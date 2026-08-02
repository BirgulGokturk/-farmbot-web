"""Cihaz (robot) şemaları."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class DeviceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    serial_number: str | None = None
    model: str = "Genesis XL v1.8"
    timezone: str = "Europe/Istanbul"
    lat: float | None = None
    lng: float | None = None
    indoor: bool = False
    bed_width_mm: int = Field(default=5900, gt=0, le=20000)
    bed_length_mm: int = Field(default=2900, gt=0, le=20000)
    max_z_mm: int = Field(default=400, gt=0, le=5000)
    camera_stream_url: str | None = None


class DeviceUpdate(BaseModel):
    """Tüm alanlar isteğe bağlı — kısmi güncelleme (PATCH) için."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    serial_number: str | None = None
    model: str | None = None
    timezone: str | None = None
    lat: float | None = None
    lng: float | None = None
    indoor: bool | None = None
    bed_width_mm: int | None = Field(default=None, gt=0, le=20000)
    bed_length_mm: int | None = Field(default=None, gt=0, le=20000)
    max_z_mm: int | None = Field(default=None, gt=0, le=5000)
    safe_height_mm: int | None = None
    soil_height_mm: int | None = None
    camera_stream_url: str | None = None
    settings: dict[str, Any] | None = None


class DeviceRead(ORMModel):
    id: uuid.UUID
    name: str
    serial_number: str | None
    model: str
    firmware_version: str | None
    timezone: str
    lat: float | None
    lng: float | None
    indoor: bool

    bed_width_mm: int
    bed_length_mm: int
    max_z_mm: int
    safe_height_mm: int
    soil_height_mm: int

    camera_stream_url: str | None
    settings: dict[str, Any]

    last_seen_at: datetime | None
    is_locked: bool
    last_x: float
    last_y: float
    last_z: float
    is_online: bool

    created_at: datetime


class Position(BaseModel):
    x: float
    y: float
    z: float


class DeviceStatusRead(BaseModel):
    """WebSocket üzerinden yayınlanan canlı durumun REST karşılığı."""

    device_id: str
    online: bool
    locked: bool
    busy: bool
    sync_status: str
    position: Position
    axis_states: dict[str, str]
    pins: dict[str, Any]
    informational: dict[str, Any]
    last_seen_at: datetime | None
