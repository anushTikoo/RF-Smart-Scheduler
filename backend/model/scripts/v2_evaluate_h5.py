from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from time import perf_counter

import h5py

from smart_scan.config import (
    context_config,
    load_config,
    preprocess_kwargs,
    receiver_config,
    reward_config,
)
from smart_scan.data.preprocess import preprocess_h5
from smart_scan.evaluation.run import run_episode
from smart_scan.schedulers.baselines import RoundRobinScheduler
from smart_scan.schedulers.linucb import LinUCBScheduler


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def timed_run(
    episode, scheduler, *, receiver, reward, context, seed: int
) -> dict[str, object]:
    start = perf_counter()
    metrics = run_episode(
        episode,
        scheduler,
        seed=seed,
        receiver=receiver,
        reward=reward,
        context=context,
    )
    wall_s = perf_counter() - start
    steps = episode.num_steps
    simulated_s = steps * episode.time_bin_s
    decision_total_s = float(metrics["scheduler_decision_mean_s"]) * steps
    return {
        **metrics,
        "decision_count": steps,
        "simulated_duration_s": simulated_s,
        "full_file_inference_wall_s": wall_s,
        "scheduler_decision_compute_total_s": decision_total_s,
        "wall_time_per_decision_s": wall_s / max(steps, 1),
        "real_time_factor": simulated_s / max(wall_s, 1e-12),
        "deadline_met_rate": 1.0 - float(metrics["scheduler_deadline_miss_rate"]),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Preprocess one HDF5 scenario and evaluate the frozen V2 model."
    )
    parser.add_argument("input_h5", type=Path)
    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=Path(
            "outputs/v2_production_200/frozen_model/smart_scan_linucb_v2_1_200.npz"
        ),
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(
            "outputs/v2_production_200/frozen_model/smart_scan_linucb_v2_1_200.yaml"
        ),
    )
    parser.add_argument(
        "--output", type=Path, default=Path("outputs/custom_tests/config_1")
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--no-round-robin", action="store_true")
    args = parser.parse_args()

    source = args.input_h5.resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    configuration = load_config(args.config)
    receiver = receiver_config(configuration)
    reward = reward_config(configuration)
    context = context_config(configuration)
    args.output.mkdir(parents=True, exist_ok=True)

    with h5py.File(source, "r") as handle:
        if "data" not in handle or "labels" not in handle:
            raise ValueError("custom HDF5 file must contain data and labels")
        input_pulses = int(handle["data"].shape[0])

    input_hash = sha256(source)
    checkpoint_hash_before = sha256(args.checkpoint)
    processed_path = args.output / "processed_episode.npz"
    preprocess_start = perf_counter()
    episode = preprocess_h5(
        source,
        processed_path,
        **preprocess_kwargs(configuration),
    )
    preprocessing_s = perf_counter() - preprocess_start

    load_start = perf_counter()
    scheduler = LinUCBScheduler.load(args.checkpoint, update_enabled=False)
    model_load_s = perf_counter() - load_start
    if scheduler.update_enabled:
        raise RuntimeError("custom evaluation requires frozen inference")

    linucb = timed_run(
        episode,
        scheduler,
        receiver=receiver,
        reward=reward,
        context=context,
        seed=args.seed,
    )
    runs: list[dict[str, object]] = [linucb]
    if not args.no_round_robin:
        runs.append(
            timed_run(
                episode,
                RoundRobinScheduler(),
                receiver=receiver,
                reward=reward,
                context=context,
                seed=args.seed,
            )
        )

    checkpoint_hash_after = sha256(args.checkpoint)
    if checkpoint_hash_before != checkpoint_hash_after:
        raise RuntimeError("frozen checkpoint changed during custom evaluation")

    report = {
        "schema_version": 1,
        "input_h5": str(source),
        "input_sha256": input_hash,
        "input_pulse_rows": input_pulses,
        "processed_episode": str(processed_path),
        "preprocessing_wall_s": preprocessing_s,
        "checkpoint": str(args.checkpoint),
        "checkpoint_sha256": checkpoint_hash_before,
        "checkpoint_unchanged": True,
        "online_updates_during_test": False,
        "model_load_wall_s": model_load_s,
        "num_bands": episode.num_bands,
        "dwell_s": episode.time_bin_s,
        "runs": runs,
    }
    report_path = args.output / "results.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)
    print(f"wrote {report_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
