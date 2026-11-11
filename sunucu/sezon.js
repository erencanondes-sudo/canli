/*
 * SEZONLAR: depodaki sezonlar.txt'de yazan liglerin sezon maçları R2'ye kaydedilir (sunucu/VERITABANI.md → "Sezonlar").
 * Dosya yalnızca sunucu açılırken okunur (satır ekleyince: git pull + sunucuyu yeniden başlat).
 *
 *   R2 sezon/{lig}-{yıl}.json : sezonun bütün maçları { "maç no": "gün,lig,hafta,ev,dep,saat,durum,ev gol,dep gol" }
 *                               (gün: maçın günü, gün listesindeki gibi; geri kalanı canlı skor satırı)
 *   R2 mac/{no}.json          : oynanmış maçların içeriği (canlı maçlardaki gibi)
 *   R2 sezon/durum.json       : her sezonun durumu (sen bakarsın)
 *   R2 sezon/takimlar.json    : takım dizini { takım no: ["lig-yıl", ...] } hangi takım hangi sezon dosyalarında (takım sayfası için)
 *   R2 sezon/ic/{lig}-{yıl}.json : içeriği yazılmış maçların numaraları (sunucu yeniden açılınca kaldığı yerden sürsün diye)
 *
 * Her turda en fazla SEZON_TUR_ISTEK istek (API hakkı azaldıysa hiç): önce sezonun maç listesi (1 istek), sonra
 * oynanmış maçların içeriği 20'şerli gruplar halinde. Bitmiş sezon (ya da bitiş yılı geçmişte kalan) bir kez doldurulur ("tamam").
 * Sezonlar dosyadaki sırayla işlenir: yeni satırlar sona eklenirse güncel sezonların günlük işi beklemez.
 * Devam eden sezonun listesi günde bir yenilenir; yeni biten maçların içeriği de çekilir. Maç bitince (index.js)
 * satırı sezon dosyasında hemen güncellenir.
 */

const fs = require('fs');
const path = require('path');
const A = require('./ayarlar');
const api = require('./api');
const B = require('./bicim');
const depo = require('./depo');

const BITTI = new Set(['FT', 'AET', 'PEN']);
const OYNANMAYACAK = new Set(['PST', 'CANC', 'ABD', 'AWD', 'WO']);
const SAAT = '&timezone=' + A.SAAT_DILIMI;
const GUN = 864e5;

const gunAdi = ms => new Date(ms).toLocaleDateString('en-CA', { timeZone: A.SAAT_DILIMI });
const macGunu = ts => gunAdi(ts * 1000 - A.GUN_KAYMA * 3600000);

/* sezonlar.txt: "lig sezon açıklama" ("203 2026-2027 Süper Lig"); # ile başlayan satır açıklama */
function dosyaOku() {
    const liste = [];
    let metin = '';
    try {
        metin = fs.readFileSync(path.join(__dirname, '..', 'sezonlar.txt'), 'utf8');
    } catch (e) {
        return liste;
    }
    for (const satir of metin.split('\n')) {
        const m = /^\s*(\d+)\s+(\d{4})(?:-(\d{4}))?\s*(.*)$/.exec(satir);
        if (!m || satir.trim().startsWith('#')) continue;
        liste.push({ lig: Number(m[1]), yil: Number(m[2]), sezon: m[2] + (m[3] ? '-' + m[3] : ''), ad: m[4].trim() });
    }
    return liste;
}

const sezonlar = new Map();   /* "lig-yıl" → { lig, yil, sezon, ad, satirlar: { no: satır } | null, yazilan: Set | null, liste: son liste anı } */
const takimlar = new Map();   /* takım no → ad (sezon listelerinde görülen) */
let durum = null;             /* R2 sezon/durum.json */
let dizin = null;             /* R2 sezon/takimlar.json */
let hazir = null;

async function hazirla() {
    durum = await depo.oku('sezon/durum.json') || { sezonlar: {} };
    dizin = await depo.oku('sezon/takimlar.json') || {};
    for (const s of dosyaOku()) {
        const anahtar = s.lig + '-' + s.yil;
        sezonlar.set(anahtar, { ...s, satirlar: null, yazilan: null, liste: 0 });
        const d = durum.sezonlar[anahtar] || {};
        durum.sezonlar[anahtar] = { lig: s.lig, sezon: s.sezon, ad: s.ad, durum: d.durum || 'bekliyor', mac: d.mac || 0,
            biten: d.biten || 0, icerik_yazilan: d.icerik_yazilan || 0, icerigi_eksik: d.icerigi_eksik || 0,
            son_liste: d.son_liste || null, hata: null };
    }
    console.log('Sezonlar: ' + ([...sezonlar.values()].map(s => s.lig + ' ' + s.sezon).join(', ') || 'yok'));
}

function durumYaz() {
    durum.guncellendi = new Date().toISOString();
    depo.yaz('sezon/durum.json', JSON.stringify(durum, null, 1));
}

/* Maçın sezon dosyasındaki satırı */
const satirOf = f => macGunu(f.fixture.timestamp) + ',' + B.satir(f, false, null);

