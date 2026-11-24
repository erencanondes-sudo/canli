/*
 * ODALAR (Cloudflare Durable Objects). Ayrıntı: sunucu/VERITABANI.md → "Odalar".
 *
 *   Gün odası   gun/{gün}  : günün listesi (satırlar), hızlı kaynağın skoru ve uyarısı, sürümler (takım adları, analiz),
 *                            maçların içeriği (durum, istatistik, kadro, puan, olaylar, oran; gün dünden eski olunca sunucu R2'ye
 *                            taşır ve odayı boşaltır); Özet değişikliklerini iletir (Özet'in tamamı R2'de).
 *                            Bağlantı 3000'i geçince yeni gelenler kopyalara gider (aşağıda "Kopyalar").
 *   Mesaj odası mac/{no}   : maçın yorumları
 *   Bildirim odası         : zil kayıtları ve yorumlardaki @rumuz yanıt bildirimleri; sunucu bağlanıp işleri alır (abonelik, FCM)
 *   Kullanıcı bilgileri D1 veritabanında (d1.js); hesap işlemleri hesap.js
 *
 * Adresler:
 *   GET    /oda/gun/{gün}?k=&s=&kopya=   telefon bağlanır (WebSocket)
 *   GET    /oda/mac/{no}                 Yorumlar sekmesi açılınca
 *   GET    /yaz/gun/{gün}?tum=1          bütün maçların içeriği (sunucu, gün eskiyince R2'ye taşımak için)
 *   POST   /yaz/gun/{gün}                sunucu yazar (Authorization: Bearer ODA_ANAHTAR)
 *   POST   /yaz/mac/{no}                 { acik: 1 }: bu maça yorum yazılabilir
 *   POST   /hizli/gun/{gün}              hızlı kaynak (bilgisayardaki program) yazar (Authorization: Bearer HIZLI_ANAHTAR; sunucu da ODA_ANAHTAR ile)
 *   DELETE /yaz/gun/{gün}                gün odası (kopyalarıyla) boşaltılır
 *   GET    /bak/gun/{gün}?anahtar=...&kopya=, /bak/mac/{no}?anahtar=...   odanın şu anki hali (yalnızca sen; tarayıcıda açılır)
 *   GET    /oda/bildirim?anahtar=...     sunucu bildirim odasına bağlanır (WebSocket, ODA_ANAHTAR)
 *   POST   /hesap/zil                    site zil kaydını gönderir { cihaz, token, maclar, tur, google?, cikis? }
 *   GET    /bak/bildirim?anahtar=...     bildirim odasının özeti (zil kaydı sayısı, bekleyen işler)
 *   GET, POST /hesap/...                 hesap işlemleri (hesap.js)
 *
 * Sıra numarası (s): gün odasında listedeki her değişiklik 1 artar. Telefon yeniden bağlanırken son aldığı numarayı (s) ve odanın
 * kimliğini (k) gönderir; oda yalnızca kaçırılan değişiklikleri gönderir (en fazla 100; daha fazlası kaçırıldıysa
 * liste baştan gider). Gün odası son 300 değişikliği saklar, bellekte de. Kopyaların kimliği ve sırası ana odanınkiyle aynı.
 * Kimlik oda ilk kez oluşunca rastgele verilir; oda boşaltılıp yeniden oluşursa değişir (telefon her şeyi baştan alır).
 *
 * Yer: odalar Doğu Avrupa'da kurulur (Türkiye'ye en yakın bölge). Bir oda kurulduğu yerde kalır; adlarının başındaki
 * "eeur/" bu yüzden: önceki (ipucusuz, Amerika'da kurulmuş) odalardan ayrı, yeni odalar. /bak sayfasında "konum" odanın bulunduğu merkez.
 */

import { DurableObject } from 'cloudflare:workers';
import { dogrula } from './kimlik.js';
import { d1, rumuzAnahtari } from './d1.js';
import { uygunsuz } from './filtre.js';
import { hesap } from './hesap.js';

const BICIM = { gun: /^\d{4}-\d{2}-\d{2}$/, mac: /^\d{1,10}$/ };
const GUNLUK_SAKLA = 300;        /* gün odası son bu kadar değişikliği saklar (yeniden bağlanış ve Özet'in eksikleri için) */
const BELLEK_SAKLA = 300;        /* ... ve bellekte de tutar (oda uyanıkken satır okunmaz) */
const KACIRILAN_SINIR = 100;     /* telefon bundan fazla değişiklik kaçırdıysa liste baştan gider (Özet'i R2'den yeniden okur) */
const KOPYA_SINIR = 3000;        /* bir gün odasında (ana oda ya da kopya) en fazla bu kadar bağlantı; fazlası sonraki kopyaya */
const KOPYA_EN = 9;              /* en fazla bu kadar kopya (sonuncusu dolsa da kabul eder) */
const KOPYA_BOS = 10 * 60000;    /* kopya bu kadar süre bağlantısız kalınca kapanır */
const IZLE_EN = 3;               /* bir bağlantı aynı anda en fazla bu kadar maçın içeriğini dinler */
const YORUM_SAYFA = 20;          /* bir istekte en fazla bu kadar eski yorum */
const YORUM_GUNLUK = 20;         /* kişi başına günde en fazla yorum */
const BILDIRIM_ESKI = 10 * 60000;   /* bildirim kuyruğunda bu kadar eski iş gönderilmez; aynı kişiden aynı kişiye 10 dakikada bir */

/* Hesap işlemlerine Android uygulamasından (https://localhost) da izin; site aynı adresten gelir */
const IZINLI_KAYNAK = ['https://localhost'];

function izinEkle(istek, cevap) {
    const kaynak = istek.headers.get('Origin');
    if (!IZINLI_KAYNAK.includes(kaynak))
        return cevap;
    const yeni = new Response(cevap.body, cevap);
    yeni.headers.set('Access-Control-Allow-Origin', kaynak);
    yeni.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    yeni.headers.set('Access-Control-Allow-Methods', 'GET, POST');
    yeni.headers.set('Access-Control-Max-Age', '86400');
    yeni.headers.set('Vary', 'Origin');
    return yeni;
}

const bos = (durum = 404) => new Response(null, { status: durum });

/* Gelen anahtar: başlıkta (Bearer) ya da tarayıcıdan bakarken adreste (?anahtar=); izinli anahtarlardan biri mi */
function yetkili(istek, url, ...anahtarlar) {
    const gelen = (istek.headers.get('Authorization') || '').replace(/^Bearer /, '') || url.searchParams.get('anahtar') || '';
    return anahtarlar.some(a => !!a && gelen === a);
}

/* Gün odası: n = 0 ana oda, 1… kopyalar */
const gunOdasi = (env, gun, n = 0) =>
    env.GUN.get(env.GUN.idFromName('eeur/gun/' + gun + (n ? '#' + n : '')), { locationHint: 'eeur' });

