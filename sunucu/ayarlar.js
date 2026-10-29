/* Sunucunun bütün ayarları. Değiştirmek için yalnızca bu dosyaya dokunulur. */

module.exports = {

    PROJE: 'canli-b4406',
    RTDB_ADRES: 'https://canli-b4406-default-rtdb.firebaseio.com',   /* Realtime Database adresi */
    SITE_ADRES: 'https://erencanondes-sudo.github.io/canli/',   /* bildirime basınca açılan adres */
    SAAT_DILIMI: 'Europe/Istanbul',

    /* Ligler (sitedeki sırayla aynı) */
    LIGLER: [
        { no: 140, ad: 'La Liga' },
        { no: 203, ad: 'Süper Lig' },
        { no: 39, ad: 'Premier League' },
        { no: 61, ad: 'Ligue 1' },
        { no: 135, ad: 'Serie A' },
        { no: 78, ad: 'Bundesliga' },
        { no: 141, ad: 'Segunda División' },
        { no: 204, ad: '1. Lig' },
        { no: 40, ad: 'Championship' },
        { no: 62, ad: 'Ligue 2' },
        { no: 136, ad: 'Serie B' },
        { no: 79, ad: '2. Bundesliga' },
        { no: 143, ad: 'Kral Kupası' },
        { no: 556, ad: 'İspanya Süper Kupası' },
        { no: 206, ad: 'Türkiye Kupası' },
        { no: 551, ad: 'Türkiye Süper Kupası' },
        { no: 45, ad: 'FA Cup' },
        { no: 48, ad: 'EFL Cup' },
        { no: 528, ad: 'Community Shield' },
        { no: 66, ad: 'Fransa Kupası' },
        { no: 526, ad: 'Fransa Süper Kupası' },
        { no: 137, ad: 'İtalya Kupası' },
        { no: 547, ad: 'İtalya Süper Kupası' },
        { no: 81, ad: 'DFB Pokal' },
        { no: 529, ad: 'Almanya Süper Kupası' }
    ],

    /* Canlı skor yalnızca bu saatler arasında çekilir (Türkiye saati, gece yarısını geçebilir) */
    CANLI_SAAT: ['12:30', '01:00'],
    TUR_ARALIK: 8000,               /* canlı saatlerde: canlı skor ve yazma 8 sn */
    OZET_ARALIK: 15000,             /* Özet dokümanı en fazla 15 sn'de bir yazılır */
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
