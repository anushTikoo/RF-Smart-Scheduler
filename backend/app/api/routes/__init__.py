"""
API routes module aggregator.
"""

from fastapi import APIRouter

from app.api.routes.analytics import router as analytics_router
from app.api.routes.config import router as config_router
from app.api.routes.dataset import router as dataset_router
from app.api.routes.general import router as general_router
from app.api.routes.spectrum import router as spectrum_router
from app.api.routes.telemetry import router as telemetry_router

api_router = APIRouter()
api_router.include_router(general_router)
api_router.include_router(spectrum_router)
api_router.include_router(telemetry_router)
api_router.include_router(dataset_router)
api_router.include_router(config_router)
api_router.include_router(analytics_router)

__all__ = ["api_router"]
