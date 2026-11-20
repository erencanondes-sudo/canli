/*
 * ESPN (ikinci kaynak): yalnızca ayarlar.js → ESPN_LIGLER'deki liglerde. Yapı: sunucu/VERITABANI.md → "ESPN".
 *
 * Çekme (index.js her turda tur() çağırır):
 *   Liste: ESPN'i gereken maçı (canlı, birazdan başlayacak, yeni bitmiş) olan ligler, lig başına 1 istek (scoreboard).
 *   Ayrıntı: eşleşen ve gereken maç başına DETAY_ARALIK'ta bir 1 istek (summary): istatistik ve olaylar.
 *   ESPN'in maçı bizim maça bağlanır: aynı lig, başlama saati en fazla 15 dk farklı, iki takım adı da benzer.
 *
 * Birleştirme (uygula): API'nin verisi her geldiğinde ve ESPN'in verisi her geldiğinde maçın gösterilen hali yeniden kurulur.
 *   Skor, kırmızı kart: iki kaynaktan büyük olan (geç gelen kaynak geri götürmez). Bir kaynak kendi verdiğini düşürürse
 *     (VAR iptali) düşüş kabul edilir: öbür kaynağın düşüşten önceki değere kadar olan değerleri yok sayılır (geç gelen kaynak
 *     iptal edilen golü yeniden getirmesin); düşüren kaynak o değere yeniden ulaşınca (yeni gol) yok sayma kalkar.
 *   Durum ve dakika: ESPN (ESPN SESSIZ süre gelmezse API).
 *   Olaylar: gol, kart, kaçan penaltı ESPN'den; API aynı olayı verince oyuncu adı, asist ve ikinci sarıdan kırmızı API'den.
 *     API'nin ESPN'de karşılığı olmayan golü / kartı OLAY_BEKLE kadar beklenir, sonra skor / kırmızı sayısı izin veriyorsa eklenir.
 *     Değişiklik ve VAR olayları API'den.
 *   İstatistik: sayılar (şut, korner, faul, pas...) iki kaynaktan büyük olan; topla oynama ESPN (tazeyse); isabetsiz şut ve
 *     pas isabeti bunlardan hesaplanır; ESPN'de olmayanlar (ceza sahası içi / dışı şut, xG, önlenen gol, serbest vuruş) API.
 * Elle düzeltme kilidi olan maçta ESPN kullanılmaz.
 */

const A = require('./ayarlar');

const ADRES = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
const SESSIZ = 5 * 60000;          /* ESPN bu kadar süre gelmezse durum, dakika ve topla oynama API'den */
const OLAY_BEKLE = 2 * 60000;      /* API'nin ESPN'de karşılığı olmayan golü / kartı bu kadar beklenir */
const SAAT_PAYI = 15 * 60;         /* eşleştirmede başlama saati farkı (sn) */

const LIG_KODU = new Map(A.ESPN_LIGLER.map(l => [l.no, l.kod]));

const hal = new Map();      /* maç no → { id, kod, ev, zaman, durum, olaylar, ist, detay } (ESPN'in son verisi) */
const espnNo = new Map();   /* ESPN maç no → bizim maç no (null: eşleşmedi, günlüğe bir kez yazıldı) */
let sonHataZamani = 0;

const ligde = k => LIG_KODU.has(k.f.league.id);

async function al(yol) {
    const cevap = await fetch(ADRES + yol, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    if (!cevap.ok) throw new Error('ESPN ' + cevap.status + ' (' + yol + ')');
    return cevap.json();
}

function hataYaz(e) {
    if (Date.now() - sonHataZamani < 60000) return;
    sonHataZamani = Date.now();
    console.error('ESPN: ' + e.message);
}

/* ---------- Eşleştirme ---------- */

const GENEL = new Set(['club', 'football', 'futbol', 'spor', 'kulubu']);

/* "Çaykur Rizespor" → ["caykur", "rizespor"] */
function kelimeler(ad) {
    return String(ad || '').toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 2 && !GENEL.has(w));
}

/* İki adın ortak kelime sayısı (biri öbürüyle başlıyorsa da sayılır: "erzurum" / "erzurumspor") */
function benzerlik(a, b) {
    const kb = kelimeler(b);
    return kelimeler(a).filter(x => kb.some(y => x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x))))).length;
}

