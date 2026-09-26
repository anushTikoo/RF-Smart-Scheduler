from __future__ import annotations

import argparse
import cProfile
import io
from pathlib import Path
import pstats

from smart_scan.data.episode import Episode
from smart_scan.env.scan_env import ScanEnvironment
from smart_scan.schedulers.linucb import LinUCBScheduler


def main() -> int:
    parser = argparse.ArgumentParser(description="Profile the V2 scheduler hot path.")
    parser.add_argument(
        "--episode",
        type=Path,
        default=Path("data/processed_v2_20bands_500us/stare/train/config_0.npz"),
    )
    parser.add_argument("--steps", type=int, default=5000)
    parser.add_argument("--predictor", action="store_true")
    args = parser.parse_args()
    episode = Episode.load(args.episode)
    env = ScanEnvironment(episode)
    scheduler = LinUCBScheduler(
        shared_model=True,
        context_version="v2",
        predictor_enabled=args.predictor,
        pulse_count_reference=21.0,
        min_revisit_factor=0.5,
        max_revisit_factor=3.0,
        uncertainty_weight=0.75,
        coverage_bonus_weight=1.0,
    )
    scheduler.reset(env)
    empty = __import__("numpy").empty(0)
    profiler = cProfile.Profile()
    profiler.enable()
    for _ in range(min(args.steps, episode.num_steps)):
        action = scheduler.select_action(env)
        transition = env.step(action)
        scheduler.observe(env, empty, action, transition, empty)
    profiler.disable()
    output = io.StringIO()
    pstats.Stats(profiler, stream=output).sort_stats("cumulative").print_stats(30)
    print(output.getvalue())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
