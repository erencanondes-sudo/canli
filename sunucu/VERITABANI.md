# Veritabanı (Firestore)

Bütün dokümanları yalnızca sunucu yazar. Her dokümanda `guncellendi` alanı son yazma zamanıdır.
Bir doküman değişmediyse yeniden yazılmaz.

| Koleksiyon / doküman | Ne var | Kim okur | Ne zaman değişir | Boyut |
|---|---|---|---|---|
| `gunler/{gün}-{grup}` | O günün maçları, 50'şer maçlık gruplar | Ana sayfa | Maç başlayınca, bitince, fikstür değişince | grup başına ~2–30 KB |
| `canli/simdi` | Şu an oynanan maçlar (skor, dakika, olaylar) | Ana sayfa, maç sayfası | Canlı maç varken en sık 15 sn'de bir | ~1–5 KB |
| `maclar/{maç no}` | İstatistik ve kadro | Maç sayfası | Canlı maçta en sık dakikada bir | ~1,5 KB |
| `sistem/durum` | Sunucunun durumu | Yalnızca sen | Dakikada bir | < 1 KB |

---

## `gunler/{gün}-{grup}`

Örnek: `gunler/2026-10-25-1` → 25 Ekim'in 1. grubu (ilk 50 maç).
Gün, Türkiye saatine göredir. Maçlar lig sırasına (ayarlar.js), sonra başlama saatine göre dizilir.

| Alan | Açıklama |
|---|---|
| `gun` | `2026-10-25` |
| `grup` | Kaçıncı grup (1, 2, 3…) |
| `grup_sayisi` | O gün kaç grup var (maç yoksa 0) |
| `maclar` | Maç satırları listesi. Her satır bir metin (aşağıda) |
| `takimlar` | Bu gruptaki takımların adları: `{ "994": "Göztepe" }` |
| `ligler` | Bu gruptaki ligler: `{ "203": { ad: "Süper Lig", detay: true } }`. `detay: false` olan ligde kadro ve istatistik yok |
| `diger_gruplar` | Yalnızca 1. grupta: diğer grupların maç numaraları `{ "2": [...], "3": [...] }`. Lig filtresi ve kayıtlı maçlar için |

**Canlı maçlar** grupta `CANLI` durumuyla, skorsuz durur. Güncel halleri `canli/simdi` dokümanındadır.
Maç bitince olaylarıyla birlikte gruba yazılır ve `canli/simdi`'den çıkar.

## `canli/simdi`

| Alan | Açıklama |
|---|---|
| `maclar` | Canlı maçların satırları (aşağıdaki biçimde, olaylarıyla) |
| `takimlar`, `ligler` | Yukarıdaki gibi |

## Maç satırı

Her satır sırası sabit bir listedir:

```
[1584444, 203, 1792944000, "FT", 90, 5, 994, 6343, 2, 0, 2, 0, [olaylar], 9]
```

| Sıra | Ne | Örnek |
|---|---|---|
| 0 | Maç no | 1584444 |
| 1 | Lig no | 203 |
| 2 | Başlama zamanı (saniye) | 1792944000 |
| 3 | Durum (aşağıda) | "FT" |
| 4 | Dakika | 90 |
| 5 | Uzatma dakikası | 5 (90+5) |
| 6 | Ev sahibi takım no | 994 |
| 7 | Deplasman takım no | 6343 |
| 8 | Ev sahibi gol | 2 |
| 9 | Deplasman gol | 0 |
| 10 | İlk yarı ev sahibi | 2 |
| 11 | İlk yarı deplasman | 0 |
| 12 | Olaylar (yalnızca biten ve canlı maçlarda) | `[[3, null, 0, "g", "n", "A. Antunes", null], …]` |
| 13 | Hafta. Ligde sayı (9), kupada tur adı API'nin yazdığı gibi ("Round of 16") | 9 |

Boş olan yerlerde `null` yazar.

### Durumlar

| Kod | Anlamı |
|---|---|
| NS | Başlamadı |
| TBD | Saati belli değil |
| 1H, 2H | 1. yarı, 2. yarı |
| HT | Devre arası |
| ET, BT, P | Uzatma, uzatma arası, penaltılar |
| SUSP, INT | Askıya alındı, durduruldu |
| FT | Bitti |
| AET, PEN | Uzatmada bitti, penaltılarla bitti |
| PST, CANC, ABD | Ertelendi, iptal, yarıda kaldı |
| AWD, WO | Hükmen |
| CANLI | (Yalnızca grup dokümanında) güncel hali `canli/simdi`'de |

### Olay

```
[dakika, uzatma, taraf, tür, ayrıntı, oyuncu, ikinci oyuncu]
```

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

Yalnızca kadro ve istatistik veren liglerde yazılır. Olaylar burada yok, ana sayfa satırında.

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
