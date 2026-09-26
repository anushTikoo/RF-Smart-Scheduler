from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from smart_scan.env.scan_env import ScanEnvironment


V2_CORE_FEATURES = (
    "bias",
    "time_since_visit",
    "observed_hit_ewma",
    "previous_observed_pulse_count",
    "consecutive_no_hits",
    "learned_periodicity",
)


@dataclass(frozen=True, slots=True)
class BandContextConfig:
    """Versioned, causal per-band feature configuration.

    V2 deliberately excludes absolute band position/identity, mission phase,
    amplitude, and switching distance. The shared LinUCB model therefore learns
    rules that transfer across bands instead of memorising training frequencies.
    """

    version: str = "v2"
    predictor_enabled: bool = True
    pulse_count_reference: float = 128.0
    no_hit_reference: float = 5.0

    def __post_init__(self) -> None:
        if self.version not in {"v1", "v2"}:
            raise ValueError(f"unsupported context version: {self.version}")
        if self.pulse_count_reference <= 0:
            raise ValueError("pulse_count_reference must be positive")
        if self.no_hit_reference <= 0:
            raise ValueError("no_hit_reference must be positive")

    @property
    def feature_names(self) -> tuple[str, ...]:
        if self.version == "v1":
            return (
                "bias",
                "band_position",
                "time_since_visit",
                "observed_hit_ewma",
                "previous_observed_pulse_count",
                "previous_observed_amplitude",
                "consecutive_no_hits",
                "learned_periodicity",
                "prediction_urgency",
                "switching_distance",
                "mission_phase_sin",
                "mission_phase_cos",
            )
        if self.predictor_enabled:
            return (*V2_CORE_FEATURES, "prediction_urgency")
        return V2_CORE_FEATURES


class BandContextEncoder:
    """Encode only information available from earlier receiver observations."""

    def __init__(self, config: BandContextConfig) -> None:
        self.config = config

    @property
    def feature_names(self) -> tuple[str, ...]:
        return self.config.feature_names

    def encode(self, env: "ScanEnvironment") -> np.ndarray:
        if self.config.version == "v1":
            return env._legacy_band_contexts()

        bands = env.episode.num_bands
        elapsed = np.where(
            env.last_visit < 0,
            bands,
            env.step_index - env.last_visit,
        )
        time_since_visit = np.clip(elapsed / max(bands, 1), 0.0, 1.0)
        pulse_count = np.clip(
            np.log1p(env.last_pulse_count)
            / np.log1p(self.config.pulse_count_reference),
            0.0,
            1.0,
        )
        no_hits = np.clip(
            env.consecutive_no_hits / self.config.no_hit_reference,
            0.0,
            1.0,
        )
        columns: list[np.ndarray] = [
            np.ones(bands, dtype=np.float32),
            time_since_visit.astype(np.float32),
            env.ewma_hit.astype(np.float32),
            pulse_count.astype(np.float32),
            no_hits.astype(np.float32),
            env.periodicity_scores().astype(np.float32),
        ]
        if self.config.predictor_enabled:
            columns.append(env.prediction_scores().astype(np.float32))
        return np.column_stack(columns).astype(np.float32, copy=False)
