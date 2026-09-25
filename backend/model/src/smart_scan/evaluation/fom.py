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
                "oracle_band_prediction_accuracy_percent": 100.0
                * mean("oracle_band_accuracy"),
                "next_pulse_band_prediction_accuracy_percent": 100.0
                * mean("next_pulse_band_accuracy"),
                "average_intercept_time_error_s": mean(
                    "intercept_time_prediction_mae_s"
                ),
            }
        )
    return {
        "notes": {
            "probability_of_detection": "Measured against simulator-eligible selected pulses.",
            "probability_of_false_alarm": "Measured against selected empty dwells.",
            "sensitivity": "Configured PDW amplitude threshold, not measured RF hardware sensitivity.",
            "prediction_accuracy": "Oracle-best-band accuracy and conditional next-pulse-band accuracy are reported separately.",
            "intercept_time_error": "Conditional next-pulse time MAE from observed emitter histories.",
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
