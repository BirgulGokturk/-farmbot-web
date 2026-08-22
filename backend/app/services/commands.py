"""CeleryScript RPC komut üreticileri.

Her fonksiyon, robota MQTT ile gönderilecek JSON gövdesini döndürür.
Biçim FarmBot'un kendi protokolüyle uyumludur — bkz. docs/MQTT.md
"""

from __future__ import annotations

import uuid
from typing import Any

# Robotun komutları sıraya koyarken kullandığı öncelik. Acil durdurma daha yüksek.
DEFAULT_PRIORITY = 500
EMERGENCY_PRIORITY = 9000


def rpc_request(
    body: list[dict[str, Any]],
    label: str | None = None,
    priority: int = DEFAULT_PRIORITY,
) -> dict[str, Any]:
    """Bir veya daha fazla adımı RPC zarfına sarar.

    `label` yanıtı eşleştirmek için kullanılır; verilmezse üretilir.
    """
    return {
        "kind": "rpc_request",
        "args": {"label": label or str(uuid.uuid4()), "priority": priority},
        "body": body,
    }


def _coordinate(x: float, y: float, z: float) -> dict[str, Any]:
    return {"kind": "coordinate", "args": {"x": x, "y": y, "z": z}}


# --------------------------------------------------------------------------- #
# Hareket
# --------------------------------------------------------------------------- #

def move_absolute(x: float, y: float, z: float, speed: int = 100) -> dict[str, Any]:
    """Mutlak koordinata git (mm)."""
    return {
        "kind": "move_absolute",
        "args": {
            "location": _coordinate(x, y, z),
            "offset": _coordinate(0, 0, 0),
            "speed": speed,
        },
    }


def move_relative(x: float = 0, y: float = 0, z: float = 0, speed: int = 100) -> dict[str, Any]:
    """Bulunduğu yerden göreli adım at — jog pad bunu kullanır."""
    return {"kind": "move_relative", "args": {"x": x, "y": y, "z": z, "speed": speed}}


def home(axis: str = "all", speed: int = 100) -> dict[str, Any]:
    """Ekseni sıfır konumuna götür."""
    return {"kind": "home", "args": {"axis": axis, "speed": speed}}


def find_home(axis: str = "all", speed: int = 100) -> dict[str, Any]:
    """Sınır anahtarı/enkoder ile gerçek ev konumunu bul."""
    return {"kind": "find_home", "args": {"axis": axis, "speed": speed}}


def calibrate(axis: str = "all") -> dict[str, Any]:
    """Eksen uzunluğunu ölçerek kalibre et."""
    return {"kind": "calibrate", "args": {"axis": axis}}


def set_zero(axis: str = "all") -> dict[str, Any]:
    """Mevcut konumu o eksenin sıfırı kabul et."""
    return {"kind": "zero", "args": {"axis": axis}}


# --------------------------------------------------------------------------- #
# Pinler (çevre birimleri ve sensörler)
# --------------------------------------------------------------------------- #

def write_pin(pin: int, value: int, mode: int = 0) -> dict[str, Any]:
    """Çıkış pinine değer yaz. mode: 0 = dijital, 1 = analog (PWM)."""
    return {
        "kind": "write_pin",
        "args": {"pin_number": pin, "pin_value": value, "pin_mode": mode},
    }


def toggle_pin(pin: int) -> dict[str, Any]:
    return {"kind": "toggle_pin", "args": {"pin_number": pin}}


def read_pin(pin: int, mode: int = 1, label: str = "---") -> dict[str, Any]:
    """Sensör oku. mode: 0 = dijital, 1 = analog."""
    return {
        "kind": "read_pin",
        "args": {"pin_number": pin, "pin_mode": mode, "label": label},
    }


def set_servo_angle(pin: int, angle: int) -> dict[str, Any]:
    return {"kind": "set_servo_angle", "args": {"pin_number": pin, "pin_value": angle}}


# --------------------------------------------------------------------------- #
# Sulama — yüksek seviyeli yardımcı
# --------------------------------------------------------------------------- #

