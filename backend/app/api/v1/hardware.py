"""Çevre birimleri, sensörler ve telemetri okumaları."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.api.deps import DbSession, OwnedDevice
from app.models import Peripheral, Sensor, SensorReading
from app.schemas.common import Message
from app.schemas.hardware import (
    PeripheralCreate,
    PeripheralRead,
    SensorCreate,
    SensorRead,
    SensorReadingCreate,
    SensorReadingRead,
    SensorSeries,
    SensorSeriesPoint,
)

router = APIRouter(prefix="/devices/{device_id}", tags=["Donanım"])


# --------------------------------------------------------------------------- #
# Çevre birimleri (çıkış pinleri)
# --------------------------------------------------------------------------- #

@router.get("/peripherals", response_model=list[PeripheralRead])
async def list_peripherals(device: OwnedDevice, db: DbSession) -> list[Peripheral]:
    result = await db.execute(
        select(Peripheral).where(Peripheral.device_id == device.id).order_by(Peripheral.pin)
    )
    return list(result.scalars().all())


@router.post("/peripherals", response_model=PeripheralRead, status_code=status.HTTP_201_CREATED)
async def create_peripheral(
    payload: PeripheralCreate, device: OwnedDevice, db: DbSession
) -> Peripheral:
    peripheral = Peripheral(device_id=device.id, **payload.model_dump())
    db.add(peripheral)
    await db.commit()
    await db.refresh(peripheral)
    return peripheral


@router.delete("/peripherals/{peripheral_id}", response_model=Message)
async def delete_peripheral(
    peripheral_id: uuid.UUID, device: OwnedDevice, db: DbSession
) -> Message:
    result = await db.execute(
        select(Peripheral).where(
            Peripheral.id == peripheral_id, Peripheral.device_id == device.id
        )
    )
    peripheral = result.scalar_one_or_none()
    if peripheral is None:
        raise HTTPException(404, detail="Çevre birimi bulunamadı")
    await db.delete(peripheral)
    await db.commit()
    return Message(detail="Çevre birimi silindi")


# --------------------------------------------------------------------------- #
# Sensörler (giriş pinleri)
# --------------------------------------------------------------------------- #

@router.get("/sensors", response_model=list[SensorRead])
async def list_sensors(device: OwnedDevice, db: DbSession) -> list[Sensor]:
    result = await db.execute(
        select(Sensor).where(Sensor.device_id == device.id).order_by(Sensor.pin)
    )
    return list(result.scalars().all())


@router.post("/sensors", response_model=SensorRead, status_code=status.HTTP_201_CREATED)
async def create_sensor(
    payload: SensorCreate, device: OwnedDevice, db: DbSession
) -> Sensor:
    sensor = Sensor(device_id=device.id, **payload.model_dump())
    db.add(sensor)
    await db.commit()
    await db.refresh(sensor)
    return sensor


@router.delete("/sensors/{sensor_id}", response_model=Message)
async def delete_sensor(sensor_id: uuid.UUID, device: OwnedDevice, db: DbSession) -> Message:
    sensor = await _get_sensor(db, device.id, sensor_id)
    await db.delete(sensor)
    await db.commit()
    return Message(detail="Sensör silindi")


# --------------------------------------------------------------------------- #
# Okumalar
# --------------------------------------------------------------------------- #

@router.post(
    "/readings", response_model=SensorReadingRead, status_code=status.HTTP_201_CREATED
)
async def create_reading(
    payload: SensorReadingCreate, device: OwnedDevice, db: DbSession
) -> SensorReading:
    """Robot veya bir Farmware yeni ölçüm gönderdiğinde çağrılır."""
    reading = SensorReading(
        device_id=device.id,
        **payload.model_dump(exclude={"read_at"}),
        read_at=payload.read_at or datetime.now(timezone.utc),
    )
    db.add(reading)
    await db.commit()
    await db.refresh(reading)

    # Grafikler anında güncellensin
    from app.services.realtime import hub

    await hub.broadcast(
        str(device.id),
        {
            "type": "reading",
            "payload": {
                "sensor_id": str(reading.sensor_id) if reading.sensor_id else None,
                "value": reading.value,
                "read_at": reading.read_at.isoformat(),
            },
        },
    )
    return reading


@router.get("/sensors/{sensor_id}/series", response_model=SensorSeries)
async def sensor_series(
    sensor_id: uuid.UUID,
    device: OwnedDevice,
    db: DbSession,
    hours: int = Query(default=24, ge=1, le=24 * 90, description="Kaç saat geriye"),
    limit: int = Query(default=500, ge=10, le=5000),
) -> SensorSeries:
    """Bir sensörün geçmiş verisi — grafik çizimi için."""
    sensor = await _get_sensor(db, device.id, sensor_id)
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    result = await db.execute(
        select(SensorReading)
        .where(
            SensorReading.device_id == device.id,
            SensorReading.sensor_id == sensor_id,
            SensorReading.read_at >= since,
        )
        .order_by(SensorReading.read_at.desc())
        .limit(limit)
    )
    rows = list(result.scalars().all())
    rows.reverse()  # grafikte zaman soldan sağa aksın

    return SensorSeries(
        sensor_id=sensor.id,
        label=sensor.label,
        unit=sensor.unit,
        points=[SensorSeriesPoint(t=row.read_at, v=row.value) for row in rows],
    )


@router.get("/readings/latest", response_model=list[SensorReadingRead])
async def latest_readings(device: OwnedDevice, db: DbSession) -> list[SensorReading]:
    """Her sensörün en son okuması — Kontrol Merkezi kartları için."""
    sensors = await db.execute(select(Sensor.id).where(Sensor.device_id == device.id))
    latest: list[SensorReading] = []

    for (sensor_id,) in sensors.all():
        row = await db.execute(
            select(SensorReading)
            .where(SensorReading.sensor_id == sensor_id)
            .order_by(SensorReading.read_at.desc())
            .limit(1)
        )
        reading = row.scalar_one_or_none()
        if reading is not None:
            latest.append(reading)

    return latest


async def _get_sensor(db: DbSession, device_id: uuid.UUID, sensor_id: uuid.UUID) -> Sensor:
    result = await db.execute(
        select(Sensor).where(Sensor.id == sensor_id, Sensor.device_id == device_id)
    )
    sensor = result.scalar_one_or_none()
    if sensor is None:
        raise HTTPException(404, detail="Sensör bulunamadı")
    return sensor
