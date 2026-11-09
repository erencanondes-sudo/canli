/*
 * D1 veritabanı (canli): kullanıcı bilgileri. Yapı: sunucu/VERITABANI.md → "Mesajlar".
 * Tablolar ilk kullanımda kurulur (yoksa).
 *
 *   kisi (uid, r: rumuz, k: kuralların kabul anı, b: 1 = yanıt bildirimleri kapalı)
 *   rumuz (ad: küçük harfle rumuz, uid)                 rumuzun sahibi (benzersizlik)
 *   rumuz_zaman (uid, z)                                son rumuz değişikliği (haftada bir); hesap silinse de kalır
 *   sayac (uid, g: gün no, n: o gün yazılan yorum)       günde en fazla 20; hesap silinse de kalır
 *   engel (uid, kim)                                    kişinin engelledikleri
 *   sessiz (uid, mac, mesaj)                            kişinin, yanıtlarından bildirim almadığı kendi yorumları
 *   sikayet (mac, mesaj, uid, z)                        şikayetler (her kişi bir yorumu bir kez); hesap silinse de kalır
 *   mesajlarim (uid, mac, mesaj)                        kişinin yorumları (hesap silinince bulmak için)
 *   bildirim_son (cift: "gönderen>alan", z)            son yanıt bildirimi (aynı kişiden 10 dakikada bir)
 */

const TABLOLAR = [
    'CREATE TABLE IF NOT EXISTS kisi (uid TEXT PRIMARY KEY, r TEXT, k INTEGER, b INTEGER NOT NULL DEFAULT 0)',
    'CREATE TABLE IF NOT EXISTS rumuz (ad TEXT PRIMARY KEY, uid TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS rumuz_zaman (uid TEXT PRIMARY KEY, z INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS sayac (uid TEXT PRIMARY KEY, g INTEGER NOT NULL, n INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS engel (uid TEXT NOT NULL, kim TEXT NOT NULL, PRIMARY KEY (uid, kim))',
    'CREATE TABLE IF NOT EXISTS sessiz (uid TEXT NOT NULL, mac TEXT NOT NULL, mesaj TEXT NOT NULL, PRIMARY KEY (uid, mac, mesaj))',
    'CREATE TABLE IF NOT EXISTS sikayet (mac TEXT NOT NULL, mesaj TEXT NOT NULL, uid TEXT NOT NULL, z INTEGER NOT NULL, PRIMARY KEY (mac, mesaj, uid))',
    'CREATE TABLE IF NOT EXISTS mesajlarim (uid TEXT NOT NULL, mac TEXT NOT NULL, mesaj TEXT NOT NULL, PRIMARY KEY (uid, mac, mesaj))',
    'CREATE TABLE IF NOT EXISTS bildirim_son (cift TEXT PRIMARY KEY, z INTEGER NOT NULL)'
];

let hazir = null;

/* Veritabanı (tablolar kurulmuş olarak) */
export async function d1(env) {
    if (!hazir)
        hazir = env.DB.batch(TABLOLAR.map(t => env.DB.prepare(t))).catch(e => {
            hazir = null;
            throw e;
        });
    await hazir;
    return env.DB;
}

export const RUMUZ = /^[A-Za-z0-9_çğıöşüÇĞİÖŞÜ]{3,15}$/;
export const rumuzAnahtari = ad => ad.toLocaleLowerCase('tr');
