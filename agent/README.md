# KÃ¶prÃ¼ AjanÄ± â€” Raspberry Pi Kurulumu

Arduino'dan gelen sensÃ¶r verilerini canlÄ± panele taÅŸÄ±yan kÃ¼Ã§Ã¼k bir Python
programÄ±. Pi'ye uygulamanÄ±n tamamÄ± **kurulmaz**; yalnÄ±zca bu ajan Ã§alÄ±ÅŸÄ±r.

```
Arduino â”€â”€USB seriâ”€â”€> Raspberry Pi (ajan) â”€â”€HTTPS/WSSâ”€â”€> farmbot-api.onrender.com
                                                                    â”‚
                                                        farmbot-hmi.onrender.com
```

---

## 1. Arduino tarafÄ±

1. Arduino IDE'yi aÃ§Ä±n, **KÃ¼tÃ¼phane YÃ¶neticisi**'nden ÅŸunlarÄ± kurun:
   - `Adafruit BMP085 Library` (BMP180/GY-68 ile uyumlu)
   - `DHT sensor library` (Adafruit)
   - `Adafruit Unified Sensor`

   > JSON kÃ¼tÃ¼phanesi gerekmez â€” Ã§Ä±ktÄ± elle Ã¼retiliyor.

2. [`firmware/arduino/farmbot_sensors/farmbot_sensors.ino`](../firmware/arduino/farmbot_sensors/farmbot_sensors.ino)
   dosyasÄ±nÄ± aÃ§Ä±n.
3. Sketch **DHT11** iÃ§in ayarlÄ±dÄ±r. DHT22'ye geÃ§erseniz `#define DHTTYPE DHT11`
   satÄ±rÄ±nÄ± `DHT22` yapmanÄ±z yeterli.
4. Karta yÃ¼kleyin ve Seri MonitÃ¶r'Ã¼ **9600** baud ile aÃ§Ä±n.

Arduino iki tÃ¼r satÄ±r basar â€” insan iÃ§in TÃ¼rkÃ§e durum satÄ±rlarÄ±, kÃ¶prÃ¼ iÃ§in
`VERI:` Ã¶nekli satÄ±r:

```
Hava Nemi: %54.00 | Ort. Sicaklik: 23.50 *C
Basinc: 101140 Pa | Yagmur/Nem Seviyesi: 468
DURUM: Kuru hava. Sistem kapali konumda.
VERI:{"dht_humidity":54.0,"dht_temperature":23.0,"bmp180_temperature":24.0,...}
----------------------------------------
```

KÃ¶prÃ¼ yalnÄ±zca `VERI:` satÄ±rÄ±nÄ± okur, diÄŸerlerini yok sayar â€” bÃ¶ylece Seri
MonitÃ¶r'den sistemi izlemeye devam edebilirsiniz.

### Seri MonitÃ¶r'den elle komut deneme

GiriÅŸ kutusuna yazÄ±p Enter'a basÄ±n (satÄ±r sonu **"Yeni SatÄ±r"** olmalÄ±):

| Komut | Etkisi |
|---|---|
| `AC` | Servo 90Â° (vana aÃ§), MANUEL kipe geÃ§er |
| `KAPA` | Servo 0Â° (vana kapa) |
| `SERVO 45` | Servoyu belirtilen aÃ§Ä±ya al |
| `AUTO` | Otomatik karar mekanizmasÄ±na geri dÃ¶n |
| `OKU` | Beklemeden hemen Ã¶lÃ§Ã¼m satÄ±rÄ± bas |

### BaÄŸlantÄ±lar (Arduino Uno)

| BileÅŸen | BaÄŸlantÄ± |
|---|---|
| BMP180 / GY-68 | `VCCâ†’3.3V` Â· `GNDâ†’GND` Â· `SDAâ†’A4` Â· `SCLâ†’A5` |
| DHT11 | `VCCâ†’5V` Â· `GNDâ†’GND` Â· `DATAâ†’D2` (DATAâ€“VCC arasÄ±na 10 kÎ©; 3 bacaklÄ± hazÄ±r modÃ¼lde direnÃ§ kart Ã¼zerindedir) |
| HW-103 | `VCCâ†’5V` Â· `GNDâ†’GND` Â· `AOâ†’A0` Â· `DOâ†’D3` |
| SG-5010 servo | Turuncuâ†’`D6` Â· KÄ±rmÄ±zÄ±â†’**ayrÄ± 5â€“6 V gÃ¼Ã§** Â· Kahveâ†’ortak `GND` |

> âš ï¸ **Servoyu Arduino'nun 5V pininden beslemeyin.** SG-5010 yÃ¼k altÄ±nda 1 A'in
> Ã¼zerine Ã§Ä±kar; Arduino'nun regÃ¼latÃ¶rÃ¼ bunu kaldÄ±ramaz ve kart hareket
> sÄ±rasÄ±nda resetlenir. AyrÄ± bir gÃ¼Ã§ kaynaÄŸÄ± kullanÄ±n ve **GND'leri birleÅŸtirin**.

### Toprak nemi kalibrasyonu

`hw103_soil_raw` kanalÄ± ham ADC deÄŸerini de gÃ¶nderir. Panelde bu deÄŸeri izleyin:

