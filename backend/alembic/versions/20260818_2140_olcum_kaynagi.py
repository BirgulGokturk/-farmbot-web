"""olcum_kaynagi

Ölçümlere `source` sütunu: "agent" (Arduino köprüsü) ya da "simulator".

Geriye dönük doldurma
---------------------
Mevcut satırlarda kaynak bilgisi yok. Ayırt etmenin güvenilir bir yolu var:
bir cihaz ajan token'ı üretilmeden **önce** gerçek ölçüm üretemez, çünkü ölçüm
gönderen tek istemci ajanın kendisi. Dolayısıyla `agent_token_created_at`
tarihinden önceki her satır simülatörden gelmiştir.

Hiç eşleştirilmemiş cihazlarda da tüm veri simülatörden gelir.

Revision ID: c3f1a8b47e21
Revises: 40d861040de5
Create Date: 2026-08-18 21:40:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from sqlalchemy import Text  # noqa: F401


revision: str = "c3f1a8b47e21"
down_revision: Union[str, None] = "40d861040de5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default: sütun eklenirken mevcut satırlar NOT NULL'ı ihlal etmesin
    op.add_column(
        "sensor_readings",
        sa.Column("source", sa.String(length=16), nullable=False, server_default="agent"),
    )

    # Eşleştirilmiş cihazlarda: token üretiminden önceki her şey simülatör
    op.execute(
        """
        UPDATE sensor_readings
        SET source = 'simulator'
        WHERE device_id IN (
            SELECT id FROM devices WHERE agent_token_created_at IS NOT NULL
        )
        AND read_at < (
            SELECT agent_token_created_at FROM devices
            WHERE devices.id = sensor_readings.device_id
        )
        """
    )

    # Hiç eşleştirilmemiş cihazlarda: tüm veri simülatörden
    op.execute(
        """
        UPDATE sensor_readings
        SET source = 'simulator'
        WHERE device_id IN (
            SELECT id FROM devices WHERE agent_token_created_at IS NULL
        )
        """
    )

    # `server_default` bilerek bırakılıyor: SQLite `ALTER COLUMN ... DROP DEFAULT`
    # desteklemiyor ve testler SQLite üzerinde koşuyor. Zararı da yok — modelde
    # zaten aynı varsayılan var, değeri her iki yazma yolu da açıkça veriyor.


def downgrade() -> None:
    op.drop_column("sensor_readings", "source")
