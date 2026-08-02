"""Komut dizileri (sequences)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import DbSession, OwnedDevice
from app.models import Sequence
from app.schemas.automation import SequenceCreate, SequenceRead, SequenceUpdate
from app.schemas.common import Message

router = APIRouter(prefix="/devices/{device_id}/sequences", tags=["Diziler"])


@router.get("", response_model=list[SequenceRead])
async def list_sequences(device: OwnedDevice, db: DbSession) -> list[Sequence]:
    result = await db.execute(
        select(Sequence)
        .where(Sequence.device_id == device.id)
        # Sabitlenmiş diziler önce gelsin
        .order_by(Sequence.pinned.desc(), Sequence.name)
    )
    return list(result.scalars().all())


@router.post("", response_model=SequenceRead, status_code=status.HTTP_201_CREATED)
async def create_sequence(
    payload: SequenceCreate, device: OwnedDevice, db: DbSession
) -> Sequence:
    sequence = Sequence(device_id=device.id, **payload.model_dump())
    db.add(sequence)
    await db.commit()
    await db.refresh(sequence)
    return sequence


@router.get("/{sequence_id}", response_model=SequenceRead)
async def get_sequence(
    sequence_id: uuid.UUID, device: OwnedDevice, db: DbSession
) -> Sequence:
    return await _get(db, device.id, sequence_id)


@router.patch("/{sequence_id}", response_model=SequenceRead)
async def update_sequence(
    sequence_id: uuid.UUID, payload: SequenceUpdate, device: OwnedDevice, db: DbSession
) -> Sequence:
    sequence = await _get(db, device.id, sequence_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(sequence, field, value)
    await db.commit()
    await db.refresh(sequence)
    return sequence


@router.delete("/{sequence_id}", response_model=Message)
async def delete_sequence(
    sequence_id: uuid.UUID, device: OwnedDevice, db: DbSession
) -> Message:
    sequence = await _get(db, device.id, sequence_id)
    await db.delete(sequence)
    await db.commit()
    return Message(detail="Dizi silindi")


async def _get(db: DbSession, device_id: uuid.UUID, sequence_id: uuid.UUID) -> Sequence:
    result = await db.execute(
        select(Sequence).where(Sequence.id == sequence_id, Sequence.device_id == device_id)
    )
    sequence = result.scalar_one_or_none()
    if sequence is None:
        raise HTTPException(404, detail="Dizi bulunamadı")
    return sequence
