/*
 * ODALAR (Cloudflare Durable Objects). Ayrıntı: sunucu/VERITABANI.md → "Odalar".
 *
 *   Gün odası  gun/{gün}  : günün listesi (satırlar), Özet (olaylar), hızlı kaynağın skoru ve uyarısı, sürümler (takım adları, analiz)
 *   Maç odası  mac/{no}   : maçın içeriği (durum, istatistik, kadro, olaylar; maç kesinleşince R2'ye yazılır ve odadan silinir) ve yorumları
 *   Bildirim kuyruğu      : yorumlardaki @rumuz yanıt bildirimleri; sunucu bağlanıp alır ve FCM ile gönderir
 *   Kullanıcı bilgileri D1 veritabanında (d1.js); hesap işlemleri hesap.js
 *
 * Adresler:
 *   GET    /oda/gun/{gün}?k=&s=   telefon bağlanır (WebSocket); site bunu Cloudflare Pages'ten (functions/oda) geçirir
 *   GET    /oda/mac/{no}?k=&s=
 *   POST   /yaz/gun/{gün}         sunucu yazar (Authorization: Bearer ODA_ANAHTAR)
 *   POST   /yaz/mac/{no}
 *   POST   /hizli/gun/{gün}       hızlı kaynak (bilgisayardaki program) yazar (Authorization: Bearer HIZLI_ANAHTAR; sunucu da ODA_ANAHTAR ile)
 *   DELETE /yaz/gun/{gün}, /yaz/mac/{no}   oda boşaltılır
 *   GET    /bak/gun/{gün}?anahtar=..., /bak/mac/{no}?anahtar=...   odanın şu anki hali (yalnızca sen; tarayıcıda açılır)
 *   GET    /oda/bildirim?anahtar=...   sunucu bildirim kuyruğuna bağlanır (WebSocket, ODA_ANAHTAR)
 *   GET, POST /hesap/...   hesap işlemleri (hesap.js; site Cloudflare Pages'ten, functions/hesap, geçirir)
 *
 * Sıra numarası (s): odadaki her değişiklik 1 artar. Telefon yeniden bağlanırken son aldığı numarayı (s) ve odanın
 * kimliğini (k) gönderir; oda yalnızca kaçırılan değişiklikleri gönderir (gün odası son 1000 değişikliği saklar).
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
const GUNLUK_SAKLA = 1000;
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

export default {
    async fetch(istek, env) {
        const url = new URL(istek.url);
        const [, bolum, tur, ad] = url.pathname.split('/');
        const macOdasi = no => env.MAC.get(env.MAC.idFromName('eeur/mac/' + no), { locationHint: 'eeur' });

        if (bolum === 'hesap')
            return izinEkle(istek, istek.method === 'OPTIONS' ? bos(204) : await hesap(istek, env, tur, macOdasi));

        if (bolum === 'oda' && tur === 'bildirim' && istek.headers.get('Upgrade') === 'websocket') {
            if (!yetkili(istek, url, env.ODA_ANAHTAR))
                return bos(403);
            return env.BILDIRIM.get(env.BILDIRIM.idFromName('bildirim'), { locationHint: 'eeur' }).fetch(istek);
        }

        if (!BICIM[tur] || !BICIM[tur].test(ad || ''))
            return bos();

        const oda = tur === 'gun' ? env.GUN.get(env.GUN.idFromName('eeur/gun/' + ad), { locationHint: 'eeur' }) : macOdasi(ad);

        if (bolum === 'oda' && istek.method === 'GET') {
            if (istek.headers.get('Upgrade') !== 'websocket')
                return bos(426);
            return oda.fetch(istek);
        }

        if (bolum === 'hizli' && tur === 'gun' && istek.method === 'POST') {
            if (!yetkili(istek, url, env.HIZLI_ANAHTAR, env.ODA_ANAHTAR))
                return bos(403);
            const sonuc = await oda.hizli(await istek.json().catch(() => null));
            return sonuc ? Response.json(sonuc) : bos(400);
        }

        if ((bolum === 'yaz' || bolum === 'bak') && !yetkili(istek, url, env.ODA_ANAHTAR))
            return bos(403);

        if (bolum === 'bak' && istek.method === 'GET')
            return Response.json(await oda.bak());

        if (bolum === 'yaz' && istek.method === 'POST')
            return Response.json(await oda.yaz(await istek.json()));

        if (bolum === 'yaz' && istek.method === 'DELETE') {
            await oda.sil();
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

    /* Odanın bulunduğu Cloudflare merkezi (ör. WAW Varşova, OTP Bükreş); yalnızca /bak için */
    async konum() {
        try {
            return (/colo=(\w+)/.exec(await (await fetch('https://cloudflare.com/cdn-cgi/trace')).text()) || [])[1] || null;
        } catch (e) {
            return null;
        }
    }

    herkese(mesaj) {
        const metin = JSON.stringify(mesaj);
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
 * veri tablosu: tur r (satır metni), o (maçın olayları, JSON metni), h (hızlı skor "2-1"), u (hızlı uyarı "2-2" / "k"),
 *   v (sürümler: takim, analiz; sayı)
 * gunluk tablosu: değişiklikler (sıra → mesaj), son 1000
 * r, o, v'yi sunucu yazar (yaz: o günün tam hali); h, u'yu hızlı kaynak yazar (hizli: yalnızca değişenler).
 *
 * Telefona giden mesajlar:
 *   { t: "l", k, s, z, r, h, u, v }  liste (satırlar, hızlı kaynak, sürümler), ilk bağlanışta önce bu
 *   { t: "o", o }                  Özet, listeden hemen sonra
 *   { t: "h", k, s, z, n }         yeniden bağlanış: ardından kaçırılan n değişiklik ("d") gelir (0: telefon güncel)
 *   { t: "d", s, r?, o?, h?, u?, v? }  değişiklik: yalnızca değişenler; null = silindi
 * z: sunucu saati (ms), telefon dakikayı doğru hesaplasın diye.
 */
export class GunOdasi extends Oda {

    tablolar() {
        super.tablolar();
        this.sql.exec('CREATE TABLE IF NOT EXISTS veri (tur TEXT, no TEXT, v TEXT, PRIMARY KEY (tur, no))');
        this.sql.exec('CREATE TABLE IF NOT EXISTS gunluk (s INTEGER PRIMARY KEY, v TEXT)');
    }

    /* Odanın tamamı: { r: {no: satır}, o: {no: [olaylar]}, h: {...}, u: {...}, v: {takim, analiz} } */
    hal() {
        const hal = { r: {}, o: {}, h: {}, u: {}, v: {} };
        for (const { tur, no, v } of this.sql.exec('SELECT tur, no, v FROM veri'))
            hal[tur][no] = tur === 'o' ? JSON.parse(v) : tur === 'v' ? Number(v) : v;
        return hal;
    }

    /* Değişiklik kaydedilir ve bağlı telefonlara gönderilir */
    degisiklik(degisen) {
        this.kimlik();
        const s = this.sira() + 1;
        const mesaj = { t: 'd', s, ...degisen };
        this.bilgiYaz('s', s);
        this.sql.exec('INSERT INTO gunluk (s, v) VALUES (?, ?)', s, JSON.stringify(mesaj));
        this.sql.exec('DELETE FROM gunluk WHERE s <= ?', s - GUNLUK_SAKLA);
        this.herkese(mesaj);
        return s;
    }

    /*
     * Sunucu yazar: { r?, o?, v? }, her alan o günün tam hali. Oda kendi haliyle karşılaştırır,
     * yalnızca değişenleri saklar ve bağlı telefonlara tek mesajla gönderir.
     */
    yaz(govde) {
        const degisen = {};
        let sayi = 0;

        for (const tur of ['r', 'o', 'v']) {
            const yeni = govde[tur];
            if (!yeni || typeof yeni !== 'object')
                continue;
            const once = new Map(this.sql.exec('SELECT no, v FROM veri WHERE tur = ?', tur).toArray().map(x => [x.no, x.v]));
            const fark = {};

            for (const [no, deger] of Object.entries(yeni)) {
                const metin = tur === 'o' ? JSON.stringify(deger) : String(deger);
                if (once.get(no) === metin)
                    continue;
                this.sql.exec('INSERT OR REPLACE INTO veri (tur, no, v) VALUES (?, ?, ?)', tur, no, metin);
                fark[no] = deger;
            }
            for (const no of once.keys()) {
                if (no in yeni)
                    continue;
                this.sql.exec('DELETE FROM veri WHERE tur = ? AND no = ?', tur, no);
                fark[no] = null;
            }
            if (Object.keys(fark).length) {
                degisen[tur] = fark;
                sayi += Object.keys(fark).length;
            }
        }

        if (!sayi)
            return { s: this.sira(), degisen: 0 };
        return { s: this.degisiklik(degisen), degisen: sayi };
    }

    /*
     * Hızlı kaynak yazar: { h?: { no: "2-1" | null }, u?: { no: "2-2" | "k" | null }, t?: 1 }, yalnızca değişenler (null = sil).
     * t: programın çalıştığını gösteren işaret (zamanı saklanır, telefonlara gitmez). Biçime uymayan istek hiç yazılmaz (null döner).
     */
    hizli(govde) {
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

        if (govde.t)
            this.bilgiYaz('hizli_t', Date.now());

        const degisen = {};
        for (const tur of ['h', 'u']) {
            const fark = {};
            for (const [no, deger] of Object.entries(govde[tur] || {})) {
                const once = this.sql.exec('SELECT v FROM veri WHERE tur = ? AND no = ?', tur, no).toArray()[0];
                if ((once ? once.v : null) === deger)
                    continue;
                if (deger === null)
                    this.sql.exec('DELETE FROM veri WHERE tur = ? AND no = ?', tur, no);
                else
                    this.sql.exec('INSERT OR REPLACE INTO veri (tur, no, v) VALUES (?, ?, ?)', tur, no, deger);
                fark[no] = deger;
            }
            if (Object.keys(fark).length)
                degisen[tur] = fark;
        }

        if (!Object.keys(degisen).length)
            return { s: this.sira(), degisen: 0 };
        return { s: this.degisiklik(degisen), degisen: Object.values(degisen).reduce((n, x) => n + Object.keys(x).length, 0) };
    }

    ac(ws, k, s) {
        const kimlik = this.kimlik();
        const sira = this.sira();
        const z = Date.now();

        /* Telefon bu odayı tanıyor ve kaçırdıkları günlükte duruyorsa yalnızca onlar */
        if (k === kimlik && s !== null && s <= sira) {
            const eksik = this.sql.exec('SELECT v FROM gunluk WHERE s > ? ORDER BY s', s).toArray();
            if (eksik.length === sira - s) {
                ws.send(JSON.stringify({ t: 'h', k: kimlik, s, z, n: eksik.length }));
                eksik.forEach(x => ws.send(x.v));
                return;
            }
        }

        const hal = this.hal();
        ws.send(JSON.stringify({ t: 'l', k: kimlik, s: sira, z, r: hal.r, h: hal.h, u: hal.u, v: hal.v }));
        ws.send(JSON.stringify({ t: 'o', o: hal.o }));
    }

    async bak() {
        const hal = this.hal();
        return {
            konum: await this.konum(),
            kimlik: this.bilgi('k'),
            sira: this.sira(),
            bagli_telefon: this.ctx.getWebSockets().length,
            mac_sayisi: Object.keys(hal.r).length,
            hizli_son_isaret: this.bilgi('hizli_t') ? new Date(Number(this.bilgi('hizli_t'))).toISOString() : null,
            ...hal,
            son_degisiklikler: this.sql.exec('SELECT v FROM gunluk ORDER BY s DESC LIMIT 20').toArray().map(x => JSON.parse(x.v))
        };
    }
}

/*
 * MAÇ ODASI
 * bilgi tablosunda: no (maç no), acik (sunucu yazar: bu maça yorum yazılabilir), d (maçın içeriği, JSON metni), g (son değişme anı, ms)
 * yorum tablosu: id, u (yazanın kimliği), r (rumuz), t (metin), z (zaman, ms), y (yanıtlanan yorum), b, d (beğeni, beğenmeme sayısı)
 * oy tablosu: id (yorum), u (kimlik), v (1 beğeni, -1 beğenmeme, 0 geri alındı), n (kaç kez değişti, en fazla 2)
 * Maç kesinleşince (sil) yalnızca içerik silinir; yorumlar kalır. Yorumlar şimdilik hiç silinmez.
 *
 * Telefona giden mesajlar:
 *   { t: "m", k, s, g, d }  içerik (bağlanınca ve her değişince)
 *   { t: "h", k, s }        yeniden bağlanış: telefondaki içerik güncel
 *   { t: "y" }              odada içerik yok (maç kesinleştiyse içerik R2'de: mac/{no}.json)
 *   { t: "c0", c: [...] }   bağlanınca son 10 yorum (yeniden eskiye)
 *   { t: "c", c }           yeni yorum;  { t: "x", id } yorum silindi;  { t: "b", id, b, d } oy sayıları
 *   { t: "r", n, ... }      telefonun isteğine cevap (n: isteğin numarası): { ok: true, ... } ya da { hata: "kod" }
 * Telefondan gelen istekler (JSON, n: isteğin numarası):
 *   { a: "daha", once: yorum no, adet }          bu yorumdan eski en fazla 20 yorum (giriş gerekmez)
 *   { a: "yaz", token, t, y? }  { a: "sil", token, id }  { a: "oy", token, id, v: 1 | -1 }  { a: "sikayet", token, id }
 *   token: Firebase giriş kimliği (Google ile giriş). Hata kodları: giris, rumuz, kapali, bicim, uygunsuz, gunluk, yok, yetki, kendi, oy_sinir
 */
export class MacOdasi extends Oda {

    tablolar() {
        super.tablolar();
        this.sql.exec('CREATE TABLE IF NOT EXISTS yorum (id INTEGER PRIMARY KEY AUTOINCREMENT, u TEXT NOT NULL, r TEXT NOT NULL, ' +
            't TEXT NOT NULL, z INTEGER NOT NULL, y INTEGER, b INTEGER NOT NULL DEFAULT 0, d INTEGER NOT NULL DEFAULT 0)');
        this.sql.exec('CREATE TABLE IF NOT EXISTS oy (id INTEGER NOT NULL, u TEXT NOT NULL, v INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (id, u))');
    }

    /* Sunucu yazar: { d?: içerik, acik?: 1 } */
    yaz(govde) {
        if (govde.acik && !this.bilgi('acik'))
            this.bilgiYaz('acik', 1);

        const metin = JSON.stringify(govde.d);
        if (!govde.d || this.bilgi('d') === metin)
            return { s: this.sira(), degisen: 0 };

        const k = this.kimlik();
        const s = this.sira() + 1;
        const g = Date.now();
        this.bilgiYaz('d', metin);
        this.bilgiYaz('g', g);
        this.bilgiYaz('s', s);
        this.herkese({ t: 'm', k, s, g, d: govde.d });
        return { s, degisen: 1 };
    }

    /* Maç kesinleşti: içerik R2'de; odadan yalnızca içerik silinir, bağlı telefonlar R2'den okur */
    async sil() {
        this.sql.exec("DELETE FROM bilgi WHERE ad IN ('d', 'g')");
        this.herkese({ t: 'y' });
    }

    ac(ws, k, s, url) {
        if (!this.bilgi('no'))
            this.bilgiYaz('no', url.pathname.split('/')[3]);

        const d = this.bilgi('d');
        const kimlik = this.kimlik();
        const sira = this.sira();
        if (!d)
            ws.send(JSON.stringify({ t: 'y' }));
        else if (k === kimlik && s === sira)
            ws.send(JSON.stringify({ t: 'h', k: kimlik, s: sira }));
        else
            ws.send(JSON.stringify({ t: 'm', k: kimlik, s: sira, g: Number(this.bilgi('g')), d: JSON.parse(d) }));

        ws.send(JSON.stringify({ t: 'c0', c: this.yorumlar(null, 10) }));
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
            if (m.a === 'daha')
                return cevap({ ok: true, c: this.yorumlar(Number(m.once) || null, Math.min(Math.max(Number(m.adet) || 10, 1), YORUM_SAYFA)) });
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
            this.herkese({ t: 'c', c: yeni });
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
            this.herkese({ t: 'b', id, b: sayi.b || 0, d: sayi.d || 0 });
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
            this.herkese({ t: 'x', id });
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
        const d = this.bilgi('d');
        return {
            konum: await this.konum(),
            kimlik: this.bilgi('k'),
            sira: this.sira(),
            bagli_telefon: this.ctx.getWebSockets().length,
            yorum_acik: !!this.bilgi('acik'),
            yorum_sayisi: this.sql.exec('SELECT COUNT(*) AS n FROM yorum').one().n,
            guncellendi: this.bilgi('g') ? new Date(Number(this.bilgi('g'))).toISOString() : null,
            icerik: d ? JSON.parse(d) : null,
            son_yorumlar: this.yorumlar(null, 20)
        };
    }
}

/*
 * BİLDİRİM KUYRUĞU (tek oda): maç odaları yanıt bildirimlerini ekler, sunucu bağlıysa hemen gönderilir.
 * Sunucu bağlanınca son 10 dakikanın bekleyen işleri gelir; sunucu işi alınca { ack: no } gönderir, iş silinir.
 * Sunucuya giden: { t: "i", id, kisi, baslik, metin, link }
 */
export class BildirimOdasi extends Oda {

    tablolar() {
        super.tablolar();
        this.sql.exec('CREATE TABLE IF NOT EXISTS kuyruk (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT NOT NULL, z INTEGER NOT NULL)');
    }

    ekle(is) {
        const z = Date.now();
        this.sql.exec('DELETE FROM kuyruk WHERE z < ?', z - BILDIRIM_ESKI);
        const id = this.sql.exec('INSERT INTO kuyruk (v, z) VALUES (?, ?) RETURNING id', JSON.stringify(is), z).one().id;
        this.herkese({ t: 'i', id, ...is });
    }

    ac(ws) {
        this.sql.exec('SELECT id, v FROM kuyruk WHERE z >= ? ORDER BY id', Date.now() - BILDIRIM_ESKI).toArray()
            .forEach(x => ws.send(JSON.stringify({ t: 'i', id: x.id, ...JSON.parse(x.v) })));
    }

    webSocketMessage(ws, ham) {
        try {
            const m = JSON.parse(ham);
            if (Number.isInteger(m.ack))
                this.sql.exec('DELETE FROM kuyruk WHERE id <= ?', m.ack);
        } catch (e) {}
    }
}
