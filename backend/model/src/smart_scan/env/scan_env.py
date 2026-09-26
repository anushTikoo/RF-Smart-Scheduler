from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from smart_scan.data.episode import Episode
from smart_scan.features.context import BandContextConfig, BandContextEncoder
from smart_scan.prediction.next_pulse import NextPulsePredictor


@dataclass(frozen=True, slots=True)
class ReceiverConfig:
    amplitude_threshold_db: float = -120.0
    detection_probability: float = 1.0
    false_alarm_probability: float = 0.0
    ewma_alpha: float = 0.2
    decision_latency_us: float = 0.0
    retune_time_us: float = 0.0
    settling_time_us: float = 0.0


@dataclass(frozen=True, slots=True)
class RewardConfig:
    """Weights for the three scheduling objectives.

    The delay weight is expressed per second and per emitter that has appeared but
    has not yet been intercepted. A miss is an action-level false negative: at
    least one observable pulse existed somewhere in the spectrum during the
    dwell, but the receiver intercepted no pulse.
    """

    pulse_intercept_weight: float = 0.01
    acquisition_delay_weight_per_s: float = 1.0
    miss_penalty: float = 0.1
    missed_opportunity_penalty_per_s: float | None = None

    def missed_opportunity_cost(self, dwell_s: float) -> float:
        """Return a dwell-normalized cost while retaining V1 compatibility."""

        if self.missed_opportunity_penalty_per_s is not None:
            return self.missed_opportunity_penalty_per_s * dwell_s
        return self.miss_penalty


@dataclass(slots=True)
class Transition:
    reward: float
    detected_pulses: int
    detected_emitters: np.ndarray
    miss: bool
    scan_miss: bool
    missed_opportunity: bool
    detector_false_negative: bool
    false_alarm: bool
    switching_distance: float
    interception_reward: float
    acquisition_delay_penalty: float
    miss_penalty: float
    done: bool
    detected_event_times_s: np.ndarray
    detected_event_emitters: np.ndarray
    detected_event_bands: np.ndarray


