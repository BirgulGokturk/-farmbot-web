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

# Gantry Studio hareket komutlarında HTTP yanıtını **hareket bitene kadar**
# tutuyor: `movexyz` içeride `safe_goto` çalıştırıyor (Z kaldır → yatayda git →
# indir) ve her eksen için 45 saniyeye kadar bekliyor. Bu yüzden komut zaman
# aşımı cömert olmalı; kısa tutulursa her gerçek hareket ReadTimeout ile
# başarısız olur.
COMMAND_TIMEOUT_SECONDS = 180.0


class GantryUnavailable(Exception):
    """Gantry Studio çalışmıyor ya da yanıt vermiyor."""


class OutOfRange(Exception):
    """Hedef, kullanıcının tanımladığı yumuşak sınırların dışında."""


# --------------------------------------------------------------------------- #
# Eksen kalibrasyonu
# --------------------------------------------------------------------------- #

# Ölçek/kaydırma neden burada?
#   Gantry Studio, PLC'ye kendi biriminde yazıyor ve `cpm` (counts-per-mm)
#   ayarlanmadığında "100 mm git" komutu sahada bambaşka bir mesafeye dönüşüyor.
#   Gantry Studio ortağın kodu; ona dokunmuyoruz. Bunun yerine komutu göndermeden
#   önce ve konumu okuduktan sonra kendi dönüşümümüzü uyguluyoruz. Değerler
#   panelin ayarlar sayfasından geliyor, bulut WebSocket'i üzerinden itiliyor.
NEUTRAL_AXIS: dict[str, Any] = {
    "scale": 1.0,
    "offset": 0.0,
    "invert": False,
    "min_mm": 0.0,
    "max_mm": 1000.0,
    "speed": 20.0,
    "accel": 100.0,
}


class AxisCalibration:
    """Üç eksenin ölçek/kaydırma/yön ve sınır ayarlarını tutar."""

    def __init__(self) -> None:
        self._axes: dict[str, dict[str, Any]] = {
            name: dict(NEUTRAL_AXIS) for name in AXIS_INDEX
        }

    def update(self, axes: dict[str, Any] | None) -> None:
        if not isinstance(axes, dict):
            return
        for name in AXIS_INDEX:
            incoming = axes.get(name)
            if isinstance(incoming, dict):
                merged = dict(NEUTRAL_AXIS)
                merged.update(incoming)
                # Ölçek sıfırsa bölme hatası verir; nötre düş
                if not merged.get("scale"):
                    merged["scale"] = 1.0
                self._axes[name] = merged
        logger.info(
            "Kalibrasyon güncellendi — %s",
            ", ".join(
                f"{n.upper()} ölçek {self._axes[n]['scale']:g}"
                f"{' (ters)' if self._axes[n]['invert'] else ''}"
                for n in ("x", "y", "z")
            ),
        )

    def get(self, axis: str) -> dict[str, Any]:
        return self._axes.get(axis, NEUTRAL_AXIS)

    def to_machine(self, axis: str, user_mm: float) -> float:
        cfg = self.get(axis)
        direction = -1.0 if cfg.get("invert") else 1.0
        return float(cfg["offset"]) + direction * float(cfg["scale"]) * float(user_mm)

    def from_machine(self, axis: str, machine_value: float) -> float:
        cfg = self.get(axis)
        direction = -1.0 if cfg.get("invert") else 1.0
        return direction * (float(machine_value) - float(cfg["offset"])) / float(cfg["scale"])

    def check_limits(self, axis: str, user_mm: float) -> None:
        """Sınır dışıysa anlaşılır bir hata verir.

        Gantry Studio da kendi sınırlarını uyguluyor ama onun mesajı makine
        birimindeki sayıyı söylüyor; kullanıcı panelde milimetre görüyor.
        Kendi sınırımızı önce kontrol edip anlaşılır mesaj veriyoruz.
        """
        cfg = self.get(axis)
        low, high = float(cfg["min_mm"]), float(cfg["max_mm"])
        if not (low <= user_mm <= high):
            raise OutOfRange(
                f"{axis.upper()} ekseni {user_mm:.1f} mm hedefine gidemez; "
                f"izin verilen aralık {low:.0f} – {high:.0f} mm."
            )

    def speed_for(self, axes: list[str], requested: float) -> float:
        """İstenen hızı, hareket eden eksenlerin hız tavanıyla sınırlar.

        Eksen ayarındaki hız bir **üst sınır**; panelin hız kaydırıcısı bunun
        altında serbest. Tersini yapsaydık (doğrudan eksen hızını dayatsaydık)
        manuel kontroldeki kaydırıcı işlevsiz kalırdı.

        `movexyz` tek bir hız alıyor; birden çok eksen hareket ediyorsa en
        düşük tavan geçerli olmalı, yoksa yavaş eksen kapasitesinin üzerine
        zorlanır.
        """
        limits = [float(self.get(name)["speed"]) for name in axes if name in AXIS_INDEX]
        return min([requested, *limits]) if limits else requested


