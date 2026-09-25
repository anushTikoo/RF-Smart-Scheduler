from __future__ import annotations

import json
from pathlib import Path


def validate_split_manifests(paths: list[str | Path]) -> dict[str, object]:
    """Validate whole-file split uniqueness without treating local emitter IDs as identities."""

    seen: dict[tuple[str, str, int], str] = {}
    counts = {"train": 0, "val": 0, "test": 0}
    dataset_ids: set[str] = set()
    for raw_path in paths:
        path = Path(raw_path)
        payload = json.loads(path.read_text(encoding="utf-8"))
        dataset_ids.add(str(payload["dataset_id"]))
        for item in payload["files"]:
            split = str(item["split"])
            mode = str(item["mode"])
            config_id = int(item["config_id"])
            if split not in counts:
                raise ValueError(f"unknown split {split!r} in {path}")
            key = (split, mode, config_id)
            if key in seen:
                raise ValueError(
                    f"duplicate source file {key} in {path}; already present in {seen[key]}"
                )
            seen[key] = str(path)
            counts[split] += 1
    if len(dataset_ids) != 1:
        raise ValueError(f"manifests reference multiple datasets: {sorted(dataset_ids)}")
    return {
        "dataset_id": next(iter(dataset_ids)),
        "counts": counts,
        "total_files": sum(counts.values()),
        "whole_file_split": True,
        "duplicate_source_files": 0,
        "emitter_labels_are_scenario_local": True,
    }
