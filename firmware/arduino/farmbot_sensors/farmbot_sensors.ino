/*
 * FarmBot — Arduino sensör düğümü
 * ================================
 * Temel: senin yazdığın kod. Mantık ve Türkçe çıktılar aynen korundu.
 * Üzerine panele bağlanabilmesi için gerekenler eklendi.
 *
 * EKLENENLER
 *   1) Her ölçümden sonra tek satırlık VERI: satırı basılıyor.
 *      Köprü programı bu satırı okuyup buluta gönderiyor.
 *      Senin okuduğun Türkçe satırlar aynen duruyor.
 *   2) Seri porttan komut alma (panelden servo kontrolü için).
 *   3) OTOMATIK / MANUEL kip: panelden komut gelince otomatik karar durur,
 *      "AUTO" komutuyla geri açılır. Yoksa panel servoyu 90'a alsa bile
 *      döngü bir sonraki turda üzerine yazardı.
 *   4) Barometre bulunamazsa sistem artık DURMUYOR. Eski hâlinde while(1)
 *      tüm ölçümü kilitliyordu; tek sensör arızası yüzünden nem ve toprak
 *      verisi de kesiliyordu.
 *   5) Toprak nemi ham değerin yanında yüzde olarak da hesaplanıyor.
 *
 * GEREKEN KÜTÜPHANELER (senin zaten kurduklarının aynısı, yenisi yok)
 *   - Adafruit BMP085 Library      (BMP180/GY-68 ile uyumlu)
 *   - DHT sensor library           (Adafruit)
 *   - Adafruit Unified Sensor
 *   Servo ve Wire, Arduino IDE ile birlikte gelir.
 */

#include <Wire.h>
#include <Adafruit_BMP085.h>
#include <DHT.h>
#include <Servo.h>

// --- SENSÖR PİN TANIMLAMALARI ---
#define DHTPIN 2          // Nem ve sıcaklık sensörü D2'ye bağlı
#define DHTTYPE DHT11     // Elindeki sensör DHT11
#define YAGMUR_PIN A0     // HW-103 yağmur sensörünün analog (AO) pini
// Toprak nemi sensörü henüz yok. Taktığında A1'e bağla ve aşağıdaki
// Toprak nemi probu — uç değiştirme istasyonundaki sensör.
//
// A1'de, A0'da DEĞİL: A0'ı yağmur sensörü kullanıyor ve iki analog sensör
// aynı pini paylaşamaz. Paylaşırlarsa ikisi de birbirinin okumasını bozar ve
// hangi değerin hangisine ait olduğu anlaşılmaz.
#define TOPRAK_PIN A1
#define SERVO_PIN 9       // SG 5010 Servo pini

// --- NESNELERİ OLUŞTURMA ---
Adafruit_BMP085 bmp;
DHT dht(DHTPIN, DHTTYPE);
Servo tarimServo;

// --- YAĞMUR EŞİĞİ ---
// HW-103 kuruyken 1023'e yakın, su gördüğünde 0'a yakın değer verir.
// Doğru eşiği bulmak için: panelde "Yağmur (ham)" grafiğine bak, sensör
// kuruyken ve üstüne birkaç damla su damlattığında okunan değerlerin
// ortasını buraya yaz.
/*
 * Yağmur eşiği — ham ADC değeri bunun ALTINDAYSA "ıslak" sayılıyor.
 *
 * Sahada ölçüldü: sensör kuruyken ~990, ıslakken ~240. Yani su değdikçe
 * değer DÜŞÜYOR ve eşik ikisinin ortası: (990 + 240) / 2 = 615.
 *
 * Bir ara bunun tersini yazmıştım. Sebebi şuydu: sensör o sırada RX0'a
 * bağlıydı ve A0 boştaydı; boştaki pin yanındaki kanalın değerini kaptığı
 * için "kuru 286, ıslak 500" gibi anlamsız sayılar ölçmüştük. Sensör A0'a
 * alınınca gerçek davranış ortaya çıktı ve ilk yön doğru çıktı.
 *
 * `ESIK <sayi>` komutuyla çalışırken değiştirilebiliyor.
 */