class GantryClient:
    def __init__(
        self,
        base_url: str = "http://localhost:8091",
        username: str = "",
        password: str = "",
        status_timeout: float = 5.0,
        command_timeout: float = COMMAND_TIMEOUT_SECONDS,
    ) -> None:
        self.base_url = base_url.rstrip("/")
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
        # Panelden gelen eksen kalibrasyonu; bulut bağlanınca dolduruluyor
        self.calibration = AxisCalibration()

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

    async def position(self) -> tuple[float, float, float] | None:
        """Anlık X/Y/Z konumu, **kullanıcı milimetresinde**. Okunamazsa None."""
        data = await self.status()
        if data is None:
            return None
        machine = extract_position(data)
        if machine is None:
            return None
        return (
            self.calibration.from_machine("x", machine[0]),
            self.calibration.from_machine("y", machine[1]),
            self.calibration.from_machine("z", machine[2]),
        )

    async def machine_position(self) -> tuple[float, float, float] | None:
        """Ham makine konumu — kalibrasyon sihirbazı bunu kullanıyor."""
        data = await self.status()
        return None if data is None else extract_position(data)

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

    async def move_xyz(
        self,
        x: float,
        y: float,
        z: float,
        speed: float = 20.0,
        *,
        moving: list[str] | None = None,
    ) -> None:
        """Güvenli rotayla hedefe git (Z kaldır → yatayda git → indir).

        x/y/z **kullanıcı milimetresi**; sınır kontrolü ve makine birimine
        çevirme burada yapılıyor. `moving`, hız seçiminde hangi eksenlerin
        gerçekten hareket ettiğini bildirir.
        """
        for axis, value in (("x", x), ("y", y), ("z", z)):
            self.calibration.check_limits(axis, value)

        target = [
            self.calibration.to_machine("x", x),
            self.calibration.to_machine("y", y),
            self.calibration.to_machine("z", z),
        ]
        effective = self.calibration.speed_for(moving or ["x", "y", "z"], speed)
        logger.info(
            "Hedef: X %.1f Y %.1f Z %.1f mm → makine %.2f / %.2f / %.2f (hız %.1f)",
            x, y, z, target[0], target[1], target[2], effective,
        )
        await self.command({"cmd": "movexyz", "target": target, "speed": effective})

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

    async def move_axis(
        self, axis: str, millimetres: float, speed: float | None = None, *, raw: bool = False
    ) -> None:
        """Tek ekseni hedefe götürür (diğer eksenlere dokunmadan).

        `raw=True` kalibrasyonu atlar; ölçüm sihirbazı ham makine birimiyle
        hareket ettirip sonucu cetvelle ölçebilsin diye.
        """
        if raw:
            value = millimetres
        else:
            self.calibration.check_limits(axis, millimetres)
            value = self.calibration.to_machine(axis, millimetres)

        effective = speed if speed is not None else float(self.calibration.get(axis)["speed"])
        await self.command(
            {"cmd": "movej", "axis": AXIS_INDEX[axis], "value": value, "speed": effective}
        )

    async def apply_motion_profile(self, axis: str) -> None:
        """Eksenin hız/ivme değerlerini Gantry Studio'ya yazar.

        Bu, her hareketle değil yalnızca kullanıcı ayarlar sayfasından açıkça
        istediğinde çağrılıyor: PLC'ye yazan bir işlem sessizce arka planda
        çalışmamalı.
        """
        cfg = self.calibration.get(axis)
        await self.command(
            {
                "cmd": "speed",
                "axis": AXIS_INDEX[axis],
                "vel": float(cfg["speed"]),
                "accel": float(cfg["accel"]),
                "decel": float(cfg["accel"]),
            }
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
    status: dict[str, Any], calibration: "AxisCalibration | None" = None
) -> dict[str, Any]:
    """Gantry Studio yanıtını panelin beklediği durum ağacına çevirir.

    Panel FarmBot'un durum ağacı biçimini bekliyor; böylece 3D görünüm, tarla
    tasarımcısı ve manuel kontrol ekranları hiç değişmeden gerçek veriyle çalışır.
    """
    machine = extract_position(status) or (0.0, 0.0, 0.0)
    # Panel her yerde kullanıcı milimetresi gösteriyor; ham makine birimi
    # yalnızca ajanın içinde kalmalı.
    position = (
        (
            calibration.from_machine("x", machine[0]),
            calibration.from_machine("y", machine[1]),
            calibration.from_machine("z", machine[2]),
        )
        if calibration is not None
        else machine
    )
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
