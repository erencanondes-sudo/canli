/*
 * Canlı skor sunucusu.
 * Canlı saatlerde (12:30–01:00) 15 sn'de bir tur, dışında 1 dk'da bir (ayarlar.js):
 *   1. Gerekirse fikstür (dün, bugün ve 7 gün ileri) ve liglerin veri kapsamı
 *   2. Canlı maç varsa canlı skor + olaylar
 *   3. Dakikada bir detay (istatistik, kadro), maç sonları ve düzeltmeler
 *   4. Değişenleri yaz: takım adları ve canlı skor satırları (RTDB), gün dokümanı (Firestore, en fazla 10 dk'da bir),
 *      Özet (RTDB olay günlüğü + Firestore, değişince)
 *   5. Maçta olay olduysa zili açık cihazlara bildirim (bildirim.js; gol ve iptal hızlı kaynaktan da)
 */

const A = require('./ayarlar');
const api = require('./api');
const B = require('./bicim');
const db = require('./veritabani');
const bildirim = require('./bildirim');

const CANLI = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);
const BITTI = new Set(['FT', 'AET', 'PEN']);
const OYNANMAYACAK = new Set(['PST', 'CANC', 'ABD', 'AWD', 'WO']);

const LIG_NO = A.LIGLER.map(l => l.no);
const LIG_SIRA = new Map(LIG_NO.map((no, i) => [no, i]));
const detayli = new Map(LIG_NO.map(no => [no, true]));   /* lig → kadro / istatistik veriyor mu */

/* Takip edilen maçlar: no → { f, gun, olaylar, bitis, sonHal, duzeltildi, kadro, kadroDeneme, kontrol, cBitis } */
const maclar = new Map();

const zaman = { fikstur: {}, kapsam: 0, detay: 0, durum: 0 };
let sonCanli = null;
let sonHata = null;

const simdi = () => Math.floor(Date.now() / 1000);
const gunAdi = ms => new Date(ms).toLocaleDateString('en-CA', { timeZone: A.SAAT_DILIMI });
const durumu = k => k.f.fixture.status.short;
const SAAT = '&timezone=' + A.SAAT_DILIMI;

/* Türkiye saatine göre canlı saatlerde miyiz? (aralık gece yarısını geçebilir) */
function canliSaatte() {
    const saat = new Date().toLocaleTimeString('en-GB', { timeZone: A.SAAT_DILIMI, hour: '2-digit', minute: '2-digit' });
    const [bas, son] = A.CANLI_SAAT;
    return bas <= son ? saat >= bas && saat <= son : saat >= bas || saat <= son;
}

const turAraligi = () => canliSaatte() ? A.TUR_ARALIK : A.BEKLEME_ARALIK;

/* Dün, bugün ve ILERI_GUN gün ileri */
function gunler() {
    const n = Date.now();
    const liste = [];
    for (let i = -1; i <= A.ILERI_GUN; i++) liste.push(gunAdi(n + i * 864e5));
    return liste;
}

/*
 * API'den gelen maçı kaydeder; olay içermeyen cevaplarda eski olayları korur.
 * Canlı maçın skoru, dakikası ve olayları yalnızca canlı istekten alınır
 * (fikstür ve ayrıntı cevapları geride kalabiliyor; skor geri gidip yanlış bildirim olmasın).
 */
function kaydet(f, canliIstek) {
    const no = f.fixture.id;
    let k = maclar.get(no);
    if (!k) {
        k = { olaylar: null, bitis: null, sonHal: false, duzeltildi: false, kadro: false, kadroDeneme: 0, kontrol: false, cBitis: null };
        maclar.set(no, k);
    }
    if (!canliIstek && k.f && CANLI.has(durumu(k)) && CANLI.has(f.fixture.status.short) && !k.kontrol)
        return k;
    k.f = f;
    k.gun = f.fixture.date.slice(0, 10);
    if (f.events) k.olaylar = B.olaylar(f);
    if (BITTI.has(f.fixture.status.short) && !k.bitis) k.bitis = simdi();
    bildirim.kontrol(f, k.olaylar, canliSaatte());
    return k;
}

/* ---------- API'den çekme ---------- */

async function kapsamCek() {
    for (const no of LIG_NO) {
        const r = await api.istek('/leagues?id=' + no + '&current=true');
        const kapsam = r[0] && r[0].seasons[0] && r[0].seasons[0].coverage.fixtures;
        if (kapsam) detayli.set(no, !!(kapsam.lineups || kapsam.statistics_fixtures));
        /* Lig numarasının doğruluğunu kontrol için API'deki adı */
        console.log('Lig ' + no + ': ' + (r[0] ? r[0].league.name + ' (' + r[0].country.name + ')' : 'BULUNAMADI') +
            (detayli.get(no) ? ', detaylı' : ', detaysız'));
    }
}

