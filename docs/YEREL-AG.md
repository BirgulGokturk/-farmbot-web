# Yerel ağ kipi — buluta gerek kalmadan çalıştırma

Raspberry Pi ile tarayıcı aynı WiFi'daysa buluttan geçmek gereksiz. Bu kipte
API, arayüz ve robot köprüsü Pi'nin üzerinde çalışır; tarayıcı doğrudan Pi'ye
bağlanır.

## Neden

Bulut kurulumunda her hareket komutu şu yolu izliyor:

    tarayıcı → Render (Frankfurt) → Pi → Gantry Studio → PLC

Yerel kipte:

    tarayıcı → Pi → Gantry Studio → PLC

Kazanımlar:

- **Cihaz token'ı derdi biter.** Ajan `localhost`'a bağlanır; internet
  üzerinden kimlik doğrulaması yoktur.
- **Gecikme düşer.** Frankfurt'a gidiş-dönüş yerine yerel ağ.
- **Uyanma beklemesi yoktur.** Render'ın ücretsiz katmanı uykuya dalıp ilk
  isteği 15 saniye bekletebiliyor.
- **İnternet kesilince robot yönetilmeye devam eder.**

## Bedeli

Dürüst olmak gerekirse üç şeyi kaybediyorsunuz:

- **Uzaktan erişim yok.** Yalnızca aynı ağdan bağlanılır.
- **Uygulama olarak kurulamaz.** Tarayıcılar servis çalışanını yalnızca
  güvenli bağlamlarda (HTTPS ya da `localhost`) çalıştırıyor;
  `http://192.168.1.x` bunun dışında kalıyor. Sayfa normal çalışır, yalnızca
  "ana ekrana ekle" ve çevrimdışı önbellek devre dışı kalır.
- **Trafik şifresiz.** Parola ve oturum anahtarı yerel ağda düz metin gider.
  WPA2/WPA3 korumalı bir ev ağında kabul edilebilir; misafirlere açık bir ağda
  değil.

Bulut kurulumu bu kiple birlikte çalışmaya devam eder — biri diğerini
kapatmıyor. `FRONTEND_DIST` boş bırakıldığında hiçbir davranış değişmez.

## Kurulum (Pi üzerinde)

### 1. Bağımlılıklar ve arayüzün derlenmesi

```bash
cd ~/farmbot-web
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
npm --prefix frontend ci && npm --prefix frontend run build
```

Arayüz `VITE_API_URL` verilmeden derlenmeli. Boş olduğunda API'yi kendi
adresinde arıyor; ayrı bir ayar gerekmiyor.

### 2. Ayarlar

`~/farmbot-web/backend/.env`:

```
ENVIRONMENT=production
DEBUG=false
SECRET_KEY=<uzun-rastgele-bir-dize>
DATABASE_URL=sqlite+aiosqlite:///./farmbot.db
FRONTEND_DIST=/home/pi/farmbot-web/frontend/dist
SIMULATOR_ENABLED=false
```

`SECRET_KEY` için: `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`

### 3. Şema

```bash
cd ~/farmbot-web/backend && .venv/bin/alembic upgrade head
```

### 4. Servis

`/etc/systemd/system/farmbot-api.service`:

```ini
[Unit]
Description=FarmBot API (yerel)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/farmbot-web/backend
ExecStart=/home/pi/farmbot-web/backend/.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --timeout-graceful-shutdown 10
Restart=always
RestartSec=5
TimeoutStopSec=20
StandardOutput=journal
StandardError=journal
SyslogIdentifier=farmbot-api

[Install]
WantedBy=multi-user.target
```

`--host 0.0.0.0` şart: `127.0.0.1` yalnızca Pi'nin kendisinden erişilir.

**`--timeout-graceful-shutdown` ve `TimeoutStopSec` neden var**

API, ajan ve panelle **WebSocket** üzerinden konuşuyor ve bu bağlantılar açık
kalıyor. Uvicorn kapanırken varsayılan olarak bütün bağlantıların kapanmasını
bekliyor; WebSocket kendiliğinden kapanmadığı için süreç SIGTERM'e yanıt
vermiyor. systemd de varsayılan 90 saniyelik süreyi doldurup SIGKILL çekiyor:

```
farmbot-api.service: Killing process 5065 (python) with signal SIGKILL.
farmbot-api.service: Failed with result 'timeout'.
```

Sonuç: her güncellemede yaklaşık **bir buçuk dakika** 8000 portu kapalı
kalıyor. Bu sürede ajan "Connect call failed" yazıyor ve panel açılmıyor —
tablo tıpatıp "yeni kod çöktü"ye benziyor, oysa yalnızca eski süreç geç
ölüyor. İki ayar bu bekleyişi 10 saniyeye indiriyor.

### 5. Ajanı yerele çevirin

`/etc/farmbot/agent.env` içindeki adresi değiştirin:

```
FARMBOT_API_URL=http://localhost:8000
```

Token yine gerekiyor ama artık yerel: panelden (Pi'nin adresinden) üretilip
aynı dosyaya yazılır ve internet üzerinden hiç geçmez.

## Kullanım

Tarayıcıdan `http://<pi-adresi>:8000` açın. Adresi öğrenmek için:

```bash
hostname -I
```

Pi'nin adresinin değişmemesi için modemden sabit IP tanımlayın; yoksa her
yeniden başlatmada adres değişebilir ve yer imi çalışmaz.
