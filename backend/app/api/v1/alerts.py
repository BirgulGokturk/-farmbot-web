"""Uyarı kuralları ve bildirimler."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select, update

from app.api.deps import DbSession, OwnedDevice
from app.models import AlertRule, Notification, Sensor
from app.models.enums import AlertKind
from app.schemas.alerts import (
    AlertRuleCreate,
    AlertRuleRead,
    AlertRuleUpdate,
    NotificationRead,
    NotificationSummary,
)
from app.schemas.common import Message

router = APIRouter(prefix="/devices/{device_id}", tags=["Uyarılar"])


# --------------------------------------------------------------------------- #
# Kurallar
# --------------------------------------------------------------------------- #


@router.get("/alert-rules", response_model=list[AlertRuleRead])
async def list_rules(device: OwnedDevice, db: DbSession) -> list[AlertRule]:
    result = await db.execute(
        select(AlertRule).where(AlertRule.device_id == device.id).order_by(AlertRule.created_at)
    )
    return list(result.scalars().all())


@router.post("/alert-rules", response_model=AlertRuleRead, status_code=status.HTTP_201_CREATED)
async def create_rule(
    payload: AlertRuleCreate, device: OwnedDevice, db: DbSession
) -> AlertRule:
    # Başka bir cihazın sensörüne kural bağlanmasını engelle
    if payload.kind is AlertKind.SENSOR_THRESHOLD and payload.sensor_id:
        sensor = await db.execute(
            select(Sensor.id).where(
                Sensor.id == payload.sensor_id, Sensor.device_id == device.id
            )
        )
        if sensor.scalar_one_or_none() is None:
            raise HTTPException(422, detail="Sensör bu cihaza ait değil")

    rule = AlertRule(device_id=device.id, **payload.model_dump())
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.patch("/alert-rules/{rule_id}", response_model=AlertRuleRead)
async def update_rule(
    rule_id: uuid.UUID, payload: AlertRuleUpdate, device: OwnedDevice, db: DbSession
) -> AlertRule:
    rule = await _get_rule(db, device.id, rule_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(rule, field, value)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/alert-rules/{rule_id}", response_model=Message)
async def delete_rule(rule_id: uuid.UUID, device: OwnedDevice, db: DbSession) -> Message:
    rule = await _get_rule(db, device.id, rule_id)
    await db.delete(rule)
    await db.commit()
    return Message(detail="Uyarı kuralı silindi")


async def _get_rule(db: DbSession, device_id: uuid.UUID, rule_id: uuid.UUID) -> AlertRule:
    result = await db.execute(
        select(AlertRule).where(AlertRule.id == rule_id, AlertRule.device_id == device_id)
    )
    rule = result.scalar_one_or_none()
    if rule is None:
        raise HTTPException(404, detail="Uyarı kuralı bulunamadı")
    return rule


# --------------------------------------------------------------------------- #
# Bildirimler
# --------------------------------------------------------------------------- #


@router.get("/notifications", response_model=NotificationSummary)
async def list_notifications(
    device: OwnedDevice,
    db: DbSession,
    limit: int = Query(default=30, ge=1, le=200),
    unread_only: bool = Query(default=False),
) -> NotificationSummary:
    conditions = [Notification.device_id == device.id]
    if unread_only:
        conditions.append(Notification.read_at.is_(None))

    unread = (
        await db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.device_id == device.id, Notification.read_at.is_(None))
        )
        or 0
    )

    result = await db.execute(
        select(Notification)
        .where(*conditions)
        .order_by(Notification.created_at.desc())
        .limit(limit)
    )
    return NotificationSummary(
        unread=unread,
        items=[NotificationRead.model_validate(row) for row in result.scalars().all()],
    )


@router.post("/notifications/read-all", response_model=Message)
async def mark_all_read(device: OwnedDevice, db: DbSession) -> Message:
    await db.execute(
        update(Notification)
        .where(Notification.device_id == device.id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(timezone.utc))
    )
    await db.commit()
    return Message(detail="Tüm bildirimler okundu olarak işaretlendi")


@router.post("/notifications/{notification_id}/read", response_model=NotificationRead)
async def mark_read(
    notification_id: int, device: OwnedDevice, db: DbSession
) -> Notification:
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id, Notification.device_id == device.id
        )
    )
    notification = result.scalar_one_or_none()
    if notification is None:
        raise HTTPException(404, detail="Bildirim bulunamadı")

    if notification.read_at is None:
        notification.read_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(notification)
    return notification
