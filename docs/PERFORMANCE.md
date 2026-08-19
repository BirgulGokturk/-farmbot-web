# Performans

HMI'nin ilk yükleme performansı üzerine yapılan çalışmanın kaydı: hangi sorunlar
vardı, neden oluştular, ne değişti.

Ölçüm aracı PageSpeed Insights (Lighthouse), hedef sayfa `/viewer`. Oturum
açılmamışken bu adres giriş ekranına düştüğü için ölçülen aslında giriş ekranıdır.

## Sonuç

| Metrik (mobil, Slow 4G) | Önce | Sonra |
| --- | --- | --- |
| Performans skoru | 69 | **99** |
| First Contentful Paint | 5,0 sn | **1,4 sn** |
| Largest Contentful Paint | 5,0 sn | **1,8 sn** |
| Speed Index | 5,0 sn | **2,5 sn** |
| Total Blocking Time | 10 ms | **0 ms** |
| Cumulative Layout Shift | 0.001 | **0** |
| İlk yüklemede inen JS | 462 KiB | **114 KiB** |
| İlk yüklemede inen font | 167 KiB | **63 KiB** |
| Toplam istek | 6 | **4** |
| Üçüncü taraf origin | 2 | **0** |

Masaüstünde FCP 0,3 sn · LCP 0,4 sn · Speed Index 0,5 sn.

## Sorun 1 — React yanlış chunk'ın içine hapsolmuştu

`vite.config.ts` içinde ağır kütüphaneleri ayırmak için elle yazılmış bir
bölme kuralı vardı:

```js
manualChunks(id) {
  if (id.includes("three") || id.includes("@react-three")) return "three";
  if (id.includes("recharts") || id.includes("d3-")) return "charts";
}
```

Bu substring eşleşmesi amaçlananın ötesine geçti ve **React'i `charts`
chunk'ına, react-dom + scheduler'ı `three` chunk'ına** mühürledi. Entry'de
React kalmayınca entry bu iki chunk'ı statik import etmek zorunda kaldı;
`index.html` de ikisini `modulepreload` ile önden çekti.

Sonuç: giriş ekranını görmek için **1,45 MB JavaScript** indirmek gerekiyordu.
`App.tsx`'teki `lazy()` kurulumu doğruydu — Viewer3D ve Sensors gerçekten
lazy'ydi — ama React onların chunk'ında olduğu için hepsi baştan iniyordu.

Teşhisi zorlaştıran şey, belirtinin sezgiye ters olmasıydı: Total Blocking Time
yalnızca 10 ms'ti, yani ana iş parçacığı tıkanmıyordu. Sorun CPU değil, bant
genişliğiydi.

**Çözüm:** kural tamamen kaldırıldı. `three` ve `recharts` yalnızca lazy
sayfalardan (`Viewer3D`, `Sensors`) erişildiği için paketleyici doğru bölmeyi
kendiliğinden yapıyor.

**Kazanç:** kritik yol 462 → 128 KiB. Viewer3D (238 KiB) ve Sensors (100 KiB)
artık gerçekten o sayfaya girilince iniyor.

## Sorun 2 — üç sayfa gereksiz yere eager'dı

`ManualControl` ve `Designer` (953 satır) giriş ekranında hiç kullanılmadıkları
halde entry'nin içindeydi. İkisi de `lazy()`'ye alındı.

`Dashboard` bilerek eager bırakıldı. Giriş sonrası açılış sayfası olduğu için
lazy yapılsaydı kiosk ekranında her açılışta panel yerine bir an spinner
görünürdü — skor için iyi, kullanım için kötü bir takas.

**Kazanç:** entry 126 → 114 KiB.

## Sorun 3 — Türkçe metin, fontların en pahalı parçasını zorunlu kılıyordu

Fontlar Google Fonts'tan geliyordu. Google her aileyi unicode aralığına göre
böler: `latin`, `latin-ext`, `cyrillic` ve benzeri. Türkçe'deki `ğ ş İ`
karakterleri `latin-ext` aralığındadır — ve **Inter'in latin-ext dosyası
83 KiB, kendi latin dosyasının (47 KiB) neredeyse iki katı.** Yani her ağırlık
için 130 KiB.

Giriş ekranı tek ağırlıkla bile 167 KiB font indiriyordu. Panelde gezinince
Inter 500/600/700 de devreye girdiği için uygulama geneli 700 KiB'ı aşıyordu.

Dikkat: sorun **ağırlık sayısı değildi**. Tarayıcı yalnızca ekranda fiilen
çizilen yüzleri indirir, dolayısıyla kullanılmayan ağırlıkları istekten
çıkarmak sıfır bayt kazandırırdı. Sorun hangi *karakterlerin* indiğiydi.

**Çözüm:** fontlar değişken (variable) kaynaklarından yeniden alt kümelendi ve
kendi sunucumuza taşındı. Alt küme `latin` aralığı + Türkçe'de eksik kalan beş
karakter (`Ğ ğ İ Ş ş`; `ı` zaten latin'de var). Değişken eksen korunduğu için
tek dosya bütün ağırlıkları karşılıyor.

| | Google Fonts | Kendi sunucumuz |
| --- | --- | --- |
| Inter 400-700 | 520 KiB | **36,1 KiB** |
| Sora 500-700 | 110 KiB | **27,1 KiB** |
| JetBrains Mono 400-500 | 84 KiB | **27,6 KiB** |

`cv02/cv03/cv04/cv11` (index.css'teki `font-feature-settings`), `tnum`
(`tabular-nums`) ve `locl` (Türkçe i/İ eşlemesi) OpenType özellikleri korundu.

Ek olarak `fonts.googleapis.com` ve `fonts.gstatic.com` için DNS + TLS el
sıkışması ortadan kalktı ve dosyalar `max-age=1yıl, immutable` ile önbelleğe
alınıyor (bkz. `render.yaml`).

**Kazanç:** giriş ekranı fontu 167 → 63 KiB, üçüncü taraf origin sayısı 2 → 0.

Fontları yeniden üretmek için: `tools/subset-fonts.sh`

## Pratikte ne değişti

- **Sahada telefondan açan kullanıcı için.** Bahçedeki robotu kontrol etmek
  isteyen kişi zayıf çekim alanında olabilir. 5 saniyelik boş ekran yerine
  1,4 saniyede kullanılabilir sayfa.
- **Raspberry Pi kiosk ekranı için.** Panel her açılışta 1,45 MB JavaScript
  parse etmiyor; Pi'nin zayıf CPU'sunda bu doğrudan hissedilir.
- **Veri kullanımı.** İlk ziyaret ~630 KiB'dan ~180 KiB'a indi.
- **Dış bağımlılık yok.** Google Fonts kesintisi veya engellenmesi tipografiyi
  etkilemiyor.
- **CLS 0.** Yüklenirken düzen hiç kaymıyor.

## Ölçüm yaparken

Render ücretsiz katmanının yanıt süresi değişken. Statik dosyada bile ardışık
sekiz istekte TTFB 110-260 ms arasında gezindi; Lighthouse'un Slow 4G
kısıtlaması bu farkı büyütür. Tek ölçüme bakmayın, 2-3 tur çalıştırıp ortancayı
alın.

Ayrıca ölçümün gerçekten güncel sürümü gördüğünü doğrulayın: deploy sırasında
çalıştırılan bir Lighthouse turu eski build'i ölçebiliyor. Raporun ağ listesinde
görünen `index-<hash>.js` adını canlıdaki `index.html` ile karşılaştırmak en
kesin kontrol.
