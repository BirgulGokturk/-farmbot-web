"""Şemalarda tekrar eden temel yapılar."""

from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict

T = TypeVar("T")


class ORMModel(BaseModel):
    """SQLAlchemy nesnesinden doğrudan doldurulabilen yanıt modeli."""

    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    """Sayfalanmış liste yanıtı."""

    items: list[T]
    total: int
    limit: int
    offset: int


class Message(BaseModel):
    """Basit durum yanıtı."""

    detail: str
