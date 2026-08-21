"""Uygulama ayarları — tamamı ortam değişkenlerinden (.env) okunur (12-Factor)."""

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Genel ---
    APP_NAME: str = "FarmBot Web API"
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"
    DEBUG: bool = True
    API_V1_PREFIX: str = "/api/v1"

    # --- Veritabanı ---
    # Docker'sız hızlı deneme için varsayılan SQLite; üretimde .env ile Postgres verilir.
    DATABASE_URL: str = "sqlite+aiosqlite:///./farmbot.db"
    DB_ECHO: bool = False

    # --- Güvenlik ---
    SECRET_KEY: str = "gelistirme-icin-guvensiz-anahtar-uretimde-mutlaka-degistir"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 1 gün
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # --- Yerel ağ kipi ---
    # Ön yüzün derlenmiş hâlinin yolu. Doluysa API aynı adresten hem arayüzü
    # hem veriyi sunuyor ve buluta hiç ihtiyaç kalmıyor.
    #
    # Neden işe yarıyor: arayüz `VITE_API_URL` boşken API'yi kendi origin'inde
    # arıyor, WebSocket adresini de `window.location.origin`'den türetiyor.
    # Yani tek adres (http://<pi-adresi>:8000) her şeyi karşılıyor; ayrı bir
    # ayar, ayrı bir port ve CORS gerekmiyor.
    FRONTEND_DIST: str | None = None

    # --- Gantry Studio'yu panelin içinde göstermek ---
    #
    # Ortağın hareket arayüzü Pi'de ayrı bir sunucuda (localhost:8091) çalışıyor
    # ve sahada kusursuz çalışan kısım orası. Panelin içinde bir sekmede
    # göstermek istiyoruz ama tarayıcılar HTTPS bir sayfanın içine HTTP bir
    # sayfa gömülmesini engelliyor ("karışık içerik"), üstelik Pi'nin yerel
    # adresi dışarıdan erişilebilir de değil.
    #
    # Çözüm: istekleri kendi sunucumuz üzerinden geçirmek. Böylece tarayıcı
    # açısından her şey tek bir kaynaktan (aynı adres, aynı sertifika) geliyor.
    #
    # Boşsa hiçbir şey değişmiyor; bulut kurulumu aynen çalışmaya devam ediyor.
    GANTRY_PROXY_URL: str | None = None

    # --- CORS ---
    # NoDecode şart: pydantic-settings, liste tipindeki alanları ortam
    # değişkeninden okurken önce JSON olarak ayrıştırmayı dener ve
    # "a.com,b.com" gibi bir değerde daha doğrulayıcıya sıra gelmeden
    # SettingsError fırlatır. NoDecode ham metni aşağıdaki doğrulayıcıya iletir.
    CORS_ORIGINS: Annotated[list[str], NoDecode] = Field(
        default=["http://localhost:5173", "http://127.0.0.1:5173"]
    )

    # --- MQTT (robot haberleşmesi) ---
    MQTT_HOST: str = "localhost"
    MQTT_PORT: int = 1883
    MQTT_USERNAME: str | None = None
    MQTT_PASSWORD: str | None = None
    MQTT_TLS: bool = False
    MQTT_CLIENT_ID: str = "farmbot-backend"
    MQTT_ENABLED: bool = True
    MQTT_KEEPALIVE: int = 30
    # Robotun bir RPC komutuna kaç saniyede yanıt vermesi beklenir
    RPC_TIMEOUT_SECONDS: float = 15.0

    # --- Medya (kamera fotoğrafları) ---
    MEDIA_ROOT: str = "./media"
    MEDIA_URL_PREFIX: str = "/media"

    # --- Simülatör ---
    # Gerçek robot bağlı değilken paneli canlı tutan sanal FarmBot.
    # MQTT bağlantısı kurulduğunda otomatik olarak devre dışı kalır.
    SIMULATOR_ENABLED: bool = True

    # --- Uyarılar ---
    # Cihaz bu süre boyunca haber vermezse "çevrimdışı" uyarısı üretilir
    DEVICE_OFFLINE_AFTER_SECONDS: int = 300

    # --- Demo veri ---
    SEED_DEMO_DATA: bool = True

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        """Virgülle ayrılmış listeyi böler ve şeması eksik adresleri tamamlar.

        Bulut sağlayıcıları (ör. Render Blueprint) servis adresini şemasız,
        sadece "app.onrender.com" biçiminde verir; CORS eşleşmesi için başına
        https:// koymak gerekir.
        """
        if isinstance(v, str):
            text = v.strip()
            # NoDecode JSON çözümlemesini kapattığı için JSON dizi biçimini
            # burada elle destekliyoruz: ["https://a.com","https://b.com"]
            if text.startswith("["):
                import json

                try:
                    items = [str(item) for item in json.loads(text)]
                except (json.JSONDecodeError, TypeError):
                    items = [text]
            else:
                items = [origin.strip() for origin in text.split(",")]
        else:
            items = [str(item) for item in (v or [])]  # type: ignore[union-attr]
        normalized: list[str] = []
        for origin in items:
            if not origin:
                continue
            if "://" not in origin:
                origin = f"https://{origin}"
            normalized.append(origin.rstrip("/"))
        return normalized

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def _use_async_driver(cls, v: object) -> object:
        """Sağlayıcıların verdiği senkron URL'yi async sürücüye çevirir.

        Render/Heroku `postgres://…` ya da `postgresql://…` verir; SQLAlchemy'nin
        async motoru `postgresql+asyncpg://…` bekler. Elle düzeltmeyi unutmak
        dağıtımda "sürücü bulunamadı" hatasına yol açtığı için burada normalize
        ediyoruz.
        """
        if not isinstance(v, str):
            return v
        if v.startswith("postgres://"):
            return v.replace("postgres://", "postgresql+asyncpg://", 1)
        if v.startswith("postgresql://"):
            return v.replace("postgresql://", "postgresql+asyncpg://", 1)
        return v

    @property
    def is_sqlite(self) -> bool:
        return self.DATABASE_URL.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
