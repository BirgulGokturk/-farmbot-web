# FarmBot Web — Mimari Dokümanı

> Açık kaynak FarmBot robotunu internet üzerinden yöneten web uygulaması.
> Referans: [FarmBot Developer Docs](https://developer.farm.bot) · [Farmbot-Web-App](https://github.com/FarmBot/Farmbot-Web-App)

---

## 1. Sistem Genel Görünümü

```
┌──────────────────┐        HTTPS / WSS        ┌─────────────────────┐
│   TARAYICI       │ ◄───────────────────────► │   BACKEND (API)     │
│  React + Vite    │   REST + WebSocket        │   FastAPI (Python)  │
│  (masaüstü/mobil)│                           │                     │
└──────────────────┘                           └──────┬──────────────┘
                                                      │
                                       ┌──────────────┼──────────────┐
                                       │              │              │
                                  ┌────▼────┐   ┌─────▼─────┐  ┌─────▼─────┐
                                  │PostgreSQL│   │   MQTT    │  │  S3/Disk  │
                                  │  (veri)  │   │  Broker   │  │(fotoğraf) │
                                  └──────────┘   └─────┬─────┘  └───────────┘
                                                       │ MQTT/TLS
                                                 ┌─────▼──────────────┐
                                                 │  FARMBOT DONANIMI  │
                                                 │ Raspberry Pi  ─────┤
                                                 │   └─ Arduino/      │
                                                 │      Farmduino     │
                                                 │   └─ Kamera        │
                                                 └────────────────────┘
```

**Temel kural:** Tarayıcı robota *asla doğrudan* bağlanmaz. Her komut backend'den geçer
(yetkilendirme + kayıt + güvenlik kilidi). Backend, MQTT broker'a komutu yayınlar; robot
dinler ve uygular. Robotun durumu ters yönde MQTT → backend → WebSocket → tarayıcı akar.

---

## 2. Teknoloji Seçimleri ve Gerekçeleri

### Frontend
| Teknoloji | Sürüm | Neden? |
|---|---|---|
| **React + TypeScript** | 19 / 5.x | Ekosistem, tip güvenliği |
| **Vite** | 7.x | Anında HMR, hafif build; SSR gerekmeyen bir kontrol paneli için Next.js'ten uygun |
| **Tailwind CSS** | v4 | CSS-first tema, `@theme` ile gradient/renk token'ları |
| **React Router** | 7.x | Bölüm bazlı yönlendirme |
| **TanStack Query** | 5.x | Sunucu durumu, cache, otomatik yeniden çekme |
| **Zustand** | 5.x | Robotun canlı durumu için hafif global store |
| **dnd-kit** | 6.x | Erişilebilir, dokunmatik uyumlu sürükle-bırak (Farm Designer) |
| **Recharts** | 3.x | Sensör telemetri grafikleri |
| **Three.js + R3F** | — | 3D FarmBot görünümü |
| **Lucide React** | — | İkon seti |

> **Mobil (ileride):** Uygulama önce web olarak canlıya alınır. APK aşamasında Expo ile
> ayrı bir istemci yazılacak; bu yüzden **tüm iş mantığı backend'de**, frontend sadece
> sunum katmanı. `frontend/src/lib/api.ts` içindeki istemci sözleşmesi Expo tarafında
> birebir tekrar kullanılabilir.

### Backend
| Teknoloji | Neden? |
|---|---|
| **FastAPI** | Async, otomatik OpenAPI dokümanı, Pydantic doğrulama |
| **SQLAlchemy 2.0 (async)** | Olgun ORM, tip destekli `Mapped[]` sözdizimi |
| **Alembic** | Şema göçleri — "sonradan güncellenebilir" gereksinimi için şart |
| **asyncpg** | Yüksek performanslı Postgres sürücüsü |
| **aiomqtt (paho tabanlı)** | Async MQTT istemcisi |
| **python-jose + passlib/bcrypt** | JWT kimlik doğrulama |
| **Pydantic Settings** | 12-Factor uyumlu `.env` yapılandırması |

### Altyapı
| Bileşen | Seçim |
|---|---|
| Veritabanı | PostgreSQL 16 |
| Mesaj broker | Eclipse Mosquitto 2 (MQTT 3.1.1/5, TLS + WebSocket) |
| Konteyner | Docker + docker-compose |
| Dağıtım | Backend/DB/broker → Render veya Fly.io · Frontend → Vercel |

---

## 3. Uygulama Bölümleri (Modüller)

Gereksinimdeki "bölümler ayrı ayrı olmalı" maddesi için yapılan kategorizasyon.
Sol menüdeki gruplandırma birebir budur:

### 🌱 İZLEME
| Bölüm | Rota | İçerik |
|---|---|---|
| **Kontrol Merkezi** | `/` | Durum özeti, canlı X/Y/Z konumu, bağlantı sağlığı, hızlı aksiyonlar, sonraki görevler |
| **3D Görünüm** | `/viewer` | FarmBot'un gerçek zamanlı 3D dijital ikizi; gantry/çapraz kızak/Z ekseni canlı konuma göre hareket eder |
| **Kamera** | `/camera` | Canlı MJPEG/WebRTC akış penceresi, anlık fotoğraf çekme, konum etiketli galeri |
| **Sensörler** | `/sensors` | Toprak nemi, sıcaklık, ışık, su akışı — canlı değer + geçmiş grafiği |

### 🎮 KONTROL
| Bölüm | Rota | İçerik |
|---|---|---|
| **Manuel Kontrol** | `/control` | Mobil uyumlu jog pad, eksen adımlama, hız kaydırıcısı, ev/kalibrasyon, çevre birimi anahtarları, **ACİL DURDURMA** |
| **Diziler** | `/sequences` | Görsel komut dizisi (sequence) editörü — hareket et, sula, ek, fotoğraf çek |

### 🗺️ TARLA
| Bölüm | Rota | İçerik |
|---|---|---|
| **Tarla Tasarımcısı** | `/designer` | Sürükle-bırak bitki yerleştirme, pan/zoom grid, alet yuvaları, yataklar |
| **Bitki Kütüphanesi** | `/plants` | Tür kataloğu: aralık, ekim derinliği, su ihtiyacı, olgunlaşma süresi |

### ⏰ PLANLAMA
| Bölüm | Rota | İçerik |
|---|---|---|
| **Sulama & Takvim** | `/schedule` | Sulama zamanlayıcısı, tekrarlı görevler, aylık/haftalık takvim görünümü |

### ⚙️ SİSTEM
| Bölüm | Rota | İçerik |
|---|---|---|
| **Kayıtlar** | `/logs` | Canlı log akışı, seviye filtresi |
| **Ayarlar** | `/settings` | Cihaz, donanım/firmware parametreleri, çalışma alanı boyutları, hesap, tema |

---

## 4. Klasör Yapısı

```
farmbot-web/
├── docs/
│   ├── ARCHITECTURE.md         # bu dosya
│   ├── DATABASE.md             # veritabanı şeması
│   └── MQTT.md                 # robot haberleşme protokolü
│
├── backend/
│   ├── app/
│   │   ├── main.py             # FastAPI uygulaması, lifespan, CORS
│   │   ├── core/
│   │   │   ├── config.py       # .env tabanlı ayarlar
│   │   │   ├── security.py     # JWT, parola hash
│   │   │   └── errors.py       # merkezî hata yönetimi
│   │   ├── db/
│   │   │   ├── base.py         # DeclarativeBase + ortak sütunlar
│   │   │   ├── session.py      # async engine + oturum bağımlılığı
│   │   │   └── seed.py         # demo veri (bitki kataloğu vb.)
│   │   ├── models/             # SQLAlchemy tabloları
│   │   ├── schemas/            # Pydantic istek/yanıt modelleri
│   │   ├── api/
│   │   │   ├── deps.py         # ortak bağımlılıklar (aktif kullanıcı, cihaz)
│   │   │   └── v1/             # sürümlü uç noktalar
│   │   └── services/
│   │       ├── mqtt.py         # broker istemcisi + abonelikler
│   │       ├── commands.py     # CeleryScript RPC üreticileri
│   │       └── realtime.py     # WebSocket yayın merkezi
│   ├── alembic/                # şema göçleri
│   ├── tests/
│   ├── requirements.txt
│   └── Dockerfile
│
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx             # rota tanımları
│   │   ├── index.css           # tasarım sistemi (Tailwind v4 @theme)
│   │   ├── lib/
│   │   │   ├── api.ts          # tip güvenli REST istemcisi
│   │   │   ├── ws.ts           # WebSocket bağlantısı (otomatik yeniden bağlanma)
│   │   │   └── format.ts
│   │   ├── store/              # Zustand store'ları (bot durumu, tema)
│   │   ├── hooks/              # useBotStatus, useTelemetry ...
│   │   ├── components/
│   │   │   ├── ui/             # Card, Button, Badge, Slider, Toggle ...
│   │   │   ├── layout/         # Sidebar, Topbar, AppShell
│   │   │   ├── control/        # JogPad, EStopButton, PeripheralSwitch
│   │   │   └── designer/       # GardenCanvas, PlantChip, DraggablePlant
│   │   └── pages/              # her bölüm için bir sayfa
│   ├── vite.config.ts
│   ├── package.json
│   └── Dockerfile
│
├── infra/
│   └── mosquitto/config/mosquitto.conf
│
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## 5. Katmanlar Arası Veri Akışı

### Komut gönderme (tarayıcı → robot)
```
1. Kullanıcı jog pad'de "+X 100mm" butonuna basar
2. POST /api/v1/control/move  { axis: "x", distance: 100, speed: 100 }
3. Backend: JWT doğrula → cihaz sahipliğini doğrula → acil-kilit durumunu kontrol et
4. commands.move_relative() → CeleryScript RPC JSON üretir
5. MQTT publish → bot/device_<id>/from_clients
6. Robot uygular, bot/device_<id>/from_device kanalına rpc_ok/rpc_error döner
7. Backend yanıtı yakalar → WebSocket ile tarayıcıya iletir
```

### Durum alma (robot → tarayıcı)
```
1. Robot bot/device_<id>/status kanalına durum ağacını yayınlar (retained)
2. Backend abonesi mesajı alır → normalize eder → bellekteki son duruma yazar
3. realtime.broadcast() → o cihaza bağlı tüm WebSocket istemcilerine iletir
4. Zustand store güncellenir → Dashboard, 3D görünüm, jog pad anında yenilenir
```

### Kalıcılık
- **Sık değişen ama kalıcı olmayan** veri (anlık konum, motor durumu) → sadece bellek + WS
- **Kalıcı** veri (bitkiler, diziler, takvim, sensör okumaları, loglar) → PostgreSQL

---

## 6. Güvenlik

| Katman | Önlem |
|---|---|
| Kimlik | JWT erişim (30 dk) + yenileme (7 gün) token'ı; bcrypt parola hash |
| Yetki | Her istekte `device.user_id == current_user.id` kontrolü |
| Cihaz kimliği | Robot, broker'a cihaza özel MQTT kullanıcı/parolası ile bağlanır |
| Taşıma | HTTPS + WSS; MQTT için TLS (8883) |
| Güvenlik kilidi | Acil durdurma aktifken hareket komutları backend'de reddedilir (`423 Locked`) |
| Hız sınırı | Kontrol uç noktalarında IP/cihaz başına istek limiti |
| CORS | Sadece `.env` içinde tanımlı origin'lere izin |

---

## 7. Genişletilebilirlik Kararları

Uygulamanın "sonradan güncellenebilir" olması için baştan alınan kararlar:

1. **Sürümlü API** (`/api/v1/...`) — kırıcı değişiklikler `/v2` altında yaşar.
2. **Alembic göçleri** — şema değişikliği veri kaybı olmadan uygulanır.
3. **`meta JSONB` sütunları** — şema göçü gerektirmeden yeni alan eklenebilir.
4. **Çoklu cihaz desteği** — veri modeli tek robota kilitli değil; bir hesap N robot yönetebilir.
5. **Donanım soyutlaması** — robot komutları CeleryScript formatında; resmî FarmBot OS
   çalıştıran bir kart da, kendi yazacağımız Pi istemcisi de aynı sözleşmeyi konuşur.
6. **Frontend sunum katmanı** — iş mantığı backend'de olduğu için Expo istemcisi
   aynı API'yi tüketerek yazılabilir.
