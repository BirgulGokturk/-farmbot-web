"""API bağımlılıkları: aktif kullanıcı ve sahipliği doğrulanmış cihaz."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, Path, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import decode_token
from app.db.session import get_db
from app.models import Device, User

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_PREFIX}/auth/login", auto_error=True
)

DbSession = Annotated[AsyncSession, Depends(get_db)]


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: DbSession,
) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Kimlik doğrulanamadı",
        headers={"WWW-Authenticate": "Bearer"},
    )

    payload = decode_token(token, expected_type="access")
    if payload is None:
        raise credentials_error

    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError):
        raise credentials_error from None

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise credentials_error
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_owned_device(
    device_id: Annotated[uuid.UUID, Path(description="Cihaz kimliği")],
    user: CurrentUser,
    db: DbSession,
) -> Device:
    """Cihazı getirir ve isteği yapan kullanıcıya ait olduğunu doğrular.

    Başkasının cihazı için 404 döndürülür (403 yerine) — böylece cihaz kimliğinin
    var olup olmadığı sızdırılmaz.
    """
    result = await db.execute(
        select(Device).where(Device.id == device_id, Device.user_id == user.id)
    )
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(status_code=404, detail="Cihaz bulunamadı")
    return device


OwnedDevice = Annotated[Device, Depends(get_owned_device)]


def ensure_unlocked(device: Device) -> None:
    """Acil durdurma aktifken hareket komutlarını engelle."""
    if device.is_locked:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail="Robot acil durdurma kilidinde. Önce kilidi açın.",
        )
