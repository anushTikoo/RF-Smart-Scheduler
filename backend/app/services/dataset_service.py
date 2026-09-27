"""
Dataset management and preprocessing service.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Tuple

import h5py
import numpy as np

from smart_scan.data.episode import Episode
from smart_scan.data.preprocess import pulse_train_to_episode
from app.core.config import DWELL_DURATION_MS


class DatasetService:
    """Handles loading, inspecting, and preprocessing HDF5 radar pulse files."""

    @staticmethod
    def load_h5_file(path: str | Path) -> Tuple[np.ndarray, np.ndarray]:
        """Read data and labels arrays from an HDF5 file."""
        source = Path(path)
        if not source.exists():
            raise FileNotFoundError(f"HDF5 dataset not found: {source}")

        with h5py.File(source, "r") as hf:
            if "data" not in hf or "labels" not in hf:
                raise ValueError("HDF5 file must contain 'data' and 'labels' datasets")
            data = hf["data"][:]
            labels = hf["labels"][:]

        return data, labels

    @staticmethod
    def create_episode(
        data: np.ndarray,
        labels: np.ndarray,
        source_name: str,
        dwell_ms: float = DWELL_DURATION_MS,
    ) -> Episode:
        """Transform raw pulse train data into a discrete Episode grid."""
        return pulse_train_to_episode(
            data,
            labels,
            frequency_min_mhz=500.0,
            frequency_max_mhz=18000.0,
            bandwidth_mhz=875.0,
            dwell_ms=dwell_ms,
            source=source_name,
        )

    @staticmethod
    def extract_info(
        episode: Episode | None,
        dataset_name: str,
        total_pulses: int,
    ) -> Dict[str, Any]:
        """Format dataset information dictionary."""
        if episode is None:
            return {"loaded": False, "message": "No dataset loaded"}

        return {
            "loaded": True,
            "name": dataset_name,
            "total_pulses": total_pulses,
            "total_dwells": episode.num_steps,
            "dwell_duration_ms": DWELL_DURATION_MS,
            "total_duration_ms": episode.num_steps * DWELL_DURATION_MS,
            "num_bands": episode.num_bands,
            "frequency_min_mhz": float(episode.band_edges_mhz[0]),
            "frequency_max_mhz": float(episode.band_edges_mhz[-1]),
            "bandwidth_mhz": float(
                episode.band_edges_mhz[1] - episode.band_edges_mhz[0]
            ),
            "num_emitters": episode.num_emitters,
            "source": episode.source,
        }
