# Veritabanı Şeması

**PostgreSQL 16** · SQLAlchemy 2.0 (async) · Alembic göçleri

Şema, [FarmBot resmî veri modeliyle](https://developer.farm.bot/v15/docs/web-app/api-docs)
kavramsal olarak uyumludur (`points`, `sequences`, `farm_events`, `sensors`, `curves` …),
böylece ileride resmî FarmBot OS çalıştıran bir kartla da veri alışverişi yapılabilir.

---

## 1. İlişki Diyagramı

```
                             ┌──────────┐
                             │  users   │
                             └────┬─────┘
                                  │ 1:N
                             ┌────▼─────┐
              ┌──────────────┤ devices  ├───────────────┐
              │              └────┬─────┘               │
              │                   │                     │
   ┌──────────┼──────────┬────────┼────────┬────────────┼──────────┐
   │          │          │        │        │            │          │
┌──▼───┐ ┌────▼─────┐ ┌──▼────┐ ┌─▼─────┐ ┌▼────────┐ ┌─▼──────┐ ┌─▼──────┐
│points│ │sequences │ │sensors│ │periph.│ │  logs   │ │ images │ │ tools  │
└──┬───┘ └────┬─────┘ └──┬────┘ └───────┘ └─────────┘ └────────┘ └───┬────┘
   │          │          │                                            │
   │          │ 1:N   ┌──▼──────────────┐                             │
   │          │       │ sensor_readings │                             │
   │          │       └─────────────────┘                             │
   │          │                                                       │
   │     ┌────▼───────┐   ┌───────────┐                               │
   │     │farm_events │   │ regimens  │                               │
   │     └────────────┘   └─────┬─────┘                               │
   │                            │ 1:N                                 │
   │                     ┌──────▼───────┐                             │
   │                     │regimen_items │                             │
   │                     └──────────────┘                             │
   │                                                                  │
   │  points.tool_id ─────────────────────────────────────────────────┘
   │
   ├── points.species_id ────► plant_species  (küresel bitki kataloğu)
   ├── points.*_curve_id ───► curves          (su / yayılım / boy eğrileri)
   └── point_groups.point_ids (JSONB) ────────► points
```

---

## 2. Tablolar

### `users` — Hesaplar
| Sütun | Tip | Not |
|---|---|---|
| `id` | UUID PK | |
| `email` | citext UNIQUE NOT NULL | giriş kimliği |
| `hashed_password` | text NOT NULL | bcrypt |
| `full_name` | text | |
| `timezone` | text | varsayılan `Europe/Istanbul` |
| `is_active` | bool | varsayılan `true` |
| `created_at` / `updated_at` | timestamptz | |

---

### `devices` — Robotlar
Bir hesap birden fazla FarmBot yönetebilir.

| Sütun | Tip | Not |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK→users ON DELETE CASCADE | |
| `name` | text NOT NULL | "Bahçe Robotu" |
| `serial_number` | text UNIQUE | donanım kimliği |
| `mqtt_username` / `mqtt_password_hash` | text | robotun broker kimliği |
| `firmware_version` | text | |
| `timezone` | text | |
| `lat` / `lng` | double | hava durumu / gün doğumu hesabı |
| `indoor` | bool | |
| **Çalışma alanı** | | |
| `bed_width_mm` | int | X ekseni uzunluğu (Genesis XL ≈ 6000) |
| `bed_length_mm` | int | Y ekseni uzunluğu (≈ 3000) |
| `max_z_mm` | int | Z ekseni derinliği (≈ 500) |
| `safe_height_mm` | int | güvenli geçiş yüksekliği |
| `soil_height_mm` | int | toprak yüzeyi Z değeri |
| **Durum (önbellek)** | | |
| `last_seen_at` | timestamptz | son MQTT teması |
| `is_locked` | bool | acil durdurma aktif mi |
| `mounted_tool_id` | UUID FK→tools | takılı alet |
| `settings` | JSONB | firmware/kalibrasyon parametreleri, esnek alan |

> `settings` JSONB, motor akımı, mikro-adım, encoder, pin koruması gibi onlarca
> firmware parametresini şema göçü gerektirmeden taşır.

---

### `points` — Bahçedeki her şey (FarmBot `points` modeliyle birebir)
Bitkiler, yabani otlar, alet yuvaları ve işaretçiler **tek tabloda** tutulur;
`point_type` ayrımı yapar. FarmBot'un kendi yaklaşımı da budur.

| Sütun | Tip | Not |
|---|---|---|
| `id` | UUID PK | |
| `device_id` | UUID FK→devices CASCADE | |
| `point_type` | enum | `plant` · `weed` · `tool_slot` · `marker` |
| `name` | text NOT NULL | |
| `x` / `y` / `z` | double NOT NULL | mm cinsinden mutlak koordinat |
| `radius_mm` | double | çizimdeki yarıçap |
| `meta` | JSONB | serbest alan |
| `created_at` / `updated_at` | timestamptz | |
| **`plant` / `weed` için** | | |
| `species_id` | UUID FK→plant_species | katalog bağlantısı |
| `stage` | enum | `planned` · `planted` · `sprouted` · `active` · `harvested` · `removed` |
| `planted_at` | timestamptz | |
| `depth_mm` | int | ekim derinliği |
| `water_curve_id` / `spread_curve_id` / `height_curve_id` | UUID FK→curves | |
| `discarded_at` | timestamptz | yabani ot için |
| **`tool_slot` için** | | |
| `tool_id` | UUID FK→tools | yuvadaki alet |
| `pullout_direction` | smallint | 0–4 (çıkarma yönü) |
| `gantry_mounted` | bool | |

**İndeksler:** `(device_id, point_type)`, `(device_id, x, y)` — tasarımcı ekranı bir
görünüm alanındaki noktaları hızlı çeksin diye.

---

### `plant_species` — Bitki kataloğu (küresel, cihazdan bağımsız)
| Sütun | Tip | Not |
|---|---|---|
| `id` | UUID PK | |
| `slug` | text UNIQUE | `domates`, `marul` … |
| `name_tr` / `name_en` | text | |
| `icon` | text | emoji veya ikon adı |
| `color` | text | tasarımcıdaki renk |
| `spread_mm` | int | bitkiler arası aralık |
| `sow_depth_mm` | int | ekim derinliği |
| `days_to_harvest` | int | olgunlaşma süresi |
| `water_ml_per_day` | int | günlük su ihtiyacı |
| `sun_requirement` | enum | `full` · `partial` · `shade` |
| `notes` | text | |

---

### `curves` — Büyüme eğrileri
Bitki yaşına göre su/yayılım/boy değerini modelleyen tablo.

| Sütun | Tip | Not |
|---|---|---|
| `id` | UUID PK | |
| `device_id` | UUID FK→devices CASCADE | |
| `name` | text NOT NULL | |
| `curve_type` | enum | `water` · `spread` · `height` |
| `data` | JSONB NOT NULL | `{"1": 50, "10": 120, "30": 400}` → gün: değer |

---

### `tools` — Aletler
| Sütun | Tip |
|---|---|
| `id` | UUID PK |
| `device_id` | UUID FK→devices CASCADE |
| `name` | text NOT NULL — "Sulama Ucu", "Ekici", "Toprak Sensörü" |
| `flow_rate_ml_per_s` | double — sulama ucu için debi |
| `status` | enum: `active` · `inactive` |

---

### `sequences` — Komut dizileri
| Sütun | Tip | Not |
|---|---|---|
| `id` | UUID PK | |
| `device_id` | UUID FK→devices CASCADE | |
| `name` | text NOT NULL | |
| `description` | text | |
| `color` | text | UI etiketi |
| `body` | JSONB NOT NULL | CeleryScript adım dizisi |
| `args` | JSONB | değişken tanımları (kapsam) |
| `pinned` | bool | |
| `folder` | text | basit gruplama |

`body` örneği:
```json
[
  { "kind": "move_absolute", "args": { "x": 100, "y": 200, "z": 0, "speed": 100 } },
  { "kind": "write_pin", "args": { "pin_number": 8, "pin_value": 1, "pin_mode": 0 } },
  { "kind": "wait", "args": { "milliseconds": 5000 } },
  { "kind": "write_pin", "args": { "pin_number": 8, "pin_value": 0, "pin_mode": 0 } }
]
```

---

### `regimens` + `regimen_items` — Bitki yaşına bağlı programlar
| `regimens` | Tip |
|---|---|
| `id` | UUID PK |
| `device_id` | UUID FK→devices CASCADE |
| `name` | text NOT NULL |
| `color` | text |

| `regimen_items` | Tip | Not |
|---|---|---|
| `id` | UUID PK | |
| `regimen_id` | UUID FK→regimens CASCADE | |
| `sequence_id` | UUID FK→sequences | çalıştırılacak dizi |
| `day_offset` | int NOT NULL | ekimden kaç gün sonra |
| `time_of_day` | time NOT NULL | saat |

---

### `farm_events` — Takvim / zamanlayıcı
Sulama zamanlayıcısı ve takvim modülünün veri kaynağı.

| Sütun | Tip | Not |
|---|---|---|
| `id` | UUID PK | |
| `device_id` | UUID FK→devices CASCADE | |
| `executable_type` | enum | `sequence` · `regimen` |
| `executable_id` | UUID NOT NULL | hedef kaynağın kimliği |
| `start_time` | timestamptz NOT NULL | |
| `end_time` | timestamptz | |
| `repeat_every` | int | tekrar sayısı (0 = tekrarsız) |
| `time_unit` | enum | `never` · `minutely` · `hourly` · `daily` · `weekly` · `monthly` · `yearly` |
| `body` | JSONB | değişken atamaları |
| `is_active` | bool | |
| `last_run_at` / `next_run_at` | timestamptz | zamanlayıcı için |

**İndeks:** `(device_id, is_active, next_run_at)` — sıradaki görevi bulmak için.

---

### `peripherals` — GPIO çıkışları (pompa, vana, lamba, vakum)
| Sütun | Tip | Not |
|---|---|---|
| `id` | UUID PK | |
| `device_id` | UUID FK→devices CASCADE | |
| `label` | text NOT NULL | "Su Pompası" |
| `pin` | int NOT NULL | GPIO numarası |
| `mode` | smallint | 0 = dijital, 1 = analog |
| `icon` | text | |

---

### `sensors` — GPIO girişleri
| Sütun | Tip | Not |
|---|---|---|
| `id` | UUID PK | |
| `device_id` | UUID FK→devices CASCADE | |
| `label` | text NOT NULL | "Toprak Nemi" |
| `pin` | int NOT NULL | 0–69 |
| `mode` | smallint | 0 = dijital, 1 = analog |
| `unit` | text | `%`, `°C`, `lux` |
| `min_value` / `max_value` | double | ölçekleme için |

---

### `sensor_readings` — Telemetri (zaman serisi)
| Sütun | Tip | Not |
|---|---|---|
| `id` | bigserial PK | yüksek hacim → UUID değil |
| `device_id` | UUID FK→devices CASCADE | |
| `sensor_id` | UUID FK→sensors SET NULL | |
| `pin` | int | |
| `value` | double NOT NULL | ham değer |
| `x` / `y` / `z` | double | ölçüm anındaki konum |
| `read_at` | timestamptz NOT NULL | |

**İndeks:** `(device_id, sensor_id, read_at DESC)` — grafik sorguları için.
İleride hacim büyürse `read_at` üzerinden aylık **partition** veya TimescaleDB.

---

### `logs` — Sistem kayıtları
| Sütun | Tip | Not |
|---|---|---|
| `id` | bigserial PK | |
| `device_id` | UUID FK→devices CASCADE | |
| `message` | text NOT NULL | |
| `level` | enum | `debug` · `info` · `success` · `warn` · `error` |
| `channels` | JSONB | `["ticker","toast","email"]` |
| `x` / `y` / `z` | double | olay konumu |
| `created_at` | timestamptz | |

**İndeks:** `(device_id, created_at DESC)`

---

### `images` — Kamera çekimleri
| Sütun | Tip | Not |
|---|---|---|
| `id` | UUID PK | |
| `device_id` | UUID FK→devices CASCADE | |
| `url` | text NOT NULL | S3 veya yerel disk yolu |
| `thumbnail_url` | text | |
| `x` / `y` / `z` | double | çekim konumu |
| `captured_at` | timestamptz | |
| `meta` | JSONB | çözünürlük, kalibrasyon, tespit sonuçları |

---

### `point_groups` — Nokta grupları
Bir diziyi "tüm domateslere uygula" gibi toplu çalıştırmak için.

| Sütun | Tip | Not |
|---|---|---|
| `id` | UUID PK | |
| `device_id` | UUID FK→devices CASCADE | |
| `name` | text NOT NULL | |
| `point_ids` | JSONB | UUID dizisi (manuel seçim) |
| `criteria` | JSONB | otomatik kural: `{"species_id": "...", "stage": "planted"}` |
| `sort_type` | enum | `xy_ascending` · `yx_ascending` · `random` · `nearest` |

---

## 3. Ortak Kurallar

- **Birincil anahtar:** yüksek hacimli iki tablo (`sensor_readings`, `logs`) dışında **UUID v4**.
  Sebep: cihaz üzerinde çevrimdışı üretilen kayıtlar çakışmadan senkronize olabilsin.
- **Zaman damgaları:** her tabloda `created_at` / `updated_at`, hepsi **timestamptz (UTC)**.
  Yerelleştirme sunum katmanında `device.timezone` ile yapılır.
- **Silme:** `devices` silinince ona bağlı her şey `ON DELETE CASCADE`.
  `points` için **yumuşak silme** (`discarded_at`) — FarmBot da silinen noktayı 2 ay saklar.
- **Koordinat birimi:** her yerde **milimetre**, robotun kendi birimiyle aynı — dönüşüm hatası olmaz.
- **JSONB kullanımı:** `meta`, `settings`, `body`, `criteria` alanları göç gerektirmeden
  yeni alan eklenmesine izin verir.

---

## 4. Göç (Migration) Akışı

```bash
# yeni göç üret
docker compose exec backend alembic revision --autogenerate -m "aciklama"

# uygula
docker compose exec backend alembic upgrade head

# geri al
docker compose exec backend alembic downgrade -1
```
