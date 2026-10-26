/* Sunucunun bütün ayarları. Değiştirmek için yalnızca bu dosyaya dokunulur. */

module.exports = {

    PROJE: 'canli-b4406',
    SAAT_DILIMI: 'Europe/Istanbul',

    /* Ligler. Sıra önemli: ana sayfa grupları bu sıraya göre dolar. */
    LIGLER: [
        { no: 203, ad: 'Süper Lig' },
        { no: 204, ad: '1. Lig' },
        { no: 206, ad: 'Türkiye Kupası' }
    ],

    GRUP_BOYU: 50,                  /* ana sayfa dokümanı başına maç */

    TUR_ARALIK: 15000,              /* canlı skor ve yazma: 15 sn (aşağıdaki saatlerin dışında) */

    /* Belli saatlerde daha sık (Türkiye saati): [başlangıç, bitiş, aralık] */
    HIZLI_SAATLER: [
        ['19:00', '21:00', 5000],
        ['21:30', '23:30', 3000]
    ],
    DETAY_ARALIK: 60000,            /* canlı maç detayı: 1 dk */
    FIKSTUR_BUGUN: 15 * 60000,      /* bugünün fikstürü: 15 dk */
    FIKSTUR_DIGER: 60 * 60000,      /* dün ve yarının fikstürü: 1 saat */
    KAPSAM_ARALIK: 24 * 3600000,    /* liglerin veri kapsamı: günde 1 */

    KADRO_ONCESI: 3600,             /* maçtan bu kadar saniye önce kadro aranır */
    KADRO_ARALIK: 300,              /* kadro bu kadar saniyede bir aranır */
    DUZELTME_SONRA: 2 * 3600,       /* maç bitince bu kadar saniye sonra son kez çekilir */

    ISTEK_ARALIK: 400,              /* iki API isteği arası en az (ms) */
    YEDEK_HAK: 500,                 /* bu kadar hak kalınca yalnızca canlı skor ve maç sonları */
    SON_HAK: 30                     /* bu kadar hak kalınca hiç istek atılmaz */
};
