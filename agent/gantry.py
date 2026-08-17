"""Gantry Studio istemcisi — PLC hareket kontrolüne köprü.

Neden Modbus'a doğrudan bağlanmıyoruz?
  Pi'de zaten Gantry Studio çalışıyor ve PLC'ye tek yazıcı olarak o bağlanıyor.
  Biz de ayrıca Modbus yazsaydık iki program aynı register'lara yazar, komutlar
  çakışırdı. Üstelik Gantry Studio'nun içinde yeniden yazmamız gereken çok şey
  var: puls↔milimetre kalibrasyonu, yumuşak eksen limitleri, Z güvenlik kilidi
  (Z yukarıda değilken X/Y hareketi reddediliyor), güvenli geçiş rotası
  (Z kaldır → yatayda git → indir) ve alet değiştirme dizisi.

  Bu yüzden HTTP API'sini kullanıyoruz: `localhost:8091`. Gantry Studio
  güncellenirse entegrasyon bozulmadan çalışmaya devam eder.

Kullanılan uç noktalar:
  GET  /api/status  → eksen konumları ve etkinleştirme durumu
  POST /api/cmd     → movexyz | gohome | jogf/jogb | estop | enable
"""

from __future__ import annotations

import base64
import logging
from typing import Any

import httpx

logger = logging.getLogger("farmbot-agent.gantry")

# Eksen sırası Gantry Studio ile aynı: 0=X, 1=Y, 2=Z
AXIS_INDEX = {"x": 0, "y": 1, "z": 2}


class GantryUnavailable(Exception):
    """Gantry Studio çalışmıyor ya da yanıt vermiyor."""