export default {
    async fetch(istek, env) {
        const url = new URL(istek.url);
        const [, bolum, tur, ad] = url.pathname.split('/');
        const macOdasi = no => env.MAC.get(env.MAC.idFromName('eeur/mac/' + no), { locationHint: 'eeur' });

        const bildirimOdasi = () => env.BILDIRIM.get(env.BILDIRIM.idFromName('bildirim'), { locationHint: 'eeur' });

        /* Zil kaydı: gövde JSON (sayfadan çıkarken düz metin olarak da gelir); Google giriş kimliği varsa kişi yazılır */
        if (bolum === 'hesap' && tur === 'zil' && istek.method === 'POST') {
            const govde = await istek.text().then(t => JSON.parse(t)).catch(() => null);
            if (!govde || typeof govde !== 'object')
                return izinEkle(istek, bos(400));
            const kim = govde.google ? await dogrula(String(govde.google), env).catch(() => null) : null;
            const sonuc = await bildirimOdasi().zil(govde, istek.headers.get('CF-Connecting-IP') || '', kim && kim.google ? kim.uid : null);
            return izinEkle(istek, Response.json(sonuc, { status: sonuc.hata === 'sinir' ? 429 : sonuc.hata ? 400 : 200 }));
        }

        if (bolum === 'hesap')
            return izinEkle(istek, istek.method === 'OPTIONS' ? bos(204) : await hesap(istek, env, tur, macOdasi));

        if (bolum === 'bak' && tur === 'bildirim' && istek.method === 'GET')
            return yetkili(istek, url, env.ODA_ANAHTAR) ? Response.json(await bildirimOdasi().bak()) : bos(403);

        if (bolum === 'oda' && tur === 'bildirim' && istek.headers.get('Upgrade') === 'websocket') {
            if (!yetkili(istek, url, env.ODA_ANAHTAR))
                return bos(403);
            return bildirimOdasi().fetch(istek);
        }

        if (!BICIM[tur] || !BICIM[tur].test(ad || ''))
            return bos();

        /* Telefon ve /bak kopyayı seçebilir; yazmalar hep ana odaya (ana oda kopyalara iletir) */
        const kopya = Math.min(Math.max(Math.floor(Number(url.searchParams.get('kopya')) || 0), 0), KOPYA_EN);
        const oda = tur === 'gun' ? gunOdasi(env, ad, bolum === 'oda' || bolum === 'bak' ? kopya : 0) : macOdasi(ad);

        if (bolum === 'oda' && istek.method === 'GET') {
            if (istek.headers.get('Upgrade') !== 'websocket')
                return bos(426);
            return oda.fetch(istek);
        }

        if (bolum === 'hizli' && tur === 'gun' && istek.method === 'POST') {
            if (!yetkili(istek, url, env.HIZLI_ANAHTAR, env.ODA_ANAHTAR))
                return bos(403);
            const sonuc = await oda.hizli(await istek.json().catch(() => null), ad);
            return sonuc ? Response.json(sonuc) : bos(400);
        }

        if ((bolum === 'yaz' || bolum === 'bak') && !yetkili(istek, url, env.ODA_ANAHTAR))
            return bos(403);

        if (bolum === 'bak' && istek.method === 'GET')
            return Response.json(await oda.bak());

        if (bolum === 'yaz' && tur === 'gun' && istek.method === 'GET' && url.searchParams.get('tum'))
            return Response.json(await oda.macHepsi());

        if (bolum === 'yaz' && istek.method === 'POST')
            return Response.json(await oda.yaz(await istek.json(), ad));

        /* Yalnızca gün odası boşaltılır (mesaj odasındaki yorumlar silinmez) */
        if (bolum === 'yaz' && tur === 'gun' && istek.method === 'DELETE') {
            await oda.sil(ad);
            return bos(204);
        }

        return bos();
    }
};

/* Ortak: oda bilgisi (kimlik, sıra), bağlantı kabulü, herkese gönderme */
class Oda extends DurableObject {

    constructor(ctx, env) {
        super(ctx, env);
        this.sql = ctx.storage.sql;
        this.tablolar();
        /* Telefonun "p" yoklamasına oda uyandırılmadan "o" cevabı verilir */
        ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('p', 'o'));
    }

    /* Tablolar (oda boşaltılınca da yeniden kurulur) */
    tablolar() {
        this.sql.exec('CREATE TABLE IF NOT EXISTS bilgi (ad TEXT PRIMARY KEY, v TEXT)');
    }

    bilgi(ad) {
        const satir = this.sql.exec('SELECT v FROM bilgi WHERE ad = ?', ad).toArray()[0];
        return satir ? satir.v : null;
    }

    bilgiYaz(ad, v) {
        this.sql.exec('INSERT OR REPLACE INTO bilgi (ad, v) VALUES (?, ?)', ad, String(v));
    }

    /* Odanın kimliği (yoksa verilir) ve son sıra numarası */
    kimlik() {
        let k = this.bilgi('k');
        if (!k) {
            k = crypto.randomUUID().slice(0, 8);
            this.bilgiYaz('k', k);
        }
        return k;
    }

    sira() {
        return Number(this.bilgi('s')) || 0;
    }

    /* Açık bağlantı sayısı */
    acikSayisi() {
        return this.ctx.getWebSockets().filter(ws => ws.readyState === 1).length;
    }

    /* Odanın bulunduğu Cloudflare merkezi (ör. WAW Varşova, OTP Bükreş); yalnızca /bak için */
    async konum() {
        try {
            return (/colo=(\w+)/.exec(await (await fetch('https://cloudflare.com/cdn-cgi/trace')).text()) || [])[1] || null;
        } catch (e) {
            return null;
        }
    }

    herkese(mesaj) {
        const metin = typeof mesaj === 'string' ? mesaj : JSON.stringify(mesaj);
        this.ctx.getWebSockets().forEach(ws => {
            try {
                ws.send(metin);
            } catch (e) {}
        });
    }

    /* Telefon bağlanır: ilk mesajlar ac() ile gönderilir */
    async fetch(istek) {
        const url = new URL(istek.url);
        const [istemci, sunucu] = Object.values(new WebSocketPair());
        this.ctx.acceptWebSocket(sunucu);
        const s = url.searchParams.get('s');
        this.ac(sunucu, url.searchParams.get('k'), s === null || s === '' ? null : Number(s), url);
        return new Response(null, { status: 101, webSocket: istemci });
    }

    webSocketMessage() {}

    webSocketClose(ws, kod) {
        try {
            ws.close(kod === 1005 ? 1000 : kod);
        } catch (e) {}
    }

    /* Oda boşaltılır: bağlı telefonların bağlantısı kapanır, depo silinir */
    async sil() {
        this.ctx.getWebSockets().forEach(ws => {
            try {
                ws.close(1000, 'bosaltildi');
            } catch (e) {}
        });
        await this.ctx.storage.deleteAll();
        this.tablolar();
    }
}

/*
 * GÜN ODASI
 * bilgi tablosunda "liste": günün satırları { maç no: satır } (tek satır, JSON metni); gun (odanın günü), kopya (kopyada numarası),
 *   hazir (kopya ana odadan doldu), kopyalar (ana odada: çalışan kopyaların numaraları, JSON)
 * veri tablosu: tur h (hızlı skor "2-1"), u (hızlı uyarı "2-2" / "k"), v (sürümler: takim, analiz; sayı)
 * gunluk tablosu: değişiklikler (sıra → mesaj), son 300; bellekte de (oda uyanıkken eksikler oradan gider)
 * mac tablosu: maçların içeriği, maç başına alan alan (no, ad, v: JSON metni); ad "_g": içeriğin son değişme anı (ms)
 * r, v'yi sunucu o günün tam hali olarak yazar (oda karşılaştırır); o'yu (Özet) yalnızca değişen maçlar olarak yazar,
 * oda Özet'i saklamaz, yalnızca telefonlara iletir ve günlüğe yazar (Özet'in tamamı R2 ozet/{gün}.json'da).
 * m'yi (maç içeriği) yalnızca değişen maçlar olarak yazar: { maç no: { d?: içerik, oran?: oranlar } | null (silinir) };
 * içerikler gün eskiyince (dünden eski) sunucu tarafından R2'ye taşınır, oda boşaltılır;
 * içerik alan alan karşılaştırılır, içerikte olmayan alanlar silinir (oran hariç, o ayrı yazılır).
 * h, u'yu hızlı kaynak yazar (hizli: yalnızca değişenler).
 * Liste, hızlı kaynak ve sürümler bellekte tutulur; oda uyanınca bir kez okunur. Maç içeriği bellekte tutulmaz.
 *
 * Telefona giden mesajlar:
 *   { t: "l", k, s, z, r, h, u, v }  liste (satırlar, hızlı kaynak, sürümler), ilk bağlanışta ya da 100'den fazla değişiklik kaçırıldıysa
 *   { t: "h", k, s, z, n }         yeniden bağlanış: ardından kaçırılan n değişiklik ("d") gelir (0: telefon güncel)
 *   { t: "d", s, r?, o?, h?, u?, v? }  değişiklik: yalnızca değişenler; null = silindi
 *   { t: "oz", s, o }              telefonun { a: "oz", s } isteğine: s'den sonraki Özet değişiklikleri birleşik
 *                                  (o: null = günlükte yok, telefon R2 dosyasıyla yetinir)
 *   { t: "mm", no, g, d }          telefonun { a: "mac", no } isteğine: maçın içeriğinin tamamı (g: son değişme anı)
 *   { t: "mp", no, g, d }          maçın içeriğinde yalnızca değişen alanlar (null = silindi); yalnızca o maçı dinleyenlere
 *   { t: "my", no }                maçın içeriği odada yok
 *   { t: "dolu", kopya }           oda dolu: telefon bu kopyaya bağlanır
 * Telefondan gelen: { a: "oz", s }, { a: "mac", no } (maçı dinle; en fazla 3 maç), { a: "birak", no }.
 * z: sunucu saati (ms), telefon dakikayı doğru hesaplasın diye.
 *
 * KOPYALAR: ana odada (#0) 3000 bağlantı olunca yeni gelen telefona { t: "dolu", kopya: 1 } gider, telefon #1'e bağlanır; o da
 * dolarsa #2… (en fazla 9 kopya). Kopya ilk bağlantıda ana odadan her şeyi alır (kopyaKatil) ve ana oda kopyalarına listedeki
 * her değişikliği ve maç içeriğini iletir (kopyaAl). Kopyanın sırası eksik kalırsa ana oda her şeyi yeniden gönderir (kopyaKur).
 * Kopya 10 dakika bağlantısız kalınca ana odadan ayrılır ve kendini boşaltır. Sunucunun dinleme bağlantısı sınıra takılmaz.
 */
