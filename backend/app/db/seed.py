"""Başlangıç verisi: bitki kataloğu ve isteğe bağlı demo hesabı.

Idempotent'tir — her açılışta çalıştırılabilir, var olan kaydı tekrar eklemez.
"""

from __future__ import annotations

import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.models import (
    Device,
    Peripheral,
    PlantSpecies,
    Sensor,
    Tool,
    User,
)
from app.models.enums import PeripheralKind, SunRequirement
from app.services.channels import describe_channel

logger = logging.getLogger(__name__)

# Not: `.local` gibi özel amaçlı alan adları e-posta doğrulayıcı tarafından reddedilir.
DEMO_EMAIL = "demo@farmbot.dev"
DEMO_PASSWORD = "farmbot123"

# (slug, ad, ikon, renk, yayılma mm, ekim derinliği mm, hasat günü, günlük su ml, güneş)
SPECIES: list[tuple[str, str, str, str, int, int, int, int, SunRequirement]] = [
    ("domates",   "Domates",   "🍅", "#ef4444", 460, 15,  90, 500, SunRequirement.FULL),
    ("salatalik", "Salatalık", "🥒", "#22c55e", 400, 20,  60, 450, SunRequirement.FULL),
    ("marul",     "Marul",     "🥬", "#4ade80", 250,  5,  45, 250, SunRequirement.PARTIAL),
    ("biber",     "Biber",     "🌶️", "#f97316", 350, 10,  80, 400, SunRequirement.FULL),
    ("patlican",  "Patlıcan",  "🍆", "#a855f7", 450, 15, 100, 480, SunRequirement.FULL),
    ("havuc",     "Havuç",     "🥕", "#fb923c", 100,  8,  75, 180, SunRequirement.FULL),
    ("sogan",     "Soğan",     "🧅", "#fbbf24", 120, 20, 110, 150, SunRequirement.FULL),
    ("sarimsak",  "Sarımsak",  "🧄", "#e5e7eb", 120, 40, 240, 120, SunRequirement.FULL),
    ("kabak",     "Kabak",     "🎃", "#f59e0b", 900, 25,  55, 700, SunRequirement.FULL),
    ("misir",     "Mısır",     "🌽", "#facc15", 300, 40,  95, 400, SunRequirement.FULL),
    ("cilek",     "Çilek",     "🍓", "#f43f5e", 300, 10, 120, 300, SunRequirement.PARTIAL),
    ("ispanak",   "Ispanak",   "🌿", "#16a34a", 180,  8,  40, 220, SunRequirement.PARTIAL),
    ("brokoli",   "Brokoli",   "🥦", "#15803d", 450, 12,  85, 420, SunRequirement.FULL),
    ("turp",      "Turp",      "🌰", "#fda4af",  80,  8,  28, 140, SunRequirement.PARTIAL),
    ("fesleğen",  "Fesleğen",  "🌱", "#65a30d", 200,  5,  50, 200, SunRequirement.PARTIAL),
    ("nane",      "Nane",      "🍃", "#10b981", 250,  5,  60, 260, SunRequirement.SHADE),
]


async def seed_plant_species(session: AsyncSession) -> int:
    """Bitki kataloğunu doldurur. Eklenen yeni kayıt sayısını döndürür."""
    existing = await session.execute(select(PlantSpecies.slug))
    known = {row[0] for row in existing.all()}

    added = 0
    for slug, name, icon, color, spread, depth, days, water, sun in SPECIES:
        if slug in known:
            continue
        session.add(
            PlantSpecies(
                slug=slug,
                name_tr=name,
                icon=icon,
                color=color,
                spread_mm=spread,
                sow_depth_mm=depth,
                days_to_harvest=days,
                water_ml_per_day=water,
                sun_requirement=sun,
            )
        )
        added += 1

    if added:
        await session.commit()
        logger.info("Bitki kataloğuna %d tür eklendi", added)
    return added


async def seed_demo_account(session: AsyncSession) -> None:
    """Geliştirme için hazır bir hesap + robot + donanım tanımı oluşturur."""
    result = await session.execute(select(User).where(User.email == DEMO_EMAIL))
    if result.scalar_one_or_none() is not None:
        return

    user = User(
        email=DEMO_EMAIL,
        hashed_password=hash_password(DEMO_PASSWORD),
        full_name="Demo Kullanıcı",
    )
    session.add(user)
    await session.flush()  # user.id gerekiyor

    device = Device(
        user_id=user.id,
        name="Bahçe Robotu",
        model="Genesis XL v1.8",
        serial_number="DEMO-XL-0001",
        bed_width_mm=5900,
        bed_length_mm=2900,
        max_z_mm=400,
        soil_height_mm=-300,
        lat=41.0082,
        lng=28.9784,
    )
    session.add(device)
    await session.flush()

    session.add_all(
        [
            Peripheral(device_id=device.id, label="Su Pompası", pin=8, icon="💧"),
            Peripheral(device_id=device.id, label="Vakum Pompası", pin=9, icon="🌀"),
            Peripheral(device_id=device.id, label="LED Aydınlatma", pin=7, icon="💡"),
            # SG-5010 servo — şimdilik yalnızca aç/kapa; görevi sonra belirlenecek
            Peripheral(
                device_id=device.id,
                label="Servo (SG-5010)",
                pin=6,
                icon="🔀",
                kind=PeripheralKind.SERVO,
                servo_open_angle=90,
                servo_closed_angle=0,
            ),
        ]
    )
    # Kanallar gerçek donanımla birebir aynı: köprü ajanı bağlandığında
    # ölçümler doğrudan bu kayıtlara düşer, elle eşleştirme gerekmez.
    session.add_all(
        [
            Sensor(device_id=device.id, channel=channel, label=spec.label, kind=spec.kind,
                   unit=spec.unit, icon=spec.icon,
                   min_value=spec.min_value, max_value=spec.max_value,
                   pin=pin)
            for channel, pin in (
                ("hw103_soil", 59),          # HW-103 analog çıkış
                ("hw103_rain", 62),          # HW-103 dijital çıkış
                ("dht_temperature", 63),     # DHT11/DHT22 tek hat
                ("dht_humidity", 63),
                ("bmp180_temperature", None),  # BMP180 I²C — pin yok
                ("bmp180_pressure", None),
                ("bmp180_altitude", None),
            )
            for spec in (describe_channel(channel),)
        ]
    )
    session.add_all(
        [
            Tool(device_id=device.id, name="Sulama Ucu", icon="💦", flow_rate_ml_per_s=8.0),
            Tool(device_id=device.id, name="Ekici", icon="🌱"),
            Tool(device_id=device.id, name="Toprak Sensörü", icon="📡"),
            Tool(device_id=device.id, name="Yabani Ot Sökücü", icon="🪓"),
        ]
    )

    await session.commit()
    logger.info("Demo hesap oluşturuldu: %s / %s", DEMO_EMAIL, DEMO_PASSWORD)


async def run_seed(session: AsyncSession, include_demo: bool = True) -> None:
    await seed_plant_species(session)
    if include_demo:
        # Hiç kullanıcı yoksa demo hesabı aç — mevcut kurulumu kirletme
        count = await session.scalar(select(func.count()).select_from(User))
        if not count:
            await seed_demo_account(session)
