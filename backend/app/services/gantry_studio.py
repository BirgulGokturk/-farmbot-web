"""Gantry Studio'daki uç istasyonlarını okur.

Neden ayrı bir modül
--------------------
İki yerden aynı bilgi isteniyor ve ikisinin de aynı cevabı vermesi şart:

  * Ayar kartı — kullanıcıya istasyonları gösteriyor
  * Ekim/sulama komutu — hareketi üretirken koordinatı kullanıyor

Panelde bir sayı gösterip robotu başka bir sayıya göre sürmek, hata ayıklaması
en zor sınıftan bir kusur olurdu.

Neden komut anında da okunuyor
------------------------------
İstasyon konumları `device.settings` içinde de saklanıyor (aynası), ama tek
başına saklamak yetmiyor: ortak Gantry Studio'da istasyonu kaydırdığında bizim
kopyamız eskiyor ve robot eski noktaya gider. Kayma sessiz olurdu — kimse
"Eşitle"ye basmayı unuttuğunu fark etmez, kafa yuvayı sıyırır.

Bu yüzden komut, hareketi kurarken canlı listeyi bir kez soruyor. Ulaşılamazsa
saklanan kopya devreye giriyor: ortağın sunucusu kapalı diye ekim tamamen
durmasın.

Kısa ömürlü önbellek
--------------------
Tek bir ekim döngüsü uç ararken birden çok kez soruyor. İstasyon konumları
saniyeler içinde değişmiyor; birkaç saniyelik önbellek hem PLC arayüzünü boşa
yormuyor hem de "az önce taşıdım, hâlâ eskisine gidiyor" durumunu üretmiyor.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

ONBELLEK_SANIYE = 5.0
ZAMAN_ASIMI = 5.0

_onbellek: dict[str, Any] | None = None
_onbellek_zamani = 0.0
_kilit = asyncio.Lock()


def yapilandirilmis() -> bool:
    return bool(settings.GANTRY_PROXY_URL)


async def uc_istasyonlari(*, tazele: bool = False) -> dict[str, Any]:
    """Normalleştirilmiş istasyon listesi.

    Hata atmıyor. Ulaşılamadığında `{"available": False, "reason": ...}`
    dönüyor; çağıranlar buna göre kendi yedek davranışlarını seçiyor.
    """
    global _onbellek, _onbellek_zamani

    if not yapilandirilmis():
        return {
            "available": False,
            "reason": "Gantry Studio bu kurulumda yapılandırılmamış.",
        }

    async with _kilit:
        taze = _onbellek is not None and (time.monotonic() - _onbellek_zamani) < ONBELLEK_SANIYE
        if taze and not tazele:
            return _onbellek  # type: ignore[return-value]

        hedef = settings.GANTRY_PROXY_URL.rstrip("/")  # type: ignore[union-attr]
        try:
            async with httpx.AsyncClient(timeout=ZAMAN_ASIMI) as istemci:
                yanit = await istemci.get(f"{hedef}/api/tools")
                yanit.raise_for_status()
                veri = yanit.json()
        except Exception as hata:  # ağ, zaman aşımı, bozuk JSON — sonuç aynı
            logger.warning("Gantry Studio uç listesi okunamadı: %s", hata)
            sonuc = {
                "available": False,
                "reason": f"Gantry Studio'ya ulaşılamadı: {hata}",
            }
            # Başarısızlığı önbelleğe **almıyoruz**: sunucu geri geldiğinde
            # beş saniye daha yanlış cevap vermeyelim.
            return sonuc

        if not isinstance(veri, dict):
            return {"available": False, "reason": "Gantry Studio beklenmeyen bir yanıt verdi."}

        slots: list[dict[str, Any]] = []
        for ham in veri.get("tools") or []:
            if not isinstance(ham, dict):
                continue
            ad = str(ham.get("name") or "").strip()
            if not ad:
                continue
            try:
                slots.append(
                    {
                        "name": ad,
                        "x": float(ham["x"]),
                        "y": float(ham["y"]),
                        "z": float(ham["z"]),
                    }
                )
            except (KeyError, TypeError, ValueError):
                # Koordinatı eksik istasyon işe yaramaz. Sessizce atlamak
                # kafa karıştırırdı; günlüğe düşüyor.
                logger.warning("Gantry Studio istasyonu koordinatsız, atlandı: %s", ham)

        _onbellek = {
            "available": True,
            "slots": slots,
            "current_tool": veri.get("current_tool") or None,
            # Yalnızca gösterim için: kullanıcı bu sayıların nerede
            # ayarlandığını görsün diye. Hareketi üreten taraf Gantry Studio.
            "travel_z": veri.get("travel_z"),
            "safe_z": veri.get("safe_z"),
            "slide_axis": str(veri.get("slide_axis") or "Y").upper(),
            "approach": veri.get("approach"),
            "lift": veri.get("lift"),
        }
        _onbellek_zamani = time.monotonic()
        return _onbellek


async def canli_koordinatlar() -> dict[str, dict[str, float]]:
    """Ada göre `{"tool1": {"x":…, "y":…, "z":…}}`.

    Ulaşılamazsa boş sözlük — çağıran saklanan kopyayla devam ediyor.
    """
    veri = await uc_istasyonlari()
    if not veri.get("available"):
        return {}
    return {
        y["name"]: {"x": y["x"], "y": y["y"], "z": y["z"]}
        for y in veri.get("slots", [])
    }


def tazele_yuvalar(
    yuvalar: list[dict[str, Any]],
    canli: dict[str, dict[str, float]],
) -> list[dict[str, Any]]:
    """Saklanan yuvaların koordinatını canlı değerlerle değiştirir.

    Görev ve okunur ad korunuyor — onlar bizim tarafımızın bilgisi, Gantry
    Studio'da karşılıkları yok. Canlı listede olmayan yuva olduğu gibi kalıyor:
    elle tanımlanmış bir istasyonu, ortağın listesinde yok diye silmek yanlış
    olurdu.
    """
    if not canli:
        return yuvalar
    tazelenmis = []
    for yuva in yuvalar:
        kaynak = canli.get(str(yuva.get("name") or ""))
        tazelenmis.append({**yuva, **kaynak} if kaynak else yuva)
    return tazelenmis