export class GunOdasi extends Oda {

    tablolar() {
        super.tablolar();
        this.sql.exec('CREATE TABLE IF NOT EXISTS veri (tur TEXT, no TEXT, v TEXT, PRIMARY KEY (tur, no))');
        this.sql.exec('CREATE TABLE IF NOT EXISTS gunluk (s INTEGER PRIMARY KEY, v TEXT)');
        this.sql.exec('CREATE TABLE IF NOT EXISTS mac (no TEXT, ad TEXT, v TEXT, PRIMARY KEY (no, ad))');
        this.bellek = null;
        this.sonlar = [];
        this.izleyen = null;
        this.zincir = this.zincir || new Map();
        this.bozuk = this.bozuk || new Set();
    }

    /* Bellekteki hal (yoksa okunur): { r, h, u, v, metin: listenin hazır JSON parçası } */
    hal() {
        if (!this.bellek) {
            const hal = { r: JSON.parse(this.bilgi('liste') || '{}'), h: {}, u: {}, v: {}, metin: null };
            for (const { tur, no, v } of this.sql.exec("SELECT tur, no, v FROM veri WHERE tur IN ('h', 'u', 'v')"))
                hal[tur][no] = tur === 'v' ? Number(v) : v;
            this.bellek = hal;
        }
        return this.bellek;
    }

    gunAdi(gun) {
        if (gun && !this.bilgi('gun'))
            this.bilgiYaz('gun', gun);
        return gun || this.bilgi('gun');
    }

    kopyaNo() {
        return Number(this.bilgi('kopya')) || 0;
    }

    /* Değişiklik günlüğe yazılır ve bağlı telefonlara gönderilir (metin: { t: "d", s, … }) */
    gunluge(s, metin) {
        this.bilgiYaz('s', s);
        this.sql.exec('INSERT OR REPLACE INTO gunluk (s, v) VALUES (?, ?)', s, metin);
        this.sql.exec('DELETE FROM gunluk WHERE s <= ?', s - GUNLUK_SAKLA);
        this.sonlar.push({ s, v: metin });
        if (this.sonlar.length > BELLEK_SAKLA)
            this.sonlar.shift();
        this.herkese(metin);
    }

    /* Ana odada değişiklik: kaydedilir, telefonlara gönderilir, kopyalara iletilir */
    degisiklik(degisen) {
        this.kimlik();
        const s = this.sira() + 1;
        const metin = JSON.stringify({ t: 'd', s, ...degisen });
        if (degisen.r || degisen.h || degisen.u || degisen.v)
            this.hal().metin = null;
        this.gunluge(s, metin);
        this.ilet({ d: metin });
        return s;
    }

    /* s'den sonraki değişiklikler (mesaj metinleri); günlükte hepsi yoksa null */
    sonrakiler(s) {
        const sira = this.sira();
        if (s >= sira)
            return [];
        if (this.sonlar.length && this.sonlar[0].s <= s + 1)
            return this.sonlar.filter(x => x.s > s).map(x => x.v);
        const eksik = this.sql.exec('SELECT v FROM gunluk WHERE s > ? ORDER BY s', s).toArray().map(x => x.v);
        return eksik.length === sira - s ? eksik : null;
    }

    /*
     * Sunucu yazar: { r?, o?, v?, m? }. r, v o günün tam hali: oda kendi haliyle karşılaştırır, yalnızca değişenleri saklar.
     * o yalnızca değişen maçların olayları (null = silindi): saklanmaz, olduğu gibi iletilir. r, o, v tek mesajla gider.
     * m: maçların içeriği (yukarıda); yalnızca o maçı dinleyen telefonlara gider.
     */
    yaz(govde, gun) {
        this.gunAdi(gun);
        const hal = this.hal();
        const degisen = {};
        let sayi = 0;

        if (govde.r && typeof govde.r === 'object') {
            const fark = {};
            for (const [no, satir] of Object.entries(govde.r))
                if (hal.r[no] !== String(satir))
                    fark[no] = String(satir);
            for (const no of Object.keys(hal.r))
                if (!(no in govde.r))
                    fark[no] = null;
            if (Object.keys(fark).length) {
                for (const [no, satir] of Object.entries(fark)) {
                    if (satir === null) delete hal.r[no];
                    else hal.r[no] = satir;
                }
                this.bilgiYaz('liste', JSON.stringify(hal.r));
                degisen.r = fark;
                sayi += Object.keys(fark).length;
            }
        }

        if (govde.v && typeof govde.v === 'object') {
            const fark = {};
            for (const [ad, deger] of Object.entries(govde.v)) {
                if (hal.v[ad] === Number(deger))
                    continue;
                this.sql.exec('INSERT OR REPLACE INTO veri (tur, no, v) VALUES (?, ?, ?)', 'v', ad, String(deger));
                hal.v[ad] = Number(deger);
                fark[ad] = Number(deger);
            }
            if (Object.keys(fark).length) {
                degisen.v = fark;
                sayi += Object.keys(fark).length;
            }
        }

        if (govde.o && typeof govde.o === 'object' && Object.keys(govde.o).length) {
            degisen.o = govde.o;
            sayi += Object.keys(govde.o).length;
        }

        let mac = 0;
        if (govde.m && typeof govde.m === 'object' && Object.keys(govde.m).length) {
            mac = this.macYaz(govde.m);
            this.ilet({ m: govde.m });
        }

        const s = sayi ? this.degisiklik(degisen) : this.sira();
        return { s, k: this.kimlik(), degisen: sayi, mac };
    }

