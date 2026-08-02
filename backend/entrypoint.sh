#!/bin/sh
# Konteyner giriş noktası.
#
# Render'ın ücretsiz katmanında "pre-deploy command" bulunmadığı için şema
# göçlerini konteyner açılışında uyguluyoruz. Tek örnek çalıştığı sürece
# güvenlidir; birden fazla kopyaya ölçeklenirse bunu kapatıp göçü ayrı bir
# adımda çalıştırın (RUN_MIGRATIONS_ON_START=false).
set -e

if [ "${RUN_MIGRATIONS_ON_START:-false}" = "true" ]; then
  echo "==> Veritabanı göçleri uygulanıyor (alembic upgrade head)"
  alembic upgrade head
fi

echo "==> API başlatılıyor (port ${PORT:-8000})"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
