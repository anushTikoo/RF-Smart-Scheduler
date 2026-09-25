from __future__ import annotations

import json
from pathlib import Path

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
        shared_model: bool = False,
        preserve_model_across_episodes: bool = False,
        update_enabled: bool = True,
    ) -> None:
        if alpha < 0:
            raise ValueError("alpha cannot be negative")
        if regularization <= 0:
            raise ValueError("regularization must be positive")
        if coverage_bonus_weight < 0:
            raise ValueError("coverage_bonus_weight cannot be negative")
        self.alpha = alpha
        self.regularization = regularization
        self.max_revisit_factor = max_revisit_factor
        self.min_revisit_factor = min_revisit_factor
        self.uncertainty_weight = uncertainty_weight
        self.coverage_bonus_weight = coverage_bonus_weight
        self.shared_model = shared_model
        self.preserve_model_across_episodes = preserve_model_across_episodes
        self.update_enabled = update_enabled
        self.a_inverse: np.ndarray | None = None
        self.b: np.ndarray | None = None
        self.num_updates = 0
        self._num_bands: int | None = None
        self._context_size: int | None = None

    def _initialize_model(self, bands: int, dimension: int) -> None:
        model_count = 1 if self.shared_model else bands
        self.a_inverse = np.repeat(
            ((1.0 / self.regularization) * np.eye(dimension, dtype=np.float64))[
                None, :, :
            ],
            model_count,
            axis=0,
        )
        self.b = np.zeros((model_count, dimension), dtype=np.float64)
        self._num_bands = bands
        self._context_size = dimension

    def _validate_model_shape(self, bands: int, dimension: int) -> None:
        if self.a_inverse is None or self.b is None:
            raise RuntimeError("LinUCB model has not been initialized")
        model_count = 1 if self.shared_model else bands
        if self.a_inverse.shape != (model_count, dimension, dimension):
            raise ValueError(
                "checkpoint/environment mismatch: expected LinUCB inverse matrices "
                f"with shape {(model_count, dimension, dimension)}, got {self.a_inverse.shape}"
            )
        if self.b.shape != (model_count, dimension):
            raise ValueError(
                "checkpoint/environment mismatch: expected LinUCB reward vectors "
                f"with shape {(model_count, dimension)}, got {self.b.shape}"
            )
        if self._num_bands is not None and self._num_bands != bands:
            raise ValueError(
                f"checkpoint expects {self._num_bands} bands, environment has {bands}"
            )

    def reset(self, env: ScanEnvironment, seed: int = 0) -> None:
        super().reset(env, seed)
        bands = env.episode.num_bands
        dimension = env.context_size
        if (
            not self.preserve_model_across_episodes
            or self.a_inverse is None
            or self.b is None
        ):
            self._initialize_model(bands, dimension)
        else:
            self._validate_model_shape(bands, dimension)
        self.last_contexts: np.ndarray | None = None

    def select_action(self, env: ScanEnvironment) -> int:
        if self.a_inverse is None or self.b is None:
            raise RuntimeError("reset must be called before selecting an action")
        contexts = env.band_contexts().astype(np.float64)
        candidate_mask = revisit_candidate_mask(
            env,
            self.max_revisit_factor,
            min_revisit_factor=self.min_revisit_factor,
            uncertainty_weight=self.uncertainty_weight,
        )
        scores = np.empty(env.episode.num_bands, dtype=np.float64)
        for arm, context in enumerate(contexts):
            model_index = 0 if self.shared_model else arm
            inverse = self.a_inverse[model_index]
            theta = inverse @ self.b[model_index]
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
        if not self.update_enabled or self.last_contexts is None:
            return
        if self.a_inverse is None or self.b is None:
            raise RuntimeError("reset must be called before observing a transition")
        context = self.last_contexts[action]
        model_index = 0 if self.shared_model else action
        inverse = self.a_inverse[model_index]
        projected = inverse @ context
        denominator = 1.0 + float(context @ projected)
        self.a_inverse[model_index] = (
            inverse - np.outer(projected, projected) / denominator
        )
        self.b[model_index] += transition.reward * context
        self.num_updates += 1

    def save(self, path: str | Path) -> Path:
        """Save learned LinUCB sufficient statistics and action settings."""

        if self.a_inverse is None or self.b is None:
            raise RuntimeError("cannot save an uninitialized LinUCB model")
        target = Path(path)
        if target.suffix.lower() != ".npz":
            raise ValueError("LinUCB checkpoints must use the .npz extension")
        target.parent.mkdir(parents=True, exist_ok=True)
        metadata = {
            "format_version": 1,
            "alpha": self.alpha,
            "regularization": self.regularization,
            "max_revisit_factor": self.max_revisit_factor,
            "min_revisit_factor": self.min_revisit_factor,
            "uncertainty_weight": self.uncertainty_weight,
            "coverage_bonus_weight": self.coverage_bonus_weight,
            "shared_model": self.shared_model,
            "num_updates": self.num_updates,
            "num_bands": self._num_bands,
            "context_size": self._context_size,
        }
        np.savez_compressed(
            target,
            a_inverse=self.a_inverse,
            b=self.b,
            metadata=np.asarray(json.dumps(metadata)),
        )
        return target

    @classmethod
    def load(
        cls,
        path: str | Path,
        *,
        update_enabled: bool = False,
    ) -> "LinUCBScheduler":
        """Load a checkpoint; frozen inference is the safe default."""

        source = Path(path)
        with np.load(source, allow_pickle=False) as payload:
            metadata = json.loads(str(payload["metadata"]))
            scheduler = cls(
                alpha=float(metadata["alpha"]),
                regularization=float(metadata["regularization"]),
                max_revisit_factor=metadata["max_revisit_factor"],
                min_revisit_factor=metadata["min_revisit_factor"],
                uncertainty_weight=float(metadata["uncertainty_weight"]),
                coverage_bonus_weight=float(metadata["coverage_bonus_weight"]),
                shared_model=bool(metadata.get("shared_model", False)),
                preserve_model_across_episodes=True,
                update_enabled=update_enabled,
            )
            scheduler.a_inverse = payload["a_inverse"].astype(np.float64, copy=True)
            scheduler.b = payload["b"].astype(np.float64, copy=True)
            scheduler.num_updates = int(metadata.get("num_updates", 0))
            scheduler._num_bands = int(metadata["num_bands"])
            scheduler._context_size = int(metadata["context_size"])
        scheduler._validate_model_shape(
            int(metadata["num_bands"]), int(metadata["context_size"])
        )
        return scheduler