    /* Maçların içeriği yazılır (yukarıda "m"); değişen maçları dinleyenlere gider. Değişen maç sayısı döner */
    macYaz(m) {
        let sayi = 0;
        for (const [no, yeni] of Object.entries(m)) {
            if (!BICIM.mac.test(no))
                continue;
            if (yeni === null) {
                if (this.sql.exec('DELETE FROM mac WHERE no = ? RETURNING ad', no).toArray().length) {
                    this.izleyenlere(no, { t: 'my', no });
                    sayi++;
                }
                continue;
            }
            if (!yeni || typeof yeni !== 'object')
                continue;
            const alanlar = Object.assign({}, yeni.d && typeof yeni.d === 'object' ? yeni.d : null);
            if (yeni.oran && typeof yeni.oran === 'object')
                alanlar.oran = yeni.oran;

            const once = new Map(this.sql.exec('SELECT ad, v FROM mac WHERE no = ?', no).toArray().map(x => [x.ad, x.v]));
            const fark = {};
            for (const [ad, deger] of Object.entries(alanlar)) {
                if (ad === '_g')
                    continue;
                const metin = JSON.stringify(deger);
                if (once.get(ad) === metin)
                    continue;
                this.sql.exec('INSERT OR REPLACE INTO mac (no, ad, v) VALUES (?, ?, ?)', no, ad, metin);
                fark[ad] = deger;
            }
            /* İçerik yazılınca içerikte olmayan alanlar silinir (oran hariç) */
            if (yeni.d && typeof yeni.d === 'object') {
                for (const ad of once.keys()) {
                    if (ad in alanlar || ad === 'oran' || ad === '_g')
                        continue;
                    this.sql.exec('DELETE FROM mac WHERE no = ? AND ad = ?', no, ad);
                    fark[ad] = null;
                }
            }
            if (!Object.keys(fark).length)
                continue;
            const g = Date.now();
            this.sql.exec('INSERT OR REPLACE INTO mac (no, ad, v) VALUES (?, ?, ?)', no, '_g', String(g));
            this.izleyenlere(no, { t: 'mp', no, g, d: fark });
            sayi++;
        }
        return sayi;
    }

    /* Maçın içeriği { d, g } (yoksa null) */
    macIcerik(no) {
        const satirlar = this.sql.exec('SELECT ad, v FROM mac WHERE no = ?', String(no)).toArray();
        if (!satirlar.length)
            return null;
        const d = {};
        let g = 0;
        for (const { ad, v } of satirlar) {
            if (ad === '_g') g = Number(v);
            else d[ad] = JSON.parse(v);
        }
        return { d, g };
    }

    /* Bütün maçların içeriği { maç no: içerik } (oranlar dahil; gün eskiyince sunucu R2'ye taşır) */
    macHepsi() {
        const hepsi = {};
        for (const { no, ad, v } of this.sql.exec("SELECT no, ad, v FROM mac WHERE ad != '_g'")) {
            if (!hepsi[no]) hepsi[no] = {};
            hepsi[no][ad] = JSON.parse(v);
        }
        return hepsi;
    }

    /* Maç no → onu dinleyen bağlantılar (bellekte; oda uyanınca bağlantıların notlarından bir kez kurulur) */
    izleyenler() {
        if (!this.izleyen) {
            this.izleyen = new Map();
            for (const ws of this.ctx.getWebSockets())
                for (const no of this.izledigi(ws))
                    this.izleyenEkle(no, ws);
        }
        return this.izleyen;
    }

    izledigi(ws) {
        try {
            return ((ws.deserializeAttachment() || {}).m || []).map(String);
        } catch (e) {
            return [];
        }
    }

    izleyenEkle(no, ws) {
        if (!this.izleyen.has(no))
            this.izleyen.set(no, new Set());
        this.izleyen.get(no).add(ws);
    }

    izleyenlere(no, mesaj) {
        const liste = this.izleyenler().get(String(no));
        if (!liste)
            return;
        const metin = JSON.stringify(mesaj);
        liste.forEach(ws => {
            try {
                ws.send(metin);
            } catch (e) {}
        });
    }

    /* Bağlantının dinlediği maçlar değişti (not bağlantının üstünde de durur: oda uyuyup uyanınca da bilinir) */
    izlemeDegistir(ws, no, ekle) {
        const liste = this.izledigi(ws).filter(x => x !== no);
        if (ekle)
            liste.push(no);
        while (liste.length > IZLE_EN)
            liste.shift();
        ws.serializeAttachment({ m: liste });
        this.izleyen = null;
    }

    /*
     * Hızlı kaynak yazar: { h?: { no: "2-1" | null }, u?: { no: "2-2" | "k" | null }, t?: 1 }, yalnızca değişenler (null = sil).
     * t: programın çalıştığını gösteren işaret (zamanı saklanır, telefonlara gitmez). Biçime uymayan istek hiç yazılmaz (null döner).
     */
    hizli(govde, gun) {
        const BICIMLER = { h: /^\d+-\d+$/, u: /^(k|\d+-\d+)$/ };
        if (!govde || typeof govde !== 'object')
            return null;
        for (const tur of ['h', 'u']) {
            const alan = govde[tur];
            if (alan === undefined)
                continue;
            if (!alan || typeof alan !== 'object')
                return null;
            for (const [no, deger] of Object.entries(alan))
                if (!BICIM.mac.test(no) || (deger !== null && !BICIMLER[tur].test(String(deger))))
                    return null;
        }

        this.gunAdi(gun);
        if (govde.t)
            this.bilgiYaz('hizli_t', Date.now());

        const hal = this.hal();
        const degisen = {};
        for (const tur of ['h', 'u']) {
            const fark = {};
            for (const [no, deger] of Object.entries(govde[tur] || {})) {
                if ((hal[tur][no] ?? null) === deger)
                    continue;
                if (deger === null) {
                    this.sql.exec('DELETE FROM veri WHERE tur = ? AND no = ?', tur, no);
                    delete hal[tur][no];
                } else {
                    this.sql.exec('INSERT OR REPLACE INTO veri (tur, no, v) VALUES (?, ?, ?)', tur, no, deger);
                    hal[tur][no] = deger;
                }
                fark[no] = deger;
            }
            if (Object.keys(fark).length)
                degisen[tur] = fark;
        }

        if (!Object.keys(degisen).length)
            return { s: this.sira(), degisen: 0 };
        return { s: this.degisiklik(degisen), degisen: Object.values(degisen).reduce((n, x) => n + Object.keys(x).length, 0) };
    }

    /* Telefon bağlanır. Kopyaysa ve henüz dolmadıysa önce ana odadan her şeyi alır; oda doluysa telefon sonraki kopyaya yollanır */
    async fetch(istek) {
        const url = new URL(istek.url);
        const gun = url.pathname.split('/')[3];
        const n = Math.min(Math.max(Math.floor(Number(url.searchParams.get('kopya')) || 0), 0), KOPYA_EN);
        this.gunAdi(gun);
        if (n && !this.bilgi('hazir'))
            this.kopyaKur(await gunOdasi(this.env, gun).kopyaKatil(n, gun), gun, n);

        const sunucu = !!this.env.ODA_ANAHTAR && url.searchParams.get('anahtar') === this.env.ODA_ANAHTAR;
        if (!sunucu && n < KOPYA_EN && this.acikSayisi() >= KOPYA_SINIR) {
            const [istemci, karsi] = Object.values(new WebSocketPair());
            this.ctx.acceptWebSocket(karsi);
            karsi.send(JSON.stringify({ t: 'dolu', kopya: n + 1 }));
            karsi.close(1000, 'dolu');
            return new Response(null, { status: 101, webSocket: istemci });
        }
        return super.fetch(istek);
    }

    ac(ws, k, s) {
        const kimlik = this.kimlik();
        const sira = this.sira();
        const z = Date.now();

        /* Telefon bu odayı tanıyor ve az şey kaçırdıysa (günlükte duruyorsa) yalnızca onlar */
        if (k === kimlik && s !== null && s <= sira && sira - s <= KACIRILAN_SINIR) {
            const eksik = this.sonrakiler(s);
            if (eksik) {
                ws.send(JSON.stringify({ t: 'h', k: kimlik, s, z, n: eksik.length }));
                eksik.forEach(v => ws.send(v));
                return;
            }
        }

        /* Liste bellekteki hazır metinden (değişince bir kez yeniden hazırlanır) */
        const hal = this.hal();
        if (!hal.metin)
            hal.metin = JSON.stringify({ r: hal.r, h: hal.h, u: hal.u, v: hal.v }).slice(1);
        ws.send('{"t":"l","k":' + JSON.stringify(kimlik) + ',"s":' + sira + ',"z":' + z + ',' + hal.metin);
    }