int suEsikDegeri = 615;

/*
 * Histerezis — kararın sınırda titrememesi için.
 *
 * Sahada kuru sensörün iki saniyede 336'dan 495'e sıçradığını gördük. Tek bir
 * eşikle bu gürültü, saniyede bir "yağmur var / yok" demek ve vanayı sürekli
 * açıp kapamak anlamına gelirdi.
 *
 * Bu yüzden iki sınır var: ıslak demek için eşiğin bu kadar üstüne çıkmak,
 * kuru demek için bu kadar altına inmek gerekiyor. Arada kalan bölgede son
 * karar korunuyor.
 */
const int ESIK_HISTEREZIS = 40;
bool islakMi = false;

/*
 * POMPALAR
 * --------
 * D4 = hava pompası, D7 = su vanası, D12 = su pompası.
 *
 * Pin pompayı **beslemiyor**, yalnızca röleyi anahtarlıyor: bir Arduino pini
 * ~20 mA verir, en küçük pompa bile yüzlerce mA çeker. Pompanın gücü ayrı
 * kaynaktan gelmeli.
 *
 * DİKKAT — röle yönü: piyasadaki modüllerin çoğu **aktif-LOW**, yani IN ucu
 * LOW iken röle çeker. Öyle bir modülünüz varsa buradaki POMPA_ACIK/KAPALI
 * değerlerini ters çevirin. Hangisi olduğunu denemeden bilmenin yolu yok;
 * yanlış varsayım, açılışta pompanın kendiliğinden çalışması demek.
 */
#define POMPA_HAVA_PIN 4
#define SU_VANA_PIN    7
#define POMPA_SU_PIN   12

const int POMPA_ACIK   = HIGH;
const int POMPA_KAPALI = LOW;

// Panelin gerçek durumu görebilmesi için son yazılan değeri saklıyoruz.
// Arduino pinin çıkışını geri okuyamıyor; komutu biz verdiğimiz için
// hatırlamak tek yol. Böylece panel "gönderdiğimi sanıyorum" yerine
// "kartın bildirdiği" durumu gösteriyor.
bool pompaHavaAcik = false;
bool pompaSuAcik = false;
bool suVanaAcik = false;

// --- TOPRAK NEMİ (sensör takıldığında) ---
// Kalibrasyon: probu havada tutunca okunan değer -> TOPRAK_KURU,
// suya batırınca okunan -> TOPRAK_ISLAK. Panelde "Toprak (ham)" grafiğinden
// okuyup buraya yaz.
// Sahada ölçüldü: prob havadayken ~1020, suya batırılınca ~330.
// Önceki 620/260 tahmindi ve yüzdeyi sürekli %0 gösteriyordu.
const int TOPRAK_KURU  = 1020;
const int TOPRAK_ISLAK = 330;

// --- DURUM ---
bool barometreVar = false;   // Barometre bulunamazsa diğer sensörler çalışmaya devam etsin
bool otomatikKip = true;     // Panelden komut gelince false olur
int servoAcisi = 0;

