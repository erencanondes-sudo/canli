/*
 * Veritabanına yazma. Sunucu Google'ın kendi bağlantısıyla yazar (anahtar dosyası yok).
 *   Firestore : maç detayı, Özet, sistem durumu (bir doküman son yazılandan farklı değilse yazılmaz)
 *   RTDB      : canlı skor listesi, takım adları (yalnızca değişen satırlar yazılır)
 */

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getDatabase } = require('firebase-admin/database');
const A = require('./ayarlar');

initializeApp({ projectId: A.PROJE, databaseURL: A.RTDB_ADRES });
const db = getFirestore();
const rtdb = getDatabase();

const sonYazilan = new Map();   /* doküman yolu → son içerik */
const sonZaman = new Map();     /* doküman yolu → son yazma anı (ms) */
let yazmaSayisi = 0;

/*
 * Firestore: değiştiyse yazar; yazdıysa true döner.
 * aralik verilirse aynı doküman en fazla o kadar ms'de bir yazılır (arada değişen bir sonraki turda yazılır).
 */
async function yaz(yol, veri, aralik = 0) {
    const icerik = JSON.stringify(veri);
    if (sonYazilan.get(yol) === icerik) return false;
    if (aralik && Date.now() - (sonZaman.get(yol) || 0) < aralik) return false;

    await db.doc(yol).set({ ...veri, guncellendi: FieldValue.serverTimestamp() });
    sonYazilan.set(yol, icerik);
    sonZaman.set(yol, Date.now());
    yazmaSayisi++;

    if (icerik.length > 900000) console.warn('Uyarı: ' + yol + ' 900 KB üstünde (' + icerik.length + ' bayt)');
    return true;
}

/* Firestore dokümanını bir kez okur (sunucu açılınca eski Özet'i korumak için) */
async function oku(yol) {
    const snap = await db.doc(yol).get();
    return snap.exists ? snap.data() : null;
}

/* ---------- RTDB ---------- */

const dal = new Map();   /* dal yolu → Map(anahtar → son yazılan değer) */

/* Dalın sunucudaki halini ilk seferde bir kez okur */
async function dalHali(yol) {
    if (!dal.has(yol)) {
        const snap = await rtdb.ref(yol).get();
        dal.set(yol, new Map(Object.entries(snap.val() || {})));
    }
    return dal.get(yol);
}

/*
 * Dalı verilen içeriğe getirir: yalnızca değişen anahtarlar yazılır.
 * silinsin: true ise içerikte olmayan anahtarlar silinir. Değişen anahtar sayısını döner.
 */
async function dalYaz(yol, icerik, silinsin = true) {
    const once = await dalHali(yol);
    const degisen = {};

    icerik.forEach((deger, anahtar) => {
        if (once.get(anahtar) !== deger) degisen[anahtar] = deger;
    });
    if (silinsin) once.forEach((deger, anahtar) => {
        if (!icerik.has(anahtar)) degisen[anahtar] = null;
    });

    const sayi = Object.keys(degisen).length;
    if (!sayi) return 0;

    await rtdb.ref(yol).update(degisen);
    Object.entries(degisen).forEach(([anahtar, deger]) => {
        if (deger === null) once.delete(anahtar);
        else once.set(anahtar, deger);
    });
    yazmaSayisi++;
    return sayi;
}

/* Tek değer yazar (takım sözlüğünün sürümü gibi) */
async function degerYaz(yol, deger) {
    await rtdb.ref(yol).set(deger);
    yazmaSayisi++;
}

module.exports = { yaz, oku, dalYaz, degerYaz, yazmaSayisi: () => yazmaSayisi };
