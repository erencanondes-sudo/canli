/*
 * BİLDİRİMLER (Firebase Cloud Messaging)
 * - zil/{cihaz} dokümanlarını dinler; cihazı kayıtlı maçların konusuna (mac-{no}) abone eder.
 * - Maçta gol, VAR iptali, kırmızı kart, başlama, devre ve maç sonunda konuya tek mesaj gönderir.
 * - Gol ve gol iptali hızlı kaynaktan (RTDB hizli) da gelir: hangi kaynak önce görürse o gönderir,
 *   diğeri aynı skor için tekrar göndermez (bildirilen skor ortak tutulur).
 * Her olay yalnızca bir kez gönderilir; ilk görülen maç yalnızca not edilir.
 */

require('./veritabani');   /* Firebase bağlantısı orada kurulur */
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { getDatabase } = require('firebase-admin/database');
const A = require('./ayarlar');
const B = require('./bicim');

const BASLAMADI = new Set(['NS', 'TBD']);
const BITTI = new Set(['FT', 'AET', 'PEN']);

const konu = no => 'mac-' + no;

/* ---------- Maç olayları ---------- */

const durumlar = new Map();   /* maç no → { skor, durum, kirmizi, takim, dakika } (API'den) */
const bildirilen = new Map(); /* maç no → bildirimi gönderilmiş skor [ev, dep] (API ve hızlı kaynak ortak) */
const CANLI = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);

/* Taraf başına kırmızı kart sayısı (ikinci sarıdan kırmızı dahil) */
function kirmizilar(olaylar) {
    const sayi = [0, 0];
    olaylar.forEach(e => {
        if (e[3] === 'k' && (e[4] === 'k' || e[4] === 'sk') && (e[2] === 0 || e[2] === 1)) sayi[e[2]]++;
    });
    return sayi;
}

/* Tarafın golleri / kırmızı kartları (kaçan penaltı gol değildir) */
function oyuncular(olaylar, taraf, tur) {
    return (olaylar || [])
        .filter(e => e[2] === taraf && e[3] === tur && (tur === 'g' ? e[4] !== 'kp' : e[4] === 'k' || e[4] === 'sk'))
        .map(e => e[5] || '');
}

/*
 * API'den gelen maçı bir önceki haliyle karşılaştırır.
 * gonder: false ise (canlı saatler dışı) yalnızca not edilir.
 */
function kontrol(f, olaylar, gonder) {

    const no = f.fixture.id;
    const durum = f.fixture.status.short;
    const skor = [f.goals.home || 0, f.goals.away || 0];
    const once = durumlar.get(no);
    const kirmizi = olaylar ? kirmizilar(olaylar) : (once ? once.kirmizi : [0, 0]);

    const ev = B.ad(f.teams.home.name);
    const dep = B.ad(f.teams.away.name);
    const takim = [ev, dep];
    const dakika = f.fixture.status.elapsed ? f.fixture.status.elapsed + (f.fixture.status.extra ? '+' + f.fixture.status.extra : '') + "' " : '';
    const sonuc = ev + ' ' + skor[0] + ' - ' + skor[1] + ' ' + dep;

    durumlar.set(no, { skor, durum, kirmizi, takim, dakika });

    /* Bildirilen skor: API'de değişen taraf ilerler (hızlı kaynak öndeyse geri gitmez); iptalde iner */
    const duyurulan = bildirilen.get(no);
    const yeni = duyurulan ? duyurulan.slice() : skor.slice();
    if (once) [0, 1].forEach(t => {
        if (skor[t] > once.skor[t]) yeni[t] = Math.max(yeni[t], skor[t]);
        if (skor[t] < once.skor[t]) yeni[t] = skor[t];
    });
    bildirilen.set(no, yeni);

    if (!once || !gonder) return;

    if (BASLAMADI.has(once.durum) && durum === '1H')
        gonderMesaj(no, 'Maç başladı', ev + ' - ' + dep);

    [0, 1].forEach(t => {
        const goller = oyuncular(olaylar, t, 'g');
        /* Hızlı kaynak bu golü zaten bildirdiyse tekrar gönderilmez */
        for (let i = Math.max(once.skor[t], duyurulan ? duyurulan[t] : 0); i < skor[t]; i++) {
            const oyuncu = goller[i] !== undefined ? goller[i] : goller[goller.length - 1] || '';
            gonderMesaj(no, '⚽ GOL! ' + takim[t], dakika + sonuc + (oyuncu ? ' · ' + oyuncu : ''));
        }
        if (skor[t] < once.skor[t] && (!duyurulan || skor[t] < duyurulan[t]))
            gonderMesaj(no, 'VAR: ' + takim[t] + ' golü iptal', sonuc);
        if (kirmizi[t] > once.kirmizi[t]) {
            const oyuncu = oyuncular(olaylar, t, 'k').pop() || '';
            gonderMesaj(no, '🟥 Kırmızı kart: ' + takim[t], dakika + (oyuncu ? oyuncu + ' · ' : '') + sonuc);
        }
    });

    if (once.durum !== 'HT' && durum === 'HT')
        gonderMesaj(no, 'Devre arası', sonuc);

    if (!BITTI.has(once.durum) && BITTI.has(durum))
        gonderMesaj(no, 'Maç sonu', sonuc);
}

