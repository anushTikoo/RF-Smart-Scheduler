from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True, slots=True)
class PulsePrediction:
    """Anonymous band-activity prediction derived from observed active dwells."""

    time_s: float
    band_index: int
    confidence: float


class NextPulsePredictor:
    """Bounded-cost, causal predictor operating once per observed dwell.

    Despite the historical class name, V2 predicts the next *active dwell*, not
    every individual PDW. This avoids one update per intercepted pulse and makes
    its output match the scheduler's decision resolution. Emitter identities and
    unobserved truth are never accepted by this API.
    """

    def __init__(
        self,
        num_bands: int,
        *,
        history_size: int = 16,
        min_intervals: int = 3,
    ) -> None:
        if num_bands < 1:
            raise ValueError("num_bands must be positive")
        if history_size < min_intervals + 1:
            raise ValueError("history_size must hold the required intervals")
        self.num_bands = int(num_bands)
        self.history_size = int(history_size)
        self.min_intervals = int(min_intervals)
        self.times = [deque(maxlen=history_size) for _ in range(num_bands)]
        self.periods_s = np.zeros(num_bands, dtype=np.float64)
        self.confidences = np.zeros(num_bands, dtype=np.float64)
        self.next_times_s = np.full(num_bands, np.inf, dtype=np.float64)
        self.pending: PulsePrediction | None = None
        self.time_errors_s: list[float] = []
        self.band_correct = 0
        self.band_predictions = 0
        self.active_observations = 0
        self.dwell_updates = 0

    def _period_statistics(self, band: int) -> tuple[float, float] | None:
        history = np.asarray(self.times[band], dtype=np.float64)
        if len(history) < self.min_intervals + 1:
            return None
        intervals = np.diff(history)
        intervals = intervals[intervals > 1e-12]
        if len(intervals) < self.min_intervals:
            return None
        recent = intervals[-min(len(intervals), self.history_size - 1) :]
        period = float(np.median(recent))
        if period <= 0:
            return None
        coefficient_of_variation = float(
            np.std(recent) / max(np.mean(recent), 1e-12)
        )
        sample_confidence = min(len(recent) / 8.0, 1.0)
        confidence = sample_confidence / (1.0 + coefficient_of_variation)
        return period, float(np.clip(confidence, 0.0, 1.0))

    def _recompute_band(self, band: int) -> None:
        statistics = self._period_statistics(band)
        if statistics is None:
            self.periods_s[band] = 0.0
            self.confidences[band] = 0.0
            self.next_times_s[band] = np.inf
            return
        period, confidence = statistics
        self.periods_s[band] = period
        self.confidences[band] = confidence
        self.next_times_s[band] = float(self.times[band][-1]) + period

    def predict_band(
        self, band: int, *, current_time_s: float
    ) -> PulsePrediction | None:
        period = float(self.periods_s[band])
        if period <= 0:
            return None
        confidence = float(self.confidences[band])
        next_time = float(self.next_times_s[band])
        if next_time <= current_time_s:
            skips = np.floor((current_time_s - next_time) / period) + 1
            next_time += float(skips * period)
        return PulsePrediction(next_time, int(band), confidence)

    def predict_next(self, *, current_time_s: float) -> PulsePrediction | None:
        valid = self.periods_s > 0
        if not np.any(valid):
            return None
        predicted = self.next_times_s.copy()
        overdue = valid & (predicted <= current_time_s)
        predicted[overdue] += (
            np.floor(
                (current_time_s - predicted[overdue]) / self.periods_s[overdue]
            )
            + 1
        ) * self.periods_s[overdue]
        predicted[~valid] = np.inf
        earliest = float(np.min(predicted))
        tied = np.flatnonzero(np.isclose(predicted, earliest, rtol=0.0, atol=1e-12))
        band = int(tied[np.argmax(self.confidences[tied])])
        return PulsePrediction(earliest, band, float(self.confidences[band]))

    def update_dwell(
        self,
        *,
        observation_time_s: float,
        band_index: int,
        active: bool,
    ) -> None:
        """Consume one selected-band observation, irrespective of pulse count."""

        self.dwell_updates += 1
        if not active:
            return
        band = int(band_index)
        if not 0 <= band < self.num_bands:
            raise ValueError("band_index is outside the predictor range")
        time_s = float(observation_time_s)
        self.active_observations += 1
        if self.pending is not None:
            self.time_errors_s.append(abs(time_s - self.pending.time_s))
            self.band_correct += int(band == self.pending.band_index)
            self.band_predictions += 1
        history = self.times[band]
        if not history or time_s > history[-1]:
            history.append(time_s)
            self._recompute_band(band)
        self.pending = self.predict_next(current_time_s=time_s)

    def update(self, event_times_s: np.ndarray, event_bands: np.ndarray) -> None:
        """Backward-compatible adapter for V1 callers."""

        if not len(event_times_s):
            return
        order = np.argsort(event_times_s, kind="stable")
        for index in order:
            self.update_dwell(
                observation_time_s=float(event_times_s[index]),
                band_index=int(event_bands[index]),
                active=True,
            )

    def band_scores(self, current_time_s: float, horizon_s: float) -> np.ndarray:
        horizon_s = max(float(horizon_s), 1e-12)
        valid = self.periods_s > 0
        predicted = self.next_times_s.copy()
        overdue = valid & (predicted <= current_time_s)
        predicted[overdue] += (
            np.floor(
                (current_time_s - predicted[overdue]) / self.periods_s[overdue]
            )
            + 1
        ) * self.periods_s[overdue]
        lead_time = np.maximum(predicted - current_time_s, 0.0)
        scores = np.zeros(self.num_bands, dtype=np.float64)
        scores[valid] = self.confidences[valid] * np.exp(
            -lead_time[valid] / horizon_s
        )
        maximum = float(scores.max(initial=0.0))
        if maximum > 0:
            scores /= maximum
        return scores.astype(np.float32)

    def metrics(self) -> dict[str, float]:
        mae = float(np.mean(self.time_errors_s)) if self.time_errors_s else 0.0
        accuracy = self.band_correct / max(self.band_predictions, 1)
        coverage = self.band_predictions / max(self.active_observations, 1)
        return {
            "next_active_dwell_timing_mae_s": mae,
            "next_active_band_accuracy": accuracy,
            "next_active_prediction_count": float(self.band_predictions),
            "next_active_prediction_coverage": coverage,
            "predictor_dwell_updates": float(self.dwell_updates),
            "intercept_time_prediction_mae_s": mae,
            "next_pulse_band_accuracy": accuracy,
            "next_pulse_prediction_count": float(self.band_predictions),
        }
