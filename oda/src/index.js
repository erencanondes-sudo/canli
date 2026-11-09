/*
 * ODALAR (Cloudflare Durable Objects). Ayrıntı: sunucu/VERITABANI.md → "Odalar".
 *
 *   Gün odası  gun/{gün}  : günün listesi (satırlar), Özet (olaylar), hızlı kaynağın skoru ve uyarısı
 *   Maç odası  mac/{no}   : maçın içeriği (durum, istatistik, kadro, olaylar); maç kesinleşince R2'ye yazılır, oda boşaltılır
 *
 * Adresler:
 *   GET    /oda/gun/{gün}?k=&s=   telefon bağlanır (WebSocket); site bunu Cloudflare Pages'ten (functions/oda) geçirir
 *   GET    /oda/mac/{no}?k=&s=
 *   POST   /yaz/gun/{gün}         sunucu yazar (Authorization: Bearer ODA_ANAHTAR)
 *   POST   /yaz/mac/{no}
 *   DELETE /yaz/gun/{gün}, /yaz/mac/{no}   oda boşaltılır
 *   GET    /bak/gun/{gün}?anahtar=..., /bak/mac/{no}?anahtar=...   odanın şu anki hali (yalnızca sen; tarayıcıda açılır)
 *
 * Sıra numarası (s): odadaki her değişiklik 1 artar. Telefon yeniden bağlanırken son aldığı numarayı (s) ve odanın
 * kimliğini (k) gönderir; oda yalnızca kaçırılan değişiklikleri gönderir (gün odası son 1000 değişikliği saklar).
 * Kimlik oda ilk kez oluşunca rastgele verilir; oda boşaltılıp yeniden oluşursa değişir (telefon her şeyi baştan alır).
 *
 * Yer: odalar Doğu Avrupa'da kurulur (Türkiye'ye en yakın bölge). Bir oda kurulduğu yerde kalır; adlarının başındaki
 * "eeur/" bu yüzden: önceki (ipucusuz, Amerika'da kurulmuş) odalardan ayrı, yeni odalar. /bak sayfasında "konum" odanın bulunduğu merkez.
 */

import { DurableObject } from 'cloudflare:workers';

const BICIM = { gun: /^\d{4}-\d{2}-\d{2}$/, mac: /^\d{1,10}$/ };
const GUNLUK_SAKLA = 1000;

const bos = (durum = 404) => new Response(null, { status: durum });

/* Sunucunun anahtarı: başlıkta (Bearer) ya da tarayıcıdan bakarken adreste (?anahtar=) */
function yetkili(istek, env, url) {
    const gelen = (istek.headers.get('Authorization') || '').replace(/^Bearer /, '') || url.searchParams.get('anahtar') || '';
    return !!env.ODA_ANAHTAR && gelen === env.ODA_ANAHTAR;
}

export default {
    async fetch(istek, env) {
        const url = new URL(istek.url);
        const [, bolum, tur, ad] = url.pathname.split('/');
        if (!BICIM[tur] || !BICIM[tur].test(ad || ''))
            return bos();

        const alan = tur === 'gun' ? env.GUN : env.MAC;
        const oda = alan.get(alan.idFromName('eeur/' + tur + '/' + ad), { locationHint: 'eeur' });

        if (bolum === 'oda' && istek.method === 'GET') {
            if (istek.headers.get('Upgrade') !== 'websocket')
                return bos(426);
            return oda.fetch(istek);
        }

        if ((bolum === 'yaz' || bolum === 'bak') && !yetkili(istek, env, url))
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
        this.ac(sunucu, url.searchParams.get('k'), s === null || s === '' ? null : Number(s));
        return new Response(null, { status: 101, webSocket: istemci });
    }

    webSocketMessage() {}

    webSocketClose(ws, kod) {
        try {
            ws.close(kod === 1005 ? 1000 : kod);
        } catch (e) {}
    }

    /* Oda boşaltılır: bağlı telefonlara haber verilir, depo silinir */
    async sil() {
        this.bosaltildi();
        this.ctx.getWebSockets().forEach(ws => {
            try {
                ws.close(1000, 'bosaltildi');
            } catch (e) {}
        });
        await this.ctx.storage.deleteAll();
        this.tablolar();
    }

    bosaltildi() {}
}

