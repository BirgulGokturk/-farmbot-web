"""MQTT köprüsü — backend ile robot arasındaki tek iletişim kanalı.

Sorumlulukları:
  * Broker'a kalıcı bağlantı kurmak, kopunca üstel geri çekilmeyle yeniden bağlanmak
  * Robotların durum/log/telemetri yayınlarını dinleyip normalize etmek
  * RPC komutlarını yayınlamak ve yanıtı `label` üzerinden eşleştirmek
  * Gelen her şeyi WebSocket üzerinden tarayıcıya iletmek

Bkz. docs/MQTT.md
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

import aiomqtt

from app.core.config import settings
from app.services import commands
from app.services.realtime import hub

logger = logging.getLogger(__name__)

TOPIC_ROOT = "bot"


def device_topic(device_id: str, channel: str) -> str:
    return f"{TOPIC_ROOT}/device_{device_id}/{channel}"


class RpcTimeoutError(Exception):
    """Robot komuta zamanında yanıt vermedi."""


class RpcError(Exception):
    """Robot komutu reddetti veya uygularken hata verdi."""


class MqttBridge:
    def __init__(self) -> None:
        self._client: aiomqtt.Client | None = None
        self._task: asyncio.Task[None] | None = None
        self._stopping = asyncio.Event()
        # label -> komutun yanıtını bekleyen Future
        self._pending: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self.connected: bool = False

    # ------------------------------------------------------------------ #
    # Yaşam döngüsü
    # ------------------------------------------------------------------ #

    async def start(self) -> None:
        if not settings.MQTT_ENABLED:
            logger.warning("MQTT devre dışı (MQTT_ENABLED=false) — robot komutları gönderilmeyecek")
            return
        self._stopping.clear()
        self._task = asyncio.create_task(self._run(), name="mqtt-bridge")

    async def stop(self) -> None:
        self._stopping.set()
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        self.connected = False

    async def _run(self) -> None:
        """Bağlantıyı ayakta tutan sonsuz döngü — koparsa geri çekilerek yeniden dener."""
        backoff = 1.0
        while not self._stopping.is_set():
            try:
                async with aiomqtt.Client(
                    hostname=settings.MQTT_HOST,
                    port=settings.MQTT_PORT,
                    username=settings.MQTT_USERNAME,
                    password=settings.MQTT_PASSWORD,
                    identifier=f"{settings.MQTT_CLIENT_ID}-{uuid.uuid4().hex[:8]}",
                    keepalive=settings.MQTT_KEEPALIVE,
                    tls_params=aiomqtt.TLSParameters() if settings.MQTT_TLS else None,
                ) as client:
                    self._client = client
                    self.connected = True
                    backoff = 1.0
                    logger.info("MQTT bağlandı: %s:%s", settings.MQTT_HOST, settings.MQTT_PORT)

                    # Tüm cihazların yayınlarını dinle
                    for channel in ("status", "logs", "from_device", "telemetry"):
                        await client.subscribe(f"{TOPIC_ROOT}/+/{channel}", qos=1)

                    async for message in client.messages:
                        try:
                            await self._handle(message)
                        except Exception:
                            logger.exception("MQTT mesajı işlenemedi: %s", message.topic)

            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.connected = False
                self._client = None
                if self._stopping.is_set():
                    return
                logger.warning("MQTT bağlantısı koptu (%s) — %.0f sn sonra yeniden denenecek", exc, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)  # üstel geri çekilme, üst sınır 30 sn

    # ------------------------------------------------------------------ #
    # Gelen mesajlar
    # ------------------------------------------------------------------ #

    async def _handle(self, message: aiomqtt.Message) -> None:
        topic = str(message.topic)
        parts = topic.split("/")
        # bot/device_<id>/<channel>
        if len(parts) < 3 or not parts[1].startswith("device_"):
            return

        device_id = parts[1].removeprefix("device_")
        channel = parts[2]

        try:
            payload = json.loads(message.payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            logger.debug("JSON olmayan MQTT yükü yok sayıldı: %s", topic)
            return

        if channel == "status":
            await self._on_status(device_id, payload)
        elif channel == "logs":
            await self._on_log(device_id, payload)
        elif channel == "from_device":
            await self._on_rpc_response(device_id, payload)
        elif channel == "telemetry":
            await hub.broadcast(device_id, {"type": "telemetry", "payload": payload})

    async def _on_status(self, device_id: str, payload: dict[str, Any]) -> None:
        state = hub.state(device_id)
        state.apply_status_tree(payload)
        await hub.broadcast_status(device_id)
        await self._persist_device_snapshot(device_id, state)

    async def _on_log(self, device_id: str, payload: dict[str, Any]) -> None:
        from app.db.session import SessionLocal
        from app.models import Log, LogLevel

        message_text = str(payload.get("message", ""))
        raw_level = str(payload.get("type", "info")).lower()
        level = LogLevel(raw_level) if raw_level in LogLevel._value2member_map_ else LogLevel.INFO

        entry = {
            "message": message_text,
            "level": level.value,
            "channels": payload.get("channels") or [],
            "x": payload.get("x"),
            "y": payload.get("y"),
            "z": payload.get("z"),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await hub.broadcast(device_id, {"type": "log", "payload": entry})

        try:
            async with SessionLocal() as session:
                session.add(
                    Log(
                        device_id=uuid.UUID(device_id),
                        message=message_text,
                        level=level,
                        channels=payload.get("channels") or [],
                        x=payload.get("x"),
                        y=payload.get("y"),
                        z=payload.get("z"),
                        created_at=datetime.now(timezone.utc),
                    )
                )
                await session.commit()
        except ValueError:
            # Cihaz kimliği UUID değil (ör. yerel test cihazı) — sadece yayınla, saklama
            pass
        except Exception:
            logger.exception("Log kaydedilemedi")

    async def _on_rpc_response(self, device_id: str, payload: dict[str, Any]) -> None:
        """rpc_ok / rpc_error yanıtını bekleyen Future'a bağla."""
        label = (payload.get("args") or {}).get("label")
        kind = payload.get("kind")

        await hub.broadcast(device_id, {"type": "rpc", "payload": payload})

        if not label:
            return
        future = self._pending.pop(label, None)
        if future is None or future.done():
            return

        if kind == "rpc_ok":
            future.set_result(payload)
        elif kind == "rpc_error":
            explanations = [
                (item.get("args") or {}).get("message", "")
                for item in payload.get("body") or []
            ]
            future.set_exception(RpcError("; ".join(filter(None, explanations)) or "Robot komutu reddetti"))

    async def _persist_device_snapshot(self, device_id: str, state: Any) -> None:
        """Son konum ve kilit durumunu veritabanına yaz (sunucu yeniden başlarsa kaybolmasın)."""
        from sqlalchemy import update

        from app.db.session import SessionLocal
        from app.models import Device

        try:
            device_uuid = uuid.UUID(device_id)
        except ValueError:
            return

        try:
            async with SessionLocal() as session:
                await session.execute(
                    update(Device)
                    .where(Device.id == device_uuid)
                    .values(
                        last_seen_at=state.last_seen_at,
                        is_locked=state.locked,
                        last_x=state.position["x"],
                        last_y=state.position["y"],
                        last_z=state.position["z"],
                    )
                )
                await session.commit()
        except Exception:
            logger.exception("Cihaz durumu kaydedilemedi")

    # ------------------------------------------------------------------ #
    # Giden mesajlar
    # ------------------------------------------------------------------ #

    async def publish(self, topic: str, payload: dict[str, Any], qos: int = 1) -> None:
        if self._client is None or not self.connected:
            raise ConnectionError("MQTT broker'a bağlı değil")
        await self._client.publish(topic, json.dumps(payload), qos=qos)

    async def send_rpc(
        self,
        device_id: str,
        body: list[dict[str, Any]],
        priority: int = commands.DEFAULT_PRIORITY,
        wait_for_response: bool = True,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        """RPC komutunu gönderir ve istenirse robotun yanıtını bekler.

        Yanıt beklenmezse komut "ateşle ve unut" olarak gönderilir; uzun süren
        hareketlerde arayüzü bloklamamak için kullanışlıdır.
        """
        label = str(uuid.uuid4())
        request = commands.rpc_request(body, label=label, priority=priority)

        future: asyncio.Future[dict[str, Any]] | None = None
        if wait_for_response:
            future = asyncio.get_running_loop().create_future()
            self._pending[label] = future

        try:
            await self.publish(device_topic(device_id, "from_clients"), request)
        except Exception:
            self._pending.pop(label, None)
            raise

        if future is None:
            return {"kind": "rpc_sent", "args": {"label": label}}

        try:
            return await asyncio.wait_for(future, timeout or settings.RPC_TIMEOUT_SECONDS)
        except asyncio.TimeoutError as exc:
            self._pending.pop(label, None)
            raise RpcTimeoutError(
                f"Robot {timeout or settings.RPC_TIMEOUT_SECONDS:.0f} saniyede yanıt vermedi"
            ) from exc

    async def ping(self, device_id: str) -> float | None:
        """Gidiş-dönüş gecikmesini ölçer (saniye). Yanıt yoksa None."""
        if self._client is None or not self.connected:
            return None
        token = uuid.uuid4().hex
        started = asyncio.get_running_loop().time()
        await self.publish(device_topic(device_id, f"ping/{token}"), {"ts": started}, qos=0)
        # Not: pong aboneliği ayrı bir akışta ele alınır; şimdilik ölçüm yaklaşık.
        return asyncio.get_running_loop().time() - started


# Uygulama genelinde tek örnek
bridge = MqttBridge()
