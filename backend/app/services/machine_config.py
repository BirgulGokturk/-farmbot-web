"""Makine yapılandırması — eksen kalibrasyonu, uç değiştirme bölgesi, 3B görünüm.

Neden `device.settings` (serbest JSON) içinde tutuluyor?
  Bu değerler kullanıcıdan kullanıcıya değil, **makineden makineye** değişiyor
  ve zamanla yenileri ekleniyor (yeni bir uç yuvası, yeni bir görünüm tercihi).
  Her biri için ayrı sütun açmak her seferinde bir göç (migration) demek olurdu.
  Bunun yerine tek bir JSON sütunu tutuyor, şeklini de burada tek yerden
  doğruluyoruz; böylece hem arayüz hem ajan aynı sözleşmeye bakıyor.

Kalibrasyonun anlamı
--------------------
Gantry Studio PLC'ye kendi biriminde (enkoder sayımı) yazıyor ve `cpm`
(counts-per-mm) değeri doğru ayarlanmadığında "100 mm git" komutu sahada 700 mm
harekete dönüşebiliyor. Gantry Studio ortağın kodu olduğu için ona dokunmuyoruz;
bunun yerine komutu göndermeden **önce** ve konumu okuduktan **sonra** kendi
dönüşümümüzü uyguluyoruz:

    makine = offset + yön * ölçek * kullanıcı_mm
    kullanıcı_mm = yön * (makine - offset) / ölçek

`ölçek` sahada ölçülerek bulunur: "100 mm git" deyip cetvelle 700 mm ölçüldüyse
ölçek = 100 / 700 ≈ 0.1429 olur ve komut 14.29 olarak gider, makine de gerçek
100 mm yol alır. Arayüzdeki ölçüm sihirbazı bu bölmeyi kullanıcı adına yapar.
"""

from __future__ import annotations

from typing import Any

AXES = ("x", "y", "z")

# Bir eksenin varsayılanı: hiçbir dönüşüm yapma (ölçek 1, kaydırma 0, yön düz).
# Kalibre edilmemiş bir makinede davranış bugünküyle birebir aynı kalsın diye
# nötr seçildi; kullanıcı ölçüm yapana kadar hiçbir şey sessizce değişmez.
AXIS_DEFAULTS: dict[str, Any] = {
    # Makinenin kendi terimleri. Gantry Studio'nun `gantry_calib.json` dosyası
    # ve PLC_BRIEF.md §5 ile aynı alan adları — iki taraf aynı dili konuşsun.
    "cpm": None,       # counts/mm; None = makineninkini kullan
    "dir": None,       # +1 / -1; None = makineninkini kullan
    "home_mm": None,   # sıfır noktasının mm karşılığı
    "min_mm": None,    # yumuşak sınırlar; None = makineninki geçerli
    "max_mm": None,
    "speed": None,     # hız tavanı (mm/s); None = makineninkini kullan
    "accel": None,     # ivme; None = makineninkini kullan
}

TOOL_ZONE_DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "safe_z": 0.0,      # yuvaya girmeden önce çıkılacak yükseklik
    "approach_mm": 40.0,  # yuvaya yatayda yaklaşma payı
    "slots": [],        # [{"name": ..., "x":, "y":, "z":}]
}

VIEWER_DEFAULTS: dict[str, Any] = {
    "camera_angle": "on",  # bakış yönü
    "robot_scale": 1.0,   # gantry gövdesinin boyut çarpanı
    "zoom": 1.0,          # kamera uzaklığı çarpanı
    "font_scale": 1.0,    # etiket yazı boyutu çarpanı
    "show_grid": True,
    "show_labels": True,
}

# Kullanıcı arayüzü hatalı bir sayı gönderdiğinde makineyi kilitlememek için
# her alanın kabul aralığı; aralık dışı değer varsayılana düşürülür.
#
# `scale`, `speed` ve `accel` için sınır **büyüklüğe** uygulanıyor: ölçek
# negatif olabilir (yön çevirmenin bir başka yolu) ama sıfıra çok yakın ya da
# absürt büyük olamaz. `offset`, `min_mm`, `max_mm` işaretli aralıkla sınırlı.
_AXIS_MAGNITUDE_BOUNDS: dict[str, tuple[float, float]] = {
    "cpm": (1e-4, 1e5),
    "speed": (0.1, 1000.0),
    "accel": (0.1, 100000.0),
}
_AXIS_RANGE_BOUNDS: dict[str, tuple[float, float]] = {
    "home_mm": (-1e6, 1e6),
    "min_mm": (-1e6, 1e6),
    "max_mm": (-1e6, 1e6),
}

# Boş bırakılabilen alanlar: değer yoksa o sınır uygulanmıyor
_OPTIONAL_AXIS_KEYS = ("cpm", "dir", "home_mm", "min_mm", "max_mm", "speed", "accel")


def _number(
    value: Any,
    fallback: float,
    *,
    magnitude: tuple[float, float] | None = None,
    span: tuple[float, float] | None = None,
) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return fallback
    # NaN ve sonsuz sessizce geçmesin: ölçek NaN olursa her hareket bozulur
    if result != result or result in (float("inf"), float("-inf")):
        return fallback
    if magnitude is not None and not (magnitude[0] <= abs(result) <= magnitude[1]):
        return fallback
    if span is not None and not (span[0] <= result <= span[1]):
        return fallback
    return result


