"""Uyarı kurallarını değerlendirir ve bildirim üretir.

İki tetikleyici vardır:
  * Yeni sensör okuması kaydedildiğinde → eşik kuralları
  * Arka plan görevi (dakikada bir) → çevrimdışı kuralları

Aynı uyarının sürekli tekrarlanmaması için her kuralın bir bekleme
(cooldown) süresi vardır.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal
from app.models import AlertRule, Device, Notification, Sensor, SensorReading
from app.models.enums import AlertComparison, AlertKind
from app.services.realtime import hub

logger = logging.getLogger(__name__)

# Çevrimdışı kurallarının kontrol sıklığı
OFFLINE_CHECK_INTERVAL_SECONDS = 60


async def evaluate_device_alerts(device_id: uuid.UUID) -> int:
    """Bir cihazın tüm etkin kurallarını değerlendirir.

    Üretilen bildirim sayısını döndürür.
    """
    async with SessionLocal() as session:
        rules = (
            await session.execute(
                select(AlertRule).where(
                    AlertRule.device_id == device_id, AlertRule.enabled.is_(True)
                )
            )
        ).scalars().all()

        if not rules:
            return 0

        device = await session.get(Device, device_id)
        if device is None:
            return 0

        created = 0
        for rule in rules:
            if _in_cooldown(rule):
                continue

            triggered = (
                await _check_sensor_rule(session, rule)
                if rule.kind is AlertKind.SENSOR_THRESHOLD
                else _check_offline_rule(rule, device)
            )
            if triggered is None:
                continue

            title, message = triggered
            notification = Notification(
                device_id=device_id,
                rule_id=rule.id,
                title=title,
                message=message,
                level=rule.level,
            )
            session.add(notification)
            rule.last_triggered_at = datetime.now(timezone.utc)
            created += 1

        if created:
            await session.commit()
            # Çan ikonu anında güncellensin
            await hub.broadcast(
                str(device_id),
                {"type": "notification", "payload": {"count": created}},
            )

        return created


def _in_cooldown(rule: AlertRule) -> bool:
    if rule.last_triggered_at is None:
        return False
    elapsed = datetime.now(timezone.utc) - _aware(rule.last_triggered_at)
    return elapsed < timedelta(minutes=max(1, rule.cooldown_minutes))


async def _check_sensor_rule(
    session: AsyncSession, rule: AlertRule
) -> tuple[str, str] | None:
    """Sensörün son okumasını eşikle karşılaştırır."""
    if rule.sensor_id is None or rule.threshold is None:
        return None

    sensor = await session.get(Sensor, rule.sensor_id)
    if sensor is None:
        return None

    reading = (
        await session.execute(
            select(SensorReading)
            .where(SensorReading.sensor_id == rule.sensor_id)
            .order_by(SensorReading.read_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if reading is None:
        return None

    breached = (
        reading.value < rule.threshold
        if rule.comparison is AlertComparison.BELOW
        else reading.value > rule.threshold
    )
    if not breached:
        return None

    direction = "altına düştü" if rule.comparison is AlertComparison.BELOW else "üzerine çıktı"
    unit = sensor.unit or ""
    return (
        rule.name,
        f"{sensor.label} {reading.value:.1f}{unit} — eşik {rule.threshold:.1f}{unit} {direction}.",
    )


def _check_offline_rule(rule: AlertRule, device: Device) -> tuple[str, str] | None:
    """Cihazdan uzun süredir haber alınamadıysa uyarır."""
    limit = timedelta(minutes=max(1, rule.offline_minutes))

    if device.last_seen_at is None:
        # Hiç bağlanmamış bir cihaz için uyarı üretmek gürültü olur
        return None

    elapsed = datetime.now(timezone.utc) - _aware(device.last_seen_at)
    if elapsed < limit:
        return None

    minutes = int(elapsed.total_seconds() // 60)
    return (rule.name, f"{device.name} {minutes} dakikadır haber vermiyor.")


def _aware(value: datetime) -> datetime:
    """SQLite saat dilimi bilgisini kaybedebiliyor; UTC varsay."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


# --------------------------------------------------------------------------- #
# Arka plan görevi
# --------------------------------------------------------------------------- #


class AlertWatcher:
    """Çevrimdışı kurallarını düzenli aralıkla kontrol eden arka plan görevi."""

    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        self._task = asyncio.create_task(self._loop(), name="alert-watcher")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(OFFLINE_CHECK_INTERVAL_SECONDS)
            try:
                await self._check_all()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Uyarı kontrolü başarısız")

    @staticmethod
    async def _check_all() -> None:
        async with SessionLocal() as session:
            device_ids = (
                await session.execute(
                    select(AlertRule.device_id)
                    .where(
                        AlertRule.enabled.is_(True),
                        AlertRule.kind == AlertKind.DEVICE_OFFLINE,
                    )
                    .distinct()
                )
            ).scalars().all()

        for device_id in device_ids:
            with contextlib.suppress(Exception):
                await evaluate_device_alerts(device_id)


watcher = AlertWatcher()
