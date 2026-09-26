# Persistent LinUCB Training Pipeline

## Data boundary

```text
30 train scenarios -> update LinUCB -> save candidate checkpoint
10 validation scenarios -> frozen evaluation -> select hyperparameters
freeze checkpoint and configuration
10 fresh test scenarios -> frozen evaluation once
```

The train/validation selector reads only `scaled_train_val.json`. It has no test-manifest argument and records `test_data_accessed: false` in `selection.json`. The final evaluator is a separate command using `scaled_fresh_test_holdout.json`.

## No emitter intelligence in the scheduler

The scheduler is designed for the absence of emitter identity and operating-characteristic intelligence. LinUCB does not receive dataset emitter labels, threat class, emitter PRI, scan pattern, or future frequency schedule. One shared linear model is used for every band, so training learns general observable activity rules instead of maintaining a memorized model for each absolute frequency.

Its context contains only quantities derived from the receiver's own past observations:

- normalized frequency-band index;
- time since the band was observed;
- exponentially weighted hit history;
- last observed pulse count and amplitude;
- consecutive no-hit observations;
- band-level periodicity inferred from observed hits;
- anonymous per-band activity prediction inferred from observed pulse times;
- normalized retune distance;
- coverage/visit uncertainty;
- episode time features.

The anonymous pulse predictor groups observations by receiver band, not emitter ID. Multiple emitters in one band are intentionally treated as a single anonymous activity stream.

Dataset labels remain in the simulator for offline acquisition-delay reward and evaluation metrics. During validation and test the loaded checkpoint has `update_enabled=False`, so oracle reward and labels cannot modify the policy. An operational integration should replace evaluation labels with a real tracker only if emitter-specific reporting is required; LinUCB scheduling itself does not require that tracker.

## What persists

The selected shared LinUCB model saves:

- one inverse design matrix `A_inverse`, shared by all frequency-band arms;
- one reward vector `b`, shared by all frequency-band arms;
- alpha and regularization;
- adaptive revisit and coverage settings;
- context dimensions and update count.

Calling `reset()` for a new training episode clears episode-local action context while retaining these learned statistics. A frozen checkpoint can be loaded without enabling online updates.

## Training diagnostics

LinUCB updates its linear sufficient statistics analytically and therefore has no neural-network optimization loss. The implementation logs contextual reward-prediction mean squared error as the loss-like diagnostic:

```text
reward_prediction_mse = mean((observed_reward - predicted_reward)^2)
```

For every training scenario it records average reward, prediction MSE, five-scenario rolling reward/MSE, cumulative updates, interception ratios, coverage, delay, and miss rate. The selected candidate's complete history is copied to:

```text
outputs/linucb_pipeline/frozen_training_history.csv
outputs/linucb_pipeline/frozen_training_history.json
```

Because scenarios contain different emitters and activity densities, raw per-scenario reward is not expected to increase monotonically. Rolling metrics and frozen validation performance are the meaningful trend checks.

## Inference band trace

Candidate-screening validation skips action traces and evaluates only LinUCB. Once the best candidate is selected, a single full validation comparison writes one CSV row for every LinUCB and round-robin decision under `outputs/linucb_pipeline/selected_validation/traces`. Final test runs write the same traces under their own `traces` directory. Rows include step/time, band index, lower and upper frequency, pulse interceptions, miss and false-alarm flags, total reward and each reward component, and switching distance.

The final-test script prints the active LinUCB band every 100 decisions by default:

```powershell
.venv\Scripts\python scripts/linucb_final_test.py --band-log-interval 100
```

Use `--band-log-interval 1` for every decision or `0` to disable console band logging. Full CSV traces are produced independently of the console interval.

## Hyperparameter selection

`configs/linucb_search.yaml` declares three exploration candidates:

- exploration strength (`alpha`);
- balanced exploration (`alpha=1.0`);
- lower exploration (`alpha=0.5`);
- higher exploration (`alpha=1.5`).

Regularization, coverage, revisit and uncertainty settings are held fixed so the three-candidate comparison remains interpretable. Each candidate is independently trained on all 30 training scenarios. Validation selection uses highest mean reward, then pulse interception and lower first-intercept delay only as deterministic tie-breakers. Test data is not used for candidate selection.

The three candidates run in separate worker processes by default, but training order remains sequential within each candidate. LinUCB feature calculations are cached for the current dwell and vectorized across all bands. State vectors used only by DQN are not built on the LinUCB path.

A compatible checkpoint, JSON history and CSV history are saved after every scenario. If a run is interrupted, rerunning the same command resumes from the last completed scenario. Resume is rejected if the paths, seed, receiver, reward or LinUCB options changed.

## Commands

```powershell
& ".\.venv\Scripts\python.exe" ".\scripts\linucb_train_validate.py" --jobs 3
```

After selection is complete and frozen, download/preprocess the sealed scenarios and run:

```powershell
.venv\Scripts\python scripts/linucb_final_test.py
```

The final evaluator compares only round-robin and frozen LinUCB and writes per-episode results, a bootstrap aggregate, figures of merit, and a protocol record.
