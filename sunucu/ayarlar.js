/* Sunucunun bütün ayarları. Değiştirmek için yalnızca bu dosyaya dokunulur. */

module.exports = {

    PROJE: 'canli-b4406',
    SAAT_DILIMI: 'Europe/Istanbul',

    /* Ligler. Sıra önemli: ana sayfa grupları bu sıraya göre dolar. */
    LIGLER: [
        { no: 135, ad: 'Serie A' },
        { no: 203, ad: 'Süper Lig' },
        { no: 204, ad: '1. Lig' },
        { no: 206, ad: 'Türkiye Kupası' }
    ],

    GRUP_BOYU: 50,                  /* ana sayfa dokümanı başına maç */

    /* Canlı skor yalnızca bu saatler arasında çekilir (Türkiye saati, gece yarısını geçebilir) */
    CANLI_SAAT: ['12:30', '01:00'],
    TUR_ARALIK: 8000,               /* canlı saatlerde: canlı skor ve yazma 8 sn */
    BEKLEME_ARALIK: 60000,          /* canlı saatler dışında: yalnızca fikstür ve maç sonları, 1 dk */
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