1. SensÃ¶r **kuru** havadayken deÄŸeri not alÄ±n â†’ sketch'teki `SOIL_DRY`
2. SensÃ¶rÃ¼ **suya** batÄ±rÄ±n, yeni deÄŸeri not alÄ±n â†’ `SOIL_WET`
3. Sketch'i gÃ¼ncelleyip tekrar yÃ¼kleyin

---

## 2. Panelden cihaz token'Ä± alÄ±n

1. https://farmbot-hmi.onrender.com adresinde oturum aÃ§Ä±n
2. **Ayarlar â†’ KÃ¶prÃ¼ AjanÄ±** â†’ **Token Ãœret**
3. Ã‡Ä±kan `fbt_...` dizesini kopyalayÄ±n â€” **yalnÄ±zca bir kez gÃ¶sterilir**

---

## 3. Raspberry Pi tarafÄ±

```bash
sudo apt update && sudo apt install -y python3-venv git
git clone https://github.com/BirgulGokturk/-farmbot-web.git
cd -farmbot-web/agent
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

KullanÄ±cÄ±nÄ±zÄ± seri porta eriÅŸim grubuna ekleyin (bir kez, sonra yeniden giriÅŸ):

```bash
sudo usermod -aG dialout $USER
```

Arduino'nun hangi portta olduÄŸunu bulun:

```bash
ls /dev/ttyUSB* /dev/ttyACM*
```

> Uno R3 klonlarÄ±nda genellikle `/dev/ttyUSB0`, orijinal Uno'da `/dev/ttyACM0`.

Deneme Ã§alÄ±ÅŸtÄ±rmasÄ±:

```bash
.venv/bin/python farmbot_agent.py --port /dev/ttyUSB0 --token fbt_xxx --verbose
```

Åuna benzer Ã§Ä±ktÄ± gÃ¶rmelisiniz:

```
19:42:01  INFO    Ajan baÅŸlÄ±yor Â· port=/dev/ttyUSB0 Â· api=https://farmbot-api.onrender.com
19:42:04  INFO    Arduino baÄŸlandÄ±: /dev/ttyUSB0 @ 9600
19:42:04  INFO    Arduino hazÄ±r: {"t": "hello", "fw": "farmbot-node-1.0", ...}
19:42:05  INFO    Komut kanalÄ± aÃ§Ä±ldÄ±
19:42:19  INFO    14 Ã¶lÃ§Ã¼m gÃ¶nderildi (toplam 14, tamponda 0)
```

Bu satÄ±rlarÄ± gÃ¶rdÃ¼ÄŸÃ¼nÃ¼zde panelde **SensÃ¶rler** bÃ¶lÃ¼mÃ¼nde veriler akmaya baÅŸlar.

---

## 4. SÃ¼rekli Ã§alÄ±ÅŸmasÄ± iÃ§in servis kurun

```bash
sudo cp farmbot-agent.service /etc/systemd/system/
sudo nano /etc/systemd/system/farmbot-agent.service   # token ve portu dÃ¼zenleyin
sudo systemctl daemon-reload
sudo systemctl enable --now farmbot-agent
```

Durum ve gÃ¼nlÃ¼kler:

```bash
systemctl status farmbot-agent
journalctl -u farmbot-agent -f
```

---

## Sorun giderme

| Belirti | Sebep / Ã§Ã¶zÃ¼m |
|---|---|
| `Permission denied: '/dev/ttyUSB0'` | `sudo usermod -aG dialout $USER` sonrasÄ± **yeniden giriÅŸ yapÄ±n** |
| `GeÃ§ersiz cihaz token'Ä±` | Token yanlÄ±ÅŸ veya iptal edilmiÅŸ; panelden yenisini Ã¼retin |
| Arduino baÄŸlanÄ±yor ama veri yok | Seri MonitÃ¶r'Ã¼ kapatÄ±n â€” port aynÄ± anda tek program tarafÄ±ndan kullanÄ±labilir |
| `bmp180: false` | IÂ²C baÄŸlantÄ±sÄ±nÄ± kontrol edin; `sudo i2cdetect -y 1` ile modÃ¼lÃ¼ arayÄ±n |
| DHT deÄŸerleri eksik | Pull-up direnci takÄ±lÄ± mÄ±? DHT11/DHT22 seÃ§imi doÄŸru mu? |
| Servo hareket edince kart resetleniyor | Servo ayrÄ± gÃ¼Ã§ kaynaÄŸÄ±ndan beslenmiyor (yukarÄ±daki uyarÄ±) |
| Ã–lÃ§Ã¼mler tamponda birikiyor | Ä°nternet yok ya da API uykuda; baÄŸlantÄ± dÃ¶nÃ¼nce otomatik gÃ¶nderilir |

---

## Ajan ne yapar, ne yapmaz

**Yapar:** seri porttan JSON okur Â· Ã¶lÃ§Ã¼mleri paketleyip buluta gÃ¶nderir Â·
internet kesilirse ~1 saatlik veriyi tamponlar Â· panelden gelen servo/rÃ¶le
komutlarÄ±nÄ± Arduino'ya iletir Â· kopan baÄŸlantÄ±larÄ± Ã¼stel geri Ã§ekilmeyle yeniler.

**Yapmaz:** veritabanÄ± tutmaz, web arayÃ¼zÃ¼ sunmaz, Pi'ye aÄŸÄ±r bir yÄ±ÄŸÄ±n kurmaz.
TÃ¼m veri ve arayÃ¼z bulutta kalÄ±r.

