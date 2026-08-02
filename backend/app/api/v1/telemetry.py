"""Loglar ve kamera görüntüleri."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Query, status
from sqlalchemy import delete, func, select

from app.api.deps import DbSession, OwnedDevice
from app.models import Image, Log
from app.models.enums import LogLevel
from app.schemas.common import Message, Page
from app.schemas.telemetry import ImageCreate, ImageRead, LogCreate, LogRead

router = APIRouter(prefix="/devices/{device_id}", tags=["Kayıtlar & Görüntüler"])


# --------------------------------------------------------------------------- #
# Loglar
# --------------------------------------------------------------------------- #

@router.get("/logs", response_model=Page[LogRead])
async def list_logs(
    device: OwnedDevice,
    db: DbSession,
    level: LogLevel | None = Query(default=None, description="Seviye filtresi"),
    search: str | None = Query(default=None, description="Metin içinde ara"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> Page[LogRead]:
    conditions = [Log.device_id == device.id]
    if level is not None:
        conditions.append(Log.level == level)
    if search:
        conditions.append(Log.message.ilike(f"%{search}%"))

    total = await db.scalar(select(func.count()).select_from(Log).where(*conditions)) or 0

    result = await db.execute(
        select(Log)
        .where(*conditions)
        .order_by(Log.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return Page[LogRead](
        items=[LogRead.model_validate(row) for row in result.scalars().all()],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/logs", response_model=LogRead, status_code=status.HTTP_201_CREATED)
async def create_log(payload: LogCreate, device: OwnedDevice, db: DbSession) -> Log:
    log = Log(device_id=device.id, created_at=datetime.now(timezone.utc), **payload.model_dump())
    db.add(log)
    await db.commit()
    await db.refresh(log)
    return log


@router.delete("/logs", response_model=Message)
async def clear_logs(device: OwnedDevice, db: DbSession) -> Message:
    await db.execute(delete(Log).where(Log.device_id == device.id))
    await db.commit()
    return Message(detail="Kayıtlar temizlendi")


# --------------------------------------------------------------------------- #
# Görüntüler
# --------------------------------------------------------------------------- #

@router.get("/images", response_model=Page[ImageRead])
async def list_images(
    device: OwnedDevice,
    db: DbSession,
    limit: int = Query(default=48, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[ImageRead]:
    total = (
        await db.scalar(select(func.count()).select_from(Image).where(Image.device_id == device.id))
        or 0
    )
    result = await db.execute(
        select(Image)
        .where(Image.device_id == device.id)
        .order_by(Image.captured_at.desc().nullslast(), Image.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return Page[ImageRead](
        items=[ImageRead.model_validate(row) for row in result.scalars().all()],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/images", response_model=ImageRead, status_code=status.HTTP_201_CREATED)
async def create_image(payload: ImageCreate, device: OwnedDevice, db: DbSession) -> Image:
    """Robot fotoğrafı yükledikten sonra kaydı buraya bildirir."""
    image = Image(device_id=device.id, **payload.model_dump())
    if image.captured_at is None:
        image.captured_at = datetime.now(timezone.utc)
    db.add(image)
    await db.commit()
    await db.refresh(image)

    from app.services.realtime import hub

    await hub.broadcast(
        str(device.id),
        {"type": "image", "payload": {"id": str(image.id), "url": image.url}},
    )
    return image
