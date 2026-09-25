from __future__ import annotations

import numpy as np

from smart_scan.data.episode import Episode
from smart_scan.data.synthetic import make_synthetic_episode


def test_episode_round_trip(tmp_path) -> None:
    episode = make_synthetic_episode(num_steps=25, num_bands=4, num_emitters=3)
    path = episode.save(tmp_path / "episode.npz")
    loaded = Episode.load(path)
    np.testing.assert_array_equal(loaded.pulse_count, episode.pulse_count)
    np.testing.assert_array_equal(loaded.emitter_presence, episode.emitter_presence)
    assert loaded.time_bin_s == episode.time_bin_s
    assert loaded.source == episode.source


def test_synthetic_episode_dimensions() -> None:
    episode = make_synthetic_episode(num_steps=50, num_bands=5, num_emitters=4)
    assert episode.pulse_count.shape == (50, 5)
    assert episode.emitter_presence.shape == (50, 5, 4)
    assert episode.pulse_count.sum() > 0