function eslestir(e, ligNo, maclar) {
    if (espnNo.has(e.id)) return espnNo.get(e.id);
    const c = (e.competitions || [])[0] || {};
    const taraf = Object.fromEntries((c.competitors || []).map(x => [x.homeAway, (x.team || {}).displayName || '']));
    const ts = Date.parse(e.date) / 1000;
    let enIyi = null;
    let puan = 0;
    for (const [no, k] of maclar) {
        if (k.f.league.id !== ligNo || Math.abs(k.f.fixture.timestamp - ts) > SAAT_PAYI) continue;
        const ev = benzerlik(taraf.home, k.f.teams.home.name);
        const dep = benzerlik(taraf.away, k.f.teams.away.name);
        if (ev && dep && ev + dep > puan) {
            enIyi = no;
            puan = ev + dep;
        }
    }
    if (enIyi === null) console.log('ESPN: eşleşmeyen maç ' + e.id + ' ' + e.name + ' (' + e.date + ')');
    espnNo.set(e.id, enIyi);
    return enIyi;
}

/* ---------- ESPN verisini bizim biçime çevirme ---------- */

/* Durum: { short, elapsed, extra }; başlamamış ya da oynanmayacak maçta null (API'ninki kalır) */
function durum(st) {
    const t = (st || {}).type || {};
    const ad = t.name || '';
    let short = null;
    if (t.state === 'in')
        short = /HALFTIME/.test(ad) ? 'HT' : st.period >= 5 || /SHOOTOUT/.test(ad) ? 'P' : st.period >= 3 ? 'ET' : st.period === 2 ? '2H' : '1H';
    else if (t.state === 'post' && t.completed)
        short = /PEN|SHOOTOUT/.test(ad) ? 'PEN' : /AET|EXTRA/.test(ad) ? 'AET' : 'FT';
    if (!short) return null;
    const m = /(\d+)'(?:\s*\+\s*(\d+))?/.exec(st.displayClock || '');
    return { short, elapsed: m ? Number(m[1]) : null, extra: m && m[2] ? Number(m[2]) : null };
}

/* Olay: [dakika, uzatma, taraf, tür, ayrıntı, oyuncu, ikinci oyuncu] (yalnızca gol, kart, kaçan penaltı; değişiklik API'den) */
function olay(o, evNo, adlar) {
    const tur = ((o.type || {}).text || '');
    const [t, a] = /own goal/i.test(tur) ? ['g', 'kk'] : /penalty - scored/i.test(tur) ? ['g', 'p'] :
        /penalty - missed/i.test(tur) ? ['g', 'kp'] : /^goal/i.test(tur) ? ['g', 'n'] :
        /yellow card/i.test(tur) ? ['k', 's'] : /red card/i.test(tur) ? ['k', 'k'] : [null, null];
    if (!t) return null;
    const m = /(\d+)'(?:\s*\+\s*(\d+))?/.exec((o.clock || {}).displayValue || '');
    const takim = String((o.team || {}).id || '');
    let taraf = takim ? (takim === evNo ? 0 : 1) : null;
    const parantez = /\(([^)]+)\)/.exec(o.text || '');
    if (taraf === null && parantez) taraf = parantez[1] === adlar[0] ? 0 : parantez[1] === adlar[1] ? 1 : null;
    const oyuncu = (((o.participants || [])[0] || {}).athlete || {}).displayName || (/^(.+?) \(/.exec(o.text || '') || [])[1] || null;
    return [m ? Number(m[1]) : null, m && m[2] ? Number(m[2]) : null, taraf, t, a, oyuncu, null];
}

/* ---------- Çekme ---------- */

/*
 * gerekenler: ESPN'i gereken bizim maçlar [[no, k], ...] (index.js seçer). degisti(no): maçın ESPN verisi değişti.
 * Liste her çağrıda; ayrıntı maç başına DETAY_ARALIK'ta bir.
 */
