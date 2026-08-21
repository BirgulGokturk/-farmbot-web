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

# --------------------------------------------------------------------------- #
# Uç değiştirme
# --------------------------------------------------------------------------- #
#
# Alan adları Gantry Studio'nun "Tool change & safe zones" ekranıyla birebir
# aynı tutuldu. Sebebi: aynı makinenin aynı ayarı iki arayüzde farklı adla
# görünürse hangisinin geçerli olduğu tartışma konusu olur ve ortakla
# konuşurken ortak bir dil kalmaz.
#
# Yandan yaklaşma kuralı (PLC_BRIEF.md §7): kafa ucun **üstüne dikey inemez**,
# yalnızca tek eksen boyunca altına kayar. Sıra:
#   ① Travel Z'ye çık → ② yaklaşma noktası üzerine yatayda git → ③ ucun
#   yanında alçal → ④ altına kay (tek eksen) → ⑤ kilitle → ⑥ Lift kadar kaldır
# Bırakma bunun tersi.
TOOL_ZONE_DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "safe_z": 0.0,           # jog korumasının istediği asgari yükseklik
    "travel_z": 0.0,         # uçların üstünden geçiş yüksekliği
    "lift_mm": 0.0,          # kilitledikten sonra kaldırma payı
    "slide_axis": "y",       # altına kayarken kullanılan tek eksen
    "approach_offset": 0.0,  # yaklaşma noktası: hedef + bu değer (işaretli)
    "change_speed": 20.0,    # uç değiştirme sırasındaki hız (mm/s)
    "presence_reg": 0,       # ucun takılı olduğunu bildiren PLC D-yazmacı
    "z_safe_reg": 0,         # Z güvenli yükseklikte mi bilgisini veren D-yazmacı
    "lock_servo_reg": 0,     # kilitleme servosu D-yazmacı (1 = kilitle, 0 = bırak)
    "lock_delay_ms": 1500,   # servo komutundan sonra beklenecek süre
    "slots": [],             # [{"name":, "x":, "y":, "z":}] — z = kavrama yüksekliği
    "zones": [],             # [{"name":, "x1":, "y1":, "x2":, "y2":, "allow_if":}]
    "change_area": {         # içinde Z güvenlik kilidinin devre dışı kaldığı dörtgen
        "enabled": False,
        "corners": [[0.0, 0.0], [0.0, 0.0], [0.0, 0.0], [0.0, 0.0]],
    },
    "current_tool": None,    # takılı olduğu bilinen uç
}

# --------------------------------------------------------------------------- #
# Ekim alanı — yatağın kenarıyla ekilebilir toprağın başladığı yer aynı değil
# --------------------------------------------------------------------------- #
#
# Yatak ölçüsü (`bed_width_mm` / `bed_length_mm`) makinenin gidebildiği alan.
# Ekilebilir toprak ise onun içinde daha küçük bir dikdörtgen: kenarda profil,
# kablo kanalı, saksı duvarı gibi boşluklar var. Tohumu oraya bırakırsak
# tohum toprağa değil metale düşer.
#
# Bu yüzden ekim alanını ayrı tutuyoruz. `None` = "o kenarda sınır yok",
# yani yatağın kendi ölçüsü geçerli — ölçüm yapılmamış bir makinede davranış
# bugünküyle aynı kalsın diye.
PLANTING_AREA_DEFAULTS: dict[str, Any] = {
    "x_min_mm": None,
    "x_max_mm": None,
    "y_min_mm": None,
    "y_max_mm": None,
}

# --------------------------------------------------------------------------- #
# Güvenli geçiş
# --------------------------------------------------------------------------- #
#
# Uç aşağıdayken yatayda gitmek, yoldaki her bitkiyi biçer. Bu yüzden her
# X/Y hareketinden önce Z güvenli yüksekliğe çekilir, varılınca indirilir.
#
# Yüksekliğin kendisi burada tutulmuyor: `device.safe_height_mm` zaten var ve
# sulama da onu kullanıyor. İkinci bir alan açsaydık iki ayrı "güvenli
# yükseklik" olurdu ve biri güncellenip diğeri unutulduğunda hangisinin
# geçerli olduğu belirsizleşirdi. Burada yalnızca korumanın açık olup
# olmadığı duruyor.
TRAVEL_DEFAULTS: dict[str, Any] = {
    "enabled": True,
}

