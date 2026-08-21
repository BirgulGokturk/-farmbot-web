"""Veri modelinde kullanılan sabit değer kümeleri.

`str, Enum` mirası sayesinde Pydantic ve JSON serileştirmede doğrudan
metin olarak görünürler.
"""

from enum import Enum


class PointType(str, Enum):
    """Bahçedeki bir noktanın türü (FarmBot `pointer_type` karşılığı)."""

    PLANT = "plant"
    WEED = "weed"
    TOOL_SLOT = "tool_slot"
    MARKER = "marker"


class PlantStage(str, Enum):
    """Bitkinin yaşam döngüsündeki aşaması."""

    PLANNED = "planned"      # tasarımcıda yerleştirildi, henüz ekilmedi
    PLANTED = "planted"      # robot ekti
    SPROUTED = "sprouted"    # filizlendi
    ACTIVE = "active"        # büyüyor
    HARVESTED = "harvested"  # hasat edildi
    REMOVED = "removed"      # kaldırıldı


class SensorKind(str, Enum):
    """Sensörün ne ölçtüğü.

    Birim, ikon ve renk seçimini bu belirler. Aynı fiziksel büyüklüğü ölçen
    iki sensör olabilir (BMP180 kart sıcaklığı ile DHT hava sıcaklığı gibi);
    bu yüzden tür ayrımı `channel` alanıyla birlikte kullanılır.
    """

    TEMPERATURE = "temperature"      # °C
    HUMIDITY = "humidity"            # % (ortam nemi)
    SOIL_MOISTURE = "soil_moisture"  # % (toprak nemi)
    PRESSURE = "pressure"            # hPa
    ALTITUDE = "altitude"            # m
    RAIN = "rain"                    # 0/1 (yağmur var/yok)
    LIGHT = "light"                  # lux
    GENERIC = "generic"


class PeripheralKind(str, Enum):
    """Çevre biriminin sürülme biçimi."""

    DIGITAL = "digital"  # aç/kapa (röle, pompa, lamba)
    PWM = "pwm"          # 0–255 arası analog çıkış
    SERVO = "servo"      # 0–180° açı


class PeripheralRole(str, Enum):
    """Çevre biriminin **işlevi** — sistemin onu tanıyabilmesi için.

    `kind` nasıl sürüldüğünü söylüyor (röle mi, servo mu). `role` ise ne işe
    yaradığını: sulama komutu "su pompası hangisi" diye sorabilsin.

    Buna ihtiyaç vardı çünkü sulama pompanın pinini **sabit 8** varsayıyordu.
    Kullanıcı panelde "Su pompası, pin 7" tanımlasa bile sulama pin 8'i
    sürüyordu ve hiçbir şey olmuyordu; panel kendi tanımını kullanmıyordu.
    """

    GENERIC = "generic"      # lamba, fan, genel amaçlı röle
    WATER_PUMP = "water_pump"
    AIR_PUMP = "air_pump"
    VACUUM = "vacuum"        # tohum ucu vakumu
    VALVE = "valve"


class CurveType(str, Enum):
    WATER = "water"
    SPREAD = "spread"
    HEIGHT = "height"


class SunRequirement(str, Enum):
    FULL = "full"
    PARTIAL = "partial"
    SHADE = "shade"


class ToolStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class ExecutableType(str, Enum):
    """Takvim olayının neyi çalıştırdığı."""

    SEQUENCE = "sequence"
    REGIMEN = "regimen"


class TimeUnit(str, Enum):
    NEVER = "never"
    MINUTELY = "minutely"
    HOURLY = "hourly"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"


class LogLevel(str, Enum):
    DEBUG = "debug"
    INFO = "info"
    SUCCESS = "success"
    WARN = "warn"
    ERROR = "error"


class PointGroupSort(str, Enum):
    XY_ASCENDING = "xy_ascending"
    YX_ASCENDING = "yx_ascending"
    RANDOM = "random"
    NEAREST = "nearest"


class Axis(str, Enum):
    X = "x"
    Y = "y"
    Z = "z"
    # Yalnızca yatay eksenler. Jog pad'in ortasındaki ev düğmesi bunu
    # kullanıyor: kullanıcı X/Y'yi eve göndermek isterken Z'nin de hareket
    # etmesini beklemiyor, hele takılı bir uç varken.
    XY = "xy"
    ALL = "all"


class AlertKind(str, Enum):
    """Uyarı kuralının türü."""

    SENSOR_THRESHOLD = "sensor_threshold"
    DEVICE_OFFLINE = "device_offline"


class AlertComparison(str, Enum):
    BELOW = "below"
    ABOVE = "above"


class SyncStatus(str, Enum):
    """Robotun backend ile senkronizasyon durumu."""

    OFFLINE = "offline"
    MAINTENANCE = "maintenance"
    SYNCING = "syncing"
    SYNCED = "synced"
    SYNC_ERROR = "sync_error"
    UNKNOWN = "unknown"
