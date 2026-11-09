/*
 * Firebase giriş kimliğinin (ID token) doğrulanması. Telefon kimliği Firebase'den alır (getIdToken) ve isteklerle gönderir.
 * Kimlik Google'ın imzasıyla (RS256) doğrulanır; Google'ın herkese açık anahtarları birkaç saat hafızada tutulur.
 * Gizli anahtar gerekmez. Proje: wrangler.toml → FIREBASE_PROJE.
 */

const ANAHTAR_ADRES = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let anahtarlar = null;   /* { kid: CryptoKey } */
let anahtarZaman = 0;

const metinden = parca => Uint8Array.from(atob(parca.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function anahtar(kid) {
    if (!anahtarlar || Date.now() - anahtarZaman > 3 * 3600000 || !anahtarlar[kid]) {
        const liste = (await (await fetch(ANAHTAR_ADRES)).json()).keys || [];
        const yeni = {};
        for (const jwk of liste)
            yeni[jwk.kid] = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
        anahtarlar = yeni;
        anahtarZaman = Date.now();
    }
    return anahtarlar[kid] || null;
}

/* Kimlik geçerliyse { uid, google: Google ile giriş mi } döner, değilse null */
export async function dogrula(token, env) {
    try {
        const [bas, govde, imza] = String(token || '').split('.');
        if (!imza)
            return null;
        const baslik = JSON.parse(new TextDecoder().decode(metinden(bas)));
        const veri = JSON.parse(new TextDecoder().decode(metinden(govde)));
        if (baslik.alg !== 'RS256')
            return null;

        const simdi = Date.now() / 1000;
        const proje = env.FIREBASE_PROJE;
        if (veri.aud !== proje || veri.iss !== 'https://securetoken.google.com/' + proje ||
            !(veri.exp > simdi) || !(veri.iat <= simdi + 60) || !veri.sub)
            return null;

        const k = await anahtar(baslik.kid);
        if (!k || !(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', k, metinden(imza), new TextEncoder().encode(bas + '.' + govde))))
            return null;

        return { uid: veri.sub, google: !!veri.firebase && veri.firebase.sign_in_provider === 'google.com' };
    } catch (e) {
        return null;
    }
}
