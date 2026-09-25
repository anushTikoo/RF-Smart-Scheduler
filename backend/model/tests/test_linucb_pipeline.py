from __future__ import annotations

import numpy as np

from smart_scan.data.synthetic import make_synthetic_episode
from smart_scan.env.scan_env import ReceiverConfig, RewardConfig, ScanEnvironment
from smart_scan.evaluation.run import run_episode
from smart_scan.linucb_pipeline import train_validate_select
from smart_scan.schedulers.linucb import LinUCBScheduler


def test_linucb_checkpoint_round_trip_and_frozen_inference(tmp_path) -> None:
    episode = make_synthetic_episode(
        num_steps=50, num_bands=5, num_emitters=3, seed=4
    )
    scheduler = LinUCBScheduler(
        shared_model=True,
        preserve_model_across_episodes=True,
        update_enabled=True,
    )
    run_episode(episode, scheduler, seed=1)
    assert scheduler.num_updates == episode.num_steps
    assert scheduler.reward_prediction_count == episode.num_steps
    assert scheduler.reward_prediction_mse >= 0.0
    learned_b = scheduler.b.copy()

    # Starting another episode clears only episode-local context, not learning.
    scheduler.reset(ScanEnvironment(episode), seed=2)
    assert np.array_equal(scheduler.b, learned_b)

    checkpoint = scheduler.save(tmp_path / "linucb.npz")
    frozen = LinUCBScheduler.load(checkpoint)
    assert frozen.update_enabled is False
    before_b = frozen.b.copy()
    before_updates = frozen.num_updates
    run_episode(episode, frozen, seed=3)
    assert np.array_equal(frozen.b, before_b)
    assert frozen.num_updates == before_updates


def test_train_validate_selection_produces_frozen_artifacts(tmp_path) -> None:
    train_paths = []
    for index in range(2):
        path = tmp_path / f"train_{index}.npz"
        make_synthetic_episode(
            num_steps=30, num_bands=4, num_emitters=2, seed=index
        ).save(path)
        train_paths.append(path)
    validation_path = tmp_path / "validation.npz"
    make_synthetic_episode(
        num_steps=30, num_bands=4, num_emitters=2, seed=10
    ).save(validation_path)

    candidates = [
        {
            "name": "candidate_a",
            "alpha": 0.5,
            "regularization": 1.0,
            "max_revisit_factor": 2.0,
            "coverage_bonus_weight": 0.5,
            "shared_model": True,
        },
        {
            "name": "candidate_b",
            "alpha": 1.0,
            "regularization": 2.0,
            "max_revisit_factor": 2.0,
            "coverage_bonus_weight": 1.0,
            "shared_model": True,
        },
    ]
    configuration = {
        "receiver": {"dwell_ms": 5.0},
        "reward": {"pulse_intercept_weight": 0.01},
    }
    output = tmp_path / "selection"
    selection = train_validate_select(
        train_paths,
        [validation_path],
        candidates,
        output_dir=output,
        configuration=configuration,
        receiver=ReceiverConfig(),
        reward=RewardConfig(),
        bootstrap_samples=20,
    )
    assert selection["train_episode_count"] == 2
    assert selection["validation_episode_count"] == 1
    assert selection["test_data_accessed"] is False
    assert (output / "frozen_linucb.npz").is_file()
    assert (output / "frozen_config.yaml").is_file()
    assert (output / "frozen_training_history.csv").is_file()
    assert (output / "frozen_training_history.json").is_file()
    assert (output / "selection.json").is_file()
    assert (
        output
        / "candidates"
        / "candidate_a"
        / "validation"
        / "traces"
        / "validation_linucb.csv"
    ).is_file()
