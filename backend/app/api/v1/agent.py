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
from time import monotonic

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from sqlalchemy import delete as sa_delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DbSession, OwnedDevice
from app.core.security import hash_password, verify_password
from app.db.session import SessionLocal, get_db
from app.core.config import settings
from app.models import Device, Image, Sensor, SensorReading
from app.schemas.agent import (
    AgentIngestRequest,
    AgentIngestResult,
    AgentPhotoResult,
    AgentTokenResponse,
    AgentStatusRead,
)
from app.api.v1.telemetry import PHOTO_RETENTION
from app.services import machine_config
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
    return await authenticate_agent(db, (x_device_token or "").strip() or None)


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
                source="agent",
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


async def push_machine_config(device: Device) -> bool:
    """Kalibrasyon değişince bağlı ajana anında bildirir.

    Ajan yeniden başlatılmadan yeni ölçek/kaydırma değerleriyle çalışsın diye:
    kullanıcı ayarlar sayfasında ölçüm sihirbazını bitirdiğinde bir sonraki
    hareket zaten düzeltilmiş olmalı. Ajan bağlı değilse sessizce geçilir —
    bağlanınca zaten ilk mesaj olarak yapılandırmayı alıyor.
    """
    machine = machine_config.normalize(device.settings)
    return await agent_hub.send_to(
        str(device.id),
        {"type": "config", "payload": _agent_config(device, machine)},
    )


def _agent_config(device: Device, machine: dict) -> dict:
    """Ajanın hareket etmeden önce bilmesi gereken her şey.

    Tek yerde üretiliyor: hem bağlantı anında hem ayar değişince gönderiliyor
    ve ikisinin farklı davranması, "panelde değiştirdim ama robot eskisini
    kullanıyor" gibi bulunması zor bir hataya yol açardı.
    """
    return {
        "axes": machine["axes"],
        "limits_enabled": machine["limits_enabled"],
        # Güvenli geçiş yüksekliği cihaz kaydından geliyor (tek doğruluk
        # kaynağı; sulama da onu kullanıyor). Koruma kapalıysa hiç
        # gönderilmiyor: ajan tarafında "kapalı" tek bir durumla (None) temsil
        # edilsin, iki ayrı bayrak karşılaştırmak gerekmesin.
        "travel": {
            "enabled": machine["travel"]["enabled"],
            "safe_z_mm": (
                float(device.safe_height_mm) if machine["travel"]["enabled"] else None
            ),
        },
    }


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
# Fotoğraf yükleme
# --------------------------------------------------------------------------- #

# Tek karenin üst sınırı. Bahçe kamerasının 640×480 JPEG'i ~50 KB; 4 MB, yanlış
# yapılandırılmış bir çözünürlüğün veritabanını doldurmasını engelliyor.
MAX_PHOTO_BYTES = 4 * 1024 * 1024


@router.post("/agent/photo", response_model=AgentPhotoResult)
async def upload_photo(
    db: DbSession,
    file: UploadFile = File(..., description="JPEG/PNG kare"),
    x: float | None = Form(default=None),
    y: float | None = Form(default=None),
    z: float | None = Form(default=None),
    device: Device = Depends(current_agent_device),
) -> AgentPhotoResult:
    """Ajanın çektiği kareyi kaydeder.

    Kare veritabanında saklanıyor; sebebi `Image.data` alanının yanındaki notta:
    Render'ın ücretsiz katmanında kalıcı disk yok, diske yazılan her şey ilk
    yeniden başlatmada kayboluyor.
    """
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Boş dosya")
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"Kare çok büyük ({len(data) // 1024} KB); üst sınır "
            f"{MAX_PHOTO_BYTES // 1024} KB. Kamera çözünürlüğünü düşürün.",
        )

    now = datetime.now(timezone.utc)
    image = Image(
        device_id=device.id,
        url="",  # kaydedildikten sonra kendi kimliğiyle dolduruluyor
        x=x if x is not None else device.last_x,
        y=y if y is not None else device.last_y,
        z=z if z is not None else device.last_z,
        captured_at=now,
        data=data,
        content_type=file.content_type or "image/jpeg",
        meta={"bytes": len(data), "filename": file.filename or ""},
    )
    db.add(image)
    await db.flush()

    image.url = f"{settings.API_V1_PREFIX}/devices/{device.id}/images/{image.id}/file"

    # Eski kareleri at: görüntüler veritabanında duruyor, sınırsız büyüyemez.
    old = (
        await db.execute(
            select(Image.id)
            .where(Image.device_id == device.id)
            .order_by(Image.captured_at.desc().nullslast(), Image.created_at.desc())
            .offset(PHOTO_RETENTION)
        )
    ).scalars().all()
    if old:
        await db.execute(sa_delete(Image).where(Image.id.in_(old)))

    device.agent_last_seen_at = now
    device.last_seen_at = now
    await db.commit()

    await hub.broadcast(
        str(device.id),
        {"type": "image", "payload": {"id": str(image.id), "url": image.url}},
    )
    return AgentPhotoResult(id=image.id, url=image.url, bytes=len(data), discarded=len(old))


