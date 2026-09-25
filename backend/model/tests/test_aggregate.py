import json

import pytest

from smart_scan.evaluation.aggregate import aggregate_result_files
from smart_scan.evaluation.run import METRICS


def test_aggregate_reports_episode_bootstrap_intervals(tmp_path):
    paths = []
    for index, value in enumerate((0.2, 0.4)):
        row = {metric: value for metric in METRICS}
        row.update({"scheduler": "round_robin", "seed": 0})
        path = tmp_path / f"episode_{index}.json"
        path.write_text(json.dumps({"runs": [row]}), encoding="utf-8")
        paths.append(path)

    payload = aggregate_result_files(paths, bootstrap_samples=200, seed=7)
    summary = payload["summary"][0]
    metric = summary["emitter_event_interception_ratio"]

    assert summary["episode_count"] == 2
    assert metric["mean"] == pytest.approx(0.3)
    assert metric["median"] == pytest.approx(0.3)
    assert metric["ci95_low"] <= metric["mean"] <= metric["ci95_high"]