async function fiksturCek(gun) {
    const liste = await api.istek('/fixtures?date=' + gun + SAAT);
    let sayi = 0;
    for (const f of liste) {
        if (!LIG_SIRA.has(f.league.id)) continue;
        const k = kaydet(f);
        sayi++;

        /* Sunucu yeniden açıldıysa: eski maçların düzeltmesi yapılmış sayılır */
        if (BITTI.has(f.fixture.status.short) && !k.sonHal && simdi() - f.fixture.timestamp > 6 * 3600) {
            k.duzeltildi = true;
        }
    }
    console.log('Fikstür ' + gun + ': ' + sayi + ' maç');
}

/* Canlı maç var mı, ya da birazdan başlayacak maç var mı? */
function canliGerekli() {
    if (!canliSaatte()) return false;
    const t = simdi();
    for (const k of maclar.values()) {
        const d = durumu(k);
        const s = k.f.fixture.timestamp;
        if (CANLI.has(d)) return true;
        if ((d === 'NS' || d === 'TBD') && s <= t + 60 && s >= t - 4 * 3600) return true;
    }
    return false;
}

async function canliCek() {
    const liste = await api.istek('/fixtures?live=' + LIG_NO.join('-') + SAAT, true);
    const gelen = new Set();
    for (const f of liste) {
        if (!LIG_SIRA.has(f.league.id)) continue;
        kaydet(f, true);
        gelen.add(f.fixture.id);
    }

    /* Canlı listeden düşen maç: bitmiş olabilir, hemen detayına bakılır */
    for (const [no, k] of maclar) {
        if (CANLI.has(durumu(k)) && !gelen.has(no)) k.kontrol = true;
    }
    sonCanli = new Date().toISOString();
}

/* Detayı çekilecek maçlar */
function detaySec() {
    const t = simdi();
    const yedek = api.yedekte();
    const canliSaat = canliSaatte();
    const secim = [];

    for (const [no, k] of maclar) {
        const d = durumu(k);
        const lig = k.f.league.id;

        if (k.kontrol || (BITTI.has(d) && !k.sonHal)) secim.push(no);
        else if (yedek) continue;
        else if (CANLI.has(d)) { if (canliSaat && detayli.get(lig)) secim.push(no); }
        else if (BITTI.has(d) && !k.duzeltildi && t - k.bitis >= A.DUZELTME_SONRA) secim.push(no);
        else if (d === 'NS' && detayli.get(lig) && !k.kadro &&
                 k.f.fixture.timestamp - t <= A.KADRO_ONCESI && t - k.kadroDeneme >= A.KADRO_ARALIK) {
            k.kadroDeneme = t;
            secim.push(no);
        }
    }
    return secim;
}

async function detayCek(nolar) {
    for (let i = 0; i < nolar.length; i += 20) {
        const liste = await api.istek('/fixtures?ids=' + nolar.slice(i, i + 20).join('-') + SAAT);

        for (const f of liste) {
            const k = kaydet(f);
            const d = f.fixture.status.short;
            k.kontrol = false;

            if (BITTI.has(d)) {
                if (k.sonHal && simdi() - k.bitis >= A.DUZELTME_SONRA) k.duzeltildi = true;
                k.sonHal = true;
            }
            if (OYNANMAYACAK.has(d)) k.sonHal = true;
            if (f.lineups && f.lineups.length) k.kadro = true;

            /* Maç bitince doküman olaylarla birlikte tam yazılır (istatistik vermeyen liglerde de) */
            const bitti = BITTI.has(d);
            if (bitti || (detayli.get(f.league.id) && (k.kadro || (f.statistics && f.statistics.length)))) {
                await db.yazSikistir('maclar/' + f.fixture.id, JSON.stringify(B.macDokumani(f, bitti ? (k.olaylar || []) : null)));
            }
        }
    }
}

/* ---------- Yazma ---------- */

/*
 * RTDB: takım adları (silinmez). Yeni ya da değişen adlar ayrıca takim_ek/{sürüm} altına yazılır
 * ve sürüm değişir; telefon yalnızca son baktığından sonraki ekleri indirir.
 */