void setup() {
  Serial.begin(9600);
  Serial.println("Sistem Baslatiliyor...");

  // 1. Servo Motor Başlatma
  tarimServo.attach(SERVO_PIN);
  tarimServo.write(servoAcisi); // Başlangıç konumu: Kapalı (0 derece)

  // 2. DHT (Nem/Sıcaklık) Başlatma
  dht.begin();

  // 3. GY-68 (Barometre) Başlatma
  barometreVar = bmp.begin();
  if (!barometreVar) {
    // Eskiden burada while(1) vardı ve tüm sistem donuyordu.
    // Artık sadece uyarıyoruz; nem, sıcaklık ve toprak ölçümü devam ediyor.
    Serial.println("UYARI: GY-68 Barometre bulunamadi! Kablolari kontrol edin.");
    Serial.println("       Diger sensorler calismaya devam ediyor.");
  }

  // HW-103 için pinMode ayarına gerek yoktur, analogRead doğrudan okur.

  /*
   * Pompaları açıkça KAPALI başlat.
   *
   * Bu satırlar olmadan pinler açılışta giriş (yüksek empedans) kalıyor ve
   * röle modülünün kendi davranışına bağlı olarak kısa süre çekebiliyor.
   * Elektrik kesilip geldiğinde ya da kart resetlendiğinde suyun kendiliğinden
   * akmaya başlaması kabul edilemez.
   */
  pinMode(POMPA_HAVA_PIN, OUTPUT);
  digitalWrite(POMPA_HAVA_PIN, POMPA_KAPALI);
  pinMode(SU_VANA_PIN, OUTPUT);
  digitalWrite(SU_VANA_PIN, POMPA_KAPALI);
  pinMode(POMPA_SU_PIN, OUTPUT);
  digitalWrite(POMPA_SU_PIN, POMPA_KAPALI);

  Serial.println("Tum Sensorler Aktif. Olcumler Basliyor...");
  Serial.println("----------------------------------------");

  // Köprü programı bu satırdan düğümün hazır olduğunu anlar
  Serial.print("HAZIR:{\"fw\":\"farmbot-node-2.0\",\"bmp180\":");
  Serial.print(barometreVar ? "true" : "false");
  Serial.println(",\"dht\":\"DHT11\"}");
}

void loop() {
  // Panelden komut gelmiş mi? (bloklamaz, sadece bekleyen varsa okur)
  komutlariIsle();

  // Sensörlerin veri toparlaması için 2 saniye bekliyoruz
  // (DHT11 saniyede sadece 1 kez güncellenebilir)
  delay(2000);

  // --- DHT VERİLERİNİ OKUMA ---
  float nem = dht.readHumidity();
  float dhtSicaklik = dht.readTemperature(); // Santigrat

  // --- GY-68 VERİLERİNİ OKUMA ---
  float bmpSicaklik = 0;
  int32_t basinc = 0;
  float rakim = 0;
  if (barometreVar) {
    bmpSicaklik = bmp.readTemperature();
    basinc = bmp.readPressure();          // Paskal (Pa)
    rakim = bmp.readAltitude();           // metre
  }

  // --- HW-103 YAĞMUR SENSÖRÜ ---
  int yagmurDegeri = yagmurOku();

  // Sensör verilerinde okuma hatası var mı kontrol et
  if (isnan(nem) || isnan(dhtSicaklik)) {
    Serial.println("HATA: DHT sensorunden veri okunamadi!");
    return; // Döngüyü başa sar
  }

  // --- EKRANA YAZDIRMA KISMI (senin yazdığın hâliyle) ---
  Serial.print("Hava Nemi: %");
  Serial.print(nem);
  Serial.print(" | Ort. Sicaklik: ");
  // İki farklı sıcaklık okunduğu için ortalamasını alabiliriz
  if (barometreVar) {
    Serial.print((dhtSicaklik + bmpSicaklik) / 2.0);
  } else {
    Serial.print(dhtSicaklik);
  }
  Serial.println(" *C");

  Serial.print("Basinc: ");
  Serial.print(basinc);
  Serial.print(" Pa | Yagmur/Nem Seviyesi: ");
  Serial.println(yagmurDegeri);

  // --- OTONOM KARAR MEKANİZMASI ---
  // Islaklık kararını tek yerde veriyoruz: servo da panel de aynı sonucu
  // görsün. İki ayrı yerde hesaplansaydı biri histerezisli, diğeri değil
  // olurdu ve panel "kuru" derken vana açık kalabilirdi.
  islaklikGuncelle(yagmurDegeri);

  // Panelden elle komut verildiyse (otomatikKip = false) karışmıyoruz.
  if (otomatikKip) {
    if (islakMi) {
      Serial.println("DURUM: Yagmur/Su Algilandi! Vana veya Tente Aciliyor...");
      servoyuAyarla(90); // Motor 90 dereceye gider
    } else {
      Serial.println("DURUM: Kuru hava. Sistem kapali konumda.");
      servoyuAyarla(0);  // Motor 0 dereceye geri döner
    }
  } else {
    Serial.print("DURUM: MANUEL kip. Servo ");
    Serial.print(servoAcisi);
    Serial.println(" derecede bekliyor.");
  }

  // --- PANELE GÖNDERİLEN SATIR ---
  // Köprü programı yalnızca bu satırı okur, üsttekileri yok sayar.
  paneleGonder(nem, dhtSicaklik, bmpSicaklik, basinc, rakim, yagmurDegeri);

  Serial.println("----------------------------------------");
}

