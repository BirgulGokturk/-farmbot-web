"""Alembic ortamı — async motor üzerinden çalışır.

Bağlantı adresi `alembic.ini` yerine uygulama ayarlarından (.env) okunur;
böylece dağıtımda tek bir DATABASE_URL yeter.
"""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.core.config import settings
from app.db.base import Base
from app import models  # noqa: F401 — tüm tabloların metadata'ya kaydı için

config = context.config
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _configure(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # Sütun tipi değişikliklerini de yakala
        compare_type=True,
        compare_server_default=True,
        # SQLite ALTER TABLE'ı sınırlı; tabloyu yeniden oluşturarak uygula
        render_as_batch=settings.is_sqlite,
    )


def run_migrations_offline() -> None:
    """Veritabanına bağlanmadan SQL üretir (--sql modu)."""
    context.configure(
        url=settings.DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=settings.is_sqlite,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    _configure(connection)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
