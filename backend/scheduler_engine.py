"""
RF-Smart-Scheduler Engine Compatibility Layer
Re-exports SimulationEngine and configuration from modular app.services.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure backend root is on sys.path
backend_dir = Path(__file__).resolve().parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.services import SimulationEngine, engine
from app.core.config import (
    DEFAULT_TOTAL_DWELLS,
    DWELL_DURATION_MS,
    SPECTRUM_BANDS,
)

__all__ = [
    "SimulationEngine",
    "engine",
    "DEFAULT_TOTAL_DWELLS",
    "DWELL_DURATION_MS",
    "SPECTRUM_BANDS",
]
