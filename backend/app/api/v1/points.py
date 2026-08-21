"""Bahçedeki noktalar — Tarla Tasarımcısı'nın veri kaynağı."""

from __future__ import annotations

import random
import uuid

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.api.deps import DbSession, OwnedDevice
from app.db.base import utcnow
from app.models import PlantSpecies, Point
from app.models.enums import PointType
from app.schemas.common import Message
from app.schemas.garden import (
    PointBulkMove,
    PointCreate,
    PointRead,
    PointScatter,
    PointScatterResult,
    PointUpdate,
)
from app.services import machine_config

router = APIRouter(prefix="/devices/{device_id}/points", tags=["Bahçe"])


@router.get("", response_model=list[PointRead])
async def list_points(
    device: OwnedDevice,
    db: DbSession,
    point_type: PointType | None = Query(default=None, description="Tür filtresi"),
    include_discarded: bool = Query(default=False, description="Silinmişleri de getir"),
) -> list[Point]:
    stmt = select(Point).where(Point.device_id == device.id)
    if point_type is not None:
        stmt = stmt.where(Point.point_type == point_type)
    if not include_discarded:
        stmt = stmt.where(Point.discarded_at.is_(None))

    result = await db.execute(stmt.order_by(Point.created_at))
    return list(result.scalars().all())


@router.post("", response_model=PointRead, status_code=status.HTTP_201_CREATED)
async def create_point(payload: PointCreate, device: OwnedDevice, db: DbSession) -> Point:
    """Tasarımcıda bir bitki/işaretçi bırakıldığında çağrılır."""
    _assert_in_bounds(device, payload.x, payload.y)

    data = payload.model_dump()

    # Yarıçap verilmediyse türün yayılma değerinden türet
    if data.get("species_id") and data.get("radius_mm") == 25.0:
        species = await db.get(PlantSpecies, data["species_id"])
        if species is not None:
            data["radius_mm"] = species.spread_mm / 2

    point = Point(device_id=device.id, **data)
    db.add(point)
    await db.commit()
    await db.refresh(point)
    return point


@router.patch("/{point_id}", response_model=PointRead)
async def update_point(
    point_id: uuid.UUID, payload: PointUpdate, device: OwnedDevice, db: DbSession
) -> Point:
    point = await _get_point(db, device.id, point_id)

    updates = payload.model_dump(exclude_unset=True)
    if "x" in updates or "y" in updates:
        _assert_in_bounds(device, updates.get("x", point.x), updates.get("y", point.y))

    for field, value in updates.items():
        setattr(point, field, value)

    await db.commit()
    await db.refresh(point)
    return point


@router.post("/bulk-move", response_model=list[PointRead])
async def bulk_move(payload: PointBulkMove, device: OwnedDevice, db: DbSession) -> list[Point]:
    """Tasarımcıda çoklu seçim sürüklendiğinde tek istekte kaydeder."""
    ids = [move.id for move in payload.moves]
    result = await db.execute(
        select(Point).where(Point.device_id == device.id, Point.id.in_(ids))
    )
    by_id = {point.id: point for point in result.scalars().all()}

    missing = [str(i) for i in ids if i not in by_id]
    if missing:
        raise HTTPException(404, detail=f"Nokta bulunamadı: {', '.join(missing)}")

    for move in payload.moves:
        _assert_in_bounds(device, move.x, move.y)
        point = by_id[move.id]
        point.x = move.x
        point.y = move.y
        if move.z is not None:
            point.z = move.z

    await db.commit()
    return [by_id[move.id] for move in payload.moves]


