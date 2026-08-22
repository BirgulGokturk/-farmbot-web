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
for servis in farmbot-api farmbot-agent; do
  if systemctl list-unit-files | grep -q "^${servis}.service"; then
    sudo systemctl restart "$servis"
    echo "        $servis yeniden başlatıldı"
  fi
done

echo "── 5/5  Kontrol"
sleep 6
if curl -fsS -m 10 localhost:8000/health > /dev/null 2>&1; then
  echo "        API ayakta"
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
