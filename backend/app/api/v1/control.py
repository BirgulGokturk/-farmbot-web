"""Manuel kontrol — jog pad, ev, pinler, sulama, acil durdurma.

Her uç nokta CeleryScript komutunu üretip MQTT köprüsüne verir.
Hareket içeren komutlar, acil durdurma kilidi açıkken reddedilir.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import DbSession, OwnedDevice, ensure_unlocked
from app.models import Point, Tool
from app.schemas.control import (
    CommandResponse,
    ExecuteSequenceRequest,
    HomeRequest,
    MoveAbsoluteRequest,
    MoveRelativeRequest,
    PinReadRequest,
    PinWriteRequest,
    RawCommandRequest,
    WaterPointRequest,
)
from app.services import commands
from app.services.mqtt import RpcError, RpcTimeoutError, bridge

router = APIRouter(prefix="/devices/{device_id}/control", tags=["Kontrol"])


async def _dispatch(
    device_id: uuid.UUID,
    body: list[dict],
    *,
    wait: bool = True,
    priority: int = commands.DEFAULT_PRIORITY,
) -> CommandResponse:
    """Komutu robota gönderir ve hataları anlaşılır HTTP yanıtlarına çevirir."""
    if not bridge.connected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Robot haberleşme sunucusuna (MQTT) bağlanılamıyor",
        )

    try:
        response = await bridge.send_rpc(
            str(device_id), body, priority=priority, wait_for_response=wait
        )
    except RpcTimeoutError as exc:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=str(exc)) from exc
    except RpcError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except ConnectionError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    return CommandResponse(
        ok=True,
        label=(response.get("args") or {}).get("label"),
        response=response,
    )


# --------------------------------------------------------------------------- #
# Hareket
# --------------------------------------------------------------------------- #

@router.post("/move-relative", response_model=CommandResponse)
async def move_relative(payload: MoveRelativeRequest, device: OwnedDevice) -> CommandResponse:
    """Jog pad butonları bunu çağırır."""
    ensure_unlocked(device)
    return await _dispatch(
        device.id,
        [commands.move_relative(payload.x, payload.y, payload.z, payload.speed)],
    )


@router.post("/move-absolute", response_model=CommandResponse)
async def move_absolute(payload: MoveAbsoluteRequest, device: OwnedDevice) -> CommandResponse:
    ensure_unlocked(device)
    _assert_reachable(device, payload.x, payload.y)
    return await _dispatch(
        device.id,
        [commands.move_absolute(payload.x, payload.y, payload.z, payload.speed)],
    )


@router.post("/home", response_model=CommandResponse)
async def go_home(payload: HomeRequest, device: OwnedDevice) -> CommandResponse:
    ensure_unlocked(device)
    step = (
        commands.find_home(payload.axis.value, payload.speed)
        if payload.find
        else commands.home(payload.axis.value, payload.speed)
    )
    # Ev arama uzun sürebilir; arayüzü bekletmeden gönder
    return await _dispatch(device.id, [step], wait=not payload.find)


@router.post("/calibrate", response_model=CommandResponse)
async def calibrate(payload: HomeRequest, device: OwnedDevice) -> CommandResponse:
    ensure_unlocked(device)
    return await _dispatch(device.id, [commands.calibrate(payload.axis.value)], wait=False)


@router.post("/set-zero", response_model=CommandResponse)
async def set_zero(payload: HomeRequest, device: OwnedDevice) -> CommandResponse:
    ensure_unlocked(device)
    return await _dispatch(device.id, [commands.set_zero(payload.axis.value)])


# --------------------------------------------------------------------------- #
# Pinler
# --------------------------------------------------------------------------- #

@router.post("/pin/write", response_model=CommandResponse)
async def write_pin(payload: PinWriteRequest, device: OwnedDevice) -> CommandResponse:
    """Pompa/vana/lamba aç-kapa. Kilit hareketi engeller ama pin yazmayı engellemez —
    acil durumda suyu kapatabilmek gerekir."""
    return await _dispatch(
        device.id, [commands.write_pin(payload.pin, payload.value, payload.mode)]
    )


@router.post("/pin/read", response_model=CommandResponse)
async def read_pin(payload: PinReadRequest, device: OwnedDevice) -> CommandResponse:
    return await _dispatch(device.id, [commands.read_pin(payload.pin, payload.mode)])


# --------------------------------------------------------------------------- #
# Sulama
# --------------------------------------------------------------------------- #

@router.post("/water", response_model=CommandResponse)
async def water_point(
    payload: WaterPointRequest, device: OwnedDevice, db: DbSession
) -> CommandResponse:
    """Belirtilen bitkiye gidip sular.

    Süre doğrudan `duration_ms` ile ya da `volume_ml` + sulama ucunun debisinden
    hesaplanarak belirlenir.
    """
    ensure_unlocked(device)

    result = await db.execute(
        select(Point).where(Point.id == payload.point_id, Point.device_id == device.id)
    )
    point = result.scalar_one_or_none()
    if point is None:
        raise HTTPException(404, detail="Bitki bulunamadı")

    duration_ms = payload.duration_ms
    if duration_ms is None:
        if payload.volume_ml is None:
            raise HTTPException(422, detail="duration_ms veya volume_ml verilmeli")
        duration_ms = await _duration_from_volume(db, device.id, payload.volume_ml)

    body = commands.water_at(
        x=point.x,
        y=point.y,
        z=device.soil_height_mm,
        duration_ms=duration_ms,
        pump_pin=payload.pump_pin,
        speed=payload.speed,
        safe_z=device.safe_height_mm,
    )
    # Sulama uzun sürer; yanıtı bekleme, ilerleme WebSocket'ten izlenir
    return await _dispatch(device.id, body, wait=False)


async def _duration_from_volume(db: DbSession, device_id: uuid.UUID, volume_ml: int) -> int:
    """Su hacmini, sulama ucunun debisine bakarak milisaniyeye çevirir."""
    result = await db.execute(
        select(Tool).where(Tool.device_id == device_id, Tool.flow_rate_ml_per_s.is_not(None))
    )
    tool = result.scalars().first()
    if tool is None or not tool.flow_rate_ml_per_s:
        raise HTTPException(
            422,
            detail="Debisi tanımlı bir sulama ucu yok. duration_ms gönderin veya alete debi ekleyin.",
        )
    return int(volume_ml / tool.flow_rate_ml_per_s * 1000)


# --------------------------------------------------------------------------- #
# Kamera ve sistem
# --------------------------------------------------------------------------- #

@router.post("/take-photo", response_model=CommandResponse)
async def take_photo(device: OwnedDevice) -> CommandResponse:
    return await _dispatch(device.id, [commands.take_photo()], wait=False)


@router.post("/emergency-lock", response_model=CommandResponse)
async def emergency_lock(device: OwnedDevice, db: DbSession) -> CommandResponse:
    """ACİL DURDURMA. En yüksek öncelikle gider ve yanıt beklenmez."""
    device.is_locked = True
    await db.commit()
    return await _dispatch(
        device.id,
        [commands.emergency_lock()],
        wait=False,
        priority=commands.EMERGENCY_PRIORITY,
    )


@router.post("/emergency-unlock", response_model=CommandResponse)
async def emergency_unlock(device: OwnedDevice, db: DbSession) -> CommandResponse:
    device.is_locked = False
    await db.commit()
    return await _dispatch(
        device.id,
        [commands.emergency_unlock()],
        wait=False,
        priority=commands.EMERGENCY_PRIORITY,
    )


@router.post("/reboot", response_model=CommandResponse)
async def reboot(device: OwnedDevice) -> CommandResponse:
    return await _dispatch(device.id, [commands.reboot()], wait=False)


@router.post("/execute", response_model=CommandResponse)
async def execute_sequence(
    payload: ExecuteSequenceRequest, device: OwnedDevice
) -> CommandResponse:
    ensure_unlocked(device)
    return await _dispatch(
        device.id, [commands.execute_sequence(payload.sequence_id)], wait=False
    )


@router.post("/raw", response_model=CommandResponse)
async def raw_command(payload: RawCommandRequest, device: OwnedDevice) -> CommandResponse:
    """Dizi editöründe "şimdi çalıştır" önizlemesi için ham CeleryScript."""
    ensure_unlocked(device)
    return await _dispatch(device.id, payload.body, wait=payload.wait_for_response)


def _assert_reachable(device, x: float, y: float) -> None:
    if not (0 <= x <= device.bed_width_mm) or not (0 <= y <= device.bed_length_mm):
        raise HTTPException(
            422,
            detail=(
                f"Hedef çalışma alanı dışında "
                f"(X: 0–{device.bed_width_mm}, Y: 0–{device.bed_length_mm} mm)"
            ),
        )
