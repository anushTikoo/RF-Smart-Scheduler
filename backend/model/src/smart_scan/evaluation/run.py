from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Callable

import numpy as np

from smart_scan.data.episode import Episode
from smart_scan.env.scan_env import ReceiverConfig, RewardConfig, ScanEnvironment
from smart_scan.schedulers.base import Scheduler
from smart_scan.schedulers.baselines import (
    GreedyScheduler,
    OracleScheduler,
    PeriodicScheduler,
    RandomScheduler,
    RoundRobinScheduler,
)
from smart_scan.schedulers.linucb import LinUCBScheduler

METRICS = [
    "average_reward",
    "average_interception_reward",
    "average_acquisition_delay_penalty",
    "average_miss_penalty",
    "miss_rate",
    "pulse_interception_ratio",
    "emitter_event_interception_ratio",
    "unique_emitter_coverage",
    "average_first_intercept_delay_s",
    "intercept_rate_per_s",
    "average_switching_distance",
    "false_alarm_rate",
    "measured_detection_probability",
    "sensitivity_threshold_db",
    "mean_revisit_interval_s",
    "pulses_lost_to_latency",
    "receiver_dead_time_s",
    "oracle_band_accuracy",
    "intercept_time_prediction_mae_s",
    "next_pulse_band_accuracy",
    "next_pulse_prediction_count",
]


def scheduler_factories(
    dqn_model: str | Path | None = None,
    *,
    dqn_options: dict | None = None,
    linucb_options: dict | None = None,
) -> dict[str, Callable[[], Scheduler]]:
    factories: dict[str, Callable[[], Scheduler]] = {
        "round_robin": RoundRobinScheduler,
        "random": RandomScheduler,
        "greedy": GreedyScheduler,
        "periodic": PeriodicScheduler,
        "linucb": lambda: LinUCBScheduler(**(linucb_options or {})),
        "oracle": OracleScheduler,
    }
    if dqn_model is not None:
        try:
            from smart_scan.schedulers.dqn import DQNScheduler

            factories["dqn"] = lambda: DQNScheduler(
                training=False, model_path=dqn_model, **(dqn_options or {})
            )
        except (ImportError, RuntimeError):
            pass
    return factories


def run_episode(
    episode: Episode,
    scheduler: Scheduler,
    *,
    seed: int = 0,
    receiver: ReceiverConfig | None = None,
    reward: RewardConfig | None = None,
    trace_path: str | Path | None = None,
    action_callback: Callable[[dict[str, float | int | str | bool]], None]
    | None = None,
) -> dict[str, float | str | int]:
    env = ScanEnvironment(episode, receiver=receiver, reward=reward, seed=seed)
    scheduler.reset(env, seed=seed)
    state = env.reset()
    trace_rows: list[dict[str, float | int | str | bool]] = []
    while not env.done:
        step = env.step_index
        action = scheduler.select_action(env)
        transition = env.step(action)
        action_record = {
            "scheduler": scheduler.name,
            "step": step,
            "time_start_s": step * episode.time_bin_s,
            "band_index": action,
            "frequency_low_mhz": float(episode.band_edges_mhz[action]),
            "frequency_high_mhz": float(episode.band_edges_mhz[action + 1]),
            "detected_pulses": transition.detected_pulses,
            "miss": transition.miss,
            "false_alarm": transition.false_alarm,
            "reward": transition.reward,
            "interception_reward": transition.interception_reward,
            "acquisition_delay_penalty": transition.acquisition_delay_penalty,
            "miss_penalty": transition.miss_penalty,
            "switching_distance": transition.switching_distance,
        }
        if trace_path is not None:
            trace_rows.append(action_record)
        if action_callback is not None:
            action_callback(action_record)
        next_state = env.state_vector()
        scheduler.observe(env, state, action, transition, next_state)
        state = next_state
    if trace_path is not None:
        target = Path(trace_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(trace_rows[0]))
            writer.writeheader()
            writer.writerows(trace_rows)
    return {"scheduler": scheduler.name, "seed": seed, **env.summary()}


def benchmark(
    episode: Episode,
    scheduler_names: list[str],
    *,
    seeds: int = 3,
    dqn_model: str | Path | None = None,
    receiver: ReceiverConfig | None = None,
    reward: RewardConfig | None = None,
    dqn_options: dict | None = None,
    linucb_options: dict | None = None,
) -> list[dict[str, float | str | int]]:
    factories = scheduler_factories(
        dqn_model=dqn_model,
        dqn_options=dqn_options,
        linucb_options=linucb_options,
    )
    unknown = sorted(set(scheduler_names) - set(factories))
    if unknown:
        raise ValueError(f"unknown or unavailable schedulers: {unknown}")
    rows: list[dict[str, float | str | int]] = []
    for name in scheduler_names:
        runs = seeds if name in {"random", "greedy", "periodic"} else 1
        for seed in range(runs):
            rows.append(
                run_episode(
                    episode,
                    factories[name](),
                    seed=seed,
                    receiver=receiver,
                    reward=reward,
                )
            )
    return rows


def summarize(rows: list[dict[str, float | str | int]]) -> list[dict[str, float | str]]:
    output: list[dict[str, float | str]] = []
    for name in sorted({str(row["scheduler"]) for row in rows}):
        selected = [row for row in rows if row["scheduler"] == name]
        result: dict[str, float | str] = {"scheduler": name}
        for metric in METRICS:
            values = np.asarray([float(row[metric]) for row in selected], dtype=np.float64)
            result[f"{metric}_mean"] = float(values.mean())
            result[f"{metric}_std"] = float(values.std())
        output.append(result)
    return output


def save_results(rows: list[dict[str, float | str | int]], path: str | Path) -> Path:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"runs": rows, "summary": summarize(rows)}, indent=2), encoding="utf-8")
    return target
