/*
 * R2 okuyucusu (Cloudflare Pages Function): /veri/gun/{gün}.json ve /veri/ozet/{gün}.json
 * R2 kovası projeye DEPO adıyla bağlı (Pages → Settings → Bindings). Yapı: sunucu/VERITABANI.md → "R2".
 * Önbellek: bugün, dün ve ilerideki günler tutulmaz (her açılışta en son hali); daha eski günler 1 saat (değişmezler).
 * Bilgisayardan dosya olarak açılan yönetim sayfası (adresi "null") da okuyabilir; başka siteler tarayıcıda okuyamaz.
 */

const IZIN = { 'Access-Control-Allow-Origin': 'null' };

export async function onRequestGet({ params, env }) {

    const yol = (params.yol || []).join('/');
    const eslesme = /^(gun|ozet)\/(\d{4}-\d{2}-\d{2})\.json$/.exec(yol);
    if (!eslesme)
        return new Response('', { status: 404, headers: IZIN });

    /* Dün (Türkiye saati, gün 04:00'te değişir) */
    const dun = new Date(Date.now() + (3 - 4) * 3600000 - 86400000).toISOString().slice(0, 10);
    const sure = eslesme[2] < dun ? 3600 : 0;

    const nesne = await env.DEPO.get(yol);
    if (!nesne)
        return new Response('', { status: 404, headers: { ...IZIN, 'Cache-Control': 'public, max-age=0' } });

    return new Response(nesne.body, {
        headers: { ...IZIN, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=' + sure }
    });
}
