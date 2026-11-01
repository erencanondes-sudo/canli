/*
 * ORANLAR (maç öncesi, canlı değil): sunucu/VERITABANI.md → "Oranlar"
 *
 * Günde 2 kez (ORAN_SAATLER: 06 ve 12) bugün ve sonraki 7 günün başlamamış maçları için:
 *   API'den 2 şirketin oranları lig lig çekilir (sayfa sayfa).
 *   Her seçeneğin olasılığı şirket payı çıkarılarak bulunur, 2 şirketin ortalaması alınır.
 *   Türkiye oranlarına benzetmek için ORAN_PAY eklenip oran yeniden hesaplanır (tahmini).
 * Yazılanlar (Firestore, gzip ile sıkıştırılmış, değişmediyse yazılmaz):
 *   oran_mac/{maç no} : maçın bütün oranları (maç sayfası, Oranlar sekmesi)
 *   oran_gun/{gün}    : günün maçları, menüdeki 5 oran (Oranlar menüsü)
 *   oran_lig/{lig}    : ligin 8 günü, menüdeki 5 oran (Oranlar menüsü, lig seçilince)
 *   sistem/oran       : son güncelleme
 */

const A = require('./ayarlar');
const api = require('./api');
const db = require('./veritabani');

/* API'deki bahis adı → kod */
const BAHIS = {
    'match winner': 'ms',
    'first half winner': 'iy',
    'ht/ft double': 'iyms',
    'both teams score': 'kg',
    'goals over/under': 'au',
    'goals over/under first half': 'iau',
    'odd/even': 'tc',
    'handicap result': 'hnd',
    'exact score': 'skor',
    'corners over under': 'kor',
    'cards over/under': 'kart'
};

/* Ofsayt bahsinin adı şirkete göre değişebiliyor: maçın toplamı (takımın ya da yarının değil) */
function bahisKodu(ad) {
    const a = String(ad || '').toLowerCase().trim();
    if (BAHIS[a]) return BAHIS[a];
    if (/offside/.test(a) && !/home|away|team|half|1st|2nd|1x2|handicap/.test(a)) return 'ofs';
    return null;
}

/* Tanınmayan bahis adları kayda bir kez yazılır (yeni oran eklemek için) */
const bilinmeyen = new Set();
const bildirilen = new Set();

const UC = { Home: '1', Draw: 'X', Away: '2' };
const IYMS = ['1/1', '1/X', '1/2', 'X/1', 'X/X', 'X/2', '2/1', '2/X', '2/2'];

/* Bir şirketin bahisleri → grup → (seçenek → oran). Alt/üst grupları "au:2.5" gibi */
function sirketGruplari(bets) {
    const g = new Map();
    const ekle = (grup, secenek, odd) => {
        const o = parseFloat(odd);
        if (!(o > 1)) return;
        if (!g.has(grup)) g.set(grup, new Map());
        g.get(grup).set(secenek, o);
    };

    for (const b of bets || []) {
        const kod = bahisKodu(b.name);
        if (!kod) {
            bilinmeyen.add(b.name);
            continue;
        }
        for (const v of b.values || []) {
            const d = String(v.value).trim();
            let m;
            if (kod === 'ms' || kod === 'iy') {
                if (UC[d]) ekle(kod, UC[d], v.odd);
            } else if (kod === 'iyms') {
                m = /^(Home|Draw|Away)\/(Home|Draw|Away)$/.exec(d);
                if (m) ekle(kod, UC[m[1]] + '/' + UC[m[2]], v.odd);
            } else if (kod === 'kg') {
                if (d === 'Yes') ekle(kod, 'var', v.odd);
                if (d === 'No') ekle(kod, 'yok', v.odd);
            } else if (kod === 'tc') {
                if (d === 'Odd') ekle(kod, 'tek', v.odd);
                if (d === 'Even') ekle(kod, 'cift', v.odd);
            } else if (kod === 'skor') {
                m = /^(\d+):(\d+)$/.exec(d);
                if (m) ekle(kod, m[1] + '-' + m[2], v.odd);
            } else if (kod === 'hnd') {
                m = /^(Home|Draw|Away)\s*([+-]?\d+)$/.exec(d);
                if (m) ekle('hnd:' + Number(m[2]), UC[m[1]], v.odd);
            } else {
                /* Alt / üst: yalnızca buçuklu barajlar (beraberliği olmayanlar) */
                m = /^(Over|Under)\s*(\d+\.5)$/.exec(d);
                if (m) ekle(kod + ':' + m[2], m[1] === 'Over' ? 'u' : 'a', v.odd);
            }
        }
    }
    return g;
}

