"""eslestirme_kodu

Ajan eşleştirmesini kolaylaştıran iki ekleme.

1) Eşleştirme kodu
   56 karakterlik token'ı panelden Pi'ye elle taşımak her seferinde bir
   kopyalama riski demekti; bir kez CRLF ile kaydedilen birim dosyası
   token'ın sonuna görünmez bir karakter ekleyip anlaşılmaz bir 403'e yol
   açtı. Artık panel kısa ömürlü bir kod gösteriyor, ajan onu kalıcı
   token'la takas edip kendi dosyasına kendisi yazıyor.

2) Önceki token için hoşgörü penceresi
   Otomatik yenileme iki adımlı: sunucu yeni token'ı üretir, ajan diskine
   yazar. Ajan tam arada çökerse yeni token kaybolur, eskisi de geçersizdir
   ve robot kendini dışarıda bırakır — kurtarmak için Pi'ye fiziksel erişim
   gerekir. Eski hash'i bir süre daha kabul etmek bu riski kaldırıyor.

Revision ID: f1b83c2a47d5
Revises: e5a1c9d3b806
Create Date: 2026-08-19 22:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f1b83c2a47d5"
down_revision: Union[str, None] = "e5a1c9d3b806"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("devices", sa.Column("agent_token_previous_hash", sa.String(255), nullable=True))
    op.add_column(
        "devices", sa.Column("agent_token_rotated_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("devices", sa.Column("pairing_code_hash", sa.String(255), nullable=True))
    op.add_column(
        "devices", sa.Column("pairing_code_expires_at", sa.DateTime(timezone=True), nullable=True)
    )
    # server_default: mevcut satırlar NOT NULL kısıtını ihlal etmesin.
    # Tam sayı sütununda `sa.text("0")` her iki lehçede de doğru.
    op.add_column(
        "devices",
        sa.Column("pairing_attempts", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )


def downgrade() -> None:
    op.drop_column("devices", "pairing_attempts")
    op.drop_column("devices", "pairing_code_expires_at")
    op.drop_column("devices", "pairing_code_hash")
    op.drop_column("devices", "agent_token_rotated_at")
    op.drop_column("devices", "agent_token_previous_hash")
