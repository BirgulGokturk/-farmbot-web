"""Uyarı kuralları ve üretilen bildirimler."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import AlertComparison, AlertKind, LogLevel


class AlertRule(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Kullanıcının tanımladığı uyarı kuralı.

    İki tür desteklenir:
      * `sensor_threshold` — bir sensör eşiği aşarsa/altına düşerse
      * `device_offline`   — robot belirtilen süre boyunca haber vermezse
    """

    __tablename__ = "alert_rules"

    device_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    kind: Mapped[AlertKind] = mapped_column(
        SAEnum(AlertKind, native_enum=False), default=AlertKind.SENSOR_THRESHOLD
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    level: Mapped[LogLevel] = mapped_column(
        SAEnum(LogLevel, native_enum=False), default=LogLevel.WARN
    )

    # --- sensor_threshold için ---
    sensor_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("sensors.id", ondelete="CASCADE")
    )
    comparison: Mapped[AlertComparison] = mapped_column(
        SAEnum(AlertComparison, native_enum=False), default=AlertComparison.BELOW
    )
    threshold: Mapped[float | None] = mapped_column(Float)

    # --- device_offline için ---
    offline_minutes: Mapped[int] = mapped_column(Integer, default=15)

    # Aynı uyarının dakikada bir tekrarlanmaması için bekleme süresi
    cooldown_minutes: Mapped[int] = mapped_column(Integer, default=60)
    last_triggered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Notification(TimestampMixin, Base):
    """Bir kural tetiklendiğinde üretilen bildirim."""

    __tablename__ = "notifications"
    __table_args__ = (
        # Çan ikonundaki okunmamış sayacı ve liste sorgusu için
        Index("ix_notifications_device_read", "device_id", "read_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), index=True
    )
    rule_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("alert_rules.id", ondelete="SET NULL")
    )

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    level: Mapped[LogLevel] = mapped_column(
        SAEnum(LogLevel, native_enum=False), default=LogLevel.WARN
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
