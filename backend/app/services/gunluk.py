"""Olay günlüğü — robotun ne yaptığının kaydı.

Neden yazıldı
-------------
`logs` tablosu ve `POST /logs` ucu vardı ama **hiçbir kod onları
doldurmuyordu**. Kayıtlar sayfası bu yüzden sonsuza kadar boş kalıyor,
üstelik "Robot bağlandığında olaylar buraya düşecek" diyerek bağlantı sorunu
varmış izlenimi veriyordu — oysa robot bağlıydı, yazacak kimse yoktu.

Bir bahçe robotunda bu kayıt asıl işe yarayan şey: "dün gece ne oldu",
"sulama gerçekten çalıştı mı", "acil durdurmaya kim bastı". Panelde anlık
durumu görüyorsunuz ama geçmişi yalnızca burası tutuyor.

Tasarım kararları
-----------------
* **Sessizce başarısız oluyor.** Günlük yazamamak, asıl işi durdurmamalı:
  sulama komutu gitti ama kaydı düşemedi diye kullanıcıya hata göstermek
  yanlış olurdu.
* **Konum da kaydediliyor.** "Sulama başladı" tek başına az; hangi noktada
  olduğu sonradan sorunu bulmayı kolaylaştırıyor.
* **Seviye ayrımı gerçek.** `error` yalnızca gerçekten yanlış giden şeyler
  için; her şeyi `info` yapmak, listeyi göz taraması yapılamaz hâle getirir.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.models import Device, Log
from app.models.enums import LogLevel

logger = logging.getLogger(__name__)


async def yaz(
    db: AsyncSession,
    device: Device,
    message: str,
    *,
    level: LogLevel = LogLevel.INFO,
    channels: list[str] | None = None,
    commit: bool = False,
) -> None:
    """Bir olay kaydı düşer.

    `commit=False` varsayılan: çağıran işlem zaten bir işlem (transaction)
    içindeyse kaydı ona iliştiriyoruz. Kendi başına commit etmek, çağıranın
    yarım kalmış değişikliklerini de kalıcı yapardı.
    """
    try:
        db.add(
            Log(
                device_id=device.id,
                message=message[:2000],
                level=level,
                channels=channels or ["ticker"],
                # Konum, olayın nerede olduğunu sonradan bulmayı sağlıyor
                x=device.last_x,
                y=device.last_y,
                z=device.last_z,
                created_at=utcnow(),
            )
        )
        if commit:
            await db.commit()
    except Exception:  # pragma: no cover - günlük asıl işi durdurmamalı
        logger.warning("Olay kaydı düşülemedi: %s", message[:80], exc_info=True)


def ozet(baslik: str, **ayrintilar: Any) -> str:
    """`"Sulama başladı · bitki=Çilek · süre=30 sn"` biçiminde tek satır.

    Ayrıntıları ayrı sütunlara koymak yerine metne gömüyoruz: kayıt ekranı
    arama kutusuyla geziliyor ve serbest metin aramak, alan alan filtrelemekten
    pratikte daha çok işe yarıyor.
    """
    parcalar = [baslik]
    for ad, deger in ayrintilar.items():
        if deger is None or deger == "":
            continue
        parcalar.append(f"{ad}={deger}")
    return " · ".join(parcalar)
