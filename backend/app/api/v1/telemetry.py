"""Loglar ve kamera görüntüleri."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, Response, status
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


@router.delete("/images/{image_id}", response_model=Message)
async def delete_image(
    image_id: uuid.UUID, device: OwnedDevice, db: DbSession
) -> Message:
    """Tek bir kareyi siler.

    Cihaz kontrolü sorguya gömülü: başka bir kullanıcının cihazına ait bir
    kimlik gönderilse bile hiçbir satır eşleşmiyor ve 404 dönüyor.
    """
    result = await db.execute(
        delete(Image).where(Image.id == image_id, Image.device_id == device.id)
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Fotoğraf bulunamadı")
    await db.commit()
    return Message(detail="Fotoğraf silindi")


@router.delete("/images", response_model=Message)
async def clear_images(device: OwnedDevice, db: DbSession) -> Message:
    """Cihazın tüm karelerini siler."""
    result = await db.execute(delete(Image).where(Image.device_id == device.id))
    await db.commit()
    return Message(detail=f"{result.rowcount} fotoğraf silindi")


# --------------------------------------------------------------------------- #
# Fotoğraf dosyası
# --------------------------------------------------------------------------- #

# Cihaz başına saklanan kare sayısı. Görüntüler veritabanında durduğu için
# sınırsız büyümemeli; 120 kare ~6 MB ve birkaç günlük geçmişe yetiyor.
PHOTO_RETENTION = 120


@router.get("/images/{image_id}/file")
async def image_file(image_id: uuid.UUID, device: OwnedDevice, db: DbSession) -> Response:
    """Karenin kendisini döndürür.

    Görüntü baytları `deferred` olduğu için burada açıkça yükleniyor; liste
    sorguları onları taşımıyor.
    """
    image = await db.get(Image, image_id)
    if image is None or image.device_id != device.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fotoğraf bulunamadı")

    data = await db.scalar(select(Image.data).where(Image.id == image_id))
    if not data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bu kaydın görüntü verisi yok")

    return Response(
        content=data,
        media_type=image.content_type or "image/jpeg",
        # Kare bir daha değişmiyor; tarayıcı galeriyi her açışta yeniden indirmesin
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
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
