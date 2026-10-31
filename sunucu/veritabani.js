/*
 * Veritabanına yazma. Sunucu Google'ın kendi bağlantısıyla yazar (anahtar dosyası yok).
 *   Firestore : gün listesi ve Özet (gzip ile sıkıştırılmış), maç detayı, sistem durumu
 *               (bir doküman son yazılandan farklı değilse yazılmaz)
 *   RTDB      : canlı skor listesi, takım adları (yalnızca değişen satırlar yazılır)
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
 * Büyük doküman (gün listesi, Özet): metin gzip ile sıkıştırılıp z alanına (ikili) yazılır, ek alanlar açık.
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

/* Firestore dokümanını bir kez okur (sunucu açılınca eski Özet'i korumak için); z açılır, m olarak döner */
async function oku(yol) {
    const snap = await db.doc(yol).get();
    if (!snap.exists) return null;
    const veri = snap.data();
    if (veri.z) veri.m = zlib.gunzipSync(veri.z).toString();
    return veri;
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
 * silinsin: true ise içerikte olmayan anahtarlar silinir. Değişenleri { anahtar: değer } döner (yoksa null).
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

    if (!Object.keys(degisen).length) return null;

    await rtdb.ref(yol).update(degisen);
    Object.entries(degisen).forEach(([anahtar, deger]) => {
        if (deger === null) once.delete(anahtar);
        else once.set(anahtar, deger);
    });
    yazmaSayisi++;
    return degisen;
}

/* Birden çok yola tek seferde yazar: { "takim_surum": 5, "takim_ek/5": {...} } */
async function cokluYaz(veri) {
    await rtdb.ref().update(veri);
    yazmaSayisi++;
}

/* Dalda anahtarı sinir'e kadar (dahil) olan kayıtları siler (anahtarlar aynı uzunlukta sayı) */
async function eskiSil(yol, sinir) {
    const snap = await rtdb.ref(yol).orderByKey().endAt(String(sinir)).get();
    const sil = {};
    snap.forEach(c => { sil[c.key] = null; });
    if (Object.keys(sil).length) {
        await rtdb.ref(yol).update(sil);
        yazmaSayisi++;
    }
}

module.exports = { yaz, yazSikistir, oku, dalYaz, dalHali, cokluYaz, eskiSil, yazmaSayisi: () => yazmaSayisi };