    /* Telefondan: { a: "oz", s } Özet'in eksikleri; { a: "mac", no } maçı dinle (içeriğin tamamı gider); { a: "birak", no } */
    webSocketMessage(ws, ham) {
        let m;
        try {
            m = JSON.parse(ham);
        } catch (e) {
            return;
        }
        if (m.a === 'oz') {
            const sira = this.sira();
            const eksik = this.sonrakiler(Math.max(0, Number(m.s) || 0));
            let o = null;
            if (eksik) {
                o = {};
                eksik.forEach(v => Object.assign(o, JSON.parse(v).o || {}));
            }
            ws.send(JSON.stringify({ t: 'oz', s: sira, o }));
            return;
        }
        const no = String(m.no || '');
        if (!BICIM.mac.test(no))
            return;
        if (m.a === 'mac') {
            this.izlemeDegistir(ws, no, true);
            const icerik = this.macIcerik(no);
            ws.send(JSON.stringify(icerik ? { t: 'mm', no, g: icerik.g, d: icerik.d } : { t: 'my', no }));
        } else if (m.a === 'birak') {
            this.izlemeDegistir(ws, no, false);
        }
    }

    /* Bağlantı kapandı: dinleme listesinden çıkar; kopyada kimse kalmadıysa 10 dakika sonra kapanmaya bakılır */
    webSocketClose(ws, kod) {
        super.webSocketClose(ws, kod);
        this.izleyen = null;
        if (this.kopyaNo() && !this.acikSayisi())
            this.ctx.storage.setAlarm(Date.now() + KOPYA_BOS);
    }

    async alarm() {
        const n = this.kopyaNo();
        if (!n || this.acikSayisi())
            return;
        const gun = this.bilgi('gun');
        if (gun)
            await gunOdasi(this.env, gun).kopyaAyril(n).catch(() => {});
        await this.ctx.storage.deleteAll();
        this.tablolar();
    }

    /* Gün odası boşaltılır (ana odada: kopyaları da) */
    async sil(gun) {
        this.gunAdi(gun);
        this.ilet({ sil: 1 });
        await Promise.all([...this.zincir.values()]).catch(() => {});
        this.zincir.clear();
        this.bozuk.clear();
        await super.sil();
    }

    /* ---------- Kopyalar ---------- */

    kopyalar() {
        return JSON.parse(this.bilgi('kopyalar') || '[]');
    }

    /* Ana odanın her şeyi (kopyaya) */
    tamHal() {
        return {
            k: this.kimlik(),
            s: this.sira(),
            liste: this.bilgi('liste') || '{}',
            veri: this.sql.exec('SELECT tur, no, v FROM veri').toArray(),
            gunluk: this.sql.exec('SELECT s, v FROM gunluk ORDER BY s').toArray(),
            mac: this.sql.exec('SELECT no, ad, v FROM mac').toArray()
        };
    }

    /* Ana odada: kopya katıldı (her şeyi alır) / ayrıldı */
    kopyaKatil(n, gun) {
        this.gunAdi(gun);
        const liste = this.kopyalar().filter(x => x !== n);
        liste.push(n);
        this.bilgiYaz('kopyalar', JSON.stringify(liste));
        this.bozuk.delete(n);
        return this.tamHal();
    }

    kopyaAyril(n) {
        this.bilgiYaz('kopyalar', JSON.stringify(this.kopyalar().filter(x => x !== n)));
        this.zincir.delete(n);
        this.bozuk.delete(n);
    }

    /* Ana odada: kopyalara iletir (her kopyaya sırayla; kopya eksik kaldıysa ya da ulaşılamadıysa her şey yeniden) */
    ilet(paket) {
        if (this.kopyaNo())
            return;
        const gun = this.bilgi('gun');
        const liste = this.kopyalar();
        if (!gun || !liste.length)
            return;
        for (const n of liste) {
            const sonraki = (this.zincir.get(n) || Promise.resolve()).then(async () => {
                const kopya = gunOdasi(this.env, gun, n);
                try {
                    if (this.bozuk.has(n) && !paket.sil) {
                        await kopya.kopyaKur(this.tamHal(), gun, n);
                        this.bozuk.delete(n);
                        return;
                    }
                    const cevap = await kopya.kopyaAl(paket);
                    if (cevap && cevap.eksik)
                        await kopya.kopyaKur(this.tamHal(), gun, n);
                } catch (e) {
                    this.bozuk.add(n);
                }
            });
            this.zincir.set(n, sonraki);
            this.ctx.waitUntil(sonraki);
        }
        if (paket.sil)
            this.bilgiYaz('kopyalar', '[]');
    }

    /* Kopyada: ana odadan gelen { d: değişiklik metni } / { m: maç içeriği } / { sil: 1 } */
    async kopyaAl(paket) {
        if (paket.sil) {
            await super.sil();
            return { tamam: 1 };
        }
        if (!this.bilgi('hazir'))
            return { eksik: 1 };
        if (paket.m)
            this.macYaz(paket.m);
        if (paket.d) {
            const m = JSON.parse(paket.d);
            const sira = this.sira();
            if (m.s <= sira)
                return { tamam: 1 };
            if (m.s !== sira + 1)
                return { eksik: 1 };
            const hal = this.hal();
            if (m.r) {
                for (const [no, satir] of Object.entries(m.r)) {
                    if (satir === null) delete hal.r[no];
                    else hal.r[no] = satir;
                }
                this.bilgiYaz('liste', JSON.stringify(hal.r));
            }
            for (const tur of ['h', 'u', 'v']) {
                for (const [no, deger] of Object.entries(m[tur] || {})) {
                    if (deger === null) {
                        this.sql.exec('DELETE FROM veri WHERE tur = ? AND no = ?', tur, no);
                        delete hal[tur][no];
                    } else {
                        this.sql.exec('INSERT OR REPLACE INTO veri (tur, no, v) VALUES (?, ?, ?)', tur, no, String(deger));
                        hal[tur][no] = tur === 'v' ? Number(deger) : deger;
                    }
                }
            }
            if (m.r || m.h || m.u || m.v)
                hal.metin = null;
            this.gunluge(m.s, paket.d);
        }
        return { tamam: 1 };
    }

    /* Kopyada: ana odanın her şeyi yazılır; bağlı telefonlara liste ve dinledikleri maçlar baştan gider */
    kopyaKur(tam, gun, n) {
        this.sql.exec('DELETE FROM veri');
        this.sql.exec('DELETE FROM gunluk');
        this.sql.exec('DELETE FROM mac');
        this.bilgiYaz('k', tam.k);
        this.bilgiYaz('s', tam.s);
        this.bilgiYaz('liste', tam.liste);
        this.bilgiYaz('gun', gun);
        this.bilgiYaz('kopya', n);
        for (const x of tam.veri)
            this.sql.exec('INSERT INTO veri (tur, no, v) VALUES (?, ?, ?)', x.tur, x.no, x.v);
        for (const x of tam.gunluk)
            this.sql.exec('INSERT INTO gunluk (s, v) VALUES (?, ?)', x.s, x.v);
        for (const x of tam.mac)
            this.sql.exec('INSERT INTO mac (no, ad, v) VALUES (?, ?, ?)', x.no, x.ad, x.v);
        this.bellek = null;
        this.sonlar = tam.gunluk.slice(-BELLEK_SAKLA).map(x => ({ s: x.s, v: x.v }));
        this.bilgiYaz('hazir', 1);

        for (const ws of this.ctx.getWebSockets()) {
            if (ws.readyState !== 1)
                continue;
            try {
                this.ac(ws, null, null);
                for (const no of this.izledigi(ws)) {
                    const icerik = this.macIcerik(no);
                    ws.send(JSON.stringify(icerik ? { t: 'mm', no, g: icerik.g, d: icerik.d } : { t: 'my', no }));
                }
            } catch (e) {}
        }
    }

