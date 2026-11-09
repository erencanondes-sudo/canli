# Veritabanı

Odalar, bir dosya deposu ve iki veritabanı var:

- **Odalar (Cloudflare Durable Objects, `oda/` klasörü, Worker adı `canli-oda`):** canlı veri. Gün odası (günün listesi, Özet, hızlı kaynak) ve maç odası (maçın içeriği). Telefon odaya açık bir hatla (WebSocket) bağlanır; oda değişenleri kendisi gönderir. Ayrıntı: aşağıda "Odalar".
- **Cloudflare R2 (kova `canli`):** günün maç listesi, Özet ve kesinleşmiş maçların içeriği, JSON dosyası olarak (arşiv, silinmez). Sunucu yazar (anahtarlar `/etc/canli/anahtar.env`: `R2_ADRES`, `R2_KIMLIK`, `R2_GIZLI`); site Cloudflare Pages'teki okuyucudan (`functions/veri`, kovaya `DEPO` adıyla bağlı) `/veri/gun/{gün}.json`, `/veri/ozet/{gün}.json`, `/veri/mac/{no}.json`, `/veri/takim.json`, `/veri/lig.json` olarak okur. Okuyucu bugün, dün ve ilerideki günleri ve takım adlarını önbelleğe aldırmaz (her açılışta en son hali), daha eski günleri, maç dosyalarını ve lig bilgisini 1 saat tutturur.
- **Realtime Database (RTDB):** yalnızca mesajlar (aşağıda "Mesajlar").
- **Firestore:** oranlar, analizler, bildirim kayıtları, sunucu durumu; yönetim sayfasının elle düzeltme kilitleri ve istekleri.

Dokümanları ve odaları sunucu yazar; `zil/{gizli kimlik}` kayıtlarını site (kullanıcının cihazı), gün odasındaki hızlı skoru ve uyarıyı (`h`, `u`) hızlı kaynak (başka bir bilgisayardaki skor sunucusu, kendi anahtarıyla) yazar. Bir şey değişmediyse yeniden yazılmaz.
Firestore dokümanlarında `guncellendi` alanı son yazma zamanıdır. Büyük dokümanlar (oranlar, analizler) gzip ile sıkıştırılmış `z` alanında durur; Console'da okunamaz, site açar.

