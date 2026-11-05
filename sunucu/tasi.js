/*
 * BİR KEZLİK: Firestore'daki gün listelerini (gun) ve Özetleri (ozet) R2'ye kopyalar.
 *   node tasi.js        → kopyalar (Firestore'a dokunmaz)
 *   node tasi.js --sil  → R2'de karşılığı olan Firestore dokümanlarını siler
 * İş bitince bu dosya depodan kaldırılacak.
 */

require('./veritabani');   /* Firebase bağlantısı */
const { getFirestore } = require('firebase-admin/firestore');
const zlib = require('zlib');
const depo = require('./depo');

const fs = getFirestore();
const sil = process.argv.includes('--sil');

const metin = veri => veri.z ? zlib.gunzipSync(veri.z).toString() : veri.m || '{}';

(async () => {
    for (const koleksiyon of ['gun', 'ozet']) {
        const snap = await fs.collection(koleksiyon).get();
        let sayi = 0;
        for (const doc of snap.docs) {
            const anahtar = koleksiyon + '/' + doc.id + '.json';
            if (sil) {
                if (await depo.oku(anahtar) === null) {
                    console.log('R2\'de yok, silinmedi: ' + anahtar);
                    continue;
                }
                await doc.ref.delete();
            } else {
                const veri = doc.data();
                const icerik = koleksiyon === 'gun' ? metin(veri) : JSON.stringify({ t: veri.t || '', m: JSON.parse(metin(veri)) });
                await depo.yukle(anahtar, icerik);
            }
            sayi++;
        }
        console.log(koleksiyon + ': ' + sayi + ' / ' + snap.size + (sil ? ' silindi' : ' kopyalandı'));
    }
    process.exit(0);
})().catch(e => {
    console.error(e.message);
    process.exit(1);
});
