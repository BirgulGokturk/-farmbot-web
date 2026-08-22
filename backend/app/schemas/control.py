"""Manuel kontrol ve robot komut şemaları."""

from __future__ import annotations

import uuid
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from app.models.enums import Axis


class SpotAction(str, Enum):
    """Serbest koordinatta yapılabilecek işler."""

    SOW = "sow"                  # tohum al, oraya bırak
    WATER = "water"              # reçeteye göre sula
    SOIL_PROBE = "soil_probe"    # probu batır, nem oku


class MoveRelativeRequest(BaseModel):
    """Jog pad: bulunduğu yerden göreli adım."""

    x: float = Field(default=0, ge=-10000, le=10000)
    y: float = Field(default=0, ge=-10000, le=10000)
    z: float = Field(default=0, ge=-10000, le=10000)
    speed: int = Field(default=100, ge=1, le=100)


class MoveAbsoluteRequest(BaseModel):
    """Belirli bir koordinata git."""

    x: float = Field(ge=-1000, le=20000)
    y: float = Field(ge=-1000, le=20000)
    z: float = Field(ge=-5000, le=1000)
    speed: int = Field(default=100, ge=1, le=100)


class HomeRequest(BaseModel):
    axis: Axis = Axis.ALL
    speed: int = Field(default=100, ge=1, le=100)
    find: bool = False  # true → sınır anahtarıyla gerçek evi bul


class PinWriteRequest(BaseModel):
    pin: int = Field(ge=0, le=69)
    value: int = Field(ge=0, le=255)
    mode: int = Field(default=0, ge=0, le=1)


class PinReadRequest(BaseModel):
    pin: int = Field(ge=0, le=69)
    mode: int = Field(default=1, ge=0, le=1)


class WaterPointRequest(BaseModel):
    """Bir bitkiyi sula. Süre doğrudan ya da su hacminden hesaplanarak verilir."""

    point_id: uuid.UUID
    duration_ms: int | None = Field(default=None, gt=0, le=600_000)
    volume_ml: int | None = Field(default=None, gt=0, le=100_000)
    # Boş bırakılırsa görevi "su pompası" olan çevre birimi kullanılıyor.
    # Sabit 8 varsayımı, kullanıcının kendi tanımını yok sayıyordu.
    pump_pin: int | None = Field(default=None, ge=0, le=69)
    speed: int = Field(default=100, ge=1, le=100)


class SowRequest(BaseModel):
    """Vakumlu uçla tohum ek.

    `point_ids` boş bırakılırsa henüz ekilmemiş (planlanan) tüm bitkiler
    sıraya alınır — "tasarımı olduğu gibi ek" hâli.
    """

    point_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)
    speed: int = Field(default=100, ge=1, le=100)
    # Ekim sonrası bitkiler "ekildi" olarak işaretlensin mi
    mark_planted: bool = True


class SpotTaskRequest(BaseModel):
    """Serbest koordinatta tek iş: oraya git ve şunu yap.

    Neden ayrı bir uç nokta: `sow` ve `water` kayıtlı bir bitkiye (Point)
    bağlı çalışıyor. Tasarımda yeri olmayan bir noktayı denemek, sulamayı
    ölçmek ya da tek bir tohum bırakmak için önce bitki kaydı açmak gerekiyordu
    — deneme yapmak isteyen biri için gereksiz bir yol.

    `species_id` yalnızca ekimde ve yalnızca derinlik için: tür katalogda bir
    derinlik taşıyorsa onu kullanmak, kullanıcının aynı sayıyı ezberden
    girmesinden iyi.
    """

    x: float = Field(ge=-1000, le=20000)
    y: float = Field(ge=-1000, le=20000)
    action: SpotAction
    speed: int = Field(default=100, ge=1, le=100)

    # Ekim
    depth_mm: float | None = Field(default=None, ge=0, le=500)
    species_id: uuid.UUID | None = None

    # Sulama — ikisi de boşsa reçetedeki süre geçerli
    duration_ms: int | None = Field(default=None, gt=0, le=600_000)
    volume_ml: int | None = Field(default=None, gt=0, le=100_000)

    # Toprak ölçümü — boşsa toprak nemi sensörü kendiliğinden bulunuyor
    sensor_id: uuid.UUID | None = None
    probe_depth_mm: float | None = Field(default=None, ge=0, le=500)


class ServoRequest(BaseModel):
    pin: int = Field(ge=0, le=69)
    angle: int = Field(ge=0, le=180)


class SurveyRequest(BaseModel):
    """Isı haritası için ızgara taraması."""

    sensor_id: uuid.UUID
    # 4×3 = 12 durak makul bir başlangıç; simülatörde ~1 dakika sürer
    columns: int = Field(default=4, ge=2, le=12)
    rows: int = Field(default=3, ge=2, le=12)
    speed: int = Field(default=100, ge=1, le=100)


class ExecuteSequenceRequest(BaseModel):
    sequence_id: uuid.UUID


class RawCommandRequest(BaseModel):
    """Ham CeleryScript adımları — dizi editöründe önizleme için."""

    body: list[dict[str, Any]] = Field(min_length=1, max_length=200)
    wait_for_response: bool = True


class CommandResponse(BaseModel):
    ok: bool
    label: str | None = None
    detail: str | None = None
    response: dict[str, Any] | None = None
