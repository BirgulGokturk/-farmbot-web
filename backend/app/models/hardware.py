"""Donanım pinleri: çevre birimleri (çıkış), sensörler (giriş) ve okumaları."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Index, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Peripheral(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """GPIO çıkışı — su pompası, vana, lamba, vakum pompası…"""

    __tablename__ = "peripherals"

    device_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), index=True
    )
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    pin: Mapped[int] = mapped_column(Integer, nullable=False)
    mode: Mapped[int] = mapped_column(Integer, default=0)  # 0 = dijital, 1 = analog
    icon: Mapped[str] = mapped_column(String(16), default="💡")


class Sensor(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """GPIO girişi — toprak nemi, sıcaklık, ışık, su akışı…"""

    __tablename__ = "sensors"

    device_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), index=True
    )
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    pin: Mapped[int] = mapped_column(Integer, nullable=False)
    mode: Mapped[int] = mapped_column(Integer, default=1)  # 0 = dijital, 1 = analog
    unit: Mapped[str] = mapped_column(String(20), default="")
    icon: Mapped[str] = mapped_column(String(16), default="📊")
    # Ham ADC değerini (0–1023) anlamlı birime ölçeklemek için
    min_value: Mapped[float] = mapped_column(Float, default=0.0)
    max_value: Mapped[float] = mapped_column(Float, default=100.0)


class SensorReading(TimestampMixin, Base):
    """Zaman serisi telemetri. Hacim yüksek olduğu için birincil anahtar bigserial."""

    __tablename__ = "sensor_readings"
    __table_args__ = (
        Index("ix_readings_device_sensor_time", "device_id", "sensor_id", "read_at"),
    )

    # SQLite yalnızca `INTEGER PRIMARY KEY` sütunlarını otomatik artırır; BIGINT
    # kullanılırsa satır eklerken NOT NULL hatası verir. SQLite'ın INTEGER'ı zaten
    # 64 bittir, dolayısıyla varyant kullanmak kapasiteden ödün vermez.
    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), index=True
    )
    sensor_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("sensors.id", ondelete="SET NULL")
    )
    pin: Mapped[int | None] = mapped_column(Integer)
    value: Mapped[float] = mapped_column(Float, nullable=False)

    # Ölçüm anındaki robot konumu — "hangi bitkinin yanında ölçüldü" sorusu için
    x: Mapped[float | None] = mapped_column(Float)
    y: Mapped[float | None] = mapped_column(Float)
    z: Mapped[float | None] = mapped_column(Float)

    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
