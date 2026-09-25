from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True, slots=True)
class PulsePrediction:
    emitter_index: int
    time_s: float
    band_index: int
    confidence: float


class NextPulsePredictor:
    """Small online PRI and frequency-transition predictor per tracked emitter."""

    def __init__(
        self,
        num_emitters: int,
        num_bands: int,
        *,
        history_size: int = 32,
        min_intervals: int = 3,
    ) -> None:
        self.num_emitters = num_emitters
        self.num_bands = num_bands
        self.history_size = history_size
        self.min_intervals = min_intervals
        self.times = [deque(maxlen=history_size) for _ in range(num_emitters)]
        self.bands = [deque(maxlen=history_size) for _ in range(num_emitters)]
        self.transitions = np.zeros(
            (num_emitters, num_bands, num_bands), dtype=np.int32
        )
        self.pending: dict[int, PulsePrediction] = {}
        self.time_errors_s: list[float] = []
        self.band_correct = 0
        self.band_predictions = 0

    def update(
        self,
        event_times_s: np.ndarray,
        event_bands: np.ndarray,
        event_emitters: np.ndarray,
    ) -> None:
        if not len(event_times_s):
            return
        order = np.argsort(event_times_s, kind="stable")
        for index in order:
            time_s = float(event_times_s[index])
            band = int(event_bands[index])
            emitter = int(event_emitters[index])
            pending = self.pending.pop(emitter, None)
            if pending is not None:
                self.time_errors_s.append(abs(time_s - pending.time_s))
                self.band_correct += int(band == pending.band_index)
                self.band_predictions += 1
            if self.bands[emitter]:
                previous_band = int(self.bands[emitter][-1])
                self.transitions[emitter, previous_band, band] += 1
            self.times[emitter].append(time_s)
            self.bands[emitter].append(band)
            prediction = self.predict_emitter(emitter, current_time_s=time_s)
            if prediction is not None:
                self.pending[emitter] = prediction

    def predict_emitter(
        self, emitter: int, *, current_time_s: float
    ) -> PulsePrediction | None:
        history = np.asarray(self.times[emitter], dtype=np.float64)
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

        last_band = int(self.bands[emitter][-1])
        transition_row = self.transitions[emitter, last_band]
        if transition_row.sum() > 0:
            next_band = int(np.argmax(transition_row))
            frequency_confidence = float(transition_row[next_band] / transition_row.sum())
        else:
            next_band = last_band
            frequency_confidence = 0.5
        coefficient_of_variation = float(np.std(recent) / max(np.mean(recent), 1e-12))
        timing_confidence = 1.0 / (1.0 + coefficient_of_variation)
        sample_confidence = min(len(recent) / 8.0, 1.0)
        confidence = timing_confidence * frequency_confidence * sample_confidence
        return PulsePrediction(emitter, next_time, next_band, confidence)

    def band_scores(self, current_time_s: float, horizon_s: float) -> np.ndarray:
        scores = np.zeros(self.num_bands, dtype=np.float32)
        horizon_s = max(float(horizon_s), 1e-9)
        for emitter in range(self.num_emitters):
            prediction = self.predict_emitter(emitter, current_time_s=current_time_s)
            if prediction is None:
                continue
            time_error = max(prediction.time_s - current_time_s, 0.0)
            proximity = np.exp(-time_error / horizon_s)
            scores[prediction.band_index] += prediction.confidence * proximity
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