# --------------------------------------------------------------------------- #
# Komut kanalı
# --------------------------------------------------------------------------- #


@router.websocket("/agent/ws")
async def agent_socket(websocket: WebSocket, token: str | None = None) -> None:
    """Ajanın komut kanalı.

    Token önce `X-Device-Token` başlığında aranıyor, bulunamazsa adres
    satırındaki `?token=` kullanılıyor. Başlık tercih ediliyor çünkü adresler
    ara sunucu ve barındırıcı kayıtlarına düz metin yazılıyor — kimlik bilgisi
    oraya sızmamalı. Adres satırı yalnızca güncellenmemiş ajanlar bağlantısız
    kalmasın diye kabul edilmeye devam ediyor.
    """
    """Ajanın komutları dinlediği kanal.

    Token sorgu dizesinden alınır: tarayıcı dışı istemcilerde de basit olsun ve
    WebSocket el sıkışmasında özel başlık gerekmesin.
    """
    # Görünmez karakterlere karşı kırpıyoruz: systemd birimi bir kez CRLF ile
    # kaydedilirse token'ın sonuna satır sonu yapışıyor ve tek belirtisi
    # anlaşılmaz bir 403 oluyor.
    sunulan = (websocket.headers.get("X-Device-Token") or token or "").strip()

    async with SessionLocal() as session:
        try:
            device = await authenticate_agent(session, sunulan)
        except HTTPException:
            await websocket.close(code=4401, reason="Gecersiz cihaz token'i")
            return

        device_id = str(device.id)
        now = datetime.now(timezone.utc)
        device.agent_last_seen_at = now
        # Bağlantı anında da çevrimiçi sayılsın; ilk durum mesajını beklemeden
        device.last_seen_at = now
        machine = machine_config.normalize(device.settings)
        # Yapılandırma **oturum kapanmadan** hazırlanıyor: `commit()` ORM
        # alanlarını geçersizleştiriyor ve oturum dışında okumak
        # DetachedInstanceError veriyor — her ajan bağlantısını kırardı.
        agent_config = _agent_config(device, machine)
        await session.commit()

    _last_touch[device_id] = monotonic()

    await agent_hub.connect(device_id, websocket)
    logger.info("Köprü ajanı bağlandı: %s", device_id)

    # Simülatör varsa sussun — gerçek donanım devrede
    from app.services.simulator import simulator

    await simulator.stop_device(device_id)

    # Kalibrasyon ajanın elinde olmalı: hareket komutu Gantry Studio'ya
    # gitmeden önce eksen ölçeği/kaydırması ajanda uygulanıyor. Bağlantının
    # ilk mesajı bu olsun ki ajan hiçbir zaman kalibrasyonsuz komut çalıştırmasın.
    await websocket.send_json(
        {
            "type": "config",
            "payload": agent_config,
        }
    )

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


# Ajandan mesaj geldikçe `last_seen_at` tazeleniyor, ama her mesajda değil:
# hareket sırasında saniyede iki durum mesajı geliyor ve her biri için veritabanı
# yazmak anlamsız. 20 saniye, 60 saniyelik çevrimdışı eşiğinin rahat altında.
_TOUCH_INTERVAL_SECONDS = 20.0
_last_touch: dict[str, float] = {}


async def _touch_device(device_id: str) -> None:
    """Ajan hayattayken cihazı çevrimiçi tutar.

    Bu olmadan cihaz yalnızca sensör ölçümü aktıkça çevrimiçi görünüyordu:
    Arduino çıkarıldığında ya da yalnızca PLC bağlıyken panel, ajan bağlı
    olmasına rağmen 60 saniye sonra "Çevrimdışı" gösteriyordu.
    """
    now = monotonic()
    if now - _last_touch.get(device_id, 0.0) < _TOUCH_INTERVAL_SECONDS:
        return
    _last_touch[device_id] = now

    stamp = datetime.now(timezone.utc)
    async with SessionLocal() as session:
        await session.execute(
            update(Device)
            .where(Device.id == uuid.UUID(device_id))
            .values(last_seen_at=stamp, agent_last_seen_at=stamp)
        )
        await session.commit()


async def _handle_agent_message(device_id: str, message: dict) -> None:
    """Ajandan gelen mesajları işler (komut yanıtı, log, durum)."""
    kind = message.get("type")

    # Hangi tür olursa olsun: mesaj geldiyse ajan ayakta demektir
    await _touch_device(device_id)

    if kind == "rpc_result":
        agent_hub.resolve(message.get("label"), message.get("payload") or {})

    elif kind == "status":
        state = hub.state(device_id)
        state.apply_status_tree(message.get("payload") or {})
        await hub.broadcast_status(device_id)

    elif kind == "log":
        await hub.broadcast(device_id, {"type": "log", "payload": message.get("payload") or {}})

    elif kind == "pong":
        # Canlılık sinyali; `_touch_device` zaten çalıştı
        pass


# Ajan bağlantısını canlı tutmak için düzenli ping — bazı vekil sunucular
# 60 saniye sessiz kalan WebSocket'i kapatır.
async def ping_agents_forever() -> None:
    while True:
        await asyncio.sleep(30)
        await agent_hub.ping_all()
