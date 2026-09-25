from __future__ import annotations

from pathlib import Path

from smart_scan.evaluation.aggregate import aggregate_result_files, save_aggregate
from smart_scan.evaluation.fom import load_and_save_figures_of_merit
from smart_scan.evaluation.run import save_results

import json


def main() -> int:
    selected_paths: list[Path] = []
    for config_id in range(10):
        baseline_path = Path(f"outputs/scaled/validation/config_{config_id}.json")
        selected_path = Path(
            f"outputs/scaled/validation_selected/config_{config_id}.json"
        )
        linucb_path = Path(
            f"outputs/scaled/linucb_sweep/bonus_1p0/config_{config_id}.json"
        )
        baseline = json.loads(baseline_path.read_text(encoding="utf-8"))["runs"]
        linucb = json.loads(linucb_path.read_text(encoding="utf-8"))["runs"]
        rows = [row for row in baseline if row["scheduler"] != "linucb"] + linucb
        save_results(rows, selected_path)
        selected_paths.append(selected_path)

    aggregate = aggregate_result_files(selected_paths, bootstrap_samples=10_000, seed=42)
    aggregate_path = save_aggregate(
        aggregate, "outputs/scaled/validation_selected_aggregate.json"
    )
    load_and_save_figures_of_merit(
        aggregate_path, "outputs/scaled/validation_selected_figures_of_merit.json"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