/*
 * GÜN ODASI
 * veri tablosu: tur r (satır metni), o (maçın olayları, JSON metni), h (hızlı skor "2-1"), u (hızlı uyarı "2-2" / "k")
 * gunluk tablosu: değişiklikler (sıra → mesaj), son 1000
 *
 * Telefona giden mesajlar:
 *   { t: "l", k, s, z, r, h, u }  liste (satırlar ve hızlı kaynak), ilk bağlanışta önce bu
 *   { t: "o", o }                  Özet, listeden hemen sonra
 *   { t: "h", k, s, z, n }         yeniden bağlanış: ardından kaçırılan n değişiklik ("d") gelir (0: telefon güncel)
 *   { t: "d", s, r?, o?, h?, u? }  değişiklik: yalnızca değişen maçlar; null = silindi
 * z: sunucu saati (ms), telefon dakikayı doğru hesaplasın diye.
 */
export class GunOdasi extends Oda {

    tablolar() {
        super.tablolar();
        this.sql.exec('CREATE TABLE IF NOT EXISTS veri (tur TEXT, no TEXT, v TEXT, PRIMARY KEY (tur, no))');
        this.sql.exec('CREATE TABLE IF NOT EXISTS gunluk (s INTEGER PRIMARY KEY, v TEXT)');
    }

    /* Odanın tamamı: { r: {no: satır}, o: {no: [olaylar]}, h: {...}, u: {...} } */
    hal() {
        const hal = { r: {}, o: {}, h: {}, u: {} };
        for (const { tur, no, v } of this.sql.exec('SELECT tur, no, v FROM veri'))
            hal[tur][no] = tur === 'o' ? JSON.parse(v) : v;
        return hal;
    }

    /*
     * Sunucu yazar: { r?, o?, h?, u? }, her alan o günün tam hali. Oda kendi haliyle karşılaştırır,
     * yalnızca değişenleri saklar ve bağlı telefonlara tek mesajla gönderir.
     */
    yaz(govde) {
        const degisen = {};
        let sayi = 0;

        for (const tur of ['r', 'o', 'h', 'u']) {
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

        this.kimlik();
        const s = this.sira() + 1;
        const mesaj = { t: 'd', s, ...degisen };
        this.bilgiYaz('s', s);
        this.sql.exec('INSERT INTO gunluk (s, v) VALUES (?, ?)', s, JSON.stringify(mesaj));
        this.sql.exec('DELETE FROM gunluk WHERE s <= ?', s - GUNLUK_SAKLA);
        this.herkese(mesaj);
        return { s, degisen: sayi };
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
        ws.send(JSON.stringify({ t: 'l', k: kimlik, s: sira, z, r: hal.r, h: hal.h, u: hal.u }));
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
            ...hal,
            son_degisiklikler: this.sql.exec('SELECT v FROM gunluk ORDER BY s DESC LIMIT 20').toArray().map(x => JSON.parse(x.v))
        };
    }
}

/*
 * MAÇ ODASI
 * bilgi tablosunda: d (maçın içeriği, JSON metni), g (son değişme anı, ms)
 *
 * Telefona giden mesajlar:
 *   { t: "m", k, s, g, d }  içerik (bağlanınca ve her değişince)
 *   { t: "h", k, s }        yeniden bağlanış: telefondaki içerik güncel
 *   { t: "y" }              odada içerik yok (maç kesinleştiyse içerik R2'de: mac/{no}.json)
 */
export class MacOdasi extends Oda {

    yaz(govde) {
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

    ac(ws, k, s) {
        const d = this.bilgi('d');
        if (!d) {
            ws.send(JSON.stringify({ t: 'y' }));
            return;
        }
        const kimlik = this.kimlik();
        const sira = this.sira();
        if (k === kimlik && s === sira)
            ws.send(JSON.stringify({ t: 'h', k: kimlik, s: sira }));
        else
            ws.send(JSON.stringify({ t: 'm', k: kimlik, s: sira, g: Number(this.bilgi('g')), d: JSON.parse(d) }));
    }

    bosaltildi() {
        this.herkese({ t: 'y' });
    }

    async bak() {
        const d = this.bilgi('d');
        return {
            konum: await this.konum(),
            kimlik: this.bilgi('k'),
            sira: this.sira(),
            bagli_telefon: this.ctx.getWebSockets().length,
            guncellendi: this.bilgi('g') ? new Date(Number(this.bilgi('g'))).toISOString() : null,
            icerik: d ? JSON.parse(d) : null
        };
    }
}
