# Köprü Ajanı — Raspberry Pi Kurulumu

Arduino'dan gelen sensör verilerini canlı panele taşıyan küçük bir Python
programı. Pi'ye uygulamanın tamamı **kurulmaz**; yalnızca bu ajan çalışır.

```
Arduino ──USB seri──> Raspberry Pi (ajan) ──HTTPS/WSS──> farmbot-api.onrender.com
                                                                  │
                                                      farmbot-hmi.onrender.com
```

---

## 1. Arduino tarafı

1. Arduino IDE'yi açın, **Kütüphane Yöneticisi**'nden şunları kurun:
   - `Adafruit BMP085 Library` (BMP180/GY-68 ile uyumlu)
   - `DHT sensor library` (Adafruit)
   - `Adafruit Unified Sensor`

   > JSON kütüphanesi gerekmez — çıktı elle üretiliyor.

2. [`firmware/arduino/farmbot_sensors/farmbot_sensors.ino`](../firmware/arduino/farmbot_sensors/farmbot_sensors.ino)
   dosyasını açın.
3. Sketch **DHT11** için ayarlıdır. DHT22'ye geçerseniz `#define DHTTYPE DHT11`
   satırını `DHT22` yapmanız yeterli.
4. Karta yükleyin ve Seri Monitör'ü **9600** baud ile açın.

Arduino iki tür satır basar — insan için Türkçe durum satırları, köprü için
`VERI:` önekli satır:

```
Hava Nemi: %54.00 | Ort. Sicaklik: 23.50 *C
Basinc: 101140 Pa | Yagmur/Nem Seviyesi: 468
DURUM: Kuru hava. Sistem kapali konumda.
VERI:{"dht_humidity":54.0,"dht_temperature":23.0,"bmp180_temperature":24.0,...}
----------------------------------------
```

Köprü yalnızca `VERI:` satırını okur, diğerlerini yok sayar — böylece Seri
Monitör'den sistemi izlemeye devam edebilirsiniz.

### Seri Monitör'den elle komut deneme

Giriş kutusuna yazıp Enter'a basın (satır sonu **"Yeni Satır"** olmalı):

| Komut | Etkisi |
|---|---|
| `AC` | Servo 90° (vana aç), MANUEL kipe geçer |
| `KAPA` | Servo 0° (vana kapa) |
| `SERVO 45` | Servoyu belirtilen açıya al |
| `AUTO` | Otomatik karar mekanizmasına geri dön |
| `OKU` | Beklemeden hemen ölçüm satırı bas |

### Bağlantılar (Arduino Uno)

| Bileşen | Bağlantı |
|---|---|
| BMP180 / GY-68 | `VCC→3.3V` · `GND→GND` · `SDA→A4` · `SCL→A5` |
| DHT11 | `VCC→5V` · `GND→GND` · `DATA→D2` (DATA–VCC arasına 10 kΩ; 3 bacaklı hazır modülde direnç kart üzerindedir) |
| HW-103 | `VCC→5V` · `GND→GND` · `AO→A0` |
| SG-5010 servo | Turuncu→`D9` · Kırmızı→**ayrı 5–6 V güç** · Kahve→ortak `GND` |

> ⚠️ **Servoyu Arduino'nun 5V pininden beslemeyin.** SG-5010 yük altında 1 A'in
> üzerine çıkar; Arduino'nun regülatörü bunu kaldıramaz ve kart hareket
> sırasında resetlenir. Ayrı bir güç kaynağı kullanın ve **GND'leri birleştirin**.

### Toprak nemi kalibrasyonu

Seri Monitör'deki `Yagmur/Nem Seviyesi` değerini (ham ADC) izleyin:

1. Sensör **kuru** havadayken değeri not alın → sketch'teki `TOPRAK_KURU`
2. Sensörü **suya** batırın, yeni değeri not alın → `TOPRAK_ISLAK`
3. Sketch'i güncelleyip tekrar yükleyin

Aynı değer `suEsikDegeri` için de yol gösterir: bu eşiğin altına düşünce
otomatik kip servoyu açar.

