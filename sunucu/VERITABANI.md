# Veritabanı

Odalar, bir dosya deposu ve veritabanları var:

- **Odalar (Cloudflare Durable Objects, `oda/` klasörü, Worker adı `canli-oda`):** canlı veri. Gün odası (günün listesi, hızlı kaynak; Özet değişikliklerini iletir) ve maç odası (maçın içeriği, oranları, yorumları). Telefon odaya açık bir hatla (WebSocket) bağlanır; oda değişenleri kendisi gönderir. Ayrıntı: aşağıda "Odalar".
- **Cloudflare R2 (kova `canli`):** günün maç listesi, Özet (gzip ile sıkıştırılmış) ve kesinleşmiş maçların içeriği, JSON dosyası olarak (arşiv, silinmez). Sunucu yazar (anahtarlar `/etc/canli/anahtar.env`: `R2_ADRES`, `R2_KIMLIK`, `R2_GIZLI`); site Cloudflare Pages'teki okuyucudan (`functions/veri`, kovaya `DEPO` adıyla bağlı) `/veri/gun/{gün}.json`, `/veri/ozet/{gün}.json`, `/veri/mac/{no}.json`, `/veri/takim.json`, `/veri/lig.json`, `/veri/sezon/…` olarak okur. Okuyucu bugün, dün ve ilerideki günlerin listesini ve takım adlarını önbelleğe aldırmaz (her açılışta en son hali), bugün ve dünün Özet'ini 30 sn, daha eski günleri, maç dosyalarını ve lig bilgisini 1 saat tutturur. Süresi olan dosyalar Cloudflare önbelleğinde de tutulur (domainde; her merkezde süresi boyunca R2'den bir kez okunur). Sıkıştırılmış Özet dosyasını açıp gönderir (Cloudflare tarayıcıya giderken kendisi sıkıştırır).
- **Cloudflare D1 (veritabanı `canli`):** kullanıcı bilgileri (rumuz, engellenenler, sayaç, şikayetler; aşağıda "Mesajlar").
- **Realtime Database:** artık kullanılmıyor (kuralları her şeyi kapatır).
- **Firestore:** menü oranları, analizler, bildirim kayıtları, sunucu durumu; yönetim sayfasının elle düzeltme kilitleri ve istekleri.

Dokümanları ve odaları sunucu yazar; `zil/{gizli kimlik}` kayıtlarını site (kullanıcının cihazı), gün odasındaki hızlı skoru ve uyarıyı (`h`, `u`) hızlı kaynak (başka bir bilgisayardaki skor sunucusu, kendi anahtarıyla) yazar. Bir şey değişmediyse yeniden yazılmaz.
Firestore dokümanlarında `guncellendi` alanı son yazma zamanıdır. Büyük dokümanlar (menü oranları, analizler) gzip ile sıkıştırılmış `z` alanında durur; Console'da okunamaz, site açar.

| Yer | Ne var | Kim yazar | Kim okur | Ne zaman değişir | Boyut |
|---|---|---|---|---|---|
| Gün odası `gun/{gün}` | Günün maçlarının satırları (`r`, tek satır), canlı maçlarda hızlı kaynağın skoru (`h`) ve uyarısı (`u`); Özet değişikliklerini (`o`) saklamadan iletir. Ayrıntı: "Odalar" | Sunucu | Canlı Skor: bugün ve dün (bağlanınca liste, sonra değişenler) | Skor, dakika, durum, olay, hızlı skor değişince | satır ~40 bayt |
| Maç odası `mac/{maç no}` | Maçın içeriği `{ durum, istatistik, kadro, olaylar, oran }` (her alan bir satır; aşağıda "Maç içeriği" ve "Oranlar") ve yorumları. Maç kesinleşince içerik silinir, yorumlar kalır | Sunucu | Maç sayfası ve Oranlar menüsündeki oran sayfası (açıkken) | İçerik: canlı maçta ve bitişten sonraki 10 dk en sık 2 dk'da bir, maç bitince. Oranlar: günde 2 kez | ~2–4 KB |
| R2 `sezon/{lig}-{yıl}.json` | Sezonun bütün maçları `{ "maç no": "gün,lig,hafta,ev,dep,saat,durum,ev gol,dep gol" }` (aşağıda "Sezonlar") | Sunucu | Takım ve lig sayfası (bir kez; 5 dk önbellek) | Günde 1 ve o ligden maç bitince | lig başına ~15–20 KB |
| R2 `sezon/takimlar.json` | Takım dizini `{ takım no: ["lig-yıl", ...] }`: takım hangi sezon dosyalarında (aşağıda "Sezonlar") | Sunucu | Takım sayfası (bir kez; 5 dk önbellek) | Sezon listesinde yeni takım görülünce | ~birkaç KB |
| R2 `sezon/durum.json` | Her sezonun durumu (aşağıda "Sezonlar") | Sunucu | Sen, takım sayfası (bir kez) | Sezon işi ilerledikçe | < 1 KB / sezon |
| R2 `takim.json` | Bütün takımların adları `{ s: sürüm (zaman, saniye), t: { "takım no": ad } }`. Silinmez | Sunucu | Site (yalnızca sürüm telefondakinden farklıysa; sürüm gün odasından `v.takim`), hızlı kaynak, yönetim sayfası | Yeni takım görülünce | takım başına ~20 bayt |
| R2 `puan/{lig}.json` | Ligin puan durumu `{ g: yazma anı (ms), sezon, cevap: API-Football /standings cevabı olduğu gibi }` (kullanılmayan alanlar da durur: form, ev / deplasman ayrımı, açıklama...); kupalarda ayrıca `eslesme` (eleme turlarının maçları) ve `t` (takım adları). Aşağıda "Puan durumu" | Sunucu | Maç sayfası açılınca arka planda (Puan sekmesi; telefonda 10 dk, okuyucuda 5 dk önbellek) | Ligde maç bitince 5 dk sonra, ayrıca günde bir | 20 takım ~10–15 KB |
| R2 `lig.json` | Liglerin kadro / istatistik verip vermediği `{ "lig no": 1 / 0 }` | Sunucu | Site (açılışta bir kez) | Günde en fazla 1 | < 1 KB |
| Firestore `elle/{maç no}` | Elle düzeltme kilidi `{ s: "2-1", d?: "FT", o?: "[olaylar]", t }`: kilit durdukça maçın skoru (ve durumu, olayları) API'nin yerine geçer, bildirim gitmez. Gün listesini, Özet'i ve maç içeriğini sunucu kilitten yazar; kilit konunca, değişince ve kalkınca maç API'den yeniden çekilir, konunca maçın hızlı kaydı silinir (yönetim sayfası yalnızca kilidi yazar; dün ve sonrası) | Yönetim sayfası | Sunucu (dinler), yönetim sayfası | Düzeltmede | ~40 bayt |
| Firestore `istek/{ad}` | Yönetim sayfasının sunucudan istediği iş `{ tur, mac?, t }`: `yenile_{maç}` maçı API'den yeniden çek, `hizli_sil_{maç}` maçın hızlı kaydını sil, `hizli_sil_hepsi` bütün hızlı kayıtları sil. Sunucu işi yapınca siler (yönetim sayfası bunu bekler) | Yönetim sayfası | Sunucu (dinler) | İstendiğinde | ~50 bayt |
| R2 `gun/{gün}.json` | Günün bütün maçları `{ "maç no": "satır" }` (gün odasındaki satırla aynı). Canlı maçta hızlı kaynağın skoru varsa (kilitli değilse) o. Arşiv, silinmez | Sunucu | Canlı Skor: dünden eski günler, yarın ve sonrası (bir kez); gün odasına bağlanılamazsa bugün ve dün de | Skor ya da durum değişince (hızlı kaynağın golünde de) | 200 maç ~7,7 KB |
| R2 `ozet/{gün}.json` | Dün ve bugünün oynanan ve biten maçlarının olayları `{ k, s, m: { "maç no": [olaylar] } }` (gzip ile sıkıştırılmış). `k`, `s`: dosya yazılırken gün odasının kimliği ve sırası (telefon sonrasını odadan ister; eski dosyalarda yok). Arşiv, silinmez | Sunucu | Site: son 7 gün; bugün ve dün listeden sonra (30 sn önbellekli, eksikler gün odasından); yönetim sayfası | Değişince, en sık 30 sn'de bir (`OZET_R2_ARALIK`) | 150 maç ~95 KB (sıkıştırılmış ~10–15 KB) |
| R2 `mac/{maç no}.json` | Kesinleşmiş maçın içeriği `{ durum, istatistik, kadro, olaylar, oran?, g: yazma anı (ms) }` (oran: maç odasındaki oranlar, varsa). Maç bitince 2 saat sonraki son çekişte yazılır (elle düzeltmede yeniden). Arşiv, silinmez | Sunucu | Maç sayfası (maç odası boşsa, bir kez) | Maç kesinleşince | ~2–4 KB |
| Firestore `maclar/{maç no}` | Eski maç içerikleri (artık yazılmıyor). Yönetim sayfası düzeltmede hâlâ bakar; doküman yoksa o adımı atlar | — | — | — | — |
| Firestore `oran_gun/{gün}` | Bugün ve sonraki 7 günün başlamamış maçlarının menü oranları (`z`, gzip: `{ "maç no": "satır" }`) | Sunucu | Oranlar menüsü (seçili gün, bir kez) | Günde 2 kez, değişince | hafta içi ~1,5–2 KB, hafta sonu ~4–5 KB (sıkıştırılmış) |
| Firestore `oran_lig/{lig no}` | Aynı oranlar, ligin 8 günü | Sunucu | Oranlar menüsü (lig seçilince, bir kez) | Günde 2 kez, değişince | ~0,3–1 KB (sıkıştırılmış) |
| Firestore `oran_mac/{maç no}` | Eski maç oranları (artık yazılmıyor ve okunmuyor, kuralı kaldırıldı; maçın oranları maç odasında) | — | — | — | — |
| Firestore `sistem/oran` | Son oran güncellemesi: zaman, istek sayısı, maç sayısı, süre | Sunucu | Sunucu (açılışta), sen | Günde 2 kez | < 1 KB |
| Firestore `analiz_futbol/{maç no}`, `analiz_nba/{maç no}` | Analiz dosyasındaki maçın bütün alanları (sıkıştırılmadan; Firestore liste içinde liste kabul etmediği için öyle olan alanlar, ör. `gecmis`, JSON metni) + `gun` (başlama − 7 saat), `dosya_surum`, `dosya_olusturma`, `yuklendi`. Maç numarası analiz kaynağınınki (API'ninkiyle aynı değil) | Yönetici (bilgisayardaki yonetim.html, e-posta/şifre ile) | Detaylı Analiz'e basınca (bir kez) | Dosya yüklenince | ~2–3 KB |
| Firestore `analiz_gun/{gün}`, `analiz_nba_gun/{gün}` | O günün kartları (`z`, gzip: `{ "maç no": kart }`). Futbol kartı: ts, league, home, away, featured_pick, stars, featured_odd, market, result, lineup_label, corner_chip, card_chip, offside_chip, card_reasons, sub_boxes, prob (`[ev, beraberlik, dep]` %). NBA kartı: ts, league, home, away, featured_pick, stars, featured_odd, market, result, chips, badges, reasons, prob (`[ev, dep]` %) | Yönetici | Analiz sekmesi, seçili gün (bir kez) | Dosya yüklenince | ~4–11 KB (sıkıştırılmış) |
| Firestore `analiz_lig/{lig}`, `analiz_nba_lig/{lig}` | O ligin kartları (lig adındaki `/` yerine `-`) | Yönetici | Analiz sekmesi, lig seçilince (bir kez) | Dosya yüklenince | ~1–2 KB (sıkıştırılmış) |
| Firestore `analiz_dizin/futbol`, `analiz_dizin/nba` | `{ gunler: { gün: sayı }, ligler: { lig: sayı } }` (`z`); futbolda ayrıca `surum` (son yüklemenin anı, saniye; sunucu dinler ve gün odasına `v.analiz` olarak aktarır), `karne` (dosyadaki `basari_karnesi`, futbol ve NBA birlikte) ve `kupon` (kupon günlerinin maç sayıları `{ tarih: [futbol, NBA] }`, AI Kuponu gün düğmelerinde) | Yönetici | Analiz sekmesi açılınca (bir kez) | Dosya yüklenince | < 1 KB |
| Firestore `kupon_gun/{tarih}` | AI Kuponu havuzu, maçın takvim gününe (Türkiye saati) göre, futbol ve NBA birlikte (`z`, gzip: `{ "maç no": { s: "f" \| "n", ts, d: tarih, t: saat, league, home, away, prob, opts: [{ pick, odd, prob, stars, cat, why }] } }`). Analiz dosyasındaki `hazir_tercihler`'den (ya da `opts`); tercihi olmayan maç yazılmaz | Yönetici | AI Kuponu sekmesi, seçili günler (Bugün seçiliyse ertesi gün de), bir kez; telefonda analiz sürümüyle saklanır | Dosya yüklenince | yoğun gün ~35 KB (sıkıştırılmış) |
| Firestore `sistem/durum` | Sunucunun durumu | Sunucu | Yalnızca sen | Dakikada bir | < 1 KB |
| Firestore `zil/{cihaz no}` | Bir cihazın kaydı: `{ token, maclar (zil açılan maçlar), sahip (yazan girişin kimliği), kisi (Google ile giriş yapan kişi, varsa), tur: site / uygulama }`. Cihaz no telefonda saklanır; bir kişinin birden çok cihazı olabilir. Eski biçim `zil/{kimlik}` yenisi yazılınca silinir | Site | Yalnızca sunucu | Kullanıcı zil açıp kapatınca, giriş / çıkışta | ~300 bayt |

**Gün tanımı (sunucu ve site aynı):** maçın günü = başlama saati − 7 saat (00:00–06:59 başlayan maç önceki günün listesindedir); "bugün" = şu an − 4 saat (gün 04:00'te değişir). 04:00–06:59 başlayan ("sabah") maç kendi takvim gününün listesine de yazılır; site 04:00–07:00 arası önceki günün odasına da bağlı kalır. Canlı skor 12:30–07:00 arası çekilir.

Sunucu dün, bugün ve 7 gün ilerinin listesini yazar (fikstür: bugün 15 dk, dün ve yarın saatte bir, sonraki günler 6 saatte bir yenilenir). Gün odaları dünden eski olunca boşaltılır; R2'deki günler arşiv olarak kalır.

## Site ne zaman ne okur

| Ne | Bugün ve dün | Diğer geçmiş günler | Yarın ve sonrası |
|---|---|---|---|
| Liste | Gün odası: bağlanınca hepsi (hızlı kaynakla birlikte), sonra değişenler. Odaya bağlanılamazsa R2 `gun` bir kez | R2 `gun` bir kez | R2 `gun` bir kez |
| Özet | Listeden sonra R2 `ozet` (30 sn önbellekli); dosyanın sırasından sonraki değişiklikler gün odasından, sonra değişenler. Odaya bağlanılamazsa yalnızca R2 `ozet` | Son 7 gün: R2 `ozet` bir kez. Daha eskiler okunmaz (maç açılınca olaylar R2 maç dosyasından) | Okunmaz |

- Dün yalnızca seçiliyken ve 04:00–07:00 arası (gece yarısını geçen maçlar) bağlı kalır.
- Uygulama arka plana geçince oda bağlantıları kapanır; öne gelince yeniden bağlanır ve yalnızca kaçırılan değişiklikler gelir.
- İstatistikteki "Kart" sayısı maç içeriğindeki istatistikte sarı + kırmızı karttan.
- Bugün her zaman dinlenir. Dün yalnızca seçiliyken dinlenir (gece yarısını geçen maçlar ve maç sonu düzeltmeleri için).
- Takım adları telefonda saklanır. Sürüm bugünün gün odasından gelir (`v.takim`); telefondakinden farklıysa R2 `takim.json`'un tamamı bir kez iner. Odaya bağlanılamazsa ve telefonda sözlük yoksa dosya yine iner.
- Maç açılınca maç odasına bağlanılır, maç kapanınca bırakılır. Bağlanınca içeriğin tamamı, sonra yalnızca değişen alanlar gelir. Odada içerik yoksa R2 `mac/{no}.json` okunur (dosya varsa oda bırakılır).
- Uygulama arka plana geçince bütün dinlemeler durur, oda bağlantıları kapanır.
- Hızlı kaynağın skoru ve uyarısı gün odasından gelir (yalnızca canlı ve kilitli olmayan maçlar).
- Oranlar menüsü açılınca seçili günün `oran_gun` dokümanı, lig seçilince o ligin `oran_lig` dokümanı bir kez okunur. Maçın bütün oranları maç içeriğinin `oran` alanıyla gelir (maç odası ya da R2 maç dosyası); Oranlar menüsünden maçın oran sayfası açılınca da maç odasına bağlanılır. Okunan menü oran dokümanı 1 saatten eskiyse yeniden okunur.
- Kayıtlı Oranlarım telefonda saklanır (Firestore'a yazılmaz).
- Analiz sekmesi ilk açılınca `analiz_dizin/futbol` ve bugünün `analiz_gun` dokümanı okunur; başka gün seçilince o günün `analiz_gun`, lig seçilince `analiz_lig`, Detaylı Analiz'e basınca `analiz_futbol/{no}` bir kez okunur. Üstte basketbol seçiliyse aynısı NBA dokümanlarından (`analiz_dizin/nba`, `analiz_nba_gun`, `analiz_nba_lig`, `analiz_nba/{no}`). Başarı Karnesi `analiz_dizin/futbol`'daki `karne`'den. AI Kuponu sekmesi ilk açılınca seçili günlerin `kupon_gun` dokümanları okunur; kupon telefonda kurulur (ek okuma yok), kupondaki maça basınca Detaylı Analiz (`analiz_futbol/{no}` ya da `analiz_nba/{no}`). Analiz sürümü bugünün gün odasından (`v.analiz`) bağlanınca bir kez alınır. Okunan analiz dokümanları telefonda bu sürümle saklanır; sürüm aynıysa Firestore'dan yeniden okunmaz (geçmiş günler ve 1 günden eski maçlar telefondan silinir).

## Hızlı kaynak (gün odasında `h`, `u`)

- Canlı maçta iki kaynaktan (API, hızlı) en son değişen skor gösterilir. Açılışta farklıysa hızlı kaynağınki.
- Biten maçta (API'de canlı değil) hızlı kaynağa bakılmaz.
- Canlı maçta hızlı skor API'ninkinden 2 dk farklı kalırsa sunucu o maçın hızlı kaydını (`h`, `u`) gün odasından siler.
- Telefon bildirimi (sunucu) golü ve iptali hangi kaynak önce görürse ondan gönderir, aynı skor için bir kez.
- Uyarı (`u`) varken (yalnızca top oyundayken) satır hafif kırmızı olur; `"2-2"`de beklenen takımın yanında kırmızı nokta. Uyarı geldikten sonra skor değişirse (hangi kaynaktan olursa) kırmızı kalkar.
- Skor değişince o maçta 1 dk `"k"` uyarısı gösterilmez; `"2-2"` (nokta) gösterilir.
- **Program yazar:** `POST {ODA_ADRES}/hizli/gun/{maçın günü}`, başlıkta `Authorization: Bearer HIZLI_ANAHTAR` (Cloudflare'de canli-oda → Variables and Secrets). Gövde yalnızca değişenler: `{ "h": { "maç no": "2-1" | null }, "u": { "maç no": "2-2" | "k" | null }, "t": 1 }` (`null` = sil, `t` = programın dakikalık çalışıyorum işareti, telefonlara gitmez; `/bak` sayfasında `hizli_son_isaret`). Biçime uymayan istek hiç yazılmaz (400). Bu anahtar yalnızca bunu yazabilir.
- **Program okur:** maç listesi R2 `gun/{gün}.json`, takım adları R2 `takim.json` (okuyucudan, yetki gerekmez).
- Sunucu dün ve bugünün gün odasını dinleyerek hızlı skoru öğrenir (bildirim, R2 gün dosyası, 2 dk kontrolü); sildiğinde aynı adrese `ODA_ANAHTAR` ile yazar.

---

## Puan durumu

Kod: `sunucu/puan.js`. `ayarlar.js` → `LIGLER`'deki bütün ligler. Kupalarda (API'nin lig türü `Cup`) ayrıca sezonun maç listesi çekilir (1 istek daha) ve eleme turları `eslesme` olarak yazılır: `[maç no, tur kodu, başlama (sn), ev, dep, ev gol, dep gol, durum, ev penaltı, dep penaltı]`; lig / grup aşaması ve ön elemeler yazılmaz. Puan durumu da eşleşmesi de yoksa dosya yazılmaz, günde bir yeniden denenir.

- Ligde bir maç bitince `PUAN_BEKLE` (5 dk) sonra çekilir (art arda bitenler tek istek); ayrıca her lig günde bir. Turda en fazla `PUAN_TUR_ISTEK` istek; API hakkı azaldıysa hiç. Sunucu açılınca dosyanın yazma anına bakılır.
- Site (maç sayfası → Puan; maç sayfası açılınca arka planda okunur): `cevap[0].league.standings` (grup başına bir tablo; maçın grubu üstte). Maçın takımları vurgulu; API'nin açıklamasından bölge şeridi. Altında kupa eşleşmeleri tur tur (çift maçta toplam skor, tur atlayan kalın, açılan maçın eşleşmesi vurgulu; oynanan maçın skoru canlı listeden).
- **Canlı:** ligde oynanan maç varsa (ve dosya yazıldığında henüz bitmemiş maç) telefon o anki skoru tabloya ekleyip yeniden sıralar (puan, averaj, atılan gol; ikili averaj bilinmez). Maç bitince sunucunun çektiği gerçek tablo gelir.

---

## ESPN (ikinci kaynak)

`ayarlar.js` → `ESPN_LIGLER`: Süper Lig (`tur.1`), Belçika Pro League (`bel.1`), İskoçya Championship (`sco.2`). Kod: `sunucu/espn.js`. Anahtar gerekmez (ESPN'in herkese açık ama belgelenmemiş adresi).

- **Çekme (canlı saatlerde):** ESPN'i gereken maçı (canlı, 1 dk içinde başlayacak, `BITIS_SONRASI` içinde bitmiş) olan ligin listesi her turda (lig başına 1 istek); eşleşen maçın ayrıntısı (istatistik, olaylar) `DETAY_ARALIK`'ta bir (maç başına 1 istek).
- **Eşleştirme:** aynı lig, başlama saati en fazla 15 dk farklı, iki takım adı da benzer. Eşleşmeyen ESPN maçı sunucu günlüğüne bir kez yazılır (`ESPN: eşleşmeyen maç`).
- **Birleştirme** (gösterilen hal; gün listesi, Özet, maç içeriği, bildirimler bunu kullanır):

| Ne | Kural |
|---|---|
| Skor, kırmızı kart | İki kaynaktan büyük olan (geç gelen kaynak geri götürmez). Bir kaynak kendi değerini düşürürse (VAR) düşüş kabul edilir; öbür kaynağın o eski değere kadar olan değerleri yok sayılır, düşüren kaynak yeniden o değere ulaşınca (yeni gol) kalkar |
| Durum, dakika | ESPN (ESPN 5 dk gelmezse API) |
| Olaylar | Gol, kart, kaçan penaltı ESPN'den; API aynı olayı (aynı taraf, tür, en fazla 3 dk fark) verince oyuncu adı, asist, ikinci sarıdan kırmızı API'den. API'nin karşılığı olmayan golü / kartı 2 dk beklenir, skor / kırmızı sayısı izin veriyorsa eklenir. Değişiklik ve VAR API'den |
| İstatistik | Sayılar (isabetli / toplam / engellenen şut, faul, korner, ofsayt, kartlar, kurtarış, pas, isabetli pas) büyük olan; topla oynama ESPN (tazeyse); isabetsiz şut ve pas isabeti bunlardan hesaplanır; ceza sahası içi / dışı şut, xG, önlenen gol, serbest vuruş API |
| Kadro | API |

- Elle düzeltme kilidi olan maçta ESPN kullanılmaz.

---

## Sezonlar

Depodaki `sezonlar.txt`'de yazan lig sezonlarının bütün maçları ve oynanmış maçların içeriği R2'ye kaydedilir (`sunucu/sezon.js`). Satır biçimi: `203 2026-2027 Süper Lig` (lig no, sezon, açıklama; tek yıllık sezon `2026`). Sunucu dosyayı yalnızca açılırken okur: satır ekleyince `cd /opt/canli && sudo git pull && sudo systemctl restart canli`. Satır silinince kaydedilmiş dosyalar silinmez.

- Sunucu her turda en fazla `SEZON_TUR_ISTEK` (ayarlar.js) API isteğiyle çalışır; API hakkı azalınca durur. Önce sezonun maç listesi (1 istek), sonra oynanmış maçların içeriği 20'şerli gruplar halinde (`mac/{no}.json`, canlı maçlarla aynı biçim).
- Sezonlar dosyadaki sırayla işlenir; yeni satırlar sona eklenir. Bitmiş sezon (ve bitiş yılı geçmişte kalan sezon, ör. 2000-2001) bir kez doldurulur (`tamam`), bir daha dokunulmaz. Devam eden sezonun listesi günde bir yenilenir, yeni biten maçların içeriği çekilir; canlı takip edilen maç bitince satırı sezon dosyasında hemen güncellenir.
- Sezon listelerinde görülen takımlar (artık ligde olmayanlar dahil) takım adları dosyasına eklenir.
- `sezon/durum.json` (tarayıcıda `https://deneme.co.uk/veri/sezon/durum.json`): her sezon için `durum` (`bekliyor`, `dolduruluyor`, `devam ediyor`, `tamam`), `mac` (sezondaki maç), `biten`, `icerik_yazilan`, `icerigi_eksik` (API'nin istatistik, kadro ve olay vermediği maç), `son_liste`, `hata`.
- `sezon/ic/{lig}-{yıl}.json`: içeriği yazılmış maçların numaraları (sunucu yeniden açılınca kaldığı yerden sürsün diye; okuyucudan okunmaz).
- `sezon/takimlar.json`: her takımın bulunduğu sezon dosyaları (sezon listesi her çekildiğinde eklenir; silinmez).
- Takım ve lig sayfasında üstte sezon menüsü (kaydedilmiş sezonlar, en yenisi seçili). Takım sayfası (maç sayfasındaki takım adına basınca): seçilen sezonda takımın kaydedilmiş bütün turnuvaları, lig adı başlığıyla; sıra: önce lig, sonra Avrupa kupaları (2, 3, 848), sonra kupalar (adında Kupa / Cup / Pokal / Shield geçen).
- Lig sayfası (ana listede lig başlığına, maç sayfasında lig satırına basınca): seçilen sezonun dosyasından hafta hafta (oklar ve açılır liste); açılışta bugüne en yakın maçın haftası.
- Takım ve lig sayfası, maça basınca açılan maç sayfası üst üste yeni sayfa olarak açılır; mavi top ve geri tuşu yalnızca en üsttekini kapatır. Maç içeriği maç odasından / R2 maç dosyasından gelir.

## Odalar

Cloudflare Durable Objects; kodu `oda/src/index.js`, Cloudflare'de `canli-oda` Worker'ı (GitHub'daki `oda/` klasöründen kendisi yüklenir). Her oda kendi küçük deposunu tutar; kimse bağlı değilken uyur. Odalar Doğu Avrupa'da kurulur (`eeur`, Türkiye'ye en yakın bölge); `/bak` sayfasındaki `konum` odanın bulunduğu merkezdir (ör. `WAW` Varşova).

- **Telefon bağlanır:** `wss://{site}/oda/gun/{gün}`, `wss://{site}/oda/mac/{no}`. `deneme.co.uk`'te `/oda/*` ve `/hesap/*` doğrudan Worker'a gider (canli-oda → Domains → Route); `pages.dev` adresinde Cloudflare Pages'teki geçit (`functions/oda`, Worker'a `ODA` adıyla bağlı) iletir.
- **Sunucu yazar:** `POST {ODA_ADRES}/yaz/gun/{gün}`, `POST {ODA_ADRES}/yaz/mac/{no}`; boşaltma `DELETE` ile. Hızlı kaynak: `POST {ODA_ADRES}/hizli/gun/{gün}` (yukarıda "Hızlı kaynak"). Anahtarlar `/etc/canli/anahtar.env`: `ODA_ADRES` (Worker'ın adresi), `ODA_ANAHTAR` (Cloudflare'de aynı anahtar: canli-oda → Settings → Variables and Secrets).
- **Sen bakarsın:** tarayıcıda `{ODA_ADRES}/bak/gun/2026-11-09?anahtar={ODA_ANAHTAR}` ya da `/bak/mac/{no}?anahtar=...`. Odanın şu anki hali, sıra numarası, bağlı telefon sayısı ve (gün odasında) son 20 değişiklik görünür.
- **Sıra numarası:** odadaki her değişiklik 1 artar. Telefon yeniden bağlanırken son aldığı numarayı ve odanın kimliğini gönderir; oda yalnızca kaçırılanları yollar. Gün odasında kaçırılan 100'den fazlaysa (ya da günlükte yoksa) listeyi baştan gönderir, telefon Özet'i R2'den yeniden okur. Gün odası son 300 değişikliği saklar, bellekte de.
- **Yoklama:** telefon 45 sn'de bir `p` gönderir, oda uyanmadan `o` cevabı gider (mobil ağlar boştaki bağlantıyı kesmesin).

### Gün odası `gun/{gün}`

| Alan | Ne |
|---|---|
| `r` | `{ "maç no": "satır" }` (aşağıda "Canlı skor satırı"). API'nin skoru. Odada tek satır |
| `o` | Yalnızca değişikliklerde: olayları değişen maçlar `{ "maç no": [olaylar] \| null }` (Özet). Oda saklamaz; Özet'in tamamı R2 `ozet/{gün}.json` |
| `h` | `{ "maç no": "2-1" }` hızlı kaynağın skoru (programın yazdığı gibi; kilitli maçta sunucu siler) |
| `u` | `{ "maç no": "2-2" / "k" }` hızlı kaynağın uyarısı |
| `v` | Sürümler `{ takim, analiz }`: takım adları (R2 `takim.json`) ve analiz dosyası (Firestore `analiz_dizin/futbol` → `surum`) |

`r`, `v`'yi sunucu her seferinde o günün **tam hali** olarak gönderir (yalnızca son gönderilenden farklı alanlar). Oda kendi haliyle karşılaştırır, yalnızca değişenleri saklar ve telefonlara iletir. `o`'yu sunucu yalnızca değişen maçlar olarak gönderir (gönderemezse bir sonrakinde hepsini). `h`, `u`'yu hızlı kaynak yalnızca değişenler olarak yazar. Liste, hızlı kaynak ve sürümler odanın belleğinde hazır durur (oda uyanınca bir kez okunur).

Telefona giden mesajlar:

| Mesaj | Ne zaman |
|---|---|
| `{ t: "l", k, s, z, r, h, u, v }` | İlk bağlanışta (ya da kaçırılanlar saklanandan eskiyse): liste, hızlı kaynak, sürümler |
| `{ t: "oz", s, o }` | Telefonun `{ a: "oz", s }` isteğine (R2 Özet dosyasını okuyunca, dosyanın `s`'i): o sıradan sonraki Özet değişiklikleri birleşik. `o: null`: günlükte yok (telefon dosyayla yetinir) |
| `{ t: "h", k, s, z, n }` | Yeniden bağlanışta: ardından kaçırılan `n` değişiklik gelir |
| `{ t: "d", s, r?, o?, h?, u?, v? }` | Değişiklik: yalnızca değişenler, `null` = silindi |

`k` odanın kimliği, `s` sıra numarası, `z` sunucu saati (ms; dakika telefonun saati yanlış olsa da doğru hesaplansın diye).

### Maç odası `mac/{maç no}`

İçerik aşağıdaki "Maç içeriği"; her alanı (`durum`, `istatistik`, `kadro`, `olaylar`, `oran`) odada ayrı satır. Telefona: bağlanınca `{ t: "m", k, s, g: değişme anı (ms), d: içeriğin tamamı }`, değişince yalnızca değişen alanlar `{ t: "p", k, s, g, d }`; telefondaki güncelse `{ t: "h" }`; odada içerik yoksa `{ t: "y" }` (maç kesinleştiyse içerik R2 `mac/{no}.json`'da). Maç kesinleşince sunucu içeriği odadaki oranlarla birlikte R2'ye yazar (oranları `GET /yaz/mac/{no}` ile, `ODA_ANAHTAR`) ve odadan içeriği siler (yorumlar kalır).

Oranları (`oran`) sunucu günde 2 kez ayrı yazar; içerik yazılırken oran alanı silinmez.

## Canlı skor satırı

Örnek: `"203,9,994,6343,2030,2H3725,2,1,,1"`. Gün Türkiye saatine göredir. Anahtar API-Football'un maç numarasıdır.

Virgülle ayrılmış metin. Sondaki boş alanlar yazılmaz (başlamamış maçta skor yok).

| Sıra | Ne | Örnek |
|---|---|---|
| 1 | Lig no | 203 |
| 2 | Hafta (aşağıda) | 9 |
| 3 | Ev sahibi takım no | 994 |
| 4 | Deplasman takım no | 6343 |
| 5 | Başlama saati (Türkiye saati). Sonunda `+` varsa maç listenin gününden sonraki takvim gününde başlıyor (00:00–06:59) | 2030 (20:30), 0500+ |
| 6 | Durum (aşağıda) | 67 |
| 7 | Ev sahibi gol | 2 |
| 8 | Deplasman gol | 1 |
| 9 | Ev sahibinin kırmızı kartı (yoksa boş) | |
| 10 | Deplasmanın kırmızı kartı (yoksa boş) | 1 |

Kırmızı kart sayısı maçın olaylarından (kırmızı ve ikinci sarıdan kırmızı); olayları bilinmeyen maçta boş. Sezon dosyalarındaki satırlarda yok.

**Hafta:** ligde sayı (`9`). Kupada: `3T` 3. tur, `S16` son 16, `S32`, `S64`, `CF` çeyrek final, `YF` yarı final, `F` final, `G` grup aşaması, `PO` play-off. Bilinmeyen tur API'nin yazdığı gibi.

**Durum:** boş = başlamadı; oynanan devrede devre kodu + devrenin başladığı an, planlanan başlama saatinden kaç saniye sonra (`1H-30`, `2H3725`, `ET6400`; dakika yazılmaz, site sunucu saatiyle hesaplar, 45'ten sonra `45+N`); diğerlerinde aşağıdaki kodlar. Devre değişince ve API'nin dakikası 2 dk'dan fazla saparsa bir kez yazılır.

### Durumlar

| Kod | Anlamı |
|---|---|
| TBD | Saati belli değil |
| 1H, 2H, ET | 1. yarı, 2. yarı, uzatma (devre başlangıcı bilinmiyorsa yalnız kod) |
| HT | Devre arası |
| BT, P | Uzatma arası, penaltılar |
| SUSP, INT | Askıya alındı, durduruldu |
| FT | Bitti |
| AET, PEN | Uzatmada bitti, penaltılarla bitti |
| PST, CANC, ABD | Ertelendi, iptal, yarıda kaldı |
| AWD, WO | Hükmen |

## Özet (gün odası `o`, R2 `ozet/{gün}.json`)

`{ "maç no": [olaylar], … }` (R2 dosyasında `m` alanında). Yalnızca oynanan ve biten maçlar. Olayı olmayan maçta `[]`.

Sitedeki Özet sekmesi şimdilik yalnızca gol ve kartları gösterir; değişiklik, VAR, asist ve kaçan penaltı da yazılır.

### Olay

```
[dakika, uzatma, taraf, tür, ayrıntı, oyuncu, ikinci oyuncu]
```

Sondaki boş (`null`) alanlar yazılmaz.

| Sıra | Ne |
|---|---|
| 0 | Dakika |
| 1 | Uzatma dakikası (45+2 → 45, 2) |
| 2 | Taraf: 0 ev sahibi, 1 deplasman |
| 3 | Tür: `g` gol, `k` kart, `d` oyuncu değişikliği, `v` VAR |
| 4 | Ayrıntı (aşağıda) |
| 5 | Oyuncu. Değişiklikte **çıkan** oyuncu |
| 6 | Golde asist yapan, değişiklikte **giren** oyuncu |

| Ayrıntı | Anlamı |
|---|---|
| `n` | Normal gol |
| `p` | Penaltı golü |
| `kk` | Kendi kalesine |
| `kp` | Kaçan penaltı (**gol sayılmaz**) |
| `s` | Sarı kart |
| `k` | Kırmızı kart |
| `sk` | İkinci sarıdan kırmızı |
| başka metin | VAR kararı, API'nin yazdığı gibi (ör. "Goal cancelled": gol iptal) |

---

## Maç içeriği (maç odası, R2 `mac/{maç no}.json`)

Kadro ve istatistik veren liglerde maç öncesi ve canlıyken maç odasına; bütün liglerde maç bitince (olaylarla) yazılır. Maç bittikten 2 saat sonraki son çekişte R2'ye yazılır ve oda boşaltılır.

| Alan | Açıklama |
|---|---|
| `durum` | Maçın durumu |
| `istatistik` | `[[ev sahibi 19 değer], [deplasman 19 değer]]`. Henüz yoksa `null` |
| `kadro` | `[ev sahibi kadrosu, deplasman kadrosu]`. Henüz açıklanmadıysa `null` |
| `olaylar` | Yalnızca maç bitince: maçın bütün olayları (Özet'teki biçimde) |
| `oran` | Maçın oranları (aşağıda "Oranlar"); yoksa alan yok |

### İstatistik sırası

| Sıra | Ne | Sıra | Ne |
|---|---|---|---|
| 0 | İsabetli şut | 10 | Sarı kart |
| 1 | İsabetsiz şut | 11 | Kırmızı kart |
| 2 | Toplam şut | 12 | Kaleci kurtarışı |
| 3 | Engellenen şut | 13 | Toplam pas |
| 4 | Ceza sahası içi şut | 14 | İsabetli pas |
| 5 | Ceza sahası dışı şut | 15 | Pas isabeti (%) |
| 6 | Faul | 16 | Gol beklentisi (xG) |
| 7 | Korner | 17 | Önlenen gol |
| 8 | Ofsayt | 18 | Serbest vuruş |
| 9 | Topla oynama (%) | | |

### Kadro (her takım için)

```
[diziliş, teknik direktör, [ilk 11], [yedekler]]
```

- İlk 11 oyuncusu: `[forma no, ad, mevki, sahadaki yer]`. Yer `"2:3"` = 2. sıra, 3. oyuncu (1. sıra kaleci)
- Yedek: `[forma no, ad, mevki]`
- Mevki: `G` kaleci, `D` defans, `M` orta saha, `F` forvet

---

## Oranlar

Maç öncesi oranlar (canlı değil). Günde 2 kez (06 ve 12, Türkiye saati; sunucu o saatte kapalıydıysa açılınca hemen) bugün ve sonraki 7 günün başlamamış maçları için 2 şirketin oranları lig lig çekilir. Her seçeneğin olasılığı şirket payı çıkarılarak bulunur, iki şirketin ortalaması alınır, Türkiye oranlarına benzemesi için pay eklenip oran yeniden hesaplanır (**tahmini**; pay `ayarlar.js` → `ORAN_PAY`). Şirket adları hiçbir yere yazılmaz. Başlamış maçların oranı bir daha yazılmaz.

Oranlar 100 ile çarpılmış tam sayıdır (`185` = 1,85). Barajlar dokümanda olduğu gibi (`"2.5"`), menü satırında 10 ile çarpılmış (`95` = 9,5).

### Maç odasında `oran` (olmayan oran yazılmaz)

| Anahtar | Ne | Değer |
|---|---|---|
| `ms` | Maç sonucu | `[1, X, 2]` |
| `cs` | Çifte şans | `[1X, 12, X2]` |
| `iy` | İlk yarı sonucu | `[1, X, 2]` |
| `iyms` | İlk yarı / maç sonucu | `[1/1, 1/X, 1/2, X/1, X/X, X/2, 2/1, 2/X, 2/2]` |
| `kg` | Karşılıklı gol | `[var, yok]` |
| `au` | Gol alt / üst (0,5–4,5) | `{ "2.5": [alt, üst], ... }` |
| `iau` | İlk yarı gol alt / üst (0,5, 1,5) | `{ "0.5": [alt, üst], ... }` |
| `tc` | Toplam gol tek / çift | `[tek, çift]` |
| `hnd` | Handikaplı maç sonucu (ev sahibine −1 / +1) | `{ "-1": [1, X, 2], "1": [1, X, 2] }` |
| `tg` | Toplam gol aralığı | `[0-1, 2-3, 4-5, 6+]` |
| `skor` | Skor (en olası 18) | `{ "1-0": oran, ... }` |
| `kor`, `kart`, `ofs` | Korner, kart, ofsayt alt / üst (dengeye en yakın 3 baraj) | `{ "9.5": [alt, üst], ... }` |

### Menü satırı (`oran_gun`, `oran_lig`)

`oran_gun`: `"lig,ev,dep,saat,1,X,2,altı,üstü,korner barajı,alt,üst"`. Bugünün satırlarında lig, ev, dep ve saat boştur (sitede canlı skor listesinde var). Olmayan oran boş.

`oran_lig`: `"gün,ev,dep,saat,1,X,2,..."` (gün `2026-11-03`, saat Türkiye saati `2000`; 00:00–06:59 başlayan maç önceki günün maçıdır).

---

## Mesajlar (maç odası + D1)

Maç sayfasındaki Yorumlar. Okuma herkese açık; yazmak, oy ve şikayet için Google ile giriş ve rumuz gerekir. Telefon her yazma isteğiyle Firebase giriş kimliğini (ID token) gönderir; oda / Worker kimliği Google'ın herkese açık anahtarlarıyla doğrular (`oda/src/kimlik.js`, görünmez giriş yazamaz). Bütün sınırları oda denetler.

**Yorumlar maç odasında** (`oda/src/index.js` → MacOdasi; tablolar `yorum`, `oy`):

| Ne | Ayrıntı |
|---|---|
| Yorum | `{ id, u: yazanın kimliği, r: rumuz, t: metin (≤ 100 karakter), z: zaman (ms), y?: yanıtlanan yorum, b: beğeni, d: beğenmeme }`. Değiştirilemez, yazan silebilir. Yalnızca sunucunun "açık" bildirdiği maçlara yazılır (sunucu gördüğü her maçı bildirir). Şimdilik hiç silinmez; maç kesinleşince yalnızca maç içeriği odadan silinir, yorumlar kalır |
| Oy | Yorum ve kişi başına `{ v: 1 beğeni, -1 beğenmeme, 0 geri alındı, n: kaç kez değişti }`. İlk oy n = 0, en fazla 2 değişiklik. Kendi yorumuna oy verilemez; sayılar oda tarafından tutulur |
| Okuma | Canlı ve başlamamış maçta maç sayfası açılınca odaya bağlanılır (içerik). Kesinleşmiş olabilecek maçta (bitmiş, başlamasının üzerinden 5 saat geçmiş) içerik önce R2'den okunur, odaya yalnızca Yorumlar sekmesi açılınca bağlanılır (R2'de dosya yoksa hemen). Yorumlar sekmesi açılınca (ve oda yeniden bağlanınca) son 20 yorum istenir, "Daha fazla göster" ile her seferinde 20 daha (en fazla 200). Ondan sonra yeni yorum, silinen yorum ve oy sayıları anında gelir (yorumları istememiş bağlantılara gitmez) |
| Mesajların biçimi | `oda/src/index.js` → MAÇ ODASI açıklaması (`c`, `x`, `b`, `r` mesajları; `daha`, `yaz`, `sil`, `oy`, `sikayet` istekleri) |

**Kullanıcı bilgileri D1'de** (Cloudflare D1, veritabanı `canli`; `oda/src/d1.js`), hesap işlemleri `/hesap` adresinden (`oda/src/hesap.js`; site Pages'teki geçitten, `functions/hesap`):

| Tablo | Ne |
|---|---|
| `kisi` | `uid, r: rumuz, k: kuralların kabul anı, b: 1 = yanıt bildirimleri kapalı` |
| `rumuz` | Küçük harfle rumuz → sahibi (benzersizlik). 3–15 karakter: harf (Türkçe dahil), rakam, alt çizgi |
| `rumuz_zaman` | Son rumuz değişikliği; haftada bir. Hesap silinse de kalır |
| `sayac` | `g: gün no, n: o gün yazılan yorum`. Gün no = (zaman + 3 saat) / 1 gün. En fazla 20. Hesap silinse de kalır |
| `engel` | Kişinin engelledikleri. Engellenenin yorumları telefonda gizlenir, ondan yanıt bildirimi gelmez. Girişte okunur, telefondaki listeyle birleşir |
| `sessiz` | Kişinin, yanıtlarından bildirim almadığı kendi yorumları |
| `sikayet` | Şikayetler (her kişi bir yorumu bir kez); `mac, mesaj, uid, z`. Şimdilik yalnızca Cloudflare panelinden (D1 → canli → Console) bakılır |
| `mesajlarim` | Kişinin yorumları (hesap silinince bulmak için) |
| `bildirim_son` | Son yanıt bildirimi (aynı kişiden aynı kişiye 10 dakikada bir) |

- Küfür ve bağlantı filtresi: depodaki `kufur.json` (kök, tam kelime, bağlantı, izinli kelimeler); oda yorumu ve rumuzu yayınlamadan önce kontrol eder (`oda/src/filtre.js`), uygunsuzsa hiç yazılmaz.
- Yanıt bildirimi: yeni yorumda `@rumuz` (en fazla 2) geçerse oda bildirim kuyruğu odasına ekler; sunucu kuyruğa bağlıdır (`/oda/bildirim`), o kişinin bildirim izni vermiş ve zil kaydı olan cihazlarına gönderir (bağlantı `#mac={no}&yorum` Yorumlar'ı açar). Gitmez: kendine, yanıt bildirimlerini kapatana, göndereni engelleyene ya da göndericinin engellediğine, yanıtlanan yorumu için bildirimi kapatana, aynı gönderenden 10 dakika içinde ikinci kez. Kuyrukta 10 dakikadan eski iş gönderilmez. İzin ilk mesajdan sonra bir kez sorulur.
- Hesap silinince: yorumlar, `mesajlarim`, `kisi`, `engel`, `sessiz`, rumuz ve giriş kaydı silinir; oylar, `sayac`, `rumuz_zaman` ve şikayetler kalır.
- Henüz yok: eski yorumları silme (ör. her maçta son 100), yönetim sayfasında şikayetler.

---

## `sistem/durum`

| Alan | Açıklama |
|---|---|
| `calisiyor` | true |
| `son_tur` | Sunucunun son çalıştığı zaman. **Birkaç dakikadan eskiyse sunucu durmuş demektir** |
| `son_canli_istek` | Son canlı skor isteği |
| `canli_mac` | Şu an canlı maç sayısı |
| `takip_edilen_mac` | Dün, bugün ve 7 gün ileri takip edilen maç sayısı |
| `kalan_istek` / `gunluk_hak` | API-Football'da bugün kalan istek / günlük hak |
| `acilistan_beri_istek` / `acilistan_beri_yazma` | Sunucu son açıldığından beri API isteği / Firestore yazması |
| `son_hata` | Son turdaki hata (yoksa `null`) |
| `r2_son_hata` / `oda_son_hata` | R2'ye / odalara son yazmadaki hata (yoksa `null`) |

---

## `zil/{cihaz no}`

Kullanıcı bir maçın zilini açınca, Google ile giriş / çıkış yapınca (bildirim izni verdiyse) site yazar. Cihaz no her cihazın telefonda saklanan rastgele numarasıdır; bir kişi birden çok cihazdan girse her cihazın kaydı ayrıdır (birbirinin üzerine yazmaz).

| Alan | Açıklama |
|---|---|
| `token` | Cihazın bildirim kimliği (Firebase verir) |
| `maclar` | Zili açık maçların numaraları, en fazla 100 |
| `sahip` | Kaydı yazan girişin kimliği (görünmez ya da Google) |
| `kisi` | O cihazda Google ile giriş yapan kişinin kimliği (yoksa alan yok). Yanıt bildirimleri kişinin bütün cihazlarına gider |
| `tur` | `site` (ileride uygulama: `uygulama`) |
| `guncellendi` | Son yazma zamanı |

Sunucu bu kayıtları dinler ve cihazı her maçın bildirim konusuna (`mac-{maç no}`) abone eder (aynı cihaz anahtarı birden çok kayıtta olabilir; abonelik, anahtar ve maç hiçbir kayıtta kalmayınca kaldırılır). Geçersizleşen cihaz anahtarının kaydı yanıt bildirimi gönderilirken silinir. Bildirimler:
gol, VAR gol iptali, kırmızı kart, maç başladı, devre arası, maç sonu. Yalnızca canlı saatlerde (12:30–01:00) gönderilir.
