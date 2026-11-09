/*
 * Odalara bağlantı (WebSocket): /oda/gun/{gün}, /oda/mac/{maç no}.
 * İstek olduğu gibi canli-oda Worker'ına geçer (Pages → Settings → Bindings → Service binding, adı ODA).
 * Site ve uygulama odalara sitenin kendi adresinden bağlanır. Yapı: sunucu/VERITABANI.md → "Odalar".
 */

export function onRequestGet({ request, env }) {
    return env.ODA.fetch(request);
}
