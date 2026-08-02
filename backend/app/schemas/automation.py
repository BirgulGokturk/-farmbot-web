"""Otomasyon şemaları: diziler, programlar, takvim olayları."""

from __future__ import annotations

import uuid
from datetime import datetime, time
from typing import Any

from pydantic import BaseModel, Field

from app.models.enums import ExecutableType, TimeUnit
from app.schemas.common import ORMModel


# --------------------------------------------------------------------------- #
# Diziler
# --------------------------------------------------------------------------- #

class SequenceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = None
    color: str = "emerald"
    icon: str = "⚙️"
    body: list[dict[str, Any]] = Field(default_factory=list)
    args: dict[str, Any] = Field(default_factory=dict)
    pinned: bool = False
    folder: str | None = None


class SequenceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = None
    color: str | None = None
    icon: str | None = None
    body: list[dict[str, Any]] | None = None
    args: dict[str, Any] | None = None
    pinned: bool | None = None
    folder: str | None = None


class SequenceRead(ORMModel):
    id: uuid.UUID
    device_id: uuid.UUID
    name: str
    description: str | None
    color: str
    icon: str
    body: list
    args: dict
    pinned: bool
    folder: str | None
    created_at: datetime
    updated_at: datetime


# --------------------------------------------------------------------------- #
# Programlar (regimen)
# --------------------------------------------------------------------------- #

class RegimenItemCreate(BaseModel):
    sequence_id: uuid.UUID
    day_offset: int = Field(ge=0, le=3650)
    time_of_day: time


class RegimenItemRead(ORMModel):
    id: uuid.UUID
    sequence_id: uuid.UUID
    day_offset: int
    time_of_day: time


class RegimenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    color: str = "sky"
    description: str | None = None
    items: list[RegimenItemCreate] = Field(default_factory=list)


class RegimenRead(ORMModel):
    id: uuid.UUID
    device_id: uuid.UUID
    name: str
    color: str
    description: str | None
    items: list[RegimenItemRead]
    created_at: datetime


# --------------------------------------------------------------------------- #
# Takvim olayları
# --------------------------------------------------------------------------- #

class FarmEventCreate(BaseModel):
    title: str = Field(default="", max_length=160)
    executable_type: ExecutableType = ExecutableType.SEQUENCE
    executable_id: uuid.UUID
    start_time: datetime
    end_time: datetime | None = None
    repeat_every: int = Field(default=0, ge=0, le=1000)
    time_unit: TimeUnit = TimeUnit.NEVER
    body: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True


class FarmEventUpdate(BaseModel):
    title: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    repeat_every: int | None = Field(default=None, ge=0, le=1000)
    time_unit: TimeUnit | None = None
    body: dict[str, Any] | None = None
    is_active: bool | None = None


class FarmEventRead(ORMModel):
    id: uuid.UUID
    device_id: uuid.UUID
    title: str
    executable_type: ExecutableType
    executable_id: uuid.UUID
    start_time: datetime
    end_time: datetime | None
    repeat_every: int
    time_unit: TimeUnit
    body: dict
    is_active: bool
    last_run_at: datetime | None
    next_run_at: datetime | None
    created_at: datetime


class CalendarOccurrence(BaseModel):
    """Takvim görünümü için hesaplanmış tek bir çalışma anı."""

    event_id: uuid.UUID
    title: str
    executable_type: ExecutableType
    executable_id: uuid.UUID
    occurs_at: datetime
