from __future__ import annotations

import argparse
import json
from pathlib import Path

from smart_scan.config import load_config, preprocess_kwargs
from smart_scan.data.download import load_manifest
from smart_scan.data.preprocess import preprocess_manifest


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Preprocess whole V2 scenarios into 20 bands and 500 us dwells."
    )
    parser.add_argument(
        "--manifest", type=Path, default=Path("data/manifests/scaled_train_val.json")
    )
    parser.add_argument("--raw", type=Path, default=Path("data/raw"))
    parser.add_argument(
        "--output", type=Path, default=Path("data/processed_v2_20bands_500us")
    )
    parser.add_argument(
        "--config", type=Path, default=Path("configs/v2_20bands_500us.yaml")
    )
    args = parser.parse_args()

    configuration = load_config(args.config)
    options = preprocess_kwargs(configuration)
    span = options["frequency_max_mhz"] - options["frequency_min_mhz"]
    bands = round(span / options["bandwidth_mhz"])
    if bands != 20 or options["dwell_ms"] != 0.5:
        raise ValueError("V2 requires exactly 20 bands and a 0.5 ms dwell")
    outputs = preprocess_manifest(args.manifest, args.raw, args.output, **options)
    receipt = {
        "schema_version": 2,
        "manifest": str(args.manifest),
        "config": str(args.config),
        "source_files": len(load_manifest(args.manifest)["files"]),
        "processed_files": len(outputs),
        "num_bands": bands,
        "dwell_us": options["dwell_ms"] * 1000.0,
        "round_robin_sweep_ms": bands * options["dwell_ms"],
        "outputs": [str(path) for path in outputs],
    }
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "preprocessing_receipt.json").write_text(
        json.dumps(receipt, indent=2), encoding="utf-8"
    )
    print(json.dumps(receipt, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