---

## 2. Panelden cihaz token'ı alın

1. https://farmbot-hmi.onrender.com adresinde oturum açın
2. **Ayarlar → Köprü Ajanı** → **Token Üret**
3. Çıkan `fbt_...` dizesini kopyalayın — **yalnızca bir kez gösterilir**

---

## 3. Raspberry Pi tarafı

```bash
sudo apt update && sudo apt install -y python3-venv git
```

```bash
git clone https://github.com/BirgulGokturk/-farmbot-web.git
```

```bash
cd -farmbot-web/agent && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

Kullanıcınızı seri porta erişim grubuna ekleyin (bir kez, sonra **yeniden giriş**):

```bash
sudo usermod -aG dialout $USER
```

Arduino'nun hangi portta olduğunu bulun:

```bash
ls /dev/ttyUSB* /dev/ttyACM*
```

> Uno R3 klonlarında genellikle `/dev/ttyUSB0`, orijinal Uno'da `/dev/ttyACM0`.

Deneme çalıştırması:

```bash
.venv/bin/python farmbot_agent.py --port /dev/ttyUSB0 --token fbt_xxx --verbose
```

Şuna benzer çıktı görmelisiniz:

```
19:42:01  INFO    Ajan başlıyor · port=/dev/ttyUSB0 · api=https://farmbot-api.onrender.com
19:42:04  INFO    Arduino bağlandı: /dev/ttyUSB0 @ 9600
19:42:04  INFO    Arduino hazır: {"fw": "farmbot-node-2.0", "bmp180": true, "dht": "DHT11"}
19:42:05  INFO    Komut kanalı açıldı
19:42:19  INFO    14 ölçüm gönderildi (toplam 14, tamponda 0)
```

Bu satırları gördüğünüzde panelde **Sensörler** bölümünde veriler akmaya başlar.

---

## 4. Sürekli çalışması için servis kurun

```bash
sudo cp farmbot-agent.service /etc/systemd/system/
```

```bash
sudo nano /etc/systemd/system/farmbot-agent.service
```

`FARMBOT_DEVICE_TOKEN` ve `FARMBOT_SERIAL_PORT` satırlarını düzenleyin, sonra:

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now farmbot-agent
```

```bash
journalctl -u farmbot-agent -f
```

---

## Sorun giderme

| Belirti | Sebep / çözüm |
|---|---|
| `Permission denied: '/dev/ttyUSB0'` | `sudo usermod -aG dialout $USER` sonrası **yeniden giriş yapın** |
| `Geçersiz cihaz token'ı` | Token yanlış veya iptal edilmiş; panelden yenisini üretin |
| Arduino bağlanıyor ama veri yok | Seri Monitör'ü kapatın — port aynı anda tek program tarafından kullanılabilir |
| `bmp180: false` | I²C bağlantısını kontrol edin (SDA→A4, SCL→A5, besleme 3.3V) |
| DHT değerleri eksik | Pull-up direnci takılı mı? DHT11/DHT22 seçimi doğru mu? |
| Anlamsız karakterler | Baud hızı uyuşmuyor — sketch 9600, ajan `--baud 9600` olmalı |
| Servo hareket edince kart resetleniyor | Servo ayrı güç kaynağından beslenmiyor (yukarıdaki uyarı) |
| Ölçümler tamponda birikiyor | İnternet yok ya da API uykuda; bağlantı dönünce otomatik gönderilir |

---

## Ajan ne yapar, ne yapmaz

**Yapar:** seri porttan `VERI:` satırlarını okur · ölçümleri paketleyip buluta
gönderir · internet kesilirse ~1 saatlik veriyi tamponlar · panelden gelen
servo/röle komutlarını Arduino'ya metin komutu olarak iletir · kopan
bağlantıları üstel geri çekilmeyle yeniler.

**Yapmaz:** veritabanı tutmaz, web arayüzü sunmaz, Pi'ye ağır bir yığın kurmaz.
Tüm veri ve arayüz bulutta kalır.
