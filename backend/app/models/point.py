"""Bahçedeki noktalar: bitkiler, yabani otlar, alet yuvaları ve işaretçiler.

FarmBot'un kendi veri modeli gibi hepsi tek tabloda tutulur; `point_type` ayrımı yapar.
Böylece tasarımcı ekranı tek sorguyla tüm görünür nesneleri çekebilir.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, Enum as SAEnum
from sqlalchemy import Float, ForeignKey, Index, Integer, SmallInteger, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, JSONType, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import PlantStage, PointType

if TYPE_CHECKING:
    from app.models.catalog import PlantSpecies


class Point(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "points"
    __table_args__ = (
        Index("ix_points_device_type", "device_id", "point_type"),
        # Tasarımcı, görünür alandaki noktaları hızlı çeksin diye
        Index("ix_points_device_xy", "device_id", "x", "y"),
    )

    device_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), index=True
    )

    point_type: Mapped[PointType] = mapped_column(
        SAEnum(PointType, native_enum=False), default=PointType.PLANT, nullable=False
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)

    # Robotla aynı birim: milimetre. Dönüşüm hatası olmasın diye her yerde mm.
    x: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    y: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    z: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    radius_mm: Mapped[float] = mapped_column(Float, default=25.0)

    meta: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)

    # --- Yalnızca plant / weed için ---
    species_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("plant_species.id", ondelete="SET NULL")
    )
    stage: Mapped[PlantStage] = mapped_column(
        SAEnum(PlantStage, native_enum=False), default=PlantStage.PLANNED
    )
    planted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    depth_mm: Mapped[int | None] = mapped_column(Integer)
    water_curve_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("curves.id", ondelete="SET NULL")
    )
    spread_curve_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("curves.id", ondelete="SET NULL")
    )
    height_curve_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("curves.id", ondelete="SET NULL")
    )

    # --- Yalnızca tool_slot için ---
    tool_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("tools.id", ondelete="SET NULL")
    )
    pullout_direction: Mapped[int] = mapped_column(SmallInteger, default=0)
    gantry_mounted: Mapped[bool] = mapped_column(default=False)

    # --- Yumuşak silme: FarmBot da silinen noktayı bir süre saklar ---
    discarded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True
    )

    species: Mapped["PlantSpecies | None"] = relationship(lazy="joined")
