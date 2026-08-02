"""Log ve görüntü şemaları."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import LogLevel
from app.schemas.common import ORMModel


class LogRead(ORMModel):
    id: int
    device_id: uuid.UUID
    message: str
    level: LogLevel
    channels: list
    x: float | None
    y: float | None
    z: float | None
    created_at: datetime


class LogCreate(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    level: LogLevel = LogLevel.INFO
    channels: list[str] = Field(default_factory=list)
    x: float | None = None
    y: float | None = None
    z: float | None = None


class ImageRead(ORMModel):
    id: uuid.UUID
    device_id: uuid.UUID
    url: str
    thumbnail_url: str | None
    x: float | None
    y: float | None
    z: float | None
    captured_at: datetime | None
    meta: dict
    created_at: datetime


class ImageCreate(BaseModel):
    url: str = Field(min_length=1, max_length=500)
    thumbnail_url: str | None = None
    x: float | None = None
    y: float | None = None
    z: float | None = None
    captured_at: datetime | None = None
    meta: dict = Field(default_factory=dict)
