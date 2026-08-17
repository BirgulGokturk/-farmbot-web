"""Bilinen sensör kanalları.

Arduino yazılımı ölçümleri kanal adıyla gönderir. Burası, bir kanal ilk kez
görüldüğünde sensörün etiketini, birimini ve ölçek aralığını belirler; böylece
yeni bir sensör takıldığında panelde elle tanımlama yapmak gerekmez.

Kanal adları `<modül>_<büyüklük>` düzenindedir — aynı modülün birden fazla
büyüklük ölçmesi (BMP180: basınç + sıcaklık + rakım) bu sayede ayrışır.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models.enums import SensorKind


@dataclass(frozen=True)
class ChannelSpec:
    label: str
    kind: SensorKind
    unit: str
    icon: str
    min_value: float
    max_value: float


# Kullanıcının elindeki donanım: BMP180 (GY-68), DHT11/DHT22, HW-103
KNOWN_CHANNELS: dict[str, ChannelSpec] = {
    # --- BMP180 / GY-68 (I²C) ---
    "bmp180_pressure": ChannelSpec(
        "Barometrik Basınç", SensorKind.PRESSURE, "hPa", "🌡️", 950, 1050
    ),
    "bmp180_temperature": ChannelSpec(
        "Sıcaklık (BMP180)", SensorKind.TEMPERATURE, "°C", "🌡️", -10, 60
    ),
    "bmp180_altitude": ChannelSpec("Rakım", SensorKind.ALTITUDE, "m", "⛰️", 0, 2500),
    # --- DHT11 / DHT22 (tek hat dijital) ---
    "dht_temperature": ChannelSpec(
        "Hava Sıcaklığı", SensorKind.TEMPERATURE, "°C", "🌡️", -10, 60
    ),
    "dht_humidity": ChannelSpec("Ortam Nemi", SensorKind.HUMIDITY, "%", "💨", 0, 100),
    # --- HW-103 (analog + dijital) ---
    "hw103_soil": ChannelSpec("Toprak Nemi", SensorKind.SOIL_MOISTURE, "%", "💧", 0, 100),
    "hw103_rain": ChannelSpec("Yağmur", SensorKind.RAIN, "", "🌧️", 0, 1),
    # Ham ADC değeri — yüzde değil. Kalibrasyon (SOIL_DRY / SOIL_WET) bunu
    # izleyerek yapılır, bu yüzden ayrı kanal olarak tutuluyor.
    "hw103_soil_raw": ChannelSpec(
        "Toprak Nemi (ham ADC)", SensorKind.GENERIC, "", "🔢", 0, 1023
    ),
}


def describe_channel(channel: str) -> ChannelSpec:
    """Kanalın tanımını döndürür; bilinmiyorsa adından makul bir tahmin üretir."""
    known = KNOWN_CHANNELS.get(channel)
    if known is not None:
        return known

    lowered = channel.lower()

    # Ad içindeki ipuçlarından türü çıkar — bilinmeyen bir modül eklendiğinde
    # yine de anlamlı birim ve ölçek göster.
    # "raw" ilk sırada: "soil_raw" gibi adlar yüzde sanılmasın, ham ADC değeri
    # birimsiz ve 0–1023 aralığındadır.
    if "raw" in lowered or "adc" in lowered:
        kind, unit, icon, low, high = SensorKind.GENERIC, "", "🔢", 0.0, 1023.0
    elif "humid" in lowered or "nem" in lowered:
        kind, unit, icon, low, high = SensorKind.HUMIDITY, "%", "💨", 0.0, 100.0
    elif "soil" in lowered or "toprak" in lowered:
        kind, unit, icon, low, high = SensorKind.SOIL_MOISTURE, "%", "💧", 0.0, 100.0
    elif "temp" in lowered or "sicak" in lowered:
        kind, unit, icon, low, high = SensorKind.TEMPERATURE, "°C", "🌡️", -10.0, 60.0
    elif "press" in lowered or "basinc" in lowered:
        kind, unit, icon, low, high = SensorKind.PRESSURE, "hPa", "🎈", 950.0, 1050.0
    elif "alt" in lowered or "rakim" in lowered:
        kind, unit, icon, low, high = SensorKind.ALTITUDE, "m", "⛰️", 0.0, 2500.0
    elif "rain" in lowered or "yagmur" in lowered:
        kind, unit, icon, low, high = SensorKind.RAIN, "", "🌧️", 0.0, 1.0
    elif "light" in lowered or "isik" in lowered or "lux" in lowered:
        kind, unit, icon, low, high = SensorKind.LIGHT, "lux", "☀️", 0.0, 10_000.0
    else:
        kind, unit, icon, low, high = SensorKind.GENERIC, "", "📊", 0.0, 1023.0

    # "dht_humidity" → "Dht Humidity"
    label = channel.replace("_", " ").strip().title() or channel
    return ChannelSpec(label, kind, unit, icon, low, high)
