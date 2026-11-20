/*
 * Odalara yazma (Cloudflare Durable Objects, klasör oda/). Yapı: sunucu/VERITABANI.md → "Odalar".
 * Anahtarlar /etc/canli/anahtar.env içinde: ODA_ADRES (canli-oda Worker'ının adresi), ODA_ANAHTAR (yazma anahtarı).
 *
 * gun(gün, alanlar): gün odasına { r, v } alanlarından verilenleri (her biri o günün tam hali) gönderir.
 *   Yalnızca son gönderilenden farklı olan alanlar gider; oda da kendi haliyle karşılaştırıp yalnızca değişen maçları telefonlara iletir.
 * ozet(gün, tam): günün Özet'i ({ maç no: olaylar }, tam hali); gün odasına yalnızca değişen maçlar gider (oda saklamaz, iletir).
 *   Gönderilemezse bir sonraki çağrıda hepsi yeniden gider.
 * ozetHali(gün): odanın onayladığı Özet ve o andaki oda sırası: { metin: R2 dosyasının JSON'u { k, s, m }, surum } ya da null.
 *   surum her onayda artar (sunucu R2 dosyasını yalnızca değişince yazar).
 * mac(no, içerik): maç odasına içeriği gönderir (değiştiyse; oda alan alan karşılaştırır).
 * oran(no, oranlar): maçın oranlarını maç odasına yazar, gönderilene kadar bekler (değişmediyse gitmez; true: gitti).
 * oranUnut(no): maçın son gönderilen oranı hafızadan silinir (maç başladı, oranı bir daha yazılmaz).
 * oranOku(no): maç odasındaki oranlar (maç kesinleşince R2 dosyasına konur; yoksa {}).
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
const ozetGiden = new Map(); /* gün odası yolu → Map(maç no → olayların JSON'u): gönderilen ya da gönderilmeyi bekleyen */
const ozetOnay = new Map();  /* gün odası yolu → { m: Map(maç no → olayların JSON'u), s, k, surum }: odanın aldığı */
const oranSon = new Map();   /* maç no → son gönderilen oranların JSON'u */
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
    return yontem === 'DELETE' ? null : cevap.json().catch(() => ({}));
}

function yaz(yol, alanlar) {
    const once = son.get(yol) || {};
    const b = bekleyen.get(yol);
    /* Boşaltma bekliyorsa önce o yapılır; bu yazma bir sonraki turda yeniden gelir */
    if (b === SIL) return;
    const yeni = b || {};
    let var_ = false;

    for (const [alan, deger] of Object.entries(alanlar)) {
        /* Özet değişiklikleri birikir (yalnızca değişen maçlar; karşılaştırması ozet()'te) */
        if (alan === 'o') {
            yeni.o = Object.assign(yeni.o || {}, deger);
            var_ = true;
            continue;
        }
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
                const cevap = await istek('/yaz/' + yol, 'POST', is);
                const once = son.get(yol) || {};
                for (const [alan, deger] of Object.entries(is))
                    if (alan !== 'o') once[alan] = JSON.stringify(deger);
                son.set(yol, once);
                if (is.o) ozetOnaylandi(yol, is.o, cevap);
            }
            sonHata = null;
        } catch (e) {
            son.delete(yol);
            ozetGiden.delete(yol);
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

function ozet(gunAdi, tam) {
    const yol = 'gun/' + gunAdi;
    const giden = ozetGiden.get(yol) || new Map();
    const fark = {};
    for (const [no, olaylar] of Object.entries(tam)) {
        const metin = JSON.stringify(olaylar);
        if (giden.get(no) === metin) continue;
        giden.set(no, metin);
        fark[no] = olaylar;
    }
    for (const no of [...giden.keys()]) {
        if (no in tam) continue;
        giden.delete(no);
        fark[no] = null;
    }
    ozetGiden.set(yol, giden);
    if (Object.keys(fark).length) yaz(yol, { o: fark });
}

/* Oda Özet değişikliğini aldı: onaylanan hal ve odanın o andaki sırası (R2 dosyası bundan yazılır) */
function ozetOnaylandi(yol, fark, cevap) {
    const onay = ozetOnay.get(yol) || { m: new Map(), s: 0, k: null, surum: 0 };
    if (cevap.k !== onay.k) onay.m = new Map();
    for (const [no, olaylar] of Object.entries(fark)) {
        if (olaylar === null) onay.m.delete(no);
        else onay.m.set(no, JSON.stringify(olaylar));
    }
    onay.s = cevap.s;
    onay.k = cevap.k;
    onay.surum++;
    ozetOnay.set(yol, onay);
}

function ozetHali(gunAdi) {
    const onay = ozetOnay.get('gun/' + gunAdi);
    if (!onay || !onay.k) return null;
    const m = [...onay.m].map(([no, metin]) => JSON.stringify(no) + ':' + metin).join(',');
    return { metin: '{"k":' + JSON.stringify(onay.k) + ',"s":' + onay.s + ',"m":{' + m + '}}', surum: onay.surum };
}
const mac = (no, icerik) => yaz('mac/' + no, { d: icerik });

async function oran(no, oranlar) {
    const metin = JSON.stringify(oranlar);
    if (oranSon.get(no) === metin) return false;
    await istek('/yaz/mac/' + no, 'POST', { oran: oranlar });
    oranSon.set(no, metin);
    return true;
}

const oranUnut = no => oranSon.delete(no);
const oranOku = no => istek('/yaz/mac/' + no, 'GET');
const acik = no => yaz('mac/' + no, { acik: 1 });

function sil(yol) {
    bekleyen.set(yol, SIL);
    if (!gidiyor.has(yol))
        bosalt(yol);
}

/* Takip edilmeyen maçların ve eski günlerin "son gönderilen"i hafızadan silinir */
function unut(gecerli) {
    for (const harita of [son, ozetGiden, ozetOnay])
        for (const yol of harita.keys())
            if (!gecerli(yol)) harita.delete(yol);
}

module.exports = { gun, ozet, ozetHali, mac, oran, oranUnut, oranOku, acik, sil, unut, hizliSil, dinle, bildirimDinle, sonHata: () => sonHata };
