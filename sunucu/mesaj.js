/*
 * MESAJLAR (maç sayfası, Yorumlar): sunucu/VERITABANI.md → "Mesajlar"
 * Site mesajı ve oyu kendisi yazar (kurallar denetler). Sunucunun işi:
 *   acik/{maç no}  : görülen her maç bir kez yazılır, silinmez (yalnızca bu maçlara mesaj yazılabilir)
 *   kuyruk/{...}   : yeni mesaj ve oylar. Her satır için mesaj küfür / bağlantı listesine göre kontrol edilir
 *                    (uygunsuzsa silinir), beğeni (b) ve beğenmeme (d) sayıları oy/'dan sayılıp yazılır, satır silinir.
 * Satırlar sırayla işlenir; API isteği harcamaz.
 */

const { rtdb } = require('./veritabani');
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
