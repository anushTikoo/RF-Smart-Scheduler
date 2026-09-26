from __future__ import annotations

import json
from pathlib import Path


def figures_of_merit(aggregate: dict[str, object]) -> dict[str, object]:
    """Map aggregate scheduler metrics to the project's named figures of merit."""

    rows: list[dict[str, object]] = []
    for raw in aggregate["summary"]:  # type: ignore[index]
        scheduler = raw  # type: ignore[assignment]

        def mean(metric: str) -> float:
            return float(scheduler[metric]["mean"])  # type: ignore[index]

        rows.append(
            {
                "scheduler": scheduler["scheduler"],  # type: ignore[index]
                "episode_count": int(scheduler["episode_count"]),  # type: ignore[index]
                "probability_of_detection": mean("measured_detection_probability"),
                "probability_of_false_alarm": mean("false_alarm_rate"),
                "sensitivity_threshold_db": mean("sensitivity_threshold_db"),
                "average_intercept_rate_per_s": mean("intercept_rate_per_s"),
                "average_reward": mean("average_reward"),
                "average_reward_per_s": mean("average_reward_per_s"),
                "pulse_interception_ratio": mean("pulse_interception_ratio"),
                "emitter_event_interception_ratio": mean(
                    "emitter_event_interception_ratio"
                ),
                "correct_scan_rate": mean("correct_scan_rate"),
                "missed_opportunity_rate": mean("missed_opportunity_rate"),
                "detector_false_negative_rate": mean(
                    "detector_false_negative_rate"
                ),
                "average_first_intercept_delay_s": mean(
                    "average_first_intercept_delay_s"
                ),
                "unique_emitter_coverage": mean("unique_emitter_coverage"),
                "mean_revisit_interval_s": mean("mean_revisit_interval_s"),
                "next_active_band_prediction_accuracy_percent": 100.0
                * mean("next_active_band_accuracy"),
                "next_active_dwell_timing_mae_s": mean(
                    "next_active_dwell_timing_mae_s"
                ),
                "prediction_coverage": mean("next_active_prediction_coverage"),
                "scheduler_decision_p99_s": mean("scheduler_decision_p99_s"),
                "scheduler_deadline_miss_rate": mean(
                    "scheduler_deadline_miss_rate"
                ),
            }
        )
    return {
        "notes": {
            "probability_of_detection": "Measured against simulator-eligible selected pulses.",
            "probability_of_false_alarm": "Measured against selected empty dwells.",
            "sensitivity": "Configured PDW amplitude threshold, not measured RF hardware sensitivity.",
            "correct_scan_rate": "Fraction of globally active dwells in which the selected band contained an eligible emission.",
            "missed_opportunity": "Activity existed somewhere in the spectrum but the action produced no interception; this is not a false alarm.",
            "prediction_accuracy": "Conditional next-active-band accuracy from causal selected-band observations. Oracle accuracy is debug-only and omitted here.",
            "intercept_time_error": "Conditional next-active-dwell timing MAE from selected-band observation history.",
        },
        "figures_of_merit": rows,
    }


def load_and_save_figures_of_merit(
    aggregate_path: str | Path, output_path: str | Path
) -> Path:
    source = Path(aggregate_path)
    payload = json.loads(source.read_text(encoding="utf-8"))
    report = figures_of_merit(payload)
    target = Path(output_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return target
