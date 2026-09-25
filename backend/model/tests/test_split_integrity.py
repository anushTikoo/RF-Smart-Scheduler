import json

import pytest

from smart_scan.data.split_integrity import validate_split_manifests


def test_scaled_manifests_are_disjoint_and_have_expected_counts() -> None:
    result = validate_split_manifests(
        [
            "data/manifests/scaled_train_val.json",
            "data/manifests/scaled_test_holdout.json",
        ]
    )
    assert result["counts"] == {"train": 30, "val": 10, "test": 10}
    assert result["total_files"] == 50
    assert result["duplicate_source_files"] == 0


def test_duplicate_source_file_is_rejected(tmp_path) -> None:
    payload = {
        "dataset_id": "example",
        "files": [{"split": "train", "mode": "stare", "config_id": 1}],
    }
    first = tmp_path / "first.json"
    second = tmp_path / "second.json"
    first.write_text(json.dumps(payload), encoding="utf-8")
    second.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="duplicate source file"):
        validate_split_manifests([first, second])
