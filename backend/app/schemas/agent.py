"""Köprü ajanı şemaları."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class AgentReadingItem(BaseModel):
    """Tek bir sensör ölçümü."""

    # Arduino yazılımındaki alan adı, ör. "bmp180_pressure"
    channel: str = Field(min_length=1, max_length=80)
    value: float
    # Robot konumu bilinmiyorsa cihazın son bilinen konumu kullanılır
    x: float | None = None
    y: float | None = None
    z: float | None = None
    read_at: datetime | None = None


class AgentIngestRequest(BaseModel):
    """Ajan ölçümleri paket halinde gönderir — her okuma için ayrı istek atmaz."""

    readings: list[AgentReadingItem] = Field(min_length=1, max_length=500)


class AgentIngestResult(BaseModel):
    stored: int
    # İlk kez görülen ve otomatik tanımlanan kanallar
    created_channels: list[str] = Field(default_factory=list)


class AgentTokenResponse(BaseModel):
    token: str
    created_at: datetime
    note: str


class AgentStatusRead(BaseModel):
    has_token: bool
    token_created_at: datetime | None
    connected: bool
    last_seen_at: datetime | None


class AgentPhotoResult(BaseModel):
    """Yükleme sonucu — ajan günlüğünde ne olduğu görünsün."""

    id: uuid.UUID
    url: str
    bytes: int
    # Saklama sınırı aşıldığı için silinen eski kare sayısı
    discarded: int = 0


class PairingCodeResponse(BaseModel):
    """Panelde gösterilen kısa ömürlü eşleştirme kodu."""

    code: str
    expires_at: datetime
    note: str


class AgentPairRequest(BaseModel):
    """Ajanın kodu kalıcı token'la takas isteği."""

    code: str = Field(min_length=4, max_length=32)


class AgentPairResponse(BaseModel):
    device_id: uuid.UUID
    device_name: str
    token: str


class AgentRotateResponse(BaseModel):
    """Yenilenmiş token.

    `previous_valid_until`: eski token bu ana kadar da kabul edilir. Ajan yeni
    token'ı diskine yazamadan çökerse kendini dışarıda bırakmasın diye.
    """

    token: str
    previous_valid_until: datetime
