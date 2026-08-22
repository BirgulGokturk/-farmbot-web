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


def toprak_olc(
    x: float,
    y: float,
    soil_z: float,
    safe_z: float,
    *,
    depth_mm: float,
    pin: int | None = None,
    mode: int = 1,
    label: str = "toprak_nemi",
    settle_ms: int = 2000,
    speed: int = 100,
) -> list[dict[str, Any]]:
    """Probu bir noktada toprağa batırıp ölçüm al, sonra çek.

    Neden batırılıyor: yüzeyde tutulan bir okuma havayı ölçer ve her noktada
    aynı çıkar. `depth_mm` toprak yüzeyinden **aşağı** ölçülüyor, bu yüzden
    çıkarılıyor.

    Neden bekleniyor: dirençli prob toprağa girer girmez okumuyor, nem iki uç
    arasında dengelenene kadar birkaç saniye geçiyor. Beklemeden okumak ıslak
    toprağı kuru gösteriyordu.

    Neden sonunda çekiliyor: prob toprakta kalırsa bir sonraki yatay hareket
    onu toprağın içinden sürükler.

    `pin` neden isteğe bağlı
    ------------------------
    İki tür sensör var ve ölçüm ikisinde farklı yoldan geliyor:

      * **Pinli** — panel "şu pini oku" diyor, değer o anda dönüyor.
      * **Kanallı** — Arduino kendi döngüsünde sürekli okuyup seri porttan
        yayınlıyor (`soil_moisture` böyle). Ona `read_pin` göndermenin
        karşılığı yok; ajan zaten iki saniyede bir ölçüm gönderiyor ve her
        ölçüm alındığı andaki konumla damgalanıyor.

    Kanallı sensörde dizi yalnızca robotu doğru noktada, doğru derinlikte ve
    yeterince uzun tutuyor — ölçüm kendiliğinden o noktaya yazılıyor.
    """
    adimlar = [
        move_absolute(x, y, safe_z, speed),          # güvenli yükseklikte yatayda git
        move_absolute(x, y, soil_z - depth_mm, speed),  # toprağa bat
        wait(settle_ms),                             # okuma dengelensin
    ]
    if pin is not None:
        adimlar.append(read_pin(pin, mode, label))
    adimlar.append(move_absolute(x, y, safe_z, speed))  # probu topraktan çek
    return adimlar


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
# Bu diziyi **biz kurmuyoruz**. Tek bir adım üretip Gantry Studio'ya
# devrediyoruz; o da kendi `tool_change` yordamını çalıştırıyor.
#
# Neden
# -----
# Önce kendimiz kuruyorduk: geçiş Z'ye çık, yaklaşma noktasına git, ucun
# yanında alçal, altına kay, kilitle, kaldır. Aynı geometriyi iki yerde
# hesaplamak demekti ve sahada beklenen şekilde kırıldı — yaklaşma noktası
# eksen sınırının dışına düştü ("Y target -1.8 mm outside limits") ve komut
# hiç başlamadan reddedildi.
#
# Gantry Studio bu işi zaten yapıyor ve sahada çalışan kısım orası: kayma
# eksenini, yaklaşma ofsetini, geçiş yüksekliğini, kilitleme servosunu ve
# **varlık sensörünü** biliyor. Varlık sensörü bizde hiç yoktu; ucun gerçekten
# takılıp takılmadığını yalnızca o görüyor.
#
# Sonuç: geometri tek yerde duruyor, biz yalnızca "hangi uç" diyoruz.


def tool_change(name: str) -> dict[str, Any]:
    """Gantry Studio'ya "şu ucu tak" der.

    Ajan bunu `/api/tool` çağrısına çeviriyor. Gerekiyorsa takılı uç önce
    bırakılıyor; zaten doğru uç takılıysa Gantry Studio hiçbir şey yapmıyor.
    """
    return {"kind": "tool_change", "args": {"name": name}}


def uc_hazirla(
    hedef: dict[str, Any] | None,
    takili: dict[str, Any] | None,
    zone: dict[str, Any] | None = None,
    speed: int = 20,
) -> list[dict[str, Any]]:
    """Doğru ucun takılı olmasını sağlar.

    Zaten doğru uç takılıysa **hiç adım üretmiyor**: her sulamada ucu bırakıp
    yeniden almak hem zaman kaybı hem gereksiz aşınma. Gantry Studio da aynı
    kontrolü yapıyor ama boşuna bir tur ağa çıkmanın anlamı yok.

    `zone` ve `speed` artık kullanılmıyor — geometri Gantry Studio'da. İmzada
    duruyorlar ki çağıran taraflar tek tek değişmek zorunda kalmasın.
    """
    if hedef is None:
        return []
    if takili is not None and takili.get("name") == hedef.get("name"):
        return []
    return [tool_change(str(hedef["name"]))]


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
