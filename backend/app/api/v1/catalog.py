"""Bitki kütüphanesi, aletler ve büyüme eğrileri."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import or_, select

from app.api.deps import CurrentUser, DbSession, OwnedDevice
from app.models import Curve, PlantSpecies, Tool
from app.schemas.common import Message
from app.schemas.garden import (
    CurveCreate,
    CurveRead,
    PlantSpeciesCreate,
    PlantSpeciesRead,
    ToolCreate,
    ToolRead,
)

router = APIRouter(tags=["Katalog"])


# --------------------------------------------------------------------------- #
# Bitki türleri (küresel katalog)
# --------------------------------------------------------------------------- #

@router.get("/plant-species", response_model=list[PlantSpeciesRead])
async def list_species(
    db: DbSession,
    search: str | None = Query(default=None, description="Ada göre ara"),
) -> list[PlantSpecies]:
    stmt = select(PlantSpecies)
    if search:
        pattern = f"%{search.lower()}%"
        stmt = stmt.where(
            or_(
                PlantSpecies.name_tr.ilike(pattern),
                PlantSpecies.name_en.ilike(pattern),
                PlantSpecies.slug.ilike(pattern),
            )
        )
    result = await db.execute(stmt.order_by(PlantSpecies.name_tr))
    return list(result.scalars().all())


@router.post(
    "/plant-species", response_model=PlantSpeciesRead, status_code=status.HTTP_201_CREATED
)
async def create_species(
    payload: PlantSpeciesCreate, user: CurrentUser, db: DbSession
) -> PlantSpecies:
    existing = await db.execute(select(PlantSpecies).where(PlantSpecies.slug == payload.slug))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(409, detail="Bu kısa ad (slug) zaten kullanılıyor")

    species = PlantSpecies(**payload.model_dump())
    db.add(species)
    await db.commit()
    await db.refresh(species)
    return species


# --------------------------------------------------------------------------- #
# Aletler (cihaza özel)
# --------------------------------------------------------------------------- #

@router.get("/devices/{device_id}/tools", response_model=list[ToolRead])
async def list_tools(device: OwnedDevice, db: DbSession) -> list[Tool]:
    result = await db.execute(
        select(Tool).where(Tool.device_id == device.id).order_by(Tool.name)
    )
    return list(result.scalars().all())


@router.post(
    "/devices/{device_id}/tools", response_model=ToolRead, status_code=status.HTTP_201_CREATED
)
async def create_tool(payload: ToolCreate, device: OwnedDevice, db: DbSession) -> Tool:
    tool = Tool(device_id=device.id, **payload.model_dump())
    db.add(tool)
    await db.commit()
    await db.refresh(tool)
    return tool


@router.delete("/devices/{device_id}/tools/{tool_id}", response_model=Message)
async def delete_tool(tool_id: uuid.UUID, device: OwnedDevice, db: DbSession) -> Message:
    result = await db.execute(
        select(Tool).where(Tool.id == tool_id, Tool.device_id == device.id)
    )
    tool = result.scalar_one_or_none()
    if tool is None:
        raise HTTPException(404, detail="Alet bulunamadı")
    await db.delete(tool)
    await db.commit()
    return Message(detail="Alet silindi")


# --------------------------------------------------------------------------- #
# Büyüme eğrileri
# --------------------------------------------------------------------------- #

@router.get("/devices/{device_id}/curves", response_model=list[CurveRead])
async def list_curves(device: OwnedDevice, db: DbSession) -> list[Curve]:
    result = await db.execute(
        select(Curve).where(Curve.device_id == device.id).order_by(Curve.name)
    )
    return list(result.scalars().all())


@router.post(
    "/devices/{device_id}/curves", response_model=CurveRead, status_code=status.HTTP_201_CREATED
)
async def create_curve(payload: CurveCreate, device: OwnedDevice, db: DbSession) -> Curve:
    curve = Curve(device_id=device.id, **payload.model_dump())
    db.add(curve)
    await db.commit()
    await db.refresh(curve)
    return curve
