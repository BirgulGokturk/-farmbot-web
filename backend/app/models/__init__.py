"""Tüm SQLAlchemy modelleri.

Alembic'in ve `Base.metadata.create_all`in tabloları görebilmesi için
her model bu dosyadan içe aktarılmalıdır.
"""

from app.db.base import Base
from app.models.alerts import AlertRule, Notification
from app.models.automation import (
    FarmEvent,
    PointGroup,
    Regimen,
    RegimenItem,
    Sequence,
)
from app.models.catalog import Curve, PlantSpecies, Tool
from app.models.device import Device
from app.models.enums import (
    Axis,
    CurveType,
    ExecutableType,
    LogLevel,
    PlantStage,
    PointGroupSort,
    PointType,
    SunRequirement,
    SyncStatus,
    TimeUnit,
    ToolStatus,
)
from app.models.hardware import Peripheral, Sensor, SensorReading
from app.models.point import Point
from app.models.telemetry import Image, Log
from app.models.user import User

__all__ = [
    "Base",
    # tablolar
    "User",
    "Device",
    "Point",
    "PlantSpecies",
    "Curve",
    "Tool",
    "Sequence",
    "Regimen",
    "RegimenItem",
    "FarmEvent",
    "PointGroup",
    "Peripheral",
    "Sensor",
    "SensorReading",
    "Log",
    "Image",
    # enum'lar
    "Axis",
    "CurveType",
    "ExecutableType",
    "LogLevel",
    "PlantStage",
    "PointGroupSort",
    "PointType",
    "SunRequirement",
    "SyncStatus",
    "TimeUnit",
    "ToolStatus",
]
