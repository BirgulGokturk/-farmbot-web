"""WebSocket yayın merkezi ve cihazların bellek içi son durumu.

Robotun anlık konumu gibi saniyede birkaç kez değişen veriler veritabanına
yazılmaz; burada tutulur ve WebSocket ile tarayıcıya iletilir.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class DeviceState:
    """Bir robotun bellekteki son bilinen durumu."""

    def __init__(self, device_id: str) -> None:
        self.device_id = device_id
        self.online: bool = False
        self.locked: bool = False
        self.busy: bool = False
        self.sync_status: str = "unknown"
        self.position: dict[str, float] = {"x": 0.0, "y": 0.0, "z": 0.0}
        self.axis_states: dict[str, str] = {"x": "idle", "y": "idle", "z": "idle"}
        self.pins: dict[str, dict[str, Any]] = {}
        self.informational: dict[str, Any] = {}
        self.last_seen_at: datetime | None = None

    def apply_status_tree(self, tree: dict[str, Any]) -> None:
        """Robotun yayınladığı durum ağacını bu nesneye uygula."""
        location = tree.get("location_data") or {}
        position = location.get("position") or {}
        for axis in ("x", "y", "z"):
            value = position.get(axis)
            if isinstance(value, (int, float)):
                self.position[axis] = float(value)

        axis_states = location.get("axis_states") or {}
        for axis in ("x", "y", "z"):
            if axis in axis_states:
                self.axis_states[axis] = str(axis_states[axis])

        pins = tree.get("pins")
        if isinstance(pins, dict):
            self.pins = {str(k): v for k, v in pins.items()}

        info = tree.get("informational_settings") or {}
        if info:
            self.informational = info
            self.sync_status = str(info.get("sync_status", self.sync_status))
            self.locked = bool(info.get("locked", self.locked))
            self.busy = bool(info.get("busy", self.busy))

        self.online = self.sync_status != "offline"
        self.last_seen_at = datetime.now(timezone.utc)

    def to_dict(self) -> dict[str, Any]:
        return {
            "device_id": self.device_id,
            "online": self.online,
            "locked": self.locked,
            "busy": self.busy,
            "sync_status": self.sync_status,
            "position": self.position,
            "axis_states": self.axis_states,
            "pins": self.pins,
            "informational": self.informational,
            "last_seen_at": self.last_seen_at.isoformat() if self.last_seen_at else None,
        }


class RealtimeHub:
    """Cihaz başına WebSocket abonelerini tutar ve mesaj yayınlar."""

    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._states: dict[str, DeviceState] = {}
        self._lock = asyncio.Lock()

    # --- Durum ---

    def state(self, device_id: str) -> DeviceState:
        """Cihazın durumunu döndürür; yoksa oluşturur."""
        if device_id not in self._states:
            self._states[device_id] = DeviceState(device_id)
        return self._states[device_id]

    def known_devices(self) -> list[str]:
        return list(self._states.keys())

    # --- Abonelik ---

    async def connect(self, device_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[device_id].add(websocket)
        # Yeni bağlanan istemci anında güncel durumu görsün
        await self._send(websocket, {"type": "status", "payload": self.state(device_id).to_dict()})

    async def disconnect(self, device_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections[device_id].discard(websocket)
            if not self._connections[device_id]:
                self._connections.pop(device_id, None)

    # --- Yayın ---

    async def broadcast(self, device_id: str, message: dict[str, Any]) -> None:
        """Bir cihazın tüm abonelerine mesaj gönder. Kopan bağlantılar temizlenir."""
        async with self._lock:
            targets = list(self._connections.get(device_id, ()))

        if not targets:
            return

        dead: list[WebSocket] = []
        for ws in targets:
            if not await self._send(ws, message):
                dead.append(ws)

        if dead:
            async with self._lock:
                for ws in dead:
                    self._connections[device_id].discard(ws)

    async def broadcast_status(self, device_id: str) -> None:
        await self.broadcast(device_id, {"type": "status", "payload": self.state(device_id).to_dict()})

    @staticmethod
    async def _send(websocket: WebSocket, message: dict[str, Any]) -> bool:
        """Tek istemciye gönderir. Başarısızsa False döner (bağlantı kopmuş)."""
        try:
            await websocket.send_json(message)
            return True
        except Exception:  # bağlantı kapanmış olabilir — sessizce düş
            return False

    def connection_count(self, device_id: str) -> int:
        return len(self._connections.get(device_id, ()))


# Uygulama genelinde tek örnek
hub = RealtimeHub()
