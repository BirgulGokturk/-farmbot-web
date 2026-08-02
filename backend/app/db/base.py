"""Ortak SQLAlchemy temel sınıfı ve tekrar kullanılan sütun tipleri."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, MetaData, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import JSON

# Alembic'in kısıtlamaları tutarlı adlandırması için (autogenerate'in doğru çalışması şart)
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

# PostgreSQL'de JSONB, SQLite'ta düz JSON olarak davranır.
JSONType = JSON().with_variant(JSONB(), "postgresql")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)

    type_annotation_map = {dict[str, Any]: JSONType, list[Any]: JSONType}

    def __repr__(self) -> str:  # pragma: no cover - sadece hata ayıklama kolaylığı
        pk = getattr(self, "id", None)
        return f"<{type(self).__name__} id={pk}>"


class UUIDPrimaryKeyMixin:
    """UUID birincil anahtar — kayıtlar cihaz üzerinde çevrimdışı üretilebilsin diye."""

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )


class TimestampMixin:
    """Her tabloda bulunan oluşturma/güncelleme zaman damgaları (UTC).

    Değerler sunucu tarafında değil Python tarafında üretilir. Sunucu tarafı
    `onupdate` kullanılsaydı, SQLAlchemy her UPDATE sonrası yeni değeri okumak
    için ek bir sorgu çalıştırmak zorunda kalır ve bu async bağlamda
    `MissingGreenlet` hatasına yol açardı. `server_default` yalnızca ORM
    dışından eklenen satırlar için yedek olarak duruyor.
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
        server_default=func.now(),
        nullable=False,
    )
