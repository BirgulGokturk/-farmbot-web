"""Uyarı kuralı ve bildirim şemaları."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from app.models.enums import AlertComparison, AlertKind, LogLevel
from app.schemas.common import ORMModel


class AlertRuleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    kind: AlertKind = AlertKind.SENSOR_THRESHOLD
    enabled: bool = True
    level: LogLevel = LogLevel.WARN

    sensor_id: uuid.UUID | None = None
    comparison: AlertComparison = AlertComparison.BELOW
    threshold: float | None = None

    offline_minutes: int = Field(default=15, ge=1, le=1440)
    cooldown_minutes: int = Field(default=60, ge=1, le=10_080)

    @model_validator(mode="after")
    def _require_sensor_fields(self) -> "AlertRuleCreate":
        """Eşik kuralı sensör ve eşik değeri olmadan anlamsızdır."""
        if self.kind is AlertKind.SENSOR_THRESHOLD:
            if self.sensor_id is None:
                raise ValueError("Eşik kuralı için sensör seçilmeli")
            if self.threshold is None:
                raise ValueError("Eşik kuralı için eşik değeri girilmeli")
        return self


class AlertRuleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    enabled: bool | None = None
    level: LogLevel | None = None
    sensor_id: uuid.UUID | None = None
    comparison: AlertComparison | None = None
    threshold: float | None = None
    offline_minutes: int | None = Field(default=None, ge=1, le=1440)
    cooldown_minutes: int | None = Field(default=None, ge=1, le=10_080)


class AlertRuleRead(ORMModel):
    id: uuid.UUID
    device_id: uuid.UUID
    name: str
    kind: AlertKind
    enabled: bool
    level: LogLevel
    sensor_id: uuid.UUID | None
    comparison: AlertComparison
    threshold: float | None
    offline_minutes: int
    cooldown_minutes: int
    last_triggered_at: datetime | None
    created_at: datetime


class NotificationRead(ORMModel):
    id: int
    device_id: uuid.UUID
    rule_id: uuid.UUID | None
    title: str
    message: str
    level: LogLevel
    read_at: datetime | None
    created_at: datetime


class NotificationSummary(BaseModel):
    unread: int
    items: list[NotificationRead]
