/*
 * Firestore'a yazma. Sunucu Google'ın kendi bağlantısıyla yazar (anahtar dosyası yok).
 * Bir doküman son yazılandan farklı değilse yazılmaz.
 */

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const A = require('./ayarlar');

initializeApp({ projectId: A.PROJE });
const db = getFirestore();

const sonYazilan = new Map();   /* doküman yolu → son içerik */
let yazmaSayisi = 0;

/* Değiştiyse yazar; yazdıysa true döner */
async function yaz(yol, veri) {
    const icerik = JSON.stringify(veri);
    if (sonYazilan.get(yol) === icerik) return false;

    await db.doc(yol).set({ ...veri, guncellendi: FieldValue.serverTimestamp() });
    sonYazilan.set(yol, icerik);
    yazmaSayisi++;

    if (icerik.length > 900000) console.warn('Uyarı: ' + yol + ' 900 KB üstünde (' + icerik.length + ' bayt)');
    return true;
}

module.exports = { yaz, yazmaSayisi: () => yazmaSayisi };
