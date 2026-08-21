"""cevre_birimi_rolu

Çevre birimine `role` ve `flow_rate_ml_per_s` ekler.

Neden gerekti
-------------
Sulama komutu pompanın pinini **sabit 8** varsayıyordu. Kullanıcı panelde
"Su pompası, pin 7" tanımlasa bile sulama pin 8'i sürüyordu; panel kendi
tanımını kullanmıyordu ve hiçbir şey olmadığı için sebebi de anlaşılmıyordu.

`role` bu boşluğu kapatıyor: sulama artık "su pompası hangisi" diye
sorabiliyor. `kind` nasıl sürüldüğünü söylüyor (röle mi servo mu), `role` ne
işe yaradığını.

Debi (`flow_rate_ml_per_s`) da buraya taşındı. Önceden `Tool` üzerindeydi:
pompa "Çevre Birimleri"nde, debisi "Aletler"de duruyordu ve ikisini
eşleştiren bir şey yoktu. Eski değer `tools` tablosunda kalıyor; oradan
taşımak kullanıcının hangi aletin hangi pompa olduğunu bilmesini gerektirir,
bunu tahmin etmek yanlış eşleştirme riski taşırdı.

Revision ID: a4c72e19f5b3
Revises: f1b83c2a47d5
Create Date: 2026-08-21 23:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a4c72e19f5b3"
down_revision: Union[str, None] = "f1b83c2a47d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default: mevcut satırlar NOT NULL kısıtını ihlal etmesin.
    # Enum `native_enum=False` ile saklandığı için sütun metin; varsayılan da
    # metin olarak veriliyor.
    op.add_column(
        "peripherals",
        sa.Column(
            "role",
            sa.String(20),
            nullable=False,
            server_default="generic",
        ),
    )
    op.add_column(
        "peripherals", sa.Column("flow_rate_ml_per_s", sa.Float(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("peripherals", "flow_rate_ml_per_s")
    op.drop_column("peripherals", "role")
