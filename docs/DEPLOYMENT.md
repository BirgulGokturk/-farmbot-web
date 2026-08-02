# Canlıya Alma (Deployment)

Hedef: internetten erişilebilen, telefondan da açılabilen canlı bir HMI.
Robot henüz hazır olmadığı için **MQTT kapalı** başlar; donanım geldiğinde tek
bir ayarla açılır.

---

## En hızlı yol: Render Blueprint (önerilen)

Depodaki [`render.yaml`](../render.yaml) tüm yığını tek dosyadan kurar:
**PostgreSQL + API + statik HMI**. Adresler, veritabanı bağlantısı ve gizli
anahtar otomatik bağlanır — elle girilecek hiçbir değer yok.

### 1. Depoyu GitHub'a yükleyin

```bash
git remote add origin https://github.com/<kullanici>/farmbot-web.git
git push -u origin main
```

> Depo **özel (private)** olabilir; Render özel depolara da erişebilir.

### 2. Render'da Blueprint'i çalıştırın

1. [render.com](https://render.com) → ücretsiz hesap açın (GitHub ile giriş en kolayı)
2. **New → Blueprint**
3. `farmbot-web` deposunu seçin
4. Render `render.yaml`'ı okur ve üç servisi listeler → **Apply**

İlk kurulum 5–10 dakika sürer (Docker imajı derlenir).

### 3. Sonuç

| Servis | Adres |
|---|---|
| **HMI (panel)** | `https://farmbot-hmi.onrender.com` |
| API | `https://farmbot-api.onrender.com` |
| API dokümanı | `https://farmbot-api.onrender.com/docs` |

Panele girip **kayıt olun** — ilk girişte robotunuzu tanımlayan kurulum ekranı
karşılar. Robot henüz kurulu olmasa da tarla tasarımını, sulama takvimini ve
bitki kütüphanesini şimdiden hazırlayabilirsiniz.

### Ücretsiz katman hakkında

- Web servisi 15 dakika işlem görmezse uykuya geçer; sonraki istek ~30 saniye
  gecikmeyle uyandırır. Panel açık kaldığı sürece uyumaz.
- Ücretsiz PostgreSQL 90 gün sonra sona erer. Kalıcı kullanım için veritabanını
  ücretli katmana (aylık birkaç dolar) yükseltin ya da Neon/Supabase gibi
  kalıcı ücretsiz bir Postgres'e `DATABASE_URL` ile bağlanın.

---

## Robot hazır olduğunda: MQTT'yi açma

Mekanik ve elektrik tamamlanınca:

1. Bir MQTT broker edinin — **HiveMQ Cloud** ücretsiz katmanı yeterlidir.
   Panelden iki kullanıcı oluşturun:
   - `farmbot_backend` → `bot/#` üzerinde okuma + yazma
   - `device_<cihaz-uuid>` → yalnızca `bot/device_<uuid>/#`
2. Render → `farmbot-api` → **Environment** sekmesinde şunları girin:

```
MQTT_ENABLED = true
MQTT_HOST    = <broker-adresi>.hivemq.cloud
MQTT_PORT    = 8883
MQTT_TLS     = true
MQTT_USERNAME = farmbot_backend
MQTT_PASSWORD = <parola>
```

3. Servis yeniden başlar. Panelde bağlantı göstergesi robot bağlanır bağlanmaz
   yeşile döner.

Cihaz UUID'sini Ayarlar bölümünden ya da `/api/v1/devices` yanıtından alırsınız.

---

## Robot (Raspberry Pi) tarafının yapması gerekenler

1. Broker'a **kendi cihaz kimliğiyle** TLS üzerinden bağlanmak.
2. Bağlanırken vasiyet (LWT) bırakmak:
   - konu: `bot/device_<id>/status`
   - içerik: `{"informational_settings":{"sync_status":"offline"}}`
3. `bot/device_<id>/from_clients` konusunu dinleyip gelen CeleryScript
   komutlarını uygulamak.
4. Durum değiştikçe `bot/device_<id>/status` konusuna **retained** mesaj yayınlamak.
5. Olayları `bot/device_<id>/logs`, komut yanıtlarını
   `bot/device_<id>/from_device` konusuna göndermek.

Komut listesi ve tam mesaj biçimleri: [MQTT Protokolü](MQTT.md)

---

## Alternatif: ön yüzü Vercel'de barındırmak

Render'ın statik sitesi yerine Vercel kullanmak isterseniz:

- **Root Directory:** `frontend`
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Ortam değişkeni:** `VITE_API_URL = https://farmbot-api.onrender.com`

Ardından Render'daki `farmbot-api` servisinin `CORS_ORIGINS` değerine Vercel
adresini ekleyin.

> `VITE_API_URL` şemasız verilirse istemci başına otomatik `https://` ekler ve
> `/api/v1` son ekini tamamlar; WebSocket adresi de bundan türetilir
> (`frontend/src/lib/api.ts`).

---

## Yerelde Docker ile

```bash
cp .env.example .env
docker compose up --build
```

| Servis | Adres |
|---|---|
| Ön yüz | http://localhost:5173 |
| API dokümanı | http://localhost:8000/docs |
| MQTT | localhost:1883 |

---

## Veritabanı şeması

Üretimde tablolar **otomatik oluşturulmaz**; şema Alembic göçleriyle yönetilir.
Konteyner açılışında `RUN_MIGRATIONS_ON_START=true` olduğu için göçler
kendiliğinden uygulanır.

```bash
# yeni göç üret (model değiştirdikten sonra)
alembic revision --autogenerate -m "aciklama"

# elle uygula
alembic upgrade head

# geri al
alembic downgrade -1
```

> Birden fazla kopyaya ölçeklendirirseniz `RUN_MIGRATIONS_ON_START=false` yapıp
> göçü ayrı bir adımda çalıştırın — aynı anda iki kopyanın göç uygulaması
> çakışmaya yol açabilir.

---

## Yayın öncesi kontrol listesi

- [x] `SECRET_KEY` Render tarafından otomatik üretiliyor (`generateValue: true`)
- [x] `DEBUG=false`, `ENVIRONMENT=production`
- [x] Üretimde demo hesap oluşturulmuyor (yalnızca bitki kataloğu yükleniyor)
- [x] `CORS_ORIGINS` yalnızca HMI adresini içeriyor (Blueprint otomatik bağlıyor)
- [x] Şema göçleri açılışta uygulanıyor
- [x] Sağlık kontrolü `/health`
- [ ] MQTT TLS (8883) — robot bağlanınca açılacak
- [ ] Veritabanı yedeklemesi (ücretli katmanda otomatik)
