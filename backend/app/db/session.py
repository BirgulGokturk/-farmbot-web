"""Async veritabanı motoru ve oturum bağımlılığı."""

from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

# SQLite'ta pool ayarları geçerli değil; sadece Postgres'te uygula.
_engine_kwargs: dict = {"echo": settings.DB_ECHO, "future": True}
if not settings.is_sqlite:
    _engine_kwargs.update(
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,  # kopmuş bağlantıları sessizce yenile
        pool_recycle=1800,
    )

engine = create_async_engine(settings.DATABASE_URL, **_engine_kwargs)

SessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,  # commit sonrası nesneler kullanılabilir kalsın
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI bağımlılığı: istek başına bir veritabanı oturumu."""
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


async def init_db() -> None:
    """Geliştirme kolaylığı: tabloları oluştur.

    Üretimde şema yönetimi Alembic göçleriyle yapılır; bu fonksiyon
    yalnızca ENVIRONMENT=development iken çağrılır.
    """
    from app import models  # noqa: F401 — tüm modellerin metadata'ya kaydı için
    from app.db.base import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
