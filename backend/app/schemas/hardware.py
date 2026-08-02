"""Donanım şemaları: çevre birimleri, sensörler, telemetri."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class PeripheralCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    pin: int = Field(ge=0, le=69)
    mode: int = Field(default=0, ge=0, le=1)
    icon: str = "💡"


class PeripheralRead(ORMModel):
    id: uuid.UUID
    device_id: uuid.UUID
    label: str
    pin: int
    mode: int
    icon: str


class SensorCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    pin: int = Field(ge=0, le=69)
    mode: int = Field(default=1, ge=0, le=1)
    unit: str = ""
    icon: str = "📊"
    min_value: float = 0.0
    max_value: float = 100.0


class SensorRead(ORMModel):
    id: uuid.UUID
    device_id: uuid.UUID
    label: str
    pin: int
    mode: int
    unit: str
    icon: str
    min_value: float
    max_value: float


class SensorReadingCreate(BaseModel):
    sensor_id: uuid.UUID | None = None
    pin: int | None = None
    value: float
    x: float | None = None
    y: float | None = None
    z: float | None = None
    read_at: datetime | None = None


class SensorReadingRead(ORMModel):
    id: int
    device_id: uuid.UUID
    sensor_id: uuid.UUID | None
    pin: int | None
    value: float
    x: float | None
    y: float | None
    z: float | None
    read_at: datetime


class SensorSeriesPoint(BaseModel):
    """Grafik için sadeleştirilmiş nokta."""

    t: datetime
    v: float


class SpatialReading(BaseModel):
    """Isı haritası için konumlu ölçüm."""

    x: float
    y: float
    value: float
    read_at: datetime


class SensorSeries(BaseModel):
    sensor_id: uuid.UUID
    label: str
    unit: str
    points: list[SensorSeriesPoint]
