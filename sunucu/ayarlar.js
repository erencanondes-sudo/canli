/* Sunucunun bütün ayarları. Değiştirmek için yalnızca bu dosyaya dokunulur. */

module.exports = {

    PROJE: 'canli-b4406',
    RTDB_ADRES: 'https://canli-b4406-default-rtdb.firebaseio.com',   /* Realtime Database adresi */
    SITE_ADRES: 'https://erencanondes-sudo.github.io/canli/',   /* bildirime basınca açılan adres */
    SAAT_DILIMI: 'Europe/Istanbul',

    /* Ligler (sitedeki sırayla aynı) */
    LIGLER: [
        /* 1. ligler */
        { no: 140, ad: 'La Liga' },
        { no: 203, ad: 'Süper Lig' },
        { no: 39, ad: 'Premier League' },
        { no: 61, ad: 'Ligue 1' },
        { no: 135, ad: 'Serie A' },
        { no: 78, ad: 'Bundesliga' },
        { no: 88, ad: 'Eredivisie' },
        { no: 144, ad: 'Pro League' },
        { no: 197, ad: 'Super League' },
        { no: 179, ad: 'Premiership' },
        { no: 207, ad: 'Super League' },
        { no: 119, ad: 'Superliga' },
        { no: 103, ad: 'Eliteserien' },
        { no: 113, ad: 'Allsvenskan' },
        /* 2. ligler */
        { no: 141, ad: 'Segunda División' },
        { no: 204, ad: '1. Lig' },
        { no: 40, ad: 'Championship' },
        { no: 62, ad: 'Ligue 2' },
        { no: 136, ad: 'Serie B' },
        { no: 79, ad: '2. Bundesliga' },
        { no: 89, ad: 'Eerste Divisie' },
        { no: 145, ad: 'Challenger Pro League' },
        { no: 494, ad: 'Super League 2' },
        { no: 180, ad: 'Championship' },
        { no: 208, ad: 'Challenge League' },
        { no: 120, ad: '1. Division' },
        { no: 104, ad: 'OBOS-ligaen' },
        { no: 114, ad: 'Superettan' },
        /* 3. ligler */
        { no: 435, ad: 'Primera RFEF 1' },
        { no: 436, ad: 'Primera RFEF 2' },
        { no: 205, ad: '2. Lig' },
        { no: 41, ad: 'League One' },
        { no: 42, ad: 'League Two' },
        { no: 63, ad: 'National' },
        { no: 138, ad: 'Serie C' },
        { no: 80, ad: '3. Liga' },
        /* Kupalar */
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
        { no: 529, ad: 'Almanya Süper Kupası' },
        { no: 90, ad: 'Hollanda Kupası' },
        { no: 543, ad: 'Hollanda Süper Kupası' },
        { no: 147, ad: 'Belçika Kupası' },
        { no: 519, ad: 'Belçika Süper Kupası' },
        { no: 199, ad: 'Yunanistan Kupası' },
        { no: 181, ad: 'İskoçya Kupası' },
        { no: 185, ad: 'İskoçya Lig Kupası' },
        { no: 209, ad: 'İsviçre Kupası' },
        { no: 121, ad: 'Danimarka Kupası' },
        { no: 105, ad: 'Norveç Kupası' },
        { no: 115, ad: 'İsveç Kupası' }
    ],

    /* Canlı skor yalnızca bu saatler arasında çekilir (Türkiye saati, gece yarısını geçebilir) */
    CANLI_SAAT: ['12:30', '01:00'],
    TUR_ARALIK: 15000,              /* canlı saatlerde: canlı skor ve yazma 15 sn */
    OZET_ARALIK: 15000,             /* Özet dokümanı en fazla 15 sn'de bir yazılır */
    GUN_ARALIK: 10 * 60000,         /* Firestore gün dokümanı en fazla 10 dk'da bir yazılır */
    B1_SURE: 21 * 60,               /* biten maç RTDB'de bu kadar saniye daha "c" ile (dinlenir) kalır */
    RTDB_GUN_SAKLA: 2,              /* RTDB'deki günler bu kadar gün sonra silinir (Firestore'da kalır) */
    BEKLEME_ARALIK: 60000,          /* canlı saatler dışında: yalnızca fikstür ve maç sonları, 1 dk */
    DETAY_ARALIK: 60000,            /* canlı maç detayı: 1 dk */
    FIKSTUR_BUGUN: 15 * 60000,      /* bugünün fikstürü: 15 dk */
    FIKSTUR_DIGER: 60 * 60000,      /* dün ve yarının fikstürü: 1 saat */
    ILERI_GUN: 7,                   /* bugünden sonra kaç günün fikstürü çekilir */
    FIKSTUR_ILERI: 6 * 3600000,     /* yarından sonraki günlerin fikstürü: 6 saat */
    TAKIM_EK_SURE: 30 * 86400,      /* takım ekleri (takim_ek) bu kadar saniye saklanır */
    KAPSAM_ARALIK: 24 * 3600000,    /* liglerin veri kapsamı: günde 1 */

    KADRO_ONCESI: 3600,             /* maçtan bu kadar saniye önce kadro aranır */
    KADRO_ARALIK: 300,              /* kadro bu kadar saniyede bir aranır */
    DUZELTME_SONRA: 2 * 3600,       /* maç bitince bu kadar saniye sonra son kez çekilir */

    ISTEK_ARALIK: 400,              /* iki API isteği arası en az (ms) */
    YEDEK_HAK: 500,                 /* bu kadar hak kalınca yalnızca canlı skor ve maç sonları */
    SON_HAK: 30                     /* bu kadar hak kalınca hiç istek atılmaz */
};
