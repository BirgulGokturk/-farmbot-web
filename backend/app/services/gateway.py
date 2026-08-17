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


def transport_for(device_id: str | None = None, *, paired: bool = False) -> Transport:
    """Belirli bir cihaz için etkin taşıyıcı.

    `paired`: cihaza gerçek donanım eşleştirilmiş mi (ajan token'ı üretilmiş mi).
    Eşleştirilmiş bir cihazda ajan o an bağlı değilse simülatöre **düşmeyiz** —
    aksi hâlde sanal veri gerçek ölçümlerin arasına karışır ve grafik, donanım
    kopmuşken bile hareket etmeye devam eder.
    """
    if device_id and agent_hub.is_connected(device_id):
        return Transport.AGENT
    if settings.MQTT_ENABLED and bridge.connected:
        return Transport.MQTT
    if settings.SIMULATOR_ENABLED and not paired:
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
    paired = _is_paired(device)
    transport = transport_for(device_id, paired=paired)

    if transport is Transport.AGENT:
        return await agent_hub.send_command(device_id, body, wait=wait)

    if transport is Transport.MQTT:
        return await bridge.send_rpc(device_id, body, priority=priority, wait_for_response=wait)

    if transport is Transport.SIMULATOR:
        robot = await simulator.robot_for(device)
        await robot.submit(body)
        # Sanal robot komutu sıraya alır; arayüz ilerlemeyi WebSocket'ten izler
        return {"kind": "rpc_ok", "args": {"label": "simulator"}}

    if paired:
        raise ConnectionError(
            "Köprü ajanı bağlı değil. Raspberry Pi'nin açık ve internete bağlı "
            "olduğunu kontrol edin (systemctl status farmbot-agent)."
        )
    raise ConnectionError(
        "Robota ulaşılamıyor. Köprü ajanı bağlı değil, MQTT kapalı ve simülatör devre dışı."
    )


async def ensure_started(device: Any) -> None:
    """Simülatör modundaysa cihazın sanal robotunu ayağa kaldırır.

    Gerçek donanım eşleştirilmiş bir cihazda simülatör hiç başlatılmaz; ajan
    geçici olarak kopsa bile sanal veri üretilmez.
    """
    if transport_for(str(device.id), paired=_is_paired(device)) is Transport.SIMULATOR:
        await simulator.robot_for(device)


def _is_paired(device: Any) -> bool:
    """Cihaza gerçek donanım eşleştirilmiş mi? (ajan token'ı üretilmişse evet)"""
    return getattr(device, "agent_token_hash", None) is not None
