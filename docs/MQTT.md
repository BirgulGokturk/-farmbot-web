# Robot Haberleşme Protokolü (MQTT + CeleryScript)

Robot ile backend arasındaki tüm iletişim **MQTT** üzerinden, **CeleryScript** JSON
formatıyla yapılır. Bu, [FarmBot'un kendi protokolüyle](https://developer.farm.bot/docs/message-broker)
uyumludur.

---

## 1. Neden MQTT?

| Gereksinim | MQTT'nin cevabı |
|---|---|
| Gecikmesiz kontrol | Kalıcı TCP bağlantısı — HTTP polling'in aksine tur atma yok |
| Robot NAT/güvenlik duvarı arkasında | Robot **dışa doğru** bağlanır; port yönlendirme gerekmez |
| Bağlantı koparsa | LWT (Last Will) ile robot anında "çevrimdışı" işaretlenir |
| Düşük bant genişliği | İkili/kompakt kare yapısı, mobil hat dostu |
| Teslim garantisi | QoS 0/1/2 — komutlar QoS 1, telemetri QoS 0 |

---

## 2. Konu (Topic) Yapısı

Kök: `bot/device_<device_id>/`

| Konu | Yön | QoS | Açıklama |
|---|---|---|---|
| `bot/device_<id>/from_clients` | Backend → Robot | 1 | RPC komutları |
| `bot/device_<id>/from_device` | Robot → Backend | 1 | `rpc_ok` / `rpc_error` yanıtları |
| `bot/device_<id>/status` | Robot → Backend | 0, **retained** | Tam durum ağacı |
| `bot/device_<id>/logs` | Robot → Backend | 0 | Log satırları |
| `bot/device_<id>/sync/<Kaynak>/<id>` | Çift yönlü | 1 | Kaynak senkronizasyonu |
| `bot/device_<id>/ping/<uuid>` | Backend → Robot | 0 | Gecikme ölçümü |
| `bot/device_<id>/pong/<uuid>` | Robot → Backend | 0 | Ping yanıtı |
| `bot/device_<id>/telemetry` | Robot → Backend | 0 | CPU/sıcaklık/WiFi |

**LWT (Last Will and Testament):** Robot bağlanırken
`bot/device_<id>/status` konusuna `{"informational_settings":{"sync_status":"offline"}}`
mesajını vasiyet olarak bırakır. Bağlantı koparsa broker bunu otomatik yayınlar.

---

## 3. RPC İstek Formatı

```json
{
  "kind": "rpc_request",
  "args": { "label": "0f3c9a1e-4b2d-4a77-9c6e-2f8b1d0a7e55", "priority": 500 },
  "body": [
    {
      "kind": "move_absolute",
      "args": {
        "location": { "kind": "coordinate", "args": { "x": 100, "y": 200, "z": 0 } },
        "offset":   { "kind": "coordinate", "args": { "x": 0, "y": 0, "z": 0 } },
        "speed": 100
      }
    }
  ]
}
```

`args.label` istemcinin ürettiği UUID'dir. Robot yanıtı aynı `label` ile döner —
backend böylece hangi komutun cevaplandığını eşleştirir.

### Başarılı yanıt
```json
{ "kind": "rpc_ok", "args": { "label": "0f3c9a1e-..." } }
```

### Hatalı yanıt
```json
{
  "kind": "rpc_error",
  "args": { "label": "0f3c9a1e-..." },
  "body": [ { "kind": "explanation", "args": { "message": "X ekseni sınır anahtarına çarptı" } } ]
}
```

---

## 4. Desteklenen Komutlar

### Hareket
| `kind` | Argümanlar | Kullanım |
|---|---|---|
| `move_absolute` | `location`, `offset`, `speed` | Mutlak koordinata git |
| `move_relative` | `x`, `y`, `z`, `speed` | Göreli adım (jog pad) |
| `home` | `axis`, `speed` | Eve dön (`x`\|`y`\|`z`\|`all`) |
| `find_home` | `axis`, `speed` | Sınır anahtarıyla ev bul |
| `calibrate` | `axis` | Eksen uzunluğunu kalibre et |
| `set_zero` | `axis` | Mevcut konumu sıfır kabul et |

### Çevre birimleri ve sensörler
| `kind` | Argümanlar | Kullanım |
|---|---|---|
| `write_pin` | `pin_number`, `pin_value`, `pin_mode` | Pompa/vana/lamba aç-kapa |
| `read_pin` | `pin_number`, `pin_mode`, `label` | Sensör oku |
| `set_servo_angle` | `pin_number`, `pin_value` | Servo açısı |
| `toggle_pin` | `pin_number` | Durumu tersine çevir |

### Kamera ve sistem
| `kind` | Argümanlar | Kullanım |
|---|---|---|
| `take_photo` | — | Fotoğraf çek ve yükle |
| `emergency_lock` | — | **ACİL DURDURMA** |
| `emergency_unlock` | — | Kilidi aç |
| `reboot` / `power_off` | — | Yeniden başlat / kapat |
| `execute` | `sequence_id` | Kayıtlı diziyi çalıştır |
| `sync` | — | Kaynakları senkronize et |
| `read_status` | — | Durum ağacını yeniden yayınla |

---

## 5. Durum Ağacı (`status` konusu)

Robot her değişiklikte tam durumunu **retained** olarak yayınlar. Yeni bağlanan
backend anında güncel durumu alır.

```json
{
  "location_data": {
    "position":  { "x": 1220.0, "y": 480.5, "z": -120.0 },
    "scaled_encoders": { "x": 1220.0, "y": 480.5, "z": -120.0 },
    "axis_states": { "x": "idle", "y": "idle", "z": "idle" }
  },
  "pins": {
    "8":  { "mode": 0, "value": 1 },
    "10": { "mode": 0, "value": 0 }
  },
  "informational_settings": {
    "sync_status": "synced",
    "locked": false,
    "busy": false,
    "firmware_version": "6.6.16",
    "soc_temp": 47.2,
    "wifi_level": -58,
    "uptime": 84213,
    "cpu_usage": 12,
    "memory_usage": 38,
    "disk_usage": 41
  },
  "configuration": { "firmware_hardware": "farmduino_k16" },
  "user_env": {},
  "process_info": { "farmwares": {} }
}
```

Backend bu ağacı `services/mqtt.py` içinde normalize edip
`DeviceStatus` nesnesine dönüştürür ve WebSocket ile tarayıcıya yayınlar.

---

## 6. Kimlik Doğrulama

| Taraf | Yöntem |
|---|---|
| **Backend → Broker** | `.env` içindeki servis kullanıcısı; `bot/#` altındaki her konuya yetkili |
| **Robot → Broker** | Cihaza özel kullanıcı/parola; **sadece kendi** `bot/device_<id>/#` ağacına yetkili |
| **Taşıma** | Üretimde TLS (8883). Geliştirmede düz TCP (1883) |

Mosquitto ACL örneği (`infra/mosquitto/config/acl`):
```
user farmbot_backend
topic readwrite bot/#

user device_a1b2c3d4
topic readwrite bot/device_a1b2c3d4/#
```

---

## 7. Yerelde Test

```bash
docker compose up -d mosquitto
```

Durum yayınlamayı taklit et:
```bash
mosquitto_pub -h localhost -p 1883 -t "bot/device_test/status" -r \
  -m '{"location_data":{"position":{"x":0,"y":0,"z":0}},"informational_settings":{"sync_status":"synced","locked":false}}'
```

Komutları dinle:
```bash
mosquitto_sub -h localhost -p 1883 -t "bot/device_test/from_clients" -v
```
