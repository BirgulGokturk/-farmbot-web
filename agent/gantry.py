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
from time import perf_counter
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


# İki konumu "aynı" saymak için tolerans (mm).
#
# Sıfırla karşılaştırmak işe yaramıyor: enkoder okuması her turda birkaç
# yüzde milimetre oynuyor ve tam eşitlik neredeyse hiç tutmuyor. Tolerans
# olmadan robot zaten bulunduğu yere gitmek için gereksiz adımlar atardı.
POSITION_EPSILON = 0.5


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
    # None olan her alan "makineninkini kullan" demek. Varsayılan bir sayı
    # koymak, kalibrasyon hiç ayarlanmamış bir makinede yanlış davranış
    # üretirdi; boş bırakmak `/api/calib`'den geleni yürürlükte tutuyor.
    "cpm": None,
    # `dir` de boş başlamak zorunda. Varsayılan olarak 1 yazılmıştı ve bu değer
    # "doğru" olduğu için makinenin kendi yönünü hiç kullanmıyordu: Z'de makine
    # -1 diyorken panel 1 dayatıyor, eksen ters yönde gösteriliyordu.
    "dir": None,
    "home_mm": None,
    "min_mm": None,
    "max_mm": None,
    "speed": None,
    "accel": None,
}


class AxisCalibration:
    """Üç eksenin ölçek/kaydırma/yön ve sınır ayarlarını tutar.

    İki ayrı sınır kaynağı var ve ikisi de gerekli:

    * **Makine sınırları** — Gantry Studio'nun `gantry_calib.json` dosyasından,
      `/api/calib` ile okunuyor. PLC belgesindeki ifade net: *"Soft limits must
      be enforced in the app before every move. The PLC will not stop you."*
      Yani bu sınırların dışına çıkmak fiziksel çarpma demek; pazarlık konusu
      değil.
    * **Kullanıcı sınırları** — panelden girilen değerler. Bunlar yalnızca
      **daraltabilir**, genişletemez. Kullanıcı 5000 mm yazsa bile makine 425'te
      duruyorsa 425 geçerli olur.

    Kullanıcı sınırı için varsayılan koymuyoruz (bkz. NEUTRAL_AXIS): panelde
    hiçbir şey ayarlanmamışken bile makine sınırları yürürlükte olduğu için
    koruma zaten var.
    """

    def __init__(self) -> None:
        self._axes: dict[str, dict[str, Any]] = {
            name: dict(NEUTRAL_AXIS) for name in AXIS_INDEX
        }
        # Gantry Studio'dan okunan gerçek eksen kalibrasyonu
        self._machine: dict[str, dict[str, float]] = {}
        # Yumuşak sınırlar uygulansın mı? Panelden kapatılabiliyor.
        self.limits_enabled = True

    def set_machine_limits(self, calib: list[dict[str, Any]] | None) -> None:
        """`/api/calib` yanıtını alır (X, Y, Z sırasıyla): cpm, dir, home, min, max."""
        if not isinstance(calib, list):
            return
        machine: dict[str, dict[str, float]] = {}
        for name, index in AXIS_INDEX.items():
            if index >= len(calib) or not isinstance(calib[index], dict):
                continue
            entry = calib[index]
            try:
                machine[name] = {
                    "cpm": float(entry.get("cpm") or 1.0),
                    "dir": float(entry.get("dir", 1)),
                    "home": float(entry.get("home", 0.0)),
                    "min": float(entry["min"]),
                    "max": float(entry["max"]),
                }
            except (KeyError, TypeError, ValueError):
                continue
        if not machine:
            return
        self._machine = machine
        logger.info(
            "Makine kalibrasyonu okundu — %s",
            ", ".join(
                f"{n.upper()} {machine[n]['cpm']:g} count/mm, {machine[n]['min']:.0f}–{machine[n]['max']:.0f} mm"
                for n in ("x", "y", "z")
                if n in machine
            ),
        )

    def mm_from_raw(self, axis: str, raw: float) -> float:
        """Ham register değerini milimetreye çevirir.

        Neden gerekli: Gantry Studio'nun `/api/status` yanıtındaki `pos` alanı
        **ham count**, milimetre değil — kendi arayüzü ekranda gösterirken
        çeviriyor, API ise ham veriyi veriyor. Bunu milimetre sanmak konumu
        `cpm` katı kadar (X'te ~7, Y'de ~2.2) yanlış gösteriyordu; göreli
        hareket de hedefini bu yanlış sayının üstüne kurduğu için sapıyordu.

        Formül PLC belgesinden birebir (PLC_BRIEF.md §5):
            mm = dir * raw / cpm + home
        """
        c = self._resolved(axis)
        return c["dir"] * raw / c["cpm"] + c["home"]

    def user_position(self, raw: tuple[float, float, float]) -> tuple[float, float, float]:
        """Ham register üçlüsünü kullanıcı milimetresine çevirir.

        Kullanılan `cpm`/`dir`/`home`, panelde girilmişse oradan, yoksa
        makinenin kendi kalibrasyonundan geliyor.
        """
        return (
            self.mm_from_raw("x", raw[0]),
            self.mm_from_raw("y", raw[1]),
            self.mm_from_raw("z", raw[2]),
        )

    def machine_snapshot(self) -> dict[str, dict[str, float]]:
        """Makinenin kendi kalibrasyonu — panelde referans olarak gösteriliyor.

        Panel bir alanı boş bıraktığında hangi değerin geçerli olduğunu
        görebilsin diye taşınıyor; yoksa kullanıcı "boş" yazınca ne olacağını
        tahmin etmek zorunda kalıyor.
        """
        return dict(self._machine)

    def effective_limits(self, axis: str) -> tuple[float | None, float | None]:
        """Makine ve kullanıcı sınırlarının kesişimi — en dar olan geçerli."""
        cfg = self.get(axis)
        machine = self._machine.get(axis)

        lows = [v for v in (cfg.get("min_mm"), machine and machine["min"]) if v is not None]
        highs = [v for v in (cfg.get("max_mm"), machine and machine["max"]) if v is not None]

        return (
            max(float(v) for v in lows) if lows else None,
            min(float(v) for v in highs) if highs else None,
        )

    def update(self, axes: dict[str, Any] | None) -> None:
        if not isinstance(axes, dict):
            return
        for name in AXIS_INDEX:
            incoming = axes.get(name)
            if isinstance(incoming, dict):
                merged = dict(NEUTRAL_AXIS)
                merged.update(incoming)
                # counts/mm sıfır olursa bölme hatası verir; boşa çevirip
                # makinenin kendi değerine düşüyoruz
                if not merged.get("cpm"):
                    merged["cpm"] = None
                self._axes[name] = merged

        def describe(axis: str) -> str:
            resolved = self._resolved(axis)
            source = "panel" if self._axes[axis].get("cpm") is not None else "makine"
            return f"{axis.upper()} {resolved['cpm']:g} count/mm ({source})"

        logger.info(
            "Kalibrasyon güncellendi — %s",
            ", ".join(describe(n) for n in ("x", "y", "z")),
        )

    def get(self, axis: str) -> dict[str, Any]:
        return self._axes.get(axis, NEUTRAL_AXIS)

    def _resolved(self, axis: str) -> dict[str, float]:
        """Panelden girilen değerlerle makineninkini birleştirir.

        Panel bir alanı boş bıraktıysa makinenin `/api/calib` değeri geçerli.
        Böylece kullanıcı hiçbir şey ayarlamadan da doğru çalışıyor, ama
        istediğinde tek tek üzerine yazabiliyor.
        """
        user = self.get(axis)
        machine = self._machine.get(axis, {})

        def pick(user_key: str, machine_key: str, fallback: float) -> float:
            value = user.get(user_key)
            if value is None:
                value = machine.get(machine_key)
            return float(fallback if value is None else value)

        return {
            "cpm": pick("cpm", "cpm", 1.0) or 1.0,
            "dir": pick("dir", "dir", 1.0) or 1.0,
            "home": pick("home_mm", "home", 0.0),
        }

    def check_limits(self, axis: str, user_mm: float) -> None:
        """Sınır dışıysa anlaşılır bir hata verir.

        Panelden `limits_enabled` kapatıldıysa hiç kontrol yapılmıyor —
        kalibrasyon sırasında sınırlar henüz doğru değilken gerekiyor.


        Gantry Studio da kendi sınırlarını uyguluyor ama onun mesajı makine
        birimindeki sayıyı söylüyor; kullanıcı panelde milimetre görüyor.
        Kendi sınırımızı önce kontrol edip anlaşılır mesaj veriyoruz.
        """
        if not self.limits_enabled:
            return

        low, high = self.effective_limits(axis)

        if low is not None and user_mm < low:
            raise OutOfRange(
                f"{axis.upper()} ekseni {user_mm:.1f} mm hedefine gidemez; "
                f"alt sınır {low:.0f} mm."
            )
        if high is not None and user_mm > high:
            raise OutOfRange(
                f"{axis.upper()} ekseni {user_mm:.1f} mm hedefine gidemez; "
                f"üst sınır {high:.0f} mm."
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
        limits = [
            float(self.get(name)["speed"])
            for name in axes
            if name in AXIS_INDEX and self.get(name).get("speed") is not None
        ]
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
        # Son durum okumasının gidiş-dönüş süresi (ms)
        self.last_latency_ms: float | None = None

        # --- Güvenli geçiş yüksekliği ---
        # Uç aşağıdayken yatayda gitmek yoldaki bitkileri biçer. Bu yüzden her
        # X/Y hareketinden önce Z buraya çekiliyor, varılınca hedefe iniliyor.
        #
        # `None` = koruma kapalı ve hareket bugünküyle birebir aynı. Bir sayı
        # uydurmuyoruz: hangi yönün "yukarı" olduğu makineye göre değişiyor
        # (Z yönü -1, ev 440 mm) ve yanlış bir varsayılan her harekette ucu
        # toprağa sürtmek demek olurdu. Kullanıcı panelden girene kadar kapalı.
        self.safe_z: float | None = None
        self.travel_guard: bool = True

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
        started = perf_counter()
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
        # Gidiş-dönüş süresi tanılama ekranında gösteriliyor: PLC yolunun
        # yavaşlaması, hareketin neden geciktiğini anlamanın en hızlı yolu.
        self.last_latency_ms = (perf_counter() - started) * 1000.0
        return data

    async def position(self) -> tuple[float, float, float] | None:
        """Anlık X/Y/Z konumu, **kullanıcı milimetresinde**. Okunamazsa None."""
        data = await self.status()
        if data is None:
            return None
        raw = extract_position(data)
        if raw is None:
            return None
        return self.calibration.user_position(raw)

    async def machine_position(self) -> tuple[float, float, float] | None:
        """Ham makine konumu — kalibrasyon sihirbazı bunu kullanıyor."""
        data = await self.status()
        return None if data is None else extract_position(data)

    async def refresh_machine_limits(self) -> bool:
        """Eksen sınırlarını Gantry Studio'nun kalibrasyonundan tazeler.

        PLC belgesindeki kural: yumuşak sınırları uygulamak **uygulamanın**
        işi, PLC durdurmuyor. Bu yüzden sınırları tahmin etmiyor, makinenin
        kendi kalibrasyon dosyasından okuyoruz. Ulaşılamazsa sessizce geçiyoruz;
        hareket zaten Gantry Studio ayakta değilken yapılamıyor.
        """
        try:
            response = await self._http.get("/api/calib", timeout=self._status_timeout)
            response.raise_for_status()
            data = response.json()
        except Exception as exc:
            logger.warning("Eksen sınırları okunamadı (%s)", exc)
            return False

        # Gantry Studio yanıtı {"calib": [...]} sarmalıyla döndürüyor
        calib = data.get("calib") if isinstance(data, dict) else data
        self.calibration.set_machine_limits(calib)
        return True

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
        """Güvenli rotayla hedefe git: Z'yi kaldır → yatayda git → indir.

        x/y/z **kullanıcı milimetresi**; sınır kontrolü ve makine birimine
        çevirme burada yapılıyor. `moving`, hız seçiminde hangi eksenlerin
        gerçekten hareket ettiğini bildirir.

        Koruma neden burada:
          Uygulanabilmesi için robotun **o an nerede olduğunu** bilmek gerekiyor
          ve bunu yalnızca bu katman biliyor. Buraya koyunca komutu kimin
          ürettiği fark etmiyor — tasarımcının "Git" düğmesi, sulama, ekim,
          diziler ve ham komutlar aynı korumadan geçiyor.
        """
        for axis, value in (("x", x), ("y", y), ("z", z)):
            self.calibration.check_limits(axis, value)

        if not self._guard_active():
            await self._raw_move(x, y, z, speed, moving)
            return

        safe_z = float(self.safe_z)  # _guard_active None olmadığını doğruladı
        current = await self.position()
        if current is None:
            # Nerede olduğumuzu bilmeden Z'yi oynatmak kör hareket olurdu;
            # korumasız ama beklenen tek adımı göndermek daha az riskli.
            logger.warning("Konum okunamadı; güvenli yükseklik atlanıyor")
            await self._raw_move(x, y, z, speed, moving)
            return

        yatay = abs(current[0] - x) > POSITION_EPSILON or abs(current[1] - y) > POSITION_EPSILON

        if yatay:
            # 1) Ucu **olduğu yerde** kaldır. X/Y'yi mevcut değerinde tutuyoruz:
            #    hedefe doğru kaymaya başlarsa çukurdan çıkarken toprağı yarar.
            if abs(current[2] - safe_z) > POSITION_EPSILON:
                logger.info("Güvenli yüksekliğe çekiliyor: Z %.1f mm", safe_z)
                await self._raw_move(current[0], current[1], safe_z, speed, ["z"])

            # 2) Yatayda git — artık yol boyunca uç yukarıda.
            #    Hız için yalnızca X/Y'ye bakılıyor: bu adımda Z durgun ve
            #    Z'nin (genelde daha düşük) hız tavanı yolu yavaşlatmamalı.
            await self._raw_move(x, y, safe_z, speed, ["x", "y"])

        # 3) Hedef yüksekliğe in (zaten oradaysak adım atlanır)
        if abs(z - safe_z) > POSITION_EPSILON or not yatay:
            await self._raw_move(x, y, z, speed, ["z"] if yatay else moving)

    def _guard_active(self) -> bool:
        """Güvenli geçiş uygulanacak mı?

        Yükseklik sınırların dışındaysa uygulamıyoruz: koruma olsun derken
        her hareketi `OutOfRange` ile reddetmek makineyi tamamen kilitlerdi.
        """
        if self.safe_z is None or not self.travel_guard:
            return False
        try:
            self.calibration.check_limits("z", float(self.safe_z))
        except OutOfRange:
            logger.warning(
                "Güvenli yükseklik (%.1f mm) Z sınırlarının dışında; koruma atlanıyor",
                self.safe_z,
            )
            return False
        return True

    async def _raw_move(
        self,
        x: float,
        y: float,
        z: float,
        speed: float,
        moving: list[str] | None = None,
    ) -> None:
        """Tek adımlık hareket — güvenli rota bunu parçalar hâlinde çağırıyor."""
        # Hedef **milimetre** olarak gidiyor: Gantry Studio'nun `/api/cmd`
        # arayüzü mm alıp count'a kendi çeviriyor (PLC_BRIEF.md §6). Burada bir
        # kez daha çevirseydik dönüşüm iki kez uygulanırdı.
        effective = self.calibration.speed_for(moving or ["x", "y", "z"], speed)
        logger.info(
            "Hedef: X %.1f · Y %.1f · Z %.1f mm (hız %.1f)", x, y, z, effective
        )
        await self.command({"cmd": "movexyz", "target": [x, y, z], "speed": effective})

    async def go_home(self, axis: str = "all") -> None:
        """Eve dön.

        `all` için sıralama Z → X → Y: önce Z'yi yukarı almazsak alet toprakta
        sürünerek yatay harekete başlar.

        Yalnızca X ya da Y eve çağrıldığında bu sıralama devreye girmiyor —
        o yüzden önce ucu güvenli yüksekliğe çekiyoruz. Kullanıcının "X'i eve
        gönder" demesi, yoldaki bitkileri feda etmeyi göze aldığı anlamına
        gelmiyor.
        """
        if axis in {"x", "y", "xy"}:
            await self.retract_to_safe()

        if axis == "all":
            order = [2, 0, 1]
        elif axis == "xy":
            order = [0, 1]
        else:
            order = [AXIS_INDEX[axis]]

        for index in order:
            await self.command({"cmd": "gohome", "axis": index})

    async def retract_to_safe(self) -> None:
        """Ucu, X/Y'yi kıpırdatmadan güvenli yüksekliğe çeker."""
        if not self._guard_active():
            return
        current = await self.position()
        if current is None:
            logger.warning("Konum okunamadı; uç kaldırılamadı")
            return
        safe_z = float(self.safe_z)
        if abs(current[2] - safe_z) <= POSITION_EPSILON:
            return
        logger.info("Güvenli yüksekliğe çekiliyor: Z %.1f mm", safe_z)
        await self._raw_move(current[0], current[1], safe_z, 20.0, ["z"])

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

        `raw=True` yumuşak sınır kontrolünü atlar; kalibrasyon sihirbazı
        sınırlar henüz doğru değilken de ekseni sürebilsin diye.
        """
        if not raw:
            self.calibration.check_limits(axis, millimetres)
        value = millimetres

        cap = self.calibration.get(axis).get("speed")
        effective = speed if speed is not None else float(cap) if cap is not None else 20.0
        await self.command(
            {"cmd": "movej", "axis": AXIS_INDEX[axis], "value": value, "speed": effective}
        )

    async def write_machine_calibration(self, axes: dict[str, Any]) -> None:
        """Panelde girilen kalibrasyonu Gantry Studio'ya yazar.

        Neden makineye yazıyoruz, kendimizde tutmuyoruz: PLC belgesine göre
        `gantry_calib.json` tek doğru kaynak (PLC_BRIEF.md §5). Kendi kopyamızı
        tutsaydık okuma bizim değerimizle, hareket Gantry Studio'nunkiyle
        yapılırdı — ikisi ayrışınca konum ile gerçek yer birbirini tutmazdı.

        Yazma başarısız olursa **sessiz kalmıyoruz**: kullanıcı kaydet düğmesine
        bastıysa sonucu görmeli.
        """
        payload = []
        for name in ("x", "y", "z"):
            cfg = axes.get(name) or {}
            merged = self.calibration._resolved(name)
            limits = self.calibration.effective_limits(name)
            payload.append(
                {
                    "cpm": merged["cpm"],
                    "dir": int(merged["dir"]),
                    "home": merged["home"],
                    "min": 0.0 if limits[0] is None else limits[0],
                    "max": 0.0 if limits[1] is None else limits[1],
                }
            )

        try:
            response = await self._http.post(
                "/api/calib", json={"calib": payload}, timeout=self._command_timeout
            )
            response.raise_for_status()
            result = response.json()
        except Exception as exc:
            raise GantryUnavailable(
                f"Kalibrasyon Gantry Studio'ya yazılamadı ({exc}). "
                "Bu sürümde kalibrasyon yazma uç noktası olmayabilir."
            ) from exc

        if isinstance(result, dict) and not result.get("ok", True):
            raise GantryUnavailable(result.get("error") or "Kalibrasyon reddedildi")

        await self.refresh_machine_limits()
        logger.info("Kalibrasyon Gantry Studio'ya yazıldı")

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
                "vel": float(cfg["speed"] if cfg.get("speed") is not None else 20.0),
                "accel": float(cfg["accel"] if cfg.get("accel") is not None else 100.0),
                "decel": float(cfg["accel"] if cfg.get("accel") is not None else 100.0),
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
    status: dict[str, Any],
    calibration: "AxisCalibration | None" = None,
    latency_ms: float | None = None,
) -> dict[str, Any]:
    """Gantry Studio yanıtını panelin beklediği durum ağacına çevirir.

    Panel FarmBot'un durum ağacı biçimini bekliyor; böylece 3D görünüm, tarla
    tasarımcısı ve manuel kontrol ekranları hiç değişmeden gerçek veriyle çalışır.
    """
    raw = extract_position(status) or (0.0, 0.0, 0.0)
    # Panel her yerde milimetre gösteriyor; ham register değeri yalnızca
    # ajanın içinde kalmalı.
    position = calibration.user_position(raw) if calibration is not None else raw
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

    # Ham register değerleri tanılama ekranına olduğu gibi taşınıyor.
    # Otomasyon tarafında sorun ararken milimetre değil, PLC'nin gerçekte ne
    # tuttuğu önemli: enable biti, jog bitleri, hız/ivme ve ham konum.
    raw_axes = []
    for index in range(3):
        entry = axes[index] if index < len(axes) and isinstance(axes[index], dict) else {}
        raw_axes.append(
            {
                "en": entry.get("en"),
                "jf": entry.get("jf"),
                "jb": entry.get("jb"),
                "vel": entry.get("vel"),
                "accel": entry.get("accel"),
                "decel": entry.get("decel"),
                "pos": entry.get("pos"),
                "err": entry.get("err"),
                "off": bool(entry.get("off")),
            }
        )

    return {
        "diagnostics": {
            "axes_raw": raw_axes,
            "machine_calib": calibration.machine_snapshot() if calibration else {},
            "gantry_latency_ms": latency_ms,
            "presence": status.get("presence"),
        },
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
