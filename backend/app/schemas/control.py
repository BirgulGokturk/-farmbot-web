"""Manuel kontrol ve robot komut şemaları."""

from __future__ import annotations

import uuid
from typing import Any

from pydantic import BaseModel, Field

from app.models.enums import Axis


class MoveRelativeRequest(BaseModel):
    """Jog pad: bulunduğu yerden göreli adım."""

    x: float = Field(default=0, ge=-10000, le=10000)
    y: float = Field(default=0, ge=-10000, le=10000)
    z: float = Field(default=0, ge=-10000, le=10000)
    speed: int = Field(default=100, ge=1, le=100)


class MoveAbsoluteRequest(BaseModel):
    """Belirli bir koordinata git."""

    x: float = Field(ge=-1000, le=20000)
    y: float = Field(ge=-1000, le=20000)
    z: float = Field(ge=-5000, le=1000)
    speed: int = Field(default=100, ge=1, le=100)


class HomeRequest(BaseModel):
    axis: Axis = Axis.ALL
    speed: int = Field(default=100, ge=1, le=100)
    find: bool = False  # true → sınır anahtarıyla gerçek evi bul


class PinWriteRequest(BaseModel):
    pin: int = Field(ge=0, le=69)
    value: int = Field(ge=0, le=255)
    mode: int = Field(default=0, ge=0, le=1)


class PinReadRequest(BaseModel):
    pin: int = Field(ge=0, le=69)
    mode: int = Field(default=1, ge=0, le=1)


class WaterPointRequest(BaseModel):
    """Bir bitkiyi sula. Süre doğrudan ya da su hacminden hesaplanarak verilir."""

    point_id: uuid.UUID
    duration_ms: int | None = Field(default=None, gt=0, le=600_000)
    volume_ml: int | None = Field(default=None, gt=0, le=100_000)
    pump_pin: int = Field(default=8, ge=0, le=69)
    speed: int = Field(default=100, ge=1, le=100)


class ExecuteSequenceRequest(BaseModel):
    sequence_id: uuid.UUID


class RawCommandRequest(BaseModel):
    """Ham CeleryScript adımları — dizi editöründe önizleme için."""

    body: list[dict[str, Any]] = Field(min_length=1, max_length=200)
    wait_for_response: bool = True


class CommandResponse(BaseModel):
    ok: bool
    label: str | None = None
    detail: str | None = None
    response: dict[str, Any] | None = None
