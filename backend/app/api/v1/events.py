"""Takvim olayları — sulama zamanlayıcısı ve takvim modülü."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.api.deps import DbSession, OwnedDevice
from app.models import FarmEvent, Sequence
from app.models.enums import ExecutableType, TimeUnit
from app.schemas.automation import (
    CalendarOccurrence,
    FarmEventCreate,
    FarmEventRead,
    FarmEventUpdate,
)
from app.schemas.common import Message

router = APIRouter(prefix="/devices/{device_id}/events", tags=["Takvim"])

# Sonsuz döngüye karşı üst sınır — çok sık tekrarlı bir olay takvimi kilitlemesin
MAX_OCCURRENCES = 500


@router.get("", response_model=list[FarmEventRead])
async def list_events(
    device: OwnedDevice,
    db: DbSession,
    only_active: bool = Query(default=False),
) -> list[FarmEvent]:
    stmt = select(FarmEvent).where(FarmEvent.device_id == device.id)
    if only_active:
        stmt = stmt.where(FarmEvent.is_active.is_(True))
    result = await db.execute(stmt.order_by(FarmEvent.start_time))
    return list(result.scalars().all())


@router.post("", response_model=FarmEventRead, status_code=status.HTTP_201_CREATED)
async def create_event(
    payload: FarmEventCreate, device: OwnedDevice, db: DbSession
) -> FarmEvent:
    await _assert_executable_exists(db, device.id, payload.executable_type, payload.executable_id)

    event = FarmEvent(device_id=device.id, **payload.model_dump())
    event.next_run_at = _next_occurrence(event, after=datetime.now(timezone.utc))
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


@router.patch("/{event_id}", response_model=FarmEventRead)
async def update_event(
    event_id: uuid.UUID, payload: FarmEventUpdate, device: OwnedDevice, db: DbSession
) -> FarmEvent:
    event = await _get(db, device.id, event_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(event, field, value)
    event.next_run_at = _next_occurrence(event, after=datetime.now(timezone.utc))
    await db.commit()
    await db.refresh(event)
    return event


@router.delete("/{event_id}", response_model=Message)
async def delete_event(event_id: uuid.UUID, device: OwnedDevice, db: DbSession) -> Message:
    event = await _get(db, device.id, event_id)
    await db.delete(event)
    await db.commit()
    return Message(detail="Takvim olayı silindi")


@router.get("/calendar", response_model=list[CalendarOccurrence])
async def calendar(
    device: OwnedDevice,
    db: DbSession,
    start: datetime = Query(description="Aralık başlangıcı (ISO 8601)"),
    end: datetime = Query(description="Aralık bitişi (ISO 8601)"),
) -> list[CalendarOccurrence]:
    """Verilen tarih aralığındaki tüm çalışma anlarını genişleterek döndürür.

    Takvim görünümü tekrarlı olayları ayrı ayrı satır olarak gösterebilsin diye
    tekrar kuralı burada açılır.
    """
    if end <= start:
        raise HTTPException(422, detail="Bitiş tarihi başlangıçtan sonra olmalı")
    if (end - start) > timedelta(days=400):
        raise HTTPException(422, detail="Aralık en fazla 400 gün olabilir")

    result = await db.execute(
        select(FarmEvent).where(
            FarmEvent.device_id == device.id, FarmEvent.is_active.is_(True)
        )
    )

    occurrences: list[CalendarOccurrence] = []
    for event in result.scalars().all():
        for moment in _expand(event, start, end):
            occurrences.append(
                CalendarOccurrence(
                    event_id=event.id,
                    title=event.title or "Görev",
                    executable_type=event.executable_type,
                    executable_id=event.executable_id,
                    occurs_at=moment,
                )
            )

    occurrences.sort(key=lambda o: o.occurs_at)
    return occurrences


# --------------------------------------------------------------------------- #
# Tekrar kuralı hesabı
# --------------------------------------------------------------------------- #

_DELTAS: dict[TimeUnit, object] = {
    TimeUnit.MINUTELY: relativedelta(minutes=1),
    TimeUnit.HOURLY: relativedelta(hours=1),
    TimeUnit.DAILY: relativedelta(days=1),
    TimeUnit.WEEKLY: relativedelta(weeks=1),
    TimeUnit.MONTHLY: relativedelta(months=1),
    TimeUnit.YEARLY: relativedelta(years=1),
}


def _step(event: FarmEvent) -> relativedelta | None:
    """Olayın tekrar adımını döndürür; tekrarsızsa None."""
    if event.time_unit == TimeUnit.NEVER or event.repeat_every <= 0:
        return None
    base = _DELTAS.get(event.time_unit)
    if base is None:
        return None
    return base * event.repeat_every


def _expand(event: FarmEvent, window_start: datetime, window_end: datetime) -> list[datetime]:
    """Olayı verilen pencere içindeki çalışma anlarına açar."""
    current = event.start_time
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)

    step = _step(event)
    if step is None:
        return [current] if window_start <= current <= window_end else []

    limit = min(window_end, event.end_time) if event.end_time else window_end
    moments: list[datetime] = []

    while current <= limit and len(moments) < MAX_OCCURRENCES:
        if current >= window_start:
            moments.append(current)
        nxt = current + step
        if nxt <= current:  # hatalı yapılandırmaya karşı güvenlik
            break
        current = nxt

    return moments


def _next_occurrence(event: FarmEvent, after: datetime) -> datetime | None:
    """Verilen andan sonraki ilk çalışma zamanı."""
    current = event.start_time
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)

    if current >= after:
        return current

    step = _step(event)
    if step is None:
        return None  # tekrarsız ve zamanı geçmiş

    limit = event.end_time
    for _ in range(MAX_OCCURRENCES):
        current = current + step
        if limit and current > limit:
            return None
        if current >= after:
            return current
    return None


# --------------------------------------------------------------------------- #
# Yardımcılar
# --------------------------------------------------------------------------- #

async def _get(db: DbSession, device_id: uuid.UUID, event_id: uuid.UUID) -> FarmEvent:
    result = await db.execute(
        select(FarmEvent).where(FarmEvent.id == event_id, FarmEvent.device_id == device_id)
    )
    event = result.scalar_one_or_none()
    if event is None:
        raise HTTPException(404, detail="Takvim olayı bulunamadı")
    return event


async def _assert_executable_exists(
    db: DbSession,
    device_id: uuid.UUID,
    executable_type: ExecutableType,
    executable_id: uuid.UUID,
) -> None:
    """Takvime var olmayan bir diziyi bağlamayı engelle."""
    if executable_type != ExecutableType.SEQUENCE:
        return  # regimen doğrulaması regimen uç noktalarıyla birlikte gelecek
    result = await db.execute(
        select(Sequence.id).where(
            Sequence.id == executable_id, Sequence.device_id == device_id
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(422, detail="Belirtilen dizi bulunamadı")
