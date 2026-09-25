from __future__ import annotations

import argparse
import json
from pathlib import Path

import yaml

from smart_scan.config import load_config, receiver_config, reward_config
from smart_scan.linucb_pipeline import (
    manifest_episode_paths,
    train_validate_select,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Train persistent LinUCB candidates and select on validation only."
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("data/manifests/scaled_train_val.json"),
    )
    parser.add_argument("--processed", type=Path, default=Path("data/processed"))
    parser.add_argument("--config", type=Path, default=Path("configs/scaled.yaml"))
    parser.add_argument(
        "--search-config",
        type=Path,
        default=Path("configs/linucb_search.yaml"),
    )
    parser.add_argument(
        "--output", type=Path, default=Path("outputs/linucb_pipeline")
    )
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--bootstrap-samples", type=int, default=2000)
    args = parser.parse_args()

    configuration = load_config(args.config)
    search = yaml.safe_load(args.search_config.read_text(encoding="utf-8")) or {}
    candidates = search.get("candidates", [])
    if not isinstance(candidates, list):
        raise ValueError("search configuration 'candidates' must be a list")
    train_paths = manifest_episode_paths(args.manifest, args.processed, "train")
    validation_paths = manifest_episode_paths(args.manifest, args.processed, "val")
    selection = train_validate_select(
        train_paths,
        validation_paths,
        candidates,
        output_dir=args.output,
        configuration=configuration,
        receiver=receiver_config(configuration),
        reward=reward_config(configuration),
        epochs=args.epochs,
        seed=args.seed,
        bootstrap_samples=args.bootstrap_samples,
        progress=lambda message: print(message, flush=True),
    )
    print(json.dumps(selection, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
