from __future__ import annotations

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
