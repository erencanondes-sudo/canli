/*
 * Canlı skor sunucusu.
 * Canlı saatlerde (12:30–01:00) 15 sn'de bir tur, dışında 1 dk'da bir (ayarlar.js):
 *   1. Gerekirse fikstür (dün, bugün ve 7 gün ileri) ve liglerin veri kapsamı
 *   2. Canlı maç varsa canlı skor + olaylar
 *   3. Dakikada bir detay (istatistik, kadro), maç sonları ve düzeltmeler
 *   4. Değişenleri yaz: takım adları (RTDB); gün listesi ve Özet (gün odası + R2, değişince; hızlı kaynağın golünde de);
 *      maç içeriği (maç odası; maç kesinleşince R2 ve oda boşaltılır)
 *   5. Maçta olay olduysa zili açık cihazlara bildirim (bildirim.js; gol ve iptal hızlı kaynaktan da)
 * Yönetim sayfasından (RTDB): elle/{maç} kilidi API'nin skorunun / durumunun yerine geçer; yenile/{maç} maçı hemen yeniden çektirir.
 * Hızlı kaynak (bilgisayardaki program) şimdilik RTDB hizli, hizli_u'ya yazar; sunucu bunları gün odasına aktarır.
 */

const A = require('./ayarlar');
const api = require('./api');
const B = require('./bicim');
const db = require('./veritabani');
const depo = require('./depo');
const oda = require('./oda');
const bildirim = require('./bildirim');
const oran = require('./oran');
const mesaj = require('./mesaj');

const CANLI = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);
const BITTI = new Set(['FT', 'AET', 'PEN']);
const OYNANMAYACAK = new Set(['PST', 'CANC', 'ABD', 'AWD', 'WO']);

const LIG_NO = A.LIGLER.map(l => l.no);
const LIG_SIRA = new Map(LIG_NO.map((no, i) => [no, i]));
const detayli = new Map(LIG_NO.map(no => [no, true]));   /* lig → kadro / istatistik veriyor mu */

/* Takip edilen maçlar: no → { f, gun, gun2 (sabah maçının kendi takvim günü), devre { kod, bas }, olaylar, bitis, sonHal, duzeltildi, kadro, kadroDeneme, kontrol } */
const maclar = new Map();

const zaman = { fikstur: {}, kapsam: 0, detay: 0, durum: 0 };
let sonCanli = null;
let sonHata = null;
let hazirGunler = [];   /* fikstürü bu açılışta çekilmiş, yazılabilen günler */

/*
 * ELLE DÜZELTME (yönetim sayfası yazar)
 *   elle/{maç}: { s: "2-1", d?: "FT", o?: "[olaylar]", t } kilit. Kilit durdukça maçın skoru (ve verildiyse durumu, olayları) API'den değil buradan;
 *     kilitli maç için bildirim gönderilmez. Kilit konunca, değişince ve kalkınca maç API'den yeniden çekilir (maç odası / R2 düzelsin).
 *   yenile/{maç}: maç bir sonraki turda API'den yeniden çekilir, sonra kayıt silinir.
 */
const elle = new Map();      /* maç no → { s, d } */
const yenilenecek = new Set();

function elleUygula(f) {
    const kilit = elle.get(f.fixture.id);
    if (!kilit) return;
    const m = /^(\d+)-(\d+)$/.exec(kilit.s || '');
    if (m) f.goals = { home: Number(m[1]), away: Number(m[2]) };
    if (kilit.d) f.fixture.status.short = kilit.d;
}

/* Kilitteki olaylar (yönetim sayfasında düzenlendiyse) */
function elleOlaylar(no) {
    const kilit = elle.get(no);
    if (!kilit || !kilit.o) return null;
    try {
        return JSON.parse(kilit.o);
    } catch (e) {
        return null;
    }
}

function elleDinle() {
    const degisti = snap => {
        const no = Number(snap.key);
        const k = maclar.get(no);
        if (snap.exists()) {
            elle.set(no, snap.val() || {});
            if (k) {
                elleUygula(k.f);
                k.olaylar = elleOlaylar(no) || k.olaylar;
                if (BITTI.has(durumu(k)) && !k.bitis) k.bitis = simdi();
            }
        } else {
            elle.delete(no);
        }
        yenilenecek.add(no);
    };
    const ref = db.rtdb.ref('elle');
    ref.on('child_added', degisti, e => console.error('elle dinlenemedi: ' + e.message));
    ref.on('child_changed', degisti);
    ref.on('child_removed', degisti);
    db.rtdb.ref('yenile').on('child_added', snap => yenilenecek.add(Number(snap.key)),
        e => console.error('yenile dinlenemedi: ' + e.message));
}

