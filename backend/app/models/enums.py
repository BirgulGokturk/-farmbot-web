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
    ALL = "all"


class SyncStatus(str, Enum):
    """Robotun backend ile senkronizasyon durumu."""

    OFFLINE = "offline"
    MAINTENANCE = "maintenance"
    SYNCING = "syncing"
    SYNCED = "synced"
    SYNC_ERROR = "sync_error"
    UNKNOWN = "unknown"
