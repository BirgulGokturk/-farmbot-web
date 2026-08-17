"""Raspberry Pi köprü ajanı uç noktaları.

Ajan, tarayıcı gibi kullanıcı oturumu taşımaz; cihaza özel bir **token** ile
kimliğini kanıtlar (`X-Device-Token` başlığı). Token yalnızca üretildiği anda
düz metin gösterilir; veritabanında bcrypt hash'i saklanır.

İki yön vardır:
  * `POST /agent/readings` — Arduino'dan gelen ölçümler buluta yazılır
  * `WS   /agent/ws`       — bulut, robot komutlarını ajana iletir
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DbSession, OwnedDevice
from app.core.security import hash_password, verify_password
from app.db.session import SessionLocal, get_db
from app.models import Device, Sensor, SensorReading
from app.schemas.agent import (
    AgentIngestRequest,
    AgentIngestResult,
    AgentTokenResponse,
    AgentStatusRead,
)
from app.services.agents import agent_hub
from app.services.realtime import hub

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Köprü Ajanı"])

# Token biçimi: fbt_<cihaz kısaltması>_<rastgele>. Ön ek, sızan bir dizenin
# ne olduğunu anlamayı ve gerekirse taramayı kolaylaştırır.
TOKEN_PREFIX = "fbt"


# --------------------------------------------------------------------------- #
# Token yönetimi (kullanıcı oturumu gerektirir)
# --------------------------------------------------------------------------- #


@router.post(
    "/devices/{device_id}/agent-token",
    response_model=AgentTokenResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_agent_token(device: OwnedDevice, db: DbSession) -> AgentTokenResponse:
    """Yeni bir ajan token'ı üretir. Önceki token geçersiz olur."""
    raw = f"{TOKEN_PREFIX}_{str(device.id)[:8]}_{secrets.token_urlsafe(32)}"

    device.agent_token_hash = hash_password(raw)
    device.agent_token_created_at = datetime.now(timezone.utc)
    await db.commit()

    return AgentTokenResponse(
        token=raw,
        created_at=device.agent_token_created_at,
        note="Bu token yalnızca şimdi gösterilir. Kaybederseniz yenisini üretin.",
    )


@router.delete("/devices/{device_id}/agent-token", response_model=AgentStatusRead)
async def revoke_agent_token(device: OwnedDevice, db: DbSession) -> AgentStatusRead:
    """Token'ı iptal eder; bağlı ajan varsa bağlantısı kesilir."""
    device.agent_token_hash = None
    device.agent_token_created_at = None
    await db.commit()
    await agent_hub.disconnect_device(str(device.id))
    return _status_of(device)


@router.get("/devices/{device_id}/agent-status", response_model=AgentStatusRead)
async def agent_status(device: OwnedDevice) -> AgentStatusRead:
    return _status_of(device)


def _status_of(device: Device) -> AgentStatusRead:
    return AgentStatusRead(
        has_token=device.agent_token_hash is not None,
        token_created_at=device.agent_token_created_at,
        connected=agent_hub.is_connected(str(device.id)),
        last_seen_at=device.agent_last_seen_at,
    )


# --------------------------------------------------------------------------- #
# Token ile kimlik doğrulama
# --------------------------------------------------------------------------- #


async def authenticate_agent(
    db: AsyncSession,
    token: str | None,
) -> Device:
    """Token'ı doğrular ve ilgili cihazı döndürür.

    Token içinde cihaz kimliğinin ilk 8 karakteri bulunduğu için tüm cihazları
    tek tek denemek gerekmez; doğrudan aday cihazlar süzülür.
    """
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Geçersiz cihaz token'ı"
    )
    if not token or not token.startswith(f"{TOKEN_PREFIX}_"):
        raise unauthorized

    parts = token.split("_", 2)
    if len(parts) != 3:
        raise unauthorized
    prefix_id = parts[1]

    result = await db.execute(select(Device).where(Device.agent_token_hash.is_not(None)))
    for device in result.scalars().all():
        if not str(device.id).startswith(prefix_id):
            continue
        if verify_password(token, device.agent_token_hash or ""):
            return device

    raise unauthorized


async def current_agent_device(
    db: AsyncSession = Depends(get_db),
    x_device_token: str | None = Header(default=None, alias="X-Device-Token"),
) -> Device:
    return await authenticate_agent(db, x_device_token)


# --------------------------------------------------------------------------- #
# Ölçüm gönderimi
# --------------------------------------------------------------------------- #


