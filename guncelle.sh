#!/usr/bin/env bash
#
# Pi'yi güncelle: kodu çek, arayüzü derle, şemayı ilerlet, servisleri yenile.
#
# Neden ayrı bir betik: bu dört adım sırayla yapılmak zorunda ve biri
# atlandığında belirti yanıltıcı oluyor. Arayüz derlenmeden `git pull` yapmak
# eski paneli göstermeye devam ediyor, göç atlanınca API açılışta ölüyor ve
# panel "sunucuya ulaşılamıyor" diyor. Elle yazılan dört komutta biri
# unutuluyor; tek komutta unutulmuyor.
#
# Kullanım:  ~/farmbot-web/guncelle.sh

set -euo pipefail

KOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$KOK"

echo "── 1/5  Kod çekiliyor"
ONCEKI=$(git rev-parse --short HEAD)
git pull --ff-only
SONRAKI=$(git rev-parse --short HEAD)

if [ "$ONCEKI" = "$SONRAKI" ]; then
  echo "        Zaten güncel ($SONRAKI) — yine de derleyip yeniliyorum."
else
  echo "        $ONCEKI → $SONRAKI"
fi

echo "── 2/5  Arayüz derleniyor"
# `ci` yerine `install`: package-lock değişmediyse çok daha hızlı bitiyor.
npm --prefix frontend install --silent --no-audit --no-fund
npm --prefix frontend run build

echo "── 3/5  Veritabanı şeması"
if [ -d backend/.venv ]; then
  (cd backend && .venv/bin/alembic upgrade head)
else
  echo "        backend/.venv yok — yerel API kurulu değil, atlanıyor."
fi

echo "── 4/5  Servisler yenileniyor"
#
# Bulunamayan servis **sessizce atlanmıyor**.
#
# Sahada tam bunu yaşadık: API servisi beklenen adda değildi, betik adımı
# atladı ve hiçbir uyarı vermedi. Statik dosyalar diskten okunduğu için arayüz
# güncellendi, Python kodu eski süreçte kaldı — panel yeni önizlemeyi
# gösterirken sunucu düzeltilmiş bir hatayı vermeye devam etti. Yarısı yeni
# yarısı eski bir sistemi teşhis etmek, hiç güncellenmemiş olandan çok daha zor.
YENILENEN=0
for servis in farmbot-api farmbot-agent; do
  if systemctl list-unit-files | grep -q "^${servis}.service"; then
    sudo systemctl restart "$servis"
    echo "        $servis yeniden başlatıldı"
    YENILENEN=$((YENILENEN + 1))
  else
    echo "        UYARI: $servis.service bulunamadı — YENİDEN BAŞLATILMADI."
    echo "               Kod diskte güncel ama çalışan süreç eski."
    BENZER=$(systemctl list-unit-files --type=service --no-legend \
             | awk '{print $1}' | grep -i farm | tr '\n' ' ')
    if [ -n "$BENZER" ]; then
      echo "               Bu makinedeki farmbot servisleri: $BENZER"
    else
      echo "               Bu makinede farmbot servisi yok gibi görünüyor."
    fi
  fi
done

if [ "$YENILENEN" -eq 0 ]; then
  echo
  echo "        Hiçbir servis yenilenmedi. Yukarıdaki adlardan doğru olanı"
  echo "        elle başlatın:  sudo systemctl restart <servis-adı>"
fi

echo "── 5/5  Kontrol"
sleep 6
SAGLIK=$(curl -fsS -m 10 localhost:8000/health 2>/dev/null || true)
if [ -n "$SAGLIK" ]; then
  # "Ayakta" yetmiyor: eski süreç de gayet sağlıklı yanıt veriyor. Asıl soru
  # **hangi kodun** çalıştığı. API kendi commit'ini bildiriyor; diskteki
  # sürümle karşılaştırıyoruz.
  CALISAN=$(printf '%s' "$SAGLIK" | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p')
  if [ -z "$CALISAN" ] || [ "$CALISAN" = "null" ]; then
    echo "        API ayakta (sürüm bildirmiyor — muhtemelen eski sürüm)"
  elif [ "$CALISAN" = "$(git rev-parse --short=7 HEAD)" ]; then
    echo "        API ayakta ve güncel ($CALISAN)"
  else
    echo "        UYARI: API ayakta ama ESKİ KOD çalışıyor"
    echo "               diskte $(git rev-parse --short=7 HEAD), süreçte $CALISAN"
    echo "               Servis yeniden başlatılmamış olabilir."
  fi
else
  echo "        UYARI: API yanıt vermiyor — journalctl -u farmbot-api -n 30"
fi

if systemctl is-active --quiet farmbot-agent; then
  # Ajanın buluta/yerele bağlandığını görmek, servisin ayakta olmasından
  # daha anlamlı: servis çalışıp token reddedilmiş olabilir.
  if journalctl -u farmbot-agent -n 30 --no-pager | grep -q "Komut kanalı açıldı"; then
    echo "        Ajan bağlı"
  else
    echo "        UYARI: ajan henüz bağlanmadı — journalctl -u farmbot-agent -n 20"
  fi
fi

echo
echo "Güncelleme tamam: $SONRAKI"
