FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# asyncpg ve bcrypt için derleme araçları; kurulumdan sonra imajdan çıkarılır
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl \
    && rm -rf /var/lib/apt/lists/*

# Bağımlılıklar önce kopyalanır ki kod değişince katman önbelleği bozulmasın
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt \
    && apt-get purge -y build-essential && apt-get autoremove -y

COPY . .

RUN mkdir -p /app/media

# Windows'ta düzenlenmiş olma ihtimaline karşı CRLF'i temizle, sonra çalıştırılabilir yap
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Kök olmayan kullanıcı — konteyner güvenliği
RUN useradd --create-home --uid 1000 farmbot && chown -R farmbot:farmbot /app
USER farmbot

EXPOSE 8000

# Bulut sağlayıcıları dinlenecek portu PORT ortam değişkeniyle bildirir
ENV PORT=8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://localhost:${PORT}/health" || exit 1

CMD ["/app/entrypoint.sh"]