def water_at(
    x: float,
    y: float,
    z: float,
    duration_ms: int,
    pump_pin: int = 8,
    speed: int = 100,
    safe_z: float = 0,
) -> list[dict[str, Any]]:
    """Bir noktaya git, pompayı süreyle çalıştır, güvenli yüksekliğe dön.

    Tek RPC gövdesi olarak gönderilir; robot adımları sırayla uygular.
    """
    return [
        move_absolute(x, y, safe_z, speed),   # önce güvenli yükseklikte yatayda git
        move_absolute(x, y, z, speed),        # sonra alçal
        write_pin(pump_pin, 1, 0),            # pompayı aç
        wait(duration_ms),
        write_pin(pump_pin, 0, 0),            # pompayı kapat
        move_absolute(x, y, safe_z, speed),   # güvenli yüksekliğe dön
    ]


# --------------------------------------------------------------------------- #
# Vakumlu tohum ekimi
# --------------------------------------------------------------------------- #
#
# Buradaki adımlar düz `move_absolute` üretiyor; "önce Z'yi kaldır" korumasını
# eklemiyoruz. Sebebi: korumayı uygulayabilmek için robotun **o an nerede
# olduğunu** bilmek gerekiyor ve bunu yalnızca ajan biliyor. Bu yüzden koruma
# ajanda, yani makineye açılan son kapıda uygulanıyor (agent/farmbot_agent.py).
#
# Böylece koruma tek bir yerde duruyor ve komutu kimin ürettiğinden bağımsız
# olarak geçerli oluyor: tasarımcının "Git" düğmesi, sulama, ekim, diziler ve
# eve dönüş — hepsi aynı korumadan geçiyor.

def sow_at(
    x: float,
    y: float,
    soil_z: float,
    depth_mm: float,
    *,
    tray: tuple[float, float, float],
    vacuum_pin: int = 9,
    pick_dwell_ms: int = 800,
    release_dwell_ms: int = 500,
    speed: int = 100,
) -> list[dict[str, Any]]:
    """Vakumlu uçla tek tohum ek.

    Tepsiden al → hedefe götür → çukura bırak. Adımlar tek RPC gövdesi olarak
    gidiyor; robot sırayla uyguluyor ve arada başka komut araya giremiyor —
    yarı yolda kalan bir ekim, ucunda tohum asılı bir robot bırakırdı.

    `depth_mm` toprak yüzeyinden **aşağı** ölçülüyor, bu yüzden çıkarılıyor:
    yüzey Z'si 0 ve derinlik 15 ise tohum -15'e bırakılıyor.
    """
    tray_x, tray_y, tray_z = tray
    return [
        # 1) Tohum tepsisine in ve tohumu vakumla al
        move_absolute(tray_x, tray_y, tray_z, speed),
        write_pin(vacuum_pin, 1, 0),
        wait(pick_dwell_ms),
        # 2) Tohum uçta asılıyken hedefe git ve çukura indir
        move_absolute(x, y, soil_z - depth_mm, speed),
        # 3) Vakumu kes; tohum düşsün diye biraz bekle
        write_pin(vacuum_pin, 0, 0),
        wait(release_dwell_ms),
    ]


