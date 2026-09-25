# Smart Scan Strategy for Electronic Warfare

Model-only research prototype for learning a narrowband receiver scan policy from radar Pulse Descriptor Words (PDWs).

The system treats stare-mode recordings from the Turing Synthetic Radar Dataset as oracle environmental truth. A simulated receiver observes only one 500 MHz band per dwell. Round-robin, random, greedy, periodicity-aware, LinUCB, and DQN schedulers are evaluated through identical episodes.

The cache keeps both time-band aggregates and exact pulse times. Exact events are used for amplitude thresholding, configurable decision/retune/settling latency, and online next-pulse prediction. The 5 ms dwell is a scheduling time step, not a claim that the Python prototype makes a hardware decision between two pulses a few microseconds apart. Real-time feasibility must later be measured on the target receiver/FPGA/processor with non-zero latency configured in `configs/micro.yaml`.

The active LinUCB scheduler requires no emitter identity, emitter class, PRI, scan pattern, or pre-mission frequency plan. Its context is built only from receiver-observable per-band history: visit recency, hit EWMA, pulse count, amplitude, consecutive no-hit observations, anonymously inferred band periodicity, anonymous band-activity prediction, switching distance, uncertainty, coverage urgency, and time. Dataset emitter labels remain simulator truth for offline reward and evaluation only. Frozen validation/test inference does not update from oracle rewards.

## Setup

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[ml,dev]"
```

Do not place a Hugging Face token in source files or commit it. After accepting the gated dataset conditions, either configure it only in the current shell:

```powershell
$env:HF_TOKEN = "your-token"
```

or use the secure helper, which hides the input and removes the token from the process after downloading:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/download_micro_dataset.ps1
```

## Verify without external data

```powershell
smart-scan synthetic --output data/processed/synthetic_episode.npz
smart-scan train-dqn data/processed/synthetic_episode.npz --epochs 2 --output outputs/models/dqn-smoke.pt
smart-scan benchmark --episode data/processed/synthetic_episode.npz --scheduler all --dqn-model outputs/models/dqn-smoke.pt --seeds 3
pytest
```

## Download the micro-dataset

The checked-in manifest requests only 12 explicit HDF5 files.

```powershell
smart-scan download --manifest data/manifests/micro.json --output data/raw
smart-scan audit --manifest data/manifests/micro.json --raw data/raw --output outputs/data_audit.json
smart-scan preprocess --manifest data/manifests/micro.json --raw data/raw --output data/processed --config configs/micro.yaml
```

Train only on the official training episodes and evaluate candidate checkpoints on validation episodes:

```powershell
$train = (Get-ChildItem data/processed/stare/train/*.npz).FullName
smart-scan train-dqn $train --epochs 1 --seed 42 --config configs/micro.yaml --output outputs/models/dqn.pt
smart-scan benchmark --episode data/processed/stare/val/config_0.npz --scheduler round_robin --scheduler linucb --scheduler dqn --dqn-model outputs/models/dqn.pt --config configs/micro.yaml --output outputs/validation.json
```

After model selection is frozen, download the untouched final holdout without changing its manifest:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/download_micro_dataset.ps1 `
  -Manifest data/manifests/final_holdout.json `
  -RawDirectory data/raw
```

The current model is a research simulator, not an operational EW receiver. Probability of detection and false alarms are controlled simulation parameters because this PDW dataset does not contain raw RF/IQ noise from which hardware detector performance can be measured.

The scheduler reward is:

```text
R_t = 0.01 * intercepted pulses
    - 1.00 * undetected-emitter acquisition-delay seconds
    - 0.10 * miss
```

A miss means a real, threshold-eligible emission occurred somewhere during the dwell but the receiver intercepted no pulse. It is distinct from a false alarm. The default ideal detector has zero false alarms by construction, so false alarms are measured but not penalized. See [REWARD_FUNCTION.md](REWARD_FUNCTION.md) for the exact definitions and limitations.

## Scaled experiment

The frozen scaled split contains 30 official training files, 10 official validation files, and 10 untouched official test files. Test IDs 0–6 were consumed by earlier development and are excluded from the new holdout.

```powershell
smart-scan check-splits data/manifests/scaled_train_val.json data/manifests/scaled_test_holdout.json
powershell -ExecutionPolicy Bypass -File scripts/download_micro_dataset.ps1 `
  -Manifest data/manifests/scaled_train_val.json `
  -RawDirectory data/raw
smart-scan audit --manifest data/manifests/scaled_train_val.json --raw data/raw --output outputs/scaled_data_audit.json
smart-scan preprocess --manifest data/manifests/scaled_train_val.json --raw data/raw --output data/processed --config configs/scaled.yaml
```

Do not download, preprocess, inspect, or evaluate `scaled_test_holdout.json` until the scheduler configuration and DQN checkpoint have been selected using validation data.

The scaled configuration enables activity-aware revisit deadlines and a coverage-urgency bonus. It retains an initial full-band visit and a hard deadline guard, while allowing repeatedly inactive bands to wait longer and active, uncertain, or pulse-due bands to be revisited sooner.

Emitter labels are retained in processed episode caches because they are required to score unique-emitter coverage, first-intercept delay, and emitter-event interception. Labels are local to each scenario and are evaluator/reward-only: they are never placed in the scheduler state, contextual-bandit context, or DQN input.

## Persistent LinUCB train/validation/test pipeline

Train every candidate continuously across all 30 training scenarios, evaluate the resulting frozen checkpoints on the 10 validation scenarios, and freeze the best validation configuration:

```powershell
.venv\Scripts\python scripts/linucb_train_validate.py
```

The compact candidate search is declared in `configs/linucb_search.yaml`. Selection maximizes validation reward, with pulse interception and lower first-intercept delay used only as tie-breakers. The command produces:

- `outputs/linucb_pipeline/frozen_linucb.npz`
- `outputs/linucb_pipeline/frozen_config.yaml`
- `outputs/linucb_pipeline/selection.json`

Only after those files are frozen, download and preprocess the new sealed test scenarios 17–26:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/download_micro_dataset.ps1 `
  -Manifest data/manifests/scaled_fresh_test_holdout.json `
  -RawDirectory data/raw
smart-scan preprocess `
  --manifest data/manifests/scaled_fresh_test_holdout.json `
  --raw data/raw `
  --output data/processed `
  --config outputs/linucb_pipeline/frozen_config.yaml
.venv\Scripts\python scripts/linucb_final_test.py
```

The final-test command loads the frozen checkpoint with online updates disabled and compares only round-robin and LinUCB. See `LINUCB_TRAINING_PIPELINE.md` for the data-boundary and checkpoint details.

Generate the named interception figures of merit from an aggregate result:

```powershell
smart-scan fom-report --aggregate outputs/scaled/aggregate.json --output outputs/scaled/figures_of_merit.json
```

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for scope, metrics, milestones, and acceptance gates.