/* Bir grubun eksiksiz sayılması için gereken seçenek sayısı */
const TAM = { ms: 3, iy: 3, iyms: 9, kg: 2, tc: 2, hnd: 3, skor: 10 };
const gerekli = grup => TAM[grup.split(':')[0]] || 2;

/*
 * Şirketlerin oranlarından olasılık: her şirkette 1/oran'lar toplamı 1'e indirilir (şirket payı çıkar),
 * eksiksiz grubu olan şirketlerin ortalaması alınır.
 */
function olasiliklar(sirketler) {
    const sonuc = new Map();
    const gruplar = new Set();
    sirketler.forEach(g => g.forEach((_, grup) => gruplar.add(grup)));

    for (const grup of gruplar) {
        const adaylar = sirketler.map(g => g.get(grup)).filter(m => m && m.size >= gerekli(grup));
        if (!adaylar.length) continue;
        const en = Math.max(...adaylar.map(m => m.size));
        const secilen = adaylar.filter(m => m.size === en);
        const p = new Map();
        secilen.forEach(m => {
            let toplam = 0;
            m.forEach(o => { toplam += 1 / o; });
            m.forEach((o, s) => p.set(s, (p.get(s) || 0) + (1 / o) / toplam / secilen.length));
        });
        sonuc.set(grup, p);
    }
    return sonuc;
}

/* Olasılık → Türkiye'ye benzer oran (100 ile çarpılmış tam sayı: 1,85 → 185) */
function trOran(p, secenekSayisi) {
    const pay = secenekSayisi === 2 ? A.ORAN_PAY[2] : secenekSayisi === 3 ? A.ORAN_PAY[3] : A.ORAN_PAY.cok;
    return Math.min(10000, Math.max(101, Math.floor(100 / (p * (1 + pay)))));
}

/* Alt/üst barajları: üst olasılığı %50'ye en yakın olanlar önce */
function dengeli(P, kod) {
    const liste = [];
    P.forEach((p, grup) => {
        const [k, baraj] = grup.split(':');
        if (k === kod && p.has('a') && p.has('u')) liste.push([baraj, Math.abs(p.get('u') - 0.5)]);
    });
    return liste.sort((x, y) => x[1] - y[1]).map(x => x[0]);
}

/* Maçın bütün oranları (yoksa null). Biçim: VERITABANI.md → "Oranlar" */
function hesapla(sirketBahisleri) {
    const P = olasiliklar(sirketBahisleri.map(sirketGruplari));
    const o = {};

    const sira = (grup, secenekler) => {
        const p = P.get(grup);
        if (!p || !secenekler.every(s => p.has(s))) return null;
        return secenekler.map(s => trOran(p.get(s), secenekler.length));
    };
    const altUst = (kod, barajlar) => {
        const r = {};
        barajlar.forEach(b => {
            const v = sira(kod + ':' + b, ['a', 'u']);
            if (v) r[b] = v;
        });
        return Object.keys(r).length ? r : null;
    };
    const koy = (anahtar, deger) => { if (deger) o[anahtar] = deger; };

    koy('ms', sira('ms', ['1', 'X', '2']));
    if (o.ms) {
        const p = P.get('ms');
        o.cs = [['1', 'X'], ['1', '2'], ['X', '2']].map(([a, b]) => trOran(p.get(a) + p.get(b), 2));
    }
    koy('iy', sira('iy', ['1', 'X', '2']));
    koy('iyms', sira('iyms', IYMS));
    koy('kg', sira('kg', ['var', 'yok']));
    koy('au', altUst('au', ['0.5', '1.5', '2.5', '3.5', '4.5']));
    koy('iau', altUst('iau', ['0.5', '1.5']));
    koy('tc', sira('tc', ['tek', 'cift']));

    const hnd = {};
    ['-1', '1'].forEach(b => {
        const v = sira('hnd:' + b, ['1', 'X', '2']);
        if (v) hnd[b] = v;
    });
    if (Object.keys(hnd).length) o.hnd = hnd;

    /* Toplam gol aralığı (0-1, 2-3, 4-5, 6+): 1,5 / 3,5 / 5,5 alt olasılıklarından */
    const alt = b => (P.get('au:' + b) || new Map()).get('a');
    const [a15, a35, a55] = [alt('1.5'), alt('3.5'), alt('5.5')];
    if (a15 !== undefined && a35 !== undefined && a55 !== undefined) {
        const p = [a15, a35 - a15, a55 - a35, 1 - a55];
        if (p.every(x => x > 0)) o.tg = p.map(x => trOran(x, 4));
    }

    /* Skor: en olası 18 skor */
    const skor = P.get('skor');
    if (skor) {
        o.skor = {};
        [...skor].sort((x, y) => y[1] - x[1]).slice(0, 18).forEach(([s, p]) => { o.skor[s] = trOran(p, 'cok'); });
    }

    /* Korner, kart, ofsayt: dengeye en yakın 3 baraj */
    ['kor', 'kart', 'ofs'].forEach(kod => koy(kod, altUst(kod, dengeli(P, kod).slice(0, 3))));

    return { o: Object.keys(o).length ? o : null, P };
}

