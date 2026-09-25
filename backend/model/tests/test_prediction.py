from __future__ import annotations

import numpy as np

from smart_scan.prediction.next_pulse import NextPulsePredictor


def test_periodic_next_pulse_prediction() -> None:
    predictor = NextPulsePredictor(num_emitters=1, num_bands=3, min_intervals=3)
    predictor.update(
        np.asarray([0.0, 1.0, 2.0, 3.0]),
        np.asarray([1, 1, 1, 1]),
        np.asarray([0, 0, 0, 0]),
    )
    prediction = predictor.predict_emitter(0, current_time_s=3.0)
    assert prediction is not None
    assert prediction.time_s == 4.0
    assert prediction.band_index == 1
    predictor.update(np.asarray([4.0]), np.asarray([1]), np.asarray([0]))
    metrics = predictor.metrics()
    assert metrics["intercept_time_prediction_mae_s"] == 0.0
    assert metrics["next_pulse_band_accuracy"] == 1.0

