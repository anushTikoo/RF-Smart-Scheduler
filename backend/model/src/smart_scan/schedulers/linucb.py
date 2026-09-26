from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from smart_scan.env.scan_env import ScanEnvironment, Transition
from smart_scan.features.context import BandContextConfig
from smart_scan.schedulers.base import Scheduler, coverage_urgency


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
        context_version: str = "v1",
        predictor_enabled: bool = True,
        pulse_count_reference: float = 128.0,
        no_hit_reference: float = 5.0,
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
        self.context_config = BandContextConfig(
            version=context_version,
            predictor_enabled=predictor_enabled,
            pulse_count_reference=pulse_count_reference,
            no_hit_reference=no_hit_reference,
        )
        self.a_inverse: np.ndarray | None = None
        self.b: np.ndarray | None = None
        self.num_updates = 0
        self.reward_prediction_squared_error_sum = 0.0
        self.reward_prediction_count = 0
        self.last_predicted_reward = 0.0
        self.last_reward_prediction_error = 0.0
        self._num_bands: int | None = None
        self._context_size: int | None = None
        self._feature_names: tuple[str, ...] | None = None
        self._environment_metadata: dict[str, float | int | str] = {}
        self.artifact_metadata: dict[str, object] = {}

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
        env.configure_context(self.context_config)
        bands = env.episode.num_bands
        dimension = env.context_size
        actual_environment = {
            "num_bands": bands,
            "frequency_min_mhz": float(env.episode.band_edges_mhz[0]),
            "frequency_max_mhz": float(env.episode.band_edges_mhz[-1]),
            "bandwidth_mhz": float(
                env.episode.band_edges_mhz[1] - env.episode.band_edges_mhz[0]
            ),
            "dwell_s": float(env.episode.time_bin_s),
        }
        if self._environment_metadata:
            mismatches = [
                key
                for key, expected in self._environment_metadata.items()
                if key in actual_environment
                and not np.isclose(float(expected), float(actual_environment[key]))
            ]
            if mismatches:
                raise ValueError(
                    "checkpoint/environment geometry mismatch: " + ", ".join(mismatches)
                )
        if (
            not self.preserve_model_across_episodes
            or self.a_inverse is None
            or self.b is None
        ):
            self._initialize_model(bands, dimension)
        else:
            self._validate_model_shape(bands, dimension)
        if self._feature_names is not None and self._feature_names != env.context_feature_names:
            raise ValueError(
                "checkpoint context features do not match the environment: "
                f"{self._feature_names} != {env.context_feature_names}"
            )
        self._feature_names = env.context_feature_names
        self._environment_metadata = actual_environment
        self.last_contexts: np.ndarray | None = None

    def select_action(self, env: ScanEnvironment) -> int:
        if self.a_inverse is None or self.b is None:
            raise RuntimeError("reset must be called before selecting an action")
        contexts = env.band_contexts().astype(np.float64)
        urgency = coverage_urgency(
            env,
            self.max_revisit_factor,
            min_revisit_factor=self.min_revisit_factor,
            uncertainty_weight=self.uncertainty_weight,
        )
        due = urgency >= 1.0
        candidate_mask = due if np.any(due) else None
        if self.shared_model:
            inverse = self.a_inverse[0]
            theta = inverse @ self.b[0]
            projected = contexts @ inverse
            mean_reward = contexts @ theta
            variance = np.einsum("ij,ij->i", projected, contexts)
        else:
            theta = np.einsum("aij,aj->ai", self.a_inverse, self.b)
            projected = np.einsum("ai,aij->aj", contexts, self.a_inverse)
            mean_reward = np.einsum("ai,ai->a", theta, contexts)
            variance = np.einsum("ai,ai->a", projected, contexts)
        scores = mean_reward + self.alpha * np.sqrt(np.maximum(variance, 0.0))
        scores += self.coverage_bonus_weight * urgency
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
        predicted_reward = float((inverse @ self.b[model_index]) @ context)
        prediction_error = float(transition.reward - predicted_reward)
        self.last_predicted_reward = predicted_reward
        self.last_reward_prediction_error = prediction_error
        self.reward_prediction_squared_error_sum += prediction_error**2
        self.reward_prediction_count += 1
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
            "format_version": 2,
            "alpha": self.alpha,
            "regularization": self.regularization,
            "max_revisit_factor": self.max_revisit_factor,
            "min_revisit_factor": self.min_revisit_factor,
            "uncertainty_weight": self.uncertainty_weight,
            "coverage_bonus_weight": self.coverage_bonus_weight,
            "shared_model": self.shared_model,
            "num_updates": self.num_updates,
            "reward_prediction_squared_error_sum": (
                self.reward_prediction_squared_error_sum
            ),
            "reward_prediction_count": self.reward_prediction_count,
            "num_bands": self._num_bands,
            "context_size": self._context_size,
            "context_version": self.context_config.version,
            "predictor_enabled": self.context_config.predictor_enabled,
            "pulse_count_reference": self.context_config.pulse_count_reference,
            "no_hit_reference": self.context_config.no_hit_reference,
            "feature_names": list(self._feature_names or ()),
            "environment": self._environment_metadata,
            "training": self.artifact_metadata,
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
                context_version=str(metadata.get("context_version", "v1")),
                predictor_enabled=bool(metadata.get("predictor_enabled", True)),
                pulse_count_reference=float(
                    metadata.get("pulse_count_reference", 128.0)
                ),
                no_hit_reference=float(metadata.get("no_hit_reference", 5.0)),
            )
            scheduler.a_inverse = payload["a_inverse"].astype(np.float64, copy=True)
            scheduler.b = payload["b"].astype(np.float64, copy=True)
            scheduler.num_updates = int(metadata.get("num_updates", 0))
            scheduler.reward_prediction_squared_error_sum = float(
                metadata.get("reward_prediction_squared_error_sum", 0.0)
            )
            scheduler.reward_prediction_count = int(
                metadata.get("reward_prediction_count", 0)
            )
            scheduler._num_bands = int(metadata["num_bands"])
            scheduler._context_size = int(metadata["context_size"])
            feature_names = metadata.get("feature_names", [])
            scheduler._feature_names = tuple(str(name) for name in feature_names) or None
            scheduler._environment_metadata = dict(metadata.get("environment", {}))
            scheduler.artifact_metadata = dict(metadata.get("training", {}))
        scheduler._validate_model_shape(
            int(metadata["num_bands"]), int(metadata["context_size"])
        )
        return scheduler

    @property
    def reward_prediction_mse(self) -> float:
        """Mean squared error between predicted and observed contextual reward."""

        return self.reward_prediction_squared_error_sum / max(
            self.reward_prediction_count, 1
        )
