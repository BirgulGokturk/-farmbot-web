"""v1 API'sinin tüm alt yönlendiricilerini birleştirir."""

from fastapi import APIRouter

from app.api.v1 import (
    auth,
    catalog,
    control,
    devices,
    events,
    hardware,
    points,
    sequences,
    telemetry,
    ws,
)

api_router = APIRouter()

api_router.include_router(auth.router)
api_router.include_router(devices.router)
api_router.include_router(points.router)
api_router.include_router(catalog.router)
api_router.include_router(sequences.router)
api_router.include_router(events.router)
api_router.include_router(hardware.router)
api_router.include_router(telemetry.router)
api_router.include_router(control.router)
api_router.include_router(ws.router)
