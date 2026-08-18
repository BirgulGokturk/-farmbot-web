"""Cihaz (robot) yönetimi."""

from __future__ import annotations

from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, OwnedDevice
from app.models import Device
from app.schemas.common import Message
from app.schemas.device import DeviceCreate, DeviceRead, DeviceStatusRead, DeviceUpdate
from app.api.v1.agent import push_machine_config
from app.services import gateway, machine_config
from app.services.realtime import hub

router = APIRouter(prefix="/devices", tags=["Cihazlar"])


@router.get("", response_model=list[DeviceRead])
async def list_devices(user: CurrentUser, db: DbSession) -> list[Device]:
    result = await db.execute(
        select(Device).where(Device.user_id == user.id).order_by(Device.created_at)
    )
    return list(result.scalars().all())


@router.post("", response_model=DeviceRead, status_code=status.HTTP_201_CREATED)
async def create_device(payload: DeviceCreate, user: CurrentUser, db: DbSession) -> Device:
    device = Device(user_id=user.id, **payload.model_dump())
    db.add(device)
    await db.commit()
    await db.refresh(device)
    return device


@router.get("/{device_id}", response_model=DeviceRead)
async def get_device(device: OwnedDevice) -> Device:
    return device


@router.patch("/{device_id}", response_model=DeviceRead)
async def update_device(
    payload: DeviceUpdate, device: OwnedDevice, db: DbSession
) -> Device:
    # exclude_unset: gönderilmeyen alanlar mevcut değerini korur
    changes = payload.model_dump(exclude_unset=True)

    # `settings` serbest bir JSON sütunu; kalibrasyon da içinde. Arayüzden gelen
    # değeri olduğu gibi yazmıyoruz: ölçek 0 ya da NaN gelirse her hareket
    # bozulurdu. Normalleştirme eksik alanları varsayılanla tamamlar, saçma
    # değerleri geri çevirir, bilinmeyen anahtarları korur.
    if "settings" in changes:
        changes["settings"] = machine_config.normalize(changes["settings"])

    for field, value in changes.items():
        setattr(device, field, value)
    await db.commit()
    await db.refresh(device)

    # Kalibrasyon değiştiyse bağlı ajan bunu hemen bilmeli; aksi hâlde yeni
    # ölçek ancak ajan yeniden başlatılınca devreye girerdi.
    if "settings" in changes:
        await push_machine_config(device)

    return device


@router.delete("/{device_id}", response_model=Message)
async def delete_device(device: OwnedDevice, db: DbSession) -> Message:
    await db.delete(device)
    await db.commit()
    return Message(detail="Cihaz silindi")


@router.get("/{device_id}/status", response_model=DeviceStatusRead)
async def device_status(device: OwnedDevice) -> DeviceStatusRead:
    """Robotun bellekteki canlı durumu.

    Sürekli izleme için WebSocket (`/api/v1/ws/devices/{id}`) tercih edilmelidir;
    bu uç nokta ilk yükleme ve WebSocket desteklemeyen istemciler içindir.
    """
    # Simülatör modundaysa cihazın sanal robotu ilk sorguda ayağa kalksın
    await gateway.ensure_started(device)

    state = hub.state(str(device.id))

    # Henüz robottan durum gelmediyse veritabanındaki son bilinen değerleri kullan
    if state.last_seen_at is None:
        state.position = {"x": device.last_x, "y": device.last_y, "z": device.last_z}
        state.locked = device.is_locked
        state.last_seen_at = device.last_seen_at
        state.online = device.is_online

    return DeviceStatusRead.model_validate(state.to_dict())


@router.post("/{device_id}/sync", response_model=Message)
async def request_sync(device: OwnedDevice) -> Message:
    """Robottan durum ağacını yeniden yayınlamasını iste."""
    from app.services import commands

    try:
        await gateway.send(device, [commands.read_status()], wait=False)
    except ConnectionError as exc:
        return Message(detail=str(exc))
    return Message(detail="Durum isteği gönderildi")
