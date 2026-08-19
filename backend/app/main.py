"""FastAPI uygulaması — giriş noktası."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
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

    from app.services.alerts import watcher

    await watcher.start()

    if settings.SIMULATOR_ENABLED:
        logger.info(
            "Simülatör etkin — gerçek robot bağlanana kadar komutlar sanal robota gider"
        )

    yield

    await bridge.stop()
    await watcher.stop()

    from app.services.simulator import simulator

    await simulator.stop_all()
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


@app.get("/api", tags=["Sistem"])
async def api_root() -> dict[str, str]:
    return {
        "name": settings.APP_NAME,
        "version": "0.1.0",
        "docs": "/docs",
    }


@app.get("/health", tags=["Sistem"])
async def health() -> dict[str, object]:
    """Bulut sağlayıcılarının sağlık kontrolü için."""
    from app.services import gateway
    from app.services.realtime import hub
    from app.services.simulator import simulator

    return {
        "status": "ok",
        "environment": settings.ENVIRONMENT,
        # Komutların şu anda hangi yoldan gittiği: mqtt | simulator | none
        "transport": gateway.active_transport().value,
        "mqtt_connected": bridge.connected,
        "simulated_robots": simulator.active_count,
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


# --------------------------------------------------------------------------- #
# Yerel ağ kipi: arayüzü de bu sunucu versin
# --------------------------------------------------------------------------- #
#
# Bulut üzerinden gitmenin bedeli var: cihaz token'ı, uyanma gecikmesi ve
# internet kesildiğinde robotun yönetilememesi. Pi ile tarayıcı aynı ağdaysa
# bunların hiçbirine gerek yok — arayüz de veri de aynı adresten gelebilir.
#
# İsteğe bağlı: `FRONTEND_DIST` boşsa hiçbir şey değişmiyor ve bulut kurulumu
# aynen çalışmaya devam ediyor.

def _frontend_root() -> Path | None:
    if not settings.FRONTEND_DIST:
        return None
    root = Path(settings.FRONTEND_DIST).expanduser().resolve()
    if not (root / "index.html").is_file():
        logger.warning(
            "FRONTEND_DIST=%s içinde index.html yok; arayüz sunulmayacak. "
            "Önce `npm run build` çalıştırın.",
            root,
        )
        return None
    return root


_FRONTEND = _frontend_root()

# Bu ön ekler arayüze düşmemeli: var olmayan bir API yolu 404 JSON dönmeli,
# index.html değil. Aksi hâlde yazım hatası olan bir istek sessizce HTML alır
# ve istemci "beklenmedik yanıt" diye anlaşılmaz bir hata gösterir.
_SUNUCU_ONEKLERI = ("api", "docs", "redoc", "openapi.json", "health", "media")

if _FRONTEND is not None:
    logger.info("Arayüz yerel olarak sunuluyor: %s", _FRONTEND)

    app.mount(
        "/assets",
        StaticFiles(directory=_FRONTEND / "assets"),
        name="frontend-assets",
    )

    @app.get("/{yol:path}", include_in_schema=False)
    async def spa(yol: str) -> Response:
        """Tek sayfa uygulaması: dosya varsa onu, yoksa index.html.

        React Router yolları (/settings, /viewer…) sunucuda dosya karşılığı
        olmayan adresler; sayfa yenilendiğinde 404 almamaları için index.html
        dönüyoruz ve yönlendirmeyi tarayıcıdaki router yapıyor.
        """
        if yol.split("/", 1)[0] in _SUNUCU_ONEKLERI:
            return JSONResponse({"detail": "Bulunamadı"}, status_code=404)

        # `resolve()` ile dizin dışına çıkma denemelerini eliyoruz: ".." içeren
        # bir istek kök dizinin dışındaki dosyaları okuyabilirdi.
        if yol:
            aday = (_FRONTEND / yol).resolve()
            if aday.is_file() and aday.is_relative_to(_FRONTEND):
                return FileResponse(aday)

        return FileResponse(_FRONTEND / "index.html")
