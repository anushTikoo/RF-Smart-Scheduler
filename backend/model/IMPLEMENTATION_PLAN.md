# Smart Scan Strategy for Electronic Warfare - Model-Only MVP Plan

## 1. Project decision

Build a small, reproducible simulation and an online-learning scheduler. Do not build a user interface, hardware integration, or a large deep-learning system in the first version.

The MVP will compare two ML schedulers:

- **LinUCB contextual bandit:** the simple, interpretable model and primary learning baseline.
- **Deep Q-Network (DQN):** a compact reinforcement-learning model that can learn nonlinear, sequential scan policies.

Both choose one frequency band at each dwell interval and learn from the resulting hits, misses, and switching cost. LinUCB establishes whether simple online learning is sufficient; DQN tests whether modelling longer-term consequences provides a measurable improvement.

The Alan Turing Institute dataset is a pulse-deinterleaving dataset, not a ready-made scheduling dataset. We will adapt it as follows:

- Use a small number of **stare-mode** pulse trains as oracle truth for the RF environment.
- Simulate a receiver whose instantaneous bandwidth is smaller than the total spectrum.
- At each time step, reveal only the pulses inside the band selected by the scheduler.
- Use emitter labels only for scoring and reward construction, never as an input available to the deployed scheduler.
- Keep the supplied **scan-mode** data for a later sanity check against the dataset's deterministic sweep.

This separation is important: training only on the supplied scan-mode observations would not provide the counterfactual outcome of choosing a different band.

## 2. MVP boundaries

### Included

- Offline replay simulator driven by recorded Pulse Descriptor Words (PDWs)
- Narrowband receiver model
- Round-robin, random, greedy, periodicity-aware, LinUCB, and DQN schedulers
- Online updates from hits and misses
- Train/validation/test evaluation by complete pulse-train file
- Metrics, plots, saved model state, and configuration files
- CPU-first implementation in Python

### Excluded from the MVP

- Frontend, dashboard, or deployment service
- Live SDR/RF hardware integration
- Raw IQ processing and signal detection
- Emitter identity classification across scenarios
- Large transformer, PPO, or multi-agent reinforcement learning
- Operational threat-library integration

## 3. Data scope

The current dataset release contains 6,000 HDF5 pulse trains and roughly four billion pulses. Each PDW contains time of arrival, centre frequency, pulse width, angle of arrival, and amplitude. Emitter labels are local to one pulse train and must not be treated as globally stable identities.

### Initial micro-dataset

Start with only **12 stare-mode files**:

- 8 official training files
- 2 official validation files
- 2 official test files

Use each complete scenario, but convert it once into compact time-band aggregates. If this micro-dataset is too variable for a stable conclusion, increase to 30/10/10 files without changing the code.

Selection should be deterministic from a seed and, after metadata inspection, should cover low, medium, and high emitter-count scenarios. Never randomly split windows from the same pulse train across train and test because that would leak scenario-specific patterns.

### Access constraint

The Hugging Face dataset is gated. A user must accept its access conditions and supply a Hugging Face token. Download individual `config_*.h5` files rather than complete subsets. The official helper is useful for full-subset downloads, but the MVP downloader should use allow-patterns or explicit file paths so it cannot accidentally download the entire corpus.

### Cached representation

Convert each HDF5 file into a compact episode cache:

```text
time_bin x frequency_band -> {
    pulse_count,
    unique_emitter_count,
    max_amplitude,
    mean_pulse_width,
    active_emitter_labels  # evaluator only
}
```

Recommended initial discretization:

- Frequency range: infer from the file, then clip/configure to the project range
- Receiver bandwidth: 500 MHz, matching the dataset scan receiver
- Dwell/time bin: configurable, start at 5 ms
- Episode duration: use the available recording duration; do not hard-code 10 s or 30 s
- Receiver action: select one frequency band per dwell

Run a short sensitivity check at 1 ms, 5 ms, and 10 ms. Keep 5 ms unless it makes almost every selected band a hit or makes the environment excessively sparse.

## 4. Receiver/environment model

At time step `t`:

1. The scheduler observes only its accumulated history.
2. It selects one band `a_t`.
3. The environment reveals the aggregate for `(t, a_t)`.
4. A detection is counted when at least one oracle PDW in the selected band passes the configured amplitude/sensitivity threshold.
5. The scheduler receives a reward and updates.

The scheduler must not see unselected bands. The evaluator may use the complete oracle grid to calculate regret and interception metrics.

### Current reward

Use the three requested objectives directly:

```text
reward_t = 0.01 * intercepted_pulses_t
         - 1.00 * pending_undetected_emitters_t * dwell_seconds
         - 0.10 * miss_t
```

`miss_t` is one only when at least one threshold-eligible pulse exists somewhere in the spectrum during the current dwell and the selected observation produces no real pulse detection. It is not a false alarm. A no-emission/no-detection dwell is a true negative and receives no miss penalty. A false alarm is reported separately and has no reward term in this ideal first version.

