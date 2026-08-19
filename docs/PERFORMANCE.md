# Performans

HMI'nin ilk yükleme performansı üzerine yapılan çalışmanın kaydı: hangi sorunlar
vardı, neden oluştular, ne değişti.

**İki ayrı sayfa ölçüldü, karıştırmayın:**

- **Giriş ekranı.** PageSpeed Insights `/viewer`'ı isteyince oturum açılmamış
  olduğu için giriş ekranına düşülüyor; ölçülen budur. Sorun 1-3 buna dair.
- **Panel.** `/viewer`'ın kendisi, oturum açıkken. PageSpeed buraya giremez;
  yalnızca Chrome DevTools'un Lighthouse paneli ölçebilir. Sorun 4 buna dair.

## Sonuç — giriş ekranı

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

Erişilebilirlik, En İyi Uygulamalar ve SEO: 100. Masaüstünde FCP 0,3 sn ·
LCP 0,4 sn · Speed Index 0,5 sn.

## Sonuç — panel (`/viewer`, oturum açık)

| Metrik (mobil, Slow 4G, CPU 4x) | Önce | Sonra |
| --- | --- | --- |
| Performans skoru | 77 | ölçülmedi (aşağıdaki nota bakın) |
| Total Blocking Time | 1.016 ms | **726 ms** |
| Sahne durgunken CPU | kare başına ~20 ms, hiç durmuyor | **0 — sahne duruyor** |

Panelin skoru `frameloop` düzeltmesinden sonra yeniden ölçülmedi; elimizdeki
karşılaştırma DevTools performans kayıtlarından çıkan TBT değerleri. Skorun da
düzelmiş olması beklenir ama doğrulanmadı.

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

## Sorun 4 — 3B sahne hiç durmadan yeniden çiziliyordu

Bu, PageSpeed'in göremediği alanda: panelin kendisi.

`<Canvas>` varsayılan `frameloop="always"` ile çalışıyordu, yani sahne saniyede
60 kez yeniden çiziliyordu — robot dursa, kullanıcı hiçbir şeye dokunmasa bile.
DevTools performans kaydında ölçülen: sahne kurulduktan sonra 63 animasyon
karesi, toplam 1.291 ms CPU, kare başına ~20 ms ve kayıt bitene kadar hiç
durmuyor.

Durmamasının sebebi `RobotRig`'deki üstel yumuşatmaydı:

```js
position.x += (target.x - position.x) * SMOOTHING;
```

Bu hedefe asimptotik yaklaşır, matematiksel olarak asla varmaz; "animasyon
bitti" diyebileceğimiz bir an oluşmuyordu.

**Çözüm iki parçalı:**

1. `SETTLE_EPSILON` (0,5 mm) eşiği — bu mesafenin altında hedefe yapışıp yeni
   kare istemeyi bırakıyoruz.
2. `frameloop="demand"` — çizim yalnızca istendiğinde yapılıyor. İsteği üç yer
   üretiyor: sahne ağacı değişince react-three-fiber kendisi, kamera gezinirken
   `OrbitControls` (drei `change` olayında `invalidate()` çağırıyor), ve robot
   hareket ederken `useFrame`.

**Kazanç:** TBT 1.016 → 726 ms, ve asıl önemlisi sahne durgunken **hiç kare
çizilmiyor**. Ölçümde son kareden sonra 2,1 saniye tam sessizlik görüldü;
öncesinde kayıt bittiği için duruyordu.

Kiosk ekranında panel gün boyu açık kaldığı için faydası skordan çok burada.

## Denendi ve geri alındı — shader ön derlemesi

Panelin kalan 726 ms'lik TBT'sinin en büyük kalemi (200 ms) three.js'in shader
programlarını derlemesi. Kaynak haritalarıyla çözülen döküm: `onFirstUse`
26,8 ms, `cloneUniforms` 6,8 ms, `WebGLShader` 6,3 ms, `replaceLightNums`
4,9 ms, `getParameters` 5,0 ms.

Denenen: `renderer.compileAsync(scene, camera)` ile programları ilk çizimden
önce, `KHR_parallel_shader_compile` uzantısı üzerinden bloklamadan derlemek;
derleme sürerken Canvas'ı `frameloop="never"` ile bekletmek.

**İşe yaramadı, geri alındı.** Ölçüm: TBT 726 → 707 ms (gürültü seviyesinde) ve
`onFirstUse` maliyeti 26,8 → 26,6 ms — yani sürücü beklemesi hiç ortadan
kalkmadı.

İki sebep:

- `compileAsync` önce `compile()`'ı **senkron** çağırıyor. Shader string
  üretimi, uniform kopyalama gibi JS tarafı iş ortadan kalkmıyor, sadece başka
  bir göreve taşınıyor.
- `compile()` gölge geçişinin kullandığı `MeshDepthMaterial` varyantlarını
  kapsamıyor. Sahnede `shadows` açık ve 28 mesh gölge düşürüyor; o programlar
  yine ilk çizimde derleniyor.

Aynı fikri tekrar denemek isteyen olursa: mesele gölge geçişinin depth-material
varyantlarında. Onları da kapsayan bir ön derleme ya da gölgeleri tamamen
kapatmak denenebilir.

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
- **Boşta CPU tüketimi yok.** Panel açık durduğu sürece 3B sahne işlemciyi
  meşgul etmiyor.

## Ölçüm yaparken

Bu bölümdeki dört madde de çalışma sırasında bizzat yanlış sonuca götürdü.

**Tek ölçüme güvenmeyin.** Render ücretsiz katmanının yanıt süresi değişken;
statik dosyada bile ardışık sekiz istekte TTFB 110-260 ms arasında gezindi ve
Slow 4G kısıtlaması bu farkı büyütüyor. Aynı build üç ayrı turda 87, 84 ve 99
verdi. 2-3 tur çalıştırıp ortancayı alın.

**Ölçümün güncel sürümü gördüğünü doğrulayın.** Deploy sırasında çalıştırılan
bir Lighthouse turu eski build'i ölçebiliyor — bir kez skorun "düştüğünü"
sandık, meğer rapor font değişikliğinden önceki paketi ölçmüş. Raporun ağ
listesindeki `index-<hash>.js` adını canlıdaki `index.html` ile karşılaştırmak
en kesin kontrol.

**DevTools Lighthouse'u gizli sekmede çalıştırın.** Normal pencerede tarayıcı
eklentileri de ölçüme giriyor. Panelin ilk ölçümü 63 çıktı; sebebi sayfaya
2,1 MB JavaScript enjekte eden bir eklentiydi ve tek başına 3.013 ms'lik bir
uzun görev üretiyordu. Gizli sekmede aynı sayfa 77 verdi. Lighthouse zaten
`runWarnings` altında uyarıyor, o uyarıyı görmezden gelmeyin.

**Panelin kendisini ölçmek için DevTools şart.** PageSpeed Insights oturum
açamadığı için hep giriş ekranını ölçer. Giriş ekranının 99 olması panel
hakkında hiçbir şey söylemiyor.

### Kaynak haritaları

Üretim derlemesinde açık (`vite.config.ts`). Kapalıyken performans kaydındaki
fonksiyon adları `C`, `Cl`, `xh` gibi geliyor ve hangi three.js işleminin pahalı
olduğu anlaşılmıyor. Açıkken `onFirstUse`, `replaceLightNums`, `cloneUniforms`
gibi gerçek adlar görünüyor — Sorun 4'ün teşhisi bununla mümkün oldu.

Ziyaretçiye maliyeti yok: `.map` dosyaları yalnızca geliştirici araçları açıkken
indiriliyor.
