/*
 * Veritabanına yazma. Sunucu Google'ın kendi bağlantısıyla yazar (anahtar dosyası yok).
 *   Firestore : oranlar (gzip ile sıkıştırılmış), sistem durumu (bir doküman son yazılandan farklı değilse yazılmaz);
 *               yönetim sayfasının yazdıkları dinlenir (elle, istek, analiz sürümü)
 *   RTDB      : yalnızca mesajlar (mesaj.js)
 */

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getDatabase } = require('firebase-admin/database');
const zlib = require('zlib');
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

/*
 * Büyük doküman (maç, oranlar): metin gzip ile sıkıştırılıp z alanına (ikili) yazılır, ek alanlar açık.
 * Değişmediyse sıkıştırılmaz ve yazılmaz.
 */
async function yazSikistir(yol, metin, ek = {}, aralik = 0) {
    const icerik = metin + '|' + JSON.stringify(ek);
    if (sonYazilan.get(yol) === icerik) return false;
    if (aralik && Date.now() - (sonZaman.get(yol) || 0) < aralik) return false;

    const z = zlib.gzipSync(metin, { level: 9 });
    await db.doc(yol).set({ z, ...ek, guncellendi: FieldValue.serverTimestamp() });
    sonYazilan.set(yol, icerik);
    sonZaman.set(yol, Date.now());
    yazmaSayisi++;

    if (z.length > 900000) console.warn('Uyarı: ' + yol + ' 900 KB üstünde (' + z.length + ' bayt)');
    return true;
}

/* Artık yazılmayacak dokümanı hafızadan siler (hafıza büyümesin) */
function unut(yol) {
    sonYazilan.delete(yol);
    sonZaman.delete(yol);
}

/* Firestore dokümanını bir kez okur; z açılır, m olarak döner */
async function oku(yol) {
    const snap = await db.doc(yol).get();
    if (!snap.exists) return null;
    const veri = snap.data();
    if (veri.z) veri.m = zlib.gunzipSync(veri.z).toString();
    return veri;
}

/* Firestore dokümanını siler */
async function sil(yol) {
    await db.doc(yol).delete();
}

/* Firestore dokümanını dinler: geldi(veri ya da null) */
function belgeDinle(yol, geldi) {
    return db.doc(yol).onSnapshot(snap => geldi(snap.exists ? snap.data() : null),
        e => console.error(yol + ' dinlenemedi: ' + e.message));
}

/* Firestore koleksiyonunu dinler: degisti(belge adı, veri ya da silindiyse null) */
function koleksiyonDinle(ad, degisti) {
    return db.collection(ad).onSnapshot(snap => snap.docChanges().forEach(d =>
        degisti(d.doc.id, d.type === 'removed' ? null : d.doc.data())),
        e => console.error(ad + ' dinlenemedi: ' + e.message));
}

module.exports = { rtdb, yaz, yazSikistir, oku, unut, sil, belgeDinle, koleksiyonDinle, yazmaSayisi: () => yazmaSayisi };
