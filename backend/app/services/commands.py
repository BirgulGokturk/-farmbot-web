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
