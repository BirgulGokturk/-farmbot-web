"""Bahçedeki noktalar — Tarla Tasarımcısı'nın veri kaynağı."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.api.deps import DbSession, OwnedDevice
from app.db.base import utcnow
from app.models import PlantSpecies, Point
from app.models.enums import PointType
from app.schemas.common import Message
from app.schemas.garden import PointBulkMove, PointCreate, PointRead, PointUpdate

router = APIRouter(prefix="/devices/{device_id}/points", tags=["Bahçe"])


@router.get("", response_model=list[PointRead])
async def list_points(
    device: OwnedDevice,
    db: DbSession,
    point_type: PointType | None = Query(default=None, description="Tür filtresi"),
    include_discarded: bool = Query(default=False, description="Silinmişleri de getir"),
) -> list[Point]:
    stmt = select(Point).where(Point.device_id == device.id)
    if point_type is not None:
        stmt = stmt.where(Point.point_type == point_type)
    if not include_discarded:
        stmt = stmt.where(Point.discarded_at.is_(None))

    result = await db.execute(stmt.order_by(Point.created_at))
    return list(result.scalars().all())


@router.post("", response_model=PointRead, status_code=status.HTTP_201_CREATED)
async def create_point(payload: PointCreate, device: OwnedDevice, db: DbSession) -> Point:
    """Tasarımcıda bir bitki/işaretçi bırakıldığında çağrılır."""
    _assert_in_bounds(device, payload.x, payload.y)

    data = payload.model_dump()

    # Yarıçap verilmediyse türün yayılma değerinden türet
    if data.get("species_id") and data.get("radius_mm") == 25.0:
        species = await db.get(PlantSpecies, data["species_id"])
        if species is not None:
            data["radius_mm"] = species.spread_mm / 2

    point = Point(device_id=device.id, **data)
    db.add(point)
    await db.commit()
    await db.refresh(point)
    return point


@router.patch("/{point_id}", response_model=PointRead)
async def update_point(
    point_id: uuid.UUID, payload: PointUpdate, device: OwnedDevice, db: DbSession
) -> Point:
    point = await _get_point(db, device.id, point_id)

    updates = payload.model_dump(exclude_unset=True)
    if "x" in updates or "y" in updates:
        _assert_in_bounds(device, updates.get("x", point.x), updates.get("y", point.y))

    for field, value in updates.items():
        setattr(point, field, value)

    await db.commit()
    await db.refresh(point)
    return point


@router.post("/bulk-move", response_model=list[PointRead])
async def bulk_move(payload: PointBulkMove, device: OwnedDevice, db: DbSession) -> list[Point]:
    """Tasarımcıda çoklu seçim sürüklendiğinde tek istekte kaydeder."""
    ids = [move.id for move in payload.moves]
    result = await db.execute(
        select(Point).where(Point.device_id == device.id, Point.id.in_(ids))
    )
    by_id = {point.id: point for point in result.scalars().all()}

    missing = [str(i) for i in ids if i not in by_id]
    if missing:
        raise HTTPException(404, detail=f"Nokta bulunamadı: {', '.join(missing)}")

    for move in payload.moves:
        _assert_in_bounds(device, move.x, move.y)
        point = by_id[move.id]
        point.x = move.x
        point.y = move.y
        if move.z is not None:
            point.z = move.z

    await db.commit()
    return [by_id[move.id] for move in payload.moves]


@router.delete("/{point_id}", response_model=Message)
async def delete_point(
    point_id: uuid.UUID,
    device: OwnedDevice,
    db: DbSession,
    permanent: bool = Query(default=False, description="Kalıcı sil"),
) -> Message:
    """Varsayılan olarak yumuşak silme yapar — kayıt bir süre geri alınabilir kalır."""
    point = await _get_point(db, device.id, point_id)

    if permanent:
        await db.delete(point)
        await db.commit()
        return Message(detail="Nokta kalıcı olarak silindi")

    point.discarded_at = utcnow()
    await db.commit()
    return Message(detail="Nokta silindi (geri alınabilir)")


@router.post("/{point_id}/restore", response_model=PointRead)
async def restore_point(point_id: uuid.UUID, device: OwnedDevice, db: DbSession) -> Point:
    point = await _get_point(db, device.id, point_id)
    point.discarded_at = None
    await db.commit()
    await db.refresh(point)
    return point


# --------------------------------------------------------------------------- #
# Yardımcılar
# --------------------------------------------------------------------------- #

async def _get_point(db: DbSession, device_id: uuid.UUID, point_id: uuid.UUID) -> Point:
    result = await db.execute(
        select(Point).where(Point.id == point_id, Point.device_id == device_id)
    )
    point = result.scalar_one_or_none()
    if point is None:
        raise HTTPException(status_code=404, detail="Nokta bulunamadı")
    return point


def _assert_in_bounds(device, x: float, y: float) -> None:
    """Robotun ulaşamayacağı bir yere bitki koymayı baştan engelle."""
    if not (0 <= x <= device.bed_width_mm):
        raise HTTPException(
            422, detail=f"X koordinatı 0–{device.bed_width_mm} mm aralığında olmalı"
        )
    if not (0 <= y <= device.bed_length_mm):
        raise HTTPException(
            422, detail=f"Y koordinatı 0–{device.bed_length_mm} mm aralığında olmalı"
        )
