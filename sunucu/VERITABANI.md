# Veritabanı

İki veritabanı var:

- **Realtime Database (RTDB):** canlı skor listesi ve takım adları. Küçük ve sık değişen veri. Yalnızca değişen satır gönderilir.
- **Firestore:** Özet (olaylar), maç detayı, bildirim kayıtları, sunucu durumu.

Dokümanları sunucu yazar; `zil/{gizli kimlik}` kayıtlarını site (kullanıcının cihazı), `hizli` dallarını hızlı kaynak (başka bir bilgisayardaki skor sunucusu, ayrı bir kullanıcıyla) yazar. Bir şey değişmediyse yeniden yazılmaz.
Firestore dokümanlarında `guncellendi` alanı son yazma zamanıdır.

| Yer | Ne var | Kim yazar | Kim okur | Ne zaman değişir | Boyut |
|---|---|---|---|---|---|
| RTDB `gun/{gün}/{maç no}` | Günün maçları, her maç bir satır | Sunucu | Canlı Skor | Skor, dakika, durum değişince | satır ~40 bayt, 150 maç ~6 KB |
| RTDB `takim/{takım no}` | Takım adı | Sunucu | Site (telefonda saklanır) | Yeni takım görülünce | 300 takım ~6 KB |
| RTDB `takim_surum` | Takım listesinin sürümü | Sunucu | Site | Yeni takım görülünce | birkaç bayt |
| RTDB `lig/{lig no}` | Lig kadro / istatistik veriyor mu (1 / 0) | Sunucu | Site (açılışta bir kez) | Günde en fazla 1 | < 100 bayt |
| RTDB `hizli/{maç no}` | Hızlı kaynağın onaylı skoru `"2-1"` | Hızlı kaynak (bilgisayar) | Site (canlı) | Gol olunca | ~15 bayt |
| RTDB `hizli_u/{maç no}` | Uyarı: `"2-2"` gol bekleniyor, `"k"` genel uyarı | Hızlı kaynak | Site (canlı) | Uyarı başlayıp bitince | ~10 bayt |
| RTDB `hizli_t` | Hızlı kaynağın son çalıştığı an (ms). Yalnızca programın çalıştığını kontrol etmek için | Hızlı kaynak | Yalnızca sen | Dakikada bir | ~20 bayt |
| Firestore `ozet/{gün}` | Günün oynanan ve biten maçlarının olayları | Sunucu | Canlı Skor, maç sayfası (Özet) | Olay olunca, en fazla 15 sn'de bir | 150 maç ~60–80 KB |
| Firestore `maclar/{maç no}` | İstatistik ve kadro | Sunucu | Maç sayfası | Canlı maçta en sık dakikada bir | ~1,5 KB |
| Firestore `sistem/durum` | Sunucunun durumu | Sunucu | Yalnızca sen | Dakikada bir | < 1 KB |
| Firestore `zil/{gizli kimlik}` | Bir cihazın zil açtığı maçlar (bildirim için) | Site | Yalnızca sunucu | Kullanıcı zil açıp kapatınca | ~300 bayt |

Eski günler silinmez (takvimden açılabilsin diye).

## Site ne zaman ne okur

| Ne | Bugün ve dün | Diğer geçmiş günler | Yarın ve sonrası |
|---|---|---|---|
| Liste (RTDB `gun`) | Açılışta bir kez, sonra canlı dinlenir | Bir kez | Bir kez |
| Özet (Firestore `ozet`) | Listeden sonra arkada, sonra canlı dinlenir | Bir kez | Okunmaz |

- Bugün her zaman dinlenir. Dün yalnızca seçiliyken dinlenir (gece yarısını geçen maçlar ve maç sonu düzeltmeleri için).
- Takım adları telefonda saklanır; yalnızca `takim_surum` dinlenir, değişince `takim` yeniden indirilir.
- Maç açılınca `maclar/{no}` dinlenir, maç kapanınca bırakılır.
- Uygulama arka plana geçince bütün dinlemeler durur, RTDB bağlantısı kapanır.

