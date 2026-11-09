/* Sunucunun bütün ayarları. Değiştirmek için yalnızca bu dosyaya dokunulur. */

module.exports = {

    PROJE: 'canli-b4406',
    RTDB_ADRES: 'https://canli-b4406-default-rtdb.firebaseio.com',   /* Realtime Database adresi */
    R2_KOVA: 'canli',               /* Cloudflare R2: gün listesi ve Özet dosyaları (anahtarlar /etc/canli/anahtar.env) */
    SITE_ADRES: 'https://erencanondes-sudo.github.io/canli/',   /* bildirime basınca açılan adres */
    SAAT_DILIMI: 'Europe/Istanbul',

    /* Ligler (sitedeki sırayla aynı) */
    LIGLER: [
        /* Millî maçlar */
        { no: 10, ad: 'Hazırlık Maçları' },
        { no: 1, ad: 'Dünya Kupası' },
        { no: 4, ad: 'Avrupa Şampiyonası' },
        { no: 5, ad: 'Uluslar Ligi' },
        { no: 32, ad: 'DK Elemeleri - Avrupa' },
        { no: 960, ad: 'Avrupa Şampiyonası Elemeleri' },
        { no: 6, ad: 'Afrika Uluslar Kupası' },
        { no: 7, ad: 'Asya Kupası' },
        { no: 9, ad: 'Copa América' },
        { no: 22, ad: 'Gold Cup' },
        { no: 29, ad: 'DK Elemeleri - Afrika' },
        { no: 30, ad: 'DK Elemeleri - Asya' },
        { no: 31, ad: 'DK Elemeleri - CONCACAF' },
        { no: 33, ad: 'DK Elemeleri - Okyanusya' },
        { no: 34, ad: 'DK Elemeleri - Güney Amerika' },
        { no: 37, ad: 'DK Elemeleri - Play-off' },
        /* Avrupa kupaları */
        { no: 2, ad: 'Şampiyonlar Ligi' },
        { no: 3, ad: 'Avrupa Ligi' },
        { no: 848, ad: 'Konferans Ligi' },
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
        { no: 283, ad: 'Liga I' },
        { no: 218, ad: 'Bundesliga' },
        { no: 244, ad: 'Veikkausliiga' },
        { no: 71, ad: 'Série A' },
        { no: 128, ad: 'Liga Profesional' },
        { no: 253, ad: 'MLS' },
        { no: 307, ad: 'Saudi Pro League' },
        { no: 305, ad: 'Stars League' },
        { no: 106, ad: 'Ekstraklasa' },
        { no: 286, ad: 'Super Liga' },
        { no: 333, ad: 'Premier League' },
        { no: 345, ad: 'Czech Liga' },
        { no: 188, ad: 'A-League' },
        { no: 332, ad: 'Super Liga' },
        { no: 169, ad: 'Super League' },
        { no: 419, ad: 'Premyer Liqa' },
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
        { no: 138, ad: 'Serie C - A' },
        { no: 942, ad: 'Serie C - B' },
        { no: 943, ad: 'Serie C - C' },
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
    CANLI_SAAT: ['12:30', '07:00'],
    GUN_KAYMA: 7,                   /* maçın günü = başlama saati − 7 saat (07:00'den önce başlayan önceki güne yazılır) */
    BUGUN_KAYMA: 4,                 /* "bugün" = şu an − 4 saat (gün 04:00'te değişir, sitede de aynı) */
    SABAH: [4, 7],                  /* 04:00–06:59 başlayan maç kendi takvim gününün listesine de yazılır */
    TUR_ARALIK: 20000,              /* canlı saatlerde: canlı skor ve yazma 20 sn */
    ODA_GUN_SAKLA: 4,               /* gün odaları dünden eskiyse boşaltılır; geriye bu kadar güne bakılır (R2'de kalır) */
    BEKLEME_ARALIK: 60000,          /* canlı saatler dışında: yalnızca fikstür ve maç sonları, 1 dk */
    DETAY_ARALIK: 2 * 60000,        /* canlı maç detayı: 2 dk */
    FIKSTUR_BUGUN: 30 * 60000,      /* bugünün ve yarının fikstürü: 30 dk */
    FIKSTUR_DIGER: 60 * 60000,      /* dün ve yarının fikstürü: 1 saat */
    ILERI_GUN: 7,                   /* bugünden sonra kaç günün fikstürü çekilir */
    FIKSTUR_ILERI: 6 * 3600000,     /* yarından sonraki günlerin fikstürü: 6 saat */
    KAPSAM_ARALIK: 24 * 3600000,    /* liglerin veri kapsamı: günde 1 */

    /* ORANLAR (maç öncesi, canlı değil) */
    ORAN_SAATLER: [6, 12],          /* oranlar bu saatlerde (Türkiye saati) güncellenir */
    ORAN_SIRKETLER: [8, 11],        /* oranları alınan 2 şirketin API numarası (sitede adları geçmez) */
    /* Türkiye oranlarına çevirirken eklenen pay: seçenek sayısına göre (2: alt/üst, 3: 1-X-2, çok: skor, İY/MS) */
    ORAN_PAY: { 2: 0.16, 3: 0.15, cok: 0.30 },

    KADRO_ONCESI: 3600,             /* maçtan bu kadar saniye önce kadro aranır */
    KADRO_ARALIK: 300,              /* kadro bu kadar saniyede bir aranır */
    DUZELTME_SONRA: 2 * 3600,       /* maç bitince bu kadar saniye sonra son kez çekilir */

    ISTEK_ARALIK: 400,              /* iki API isteği arası en az (ms) */
    YEDEK_HAK: 500,                 /* bu kadar hak kalınca yalnızca canlı skor ve maç sonları */
    SON_HAK: 30,                    /* bu kadar hak kalınca istek atılmaz; */
    KILIT_DENEME: 5 * 60000,        /* yalnızca bu aralıkla bir istek denenir (hak yenilenince devam edilir) */

    /* HIZLI KAYNAK: skoru API'den bu kadar süre farklı kalırsa kaydı silinir (site API skoruna döner) */
    HIZLI_FARK: 2 * 60000
};