async function takimYaz() {
    const icerik = new Map();
    for (const k of maclar.values()) {
        icerik.set(String(k.f.teams.home.id), B.ad(k.f.teams.home.name));
        icerik.set(String(k.f.teams.away.id), B.ad(k.f.teams.away.name));
    }
    const yeni = await db.dalYaz('takim', icerik, false);
    if (yeni) {
        const surum = simdi();
        await db.cokluYaz({ takim_surum: surum, ['takim_ek/' + surum]: yeni });
    }
}

/* RTDB: liglerin kadro / istatistik verip vermediği (1 / 0) */
async function ligYaz() {
    await db.dalYaz('lig', new Map(LIG_NO.map(no => [String(no), detayli.get(no) ? 1 : 0])));
}

/*
 * Günün canlı skor satırları.
 * RTDB gun/{gün}: her maç ayrı satır, yalnızca değişen yazılır. Canlı maçlar ve bittikten sonra
 * 21 dk (b1) "c" ile başlar; site yalnızca bunları dinler. Sonra "c" kalkar (b2).
 * Firestore gun/{gün}: aynı satırlar ("c" olmadan) tek dokümanda, gzip ile sıkıştırılmış (z), en fazla 10 dk'da bir.
 */
async function gunYaz(gun) {
    const rtdb = await db.dalHali('gun/' + gun);
    const icerik = new Map();
    const duz = {};

    for (const [no, k] of maclar) {
        if (k.gun !== gun) continue;
        const satir = B.satir(k.f);
        duz[no] = satir;

        let c = CANLI.has(durumu(k));
        if (c) k.cBitis = null;
        else {
            /* "c" ile yazılmış maç artık canlı değilse 21 dk sayılır (sunucu yeniden açıldıysa da) */
            if (!k.cBitis && (rtdb.get(String(no)) || '').startsWith('c')) k.cBitis = simdi();
            c = !!k.cBitis && simdi() - k.cBitis < A.B1_SURE;
        }
        icerik.set(String(no), (c ? 'c' : '') + satir);
    }

    await db.dalYaz('gun/' + gun, icerik);
    await db.yazSikistir('gun/' + gun, JSON.stringify(duz), {}, A.GUN_ARALIK);
}

/*
 * ÖZET (oynanan ve biten maçların olayları), dün ve bugün için:
 *   RTDB olay/{gün}/{anahtar}: olay günlüğü. Yeni olay bir satır: [maç no, sıra, dakika, uzatma, taraf, tür, ayrıntı, oyuncu, ikinci oyuncu]
 *     (sıra: maçın kaçıncı olayı, 0'dan; aynı satır iki kez gelse de sonuç değişmez).
 *     API eski bir olayı değiştirir ya da silerse maçın tamamı bir satır: [maç no, [olaylar]].
 *     Anahtar zamana göre sıralı ("1793...123-00"). 2 gün sonra silinir.
 *   Firestore ozet/{gün}: bütün olaylar (z, gzip ile sıkıştırılmış) ve dahil olan son günlük anahtarı (t). Değişince yazılır.
 * Önce RTDB, sonra Firestore yazılır: Firestore aksarsa eksik kalan günlükten gelir.
 * Sunucu yeni açıldıysa olayları henüz çekilmemiş maçların eski kaydı Firestore'dan korunur.
 */
const ozetHali = new Map();   /* gün → { m: { maç no: olaylar }, t } (günlüğe son yazılan) */
let anahtarSon = '';

function yeniAnahtar() {
    let a = String(Date.now()) + '-00';
    if (a <= anahtarSon) {
        const [ms, sira] = anahtarSon.split('-');
        a = ms + '-' + String(Number(sira) + 1).padStart(2, '0');
    }
    return (anahtarSon = a);
}

