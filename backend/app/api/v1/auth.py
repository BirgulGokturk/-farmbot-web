"""Kayıt, giriş ve token yenileme."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core.security import create_token, decode_token, hash_password, verify_password
from app.models import User
from app.schemas.auth import RefreshRequest, TokenPair, UserCreate, UserRead

router = APIRouter(prefix="/auth", tags=["Kimlik"])


def _issue_tokens(user: User) -> TokenPair:
    return TokenPair(
        access_token=create_token(user.id, "access"),
        refresh_token=create_token(user.id, "refresh"),
        user=UserRead.model_validate(user),
    )


@router.post("/register", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
async def register(payload: UserCreate, db: DbSession) -> TokenPair:
    """Yeni hesap oluşturur ve doğrudan giriş yaptırır."""
    existing = await db.execute(select(User).where(User.email == payload.email.lower()))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Bu e-posta zaten kayıtlı")

    user = User(
        email=payload.email.lower(),
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        timezone=payload.timezone,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _issue_tokens(user)


@router.post("/login", response_model=TokenPair)
async def login(
    db: DbSession,
    form: OAuth2PasswordRequestForm = Depends(),
) -> TokenPair:
    """OAuth2 parola akışı — `username` alanına e-posta girilir."""
    result = await db.execute(select(User).where(User.email == form.username.lower()))
    user = result.scalar_one_or_none()

    # Kullanıcı yoksa da parola doğrulama maliyetini ödeyerek zamanlama sızıntısını azalt
    if user is None or not verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="E-posta veya parola hatalı",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Hesap devre dışı")

    return _issue_tokens(user)


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, db: DbSession) -> TokenPair:
    claims = decode_token(payload.refresh_token, expected_type="refresh")
    if claims is None:
        raise HTTPException(status_code=401, detail="Yenileme token'ı geçersiz")

    try:
        user_id = uuid.UUID(claims["sub"])
    except (KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Yenileme token'ı geçersiz") from None

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Hesap bulunamadı")
    return _issue_tokens(user)


@router.get("/me", response_model=UserRead)
async def me(user: CurrentUser) -> User:
    return user
