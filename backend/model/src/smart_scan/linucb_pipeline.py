from __future__ import annotations

from copy import deepcopy
from dataclasses import asdict
import json
from pathlib import Path
import shutil
from typing import Any, Callable, Iterable

import yaml

from smart_scan.data.download import load_manifest
from smart_scan.data.episode import Episode
from smart_scan.env.scan_env import ReceiverConfig, RewardConfig
from smart_scan.evaluation.aggregate import aggregate_result_files, save_aggregate
from smart_scan.evaluation.fom import load_and_save_figures_of_merit
from smart_scan.evaluation.run import run_episode, save_results
from smart_scan.schedulers.baselines import RoundRobinScheduler
from smart_scan.schedulers.linucb import LinUCBScheduler


LINUCB_OPTION_KEYS = {
    "alpha",
    "regularization",
    "max_revisit_factor",
    "min_revisit_factor",
    "uncertainty_weight",
    "coverage_bonus_weight",
    "shared_model",
}


def manifest_episode_paths(
    manifest_path: str | Path,
    processed_root: str | Path,
    split: str,
) -> list[Path]:
    """Resolve whole processed scenario files for one declared split."""

    manifest = load_manifest(manifest_path)
    paths: list[Path] = []
    for record in manifest["files"]:
        if str(record["split"]) != split:
            continue
        path = (
            Path(processed_root)
            / str(record["mode"])
            / split
            / f"config_{int(record['config_id'])}.npz"
        )
        if not path.is_file():
            raise FileNotFoundError(f"processed episode is missing: {path}")
        paths.append(path)
    if not paths:
        raise ValueError(f"manifest contains no {split!r} scenarios: {manifest_path}")
    if len(paths) != len(set(paths)):
        raise ValueError(f"manifest contains duplicate {split!r} scenarios")
    return paths


def _model_options(candidate: dict[str, Any]) -> dict[str, Any]:
    unknown = sorted(set(candidate) - LINUCB_OPTION_KEYS - {"name"})
    if unknown:
        raise ValueError(f"unknown LinUCB candidate options: {unknown}")
    return {key: candidate[key] for key in LINUCB_OPTION_KEYS if key in candidate}


