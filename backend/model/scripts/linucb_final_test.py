from __future__ import annotations

import argparse
import json
from pathlib import Path

from smart_scan.config import load_config, receiver_config, reward_config
from smart_scan.linucb_pipeline import (
    evaluate_frozen_linucb,
    manifest_episode_paths,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Evaluate one frozen LinUCB checkpoint on a sealed test manifest."
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("data/manifests/scaled_fresh_test_holdout.json"),
    )
    parser.add_argument("--processed", type=Path, default=Path("data/processed"))
    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=Path("outputs/linucb_pipeline/frozen_linucb.npz"),
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path("outputs/linucb_pipeline/frozen_config.yaml"),
    )
    parser.add_argument(
        "--output", type=Path, default=Path("outputs/linucb_pipeline/final_test")
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--bootstrap-samples", type=int, default=10_000)
    parser.add_argument(
        "--band-log-interval",
        type=int,
        default=100,
        help="print the selected LinUCB band every N decisions; use 0 to disable",
    )
    args = parser.parse_args()

    configuration = load_config(args.config)
    test_paths = manifest_episode_paths(args.manifest, args.processed, "test")
    aggregate = evaluate_frozen_linucb(
        args.checkpoint,
        test_paths,
        output_dir=args.output,
        receiver=receiver_config(configuration),
        reward=reward_config(configuration),
        seed=args.seed,
        bootstrap_samples=args.bootstrap_samples,
        progress=lambda message: print(message, flush=True),
        band_log_interval=args.band_log_interval,
    )
    protocol = {
        "checkpoint": str(args.checkpoint),
        "frozen_config": str(args.config),
        "test_manifest": str(args.manifest),
        "test_episode_count": len(test_paths),
        "online_updates_during_test": False,
        "aggregate": str(args.output / "aggregate.json"),
    }
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "protocol.json").write_text(
        json.dumps(protocol, indent=2), encoding="utf-8"
    )
    print(json.dumps(aggregate["summary"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
