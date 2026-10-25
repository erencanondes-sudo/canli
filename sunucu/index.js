/*
 * Canlı skor sunucusu.
 * Her 15 saniyede bir tur:
 *   1. Gerekirse fikstür (dün, bugün, yarın) ve liglerin veri kapsamı
 *   2. Canlı maç varsa canlı skor + olaylar
 *   3. Dakikada bir detay (istatistik, kadro), maç sonları ve düzeltmeler
 *   4. Değişen dokümanları yaz (önce ana sayfa grupları, sonra canlı doküman)
 */

const A = require('./ayarlar');
const api = require('./api');
const B = require('./bicim');
const db = require('./veritabani');

const CANLI = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);
const BITTI = new Set(['FT', 'AET', 'PEN']);
const OYNANMAYACAK = new Set(['PST', 'CANC', 'ABD', 'AWD', 'WO']);

const LIG_NO = A.LIGLER.map(l => l.no);
const LIG_SIRA = new Map(LIG_NO.map((no, i) => [no, i]));
const detayli = new Map(LIG_NO.map(no => [no, true]));   /* lig → kadro / istatistik veriyor mu */

/* Takip edilen maçlar: no → { f, gun, olaylar, bitis, sonHal, duzeltildi, kadro, kadroDeneme, kontrol } */
const maclar = new Map();

const zaman = { fikstur: {}, kapsam: 0, detay: 0, durum: 0 };
const grupSayisi = new Map();   /* gün → en son yazılan grup sayısı */
let sonCanli = null;
let sonHata = null;

const simdi = () => Math.floor(Date.now() / 1000);
const gunAdi = ms => new Date(ms).toLocaleDateString('en-CA', { timeZone: A.SAAT_DILIMI });
const durumu = k => k.f.fixture.status.short;
const SAAT = '&timezone=' + A.SAAT_DILIMI;

function gunler() {
    const n = Date.now();
    return [gunAdi(n - 864e5), gunAdi(n), gunAdi(n + 864e5)];
}

/* API'den gelen maçı kaydeder; olay içermeyen cevaplarda eski olayları korur */
function kaydet(f) {
    const no = f.fixture.id;
    let k = maclar.get(no);
    if (!k) {
        k = { olaylar: null, bitis: null, sonHal: false, duzeltildi: false, kadro: false, kadroDeneme: 0, kontrol: false };
        maclar.set(no, k);
    }
    k.f = f;
    k.gun = f.fixture.date.slice(0, 10);
    if (f.events) k.olaylar = B.olaylar(f);
    if (BITTI.has(f.fixture.status.short) && !k.bitis) k.bitis = simdi();
    return k;
}

/* ---------- API'den çekme ---------- */

async function kapsamCek() {
    for (const no of LIG_NO) {
        const r = await api.istek('/leagues?id=' + no + '&current=true');
        const kapsam = r[0] && r[0].seasons[0] && r[0].seasons[0].coverage.fixtures;
        if (kapsam) detayli.set(no, !!(kapsam.lineups || kapsam.statistics_fixtures));
    }
    console.log('Lig kapsamı: ' + LIG_NO.map(no => no + (detayli.get(no) ? ' detaylı' : ' detaysız')).join(', '));
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
        kaydet(f);
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
    const secim = [];

    for (const [no, k] of maclar) {
        const d = durumu(k);
        const lig = k.f.league.id;

        if (k.kontrol || (BITTI.has(d) && !k.sonHal)) secim.push(no);
        else if (yedek) continue;
        else if (CANLI.has(d) && detayli.get(lig)) secim.push(no);
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

            if (detayli.get(f.league.id) && (k.kadro || (f.statistics && f.statistics.length))) {
                await db.yaz('maclar/' + f.fixture.id, B.macDokumani(f));
            }
        }
    }
}

/* ---------- Dokümanlar ---------- */

function sirala(a, b) {
    return (LIG_SIRA.get(a.f.league.id) - LIG_SIRA.get(b.f.league.id)) ||
           (a.f.fixture.timestamp - b.f.fixture.timestamp) ||
           (a.f.fixture.id - b.f.fixture.id);
}

/* Takım adları ve ligler (uygulamadaki takım tablosu hazır olana kadar) */
function ekler(liste) {
    const takimlar = {};
    const ligler = {};
    for (const k of liste) {
        takimlar[k.f.teams.home.id] = B.ad(k.f.teams.home.name);
        takimlar[k.f.teams.away.id] = B.ad(k.f.teams.away.name);
        ligler[k.f.league.id] = { ad: k.f.league.name, detay: detayli.get(k.f.league.id) };
    }
    return { takimlar, ligler };
}

async function gunYaz(gun) {
    const liste = [...maclar.values()].filter(k => k.gun === gun).sort(sirala);
    const gruplar = [];
    for (let i = 0; i < liste.length; i += A.GRUP_BOYU) gruplar.push(liste.slice(i, i + A.GRUP_BOYU));
    if (!gruplar.length) gruplar.push([]);

    /* 1. gruptaki içindekiler: diğer grupların maç numaraları */
    const diger = {};
    gruplar.slice(1).forEach((g, i) => { diger[i + 2] = g.map(k => k.f.fixture.id); });

    for (let i = 0; i < gruplar.length; i++) {
        const g = gruplar[i];
        const veri = {
            gun,
            grup: i + 1,
            grup_sayisi: liste.length ? gruplar.length : 0,
            maclar: g.map(k => {
                const d = durumu(k);
                const satir = CANLI.has(d) ? B.yerTutucu(k.f) : B.satir(k.f, BITTI.has(d) ? (k.olaylar || []) : []);
                return JSON.stringify(satir);
            }),
            ...ekler(g)
        };
        if (i === 0) veri.diger_gruplar = diger;
        await db.yaz('gunler/' + gun + '-' + (i + 1), veri);
    }

    /* Grup sayısı azaldıysa fazla grupları boşalt */
    for (let i = gruplar.length + 1; i <= (grupSayisi.get(gun) || 0); i++) {
        await db.yaz('gunler/' + gun + '-' + i, { gun, grup: i, grup_sayisi: gruplar.length, maclar: [], takimlar: {}, ligler: {} });
    }
    grupSayisi.set(gun, gruplar.length);
}

async function canliYaz() {
    const liste = [...maclar.values()].filter(k => CANLI.has(durumu(k))).sort(sirala);
    await db.yaz('canli/simdi', {
        maclar: liste.map(k => JSON.stringify(B.satir(k.f, k.olaylar || []))),
        ...ekler(liste)
    });
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

/* Dünden eski maçları hafızadan sil (Firestore'da kalırlar) */
function temizle(dun) {
    for (const [no, k] of maclar) if (k.gun < dun) maclar.delete(no);
}

/* ---------- Tur ---------- */

async function tur() {
    const basla = Date.now();
    const [dun, bugun, yarin] = gunler();

    try {
        if (basla - zaman.kapsam >= A.KAPSAM_ARALIK) {
            await kapsamCek();
            zaman.kapsam = basla;
        }

        for (const gun of [dun, bugun, yarin]) {
            const aralik = gun === bugun ? A.FIKSTUR_BUGUN : A.FIKSTUR_DIGER;
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

        for (const gun of [dun, bugun, yarin]) await gunYaz(gun);
        await canliYaz();

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

    setTimeout(tur, Math.max(1000, A.TUR_ARALIK - (Date.now() - basla)));
}

if (require.main === module) {
    console.log('Sunucu başladı: ' + A.LIGLER.map(l => l.ad).join(', '));
    tur();
}

module.exports = { tur, maclar };
