"""teshis_kanallarini_gizle

Var olan kurulumlarda teşhis kanallarını kapatır.

Ham ADC değeri ve eşik, yağmur sensörünü kalibre ederken gerekliydi —
eşiğin ters olduğunu ancak ikisini yan yana görünce anladık. İş bitince
grafik listesini şişiriyorlar ve gerçek ölçümlerin arasında kayboluyorlar.

Kanalların teşhis olduğu koda işlendi ama bu yalnızca **yeni** oluşturulan
sensörleri etkiliyordu; çalışan kurulumlarda kayıtlar zaten açıktı. Bu göç
onları bir kereye mahsus kapatıyor.

Ölçüm **silinmiyor**, yalnızca gösterilmiyor: yeniden kalibrasyon
gerektiğinde Sensörler sayfasından açıldığında geçmiş veri de orada oluyor.

Revision ID: d8e51a06c7f4
Revises: a4c72e19f5b3
Create Date: 2026-08-21 23:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d8e51a06c7f4"
down_revision: Union[str, None] = "a4c72e19f5b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Kod tarafındaki `ChannelSpec.diagnostic` ile aynı liste. İkisi ayrışırsa
# yeni kurulumlar gizler, eskiler göstermeye devam eder.
TESHIS_KANALLARI = (
    "hw103_rain_raw",
    "rain_threshold",
    # Ölü kanal: eskiz A0'daki yağmur sensörünü bir de "toprak nemi" diye
    # bildiriyordu. Düzeltildi ve artık gönderilmiyor, ama eski kayıt panelde
    # duruyor ve son okuduğu değeri sonsuza kadar gösteriyor — ortada toprak
    # sensörü yokken "toprak nemi" grafiği görmek yanıltıcı.
    "hw103_soil",
    "hw103_soil_raw",
)


def upgrade() -> None:
    sensors = sa.table(
        "sensors",
        sa.column("channel", sa.String),
        sa.column("installed", sa.Boolean),
    )
    op.execute(
        sensors.update()
        .where(sensors.c.channel.in_(TESHIS_KANALLARI))
        .values(installed=False)
    )


def downgrade() -> None:
    # Geri alırken açıyoruz: göçten önceki hâl buydu.
    sensors = sa.table(
        "sensors",
        sa.column("channel", sa.String),
        sa.column("installed", sa.Boolean),
    )
    op.execute(
        sensors.update()
        .where(sensors.c.channel.in_(TESHIS_KANALLARI))
        .values(installed=True)
    )
