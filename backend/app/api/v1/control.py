"""Manuel kontrol — jog pad, ev, pinler, sulama, acil durdurma.

Her uç nokta CeleryScript komutunu üretip robot geçidine verir; geçit komutu
gerçek robota (MQTT) ya da simülatöre yönlendirir.
Hareket içeren komutlar, acil durdurma kilidi açıkken reddedilir.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import DbSession, OwnedDevice, ensure_unlocked
from app.models import Device, Point, Sensor, Tool
from app.schemas.control import (
    CommandResponse,
    ExecuteSequenceRequest,
    HomeRequest,
    MoveAbsoluteRequest,
    MoveRelativeRequest,
    PinReadRequest,
    PinWriteRequest,
    RawCommandRequest,
    SurveyRequest,
    WaterPointRequest,
)
from app.services import commands, gateway
from app.services.mqtt import RpcError, RpcTimeoutError

router = APIRouter(prefix="/devices/{device_id}/control", tags=["Kontrol"])


async def _dispatch(
    device: Device,
    body: list[dict],
    *,
    wait: bool = True,
    priority: int = commands.DEFAULT_PRIORITY,
) -> CommandResponse:
    """Komutu robot geçidine verir ve hataları anlaşılır HTTP yanıtlarına çevirir.

    Geçit, gerçek robot (MQTT) ile sanal robot (simülatör) arasında seçim yapar;
    bu katmanın hangisinin çalıştığını bilmesi gerekmez.
    """
    try:
        response = await gateway.send(device, body, wait=wait, priority=priority)
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
        device,
        [commands.move_relative(payload.x, payload.y, payload.z, payload.speed)],
    )


@router.post("/move-absolute", response_model=CommandResponse)
async def move_absolute(payload: MoveAbsoluteRequest, device: OwnedDevice) -> CommandResponse:
    ensure_unlocked(device)
    _assert_reachable(device, payload.x, payload.y)
    return await _dispatch(
        device,
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
    return await _dispatch(device, [step], wait=not payload.find)


@router.post("/calibrate", response_model=CommandResponse)
async def calibrate(payload: HomeRequest, device: OwnedDevice) -> CommandResponse:
    ensure_unlocked(device)
    return await _dispatch(device, [commands.calibrate(payload.axis.value)], wait=False)


@router.post("/set-zero", response_model=CommandResponse)
async def set_zero(payload: HomeRequest, device: OwnedDevice) -> CommandResponse:
    ensure_unlocked(device)
    return await _dispatch(device, [commands.set_zero(payload.axis.value)])


# --------------------------------------------------------------------------- #
# Pinler
# --------------------------------------------------------------------------- #

@router.post("/pin/write", response_model=CommandResponse)
async def write_pin(payload: PinWriteRequest, device: OwnedDevice) -> CommandResponse:
    """Pompa/vana/lamba aç-kapa. Kilit hareketi engeller ama pin yazmayı engellemez —
    acil durumda suyu kapatabilmek gerekir."""
    return await _dispatch(
        device, [commands.write_pin(payload.pin, payload.value, payload.mode)]
    )


@router.post("/pin/read", response_model=CommandResponse)
async def read_pin(payload: PinReadRequest, device: OwnedDevice) -> CommandResponse:
    return await _dispatch(device, [commands.read_pin(payload.pin, payload.mode)])


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
    return await _dispatch(device, body, wait=False)


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
    return await _dispatch(device, [commands.take_photo()], wait=False)


@router.post("/emergency-lock", response_model=CommandResponse)
async def emergency_lock(device: OwnedDevice, db: DbSession) -> CommandResponse:
    """ACİL DURDURMA. En yüksek öncelikle gider ve yanıt beklenmez."""
    device.is_locked = True
    await db.commit()
    return await _dispatch(
        device,
        [commands.emergency_lock()],
        wait=False,
        priority=commands.EMERGENCY_PRIORITY,
    )


@router.post("/emergency-unlock", response_model=CommandResponse)
async def emergency_unlock(device: OwnedDevice, db: DbSession) -> CommandResponse:
    device.is_locked = False
    await db.commit()
    return await _dispatch(
        device,
        [commands.emergency_unlock()],
        wait=False,
        priority=commands.EMERGENCY_PRIORITY,
    )


@router.post("/reboot", response_model=CommandResponse)
async def reboot(device: OwnedDevice) -> CommandResponse:
    return await _dispatch(device, [commands.reboot()], wait=False)


@router.post("/execute", response_model=CommandResponse)
async def execute_sequence(
    payload: ExecuteSequenceRequest, device: OwnedDevice
) -> CommandResponse:
    ensure_unlocked(device)
    return await _dispatch(
        device, [commands.execute_sequence(payload.sequence_id)], wait=False
    )


@router.post("/survey", response_model=CommandResponse)
async def survey(
    payload: SurveyRequest, device: OwnedDevice, db: DbSession
) -> CommandResponse:
    """Ölçüm turu: robotu ızgara üzerinde gezdirip her durakta sensörü okur.

    Isı haritasının anlamlı olabilmesi için bahçenin farklı noktalarından
    ölçüm gerekir; bu uç nokta o veriyi tek komutla toplar.
    """
    ensure_unlocked(device)

    result = await db.execute(
        select(Sensor).where(Sensor.id == payload.sensor_id, Sensor.device_id == device.id)
    )
    sensor = result.scalar_one_or_none()
    if sensor is None:
        raise HTTPException(404, detail="Sensör bulunamadı")

    # Kenarlardan biraz içeriden başla: robot sınıra dayanmasın
    margin = 200
    usable_x = max(0, device.bed_width_mm - margin * 2)
    usable_y = max(0, device.bed_length_mm - margin * 2)

    body: list[dict] = []
    for row in range(payload.rows):
        y = margin + (usable_y * row / max(1, payload.rows - 1))
        # Yılan (boustrophedon) deseni: her sırada yön değişir, yol kısalır
        columns = range(payload.columns) if row % 2 == 0 else reversed(range(payload.columns))
        for column in columns:
            x = margin + (usable_x * column / max(1, payload.columns - 1))
            body.append(commands.move_absolute(round(x), round(y), device.safe_height_mm, payload.speed))
            body.append(commands.read_pin(sensor.pin, sensor.mode, sensor.label))

    stops = payload.rows * payload.columns
    response = await _dispatch(device, body, wait=False)
    response.detail = f"{stops} noktada ölçüm turu başlatıldı"
    return response


@router.post("/raw", response_model=CommandResponse)
async def raw_command(payload: RawCommandRequest, device: OwnedDevice) -> CommandResponse:
    """Dizi editöründe "şimdi çalıştır" önizlemesi için ham CeleryScript."""
    ensure_unlocked(device)
    return await _dispatch(device, payload.body, wait=payload.wait_for_response)


def _assert_reachable(device, x: float, y: float) -> None:
    if not (0 <= x <= device.bed_width_mm) or not (0 <= y <= device.bed_length_mm):
        raise HTTPException(
            422,
            detail=(
                f"Hedef çalışma alanı dışında "
                f"(X: 0–{device.bed_width_mm}, Y: 0–{device.bed_length_mm} mm)"
            ),
        )