@router.post("/scatter", response_model=PointScatterResult)
async def scatter_points(
    payload: PointScatter, device: OwnedDevice, db: DbSession
) -> PointScatterResult:
    """Ekim alanına rastgele bitki serpiştirir.

    Neden rastgele ama denetimli:
      Tamamen rastgele noktalar üst üste biner; iki fide aynı çukura düşer.
      Bu yüzden her aday nokta, hem daha önce yerleştirilenlerden hem de
      (istenirse) bahçedeki mevcut bitkilerden yayılma çapı kadar uzak olmak
      zorunda. Aday tutmazsa yenisi deneniyor.

      Alan dolduğunda sonsuza kadar denemek yerine pes ediyoruz ve kaç tane
      yerleştirilemediğini **söylüyoruz**. Sessizce eksik ekmek, kullanıcının
      "20 tane istedim, 12 tane var" diye sonradan fark edeceği bir sürpriz olurdu.
    """
    species = await db.get(PlantSpecies, payload.species_id)
    if species is None:
        raise HTTPException(404, detail="Bitki türü bulunamadı")

    x_min, x_max, y_min, y_max = machine_config.planting_bounds(device)

    spread = payload.spread_mm if payload.spread_mm is not None else float(species.spread_mm)
    radius = spread / 2

    # Bitkinin gövdesi ekim alanının dışına taşmasın: merkez, kenardan
    # yarıçap kadar içeride başlasın. Alan yarıçaptan darsa ortaya tek sıra.
    ax_min, ax_max = x_min + radius, x_max - radius
    ay_min, ay_max = y_min + radius, y_max - radius
    if ax_min > ax_max:
        ax_min = ax_max = (x_min + x_max) / 2
    if ay_min > ay_max:
        ay_min = ay_max = (y_min + y_max) / 2

    yerlesik: list[tuple[float, float]] = []
    if payload.avoid_existing:
        mevcut = await db.execute(
            select(Point.x, Point.y).where(
                Point.device_id == device.id,
                Point.point_type == PointType.PLANT,
                Point.discarded_at.is_(None),
            )
        )
        yerlesik = [(row.x, row.y) for row in mevcut]

    # `seed` verilirse aynı istek aynı deseni üretiyor: önizlemede gördüğü
    # yerleşimin ekim sırasında değişmemesi gerekiyor.
    rastgele = random.Random(payload.seed)

    # Her bitki için sınırlı deneme: alan dolduysa döngü kilitlenmesin
    DENEME_HAKKI = 60
    yeni_noktalar: list[Point] = []

    for _ in range(payload.count):
        for _ in range(DENEME_HAKKI):
            x = rastgele.uniform(ax_min, ax_max)
            y = rastgele.uniform(ay_min, ay_max)
            # İki bitkinin merkezleri, yayılma çapından yakın olmamalı
            if all((x - px) ** 2 + (y - py) ** 2 >= spread**2 for px, py in yerlesik):
                yerlesik.append((x, y))
                yeni_noktalar.append(
                    Point(
                        device_id=device.id,
                        point_type=PointType.PLANT,
                        name=species.name_tr,
                        x=round(x, 1),
                        y=round(y, 1),
                        z=0.0,
                        radius_mm=radius,
                        species_id=species.id,
                        depth_mm=species.sow_depth_mm,
                    )
                )
                break

    db.add_all(yeni_noktalar)
    await db.commit()
    for point in yeni_noktalar:
        await db.refresh(point)

    yerlesen = len(yeni_noktalar)
    atlanan = payload.count - yerlesen
    detay = f"{yerlesen} {species.name_tr} ekim alanına yerleştirildi"
    if atlanan:
        detay += (
            f"; {atlanan} tanesine yer kalmadı "
            f"({spread:.0f} mm aralıkla alan doldu)"
        )

    return PointScatterResult(
        created=[PointRead.model_validate(p) for p in yeni_noktalar],
        requested=payload.count,
        placed=yerlesen,
        skipped=atlanan,
        detail=detay,
    )


@router.delete("/{point_id}", response_model=Message)
async def delete_point(
    point_id: uuid.UUID,
    device: OwnedDevice,
    db: DbSession,
    permanent: bool = Query(default=False, description="Kalıcı sil"),
) -> Message:
    """Varsayılan olarak yumuşak silme yapar — kayıt bir süre geri alınabilir kalır."""
    point = await _get_point(db, device.id, point_id)

    if permanent:
        await db.delete(point)
        await db.commit()
        return Message(detail="Nokta kalıcı olarak silindi")

    point.discarded_at = utcnow()
    await db.commit()
    return Message(detail="Nokta silindi (geri alınabilir)")


@router.post("/{point_id}/restore", response_model=PointRead)
async def restore_point(point_id: uuid.UUID, device: OwnedDevice, db: DbSession) -> Point:
    point = await _get_point(db, device.id, point_id)
    point.discarded_at = None
    await db.commit()
    await db.refresh(point)
    return point


# --------------------------------------------------------------------------- #
# Yardımcılar
# --------------------------------------------------------------------------- #

async def _get_point(db: DbSession, device_id: uuid.UUID, point_id: uuid.UUID) -> Point:
    result = await db.execute(
        select(Point).where(Point.id == point_id, Point.device_id == device_id)
    )
    point = result.scalar_one_or_none()
    if point is None:
        raise HTTPException(status_code=404, detail="Nokta bulunamadı")
    return point


def _assert_in_bounds(device, x: float, y: float) -> None:
    """Bitkiyi **ekilebilir alanın** dışına koymayı baştan engelle.

    Neden yatak ölçüsü değil de ekim alanı: yatağın kenarıyla toprağın
    başladığı yer aynı değil — arada profil, kablo kanalı, saksı duvarı var.
    Yatak ölçüsüne bakmak, tohumu toprağa değil metale bırakan bir plana
    "geçerli" demek olurdu.

    Kural tek yerde: `machine_config.planting_bounds`. Tasarımcıdan sürükleme,
    koordinat düzenleme, toplu taşıma, rastgele serpiştirme ve ekim komutu —
    hepsi buradan geçiyor. Ayrı ayrı yazılsalardı biri güncellenip diğeri
    kalırdı ve panel kendi kuralına uymayan bir plan üretirdi.
    """
    x_min, x_max, y_min, y_max = machine_config.planting_bounds(device)

    if not (x_min <= x <= x_max):
        raise HTTPException(
            422,
            detail=(
                f"X koordinatı ekim alanının dışında "
                f"({x_min:.0f}–{x_max:.0f} mm). "
                "Alanı Tarla Tasarımcısı → Ekim Alanı panelinden değiştirebilirsiniz."
            ),
        )
    if not (y_min <= y <= y_max):
        raise HTTPException(
            422,
            detail=(
                f"Y koordinatı ekim alanının dışında "
                f"({y_min:.0f}–{y_max:.0f} mm). "
                "Alanı Tarla Tasarımcısı → Ekim Alanı panelinden değiştirebilirsiniz."
            ),
        )
