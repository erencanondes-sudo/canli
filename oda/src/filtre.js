/*
 * Küfür ve bağlantı filtresi: yorum ve rumuz (depodaki kufur.json; kok: bu harflerle başlayan kelime, kelime: tam kelime,
 * baglanti: metnin içinde geçerse, izin: yanlışlıkla yakalanan kelimeler).
 * Küçük harf, rakamla yazılmış harfler (0 → o, 1 → i...), harf dışı işaretler atılır, tekrar eden harf tek sayılır.
 */

import LISTE from '../../kufur.json';

const RAKAM = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's' };
const sadelestir = metin => String(metin || '').toLocaleLowerCase('tr')
    .replace(/[0134578@$]/g, ch => RAKAM[ch])
    .replace(/[^a-zçğıöşü\s]/g, '')
    .replace(/(.)\1+/g, '$1');

const KOK = LISTE.kok.map(sadelestir);
const KELIME = new Set(LISTE.kelime.map(sadelestir));
const IZIN = new Set(LISTE.izin.map(sadelestir));

export function uygunsuz(metin) {
    const ham = String(metin || '').toLocaleLowerCase('tr');
    if (LISTE.baglanti.some(b => ham.includes(b)))
        return true;
    return sadelestir(metin).split(/\s+/).some(k =>
        k && !IZIN.has(k) && (KELIME.has(k) || KOK.some(kok => k.startsWith(kok))));
}
