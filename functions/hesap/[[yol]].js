/*
 * Hesap işlemleri (rumuz, yanıt bildirimleri, engelleme, hesabı silme): /hesap, /hesap/{işlem}.
 * İstek olduğu gibi canli-oda Worker'ına geçer (Pages → Settings → Bindings → Service binding, adı ODA).
 * Yapı: oda/src/hesap.js, sunucu/VERITABANI.md → "Mesajlar".
 */

export function onRequest({ request, env }) {
    return env.ODA.fetch(request);
}