def normalize_axis(raw: Any) -> dict[str, Any]:
    """Tek eksenin ayarlarını güvenli bir sözlüğe indirger."""
    source = raw if isinstance(raw, dict) else {}
    axis: dict[str, Any] = {
        key: _number(
            source.get(key, default),
            float(default),
            magnitude=_AXIS_MAGNITUDE_BOUNDS.get(key),
            span=_AXIS_RANGE_BOUNDS.get(key),
        )
        for key, default in AXIS_DEFAULTS.items()
        if key not in _OPTIONAL_AXIS_KEYS
    }

    # Boş/geçersiz sınır = sınır yok. Boş bir metin kutusunu 0'a çevirseydik
    # kullanıcı farkında olmadan ekseni kilitlerdi.
    for key in _OPTIONAL_AXIS_KEYS:
        value = source.get(key)
        if value is None or value == "":
            axis[key] = None
        elif key == "dir":
            # Yön yalnızca +1 ya da -1 olabilir; arada bir değer motoru şaşırtır
            axis[key] = -1 if _number(value, 1.0) < 0 else 1
        else:
            parsed = _number(
                value,
                float("nan"),
                magnitude=_AXIS_MAGNITUDE_BOUNDS.get(key),
                span=_AXIS_RANGE_BOUNDS.get(key),
            )
            axis[key] = None if parsed != parsed else parsed

    # İkisi de verilmiş ama ters girilmişse düzelt; aksi hâlde her hareket reddedilir
    if (
        axis["min_mm"] is not None
        and axis["max_mm"] is not None
        and axis["min_mm"] > axis["max_mm"]
    ):
        axis["min_mm"], axis["max_mm"] = axis["max_mm"], axis["min_mm"]

    return axis


def normalize_tool_zone(raw: Any) -> dict[str, Any]:
    source = raw if isinstance(raw, dict) else {}
    slots: list[dict[str, Any]] = []
    for item in source.get("slots") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        slots.append(
            {
                "name": name[:60],
                "x": _number(item.get("x"), 0.0),
                "y": _number(item.get("y"), 0.0),
                "z": _number(item.get("z"), 0.0),
            }
        )

    return {
        "enabled": bool(source.get("enabled", TOOL_ZONE_DEFAULTS["enabled"])),
        "safe_z": _number(source.get("safe_z"), float(TOOL_ZONE_DEFAULTS["safe_z"])),
        "approach_mm": _number(
            source.get("approach_mm"), float(TOOL_ZONE_DEFAULTS["approach_mm"])
        ),
        "slots": slots[:12],
    }


def normalize_viewer(raw: Any) -> dict[str, Any]:
    source = raw if isinstance(raw, dict) else {}
    angle = source.get("camera_angle")
    return {
        "camera_angle": angle if isinstance(angle, str) and angle else "on",
        "robot_scale": _number(source.get("robot_scale"), 1.0, magnitude=(0.1, 5.0)),
        "zoom": _number(source.get("zoom"), 1.0, magnitude=(0.2, 5.0)),
        "font_scale": _number(source.get("font_scale"), 1.0, magnitude=(0.5, 3.0)),
        "show_grid": bool(source.get("show_grid", True)),
        "show_labels": bool(source.get("show_labels", True)),
    }


def normalize(settings: Any) -> dict[str, Any]:
    """`device.settings` sözlüğünü eksiksiz ve güvenli hâle getirir.

    Bilinmeyen anahtarlar korunur: ileride eklenen bir alan bu sürüm tarafından
    silinmesin diye. Yalnızca bizim sahiplendiğimiz üç bölüm yeniden yazılır.
    """
    source = dict(settings) if isinstance(settings, dict) else {}

    raw_axes = source.get("axes") if isinstance(source.get("axes"), dict) else {}
    source["axes"] = {name: normalize_axis(raw_axes.get(name)) for name in AXES}
    # Varsayılan açık: sınırları uygulamak PLC belgesine göre uygulamanın
    # sorumluluğu, kapalı başlamak sessizce güvensiz olurdu.
    source["limits_enabled"] = source.get("limits_enabled") is not False
    source["tool_zone"] = normalize_tool_zone(source.get("tool_zone"))
    source["viewer"] = normalize_viewer(source.get("viewer"))
    return source


def axis_config(settings: Any) -> dict[str, dict[str, Any]]:
    """Yalnızca eksen bölümü — ajanın ihtiyaç duyduğu kısım."""
    return normalize(settings)["axes"]


def to_machine(axis: dict[str, Any], user_mm: float) -> float:
    """Kullanıcı milimetresini makinenin beklediği birime çevirir."""
    direction = -1.0 if axis.get("invert") else 1.0
    return float(axis["offset"]) + direction * float(axis["scale"]) * float(user_mm)


def from_machine(axis: dict[str, Any], machine_value: float) -> float:
    """Makineden okunan değeri kullanıcı milimetresine çevirir."""
    direction = -1.0 if axis.get("invert") else 1.0
    return direction * (float(machine_value) - float(axis["offset"])) / float(axis["scale"])