/* İstenen maçlar API'den yeniden çekilir (canlı listedeki eski hal de geçilir), sonra yenile kaydı silinir */
async function yenile() {
    const nolar = [...yenilenecek];
    nolar.forEach(no => { const k = maclar.get(no); if (k) k.kontrol = true; });
    await detayCek(nolar);
    nolar.forEach(no => yenilenecek.delete(no));
    await db.cokluYaz(Object.fromEntries(nolar.map(no => ['yenile/' + no, null])));
    console.log('Yeniden çekildi: ' + nolar.join(', '));
}

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

/*
 * GÜN TANIMI (sitede de aynı)
 *   Maçın günü  = başlama saati − 7 saat: 00:00–06:59 başlayan maç önceki günün listesindedir.
 *   "Bugün"     = şu an − 4 saat: gün 04:00'te değişir.
 *   04:00–06:59 başlayan ("sabah") maç kendi takvim gününün listesine de yazılır.
 */
const SAAT_MS = 3600000;
const macGunu = ts => gunAdi(ts * 1000 - A.GUN_KAYMA * SAAT_MS);
const takvimGunu = ts => gunAdi(ts * 1000);
const saatTR = ts => Number(new Date(ts * 1000).toLocaleTimeString('en-GB', { timeZone: A.SAAT_DILIMI, hour: '2-digit', hour12: false }));

/* Dün, bugün ve ILERI_GUN gün ileri */
function gunler() {
    const n = Date.now() - A.BUGUN_KAYMA * SAAT_MS;
    const liste = [];
    for (let i = -1; i <= A.ILERI_GUN; i++) liste.push(gunAdi(n + i * 864e5));
    return liste;
}

/* Bir sonraki takvim günü ("2026-11-02" → "2026-11-03") */
const sonrakiGun = gun => gunAdi(new Date(gun + 'T12:00:00Z').getTime() + 864e5);

/*
 * API'den gelen maçı kaydeder; olay içermeyen cevaplarda eski olayları korur.
 * Canlı maçın skoru, dakikası ve olayları yalnızca canlı istekten alınır
 * (fikstür ve ayrıntı cevapları geride kalabiliyor; skor geri gidip yanlış bildirim olmasın).
 */