async function ozetYaz(gun) {
    if (!ozetHali.has(gun)) {
        const eski = await db.oku('ozet/' + gun);
        ozetHali.set(gun, { m: eski && eski.m ? JSON.parse(eski.m) : {}, t: eski && eski.t || '' });
    }
    const hal = ozetHali.get(gun);

    const ozet = {};
    for (const [no, olay] of Object.entries(hal.m)) {
        const k = maclar.get(Number(no));
        if (k && k.gun === gun && k.olaylar === null) ozet[no] = olay;
    }
    for (const [no, k] of maclar) {
        if (k.gun !== gun || !k.olaylar) continue;
        const d = durumu(k);
        if (CANLI.has(d) || BITTI.has(d)) ozet[no] = k.olaylar.map(B.kisaOlay);
    }

    /* Günlüğe yazılacaklar: önceki listenin devamıysa yalnızca yeniler, değilse maçın tamamı */
    const satirlar = {};
    for (const [no, yeni] of Object.entries(ozet)) {
        const once = hal.m[no] || [];
        const metin = olay => JSON.stringify(olay);
        const devam = yeni.length >= once.length && once.every((o, i) => metin(o) === metin(yeni[i]));
        if (devam) yeni.slice(once.length).forEach((o, i) => {
            satirlar['olay/' + gun + '/' + yeniAnahtar()] = JSON.stringify([Number(no), once.length + i, ...o]);
        });
        else satirlar['olay/' + gun + '/' + yeniAnahtar()] = JSON.stringify([Number(no), yeni]);
    }

    /* Günlük yazılınca hal güncellenir (Firestore aksarsa günlüğe aynı satırlar tekrar yazılmasın) */
    const anahtarlar = Object.keys(satirlar);
    if (anahtarlar.length) {
        await db.cokluYaz(satirlar);
        ozetHali.set(gun, { m: ozet, t: anahtarlar[anahtarlar.length - 1].split('/').pop() });
    }

    await db.yazSikistir('ozet/' + gun, JSON.stringify(ozet), { t: ozetHali.get(gun).t });
}

async function durumYaz() {
    await db.yaz('sistem/durum', {
        calisiyor: true,
        son_tur: new Date().toISOString(),
        son_canli_istek: sonCanli,
        canli_mac: [...maclar.values()].filter(k => CANLI.has(durumu(k))).length,
        takip_edilen_mac: maclar.size,
        kalan_istek: api.durum.kalan,
        gunluk_hak: api.durum.hak,
        acilistan_beri_istek: api.durum.istek,
        acilistan_beri_yazma: db.yazmaSayisi(),
        son_hata: sonHata
    });
}

/* Dünden eski maçları hafızadan sil (veritabanında kalırlar) */
function temizle(dun) {
    for (const [no, k] of maclar) if (k.gun < dun) maclar.delete(no);
}

/* ---------- Tur ---------- */

async function tur() {
    const basla = Date.now();
    const tumu = gunler();
    const [dun, bugun, yarin] = tumu;

    try {
        if (basla - zaman.kapsam >= A.KAPSAM_ARALIK) {
            await kapsamCek();
            await ligYaz();
            await db.eskiSil('takim_ek', simdi() - A.TAKIM_EK_SURE);
            await db.eskiSil('gun', gunAdi(basla - A.RTDB_GUN_SAKLA * 864e5));
            await db.eskiSil('olay', gunAdi(basla - A.RTDB_GUN_SAKLA * 864e5));
            zaman.kapsam = basla;
        }

        for (const gun of tumu) {
            const aralik = gun === bugun ? A.FIKSTUR_BUGUN : gun === dun || gun === yarin ? A.FIKSTUR_DIGER : A.FIKSTUR_ILERI;
            if (basla - (zaman.fikstur[gun] || 0) < aralik) continue;
            if (gun !== bugun && api.yedekte()) continue;
            await fiksturCek(gun);
            zaman.fikstur[gun] = basla;
        }

        if (canliGerekli()) {
            await canliCek();
            const kontrol = [...maclar].filter(([, k]) => k.kontrol).map(([no]) => no);
            if (kontrol.length) await detayCek(kontrol);
        }

        if (basla - zaman.detay >= A.DETAY_ARALIK) {
            zaman.detay = basla;
            await detayCek(detaySec());
        }

        /* Fikstürü bu açılışta çekilmemiş gün yazılmaz (yarım liste eski satırları silmesin) */
        const hazir = tumu.filter(gun => zaman.fikstur[gun]);
        await takimYaz();
        for (const gun of hazir) await gunYaz(gun);
        for (const gun of hazir) if (gun <= bugun) await ozetYaz(gun);

        temizle(dun);
        sonHata = null;
    } catch (e) {
        sonHata = e.message;
        console.error('Hata: ' + e.message);
    }

    try {
        if (Date.now() - zaman.durum >= 60000) {
            zaman.durum = Date.now();
            await durumYaz();
        }
    } catch (e) {
        console.error('Durum yazılamadı: ' + e.message);
    }

    setTimeout(tur, Math.max(1000, turAraligi() - (Date.now() - basla)));
}

if (require.main === module) {
    console.log('Sunucu başladı: ' + A.LIGLER.map(l => l.ad).join(', '));
    bildirim.zilDinle();
    bildirim.hizliDinle(canliSaatte);
    tur();
}

module.exports = { tur, maclar };
