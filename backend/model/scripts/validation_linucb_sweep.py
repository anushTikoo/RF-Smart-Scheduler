from __future__ import annotations

import argparse
from pathlib import Path

from smart_scan.config import linucb_kwargs, load_config, receiver_config, reward_config
from smart_scan.data.episode import Episode
from smart_scan.evaluation.aggregate import aggregate_result_files, save_aggregate
from smart_scan.evaluation.run import benchmark, save_results


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("episodes", nargs="+", type=Path)
    parser.add_argument("--config", type=Path, default=Path("configs/scaled.yaml"))
    parser.add_argument("--bonus", action="append", type=float, required=True)
    parser.add_argument("--output", type=Path, default=Path("outputs/scaled/linucb_sweep"))
    args = parser.parse_args()

    configuration = load_config(args.config)
    for bonus in args.bonus:
        options = linucb_kwargs(configuration)
        options["coverage_bonus_weight"] = bonus
        label = str(bonus).replace(".", "p")
        result_paths: list[Path] = []
        for episode_path in args.episodes:
            output_path = args.output / f"bonus_{label}" / f"{episode_path.stem}.json"
            rows = benchmark(
                Episode.load(episode_path),
                ["linucb"],
                seeds=1,
                receiver=receiver_config(configuration),
                reward=reward_config(configuration),
                linucb_options=options,
            )
            save_results(rows, output_path)
            result_paths.append(output_path)
            print(f"bonus={bonus} completed {episode_path.stem}", flush=True)
        aggregate = aggregate_result_files(result_paths, bootstrap_samples=10_000, seed=42)
        save_aggregate(aggregate, args.output / f"bonus_{label}_aggregate.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
