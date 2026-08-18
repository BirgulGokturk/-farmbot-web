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

from axes import AxisConfig

logger = logging.getLogger("farmbot-agent.gantry")


# Gantry Studio hareket komutlarında HTTP yanıtını **hareket bitene kadar**
# tutuyor: `movexyz` içeride `safe_goto` çalıştırıyor (Z kaldır → yatayda git →
# indir) ve her eksen için 45 saniyeye kadar bekliyor. Bu yüzden komut zaman
# aşımı cömert olmalı; kısa tutulursa her gerçek hareket ReadTimeout ile
# başarısız olur.
COMMAND_TIMEOUT_SECONDS = 180.0


class GantryUnavailable(Exception):
    """Gantry Studio çalışmıyor ya da yanıt vermiyor."""


class GantryClient:
    def __init__(
        self,
        base_url: str = "http://localhost:8091",
        username: str = "",
        password: str = "",
        status_timeout: float = 5.0,
        command_timeout: float = COMMAND_TIMEOUT_SECONDS,
        axes: AxisConfig | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        # Panel ekseni <-> makine ekseni eslemesi (gantry_axes.json)
        self.axes = axes or AxisConfig.load()
        self._status_timeout = status_timeout
        self._command_timeout = command_timeout

        headers: dict[str, str] = {}
        # gantry_config.json'da kullanıcı/parola tanımlıysa temel kimlik doğrulama
        if username or password:
            token = base64.b64encode(f"{username}:{password}".encode()).decode()
            headers["Authorization"] = f"Basic {token}"

        # Zaman aşımı isteğe göre ayrı veriliyor (aşağıdaki nota bakın)
        self._http = httpx.AsyncClient(base_url=self.base_url, headers=headers)
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
            response = await self._http.get("/api/status", timeout=self._status_timeout)
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

    async def calib(self) -> list[dict] | None:
        """Gantry Studio'nun eksen kalibrasyonu (cpm, dir, home, min, max).

        Yumuşak limitler buradan geliyor; panel jog düğmelerini bu değerlere
        göre kilitliyor.
        """
        try:
            response = await self._http.get("/api/calib", timeout=self._status_timeout)
            response.raise_for_status()
            return response.json().get("calib")
        except Exception:
            return None

    async def position(self) -> dict[str, float] | None:
        """Anlık konum, PANEL eksenlerine çevrilmiş olarak (mm)."""
        data = await self.status()
        if data is None:
            return None
        raw = extract_position(data)
        if raw is None:
            return None
        return self.axes.from_gantry(list(raw))

    # ------------------------------------------------------------------ #
    # Komutlar
    # ------------------------------------------------------------------ #

    async def command(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Komut gönderir. Gantry Studio hata döndürürse istisna fırlatır.

        Okumadan farklı olarak burada sessiz kalmıyoruz: kullanıcı panelde bir
        düğmeye bastıysa sonucu görmeli.
        """
        try:
            response = await self._http.post(
                "/api/cmd", json=payload, timeout=self._command_timeout
            )
            response.raise_for_status()
            result = response.json()
        except httpx.TimeoutException as exc:
            # Zaman aşımı ile "servis kapalı" farklı sorunlar; ayrı mesaj verelim
            raise GantryUnavailable(
                f"Hareket {self._command_timeout:.0f} saniyede tamamlanmadı. "
                "Eksen sıkışmış ya da hedef çok uzak olabilir."
            ) from exc
        except Exception as exc:
            # httpx bazı hatalarda boş mesaj döndürüyor; tipi de yazalım ki
            # günlükten sebep anlaşılsın
            detail = str(exc) or type(exc).__name__
            raise GantryUnavailable(
                f"Hareket kontrolüne ulaşılamıyor ({detail}). "
                "Raspberry Pi'de gantry-studio servisi çalışıyor mu?"
            ) from exc

        if not result.get("ok", True):
            # Gantry Studio'nun kendi güvenlik reddi de buradan gelir,
            # ör. "Z güvenli konumda değil" — mesajı olduğu gibi aktarıyoruz
            raise GantryUnavailable(result.get("error") or "Hareket komutu reddedildi")
        return result

    async def move_xyz(self, x: float, y: float, z: float, speed: float = 20.0) -> None:
        """Güvenli rotayla hedefe git (Z kaldır → yatayda git → indir).

        Koordinatlar PANEL eksenlerinde verilir; burada makinenin sırasına
        çevrilir. Panelde X'e basınca fiziksel Z'nin hareket etmesinin sebebi
        bu çevrimin eksik olmasıydı.
        """
        target = self.axes.to_gantry_target(x, y, z)
        await self.command({"cmd": "movexyz", "target": target, "speed": speed})

    async def go_home(self, axis: str = "all") -> None:
        """Eve dön.

        `all` için sıralama Z → X → Y. Önce Z'yi yukarı almazsak alet toprakta
        sürünerek yatay harekete başlar.
        """
        # Z önce yukarı: panel Z'sinin makinedeki karşılığını kullanıyoruz
        order = (
            [self.axes.gantry_index("z"), self.axes.gantry_index("x"), self.axes.gantry_index("y")]
            if axis == "all"
            else [self.axes.gantry_index(axis)]
        )
        for index in order:
            await self.command({"cmd": "gohome", "axis": index})

    async def jog(self, axis: str, forward: bool, value: bool) -> None:
        # Yön ters tanımlıysa ileri/geri komutunu da çeviriyoruz
        if self.axes.invert.get(axis):
            forward = not forward
        await self.command(
            {
                "cmd": "jogf" if forward else "jogb",
                "axis": self.axes.gantry_index(axis),
                "value": 1 if value else 0,
            }
        )

    async def move_axis(self, axis: str, millimetres: float, speed: float = 20.0) -> None:
        await self.command(
            {"cmd": "movej", "axis": self.axes.gantry_index(axis), "value": millimetres, "speed": speed}
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


def to_status_tree(
    status: dict[str, Any],
    axes_config: AxisConfig | None = None,
    calib: list[dict] | None = None,
) -> dict[str, Any]:
    """Gantry Studio yanıtını panelin beklediği durum ağacına çevirir.

    Panel FarmBot'un durum ağacı biçimini bekliyor; böylece 3D görünüm, tarla
    tasarımcısı ve manuel kontrol ekranları hiç değişmeden gerçek veriyle çalışır.

    Eksen sırası da burada panel eksenlerine çevriliyor — makinedeki 1. eksen
    panelin X'i olmak zorunda değil.
    """
    config = axes_config or AxisConfig()
    raw = extract_position(status) or (0.0, 0.0, 0.0)
    position = config.from_gantry(list(raw))
    axes = status.get("axes") or []

    def axis_state(panel_axis: str) -> str:
        index = config.gantry_index(panel_axis)
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
    states = {axis: axis_state(axis) for axis in ("x", "y", "z")}

    return {
        "location_data": {
            "position": position,
            "axis_states": states,
        },
        "informational_settings": {
            "sync_status": "synced" if status.get("ok") else "sync_error",
            "locked": not enabled,
            "busy": running_program or any(state == "moving" for state in states.values()),
            "firmware_version": "gantry-studio",
            "current_tool": status.get("current_tool"),
            # Panel jog düğmelerini bu limitlere göre kilitliyor; kullanıcı
            # sınır dışına çıkan bir komutu göndermeden önce uyarı görüyor
            "axis_limits": config.limits_for(calib),
        },
    }
