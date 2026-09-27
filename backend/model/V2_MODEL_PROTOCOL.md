# Final Smart Scan model protocol

## Receiver and environment

- Spectrum: 500–18,000 MHz.
- Discretisation: 20 non-overlapping 875 MHz bands.
- Decision/dwell interval: 500 us.
- Round Robin sweep: 10 ms.
- Detector: ideal initial model with `Pd=1`, `Pfa=0`, −120 dB sensitivity.
- Configured decision, retune, and settling delay: zero.

A dwell is a continuous listening interval. Every eligible PDW arriving while the receiver is ready and tuned to the selected band can be intercepted.

## Selected scheduler

The deployed policy is a frozen, shared-model LinUCB contextual bandit with adaptive coverage constraints. The only comparison scheduler is deterministic Round Robin.

Final LinUCB settings:

- alpha: 0.5;
- regularisation: 1.0;
- minimum revisit factor: 0.5;
- maximum revisit factor: 3.0;
- uncertainty weight: 0.75;
- coverage bonus weight: 1.0;
- inference updates: disabled.

The final checkpoint was trained continuously across 200 complete `train_stare` scenarios. A later 1,000-scenario candidate did not show a meaningful validation improvement and was not selected.

## Causal context

The selected model receives only information derived from prior receiver observations:

1. bias;
2. time since last visit;
3. observed hit EWMA;
4. log-scaled pulse count from the previous observation of that band;
5. consecutive no-hit observations;
6. periodicity inferred from earlier observed hits.

Emitter IDs, class, PRI, scan pattern, future truth, mission phase, amplitude, absolute band position, and switching distance are not model inputs. Emitter labels remain simulator-only truth for acquisition delay and coverage scoring.

## Reward

For dwell `t`:

```text
reward_t = 0.01 * intercepted_pulses
           - 1.0 * pending_emitters * dwell_seconds
           - 20.0 * missed_opportunity * dwell_seconds
```

At a 500 us dwell, one missed opportunity costs 0.01. A missed opportunity means activity existed somewhere in the simulated spectrum but no pulse was intercepted. It is not a false alarm.

## Data boundaries

- Training: 200 whole `train_stare` scenarios, config IDs 0–199.
- Validation evidence used for the final comparison: 100 whole `val_stare` scenarios, config IDs 20–119.
- Test manifests remain separate and must never be used for training or tuning.
- No windows or pulses from one HDF5 file are split across partitions.
- The pulse-count normalization reference is fitted from training data and frozen in the checkpoint.
- Validation/test inference has online LinUCB updates disabled.

## Reported figures of merit

Scheduling metrics:

- average reward and reward per second;
- pulse and emitter-event interception ratios;
- intercept rate;
- correct scan and missed-opportunity rates;
- average first-intercept delay;
- unique emitter coverage;
- mean revisit interval.

Receiver metrics:

- measured detection probability;
- false-alarm and detector false-negative rates;
- sensitivity threshold;
- pulses lost to configured latency and receiver dead time.

Runtime metrics:

- mean, p95, p99, and maximum scheduler decision time;
- proportion of decisions exceeding the 500 us dwell deadline.

Oracle best-band accuracy may remain in raw debugging output because it is calculated from simulator truth, but it is not a headline model-performance metric.
