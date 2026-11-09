/*
 * Odalara yazma (Cloudflare Durable Objects, klasör oda/). Yapı: sunucu/VERITABANI.md → "Odalar".
 * Anahtarlar /etc/canli/anahtar.env içinde: ODA_ADRES (canli-oda Worker'ının adresi), ODA_ANAHTAR (yazma anahtarı).
 *
 * gun(gün, alanlar): gün odasına { r, o, h, u } alanlarından verilenleri (her biri o günün tam hali) gönderir.
 *   Yalnızca son gönderilenden farklı olan alanlar gider; oda da kendi haliyle karşılaştırıp yalnızca değişen maçları telefonlara iletir.
 * mac(no, içerik): maç odasına içeriği gönderir (değiştiyse).
 * sil(yol): odayı boşaltır ("gun/2026-11-09", "mac/123").
 * Aynı oda için istekler sırayla gider; beklerken yenisi gelirse yalnızca en son hali gider.
 * Gönderilemezse o odanın "son gönderilen"i unutulur: bir sonraki yazmada alanların hepsi yeniden gider.
 */

const { ODA_ADRES, ODA_ANAHTAR } = process.env;
const SIL = Symbol('sil');

const son = new Map();       /* oda yolu → { alan: son gönderilen metin } */
const bekleyen = new Map();  /* oda yolu → { alan: değer } ya da SIL */
const gidiyor = new Set();
let sonHata = null;

async function istek(yol, yontem, govde) {
    if (!ODA_ADRES || !ODA_ANAHTAR)
        throw new Error('Oda anahtarları tanımlı değil (/etc/canli/anahtar.env)');
    const cevap = await fetch(ODA_ADRES.replace(/\/$/, '') + '/yaz/' + yol, {
        method: yontem,
        headers: { authorization: 'Bearer ' + ODA_ANAHTAR, 'content-type': 'application/json' },
        body: govde === undefined ? undefined : JSON.stringify(govde),
        signal: AbortSignal.timeout(15000)
    });
    if (!cevap.ok)
        throw new Error('Oda yazılamadı (' + yol + '): ' + cevap.status + ' ' + (await cevap.text()).slice(0, 200));
}

function yaz(yol, alanlar) {
    const once = son.get(yol) || {};
    const b = bekleyen.get(yol);
    const yeni = b && b !== SIL ? b : {};
    let var_ = false;

    for (const [alan, deger] of Object.entries(alanlar)) {
        if (!(alan in yeni) && once[alan] === JSON.stringify(deger))
            continue;
        yeni[alan] = deger;
        var_ = true;
    }
    if (!var_)
        return;
    bekleyen.set(yol, yeni);
    if (!gidiyor.has(yol))
        bosalt(yol);
}

async function bosalt(yol) {
    gidiyor.add(yol);
    while (bekleyen.has(yol)) {
        const is = bekleyen.get(yol);
        bekleyen.delete(yol);
        try {
            if (is === SIL) {
                await istek(yol, 'DELETE');
                son.delete(yol);
            } else {
                await istek(yol, 'POST', is);
                const once = son.get(yol) || {};
                for (const [alan, deger] of Object.entries(is))
                    once[alan] = JSON.stringify(deger);
                son.set(yol, once);
            }
            sonHata = null;
        } catch (e) {
            son.delete(yol);
            sonHata = e.message;
            console.error(e.message);
        }
    }
    gidiyor.delete(yol);
}

const gun = (gunAdi, alanlar) => yaz('gun/' + gunAdi, alanlar);
const mac = (no, icerik) => yaz('mac/' + no, { d: icerik });

function sil(yol) {
    bekleyen.set(yol, SIL);
    if (!gidiyor.has(yol))
        bosalt(yol);
}

/* Takip edilmeyen maçların ve eski günlerin "son gönderilen"i hafızadan silinir */
function unut(gecerli) {
    for (const yol of son.keys())
        if (!gecerli(yol)) son.delete(yol);
}

module.exports = { gun, mac, sil, unut, sonHata: () => sonHata };
