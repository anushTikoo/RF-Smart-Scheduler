from __future__ import annotations

import pytest

from smart_scan.data.synthetic import make_synthetic_episode
from smart_scan.evaluation.run import run_episode
from smart_scan.schedulers.baselines import OracleScheduler, RoundRobinScheduler
from smart_scan.schedulers.base import coverage_urgency, revisit_candidate_mask
from smart_scan.schedulers.linucb import LinUCBScheduler


@pytest.mark.parametrize(
    "scheduler",
    [RoundRobinScheduler(), LinUCBScheduler(alpha=0.5), OracleScheduler()],
)
def test_scheduler_completes_episode(scheduler) -> None:
    episode = make_synthetic_episode(num_steps=40, num_bands=5, num_emitters=4)
    result = run_episode(episode, scheduler, seed=3)
    assert result["scheduler"] == scheduler.name
    assert 0.0 <= result["emitter_event_interception_ratio"] <= 1.0


def test_oracle_reward_is_at_least_round_robin() -> None:
    episode = make_synthetic_episode(num_steps=100, num_bands=6, num_emitters=5)
    oracle = run_episode(episode, OracleScheduler(), seed=1)
    round_robin = run_episode(episode, RoundRobinScheduler(), seed=1)
    assert oracle["total_reward"] >= round_robin["total_reward"]


def test_adaptive_guard_shortens_deadline_for_active_band() -> None:
    episode = make_synthetic_episode(num_steps=100, num_bands=5, num_emitters=3)
    from smart_scan.env.scan_env import ScanEnvironment

    env = ScanEnvironment(episode)
    env.last_visit[:] = 0
    env.visit_count[:] = 5
    env.step_index = 5
    env.ewma_hit[2] = 1.0
    mask = revisit_candidate_mask(
        env,
        3.0,
        min_revisit_factor=0.5,
        uncertainty_weight=0.0,
    )
    assert mask is not None
    assert mask[2]
    assert mask.sum() == 1
    urgency = coverage_urgency(
        env,
        3.0,
        min_revisit_factor=0.5,
        uncertainty_weight=0.0,
    )
    assert urgency[2] > urgency[1]
