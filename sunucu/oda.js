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
 * mac(gün, no, içerik): maçın içeriğini gün odasına gönderir (değiştiyse; oda alan alan karşılaştırır).
 * oranlar(gün, { no: oranlar }): maçların oranlarını gün odasına gönderir (değişenler).
 * macHepsi(gün): gün odasındaki bütün maçların içeriği { maç no: içerik } (gün eskiyince R2'ye taşınır).
 * sil(yol): gün odasını boşaltır ("gun/2026-11-09").
 * Aynı oda için istekler sırayla gider; beklerken yenisi gelirse yalnızca en son hali gider.
 * Gönderilemezse o odanın "son gönderilen"i unutulur: bir sonraki yazmada alanların hepsi yeniden gider.
 * hizliSil(gün, nolar): maçların hızlı skorunu ve uyarısını gün odasından siler (hızlı kaynağın yazdığı h, u).
 * dinle(gün, mesajGeldi): gün odasına telefon gibi bağlanır (hızlı kaynağı öğrenmek için; anahtarla, ana odaya: kopya sınırına
 *   takılmaz). Her bağlanışta oda her şeyi
 *   baştan gönderir ("l"), sonra değişiklikler ("d"). Kopunca 5 sn sonra yeniden bağlanır. Kapatma fonksiyonu döner.
 * acik(no): mesaj odasına "bu maça yorum yazılabilir" bilgisi (bir kez).
 * bildirimDinle(isler): bildirim odasına bağlanır; gelen işler (abonelik "z", yanıt bildirimi "i") sırayla yapılır ve onaylanır
 *   (kuyruktan silinir; geçersiz cihaz anahtarları odaya bildirilir). Kopunca 5 sn sonra yeniden bağlanır.
 */

const { ODA_ADRES, ODA_ANAHTAR } = process.env;
const SIL = Symbol('sil');

const son = new Map();       /* oda yolu → { alan: son gönderilen metin } */
const ozetGiden = new Map(); /* gün odası yolu → Map(maç no → olayların JSON'u): gönderilen ya da gönderilmeyi bekleyen */
const ozetOnay = new Map();  /* gün odası yolu → { m: Map(maç no → olayların JSON'u), s, k, surum }: odanın aldığı */
const macGiden = new Map();  /* gün odası yolu → Map(maç no → içeriğin JSON'u): gönderilen ya da gönderilmeyi bekleyen */
const oranGiden = new Map(); /* gün odası yolu → Map(maç no → oranların JSON'u) */
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
        /* Maç içerikleri de birikir: maç başına { d?, oran? } ya da null (silindi) */
        if (alan === 'm') {
            yeni.m = yeni.m || {};
            for (const [no, x] of Object.entries(deger))
                yeni.m[no] = x === null || yeni.m[no] === null || !yeni.m[no] ? x : Object.assign(yeni.m[no], x);
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
                    if (alan !== 'o' && alan !== 'm') once[alan] = JSON.stringify(deger);
                son.set(yol, once);
                if (is.o) ozetOnaylandi(yol, is.o, cevap);
            }
            sonHata = null;
        } catch (e) {
            son.delete(yol);
            ozetGiden.delete(yol);
            macGiden.delete(yol);
            oranGiden.delete(yol);
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
function dinle(gunAdi, mesajGeldi, yol = '/oda/gun/' + gunAdi + '?anahtar=' + encodeURIComponent(ODA_ANAHTAR || '')) {
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

/*
 * Bildirim odasından gelen işler sırayla yapılır, her biri bitince onaylanır (onaylanmayan iş yeniden bağlanınca yeniden gelir).
 * isler: { z: (iş) => Promise, i: (iş) => Promise<geçersiz anahtarlar> }
 */
function bildirimDinle(isler) {
    let zincir = Promise.resolve();
    return dinle(null, (is, ws) => {
        if (!isler[is.t]) return;
        zincir = zincir.then(async () => {
            /* Ağ hatasında 3 kez denenir; olmazsa onaylanmaz, yeniden bağlanınca yeniden gelir */
            for (let deneme = 1; deneme <= 3; deneme++) {
                try {
                    const gecersiz = await isler[is.t](is);
                    for (const token of gecersiz || []) ws.send(JSON.stringify({ gecersiz: token }));
                    ws.send(JSON.stringify({ ack: is.id }));
                    return;
                } catch (e) {
                    if (deneme === 3) console.error('Bildirim işi yapılamadı (' + is.t + '): ' + e.message);
                    else await new Promise(r => setTimeout(r, 2000 * deneme));
                }
            }
        });
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
/* Maçın alanı (içerik ya da oran) son gönderilenden farklıysa gün odasına birikir */
function macAlani(harita, gunAdi, no, alan, deger) {
    const yol = 'gun/' + gunAdi;
    const giden = harita.get(yol) || new Map();
    const metin = JSON.stringify(deger);
    if (giden.get(String(no)) === metin) return;
    giden.set(String(no), metin);
    harita.set(yol, giden);
    yaz(yol, { m: { [no]: { [alan]: deger } } });
}

const mac = (gunAdi, no, icerik) => macAlani(macGiden, gunAdi, no, 'd', icerik);

function oranlar(gunAdi, liste) {
    for (const [no, o] of Object.entries(liste)) macAlani(oranGiden, gunAdi, no, 'oran', o);
}

const macHepsi = gunAdi => istek('/yaz/gun/' + gunAdi + '?tum=1', 'GET');
const acik = no => yaz('mac/' + no, { acik: 1 });

function sil(yol) {
    bekleyen.set(yol, SIL);
    if (!gidiyor.has(yol))
        bosalt(yol);
}

/* Takip edilmeyen maçların ve eski günlerin "son gönderilen"i hafızadan silinir */
function unut(gecerli) {
    for (const harita of [son, ozetGiden, ozetOnay, macGiden, oranGiden])
        for (const yol of harita.keys())
            if (!gecerli(yol)) harita.delete(yol);
}

module.exports = { gun, ozet, ozetHali, mac, oranlar, macHepsi, acik, sil, unut, hizliSil, dinle, bildirimDinle, sonHata: () => sonHata };
