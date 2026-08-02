"""Bitki kataloğu, büyüme eğrileri ve aletler."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import Enum as SAEnum
from sqlalchemy import Float, ForeignKey, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, JSONType, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import CurveType, SunRequirement, ToolStatus


class PlantSpecies(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Küresel bitki türü kataloğu — cihazdan bağımsızdır, tüm kullanıcılar paylaşır."""

    __tablename__ = "plant_species"

    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    name_tr: Mapped[str] = mapped_column(String(120), nullable=False)
    name_en: Mapped[str | None] = mapped_column(String(120))

    icon: Mapped[str] = mapped_column(String(16), default="🌱")
    color: Mapped[str] = mapped_column(String(20), default="#4ade80")

    spread_mm: Mapped[int] = mapped_column(Integer, default=200)       # bitkiler arası aralık
    sow_depth_mm: Mapped[int] = mapped_column(Integer, default=10)     # ekim derinliği
    days_to_harvest: Mapped[int] = mapped_column(Integer, default=60)
    water_ml_per_day: Mapped[int] = mapped_column(Integer, default=200)
    sun_requirement: Mapped[SunRequirement] = mapped_column(
        SAEnum(SunRequirement, native_enum=False), default=SunRequirement.FULL
    )
    notes: Mapped[str | None] = mapped_column(Text)


class Curve(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Bitki yaşına göre su / yayılım / boy değerini modelleyen eğri.

    `data` biçimi: {"gün": değer} — ör. {"1": 50, "10": 120, "30": 400}
    Ara günler doğrusal enterpolasyonla hesaplanır.
    """

    __tablename__ = "curves"

    device_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    curve_type: Mapped[CurveType] = mapped_column(SAEnum(CurveType, native_enum=False))
    data: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)


class Tool(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Robotun takıp çıkarabildiği aletler (sulama ucu, ekici, toprak sensörü…)."""

    __tablename__ = "tools"

    device_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    icon: Mapped[str] = mapped_column(String(16), default="🔧")
    # Sulama ucu için debi — sulama süresini su hacminden hesaplamakta kullanılır
    flow_rate_ml_per_s: Mapped[float | None] = mapped_column(Float)
    status: Mapped[ToolStatus] = mapped_column(
        SAEnum(ToolStatus, native_enum=False), default=ToolStatus.ACTIVE
    )
