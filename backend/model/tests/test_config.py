from __future__ import annotations

from smart_scan.config import linucb_kwargs, load_config, receiver_config, reward_config


def test_production_configuration_is_consumable() -> None:
    payload = load_config("configs/v2_production_core.yaml")
    receiver = receiver_config(payload)
    reward = reward_config(payload)
    assert receiver.amplitude_threshold_db == -120.0
    assert receiver.detection_probability == 1.0
    assert receiver.false_alarm_probability == 0.0
    assert reward.pulse_intercept_weight == 0.01
    assert reward.acquisition_delay_weight_per_s == 1.0
    assert reward.missed_opportunity_penalty_per_s == 20.0


def test_production_linucb_enables_adaptive_coverage() -> None:
    options = linucb_kwargs(load_config("configs/v2_production_core.yaml"))
    assert options["min_revisit_factor"] == 0.5
    assert options["max_revisit_factor"] == 3.0
    assert options["coverage_bonus_weight"] == 1.0
    assert options["shared_model"] is True
