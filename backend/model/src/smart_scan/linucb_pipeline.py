from __future__ import annotations

from copy import deepcopy
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import asdict
import csv
import hashlib
import json
from pathlib import Path
import shutil
from typing import Any, Callable, Iterable

import yaml
import numpy as np

from smart_scan.data.download import load_manifest
from smart_scan.data.episode import Episode
from smart_scan.env.scan_env import ReceiverConfig, RewardConfig
from smart_scan.evaluation.aggregate import aggregate_result_files, save_aggregate
from smart_scan.evaluation.fom import load_and_save_figures_of_merit
from smart_scan.evaluation.run import run_episode, save_results
from smart_scan.schedulers.baselines import RoundRobinScheduler
from smart_scan.schedulers.linucb import LinUCBScheduler


LINUCB_OPTION_KEYS = {
    "alpha",
    "regularization",
    "max_revisit_factor",
    "min_revisit_factor",
    "uncertainty_weight",
    "coverage_bonus_weight",
    "shared_model",
    "context_version",
    "predictor_enabled",
    "pulse_count_reference",
    "no_hit_reference",
}


def estimate_pulse_count_reference(
    episode_paths: Iterable[str | Path], *, quantile: float = 0.95
) -> float:
    """Fit the V2 log-count scale from positive training cells only."""

    if not 0 < quantile <= 1:
        raise ValueError("quantile must be in (0, 1]")
    values: list[np.ndarray] = []
    for raw_path in episode_paths:
        episode = Episode.load(raw_path)
        positive = episode.pulse_count[episode.pulse_count > 0]
        if len(positive):
            values.append(positive.astype(np.float32, copy=False))
    if not values:
        return 1.0
    return max(float(np.quantile(np.concatenate(values), quantile)), 1.0)


