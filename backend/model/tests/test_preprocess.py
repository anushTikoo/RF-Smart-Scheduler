from __future__ import annotations

import numpy as np

from smart_scan.data.preprocess import pulse_train_to_episode


def test_pulse_train_to_episode_bins_time_frequency_and_labels() -> None:
    data = np.asarray(
        [
            [0.0, 750.0, 1.0, 0.0, -60.0],
            [1_000.0, 750.0, 1.0, 0.0, -55.0],
            [6_000.0, 1_250.0, 1.0, 0.0, -70.0],
        ],
        dtype=np.float32,
    )
    labels = np.asarray([10, 10, 20], dtype=np.int8)
    episode = pulse_train_to_episode(
        data,
        labels,
        frequency_min_mhz=500.0,
        frequency_max_mhz=1_500.0,
        bandwidth_mhz=500.0,
        dwell_ms=5.0,
    )
    assert episode.pulse_count.shape == (2, 2)
    assert episode.pulse_count[0, 0] == 2
    assert episode.pulse_count[1, 1] == 1
    assert episode.emitter_presence[0, 0, 0]
    assert episode.emitter_presence[1, 1, 1]
    assert episode.max_amplitude_db[0, 0] == -55.0