# --------------------------------------------------------------------------- #
# Vakumlu tohum ucu
# --------------------------------------------------------------------------- #
#
# Çalışma sırası: uç tohum tepsisine iner, vakum açılır, tohum uca yapışır,
# uç kalkar, hedefe gider, iner, vakum kapanır ve tohum çukura düşer.
#
# Bekleme süreleri neden ayarlanabilir: vakumun tohumu tutması da bırakması da
# anlık değil. Pompanın gücüne ve tohumun ağırlığına göre değişiyor; sahada
# denemeden doğru değer bilinemez.
SEEDER_DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "vacuum_pin": 9,
    "tray_x_mm": 0.0,      # tohum tepsisinin konumu
    "tray_y_mm": 0.0,
    "tray_z_mm": 0.0,      # tepsideki tohuma değecek yükseklik
    "pick_dwell_ms": 800,   # vakum açıkken tepside bekleme
    "release_dwell_ms": 500,  # vakum kapandıktan sonra çukurda bekleme
    "default_depth_mm": 15,   # türün kendi derinliği yoksa
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

    zones: list[dict[str, Any]] = []
    for item in source.get("zones") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        zones.append(
            {
                "name": name[:60],
                "x1": _number(item.get("x1"), 0.0),
                "y1": _number(item.get("y1"), 0.0),
                "x2": _number(item.get("x2"), 0.0),
                "y2": _number(item.get("y2"), 0.0),
                # Serbest ifade; burada **çalıştırmıyoruz**, yalnızca saklıyoruz.
                # Değerlendirme hareketi gönderen katmanın işi.
                "allow_if": str(item.get("allow_if") or "").strip()[:200],
            }
        )

    raw_area = source.get("change_area")
    area_source = raw_area if isinstance(raw_area, dict) else {}
    corners: list[list[float]] = []
    for item in (area_source.get("corners") or [])[:4]:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            corners.append([_number(item[0], 0.0), _number(item[1], 0.0)])
    # Dörtgen her zaman dört köşeli olsun: eksik köşe arayüzde boş kutu demek
    while len(corners) < 4:
        corners.append([0.0, 0.0])

    # Eski kurulumlarla uyum: `approach_mm` pozitif tutulup çıkarılıyordu,
    # yeni alan işaretli ve ekleniyor. İkisi aynı şeyi anlatıyor; eski değeri
    # sessizce kaybetmemek için işaretini çevirerek taşıyoruz.
    if source.get("approach_offset") is None and source.get("approach_mm") is not None:
        approach = -_number(source.get("approach_mm"), 0.0)
    else:
        approach = _number(source.get("approach_offset"), 0.0)

    slide = str(source.get("slide_axis") or "y").strip().lower()
    if slide not in {"x", "y"}:
        slide = "y"

    current = source.get("current_tool")

    return {
        "enabled": bool(source.get("enabled", TOOL_ZONE_DEFAULTS["enabled"])),
        "safe_z": _number(source.get("safe_z"), float(TOOL_ZONE_DEFAULTS["safe_z"])),
        "travel_z": _number(source.get("travel_z"), float(TOOL_ZONE_DEFAULTS["travel_z"])),
        "lift_mm": _number(source.get("lift_mm"), float(TOOL_ZONE_DEFAULTS["lift_mm"])),
        "slide_axis": slide,
        "approach_offset": approach,
        "change_speed": _number(
            source.get("change_speed"),
            float(TOOL_ZONE_DEFAULTS["change_speed"]),
            magnitude=(0.1, 1000.0),
        ),
        "presence_reg": int(_number(source.get("presence_reg"), 0.0, span=(0, 65535))),
        "z_safe_reg": int(_number(source.get("z_safe_reg"), 0.0, span=(0, 65535))),
        "lock_servo_reg": int(_number(source.get("lock_servo_reg"), 0.0, span=(0, 65535))),
        "lock_delay_ms": int(
            _number(source.get("lock_delay_ms"), 1500.0, span=(0, 60000))
        ),
        "slots": slots[:12],
        "zones": zones[:12],
        "change_area": {
            "enabled": bool(area_source.get("enabled", False)),
            "corners": corners,
        },
        "current_tool": str(current)[:60] if current else None,
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


def _optional_number(
    value: Any, *, span: tuple[float, float] = (-1e6, 1e6)
) -> float | None:
    """Boş bırakılabilen sayı: geçersiz ya da boşsa `None` (= sınır yok)."""
    if value is None or value == "":
        return None
    parsed = _number(value, float("nan"), span=span)
    return None if parsed != parsed else parsed


def normalize_planting_area(raw: Any) -> dict[str, Any]:
    source = raw if isinstance(raw, dict) else {}
    area = {key: _optional_number(source.get(key)) for key in PLANTING_AREA_DEFAULTS}

    # Ters girilmişse düzelt; aksi hâlde ekilebilir alan boş küme olur ve
    # rastgele ekim "yer bulamadım" deyip durur, sebebi de anlaşılmaz.
    for low, high in (("x_min_mm", "x_max_mm"), ("y_min_mm", "y_max_mm")):
        if area[low] is not None and area[high] is not None and area[low] > area[high]:
            area[low], area[high] = area[high], area[low]

    return area


def normalize_travel(raw: Any) -> dict[str, Any]:
    source = raw if isinstance(raw, dict) else {}
    return {"enabled": source.get("enabled") is not False}


def normalize_seeder(raw: Any) -> dict[str, Any]:
    source = raw if isinstance(raw, dict) else {}
    return {
        "enabled": bool(source.get("enabled", SEEDER_DEFAULTS["enabled"])),
        "vacuum_pin": int(_number(source.get("vacuum_pin"), 9.0, span=(0, 255))),
        "tray_x_mm": _number(source.get("tray_x_mm"), 0.0, span=(-1e6, 1e6)),
        "tray_y_mm": _number(source.get("tray_y_mm"), 0.0, span=(-1e6, 1e6)),
        "tray_z_mm": _number(source.get("tray_z_mm"), 0.0, span=(-1e6, 1e6)),
        "pick_dwell_ms": int(_number(source.get("pick_dwell_ms"), 800.0, span=(0, 60000))),
        "release_dwell_ms": int(
            _number(source.get("release_dwell_ms"), 500.0, span=(0, 60000))
        ),
        "default_depth_mm": _number(source.get("default_depth_mm"), 15.0, span=(0, 1000)),
    }


def planting_bounds(device: Any, settings: Any = None) -> tuple[float, float, float, float]:
    """Ekilebilir dikdörtgen: (x_min, x_max, y_min, y_max).

    Ayarlanmamış kenarlar yatağın kendi ölçüsüne düşer, böylece ölçüm
    yapılmamış bir makinede tüm yatak ekilebilir sayılır.
    """
    area = normalize(settings if settings is not None else device.settings)["planting_area"]
    x_min = area["x_min_mm"] if area["x_min_mm"] is not None else 0.0
    y_min = area["y_min_mm"] if area["y_min_mm"] is not None else 0.0
    x_max = area["x_max_mm"] if area["x_max_mm"] is not None else float(device.bed_width_mm)
    y_max = area["y_max_mm"] if area["y_max_mm"] is not None else float(device.bed_length_mm)

    # Ekim alanı yatağın dışına taşamaz: robot oraya zaten gidemiyor
    x_min, x_max = max(0.0, x_min), min(float(device.bed_width_mm), x_max)
    y_min, y_max = max(0.0, y_min), min(float(device.bed_length_mm), y_max)
    return x_min, x_max, y_min, y_max


# --------------------------------------------------------------------------- #
# Bitki türü geçersiz kılmaları
# --------------------------------------------------------------------------- #
#
# Katalog (`plant_species`) **küresel**: tüm kullanıcılar aynı satırları
# paylaşıyor. Kullanıcının "benim çileğim 30 cm aralıkla" demesi, herkesin
# çileğini değiştirmek anlamına gelemez.
#
# Bu yüzden değişiklikler cihazın kendi ayarlarında tutuluyor. Boş bırakılan
# her alan katalog değerine düşüyor, yani kullanıcı yalnızca değiştirmek
# istediğini yazıyor ve katalog güncellenirse gerisi kendiliğinden güncel
# kalıyor.
SPECIES_OVERRIDE_KEYS = {
    "spread_mm": (1.0, 5000.0),
    "sow_depth_mm": (0.0, 500.0),
    "water_ml_per_day": (0.0, 100000.0),
    "days_to_harvest": (1.0, 3650.0),
}


def normalize_species(raw: Any) -> dict[str, Any]:
    """`{slug: {favorite, spread_mm, ...}}` — bilinmeyen alanlar atılır."""
    source = raw if isinstance(raw, dict) else {}
    result: dict[str, Any] = {}

    for slug, veri in source.items():
        if not isinstance(slug, str) or not isinstance(veri, dict):
            continue
        kayit: dict[str, Any] = {"favorite": bool(veri.get("favorite", False))}
        for key, (alt, ust) in SPECIES_OVERRIDE_KEYS.items():
            kayit[key] = _optional_number(veri.get(key), span=(alt, ust))

        # Hiçbir şeyi değiştirmeyen kayıt saklanmasın: ayarlar dosyası her
        # bakılan bitki için satır biriktirmesin.
        if kayit["favorite"] or any(kayit[k] is not None for k in SPECIES_OVERRIDE_KEYS):
            result[slug[:80]] = kayit

    return result


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
    source["planting_area"] = normalize_planting_area(source.get("planting_area"))
    source["travel"] = normalize_travel(source.get("travel"))
    source["seeder"] = normalize_seeder(source.get("seeder"))
    source["species"] = normalize_species(source.get("species"))
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