/*
 * Menüdeki 5 oran (14 sayı): 1, X, 2, 2,5 alt, 2,5 üst,
 * korner baraj×10, alt, üst, kart baraj×10, alt, üst, ofsayt baraj×10, alt, üst. Olmayan boş.
 */
function menuSatiri(o, P) {
    const s = [...(o.ms || ['', '', '']), ...((o.au || {})['2.5'] || ['', ''])];
    ['kor', 'kart', 'ofs'].forEach(kod => {
        const baraj = dengeli(P, kod)[0];
        const v = baraj && o[kod] && o[kod][baraj];
        s.push(...(v ? [Math.round(Number(baraj) * 10), v[0], v[1]] : ['', '', '']));
    });
    return s;
}

/* Türkiye saati "2000" (gün listesindeki gibi) */
const saatMetni = ts => new Date(ts * 1000).toLocaleTimeString('en-GB', { timeZone: A.SAAT_DILIMI, hour: '2-digit', minute: '2-digit' }).replace(':', '');

/* ---------- Zamanlama ---------- */

let calisiyor = false;
let sonZaman = null;      /* son başarılı güncelleme (ms); açılışta Firestore'dan okunur */
let sonDeneme = 0;        /* son deneme (hata olursa 30 dk beklenir) */
const yazilanMac = new Set();   /* bu açılışta yazılan oran_mac yolları */
const yazilanLig = new Set();   /* bu açılışta yazılan lig dokümanları */

/* En son geçilen oran saati (ms). Türkiye saati UTC+3 (yaz saati yok) */
function sonOranSaati() {
    const SAAT = 3600000;
    const tr = Date.now() + 3 * SAAT;
    const gunBasi = tr - tr % (24 * SAAT);
    const adaylar = [];
    A.ORAN_SAATLER.forEach(s => {
        adaylar.push(gunBasi + s * SAAT - 3 * SAAT);
        adaylar.push(gunBasi - 24 * SAAT + s * SAAT - 3 * SAAT);
    });
    return Math.max(...adaylar.filter(t => t <= Date.now()));
}

/*
 * Her turda çağrılır: son oran saatinden beri güncelleme yapılmadıysa (saati geldiyse ya da sunucu
 * o saatte kapalıydıysa) güncellemeyi başlatır. Beklenmez: istekler tek tek atıldığı için canlı skor arada sürer.
 * gunler: bugün ve sonraki 7 gün, bugun: bugünün adı.
 */
async function kontrol(maclar, gunler, bugun) {
    if (calisiyor || api.yedekte()) return;
    calisiyor = true;
    try {
        if (sonZaman === null) {
            const d = await db.oku('sistem/oran').catch(() => null);
            sonZaman = d && d.zaman ? Date.parse(d.zaman) : 0;
        }
        if (sonZaman >= sonOranSaati()) return;
        if (Date.now() - sonDeneme < 30 * 60000) return;
        sonDeneme = Date.now();
        await guncelle(maclar, gunler, bugun);
    } catch (e) {
        console.error('Oranlar güncellenemedi: ' + e.message);
    } finally {
        calisiyor = false;
    }
}

