"""Robot geçidi — komutların nereye gideceğine karar veren tek nokta.

API katmanı robotun gerçek mi sanal mı olduğunu bilmez; sadece `gateway.send()`
çağırır. Böylece donanım değiştiğinde arayüzde tek satır değişmez.

Öncelik sırası:
  1. Raspberry Pi köprü ajanı bağlıysa → gerçek donanım (Arduino)
  2. MQTT etkin ve broker'a bağlıysa   → FarmBot OS çalıştıran kart
  3. Simülatör etkinse                 → sanal robot
  4. Hiçbiri yoksa                     → 503

Ajan MQTT'nin önünde: kullanıcının elindeki kurulum Arduino + Pi olduğu için
gerçek donanım bağlıyken komutların oraya gitmesi beklenen davranış.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from app.core.config import settings
from app.services import commands
from app.services.agents import agent_hub
from app.services.mqtt import bridge
from app.services.simulator import simulator


class Transport(str, Enum):
    AGENT = "agent"
    MQTT = "mqtt"
    SIMULATOR = "simulator"
    NONE = "none"


def transport_for(device_id: str | None = None) -> Transport:
    """Belirli bir cihaz için etkin taşıyıcı.

    Ajan bağlantısı cihaza özeldir; MQTT ve simülatör genel ayarlara bakar.
    """
    if device_id and agent_hub.is_connected(device_id):
        return Transport.AGENT
    if settings.MQTT_ENABLED and bridge.connected:
        return Transport.MQTT
    if settings.SIMULATOR_ENABLED:
        return Transport.SIMULATOR
    return Transport.NONE


def active_transport() -> Transport:
    """Sistem genelinde etkin taşıyıcı — /health için özet bilgi."""
    if agent_hub.connected_count:
        return Transport.AGENT
    return transport_for(None)


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
    device_id = str(device.id)
    transport = transport_for(device_id)

    if transport is Transport.AGENT:
        return await agent_hub.send_command(device_id, body, wait=wait)

    if transport is Transport.MQTT:
        return await bridge.send_rpc(device_id, body, priority=priority, wait_for_response=wait)

    if transport is Transport.SIMULATOR:
        robot = await simulator.robot_for(device)
        await robot.submit(body)
        # Sanal robot komutu sıraya alır; arayüz ilerlemeyi WebSocket'ten izler
        return {"kind": "rpc_ok", "args": {"label": "simulator"}}

    raise ConnectionError(
        "Robota ulaşılamıyor. Köprü ajanı bağlı değil, MQTT kapalı ve simülatör devre dışı."
    )


async def ensure_started(device: Any) -> None:
    """Simülatör modundaysa cihazın sanal robotunu ayağa kaldırır.

    Gerçek donanım (ajan veya MQTT) bağlıyken simülatör başlatılmaz — iki
    kaynağın aynı cihaza veri yazması karışıklık yaratır.
    """
    if transport_for(str(device.id)) is Transport.SIMULATOR:
        await simulator.robot_for(device)