def train_linucb(
    episode_paths: Iterable[str | Path],
    *,
    output_path: str | Path,
    receiver: ReceiverConfig,
    reward: RewardConfig,
    linucb_options: dict[str, Any],
    epochs: int = 1,
    seed: int = 42,
    progress: Callable[[str], None] | None = None,
) -> LinUCBScheduler:
    """Train one persistent LinUCB model across all supplied scenarios."""

    paths = [Path(path) for path in episode_paths]
    if not paths:
        raise ValueError("at least one LinUCB training episode is required")
    if epochs < 1:
        raise ValueError("epochs must be positive")
    scheduler = LinUCBScheduler(
        **linucb_options,
        preserve_model_across_episodes=True,
        update_enabled=True,
    )
    training_rows: list[dict[str, float | str | int]] = []
    for epoch in range(epochs):
        for index, path in enumerate(paths):
            if progress is not None:
                progress(
                    f"training epoch {epoch + 1}/{epochs}, "
                    f"scenario {index + 1}/{len(paths)}: {path.name}"
                )
            episode = Episode.load(path)
            run_seed = seed + epoch * len(paths) + index
            row = run_episode(
                episode,
                scheduler,
                seed=run_seed,
                receiver=receiver,
                reward=reward,
            )
            row["epoch"] = epoch
            row["episode"] = str(path)
            training_rows.append(row)

    checkpoint = scheduler.save(output_path)
    metadata = {
        "checkpoint": str(checkpoint),
        "episode_paths": [str(path) for path in paths],
        "epochs": epochs,
        "seed": seed,
        "receiver": asdict(receiver),
        "reward": asdict(reward),
        "linucb_options": linucb_options,
        "num_updates": scheduler.num_updates,
        "training_runs": len(training_rows),
        "final_training_run": training_rows[-1],
    }
    checkpoint.with_suffix(".json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )
    return scheduler


def evaluate_frozen_linucb(
    checkpoint_path: str | Path,
    episode_paths: Iterable[str | Path],
    *,
    output_dir: str | Path,
    receiver: ReceiverConfig,
    reward: RewardConfig,
    seed: int = 42,
    bootstrap_samples: int = 2000,
    progress: Callable[[str], None] | None = None,
) -> dict[str, object]:
    """Evaluate a frozen checkpoint and round-robin on independent scenarios."""

    paths = [Path(path) for path in episode_paths]
    if not paths:
        raise ValueError("at least one evaluation episode is required")
    output = Path(output_dir)
    result_paths: list[Path] = []
    scheduler = LinUCBScheduler.load(checkpoint_path, update_enabled=False)
    before_updates = scheduler.num_updates
    for index, path in enumerate(paths):
        if progress is not None:
            progress(f"evaluating scenario {index + 1}/{len(paths)}: {path.name}")
        episode = Episode.load(path)
        run_seed = seed + index
        rows = [
            run_episode(
                episode,
                RoundRobinScheduler(),
                seed=run_seed,
                receiver=receiver,
                reward=reward,
            ),
            run_episode(
                episode,
                scheduler,
                seed=run_seed,
                receiver=receiver,
                reward=reward,
            ),
        ]
        result_path = output / "episodes" / f"{path.stem}.json"
        save_results(rows, result_path)
        result_paths.append(result_path)
    if scheduler.num_updates != before_updates:
        raise RuntimeError("frozen LinUCB checkpoint changed during evaluation")
    aggregate = aggregate_result_files(
        result_paths, bootstrap_samples=bootstrap_samples, seed=seed
    )
    aggregate_path = save_aggregate(aggregate, output / "aggregate.json")
    load_and_save_figures_of_merit(
        aggregate_path, output / "figures_of_merit.json"
    )
    return aggregate


def train_validate_select(
    train_paths: Iterable[str | Path],
    validation_paths: Iterable[str | Path],
    candidates: list[dict[str, Any]],
    *,
    output_dir: str | Path,
    configuration: dict[str, Any],
    receiver: ReceiverConfig,
    reward: RewardConfig,
    epochs: int = 1,
    seed: int = 42,
    bootstrap_samples: int = 2000,
    progress: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """Train each candidate on train only and select it using validation only."""

    train = [Path(path) for path in train_paths]
    validation = [Path(path) for path in validation_paths]
    if not candidates:
        raise ValueError("at least one LinUCB candidate is required")
    output = Path(output_dir)
    records: list[dict[str, Any]] = []
    for index, candidate in enumerate(candidates):
        name = str(candidate.get("name", f"candidate_{index}"))
        if progress is not None:
            progress(f"candidate {index + 1}/{len(candidates)}: {name}")
        if not name.replace("_", "").replace("-", "").isalnum():
            raise ValueError(f"candidate name must be filesystem-safe: {name!r}")
        options = _model_options(candidate)
        candidate_dir = output / "candidates" / name
        checkpoint = candidate_dir / "linucb.npz"
        train_linucb(
            train,
            output_path=checkpoint,
            receiver=receiver,
            reward=reward,
            linucb_options=options,
            epochs=epochs,
            seed=seed,
            progress=progress,
        )
        aggregate = evaluate_frozen_linucb(
            checkpoint,
            validation,
            output_dir=candidate_dir / "validation",
            receiver=receiver,
            reward=reward,
            seed=seed,
            bootstrap_samples=bootstrap_samples,
            progress=progress,
        )
        linucb = next(
            row for row in aggregate["summary"] if row["scheduler"] == "linucb"  # type: ignore[index]
        )
        records.append(
            {
                "name": name,
                "options": options,
                "checkpoint": str(checkpoint),
                "validation_average_reward": float(linucb["average_reward"]["mean"]),  # type: ignore[index]
                "validation_pulse_interception_ratio": float(
                    linucb["pulse_interception_ratio"]["mean"]  # type: ignore[index]
                ),
                "validation_first_intercept_delay_s": float(
                    linucb["average_first_intercept_delay_s"]["mean"]  # type: ignore[index]
                ),
            }
        )

    # Reward is the declared multi-objective target. Pulse interception and lower
    # delay are deterministic tie-breakers, not extra information from test.
    best = max(
        records,
        key=lambda row: (
            row["validation_average_reward"],
            row["validation_pulse_interception_ratio"],
            -row["validation_first_intercept_delay_s"],
        ),
    )
    frozen_checkpoint = output / "frozen_linucb.npz"
    shutil.copy2(best["checkpoint"], frozen_checkpoint)
    source_metadata = Path(best["checkpoint"]).with_suffix(".json")
    shutil.copy2(source_metadata, frozen_checkpoint.with_suffix(".json"))

    frozen_configuration = deepcopy(configuration)
    frozen_configuration["linucb"] = dict(best["options"])
    frozen_configuration["linucb"]["checkpoint"] = str(frozen_checkpoint)
    frozen_config_path = output / "frozen_config.yaml"
    frozen_config_path.parent.mkdir(parents=True, exist_ok=True)
    frozen_config_path.write_text(
        yaml.safe_dump(frozen_configuration, sort_keys=False), encoding="utf-8"
    )
    selection = {
        "selection_rule": (
            "highest validation average reward; pulse interception then lower "
            "first-intercept delay as tie-breakers"
        ),
        "train_episode_count": len(train),
        "validation_episode_count": len(validation),
        "epochs": epochs,
        "seed": seed,
        "candidates": records,
        "selected": best,
        "frozen_checkpoint": str(frozen_checkpoint),
        "frozen_config": str(frozen_config_path),
        "test_data_accessed": False,
    }
    (output / "selection.json").write_text(
        json.dumps(selection, indent=2), encoding="utf-8"
    )
    return selection