class GantryClient:
    def __init__(
        self,
        base_url: str = "http://localhost:8091",
        username: str = "",
        password: str = "",
        timeout: float = 10.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")

        headers: dict[str, str] = {}
        # gantry_config.json'da kullanıcı/parola tanımlıysa temel kimlik doğrulama
        if username or password:
            token = base64.b64encode(f"{username}:{password}".encode()).decode()
            headers["Authorization"] = f"Basic {token}"

        self._http = httpx.AsyncClient(
            base_url=self.base_url, headers=headers, timeout=httpx.Timeout(timeout)
        )
        # Bağlantı kopunca her denemede hata basmamak için durum takibi
        self._was_reachable: bool | None = None

    async def close(self) -> None:
        await self._http.aclose()

    # ------------------------------------------------------------------ #
    # Okuma
    # ------------------------------------------------------------------ #

    async def status(self) -> dict[str, Any] | None:
        """Eksen durumlarını okur. Ulaşılamazsa None döner (istisna fırlatmaz).

        Yoklama döngüsünde çağrıldığı için sessiz başarısızlık doğru davranış:
        Gantry Studio kapalıyken sensör akışı etkilenmemeli.
        """
        try:
            response = await self._http.get("/api/status")
            response.raise_for_status()
            data = response.json()
        except Exception as exc:
            if self._was_reachable is not False:
                logger.warning("Gantry Studio'ya ulaşılamıyor (%s)", exc)
                self._was_reachable = False
            return None

        if self._was_reachable is False:
            logger.info("Gantry Studio yeniden bağlandı")
        self._was_reachable = True
        return data

    async def position(self) -> tuple[float, float, float] | None:
        """Anlık X/Y/Z konumu (mm). Okunamazsa None."""
        data = await self.status()
        if data is None:
            return None
        return extract_position(data)

    # ------------------------------------------------------------------ #
    # Komutlar
    # ------------------------------------------------------------------ #

    async def command(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Komut gönderir. Gantry Studio hata döndürürse istisna fırlatır.

        Okumadan farklı olarak burada sessiz kalmıyoruz: kullanıcı panelde bir
        düğmeye bastıysa sonucu görmeli.
        """
        try:
            response = await self._http.post("/api/cmd", json=payload)
            response.raise_for_status()
            result = response.json()
        except Exception as exc:
            raise GantryUnavailable(
                f"Hareket kontrolüne ulaşılamıyor: {exc}. "
                "Raspberry Pi'de gantry-studio servisi çalışıyor mu?"
            ) from exc

        if not result.get("ok", True):
            # Gantry Studio'nun kendi güvenlik reddi de buradan gelir,
            # ör. "Z güvenli konumda değil" — mesajı olduğu gibi aktarıyoruz
            raise GantryUnavailable(result.get("error") or "Hareket komutu reddedildi")
        return result

    async def move_xyz(self, x: float, y: float, z: float, speed: float = 20.0) -> None:
        """Güvenli rotayla hedefe git (Z kaldır → yatayda git → indir)."""
        await self.command({"cmd": "movexyz", "target": [x, y, z], "speed": speed})

    async def go_home(self, axis: str = "all") -> None:
        """Eve dön.

        `all` için sıralama Z → X → Y. Önce Z'yi yukarı almazsak alet toprakta
        sürünerek yatay harekete başlar.
        """
        order = [2, 0, 1] if axis == "all" else [AXIS_INDEX[axis]]
        for index in order:
            await self.command({"cmd": "gohome", "axis": index})

    async def jog(self, axis: str, forward: bool, value: bool) -> None:
        await self.command(
            {
                "cmd": "jogf" if forward else "jogb",
                "axis": AXIS_INDEX[axis],
                "value": 1 if value else 0,
            }
        )

    async def move_axis(self, axis: str, millimetres: float, speed: float = 20.0) -> None:
        await self.command(
            {"cmd": "movej", "axis": AXIS_INDEX[axis], "value": millimetres, "speed": speed}
        )

    async def emergency_stop(self) -> None:
        """Tüm jog'ları durdurur ve sürücüleri devre dışı bırakır."""
        await self.command({"cmd": "estop"})

    async def set_enabled(self, enabled: bool) -> None:
        await self.command({"cmd": "enable", "value": 1 if enabled else 0})


# --------------------------------------------------------------------------- #
# Yardımcılar
# --------------------------------------------------------------------------- #


def extract_position(status: dict[str, Any]) -> tuple[float, float, float] | None:
    """`/api/status` yanıtından X/Y/Z konumunu çıkarır."""
    axes = status.get("axes") or []
    if len(axes) < 3:
        return None

    values: list[float] = []
    for axis in axes[:3]:
        # Eksen okunamadıysa {"off": True} ya da {"err": "..."} döner
        if not isinstance(axis, dict) or "pos" not in axis:
            return None
        try:
            values.append(float(axis["pos"]))
        except (TypeError, ValueError):
            return None

    return values[0], values[1], values[2]


def to_status_tree(status: dict[str, Any]) -> dict[str, Any]:
    """Gantry Studio yanıtını panelin beklediği durum ağacına çevirir.

    Panel FarmBot'un durum ağacı biçimini bekliyor; böylece 3D görünüm, tarla
    tasarımcısı ve manuel kontrol ekranları hiç değişmeden gerçek veriyle çalışır.
    """
    position = extract_position(status) or (0.0, 0.0, 0.0)
    axes = status.get("axes") or []

    def axis_state(index: int) -> str:
        if index >= len(axes) or not isinstance(axes[index], dict):
            return "unknown"
        axis = axes[index]
        if axis.get("off") or axis.get("err"):
            return "error"
        # jogf/jogb aktifse eksen hareket hâlinde
        return "moving" if (axis.get("jf") or axis.get("jb")) else "idle"

    # `en` = PLC'deki etkinleştirme register'ı. 0 ise sürücüler kilitli.
    enabled = bool(axes[0].get("en")) if axes and isinstance(axes[0], dict) else False
    running_program = bool(status.get("prog"))

    return {
        "location_data": {
            "position": {"x": position[0], "y": position[1], "z": position[2]},
            "axis_states": {
                "x": axis_state(0),
                "y": axis_state(1),
                "z": axis_state(2),
            },
        },
        "informational_settings": {
            "sync_status": "synced" if status.get("ok") else "sync_error",
            "locked": not enabled,
            "busy": running_program or any(
                axis_state(i) == "moving" for i in range(3)
            ),
            "firmware_version": "gantry-studio",
            # Panelde alet durumunu göstermek için
            "current_tool": status.get("current_tool"),
        },
    }
