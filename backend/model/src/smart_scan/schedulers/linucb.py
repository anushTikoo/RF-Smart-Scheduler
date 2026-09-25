from __future__ import annotations

import numpy as np

from smart_scan.env.scan_env import ScanEnvironment, Transition
from smart_scan.schedulers.base import Scheduler, coverage_urgency, revisit_candidate_mask


class LinUCBScheduler(Scheduler):
    name = "linucb"

    def __init__(
        self,
        alpha: float = 1.0,
        regularization: float = 1.0,
        max_revisit_factor: float | None = 2.0,
        min_revisit_factor: float | None = None,
        uncertainty_weight: float = 0.5,
        coverage_bonus_weight: float = 0.0,
    ) -> None:
        self.alpha = alpha
        self.regularization = regularization
        self.max_revisit_factor = max_revisit_factor
        self.min_revisit_factor = min_revisit_factor
        self.uncertainty_weight = uncertainty_weight
        self.coverage_bonus_weight = coverage_bonus_weight

    def reset(self, env: ScanEnvironment, seed: int = 0) -> None:
        super().reset(env, seed)
        bands = env.episode.num_bands
        dimension = env.context_size
        self.a_inverse = np.repeat(
            ((1.0 / self.regularization) * np.eye(dimension, dtype=np.float64))[None, :, :],
            bands,
            axis=0,
        )
        self.b = np.zeros((bands, dimension), dtype=np.float64)
        self.last_contexts: np.ndarray | None = None

    def select_action(self, env: ScanEnvironment) -> int:
        contexts = env.band_contexts().astype(np.float64)
        candidate_mask = revisit_candidate_mask(
            env,
            self.max_revisit_factor,
            min_revisit_factor=self.min_revisit_factor,
            uncertainty_weight=self.uncertainty_weight,
        )
        scores = np.empty(env.episode.num_bands, dtype=np.float64)
        for arm, context in enumerate(contexts):
            inverse = self.a_inverse[arm]
            theta = inverse @ self.b[arm]
            uncertainty = np.sqrt(max(float(context @ inverse @ context), 0.0))
            scores[arm] = float(theta @ context) + self.alpha * uncertainty
        scores += self.coverage_bonus_weight * coverage_urgency(
            env,
            self.max_revisit_factor,
            min_revisit_factor=self.min_revisit_factor,
            uncertainty_weight=self.uncertainty_weight,
        )
        if candidate_mask is not None:
            scores[~candidate_mask] = -np.inf
        self.last_contexts = contexts
        return int(np.argmax(scores))

    def observe(
        self,
        env: ScanEnvironment,
        state: np.ndarray,
        action: int,
        transition: Transition,
        next_state: np.ndarray,
    ) -> None:
        if self.last_contexts is None:
            return
        context = self.last_contexts[action]
        inverse = self.a_inverse[action]
        projected = inverse @ context
        denominator = 1.0 + float(context @ projected)
        self.a_inverse[action] = inverse - np.outer(projected, projected) / denominator
        self.b[action] += transition.reward * context
