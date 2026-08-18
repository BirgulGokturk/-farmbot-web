"""fotograf_verisi

Kameradan gelen karenin baytları `images` tablosunda saklanıyor.

Neden diskte değil: Render'ın ücretsiz katmanında kalıcı disk yok; konteyner
her yeniden başladığında dosya sistemi sıfırlanıyor ve fotoğraflar kaybolurdu.
Bahçe kamerasının birkaç yüz karesi için veritabanı sütunu yeterli.

Revision ID: e5a1c9d3b806
Revises: b7d24e0af913
Create Date: 2026-08-18 23:40:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from sqlalchemy import Text  # noqa: F401


revision: str = "e5a1c9d3b806"
down_revision: Union[str, None] = "b7d24e0af913"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("images", sa.Column("data", sa.LargeBinary(), nullable=True))
    op.add_column(
        "images",
        sa.Column(
            "content_type",
            sa.String(length=60),
            nullable=False,
            server_default="image/jpeg",
        ),
    )


def downgrade() -> None:
    op.drop_column("images", "content_type")
    op.drop_column("images", "data")
