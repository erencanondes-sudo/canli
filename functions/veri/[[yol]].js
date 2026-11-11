/*
 * R2 okuyucusu (Cloudflare Pages Function): /veri/gun/{gün}.json, /veri/ozet/{gün}.json, /veri/mac/{maç no}.json,
 * /veri/takim.json, /veri/lig.json, /veri/sezon/{lig}-{yıl}.json ve /veri/sezon/durum.json
 * R2 kovası projeye DEPO adıyla bağlı (Pages → Settings → Bindings). Yapı: sunucu/VERITABANI.md → "R2".
 * Önbellek: bugün, dün ve ilerideki günler tutulmaz (her açılışta en son hali); daha eski günler 1 saat (değişmezler).
 * Maç dosyası maç kesinleşince yazılır: 1 saat (yönetim sayfasından düzeltilirse yeniden yazılır).
 * Takım adları ve sezon durumu tutulmaz (en son hali gerekir); lig bilgisi 1 saat; sezon maçları 5 dakika.
 * Bilgisayardan dosya olarak açılan yönetim sayfası (adresi "null") ve Android uygulaması (https://localhost) da okuyabilir;
 * başka siteler tarayıcıda okuyamaz.
 */

const IZINLI = ['null', 'https://localhost'];

export async function onRequestGet({ request, params, env }) {

    const kaynak = request.headers.get('Origin');
    const IZIN = { 'Access-Control-Allow-Origin': IZINLI.includes(kaynak) ? kaynak : 'null', Vary: 'Origin' };

    const yol = (params.yol || []).join('/');
    const gunDosyasi = /^(gun|ozet)\/(\d{4}-\d{2}-\d{2})\.json$/.exec(yol);
    if (!gunDosyasi && !/^(mac\/\d{1,10}|takim|lig|sezon\/\d{1,6}-\d{4}|sezon\/durum)\.json$/.test(yol))
        return new Response('', { status: 404, headers: IZIN });

    /* Dün (Türkiye saati, gün 04:00'te değişir) */
    const dun = new Date(Date.now() + (3 - 4) * 3600000 - 86400000).toISOString().slice(0, 10);
    const sure = yol === 'takim.json' || yol === 'sezon/durum.json' ? 0 : yol.startsWith('sezon/') ? 300 : !gunDosyasi || gunDosyasi[2] < dun ? 3600 : 0;

    const nesne = await env.DEPO.get(yol);
    if (!nesne)
        return new Response('', { status: 404, headers: { ...IZIN, 'Cache-Control': 'public, max-age=0' } });

    return new Response(nesne.body, {
        headers: { ...IZIN, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=' + sure }
    });
}
