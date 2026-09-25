# Contextual-Bandit Reward Function

The environment now implements the three requested objectives as:

```text
R_t = w_hit * N_intercepted_pulses(t)
    - w_delay * N_pending_emitters(t) * dwell_seconds
    - w_miss * I_miss(t)
```

The configured defaults in `configs/micro.yaml` and `configs/scaled.yaml` are:

```text
w_hit   = 0.01 per intercepted pulse
w_delay = 1.00 per pending-emitter second
w_miss  = 0.10 per missed dwell
```

## Exact definitions

- `N_intercepted_pulses(t)` is the number of real pulses detected in the selected frequency band during dwell `t`. Every extra pulse therefore increases reward by exactly `0.01`.
- `N_pending_emitters(t)` is the number of emitters that have appeared in threshold-eligible truth by dwell `t` but have not been intercepted by the end of the current observation. An emitter detected at its first opportunity incurs no delay cost. An emitter found later accumulates cost for every earlier dwell during which it remained undiscovered.
- `I_miss(t)` is one when at least one threshold-eligible pulse exists somewhere in the spectrum during dwell `t`, but the receiver detects zero real pulses. Otherwise it is zero. This is a binary action-level miss rather than a penalty for every individual unobserved pulse, which prevents dense pulse bursts from overwhelming the other objectives.

## Miss versus false alarm

The terms are deliberately separate:

| Reality | Receiver report | Outcome |
|---|---|---|
| Emission exists | Real pulse detected | True positive / interception |
| Emission exists | No real pulse detected | False negative / miss |
| No emission | Detection reported | False positive / false alarm |
| No emission | Nothing detected | True negative |

There is no false-alarm penalty in this reward. With the default ideal detector (`false_alarm_probability: 0.0`), false alarms cannot occur and measured probability of false alarm is zero by construction. The simulator still supports a configurable synthetic false-alarm probability for later detector experiments, and reports it as a separate metric.

A false alarm can coexist with a miss if a real emission exists in another band while the selected empty band generates a false report. They remain two distinct events: the real emission was missed and an unrelated false detection occurred.

## Why delay is emitter-acquisition delay

A physical pulse that has passed cannot be intercepted later. Therefore, the meaningful scheduler-level interpretation of “reach it sooner” is time from an emitter's first observable pulse to its first successful interception. The existing `average_first_intercept_delay_s` metric uses the same definition.

## Training-time truth and deployment limitation

The hit term is directly observable. The global miss and pending-emitter terms require the simulator's complete time-frequency truth, including unselected bands. They are valid supervised reward shaping for offline experiments, but an operational receiver would not know them immediately. Deployment would require delayed ground-truth feedback, an external evaluator, or observable proxy terms. Emitter labels remain excluded from LinUCB contexts and model inputs.

## Exploration

LinUCB does not use epsilon-greedy exploration. It explores using its upper-confidence uncertainty bonus, coverage urgency, and the hard overdue/unvisited-band constraint. Epsilon remains only in the optional DQN implementation, which is currently paused.
