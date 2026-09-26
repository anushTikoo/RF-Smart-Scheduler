from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from smart_scan.env.scan_env import ReceiverConfig, RewardConfig
from smart_scan.features.context import BandContextConfig


DEFAULT_CONFIG_PATH = Path("configs/micro.yaml")


def load_config(path: str | Path = DEFAULT_CONFIG_PATH) -> dict[str, Any]:
    source = Path(path)
    with source.open("r", encoding="utf-8") as stream:
        payload = yaml.safe_load(stream) or {}
    if not isinstance(payload, dict):
        raise ValueError(f"configuration must be a mapping: {source}")
    return payload


def receiver_config(payload: dict[str, Any]) -> ReceiverConfig:
    receiver = payload.get("receiver", {})
    history = payload.get("history", {})
    return ReceiverConfig(
        amplitude_threshold_db=float(receiver.get("amplitude_threshold_db", -120.0)),
        detection_probability=float(receiver.get("detection_probability", 1.0)),
        false_alarm_probability=float(receiver.get("false_alarm_probability", 0.0)),
        ewma_alpha=float(history.get("ewma_alpha", 0.2)),
        decision_latency_us=float(receiver.get("decision_latency_us", 0.0)),
        retune_time_us=float(receiver.get("retune_time_us", 0.0)),
        settling_time_us=float(receiver.get("settling_time_us", 0.0)),
    )


def reward_config(payload: dict[str, Any]) -> RewardConfig:
    reward = payload.get("reward", {})
    return RewardConfig(
        pulse_intercept_weight=float(reward.get("pulse_intercept_weight", 0.01)),
        acquisition_delay_weight_per_s=float(
            reward.get("acquisition_delay_weight_per_s", 1.0)
        ),
        miss_penalty=float(reward.get("miss_penalty", 0.1)),
        missed_opportunity_penalty_per_s=(
            float(reward["missed_opportunity_penalty_per_s"])
            if "missed_opportunity_penalty_per_s" in reward
            else None
        ),
    )


def context_config(payload: dict[str, Any]) -> BandContextConfig:
    context = payload.get("context", {})
    return BandContextConfig(
        version=str(context.get("version", "v1")),
        predictor_enabled=bool(context.get("predictor_enabled", True)),
        pulse_count_reference=float(context.get("pulse_count_reference", 128.0)),
        no_hit_reference=float(context.get("no_hit_reference", 5.0)),
    )


def preprocess_kwargs(payload: dict[str, Any]) -> dict[str, float]:
    receiver = payload.get("receiver", {})
    return {
        "frequency_min_mhz": float(receiver.get("frequency_min_mhz", 500.0)),
        "frequency_max_mhz": float(receiver.get("frequency_max_mhz", 18_000.0)),
        "bandwidth_mhz": float(receiver.get("bandwidth_mhz", 500.0)),
        "dwell_ms": float(receiver.get("dwell_ms", 5.0)),
    }


def dqn_kwargs(payload: dict[str, Any]) -> dict[str, Any]:
    values = dict(payload.get("dqn", {}))
    allowed = {
        "hidden_size",
        "replay_capacity",
        "batch_size",
        "gamma",
        "learning_rate",
        "target_update_steps",
        "train_frequency",
        "epsilon_start",
        "epsilon_end",
        "epsilon_decay_steps",
        "max_revisit_factor",
        "min_revisit_factor",
        "uncertainty_weight",
        "coverage_bonus_weight",
    }
    return {key: values[key] for key in allowed if key in values}


def linucb_kwargs(payload: dict[str, Any]) -> dict[str, Any]:
    values = dict(payload.get("linucb", {}))
    allowed = {
        "alpha",
        "regularization",
        "max_revisit_factor",
        "min_revisit_factor",
        "uncertainty_weight",
        "coverage_bonus_weight",
        "shared_model",
        "context_version",
        "predictor_enabled",
        "pulse_count_reference",
        "no_hit_reference",
    }
    result = {key: values[key] for key in allowed if key in values}
    if "max_revisit_factor" not in result:
        result["max_revisit_factor"] = payload.get("dqn", {}).get("max_revisit_factor", 2.0)
    return result
