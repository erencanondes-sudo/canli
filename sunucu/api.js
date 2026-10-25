/*
 * API-Football istekleri.
 * Bütün istekler tek bir sıradan geçer: iki istek arası en az ISTEK_ARALIK.
 * Canlı skor isteği sıranın başına geçer.
 * Günlük hak azalınca arka plan işleri durur (yedekte()).
 */

const A = require('./ayarlar');

const ADRES = 'https://v3.football.api-sports.io';
const ANAHTAR = process.env.API_KEY;

const durum = {
    kalan: null,        /* bugün kalan istek */
    hak: null,          /* günlük toplam hak */
    istek: 0            /* sunucu açıldığından beri atılan istek */
};

const sira = [];
let calisiyor = false;
let sonIstek = 0;

const uyu = ms => new Promise(r => setTimeout(r, ms));

/* İsteği sıraya koyar; cevabın "response" kısmını döndürür */
function istek(yol, oncelikli = false) {
    return new Promise((tamam, hata) => {
        const is = { yol, tamam, hata };
        if (oncelikli) sira.unshift(is);
        else sira.push(is);
        isle();
    });
}

async function isle() {
    if (calisiyor) return;
    calisiyor = true;

    while (sira.length) {
        const bekle = sonIstek + A.ISTEK_ARALIK - Date.now();
        if (bekle > 0) await uyu(bekle);

        const is = sira.shift();
        sonIstek = Date.now();

        try {
            is.tamam(await gonder(is.yol));
        } catch (e) {
            is.hata(e);
        }
    }

    calisiyor = false;
}

async function gonder(yol, deneme = 0) {

    if (!ANAHTAR) throw new Error('API anahtarı yok (/etc/canli/anahtar.env)');
    if (durum.kalan !== null && durum.kalan <= A.SON_HAK) throw new Error('Günlük istek hakkı bitti');

    const cevap = await fetch(ADRES + yol, {
        headers: { 'x-apisports-key': ANAHTAR },
        signal: AbortSignal.timeout(20000)
    });
    durum.istek++;

    const kalan = cevap.headers.get('x-ratelimit-requests-remaining');
    const hak = cevap.headers.get('x-ratelimit-requests-limit');
    if (kalan !== null) durum.kalan = Number(kalan);
    if (hak !== null) durum.hak = Number(hak);

    /* Çok fazla istek ya da API tarafında geçici hata: bekleyip yeniden dene */
    if (cevap.status === 429 || cevap.status >= 500) {
        if (deneme < 3) {
            await uyu(2000 * 2 ** deneme);
            return gonder(yol, deneme + 1);
        }
        throw new Error('API cevap vermiyor (' + cevap.status + ')');
    }

    const veri = await cevap.json();
    const hatalar = veri.errors ? Object.values(veri.errors) : [];
    if (hatalar.length) throw new Error('API hatası: ' + hatalar.join(' | '));

    return veri.response;
}

/* Hak azaldı mı? (arka plan işleri durur) */
const yedekte = () => durum.kalan !== null && durum.kalan <= A.YEDEK_HAK;

module.exports = { istek, yedekte, durum };
