from __future__ import annotations

from smart_scan.config import dqn_kwargs, load_config, receiver_config, reward_config


def test_micro_configuration_is_consumable() -> None:
    payload = load_config("configs/micro.yaml")
    receiver = receiver_config(payload)
    reward = reward_config(payload)
    dqn = dqn_kwargs(payload)
    assert receiver.amplitude_threshold_db == -120.0
    assert reward.pulse_intercept_weight == 0.01
    assert reward.acquisition_delay_weight_per_s == 1.0
    assert reward.miss_penalty == 0.1
    assert dqn["max_revisit_factor"] == 2.0


def test_scaled_configuration_enables_adaptive_coverage() -> None:
    payload = load_config("configs/scaled.yaml")
    dqn = dqn_kwargs(payload)
    assert dqn["min_revisit_factor"] == 0.5
    assert dqn["max_revisit_factor"] == 3.0
    assert dqn["coverage_bonus_weight"] == 0.5
    from smart_scan.config import linucb_kwargs

    assert linucb_kwargs(payload)["shared_model"] is True