    async bak() {
        const hal = this.hal();
        return {
            konum: await this.konum(),
            gun: this.bilgi('gun'),
            kopya: this.kopyaNo(),
            kopyalar: this.kopyaNo() ? undefined : this.kopyalar(),
            kimlik: this.bilgi('k'),
            sira: this.sira(),
            bagli_telefon: this.acikSayisi(),
            mac_sayisi: Object.keys(hal.r).length,
            icerigi_olan_mac: this.sql.exec('SELECT COUNT(DISTINCT no) AS n FROM mac').one().n,
            hizli_son_isaret: this.bilgi('hizli_t') ? new Date(Number(this.bilgi('hizli_t'))).toISOString() : null,
            r: hal.r,
            h: hal.h,
            u: hal.u,
            v: hal.v,
            son_degisiklikler: this.sql.exec('SELECT v FROM gunluk ORDER BY s DESC LIMIT 20').toArray().map(x => JSON.parse(x.v))
        };
    }
}

/*
 * MESAJ ODASI (maç başına; adresi eski "maç odası" ile aynı, yorumlar korunur)
 * bilgi tablosunda: no (maç no), acik (sunucu yazar: bu maça yorum yazılabilir)
 * yorum tablosu: id, u (yazanın kimliği), r (rumuz), t (metin), z (zaman, ms), y (yanıtlanan yorum), b, d (beğeni, beğenmeme sayısı)
 * oy tablosu: id (yorum), u (kimlik), v (1 beğeni, -1 beğenmeme, 0 geri alındı), n (kaç kez değişti, en fazla 2)
 * Yorumlar şimdilik hiç silinmez. (Eski maç içeriği tablosu "sekme" oda ilk uyanışında silinir.)
 *
 * Telefona giden mesajlar:
 *   { t: "a" }              bağlanınca (telefon yorumları ister)
 *   { t: "c", c }           yeni yorum;  { t: "x", id } yorum silindi;  { t: "b", id, b, d } oy sayıları
 *                           (yalnızca yorumları istemiş bağlantılara: "daha" isteği)
 *   { t: "r", n, ... }      telefonun isteğine cevap (n: isteğin numarası): { ok: true, ... } ya da { hata: "kod" }
 * Telefondan gelen istekler (JSON, n: isteğin numarası):
 *   { a: "daha", once?: yorum no, adet }        en son (once verilirse bu yorumdan eski) en fazla 20 yorum (giriş gerekmez);
 *                                                bu bağlantıya bundan sonra yeni yorumlar da gider
 *   { a: "yaz", token, t, y? }  { a: "sil", token, id }  { a: "oy", token, id, v: 1 | -1 }  { a: "sikayet", token, id }
 *   token: Firebase giriş kimliği (Google ile giriş). Hata kodları: giris, rumuz, kapali, bicim, uygunsuz, gunluk, yok, yetki, kendi, oy_sinir
 */
export class MacOdasi extends Oda {

    tablolar() {
        super.tablolar();
        this.sql.exec('CREATE TABLE IF NOT EXISTS yorum (id INTEGER PRIMARY KEY AUTOINCREMENT, u TEXT NOT NULL, r TEXT NOT NULL, ' +
            't TEXT NOT NULL, z INTEGER NOT NULL, y INTEGER, b INTEGER NOT NULL DEFAULT 0, d INTEGER NOT NULL DEFAULT 0)');
        this.sql.exec('CREATE TABLE IF NOT EXISTS oy (id INTEGER NOT NULL, u TEXT NOT NULL, v INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (id, u))');
        /* Eski maç içeriği (artık gün odasında) */
        this.sql.exec('DROP TABLE IF EXISTS sekme');
        this.sql.exec("DELETE FROM bilgi WHERE ad IN ('g', 's', 'k')");
    }

    /* Sunucu yazar: { acik: 1 } */
    yaz(govde) {
        if (govde && govde.acik && !this.bilgi('acik'))
            this.bilgiYaz('acik', 1);
        return { acik: !!this.bilgi('acik') };
    }

    ac(ws, k, s, url) {
        if (!this.bilgi('no'))
            this.bilgiYaz('no', url.pathname.split('/')[3]);
        ws.send('{"t":"a"}');
    }

    /* Yorumları istemiş bağlantılara (Yorumlar sekmesi açık) */
    yorumculara(mesaj) {
        const metin = JSON.stringify(mesaj);
        this.ctx.getWebSockets().forEach(ws => {
            try {
                if ((ws.deserializeAttachment() || {}).yorum)
                    ws.send(metin);
            } catch (e) {}
        });
    }

    /* Yorumlar, yeniden eskiye (once verilirse ondan eskiler) */
    yorumlar(once, adet) {
        return this.sql.exec('SELECT id, u, r, t, z, y, b, d FROM yorum WHERE id < ? ORDER BY id DESC LIMIT ?', once || Number.MAX_SAFE_INTEGER, adet)
            .toArray().map(x => {
                const c = { id: x.id, u: x.u, r: x.r, t: x.t, z: x.z, b: x.b, d: x.d };
                if (x.y) c.y = x.y;
                return c;
            });
    }

    async webSocketMessage(ws, ham) {
        let m;
        try {
            m = JSON.parse(ham);
        } catch (e) {
            return;
        }
        const cevap = veri => ws.send(JSON.stringify({ t: 'r', n: m.n, ...veri }));
        try {
            if (m.a === 'daha') {
                ws.serializeAttachment({ yorum: 1 });
                return cevap({ ok: true, c: this.yorumlar(Number(m.once) || null, Math.min(Math.max(Number(m.adet) || 10, 1), YORUM_SAYFA)) });
            }
            const kim = await dogrula(m.token, this.env);
            if (!kim || !kim.google)
                return cevap({ hata: 'giris' });
            cevap(await this.islem(kim.uid, m));
        } catch (e) {
            cevap({ hata: 'sunucu' });
        }
    }

    async islem(uid, m) {
        const mac = this.bilgi('no');
        const id = Number(m.id);
        const yorum = m.a === 'yaz' ? null : this.sql.exec('SELECT u FROM yorum WHERE id = ?', id).toArray()[0];
        const db = await d1(this.env);

        if (m.a === 'yaz') {
            const t = String(m.t || '').trim();
            if (!this.bilgi('acik'))
                return { hata: 'kapali' };
            if (!t || t.length > 100)
                return { hata: 'bicim' };
            if (uygunsuz(t))
                return { hata: 'uygunsuz' };
            const kisi = await db.prepare('SELECT r FROM kisi WHERE uid = ?').bind(uid).first();
            if (!kisi || !kisi.r)
                return { hata: 'rumuz' };

            /* Gün no: Türkiye saatine göre (zaman + 3 saat) / 1 gün */
            const gun = Math.floor((Date.now() + 3 * 3600000) / 86400000);
            const sayac = await db.prepare('SELECT g, n FROM sayac WHERE uid = ?').bind(uid).first();
            const n = sayac && sayac.g === gun ? sayac.n + 1 : 1;
            if (n > YORUM_GUNLUK)
                return { hata: 'gunluk' };

            const y = Number.isInteger(m.y) && this.sql.exec('SELECT 1 FROM yorum WHERE id = ?', m.y).toArray().length ? m.y : null;
            const yeni = { u: uid, r: kisi.r, t, z: Date.now() };
            yeni.id = this.sql.exec('INSERT INTO yorum (u, r, t, z, y) VALUES (?, ?, ?, ?, ?) RETURNING id', uid, kisi.r, t, yeni.z, y).one().id;
            if (y)
                yeni.y = y;
            yeni.b = 0;
            yeni.d = 0;
            await db.batch([
                db.prepare('INSERT OR REPLACE INTO sayac (uid, g, n) VALUES (?, ?, ?)').bind(uid, gun, n),
                db.prepare('INSERT OR IGNORE INTO mesajlarim (uid, mac, mesaj) VALUES (?, ?, ?)').bind(uid, mac, String(yeni.id))
            ]);
            this.yorumculara({ t: 'c', c: yeni });
            this.ctx.waitUntil(this.yanitBildir(yeni, mac, db).catch(() => {}));
            return { ok: true, id: yeni.id };
        }

        if (!yorum)
            return m.a === 'sil' ? { ok: true } : { hata: 'yok' };

        if (m.a === 'sil') {
            if (yorum.u !== uid)
                return { hata: 'yetki' };
            await this.yorumSil([id], uid);
            return { ok: true };
        }

        if (m.a === 'oy') {
            const v = m.v === 1 ? 1 : m.v === -1 ? -1 : null;
            if (!v)
                return { hata: 'bicim' };
            if (yorum.u === uid)
                return { hata: 'kendi' };
            const once = this.sql.exec('SELECT v, n FROM oy WHERE id = ? AND u = ?', id, uid).toArray()[0];
            const yeni = once && once.v === v ? 0 : v;
            const n = once ? once.n + 1 : 0;
            if (n > 2)
                return { hata: 'oy_sinir' };
            this.sql.exec('INSERT OR REPLACE INTO oy (id, u, v, n) VALUES (?, ?, ?, ?)', id, uid, yeni, n);
            const sayi = this.sql.exec('SELECT SUM(v = 1) AS b, SUM(v = -1) AS d FROM oy WHERE id = ?', id).one();
            this.sql.exec('UPDATE yorum SET b = ?, d = ? WHERE id = ?', sayi.b || 0, sayi.d || 0, id);
            this.yorumculara({ t: 'b', id, b: sayi.b || 0, d: sayi.d || 0 });
            return { ok: true, v: yeni };
        }

        if (m.a === 'sikayet') {
            await db.prepare('INSERT OR IGNORE INTO sikayet (mac, mesaj, uid, z) VALUES (?, ?, ?, ?)').bind(mac, String(id), uid, Date.now()).run();
            return { ok: true };
        }

        return { hata: 'bicim' };
    }