def _path_signature(paths: Iterable[Path]) -> str:
    payload = json.dumps([str(path) for path in paths], separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def validate_episode_geometry(
    episode_paths: Iterable[str | Path], configuration: dict[str, Any]
) -> dict[str, float | int]:
    paths = [Path(path) for path in episode_paths]
    if not paths:
        raise ValueError("at least one episode is required for geometry validation")
    receiver = configuration.get("receiver", {})
    first = Episode.load(paths[0])
    minimum = float(receiver.get("frequency_min_mhz", first.band_edges_mhz[0]))
    maximum = float(receiver.get("frequency_max_mhz", first.band_edges_mhz[-1]))
    dwell_s = float(receiver.get("dwell_ms", 5.0)) / 1000.0
    bandwidth = float(
        receiver.get(
            "bandwidth_mhz",
            (maximum - minimum) / first.num_bands,
        )
    )
    expected_bands = int(round((maximum - minimum) / bandwidth))
    for path in paths:
        episode = Episode.load(path)
        actual = (
            episode.num_bands,
            float(episode.band_edges_mhz[0]),
            float(episode.band_edges_mhz[-1]),
            float(episode.time_bin_s),
        )
        expected = (expected_bands, minimum, maximum, dwell_s)
        if not all(np.isclose(a, b) for a, b in zip(actual, expected, strict=True)):
            raise ValueError(
                f"processed episode geometry does not match configuration: {path}; "
                f"actual={actual}, expected={expected}"
            )
    return {
        "num_bands": expected_bands,
        "frequency_min_mhz": minimum,
        "frequency_max_mhz": maximum,
        "bandwidth_mhz": bandwidth,
        "dwell_s": dwell_s,
    }


def manifest_episode_paths(
    manifest_path: str | Path,
    processed_root: str | Path,
    split: str,
) -> list[Path]:
    """Resolve whole processed scenario files for one declared split."""

    manifest = load_manifest(manifest_path)
    paths: list[Path] = []
    for record in manifest["files"]:
        if str(record["split"]) != split:
            continue
        path = (
            Path(processed_root)
            / str(record["mode"])
            / split
            / f"config_{int(record['config_id'])}.npz"
        )
        if not path.is_file():
            raise FileNotFoundError(f"processed episode is missing: {path}")
        paths.append(path)
    if not paths:
        raise ValueError(f"manifest contains no {split!r} scenarios: {manifest_path}")
    if len(paths) != len(set(paths)):
        raise ValueError(f"manifest contains duplicate {split!r} scenarios")
    return paths


def _model_options(candidate: dict[str, Any]) -> dict[str, Any]:
    unknown = sorted(set(candidate) - LINUCB_OPTION_KEYS - {"name"})
    if unknown:
        raise ValueError(f"unknown LinUCB candidate options: {unknown}")
    return {key: candidate[key] for key in LINUCB_OPTION_KEYS if key in candidate}


def train_linucb(
    episode_paths: Iterable[str | Path],
    *,
    output_path: str | Path,
    receiver: ReceiverConfig,
    reward: RewardConfig,
    linucb_options: dict[str, Any],
    epochs: int = 1,
    seed: int = 42,
    progress: Callable[[str], None] | None = None,
    resume: bool = True,
) -> LinUCBScheduler:
    """Train one persistent LinUCB model across all supplied scenarios."""

    paths = [Path(path) for path in episode_paths]
    if not paths:
        raise ValueError("at least one LinUCB training episode is required")
    if epochs < 1:
        raise ValueError("epochs must be positive")
    checkpoint = Path(output_path)
    history_json_path = checkpoint.with_name(
        f"{checkpoint.stem}_training_history.json"
    )
    history_csv_path = checkpoint.with_name(
        f"{checkpoint.stem}_training_history.csv"
    )
    metadata_path = checkpoint.with_suffix(".json")
    signature = {
        "episode_paths": [str(path) for path in paths],
        "epochs": epochs,
        "seed": seed,
        "receiver": asdict(receiver),
        "reward": asdict(reward),
        "linucb_options": linucb_options,
        "episode_path_sha256": _path_signature(paths),
    }
    resumable = (
        resume
        and checkpoint.is_file()
        and metadata_path.is_file()
        and history_json_path.is_file()
    )
    if resumable:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        mismatches = [
            key for key, value in signature.items() if metadata.get(key) != value
        ]
        if mismatches:
            raise ValueError(
                "cannot resume LinUCB training because these settings changed: "
                + ", ".join(mismatches)
                + "; choose a new output directory or pass resume=False"
            )
        raw_history = json.loads(history_json_path.read_text(encoding="utf-8"))
        if not isinstance(raw_history, list):
            raise ValueError(f"invalid training history: {history_json_path}")
        training_rows = [dict(row) for row in raw_history]
        scheduler = LinUCBScheduler.load(checkpoint, update_enabled=True)
        scheduler.preserve_model_across_episodes = True
        if len(training_rows) > epochs * len(paths):
            raise ValueError("resume history contains more runs than requested")
        if training_rows and int(training_rows[-1]["cumulative_updates"]) != scheduler.num_updates:
            raise ValueError("checkpoint and resume history have different update counts")
        if progress is not None:
            progress(
                f"resuming {checkpoint.name} after "
                f"{len(training_rows)}/{epochs * len(paths)} scenarios"
            )
    else:
        if resume and any(
            path.exists() for path in (checkpoint, metadata_path, history_json_path)
        ):
            raise ValueError(
                "incomplete LinUCB resume artifacts found; choose a new output "
                "directory or pass resume=False"
            )
        scheduler = LinUCBScheduler(
            **linucb_options,
            preserve_model_across_episodes=True,
            update_enabled=True,
        )
        training_rows: list[dict[str, float | str | int]] = []

    scheduler.artifact_metadata = signature

    completed_runs = len(training_rows)
    for epoch in range(epochs):
        for index, path in enumerate(paths):
            run_number = epoch * len(paths) + index
            if run_number < completed_runs:
                continue
            if progress is not None:
                progress(
                    f"training epoch {epoch + 1}/{epochs}, "
                    f"scenario {index + 1}/{len(paths)}: {path.name}"
                )
            episode = Episode.load(path)
            run_seed = seed + epoch * len(paths) + index
            error_sum_before = scheduler.reward_prediction_squared_error_sum
            prediction_count_before = scheduler.reward_prediction_count
            row = run_episode(
                episode,
                scheduler,
                seed=run_seed,
                receiver=receiver,
                reward=reward,
            )
            row["epoch"] = epoch
            row["episode"] = str(path)
            prediction_count = (
                scheduler.reward_prediction_count - prediction_count_before
            )
            squared_error = (
                scheduler.reward_prediction_squared_error_sum - error_sum_before
            )
            row["reward_prediction_mse"] = squared_error / max(prediction_count, 1)
            recent = training_rows[-4:] + [row]
            row["rolling_5_average_reward"] = sum(
                float(item["average_reward"]) for item in recent
            ) / len(recent)
            row["rolling_5_reward_prediction_mse"] = sum(
                float(item["reward_prediction_mse"]) for item in recent
            ) / len(recent)
            row["cumulative_updates"] = scheduler.num_updates
            training_rows.append(row)
            if progress is not None:
                progress(
                    f"completed {path.name}: average_reward={float(row['average_reward']):.6f}, "
                    f"reward_prediction_mse={float(row['reward_prediction_mse']):.6f}, "
                    f"rolling_5_reward={float(row['rolling_5_average_reward']):.6f}, "
                    f"rolling_5_mse={float(row['rolling_5_reward_prediction_mse']):.6f}"
                )
            _save_training_progress(
                scheduler,
                checkpoint=checkpoint,
                training_rows=training_rows,
                history_json_path=history_json_path,
                history_csv_path=history_csv_path,
                signature=signature,
                complete=len(training_rows) == epochs * len(paths),
            )
    # Also refresh metadata when a fully completed run is resumed under a
    # compatible newer artifact schema.
    if training_rows:
        _save_training_progress(
            scheduler,
            checkpoint=checkpoint,
            training_rows=training_rows,
            history_json_path=history_json_path,
            history_csv_path=history_csv_path,
            signature=signature,
            complete=len(training_rows) == epochs * len(paths),
        )
    return scheduler


TRAINING_HISTORY_FIELDS = [
    "epoch",
    "episode",
    "average_reward",
    "reward_prediction_mse",
    "rolling_5_average_reward",
    "rolling_5_reward_prediction_mse",
    "cumulative_updates",
    "pulse_interception_ratio",
    "emitter_event_interception_ratio",
    "unique_emitter_coverage",
    "average_first_intercept_delay_s",
    "miss_rate",
]


def _save_training_progress(
    scheduler: LinUCBScheduler,
    *,
    checkpoint: Path,
    training_rows: list[dict[str, float | str | int]],
    history_json_path: Path,
    history_csv_path: Path,
    signature: dict[str, Any],
    complete: bool,
) -> None:
    """Persist a resumable checkpoint after every completed scenario."""

    scheduler.save(checkpoint)
    history_json_path.write_text(
        json.dumps(training_rows, indent=2), encoding="utf-8"
    )
    with history_csv_path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=TRAINING_HISTORY_FIELDS)
        writer.writeheader()
        for row in training_rows:
            writer.writerow(
                {field: row[field] for field in TRAINING_HISTORY_FIELDS}
            )
    metadata = {
        "checkpoint": str(checkpoint),
        **signature,
        "status": "complete" if complete else "in_progress",
        "num_updates": scheduler.num_updates,
        "training_runs": len(training_rows),
        "training_history_json": str(history_json_path),
        "training_history_csv": str(history_csv_path),
        "final_reward_prediction_mse": scheduler.reward_prediction_mse,
        "final_training_run": training_rows[-1],
    }
    checkpoint.with_suffix(".json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )


def evaluate_frozen_linucb(
    checkpoint_path: str | Path,
    episode_paths: Iterable[str | Path],
    *,
    output_dir: str | Path,
    receiver: ReceiverConfig,
    reward: RewardConfig,
    seed: int = 42,
    bootstrap_samples: int = 2000,
    progress: Callable[[str], None] | None = None,
    band_log_interval: int = 0,
    include_round_robin: bool = True,
    write_traces: bool = True,
) -> dict[str, object]:
    """Evaluate a frozen checkpoint and round-robin on independent scenarios."""

    paths = [Path(path) for path in episode_paths]
    if not paths:
        raise ValueError("at least one evaluation episode is required")
    output = Path(output_dir)
    result_paths: list[Path] = []
    scheduler = LinUCBScheduler.load(checkpoint_path, update_enabled=False)
    before_updates = scheduler.num_updates
    for index, path in enumerate(paths):
        if progress is not None:
            progress(f"evaluating scenario {index + 1}/{len(paths)}: {path.name}")
        episode = Episode.load(path)
        run_seed = seed + index

        def log_linucb_action(
            record: dict[str, float | int | str | bool],
            *,
            scenario: str = path.name,
        ) -> None:
            if (
                progress is not None
                and band_log_interval > 0
                and int(record["step"]) % band_log_interval == 0
            ):
                progress(
                    f"inference {scenario}: step={record['step']}, "
                    f"time={float(record['time_start_s']):.6f}s, "
                    f"band={record['band_index']}, "
                    f"range={float(record['frequency_low_mhz']):.1f}-"
                    f"{float(record['frequency_high_mhz']):.1f}MHz, "
                    f"pulses={record['detected_pulses']}, "
                    f"reward={float(record['reward']):.6f}"
                )

        rows: list[dict[str, float | str | int]] = []
        if include_round_robin:
            rows.append(run_episode(
                episode,
                RoundRobinScheduler(),
                seed=run_seed,
                receiver=receiver,
                reward=reward,
                context=type(scheduler.context_config)(
                    version=scheduler.context_config.version,
                    predictor_enabled=False,
                    pulse_count_reference=scheduler.context_config.pulse_count_reference,
                    no_hit_reference=scheduler.context_config.no_hit_reference,
                ),
                trace_path=(
                    output / "traces" / f"{path.stem}_round_robin.csv"
                    if write_traces
                    else None
                ),
            ))
        rows.append(run_episode(
                episode,
                scheduler,
                seed=run_seed,
                receiver=receiver,
            reward=reward,
            context=scheduler.context_config,
                trace_path=(
                    output / "traces" / f"{path.stem}_linucb.csv"
                    if write_traces
                    else None
                ),
                action_callback=(
                    log_linucb_action if band_log_interval > 0 else None
                ),
            ))
        if progress is not None and write_traces:
            progress(
                f"wrote band traces for {path.name} under {output / 'traces'}"
            )
        result_path = output / "episodes" / f"{path.stem}.json"
        save_results(rows, result_path)
        result_paths.append(result_path)
    if scheduler.num_updates != before_updates:
        raise RuntimeError("frozen LinUCB checkpoint changed during evaluation")
    aggregate = aggregate_result_files(
        result_paths, bootstrap_samples=bootstrap_samples, seed=seed
    )
    aggregate_path = save_aggregate(aggregate, output / "aggregate.json")
    load_and_save_figures_of_merit(
        aggregate_path, output / "figures_of_merit.json"
    )
    return aggregate


def _run_candidate(
    candidate_index: int,
    candidate: dict[str, Any],
    *,
    train: list[Path],
    validation: list[Path],
    output: Path,
    receiver: ReceiverConfig,
    reward: RewardConfig,
    epochs: int,
    seed: int,
    bootstrap_samples: int,
    progress: Callable[[str], None] | None,
    resume: bool,
) -> tuple[int, dict[str, Any]]:
    name = str(candidate.get("name", f"candidate_{candidate_index}"))
    if not name.replace("_", "").replace("-", "").isalnum():
        raise ValueError(f"candidate name must be filesystem-safe: {name!r}")
    options = _model_options(candidate)
    candidate_dir = output / "candidates" / name
    checkpoint = candidate_dir / "linucb.npz"
    train_linucb(
        train,
        output_path=checkpoint,
        receiver=receiver,
        reward=reward,
        linucb_options=options,
        epochs=epochs,
        seed=seed,
        progress=progress,
        resume=resume,
    )
    # Candidate selection needs only frozen LinUCB metrics. Round-robin and
    # detailed traces are produced once for the selected checkpoint below.
    aggregate = evaluate_frozen_linucb(
        checkpoint,
        validation,
        output_dir=candidate_dir / "validation",
        receiver=receiver,
        reward=reward,
        seed=seed,
        bootstrap_samples=bootstrap_samples,
        progress=progress,
        include_round_robin=False,
        write_traces=False,
    )
    linucb = next(
        row for row in aggregate["summary"] if row["scheduler"] == "linucb"  # type: ignore[index]
    )
    reward_by_episode: list[float] = []
    for result_path in aggregate["episode_result_files"]:  # type: ignore[index]
        payload = json.loads(Path(str(result_path)).read_text(encoding="utf-8"))
        row = next(item for item in payload["runs"] if item["scheduler"] == "linucb")
        reward_by_episode.append(float(row["average_reward"]))
    return candidate_index, {
        "name": name,
        "options": options,
        "checkpoint": str(checkpoint),
        "validation_average_reward": float(linucb["average_reward"]["mean"]),  # type: ignore[index]
        "validation_pulse_interception_ratio": float(
            linucb["pulse_interception_ratio"]["mean"]  # type: ignore[index]
        ),
        "validation_first_intercept_delay_s": float(
            linucb["average_first_intercept_delay_s"]["mean"]  # type: ignore[index]
        ),
        "validation_unique_emitter_coverage": float(
            linucb["unique_emitter_coverage"]["mean"]  # type: ignore[index]
        ),
        "validation_scheduler_decision_p99_s": float(
            linucb["scheduler_decision_p99_s"]["mean"]  # type: ignore[index]
        ),
        "validation_reward_by_episode": reward_by_episode,
    }


def _candidate_worker(payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    """Process-pool entry point; candidates are independent experiments."""

    name = str(payload["candidate"].get("name", payload["candidate_index"]))

    def worker_progress(message: str) -> None:
        print(f"[{name}] {message}", flush=True)

    return _run_candidate(progress=worker_progress, **payload)


def train_validate_select(
    train_paths: Iterable[str | Path],
    validation_paths: Iterable[str | Path],
    candidates: list[dict[str, Any]],
    *,
    output_dir: str | Path,
    configuration: dict[str, Any],
    receiver: ReceiverConfig,
    reward: RewardConfig,
    epochs: int = 1,
    seed: int = 42,
    bootstrap_samples: int = 2000,
    progress: Callable[[str], None] | None = None,
    jobs: int = 1,
    resume: bool = True,
) -> dict[str, Any]:
    """Train each candidate on train only and select it using validation only."""

    train = [Path(path) for path in train_paths]
    validation = [Path(path) for path in validation_paths]
    candidates = deepcopy(candidates)
    configuration = deepcopy(configuration)
    if not candidates:
        raise ValueError("at least one LinUCB candidate is required")
    if jobs < 1:
        raise ValueError("jobs must be positive")
    geometry = validate_episode_geometry([*train, *validation], configuration)
    base_context = dict(configuration.get("context", {}))
    context_version = str(base_context.get("version", "v1"))
    if context_version == "v2":
        configured_reference = base_context.get("pulse_count_reference", "train_p95")
        pulse_reference = (
            estimate_pulse_count_reference(train)
            if configured_reference in {None, "train_p95"}
            else float(configured_reference)
        )
        base_context["pulse_count_reference"] = pulse_reference
        base_context.setdefault("no_hit_reference", 5.0)
        configuration["context"] = base_context
        for candidate in candidates:
            candidate.setdefault("context_version", "v2")
            candidate.setdefault("predictor_enabled", bool(base_context.get("predictor_enabled", True)))
            candidate.setdefault("pulse_count_reference", pulse_reference)
            candidate.setdefault("no_hit_reference", float(base_context["no_hit_reference"]))

    names = [
        str(candidate.get("name", f"candidate_{index}"))
        for index, candidate in enumerate(candidates)
    ]
    if len(names) != len(set(names)):
        raise ValueError("candidate names must be unique")
    output = Path(output_dir)
    worker_count = min(jobs, len(candidates))
    indexed_records: list[tuple[int, dict[str, Any]]] = []
    common = {
        "train": train,
        "validation": validation,
        "output": output,
        "receiver": receiver,
        "reward": reward,
        "epochs": epochs,
        "seed": seed,
        "bootstrap_samples": bootstrap_samples,
        "resume": resume,
    }
    if worker_count == 1:
        for index, candidate in enumerate(candidates):
            if progress is not None:
                progress(f"candidate {index + 1}/{len(candidates)}: {names[index]}")
            indexed_records.append(
                _run_candidate(
                    index,
                    candidate,
                    progress=progress,
                    **common,
                )
            )
    else:
        if progress is not None:
            progress(
                f"training {len(candidates)} candidates with "
                f"{worker_count} parallel workers"
            )
        with ProcessPoolExecutor(max_workers=worker_count) as executor:
            futures = [
                executor.submit(
                    _candidate_worker,
                    {
                        "candidate_index": index,
                        "candidate": candidate,
                        **common,
                    },
                )
                for index, candidate in enumerate(candidates)
            ]
            for future in as_completed(futures):
                result = future.result()
                indexed_records.append(result)
                if progress is not None:
                    progress(f"candidate complete: {result[1]['name']}")
    records = [record for _, record in sorted(indexed_records)]

    # Parallel worker contention distorts wall-clock percentiles. Re-measure one
    # identical validation scenario per frozen candidate serially for the
    # real-time gate, while retaining the all-scenario timing in the report.
    timing_episode = Episode.load(validation[0])
    for record in records:
        timing_scheduler = LinUCBScheduler.load(
            record["checkpoint"], update_enabled=False
        )
        timing_row = run_episode(
            timing_episode,
            timing_scheduler,
            seed=seed,
            receiver=receiver,
            reward=reward,
            context=timing_scheduler.context_config,
        )
        record["serial_timing_episode"] = str(validation[0])
        record["serial_scheduler_decision_mean_s"] = float(
            timing_row["scheduler_decision_mean_s"]
        )
        record["serial_scheduler_decision_p99_s"] = float(
            timing_row["scheduler_decision_p99_s"]
        )
        record["serial_scheduler_deadline_miss_rate"] = float(
            timing_row["scheduler_deadline_miss_rate"]
        )

    # V2 retains the predictor only when it adds material paired validation
    # value without sacrificing interception, coverage, or the dwell deadline.
    core_records = [row for row in records if not row["options"].get("predictor_enabled", True)]
    selection_diagnostics: dict[str, Any] = {}
    if context_version == "v2" and core_records:
        core = max(core_records, key=lambda row: row["validation_average_reward"])
        predictive = [row for row in records if row["options"].get("predictor_enabled", True)]
        dwell_s = float(configuration["receiver"]["dwell_ms"]) / 1000.0
        qualifying: list[dict[str, Any]] = []
        comparisons: list[dict[str, Any]] = []
        core_rewards = list(core["validation_reward_by_episode"])
        required_wins = max(int(np.ceil(0.6 * len(core_rewards))), 1)
        for row in predictive:
            wins = sum(
                candidate_reward > core_reward
                for candidate_reward, core_reward in zip(
                    row["validation_reward_by_episode"], core_rewards, strict=True
                )
            )
            improvement = (
                row["validation_average_reward"] - core["validation_average_reward"]
            )
            checks = {
                "reward_improvement_at_least_0p01": improvement >= 0.01,
                "paired_episode_wins": wins >= required_wins,
                "pulse_interception_drop_at_most_0p01": row[
                    "validation_pulse_interception_ratio"
                ] >= core["validation_pulse_interception_ratio"] - 0.01,
                "coverage_drop_at_most_0p02": row[
                    "validation_unique_emitter_coverage"
                ] >= core["validation_unique_emitter_coverage"] - 0.02,
                "decision_p99_within_dwell": row[
                    "serial_scheduler_decision_p99_s"
                ] <= dwell_s,
            }
            comparison = {
                "candidate": row["name"],
                "core": core["name"],
                "reward_improvement": improvement,
                "paired_wins": wins,
                "required_wins": required_wins,
                "checks": checks,
                "qualified": all(checks.values()),
            }
            comparisons.append(comparison)
            if comparison["qualified"]:
                qualifying.append(row)
        if qualifying:
            reward_best = max(
                qualifying, key=lambda row: row["validation_average_reward"]
            )
            close_lower_alpha = [
                row
                for row in qualifying
                if reward_best["validation_average_reward"]
                - row["validation_average_reward"]
                < 0.01
            ]
            best = min(close_lower_alpha, key=lambda row: float(row["options"]["alpha"]))
        else:
            best = core
        selection_diagnostics = {
            "core_candidate": core["name"],
            "predictor_gate": comparisons,
            "predictor_retained": bool(best["options"].get("predictor_enabled", True)),
        }
    else:
        best = max(
            records,
            key=lambda row: (
                row["validation_average_reward"],
                row["validation_pulse_interception_ratio"],
                -row["validation_first_intercept_delay_s"],
            ),
        )
    frozen_checkpoint = output / "frozen_linucb.npz"
    shutil.copy2(best["checkpoint"], frozen_checkpoint)
    source_metadata = Path(best["checkpoint"]).with_suffix(".json")
    shutil.copy2(source_metadata, frozen_checkpoint.with_suffix(".json"))
    selected_checkpoint = Path(best["checkpoint"])
    frozen_history_json = output / "frozen_training_history.json"
    frozen_history_csv = output / "frozen_training_history.csv"
    shutil.copy2(
        selected_checkpoint.with_name(
            f"{selected_checkpoint.stem}_training_history.json"
        ),
        frozen_history_json,
    )
    shutil.copy2(
        selected_checkpoint.with_name(
            f"{selected_checkpoint.stem}_training_history.csv"
        ),
        frozen_history_csv,
    )

    frozen_configuration = deepcopy(configuration)
    frozen_configuration["linucb"] = dict(best["options"])
    frozen_configuration["linucb"]["checkpoint"] = str(frozen_checkpoint)
    if context_version == "v2":
        frozen_configuration["context"] = {
            "version": "v2",
            "predictor_enabled": bool(best["options"]["predictor_enabled"]),
            "pulse_count_reference": float(best["options"]["pulse_count_reference"]),
            "no_hit_reference": float(best["options"]["no_hit_reference"]),
        }
    frozen_config_path = output / "frozen_config.yaml"
    frozen_config_path.parent.mkdir(parents=True, exist_ok=True)
    frozen_config_path.write_text(
        yaml.safe_dump(frozen_configuration, sort_keys=False), encoding="utf-8"
    )
    selected_validation_dir = output / "selected_validation"
    if progress is not None:
        progress(
            "running one full validation comparison and band trace for selected "
            f"candidate: {best['name']}"
        )
    evaluate_frozen_linucb(
        frozen_checkpoint,
        validation,
        output_dir=selected_validation_dir,
        receiver=receiver,
        reward=reward,
        seed=seed,
        bootstrap_samples=bootstrap_samples,
        progress=progress,
        include_round_robin=True,
        write_traces=True,
    )
    selection = {
        "selection_rule": (
            "V2 predictor gate: reward improvement >=0.01, wins >=60% of paired "
            "validation scenarios, pulse drop <=0.01, coverage drop <=0.02, and "
            "decision p99 <= dwell; otherwise select core. Within 0.01 reward, "
            "prefer lower alpha. V1 uses reward with interception/delay tie-breaks."
        ),
        "train_episode_count": len(train),
        "validation_episode_count": len(validation),
        "epochs": epochs,
        "seed": seed,
        "parallel_jobs": worker_count,
        "resume_enabled": resume,
        "candidates": records,
        "selected": best,
        "frozen_checkpoint": str(frozen_checkpoint),
        "frozen_config": str(frozen_config_path),
        "frozen_training_history_json": str(frozen_history_json),
        "frozen_training_history_csv": str(frozen_history_csv),
        "selected_validation_directory": str(selected_validation_dir),
        "test_data_accessed": False,
        "training_episode_path_sha256": _path_signature(train),
        "validation_episode_path_sha256": _path_signature(validation),
        "context": base_context,
        "selection_diagnostics": selection_diagnostics,
        "episode_geometry": geometry,
    }
    (output / "selection.json").write_text(
        json.dumps(selection, indent=2), encoding="utf-8"
    )
    return selection
