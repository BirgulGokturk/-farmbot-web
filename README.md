# 🌱 FarmBot Web

Açık kaynak **FarmBot** akıllı tarım robotu için modern, internet üzerinden erişilebilir
web yönetim uygulaması.

| Katman | Teknoloji |
|---|---|
| Ön yüz | React 19 · TypeScript · Vite · Tailwind CSS v4 |
| Arka uç | Python 3.12 · FastAPI · SQLAlchemy 2 (async) |
| Veritabanı | PostgreSQL 16 |
| Robot haberleşmesi | MQTT (Mosquitto) + CeleryScript |
| Dağıtım | Docker Compose · Render / Vercel |

---

## Bölümler

| Grup | Bölüm | Açıklama |
|---|---|---|
| İzleme | **Kontrol Merkezi** | Durum özeti, canlı konum, hızlı aksiyonlar |
| İzleme | **3D Görünüm** | Robotun gerçek zamanlı dijital ikizi |
| İzleme | **Kamera** | Canlı akış + konum etiketli fotoğraf galerisi |
| İzleme | **Sensörler** | Toprak nemi, sıcaklık, ışık — canlı + geçmiş |
| Kontrol | **Manuel Kontrol** | Mobil uyumlu jog pad, acil durdurma |
| Kontrol | **Diziler** | Görsel komut dizisi editörü |
| Tarla | **Tarla Tasarımcısı** | Sürükle-bırak bitki yerleştirme |
| Tarla | **Bitki Kütüphanesi** | Tür kataloğu ve yetiştirme bilgileri |
| Planlama | **Sulama & Takvim** | Zamanlayıcı ve takvim modülü |
| Sistem | **Kayıtlar** | Canlı log akışı |
| Sistem | **Ayarlar** | Cihaz, donanım, hesap, tema |

---

## Hızlı Başlangıç

### Docker ile (önerilen)

```bash
cp .env.example .env
docker compose up --build
```

| Servis | Adres |
|---|---|
| Ön yüz | http://localhost:5173 |
| API | http://localhost:8000 |
| API dokümanı | http://localhost:8000/docs |
| MQTT | localhost:1883 |
| PostgreSQL | localhost:5432 |

### Docker olmadan

**Arka uç:**
```bash
cd backend && python -m venv .venv && .venv\Scripts\activate && pip install -r requirements.txt && uvicorn app.main:app --reload
```

**Ön yüz:**
```bash
cd frontend && npm install && npm run dev
```

---

## Dokümantasyon

- [Mimari](docs/ARCHITECTURE.md) — sistem tasarımı, klasör yapısı, teknoloji gerekçeleri
- [Veritabanı](docs/DATABASE.md) — şema, tablolar, ilişkiler
- [MQTT Protokolü](docs/MQTT.md) — robot haberleşmesi, komut listesi
- [Dağıtım](docs/DEPLOYMENT.md) — bulut yayını ve yayın öncesi kontrol listesi

---

## Yol Haritası

- [x] Mimari, veritabanı şeması, MQTT protokolü
- [x] Arka uç: 17 tablo, REST API, MQTT köprüsü, WebSocket
- [x] Ön yüz: tasarım sistemi, uygulama kabuğu, karanlık/aydınlık mod
- [x] Kontrol Merkezi + mobil uyumlu Manuel Kontrol
- [x] Tarla Tasarımcısı (sürükle-bırak, pan/zoom)
- [x] Takvim, kamera, sensör grafikleri, kayıtlar, ayarlar, 3D görünüm
- [x] Docker Compose + dağıtım yapılandırması
- [ ] Zamanlayıcı çalıştırıcısı (takvim görevlerini otomatik tetikleme)
- [ ] Raspberry Pi tarafındaki MQTT istemcisi
- [ ] Expo ile mobil istemci (Android / HarmonyOS APK)

---

## Demo Hesap

Geliştirme ortamı açıldığında hazır bir hesap oluşturulur:

```
demo@farmbot.dev · farmbot123
```

Üretimde `SEED_DEMO_DATA=false` yapın.

---

## Kaynaklar

- [FarmBot Developer Documentation](https://developer.farm.bot)
- [Farmbot-Web-App (resmî açık kaynak)](https://github.com/FarmBot/Farmbot-Web-App)
- [FarmBot Yazılım Sayfası](https://farm.bot/pages/software)
