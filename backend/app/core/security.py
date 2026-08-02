"""Parola hash'leme ve JWT üretimi/doğrulaması."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import bcrypt
import jwt

from app.core.config import settings

# bcrypt 72 baytın üzerini sessizce yok sayar; kesmeyi açıkça yapıyoruz ki
# uzun parolalarda beklenmedik davranış olmasın.
_BCRYPT_MAX_BYTES = 72

TokenType = Literal["access", "refresh"]


def hash_password(password: str) -> str:
    payload = password.encode("utf-8")[:_BCRYPT_MAX_BYTES]
    return bcrypt.hashpw(payload, bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        payload = password.encode("utf-8")[:_BCRYPT_MAX_BYTES]
        return bcrypt.checkpw(payload, hashed.encode("utf-8"))
    except (ValueError, TypeError):
        # Bozuk/eski biçimli hash — girişi reddet, patlama.
        return False


def create_token(
    subject: str | uuid.UUID,
    token_type: TokenType = "access",
    extra_claims: dict[str, Any] | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    expires = (
        now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        if token_type == "access"
        else now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    )
    claims: dict[str, Any] = {
        "sub": str(subject),
        "type": token_type,
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
    }
    if extra_claims:
        claims.update(extra_claims)
    return jwt.encode(claims, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str, expected_type: TokenType = "access") -> dict[str, Any] | None:
    """Token'ı çözer. Geçersiz/süresi dolmuş/yanlış türdeyse None döner."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except jwt.PyJWTError:
        return None

    # Yenileme token'ının erişim token'ı yerine kullanılmasını engelle
    if payload.get("type") != expected_type:
        return None
    return payload
