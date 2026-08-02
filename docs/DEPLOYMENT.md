# Dağıtım (Deployment)

Uygulama üç parçadan oluşur ve hepsi bulutta çalışabilir:

| Parça | Ne yapar | Önerilen ev sahibi |
|---|---|---|
| **Backend** | REST + WebSocket API | Render / Fly.io / Railway |
| **PostgreSQL** | Kalıcı veri | Render Postgres / Neon / Supabase |
| **MQTT broker** | Robot haberleşmesi | HiveMQ Cloud / EMQX Cloud / kendi Mosquitto'nuz |
| **Frontend** | Statik site | Vercel / Netlify / Cloudflare Pages |

---

## 1. Yerelde Docker ile

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

## 2. Backend → Render

1. Depoyu GitHub'a yükleyin.
2. Render'da **New → Web Service** deyin, depoyu seçin.
3. Ayarlar:
   - **Root Directory:** `backend`
   - **Runtime:** Docker
   - **Health Check Path:** `/health`
4. Aynı hesapta **New → PostgreSQL** ile bir veritabanı oluşturun.
5. Ortam değişkenlerini girin:

```
ENVIRONMENT=production
DEBUG=false
DATABASE_URL=<Render'ın verdiği Internal Database URL>
SECRET_KEY=<uzun rastgele dizi>
CORS_ORIGINS=https://<ön-yüz-adresiniz>
MQTT_HOST=<broker adresi>
MQTT_PORT=8883
MQTT_TLS=true
MQTT_USERNAME=<kullanıcı>
MQTT_PASSWORD=<parola>
```

> **Önemli:** Render'ın verdiği `DATABASE_URL` `postgres://` ile başlar.
> SQLAlchemy async sürücüsü için başını `postgresql+asyncpg://` yapın.

6. İlk dağıtımdan sonra şemayı kurun:

```bash
alembic upgrade head
```

> Üretimde `ENVIRONMENT=production` olduğu için tablolar otomatik oluşturulmaz;
> şema yönetimi bilinçli olarak Alembic'e bırakılmıştır.

---

## 3. Frontend → Vercel

1. Vercel'de projeyi içe aktarın.
2. Ayarlar:
   - **Root Directory:** `frontend`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
3. Ortam değişkenleri (derleme zamanında gömülür):

```
VITE_API_URL=https://<backend-adresiniz>/api/v1
VITE_WS_URL=wss://<backend-adresiniz>/api/v1/ws
```

4. Backend'in `CORS_ORIGINS` değerine Vercel adresini eklemeyi unutmayın.

---

## 4. MQTT Broker

### Seçenek A — Yönetilen (en kolay)
HiveMQ Cloud ücretsiz katmanı 100 bağlantıya kadar yeter. Panelden iki kullanıcı açın:
- `farmbot_backend` → `bot/#` üzerinde okuma+yazma
- `device_<cihaz-uuid>` → yalnızca `bot/device_<uuid>/#`

### Seçenek B — Kendi Mosquitto'nuz
`infra/mosquitto/config/mosquitto.conf` dosyasındaki **ÜRETİM** bölümünü açın,
sertifikaları yerleştirin ve kullanıcıları oluşturun:

```bash
docker compose exec mosquitto mosquitto_passwd -c /mosquitto/config/passwd farmbot_backend
docker compose exec mosquitto mosquitto_passwd    /mosquitto/config/passwd device_<uuid>
```

---

## 5. Robot (Raspberry Pi) Tarafı

Robotun yapması gerekenler:

1. Broker'a **kendi cihaz kimliğiyle** TLS üzerinden bağlanmak.
2. Bağlanırken vasiyet (LWT) bırakmak:
   - konu: `bot/device_<id>/status`
   - içerik: `{"informational_settings":{"sync_status":"offline"}}`
3. `bot/device_<id>/from_clients` konusunu dinleyip gelen CeleryScript
   komutlarını uygulamak.
4. Durum değiştikçe `bot/device_<id>/status` konusuna **retained** mesaj yayınlamak.
5. Olayları `bot/device_<id>/logs`, yanıtları `bot/device_<id>/from_device`
   konusuna göndermek.

Komut listesi ve tam mesaj biçimleri: [MQTT Protokolü](MQTT.md)

---

## 6. Yayın Öncesi Kontrol Listesi

- [ ] `SECRET_KEY` üretim için yeniden oluşturuldu
      (`python -c "import secrets; print(secrets.token_urlsafe(48))"`)
- [ ] `DEBUG=false` ve `ENVIRONMENT=production`
- [ ] `SEED_DEMO_DATA=false` (demo hesap üretime sızmasın)
- [ ] `CORS_ORIGINS` yalnızca gerçek ön yüz adresini içeriyor
- [ ] MQTT TLS (8883) açık, anonim erişim kapalı
- [ ] Veritabanı yedeklemesi etkin
- [ ] `alembic upgrade head` çalıştırıldı
- [ ] Sağlık kontrolü `/health` yanıt veriyor
