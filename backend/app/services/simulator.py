"""Sanal FarmBot — gerçek donanım olmadan paneli canlı tutar.

Neden MQTT üzerinden değil de süreç içinde?
  Ücretsiz bulut katmanlarında ek bir broker + worker servisi çalıştırmak
  gereksiz maliyet ve karmaşıklık demek. Simülatör doğrudan `hub` üzerinden
  yayın yaptığı için hiçbir ek altyapı gerektirmez. Gerçek robot bağlandığında
  `RobotGateway` komutları MQTT'ye yönlendirir; arayüz tarafında hiçbir şey
  değişmez.

Davranışı bilinçli olarak gerçekçi tutuldu:
  * Hareket ani değil, eksen hızına göre kademeli ilerler
  * Aynı anda tek komut çalışır (robot meşgulken sıraya alınır)
  * Acil kilit hareketi anında keser
  * Düzenli aralıkla sensör okuması ve log üretir
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import math
import random
import uuid
from datetime import datetime, timezone
from typing import Any

from app.services.realtime import hub

logger = logging.getLogger(__name__)

# Eksenlerin %100 hızdaki ilerleme oranı (mm/saniye)
AXIS_SPEED_MM_S = {"x": 320.0, "y": 320.0, "z": 180.0}
# Durum yayını sıklığı — hareket akıcı görünsün ama ağı boğmasın
TICK_SECONDS = 0.1
# Sensör okuması üretme aralığı
SENSOR_INTERVAL_SECONDS = 45.0


class VirtualRobot:
    """Tek bir cihazı taklit eden sanal robot."""

    def __init__(self, device_id: str, bed_width: int, bed_length: int, max_z: int) -> None:
        self.device_id = device_id
        self.bed_width = bed_width
        self.bed_length = bed_length
        self.max_z = max_z

        self.x = 0.0
        self.y = 0.0
        self.z = 0.0
        self.pins: dict[str, dict[str, int]] = {}
        self.locked = False
        self.busy = False

        self._queue: asyncio.Queue[list[dict[str, Any]]] = asyncio.Queue()
        self._tasks: list[asyncio.Task[None]] = []
        self._started_at = datetime.now(timezone.utc)
        # Sensörler her seferinde aynı değeri vermesin diye küçük bir rastgele kayma
        self._noise_seed = random.random() * 100

    # ------------------------------------------------------------------ #
    # Yaşam döngüsü
    # ------------------------------------------------------------------ #

    async def start(self) -> None:
        self._tasks = [
            asyncio.create_task(self._command_loop(), name=f"sim-cmd-{self.device_id[:8]}"),
            asyncio.create_task(self._sensor_loop(), name=f"sim-sensor-{self.device_id[:8]}"),
        ]
        await self._publish_status()
        await self._log("Sanal robot çevrimiçi", "success")

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self._tasks.clear()

    # ------------------------------------------------------------------ #
    # Komut kabulü
    # ------------------------------------------------------------------ #

    async def submit(self, body: list[dict[str, Any]]) -> None:
        """Bir RPC gövdesini sıraya alır. Acil komutlar sırayı beklemez."""
        kinds = {step.get("kind") for step in body}

        if "emergency_lock" in kinds:
            self.locked = True
            self.busy = False
            # Sırada bekleyen ne varsa iptal et — gerçek acil durdurma da böyle
            self._drain_queue()
            await self._log("ACİL DURDURMA etkinleştirildi", "error")
            await self._publish_status()
            return

        if "emergency_unlock" in kinds:
            self.locked = False
            await self._log("Acil kilit açıldı", "warn")
            await self._publish_status()
            return

        await self._queue.put(body)

    def _drain_queue(self) -> None:
        while not self._queue.empty():
            with contextlib.suppress(asyncio.QueueEmpty):
                self._queue.get_nowait()

    # ------------------------------------------------------------------ #
    # Komut işleme
    # ------------------------------------------------------------------ #

    async def _command_loop(self) -> None:
        while True:
            body = await self._queue.get()
            if self.locked:
                await self._log("Komut yok sayıldı: robot kilitli", "warn")
                continue

            self.busy = True
            await self._publish_status()
            try:
                for step in body:
                    if self.locked:
                        await self._log("Komut yarıda kesildi: acil kilit", "error")
                        break
                    await self._run_step(step)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Simülatör adımı çalıştırılamadı")
                await self._log("Sanal robot adımı uygulayamadı", "error")
            finally:
                self.busy = False
                await self._publish_status()

    async def _run_step(self, step: dict[str, Any]) -> None:
        kind = step.get("kind")
        args = step.get("args") or {}

        if kind == "move_absolute":
            location = (args.get("location") or {}).get("args") or {}
            await self._move_to(
                float(location.get("x", self.x)),
                float(location.get("y", self.y)),
                float(location.get("z", self.z)),
                int(args.get("speed", 100)),
            )

        elif kind == "move_relative":
            await self._move_to(
                self.x + float(args.get("x", 0)),
                self.y + float(args.get("y", 0)),
                self.z + float(args.get("z", 0)),
                int(args.get("speed", 100)),
            )

        elif kind in {"home", "find_home"}:
            axis = str(args.get("axis", "all"))
            target = {
                "x": 0.0 if axis in {"x", "all"} else self.x,
                "y": 0.0 if axis in {"y", "all"} else self.y,
                "z": 0.0 if axis in {"z", "all"} else self.z,
            }
            await self._log(f"Eve dönülüyor ({axis})", "info")
            await self._move_to(target["x"], target["y"], target["z"], int(args.get("speed", 100)))

        elif kind == "calibrate":
            await self._log(f"{args.get('axis', 'all')} ekseni kalibre ediliyor", "info")
            await asyncio.sleep(1.5)
            await self._log("Kalibrasyon tamamlandı", "success")

        elif kind == "zero":
            axis = str(args.get("axis", "all"))
            if axis in {"x", "all"}:
                self.x = 0.0
            if axis in {"y", "all"}:
                self.y = 0.0
            if axis in {"z", "all"}:
                self.z = 0.0
            await self._publish_status()

        elif kind == "write_pin":
            pin = str(args.get("pin_number"))
            value = int(args.get("pin_value", 0))
            self.pins[pin] = {"mode": int(args.get("pin_mode", 0)), "value": value}
            await self._log(f"Pin {pin} → {'AÇIK' if value else 'KAPALI'}", "info")
            await self._publish_status()

        elif kind == "toggle_pin":
            pin = str(args.get("pin_number"))
            current = self.pins.get(pin, {"mode": 0, "value": 0})
            current["value"] = 0 if current["value"] else 1
            self.pins[pin] = current
            await self._publish_status()

        elif kind == "read_pin":
            pin = int(args.get("pin_number", 0))
            value = self._sensor_value(pin)
            await self._log(f"Pin {pin} okundu: {value:.1f}", "info")
            await hub.broadcast(
                self.device_id,
                {"type": "pin_read", "payload": {"pin": pin, "value": value}},
            )

        elif kind == "wait":
            await asyncio.sleep(min(float(args.get("milliseconds", 0)) / 1000, 120))

        elif kind == "take_photo":
            await self._log("Fotoğraf çekiliyor…", "info")
            await asyncio.sleep(1.2)
            await self._log("Fotoğraf kaydedildi (simülasyon)", "success")

        elif kind == "reboot":
            await self._log("Yeniden başlatılıyor…", "warn")
            await asyncio.sleep(2)
            self._started_at = datetime.now(timezone.utc)
            await self._log("Sanal robot yeniden başladı", "success")

        elif kind in {"read_status", "sync"}:
            await self._publish_status()

        elif kind == "execute":
            await self._log("Dizi çalıştırılıyor (simülasyon)", "info")
            await asyncio.sleep(1.0)
            await self._log("Dizi tamamlandı", "success")

        else:
            await self._log(f"Bilinmeyen komut yok sayıldı: {kind}", "debug")

    async def _move_to(self, x: float, y: float, z: float, speed: int) -> None:
        """Hedefe kademeli ilerler; her adımda durum yayınlar."""
        target_x = _clamp(x, 0, self.bed_width)
        target_y = _clamp(y, 0, self.bed_length)
        target_z = _clamp(z, -self.max_z, 0)

        factor = max(0.05, min(1.0, speed / 100))

        while True:
            if self.locked:
                return

            dx = target_x - self.x
            dy = target_y - self.y
            dz = target_z - self.z
            if abs(dx) < 0.5 and abs(dy) < 0.5 and abs(dz) < 0.5:
                break

            self.x = _step_axis(self.x, target_x, AXIS_SPEED_MM_S["x"] * factor * TICK_SECONDS)
            self.y = _step_axis(self.y, target_y, AXIS_SPEED_MM_S["y"] * factor * TICK_SECONDS)
            self.z = _step_axis(self.z, target_z, AXIS_SPEED_MM_S["z"] * factor * TICK_SECONDS)

            await self._publish_status(moving=True)
            await asyncio.sleep(TICK_SECONDS)

        self.x, self.y, self.z = target_x, target_y, target_z
        await self._publish_status()

    # ------------------------------------------------------------------ #
    # Sensörler
    # ------------------------------------------------------------------ #

    async def _sensor_loop(self) -> None:
        """Düzenli aralıklarla gerçekçi sensör verisi üretir ve kaydeder."""
        # Açılışta hepsi aynı anda tetiklenmesin
        await asyncio.sleep(5)
        while True:
            try:
                await self._emit_sensor_readings()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Simülatör sensör okuması üretemedi")
            await asyncio.sleep(SENSOR_INTERVAL_SECONDS)

    async def _emit_sensor_readings(self) -> None:
        from sqlalchemy import select

        from app.db.session import SessionLocal
        from app.models import Sensor, SensorReading

        try:
            device_uuid = uuid.UUID(self.device_id)
        except ValueError:
            return

        async with SessionLocal() as session:
            result = await session.execute(select(Sensor).where(Sensor.device_id == device_uuid))
            sensors = list(result.scalars().all())
            if not sensors:
                return

            now = datetime.now(timezone.utc)
            for sensor in sensors:
                value = self._sensor_value(sensor.pin, sensor.min_value, sensor.max_value)
                session.add(
                    SensorReading(
                        device_id=device_uuid,
                        sensor_id=sensor.id,
                        pin=sensor.pin,
                        value=round(value, 1),
                        x=self.x,
                        y=self.y,
                        z=self.z,
                        read_at=now,
                    )
                )
                await hub.broadcast(
                    self.device_id,
                    {
                        "type": "reading",
                        "payload": {
                            "sensor_id": str(sensor.id),
                            "value": round(value, 1),
                            "read_at": now.isoformat(),
                        },
                    },
                )
            await session.commit()

        # Uyarı kuralları yeni veriye göre değerlendirilsin
        from app.services.alerts import evaluate_device_alerts

        with contextlib.suppress(Exception):
            await evaluate_device_alerts(device_uuid)

    def _sensor_value(self, pin: int, low: float = 0.0, high: float = 100.0) -> float:
        """Günün saatine göre yavaşça salınan, pinine göre farklılaşan değer."""
        now = datetime.now(timezone.utc)
        minutes = now.hour * 60 + now.minute
        # Gün içinde bir tam salınım + pine özgü faz kayması
        phase = (minutes / 1440) * 2 * math.pi + (pin % 7)
        base = (math.sin(phase + self._noise_seed) + 1) / 2  # 0..1
        jitter = random.uniform(-0.03, 0.03)
        return _clamp(low + (high - low) * (base + jitter), low, high)

    # ------------------------------------------------------------------ #
    # Yayın
    # ------------------------------------------------------------------ #

    async def _publish_status(self, moving: bool = False) -> None:
        uptime = int((datetime.now(timezone.utc) - self._started_at).total_seconds())
        state = hub.state(self.device_id)
        state.apply_status_tree(
            {
                "location_data": {
                    "position": {"x": self.x, "y": self.y, "z": self.z},
                    "axis_states": {
                        "x": "moving" if moving else "idle",
                        "y": "moving" if moving else "idle",
                        "z": "moving" if moving else "idle",
                    },
                },
                "pins": self.pins,
                "informational_settings": {
                    "sync_status": "synced",
                    "locked": self.locked,
                    "busy": self.busy,
                    "firmware_version": "simülatör-1.0",
                    "soc_temp": round(41 + random.uniform(-1.5, 1.5), 1),
                    "wifi_level": -52,
                    "uptime": uptime,
                    "cpu_usage": random.randint(6, 22),
                    "memory_usage": random.randint(30, 48),
                    "disk_usage": 37,
                },
            }
        )
        await hub.broadcast_status(self.device_id)

    async def _log(self, message: str, level: str = "info") -> None:
        payload = {
            "message": message,
            "level": level,
            "channels": ["ticker"],
            "x": self.x,
            "y": self.y,
            "z": self.z,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await hub.broadcast(self.device_id, {"type": "log", "payload": payload})

        # Kayıtlar bölümünde geçmişe bakılabilsin diye veritabanına da yaz
        from app.db.session import SessionLocal
        from app.models import Log, LogLevel

        try:
            device_uuid = uuid.UUID(self.device_id)
        except ValueError:
            return

        try:
            async with SessionLocal() as session:
                session.add(
                    Log(
                        device_id=device_uuid,
                        message=message,
                        level=LogLevel(level) if level in LogLevel._value2member_map_ else LogLevel.INFO,
                        channels=["ticker"],
                        x=self.x,
                        y=self.y,
                        z=self.z,
                        created_at=datetime.now(timezone.utc),
                    )
                )
                await session.commit()
        except Exception:
            logger.exception("Simülatör logu kaydedilemedi")


# --------------------------------------------------------------------------- #
# Simülatör yöneticisi
# --------------------------------------------------------------------------- #


class Simulator:
    """Cihaz başına sanal robot oluşturur ve yaşam döngülerini yönetir."""

    def __init__(self) -> None:
        self._robots: dict[str, VirtualRobot] = {}
        self._lock = asyncio.Lock()

    async def robot_for(self, device: Any) -> VirtualRobot:
        """Cihaz için sanal robotu döndürür; yoksa oluşturup başlatır."""
        key = str(device.id)
        async with self._lock:
            robot = self._robots.get(key)
            if robot is None:
                robot = VirtualRobot(
                    device_id=key,
                    bed_width=device.bed_width_mm,
                    bed_length=device.bed_length_mm,
                    max_z=device.max_z_mm,
                )
                # Sunucu yeniden başladıysa son bilinen konumdan devam et
                robot.x, robot.y, robot.z = device.last_x, device.last_y, device.last_z
                robot.locked = device.is_locked
                self._robots[key] = robot
                await robot.start()
            return robot

    async def stop_all(self) -> None:
        async with self._lock:
            for robot in self._robots.values():
                await robot.stop()
            self._robots.clear()

    @property
    def active_count(self) -> int:
        return len(self._robots)


simulator = Simulator()


# --------------------------------------------------------------------------- #
# Yardımcılar
# --------------------------------------------------------------------------- #


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _step_axis(current: float, target: float, step: float) -> float:
    """Hedefi aşmadan bir adım yaklaşır."""
    delta = target - current
    if abs(delta) <= step:
        return target
    return current + math.copysign(step, delta)
