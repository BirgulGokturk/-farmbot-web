#!/usr/bin/env python3
"""FarmBot köprü ajanı — Raspberry Pi üzerinde çalışır.

İki yönlü bir tercümandır:

    Arduino ──seri──> ajan ──HTTPS──> bulut API   (sensör ölçümleri)
    Arduino <──seri── ajan <──WSS──── bulut API   (servo/röle komutları)

Tasarım kararları:
  * **Tamponlama:** internet kesilirse ölçümler bellekte tutulur ve bağlantı
    dönünce toplu gönderilir. Bahçedeki bir cihazda kopma normaldir; veri
    kaybetmemek gerekir.
  * **Ayrı görevler:** seri okuma, gönderim ve komut dinleme birbirinden
    bağımsız çalışır; biri çökerse diğerleri ayakta kalır ve yeniden başlar.
  * **Tek bağımlılık kümesi:** yalnızca `pyserial`, `httpx` ve `websockets`.

Kurulum ve kullanım için: agent/README.md
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import logging
import os
import sys
from collections import deque
from datetime import datetime, timezone
from typing import Any

try:
    import httpx
    import serial  # pyserial
    import websockets
except ImportError as exc:  # pragma: no cover - kurulum yardımı
    print(f"Eksik bağımlılık: {exc.name}", file=sys.stderr)
    print("Kurulum:  pip install pyserial httpx websockets", file=sys.stderr)
    raise SystemExit(1)

logger = logging.getLogger("farmbot-agent")

# Gönderilemeyen ölçümler için üst sınır. ~5 sn'de bir 7 kanal ≈ 5000 kayıt/saat;
# 5000'lik tampon yaklaşık bir saatlik kopmayı karşılar.
MAX_BUFFER = 5000
# Kaç ölçüm birikince ya da kaç saniye geçince gönderilsin
FLUSH_SIZE = 20
FLUSH_INTERVAL_SECONDS = 15.0


class SerialLink:
    """Arduino ile satır bazlı JSON konuşan seri bağlantı.

    `pyserial` eşzamanlıdır; olay döngüsünü bloklamamak için okuma ve yazma
    ayrı iş parçacıklarında (`asyncio.to_thread`) yapılır.
    """

    def __init__(self, port: str, baudrate: int = 115200) -> None:
        self.port = port
        self.baudrate = baudrate
        self._serial: serial.Serial | None = None
        self._write_lock = asyncio.Lock()

    async def open(self) -> None:
        def _open() -> serial.Serial:
            # timeout: readline'ın sonsuza kadar beklememesi için
            return serial.Serial(self.port, self.baudrate, timeout=2)

        self._serial = await asyncio.to_thread(_open)
        # Arduino seri port açılınca resetlenir; açılış mesajını bekle
        await asyncio.sleep(2.5)
        logger.info("Arduino bağlandı: %s @ %d", self.port, self.baudrate)

    async def close(self) -> None:
        if self._serial is not None:
            with contextlib.suppress(Exception):
                await asyncio.to_thread(self._serial.close)
            self._serial = None

    async def read_line(self) -> dict[str, Any] | None:
        """Bir satır okur ve JSON olarak çözer. Bozuk satırlar yok sayılır."""
        if self._serial is None:
            raise ConnectionError("Seri port kapalı")

        raw = await asyncio.to_thread(self._serial.readline)
        if not raw:
            return None

        text = raw.decode("utf-8", errors="replace").strip()
        if not text:
            return None

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Açılış çıktısı ya da hata ayıklama satırı olabilir
            logger.debug("JSON olmayan satır: %s", text[:120])
            return None

    async def write(self, payload: dict[str, Any]) -> None:
        if self._serial is None:
            raise ConnectionError("Seri port kapalı")

        line = (json.dumps(payload, separators=(",", ":")) + "\n").encode("utf-8")
        # Aynı anda iki komut yazılırsa satırlar iç içe girer
        async with self._write_lock:
            await asyncio.to_thread(self._serial.write, line)


class CloudClient:
    """Bulut API'siyle konuşan istemci (ölçüm gönderimi + komut kanalı)."""

    def __init__(self, base_url: str, token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self._http = httpx.AsyncClient(
            base_url=self.base_url,
            headers={"X-Device-Token": token},
            timeout=httpx.Timeout(20.0),
        )

    async def close(self) -> None:
        await self._http.aclose()

    async def send_readings(self, readings: list[dict[str, Any]]) -> int:
        response = await self._http.post("/api/v1/agent/readings", json={"readings": readings})
        response.raise_for_status()
        return int(response.json().get("stored", 0))

    @property
    def websocket_url(self) -> str:
        scheme = "wss" if self.base_url.startswith("https") else "ws"
        host = self.base_url.split("://", 1)[1]
        return f"{scheme}://{host}/api/v1/agent/ws?token={self.token}"


class Agent:
    def __init__(self, serial_link: SerialLink, cloud: CloudClient) -> None:
        self.serial = serial_link
        self.cloud = cloud
        self.buffer: deque[dict[str, Any]] = deque(maxlen=MAX_BUFFER)
        self.dropped = 0
        self.sent = 0
        # Seri porta gönderilen komutların yanıtını bekleyenler
        self._pending: dict[str, asyncio.Future[dict[str, Any]]] = {}

    # ------------------------------------------------------------------ #
    # Arduino → tampon
    # ------------------------------------------------------------------ #

    async def read_serial_forever(self) -> None:
        while True:
            try:
                message = await self.serial.read_line()
            except Exception:
                logger.exception("Seri okuma hatası, bağlantı yenileniyor")
                await self._reconnect_serial()
                continue

            if message is None:
                continue

            kind = message.get("t")

            if kind == "data":
                self._buffer_readings(message.get("readings") or {})
            elif kind == "ack":
                self._resolve_ack(message)
            elif kind == "hello":
                logger.info("Arduino hazır: %s", json.dumps(message, ensure_ascii=False))

    def _buffer_readings(self, readings: dict[str, Any]) -> None:
        timestamp = datetime.now(timezone.utc).isoformat()
        for channel, value in readings.items():
            if not isinstance(value, (int, float)):
                continue
            if len(self.buffer) == self.buffer.maxlen:
                # deque dolduğunda en eskisi düşer; kullanıcıyı bilgilendir
                self.dropped += 1
            self.buffer.append(
                {"channel": channel, "value": float(value), "read_at": timestamp}
            )

    def _resolve_ack(self, message: dict[str, Any]) -> None:
        future = self._pending.pop(str(message.get("id") or ""), None)
        if future is not None and not future.done():
            future.set_result(message)

    async def _reconnect_serial(self) -> None:
        await self.serial.close()
        delay = 2.0
        while True:
            try:
                await self.serial.open()
                return
            except Exception as exc:
                logger.warning("Arduino'ya bağlanılamadı (%s), %.0f sn sonra yeniden", exc, delay)
                await asyncio.sleep(delay)
                delay = min(delay * 2, 30.0)

    # ------------------------------------------------------------------ #
    # Tampon → bulut
    # ------------------------------------------------------------------ #

    async def flush_forever(self) -> None:
        while True:
            await asyncio.sleep(FLUSH_INTERVAL_SECONDS)
            if not self.buffer:
                continue
            await self._flush()

    async def _flush(self) -> None:
        # Gönderim başarısız olursa kayıtları geri koyabilmek için önce kopyala
        batch = [self.buffer.popleft() for _ in range(min(len(self.buffer), 200))]
        try:
            stored = await self.cloud.send_readings(batch)
            self.sent += stored
            logger.info(
                "%d ölçüm gönderildi (toplam %d, tamponda %d)",
                stored, self.sent, len(self.buffer),
            )
        except Exception as exc:
            # Başa geri koy: sıra bozulmasın
            self.buffer.extendleft(reversed(batch))
            logger.warning("Gönderim başarısız (%s), tamponda %d kayıt", exc, len(self.buffer))

    # ------------------------------------------------------------------ #
    # Bulut → Arduino
    # ------------------------------------------------------------------ #

    async def command_loop_forever(self) -> None:
        delay = 2.0
        while True:
            try:
                async with websockets.connect(
                    self.cloud.websocket_url,
                    ping_interval=20,
                    ping_timeout=20,
                    max_size=2**20,
                ) as socket:
                    logger.info("Komut kanalı açıldı")
                    delay = 2.0
                    async for raw in socket:
                        await self._handle_cloud_message(socket, raw)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Komut kanalı koptu (%s), %.0f sn sonra yeniden", exc, delay)
                await asyncio.sleep(delay)
                delay = min(delay * 2, 30.0)

    async def _handle_cloud_message(self, socket: Any, raw: str | bytes) -> None:
        try:
            message = json.loads(raw)
        except json.JSONDecodeError:
            return

        if message.get("type") == "ping":
            await socket.send(json.dumps({"type": "pong"}))
            return

        if message.get("type") != "rpc":
            return

        label = message.get("label")
        body = message.get("body") or []

        ok, error = True, None
        try:
            for step in body:
                await self._apply_step(step)
        except Exception as exc:
            ok, error = False, str(exc)
            logger.exception("Komut uygulanamadı")

        await socket.send(
            json.dumps(
                {"type": "rpc_result", "label": label, "payload": {"ok": ok, "error": error}}
            )
        )

    async def _apply_step(self, step: dict[str, Any]) -> None:
        """CeleryScript adımını Arduino komutuna çevirir.

        Arduino hareket edemez (gantry yok); yalnızca pin ve servo komutları
        anlamlıdır. Diğerleri sessizce yok sayılır ki dizi çalıştırmak hata vermesin.
        """
        kind = step.get("kind")
        args = step.get("args") or {}

        if kind == "write_pin":
            await self._send_arduino(
                {"cmd": "pin", "pin": int(args.get("pin_number", 0)),
                 "value": int(args.get("pin_value", 0))}
            )

        elif kind == "set_servo_angle":
            await self._send_arduino(
                {"cmd": "servo", "angle": int(args.get("pin_value", 0))}
            )

        elif kind == "read_pin":
            # Arduino tüm kanalları birlikte yayınlar; tek pin okumak yerine
            # anlık bir ölçüm turu tetiklemek daha faydalı
            await self._send_arduino({"cmd": "read"})

        else:
            logger.debug("Arduino düğümünde geçersiz adım yok sayıldı: %s", kind)

    async def _send_arduino(self, payload: dict[str, Any], timeout: float = 5.0) -> dict[str, Any]:
        """Komutu gönderir ve Arduino'nun onayını bekler."""
        import uuid

        command_id = uuid.uuid4().hex[:8]
        payload = {**payload, "id": command_id}

        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending[command_id] = future

        await self.serial.write(payload)

        try:
            return await asyncio.wait_for(future, timeout)
        except asyncio.TimeoutError as exc:
            self._pending.pop(command_id, None)
            raise TimeoutError("Arduino komuta yanıt vermedi") from exc

    # ------------------------------------------------------------------ #

    async def run(self) -> None:
        await self._reconnect_serial()
        tasks = [
            asyncio.create_task(self.read_serial_forever(), name="serial"),
            asyncio.create_task(self.flush_forever(), name="flush"),
            asyncio.create_task(self.command_loop_forever(), name="commands"),
        ]
        try:
            # Görevlerden biri beklenmedik şekilde biterse hepsini kapat
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                if task.exception():
                    logger.error("Görev çöktü: %s", task.get_name(), exc_info=task.exception())
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await self.serial.close()
            await self.cloud.close()


# --------------------------------------------------------------------------- #


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="FarmBot köprü ajanı — Arduino ile bulut arasında veri taşır",
    )
    parser.add_argument(
        "--port",
        default=os.getenv("FARMBOT_SERIAL_PORT", "/dev/ttyUSB0"),
        help="Arduino'nun seri portu (varsayılan: /dev/ttyUSB0, Uno R3 klonlarda genellikle bu)",
    )
    parser.add_argument(
        "--baud", type=int, default=int(os.getenv("FARMBOT_BAUD", "115200")),
        help="Seri hız (Arduino yazılımıyla aynı olmalı)",
    )
    parser.add_argument(
        "--api",
        default=os.getenv("FARMBOT_API_URL", "https://farmbot-api.onrender.com"),
        help="Bulut API adresi",
    )
    parser.add_argument(
        "--token", default=os.getenv("FARMBOT_DEVICE_TOKEN"),
        help="Cihaz token'ı (panelde Ayarlar → Köprü Ajanı bölümünden üretilir)",
    )
    parser.add_argument("--verbose", action="store_true", help="Ayrıntılı günlük")
    return parser


async def main_async(args: argparse.Namespace) -> int:
    if not args.token:
        logger.error(
            "Cihaz token'ı gerekli. Panelde Ayarlar → Köprü Ajanı'ndan üretip "
            "--token ile ya da FARMBOT_DEVICE_TOKEN ortam değişkeniyle verin."
        )
        return 1

    logger.info("Ajan başlıyor · port=%s · api=%s", args.port, args.api)
    agent = Agent(SerialLink(args.port, args.baud), CloudClient(args.api, args.token))

    try:
        await agent.run()
    except KeyboardInterrupt:
        logger.info("Kapatılıyor…")
    return 0


def main() -> int:
    args = build_parser().parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s  %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )
    try:
        return asyncio.run(main_async(args))
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