async function guncelle(maclar, gunler, bugun) {
    const basla = Date.now();
    const simdi = Math.floor(basla / 1000);
    let istek = 0;

    /* Oranı aranacak maçlar: bugün ve sonraki 7 gün, başlamamış */
    const hedef = new Map();
    const ligler = new Map();   /* lig → sezon */
    for (const [no, k] of maclar) {
        const d = k.f.fixture.status.short;
        if ((d !== 'NS' && d !== 'TBD') || k.f.fixture.timestamp <= simdi || !gunler.includes(k.gun)) continue;
        hedef.set(no, k);
        ligler.set(k.f.league.id, k.f.league.season);
    }

    /* Maç no → her şirketin bahisleri */
    const bahisler = new Map();
    const sirketSayisi = {};
    for (const [lig, sezon] of ligler) {
        for (const sirket of A.ORAN_SIRKETLER) {
            let sayfa = 1;
            let toplam = 1;
            do {
                if (api.yedekte()) throw new Error('istek hakkı azaldı');
                const r = await api.istek('/odds?league=' + lig + '&season=' + sezon + '&bookmaker=' + sirket + '&page=' + sayfa);
                istek++;
                toplam = r.sayfa && r.sayfa.total ? r.sayfa.total : 1;
                for (const kayit of r) {
                    const no = kayit.fixture && kayit.fixture.id;
                    if (!hedef.has(no)) continue;
                    for (const b of kayit.bookmakers || []) {
                        if (!bahisler.has(no)) bahisler.set(no, []);
                        bahisler.get(no).push(b.bets || []);
                        sirketSayisi[sirket] = (sirketSayisi[sirket] || 0) + 1;
                    }
                }
                sayfa++;
            } while (sayfa <= toplam);
        }
    }

    /* Hesap ve yazma */
    const gunSatir = new Map(gunler.map(g => [g, {}]));
    const ligSatir = new Map();
    const buTur = new Set();
    let yazilan = 0;
    let menude = 0;

    for (const [no, liste] of bahisler) {
        const k = hedef.get(no);
        const { o, P } = hesapla(liste);
        if (!o) continue;

        const yol = 'oran_mac/' + no;
        buTur.add(yol);
        yazilanMac.add(yol);
        if (await db.yazSikistir(yol, JSON.stringify(o))) yazilan++;

        const oranlar = menuSatiri(o, P);
        if (oranlar.every(x => x === '')) continue;
        menude++;

        const f = k.f;
        const lig = f.league.id;
        const bilgi = [lig, f.teams.home.id, f.teams.away.id, saatMetni(f.fixture.timestamp)];
        /* Bugünün maçlarının takım, lig ve saati sitede canlı skor listesinde var: yazılmaz */
        gunSatir.get(k.gun)[no] = (k.gun === bugun ? ['', '', '', ''] : bilgi).concat(oranlar).join(',');

        if (!ligSatir.has(lig)) ligSatir.set(lig, {});
        ligSatir.get(lig)[no] = [k.gun, ...bilgi.slice(1), ...oranlar].join(',');
    }

    for (const [gun, satirlar] of gunSatir) await db.yazSikistir('oran_gun/' + gun, JSON.stringify(satirlar));

    /* Bu turda maçı kalmayan lig boşaltılır */
    for (const lig of yazilanLig) if (!ligSatir.has(lig)) ligSatir.set(lig, {});
    for (const [lig, satirlar] of ligSatir) {
        await db.yazSikistir('oran_lig/' + lig, JSON.stringify(satirlar));
        if (Object.keys(satirlar).length) yazilanLig.add(lig);
        else yazilanLig.delete(lig);
    }

    /* Başlamış maçların oranı bir daha yazılmaz: hafızadan silinir */
    for (const yol of yazilanMac) {
        if (buTur.has(yol)) continue;
        yazilanMac.delete(yol);
        db.unut(yol);
    }

    sonZaman = Date.now();
    const sure = Math.round((sonZaman - basla) / 1000);
    await db.yaz('sistem/oran', {
        zaman: new Date(sonZaman).toISOString(),
        istek: istek,
        mac: bahisler.size,
        menude: menude,
        sure_sn: sure
    });

    console.log('Oranlar: ' + istek + ' istek, ' + sure + ' sn, ' + bahisler.size + ' maç (menüde ' + menude +
        '), yeni yazılan maç ' + yazilan + ', şirket başına maç ' + JSON.stringify(sirketSayisi));
    const yeni = [...bilinmeyen].filter(ad => !bildirilen.has(ad));
    if (yeni.length) {
        console.log('Oranlar: tanınmayan bahisler: ' + yeni.join(' | '));
        yeni.forEach(ad => bildirilen.add(ad));
    }
    bilinmeyen.clear();
}

module.exports = { kontrol, hesapla, menuSatiri };