/** Ham ADC değerini 0–100 arası toprak nemi yüzdesine çevirir. */
// Toprak nemi yüzdesi.
//
// Katsayılar sahada ölçülerek bulunuyor: probu havada tutunca okunan değer
// TOPRAK_KURU, suya batırınca okunan TOPRAK_ISLAK olmalı. Aşağıdaki 620/260
// tahmindir — yağmur sensöründe tahminle gidip yanılmıştık, burada da ham
// değere bakıp düzeltin.
float toprakYuzdesi(int ham) {
  long aralik = (long)TOPRAK_KURU - (long)TOPRAK_ISLAK;
  if (aralik == 0) return 0;
  float yuzde = (float)((long)TOPRAK_KURU - ham) * 100.0 / (float)aralik;
  if (yuzde < 0) yuzde = 0;
  if (yuzde > 100) yuzde = 100;
  return yuzde;
}

/** Servo açısını sınırlar içinde ayarlar. */
void servoyuAyarla(int aci) {
  if (aci < 0) aci = 0;
  if (aci > 180) aci = 180;
  servoAcisi = aci;
  tarimServo.write(servoAcisi);
}

/**
 * Ölçümleri tek satırda, panelin anlayacağı biçimde yazar.
 * Kütüphane kullanmadan elle üretiliyor — ek kurulum gerekmesin diye.
 *
 * Örnek çıktı:
 * VERI:{"dht_humidity":54.0,"dht_temperature":23.0,...}
 */
void paneleGonder(float nem, float dhtSic, float bmpSic,
                  int32_t basincPa, float rakim, int yagmurHam) {
  Serial.print("VERI:{");

  Serial.print("\"dht_humidity\":");     Serial.print(nem, 1);
  Serial.print(",\"dht_temperature\":"); Serial.print(dhtSic, 1);

  if (barometreVar) {
    Serial.print(",\"bmp180_temperature\":"); Serial.print(bmpSic, 1);
    // Panelde hPa bekleniyor; Pa degerini 100'e boluyoruz
    Serial.print(",\"bmp180_pressure\":");    Serial.print(basincPa / 100.0, 1);
    Serial.print(",\"bmp180_altitude\":");    Serial.print(rakim, 1);
  }

#ifdef TOPRAK_PIN
  /*
   * Toprak nemi. Ham değeri de gönderiyoruz çünkü yüzdeye çeviren katsayılar
   * (TOPRAK_KURU / TOPRAK_ISLAK) sahada ölçülerek bulunuyor — yağmur
   * sensöründe bunu tahminle yapıp yanılmıştık.
   *
   * Ortanca filtresi burada da geçerli: prob toprağa girip çıkarken analog
   * değer sıçrıyor.
   */
  int toprakHam = toprakOku();
  Serial.print(",\"soil_raw\":");      Serial.print(toprakHam);
  Serial.print(",\"soil_moisture\":"); Serial.print(toprakYuzdesi(toprakHam), 1);
#endif

  // A0'da tek bir yağmur sensörü var. Önceki sürüm bu değeri ayrıca
  // "hw103_soil" ve "hw103_soil_raw" olarak da gönderiyordu; ortada toprak
  // sensörü olmadığı için panel yağmur sensörünü toprak nemi diye gösteriyordu.
  // Servo hangi karara göre hareket ettiyse panel de onu görsün
  Serial.print(",\"hw103_rain\":");      Serial.print(islakMi ? 1 : 0);
  // Ham değer de gidiyor: eşiği panelden bakarak ayarlayabilmek için
  Serial.print(",\"hw103_rain_raw\":");  Serial.print(yagmurHam);
  Serial.print(",\"servo_aci\":");       Serial.print(servoAcisi);
  // Eşiği de gönderiyoruz: panelde ham değerin yanında hangi sınıra göre
  // karar verildiği görünsün, tahmin etmek gerekmesin
  Serial.print(",\"rain_threshold\":");  Serial.print(suEsikDegeri);

  // Pompa durumları. Panel bunları gösterince "gönderdiğimi sanıyorum" değil
  // "kartın bildirdiği" durum görünüyor; robot resetlense de doğru kalıyor.
  Serial.print(",\"pompa_hava\":");     Serial.print(pompaHavaAcik ? 1 : 0);
  Serial.print(",\"pompa_su\":");       Serial.print(pompaSuAcik ? 1 : 0);
  Serial.print(",\"su_vana\":");        Serial.print(suVanaAcik ? 1 : 0);

  Serial.println("}");
}

