"""
Services module initializing shared simulation engine singleton.
"""

from app.services.benchmark_service import BenchmarkService
from app.services.dataset_service import DatasetService
from app.services.simulation_engine import SimulationEngine

# Global shared simulation engine
engine = SimulationEngine()

__all__ = ["SimulationEngine", "DatasetService", "BenchmarkService", "engine"]
