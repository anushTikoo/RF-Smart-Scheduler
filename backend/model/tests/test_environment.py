from __future__ import annotations

import numpy as np

from smart_scan.data.episode import Episode
from smart_scan.data.preprocess import pulse_train_to_episode
from smart_scan.data.synthetic import make_synthetic_episode
from smart_scan.env.scan_env import ReceiverConfig, RewardConfig, ScanEnvironment


def _dense_episode(pulse_count: np.ndarray, emitter_presence: np.ndarray) -> Episode:
    pulse_count = np.asarray(pulse_count, dtype=np.int32)
    presence = np.asarray(emitter_presence, dtype=bool)
    maximum = np.where(pulse_count > 0, -80.0, -np.inf).astype(np.float32)
    return Episode(
        pulse_count=pulse_count,
        max_amplitude_db=maximum,
        emitter_presence=presence,
        band_edges_mhz=500.0 + np.arange(pulse_count.shape[1] + 1) * 500.0,
        time_bin_s=0.005,
        emitter_labels=np.arange(presence.shape[2], dtype=np.int16),
        source="reward-test",
    )


def test_environment_exposes_fixed_state_and_context_shapes() -> None:
    episode = make_synthetic_episode(num_steps=30, num_bands=6, num_emitters=3)
    env = ScanEnvironment(episode, seed=1)
    state = env.reset()
    assert state.shape == (6 * 11 + 6 + 2,)
    assert env.band_contexts().shape == (6, 12)
    transition = env.step(2)
    assert isinstance(transition.reward, float)
    assert env.step_index == 1


def test_environment_only_detects_selected_band() -> None:
    episode = make_synthetic_episode(num_steps=20, num_bands=4, num_emitters=2)
    env = ScanEnvironment(episode, seed=0)
    env.reset()
    action = 0
    transition = env.step(action)
    expected = int(episode.pulse_count[0, action])
    assert transition.detected_pulses == expected
    unselected = int(episode.pulse_count[0].sum()) - expected
    assert env.total_detected_pulses + unselected == int(episode.pulse_count[0].sum())


def test_summary_metrics_are_bounded() -> None:
    episode = make_synthetic_episode(num_steps=40, num_bands=5, num_emitters=3)
    env = ScanEnvironment(episode, seed=0)
    env.reset()
    while not env.done:
        env.step(0)
    summary = env.summary()
    for key in (
        "pulse_interception_ratio",
        "emitter_event_interception_ratio",
        "unique_emitter_coverage",
        "oracle_band_accuracy",
    ):
        assert 0.0 <= summary[key] <= 1.0


def test_sparse_events_apply_threshold_and_switch_latency_per_pulse() -> None:
    data = np.asarray(
        [
            [0.0, 1250.0, 1.0, 0.0, -80.0],
            [1000.0, 1250.0, 1.0, 0.0, -80.0],
            [3000.0, 1250.0, 1.0, 0.0, -80.0],
            [3500.0, 1250.0, 1.0, 0.0, -130.0],
        ],
        dtype=np.float32,
    )
    episode = pulse_train_to_episode(
        data,
        np.asarray([0, 0, 0, 0]),
        frequency_min_mhz=500.0,
        frequency_max_mhz=1500.0,
        bandwidth_mhz=500.0,
        dwell_ms=5.0,
    )
    env = ScanEnvironment(
        episode,
        receiver=ReceiverConfig(
            amplitude_threshold_db=-120.0,
            decision_latency_us=500.0,
            retune_time_us=1000.0,
            settling_time_us=500.0,
        ),
    )
    env.reset()
    transition = env.step(1)
    assert transition.detected_pulses == 1
    assert env.pulses_lost_to_latency == 2
    assert env.detectable_pulse_count.sum() == 3


def test_each_intercepted_pulse_increases_reward_linearly() -> None:
    one_pulse = _dense_episode(
        np.asarray([[1]]), np.asarray([[[True]]])
    )
    three_pulses = _dense_episode(
        np.asarray([[3]]), np.asarray([[[True]]])
    )
    reward = RewardConfig(
        pulse_intercept_weight=0.01,
        acquisition_delay_weight_per_s=1.0,
        miss_penalty=0.1,
    )
    one = ScanEnvironment(one_pulse, reward=reward).step(0)
    three = ScanEnvironment(three_pulses, reward=reward).step(0)
    assert np.isclose(one.reward, 0.01)
    assert np.isclose(three.reward, 0.03)
    assert np.isclose(three.reward - one.reward, 0.02)


def test_miss_and_false_alarm_are_distinct() -> None:
    emission_elsewhere = _dense_episode(
        np.asarray([[0, 1]]), np.asarray([[[False], [True]]])
    )
    missed = ScanEnvironment(emission_elsewhere).step(0)
    assert missed.miss is True
    assert missed.false_alarm is False

    no_emission = _dense_episode(
        np.asarray([[0, 0]]), np.zeros((1, 2, 1), dtype=bool)
    )
    false_alarm = ScanEnvironment(
        no_emission,
        receiver=ReceiverConfig(false_alarm_probability=1.0),
    ).step(0)
    assert false_alarm.false_alarm is True
    assert false_alarm.miss is False
    assert false_alarm.reward == 0.0


def test_earlier_first_intercept_has_lower_acquisition_delay_cost() -> None:
    pulse_count = np.asarray([[0, 1], [0, 0], [0, 1]])
    presence = np.zeros((3, 2, 1), dtype=bool)
    presence[0, 1, 0] = True
    presence[2, 1, 0] = True
    episode = _dense_episode(pulse_count, presence)

    early = ScanEnvironment(episode)
    for action in (1, 0, 0):
        early.step(action)

    late = ScanEnvironment(episode)
    for action in (0, 0, 1):
        late.step(action)

    early_summary = early.summary()
    late_summary = late.summary()
    assert early_summary["average_acquisition_delay_penalty"] == 0.0
    assert late_summary["average_acquisition_delay_penalty"] > 0.0
    assert early_summary["average_first_intercept_delay_s"] == 0.0
    assert late_summary["average_first_intercept_delay_s"] == 0.01
    assert early_summary["total_reward"] > late_summary["total_reward"]
