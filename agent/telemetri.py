"""Raspberry Pi'nin kendi durumu — işlemci, bellek, disk, sıcaklık.

Panelin "Sistem Sağlığı" kartı bu değerleri bekliyordu ama ajan hiç
göndermiyordu; kart bu yüzden boş duruyordu.

Neden ek bir kütüphane yok
--------------------------
`psutil` bu işi tek satırda yapardı ama Raspberry Pi'de derleme gerektiriyor
ve ajanın tasarım kuralı üç bağımlılıkla sınırlı kalmak (bkz. farmbot_agent.py).
Gereken her şey zaten çekirdeğin `/proc` ve `/sys` dosyalarında duruyor.

Neden hepsi ayrı ayrı korunuyor
-------------------------------
Bir değer okunamazsa (farklı çekirdek, farklı kart, kapsayıcı içi çalışma)
diğerleri yine gitsin. Tek bir `try` bloğu, sıcaklık okunamadığı için işlemci
yüzdesini de düşürürdü.
"""

from __future__ import annotations

import os
import shutil
from typing import Any

# İşlemci yüzdesi iki okuma arasındaki farktan çıkıyor; önceki örnek burada.
_onceki_cpu: tuple[int, int] | None = None


def _cpu_yuzdesi() -> float | None:
    """`/proc/stat`ın ilk satırından işlemci kullanımı.

    Tek okuma yetmiyor: dosya açılıştan beri **birikmiş** süreleri veriyor.
    Yüzdeyi iki okuma arasındaki farktan hesaplıyoruz, bu yüzden ilk çağrı
    `None` dönüyor — bir sonraki turda değer geliyor.
    """
    global _onceki_cpu

    try:
        with open("/proc/stat", encoding="utf-8") as dosya:
            alanlar = dosya.readline().split()
    except OSError:
        return None

    if len(alanlar) < 5 or alanlar[0] != "cpu":
        return None

    try:
        sayilar = [int(x) for x in alanlar[1:]]
    except ValueError:
        return None

    toplam = sum(sayilar)
    bosta = sayilar[3] + (sayilar[4] if len(sayilar) > 4 else 0)  # idle + iowait

    onceki = _onceki_cpu
    _onceki_cpu = (toplam, bosta)
    if onceki is None:
        return None

    toplam_fark = toplam - onceki[0]
    bosta_fark = bosta - onceki[1]
    if toplam_fark <= 0:
        return None

    return round(100.0 * (toplam_fark - bosta_fark) / toplam_fark, 1)


def _bellek_yuzdesi() -> float | None:
    """`/proc/meminfo`dan kullanılan bellek oranı.

    `MemFree` değil `MemAvailable` kullanılıyor: Linux boş belleği önbellek
    olarak tutuyor ve `MemFree`ye bakmak sağlıklı bir sistemi %95 dolu
    gösterirdi.
    """
    degerler: dict[str, int] = {}
    try:
        with open("/proc/meminfo", encoding="utf-8") as dosya:
            for satir in dosya:
                ad, _, gerisi = satir.partition(":")
                if ad in ("MemTotal", "MemAvailable"):
                    degerler[ad] = int(gerisi.split()[0])
                    if len(degerler) == 2:
                        break
    except (OSError, ValueError, IndexError):
        return None

    toplam = degerler.get("MemTotal")
    kullanilabilir = degerler.get("MemAvailable")
    if not toplam or kullanilabilir is None:
        return None

    return round(100.0 * (toplam - kullanilabilir) / toplam, 1)


def _disk_yuzdesi(yol: str = "/") -> float | None:
    try:
        kullanim = shutil.disk_usage(yol)
    except OSError:
        return None
    if kullanim.total <= 0:
        return None
    return round(100.0 * kullanim.used / kullanim.total, 1)


def _sicaklik() -> float | None:
    """Yonga sıcaklığı (°C).

    Çekirdek bunu bin katı tam sayı olarak veriyor: 47250 = 47.25 °C.
    """
    for yol in (
        "/sys/class/thermal/thermal_zone0/temp",
        "/sys/devices/virtual/thermal/thermal_zone0/temp",
    ):
        try:
            with open(yol, encoding="utf-8") as dosya:
                ham = int(dosya.read().strip())
        except (OSError, ValueError):
            continue
        # Bazı kartlar zaten °C veriyor; bin katıysa böl
        return round(ham / 1000.0 if abs(ham) > 200 else float(ham), 1)
    return None


def topla() -> dict[str, Any]:
    """Panelin beklediği alan adlarıyla telemetri.

    Okunamayan değer **hiç gönderilmiyor**. `0` göndermek, işlemcinin boşta
    olduğunu söylemek olurdu; boş bırakınca panel "—" gösteriyor ve ölçüm
    olmadığı anlaşılıyor.
    """
    sonuc: dict[str, Any] = {}

    for anahtar, deger in (
        ("cpu_usage", _cpu_yuzdesi()),
        ("memory_usage", _bellek_yuzdesi()),
        ("disk_usage", _disk_yuzdesi()),
        ("soc_temp", _sicaklik()),
    ):
        if deger is not None:
            sonuc[anahtar] = deger

    # Çalışma süresi: "robot ne zamandır ayakta" sorusunun cevabı
    try:
        with open("/proc/uptime", encoding="utf-8") as dosya:
            sonuc["uptime_seconds"] = int(float(dosya.readline().split()[0]))
    except (OSError, ValueError, IndexError):
        pass

    sonuc["cpu_count"] = os.cpu_count() or 1
    return sonuc
