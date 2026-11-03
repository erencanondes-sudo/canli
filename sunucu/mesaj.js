/*
 * MESAJLAR (maç sayfası, Yorumlar): sunucu/VERITABANI.md → "Mesajlar"
 * Site mesajı ve oyu kendisi yazar (kurallar denetler). Sunucunun işi:
 *   acik/{maç no}  : görülen her maç bir kez yazılır, silinmez (yalnızca bu maçlara mesaj yazılabilir)
 *   kuyruk/{...}   : yeni mesaj ve oylar. Her satır için mesaj küfür / bağlantı listesine göre kontrol edilir
 *                    (uygunsuzsa silinir), beğeni (b) ve beğenmeme (d) sayıları oy/'dan sayılıp yazılır, satır silinir.
 *   Yeni mesajda @rumuz (en fazla 2) geçiyorsa o kişilere bildirim gider; gitmez: kendine, yanıt bildirimlerini
 *   kapatana (kullanici/{kimlik}/b), göndereni engelleyene ya da göndericinin engellediğine (engel, iki yönlü),
 *   yanıtlanan mesajı için bildirimi kapatana
 *   (sessiz), aynı gönderenden 10 dakika içinde ikinci kez. Bildirim kişinin giriş yaptığı bütün cihazlarına gider.
 * Satırlar sırayla işlenir; API isteği harcamaz.
 */

const { rtdb } = require('./veritabani');
const A = require('./ayarlar');
const bildirim = require('./bildirim');
const LISTE = require('../kufur.json');

/* Küçük harf, rakamla yazılmış harfler (0 → o, 1 → i...), harf dışı işaretler atılır, tekrar eden harf tek */
const RAKAM = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's' };
const sadelestir = metin => String(metin || '').toLocaleLowerCase('tr')
    .replace(/[0134578@$]/g, ch => RAKAM[ch])
    .replace(/[^a-zçğıöşü\s]/g, '')
    .replace(/(.)\1+/g, '$1');

const KOK = LISTE.kok.map(sadelestir);
const KELIME = new Set(LISTE.kelime.map(sadelestir));
const IZIN = new Set(LISTE.izin.map(sadelestir));

/* Site de aynı kuralı kullanır (index.html → uygunsuz) */
function uygunsuz(metin) {
    const ham = String(metin || '').toLocaleLowerCase('tr');
    if (LISTE.baglanti.some(b => ham.includes(b))) return true;
    return sadelestir(metin).split(/\s+/).some(k =>
        k && !IZIN.has(k) && (KELIME.has(k) || KOK.some(kok => k.startsWith(kok))));
}

/* ---------- Açık maçlar ---------- */

const acikYazildi = new Set();

async function acikYaz(nolar) {
    const yeni = {};
    for (const no of nolar) {
        if (acikYazildi.has(no)) continue;
        yeni['acik/' + no] = 1;
    }
    const anahtarlar = Object.keys(yeni);
    if (!anahtarlar.length) return;
    await rtdb.ref().update(yeni);
    anahtarlar.forEach(a => acikYazildi.add(Number(a.slice(5))));
}

/* ---------- @rumuz bildirimi ---------- */

const RUMUZ = /@([A-Za-z0-9_çğıöşüÇĞİÖŞÜ]{3,15})/g;
const bildirildi = new Set();     /* bildirimi yapılmış mesajlar ("maç/mesaj") */
const sonBildirim = new Map();    /* "gönderen>alan" → son bildirim anı */
const YENI = 10 * 60000;          /* yalnızca 10 dakikadan yeni mesajlar (kuyruk oylarla da dolar) */

async function rumuzBildir(m, i, v) {
    const anahtar = m + '/' + i;
    if (bildirildi.has(anahtar) || !v.z || Date.now() - v.z > YENI) return;
    bildirildi.add(anahtar);

    const adlar = [...new Set([...String(v.t || '').matchAll(RUMUZ)].map(x => x[1].toLowerCase()))].slice(0, 2);
    for (const ad of adlar) {
        const kime = (await rtdb.ref('rumuz/' + ad).get()).val();
        if (!kime || kime === v.u) continue;

        const cift = v.u + '>' + kime;
        if (Date.now() - (sonBildirim.get(cift) || 0) < 10 * 60000) continue;

        const [kapali, engel, engel2, sessiz] = await Promise.all([
            rtdb.ref('kullanici/' + kime + '/b').get(),
            rtdb.ref('engel/' + kime + '/' + v.u).get(),
            rtdb.ref('engel/' + v.u + '/' + kime).get(),
            GUVENLI.test(v.y || '') ? rtdb.ref('sessiz/' + kime + '/' + m + '_' + v.y).get() : Promise.resolve(null)
        ]);
        if (kapali.val() === true || engel.exists() || engel2.exists() || (sessiz && sessiz.exists())) continue;

        if (bildirim.kisiyeGonder(kime, v.r + ' sana yazdı', v.t, A.SITE_ADRES + '#mac=' + m + '&yorum'))
            sonBildirim.set(cift, Date.now());
    }
    if (bildirildi.size > 5000) bildirildi.clear();
}

/* ---------- Kuyruk ---------- */

let sira = Promise.resolve();
const GUVENLI = /^[A-Za-z0-9_-]+$/;

async function isle(snap) {
    const { m, i } = snap.val() || {};
    if (GUVENLI.test(m || '') && GUVENLI.test(i || '')) {
        const yol = 'mesaj/' + m + '/' + i;
        const mesaj = await rtdb.ref(yol).get();
        if (mesaj.exists()) {
            const v = mesaj.val();
            if (uygunsuz(v.t) || uygunsuz(v.r)) {
                await rtdb.ref().update({ [yol]: null, ['mesajlarim/' + v.u + '/' + m + '/' + i]: null });
                console.log('Mesaj silindi (uygunsuz): ' + m + '/' + i);
            } else {
                let b = 0;
                let d = 0;
                (await rtdb.ref('oy/' + m + '/' + i).get()).forEach(c => {
                    const oy = c.child('v').val();
                    if (oy === 1) b++;
                    if (oy === -1) d++;
                });
                if ((v.b || 0) !== b || (v.d || 0) !== d)
                    await rtdb.ref(yol).update({ b: b || null, d: d || null });
                await rumuzBildir(m, i, v);
            }
        }
    }
    await snap.ref.remove();
}

function dinle() {
    rtdb.ref('kuyruk').on('child_added', snap => {
        sira = sira.then(() => isle(snap)).catch(e => console.error('Mesaj kuyruğu: ' + e.message));
    });
}

module.exports = { dinle, acikYaz, uygunsuz };
