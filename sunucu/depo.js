/*
 * Cloudflare R2 (dosya deposu): gün listesi ve Özet dosyaları (sunucu/VERITABANI.md → "R2").
 * Anahtarlar /etc/canli/anahtar.env içinde: R2_ADRES (uç nokta), R2_KIMLIK (Access Key ID), R2_GIZLI (Secret Access Key).
 * Site dosyaları Cloudflare Pages'teki okuyucudan (functions/veri) okur.
 *
 * yaz(): dosya son yazılandan farklıysa yazılır. Aynı dosya yazılırken yenisi gelirse beklenir,
 * sonra yalnızca en son hali yazılır (sıra karışmaz). Yazılamazsa bir sonraki yaz() çağrısında yeniden denenir.
 * Aynı dosyaya en fazla saniyede 1 yazılır (R2'nin sınırı); araya gelenlerden yalnızca en sonuncusu yazılır.
 * sikistir: dosya gzip ile sıkıştırılıp yazılır (Content-Encoding: gzip). Okuyucu (functions/veri) ve oku() açar.
 */

const crypto = require('crypto');
const zlib = require('zlib');
const A = require('./ayarlar');

const { R2_ADRES, R2_KIMLIK, R2_GIZLI } = process.env;

const sha = veri => crypto.createHash('sha256').update(veri).digest('hex');
const hmac = (anahtar, veri) => crypto.createHmac('sha256', anahtar).update(veri).digest();

/* S3 uyumlu istek (AWS imza sürüm 4, bölge "auto") */
function istek(yontem, anahtar, govde = '', sikistirilmis = false) {
    if (!R2_ADRES || !R2_KIMLIK || !R2_GIZLI)
        return Promise.reject(new Error('R2 anahtarları tanımlı değil (/etc/canli/anahtar.env)'));

    const adres = new URL(R2_ADRES.replace(/\/$/, '') + '/' + A.R2_KOVA + '/' + anahtar);
    const zaman = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');   /* 20261105T183000Z */
    const gun = zaman.slice(0, 8);
    const ozet = sha(govde);
    const imzali = 'host;x-amz-content-sha256;x-amz-date';
    const kanonik = [yontem, adres.pathname, '',
        'host:' + adres.host + '\nx-amz-content-sha256:' + ozet + '\nx-amz-date:' + zaman + '\n', imzali, ozet].join('\n');
    const kapsam = gun + '/auto/s3/aws4_request';

    let k = hmac('AWS4' + R2_GIZLI, gun);
    for (const parca of ['auto', 's3', 'aws4_request']) k = hmac(k, parca);
    const imza = crypto.createHmac('sha256', k).update(['AWS4-HMAC-SHA256', zaman, kapsam, sha(kanonik)].join('\n')).digest('hex');

    const basliklar = {
        'x-amz-content-sha256': ozet,
        'x-amz-date': zaman,
        authorization: 'AWS4-HMAC-SHA256 Credential=' + R2_KIMLIK + '/' + kapsam + ', SignedHeaders=' + imzali + ', Signature=' + imza
    };
    if (yontem === 'PUT') basliklar['content-type'] = 'application/json';
    if (sikistirilmis) basliklar['content-encoding'] = 'gzip';

    return fetch(adres, { method: yontem, headers: basliklar, body: yontem === 'PUT' ? govde : undefined, signal: AbortSignal.timeout(15000) });
}

/* Dosyayı yazar (bekler) */
async function yukle(anahtar, metin, sikistir = false) {
    const cevap = await istek('PUT', anahtar, sikistir ? zlib.gzipSync(metin) : metin, sikistir);
    if (!cevap.ok) throw new Error('R2 yazılamadı (' + anahtar + '): ' + cevap.status + ' ' + (await cevap.text()).slice(0, 200));
}

/* Dosyayı okur (sıkıştırılmışsa açar: ilk iki bayt 1f 8b); yoksa null */
async function oku(anahtar) {
    const cevap = await istek('GET', anahtar);
    if (cevap.status === 404) return null;
    if (!cevap.ok) throw new Error('R2 okunamadı (' + anahtar + '): ' + cevap.status);
    const veri = Buffer.from(await cevap.arrayBuffer());
    return JSON.parse(veri[0] === 0x1f && veri[1] === 0x8b ? zlib.gunzipSync(veri) : veri);
}

const sonYazilan = new Map();   /* dosya → son yazılan metin */
const bekleyen = new Map();     /* dosya → { metin, sikistir }: yazılacak en son hali */
const sonZaman = new Map();     /* dosya → son yazma anı (ms) */
const yaziliyor = new Set();
let sonHata = null;

function yaz(anahtar, metin, sikistir = false) {
    if (sonYazilan.get(anahtar) === metin && !bekleyen.has(anahtar)) return;
    bekleyen.set(anahtar, { metin, sikistir });
    if (!yaziliyor.has(anahtar)) bosalt(anahtar);
}

async function bosalt(anahtar) {
    yaziliyor.add(anahtar);
    while (bekleyen.has(anahtar)) {
        const bekle = 1000 - (Date.now() - (sonZaman.get(anahtar) || 0));
        if (bekle > 0) await new Promise(r => setTimeout(r, bekle));
        const { metin, sikistir } = bekleyen.get(anahtar);
        bekleyen.delete(anahtar);
        if (sonYazilan.get(anahtar) === metin) continue;
        try {
            sonZaman.set(anahtar, Date.now());
            await yukle(anahtar, metin, sikistir);
            sonYazilan.set(anahtar, metin);
            sonHata = null;
        } catch (e) {
            sonHata = e.message;
            console.error(e.message);
        }
    }
    yaziliyor.delete(anahtar);
}

/* Artık yazılmayacak günlerin (gun'dan eski) son halleri hafızadan silinir */
function unutEski(gun) {
    for (const anahtar of sonYazilan.keys()) {
        const g = /(\d{4}-\d{2}-\d{2})\.json$/.exec(anahtar);
        if (g && g[1] < gun) {
            sonYazilan.delete(anahtar);
            sonZaman.delete(anahtar);
        }
    }
}

module.exports = { yaz, yukle, oku, unutEski, sonHata: () => sonHata };