- `hizli`, `hizli_u` canlı dinlenir (dallarda yalnızca oynanan maçlar durur).

## Hızlı kaynak (`hizli`, `hizli_u`)

- Canlı maçta iki kaynaktan (API, hızlı) en son değişen skor gösterilir. Açılışta farklıysa hızlı kaynağınki.
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
| 5 | Başlama saati (Türkiye saati) | 2030 (20:30) |
| 6 | Durum (aşağıda) | 67 |
| 7 | Ev sahibi gol | 2 |
| 8 | Deplasman gol | 1 |

**Hafta:** ligde sayı (`9`). Kupada: `3T` 3. tur, `S16` son 16, `S32`, `S64`, `CF` çeyrek final, `YF` yarı final, `F` final, `G` grup aşaması, `PO` play-off. Bilinmeyen tur API'nin yazdığı gibi.

**Durum:** boş = başlamadı; sayı = oynanıyor, dakika (`67`, uzatmada `45+2`); diğerlerinde aşağıdaki kodlar.

### Durumlar

| Kod | Anlamı |
|---|---|
| TBD | Saati belli değil |
| 1H, 2H, ET | 1. yarı, 2. yarı, uzatma (dakika bilinmiyorsa; biliniyorsa dakika yazar) |
| HT | Devre arası |
| BT, P | Uzatma arası, penaltılar |
| SUSP, INT | Askıya alındı, durduruldu |
| FT | Bitti |
| AET, PEN | Uzatmada bitti, penaltılarla bitti |
| PST, CANC, ABD | Ertelendi, iptal, yarıda kaldı |
| AWD, WO | Hükmen |

## Firestore `ozet/{gün}`

| Alan | Açıklama |
|---|---|
| `m` | Metin: `{ "maç no": [olaylar], … }`. Yalnızca oynanan ve biten maçlar. Olayı olmayan maçta `[]` |

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

Yalnızca kadro ve istatistik veren liglerde yazılır. Olaylar burada yok, `ozet/{gün}` dokümanında.

| Alan | Açıklama |
|---|---|
| `durum` | Maçın durumu |
| `istatistik` | Metin: `[[ev sahibi 19 değer], [deplasman 19 değer]]`. Henüz yoksa `null` |
| `kadro` | Metin: `[ev sahibi kadrosu, deplasman kadrosu]`. Henüz açıklanmadıysa `null` |

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

## `sistem/durum`

| Alan | Açıklama |
|---|---|
| `calisiyor` | true |
| `son_tur` | Sunucunun son çalıştığı zaman. **Birkaç dakikadan eskiyse sunucu durmuş demektir** |
| `son_canli_istek` | Son canlı skor isteği |
| `canli_mac` | Şu an canlı maç sayısı |
| `takip_edilen_mac` | Dün, bugün ve yarın takip edilen maç sayısı |
| `kalan_istek` / `gunluk_hak` | API-Football'da bugün kalan istek / günlük hak |
| `acilistan_beri_istek` / `acilistan_beri_yazma` | Sunucu son açıldığından beri API isteği / Firestore yazması |
| `son_hata` | Son turdaki hata (yoksa `null`) |

---

## `zil/{gizli kimlik}`

Kullanıcı bir maçın zilini açınca (ve bildirim izni verdiyse) site yazar. Gizli kimlik, görünmez girişin (anonim) verdiği kimliktir; üyelik gerekmez.

| Alan | Açıklama |
|---|---|
| `token` | Cihazın bildirim kimliği (Firebase verir) |
| `maclar` | Zili açık maçların numaraları, en fazla 100 |
| `guncellendi` | Son yazma zamanı |

Sunucu bu kayıtları dinler ve cihazı her maçın bildirim konusuna (`mac-{maç no}`) abone eder. Bildirimler:
gol, VAR gol iptali, kırmızı kart, maç başladı, devre arası, maç sonu. Yalnızca canlı saatlerde (12:30–01:00) gönderilir.