/*
 * Panelden gelen komutlar. Basit metin satırları — Seri Monitör'e elle de
 * yazarak deneyebilirsin (satır sonu "Yeni Satır" olmalı):
 *
 *   SERVO 90     -> servoyu 90 dereceye al, MANUEL kipe geç
 *   AC           -> servo 90 derece (vana ac)
 *   KAPA         -> servo 0 derece  (vana kapa)
 *   AUTO         -> otomatik karar mekanizmasina geri don
 *   PIN 8 1      -> 8 numarali pini HIGH yap (role vb.)
 *   OKU          -> beklemeden hemen olcum satiri bas
 */
void komutlariIsle() {
  if (!Serial.available()) return;

  String satir = Serial.readStringUntil('\n');
  satir.trim();
  satir.toUpperCase();
  if (satir.length() == 0) return;

  if (satir.startsWith("SERVO")) {
    int aci = satir.substring(5).toInt();
    otomatikKip = false;
    servoyuAyarla(aci);
    cevapVer(true, "servo");

  } else if (satir == "AC") {
    otomatikKip = false;
    servoyuAyarla(90);
    cevapVer(true, "ac");

  } else if (satir == "KAPA") {
    otomatikKip = false;
    servoyuAyarla(0);
    cevapVer(true, "kapa");

  } else if (satir == "AUTO") {
    otomatikKip = true;
    cevapVer(true, "auto");

  } else if (satir.startsWith("PIN")) {
    // "PIN 8 1" -> pin 8, deger 1
    int bosluk1 = satir.indexOf(' ');
    int bosluk2 = satir.indexOf(' ', bosluk1 + 1);
    if (bosluk1 > 0 && bosluk2 > 0) {
      int pin = satir.substring(bosluk1 + 1, bosluk2).toInt();
      int deger = satir.substring(bosluk2 + 1).toInt();
      pinMode(pin, OUTPUT);
      digitalWrite(pin, deger ? POMPA_ACIK : POMPA_KAPALI);

      // Pompa pinleriyse durumu hatırla ki panele doğrusu gitsin
      if (pin == POMPA_HAVA_PIN) pompaHavaAcik = (deger != 0);
      if (pin == SU_VANA_PIN)    suVanaAcik   = (deger != 0);
      if (pin == POMPA_SU_PIN)   pompaSuAcik  = (deger != 0);

      cevapVer(true, "pin");
    } else {
      cevapVer(false, "pin-eksik-parametre");
    }

  } else if (satir.startsWith("ESIK")) {
    // "ESIK 250" -> yağmur eşiğini değiştir.
    //
    // Çalışırken ayarlanabilmesi önemli: doğru eşik ancak sensörü kuruyken ve
    // ıslakken okuyarak bulunuyor ve her denemede eskizi yeniden yüklemek
    // saatler alıyordu.
    int bosluk = satir.indexOf(' ');
    int yeni = (bosluk > 0) ? satir.substring(bosluk + 1).toInt() : -1;
    if (yeni > 0 && yeni < 1024) {
      suEsikDegeri = yeni;
      cevapVer(true, "esik");
    } else {
      cevapVer(false, "esik-gecersiz");
    }

  } else if (satir == "OKU") {
    cevapVer(true, "oku");

  } else {
    cevapVer(false, "bilinmeyen-komut");
  }
}

