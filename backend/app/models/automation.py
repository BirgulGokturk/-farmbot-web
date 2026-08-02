"""Otomasyon: diziler, programlar, takvim olayları ve nokta grupları."""

from __future__ import annotations

import uuid
from datetime import datetime, time
from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, DateTime, Enum as SAEnum
from sqlalchemy import ForeignKey, Index, Integer, String, Text, Time, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, JSONType, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import ExecutableType, PointGroupSort, TimeUnit

if TYPE_CHECKING:
    pass


class Sequence(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Yeniden kullanılabilir komut dizisi (CeleryScript adımları)."""

    __tablename__ = "sequences"

    device_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str] = mapped_column(String(20), default="emerald")
    icon: Mapped[str] = mapped_column(String(16), default="⚙️")

    # CeleryScript adım dizisi — bkz. docs/MQTT.md
    body: Mapped[list[Any]] = mapped_column(JSONType, default=list)
    # Dizi değişkenleri (ör. "hedef nokta") — çalıştırma anında doldurulur
    args: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)

    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    folder: Mapped[str | None] = mapped_column(String(120))


class Regimen(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Bitkinin yaşına bağlı çalışan program (ör. "domates bakım programı")."""

    __tablename__ = "regimens"

    device_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    color: Mapped[str] = mapped_column(String(20), default="sky")
    description: Mapped[str | None] = mapped_column(Text)

    items: Mapped[list["RegimenItem"]] = relationship(
        back_populates="regimen", cascade="all, delete-orphan", lazy="selectin"
    )


class RegimenItem(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Programın tek bir satırı: "ekimden N gün sonra saat HH:MM'de şu diziyi çalıştır"."""

    __tablename__ = "regimen_items"

    regimen_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("regimens.id", ondelete="CASCADE"), index=True
    )
    sequence_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("sequences.id", ondelete="CASCADE")
    )
    day_offset: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    time_of_day: Mapped[time] = mapped_column(Time, nullable=False)

    regimen: Mapped["Regimen"] = relationship(back_populates="items")


class FarmEvent(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Takvim olayı — sulama zamanlayıcısının ve takvim modülünün veri kaynağı."""

    __tablename__ = "farm_events"
    __table_args__ = (
        # "Sıradaki görev ne?" sorgusu için
        Index("ix_events_device_next", "device_id", "is_active", "next_run_at"),
    )

    device_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(160), default="")

    executable_type: Mapped[ExecutableType] = mapped_column(
        SAEnum(ExecutableType, native_enum=False), default=ExecutableType.SEQUENCE
    )
    executable_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)

    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    repeat_every: Mapped[int] = mapped_column(Integer, default=0)  # 0 = tekrarsız
    time_unit: Mapped[TimeUnit] = mapped_column(
        SAEnum(TimeUnit, native_enum=False), default=TimeUnit.NEVER
    )

    body: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PointGroup(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Nokta grubu — "tüm domateslere şu diziyi uygula" gibi toplu işlemler için."""

    __tablename__ = "point_groups"

    device_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    # Elle seçilen nokta kimlikleri
    point_ids: Mapped[list[Any]] = mapped_column(JSONType, default=list)
    # Otomatik dahil etme kuralı, ör. {"species_id": "...", "stage": "planted"}
    criteria: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    sort_type: Mapped[PointGroupSort] = mapped_column(
        SAEnum(PointGroupSort, native_enum=False), default=PointGroupSort.XY_ASCENDING
    )
