from __future__ import annotations

import pytest

torch = pytest.importorskip("torch")

from smart_scan.data.synthetic import make_synthetic_episode
from smart_scan.evaluation.run import run_episode
from smart_scan.schedulers.dqn import DQNScheduler


def test_dqn_trains_and_completes_short_episode() -> None:
    episode = make_synthetic_episode(num_steps=80, num_bands=4, num_emitters=3)
    scheduler = DQNScheduler(
        hidden_size=16,
        replay_capacity=100,
        batch_size=8,
        target_update_steps=5,
        epsilon_decay_steps=50,
    )
    result = run_episode(episode, scheduler, seed=2)
    assert result["scheduler"] == "dqn"
    assert scheduler.gradient_steps > 0
    assert scheduler.loss_history

