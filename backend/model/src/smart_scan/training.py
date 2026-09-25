from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path

import numpy as np

from smart_scan.data.episode import Episode
from smart_scan.env.scan_env import ReceiverConfig, RewardConfig, ScanEnvironment
from smart_scan.schedulers.dqn import DQNScheduler


def train_dqn(
    episode_paths: list[str | Path],
    *,
    epochs: int = 3,
    seed: int = 42,
    output_path: str | Path = "outputs/models/dqn.pt",
    receiver: ReceiverConfig | None = None,
    reward: RewardConfig | None = None,
    dqn_options: dict | None = None,
) -> DQNScheduler:
    if not episode_paths:
        raise ValueError("at least one training episode is required")
    scheduler = DQNScheduler(training=True, **(dqn_options or {}))
    for epoch in range(epochs):
        for index, path in enumerate(episode_paths):
            episode = Episode.load(path)
            run_seed = seed + epoch * len(episode_paths) + index
            env = ScanEnvironment(episode, receiver=receiver, reward=reward, seed=run_seed)
            scheduler.reset(env, seed=run_seed)
            state = env.reset()
            while not env.done:
                action = scheduler.select_action(env)
                transition = env.step(action)
                next_state = env.state_vector()
                scheduler.observe(env, state, action, transition, next_state)
                state = next_state
    scheduler.save(output_path)
    metadata_path = Path(f"{output_path}.json")
    metadata_path.write_text(
        json.dumps(
            {
                "episode_paths": [str(path) for path in episode_paths],
                "epochs": epochs,
                "seed": seed,
                "receiver": asdict(receiver or ReceiverConfig()),
                "reward": asdict(reward or RewardConfig()),
                "dqn_options": dqn_options or {},
                "action_steps": scheduler.action_steps,
                "gradient_steps": scheduler.gradient_steps,
                "loss_mean": float(np.mean(scheduler.loss_history))
                if scheduler.loss_history
                else None,
                "loss_last_100_mean": float(np.mean(scheduler.loss_history[-100:]))
                if scheduler.loss_history
                else None,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return scheduler
