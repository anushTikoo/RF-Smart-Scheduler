from __future__ import annotations

import argparse
import json
from pathlib import Path

from smart_scan.config import (
    DEFAULT_CONFIG_PATH,
    dqn_kwargs,
    linucb_kwargs,
    load_config,
    preprocess_kwargs,
    receiver_config,
    reward_config,
)
from smart_scan.data.audit import audit_manifest
from smart_scan.data.download import download_manifest
from smart_scan.data.episode import Episode
from smart_scan.data.preprocess import preprocess_manifest
from smart_scan.data.synthetic import make_synthetic_episode
from smart_scan.data.split_integrity import validate_split_manifests
from smart_scan.evaluation.aggregate import aggregate_result_files, save_aggregate
from smart_scan.evaluation.fom import load_and_save_figures_of_merit
from smart_scan.evaluation.run import benchmark, save_results, scheduler_factories, summarize
from smart_scan.training import train_dqn


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="smart-scan")
    commands = parser.add_subparsers(dest="command", required=True)

    synthetic = commands.add_parser("synthetic", help="create a deterministic synthetic episode")
    synthetic.add_argument("--output", type=Path, required=True)
    synthetic.add_argument("--steps", type=int, default=600)
    synthetic.add_argument("--bands", type=int, default=12)
    synthetic.add_argument("--emitters", type=int, default=8)
    synthetic.add_argument("--seed", type=int, default=42)

    download = commands.add_parser("download", help="download only files named in a manifest")
    download.add_argument("--manifest", type=Path, required=True)
    download.add_argument("--output", type=Path, required=True)

    preprocess = commands.add_parser("preprocess", help="convert manifest HDF5 files to episodes")
    preprocess.add_argument("--manifest", type=Path, required=True)
    preprocess.add_argument("--raw", type=Path, required=True)
    preprocess.add_argument("--output", type=Path, required=True)
    preprocess.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    preprocess.add_argument("--dwell-ms", type=float)

    audit = commands.add_parser("audit", help="inspect HDF5 shapes and scenario ranges")
    audit.add_argument("--manifest", type=Path, required=True)
    audit.add_argument("--raw", type=Path, required=True)
    audit.add_argument("--output", type=Path, default=Path("outputs/data_audit.json"))

    split_check = commands.add_parser(
        "check-splits", help="verify whole-file train/validation/test separation"
    )
    split_check.add_argument("manifests", nargs="+", type=Path)

    bench = commands.add_parser("benchmark", help="benchmark schedulers on one episode")
    bench.add_argument("--episode", type=Path, required=True)
    bench.add_argument("--scheduler", action="append", default=[])
    bench.add_argument("--seeds", type=int, default=3)
    bench.add_argument("--output", type=Path, default=Path("outputs/benchmark.json"))
    bench.add_argument("--dqn-model", type=Path)
    bench.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)

    aggregate = commands.add_parser(
        "aggregate", help="aggregate independent episode benchmark files"
    )
    aggregate.add_argument("results", nargs="+", type=Path)
    aggregate.add_argument("--bootstrap-samples", type=int, default=2000)
    aggregate.add_argument("--seed", type=int, default=42)
    aggregate.add_argument("--output", type=Path, default=Path("outputs/aggregate.json"))

    fom = commands.add_parser(
        "fom-report", help="create the named interception figures-of-merit report"
    )
    fom.add_argument("--aggregate", type=Path, required=True)
    fom.add_argument("--output", type=Path, default=Path("outputs/figures_of_merit.json"))

    training = commands.add_parser("train-dqn", help="train DQN on processed episodes")
    training.add_argument("episodes", nargs="+", type=Path)
    training.add_argument("--epochs", type=int, default=3)
    training.add_argument("--seed", type=int, default=42)
    training.add_argument("--output", type=Path, default=Path("outputs/models/dqn.pt"))
    training.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "synthetic":
        episode = make_synthetic_episode(
            num_steps=args.steps,
            num_bands=args.bands,
            num_emitters=args.emitters,
            seed=args.seed,
        )
        print(episode.save(args.output))
        return 0
    if args.command == "download":
        records = download_manifest(args.manifest, args.output)
        print(json.dumps(records, indent=2))
        return 0
    if args.command == "preprocess":
        configuration = load_config(args.config)
        options = preprocess_kwargs(configuration)
        if args.dwell_ms is not None:
            options["dwell_ms"] = args.dwell_ms
        outputs = preprocess_manifest(
            args.manifest,
            args.raw,
            args.output,
            **options,
        )
        print("\n".join(str(path) for path in outputs))
        return 0
    if args.command == "audit":
        records = audit_manifest(args.manifest, args.raw, args.output)
        print(json.dumps(records, indent=2))
        return 0
    if args.command == "check-splits":
        print(json.dumps(validate_split_manifests(args.manifests), indent=2))
        return 0
    if args.command == "benchmark":
        configuration = load_config(args.config)
        dqn_options = dqn_kwargs(configuration)
        linucb_options = linucb_kwargs(configuration)
        episode = Episode.load(args.episode)
        names = args.scheduler
        if not names or "all" in names:
            names = list(
                scheduler_factories(
                    dqn_model=args.dqn_model,
                    dqn_options=dqn_options,
                    linucb_options=linucb_options,
                )
            )
        rows = benchmark(
            episode,
            names,
            seeds=args.seeds,
            dqn_model=args.dqn_model,
            receiver=receiver_config(configuration),
            reward=reward_config(configuration),
            dqn_options=dqn_options,
            linucb_options=linucb_options,
        )
        save_results(rows, args.output)
        print(json.dumps(summarize(rows), indent=2))
        return 0
    if args.command == "train-dqn":
        configuration = load_config(args.config)
        train_dqn(
            args.episodes,
            epochs=args.epochs,
            seed=args.seed,
            output_path=args.output,
            receiver=receiver_config(configuration),
            reward=reward_config(configuration),
            dqn_options=dqn_kwargs(configuration),
        )
        print(args.output)
        return 0
    if args.command == "aggregate":
        payload = aggregate_result_files(
            args.results,
            bootstrap_samples=args.bootstrap_samples,
            seed=args.seed,
        )
        save_aggregate(payload, args.output)
        print(args.output)
        return 0
    if args.command == "fom-report":
        print(load_and_save_figures_of_merit(args.aggregate, args.output))
        return 0
    raise AssertionError("unhandled command")


if __name__ == "__main__":
    raise SystemExit(main())
