"""Robot geçidi — komutların nereye gideceğine karar veren tek nokta.

API katmanı robotun gerçek mi sanal mı olduğunu bilmez; sadece `gateway.send()`
çağırır. Böylece donanım hazır olduğunda arayüzde tek satır değişmeden
MQTT'ye geçilir.

Öncelik sırası:
  1. MQTT etkin ve broker'a bağlıysa → gerçek robot
  2. Simülatör etkinse → sanal robot
  3. Hiçbiri yoksa → 503 (robota ulaşılamıyor)
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from app.core.config import settings
from app.services import commands
from app.services.mqtt import bridge
from app.services.simulator import simulator


class Transport(str, Enum):
    MQTT = "mqtt"
    SIMULATOR = "simulator"
    NONE = "none"


def active_transport() -> Transport:
    if settings.MQTT_ENABLED and bridge.connected:
        return Transport.MQTT
    if settings.SIMULATOR_ENABLED:
        return Transport.SIMULATOR
    return Transport.NONE


async def send(
    device: Any,
    body: list[dict[str, Any]],
    *,
    wait: bool = True,
    priority: int = commands.DEFAULT_PRIORITY,
) -> dict[str, Any]:
    """Komutu etkin taşıyıcıya iletir.

    Bağlantı yoksa `ConnectionError` yükseltir; API katmanı bunu 503'e çevirir.
    """
    transport = active_transport()

    if transport is Transport.MQTT:
        return await bridge.send_rpc(
            str(device.id), body, priority=priority, wait_for_response=wait
        )

    if transport is Transport.SIMULATOR:
        robot = await simulator.robot_for(device)
        await robot.submit(body)
        # Sanal robot komutu sıraya alır; arayüz ilerlemeyi WebSocket'ten izler
        return {"kind": "rpc_ok", "args": {"label": "simulator"}}

    raise ConnectionError(
        "Robota ulaşılamıyor. MQTT bağlantısı yok ve simülatör kapalı."
    )


async def ensure_started(device: Any) -> None:
    """Simülatör modundaysa cihazın sanal robotunu ayağa kaldırır.

    Kullanıcı paneli açtığında robot hemen "çevrimiçi" görünsün diye
    cihaz durumu sorgulanırken çağrılır.
    """
    if active_transport() is Transport.SIMULATOR:
        await simulator.robot_for(device)