    /* Kişinin yorumları silinir (kendi isteğiyle ya da hesabı silinince) */
    async yorumSil(idler, uid) {
        const mac = this.bilgi('no');
        const db = await d1(this.env);
        for (const id of idler) {
            if (!this.sql.exec('DELETE FROM yorum WHERE id = ? AND u = ? RETURNING id', id, uid).toArray().length)
                continue;
            this.sql.exec('DELETE FROM oy WHERE id = ?', id);
            await db.prepare('DELETE FROM mesajlarim WHERE uid = ? AND mac = ? AND mesaj = ?').bind(uid, mac, String(id)).run();
            this.yorumculara({ t: 'x', id });
        }
    }

    /*
     * Yorumda @rumuz geçiyorsa (en fazla 2) o kişilere yanıt bildirimi (bildirim kuyruğuna). Gitmez: kendine, yanıt bildirimlerini
     * kapatana, göndereni engelleyene ya da göndericinin engellediğine, yanıtlanan yorumu için bildirimi kapatana,
     * aynı gönderenden 10 dakika içinde ikinci kez.
     */
    async yanitBildir(yorum, mac, db) {
        const adlar = [...new Set([...yorum.t.matchAll(/@([A-Za-z0-9_çğıöşüÇĞİÖŞÜ]{3,15})/g)].map(x => rumuzAnahtari(x[1])))].slice(0, 2);
        for (const ad of adlar) {
            const sahip = await db.prepare('SELECT uid FROM rumuz WHERE ad = ?').bind(ad).first();
            const kime = sahip && sahip.uid;
            if (!kime || kime === yorum.u)
                continue;
            const cift = yorum.u + '>' + kime;
            const [son, kisi, engel, sessiz] = await db.batch([
                db.prepare('SELECT z FROM bildirim_son WHERE cift = ?').bind(cift),
                db.prepare('SELECT b FROM kisi WHERE uid = ?').bind(kime),
                db.prepare('SELECT 1 FROM engel WHERE (uid = ? AND kim = ?) OR (uid = ? AND kim = ?)').bind(kime, yorum.u, yorum.u, kime),
                db.prepare('SELECT 1 FROM sessiz WHERE uid = ? AND mac = ? AND mesaj = ?').bind(kime, mac, String(yorum.y || ''))
            ]);
            if ((son.results[0] && Date.now() - son.results[0].z < BILDIRIM_ESKI) || (kisi.results[0] && kisi.results[0].b === 1) ||
                engel.results.length || sessiz.results.length)
                continue;
            await this.env.BILDIRIM.get(this.env.BILDIRIM.idFromName('bildirim'), { locationHint: 'eeur' })
                .ekle({ kisi: kime, baslik: yorum.r + ' sana yazdı', metin: yorum.t, link: '#mac=' + mac + '&yorum' });
            await db.prepare('INSERT OR REPLACE INTO bildirim_son (cift, z) VALUES (?, ?)').bind(cift, Date.now()).run();
        }
    }

    async bak() {
        return {
            konum: await this.konum(),
            no: this.bilgi('no'),
            bagli_telefon: this.acikSayisi(),
            yorum_acik: !!this.bilgi('acik'),
            yorum_sayisi: this.sql.exec('SELECT COUNT(*) AS n FROM yorum').one().n,
            son_yorumlar: this.yorumlar(null, 20)
        };
    }
}

/*
 * BİLDİRİM ODASI (tek oda): zil kayıtları ve sunucuya giden işler.
 *
 * Zil kaydı (site gönderir: POST /hesap/zil): cihaz başına { token, maclar, kisi?, tur }. zil tablosunda son hal ve sunucuya
 * en son iletilen hal (iletilen: { token, maclar }). Değişiklik sunucuya cihaz başına en fazla 5 sn'de bir iletilir: daha
 * önce gelirse son hal saklanır, süre dolunca (zamanlayıcı) iletilir; hiçbir değişiklik kaybolmaz.
 * İnternet adresi başına dakikada en fazla 30 istek ve günde en fazla 50 yeni cihaz (fazlası reddedilir).
 * kisi yalnızca geçerli Google girişiyle yazılır; { cikis: true } ile silinir (giriş kimliği gelmezse eskisi kalır).
 *
 * Sunucuya giden işler (kuyruk; sunucu işi yapınca { ack: no } gönderir, o iş silinir):
 *   { t: "z", id, token, ekle: [maç no], cikar: [maç no] }  cihaz anahtarını maçların bildirim konusuna abone et / çıkar
 *                                                         (sunucu onaylayana kadar bekler)
 *   { t: "i", id, tokenlar, baslik, metin, link }         yanıt bildirimi (kişinin bütün cihazlarına; 10 dk'dan eskisi gitmez)
 * Sunucudan gelen: { ack: no }, { gecersiz: token } (cihaz anahtarı geçersizleşti: kayıtları silinir).
 */
const ZIL_ARALIK = 5000;          /* bir cihazın değişikliği sunucuya en fazla bu aralıkla iletilir */
const ZIL_DAKIKA = 30;            /* internet adresi başına dakikada en fazla istek */
const ZIL_YENI_GUNLUK = 50;       /* internet adresi başına günde en fazla yeni cihaz */
const ZIL_MAC_EN = 100;           /* bir kayıtta en fazla maç */

export class BildirimOdasi extends Oda {

    tablolar() {
        super.tablolar();
        this.sql.exec('CREATE TABLE IF NOT EXISTS kuyruk (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT NOT NULL, z INTEGER NOT NULL)');
        try { this.sql.exec("ALTER TABLE kuyruk ADD COLUMN t TEXT NOT NULL DEFAULT 'i'"); } catch (e) {}
        this.sql.exec('CREATE TABLE IF NOT EXISTS zil (cihaz TEXT PRIMARY KEY, token TEXT NOT NULL, maclar TEXT NOT NULL, ' +
            'kisi TEXT, tur TEXT, z INTEGER NOT NULL, iletilen TEXT, g INTEGER NOT NULL DEFAULT 0, bekliyor INTEGER NOT NULL DEFAULT 0)');
        this.sql.exec('CREATE INDEX IF NOT EXISTS zil_kisi ON zil (kisi)');
        this.sql.exec('CREATE INDEX IF NOT EXISTS zil_token ON zil (token)');
        this.sql.exec('CREATE TABLE IF NOT EXISTS yeni_cihaz (ip TEXT, gun INTEGER, n INTEGER, PRIMARY KEY (ip, gun))');
        this.dakikalik = new Map();   /* ip → { dk, n } (bellekte) */
    }