`pending_undetected_emitters_t` is counted after the current observation. It contains emitters that have appeared in oracle truth but have never yet been intercepted, so immediate acquisition has zero delay penalty and later acquisition accumulates cost once per dwell. All coefficients remain configurable in YAML. This is a simulator/training reward because its miss and pending-emitter terms use oracle truth; deployment would require delayed supervisory truth or observable proxy rewards.

Apply a safety constraint to learned schedulers: every band must be revisited within a configurable maximum interval (initially two times the number of bands). When several bands are due, the learned model ranks those candidates instead of reverting to a fixed sweep. This prevents a high-reward dense band from starving the remainder of the spectrum while preserving intelligent scan ordering.

## 5. Scheduler models

Implement in this order.

### Non-ML baselines

1. **Round robin:** fixed sweep through all bands.
2. **Random:** uniformly sampled band.
3. **Greedy recency:** prefer bands with high recent hit rate, with forced exploration.
4. **Periodicity-aware heuristic:** estimate per-band revisit periods from prior hits and revisit near the predicted next activity time.

### ML model 1: LinUCB contextual bandit

For every candidate band, construct a small context vector:

- band index or normalized centre frequency
- time since that band was last visited
- exponentially weighted hit rate
- pulse count and maximum amplitude at the last visit
- number of recent visits and consecutive misses
- estimated period and phase confidence, when available
- normalized switching distance from the currently tuned band
- sine/cosine time features

LinUCB predicts expected reward plus an uncertainty bonus and selects the highest-scoring band. After observing the reward, it updates only from the chosen band. This naturally supports unknown emitters and online adaptation.

### ML model 2: compact DQN

Use the same environment, action space, reward, data splits, and metrics as LinUCB so the comparison is fair.

The DQN state is a normalized, fixed-length vector containing:

- per-band exponentially weighted hit rate
- per-band time since last visit
- per-band last observed pulse count and maximum amplitude
- per-band consecutive misses and estimated periodicity confidence
- current tuned band and normalized switching distance to each candidate band
- recent total reward and sine/cosine time features

The action is the index of the next frequency band. The network outputs one Q-value per band.

Keep the initial implementation small:

- two fully connected hidden layers with 128 ReLU units each
- experience replay buffer capped at approximately 50,000 transitions
- minibatch size 64
- target network with periodic or soft updates
- epsilon-greedy exploration with a scheduled decay
- configurable discount factor, initially 0.95
- gradient clipping and fixed random seeds

Train only on official training episodes, select hyperparameters using validation episodes, and run the frozen model once on test episodes. Do not mix time windows from one pulse-train file across splits. Save training curves and evaluate at least five independent training seeds because DQN results can be unstable.

Do not add an LSTM, dueling architecture, prioritized replay, PPO, or transformer in the MVP. A recurrent DQN is a later option only if error analysis demonstrates that the fixed state cannot represent the necessary history.

## 6. Periodic-emitter interception

Maintain hit timestamps per band and estimate dominant revisit periods using robust inter-hit intervals or autocorrelation. A periodicity-aware score should rise shortly before the next predicted activity window:

```text
periodic_score = confidence * exp(-time_error / tolerance)
```

Add this score to the heuristic baseline and as an input feature for both LinUCB and DQN. Evaluate periodic interception separately on bands/emitters whose interval variation is below a configured coefficient-of-variation threshold. This provides a direct, explainable approach to the problem statement's periodic-scan requirement without a separate complex model.

## 7. Evaluation metrics

Report results per episode and as mean, median, and bootstrap 95% confidence intervals across held-out pulse trains.

### Core MVP metrics

- **Pulse interception ratio:** intercepted oracle pulses / observable oracle pulses
- **Emitter-event interception ratio:** intercepted emitter-time events / all emitter-time events
- **Unique-emitter coverage:** emitters intercepted at least once / observable emitters
- **Average first-intercept delay:** first scheduler hit minus first observable event per emitter
- **Mean revisit delay:** delay between observable recurring events and interceptions
- **Average intercept rate:** intercepted emitter-events per second
- **Average reward:** cumulative reward / time steps
- **Oracle regret:** oracle per-step reward minus scheduler reward
- **Band-prediction accuracy:** selected band equals the oracle best band; also report top-3 accuracy if a ranked output is retained
- **Intercept-time prediction MAE:** predicted next activity time versus actual next activity time

### Detection metrics and dataset limitation

The dataset contains detected PDWs rather than raw IQ/background samples, so genuine receiver probability of false alarm and hardware sensitivity cannot be measured directly.

For the MVP:

- Treat an oracle pulse above a configurable amplitude threshold as a detectable event.
- Add optional synthetic missed detections and false alarms with controlled probabilities.
- Report probability of detection and false-alarm rate only for those explicitly simulated settings.
- Do not present those simulated values as hardware performance.

## 8. Experiment protocol

For each held-out episode:

1. Reset every scheduler to the same cold-start state.
2. Replay the identical environment once per scheduler.
3. Use at least 20 seeded runs for stochastic schedulers.
4. Save actions, observations, rewards, and metric components.
5. Compare LinUCB against round robin, then compare DQN against both LinUCB and round robin.

