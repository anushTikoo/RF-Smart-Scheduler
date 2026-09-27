"""
General system information and health check endpoints.
"""

import time
from fastapi import APIRouter
from app.services import engine

router = APIRouter(tags=["General"])


@router.get("/")
async def root():
    """Welcome and overview of available services."""
    return {
        "title": "RF Smart Scheduler API",
        "description": "Cognitive Band Selection for Electronic Warfare",
        "version": "2.0.0",
        "dataset_loaded": engine.dataset_name or None,
        "total_dwells_available": len(engine.cached_dwells),
        "status": "online",
        "endpoints": {
            "websocket_telemetry": "/ws/telemetry",
            "telemetry_snapshot": "/api/telemetry",
            "spectrum_bands": "/api/bands",
            "historical_dwells": "/api/dwells",
            "dataset_info": "/api/dataset/info",
            "upload_dataset": "/api/upload",
            "detailed_metrics": "/api/metrics",
            "model_state": "/api/model/state",
            "multi_scheduler_benchmark": "/api/benchmark",
            "active_config": "/api/config",
        },
    }


@router.get("/api/health")
async def health_check():
    """System status and engine state."""
    return {
        "status": "online",
        "model": "Contextual Bandit (LinUCB V2)",
        "dataset": engine.dataset_name,
        "total_dwells": len(engine.cached_dwells),
        "timestamp": int(time.time() * 1000),
    }