async function listeCek(s) {
    const liste = await api.istek('/fixtures?league=' + s.lig + '&season=' + s.yil + SAAT);
    s.satirlar = {};
    for (const f of liste) {
        s.satirlar[f.fixture.id] = satirOf(f);
        takimlar.set(f.teams.home.id, B.ad(f.teams.home.name));
        takimlar.set(f.teams.away.id, B.ad(f.teams.away.name));
    }
    s.liste = Date.now();
    dizinYaz(s.lig + '-' + s.yil, liste);
    s.biten = liste.filter(f => BITTI.has(f.fixture.status.short)).map(f => f.fixture.id);
    /* Bitmemiş (ertelenmiş, iptal hariç) maçı kalmayan sezon bitmiştir */
    s.devam = liste.some(f => !BITTI.has(f.fixture.status.short) && !OYNANMAYACAK.has(f.fixture.status.short));
    depo.yaz('sezon/' + s.lig + '-' + s.yil + '.json', JSON.stringify(s.satirlar));
}

/* Sezon listesindeki takımlar dizine eklenir (değiştiyse yazılır) */
function dizinYaz(anahtar, liste) {
    let degisti = false;
    for (const f of liste) {
        for (const no of [f.teams.home.id, f.teams.away.id]) {
            const kayit = dizin[no] || (dizin[no] = []);
            if (kayit.includes(anahtar)) continue;
            kayit.push(anahtar);
            degisti = true;
        }
    }
    if (degisti) depo.yaz('sezon/takimlar.json', JSON.stringify(dizin));
}

async function icerikCek(s, nolar) {
    const liste = await api.istek('/fixtures?ids=' + nolar.join('-') + SAAT);
    const d = durum.sezonlar[s.lig + '-' + s.yil];
    for (const f of liste) {
        const olay = B.olaylar(f);
        const icerik = B.macDokumani(f, olay || []);
        await depo.yukle('mac/' + f.fixture.id + '.json', JSON.stringify({ ...icerik, g: Date.now() }));
        s.yazilan.add(f.fixture.id);
        if (!icerik.istatistik && !icerik.kadro && !(olay && olay.length)) d.icerigi_eksik++;
    }
    /* API'nin vermediği maç da yazılmış sayılır (tekrar istenmesin) */
    nolar.forEach(no => s.yazilan.add(no));
    depo.yaz('sezon/ic/' + s.lig + '-' + s.yil + '.json', JSON.stringify([...s.yazilan]));
}

/* Sırası gelen sezonun bir sonraki işi; iş yaptıysa true */
async function sezonAdim(s) {
    const anahtar = s.lig + '-' + s.yil;
    const d = durum.sezonlar[anahtar];
    if (d.durum === 'tamam') return false;

    if (!s.yazilan) s.yazilan = new Set(await depo.oku('sezon/ic/' + anahtar + '.json') || []);

    if (!s.satirlar || Date.now() - s.liste >= GUN) {
        await listeCek(s);
        Object.assign(d, { mac: Object.keys(s.satirlar).length, biten: s.biten.length, son_liste: new Date().toISOString() });
        if (d.durum === 'bekliyor') d.durum = 'dolduruluyor';
        return true;
    }

    const eksik = s.biten.filter(no => !s.yazilan.has(no));
    if (eksik.length) {
        await icerikCek(s, eksik.slice(0, 20));
        d.icerik_yazilan = s.biten.filter(no => s.yazilan.has(no)).length;
        return true;
    }

    /* Bitiş yılı geçmişte kalan sezon (2000-2001, 2025...) API ne derse desin bitmiştir: bir daha güncellenmez */
    const eski = Number(s.sezon.slice(-4)) < new Date().getFullYear();
    const yeni = s.devam && !eski ? 'devam ediyor' : 'tamam';
    if (d.durum !== yeni) {
        d.durum = yeni;
        console.log('Sezon ' + anahtar + ': ' + yeni + ' (' + d.icerik_yazilan + ' maçın içeriği)');
        return true;
    }
    return false;
}

/* Her turda çağrılır (index.js): en fazla SEZON_TUR_ISTEK iş */
async function adim() {
    if (!hazir) hazir = hazirla().catch(e => { hazir = null; throw e; });
    await hazir;
    if (!sezonlar.size || api.yedekte()) return;

    let yapilan = 0;
    let degisti = false;
    for (const s of sezonlar.values()) {
        while (yapilan < A.SEZON_TUR_ISTEK) {
            try {
                if (!(await sezonAdim(s))) break;
                durum.sezonlar[s.lig + '-' + s.yil].hata = null;
            } catch (e) {
                durum.sezonlar[s.lig + '-' + s.yil].hata = e.message;
                yapilan = A.SEZON_TUR_ISTEK;
            }
            yapilan++;
            degisti = true;
        }
    }
    if (degisti) durumYaz();
}

/* Canlı maç bitince ya da durumu değişince (index.js): satırı sezon dosyasında güncellenir */
function macDegisti(f) {
    const s = sezonlar.get(f.league.id + '-' + f.league.season);
    if (!s || !s.satirlar) return;
    const satir = satirOf(f);
    if (s.satirlar[f.fixture.id] === satir) return;
    s.satirlar[f.fixture.id] = satir;
    if (BITTI.has(f.fixture.status.short) && !s.biten.includes(f.fixture.id)) s.biten.push(f.fixture.id);
    depo.yaz('sezon/' + s.lig + '-' + s.yil + '.json', JSON.stringify(s.satirlar));
}

/* Canlı maçın içeriği R2'ye yazıldıysa (index.js) sezon işi onu yeniden çekmez */
function icerikYazildi(no) {
    for (const s of sezonlar.values()) if (s.yazilan && s.satirlar && s.satirlar[no]) s.yazilan.add(no);
}

module.exports = { adim, macDegisti, icerikYazildi, takimlar };
