"""Eksen eşlemesi, yön ve yumuşak limitler.

NEDEN GEREKLİ
  Panelin "X" dediği eksen, PLC'nin ladder programındaki 1. eksen olmak
  zorunda değil. Kullanıcının makinesinde panelden X'e basınca fiziksel Z
  hareket ediyordu — çünkü Gantry Studio'nun register haritasındaki sıra
  (Axis_1/2/3) makinedeki fiziksel sırayla aynı değil.

  Bunu Gantry Studio'nun kodunu değiştirerek çözmek riskli: o dosya
  sevgilinin çalışan HMI'sını da sürüyor. Bunun yerine eşlemeyi kendi
  tarafımızda, düzenlenebilir bir dosyada tutuyoruz.

DOSYA: gantry_axes.json (ajanın yanında)
  {
    "map":    {"x": 0, "y": 1, "z": 2},      panel ekseni -> Gantry dizin no
    "invert": {"x": false, "y": false, "z": false},   yön ters mi
    "limits": {"x": [0, 1000], ...}          boşsa Gantry'nin kalibrasyonu kullanılır
  }
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field

logger = logging.getLogger("farmbot-agent.axes")

PANEL_AXES = ("x", "y", "z")
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gantry_axes.json")


@dataclass
class AxisConfig:
    """Panel ekseni ile Gantry Studio ekseni arasındaki eşleme."""

    # panel ekseni -> Gantry Studio'daki dizin (0/1/2)
    map: dict[str, int] = field(default_factory=lambda: {"x": 0, "y": 1, "z": 2})
    # panel yönü ile makine yönü ters mi
    invert: dict[str, bool] = field(default_factory=lambda: {"x": False, "y": False, "z": False})
    # elle verilen yumuşak limitler; boşsa Gantry'nin kalibrasyonundan okunur
    limits: dict[str, list[float]] = field(default_factory=dict)

    @classmethod
    def load(cls, path: str = CONFIG_FILE) -> "AxisConfig":
        try:
            with open(path, encoding="utf-8") as handle:
                data = json.load(handle)
        except FileNotFoundError:
            logger.info("gantry_axes.json yok, varsayılan eşleme kullanılıyor (x=0, y=1, z=2)")
            return cls()
        except Exception as exc:
            logger.warning("gantry_axes.json okunamadı (%s), varsayılan kullanılıyor", exc)
            return cls()

        config = cls(
            map={a: int(data.get("map", {}).get(a, i)) for i, a in enumerate(PANEL_AXES)},
            invert={a: bool(data.get("invert", {}).get(a, False)) for a in PANEL_AXES},
            limits={
                a: [float(v) for v in data["limits"][a]]
                for a in PANEL_AXES
                if isinstance(data.get("limits", {}).get(a), (list, tuple))
                and len(data["limits"][a]) == 2
            },
        )
        config._validate()
        logger.info(
            "Eksen eşlemesi: %s · ters yön: %s",
            {a: config.map[a] for a in PANEL_AXES},
            [a for a in PANEL_AXES if config.invert[a]] or "yok",
        )
        return config

    def _validate(self) -> None:
        """İki panel ekseni aynı makine eksenine bakıyorsa uyar.

        Böyle bir eşleme sessizce yanlış hareket üretir; erken yakalamak şart.
        """
        indices = [self.map[a] for a in PANEL_AXES]
        if len(set(indices)) != len(indices):
            logger.error(
                "gantry_axes.json HATALI: iki eksen aynı dizine eşlenmiş (%s). "
                "Hareketler yanlış eksende olacak.",
                indices,
            )
        for axis, index in self.map.items():
            if index not in (0, 1, 2):
                logger.error("gantry_axes.json: %s ekseni için geçersiz dizin %s", axis, index)

    # ------------------------------------------------------------------ #

    def to_gantry_target(self, x: float, y: float, z: float) -> list[float]:
        """Panel koordinatlarını Gantry Studio'nun beklediği sıraya çevirir."""
        values = {"x": x, "y": y, "z": z}
        target = [0.0, 0.0, 0.0]
        for axis in PANEL_AXES:
            target[self.map[axis]] = -values[axis] if self.invert[axis] else values[axis]
        return target

    def from_gantry(self, positions: list[float]) -> dict[str, float]:
        """Gantry sırasındaki konumları panel eksenlerine çevirir."""
        result: dict[str, float] = {}
        for axis in PANEL_AXES:
            value = positions[self.map[axis]]
            result[axis] = -value if self.invert[axis] else value
        return result

    def gantry_index(self, axis: str) -> int:
        return self.map[axis]

    def limits_for(self, calib: list[dict] | None) -> dict[str, list[float]]:
        """Panel eksenlerine göre yumuşak limitler.

        Öncelik elle verilen değerlerde; yoksa Gantry Studio'nun kalibrasyonu.
        Yön ters çevrilmişse limitler de ters çevrilip sıralanır.
        """
        result: dict[str, list[float]] = {}
        for axis in PANEL_AXES:
            if axis in self.limits:
                result[axis] = list(self.limits[axis])
                continue

            index = self.map[axis]
            if not calib or index >= len(calib):
                continue
            entry = calib[index]
            try:
                low = float(entry.get("min", 0.0))
                high = float(entry.get("max", 0.0))
            except (TypeError, ValueError):
                continue

            if self.invert[axis]:
                low, high = -high, -low
            result[axis] = [min(low, high), max(low, high)]
        return result
