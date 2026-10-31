/*
 * API'den gelen veriyi veritabanına yazılacak kısa biçime çevirir.
 * Biçimin açıklaması: VERITABANI.md
 */

const A = require('./ayarlar');

/* Adlardaki HTML kodlarını çevirir (O&apos;Nien → O'Nien) */
const KOD = { '&apos;': "'", '&#39;': "'", '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>' };
const ad = s => s ? String(s).replace(/&(apos|#39|quot|amp|lt|gt);/g, k => KOD[k]) : null;

const TUR = { Goal: 'g', Card: 'k', subst: 'd', Var: 'v' };

const AYRINTI = {
    'Normal Goal': 'n',
    'Own Goal': 'kk',
    'Penalty': 'p',
    'Missed Penalty': 'kp',
    'Yellow Card': 's',
    'Red Card': 'k',
    'Second Yellow card': 'sk'
};

/* Maç istatistiklerinin sırası (VERITABANI.md'deki tabloyla aynı) */
const ISTATISTIK = [
    'Shots on Goal', 'Shots off Goal', 'Total Shots', 'Blocked Shots',
    'Shots insidebox', 'Shots outsidebox', 'Fouls', 'Corner Kicks', 'Offsides',
    'Ball Possession', 'Yellow Cards', 'Red Cards', 'Goalkeeper Saves',
    'Total passes', 'Passes accurate', 'Passes %', 'expected_goals',
    'goals_prevented', 'Free Kicks'
];

/* "46%" → 46, "1.20" → 1.2, boş → null */
function sayi(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = parseFloat(String(v));
    return isNaN(n) ? null : n;
}

/* Olay: [dakika, uzatma, taraf, tür, ayrıntı, oyuncu, ikinci oyuncu] */
function olaylar(f) {
    const ev = f.teams.home.id;
    return (f.events || []).map(e => [
        e.time.elapsed,
        e.time.extra,
        e.team.id === ev ? 0 : e.team.id ? 1 : null,
        TUR[e.type] || e.type,
        e.type === 'subst' ? null : (AYRINTI[e.detail] || e.detail || null),
        ad(e.player.name),
        ad(e.assist.name)
    ]);
}

/* Olayın sonundaki boş alanlar yazılmaz: [3, null, 0, "g", "n", "A. Antunes", null] → [3, null, 0, "g", "n", "A. Antunes"] */
function kisaOlay(e) {
    const o = e.slice();
    while (o.length && o[o.length - 1] === null) o.pop();
    return o;
}

/* Kupa turlarının kısa kodu (sitede adı yazılır) */
const TUR_KODU = {
    'Final': 'F', 'Semi-finals': 'YF', 'Quarter-finals': 'CF',
    'Round of 16': 'S16', 'Round of 32': 'S32', 'Round of 64': 'S64',
    'Group Stage': 'G', 'Play-offs': 'PO'
};

/* Hafta: "Regular Season - 9" → 9; "3rd Round" → 3T; kupa turu → kısa kod; bilinmeyen olduğu gibi (virgülsüz) */
function hafta(r) {
    if (!r) return '';
    let m = /^Regular Season - (\d+)$/.exec(r);
    if (m) return m[1];
    m = /^(\d+)(st|nd|rd|th) Round$/.exec(r);
    if (m) return m[1] + 'T';
    return TUR_KODU[r] || String(r).replace(/,/g, ' ');
}

/* Türkiye saatiyle başlama saati: "2030" */
function saat(ts) {
    return new Date(ts * 1000)
        .toLocaleTimeString('en-GB', { timeZone: A.SAAT_DILIMI, hour: '2-digit', minute: '2-digit' })
        .replace(':', '');
}

/*
 * Durum: başlamadıysa boş; oynanıyorsa dakika ("67", "45+2"); diğerlerinde API'nin kodu (HT, FT, PST…)
 */
const DAKIKALI = new Set(['1H', '2H', 'ET']);

function durum(f) {
    const s = f.fixture.status;
    if (s.short === 'NS') return '';
    if (DAKIKALI.has(s.short) && s.elapsed) return s.elapsed + (s.extra ? '+' + s.extra : '');
    return s.short;
}

/* Canlı skor satırı (RTDB): "lig,hafta,ev,dep,saat,durum,ev gol,dep gol". Sondaki boşlar yazılmaz */
function satir(f) {
    const alan = [
        f.league.id,
        hafta(f.league.round),
        f.teams.home.id,
        f.teams.away.id,
        saat(f.fixture.timestamp),
        durum(f),
        f.goals.home === null ? '' : f.goals.home,
        f.goals.away === null ? '' : f.goals.away
    ].map(String);
    while (alan.length && alan[alan.length - 1] === '') alan.pop();
    return alan.join(',');
}

/*
 * Maç dokümanının içeriği: { durum, istatistik, kadro, olaylar } (tamamı gzip ile sıkıştırılıp yazılır).
 * olay verilirse (maç bitince) olaylar da yazılır; doküman tam olur.
 */
function macDokumani(f, olay) {

    const taraflar = [f.teams.home.id, f.teams.away.id];
    const taraf = (liste, id) => (liste || []).find(x => x.team.id === id);

    const istatistik = taraflar.map(id => {
        const t = taraf(f.statistics, id);
        if (!t) return null;
        const d = {};
        t.statistics.forEach(s => { d[s.type] = s.value; });
        return ISTATISTIK.map(k => sayi(d[k]));
    });

    const kadro = taraflar.map(id => {
        const t = taraf(f.lineups, id);
        if (!t) return null;
        return [
            t.formation || null,
            ad(t.coach && t.coach.name),
            t.startXI.map(p => [p.player.number, ad(p.player.name), p.player.pos, p.player.grid]),
            t.substitutes.map(p => [p.player.number, ad(p.player.name), p.player.pos])
        ];
    });

    const dokuman = {
        durum: f.fixture.status.short,
        istatistik: istatistik.some(Boolean) ? istatistik : null,
        kadro: kadro.some(Boolean) ? kadro : null
    };
    if (olay) dokuman.olaylar = olay.map(kisaOlay);
    return dokuman;
}

module.exports = { olaylar, kisaOlay, satir, macDokumani, ad };
