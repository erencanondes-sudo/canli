/*
 * Odalara yazma (Cloudflare Durable Objects, klasör oda/). Yapı: sunucu/VERITABANI.md → "Odalar".
 * Anahtarlar /etc/canli/anahtar.env içinde: ODA_ADRES (canli-oda Worker'ının adresi), ODA_ANAHTAR (yazma anahtarı).
 *
 * gun(gün, alanlar): gün odasına { r, o, v } alanlarından verilenleri (her biri o günün tam hali) gönderir.
 *   Yalnızca son gönderilenden farklı olan alanlar gider; oda da kendi haliyle karşılaştırıp yalnızca değişen maçları telefonlara iletir.
 * mac(no, içerik): maç odasına içeriği gönderir (değiştiyse).
 * sil(yol): odayı boşaltır ("gun/2026-11-09", "mac/123").
 * Aynı oda için istekler sırayla gider; beklerken yenisi gelirse yalnızca en son hali gider.
 * Gönderilemezse o odanın "son gönderilen"i unutulur: bir sonraki yazmada alanların hepsi yeniden gider.
 * hizliSil(gün, nolar): maçların hızlı skorunu ve uyarısını gün odasından siler (hızlı kaynağın yazdığı h, u).
 * dinle(gün, mesajGeldi): gün odasına telefon gibi bağlanır (hızlı kaynağı öğrenmek için). Her bağlanışta oda her şeyi
 *   baştan gönderir ("l"), sonra değişiklikler ("d"). Kopunca 5 sn sonra yeniden bağlanır. Kapatma fonksiyonu döner.
 * acik(no): maç odasına "bu maça yorum yazılabilir" bilgisi (bir kez).
 * bildirimDinle(gonder): bildirim kuyruğu odasına bağlanır; gelen her yanıt bildirimi için gonder({ kisi, baslik, metin, link }),
 *   sonra alındığı odaya bildirilir (kuyruktan silinir). Kopunca 5 sn sonra yeniden bağlanır.
 */

const { ODA_ADRES, ODA_ANAHTAR } = process.env;
const SIL = Symbol('sil');

const son = new Map();       /* oda yolu → { alan: son gönderilen metin } */
const bekleyen = new Map();  /* oda yolu → { alan: değer } ya da SIL */
const gidiyor = new Set();
let sonHata = null;

/* yol: Worker'daki adres ("/yaz/gun/2026-11-09") */
async function istek(yol, yontem, govde) {
    if (!ODA_ADRES || !ODA_ANAHTAR)
        throw new Error('Oda anahtarları tanımlı değil (/etc/canli/anahtar.env)');
    const cevap = await fetch(ODA_ADRES.replace(/\/$/, '') + yol, {
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
    /* Boşaltma bekliyorsa önce o yapılır; bu yazma bir sonraki turda yeniden gelir */
    if (b === SIL) return;
    const yeni = b || {};
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
                await istek('/yaz/' + yol, 'DELETE');
                son.delete(yol);
            } else {
                await istek('/yaz/' + yol, 'POST', is);
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

async function hizliSil(gunAdi, nolar) {
    const bos = Object.fromEntries(nolar.map(no => [no, null]));
    try {
        await istek('/hizli/gun/' + gunAdi, 'POST', { h: bos, u: bos });
    } catch (e) {
        sonHata = e.message;
        console.error(e.message);
    }
}

/* Odaya WebSocket ile bağlanır; mesajGeldi(mesaj, ws) */
function dinle(gunAdi, mesajGeldi, yol = '/oda/gun/' + gunAdi) {
    let ws = null;
    let kapali = false;
    let bekleme = null;

    const baglan = () => {
        if (!ODA_ADRES) return;
        ws = new WebSocket(ODA_ADRES.replace(/\/$/, '').replace(/^http/, 'ws') + yol);
        ws.onmessage = olay => {
            try {
                mesajGeldi(JSON.parse(olay.data), ws);
            } catch (e) {
                console.error('Oda mesajı işlenemedi (' + yol + '): ' + e.message);
            }
        };
        ws.onclose = () => {
            if (!kapali) bekleme = setTimeout(baglan, 5000);
        };
        ws.onerror = () => {};
    };

    baglan();
    return () => {
        kapali = true;
        clearTimeout(bekleme);
        if (ws) ws.close();
    };
}

function bildirimDinle(gonder) {
    return dinle(null, (is, ws) => {
        if (is.t !== 'i') return;
        gonder(is);
        ws.send(JSON.stringify({ ack: is.id }));
    }, '/oda/bildirim?anahtar=' + encodeURIComponent(ODA_ANAHTAR || ''));
}

const gun = (gunAdi, alanlar) => yaz('gun/' + gunAdi, alanlar);
const mac = (no, icerik) => yaz('mac/' + no, { d: icerik });
const acik = no => yaz('mac/' + no, { acik: 1 });

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

module.exports = { gun, mac, acik, sil, unut, hizliSil, dinle, bildirimDinle, sonHata: () => sonHata };