    /* Kuyruğa iş ekler, sunucu bağlıysa hemen gönderir */
    kuyruga(t, is) {
        const z = Date.now();
        const id = this.sql.exec('INSERT INTO kuyruk (v, z, t) VALUES (?, ?, ?) RETURNING id', JSON.stringify(is), z, t).one().id;
        this.herkese({ t, id, ...is });
    }

    /* Yanıt bildirimi (mesaj odası ekler): kişinin cihazlarının anahtarlarıyla */
    ekle(is) {
        this.sql.exec("DELETE FROM kuyruk WHERE t = 'i' AND z < ?", Date.now() - BILDIRIM_ESKI);
        const tokenlar = [...new Set(this.sql.exec('SELECT token FROM zil WHERE kisi = ?', is.kisi).toArray().map(x => x.token))];
        if (!tokenlar.length)
            return;
        this.kuyruga('i', { tokenlar, baslik: is.baslik, metin: is.metin, link: is.link });
    }

    /* Site zil kaydını gönderir. Cevap { ok } ya da { hata } */
    zil(govde, ip, kisi) {
        const cihaz = String((govde || {}).cihaz || '');
        const token = String((govde || {}).token || '');
        const maclar = Array.isArray(govde.maclar) ? [...new Set(govde.maclar.map(String).filter(no => BICIM.mac.test(no)))].slice(-ZIL_MAC_EN) : null;
        if (!/^[0-9a-f]{16,64}$/.test(cihaz) || !token || token.length > 400 || !maclar)
            return { hata: 'bicim' };

        /* İnternet adresi başına dakikada en fazla 30 istek */
        const dk = Math.floor(Date.now() / 60000);
        const sayac = this.dakikalik.get(ip);
        if (sayac && sayac.dk === dk && sayac.n >= ZIL_DAKIKA)
            return { hata: 'sinir' };
        this.dakikalik.set(ip, sayac && sayac.dk === dk ? { dk, n: sayac.n + 1 } : { dk, n: 1 });
        if (this.dakikalik.size > 10000)
            this.dakikalik.clear();

        const once = this.sql.exec('SELECT kisi FROM zil WHERE cihaz = ?', cihaz).toArray()[0];

        /* Yeni cihaz: internet adresi başına günde en fazla 50 */
        if (!once) {
            const gun = Math.floor(Date.now() / 86400000);
            const n = (this.sql.exec('SELECT n FROM yeni_cihaz WHERE ip = ? AND gun = ?', ip, gun).toArray()[0] || {}).n || 0;
            if (n >= ZIL_YENI_GUNLUK)
                return { hata: 'sinir' };
            this.sql.exec('INSERT OR REPLACE INTO yeni_cihaz (ip, gun, n) VALUES (?, ?, ?)', ip, gun, n + 1);
            this.sql.exec('DELETE FROM yeni_cihaz WHERE gun < ?', gun - 1);
        }

        const yeniKisi = kisi || (govde.cikis ? null : once ? once.kisi : null);
        const tur = govde.tur === 'uygulama' ? 'uygulama' : 'site';
        if (once)
            this.sql.exec('UPDATE zil SET token = ?, maclar = ?, kisi = ?, tur = ?, z = ? WHERE cihaz = ?',
                token, JSON.stringify(maclar), yeniKisi, tur, Date.now(), cihaz);
        else
            this.sql.exec('INSERT INTO zil (cihaz, token, maclar, kisi, tur, z) VALUES (?, ?, ?, ?, ?, ?)',
                cihaz, token, JSON.stringify(maclar), yeniKisi, tur, Date.now());
        this.ilet(cihaz);
        return { ok: true };
    }

    /* Cihazın değişikliği sunucuya: son iletilenden bu yana 5 sn geçtiyse hemen, geçmediyse süre dolunca */
    ilet(cihaz) {
        const k = this.sql.exec('SELECT token, maclar, iletilen, g FROM zil WHERE cihaz = ?', cihaz).toArray()[0];
        if (!k)
            return;
        const simdi = Date.now();
        if (simdi - k.g < ZIL_ARALIK) {
            this.sql.exec('UPDATE zil SET bekliyor = 1 WHERE cihaz = ?', cihaz);
            this.zamanla(k.g + ZIL_ARALIK);
            return;
        }
        const once = k.iletilen ? JSON.parse(k.iletilen) : { token: null, maclar: [] };
        const simdiki = JSON.parse(k.maclar);
        /* Aynı anahtar başka kayıtta da varsa onun maçlarından çıkarılmaz */
        const baska = token => new Set(this.sql.exec('SELECT maclar FROM zil WHERE token = ? AND cihaz != ?', token, cihaz).toArray()
            .flatMap(x => JSON.parse(x.maclar)));
        if (once.token && once.token !== k.token) {
            const kalan = baska(once.token);
            const cikar = once.maclar.filter(no => !kalan.has(no));
            if (cikar.length)
                this.kuyruga('z', { token: once.token, ekle: [], cikar });
            once.maclar = [];
        }
        const ekle = simdiki.filter(no => !once.maclar.includes(no));
        const kalan = baska(k.token);
        const cikar = once.maclar.filter(no => !simdiki.includes(no) && !kalan.has(no));
        if (ekle.length || cikar.length)
            this.kuyruga('z', { token: k.token, ekle, cikar });
        this.sql.exec('UPDATE zil SET iletilen = ?, g = ?, bekliyor = 0 WHERE cihaz = ?',
            JSON.stringify({ token: k.token, maclar: simdiki }), simdi, cihaz);
    }

    async zamanla(an) {
        const once = await this.ctx.storage.getAlarm();
        if (!once || once > an)
            await this.ctx.storage.setAlarm(an);
    }

    /* Süresi dolan bekleyen değişiklikler iletilir */
    async alarm() {
        const simdi = Date.now();
        for (const { cihaz } of this.sql.exec('SELECT cihaz FROM zil WHERE bekliyor = 1 AND g <= ?', simdi - ZIL_ARALIK).toArray())
            this.ilet(cihaz);
        const sonraki = this.sql.exec('SELECT MIN(g) AS g FROM zil WHERE bekliyor = 1').one().g;
        if (sonraki)
            await this.ctx.storage.setAlarm(Math.max(sonraki + ZIL_ARALIK, simdi + 1000));
    }

    /* Sunucu bağlanınca: onaylanmamış abonelik işleri ve son 10 dakikanın yanıt bildirimleri */
    ac(ws) {
        this.sql.exec("SELECT id, v, t FROM kuyruk WHERE t = 'z' OR z >= ? ORDER BY id", Date.now() - BILDIRIM_ESKI).toArray()
            .forEach(x => ws.send(JSON.stringify({ t: x.t, id: x.id, ...JSON.parse(x.v) })));
    }

    webSocketMessage(ws, ham) {
        try {
            const m = JSON.parse(ham);
            if (Number.isInteger(m.ack))
                this.sql.exec('DELETE FROM kuyruk WHERE id = ?', m.ack);
            if (typeof m.gecersiz === 'string' && m.gecersiz)
                this.sql.exec('DELETE FROM zil WHERE token = ?', m.gecersiz);
        } catch (e) {}
    }

    async bak() {
        return {
            konum: await this.konum(),
            bagli_sunucu: this.acikSayisi(),
            zil_kaydi: this.sql.exec('SELECT COUNT(*) AS n FROM zil').one().n,
            girisli_cihaz: this.sql.exec('SELECT COUNT(*) AS n FROM zil WHERE kisi IS NOT NULL').one().n,
            bekleyen_is: this.sql.exec('SELECT t, COUNT(*) AS n FROM kuyruk GROUP BY t').toArray()
        };
    }
}