| Yer | Ne var | Kim yazar | Kim okur | Ne zaman değişir | Boyut |
|---|---|---|---|---|---|
| Gün odası `gun/{gün}` | Günün maçlarının satırları (`r`), Özet (`o`), canlı maçlarda hızlı kaynağın skoru (`h`) ve uyarısı (`u`). Ayrıntı: "Odalar" | Sunucu | Canlı Skor: bugün ve dün (bağlanınca hepsi, sonra değişenler) | Skor, dakika, durum, olay, hızlı skor değişince | satır ~40 bayt |
| Maç odası `mac/{maç no}` | Maçın içeriği `{ durum, istatistik, kadro, olaylar }` (aşağıda "Maç içeriği"). Maç kesinleşince boşaltılır | Sunucu | Maç sayfası (açıkken) | Canlı maçta en sık 2 dk'da bir; maç bitince | ~2–4 KB |
| R2 `takim.json` | Bütün takımların adları `{ s: sürüm (zaman, saniye), t: { "takım no": ad } }`. Silinmez | Sunucu | Site (yalnızca sürüm telefondakinden farklıysa; sürüm gün odasından `v.takim`), hızlı kaynak, yönetim sayfası | Yeni takım görülünce | takım başına ~20 bayt |
| R2 `lig.json` | Liglerin kadro / istatistik verip vermediği `{ "lig no": 1 / 0 }` | Sunucu | Site (açılışta bir kez) | Günde en fazla 1 | < 1 KB |
| Firestore `elle/{maç no}` | Elle düzeltme kilidi `{ s: "2-1", d?: "FT", o?: "[olaylar]", t }`: kilit durdukça maçın skoru (ve durumu, olayları) API'nin yerine geçer, bildirim gitmez. Gün listesini, Özet'i ve maç içeriğini sunucu kilitten yazar; kilit konunca, değişince ve kalkınca maç API'den yeniden çekilir, konunca maçın hızlı kaydı silinir (yönetim sayfası yalnızca kilidi yazar; dün ve sonrası) | Yönetim sayfası | Sunucu (dinler), yönetim sayfası | Düzeltmede | ~40 bayt |
| Firestore `istek/{ad}` | Yönetim sayfasının sunucudan istediği iş `{ tur, mac?, t }`: `yenile_{maç}` maçı API'den yeniden çek, `hizli_sil_{maç}` maçın hızlı kaydını sil, `hizli_sil_hepsi` bütün hızlı kayıtları sil. Sunucu işi yapınca siler (yönetim sayfası bunu bekler) | Yönetim sayfası | Sunucu (dinler) | İstendiğinde | ~50 bayt |
| R2 `gun/{gün}.json` | Günün bütün maçları `{ "maç no": "satır" }`. Canlı maçta hızlı kaynağın skoru varsa (kilitli değilse) o. Arşiv, silinmez | Sunucu | Canlı Skor: dünden eski günler, yarın ve sonrası (bir kez); gün odasına bağlanılamazsa bugün ve dün de | Skor ya da durum değişince (hızlı kaynağın golünde de) | 200 maç ~7,7 KB |
| R2 `ozet/{gün}.json` | Dün ve bugünün oynanan ve biten maçlarının olayları `{ m: { "maç no": [olaylar] } }`. Arşiv, silinmez | Sunucu | Site: dünden önceki son 7 gün (bir kez; bugün ve dün gün odasından); yönetim sayfası | Olay olunca | 150 maç ~95 KB |
| R2 `mac/{maç no}.json` | Kesinleşmiş maçın içeriği `{ durum, istatistik, kadro, olaylar, g: yazma anı (ms) }`. Maç bitince 2 saat sonraki son çekişte yazılır (elle düzeltmede yeniden). Arşiv, silinmez | Sunucu | Maç sayfası (maç odası boşsa, bir kez) | Maç kesinleşince | ~2–4 KB |
| Firestore `maclar/{maç no}` | Eski maç içerikleri (artık yazılmıyor). Yönetim sayfası düzeltmede hâlâ bakar; doküman yoksa o adımı atlar | — | — | — | — |
| Firestore `oran_gun/{gün}` | Bugün ve sonraki 7 günün başlamamış maçlarının menü oranları (`z`, gzip: `{ "maç no": "satır" }`) | Sunucu | Oranlar menüsü (seçili gün, bir kez) | Günde 2 kez, değişince | hafta içi ~1,5–2 KB, hafta sonu ~4–5 KB (sıkıştırılmış) |
| Firestore `oran_lig/{lig no}` | Aynı oranlar, ligin 8 günü | Sunucu | Oranlar menüsü (lig seçilince, bir kez) | Günde 2 kez, değişince | ~0,3–1 KB (sıkıştırılmış) |
| Firestore `oran_mac/{maç no}` | Maçın bütün oranları (`z`, gzip) | Sunucu | Maç sayfası, Oranlar sekmesine basılınca (bir kez) | Günde 2 kez, maç başlayınca durur | ~0,3–0,6 KB (sıkıştırılmış) |
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
| Özet | Gün odası: listeden hemen sonra hepsi, sonra değişenler | Son 7 gün: R2 `ozet` bir kez. Daha eskiler okunmaz (maç açılınca olaylar R2 maç dosyasından) | Okunmaz |

- Dün yalnızca seçiliyken ve 04:00–07:00 arası (gece yarısını geçen maçlar) bağlı kalır.
- Uygulama arka plana geçince oda bağlantıları kapanır; öne gelince yeniden bağlanır ve yalnızca kaçırılan değişiklikler gelir.
- İstatistikteki "Kart" sayısı maç içeriğindeki istatistikte sarı + kırmızı karttan.
- Bugün her zaman dinlenir. Dün yalnızca seçiliyken dinlenir (gece yarısını geçen maçlar ve maç sonu düzeltmeleri için).
- Takım adları telefonda saklanır. Sürüm bugünün gün odasından gelir (`v.takim`); telefondakinden farklıysa R2 `takim.json`'un tamamı bir kez iner. Odaya bağlanılamazsa ve telefonda sözlük yoksa dosya yine iner.
- Maç açılınca maç odasına bağlanılır, maç kapanınca bırakılır. Odada içerik yoksa R2 `mac/{no}.json` okunur (dosya varsa oda bırakılır).
- Uygulama arka plana geçince bütün dinlemeler durur, RTDB ve oda bağlantıları kapanır.
- Hızlı kaynağın skoru ve uyarısı gün odasından gelir (yalnızca canlı ve kilitli olmayan maçlar).
- Oranlar menüsü açılınca seçili günün `oran_gun` dokümanı, lig seçilince o ligin `oran_lig` dokümanı bir kez okunur. Maç sayfasında Oranlar sekmesine gelince `oran_mac/{no}` bir kez okunur. Okunan oran dokümanı 1 saatten eskiyse yeniden okunur.
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

## Odalar

