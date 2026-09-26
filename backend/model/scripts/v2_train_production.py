from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

import numpy as np
import yaml

from smart_scan.config import linucb_kwargs, load_config, receiver_config, reward_config
from smart_scan.data.download import load_manifest
from smart_scan.linucb_pipeline import (
    estimate_pulse_count_reference,
    manifest_episode_paths,
    train_linucb,
    validate_episode_geometry,
)
from smart_scan.schedulers.linucb import LinUCBScheduler


MODEL_FILENAME = "smart_scan_linucb_v2.npz"
CONFIG_FILENAME = "smart_scan_linucb_v2.yaml"
METADATA_FILENAME = "model_metadata.json"
MANIFEST_FILENAME = "training_manifest.json"
HISTORY_CSV_FILENAME = "training_history.csv"
HISTORY_JSON_FILENAME = "training_history.json"
CHECKSUM_FILENAME = "SHA256SUMS.txt"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def checkpoint_metadata(path: Path) -> dict[str, object]:
    with np.load(path, allow_pickle=False) as payload:
        return json.loads(str(payload["metadata"]))


def export_bundle(
    *,
    trained_checkpoint: Path,
    manifest_path: Path,
    configuration: dict[str, object],
    output_dir: Path,
    archive_path: Path,
    training_scenarios: int,
    epochs: int,
    pulse_count_reference: float,
) -> dict[str, object]:
    bundle_dir = output_dir / "frozen_model"
    bundle_dir.mkdir(parents=True, exist_ok=True)

    model_path = bundle_dir / MODEL_FILENAME
    trained = LinUCBScheduler.load(trained_checkpoint, update_enabled=False)
    trained.artifact_metadata = {
        **trained.artifact_metadata,
        "artifact_status": "frozen",
        "deployment_updates_enabled": False,
        "training_scenario_count": training_scenarios,
        "epochs": epochs,
        "selected_candidate": "v2_core",
        "selection_completed_before_production_training": True,
    }
    trained.save(model_path)

    frozen = LinUCBScheduler.load(model_path)
    if frozen.update_enabled:
        raise RuntimeError("exported model is not frozen")
    if frozen.num_updates != trained.num_updates:
        raise RuntimeError("exported model failed update-count verification")

    frozen_config = deepcopy(configuration)
    frozen_config["model_status"] = "frozen"
    frozen_config["context"]["pulse_count_reference"] = pulse_count_reference
    frozen_config["linucb"]["pulse_count_reference"] = pulse_count_reference
    frozen_config["linucb"]["checkpoint"] = MODEL_FILENAME
    (bundle_dir / CONFIG_FILENAME).write_text(
        yaml.safe_dump(frozen_config, sort_keys=False), encoding="utf-8"
    )
    shutil.copy2(manifest_path, bundle_dir / MANIFEST_FILENAME)

    history_stem = trained_checkpoint.stem
    history_csv = trained_checkpoint.with_name(f"{history_stem}_training_history.csv")
    history_json = trained_checkpoint.with_name(f"{history_stem}_training_history.json")
    shutil.copy2(history_csv, bundle_dir / HISTORY_CSV_FILENAME)
    shutil.copy2(history_json, bundle_dir / HISTORY_JSON_FILENAME)

    embedded = checkpoint_metadata(model_path)
    metadata = {
        "schema_version": 1,
        "artifact_status": "frozen",
        "model_type": "LinUCB contextual bandit",
        "selected_candidate": "v2_core",
        "predictor_enabled": False,
        "online_updates_enabled": False,
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "training_scenario_count": training_scenarios,
        "epochs": epochs,
        "num_updates": frozen.num_updates,
        "pulse_count_reference_train_p95": pulse_count_reference,
        "training_manifest_sha256": file_sha256(manifest_path),
        "checkpoint": MODEL_FILENAME,
        "configuration": CONFIG_FILENAME,
        "feature_names": embedded.get("feature_names", []),
        "environment": embedded.get("environment", {}),
        "selection_protocol": (
            "Hyperparameters were selected using the earlier 30-train/10-validation "
            "experiment and evaluated once on the untouched 10-scenario holdout. "
            "No validation or test files are included in this 100-scenario fit."
        ),
        "deployment_note": (
            "LinUCBScheduler.load(checkpoint) defaults to frozen inference. "
            "Do not enable online updates unless explicitly required by the application."
        ),
    }
    (bundle_dir / METADATA_FILENAME).write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )

    checksummed = sorted(
        path
        for path in bundle_dir.iterdir()
        if path.is_file() and path.name != CHECKSUM_FILENAME
    )
    checksum_text = "".join(
        f"{file_sha256(path)}  {path.name}\n" for path in checksummed
    )
    (bundle_dir / CHECKSUM_FILENAME).write_text(checksum_text, encoding="utf-8")

    archive_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(bundle_dir.iterdir()):
            if path.is_file():
                archive.write(path, arcname=path.name)

    result = {
        **metadata,
        "bundle_directory": str(bundle_dir),
        "archive": str(archive_path),
        "archive_sha256": file_sha256(archive_path),
        "archive_size_bytes": archive_path.stat().st_size,
    }
    (output_dir / "production_export.json").write_text(
        json.dumps(result, indent=2), encoding="utf-8"
    )
    return result


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Train the fixed V2 core LinUCB configuration on 100 official training "
            "scenarios and export a frozen backend bundle."
        )
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("data/manifests/v2_production_train_100.json"),
    )
    parser.add_argument(
        "--processed",
        type=Path,
        default=Path("data/processed_v2_production_100"),
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path("configs/v2_production_core.yaml"),
    )
    parser.add_argument(
        "--output", type=Path, default=Path("outputs/v2_production_100")
    )
    parser.add_argument(
        "--archive",
        type=Path,
        default=Path("artifacts/smart_scan_linucb_v2_production.zip"),
    )
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--expected-scenarios", type=int, default=100)
    parser.add_argument("--no-resume", action="store_false", dest="resume")
    parser.add_argument(
        "--colab-download",
        action="store_true",
        help="After export, open the ZIP download dialog when running in Colab.",
    )
    parser.set_defaults(resume=True)
    args = parser.parse_args()

    manifest = load_manifest(args.manifest)
    records = manifest["files"]
    if len(records) != args.expected_scenarios:
        raise ValueError(
            f"expected {args.expected_scenarios} manifest records, found {len(records)}"
        )
    if any(record.get("split") != "train" for record in records):
        raise ValueError("production training manifest may contain only train files")
    identities = {
        (str(record["mode"]), str(record["split"]), int(record["config_id"]))
        for record in records
    }
    if len(identities) != len(records):
        raise ValueError("production training manifest contains duplicate scenarios")

    configuration = load_config(args.config)
    options = linucb_kwargs(configuration)
    if options.get("predictor_enabled") is not False:
        raise ValueError("production model must use the selected predictor-disabled core")
    if float(options.get("alpha", -1.0)) != 0.5:
        raise ValueError("production model must use the selected alpha=0.5")

    paths = manifest_episode_paths(args.manifest, args.processed, "train")
    geometry = validate_episode_geometry(paths, configuration)
    print(f"verified {len(paths)} unique training scenarios: {geometry}", flush=True)
    print("estimating train-only pulse-count p95...", flush=True)
    pulse_reference = estimate_pulse_count_reference(paths)
    options["pulse_count_reference"] = pulse_reference
    options["no_hit_reference"] = float(configuration["context"]["no_hit_reference"])
    print(f"train-only pulse_count_reference={pulse_reference:.6f}", flush=True)

    training_dir = args.output / "training"
    checkpoint = training_dir / "linucb.npz"
    scheduler = train_linucb(
        paths,
        output_path=checkpoint,
        receiver=receiver_config(configuration),
        reward=reward_config(configuration),
        linucb_options=options,
        epochs=args.epochs,
        seed=args.seed,
        progress=lambda message: print(message, flush=True),
        resume=args.resume,
    )
    if scheduler.num_updates <= 0:
        raise RuntimeError("training completed without LinUCB updates")

    result = export_bundle(
        trained_checkpoint=checkpoint,
        manifest_path=args.manifest,
        configuration=configuration,
        output_dir=args.output,
        archive_path=args.archive,
        training_scenarios=len(paths),
        epochs=args.epochs,
        pulse_count_reference=pulse_reference,
    )
    print(json.dumps(result, indent=2), flush=True)

    if args.colab_download:
        try:
            from google.colab import files
        except ImportError as exc:
            raise RuntimeError("--colab-download is only available in Colab") from exc
        files.download(str(args.archive))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

