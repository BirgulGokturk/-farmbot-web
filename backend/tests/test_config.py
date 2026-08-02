"""Ayar ayrıştırma testleri.

Bu testler gerçek bir dağıtım hatasından doğdu: `CORS_ORIGINS` alanı `list[str]`
olduğu için pydantic-settings ortam değişkenini önce JSON olarak ayrıştırmaya
çalışıyor ve Render'ın gönderdiği `farmbot-hmi.onrender.com` değerinde uygulama
daha açılmadan çöküyordu. `NoDecode` ile çözüldü; buradaki testler aynı hatanın
sessizce geri gelmesini engeller.
"""

from __future__ import annotations

import importlib

import pytest


def _settings(monkeypatch: pytest.MonkeyPatch, **env: str):
    """Verilen ortam değişkenleriyle taze bir Settings örneği üretir."""
    for key, value in env.items():
        monkeypatch.setenv(key, value)

    import app.core.config as config

    importlib.reload(config)
    return config.Settings()


class TestCorsOrigins:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            # Render Blueprint `fromService.host` değerini şemasız gönderir
            ("farmbot-hmi.onrender.com", ["https://farmbot-hmi.onrender.com"]),
            # Virgülle ayrılmış çoklu adres
            ("https://a.com,https://b.com", ["https://a.com", "https://b.com"]),
            # Boşluklar ve eksik şema bir arada
            ("a.com, b.com ", ["https://a.com", "https://b.com"]),
            # Sondaki eğik çizgi CORS eşleşmesini bozar, temizlenmeli
            ("http://localhost:5173/", ["http://localhost:5173"]),
            # JSON dizi biçimi de desteklenmeli
            ('["https://x.com","https://y.com"]', ["https://x.com", "https://y.com"]),
        ],
    )
    def test_parses_supported_formats(
        self, monkeypatch: pytest.MonkeyPatch, raw: str, expected: list[str]
    ) -> None:
        assert _settings(monkeypatch, CORS_ORIGINS=raw).CORS_ORIGINS == expected

    def test_empty_entries_are_dropped(self, monkeypatch: pytest.MonkeyPatch) -> None:
        assert _settings(monkeypatch, CORS_ORIGINS="a.com,,b.com").CORS_ORIGINS == [
            "https://a.com",
            "https://b.com",
        ]


class TestDatabaseUrl:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            # Render ve Heroku bu biçimi verir
            ("postgres://u:p@h:5432/d", "postgresql+asyncpg://u:p@h:5432/d"),
            ("postgresql://u:p@h:5432/d", "postgresql+asyncpg://u:p@h:5432/d"),
            # Zaten doğru olan değer bozulmamalı
            ("postgresql+asyncpg://u:p@h/d", "postgresql+asyncpg://u:p@h/d"),
            ("sqlite+aiosqlite:///./x.db", "sqlite+aiosqlite:///./x.db"),
        ],
    )
    def test_rewrites_to_async_driver(
        self, monkeypatch: pytest.MonkeyPatch, raw: str, expected: str
    ) -> None:
        assert _settings(monkeypatch, DATABASE_URL=raw).DATABASE_URL == expected

    def test_is_sqlite_flag(self, monkeypatch: pytest.MonkeyPatch) -> None:
        assert _settings(monkeypatch, DATABASE_URL="sqlite+aiosqlite:///./x.db").is_sqlite
        assert not _settings(monkeypatch, DATABASE_URL="postgres://u:p@h/d").is_sqlite