/**
 * Yağmur sensörünü gürültüden arındırarak okur — beş örneğin ortancası.
 *
 * Neden tek okuma yetmiyor: sahada kuru sensörün iki saniye içinde 336'dan
 * 495'e sıçradığını gördük. Yüksek empedanslı bir analog girişte bu normal;
 * tek bir sıçrama, kararı yanlış tarafa çeviriyordu.
 *
 * Ortalama değil **ortanca** alıyoruz: ortalama, tek bir uç değeri sonuca
 * taşır; ortanca onu tamamen dışarıda bırakır.
 */
int yagmurOku() {
  int ornekler[5];
  for (int i = 0; i < 5; i++) {
    ornekler[i] = analogRead(YAGMUR_PIN);
    delay(4);  // ADC'nin toparlanması için; ardışık okuma birbirini etkiliyor
  }

  // Beş eleman için sıralama en anlaşılır yol
  for (int i = 0; i < 4; i++) {
    for (int j = i + 1; j < 5; j++) {
      if (ornekler[j] < ornekler[i]) {
        int gecici = ornekler[i];
        ornekler[i] = ornekler[j];
        ornekler[j] = gecici;
      }
    }
  }
  return ornekler[2];
}

#ifdef TOPRAK_PIN
/** Toprak probunu gürültüden arındırarak okur — beş örneğin ortancası. */
int toprakOku() {
  int ornekler[5];
  for (int i = 0; i < 5; i++) {
    ornekler[i] = analogRead(TOPRAK_PIN);
    delay(4);
  }
  for (int i = 0; i < 4; i++) {
    for (int j = i + 1; j < 5; j++) {
      if (ornekler[j] < ornekler[i]) {
        int gecici = ornekler[i];
        ornekler[i] = ornekler[j];
        ornekler[j] = gecici;
      }
    }
  }
  return ornekler[2];
}
#endif

/**
 * Islaklık durumunu histerezisle günceller.
 *
 * Değer eşiğin belirgin şekilde üstüne çıkmadan "ıslak", belirgin şekilde
 * altına inmeden "kuru" demiyoruz. Arada kalan bölgede son karar korunuyor.
 */
void islaklikGuncelle(int ham) {
  // Islak = DÜŞÜK değer. Islak demek için eşiğin belirgin şekilde altına
  // inmek, kuru demek için belirgin şekilde üstüne çıkmak gerekiyor.
  if (!islakMi && ham < suEsikDegeri - ESIK_HISTEREZIS) {
    islakMi = true;
  } else if (islakMi && ham > suEsikDegeri + ESIK_HISTEREZIS) {
    islakMi = false;
  }
}

/** Komut sonucunu paneldeki köprüye bildirir. */
void cevapVer(bool basarili, const char* komut) {
  Serial.print("CEVAP:{\"ok\":");
  Serial.print(basarili ? "true" : "false");
  Serial.print(",\"komut\":\"");
  Serial.print(komut);
  Serial.print("\",\"servo\":");
  Serial.print(servoAcisi);
  Serial.print(",\"kip\":\"");
  Serial.print(otomatikKip ? "AUTO" : "MANUEL");
  Serial.println("\"}");
}
