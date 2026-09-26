from __future__ import annotations

import argparse
import json
from pathlib import Path

import h5py
import numpy as np


def quantiles(values: np.ndarray) -> dict[str, float]:
    return {
        str(q): float(np.percentile(values, q))
        for q in (1, 5, 10, 25, 50, 75, 90, 95, 99, 99.9)
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Training-only dwell-resolution analysis; never reads validation/test."
    )
    parser.add_argument(
        "--raw-train", type=Path, default=Path("data/raw/stare/train_stare")
    )
    parser.add_argument("--files", type=int, default=30)
    parser.add_argument(
        "--output", type=Path, default=Path("outputs/v2_dwell_analysis.json")
    )
    args = parser.parse_args()
    dwell_us = (100, 250, 500, 1000, 2000, 5000)
    occupancy = {
        str(dwell): {
            "steps": 0,
            "active_cells": 0,
            "active_times": 0,
            "pulses": 0,
        }
        for dwell in dwell_us
    }
    pulse_widths: list[np.ndarray] = []
    emitter_intervals: list[np.ndarray] = []
    for file_id in range(args.files):
        path = args.raw_train / f"config_{file_id}.h5"
        with h5py.File(path, "r") as handle:
            data = handle["data"][:]
            labels = handle["labels"][:].reshape(-1)
        toa = data[:, 0].astype(np.float64)
        frequency = data[:, 1].astype(np.float64)
        width = data[:, 2].astype(np.float64)
        valid = (
            np.isfinite(toa)
            & np.isfinite(frequency)
            & np.isfinite(width)
            & (frequency >= 500.0)
            & (frequency < 18_000.0)
        )
        toa, frequency, width, labels = (
            toa[valid], frequency[valid], width[valid], labels[valid]
        )
        pulse_widths.append(width)
        for emitter in np.unique(labels):
            times = np.sort(toa[labels == emitter])
            intervals = np.diff(times)
            positive = intervals[intervals > 0]
            if len(positive):
                emitter_intervals.append(positive)
        start = float(toa.min())
        band = np.floor((frequency - 500.0) / 875.0).astype(np.int64)
        for dwell in dwell_us:
            time_index = np.floor((toa - start) / dwell).astype(np.int64)
            steps = int(time_index.max()) + 1
            record = occupancy[str(dwell)]
            record["steps"] += steps
            record["active_cells"] += len(np.unique(time_index * 20 + band))
            record["active_times"] += len(np.unique(time_index))
            record["pulses"] += len(toa)
    for dwell, record in occupancy.items():
        total_cells = record["steps"] * 20
        record["active_band_cell_percent"] = 100 * record["active_cells"] / total_cells
        record["globally_active_step_percent"] = 100 * record["active_times"] / record["steps"]
        record["mean_pulses_per_active_cell"] = record["pulses"] / record["active_cells"]
        record["round_robin_sweep_ms"] = 20 * int(dwell) / 1000.0
    payload = {
        "scope": "training files only",
        "training_files": args.files,
        "scheduler_inputs_include_emitter_labels": False,
        "note": "Labels are used only here to describe training-set inter-arrival statistics; they are not model features.",
        "pulse_width_us_quantiles": quantiles(np.concatenate(pulse_widths)),
        "per_emitter_interarrival_us_quantiles": quantiles(
            np.concatenate(emitter_intervals)
        ),
        "candidate_dwell_statistics": occupancy,
        "recommended_target_dwell_us": 500,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
