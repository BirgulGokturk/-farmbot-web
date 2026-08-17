"""Bağlı köprü ajanlarının kaydı ve komut yönlendirmesi.

`RealtimeHub` tarayıcılara **yayın** yapar; burası ise cihaz başına **tek**
bir ajan bağlantısı tutar ve ona komut gönderip yanıtını bekler. İki farklı
sorumluluk olduğu için ayrı sınıflar.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SECONDS = 20.0


class AgentTimeoutError(Exception):
    """Ajan komuta zamanında yanıt vermedi."""


class AgentError(Exception):
    """Ajan komutu uygulayamadı."""


class AgentHub:
    def __init__(self) -> None:
        self._connections: dict[str, WebSocket] = {}
        self._pending: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self._lock = asyncio.Lock()

    # --- Bağlantı yönetimi ------------------------------------------------ #

    async def connect(self, device_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            # Aynı cihaz için ikinci bir ajan bağlanırsa eskisini bırak:
            # iki ajan aynı donanımı sürerse komutlar çakışır
            previous = self._connections.get(device_id)
            if previous is not None:
                await _safe_close(previous)
            self._connections[device_id] = websocket

    async def disconnect(self, device_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            if self._connections.get(device_id) is websocket:
                self._connections.pop(device_id, None)

    async def disconnect_device(self, device_id: str) -> None:
        async with self._lock:
            websocket = self._connections.pop(device_id, None)
        if websocket is not None:
            await _safe_close(websocket)

    def is_connected(self, device_id: str) -> bool:
        return device_id in self._connections

    @property
    def connected_count(self) -> int:
        return len(self._connections)

    # --- Komut gönderimi -------------------------------------------------- #

    async def send_command(
        self,
        device_id: str,
        body: list[dict[str, Any]],
        wait: bool = True,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> dict[str, Any]:
        """Komutu ajana iletir; istenirse uygulanmasını bekler."""
        websocket = self._connections.get(device_id)
        if websocket is None:
            raise ConnectionError("Köprü ajanı bağlı değil")

        label = str(uuid.uuid4())
        message = {"type": "rpc", "label": label, "body": body}

        future: asyncio.Future[dict[str, Any]] | None = None
        if wait:
            future = asyncio.get_running_loop().create_future()
            self._pending[label] = future

        try:
            await websocket.send_json(message)
        except Exception as exc:
            self._pending.pop(label, None)
            raise ConnectionError(f"Ajana ulaşılamadı: {exc}") from exc

        if future is None:
            return {"kind": "rpc_sent", "args": {"label": label}}

        try:
            result = await asyncio.wait_for(future, timeout)
        except asyncio.TimeoutError as exc:
            self._pending.pop(label, None)
            raise AgentTimeoutError(
                f"Köprü ajanı {timeout:.0f} saniyede yanıt vermedi"
            ) from exc

        if not result.get("ok", True):
            raise AgentError(result.get("error") or "Ajan komutu uygulayamadı")
        return {"kind": "rpc_ok", "args": {"label": label}, "result": result}

    def resolve(self, label: str | None, payload: dict[str, Any]) -> None:
        """Ajandan gelen yanıtı bekleyen komuta bağlar."""
        if not label:
            return
        future = self._pending.pop(label, None)
        if future is not None and not future.done():
            future.set_result(payload)

    # --- Canlılık --------------------------------------------------------- #

    async def ping_all(self) -> None:
        """Sessiz kalan bağlantıların vekil sunucular tarafından kapatılmasını önler."""
        async with self._lock:
            targets = list(self._connections.items())

        for device_id, websocket in targets:
            try:
                await websocket.send_json({"type": "ping"})
            except Exception:
                logger.info("Ajan bağlantısı kopmuş, kaldırılıyor: %s", device_id)
                await self.disconnect(device_id, websocket)


async def _safe_close(websocket: WebSocket) -> None:
    try:
        await websocket.close()
    except Exception:
        pass


agent_hub = AgentHub()
