from __future__ import annotations

import numpy as np

from smart_scan.env.scan_env import ScanEnvironment
from smart_scan.schedulers.base import Scheduler


class RoundRobinScheduler(Scheduler):
    name = "round_robin"

    def reset(self, env: ScanEnvironment, seed: int = 0) -> None:
        super().reset(env, seed)
        self.next_band = 0

    def select_action(self, env: ScanEnvironment) -> int:
        action = self.next_band
        self.next_band = (self.next_band + 1) % env.episode.num_bands
        return action


class RandomScheduler(Scheduler):
    name = "random"

    def select_action(self, env: ScanEnvironment) -> int:
        return int(self.rng.integers(0, env.episode.num_bands))


class GreedyScheduler(Scheduler):
    name = "greedy"

    def __init__(self, exploration: float = 0.1) -> None:
        self.exploration = exploration

    def select_action(self, env: ScanEnvironment) -> int:
        if self.rng.random() < self.exploration:
            return int(self.rng.integers(0, env.episode.num_bands))
        contexts = env.band_contexts()
        score = (
            contexts[:, 3]
            + 0.2 * contexts[:, 2]
            + 0.3 * contexts[:, 8]
            - 0.05 * contexts[:, 9]
        )
        return int(np.argmax(score))


class PeriodicScheduler(Scheduler):
    name = "periodic"

    def __init__(self, exploration: float = 0.05) -> None:
        self.exploration = exploration

    def select_action(self, env: ScanEnvironment) -> int:
        if self.rng.random() < self.exploration:
            return int(self.rng.integers(0, env.episode.num_bands))
        contexts = env.band_contexts()
        score = (
            1.5 * contexts[:, 7]
            + 0.75 * contexts[:, 8]
            + contexts[:, 3]
            + 0.15 * contexts[:, 2]
            - 0.05 * contexts[:, 9]
        )
        return int(np.argmax(score))


class OracleScheduler(Scheduler):
    name = "oracle"

    def select_action(self, env: ScanEnvironment) -> int:
        return env.oracle_action()