function kaydet(f, canliIstek) {
    const no = f.fixture.id;
    let k = maclar.get(no);
    if (!k) {
        k = { olaylar: null, bitis: null, sonHal: false, duzeltildi: false, kadro: false, kadroDeneme: 0, kontrol: false };
        maclar.set(no, k);
    }
    if (!canliIstek && k.f && CANLI.has(durumu(k)) && CANLI.has(f.fixture.status.short) && !k.kontrol)
        return k;
    elleUygula(f);
    k.f = f;
    const ts = f.fixture.timestamp;
    const sa = saatTR(ts);
    k.gun = macGunu(ts);
    k.gun2 = sa >= A.SABAH[0] && sa < A.SABAH[1] ? takvimGunu(ts) : null;
    if (f.events) k.olaylar = B.olaylar(f);
    k.olaylar = elleOlaylar(no) || k.olaylar;
    if (BITTI.has(f.fixture.status.short) && !k.bitis) k.bitis = simdi();
    bildirim.kontrol(f, k.olaylar, canliSaatte() && !elle.has(no));
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

            /* Maç içeriği maç odasına; maç bitince olaylarla birlikte tam (istatistik vermeyen liglerde de).
               Maç kesinleşince (bitişten 2 saat sonraki son çekiş) içerik R2'ye mac/{no}.json yazılır, oda boşaltılır.
               Bir maçın verisindeki sorun turu durdurmaz: o maç atlanır, günlüğe yazılır. */
            const bitti = BITTI.has(d);
            if (bitti || (detayli.get(f.league.id) && (k.kadro || (f.statistics && f.statistics.length)))) {
                try {
                    const icerik = B.macDokumani(f, bitti ? (k.olaylar || []) : null);
                    if (bitti && k.duzeltildi) {
                        await depo.yukle('mac/' + f.fixture.id + '.json', JSON.stringify({ ...icerik, g: Date.now() }));
                        oda.sil('mac/' + f.fixture.id);
                    } else {
                        oda.mac(f.fixture.id, icerik);
                    }
                } catch (e) {
                    console.error('Maç ' + f.fixture.id + ' yazılamadı: ' + e.message);
                }
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
 * Gün odası gun/{gün}: r = satırlar (API'nin skoru), h / u = canlı maçların hızlı skoru ve uyarısı (kilitli maçlar hariç).
 *   Site skoru ikisinden birleştirir. Oda yalnızca değişen maçları telefonlara iletir.
 * R2 gun/{gün}.json: aynı satırlar tek dosyada, değişince (bugün ve dünden eski günler, yarın ve sonrası buradan okunur).
 *   Canlı maçta hızlı kaynağın skoru varsa (kilitli değilse) dosyaya o yazılır; maç bitince ya da hızlı kayıt silinince API'ninki.
 */
/*
 * DEVRE BAŞLANGICI: dakika veritabanına yazılmaz; oynanan devrede devre kodu ve devrenin başladığı an
 * (planlanan başlama saatinden kaç saniye sonra) yazılır: "1H40", "2H3725", "ET6400". Site dakikayı hesaplar.
 * Devre değişince API'nin dakikasından hesaplanır; API'nin dakikası 2 dk'dan fazla saparsa bir kez düzeltilir.
 */
const DEVRE_TABAN = { '1H': 0, '2H': 45, 'ET': 90 };
const DEVRE_SON = { '1H': 45, '2H': 90, 'ET': 120 };

function devreMetni(k) {
    const s = k.f.fixture.status;
    const kod = s.short;
    if (!(kod in DEVRE_TABAN)) return null;

    const basla = k.f.fixture.timestamp;
    const taban = DEVRE_TABAN[kod];
    const dk = s.elapsed;
    const t = simdi();

    /* API'nin dakikası dk ise devre şu an (dk − taban − 1) dakika + yarım dakika önce başlamış sayılır */
    const hesapla = () => dk ? t - Math.max(0, (dk - taban - 1) * 60 + 30)
        : kod === '1H' ? basla : t;

    if (!k.devre || k.devre.kod !== kod) {
        k.devre = { kod, bas: hesapla() };
    } else if (dk && dk < DEVRE_SON[kod] && !s.extra) {
        const beklenen = Math.floor((t - k.devre.bas) / 60) + 1 + taban;
        if (Math.abs(beklenen - dk) > 2) k.devre.bas = hesapla();
    }
    return kod + (k.devre.bas - basla);
}

function gunYaz(gun) {
    const satirlar = {};
    const hizliSkor = {};
    const hizliUyari = {};
    const duz = {};

    for (const [no, k] of maclar) {
        if (k.gun !== gun && k.gun2 !== gun) continue;
        /* Kendi gününün listesinde, ertesi takvim gününde başlıyorsa saatin sonunda "+" */
        const ertesi = k.gun === gun && takvimGunu(k.f.fixture.timestamp) !== gun;
        const devre = devreMetni(k);
        const satir = B.satir(k.f, ertesi, devre);
        satirlar[no] = satir;

        const hizliAcik = CANLI.has(durumu(k)) && !elle.has(no);
        const skor = hizliAcik && bildirim.hizliSkoru(no);
        const uyari = hizliAcik && bildirim.hizliUyarisi(no);
        if (skor) hizliSkor[no] = skor;
        if (uyari) hizliUyari[no] = uyari;

        const hizli = /^(\d+)-(\d+)$/.exec(skor || '');
        duz[no] = hizli ? B.satir({ ...k.f, goals: { home: Number(hizli[1]), away: Number(hizli[2]) } }, ertesi, devre) : satir;
    }

    oda.gun(gun, { r: satirlar, h: hizliSkor, u: hizliUyari });
    depo.yaz('gun/' + gun + '.json', JSON.stringify(duz));
}

/* Hızlı kaynağın skoru ya da uyarısı değişince (ya da kaydı silinince) maçın günleri hemen yeniden yazılır */
function hizliDegisti(no) {
    const k = maclar.get(no);
    if (!k) return;
    for (const gun of [k.gun, k.gun2])
        if (gun && hazirGunler.includes(gun))
            gunYaz(gun);
}

/*
 * ÖZET (oynanan ve biten maçların olayları), dün ve bugün için:
 *   Gün odası gun/{gün}: o = { maç no: [olaylar] }. Oda yalnızca olayları değişen maçları telefonlara iletir.
 *   R2 ozet/{gün}.json: { m: { maç no: [olaylar] } } (arşiv). Değişince yazılır.
 * Sunucu yeni açıldıysa olayları henüz çekilmemiş maçların eski kaydı R2'deki dosyadan korunur.
 */
const ozetHali = new Map();   /* gün → { maç no: olaylar } (son yazılan) */

async function ozetYaz(gun) {
    if (!ozetHali.has(gun)) {
        const eski = await depo.oku('ozet/' + gun + '.json');
        ozetHali.set(gun, eski && eski.m || {});
    }

    const ozet = {};
    for (const [no, olay] of Object.entries(ozetHali.get(gun))) {
        const k = maclar.get(Number(no));
        if (k && k.gun === gun && k.olaylar === null) ozet[no] = olay;
    }
    for (const [no, k] of maclar) {
        if (k.gun !== gun || !k.olaylar) continue;
        const d = durumu(k);
        if (CANLI.has(d) || BITTI.has(d)) ozet[no] = k.olaylar.map(B.kisaOlay);
    }
    ozetHali.set(gun, ozet);

    oda.gun(gun, { o: ozet });
    depo.yaz('ozet/' + gun + '.json', JSON.stringify({ m: ozet }));
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
        son_hata: sonHata,
        r2_son_hata: depo.sonHata(),
        oda_son_hata: oda.sonHata()
    });
}

/* Dünden eski maçları hafızadan sil (veritabanında kalırlar) */
function temizle(dun) {
    for (const [no, k] of maclar) if (k.gun < dun && !(k.gun2 && k.gun2 >= dun)) maclar.delete(no);
    depo.unutEski(dun);
    for (const gun of ozetHali.keys()) if (gun < dun) ozetHali.delete(gun);
    oda.unut(yol => {
        const [tur, ad] = yol.split('/');
        return tur === 'gun' ? ad >= dun : maclar.has(Number(ad));
    });
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
            /* Geçiş: RTDB'de eskiden yazılan gun ve olay dalları silinir (artık yazılmıyor; adım 2'de bu satırlar kalkar) */
            await db.eskiSil('gun', gunAdi(basla));
            await db.eskiSil('olay', gunAdi(basla));
            /* Dünden eski günlerin odaları boşaltılır (o günler R2'den okunur) */
            for (let i = 2; i <= A.ODA_GUN_SAKLA; i++) oda.sil('gun/' + gunAdi(basla - A.BUGUN_KAYMA * SAAT_MS - i * 864e5));
            zaman.kapsam = basla;
        }

        /* Bir gün iki takvim gününe yayılır (07:00 → ertesi gün 06:59): bir takvim günü fazla çekilir */
        const takvim = [...tumu, sonrakiGun(tumu[tumu.length - 1])];
        for (const gun of takvim) {
            const aralik = gun === bugun || gun === yarin ? A.FIKSTUR_BUGUN : gun === dun ? A.FIKSTUR_DIGER : A.FIKSTUR_ILERI;
            if (basla - (zaman.fikstur[gun] || 0) < aralik) continue;
            if (gun !== bugun && gun !== yarin && api.yedekte()) continue;
            await fiksturCek(gun);
            zaman.fikstur[gun] = basla;
        }

        if (canliGerekli()) {
            await canliCek();
            bildirim.hizliKontrol();
            const kontrol = [...maclar].filter(([, k]) => k.kontrol).map(([no]) => no);
            if (kontrol.length) await detayCek(kontrol);
        }

        if (yenilenecek.size) await yenile();

        if (basla - zaman.detay >= A.DETAY_ARALIK) {
            zaman.detay = basla;
            await detayCek(detaySec());
        }

        /* Fikstürü bu açılışta çekilmemiş gün yazılmaz (yarım liste eski satırları silmesin) */
        const hazir = tumu.filter(gun => zaman.fikstur[gun] && zaman.fikstur[sonrakiGun(gun)]);
        hazirGunler = hazir;
        await takimYaz();
        /* Mesaj yazılabilen maçlar (yeni görülenler) */
        await mesaj.acikYaz(maclar.keys());
        for (const gun of hazir) gunYaz(gun);
        for (const gun of hazir) if (gun <= bugun) await ozetYaz(gun);

        /* Oranlar (günde 2 kez): bugün ve sonraki 7 günün fikstürü hazırsa. Beklenmez, arka planda sürer */
        const ileri = tumu.slice(1);
        if (ileri.every(gun => hazir.includes(gun)))
            oran.kontrol(maclar, ileri, bugun);

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
    mesaj.dinle();
    bildirim.hizliDinle(canliSaatte, hizliDegisti);
    elleDinle();
    tur();
}

module.exports = { tur, maclar };
