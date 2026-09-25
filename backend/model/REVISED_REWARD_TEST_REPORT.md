# Revised-Reward Test Results

## Protocol

- Evaluated processed official test scenarios `config_7` through `config_16` (10 whole scenarios).
- Compared only round-robin and the adaptive LinUCB contextual bandit.
- Used `configs/scaled.yaml`, a 5 ms dwell, 35 frequency bands, and the revised reward:

```text
R_t = 0.01 * intercepted_pulses
    - 1.00 * pending_undetected_emitters * dwell_seconds
    - 0.10 * miss
```

- The default ideal detector was retained: detection probability 1.0, false-alarm probability 0.0, sensitivity threshold -120 dB, and zero configured receiver dead time.
- Means below are scenario-level macro averages. Confidence intervals in `aggregate.json` are 95% bootstrap intervals over the 10 scenarios.
- These scenarios had already been inspected under an earlier reward, so these are comparative test results rather than a new untouched-holdout claim.

## Main results

| Metric | Round-robin | LinUCB contextual bandit | Comparison |
|---|---:|---:|---:|
| Average reward / decision | -0.0330 | **0.2724** | +0.3054 |
| Pulse interception ratio | 2.846% | **20.812%** | **7.31x** |
| Emitter-event interception ratio | 2.846% | **11.653%** | **4.09x** |
| Unique-emitter coverage | 90.13% | **93.88%** | +3.74 percentage points |
| Average first-intercept delay | 2.573 s | **2.108 s** | **18.1% lower** |
| Average intercept rate | 71.42/s | **224.95/s** | **3.15x** |
| Miss rate on emission-opportunity dwells | 80.51% | **42.45%** | -38.06 percentage points |
| Average acquisition-delay penalty / decision | 0.01451 | **0.01058** | 27.1% lower |
| Average miss penalty / decision | 0.07016 | **0.03695** | 47.3% lower |
| Mean revisit interval | 175.000 ms | 174.843 ms | essentially equal |
| Average normalized switching distance | **0.0571** | 0.2718 | LinUCB switches 4.76x farther |

LinUCB won reward, pulse interception, emitter-event interception, intercept rate, and miss rate on all 10 scenarios. It had lower first-intercept delay on 8 of 10 scenarios. Its emitter coverage was strictly higher on 8 scenarios, equal on one, and lower on one.

## Requested figures of merit

| Figure of merit | Round-robin | LinUCB contextual bandit |
|---|---:|---:|
| Probability of detection | 1.000 | 1.000 |
| Probability of false alarm | 0.000 | 0.000 |
| Sensitivity threshold | -120 dB | -120 dB |
| Average intercept rate | 71.42/s | **224.95/s** |
| Average reward / cost | -0.0330 | **0.2724** |
| Oracle-best-band decision accuracy | 2.86% | **15.50%** |
| Conditional next-pulse-band prediction accuracy | 96.30% | **98.65%** |
| Average intercept-time prediction error | 13.726 ms | **2.259 ms** |

Probability of detection is measured only when the selected band contains an eligible pulse. It is therefore detector performance, not the probability that the scheduler chooses the correct band. Scheduler interception performance is represented by pulse/event interception ratios, miss rate, coverage, intercept rate, and delay.

## Conclusion

Under the revised reward, adaptive LinUCB is substantially better than round-robin at finding useful emissions: it intercepts 7.31 times the pulses, produces 3.15 times the intercept rate, nearly halves the miss rate, and reduces mean first-intercept delay by 18.1%, while slightly improving emitter coverage. The main cost is more frequency movement. The hard coverage constraint keeps the mean revisit interval close to the 175 ms round-robin sweep interval, but LinUCB changes the order and revisit priority within that constraint.

For an unbiased final estimate after this reward change, freeze the reward and LinUCB settings using training/validation data, then evaluate once on a fresh set of test scenarios not used in this analysis.