async function tur(gerekenler, maclar, degisti) {
    const ligler = new Set(gerekenler.filter(([, k]) => ligde(k)).map(([, k]) => k.f.league.id));
    const istenen = new Set(gerekenler.map(([no]) => no));
    const simdi = Date.now();

    for (const ligNo of ligler) {
        const kod = LIG_KODU.get(ligNo);
        let v;
        try {
            v = await al(kod + '/scoreboard');
        } catch (e) {
            hataYaz(e);
            continue;
        }
        for (const e of v.events || []) {
            const no = eslestir(e, ligNo, maclar);
            if (no === null || !istenen.has(no)) continue;
            const c = (e.competitions || [])[0] || {};
            const ev = (c.competitors || []).find(x => x.homeAway === 'home') || {};
            const dep = (c.competitors || []).find(x => x.homeAway === 'away') || {};
            const h = hal.get(no) || { id: e.id, kod, olaylar: null, ist: null, detay: 0 };
            h.ev = String((ev.team || {}).id || '');
            h.adlar = [(ev.team || {}).displayName, (dep.team || {}).displayName];
            h.durum = durum(e.status);
            h.gol = h.durum ? [Number(ev.score), Number(dep.score)] : null;
            h.zaman = simdi;
            hal.set(no, h);

            if (h.durum && simdi - h.detay >= A.DETAY_ARALIK) {
                h.detay = simdi;
                try {
                    const s = await al(kod + '/summary?event=' + e.id);
                    const takimlar = (s.boxscore || {}).teams || [];
                    const ist = side => Object.fromEntries(((takimlar.find(t => t.homeAway === side) || {}).statistics || [])
                        .map(x => [x.name, x.displayValue]));
                    h.ist = takimlar.length ? [ist('home'), ist('away')] : null;
                    h.olaylar = (s.keyEvents || []).map(o => olay(o, h.ev, h.adlar)).filter(Boolean);
                } catch (err) {
                    hataYaz(err);
                }
            }
            degisti(no);
        }
    }
}

/* ---------- Birleştirme ---------- */

/* sinir: kaynağın bu değere kadar olan değerleri yok sayılır (öbür kaynak düşürdü) */
const yeniSayac = () => ({ api: [null, null], espn: [null, null], sinir: { api: [null, null], espn: [null, null] } });

function sayacYaz(s, kaynak, degerler) {
    const diger = kaynak === 'api' ? 'espn' : 'api';
    [0, 1].forEach(t => {
        const v = degerler ? degerler[t] : null;
        if (v === null || v === undefined || isNaN(v)) return;
        const once = s[kaynak][t];
        if (once !== null && v < once) s.sinir[diger][t] = Math.max(once, s.sinir[diger][t] || 0);
        if (s.sinir[diger][t] !== null && v >= s.sinir[diger][t]) s.sinir[diger][t] = null;
        s[kaynak][t] = v;
    });
}

function sayacDeger(s) {
    return [0, 1].map(t => {
        const gecerli = ['api', 'espn'].map(k => s[k][t] !== null && (s.sinir[k][t] === null || s[k][t] > s.sinir[k][t]) ? s[k][t] : null)
            .filter(v => v !== null);
        if (gecerli.length) return Math.max(...gecerli);
        /* İkisi de yok sayılıyorsa (çok nadir) düşüren kaynağınki */
        const kalan = ['api', 'espn'].map(k => s[k][t]).filter(v => v !== null);
        return kalan.length ? Math.min(...kalan) : null;
    });
}

const kirmiziSay = olaylar => {
    const sayi = [0, 0];
    (olaylar || []).forEach(e => {
        if (e[3] === 'k' && (e[4] === 'k' || e[4] === 'sk') && (e[2] === 0 || e[2] === 1)) sayi[e[2]]++;
    });
    return sayi;
};
const golSay = (olaylar, taraf) => olaylar.filter(e => e[3] === 'g' && e[4] !== 'kp' && e[2] === taraf).length;
const dakika = e => (e[0] || 0) + (e[1] || 0) / 100;
const turu = e => e[3] === 'g' ? (e[4] === 'kp' ? 'kp' : 'g') : e[4] === 's' ? 's' : 'k';

function olaylarBirlestir(k, h, gol, kirmizi) {
    const api = k.apiOlaylar || [];
    const sonuc = h.olaylar.map(e => e.slice());
    const espnSayisi = sonuc.length;
    const kullanildi = new Set();
    const simdi = Date.now();
    if (!k.apiGorulme) k.apiGorulme = new Map();

    for (const a of api) {
        if (a[3] !== 'g' && a[3] !== 'k') {
            sonuc.push(a);
            continue;
        }
        const i = sonuc.findIndex((e, j) => j < espnSayisi && !kullanildi.has(j) && e[2] === a[2] && turu(e) === turu(a) &&
            Math.abs(dakika(e) - dakika(a)) <= 3);
        if (i >= 0) {
            kullanildi.add(i);
            sonuc[i][5] = a[5] || sonuc[i][5];
            sonuc[i][6] = a[6];
            if (a[4] === 'sk') sonuc[i][4] = 'sk';
            continue;
        }
        const anahtar = JSON.stringify(a);
        if (!k.apiGorulme.has(anahtar)) k.apiGorulme.set(anahtar, simdi);
        if (simdi - k.apiGorulme.get(anahtar) < OLAY_BEKLE) continue;
        if (turu(a) === 'g' && golSay(sonuc, a[2]) >= (gol[a[2]] || 0)) continue;
        if (turu(a) === 'k' && kirmiziSay(sonuc)[a[2]] >= (kirmizi[a[2]] || 0)) continue;
        sonuc.push(a);
    }
    return sonuc.sort((x, y) => dakika(x) - dakika(y));
}

