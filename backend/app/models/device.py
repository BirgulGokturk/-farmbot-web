"""Robot (cihaz) kaydı — çalışma alanı ölçüleri ve son bilinen durum."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, JSONType, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.user import User


class Device(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "devices"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    # --- Kimlik ---
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    serial_number: Mapped[str | None] = mapped_column(String(120), unique=True)
    firmware_version: Mapped[str | None] = mapped_column(String(40))
    model: Mapped[str] = mapped_column(String(60), default="Genesis XL v1.8")

    # --- Konum / yerelleştirme ---
    timezone: Mapped[str] = mapped_column(String(64), default="Europe/Istanbul")
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    indoor: Mapped[bool] = mapped_column(Boolean, default=False)

    # --- Çalışma alanı (mm) — Genesis XL varsayılanları ---
    bed_width_mm: Mapped[int] = mapped_column(Integer, default=5900)   # X ekseni
    bed_length_mm: Mapped[int] = mapped_column(Integer, default=2900)  # Y ekseni
    max_z_mm: Mapped[int] = mapped_column(Integer, default=400)        # Z ekseni derinliği
    safe_height_mm: Mapped[int] = mapped_column(Integer, default=0)
    soil_height_mm: Mapped[int] = mapped_column(Integer, default=-300)

    # --- Robotun broker kimliği ---
    mqtt_username: Mapped[str | None] = mapped_column(String(120))
    mqtt_password_hash: Mapped[str | None] = mapped_column(String(255))

    # --- Raspberry Pi köprü ajanının kimliği ---
    # Ajan kullanıcı parolası taşımaz; cihaza özel bir token kullanır.
    # Token yalnızca üretildiği anda düz metin gösterilir, veritabanında hash tutulur.
    agent_token_hash: Mapped[str | None] = mapped_column(String(255))
    agent_token_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    agent_last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Token yenilendiğinde eskisi bir süre daha geçerli kalıyor.
    #
    # Sebebi: yenileme iki adımlı — sunucu yeni token'ı üretiyor, ajan onu
    # diskine yazıyor. Ajan tam arada çökerse (ya da elektrik giderse) yeni
    # token kaybolur, eskisi de geçersizdir ve robot kendini dışarıda bırakır.
    # Kurtarmak için Pi'ye fiziksel erişim gerekir. Kısa bir hoşgörü penceresi
    # bu riski tamamen kaldırıyor.
    agent_token_previous_hash: Mapped[str | None] = mapped_column(String(255))
    agent_token_rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # --- Eşleştirme kodu ---
    # 56 karakterlik token'ı elle taşımak yerine panelde kısa ömürlü bir kod
    # gösteriliyor; ajan onu kalıcı token'la takas edip kendi dosyasına yazıyor.
    # Kod tek kullanımlık ve dakikalar içinde sönüyor.
    pairing_code_hash: Mapped[str | None] = mapped_column(String(255))
    pairing_code_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Kaba kuvvet denemesini sınırlamak için: kod kısa, deneme sayısı da öyle olmalı
    pairing_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # --- Son bilinen durum (MQTT'den güncellenen önbellek) ---
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_x: Mapped[float] = mapped_column(Float, default=0.0)
    last_y: Mapped[float] = mapped_column(Float, default=0.0)
    last_z: Mapped[float] = mapped_column(Float, default=0.0)

    # --- Kamera ---
    camera_stream_url: Mapped[str | None] = mapped_column(String(500))

    # --- Esnek yapılandırma (firmware/kalibrasyon parametreleri) ---
    settings: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)

    user: Mapped["User"] = relationship(back_populates="devices")

    @property
    def is_online(self) -> bool:
        """Son 60 saniye içinde haber alındıysa çevrimiçi say.

        SQLite saat dilimi bilgisini saklamaz; okunan değer "naive" gelir.
        Zaman dilimli bir tarihten naive tarih çıkarmak TypeError verdiği için
        önce UTC varsayımıyla normalize ediyoruz.
        """
        if self.last_seen_at is None:
            return False

        from datetime import timezone

        from app.db.base import utcnow

        last_seen = self.last_seen_at
        if last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=timezone.utc)

        return (utcnow() - last_seen).total_seconds() < 60
