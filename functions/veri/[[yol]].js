/*
 * R2 okuyucusu (Cloudflare Pages Function): /veri/gun/{gün}.json, /veri/ozet/{gün}.json, /veri/oran/{gün}.json, /veri/mac/{maç no}.json,
 * /veri/takim.json, /veri/lig.json, /veri/puan/{lig}.json, /veri/sezon/{lig}-{yıl}.json, /veri/sezon/durum.json ve /veri/sezon/takimlar.json
 * R2 kovası projeye DEPO adıyla bağlı (Pages → Settings → Bindings). Yapı: sunucu/VERITABANI.md → "R2".
 * Önbellek süreleri (telefon / Cloudflare):
 *   gün listesi: bugün 0 / 0 (bugün gün odasından; dosya yalnızca oda bağlanamazsa), dün 10 dk / 5 dk,
 *                daha eski günler 1 gün / 1 saat, gelecek günler 2 saat / 30 dk
 *   Özet: bugün ve dün 30 sn / 30 sn (eksikleri telefon gün odasından ister), daha eski günler 1 gün / 1 saat
 *   oranlar (günün maçlarının bütün oranları): 4 saat / 1 saat
 *   maç dosyası (gün dünden eski olunca odadan taşınır): 1 saat / 1 saat
 *   takım adları ve sezon durumu tutulmaz (en son hali gerekir); lig bilgisi 1 saat; sezon maçları ve puan durumu 5 dakika.
 * Özet ve oran dosyaları R2'de gzip ile sıkıştırılmış durur: okuyucu açıp gönderir (Cloudflare tarayıcıya giderken kendisi sıkıştırır).
 * Cloudflare önbelleği: Cache API (yalnızca kendi domainde çalışır, pages.dev'de etkisiz); aynı dosya her Cloudflare merkezinde
 * süresi boyunca R2'den bir kez okunur.
 * Bilgisayardan dosya olarak açılan yönetim sayfası (adresi "null") ve Android uygulaması (https://localhost) da okuyabilir;
 * başka siteler tarayıcıda okuyamaz.
 */

const IZINLI = ['null', 'https://localhost'];

export async function onRequestGet({ request, params, env, waitUntil }) {

    const kaynak = request.headers.get('Origin');
    const IZIN = { 'Access-Control-Allow-Origin': IZINLI.includes(kaynak) ? kaynak : 'null', Vary: 'Origin' };

    const yol = (params.yol || []).join('/');
    const gunDosyasi = /^(gun|ozet|oran)\/(\d{4}-\d{2}-\d{2})\.json$/.exec(yol);
    if (!gunDosyasi && !/^(mac\/\d{1,10}|takim|lig|puan\/\d{1,6}|sezon\/\d{1,6}-\d{4}|sezon\/durum|sezon\/takimlar)\.json$/.test(yol))
        return new Response('', { status: 404, headers: IZIN });

    /* Bugün ve dün (Türkiye saati, gün 04:00'te değişir); [telefon, Cloudflare] saniye */
    const bugun = new Date(Date.now() + (3 - 4) * 3600000).toISOString().slice(0, 10);
    const dun = new Date(Date.now() + (3 - 4) * 3600000 - 86400000).toISOString().slice(0, 10);
    const [tur, gun] = gunDosyasi ? [gunDosyasi[1], gunDosyasi[2]] : [null, null];
    const [sure, bulut] =
        yol === 'takim.json' || yol === 'sezon/durum.json' ? [0, 0] :
        yol.startsWith('sezon/') || yol.startsWith('puan/') ? [300, 300] :
        !gunDosyasi ? [3600, 3600] :
        tur === 'oran' ? [14400, 3600] :
        gun < dun ? [86400, 3600] :
        tur === 'ozet' ? (gun > bugun ? [0, 0] : [30, 30]) :
        gun === dun ? [600, 300] :
        gun > bugun ? [7200, 1800] : [0, 0];

    /* Önbellekte varsa oradan (izin başlığı isteğe göre eklenir; telefonun süresi bu dosyanınki) */
    const anahtar = new Request(new URL(request.url).origin + '/veri/' + yol);
    if (bulut) {
        const onbellek = await caches.default.match(anahtar);
        if (onbellek) {
            const cevap = new Response(onbellek.body, onbellek);
            Object.entries(IZIN).forEach(([ad, deger]) => cevap.headers.set(ad, deger));
            cevap.headers.set('Cache-Control', 'public, max-age=' + sure);
            return cevap;
        }
    }

    const nesne = await env.DEPO.get(yol);
    if (!nesne)
        return new Response('', { status: 404, headers: { ...IZIN, 'Cache-Control': 'public, max-age=0' } });

    /* Özet ve oranlar: dosyanın ilk iki baytı gzip işaretiyse (1f 8b) açılır */
    let govde = nesne.body;
    if (tur === 'ozet' || tur === 'oran') {
        const veri = new Uint8Array(await nesne.arrayBuffer());
        govde = veri[0] === 0x1f && veri[1] === 0x8b ? new Response(veri).body.pipeThrough(new DecompressionStream('gzip')) : veri;
    }

    const cevap = new Response(govde, {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=' + sure }
    });
    if (bulut) {
        const saklanan = cevap.clone();
        saklanan.headers.set('Cache-Control', 'public, max-age=' + bulut);
        waitUntil(caches.default.put(anahtar, saklanan));
    }
    Object.entries(IZIN).forEach(([ad, deger]) => cevap.headers.set(ad, deger));
    return cevap;
}