@router.post("/agent/readings", response_model=AgentIngestResult)
async def ingest_readings(
    payload: AgentIngestRequest,
    db: DbSession,
    device: Device = Depends(current_agent_device),
) -> AgentIngestResult:
    """Arduino'dan gelen ölçüm paketini kaydeder.

    Ölçümler **kanal adıyla** eşleştirilir. Tanımlı olmayan bir kanal gelirse
    sessizce yok saymak yerine sensör kaydı otomatik oluşturulur; böylece yeni
    bir sensör takıldığında panelde elle tanımlama gerekmez.
    """
    device_id = device.id

    sensors = {
        sensor.channel: sensor
        for sensor in (
            await db.execute(select(Sensor).where(Sensor.device_id == device_id))
        ).scalars().all()
        if sensor.channel
    }

    now = datetime.now(timezone.utc)
    stored = 0
    created_channels: list[str] = []

    for item in payload.readings:
        sensor = sensors.get(item.channel)
        if sensor is None:
            sensor = _auto_create_sensor(device_id, item.channel)
            db.add(sensor)
            await db.flush()
            sensors[item.channel] = sensor
            created_channels.append(item.channel)

        db.add(
            SensorReading(
                device_id=device_id,
                sensor_id=sensor.id,
                pin=sensor.pin,
                value=item.value,
                x=item.x if item.x is not None else device.last_x,
                y=item.y if item.y is not None else device.last_y,
                z=item.z if item.z is not None else device.last_z,
                read_at=item.read_at or now,
            )
        )
        stored += 1

        await hub.broadcast(
            str(device_id),
            {
                "type": "reading",
                "payload": {
                    "sensor_id": str(sensor.id),
                    "value": item.value,
                    "read_at": (item.read_at or now).isoformat(),
                },
            },
        )

    device.agent_last_seen_at = now
    # Ajan bağlıysa cihaz çevrimiçi sayılır; panelin bağlantı göstergesi bunu kullanır
    device.last_seen_at = now
    await db.commit()

    # Eşik kuralları yeni veriye göre değerlendirilsin; hata ölçümü geçersiz kılmasın
    import contextlib

    from app.services.alerts import evaluate_device_alerts

    with contextlib.suppress(Exception):
        await evaluate_device_alerts(device_id)

    if created_channels:
        logger.info("Yeni sensör kanalları otomatik tanımlandı: %s", created_channels)

    return AgentIngestResult(stored=stored, created_channels=created_channels)


def _auto_create_sensor(device_id: uuid.UUID, channel: str) -> Sensor:
    """Bilinmeyen bir kanal için makul varsayılanlarla sensör kaydı üretir."""
    from app.services.channels import describe_channel

    spec = describe_channel(channel)
    return Sensor(
        device_id=device_id,
        channel=channel,
        label=spec.label,
        kind=spec.kind,
        unit=spec.unit,
        icon=spec.icon,
        min_value=spec.min_value,
        max_value=spec.max_value,
        pin=None,
    )


# --------------------------------------------------------------------------- #
# Komut kanalı
# --------------------------------------------------------------------------- #


@router.websocket("/agent/ws")
async def agent_socket(websocket: WebSocket, token: str | None = None) -> None:
    """Ajanın komutları dinlediği kanal.

    Token sorgu dizesinden alınır: tarayıcı dışı istemcilerde de basit olsun ve
    WebSocket el sıkışmasında özel başlık gerekmesin.
    """
    async with SessionLocal() as session:
        try:
            device = await authenticate_agent(session, token)
        except HTTPException:
            await websocket.close(code=4401, reason="Gecersiz cihaz token'i")
            return

        device_id = str(device.id)
        device.agent_last_seen_at = datetime.now(timezone.utc)
        await session.commit()

    await agent_hub.connect(device_id, websocket)
    logger.info("Köprü ajanı bağlandı: %s", device_id)

    # Simülatör varsa sussun — gerçek donanım devrede
    from app.services.simulator import simulator

    await simulator.stop_device(device_id)

    await hub.broadcast(device_id, {"type": "agent", "payload": {"connected": True}})

    try:
        while True:
            message = await websocket.receive_json()
            await _handle_agent_message(device_id, message)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Ajan bağlantısında hata: %s", device_id)
    finally:
        await agent_hub.disconnect(device_id, websocket)
        await hub.broadcast(device_id, {"type": "agent", "payload": {"connected": False}})
        logger.info("Köprü ajanı ayrıldı: %s", device_id)


async def _handle_agent_message(device_id: str, message: dict) -> None:
    """Ajandan gelen mesajları işler (komut yanıtı, log, durum)."""
    kind = message.get("type")

    if kind == "rpc_result":
        agent_hub.resolve(message.get("label"), message.get("payload") or {})

    elif kind == "status":
        state = hub.state(device_id)
        state.apply_status_tree(message.get("payload") or {})
        await hub.broadcast_status(device_id)

    elif kind == "log":
        await hub.broadcast(device_id, {"type": "log", "payload": message.get("payload") or {}})

    elif kind == "pong":
        # Canlılık sinyali; ek iş gerekmiyor
        pass


# Ajan bağlantısını canlı tutmak için düzenli ping — bazı vekil sunucular
# 60 saniye sessiz kalan WebSocket'i kapatır.
async def ping_agents_forever() -> None:
    while True:
        await asyncio.sleep(30)
        await agent_hub.ping_all()
