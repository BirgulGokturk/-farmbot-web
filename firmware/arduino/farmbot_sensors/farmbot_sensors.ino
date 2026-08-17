/*
 * FarmBot — Arduino sensör ve eyleyici düğümü
 * ============================================
 *
 * Görevi: sensörleri okuyup seri porttan JSON satırı olarak yayınlamak,
 * Raspberry Pi'den gelen komutlarla servo ve röleleri sürmek.
 *
 * Arduino ile Pi arasındaki protokol bilinçli olarak **satır bazlı JSON**:
 * hem insan gözüyle ayıklanabilir (Seri Monitör'den izlenebilir) hem de
 * köprü ajanının ayrıştırması kolaydır.
 *
 * ---------------------------------------------------------------------------
 * GEREKEN KÜTÜPHANELER (Arduino IDE → Araçlar → Kütüphane Yöneticisi)
 *   - "Adafruit BMP085 Library"      (BMP180/GY-68 ile uyumludur)
 *   - "DHT sensor library"           (Adafruit)
 *   - "Adafruit Unified Sensor"      (DHT kütüphanesinin bağımlılığı)
 *   - "ArduinoJson"                  (sürüm 7.x)
 *   Servo ve Wire kütüphaneleri Arduino IDE ile birlikte gelir.
 *
 * ---------------------------------------------------------------------------
 * BAĞLANTI ŞEMASI (Arduino Uno)
 *
 *   BMP180 / GY-68        →  VCC:3.3V   GND:GND   SDA:A4   SCL:A5
 *   DHT11                 →  VCC:5V     GND:GND   DATA:D2
 *                            (DATA ile VCC arasına 10 kΩ pull-up direnç.
 *                             3 bacaklı hazır modül kullanıyorsanız direnç
 *                             kartın üzerindedir, ayrıca eklemeyin.)
 *   HW-103                →  VCC:5V     GND:GND   AO:A0    DO:D3
 *   SG-5010 servo         →  Kırmızı:5V* Kahve:GND Turuncu:D6
 *
 *   * SG-5010 yüksek torklu bir servodur; yük altında 1 A üzerine çıkabilir.
 *     Arduino'nun 5V pininden beslemeyin — AYRI bir 5–6 V güç kaynağı kullanın
 *     ve güç kaynağının GND'sini Arduino GND'sine bağlayın (ortak toprak).
 *     Aksi halde servo hareket ettiğinde Arduino resetlenir.
 */

#include <Wire.h>
#include <Servo.h>
#include <Adafruit_BMP085.h>
#include <DHT.h>
#include <ArduinoJson.h>

// --------------------------------------------------------------------------
// Pin tanımları
// --------------------------------------------------------------------------
const uint8_t PIN_DHT        = 2;   // DHT11/DHT22 veri hattı
const uint8_t PIN_RAIN_D     = 3;   // HW-103 dijital çıkış
const uint8_t PIN_SERVO      = 6;   // SG-5010 sinyal
const uint8_t PIN_PUMP       = 8;   // Su pompası rölesi (isteğe bağlı)
const uint8_t PIN_SOIL_A     = A0;  // HW-103 analog çıkış

// Kullanılan sensör: DHT11
// (DHT22'ye geçerseniz burayı DHT22 yapmanız yeterli — başka değişiklik gerekmez)
//
// DHT11'in sınırları: sıcaklık 0–50 °C (±2 °C), nem %20–90 (±%5).
// Bu yüzden negatif sıcaklık ve çok kuru/çok nemli ortam ölçemez;
// donma noktası civarında değer beklemeyin.
#define DHT_TYPE DHT11

// --------------------------------------------------------------------------
// Kalibrasyon
// --------------------------------------------------------------------------
// HW-103 kuruyken YÜKSEK, ıslakken DÜŞÜK analog değer verir.
// Doğru yüzde için bu iki değeri kendi sensörünüzle ölçün:
//   1. Sensörü kuru havada tutun  → seri porttaki "hw103_soil_raw" değerini not alın → SOIL_DRY
//   2. Bir bardak suya batırın    → yeni değeri not alın                              → SOIL_WET
const int SOIL_DRY = 620;
const int SOIL_WET = 260;

// Rakım hesabı için deniz seviyesindeki basınç (hPa).
// Bulunduğunuz yerin güncel QNH değerini girerseniz rakım doğrulaşır.
const float SEA_LEVEL_HPA = 1013.25;

// Ölçüm gönderme aralığı. DHT11 en fazla 1 Hz okunabilir; 5 sn güvenli.
const unsigned long SAMPLE_INTERVAL_MS = 5000UL;

// --------------------------------------------------------------------------
// Durum
// --------------------------------------------------------------------------
Adafruit_BMP085 bmp;
DHT dht(PIN_DHT, DHT_TYPE);
Servo servo;

bool bmpReady = false;
unsigned long lastSample = 0;
int servoAngle = 0;

void setup() {
  Serial.begin(115200);
  // USB seri hazır olana kadar bekle (Leonardo/Micro için gerekli, Uno'da anında geçer)
  while (!Serial && millis() < 3000) {}

  pinMode(PIN_RAIN_D, INPUT);
  pinMode(PIN_PUMP, OUTPUT);
  digitalWrite(PIN_PUMP, LOW);

  servo.attach(PIN_SERVO);
  servo.write(servoAngle);

  dht.begin();
  bmpReady = bmp.begin();

  // Ajan bu satırdan düğümün hazır olduğunu ve hangi kanalları
  // yayınlayacağını anlar.
  StaticJsonDocument<256> hello;
  hello["t"] = "hello";
  hello["fw"] = "farmbot-node-1.0";
  hello["bmp180"] = bmpReady;
  hello["dht"] = (DHT_TYPE == DHT11) ? "DHT11" : "DHT22";
  serializeJson(hello, Serial);
  Serial.println();
}

