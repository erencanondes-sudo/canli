/*
 * PUAN DURUMU: takip edilen ligler (ayarlar.js → LIGLER) için API-Football'un puan durumu, R2 puan/{lig}.json.
 * Kupalarda (lig türü Cup) ayrıca eleme turlarının eşleşmeleri. Yapı: sunucu/VERITABANI.md → "Puan durumu".
 *
 *   Dosya: { g: yazma anı (ms), sezon, cevap: API'nin puan durumu cevabı olduğu gibi (kullanılmayan alanlar da durur; kupada boş olabilir),
 *            eslesme?: [[maç no, tur kodu, başlama (sn), ev, dep, ev gol, dep gol, durum, ev penaltı, dep penaltı], ...],
 *            t?: { takım no: ad } (eşleşmelerdeki takımlar),
 *            son5: { takım no: [[rakip, iç saha 1 / deplasman 0, attığı, yediği, başlama (sn)], ...] } (bitmiş son 5 maç, en yeni sonda) }
 *   Sezonun maç listesi (1 istek) her çekişte: son 5 maç; kupada ayrıca lig / grup aşaması dışındaki turlar (eşleşmeler).
 *   Ne zaman çekilir: ligde bir maç bitince PUAN_BEKLE sonra (art arda bitenler tek istek), ayrıca günde bir.
 *     Sunucu açılınca dosyanın yazma anına bakılır (günlük çekiş yeniden başlamasın diye).
 *   Puan durumu ve eşleşmesi olmayan turnuvada dosya yazılmaz, günde bir yeniden denenir.
 *   Her turda en fazla PUAN_TUR_ISTEK istek; API hakkı azaldıysa hiç.
 */

const A = require('./ayarlar');
const api = require('./api');
const B = require('./bicim');
const depo = require('./depo');

const GUN = 24 * 3600000;

const ligler = new Map();   /* lig no → { sezon, son: son çekiş (ms), zaman: çekilecek an (ms), okundu: dosyaya bakıldı } */

/* Ligde maç bitti: puan durumu PUAN_BEKLE sonra çekilir */
function macBitti(lig, sezon) {
    const l = ligler.get(lig) || { sezon, son: 0, zaman: 0, okundu: false };
    l.sezon = sezon;
    const zaman = Date.now() + A.PUAN_BEKLE;
    if (!l.zaman || l.zaman > zaman || l.zaman <= l.son) l.zaman = zaman;
    ligler.set(lig, l);
}

/* Kupanın eleme turları (lig / grup aşaması ve ön elemeler dışında) */
const ELEME_DISI = /Regular Season|League Stage|Group|Qualifying|Preliminary/i;

const BITTI = new Set(['FT', 'AET', 'PEN']);

/* Takımların bitmiş son 5 maçı (en yeni sonda) */
function sonBes(maclar) {
    const son5 = {};
    maclar.filter(f => BITTI.has(f.fixture.status.short) && f.goals.home !== null)
        .sort((a, b) => a.fixture.timestamp - b.fixture.timestamp)
        .forEach(f => {
            const ev = f.teams.home.id;
            const dep = f.teams.away.id;
            (son5[ev] = son5[ev] || []).push([dep, 1, f.goals.home, f.goals.away, f.fixture.timestamp]);
            (son5[dep] = son5[dep] || []).push([ev, 0, f.goals.away, f.goals.home, f.fixture.timestamp]);
        });
    for (const no of Object.keys(son5)) son5[no] = son5[no].slice(-5);
    return son5;
}

function eslesmeler(maclar) {
    const t = {};
    const eslesme = maclar.filter(f => !ELEME_DISI.test(f.league.round || '')).map(f => {
        t[f.teams.home.id] = B.ad(f.teams.home.name);
        t[f.teams.away.id] = B.ad(f.teams.away.name);
        const pen = (f.score && f.score.penalty) || {};
        return [f.fixture.id, B.hafta(f.league.round), f.fixture.timestamp, f.teams.home.id, f.teams.away.id,
            f.goals.home, f.goals.away, f.fixture.status.short, pen.home ?? null, pen.away ?? null];
    }).sort((a, b) => a[2] - b[2]);
    return { eslesme, t };
}

/*
 * Her turda (index.js): gorulen = Map(lig no → { sezon, kupa }), takip edilen maçlardan. Sırası gelen ligler çekilir
 * (lig başına 2 istek: puan durumu ve sezonun maç listesi).
 */
async function adim(gorulen) {
    if (api.yedekte()) return;
    const simdi = Date.now();

    for (const [lig, { sezon, kupa }] of gorulen) {
        if (!ligler.has(lig)) ligler.set(lig, { sezon, son: 0, zaman: 0, okundu: false });
        Object.assign(ligler.get(lig), { sezon, kupa });
    }

    let yapilan = 0;
    let okunan = 0;
    for (const [lig, l] of ligler) {
        if (yapilan >= A.PUAN_TUR_ISTEK) break;

        /* İlk kez: dosya varsa ne zaman yazıldığına bakılır (turda en fazla 10 dosya; gerisi sonraki turlarda) */
        if (!l.okundu) {
            if (okunan >= 10) continue;
            okunan++;
            l.okundu = true;
            try {
                const eski = await depo.oku('puan/' + lig + '.json');
                if (eski && eski.sezon === l.sezon) l.son = eski.g || 0;
            } catch (e) {}
        }

        const gunluk = simdi - l.son >= GUN;
        const bekleyen = l.zaman && l.zaman <= simdi && l.zaman > l.son;
        if (!gunluk && !bekleyen) continue;

        yapilan += 2;
        l.son = simdi;
        try {
            const dosya = { g: simdi, sezon: l.sezon, cevap: await api.istek('/standings?league=' + lig + '&season=' + l.sezon) || [] };
            const maclar = await api.istek('/fixtures?league=' + lig + '&season=' + l.sezon + '&timezone=' + A.SAAT_DILIMI) || [];
            dosya.son5 = sonBes(maclar);
            if (l.kupa) Object.assign(dosya, eslesmeler(maclar));
            if (dosya.cevap.length || (dosya.eslesme && dosya.eslesme.length))
                depo.yaz('puan/' + lig + '.json', JSON.stringify(dosya));
        } catch (e) {
            console.error('Puan durumu alınamadı (' + lig + '): ' + e.message);
        }
    }
}

module.exports = { macBitti, adim };
