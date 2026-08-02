"""Bahçe şemaları: noktalar (bitkiler/otlar/yuvalar), tür kataloğu, eğriler, aletler."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import CurveType, PlantStage, PointType, SunRequirement, ToolStatus
from app.schemas.common import ORMModel


# --------------------------------------------------------------------------- #
# Bitki türü kataloğu
# --------------------------------------------------------------------------- #

class PlantSpeciesRead(ORMModel):
    id: uuid.UUID
    slug: str
    name_tr: str
    name_en: str | None
    icon: str
    color: str
    spread_mm: int
    sow_depth_mm: int
    days_to_harvest: int
    water_ml_per_day: int
    sun_requirement: SunRequirement
    notes: str | None


class PlantSpeciesCreate(BaseModel):
    slug: str = Field(min_length=1, max_length=80)
    name_tr: str = Field(min_length=1, max_length=120)
    name_en: str | None = None
    icon: str = "🌱"
    color: str = "#4ade80"
    spread_mm: int = Field(default=200, gt=0, le=5000)
    sow_depth_mm: int = Field(default=10, ge=0, le=500)
    days_to_harvest: int = Field(default=60, gt=0, le=1000)
    water_ml_per_day: int = Field(default=200, ge=0, le=100000)
    sun_requirement: SunRequirement = SunRequirement.FULL
    notes: str | None = None


# --------------------------------------------------------------------------- #
# Noktalar
# --------------------------------------------------------------------------- #

class PointBase(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    x: float
    y: float
    z: float = 0.0
    radius_mm: float = Field(default=25.0, gt=0, le=5000)
    meta: dict = Field(default_factory=dict)


class PointCreate(PointBase):
    point_type: PointType = PointType.PLANT
    species_id: uuid.UUID | None = None
    stage: PlantStage = PlantStage.PLANNED
    planted_at: datetime | None = None
    depth_mm: int | None = None
    tool_id: uuid.UUID | None = None
    pullout_direction: int = Field(default=0, ge=0, le=4)
    gantry_mounted: bool = False


class PointUpdate(BaseModel):
    """Kısmi güncelleme — tasarımcıda sürükleme sonrası sadece x/y gönderilir."""

    name: str | None = Field(default=None, min_length=1, max_length=160)
    x: float | None = None
    y: float | None = None
    z: float | None = None
    radius_mm: float | None = Field(default=None, gt=0, le=5000)
    species_id: uuid.UUID | None = None
    stage: PlantStage | None = None
    planted_at: datetime | None = None
    depth_mm: int | None = None
    tool_id: uuid.UUID | None = None
    pullout_direction: int | None = Field(default=None, ge=0, le=4)
    gantry_mounted: bool | None = None
    meta: dict | None = None


class PointRead(ORMModel):
    id: uuid.UUID
    device_id: uuid.UUID
    point_type: PointType
    name: str
    x: float
    y: float
    z: float
    radius_mm: float
    meta: dict

    species_id: uuid.UUID | None
    species: PlantSpeciesRead | None = None
    stage: PlantStage
    planted_at: datetime | None
    depth_mm: int | None

    tool_id: uuid.UUID | None
    pullout_direction: int
    gantry_mounted: bool

    created_at: datetime
    updated_at: datetime


class PointBulkMove(BaseModel):
    """Tasarımcıda birden fazla bitkiyi tek istekte taşımak için."""

    moves: list["PointMove"]


class PointMove(BaseModel):
    id: uuid.UUID
    x: float
    y: float
    z: float | None = None


PointBulkMove.model_rebuild()


# --------------------------------------------------------------------------- #
# Eğriler
# --------------------------------------------------------------------------- #

class CurveCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    curve_type: CurveType
    data: dict[str, float] = Field(default_factory=dict)


class CurveRead(ORMModel):
    id: uuid.UUID
    device_id: uuid.UUID
    name: str
    curve_type: CurveType
    data: dict
    created_at: datetime


# --------------------------------------------------------------------------- #
# Aletler
# --------------------------------------------------------------------------- #

class ToolCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    icon: str = "🔧"
    flow_rate_ml_per_s: float | None = Field(default=None, gt=0)
    status: ToolStatus = ToolStatus.ACTIVE


class ToolRead(ORMModel):
    id: uuid.UUID
    device_id: uuid.UUID
    name: str
    icon: str
    flow_rate_ml_per_s: float | None
    status: ToolStatus
    created_at: datetime
