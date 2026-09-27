# Smart Scan Strategy for Electronic Warfare

Model-only research implementation of an adaptive narrowband receiver scheduler for unknown radar emitters.

## Final scope

The repository intentionally contains two schedulers only:

- `RoundRobinScheduler`: deterministic open-loop baseline.
- `LinUCBScheduler`: the selected contextual-bandit policy with adaptive coverage constraints.

The selected model was trained continuously on 200 complete `train_stare` scenarios and then frozen. It does not receive emitter identity, class, PRI, scan pattern, future activity, or other prior emitter intelligence.

Receiver simulation assumptions:

- spectrum: 500–18,000 MHz;
- 20 non-overlapping bands of 875 MHz;
- 500 us dwell, giving a 10 ms Round Robin sweep;
- ideal initial detector with `Pd=1`, `Pfa=0`, and −120 dB sensitivity;
- zero configured decision, retune, and settling latency.

The causal LinUCB context uses bias, visit recency, observed hit EWMA, prior observed pulse count, consecutive no-hit history, and learned periodicity. No next-pulse or intercept-time predictor is part of the model. LinUCB explores with its confidence bound and coverage constraint; it does not use epsilon-greedy exploration.

## Frozen backend artifact

The selected checkpoint is:

```text
outputs/v2_production_200/frozen_model/smart_scan_linucb_v2_1_200.npz
```

Its configuration and complete training provenance are in the same directory. The portable archive is:

```text
artifacts/smart_scan_linucb_v2_1_200_scenarios.zip
```

See `FINAL_MODEL_REPORT.md` for the complete 100-scenario validation comparison with Round Robin.

## Setup

```powershell
py -m venv .venv
& ".\.venv\Scripts\python.exe" -m pip install -e ".[dev]"
& ".\.venv\Scripts\python.exe" -m pytest
```

## Reproduce the 200-scenario model

Download and preprocess the first 100 training scenarios:

```powershell
& ".\scripts\setup_v2_production_data.ps1"
```

Train and freeze the first-stage model:

```powershell
& ".\.venv\Scripts\python.exe" ".\scripts\v2_train_production.py"
```

Download and preprocess training scenarios 100–199, then continue training and export the final frozen model:

```powershell
& ".\scripts\setup_v2_additional_100.ps1"
& ".\.venv\Scripts\python.exe" ".\scripts\v2_continue_to_200.py"
```

## Evaluate one HDF5 scenario

This evaluates both the frozen contextual bandit and Round Robin and writes all figures of merit:

```powershell
& ".\.venv\Scripts\python.exe" ".\scripts\v2_evaluate_h5.py" `
  "C:\path\to\config.h5"
```

## Evaluate a declared validation or test split

`v2_final_test.py` loads the frozen model with online updates disabled and compares only LinUCB and Round Robin:

```powershell
& ".\.venv\Scripts\python.exe" ".\scripts\v2_final_test.py" `
  --split test `
  --band-log-interval 1000
```

Use `--no-traces` for large runs when per-dwell CSV logs are unnecessary. The evaluator writes per-episode results, bootstrap aggregates, figures of merit, and a protocol record.

## Interpretation limits

Stare-mode PDWs are replayed as simulator truth. Scenario-local emitter labels are retained only for offline delay, coverage, and reward bookkeeping; they never enter the scheduler context. Probability of detection and false-alarm results describe the configured ideal detector, not measured RF hardware. The implementation is a research simulator and requires integration with a real receiver, detector, retuning hardware, and real-time runtime before operational use.