Cloudflare Durable Objects; kodu `oda/src/index.js`, Cloudflare'de `canli-oda` Worker'ı (GitHub'daki `oda/` klasöründen kendisi yüklenir). Her oda kendi küçük deposunu tutar; kimse bağlı değilken uyur. Odalar Doğu Avrupa'da kurulur (`eeur`, Türkiye'ye en yakın bölge); `/bak` sayfasındaki `konum` odanın bulunduğu merkezdir (ör. `WAW` Varşova).

- **Telefon bağlanır:** `wss://{site}/oda/gun/{gün}`, `wss://{site}/oda/mac/{no}`. Site bunu Cloudflare Pages'teki geçitten (`functions/oda`, Worker'a `ODA` adıyla bağlı) geçirir.
- **Sunucu yazar:** `POST {ODA_ADRES}/yaz/gun/{gün}`, `POST {ODA_ADRES}/yaz/mac/{no}`; boşaltma `DELETE` ile. Hızlı kaynak: `POST {ODA_ADRES}/hizli/gun/{gün}` (yukarıda "Hızlı kaynak"). Anahtarlar `/etc/canli/anahtar.env`: `ODA_ADRES` (Worker'ın adresi), `ODA_ANAHTAR` (Cloudflare'de aynı anahtar: canli-oda → Settings → Variables and Secrets).
- **Sen bakarsın:** tarayıcıda `{ODA_ADRES}/bak/gun/2026-11-09?anahtar={ODA_ANAHTAR}` ya da `/bak/mac/{no}?anahtar=...`. Odanın şu anki hali, sıra numarası, bağlı telefon sayısı ve (gün odasında) son 20 değişiklik görünür.
- **Sıra numarası:** odadaki her değişiklik 1 artar. Telefon yeniden bağlanırken son aldığı numarayı ve odanın kimliğini gönderir; oda yalnızca kaçırılanları yollar (gün odası son 1000 değişikliği saklar, daha eskiyse hepsini baştan gönderir).
- **Yoklama:** telefon 45 sn'de bir `p` gönderir, oda uyanmadan `o` cevabı gider (mobil ağlar boştaki bağlantıyı kesmesin).

### Gün odası `gun/{gün}`

| Alan | Ne |
|---|---|
| `r` | `{ "maç no": "satır" }` (aşağıda "Canlı skor satırı"). API'nin skoru |
| `o` | `{ "maç no": [olaylar] }` (Özet; oynanan ve biten maçlar, dün ve bugün) |
| `h` | `{ "maç no": "2-1" }` hızlı kaynağın skoru (programın yazdığı gibi; kilitli maçta sunucu siler) |
| `u` | `{ "maç no": "2-2" / "k" }` hızlı kaynağın uyarısı |
| `v` | Sürümler `{ takim, analiz }`: takım adları (R2 `takim.json`) ve analiz dosyası (Firestore `analiz_dizin/futbol` → `surum`) |

`r`, `o`, `v`'yi sunucu her seferinde o günün **tam hali** olarak gönderir (yalnızca son gönderilenden farklı alanlar). Oda kendi haliyle karşılaştırır, yalnızca değişenleri saklar ve telefonlara iletir. `h`, `u`'yu hızlı kaynak yalnızca değişenler olarak yazar.

Telefona giden mesajlar:

| Mesaj | Ne zaman |
|---|---|
| `{ t: "l", k, s, z, r, h, u, v }` | İlk bağlanışta (ya da kaçırılanlar saklanandan eskiyse): liste, hızlı kaynak, sürümler |
| `{ t: "o", o }` | Listeden hemen sonra: Özet |
| `{ t: "h", k, s, z, n }` | Yeniden bağlanışta: ardından kaçırılan `n` değişiklik gelir |
| `{ t: "d", s, r?, o?, h?, u?, v? }` | Değişiklik: yalnızca değişenler, `null` = silindi |

`k` odanın kimliği, `s` sıra numarası, `z` sunucu saati (ms; dakika telefonun saati yanlış olsa da doğru hesaplansın diye).

### Maç odası `mac/{maç no}`

İçerik aşağıdaki "Maç içeriği". Telefona: bağlanınca ve her değişince `{ t: "m", k, s, g: değişme anı (ms), d: içerik }`; telefondaki güncelse `{ t: "h" }`; odada içerik yoksa `{ t: "y" }` (maç kesinleştiyse içerik R2 `mac/{no}.json`'da). Maç kesinleşince sunucu içeriği R2'ye yazar ve odayı boşaltır.

## Canlı skor satırı

Örnek: `"203,9,994,6343,2030,67,2,1"`. Gün Türkiye saatine göredir. Anahtar API-Football'un maç numarasıdır.

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
