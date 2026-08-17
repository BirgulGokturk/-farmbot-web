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
   - `ArduinoJson` (7.x)
2. [`firmware/arduino/farmbot_sensors/farmbot_sensors.ino`](../firmware/arduino/farmbot_sensors/farmbot_sensors.ino)
   dosyasını açın.
3. Sketch **DHT11** için ayarlıdır. DHT22'ye geçerseniz `#define DHT_TYPE DHT11`
   satırını `DHT22` yapmanız yeterli.
4. Karta yükleyin. Seri Monitör'ü **115200** baud ile açtığınızda saniyeler
   içinde şuna benzer satırlar görmelisiniz:

```json
{"t":"hello","fw":"farmbot-node-1.0","bmp180":true,"dht":"DHT22"}
{"t":"data","readings":{"bmp180_temperature":24.3,"bmp180_pressure":1011.4,...}}
```

### Bağlantılar (Arduino Uno)

| Bileşen | Bağlantı |
|---|---|
| BMP180 / GY-68 | `VCC→3.3V` · `GND→GND` · `SDA→A4` · `SCL→A5` |
| DHT11 | `VCC→5V` · `GND→GND` · `DATA→D2` (DATA–VCC arasına 10 kΩ; 3 bacaklı hazır modülde direnç kart üzerindedir) |
| HW-103 | `VCC→5V` · `GND→GND` · `AO→A0` · `DO→D3` |
| SG-5010 servo | Turuncu→`D6` · Kırmızı→**ayrı 5–6 V güç** · Kahve→ortak `GND` |

> ⚠️ **Servoyu Arduino'nun 5V pininden beslemeyin.** SG-5010 yük altında 1 A'in
> üzerine çıkar; Arduino'nun regülatörü bunu kaldıramaz ve kart hareket
> sırasında resetlenir. Ayrı bir güç kaynağı kullanın ve **GND'leri birleştirin**.

### Toprak nemi kalibrasyonu

`hw103_soil_raw` kanalı ham ADC değerini de gönderir. Panelde bu değeri izleyin:

1. Sensör **kuru** havadayken değeri not alın → sketch'teki `SOIL_DRY`
2. Sensörü **suya** batırın, yeni değeri not alın → `SOIL_WET`
3. Sketch'i güncelleyip tekrar yükleyin

---

## 2. Panelden cihaz token'ı alın

1. https://farmbot-hmi.onrender.com adresinde oturum açın
2. **Ayarlar → Köprü Ajanı** → **Token Üret**
3. Çıkan `fbt_...` dizesini kopyalayın — **yalnızca bir kez gösterilir**

---

## 3. Raspberry Pi tarafı

```bash
sudo apt update && sudo apt install -y python3-venv git
git clone https://github.com/BirgulGokturk/-farmbot-web.git
cd -farmbot-web/agent
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Kullanıcınızı seri porta erişim grubuna ekleyin (bir kez, sonra yeniden giriş):

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
19:42:04  INFO    Arduino bağlandı: /dev/ttyUSB0 @ 115200
19:42:04  INFO    Arduino hazır: {"t": "hello", "fw": "farmbot-node-1.0", ...}
19:42:05  INFO    Komut kanalı açıldı
19:42:19  INFO    14 ölçüm gönderildi (toplam 14, tamponda 0)
```

Bu satırları gördüğünüzde panelde **Sensörler** bölümünde veriler akmaya başlar.

---

## 4. Sürekli çalışması için servis kurun

```bash
sudo cp farmbot-agent.service /etc/systemd/system/
sudo nano /etc/systemd/system/farmbot-agent.service   # token ve portu düzenleyin
sudo systemctl daemon-reload
sudo systemctl enable --now farmbot-agent
```

Durum ve günlükler:

```bash
systemctl status farmbot-agent
journalctl -u farmbot-agent -f
```

---

## Sorun giderme

| Belirti | Sebep / çözüm |
|---|---|
| `Permission denied: '/dev/ttyUSB0'` | `sudo usermod -aG dialout $USER` sonrası **yeniden giriş yapın** |
| `Geçersiz cihaz token'ı` | Token yanlış veya iptal edilmiş; panelden yenisini üretin |
| Arduino bağlanıyor ama veri yok | Seri Monitör'ü kapatın — port aynı anda tek program tarafından kullanılabilir |
| `bmp180: false` | I²C bağlantısını kontrol edin; `sudo i2cdetect -y 1` ile modülü arayın |
| DHT değerleri eksik | Pull-up direnci takılı mı? DHT11/DHT22 seçimi doğru mu? |
| Servo hareket edince kart resetleniyor | Servo ayrı güç kaynağından beslenmiyor (yukarıdaki uyarı) |
| Ölçümler tamponda birikiyor | İnternet yok ya da API uykuda; bağlantı dönünce otomatik gönderilir |

---

## Ajan ne yapar, ne yapmaz

**Yapar:** seri porttan JSON okur · ölçümleri paketleyip buluta gönderir ·
internet kesilirse ~1 saatlik veriyi tamponlar · panelden gelen servo/röle
komutlarını Arduino'ya iletir · kopan bağlantıları üstel geri çekilmeyle yeniler.

**Yapmaz:** veritabanı tutmaz, web arayüzü sunmaz, Pi'ye ağır bir yığın kurmaz.
Tüm veri ve arayüz bulutta kalır.
