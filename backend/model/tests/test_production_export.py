from __future__ import annotations

import json
from pathlib import Path
import zipfile

from scripts.v2_train_production import export_bundle
from smart_scan.data.synthetic import make_synthetic_episode
from smart_scan.env.scan_env import ReceiverConfig, RewardConfig
from smart_scan.linucb_pipeline import train_linucb
from smart_scan.schedulers.linucb import LinUCBScheduler


def test_production_bundle_is_portable_and_frozen(tmp_path: Path) -> None:
    episode_path = tmp_path / "episode.npz"
    episode = make_synthetic_episode(
        num_steps=30, num_bands=20, num_emitters=2, seed=19
    )
    episode.time_bin_s = 0.0005
    episode.save(episode_path)

    checkpoint = tmp_path / "training" / "linucb.npz"
    train_linucb(
        [episode_path],
        output_path=checkpoint,
        receiver=ReceiverConfig(),
        reward=RewardConfig(),
        linucb_options={
            "alpha": 0.5,
            "regularization": 1.0,
            "min_revisit_factor": 0.5,
            "max_revisit_factor": 3.0,
            "uncertainty_weight": 0.75,
            "coverage_bonus_weight": 1.0,
            "shared_model": True,
            "context_version": "v2",
            "predictor_enabled": False,
            "pulse_count_reference": 8.0,
            "no_hit_reference": 5.0,
        },
    )
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "dataset_id": "test",
                "files": [{"split": "train", "mode": "stare", "config_id": 0}],
            }
        ),
        encoding="utf-8",
    )
    configuration = {
        "model_status": "production_training",
        "receiver": {
            "frequency_min_mhz": 500.0,
            "frequency_max_mhz": 18000.0,
            "bandwidth_mhz": 875.0,
            "dwell_ms": 0.5,
        },
        "context": {
            "version": "v2",
            "predictor_enabled": False,
            "pulse_count_reference": "train_p95",
            "no_hit_reference": 5.0,
        },
        "linucb": {
            "alpha": 0.5,
            "predictor_enabled": False,
        },
    }
    archive = tmp_path / "artifact.zip"
    result = export_bundle(
        trained_checkpoint=checkpoint,
        manifest_path=manifest,
        configuration=configuration,
        output_dir=tmp_path / "output",
        archive_path=archive,
        training_scenarios=1,
        epochs=1,
        pulse_count_reference=8.0,
    )

    assert archive.is_file()
    assert result["artifact_status"] == "frozen"
    model = tmp_path / "output" / "frozen_model" / "smart_scan_linucb_v2.npz"
    assert LinUCBScheduler.load(model).update_enabled is False
    with zipfile.ZipFile(archive) as payload:
        names = set(payload.namelist())
    assert {
        "smart_scan_linucb_v2.npz",
        "smart_scan_linucb_v2.yaml",
        "model_metadata.json",
        "training_manifest.json",
        "training_history.csv",
        "training_history.json",
        "SHA256SUMS.txt",
    } <= names