class ScanEnvironment:
    """Partially observed receiver replaying one oracle episode."""

    def __init__(
        self,
        episode: Episode,
        receiver: ReceiverConfig | None = None,
        reward: RewardConfig | None = None,
        context: BandContextConfig | None = None,
        *,
        seed: int = 0,
    ) -> None:
        self.episode = episode
        self.receiver = receiver or ReceiverConfig()
        self.reward_config = reward or RewardConfig()
        self.context_config = context or BandContextConfig(version="v1")
        self.context_encoder = BandContextEncoder(self.context_config)
        (
            self.detectable_pulse_count,
            self.detectable_max_amplitude,
            self.detectable_emitter_presence,
        ) = episode.detectable_truth(self.receiver.amplitude_threshold_db)
        self.emitter_count = self.detectable_emitter_presence.sum(axis=2, dtype=np.int16)
        self.emission_exists_by_step = self.detectable_pulse_count.sum(axis=1) > 0
        self.oracle_best_by_step = np.argmax(self.emitter_count, axis=1).astype(np.int16)
        observable_by_step = self.detectable_emitter_presence.any(axis=1)
        self.first_observable_step = np.full(episode.num_emitters, -1, dtype=np.int32)
        for emitter in range(episode.num_emitters):
            observable_steps = np.flatnonzero(observable_by_step[:, emitter])
            if len(observable_steps):
                self.first_observable_step[emitter] = int(observable_steps[0])
        if not 0 <= self.receiver.detection_probability <= 1:
            raise ValueError("detection_probability must be between zero and one")
        if not 0 <= self.receiver.false_alarm_probability <= 1:
            raise ValueError("false_alarm_probability must be between zero and one")
        if min(
            self.receiver.decision_latency_us,
            self.receiver.retune_time_us,
            self.receiver.settling_time_us,
        ) < 0:
            raise ValueError("receiver latency values cannot be negative")
        if min(
            self.reward_config.pulse_intercept_weight,
            self.reward_config.acquisition_delay_weight_per_s,
            self.reward_config.miss_penalty,
        ) < 0:
            raise ValueError("reward weights cannot be negative")
        if (
            self.reward_config.missed_opportunity_penalty_per_s is not None
            and self.reward_config.missed_opportunity_penalty_per_s < 0
        ):
            raise ValueError("missed-opportunity penalty rate cannot be negative")
        self.seed = seed
        self.rng = np.random.default_rng(seed)
        self.next_pulse_predictor = (
            NextPulsePredictor(episode.num_bands)
            if self.context_config.predictor_enabled
            else None
        )
        self.reset(return_state=False)

    def reset(self, *, return_state: bool = True) -> np.ndarray | None:
        bands = self.episode.num_bands
        emitters = self.episode.num_emitters
        self.step_index = 0
        self.current_band = 0
        self.last_visit = np.full(bands, -1, dtype=np.int32)
        self.visit_count = np.zeros(bands, dtype=np.int32)
        self.ewma_hit = np.zeros(bands, dtype=np.float32)
        self.last_pulse_count = np.zeros(bands, dtype=np.float32)
        self.last_amplitude = np.full(bands, -140.0, dtype=np.float32)
        self.consecutive_no_hits = np.zeros(bands, dtype=np.float32)
        # Compatibility alias for legacy DQN and external notebooks.
        self.consecutive_misses = self.consecutive_no_hits
        self.last_hit_step = np.full(bands, -1, dtype=np.int32)
        self.estimated_period = np.zeros(bands, dtype=np.float32)
        self.period_error = np.ones(bands, dtype=np.float32)
        self.period_samples = np.zeros(bands, dtype=np.int32)
        self.recent_reward = 0.0
        self.total_reward = 0.0
        self.total_detected_pulses = 0
        self.total_detected_events = 0
        self.total_switching_distance = 0.0
        self.total_false_alarms = 0
        self.total_misses = 0
        self.total_scan_misses = 0
        self.total_detector_false_negatives = 0
        self.total_selected_active_steps = 0
        self.total_emission_opportunity_steps = 0
        self.total_interception_reward = 0.0
        self.total_acquisition_delay_penalty = 0.0
        self.total_miss_penalty = 0.0
        self.total_eligible_selected_pulses = 0
        self.total_eligible_selected_steps = 0
        self.total_empty_selected_steps = 0
        self.pulses_lost_to_latency = 0
        self.total_dead_time_s = 0.0
        self.detected_emitters_ever = np.zeros(emitters, dtype=bool)
        self.first_detect_step = np.full(emitters, -1, dtype=np.int32)
        self.oracle_correct = 0
        self.oracle_opportunities = 0
        self.action_log: list[int] = []
        self.reward_log: list[float] = []
        self.rng = np.random.default_rng(self.seed)
        self.next_pulse_predictor = (
            NextPulsePredictor(self.episode.num_bands)
            if self.context_config.predictor_enabled
            else None
        )
        self._feature_cache_step = -1
        self._cached_prediction_scores: np.ndarray | None = None
        self._cached_periodic_due: np.ndarray | None = None
        self._cached_band_contexts: np.ndarray | None = None
        return self.state_vector() if return_state else None

    @property
    def done(self) -> bool:
        return self.step_index >= self.episode.num_steps

    @property
    def context_size(self) -> int:
        return int(self.band_contexts().shape[1])

    @property
    def state_size(self) -> int:
        return int(self.state_vector().size)

    def _time_since_visit(self) -> np.ndarray:
        elapsed = np.where(
            self.last_visit < 0,
            self.episode.num_steps,
            self.step_index - self.last_visit,
        )
        return np.clip(elapsed / max(self.episode.num_steps, 1), 0.0, 1.0)

    @property
    def context_feature_names(self) -> tuple[str, ...]:
        return self.context_encoder.feature_names

    def configure_context(self, context: BandContextConfig) -> None:
        """Configure the encoder before the first scheduling decision."""

        if self.step_index != 0 or self.action_log:
            raise RuntimeError("context must be configured before an episode starts")
        self.context_config = context
        self.context_encoder = BandContextEncoder(context)
        self.next_pulse_predictor = (
            NextPulsePredictor(self.episode.num_bands)
            if context.predictor_enabled
            else None
        )
        self._feature_cache_step = -1

    def periodicity_scores(self) -> np.ndarray:
        self._refresh_feature_cache()
        if self._cached_periodic_due is not None:
            return self._cached_periodic_due
        elapsed = np.where(
            self.last_hit_step < 0,
            0.0,
            self.step_index - self.last_hit_step,
        )
        valid = (self.estimated_period > 0) & (self.period_samples >= 2)
        error = np.abs(elapsed - self.estimated_period)
        tolerance = np.maximum(1.0, 0.2 * self.estimated_period)
        score = np.zeros(self.episode.num_bands, dtype=np.float32)
        score[valid] = np.exp(-error[valid] / tolerance[valid]) / (1.0 + self.period_error[valid])
        self._cached_periodic_due = score
        return score

    def _periodic_due(self) -> np.ndarray:
        """Compatibility alias for coverage helpers."""

        return self.periodicity_scores()

    def _refresh_feature_cache(self) -> None:
        if self._feature_cache_step == self.step_index:
            return
        self._feature_cache_step = self.step_index
        self._cached_prediction_scores = None
        self._cached_periodic_due = None
        self._cached_band_contexts = None

    def prediction_scores(self) -> np.ndarray:
        """Return per-band anonymous pulse urgency, computed once per dwell."""

        self._refresh_feature_cache()
        if self.next_pulse_predictor is None:
            return np.zeros(self.episode.num_bands, dtype=np.float32)
        if self._cached_prediction_scores is None:
            self._cached_prediction_scores = self.next_pulse_predictor.band_scores(
                self.step_index * self.episode.time_bin_s,
                self.episode.time_bin_s * self.episode.num_bands,
            )
        return self._cached_prediction_scores

    def band_contexts(self) -> np.ndarray:
        self._refresh_feature_cache()
        if self._cached_band_contexts is None:
            self._cached_band_contexts = self.context_encoder.encode(self)
        return self._cached_band_contexts

    def _legacy_band_contexts(self) -> np.ndarray:
        self._refresh_feature_cache()
        bands = self.episode.num_bands
        indices = np.arange(bands, dtype=np.float32)
        denominator = max(bands - 1, 1)
        band_position = indices / denominator
        switching = np.abs(indices - self.current_band) / denominator
        pulse_feature = np.clip(np.log1p(self.last_pulse_count) / np.log(100.0), 0.0, 1.0)
        amplitude_feature = np.clip((self.last_amplitude + 140.0) / 140.0, 0.0, 1.0)
        miss_feature = np.clip(self.consecutive_misses / 20.0, 0.0, 1.0)
        phase = 2.0 * np.pi * self.step_index / max(self.episode.num_steps, 1)
        prediction_score = self.prediction_scores()
        contexts = np.column_stack(
            [
                np.ones(bands, dtype=np.float32),
                band_position,
                self._time_since_visit(),
                self.ewma_hit,
                pulse_feature,
                amplitude_feature,
                miss_feature,
                self._periodic_due(),
                prediction_score,
                switching,
                np.full(bands, np.sin(phase), dtype=np.float32),
                np.full(bands, np.cos(phase), dtype=np.float32),
            ]
        )
        return contexts.astype(np.float32, copy=False)

    def state_vector(self) -> np.ndarray:
        contexts = self.band_contexts()[:, 1:]
        current = np.zeros(self.episode.num_bands, dtype=np.float32)
        current[self.current_band] = 1.0
        global_features = np.asarray(
            [
                np.clip(self.recent_reward / 10.0, -1.0, 1.0),
                self.step_index / max(self.episode.num_steps, 1),
            ],
            dtype=np.float32,
        )
        return np.concatenate([contexts.reshape(-1), current, global_features])

    def oracle_action(self) -> int:
        if self.done:
            return 0
        return int(self.oracle_best_by_step[self.step_index])

    def _observe_sparse_cell(
        self, time_index: int, band_index: int, switching: bool
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, int, int, float]:
        """Return detected event times, emitters, amplitudes, eligible count, latency loss, dead time."""

        assert self.episode.event_time_s is not None
        assert self.episode.event_amplitude_db is not None
        assert self.episode.event_emitter_index is not None
        cell_slice = self.episode.cell_event_slice(time_index, band_index)
        times = self.episode.event_time_s[cell_slice]
        amplitudes = self.episode.event_amplitude_db[cell_slice]
        emitters = self.episode.event_emitter_index[cell_slice]
        threshold_mask = amplitudes >= self.receiver.amplitude_threshold_db
        times = times[threshold_mask]
        amplitudes = amplitudes[threshold_mask]
        emitters = emitters[threshold_mask]

        dead_time_s = 0.0
        if switching:
            dead_time_s = (
                self.receiver.decision_latency_us
                + self.receiver.retune_time_us
                + self.receiver.settling_time_us
            ) / 1e6
        start_s = time_index * self.episode.time_bin_s
        ready_s = start_s + dead_time_s
        # Exact zero dead time must never lose a pulse to floating-point noise at
        # a bin boundary. Non-zero hardware delay retains the strict time test.
        ready_mask = (
            np.ones(len(times), dtype=bool)
            if dead_time_s == 0.0
            else times >= ready_s - np.finfo(np.float64).eps * 8
        )
        latency_loss = int((~ready_mask).sum())
        times = times[ready_mask]
        amplitudes = amplitudes[ready_mask]
        emitters = emitters[ready_mask]
        eligible_count = len(times)

        if eligible_count and self.receiver.detection_probability < 1.0:
            detection_mask = (
                self.rng.random(eligible_count) < self.receiver.detection_probability
            )
            times = times[detection_mask]
            amplitudes = amplitudes[detection_mask]
            emitters = emitters[detection_mask]
        return times, emitters, amplitudes, eligible_count, latency_loss, dead_time_s

    def step(self, action: int) -> Transition:
        if self.done:
            raise RuntimeError("cannot step a completed episode")
        if not 0 <= action < self.episode.num_bands:
            raise ValueError(f"action {action} is outside the band range")

        t = self.step_index
        oracle_counts = self.emitter_count[t]
        oracle_best = self.oracle_action()
        if oracle_counts.max() > 0:
            self.oracle_opportunities += 1
            self.oracle_correct += int(action == oracle_best)

        switched = action != self.current_band
        event_times = np.asarray([], dtype=np.float64)
        event_emitters = np.asarray([], dtype=np.int16)
        event_bands = np.asarray([], dtype=np.int16)
        dead_time_s = 0.0
        latency_loss = 0
        if self.episode.has_sparse_events:
            (
                event_times,
                event_emitters,
                detected_amplitudes,
                eligible_count,
                latency_loss,
                dead_time_s,
            ) = self._observe_sparse_cell(t, action, switched)
            pulses = len(event_times)
            amplitude = float(np.max(detected_amplitudes)) if pulses else -np.inf
            emitters = np.zeros(self.episode.num_emitters, dtype=bool)
            if pulses:
                emitters[np.unique(event_emitters)] = True
                event_bands = np.full(pulses, action, dtype=np.int16)
        else:
            eligible_count = int(self.detectable_pulse_count[t, action])
            detected = eligible_count > 0 and (
                self.rng.random() < self.receiver.detection_probability
            )
            pulses = eligible_count if detected else 0
            amplitude = (
                float(self.detectable_max_amplitude[t, action]) if detected else -np.inf
            )
            emitters = (
                self.detectable_emitter_presence[t, action].copy()
                if detected
                else np.zeros(self.episode.num_emitters, dtype=bool)
            )
        selected_emission_exists = bool(self.detectable_pulse_count[t, action] > 0)
        detectable = eligible_count > 0
        false_alarm = bool(
            not selected_emission_exists
            and self.rng.random() < self.receiver.false_alarm_probability
        )
        denominator = max(self.episode.num_bands - 1, 1)
        switching = abs(action - self.current_band) / denominator
        newly_seen = emitters & ~self.detected_emitters_ever
        event_count = int(emitters.sum())

        # Reward objective 1: each intercepted pulse contributes linearly.
        interception_reward = self.reward_config.pulse_intercept_weight * pulses

        # Reward objective 2: after this observation, charge for every emitter
        # that has already appeared in truth but has still not been acquired.
        # This makes an earlier first intercept strictly better than a later one.
        detected_after_action = self.detected_emitters_ever | emitters
        has_appeared = (self.first_observable_step >= 0) & (
            self.first_observable_step <= t
        )
        pending_emitters = has_appeared & ~detected_after_action
        acquisition_delay_penalty = (
            self.reward_config.acquisition_delay_weight_per_s
            * int(pending_emitters.sum())
            * self.episode.time_bin_s
        )

        # Reward objective 3: a missed opportunity means activity existed in the
        # spectrum but this action produced no interception. It is not a false
        # alarm, and is separated below from a detector false negative.
        emission_exists = bool(self.emission_exists_by_step[t])
        scan_miss = bool(emission_exists and not selected_emission_exists)
        detector_false_negative = bool(detectable and pulses == 0)
        missed_opportunity = bool(emission_exists and pulses == 0)
        miss = missed_opportunity  # V1 output alias.
        miss_penalty = self.reward_config.missed_opportunity_cost(
            self.episode.time_bin_s
        ) * int(missed_opportunity)
        reward = interception_reward - acquisition_delay_penalty - miss_penalty

        hit = float(pulses > 0 or false_alarm)
        alpha = self.receiver.ewma_alpha
        self.ewma_hit[action] = (1.0 - alpha) * self.ewma_hit[action] + alpha * hit
        self.last_visit[action] = t
        self.visit_count[action] += 1
        self.last_pulse_count[action] = pulses
        self.last_amplitude[action] = amplitude if np.isfinite(amplitude) else -140.0
        self.consecutive_no_hits[action] = (
            0 if hit else self.consecutive_no_hits[action] + 1
        )
        if pulses > 0:
            previous = int(self.last_hit_step[action])
            if previous >= 0:
                interval = float(t - previous)
                old_period = float(self.estimated_period[action])
                if self.period_samples[action] == 0:
                    self.estimated_period[action] = interval
                    self.period_error[action] = 0.0
                else:
                    self.estimated_period[action] = 0.8 * old_period + 0.2 * interval
                    self.period_error[action] = 0.8 * self.period_error[action] + 0.2 * abs(
                        interval - old_period
                    ) / max(old_period, 1.0)
                self.period_samples[action] += 1
            self.last_hit_step[action] = t

        self.first_detect_step[newly_seen] = t
        self.detected_emitters_ever |= emitters
        self.current_band = action
        self.recent_reward = float(reward)
        self.total_reward += float(reward)
        self.total_detected_pulses += pulses
        self.total_detected_events += event_count
        self.total_switching_distance += switching
        self.total_false_alarms += int(false_alarm)
        self.total_misses += int(miss)
        self.total_scan_misses += int(scan_miss)
        self.total_detector_false_negatives += int(detector_false_negative)
        self.total_selected_active_steps += int(selected_emission_exists)
        self.total_emission_opportunity_steps += int(emission_exists)
        self.total_interception_reward += float(interception_reward)
        self.total_acquisition_delay_penalty += float(acquisition_delay_penalty)
        self.total_miss_penalty += float(miss_penalty)
        self.total_eligible_selected_pulses += eligible_count
        self.total_eligible_selected_steps += int(detectable)
        self.total_empty_selected_steps += int(not detectable)
        self.pulses_lost_to_latency += latency_loss
        self.total_dead_time_s += min(dead_time_s, self.episode.time_bin_s)
        self.action_log.append(action)
        self.reward_log.append(float(reward))
        # V2 updates once per selected dwell, not once per pulse. It receives
        # only the observed band/activity flag; labels and hidden truth never
        # enter the prediction or context path.
        if self.next_pulse_predictor is not None:
            self.next_pulse_predictor.update_dwell(
                observation_time_s=(t + 1) * self.episode.time_bin_s,
                band_index=action,
                active=bool(pulses > 0),
            )
        self.step_index += 1
        return Transition(
            reward=float(reward),
            detected_pulses=pulses,
            detected_emitters=emitters,
            miss=miss,
            scan_miss=scan_miss,
            missed_opportunity=missed_opportunity,
            detector_false_negative=detector_false_negative,
            false_alarm=false_alarm,
            switching_distance=float(switching),
            interception_reward=float(interception_reward),
            acquisition_delay_penalty=float(acquisition_delay_penalty),
            miss_penalty=float(miss_penalty),
            done=self.done,
            detected_event_times_s=event_times,
            detected_event_emitters=event_emitters,
            detected_event_bands=event_bands,
        )

    def summary(self) -> dict[str, float]:
        observable_pulses = int(self.detectable_pulse_count.sum())
        observable_presence = self.detectable_emitter_presence
        observable_events = int(observable_presence.sum())
        observable_emitters = observable_presence.any(axis=(0, 1))
        delays: list[float] = []
        for emitter in np.flatnonzero(observable_emitters):
            detected = int(self.first_detect_step[emitter])
            start = int(self.first_observable_step[emitter])
            end_or_hit = detected if detected >= 0 else self.episode.num_steps
            delays.append((end_or_hit - start) * self.episode.time_bin_s)
        duration = self.episode.num_steps * self.episode.time_bin_s
        revisit_intervals: list[float] = []
        actions = np.asarray(self.action_log, dtype=np.int16)
        for band in range(self.episode.num_bands):
            visits = np.flatnonzero(actions == band)
            if len(visits) > 1:
                revisit_intervals.extend(np.diff(visits) * self.episode.time_bin_s)
        return {
            "total_reward": self.total_reward,
            "average_reward": self.total_reward / max(self.episode.num_steps, 1),
            "average_reward_per_s": self.total_reward / max(duration, 1e-9),
            "average_interception_reward": self.total_interception_reward
            / max(self.episode.num_steps, 1),
            "average_acquisition_delay_penalty": self.total_acquisition_delay_penalty
            / max(self.episode.num_steps, 1),
            "average_miss_penalty": self.total_miss_penalty
            / max(self.episode.num_steps, 1),
            "misses": float(self.total_misses),
            "miss_rate": self.total_misses
            / max(self.total_emission_opportunity_steps, 1),
            "missed_opportunities": float(self.total_misses),
            "missed_opportunity_rate": self.total_misses
            / max(self.total_emission_opportunity_steps, 1),
            "scan_misses": float(self.total_scan_misses),
            "scan_miss_rate": self.total_scan_misses
            / max(self.total_emission_opportunity_steps, 1),
            "correct_scan_rate": self.total_selected_active_steps
            / max(self.total_emission_opportunity_steps, 1),
            "detector_false_negatives": float(self.total_detector_false_negatives),
            "detector_false_negative_rate": self.total_detector_false_negatives
            / max(self.total_eligible_selected_steps, 1),
            "pulse_interception_ratio": self.total_detected_pulses / max(observable_pulses, 1),
            "emitter_event_interception_ratio": self.total_detected_events / max(observable_events, 1),
            "unique_emitter_coverage": int((self.detected_emitters_ever & observable_emitters).sum())
            / max(int(observable_emitters.sum()), 1),
            "average_first_intercept_delay_s": float(np.mean(delays)) if delays else 0.0,
            "intercept_rate_per_s": self.total_detected_events / max(duration, 1e-9),
            "average_switching_distance": self.total_switching_distance
            / max(self.episode.num_steps, 1),
            "false_alarms": float(self.total_false_alarms),
            "false_alarm_rate": self.total_false_alarms
            / max(self.total_empty_selected_steps, 1),
            "measured_detection_probability": self.total_detected_pulses
            / max(self.total_eligible_selected_pulses, 1),
            "sensitivity_threshold_db": float(self.receiver.amplitude_threshold_db),
            "mean_revisit_interval_s": float(np.mean(revisit_intervals))
            if revisit_intervals
            else 0.0,
            "pulses_lost_to_latency": float(self.pulses_lost_to_latency),
            "receiver_dead_time_s": self.total_dead_time_s,
            "oracle_band_accuracy": self.oracle_correct / max(self.oracle_opportunities, 1),
            **(
                self.next_pulse_predictor.metrics()
                if self.next_pulse_predictor is not None
                else {
                    "next_active_dwell_timing_mae_s": 0.0,
                    "next_active_band_accuracy": 0.0,
                    "next_active_prediction_count": 0.0,
                    "next_active_prediction_coverage": 0.0,
                    "predictor_dwell_updates": 0.0,
                    "intercept_time_prediction_mae_s": 0.0,
                    "next_pulse_band_accuracy": 0.0,
                    "next_pulse_prediction_count": 0.0,
                }
            ),
        }
