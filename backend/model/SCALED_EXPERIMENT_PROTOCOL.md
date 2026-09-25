# Scaled 30/10/10 Experiment Protocol

## Frozen data split

- Training: official `stare/train_stare/config_0.h5` through `config_29.h5`.
- Validation: official `stare/val_stare/config_0.h5` through `config_9.h5`.
- Sealed test: official `stare/test_stare/config_7.h5` through `config_16.h5`.
- Earlier test IDs 0–6 are excluded because they were consumed during prototype development.

Every HDF5 scenario remains whole. No time window, pulse, or emitter instance from one source file is assigned to another split. Numeric configuration IDs may repeat across official splits because the full remote source path, not the numeric suffix, defines a scenario.

## Label policy

Emitter labels are scenario-local identifiers. Preprocessing retains them in `emitter_labels`, `emitter_presence`, and sparse `event_emitter_index` arrays. They are used only for simulator reward bookkeeping and evaluation metrics such as coverage and first-intercept delay.

Emitter labels are not included in `band_contexts()`, `state_vector()`, LinUCB contexts, DQN inputs, or the next action supplied to any scheduler. This preserves partial observability while retaining valid ground truth for scoring.

## Model-selection sequence

1. Train five DQN seeds on the 30 training episodes only.
2. Evaluate all five frozen checkpoints and non-neural schedulers on the 10 validation episodes.
3. Select one DQN seed and scheduler configuration using validation metrics only.
4. Freeze the checkpoint and configuration.
5. Download and preprocess the sealed 10-file test manifest.
6. Run the final holdout once and aggregate episode-level confidence intervals.

No parameter may be changed after step 5 based on test behavior.

## Figures of merit

Each scheduler is evaluated on:

- simulated probability of detection;
- simulated probability of false alarm;
- configured sensitivity threshold;
- average emitter-event intercept rate per second;
- average reward/cost function;
- oracle-best-band prediction accuracy;
- conditional next-pulse-band prediction accuracy;
- conditional next-pulse-time mean absolute error;
- pulse and emitter-event interception ratios;
- unique-emitter coverage;
- first-intercept delay;
- revisit interval and switching distance.

Pd, Pfa, and sensitivity are simulator parameters/results derived from PDWs. They are not measurements of physical receiver hardware or raw-IQ detection performance.