/* ---------- Hızlı kaynak (RTDB hizli) ---------- */

/*
 * Hızlı kaynakta skor değişince: API'nin bildirdiğinden ilerideyse gol, gerideyse iptal bildirimi.
 * Yalnızca API'de canlı görünen maçlarda ve canlı saatlerde.
 */
function hizliSkor(no, deger, gonder) {

    const d = durumlar.get(no);
    const m = /^(\d+)-(\d+)$/.exec(deger || '');
    if (!d || !m || !CANLI.has(d.durum)) return;

    const skor = [Number(m[1]), Number(m[2])];
    const duyurulan = bildirilen.get(no) || d.skor;
    bildirilen.set(no, skor.slice());

    if (!gonder) return;

    const sonuc = d.takim[0] + ' ' + skor[0] + ' - ' + skor[1] + ' ' + d.takim[1];
    [0, 1].forEach(t => {
        for (let i = duyurulan[t]; i < skor[t]; i++)
            gonderMesaj(no, '⚽ GOL! ' + d.takim[t], d.dakika + sonuc);
        if (skor[t] < duyurulan[t])
            gonderMesaj(no, 'VAR: ' + d.takim[t] + ' golü iptal', sonuc);
    });
}

/* canliSaatte: bildirim gönderilecek saatlerde miyiz (index.js verir). İlk gelen kayıtlar yalnızca not edilir. */
function hizliDinle(canliSaatte) {

    let ilk = true;

    const degisti = snap => hizliSkor(Number(snap.key), snap.val(), !ilk && canliSaatte());
    const ref = getDatabase().ref('hizli');
    ref.on('child_added', degisti, e => console.error('hizli dinlenemedi: ' + e.message));
    ref.on('child_changed', degisti);
    ref.once('value', () => { ilk = false; });
}

function gonderMesaj(no, baslik, metin) {
    let mesajci;
    try {
        mesajci = getMessaging();
    } catch (e) {
        console.error('Bildirim gönderilemedi: ' + e.message);
        return;
    }
    mesajci.send({
        topic: konu(no),
        webpush: {
            notification: {
                title: baslik,
                body: metin,
                icon: A.SITE_ADRES + 'cs-icon-192.png'
            },
            fcmOptions: { link: A.SITE_ADRES + '#mac=' + no }
        }
    }).catch(e => console.error('Bildirim gönderilemedi (' + no + '): ' + e.message));
}

/* ---------- Zil kayıtları ---------- */

const kayitli = new Map();   /* cihaz → { token, maclar: Set } */

function gecerli(veri) {
    const token = veri && typeof veri.token === 'string' && veri.token.length < 400 ? veri.token : null;
    const maclar = new Set(
        (veri && Array.isArray(veri.maclar) ? veri.maclar : [])
            .map(String).filter(m => /^\d{1,10}$/.test(m)).slice(-100)
    );
    return { token, maclar };
}

/* Konu → cihaz listesi şeklinde toplayıp FCM'e tek seferde gönderir */
async function abonelik(islem, ciftler) {
    const konular = new Map();
    ciftler.forEach(([token, mac]) => {
        if (!konular.has(mac)) konular.set(mac, []);
        konular.get(mac).push(token);
    });
    for (const [mac, tokenlar] of konular) {
        for (let i = 0; i < tokenlar.length; i += 1000) {
            try {
                const parca = tokenlar.slice(i, i + 1000);
                const sonuc = islem === 'ekle'
                    ? await getMessaging().subscribeToTopic(parca, konu(mac))
                    : await getMessaging().unsubscribeFromTopic(parca, konu(mac));
                if (sonuc.failureCount) console.warn('Abonelik: ' + sonuc.failureCount + ' cihaz başarısız (' + konu(mac) + ')');
            } catch (e) {
                console.error('Abonelik yapılamadı (' + konu(mac) + '): ' + e.message);
            }
        }
    }
}

async function zilDegisti(cihaz, veri) {

    const once = kayitli.get(cihaz);
    const yeni = gecerli(veri);
    const ekle = [];
    const cikar = [];

    if (once) {
        once.maclar.forEach(m => {
            if (once.token !== yeni.token || !yeni.maclar.has(m)) cikar.push([once.token, m]);
        });
    }
    if (yeni.token) {
        yeni.maclar.forEach(m => {
            if (!once || once.token !== yeni.token || !once.maclar.has(m)) ekle.push([yeni.token, m]);
        });
    }

    if (veri) kayitli.set(cihaz, yeni);
    else kayitli.delete(cihaz);

    if (cikar.length) await abonelik('cikar', cikar);
    if (ekle.length) await abonelik('ekle', ekle);
}

/* Sunucu açılınca bütün kayıtlar bir kez okunur (abonelik aynıysa FCM'de değişmez), sonra yalnızca değişenler gelir */
function zilDinle() {
    getFirestore().collection('zil').onSnapshot(snap => {
        snap.docChanges().forEach(d => {
            zilDegisti(d.doc.id, d.type === 'removed' ? null : d.doc.data())
                .catch(e => console.error('Zil işlenemedi: ' + e.message));
        });
    }, e => console.error('Zil kayıtları dinlenemedi: ' + e.message));
}

module.exports = { kontrol, zilDinle, hizliDinle };
