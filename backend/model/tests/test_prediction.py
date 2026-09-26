from __future__ import annotations

import numpy as np

from smart_scan.prediction.next_pulse import NextPulsePredictor


def test_periodic_next_pulse_prediction() -> None:
    predictor = NextPulsePredictor(num_bands=3, min_intervals=3)
    predictor.update(
        np.asarray([0.0, 1.0, 2.0, 3.0]),
        np.asarray([1, 1, 1, 1]),
    )
    prediction = predictor.predict_next(current_time_s=3.0)
    assert prediction is not None
    assert prediction.time_s == 4.0
    assert prediction.band_index == 1
    predictor.update(np.asarray([4.0]), np.asarray([1]))
    metrics = predictor.metrics()
    assert metrics["intercept_time_prediction_mae_s"] == 0.0
    assert metrics["next_pulse_band_accuracy"] == 1.0


def test_v2_predictor_updates_once_per_dwell() -> None:
    predictor = NextPulsePredictor(num_bands=2, min_intervals=1, history_size=4)
    predictor.update_dwell(observation_time_s=0.001, band_index=0, active=True)
    predictor.update_dwell(observation_time_s=0.002, band_index=0, active=False)
    predictor.update_dwell(observation_time_s=0.003, band_index=0, active=True)
    assert predictor.dwell_updates == 3
    assert predictor.active_observations == 2
    assert list(predictor.times[0]) == [0.001, 0.003]
