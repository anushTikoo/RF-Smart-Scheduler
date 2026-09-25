from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

from smart_scan.data.download import load_manifest, remote_path


def audit_h5(path: str | Path) -> dict[str, Any]:
    try:
        import h5py
    except ImportError as exc:
        raise RuntimeError("h5py is required to audit radar files") from exc

    source = Path(path)
    with h5py.File(source, "r") as handle:
        if "data" not in handle or "labels" not in handle:
            raise ValueError(f"{source} does not contain top-level data and labels datasets")
        data = handle["data"]
        labels = handle["labels"][:].reshape(-1)
        if data.ndim != 2 or data.shape[1] < 5:
            raise ValueError(f"unexpected PDW shape in {source}: {data.shape}")
        data_shape = data.shape
        toa = data[:, 0]
        frequency = data[:, 1]
        amplitude = data[:, 4]
        metadata = handle.get("metadata")
        metadata_attributes = dict(metadata.attrs) if metadata is not None else {}
    return {
        "path": str(source),
        "size_bytes": source.stat().st_size,
        "pulses": int(data_shape[0]),
        "features": int(data_shape[1]),
        "emitters": int(np.unique(labels).size),
        "toa_min_us": float(np.min(toa)) if len(toa) else None,
        "toa_max_us": float(np.max(toa)) if len(toa) else None,
        "duration_s": float((np.max(toa) - np.min(toa)) / 1e6) if len(toa) else 0.0,
        "frequency_min_mhz": float(np.min(frequency)) if len(frequency) else None,
        "frequency_max_mhz": float(np.max(frequency)) if len(frequency) else None,
        "amplitude_min_db": float(np.min(amplitude)) if len(amplitude) else None,
        "amplitude_max_db": float(np.max(amplitude)) if len(amplitude) else None,
        "metadata_attributes": {
            key: value.item() if isinstance(value, np.generic) else value
            for key, value in metadata_attributes.items()
        },
    }


def audit_manifest(
    manifest_path: str | Path,
    raw_dir: str | Path,
    output_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    manifest = load_manifest(manifest_path)
    root = Path(raw_dir)
    records: list[dict[str, Any]] = []
    for item in manifest["files"]:
        record = {**item, **audit_h5(root / remote_path(item))}
        records.append(record)
    if output_path is not None:
        target = Path(output_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(records, indent=2), encoding="utf-8")
    return records