def sulama_recetesi(
    x: float,
    y: float,
    soil_z: float,
    safe_z: float,
    recete: dict[str, Any],
    *,
    water_pin: int | None,
    air_pin: int | None,
    valve_pin: int | None = None,
    speed: int = 100,
) -> list[dict[str, Any]]:
    """Sulama reçetesini komut dizisine çevirir.

    Sıra eskiden koda gömülüydü. Sahada bu yetmiyor: kimi kurulumda hava
    pompası suyu itmek için **önce**, kimi kurulumda hattı boşaltmak için
    **sonra** çalışıyor; kimi bitki köke iniş istiyor, kimi yukarıdan damlama.

    Vana su hattında ve pompayı **sarmalıyor**: pompadan önce açılıyor, sonra
    kapanıyor. Pompayı kapalı vanaya karşı çalıştırmak hattı zorlar; vanayı
    pompa durur durmaz kapatmak da hatta basınç hapseder. Aradaki iki bekleme
    (`valve_lead_ms`, `valve_lag_ms`) bunun içindir.

    Bir birimin pini tanımlı değilse o adım hiç üretilmiyor — tanımsız bir
    pini sürmek, bahçede rastgele bir röleyi tetiklemek demek olurdu.
    """
    adimlar: list[dict[str, Any]] = []

    if recete.get("go_to_plant", True):
        # Yatay hareket güvenli yükseklikte; iniş ayrı adım. Ajandaki koruma
        # da aynısını yapıyor ama burada açıkça yazmak diziyi okunur kılıyor.
        adimlar.append(move_absolute(x, y, safe_z, speed))
        if recete.get("descend", True):
            adimlar.append(move_absolute(x, y, soil_z, speed))

    if recete.get("pre_delay_ms"):
        adimlar.append(wait(int(recete["pre_delay_ms"])))

    def calistir(pin: int | None, sure_ms: int) -> list[dict[str, Any]]:
        if not pin or sure_ms <= 0:
            return []
        return [write_pin(pin, 1, 0), wait(sure_ms), write_pin(pin, 0, 0)]

    su = calistir(water_pin, int(recete.get("water_ms", 0)))
    hava = calistir(air_pin, int(recete.get("air_ms", 0)))

    # Vana yalnızca su gerçekten akacaksa açılıyor: su süresi sıfırken vanayı
    # açıp kapatmak boşuna aşınma.
    vana_var = bool(valve_pin) and bool(su)
    if vana_var:
        adimlar.append(write_pin(valve_pin, 1, 0))
        if recete.get("valve_lead_ms"):
            adimlar.append(wait(int(recete["valve_lead_ms"])))

    once, sonra = (su, hava) if recete.get("water_first", True) else (hava, su)
    adimlar.extend(once)
    # Bekleme yalnızca **iki pompa da çalışıyorsa** anlamlı; tek pompada
    # araya boşluk koymak sulamayı sebepsiz uzatırdı.
    if once and sonra and recete.get("between_ms"):
        adimlar.append(wait(int(recete["between_ms"])))
    adimlar.extend(sonra)

    if vana_var:
        if recete.get("valve_lag_ms"):
            adimlar.append(wait(int(recete["valve_lag_ms"])))
        adimlar.append(write_pin(valve_pin, 0, 0))

    if recete.get("post_delay_ms"):
        adimlar.append(wait(int(recete["post_delay_ms"])))

    if recete.get("retract", True) and recete.get("go_to_plant", True):
        adimlar.append(move_absolute(x, y, safe_z, speed))

    return adimlar


# --------------------------------------------------------------------------- #
# Uç değiştirme
# --------------------------------------------------------------------------- #
#
# Kural (PLC_BRIEF.md §7): kafa ucun **üstüne dikey inemez**, uca yandan ve
# yalnızca tek eksen boyunca kayarak girer. Sıra:
#
#   ① Geçiş Z'ye çık → ② yaklaşma noktası üzerine yatayda git → ③ ucun yanında
#   alçal → ④ altına kay (tek eksen) → ⑤ kilitle → ⑥ Lift kadar kaldır
#
# Bırakma bunun tersi. Geçiş Z en uzun uçtan yüksek olmalı; kafa yatayda o
# yükseklikte gidiyor ve alçak kalırsa aradaki uçlara çarpar.


def _yaklasma(slot: dict[str, Any], zone: dict[str, Any]) -> tuple[float, float]:
    """Kayma ekseni boyunca kaydırılmış yaklaşma noktası."""
    offset = float(zone.get("approach_offset", 0.0))
    if str(zone.get("slide_axis", "y")).lower() == "x":
        return float(slot["x"]) + offset, float(slot["y"])
    return float(slot["x"]), float(slot["y"]) + offset


