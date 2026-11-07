# Veritabanı

İki veritabanı ve bir dosya deposu var:

- **Realtime Database (RTDB):** canlı maçların satırları, takım adları, hızlı kaynak. Küçük ve sık değişen veri. Yalnızca değişen satır gönderilir.
- **Firestore:** maç detayı, oranlar, analizler, bildirim kayıtları, sunucu durumu.
- **Cloudflare R2 (kova `canli`):** günün maç listesi ve Özet, JSON dosyası olarak (arşiv, silinmez). Sunucu yazar (anahtarlar `/etc/canli/anahtar.env`: `R2_ADRES`, `R2_KIMLIK`, `R2_GIZLI`); site Cloudflare Pages'teki okuyucudan (`functions/veri`, kovaya `DEPO` adıyla bağlı) `/veri/gun/{gün}.json`, `/veri/ozet/{gün}.json` olarak okur. Okuyucu bugün, dün ve ilerideki günleri önbelleğe aldırmaz (her açılışta en son hali), daha eski günleri 1 saat tutturur.

Dokümanları sunucu yazar; `zil/{gizli kimlik}` kayıtlarını site (kullanıcının cihazı), `hizli` dallarını hızlı kaynak (başka bir bilgisayardaki skor sunucusu, ayrı bir kullanıcıyla) yazar. Bir şey değişmediyse yeniden yazılmaz.
Firestore dokümanlarında `guncellendi` alanı son yazma zamanıdır. Büyük dokümanlar (maç dokümanı, oranlar) gzip ile sıkıştırılmış `z` alanında durur; Console'da okunamaz, site açar.

