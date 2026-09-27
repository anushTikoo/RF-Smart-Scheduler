from __future__ import annotations

import argparse
import json
from pathlib import Path

from smart_scan.config import load_config, receiver_config, reward_config
from smart_scan.linucb_pipeline import evaluate_frozen_linucb, manifest_episode_paths


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Evaluate a frozen V2 model on one declared manifest split."
    )
    parser.add_argument(
        "--manifest", type=Path, default=Path("data/manifests/v2_2_test_holdout_100.json")
    )
    parser.add_argument(
        "--processed", type=Path, default=Path("data/processed_v2_2_test_holdout_100")
    )
    parser.add_argument(
        "--checkpoint", type=Path, default=Path("outputs/v2_production_200/frozen_model/smart_scan_linucb_v2_1_200.npz")
    )
    parser.add_argument(
        "--config", type=Path, default=Path("outputs/v2_production_200/frozen_model/smart_scan_linucb_v2_1_200.yaml")
    )
    parser.add_argument(
        "--output", type=Path, default=Path("outputs/v2_production_200/final_test_100")
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--split", choices=("train", "val", "test"), default="test"
    )
    parser.add_argument("--bootstrap-samples", type=int, default=10_000)
    parser.add_argument("--band-log-interval", type=int, default=1000)
    parser.add_argument(
        "--no-round-robin",
        action="store_true",
        help="Skip the baseline when it was already evaluated on the identical episodes.",
    )
    parser.add_argument(
        "--no-traces",
        action="store_true",
        help="Do not write per-dwell CSV traces for large validation/test runs.",
    )
    args = parser.parse_args()

    configuration = load_config(args.config)
    test_paths = manifest_episode_paths(args.manifest, args.processed, args.split)
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
        include_round_robin=not args.no_round_robin,
        write_traces=not args.no_traces,
    )
    protocol = {
        "schema_version": 2,
        "checkpoint": str(args.checkpoint),
        "frozen_config": str(args.config),
        "test_manifest": str(args.manifest),
        "evaluation_split": args.split,
        "test_episode_count": len(test_paths),
        "online_updates_during_test": False,
        "data_used_for_tuning": args.split == "val",
        "test_used_for_tuning": False if args.split == "test" else None,
        "round_robin_included": not args.no_round_robin,
        "per_dwell_traces_written": not args.no_traces,
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