def uc_al(slot: dict[str, Any], zone: dict[str, Any], speed: int = 20) -> list[dict[str, Any]]:
    """Yuvadaki ucu alır."""
    travel_z = float(zone.get("travel_z", 0.0))
    lift = float(zone.get("lift_mm", 0.0))
    ax, ay = _yaklasma(slot, zone)
    x, y, z = float(slot["x"]), float(slot["y"]), float(slot["z"])

    adimlar = [
        # ① Ucu olduğu yerde yukarı çek. X/Y'yi bilmediğimiz için hedefin
        #    X/Y'sini veriyoruz; ajandaki koruma zaten önce Z'yi kaldırıyor.
        move_absolute(ax, ay, travel_z, speed),
        move_absolute(ax, ay, z, speed),      # ③ ucun yanında alçal
        move_absolute(x, y, z, speed),        # ④ altına kay (tek eksen)
    ]
    # ⑤ Kilitleme servosu PLC yazmacıyla sürülüyor ve ajan PLC'ye yazmıyor;
    #    yazmaç tanımlanana kadar bu adım üretilmiyor.
    if zone.get("lock_delay_ms"):
        adimlar.append(wait(int(zone["lock_delay_ms"])))
    adimlar.append(move_absolute(x, y, z + lift, speed))  # ⑥ kaldır
    return adimlar


def uc_birak(slot: dict[str, Any], zone: dict[str, Any], speed: int = 20) -> list[dict[str, Any]]:
    """Takılı ucu yuvasına bırakır — alma dizisinin tersi."""
    travel_z = float(zone.get("travel_z", 0.0))
    lift = float(zone.get("lift_mm", 0.0))
    ax, ay = _yaklasma(slot, zone)
    x, y, z = float(slot["x"]), float(slot["y"]), float(slot["z"])

    adimlar = [
        move_absolute(x, y, travel_z, speed),
        move_absolute(x, y, z + lift, speed),
        move_absolute(x, y, z, speed),
    ]
    if zone.get("lock_delay_ms"):
        adimlar.append(wait(int(zone["lock_delay_ms"])))
    adimlar.extend([
        move_absolute(ax, ay, z, speed),        # yuvadan yana kay
        move_absolute(ax, ay, travel_z, speed),  # yukarı çık
    ])
    return adimlar


def uc_hazirla(
    hedef: dict[str, Any] | None,
    takili: dict[str, Any] | None,
    zone: dict[str, Any],
    speed: int = 20,
) -> list[dict[str, Any]]:
    """Doğru ucun takılı olmasını sağlar.

    Zaten doğru uç takılıysa **hiç adım üretmiyor**: her sulamada ucu bırakıp
    yeniden almak hem zaman kaybı hem gereksiz aşınma.
    """
    if hedef is None:
        return []
    if takili is not None and takili.get("name") == hedef.get("name"):
        return []

    adimlar: list[dict[str, Any]] = []
    if takili is not None:
        adimlar.extend(uc_birak(takili, zone, speed))
    adimlar.extend(uc_al(hedef, zone, speed))
    return adimlar


def wait(milliseconds: int) -> dict[str, Any]:
    return {"kind": "wait", "args": {"milliseconds": milliseconds}}


# --------------------------------------------------------------------------- #
# Kamera ve sistem
# --------------------------------------------------------------------------- #

def take_photo() -> dict[str, Any]:
    return {"kind": "take_photo", "args": {}}


def emergency_lock() -> dict[str, Any]:
    """ACİL DURDURMA — tüm hareketi anında keser."""
    return {"kind": "emergency_lock", "args": {}}


def emergency_unlock() -> dict[str, Any]:
    return {"kind": "emergency_unlock", "args": {}}


def reboot() -> dict[str, Any]:
    return {"kind": "reboot", "args": {"package": "farmbot_os"}}


def power_off() -> dict[str, Any]:
    return {"kind": "power_off", "args": {}}


def read_status() -> dict[str, Any]:
    """Robottan durum ağacını yeniden yayınlamasını iste."""
    return {"kind": "read_status", "args": {}}


def sync() -> dict[str, Any]:
    return {"kind": "sync", "args": {}}


def execute_sequence(sequence_id: str | uuid.UUID) -> dict[str, Any]:
    return {"kind": "execute", "args": {"sequence_id": str(sequence_id)}}


def execute_script(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Kaydedilmemiş adım dizisini doğrudan çalıştır (dizi önizlemesi için)."""
    return steps
