# Scaled Smart-Scan Contextual-Bandit Report

## Protocol

- 30 official training scenarios were prepared for future DQN work.
- 10 official validation scenarios were used to select LinUCB coverage bonus 1.0.
- 10 untouched official test scenarios (`test_stare/config_7.h5`–`config_16.h5`) were evaluated once after configuration freeze.
- Whole source files were kept in one split; no pulse/time windows crossed splits.
- DQN training was stopped by user request and no scaled DQN checkpoint was produced.

## Reward used for these historical holdout results

The untouched-test numbers below were produced before the reward revision and are retained for traceability. They must not be presented as results from the current reward.

```text
reward = 1.0 * detected emitter-events
       + 4.0 * newly discovered emitters
       + 0.1 * log(1 + detected pulses)
       - 0.03 * normalized switching distance
       - 0.10 * false alarms
```

```text
action score = estimated reward
             + 1.0 * LinUCB uncertainty
             + 1.0 * coverage urgency
```

LinUCB does not use epsilon-greedy exploration. The uncertainty term explores poorly understood bands, coverage urgency raises bands near their adaptive revisit deadline, and a hard mask protects unvisited/overdue bands.

The code now uses the three-objective interception/delay/miss reward documented in `REWARD_FUNCTION.md`. Because that revision was made after inspecting test scenarios 7–16, a new final claim for the revised reward requires retraining/tuning on train/validation only and a fresh untouched test set (for example, test scenarios 17–26).

## Final untouched-test results

| Scheduler | Event interception | Pulse interception | Emitter coverage | First-intercept delay | Intercept rate/s | Reward | Switching |
|---|---:|---:|---:|---:|---:|---:|---:|
| Round-robin | 2.85% | 2.85% | 90.13% | 2.573 s | 71.42 | 0.423 | 0.057 |
| Periodic | 15.92% | 15.99% | 72.88% | 8.256 s | 423.16 | 2.374 | 0.036 |
| Adaptive LinUCB | **15.95%** | **19.30%** | **92.24%** | 2.705 s | 320.04 | 1.802 | 0.227 |

LinUCB versus round-robin:

- 5.60 times the emitter-event interception ratio.
- 6.78 times the pulse interception ratio.
- 4.48 times the average emitter-event intercept rate.
- 2.11 percentage points higher unique-emitter coverage.
- 5.1% higher mean first-intercept delay.
- 3.97 times the normalized switching distance.
- Event interception improved in 10/10 scenarios.
- First-intercept delay improved in 5/10 scenarios.
- Coverage was no worse in 8/10 scenarios.

Bootstrap 95% intervals for LinUCB:

- Event interception: 12.08–21.71%.
- Coverage: 88.14–95.78%.
- First-intercept delay: 1.593–3.967 seconds.

## Requested figures of merit

For adaptive LinUCB:

- Simulated probability of detection: 1.0.
- Simulated probability of false alarm: 0.0.
- Configured sensitivity threshold: −120 dB.
- Average intercept rate: 320.04 emitter-events/second.
- Average reward: 1.802 per decision.
- Oracle-best-band prediction accuracy: 31.25%.
- Conditional next-pulse-band prediction accuracy: 98.52%.
- Conditional intercept-time prediction MAE: 2.93 ms.

Pd, Pfa, and sensitivity are simulator figures derived from PDWs, not measurements of RF hardware or raw-IQ detector performance.

## Label policy

Scenario-local emitter labels are retained in processed truth arrays because they are required for new-emitter reward, coverage, and first-intercept scoring. Labels are never included in the LinUCB context, DQN state, prediction features, or action input. A live online-learning implementation would need an emitter association/tracking component to reproduce label-dependent reward; otherwise it must replace those terms with observable hit/pulse proxies.

## Decision

Adaptive LinUCB is the selected scaled scheduler because its throughput and coverage generalize strongly and it requires no expensive offline neural training. It does not yet satisfy the strict requirement to reduce mean first-intercept delay over round-robin. The implementation should therefore be described as a high-interception, coverage-preserving prototype rather than a fully optimized minimum-intercept-time scheduler.
