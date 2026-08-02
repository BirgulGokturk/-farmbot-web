"""FastAPI uygulaması — giriş noktası."""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import api_router
from app.core.config import settings
from app.services.mqtt import bridge

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s  %(levelname)-8s %(name)s  %(message)s",
)
logger = logging.getLogger("farmbot")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Uygulama açılış/kapanış işleri."""
    logger.info("%s başlatılıyor (%s)", settings.APP_NAME, settings.ENVIRONMENT)

    # Geliştirmede şemayı otomatik kur; üretimde bu iş Alembic'in.
    if settings.ENVIRONMENT == "development":
        from app.db.session import init_db

        await init_db()
        logger.info("Veritabanı tabloları hazır")

    if settings.SEED_DEMO_DATA:
        from app.db.seed import run_seed
        from app.db.session import SessionLocal

        try:
            async with SessionLocal() as session:
                await run_seed(session, include_demo=settings.ENVIRONMENT == "development")
        except Exception:
            logger.exception("Başlangıç verisi yüklenemedi")

    await bridge.start()

    yield

    await bridge.stop()
    logger.info("Kapatıldı")


app = FastAPI(
    title=settings.APP_NAME,
    version="0.1.0",
    description=(
        "Açık kaynak FarmBot akıllı tarım robotu için web yönetim API'si.\n\n"
        "Robot haberleşmesi MQTT + CeleryScript üzerinden yapılır."
    ),
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_PREFIX)

# Kamera fotoğraflarını yerel diskten servis et (bulutta S3'e taşınır)
os.makedirs(settings.MEDIA_ROOT, exist_ok=True)
app.mount(
    settings.MEDIA_URL_PREFIX,
    StaticFiles(directory=settings.MEDIA_ROOT),
    name="media",
)


@app.get("/", tags=["Sistem"])
async def root() -> dict[str, str]:
    return {
        "name": settings.APP_NAME,
        "version": "0.1.0",
        "docs": "/docs",
    }


@app.get("/health", tags=["Sistem"])
async def health() -> dict[str, object]:
    """Bulut sağlayıcılarının sağlık kontrolü için."""
    from app.services.realtime import hub

    return {
        "status": "ok",
        "environment": settings.ENVIRONMENT,
        "mqtt_connected": bridge.connected,
        "tracked_devices": len(hub.known_devices()),
    }


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Beklenmeyen hatalarda yığın izini istemciye sızdırma."""
    logger.exception("İşlenmemiş hata: %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Sunucuda beklenmeyen bir hata oluştu"},
    )