| Yer | Ne var | Kim yazar | Kim okur | Ne zaman değişir | Boyut |
|---|---|---|---|---|---|
| RTDB `gun/{gün}/{maç no}` | Günün maçları, her maç bir satır. Canlı ve 3 dk içinde biten maçlar `c` ile başlar | Sunucu | Canlı Skor (yalnızca `c` ile başlayanlar) | Skor, dakika, durum değişince | satır ~40 bayt |
| RTDB `takim/{takım no}` | Takım adı (bütün takımlar) | Sunucu | Site (yalnızca telefonda sözlük yoksa) | Yeni takım görülünce | takım başına ~20 bayt |
| RTDB `takim_ek/{sürüm}` | O sürümde eklenen ya da değişen takımlar `{ no: ad }`. 30 gün saklanır | Sunucu | Site | Yeni takım görülünce | birkaç yüz bayt |
| RTDB `takim_surum` | Takım listesinin sürümü (zaman, saniye) | Sunucu | Site (canlı) | Yeni takım görülünce | birkaç bayt |
| RTDB `analiz_surum` | Analiz sürümü (son yüklemenin anı, saniye) | Yönetici (yonetim.html) | Site, açılışta bugünün listesi ve Özet geldikten sonra bir kez (dinlenmez) | Analiz yüklenince | ~15 bayt |
| RTDB `lig/{lig no}` | Lig kadro / istatistik veriyor mu (1 / 0) | Sunucu | Site (açılışta bir kez) | Günde en fazla 1 | < 100 bayt |
| RTDB `hizli/{maç no}` | Hızlı kaynağın onaylı skoru `"2-1"` | Hızlı kaynak (bilgisayar) | Site (canlı) | Gol olunca | ~15 bayt |
| RTDB `hizli_u/{maç no}` | Uyarı: `"2-2"` gol bekleniyor, `"k"` genel uyarı | Hızlı kaynak | Site (canlı) | Uyarı başlayıp bitince | ~10 bayt |
| RTDB `hizli_t` | Hızlı kaynağın son çalıştığı an (ms). Yalnızca programın çalıştığını kontrol etmek için | Hızlı kaynak | Yalnızca sen | Dakikada bir | ~20 bayt |
| RTDB `elle/{maç no}` | Elle düzeltme kilidi `{ s: "2-1", d?: "FT", o?: "[olaylar]", t }`: kilit durdukça maçın skoru (ve durumu, olayları) API'nin yerine geçer, bildirim gitmez. Gün listesini, olay günlüğünü ve Özet'i sunucu kilitten yazar (yönetim sayfası yalnızca kilidi ve `maclar`'ı yazar; dün ve sonrası) | Yönetim sayfası | Sunucu, yönetim sayfası | Düzeltmede | ~40 bayt |
| RTDB `yenile/{maç no}` | Maçı hemen API'den yeniden çek isteği; sunucu çekince siler | Yönetim sayfası | Sunucu | İstendiğinde | ~15 bayt |
| R2 `gun/{gün}.json` | Günün bütün maçları `{ "maç no": "satır" }` (`c` olmadan). Canlı maçta hızlı kaynağın skoru varsa (kilitli değilse) o. Arşiv, silinmez | Sunucu | Canlı Skor (bir kez) | Skor ya da durum değişince (hızlı kaynağın golünde de) | 200 maç ~7,7 KB |
| RTDB `olay/{gün}/{anahtar}` | Olay günlüğü (dün ve bugün). Yeni olay: `[maç no, sıra, olay...]`; API eski bir olayı değiştirir ya da silerse maçın tamamı: `[maç no, [olaylar]]`. Anahtar zamana göre sıralı (`"1793431720433-00"`). 2 gün sonra silinir | Sunucu | Site (canlı, yalnızca Özet dosyasına girmemiş satırlar) | Olay olunca | satır ~50 bayt |
| R2 `ozet/{gün}.json` | Dün ve bugünün oynanan ve biten maçlarının olayları `{ t: dahil olan son günlük anahtarı, m: { "maç no": [olaylar] } }`. Arşiv, silinmez | Sunucu | Site (bir kez) | Olay olunca (önce günlük, sonra dosya) | 150 maç ~95 KB |
| Firestore `maclar/{maç no}` | `z`: gzip ile sıkıştırılmış `{ durum, istatistik, kadro, olaylar }`. İstatistik ve kadro; maç bitince olaylar da (istatistik vermeyen liglerde yalnızca olaylar) | Sunucu | Maç sayfası | Canlı maçta en sık dakikada bir; maç bitince ve 2 saat sonra | ~1,5–2 KB, sıkıştırılmış ~0,7–1 KB |
| Firestore `oran_gun/{gün}` | Bugün ve sonraki 7 günün başlamamış maçlarının menü oranları (`z`, gzip: `{ "maç no": "satır" }`) | Sunucu | Oranlar menüsü (seçili gün, bir kez) | Günde 2 kez, değişince | hafta içi ~1,5–2 KB, hafta sonu ~4–5 KB (sıkıştırılmış) |
| Firestore `oran_lig/{lig no}` | Aynı oranlar, ligin 8 günü | Sunucu | Oranlar menüsü (lig seçilince, bir kez) | Günde 2 kez, değişince | ~0,3–1 KB (sıkıştırılmış) |
| Firestore `oran_mac/{maç no}` | Maçın bütün oranları (`z`, gzip) | Sunucu | Maç sayfası, Oranlar sekmesine basılınca (bir kez) | Günde 2 kez, maç başlayınca durur | ~0,3–0,6 KB (sıkıştırılmış) |
| Firestore `sistem/oran` | Son oran güncellemesi: zaman, istek sayısı, maç sayısı, süre | Sunucu | Sunucu (açılışta), sen | Günde 2 kez | < 1 KB |
| Firestore `analiz_futbol/{maç no}`, `analiz_nba/{maç no}` | Analiz dosyasındaki maçın bütün alanları (sıkıştırılmadan; Firestore liste içinde liste kabul etmediği için öyle olan alanlar, ör. `gecmis`, JSON metni) + `gun` (başlama − 7 saat), `dosya_surum`, `dosya_olusturma`, `yuklendi`. Maç numarası analiz kaynağınınki (API'ninkiyle aynı değil) | Yönetici (bilgisayardaki yonetim.html, e-posta/şifre ile) | Detaylı Analiz'e basınca (bir kez) | Dosya yüklenince | ~2–3 KB |
| Firestore `analiz_gun/{gün}`, `analiz_nba_gun/{gün}` | O günün kartları (`z`, gzip: `{ "maç no": kart }`). Futbol kartı: ts, league, home, away, featured_pick, stars, featured_odd, market, result, lineup_label, corner_chip, card_chip, offside_chip, card_reasons, sub_boxes, prob (`[ev, beraberlik, dep]` %). NBA kartı: ts, league, home, away, featured_pick, stars, featured_odd, market, result, chips, badges, reasons, prob (`[ev, dep]` %) | Yönetici | Analiz sekmesi, seçili gün (bir kez) | Dosya yüklenince | ~4–11 KB (sıkıştırılmış) |
| Firestore `analiz_lig/{lig}`, `analiz_nba_lig/{lig}` | O ligin kartları (lig adındaki `/` yerine `-`) | Yönetici | Analiz sekmesi, lig seçilince (bir kez) | Dosya yüklenince | ~1–2 KB (sıkıştırılmış) |
| Firestore `analiz_dizin/futbol`, `analiz_dizin/nba` | `{ gunler: { gün: sayı }, ligler: { lig: sayı } }` (`z`); futbolda ayrıca `karne` (dosyadaki `basari_karnesi`, futbol ve NBA birlikte) ve `kupon` (kupon günlerinin maç sayıları `{ tarih: [futbol, NBA] }`, AI Kuponu gün düğmelerinde) | Yönetici | Analiz sekmesi açılınca (bir kez) | Dosya yüklenince | < 1 KB |
| Firestore `kupon_gun/{tarih}` | AI Kuponu havuzu, maçın takvim gününe (Türkiye saati) göre, futbol ve NBA birlikte (`z`, gzip: `{ "maç no": { s: "f" \| "n", ts, d: tarih, t: saat, league, home, away, prob, opts: [{ pick, odd, prob, stars, cat, why }] } }`). Analiz dosyasındaki `hazir_tercihler`'den (ya da `opts`); tercihi olmayan maç yazılmaz | Yönetici | AI Kuponu sekmesi, seçili günler (Bugün seçiliyse ertesi gün de), bir kez; telefonda `analiz_surum` ile saklanır | Dosya yüklenince | yoğun gün ~35 KB (sıkıştırılmış) |
| Firestore `sistem/durum` | Sunucunun durumu | Sunucu | Yalnızca sen | Dakikada bir | < 1 KB |
| Firestore `zil/{cihaz no}` | Bir cihazın kaydı: `{ token, maclar (zil açılan maçlar), sahip (yazan girişin kimliği), kisi (Google ile giriş yapan kişi, varsa), tur: site / uygulama }`. Cihaz no telefonda saklanır; bir kişinin birden çok cihazı olabilir. Eski biçim `zil/{kimlik}` yenisi yazılınca silinir | Site | Yalnızca sunucu | Kullanıcı zil açıp kapatınca, giriş / çıkışta | ~300 bayt |

**Gün tanımı (sunucu ve site aynı):** maçın günü = başlama saati − 7 saat (00:00–06:59 başlayan maç önceki günün listesindedir); "bugün" = şu an − 4 saat (gün 04:00'te değişir). 04:00–06:59 başlayan ("sabah") maç kendi takvim gününün listesine de yazılır; site 04:00–07:00 arası önceki günün canlı satırlarını ve olay günlüğünü de dinler. Canlı skor 12:30–07:00 arası çekilir.

Sunucu dün, bugün ve 7 gün ilerinin listesini yazar (fikstür: bugün 15 dk, dün ve yarın saatte bir, sonraki günler 6 saatte bir yenilenir). RTDB'deki günler 2 gün sonra silinir; R2'deki günler arşiv olarak kalır.

## Site ne zaman ne okur

| Ne | Bugün ve dün | Diğer geçmiş günler | Yarın ve sonrası |
|---|---|---|---|
| Liste (R2 `gun`) | Bir kez (öne gelince yeniden); gelince gösterilir | Bir kez | Bir kez |
| Canlı satırlar (RTDB `gun`, `c` ile başlayanlar) | Canlı dinlenir; listedekinden önceliklidir; hızlı kaynakla birlikte gelince tek seferde işlenir. `c` kalkınca (maç bittikten 3 dk sonra) son hali listede kalır | Okunmaz | Okunmaz |
| Özet | Bugün: R2 `ozet` bir kez, sonra RTDB `olay` günlüğünden `t`'den sonrası canlı. Dün: R2 `ozet` bir kez | Okunmaz (maç açılınca olaylar `maclar/{no}`'dan) | Okunmaz |

- Gece penceresi: 23:55–00:00 yarının, 00:00–02:30 dünün olay günlüğü de canlı dinlenir (gece yarısını geçen maçlar).
- Uygulama öne gelince Özet yeniden okunmaz, günlük kalınan yerden sürer.
- İstatistikteki "Kart" sayısı `maclar/{no}` istatistiğindeki sarı + kırmızı karttan.
- Bugün her zaman dinlenir. Dün yalnızca seçiliyken dinlenir (gece yarısını geçen maçlar ve maç sonu düzeltmeleri için).
- Takım adları telefonda saklanır; yalnızca `takim_surum` dinlenir. Değişince yalnızca son bakılandan sonraki `takim_ek` kayıtları iner; telefonda sözlük yoksa ya da 25 günden eskiyse `takim`'ın tamamı iner.
- Maç açılınca `maclar/{no}` dinlenir, maç kapanınca bırakılır.
- Uygulama arka plana geçince bütün dinlemeler durur, RTDB bağlantısı kapanır.

- `hizli`, `hizli_u` canlı dinlenir (dallarda yalnızca oynanan maçlar durur).
- Oranlar menüsü açılınca seçili günün `oran_gun` dokümanı, lig seçilince o ligin `oran_lig` dokümanı bir kez okunur. Maç sayfasında Oranlar sekmesine gelince `oran_mac/{no}` bir kez okunur. Okunan oran dokümanı 1 saatten eskiyse yeniden okunur.
- Kayıtlı Oranlarım telefonda saklanır (Firestore'a yazılmaz).
- Analiz sekmesi ilk açılınca `analiz_dizin/futbol` ve bugünün `analiz_gun` dokümanı okunur; başka gün seçilince o günün `analiz_gun`, lig seçilince `analiz_lig`, Detaylı Analiz'e basınca `analiz_futbol/{no}` bir kez okunur. Üstte basketbol seçiliyse aynısı NBA dokümanlarından (`analiz_dizin/nba`, `analiz_nba_gun`, `analiz_nba_lig`, `analiz_nba/{no}`). Başarı Karnesi `analiz_dizin/futbol`'daki `karne`'den. AI Kuponu sekmesi ilk açılınca seçili günlerin `kupon_gun` dokümanları okunur; kupon telefonda kurulur (ek okuma yok), kupondaki maça basınca Detaylı Analiz (`analiz_futbol/{no}` ya da `analiz_nba/{no}`). Okunan analiz dokümanları telefonda `analiz_surum` ile saklanır; sürüm aynıysa Firestore'dan yeniden okunmaz (geçmiş günler ve 1 günden eski maçlar telefondan silinir).

## Hızlı kaynak (`hizli`, `hizli_u`)

- Canlı maçta iki kaynaktan (API, hızlı) en son değişen skor gösterilir. Açılışta farklıysa hızlı kaynağınki.
- Biten maçta (API'de canlı değil) hızlı kaynağa bakılmaz.
- Canlı maçta hızlı skor API'ninkinden 2 dk farklı kalırsa sunucu o maçın `hizli` ve `hizli_u` kaydını siler.
- Telefon bildirimi (sunucu) golü ve iptali hangi kaynak önce görürse ondan gönderir, aynı skor için bir kez.
- `hizli_u` varken (yalnızca top oyundayken) satır hafif kırmızı olur; `"2-2"`de beklenen takımın yanında kırmızı nokta. Uyarı geldikten sonra skor değişirse (hangi kaynaktan olursa) kırmızı kalkar.
- Skor değişince o maçta 1 dk `"k"` uyarısı gösterilmez; `"2-2"` (nokta) gösterilir.
- Kurallar: yalnızca hızlı kaynağın kullanıcısı yazabilir; değer `2-1` ya da (uyarıda) `k` biçiminde olmalı.

---

## RTDB `gun/{gün}`

Örnek: `gun/2026-10-25/1584444` → `"203,9,994,6343,2030,67,2,1"`
Gün Türkiye saatine göredir. Anahtar API-Football'un maç numarasıdır.

### Canlı skor satırı

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

**Hafta:** ligde sayı (`9`). Kupada: `3T` 3. tur, `S16` son 16, `S32`, `S64`, `CF` çeyrek final, `YF` yarı final, `F` final, `G` grup aşaması, `PO` play-off. Bilinmeyen tur API'nin yazdığı gibi.

**Başta `c`:** maç canlı ya da 3 dakika içinde bitti (b1); site yalnızca bunları RTDB'den dinler. 3 dakika sonra `c` kalkar (b2). R2'deki satırlarda `c` yoktur.

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

## R2 `ozet/{gün}.json`

| Alan | Açıklama |
|---|---|
| `t` | Dosyaya dahil olan son olay günlüğü anahtarı |
| `m` | `{ "maç no": [olaylar], … }`. Yalnızca oynanan ve biten maçlar. Olayı olmayan maçta `[]` |

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

## `maclar/{maç no}`

Kadro ve istatistik veren liglerde maç öncesi ve canlıyken; bütün liglerde maç bitince yazılır.
Tek alan `z`: aşağıdaki nesnenin gzip ile sıkıştırılmış hali (eski dokümanlarda alanlar ayrı ayrı metin olabilir).

| Alan | Açıklama |
|---|---|
| `durum` | Maçın durumu |
| `istatistik` | `[[ev sahibi 19 değer], [deplasman 19 değer]]`. Henüz yoksa `null` |
| `kadro` | `[ev sahibi kadrosu, deplasman kadrosu]`. Henüz açıklanmadıysa `null` |
| `olaylar` | Yalnızca maç bitince: maçın bütün olayları (Özet'teki biçimde) |

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

### `oran_mac/{maç no}` (olmayan oran yazılmaz)

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

## Mesajlar (Realtime Database)

Maç sayfasındaki Yorumlar. Okuma herkese açık, yazmak / oy / şikayet için Google ile giriş ve rumuz gerekir. Sınırları kurallar (`database.rules.json`) denetler; mesajlarla ilgili bütün yazmalar yalnızca Google ile girişte (görünmez giriş yazamaz).

| Yer | Ne | Kim yazar | Kim okur |
|---|---|---|---|
| `mesaj/{maç no}/{mesaj}` | `{ u: yazanın kimliği, r: rumuz, t: metin (≤ 100 karakter), z: zaman (ms), g: gün no, y: yanıtlanan mesaj (Yanıtla ile), b: beğeni, d: beğenmeme }`. Yalnızca `acik`'taki maçlara yazılır; değiştirilemez, yazan silebilir. `b`, `d` sunucu yazar | Kullanıcı (sunucu: b, d, uygunsuzsa siler) | Yorumlar sekmesi: son 10 canlı; "Daha fazla göster" daha eski 10 mesajı bir kez okur (en fazla 100, eldekiler yeniden inmez) |
| `sayac/{kimlik}` | `{ g: gün no, n: o gün yazılan mesaj }`. Gün no = (zaman + 3 saat) / 1 gün. En fazla 20; mesajla aynı anda 1 artar, silinemez | Kullanıcı | Kullanıcının kendisi |
| `oy/{maç}/{mesaj}/{kimlik}` | `{ v: 1 beğeni, -1 beğenmeme, 0 geri alındı, n: kaç kez değişti }`. İlk oy n = 0, en fazla 2 değişiklik. Kendi mesajına oy verilemez | Kullanıcı | Kullanıcının kendisi, sunucu (sayım) |
| `kuyruk/{...}` | `{ m: maç, i: mesaj, u: kimlik }`: yeni mesaj ve oy. Sunucu işleyip siler | Kullanıcı | Sunucu |
| `mesajlarim/{kimlik}/{maç}/{mesaj}` | Kişinin mesajları (hesap silinince mesajları silmek için) | Kullanıcı (sunucu: uygunsuz mesaj silinince) | Kullanıcının kendisi |
| `kullanici/{kimlik}` | `{ r: rumuz, k: kuralların kabul zamanı, b: true = yanıt bildirimleri kapalı }` | Kullanıcı | Kullanıcının kendisi |
| `rumuz/{küçük harfle rumuz}` | Rumuzun sahibi (benzersizlik). 3–15 karakter: harf (Türkçe dahil), rakam, alt çizgi | Kullanıcı | Herkes (alınmış mı) |
| `rumuz_zaman/{kimlik}` | Son rumuz değişikliği (ms); haftada bir. Hesap silinse de kalır | Kullanıcı | Kullanıcının kendisi |
| `acik/{maç no}` | Mesaj yazılabilen maçlar: sunucunun gördüğü her maç, silinmez | Sunucu | Yalnızca kurallar |
| `engel/{kimlik}/{engellenen}` | true. Engellenenin mesajları gizlenir, ondan yanıt bildirimi gelmez. Girişte okunur, telefondaki listeyle birleşir | Kullanıcı | Kullanıcının kendisi, sunucu |
| `sessiz/{kimlik}/{maç}_{mesaj}` | true: kişinin kendi mesajına gelen yanıtlardan bildirim almaz | Kullanıcı | Kullanıcının kendisi, sunucu |
| `sikayet/{maç}_{mesaj}/{kimlik}` | Şikayet zamanı (her kişi bir kez) | Kullanıcı | Sen (ileride yönetim sayfası) |

- Küfür ve bağlantı filtresi: depodaki `kufur.json` (kök, tam kelime, bağlantı, izinli kelimeler). Site yazarken bir kez indirir; sunucu kuyruktaki her mesajı (metin ve rumuz) kontrol eder, uygunsuzsa siler.
- Yanıt bildirimi: yeni mesajda `@rumuz` (en fazla 2) geçerse sunucu o kişiye bildirim gönderir (bildirim izni vermiş ve zil kaydı olan cihaza; bağlantı `#mac={no}&yorum` Yorumlar'ı açar). Gitmez: kendine, yanıt bildirimlerini kapatana, göndereni engelleyene, yanıtlanan mesajı için bildirimi kapatana, aynı gönderenden 10 dakika içinde ikinci kez. İzin ilk mesajdan sonra bir kez sorulur.
- Hesap silinince: mesajlar, `mesajlarim`, `kullanici`, `engel`, `sessiz`, rumuz ve giriş kaydı silinir; oylar ve `sayac`, `rumuz_zaman` kalır.
- Henüz yok: 100'den eski mesajları silme, mesajların saklanma süresi, yönetim sayfasında şikayetler.

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
