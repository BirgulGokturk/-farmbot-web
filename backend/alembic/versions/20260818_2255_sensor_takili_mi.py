"""sensor_takili_mi

Sensörlere `installed` sütunu: fiziksel olarak takılı mı?

Arduino, sensör bağlı olmayan bir analog pini de okuyor; boşta kalan pin
gürültü üretiyor ve panelde düzgün görünen ama anlamsız bir eğri oluşuyor.
Takılı olmayan sensörün ölçümleri kaydedilmeye devam eder, sadece
gösterilmez.

Mevcut satırlar `true` ile başlıyor: bugün görünen hiçbir sensör bu göçle
kaybolmasın; kullanıcı takılı olmayanları panelden kapatır.

Revision ID: b7d24e0af913
Revises: c3f1a8b47e21
Create Date: 2026-08-18 22:55:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from sqlalchemy import Text  # noqa: F401


revision: str = "b7d24e0af913"
down_revision: Union[str, None] = "c3f1a8b47e21"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default: mevcut satırlar NOT NULL kısıtını ihlal etmesin.
    # (SQLite `ALTER COLUMN ... DROP DEFAULT` desteklemediği için varsayılan
    # sütunda kalıyor; modelde de aynı varsayılan var, zararı yok.)
    op.add_column(
        "sensors",
        sa.Column(
            "installed", sa.Boolean(), nullable=False, server_default=sa.text("1")
        ),
    )


def downgrade() -> None:
    op.drop_column("sensors", "installed")
