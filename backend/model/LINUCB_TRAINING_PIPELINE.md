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

## Hyperparameter selection

`configs/linucb_search.yaml` declares an explicit compact search over:

- exploration strength (`alpha`);
- regularization;
- coverage bonus;
- revisit and uncertainty settings.

Each candidate is independently trained on all 30 training scenarios. Validation selection uses highest mean reward, then pulse interception and lower first-intercept delay only as deterministic tie-breakers. Test data is not used for candidate selection.

## Commands

```powershell
.venv\Scripts\python scripts/linucb_train_validate.py
```

After selection is complete and frozen, download/preprocess the sealed scenarios and run:

```powershell
.venv\Scripts\python scripts/linucb_final_test.py
```

The final evaluator compares only round-robin and frozen LinUCB and writes per-episode results, a bootstrap aggregate, figures of merit, and a protocol record.
