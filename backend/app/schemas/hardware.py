"""Donanım şemaları: çevre birimleri, sensörler, telemetri."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import PeripheralKind, SensorKind
from app.schemas.common import ORMModel


class PeripheralCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    pin: int = Field(ge=0, le=69)
    mode: int = Field(default=0, ge=0, le=1)
    icon: str = "💡"
    kind: PeripheralKind = PeripheralKind.DIGITAL
    servo_open_angle: int = Field(default=90, ge=0, le=180)
    servo_closed_angle: int = Field(default=0, ge=0, le=180)


class PeripheralUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    pin: int | None = Field(default=None, ge=0, le=69)
    icon: str | None = None
    kind: PeripheralKind | None = None
    servo_open_angle: int | None = Field(default=None, ge=0, le=180)
    servo_closed_angle: int | None = Field(default=None, ge=0, le=180)


class PeripheralRead(ORMModel):
    id: uuid.UUID
    device_id: uuid.UUID
    label: str
    pin: int
    mode: int
    icon: str
    kind: PeripheralKind
    servo_open_angle: int
    servo_closed_angle: int


class SensorCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    # Köprü ajanının ölçümü eşleştirdiği anahtar, ör. "dht_humidity"
    channel: str = Field(default="", max_length=80)
    kind: SensorKind = SensorKind.GENERIC
    # I²C sensörlerde pin yoktur
    pin: int | None = Field(default=None, ge=0, le=69)
    mode: int = Field(default=1, ge=0, le=1)
    unit: str = ""
    icon: str = "📊"
    min_value: float = 0.0
    max_value: float = 100.0


class SensorRead(ORMModel):
    id: uuid.UUID
    device_id: uuid.UUID
    label: str
    channel: str
    kind: SensorKind
    pin: int | None
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
