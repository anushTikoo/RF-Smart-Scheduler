from smart_scan.evaluation.fom import figures_of_merit
from smart_scan.evaluation.run import METRICS


def test_figures_of_merit_maps_named_metrics() -> None:
    scheduler = {metric: {"mean": 0.25} for metric in METRICS}
    scheduler.update({"scheduler": "example", "episode_count": 3})
    report = figures_of_merit({"summary": [scheduler]})
    row = report["figures_of_merit"][0]
    assert row["probability_of_detection"] == 0.25
    assert row["next_active_band_prediction_accuracy_percent"] == 25.0
    assert row["next_active_dwell_timing_mae_s"] == 0.25
    assert row["correct_scan_rate"] == 0.25
