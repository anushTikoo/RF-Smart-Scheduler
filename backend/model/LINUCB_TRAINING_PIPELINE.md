# Final LinUCB training pipeline

## Training flow

```text
100 train scenarios
        ↓ continuous LinUCB updates
frozen 100-scenario checkpoint
        ↓ continue on 100 new train scenarios
frozen 200-scenario checkpoint
        ↓ no online updates
100 validation scenarios
        ↓
Round Robin versus LinUCB figures of merit
```

Training state persists across scenarios. The second 100-scenario stage starts from the learned sufficient statistics of the first checkpoint rather than restarting the model.

## What the checkpoint contains

The `.npz` checkpoint stores the LinUCB inverse covariance matrices, reward vectors, update count, feature metadata, environment geometry, context settings, and training provenance. Loading the frozen artifact defaults to `update_enabled=False`.

The accompanying bundle contains:

- frozen checkpoint;
- frozen YAML configuration;
- combined 200-scenario manifest;
- CSV and JSON training histories;
- model metadata;
- SHA-256 checksums.

## Learning diagnostics

LinUCB uses analytical updates and therefore has no neural-network training loss. The logged reward-prediction MSE is the loss-like diagnostic. Per-scenario rewards are not expected to rise monotonically because each file contains a different RF environment. Fixed validation comparisons are the primary evidence of generalisation.

## No prior emitter intelligence

LinUCB never receives emitter identity, class, PRI, scan pattern, or future frequency activity. It learns transferable relationships between causal observation history and received reward. Dataset labels remain simulator truth only for delay, coverage, and reward bookkeeping.

## Inference and baseline comparison

The final evaluator loads the frozen model, keeps online updates disabled, and runs exactly two policies on identical episodes:

- Round Robin;
- LinUCB with adaptive coverage constraints.

Per-dwell traces include selected band, frequency interval, detections, missed opportunities, reward components, and decision timing. Aggregate output contains confidence intervals and the full figures-of-merit table.

## Commands

```powershell
& ".\scripts\setup_v2_production_data.ps1"
& ".\.venv\Scripts\python.exe" ".\scripts\v2_train_production.py"
& ".\scripts\setup_v2_additional_100.ps1"
& ".\.venv\Scripts\python.exe" ".\scripts\v2_continue_to_200.py"
```

Evaluate a declared split with the frozen 200-scenario checkpoint:

```powershell
& ".\.venv\Scripts\python.exe" ".\scripts\v2_final_test.py" --split test
```
