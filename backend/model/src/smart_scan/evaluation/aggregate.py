from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from smart_scan.evaluation.run import METRICS


def aggregate_result_files(
    paths: list[str | Path],
    *,
    bootstrap_samples: int = 2000,
    seed: int = 42,
) -> dict[str, object]:
    """Aggregate one benchmark result file per independent episode."""
    if not paths:
        raise ValueError("at least one result file is required")
    if bootstrap_samples < 1:
        raise ValueError("bootstrap_samples must be positive")

    by_scheduler: dict[str, list[dict[str, object]]] = {}
    for raw_path in paths:
        path = Path(raw_path)
        payload = json.loads(path.read_text(encoding="utf-8"))
        for row in payload["runs"]:
            item = dict(row)
            item["episode_result_file"] = str(path)
            by_scheduler.setdefault(str(row["scheduler"]), []).append(item)

    rng = np.random.default_rng(seed)
    summaries: list[dict[str, object]] = []
    for scheduler, rows in sorted(by_scheduler.items()):
        result: dict[str, object] = {
            "scheduler": scheduler,
            "episode_count": len(rows),
        }
        for metric in METRICS:
            values = np.asarray([float(row[metric]) for row in rows], dtype=np.float64)
            draws = rng.choice(values, size=(bootstrap_samples, len(values)), replace=True).mean(axis=1)
            result[metric] = {
                "mean": float(values.mean()),
                "median": float(np.median(values)),
                "ci95_low": float(np.quantile(draws, 0.025)),
                "ci95_high": float(np.quantile(draws, 0.975)),
            }
        summaries.append(result)
    return {
        "episode_result_files": [str(Path(path)) for path in paths],
        "bootstrap_samples": bootstrap_samples,
        "bootstrap_seed": seed,
        "summary": summaries,
    }


def save_aggregate(payload: dict[str, object], output: str | Path) -> Path:
    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return target
