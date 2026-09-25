from __future__ import annotations

from abc import ABC, abstractmethod

import numpy as np

from smart_scan.env.scan_env import ScanEnvironment, Transition


class Scheduler(ABC):
    name = "scheduler"

    def reset(self, env: ScanEnvironment, seed: int = 0) -> None:
        self.rng = np.random.default_rng(seed)

    @abstractmethod
    def select_action(self, env: ScanEnvironment) -> int:
        raise NotImplementedError

    def observe(
        self,
        env: ScanEnvironment,
        state: np.ndarray,
        action: int,
        transition: Transition,
        next_state: np.ndarray,
    ) -> None:
        return None


def revisit_candidate_mask(
    env: ScanEnvironment,
    max_revisit_factor: float | None,
    *,
    min_revisit_factor: float | None = None,
    uncertainty_weight: float = 0.5,
) -> np.ndarray | None:
    """Mask bands that must be considered to maintain the revisit guarantee.

    Supplying ``min_revisit_factor`` enables activity-aware deadlines. Bands with
    observed/predicted activity or high uncertainty get a shorter deadline;
    repeatedly inactive bands may wait up to ``max_revisit_factor`` sweeps.
    """

    if max_revisit_factor is None:
        return None
    unvisited = np.flatnonzero(env.last_visit < 0)
    if len(unvisited):
        mask = np.zeros(env.episode.num_bands, dtype=bool)
        mask[unvisited] = True
        return mask
    elapsed = env.step_index - env.last_visit
    if min_revisit_factor is None:
        threshold = max(int(round(max_revisit_factor * env.episode.num_bands)), 1)
        mask = elapsed >= threshold
        return mask if np.any(mask) else None

    if not 0 < min_revisit_factor <= max_revisit_factor:
        raise ValueError("min_revisit_factor must be positive and no greater than max")
    if uncertainty_weight < 0:
        raise ValueError("uncertainty_weight cannot be negative")
    prediction = env.next_pulse_predictor.band_scores(
        env.step_index * env.episode.time_bin_s,
        env.episode.time_bin_s,
    )
    uncertainty = 1.0 / np.sqrt(1.0 + env.visit_count.astype(np.float64))
    interest = np.maximum.reduce(
        [
            env.ewma_hit.astype(np.float64),
            env._periodic_due().astype(np.float64),
            prediction.astype(np.float64),
            np.clip(uncertainty_weight * uncertainty, 0.0, 1.0),
        ]
    )
    factors = max_revisit_factor - (
        max_revisit_factor - min_revisit_factor
    ) * np.clip(interest, 0.0, 1.0)
    thresholds = np.maximum(
        np.rint(factors * env.episode.num_bands).astype(np.int32), 1
    )
    mask = elapsed >= thresholds
    return mask if np.any(mask) else None


def coverage_urgency(
    env: ScanEnvironment,
    max_revisit_factor: float | None,
    *,
    min_revisit_factor: float | None = None,
    uncertainty_weight: float = 0.5,
) -> np.ndarray:
    """Return a scheduler-visible 0..1 urgency score without oracle information."""

    bands = env.episode.num_bands
    if max_revisit_factor is None:
        return np.zeros(bands, dtype=np.float32)
    if np.any(env.last_visit < 0):
        return (env.last_visit < 0).astype(np.float32)
    if min_revisit_factor is None:
        thresholds = np.full(
            bands,
            max(int(round(max_revisit_factor * bands)), 1),
            dtype=np.float64,
        )
    else:
        prediction = env.next_pulse_predictor.band_scores(
            env.step_index * env.episode.time_bin_s,
            env.episode.time_bin_s,
        )
        uncertainty = 1.0 / np.sqrt(1.0 + env.visit_count.astype(np.float64))
        interest = np.maximum.reduce(
            [
                env.ewma_hit.astype(np.float64),
                env._periodic_due().astype(np.float64),
                prediction.astype(np.float64),
                np.clip(uncertainty_weight * uncertainty, 0.0, 1.0),
            ]
        )
        factors = max_revisit_factor - (
            max_revisit_factor - min_revisit_factor
        ) * np.clip(interest, 0.0, 1.0)
        thresholds = np.maximum(factors * bands, 1.0)
    elapsed = env.step_index - env.last_visit
    return np.clip(elapsed / thresholds, 0.0, 1.0).astype(np.float32)
