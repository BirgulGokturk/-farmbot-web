"""Sistem kayıtları ve kamera görüntüleri."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Enum as SAEnum
from sqlalchemy import Float, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, JSONType, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import LogLevel


class Log(Base):
    """Robottan gelen log satırları. Hacim yüksek → bigserial birincil anahtar."""

    __tablename__ = "logs"
    __table_args__ = (Index("ix_logs_device_created", "device_id", "created_at"),)

    # Bkz. SensorReading.id — SQLite BIGINT birincil anahtarı otomatik artırmaz.
    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), index=True
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    level: Mapped[LogLevel] = mapped_column(
        SAEnum(LogLevel, native_enum=False), default=LogLevel.INFO
    )
    # Bildirim kanalları: ["ticker", "toast", "email"]
    channels: Mapped[list[Any]] = mapped_column(JSONType, default=list)

    x: Mapped[float | None] = mapped_column(Float)
    y: Mapped[float | None] = mapped_column(Float)
    z: Mapped[float | None] = mapped_column(Float)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )


class Image(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Kameradan çekilen fotoğraf — çekim konumuyla birlikte saklanır."""

    __tablename__ = "images"
    __table_args__ = (Index("ix_images_device_captured", "device_id", "captured_at"),)

    device_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), index=True
    )
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    thumbnail_url: Mapped[str | None] = mapped_column(String(500))

    x: Mapped[float | None] = mapped_column(Float)
    y: Mapped[float | None] = mapped_column(Float)
    z: Mapped[float | None] = mapped_column(Float)

    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Çözünürlük, kalibrasyon, yabani ot tespiti sonuçları vb.
    meta: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
