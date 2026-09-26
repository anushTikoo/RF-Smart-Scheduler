# Smart Scan V2 model protocol

## Fixed receiver simulation

- Spectrum: 500–18,000 MHz
- Discretisation: 20 non-overlapping 875 MHz bands
- Decision/dwell interval: 500 us
- Round-robin sweep: 10 ms
- Main receiver: ideal detector (`Pd=1`, `Pfa=0`) with zero decision,
  retune, and settling delay
- Hardware-delay fields remain supported for sensitivity studies

The raw data uses microsecond timestamps, but a dwell is a continuous listening
interval rather than one instantaneous sample. Every eligible PDW arriving while
the receiver is tuned to the selected band can be intercepted.

## Leakage control

- Train: 30 complete official `train_stare` files
- Validation: 10 complete official `val_stare` files
- Test: 10 fresh official `test_stare` files, IDs 27–36
- The test manifest is sealed until model and configuration freeze
- No pulse/window from one HDF5 file is split across dataset partitions
- Scenario-local emitter labels are simulator truth only; they are never context,
  prediction, or action inputs
- Pulse-count scaling is fitted only from positive cells in the 30 training files
  and saved in the checkpoint

## V2 causal context

Core features, in order:

1. bias
2. time since last visit, divided by one nominal 20-band sweep
3. EWMA of earlier observed hits
4. log-scaled pulse count from the previous selected-band observation
5. consecutive selected-band no-hit observations
6. periodicity score learned from earlier selected-band hits

The predictive candidate adds:

7. next-active-dwell urgency from bounded per-band observation history

Absolute band identity/position, amplitude, switching distance, mission phase,
episode duration, emitter identity, and future truth are excluded. The predictor
provides one feature; LinUCB remains the decision maker. It is updated once per
dwell, never once per pulse.

## Reward

For decision `t`:

```text
reward_t = 0.01 * intercepted_pulses
           - 1.0 * pending_emitters * dwell_seconds
           - 20.0 * missed_opportunity * dwell_seconds
```

At 500 us, one missed opportunity costs 0.01. This is physically equivalent to
the V1 cost of 0.1 per 5 ms and allows fair dwell-time comparisons.

Terminology:

- Scan miss: activity existed, but the selected band contained none.
- Detector false negative: the selected, receiver-ready band contained an
  eligible emission, but the detector did not report it.
- Missed opportunity: activity existed somewhere, but no pulse was intercepted.
- False alarm: no emission existed in the selected band, but the detector
  reported one.

With the ideal detector and zero latency, a missed opportunity is normally a
scan miss; false alarms and detector false negatives are zero by construction.

## Candidate selection

Exactly three candidates are trained sequentially over every training scenario:

- `v2_core`: alpha 0.5, prediction feature disabled
- `v2_predictive`: alpha 0.5, prediction feature enabled
- `v2_predictive_balanced`: alpha 1.0, prediction feature enabled

All use regularisation 1.0, one shared model, activity-aware coverage deadlines,
and no epsilon-greedy exploration. LinUCB explores through its uncertainty bonus.

A prediction candidate is retained only if, against `v2_core`, it:

- improves mean validation reward by at least 0.01;
- wins at least 60% of paired validation scenarios;
- loses no more than 0.01 absolute pulse interception ratio;
- loses no more than 0.02 absolute unique-emitter coverage; and
- has mean scenario p99 decision latency no greater than the 500 us dwell.

If candidates are within 0.01 mean reward, lower alpha is preferred. The chosen
checkpoint is frozen before any V2 test file is downloaded or preprocessed.

## Reported metrics

Main scheduling metrics:

- pulse interception ratio
- emitter-event interception ratio
- average intercept rate
- average and per-second reward with component costs
- correct scan rate
- missed-opportunity and scan-miss rates
- average first-intercept delay, with unacquired emitters censored at episode end
- unique-emitter coverage
- mean revisit interval

Receiver metrics:

- measured probability of detection on receiver-ready selected pulses
- probability of false alarm on selected empty dwells
- configured sensitivity threshold
- detector false-negative rate
- pulses lost to configured latency and receiver dead time

Prediction metrics (predictive candidate only):

- conditional next-active-band accuracy
- conditional next-active-dwell timing MAE
- prediction count and coverage

Runtime metrics:

- mean, p95, p99, and maximum scheduler decision time
- fraction of decisions exceeding the dwell deadline

Oracle-best-band accuracy remains in raw debug results only and is excluded from
the main figures-of-merit report.

## Commands

```powershell
& ".\.venv\Scripts\python.exe" ".\scripts\v2_preprocess.py"
& ".\.venv\Scripts\python.exe" ".\scripts\v2_train_validate.py"
```

Only after freeze:

```powershell
$env:HF_TOKEN = Read-Host "Hugging Face token"
& ".\.venv\Scripts\python.exe" -m smart_scan.cli download `
  --manifest data/manifests/v2_fresh_test_holdout.json --output data/raw
& ".\.venv\Scripts\python.exe" ".\scripts\v2_preprocess.py" `
  --manifest data/manifests/v2_fresh_test_holdout.json
& ".\.venv\Scripts\python.exe" ".\scripts\v2_final_test.py"
Remove-Item Env:HF_TOKEN
```

