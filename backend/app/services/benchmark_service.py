"""
Benchmark service for comparing multiple cognitive and baseline schedulers.
"""

from __future__ import annotations

import time
from typing import Any, Dict

from smart_scan.data.episode import Episode
from smart_scan.env.scan_env import ReceiverConfig, RewardConfig, ScanEnvironment
from smart_scan.features.context import BandContextConfig
from smart_scan.schedulers.base import Scheduler
from smart_scan.schedulers.baselines import (
    OracleScheduler,
    RandomScheduler,
    RoundRobinScheduler,
)
from smart_scan.schedulers.linucb import LinUCBScheduler


class BenchmarkService:
    """Executes multi-scheduler comparative evaluations on an episode."""

    @staticmethod
    def run(
        episode: Episode,
        receiver_cfg: ReceiverConfig,
        reward_cfg: RewardConfig,
        context_cfg: BandContextConfig,
        dataset_name: str,
        num_dwells: int = 120,
        seed: int = 42,
        alpha: float = 0.5,
        regularization: float = 1.0,
    ) -> Dict[str, Any]:
        """Run LinUCB, RoundRobin, Random, and Oracle on the episode."""
        limit = min(num_dwells, episode.num_steps)

        schedulers: Dict[str, Scheduler] = {
            "linucb": LinUCBScheduler(
                alpha=alpha,
                regularization=regularization,
                shared_model=True,
                context_version="v2",
                predictor_enabled=True,
                pulse_count_reference=128.0,
                no_hit_reference=5.0,
            ),
            "round_robin": RoundRobinScheduler(),
            "random": RandomScheduler(),
            "oracle": OracleScheduler(),
        }

        results: Dict[str, Any] = {}

        for name, sched in schedulers.items():
            env = ScanEnvironment(
                episode,
                receiver=receiver_cfg,
                reward=reward_cfg,
                context=context_cfg,
                seed=seed,
            )
            sched.reset(env, seed=seed)

            start_t = time.perf_counter()
            for _ in range(limit):
                s = env.state_vector()
                a = sched.select_action(env)
                tr = env.step(a)
                sched.observe(env, s, a, tr, env.state_vector())
            elapsed = time.perf_counter() - start_t

            summary = env.summary()
            results[name] = {
                "total_detected_pulses": int(env.total_detected_pulses),
                "total_scan_misses": int(env.total_scan_misses),
                "correct_scan_rate": f"{summary['correct_scan_rate'] * 100:.1f}%",
                "pulse_interception_ratio": f"{summary['pulse_interception_ratio'] * 100:.1f}%",
                "average_reward": float(summary["average_reward"]),
                "average_first_intercept_delay_ms": float(
                    summary["average_first_intercept_delay_s"] * 1000.0
                ),
                "runtime_ms": round(elapsed * 1000, 2),
            }

        return {
            "dataset": dataset_name,
            "dwells_evaluated": limit,
            "schedulers": results,
        }
