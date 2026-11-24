/*
 * BİLDİRİMLER (Firebase Cloud Messaging)
 * - Bildirim odasından gelen işlerle cihazı zili açık maçların konusuna (mac-{no}) abone eder / çıkarır.
 * - Maçta gol, VAR iptali, kırmızı kart, başlama, devre ve maç sonunda konuya tek mesaj gönderir.
 * - Gol ve gol iptali hızlı kaynaktan (gün odasındaki h) da gelir: hangi kaynak önce görürse o gönderir,
 *   diğeri aynı skor için tekrar göndermez (bildirilen skor ortak tutulur).
 * Her olay yalnızca bir kez gönderilir; ilk görülen maç yalnızca not edilir.
 */

require('./veritabani');   /* Firebase bağlantısı orada kurulur */
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
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

/* ---------- Hızlı kaynak (gün odasından, index.js iletir) ---------- */

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

const hizliKayit = new Map();  /* maç no → hızlı kaynağın skoru "2-1" */
const hizliFark = new Map();   /* maç no → API skorundan farklı olduğu ilk an (ms) */

/*
 * Gün odasından gelen hızlı skorlar: { maç no: "2-1" }, null = silindi (uyarılar sunucuyu ilgilendirmez).
 * gonder: yeni skor bildirim gönderebilir mi (odaya bağlanınca gelen ilk hal göndermez; canlı saatlerde değilse de göndermez).
 * Değişen maçların numaraları döner.
 */
function hizliAl(skorlar, gonder) {
    const degisen = new Set();
    for (const [anahtar, deger] of Object.entries(skorlar || {})) {
        const no = Number(anahtar);
        if ((hizliKayit.get(no) ?? null) === deger) continue;
        if (deger === null) {
            hizliKayit.delete(no);
            hizliFark.delete(no);
        } else {
            hizliKayit.set(no, deger);
            hizliSkor(no, deger, gonder);
        }
        degisen.add(no);
    }
    return degisen;
}

/*
 * Hızlı kaynağın skoru, canlı maçta API'nin skorundan HIZLI_FARK süresince farklı kalırsa
 * (program durmuş, yanlış ya da iptal edilmiş gol) maçın hızlı kaydı ve uyarısı silinir; site API skoruna döner.
 * Yalnızca API'nin canlı skoru yeni çekilmişken çağrılır (index.js), API'ye ulaşılamıyorsa karşılaştırılmaz.
 * sil(maç no): kaydı gün odasından siler (index.js verir).
 */
function hizliKontrol(sil) {
    const t = Date.now();
    for (const [no, deger] of hizliKayit) {
        const d = durumlar.get(no);
        if (!d || !CANLI.has(d.durum) || deger === d.skor.join('-')) {
            hizliFark.delete(no);
            continue;
        }
        if (!hizliFark.has(no)) hizliFark.set(no, t);
        else if (t - hizliFark.get(no) >= A.HIZLI_FARK) {
            hizliFark.delete(no);
            console.log('Hızlı kayıt silindi (' + no + '): ' + deger + ', API ' + d.skor.join('-'));
            sil(no);
        }
    }
}

/* Hızlı kaynağın maç için son skoru ("2-1"), yoksa undefined */
const hizliSkoru = no => hizliKayit.get(no);

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

/* ---------- Zil kayıtları ----------
 * Kayıtlar bildirim odasında (oda/src/index.js → BildirimOdasi): site zil değişince oraya gönderir. Oda her değişiklik için
 * "bu cihaz anahtarını şu maçlara abone et / şunlardan çıkar" işini hesaplar, sunucuya iletir (oda.bildirimDinle).
 * Yanıt bildirimlerinde kişinin cihaz anahtarlarını da oda bulur. Sunucu kayıtları tutmaz.
 */

/* Cihaz anahtarını maçların konusuna abone eder / çıkarır (maç başına tek istek). Anahtar geçersizse [anahtar] döner */
async function abone(token, ekle, cikar) {
    for (const [islem, liste] of [['cikar', cikar || []], ['ekle', ekle || []]]) {
        for (const mac of liste) {
            const sonuc = islem === 'ekle'
                ? await getMessaging().subscribeToTopic([token], konu(mac))
                : await getMessaging().unsubscribeFromTopic([token], konu(mac));
            const kod = ((sonuc.errors[0] || {}).error || {}).code || '';
            if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(kod))
                return [token];
            if (sonuc.failureCount) console.warn('Abonelik başarısız (' + konu(mac) + '): ' + kod);
        }
    }
    return [];
}

/*
 * Yanıt bildirimi (mesajda @rumuz): kişinin cihaz anahtarlarına (oda bulur). Geçersizleşmiş anahtarlar döner
 * (oda o kayıtları siler).
 */
async function tokenlaraGonder(tokenlar, baslik, metin, link) {
    const gecersiz = [];
    for (const token of tokenlar || []) {
        try {
            await getMessaging().send({
                token: token,
                webpush: {
                    notification: { title: baslik, body: metin, icon: A.SITE_ADRES + 'cs-icon-192.png' },
                    fcmOptions: { link: link }
                }
            });
        } catch (e) {
            if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(e.code || ''))
                gecersiz.push(token);
            else
                console.error('Yanıt bildirimi gönderilemedi: ' + e.message);
        }
    }
    return gecersiz;
}

/* Eski Firestore zil kayıtları (artık bildirim odasında) bir kez silinir */
async function eskiZilSil() {
    try {
        const fs = getFirestore();
        let toplam = 0;
        for (;;) {
            const snap = await fs.collection('zil').limit(400).get();
            if (snap.empty) break;
            const yigin = fs.batch();
            snap.docs.forEach(d => yigin.delete(d.ref));
            await yigin.commit();
            toplam += snap.size;
        }
        if (toplam) console.log('Eski zil kayıtları silindi: ' + toplam);
    } catch (e) {
        console.error('Eski zil kayıtları silinemedi: ' + e.message);
    }
}

module.exports = { kontrol, hizliAl, hizliKontrol, hizliSkoru, abone, tokenlaraGonder, eskiZilSil };