Run two evaluations:

- **Cold start:** no prior information at episode start.
- **Warm online adaptation:** allow an initial exploration interval, then score the remainder.

### MVP acceptance criteria

Proceed to a larger dataset if at least one ML scheduler passes the core gate on the held-out micro-dataset:

- It improves median emitter-event interception ratio over round robin by at least 10% relative.
- It reduces median first-intercept delay over round robin by at least 10% relative.
- Improvement appears in at least 70% of held-out episodes/seeds, not only in the aggregate.
- Switching cost does not increase by more than 25% unless reward improves proportionally.
- Results are reproducible from one command and a fixed configuration.

DQN is justified as the preferred model only if it improves at least one primary metric over LinUCB by 5% relative without materially degrading the other primary metrics or switching cost. If it does not, retain LinUCB as the recommended scheduler and report the DQN result honestly; a negative DQN comparison does not invalidate the MVP.

If these criteria fail, inspect reward design, time-bin size, and partial-observation features before trying a more complex model.

## 9. Proposed repository structure

```text
smart-scan-ew/
  README.md
  pyproject.toml
  configs/
    micro.yaml
    expanded.yaml
  data/
    raw/                 # ignored by git
    processed/           # ignored by git
    manifests/           # tracked file IDs and checksums
  src/smart_scan/
    data/download.py
    data/preprocess.py
    env/scan_env.py
    schedulers/base.py
    schedulers/round_robin.py
    schedulers/random.py
    schedulers/greedy.py
    schedulers/periodic.py
    schedulers/linucb.py
    schedulers/dqn.py
    training/train_dqn.py
    evaluation/metrics.py
    evaluation/run.py
  tests/
  notebooks/
    01_data_sanity.ipynb
    02_results.ipynb
  outputs/               # ignored by git except examples
```

Recommended libraries: Python 3.11+, NumPy, pandas, h5py, scikit-learn, SciPy, PyTorch, matplotlib/seaborn, PyYAML, and pytest. A GPU is optional; the proposed small DQN should also run on CPU.

## 10. Milestones

### Milestone 1 - Data audit and preprocessing (2-3 days)

- Implement restricted per-file download and manifest
- Inspect HDF5 schema and metadata
- Select the 12-file micro-dataset
- Produce compact time-band episode caches
- Add data leakage and unit checks

Deliverable: reproducible dataset report and cached episodes.

### Milestone 2 - Simulator and baselines (3-4 days)

- Implement partial-observation receiver environment
- Add round-robin, random, greedy, and oracle policies
- Implement core metrics and action logging
- Verify that round-robin behavior matches analytical expectations

Deliverable: baseline benchmark from one command.

### Milestone 3 - Smart schedulers (5-7 days)

- Implement LinUCB and online feature updates
- Add periodicity estimation
- Implement the compact DQN, replay buffer, and target network
- Train DQN with at least five seeds and save learning curves
- Tune only on training/validation scenarios
- Freeze configuration before test evaluation

Deliverable: configured LinUCB and trained DQN models with direct comparison plots.

### Milestone 4 - Validation and decision (2-3 days)

- Run cold-start and warm-adaptation experiments
- Bootstrap confidence intervals
- Perform time-bin and false-alarm sensitivity tests
- Check the acceptance criteria

Deliverable: concise model report and go/no-go decision for scaling.

Expected MVP effort: approximately 3 weeks for one developer, excluding dataset access delays.

## 11. Scale-up path

After the MVP passes:

1. Increase to 30/10/10, then 100/25/25 pulse trains.
2. Add emitter/threat weights and constrained revisit requirements.
3. Randomize bandwidth, dwell time, missed-detection rate, and false-alarm rate.
4. Test transfer from stare-derived simulation to paired scan-mode recordings.
5. Consider recurrent DQN or another sequence model only if the compact DQN has a measured state-memory limitation.
6. Integrate real receiver characteristics only when hardware/noise data becomes available.

## 12. Primary risks and controls

- **Dataset/task mismatch:** use stare mode as oracle truth and build a scheduler simulator; document that this is an adaptation.
- **Massive download:** use explicit file allow-lists and a hard maximum file count.
- **Leakage:** split only by complete pulse-train file.
- **Arbitrary emitter IDs:** use labels only within one episode and only for evaluation/reward bookkeeping.
- **Unrealistic false-alarm claims:** clearly separate simulated detector behavior from measured hardware performance.
- **Reward hacking:** report physical metrics alongside reward and compare action traces.
- **DQN instability:** use multiple seeds, held-out episodes, target networks, gradient clipping, and training-curve checks.
- **Over-complexity:** keep DQN to a small MLP and retain LinUCB when DQN does not provide a stable, measurable gain.

## References

- [Turing Synthetic Radar Dataset](https://huggingface.co/datasets/alan-turing-institute/turing-synthetic-radar-dataset)
- [Turing Deinterleaving Challenge repository](https://github.com/alan-turing-institute/turing-deinterleaving-challenge)
- Local source: `context/dataset description.pdf`
