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

from gantry import GantryClient, to_status_tree  # noqa: E402  (yerel modül)

logger = logging.getLogger("farmbot-agent")

# Gantry konumunu yoklama sıklığı. Saniyede iki kez panel için akıcı,
# PLC için de yük oluşturmayan bir denge.
GANTRY_POLL_SECONDS = 0.5

# Gönderilemeyen ölçümler için üst sınır. ~5 sn'de bir 7 kanal ≈ 5000 kayıt/saat;
# 5000'lik tampon yaklaşık bir saatlik kopmayı karşılar.
MAX_BUFFER = 5000
# Kaç ölçüm birikince ya da kaç saniye geçince gönderilsin
FLUSH_SIZE = 20
FLUSH_INTERVAL_SECONDS = 15.0


class SerialLink:
    """Arduino ile konuşan seri bağlantı.

    Arduino iki tür satır basar:
      * insan için Türkçe metin  ("Hava Nemi: %54.00 | ...")  → yok sayılır
      * makine için önekli satır ("VERI:{...}", "CEVAP:{...}") → ayrıştırılır

    Bu ayrım sayesinde Seri Monitör'den kod hâlâ okunabilir kalıyor ama köprü
    yalnızca ihtiyacı olan satırları alıyor.

    `pyserial` eşzamanlıdır; olay döngüsünü bloklamamak için okuma ve yazma
    ayrı iş parçacıklarında (`asyncio.to_thread`) yapılır.
    """

    # Arduino'nun makine okunabilir satır önekleri
    PREFIXES = {"VERI:": "data", "CEVAP:": "ack", "HAZIR:": "hello"}

    def __init__(self, port: str, baudrate: int = 9600) -> None:
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
        """Bir satır okur. Önekli satırları çözer, diğerlerini yok sayar."""
        if self._serial is None:
            raise ConnectionError("Seri port kapalı")

        raw = await asyncio.to_thread(self._serial.readline)
        if not raw:
            return None

        text = raw.decode("utf-8", errors="replace").strip()
        if not text:
            return None

        for prefix, kind in self.PREFIXES.items():
            if text.startswith(prefix):
                body = text[len(prefix):]
                try:
                    return {"t": kind, "payload": json.loads(body)}
                except json.JSONDecodeError:
                    logger.warning("Bozuk %s satırı: %s", prefix, body[:120])
                    return None

        # Türkçe durum satırları — kullanıcının Seri Monitör'de gördüğü çıktı.
        # Ayrıntılı kipte günlüğe yazıyoruz ki uzaktan da izlenebilsin.
        logger.debug("Arduino: %s", text[:160])
        return None

    async def write_command(self, command: str) -> None:
        """Arduino'ya metin komutu gönderir (ör. "SERVO 90")."""
        if self._serial is None:
            raise ConnectionError("Seri port kapalı")

        line = (command.strip() + "\n").encode("utf-8")
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
    def __init__(
        self,
        serial_link: SerialLink,
        cloud: CloudClient,
        gantry: GantryClient | None = None,
    ) -> None:
        self.serial = serial_link
        self.cloud = cloud
        # Hareket kontrolü isteğe bağlı: Gantry Studio kurulu değilse ajan
        # yalnızca sensör köprüsü olarak çalışmaya devam eder
        self.gantry = gantry
        self.buffer: deque[dict[str, Any]] = deque(maxlen=MAX_BUFFER)
        self.dropped = 0
        self.sent = 0
        # Seri porta gönderilen komutların yanıtını bekleyenler
        self._pending: dict[str, asyncio.Future[dict[str, Any]]] = {}
        # Buluta açık WebSocket; konum yayını da bunu kullanır
        self._socket: Any | None = None

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
            payload = message.get("payload") or {}

            if kind == "data":
                self._buffer_readings(payload)
            elif kind == "ack":
                self._resolve_ack(payload)
            elif kind == "hello":
                logger.info("Arduino hazır: %s", json.dumps(payload, ensure_ascii=False))
                if payload.get("bmp180") is False:
                    logger.warning(
                        "BMP180 bulunamadı — basınç, rakım ve kart sıcaklığı gelmeyecek. "
                        "SDA→A4, SCL→A5 ve 3.3V beslemeyi kontrol edin."
                    )

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

    def _resolve_ack(self, payload: dict[str, Any]) -> None:
        """Arduino komut onayı.

        Arduino komutlara kimlik döndürmüyor (basit metin protokolü), bu yüzden
        sıradaki bekleyen komutu eşleştiriyoruz. Komutlar seri porta tek tek ve
        sırayla gönderildiği için bu güvenli.
        """
        if not self._pending:
            return
        label = next(iter(self._pending))
        future = self._pending.pop(label, None)
        if future is not None and not future.done():
            future.set_result(payload)

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
                    self._socket = socket
                    async for raw in socket:
                        await self._handle_cloud_message(socket, raw)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Komut kanalı koptu (%s), %.0f sn sonra yeniden", exc, delay)
                await asyncio.sleep(delay)
                delay = min(delay * 2, 30.0)
            finally:
                self._socket = None

    async def _send_cloud(self, message: dict[str, Any]) -> bool:
        """Buluta mesaj yollar. Bağlantı yoksa sessizce atlar."""
        socket = self._socket
        if socket is None:
            return False
        try:
            await socket.send(json.dumps(message))
            return True
        except Exception:
            return False

    # ------------------------------------------------------------------ #
    # Gantry (PLC hareket kontrolü) → bulut
    # ------------------------------------------------------------------ #

    async def gantry_loop_forever(self) -> None:
        """Gantry Studio'dan konumu okuyup panele yayınlar.

        Yayın hızı bilinçli olarak sınırlı: panel akıcı görünsün diye saniyede
        iki kez okuyoruz ama **değişmeyen** durumu tekrar tekrar göndermiyoruz.
        Robot dururken ağ trafiği neredeyse sıfıra iniyor.
        """
        if self.gantry is None:
            return

        last_signature: str | None = None
        last_sent = 0.0

        while True:
            await asyncio.sleep(GANTRY_POLL_SECONDS)

            status = await self.gantry.status()
            if status is None:
                continue

            tree = to_status_tree(status)
            position = tree["location_data"]["position"]
            # Konumu 0.1 mm çözünürlükte imzala: gürültüden dolayı sürekli
            # mesaj gitmesin
            signature = "{:.1f}|{:.1f}|{:.1f}|{}|{}".format(
                position["x"], position["y"], position["z"],
                tree["informational_settings"]["locked"],
                tree["informational_settings"]["busy"],
            )

            now = asyncio.get_running_loop().time()
            # Değişmese bile 10 saniyede bir yolla: panel yeni açıldıysa
            # ilk durumu beklemeden görsün
            if signature == last_signature and (now - last_sent) < 10.0:
                continue

            if await self._send_cloud({"type": "status", "payload": tree}):
                last_signature = signature
                last_sent = now

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
        """CeleryScript adımını donanım komutuna çevirir.

        İki hedef var:
          * hareket (X/Y/Z, ev, acil durdurma) → Gantry Studio → PLC
          * pin ve servo                        → Arduino
        """
        kind = step.get("kind")
        args = step.get("args") or {}

        # --- Hareket: Gantry Studio üzerinden PLC ---
        if kind in {
            "move_absolute", "move_relative", "home", "find_home",
            "emergency_lock", "emergency_unlock",
        }:
            await self._apply_motion(kind, args)
            return

        if kind == "write_pin":
            pin = int(args.get("pin_number", 0))
            value = int(args.get("pin_value", 0))
            await self._send_arduino(f"PIN {pin} {value}")

        elif kind == "set_servo_angle":
            await self._send_arduino(f"SERVO {int(args.get('pin_value', 0))}")

        elif kind == "read_pin":
            # Arduino tüm kanalları birlikte yayınlar; tek pin okumak yerine
            # anlık bir ölçüm turu tetiklemek daha faydalı
            await self._send_arduino("OKU")

        else:
            logger.debug("Bu düğümde geçersiz adım yok sayıldı: %s", kind)

    async def _apply_motion(self, kind: str, args: dict[str, Any]) -> None:
        """Hareket komutlarını Gantry Studio'ya iletir."""
        if self.gantry is None:
            raise RuntimeError(
                "Hareket kontrolü yapılandırılmamış. Ajanı --gantry adresiyle başlatın."
            )

        # Acil durdurma her koşulda geçer — kilit kontrolünden önce gelir
        if kind == "emergency_lock":
            logger.warning("ACİL DURDURMA — tüm eksenler durduruluyor")
            await self.gantry.emergency_stop()
            return

        if kind == "emergency_unlock":
            logger.info("Acil kilit açılıyor, sürücüler etkinleştiriliyor")
            await self.gantry.set_enabled(True)
            return

        speed = float(args.get("speed", 20) or 20)

        if kind == "move_absolute":
            location = (args.get("location") or {}).get("args") or {}
            offset = (args.get("offset") or {}).get("args") or {}
            x = float(location.get("x", 0)) + float(offset.get("x", 0) or 0)
            y = float(location.get("y", 0)) + float(offset.get("y", 0) or 0)
            z = float(location.get("z", 0)) + float(offset.get("z", 0) or 0)
            logger.info("Hedefe gidiliyor: X %.1f · Y %.1f · Z %.1f", x, y, z)
            await self.gantry.move_xyz(x, y, z, speed)

        elif kind == "move_relative":
            # Göreli adım için önce bulunduğu yeri öğrenmeliyiz
            current = await self.gantry.position()
            if current is None:
                raise RuntimeError("Mevcut konum okunamadı; göreli hareket yapılamıyor")
            x = current[0] + float(args.get("x", 0) or 0)
            y = current[1] + float(args.get("y", 0) or 0)
            z = current[2] + float(args.get("z", 0) or 0)
            logger.info("Göreli hareket → X %.1f · Y %.1f · Z %.1f", x, y, z)
            await self.gantry.move_xyz(x, y, z, speed)

        elif kind in {"home", "find_home"}:
            axis = str(args.get("axis", "all")).lower()
            if axis not in {"x", "y", "z", "all"}:
                axis = "all"
            logger.info("Eve dönülüyor: %s", axis)
            await self.gantry.go_home(axis)

    async def _send_arduino(self, command: str, timeout: float = 5.0) -> dict[str, Any]:
        """Komutu gönderir ve Arduino'nun onayını bekler."""
        import uuid

        label = uuid.uuid4().hex[:8]
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending[label] = future

        logger.info("Arduino'ya komut: %s", command)
        await self.serial.write_command(command)

        try:
            return await asyncio.wait_for(future, timeout)
        except asyncio.TimeoutError as exc:
            self._pending.pop(label, None)
            raise TimeoutError("Arduino komuta yanıt vermedi") from exc

    # ------------------------------------------------------------------ #

    async def run(self) -> None:
        await self._reconnect_serial()
        tasks = [
            asyncio.create_task(self.read_serial_forever(), name="serial"),
            asyncio.create_task(self.flush_forever(), name="flush"),
            asyncio.create_task(self.command_loop_forever(), name="commands"),
        ]
        if self.gantry is not None:
            tasks.append(asyncio.create_task(self.gantry_loop_forever(), name="gantry"))
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
            if self.gantry is not None:
                await self.gantry.close()


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
        "--baud", type=int, default=int(os.getenv("FARMBOT_BAUD", "9600")),
        help="Seri hız — Arduino sketch'indeki Serial.begin() ile aynı olmalı (varsayılan 9600)",
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
    parser.add_argument(
        "--gantry",
        default=os.getenv("FARMBOT_GANTRY_URL", "http://localhost:8091"),
        help=(
            "Gantry Studio adresi (PLC hareket kontrolü). "
            "Hareket kontrolü istemiyorsanız --no-gantry kullanın."
        ),
    )
    parser.add_argument(
        "--no-gantry",
        action="store_true",
        help="Hareket kontrolünü devre dışı bırak; yalnızca sensör köprüsü çalışsın",
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

    gantry: GantryClient | None = None
    if not args.no_gantry:
        gantry = GantryClient(args.gantry)
        # Açılışta bir kez yokla: kullanıcı hareket kontrolünün durumunu hemen görsün
        if await gantry.status() is None:
            logger.warning(
                "Gantry Studio (%s) şu an yanıt vermiyor. Sensörler çalışmaya devam eder; "
                "hareket kontrolü servis ayağa kalkınca kendiliğinden devreye girer.",
                args.gantry,
            )
        else:
            logger.info("Hareket kontrolü bağlandı: %s", args.gantry)

    logger.info(
        "Ajan başlıyor · seri=%s · api=%s · hareket=%s",
        args.port, args.api, "kapalı" if gantry is None else args.gantry,
    )
    agent = Agent(SerialLink(args.port, args.baud), CloudClient(args.api, args.token), gantry)

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

    # httpx her isteği INFO olarak yazıyor. Gantry Studio saniyede iki kez
    # yoklandığı için journalctl dakikalar içinde bu satırlarla doluyor ve
    # gerçek mesajlar kayboluyor. Yalnızca hataları görelim.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("websockets").setLevel(logging.WARNING)
    try:
        return asyncio.run(main_async(args))
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
