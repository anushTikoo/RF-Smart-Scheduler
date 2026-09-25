from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True, slots=True)
class PulsePrediction:
    """Prediction derived only from anonymous receiver observations."""

    time_s: float
    band_index: int
    confidence: float


class NextPulsePredictor:
    """Online per-band activity predictor with no emitter identity or prior data.

    It estimates a repeat interval independently for each observed band and
    predicts the earliest next band activity. Multiple emitters sharing a band
    are intentionally treated as one anonymous activity stream.
    """

    def __init__(
        self,
        num_bands: int,
        *,
        history_size: int = 32,
        min_intervals: int = 3,
    ) -> None:
        self.num_bands = num_bands
        self.history_size = history_size
        self.min_intervals = min_intervals
        self.times = [deque(maxlen=history_size) for _ in range(num_bands)]
        self.pending: PulsePrediction | None = None
        self.time_errors_s: list[float] = []
        self.band_correct = 0
        self.band_predictions = 0

    def predict_band(
        self, band: int, *, current_time_s: float
    ) -> PulsePrediction | None:
        history = np.asarray(self.times[band], dtype=np.float64)
        if len(history) < self.min_intervals + 1:
            return None
        intervals = np.diff(history)
        intervals = intervals[intervals > 1e-9]
        if len(intervals) < self.min_intervals:
            return None
        recent = intervals[-min(len(intervals), 16) :]
        period = float(np.median(recent))
        if period <= 0:
            return None
        next_time = float(history[-1] + period)
        if next_time <= current_time_s:
            skips = np.floor((current_time_s - next_time) / period) + 1
            next_time += float(skips * period)
        coefficient_of_variation = float(
            np.std(recent) / max(np.mean(recent), 1e-12)
        )
        timing_confidence = 1.0 / (1.0 + coefficient_of_variation)
        sample_confidence = min(len(recent) / 8.0, 1.0)
        return PulsePrediction(next_time, band, timing_confidence * sample_confidence)

    def predict_next(self, *, current_time_s: float) -> PulsePrediction | None:
        candidates = [
            prediction
            for band in range(self.num_bands)
            if (prediction := self.predict_band(band, current_time_s=current_time_s))
            is not None
        ]
        if not candidates:
            return None
        return min(candidates, key=lambda item: (item.time_s, -item.confidence))

    def update(self, event_times_s: np.ndarray, event_bands: np.ndarray) -> None:
        if not len(event_times_s):
            return
        order = np.argsort(event_times_s, kind="stable")
        for index in order:
            time_s = float(event_times_s[index])
            band = int(event_bands[index])
            if self.pending is not None:
                self.time_errors_s.append(abs(time_s - self.pending.time_s))
                self.band_correct += int(band == self.pending.band_index)
                self.band_predictions += 1
            self.times[band].append(time_s)
            self.pending = self.predict_next(current_time_s=time_s)

    def band_scores(self, current_time_s: float, horizon_s: float) -> np.ndarray:
        scores = np.zeros(self.num_bands, dtype=np.float32)
        horizon_s = max(float(horizon_s), 1e-9)
        for band in range(self.num_bands):
            prediction = self.predict_band(band, current_time_s=current_time_s)
            if prediction is None:
                continue
            time_error = max(prediction.time_s - current_time_s, 0.0)
            proximity = np.exp(-time_error / horizon_s)
            scores[band] = prediction.confidence * proximity
        maximum = float(scores.max(initial=0.0))
        if maximum > 0:
            scores /= maximum
        return scores

    def metrics(self) -> dict[str, float]:
        return {
            "intercept_time_prediction_mae_s": (
                float(np.mean(self.time_errors_s)) if self.time_errors_s else 0.0
            ),
            "next_pulse_band_accuracy": self.band_correct
            / max(self.band_predictions, 1),
            "next_pulse_prediction_count": float(self.band_predictions),
        }
