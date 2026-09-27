from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path
import shutil

from smart_scan.config import load_config, receiver_config, reward_config
from smart_scan.data.download import load_manifest
from smart_scan.linucb_pipeline import (
    TRAINING_HISTORY_FIELDS,
    manifest_episode_paths,
    train_linucb,
    validate_episode_geometry,
)
from smart_scan.schedulers.linucb import LinUCBScheduler

from v2_train_production import export_bundle


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def scheduler_options(scheduler: LinUCBScheduler) -> dict[str, object]:
    return {
        "alpha": scheduler.alpha,
        "regularization": scheduler.regularization,
        "min_revisit_factor": scheduler.min_revisit_factor,
        "max_revisit_factor": scheduler.max_revisit_factor,
        "uncertainty_weight": scheduler.uncertainty_weight,
        "coverage_bonus_weight": scheduler.coverage_bonus_weight,
        "shared_model": scheduler.shared_model,
        "context_version": scheduler.context_config.version,
        "pulse_count_reference": scheduler.context_config.pulse_count_reference,
        "no_hit_reference": scheduler.context_config.no_hit_reference,
    }


def combine_histories(
    base_path: Path,
    continuation_path: Path,
    output_json: Path,
    output_csv: Path,
) -> list[dict[str, object]]:
    base = json.loads(base_path.read_text(encoding="utf-8"))
    continuation = json.loads(continuation_path.read_text(encoding="utf-8"))
    if len(base) != 100 or len(continuation) != 100:
        raise ValueError(
            f"expected 100 base and 100 continuation rows, got {len(base)} and "
            f"{len(continuation)}"
        )
    combined: list[dict[str, object]] = []
    for index, raw in enumerate(base + continuation, start=1):
        row = dict(raw)
        row["training_phase"] = "base_0_99" if index <= 100 else "continued_100_199"
        row["global_training_scenario"] = index
        combined.append(row)
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(combined, indent=2), encoding="utf-8")
    fields = [
        "global_training_scenario",
        "training_phase",
        *TRAINING_HISTORY_FIELDS,
    ]
    with output_csv.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for row in combined:
            writer.writerow({field: row[field] for field in fields})
    return combined


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Continue the frozen 100-scenario V2 LinUCB model on configs 100-199."
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("data/manifests/v2_additional_train_100.json"),
    )
    parser.add_argument(
        "--processed",
        type=Path,
        default=Path("data/processed_v2_additional_100"),
    )
    parser.add_argument(
        "--base-checkpoint",
        type=Path,
        default=Path(
            "outputs/v2_production_100/frozen_model/smart_scan_linucb_v2.npz"
        ),
    )
    parser.add_argument(
        "--base-history",
        type=Path,
        default=Path(
            "outputs/v2_production_100/training/linucb_training_history.json"
        ),
    )
    parser.add_argument(
        "--base-manifest",
        type=Path,
        default=Path("data/manifests/v2_production_train_100.json"),
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(
            "outputs/v2_production_100/frozen_model/smart_scan_linucb_v2.yaml"
        ),
    )
    parser.add_argument(
        "--output", type=Path, default=Path("outputs/v2_production_200")
    )
    parser.add_argument(
        "--archive",
        type=Path,
        default=Path("artifacts/smart_scan_linucb_v2_1_200_scenarios.zip"),
    )
    parser.add_argument("--seed", type=int, default=142)
    parser.add_argument("--no-resume", action="store_false", dest="resume")
    parser.set_defaults(resume=True)
    args = parser.parse_args()

    manifest = load_manifest(args.manifest)
    records = manifest["files"]
    identities = {
        (str(row["mode"]), str(row["split"]), int(row["config_id"]))
        for row in records
    }
    if len(records) != 100 or len(identities) != 100:
        raise ValueError("continuation manifest must contain 100 unique scenarios")
    if any(row["split"] != "train" for row in records):
        raise ValueError("continuation manifest may contain only training scenarios")
    ids = sorted(int(row["config_id"]) for row in records)
    if ids != list(range(100, 200)):
        raise ValueError("continuation manifest must contain config IDs 100 through 199")

    configuration = load_config(args.config)
    paths = manifest_episode_paths(args.manifest, args.processed, "train")
    geometry = validate_episode_geometry(paths, configuration)
    base_hash_before = sha256(args.base_checkpoint)
    base = LinUCBScheduler.load(args.base_checkpoint, update_enabled=False)
    base_updates = base.num_updates
    options = scheduler_options(base)
    print(
        f"continuing {base_updates} existing updates across 100 new scenarios: {geometry}",
        flush=True,
    )
    print(
        f"retaining frozen pulse_count_reference={options['pulse_count_reference']}",
        flush=True,
    )

    checkpoint = args.output / "training" / "linucb.npz"
    continued = train_linucb(
        paths,
        output_path=checkpoint,
        receiver=receiver_config(configuration),
        reward=reward_config(configuration),
        linucb_options=options,
        epochs=1,
        seed=args.seed,
        progress=lambda message: print(message, flush=True),
        resume=args.resume,
        initial_checkpoint_path=args.base_checkpoint,
    )
    if continued.num_updates <= base_updates:
        raise RuntimeError("continuation training did not add any LinUCB updates")
    if sha256(args.base_checkpoint) != base_hash_before:
        raise RuntimeError("the original V2 checkpoint changed during continuation")

    continuation_history = checkpoint.with_name("linucb_training_history.json")
    export_source = args.output / "export_source"
    export_source.mkdir(parents=True, exist_ok=True)
    export_checkpoint = export_source / "linucb_combined.npz"
    shutil.copy2(checkpoint, export_checkpoint)
    combined_json = export_source / "linucb_combined_training_history.json"
    combined_csv = export_source / "linucb_combined_training_history.csv"
    combined = combine_histories(
        args.base_history,
        continuation_history,
        combined_json,
        combined_csv,
    )
    base_manifest = load_manifest(args.base_manifest)
    combined_manifest = {
        "dataset_id": base_manifest.get("dataset_id", manifest.get("dataset_id")),
        "description": (
            "Frozen V2.1 production-training set: 200 whole train_stare "
            "scenarios, config IDs 0 through 199."
        ),
        "files": [*base_manifest["files"], *records],
    }
    combined_manifest_path = export_source / "combined_training_manifest.json"
    combined_manifest_path.write_text(
        json.dumps(combined_manifest, indent=2), encoding="utf-8"
    )
    combined_ids = {
        (str(row["mode"]), str(row["split"]), int(row["config_id"]))
        for row in combined_manifest["files"]
    }
    if len(combined_ids) != 200:
        raise ValueError("combined production manifest must contain 200 unique scenarios")

    export = export_bundle(
        trained_checkpoint=export_checkpoint,
        manifest_path=combined_manifest_path,
        configuration=configuration,
        output_dir=args.output,
        archive_path=args.archive,
        training_scenarios=200,
        epochs=1,
        pulse_count_reference=float(options["pulse_count_reference"]),
        model_filename="smart_scan_linucb_v2_1_200.npz",
        config_filename="smart_scan_linucb_v2_1_200.yaml",
        model_version="v2.1-200-stare-scenarios",
        pulse_count_reference_source=(
            "retained from training scenarios 0-99 for continuation compatibility"
        ),
    )
    summary = {
        "base_checkpoint": str(args.base_checkpoint),
        "base_checkpoint_sha256": base_hash_before,
        "base_updates": base_updates,
        "additional_training_scenarios": 100,
        "total_training_scenarios": len(combined),
        "final_updates": continued.num_updates,
        "updates_added": continued.num_updates - base_updates,
        "pulse_count_reference_retained": options["pulse_count_reference"],
        "original_checkpoint_unchanged": True,
        "export": export,
    }
    (args.output / "continuation_summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    print(json.dumps(summary, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
