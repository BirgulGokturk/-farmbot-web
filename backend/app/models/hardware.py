"""Donanım: çevre birimleri (çıkış), sensörler (giriş) ve okumaları.

Sensörler **kanal adıyla** tanımlanır (`channel`), GPIO piniyle değil.
Sebep: BMP180 gibi I²C sensörlerin pin numarası yoktur ve tek bir modül
birden fazla büyüklük ölçer (basınç + sıcaklık + rakım). Kanal adı, Arduino
yazılımındaki alan adıyla birebir eşleşir — köprü ajanı gelen JSON'u bu adla
doğru sensöre bağlar.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import PeripheralKind, SensorKind


class Peripheral(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Çıkış birimi — su pompası, vana, lamba, servo."""

    __tablename__ = "peripherals"

    device_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), index=True
    )
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    pin: Mapped[int] = mapped_column(Integer, nullable=False)
    mode: Mapped[int] = mapped_column(Integer, default=0)  # 0 = dijital, 1 = analog
    icon: Mapped[str] = mapped_column(String(16), default="💡")

    kind: Mapped[PeripheralKind] = mapped_column(
        SAEnum(PeripheralKind, native_enum=False), default=PeripheralKind.DIGITAL
    )

    # --- Yalnızca servo için ---
    # Aç/kapa anahtarı bu iki açı arasında geçiş yapar. Mekanik hazır olmadığı
    # için varsayılanlar güvenli uçlar; kalibrasyon sonrası Ayarlar'dan değişir.
    servo_open_angle: Mapped[int] = mapped_column(Integer, default=90)
    servo_closed_angle: Mapped[int] = mapped_column(Integer, default=0)


class Sensor(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Giriş birimi — toprak nemi, sıcaklık, basınç, ışık…"""

    __tablename__ = "sensors"
    __table_args__ = (
        # Köprü ajanı kanal adıyla eşleştirme yapar; cihaz içinde tekil olmalı
        UniqueConstraint("device_id", "channel", name="uq_sensors_device_channel"),
    )

    device_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), index=True
    )
    label: Mapped[str] = mapped_column(String(120), nullable=False)

    # Arduino yazılımındaki alan adı, ör. "bmp180_pressure", "dht_humidity"
    channel: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    kind: Mapped[SensorKind] = mapped_column(
        SAEnum(SensorKind, native_enum=False), default=SensorKind.GENERIC
    )

    # I²C sensörlerde pin yoktur
    pin: Mapped[int | None] = mapped_column(Integer)
    mode: Mapped[int] = mapped_column(Integer, default=1)  # 0 = dijital, 1 = analog

    unit: Mapped[str] = mapped_column(String(20), default="")
    icon: Mapped[str] = mapped_column(String(16), default="📊")
    # Grafik ekseni ve ısı haritası renk ölçeği bu aralığa göre çizilir
    min_value: Mapped[float] = mapped_column(Float, default=0.0)
    max_value: Mapped[float] = mapped_column(Float, default=100.0)


class SensorReading(TimestampMixin, Base):
    """Zaman serisi telemetri. Hacim yüksek olduğu için bigserial anahtar."""

    __tablename__ = "sensor_readings"
    __table_args__ = (
        Index("ix_readings_device_sensor_time", "device_id", "sensor_id", "read_at"),
    )

    # SQLite BIGINT birincil anahtarı otomatik artırmaz; yalnızca INTEGER artırır
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

    # Ölçüm anındaki robot konumu — ısı haritası bunu kullanır
    x: Mapped[float | None] = mapped_column(Float)
    y: Mapped[float | None] = mapped_column(Float)
    z: Mapped[float | None] = mapped_column(Float)

    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