void loop() {
  handleSerialCommands();

  const unsigned long now = millis();
  // millis() taşmasına karşı çıkarma ile karşılaştırma (yaklaşık 49 günde bir)
  if (now - lastSample >= SAMPLE_INTERVAL_MS) {
    lastSample = now;
    publishReadings();
  }
}

// --------------------------------------------------------------------------
// Ölçümler
// --------------------------------------------------------------------------
void publishReadings() {
  StaticJsonDocument<384> doc;
  doc["t"] = "data";
  JsonObject r = doc.createNestedObject("readings");

  // --- BMP180 (I²C) ---
  if (bmpReady) {
    r["bmp180_temperature"] = round1(bmp.readTemperature());
    r["bmp180_pressure"]    = round1(bmp.readPressure() / 100.0);  // Pa → hPa
    r["bmp180_altitude"]    = round1(bmp.readAltitude(SEA_LEVEL_HPA * 100.0));
  }

  // --- DHT11 / DHT22 ---
  // Okuma başarısızsa NaN döner; bozuk veriyi göndermek yerine atlıyoruz.
  const float humidity = dht.readHumidity();
  const float temperature = dht.readTemperature();
  if (!isnan(humidity))    r["dht_humidity"]    = round1(humidity);
  if (!isnan(temperature)) r["dht_temperature"] = round1(temperature);

  // --- HW-103 toprak nemi / yağmur ---
  const int soilRaw = analogRead(PIN_SOIL_A);
  r["hw103_soil"] = soilPercent(soilRaw);
  // Ham değeri de gönderiyoruz: kalibrasyonu panelden görerek yapabilmek için
  r["hw103_soil_raw"] = soilRaw;
  // Modül ıslaklık algılayınca çıkışı LOW'a çeker
  r["hw103_rain"] = (digitalRead(PIN_RAIN_D) == LOW) ? 1 : 0;

  serializeJson(doc, Serial);
  Serial.println();
}

/** Ham ADC değerini 0–100 arası toprak nemi yüzdesine çevirir. */
float soilPercent(int raw) {
  const long span = (long)SOIL_DRY - (long)SOIL_WET;
  if (span == 0) return 0;
  float percent = (float)((long)SOIL_DRY - raw) * 100.0 / (float)span;
  if (percent < 0) percent = 0;
  if (percent > 100) percent = 100;
  return round1(percent);
}

float round1(float value) {
  return round(value * 10.0) / 10.0;
}

// --------------------------------------------------------------------------
// Komutlar
// --------------------------------------------------------------------------
/*
 * Beklenen komut biçimleri (her biri tek satır):
 *   {"cmd":"servo","angle":90,"id":"abc"}
 *   {"cmd":"servo_open","id":"abc"}          → 90°
 *   {"cmd":"servo_close","id":"abc"}         → 0°
 *   {"cmd":"pin","pin":8,"value":1,"id":"abc"}
 *   {"cmd":"read","id":"abc"}                → hemen ölçüm yayınla
 */
void handleSerialCommands() {
  if (!Serial.available()) return;

  const String line = Serial.readStringUntil('\n');
  if (line.length() == 0) return;

  StaticJsonDocument<256> cmd;
  const DeserializationError error = deserializeJson(cmd, line);
  if (error) {
    sendAck("", false, "json ayristirilamadi");
    return;
  }

  const char* action = cmd["cmd"] | "";
  const char* id = cmd["id"] | "";

  if (strcmp(action, "servo") == 0) {
    setServo(cmd["angle"] | 0);
    sendAck(id, true, nullptr);

  } else if (strcmp(action, "servo_open") == 0) {
    setServo(cmd["angle"] | 90);
    sendAck(id, true, nullptr);

  } else if (strcmp(action, "servo_close") == 0) {
    setServo(cmd["angle"] | 0);
    sendAck(id, true, nullptr);

  } else if (strcmp(action, "pin") == 0) {
    const uint8_t pin = cmd["pin"] | 0;
    const int value = cmd["value"] | 0;
    pinMode(pin, OUTPUT);
    digitalWrite(pin, value ? HIGH : LOW);
    sendAck(id, true, nullptr);

  } else if (strcmp(action, "read") == 0) {
    publishReadings();
    sendAck(id, true, nullptr);

  } else if (strcmp(action, "ping") == 0) {
    sendAck(id, true, nullptr);

  } else {
    sendAck(id, false, "bilinmeyen komut");
  }
}

void setServo(int angle) {
  if (angle < 0) angle = 0;
  if (angle > 180) angle = 180;
  servoAngle = angle;
  servo.write(servoAngle);
}

void sendAck(const char* id, bool ok, const char* error) {
  StaticJsonDocument<192> ack;
  ack["t"] = "ack";
  ack["id"] = id;
  ack["ok"] = ok;
  ack["servo"] = servoAngle;
  if (error != nullptr) ack["error"] = error;
  serializeJson(ack, Serial);
  Serial.println();
}
