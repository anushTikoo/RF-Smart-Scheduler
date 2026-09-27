"""
RF-Smart-Scheduler Backend Entrypoint
Exposes the modular FastAPI application and services from `app`.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure backend root is on sys.path
backend_dir = Path(__file__).resolve().parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import uvicorn
from app.main import app, create_app
from app.services import engine
from app.core.config import (
    DEFAULT_TOTAL_DWELLS,
    DWELL_DURATION_MS,
    SPECTRUM_BANDS,
    UPLOAD_DIR,
)
from app.core.models import BenchmarkRequest, ConfigUpdateRequest

__all__ = [
    "app",
    "create_app",
    "engine",
    "DEFAULT_TOTAL_DWELLS",
    "DWELL_DURATION_MS",
    "SPECTRUM_BANDS",
    "UPLOAD_DIR",
    "BenchmarkRequest",
    "ConfigUpdateRequest",
]

if __name__ == "__main__":
    # NOTE: reload=False is critical for performance. With reload=True, Uvicorn's
    # file watcher thread causes severe GIL contention with the background
    # computation thread, slowing model execution from 60s to 4680s (78x slower).
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
