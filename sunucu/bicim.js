/*
 * API'den gelen veriyi Firestore'a yazılacak kısa biçime çevirir.
 * Biçimin açıklaması: VERITABANI.md
 */

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

/* Maç satırı: [no, lig, saat, durum, dakika, uzatma, ev, dep, ev gol, dep gol, ev İY, dep İY, olaylar] */
function satir(f, olay) {
    return [
        f.fixture.id,
        f.league.id,
        f.fixture.timestamp,
        f.fixture.status.short,
        f.fixture.status.elapsed,
        f.fixture.status.extra,
        f.teams.home.id,
        f.teams.away.id,
        f.goals.home,
        f.goals.away,
        f.score.halftime.home,
        f.score.halftime.away,
        olay
    ];
}

/* Canlı maçın ana sayfa grubundaki yer tutucusu: güncel hali canli/simdi'de */
function yerTutucu(f) {
    return [
        f.fixture.id, f.league.id, f.fixture.timestamp, 'CANLI', null, null,
        f.teams.home.id, f.teams.away.id, null, null, null, null, []
    ];
}

/* Maç dokümanı: istatistik ve kadro (metin olarak, iç içe dizi Firestore'da yazılamıyor) */
function macDokumani(f) {

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

    return {
        durum: f.fixture.status.short,
        istatistik: istatistik.some(Boolean) ? JSON.stringify(istatistik) : null,
        kadro: kadro.some(Boolean) ? JSON.stringify(kadro) : null
    };
}

module.exports = { olaylar, satir, yerTutucu, macDokumani, ad };