/*
 * API'nin verisi geldi (index.js kaydet): API'nin skorunu ve kırmızı kartlarını kaydeder (birleştirmeden önce çağrılır).
 */
function apiAl(k) {
    if (!ligde(k)) return;
    if (!k.sayac) k.sayac = { gol: yeniSayac(), kirmizi: yeniSayac() };
    const g = k.f.goals;
    sayacYaz(k.sayac.gol, 'api', [g.home, g.away]);
    if (k.apiOlaylar) sayacYaz(k.sayac.kirmizi, 'api', kirmiziSay(k.apiOlaylar));
}

/*
 * Maçın gösterilen halini kurar: k.f (skor, durum, dakika), k.olaylar, k.kirmizi. kilitli: elle düzeltme kilidi (ESPN kullanılmaz).
 * k.olaylar'ı API'nin olaylarından (k.apiOlaylar) kurar; ESPN verisi yoksa olduğu gibi bırakır.
 */
function uygula(k, kilitli) {
    const h = hal.get(k.f.fixture.id);
    k.kirmizi = null;
    if (!h || kilitli || !k.sayac) return;

    if (h.gol) sayacYaz(k.sayac.gol, 'espn', h.gol);
    if (h.olaylar) sayacYaz(k.sayac.kirmizi, 'espn', kirmiziSay(h.olaylar));
    const gol = sayacDeger(k.sayac.gol);
    if (gol[0] !== null) k.f.goals = { home: gol[0], away: gol[1] };
    k.kirmizi = sayacDeger(k.sayac.kirmizi).map(v => v || 0);

    if (h.durum && Date.now() - h.zaman < SESSIZ)
        k.f.fixture.status = { ...k.f.fixture.status, ...h.durum };

    if (h.olaylar) k.olaylar = olaylarBirlestir(k, h, gol, k.kirmizi);
}

/* İstatistik sırası: sunucu/VERITABANI.md → "İstatistik sırası". ESPN'in karşılığı olan sayılar */
const ESPN_SAYI = { 0: 'shotsOnTarget', 2: 'totalShots', 3: 'blockedShots', 6: 'foulsCommitted', 7: 'wonCorners', 8: 'offsides',
    10: 'yellowCards', 11: 'redCards', 12: 'saves', 13: 'totalPasses', 14: 'accuratePasses' };

/* Maç içeriğinin istatistiği: API'ninki (yoksa null) ESPN'inkiyle birleşir */
function istatistik(k, api) {
    const h = hal.get(k.f.fixture.id);
    if (!h || !h.ist) return api;
    const taze = Date.now() - h.zaman < SESSIZ;
    const sonuc = [0, 1].map(t => {
        const satir = api && api[t] ? api[t].slice() : Array(19).fill(null);
        const e = h.ist[t];
        const sayi = ad => {
            const n = parseFloat(e[ad]);
            return isNaN(n) ? null : n;
        };
        for (const [i, ad] of Object.entries(ESPN_SAYI)) {
            const v = sayi(ad);
            if (v !== null) satir[i] = satir[i] === null ? v : Math.max(satir[i], v);
        }
        if (taze && sayi('possessionPct') !== null) satir[9] = Math.round(sayi('possessionPct'));
        if (satir[2] !== null && satir[0] !== null) satir[1] = Math.max(0, satir[2] - satir[0] - (satir[3] || 0));
        if (satir[13]) satir[15] = Math.round(satir[14] / satir[13] * 100);
        return satir;
    });
    return sonuc;
}

/* Takip edilmeyen maçların ESPN verisi hafızadan silinir */
function unut(gecerli) {
    for (const no of hal.keys()) if (!gecerli(no)) hal.delete(no);
    for (const [e, no] of espnNo) if (no !== null && !gecerli(no)) espnNo.delete(e);
}

module.exports = { ligde, tur, apiAl, uygula, istatistik, unut };
