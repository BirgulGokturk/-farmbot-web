"""Canlı durum yayını (WebSocket).

Tarayıcı `/api/v1/ws/devices/{device_id}?token=<JWT>` adresine bağlanır.
Tarayıcı WebSocket API'si özel başlık gönderemediği için token sorgu
parametresiyle taşınır — bu yüzden bağlantı üretimde mutlaka WSS olmalıdır.
"""

from __future__ import annotations

import asyncio
import contextlib
import uuid

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select

from app.core.security import decode_token
from app.db.session import SessionLocal
from app.models import Device
from app.services.realtime import hub

router = APIRouter(prefix="/ws", tags=["Canlı"])

# İstemci bu süre içinde bir şey göndermezse ping atarak bağlantıyı canlı tutarız
HEARTBEAT_SECONDS = 25


async def _authorize(device_id: uuid.UUID, token: str) -> bool:
    payload = decode_token(token, expected_type="access")
    if payload is None:
        return False
    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError):
        return False

    async with SessionLocal() as session:
        result = await session.execute(
            select(Device.id).where(Device.id == device_id, Device.user_id == user_id)
        )
        return result.scalar_one_or_none() is not None


@router.websocket("/devices/{device_id}")
async def device_stream(
    websocket: WebSocket,
    device_id: uuid.UUID,
    token: str = Query(description="Erişim token'ı"),
) -> None:
    if not await _authorize(device_id, token):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Yetkisiz")
        return

    key = str(device_id)
    await hub.connect(key, websocket)

    try:
        while True:
            # İstemciden mesaj bekle; sessizlik uzarsa ping gönder
            try:
                message = await asyncio.wait_for(
                    websocket.receive_text(), timeout=HEARTBEAT_SECONDS
                )
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})
                continue

            if message == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception:
        # Bağlantı hataları normaldir; sadece temizliğe geç
        pass
    finally:
        await hub.disconnect(key, websocket)
        with contextlib.suppress(Exception):
            await websocket.close()
