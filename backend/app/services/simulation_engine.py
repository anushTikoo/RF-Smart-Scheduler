"""
Simulation Engine orchestrating ScanEnvironments, LinUCBScheduler,
and RoundRobinScheduler with dwell stepping and telemetry generation.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

from smart_scan.config import load_config, receiver_config, reward_config
from smart_scan.data.episode import Episode
from smart_scan.env.scan_env import ReceiverConfig, RewardConfig, ScanEnvironment
from smart_scan.features.context import BandContextConfig
from smart_scan.schedulers.baselines import RoundRobinScheduler
from smart_scan.schedulers.linucb import LinUCBScheduler

from app.core.config import (
    DEFAULT_CONFIG_PATH,
    DEFAULT_H5_PATH,
    DEFAULT_TOTAL_DWELLS,
    DWELL_DURATION_MS,
    SPECTRUM_BANDS,
)
from app.services.dataset_service import DatasetService

# Precomputed static band metadata tuples for O(1) integer-indexed lookups
BAND_CENTERS: tuple[str, ...] = tuple(b["center"] for b in SPECTRUM_BANDS)
BAND_RANGES: tuple[str, ...] = tuple(b["range"] for b in SPECTRUM_BANDS)
BAND_TYPES: tuple[str, ...] = tuple(b["type"] for b in SPECTRUM_BANDS)



class SimulationEngine:
    """
    Core engine managing radar episode data, ScanEnvironments,
    LinUCB cognitive bandit scheduler, and RoundRobin open loop scheduler.
    """

    def __init__(
        self,
        config_path: str | Path = DEFAULT_CONFIG_PATH,
        default_h5_path: str | Path | None = DEFAULT_H5_PATH,
    ):
        self.config_path = Path(config_path)
        self.default_h5_path = Path(default_h5_path) if default_h5_path is not None else None
        self.raw_config: Dict[str, Any] = {}
        self.receiver_cfg: ReceiverConfig | None = None
        self.reward_cfg: RewardConfig | None = None
        self.context_cfg: BandContextConfig | None = None

        self.episode: Episode | None = None
        self.dataset_name: str = ""
        self.total_pulses_in_dataset: int = 0
        self.total_dataset_dwells: int = 0

        # Environments and Schedulers
        self.env_ml: ScanEnvironment | None = None
        self.env_ol: ScanEnvironment | None = None
        self.linucb: LinUCBScheduler | None = None
        self.round_robin: RoundRobinScheduler | None = None

        # Cached simulation history
        self.cached_dwells: List[Dict[str, Any]] = []
        self.running_detectable_pulses: int = 0
        self._step_active_bands: List[List[tuple[int, int]]] = []
        self._cumulative_pulses: List[int] = []

        self._load_configuration()
        if self.default_h5_path and self.default_h5_path.exists():
            self.load_h5_dataset(self.default_h5_path)

    def _load_configuration(self) -> None:
        """Load YAML configuration from file or fallback to V2 defaults."""
        if self.config_path.exists():
            self.raw_config = load_config(self.config_path)
        else:
            self.raw_config = {
                "schema_version": 2,
                "seed": 42,
                "receiver": {
                    "frequency_min_mhz": 500.0,
                    "frequency_max_mhz": 18000.0,
                    "bandwidth_mhz": 875.0,
                    "dwell_ms": 0.5,
                    "amplitude_threshold_db": -120.0,
                    "detection_probability": 1.0,
                    "false_alarm_probability": 0.0,
                },
                "reward": {
                    "pulse_intercept_weight": 0.01,
                    "acquisition_delay_weight_per_s": 1.0,
                    "missed_opportunity_penalty_per_s": 20.0,
                },
                "linucb": {
                    "alpha": 0.5,
                    "regularization": 1.0,
                    "min_revisit_factor": 0.5,
                    "max_revisit_factor": 3.0,
                    "uncertainty_weight": 0.75,
                    "coverage_bonus_weight": 1.0,
                    "shared_model": True,
                    "context_version": "v2",
                },
            }

        self.receiver_cfg = receiver_config(self.raw_config)
        self.reward_cfg = reward_config(self.raw_config)

        # Parse pulse_count_reference safely handling string or numeric
        p_ref = self.raw_config.get("context", {}).get("pulse_count_reference", 21.0)
        try:
            p_ref_val = float(p_ref)
        except (ValueError, TypeError):
            p_ref_val = 21.0

        self.context_cfg = BandContextConfig(
            version="v2",
            pulse_count_reference=p_ref_val,
            no_hit_reference=float(self.raw_config.get("context", {}).get("no_hit_reference", 5.0)),
        )

        # Background computation state
        self.is_computing: bool = False
        self.compute_complete: bool = False
        self._compute_thread: threading.Thread | None = None

        # Live Ground-Truth Intercept Delay & Revisit Interval Tracking
        self._ml_seen_emitters: set[int] = set()
        self._ml_delay_sum: float = 0.0
        self._ml_delay_count: int = 0
        self._ol_seen_emitters: set[int] = set()
        self._ol_delay_sum: float = 0.0
        self._ol_delay_count: int = 0
        self._ml_last_visit: list[int] = [-1] * 20
        self._ml_revisit_sum: float = 0.0
        self._ml_revisit_count: int = 0
        self._ol_last_visit: list[int] = [-1] * 20
        self._ol_revisit_sum: float = 0.0
        self._ol_revisit_count: int = 0

    def load_h5_dataset(self, h5_file_path: str | Path, dataset_label: str = "") -> Dict[str, Any]:
        """Load an HDF5 dataset file, preprocess it into an Episode, and initialize environments."""
        path = Path(h5_file_path)
        data, labels = DatasetService.load_h5_file(path)

        self.dataset_name = dataset_label or path.name
        self.total_pulses_in_dataset = len(data)

        self.episode = DatasetService.create_episode(
            data,
            labels,
            source_name=str(path),
            dwell_ms=DWELL_DURATION_MS,
        )

        self.total_dataset_dwells = self.episode.num_steps
        self.reset_simulation()
        # Start full-speed background computation immediately
        self.start_background_compute()

        return self.get_dataset_info()

    def start_background_compute(self) -> None:
        """Run the entire model at full speed in a background thread.
        The WebSocket just polls cached_dwells progress — no pacing bottleneck."""
        if self.episode is None:
            return
        # Stop any existing computation
        self.stop_background_compute()

        self.is_computing = True
        self.compute_complete = False

        def _run():
            try:
                target = self.episode.num_steps
                current = len(self.cached_dwells)
                while current < target and self.is_computing:
                    batch_end = min(current + 200, target)
                    for step in range(current, batch_end):
                        if not self.is_computing:
                            break
                        self.cached_dwells.append(self._step_one_dwell(step))
                    current = len(self.cached_dwells)
            except Exception as e:
                print(f"Background compute error at dwell {len(self.cached_dwells)}: {e}")
            finally:
                self.is_computing = False
                self.compute_complete = True


        self._compute_thread = threading.Thread(target=_run, daemon=True)
        self._compute_thread.start()

    def get_dataset_info(self) -> Dict[str, Any]:
        """Return metadata about the currently loaded dataset."""
        return DatasetService.extract_info(
            self.episode,
            self.dataset_name,
            self.total_pulses_in_dataset,
        )

    def stop_background_compute(self) -> None:
        """Stop any running background computation thread safely."""
        self.is_computing = False
        if self._compute_thread and self._compute_thread.is_alive():
            self._compute_thread.join(timeout=5.0)
        self._compute_thread = None

    def reset_simulation(self) -> None:
        """Reset the ScanEnvironments and schedulers to step 0."""
        # Stop any running background computation before resetting state
        self.stop_background_compute()

        if self.episode is None:
            return

        seed = int(self.raw_config.get("seed", 42))

        self.env_ml = ScanEnvironment(
            self.episode,
            receiver=self.receiver_cfg,
            reward=self.reward_cfg,
            context=self.context_cfg,
            seed=seed,
        )

        ol_context_cfg = BandContextConfig(
            version="v2",
            pulse_count_reference=self.context_cfg.pulse_count_reference if self.context_cfg else 21.0,
            no_hit_reference=self.context_cfg.no_hit_reference if self.context_cfg else 5.0,
        )

        self.env_ol = ScanEnvironment(
            self.episode,
            receiver=self.receiver_cfg,
            reward=self.reward_cfg,
            context=ol_context_cfg,
            seed=seed,
        )

        lin_opts = dict(self.raw_config.get("linucb", {}))
        p_ref = lin_opts.get("pulse_count_reference", self.context_cfg.pulse_count_reference if self.context_cfg else 21.0)
        try:
            p_ref_val = float(p_ref)
        except (ValueError, TypeError):
            p_ref_val = 21.0

        self.linucb = LinUCBScheduler(
            alpha=float(lin_opts.get("alpha", 0.5)),
            regularization=float(lin_opts.get("regularization", 1.0)),
            min_revisit_factor=float(lin_opts.get("min_revisit_factor", 0.5)),
            max_revisit_factor=float(lin_opts.get("max_revisit_factor", 3.0)),
            uncertainty_weight=float(lin_opts.get("uncertainty_weight", 0.75)),
            coverage_bonus_weight=float(lin_opts.get("coverage_bonus_weight", 1.0)),
            shared_model=bool(lin_opts.get("shared_model", True)),
            context_version=str(lin_opts.get("context_version", "v2")),
            pulse_count_reference=p_ref_val,
            no_hit_reference=float(lin_opts.get("no_hit_reference", 5.0)),
        )
        self.linucb.reset(self.env_ml, seed=seed)

        self.round_robin = RoundRobinScheduler()
        self.round_robin.reset(self.env_ol, seed=seed)

        # Vectorized precomputation of per-step active bands and cumulative detectable pulses
        counts_2d = self.env_ml.detectable_pulse_count
        steps, bands = np.nonzero(counts_2d)
        pulse_values = counts_2d[steps, bands]

        self._step_active_bands = [[] for _ in range(self.episode.num_steps)]
        for s, b, p in zip(steps.tolist(), bands.tolist(), pulse_values.tolist()):
            self._step_active_bands[s].append((b, p))

        self._cumulative_pulses = np.cumsum(counts_2d.sum(axis=1)).tolist()

        self.cached_dwells = []
        self.running_detectable_pulses = 0

        # Reset Live Tracking for Intercept Delay and Revisit Interval
        self._ml_seen_emitters = set()
        self._ml_delay_sum = 0.0
        self._ml_delay_count = 0

        self._ol_seen_emitters = set()
        self._ol_delay_sum = 0.0
        self._ol_delay_count = 0

        num_bands = self.episode.num_bands if self.episode else 20
        self._ml_last_visit = [-1] * num_bands
        self._ml_revisit_sum = 0.0
        self._ml_revisit_count = 0

        self._ol_last_visit = [-1] * num_bands
        self._ol_revisit_sum = 0.0
        self._ol_revisit_count = 0


    def precompute_dwells(self, max_dwells: int = 1000) -> None:
        """Precompute initial chunk of dwells (default 1000) for instant queries."""
        if self.episode is None:
            return

        limit = min(max_dwells, self.episode.num_steps)
        self.reset_simulation()
        self.cached_dwells = []

        for step in range(limit):
            dwell = self._step_one_dwell(step)
            self.cached_dwells.append(dwell)

    def ensure_dwells(self, target_dwells: int) -> None:
        """Dynamically compute dwells on-demand up to target_dwells.
        If background computation is running, wait for it to catch up.
        If not, step synchronously."""
        if self.episode is None:
            return
        limit = min(target_dwells, self.episode.num_steps)
        current = len(self.cached_dwells)

        if self.is_computing:
            # Background thread is running — wait for it to reach our target
            timeout = 30.0  # max wait seconds
            start = time.time()
            while len(self.cached_dwells) < limit and self.is_computing:
                if time.time() - start > timeout:
                    break
                time.sleep(0.05)
        elif current < limit:
            # No background thread — step synchronously
            for step in range(current, limit):
                dwell = self._step_one_dwell(step)
                self.cached_dwells.append(dwell)

    def _step_one_dwell(self, step_idx: int) -> Dict[str, Any]:
        """Execute one dwell step on both Adaptive ML and Open Loop environments."""
        dwell_number = step_idx + 1  # 1-indexed
        start_ms = step_idx * DWELL_DURATION_MS
        end_ms = dwell_number * DWELL_DURATION_MS
        time_window = f"{start_ms:.1f}–{end_ms:.1f} ms"

        # 1. Step Adaptive ML
        a_ml = self.linucb.select_action(self.env_ml)
        tr_ml = self.env_ml.step(a_ml)
        self.linucb.observe(self.env_ml, None, a_ml, tr_ml, None)

        # 2. Step Open Loop (Round Robin)
        a_ol = self.round_robin.select_action(self.env_ol)
        tr_ol = self.env_ol.step(a_ol)

        # 3. Fast O(1) Precomputed Ground Truth Active Emissions in step_idx
        detectable_so_far = self._cumulative_pulses[step_idx]
        self.running_detectable_pulses = detectable_so_far
        active_b = self._step_active_bands[step_idx]

        if not active_b:
            # Real quiet window: no active radar emissions
            emissions_list = []
            active_band_ids = []
            freq_str = "-"
            sig_type = "None (Quiet Window)"
        else:
            active_band_ids = [b + 1 for b, _ in active_b]
            emissions_list = [
                {
                    "bandId": b + 1,
                    "freq": BAND_CENTERS[b],
                    "type": BAND_TYPES[b],
                    "pulses": int(p),
                    "isDetected": (b == a_ml),
                }
                for b, p in active_b
            ]
            freq_str = ", ".join(BAND_CENTERS[b] for b, _ in active_b)
            sig_type = " | ".join(BAND_TYPES[b] for b, _ in active_b)

        ml_band_center = BAND_CENTERS[a_ml]
        ml_band_range = BAND_RANGES[a_ml]
        ol_band_center = BAND_CENTERS[a_ol]
        ol_band_range = BAND_RANGES[a_ol]

        ml_intercepted = bool(tr_ml.detected_pulses > 0)
        ol_intercepted = bool(tr_ol.detected_pulses > 0)

        # High-performance O(1) running metrics
        ml_emissions_so_far = max(int(self.env_ml.total_emission_opportunity_steps), 1)
        ml_correct_rate = (self.env_ml.total_selected_active_steps / ml_emissions_so_far) * 100.0
        ml_scan_rate = (self.env_ml.total_selected_active_steps / max(dwell_number, 1)) * 100.0

        if detectable_so_far > 0:
            ml_pd = (self.env_ml.total_detected_pulses / detectable_so_far) * 100.0
        else:
            ml_pd = ml_correct_rate

        ml_avg_r = self.env_ml.total_reward / dwell_number
        elapsed_s = max(end_ms / 1000.0, 1e-4)
        ml_intercept_rate = self.env_ml.total_detected_pulses / elapsed_s

        ol_emissions_so_far = max(int(self.env_ol.total_emission_opportunity_steps), 1)
        ol_correct_rate = (self.env_ol.total_selected_active_steps / ol_emissions_so_far) * 100.0
        ol_scan_rate = (self.env_ol.total_selected_active_steps / max(dwell_number, 1)) * 100.0
        if detectable_so_far > 0:
            ol_pd = (self.env_ol.total_detected_pulses / detectable_so_far) * 100.0
        else:
            ol_pd = ol_correct_rate

        ol_avg_r = self.env_ol.total_reward / dwell_number
        ol_intercept_rate = self.env_ol.total_detected_pulses / elapsed_s

        # Live Ground-Truth Average Intercept Delay (from emitter onset to first receiver intercept)
        for e in np.flatnonzero(self.env_ml.first_detect_step >= 0):
            if e not in self._ml_seen_emitters:
                self._ml_seen_emitters.add(e)
                first_obs = int(self.env_ml.first_observable_step[e])
                delay_ms = (int(self.env_ml.first_detect_step[e]) - first_obs) * DWELL_DURATION_MS
                self._ml_delay_sum += max(0.0, delay_ms)
                self._ml_delay_count += 1

        for e in np.flatnonzero(self.env_ol.first_detect_step >= 0):
            if e not in self._ol_seen_emitters:
                self._ol_seen_emitters.add(e)
                first_obs = int(self.env_ol.first_observable_step[e])
                delay_ms = (int(self.env_ol.first_detect_step[e]) - first_obs) * DWELL_DURATION_MS
                self._ol_delay_sum += max(0.0, delay_ms)
                self._ol_delay_count += 1

        ml_avg_delay = (self._ml_delay_sum / self._ml_delay_count) if self._ml_delay_count > 0 else 0.0
        ol_avg_delay = (self._ol_delay_sum / self._ol_delay_count) if self._ol_delay_count > 0 else 0.0

        # Live Channel Revisit Intervals (mean elapsed duration between consecutive visits to same channel)
        if self._ml_last_visit[a_ml] >= 0:
            revisit_ms = (step_idx - self._ml_last_visit[a_ml]) * DWELL_DURATION_MS
            self._ml_revisit_sum += revisit_ms
            self._ml_revisit_count += 1
        self._ml_last_visit[a_ml] = step_idx
        ml_mean_revisit = (self._ml_revisit_sum / self._ml_revisit_count) if self._ml_revisit_count > 0 else 0.0

        if self._ol_last_visit[a_ol] >= 0:
            revisit_ms = (step_idx - self._ol_last_visit[a_ol]) * DWELL_DURATION_MS
            self._ol_revisit_sum += revisit_ms
            self._ol_revisit_count += 1
        self._ol_last_visit[a_ol] = step_idx
        ol_mean_revisit = (self._ol_revisit_sum / self._ol_revisit_count) if self._ol_revisit_count > 0 else (len(self._ol_last_visit) * DWELL_DURATION_MS)

        dwell_item: Dict[str, Any] = {
            "dwellIndex": dwell_number,
            "startMs": start_ms,
            "endMs": end_ms,
            "timeWindow": time_window,
            "dwellTimeMs": DWELL_DURATION_MS,
            "reward": round(float(tr_ml.reward), 2),
            "environment": {
                "dwellTimeMs": DWELL_DURATION_MS,
                "startMs": start_ms,
                "endMs": end_ms,
                "timeWindow": time_window,
                "actualEmissionBand": active_band_ids[0] if active_band_ids else None,
                "actualEmissionBands": active_band_ids,
                "emissionFrequency": freq_str,
                "emissionFrequencies": [BAND_CENTERS[b] for b, _ in active_b],
                "signalType": sig_type,
                "emissions": emissions_list,
            },
            "adaptive": {
                "currentBand": a_ml + 1,
                "isIntercepted": ml_intercepted,
                "result": "HIT" if ml_intercepted else "SCAN MISS",
                "pulsesDetected": int(tr_ml.detected_pulses),
                "reward": round(float(tr_ml.reward), 2),
                "interceptedFrequency": ml_band_center if ml_intercepted else "-",
                "centerFreq": ml_band_center,
                "range": ml_band_range,
                "metrics": {
                    "scanRate": f"{ml_scan_rate:.1f}%",
                    "scanHitRate": f"{ml_scan_rate:.1f}%",
                    "correctScanRate": f"{ml_correct_rate:.1f}%",
                    "hitRate": f"{ml_scan_rate:.1f}%",
                    "interceptRate": f"{ml_intercept_rate:.2f} /s",
                    "probDetection": f"{ml_pd:.1f}%",
                    "avgInterceptDelay": f"{ml_avg_delay:.1f} ms" if self._ml_delay_count > 0 else "0.0 ms",
                    "avgReward": f"{ml_avg_r:+.3f}",
                    "cumulativeReward": f"{self.env_ml.total_reward:+.2f}",
                    "meanRevisitInterval": f"{ml_mean_revisit:.1f} ms" if self._ml_revisit_count > 0 else "0.0 ms",
                    "totalHits": int(self.env_ml.total_detected_pulses),
                    "dwellHits": int(self.env_ml.total_selected_active_steps),
                    "totalScanMisses": int(self.env_ml.total_scan_misses),
                    "totalMisses": int(self.env_ml.total_misses),
                    "totalDetected": int(self.env_ml.total_detected_pulses),
                    "totalActualEmissions": int(detectable_so_far),
                    "pulsesDetected": int(tr_ml.detected_pulses),
                },
            },
            "openLoop": {
                "currentBand": a_ol + 1,
                "isIntercepted": ol_intercepted,
                "result": "HIT" if ol_intercepted else "SCAN MISS",
                "pulsesDetected": int(tr_ol.detected_pulses),
                "reward": round(float(tr_ol.reward), 2),
                "interceptedFrequency": ol_band_center if ol_intercepted else "-",
                "centerFreq": ol_band_center,
                "range": ol_band_range,
                "metrics": {
                    "scanRate": f"{ol_scan_rate:.1f}%",
                    "scanHitRate": f"{ol_scan_rate:.1f}%",
                    "correctScanRate": f"{ol_correct_rate:.1f}%",
                    "hitRate": f"{ol_scan_rate:.1f}%",
                    "interceptRate": f"{ol_intercept_rate:.2f} /s",
                    "probDetection": f"{ol_pd:.1f}%",
                    "avgInterceptDelay": f"{ol_avg_delay:.1f} ms" if self._ol_delay_count > 0 else "0.0 ms",
                    "avgReward": f"{ol_avg_r:+.3f}",
                    "cumulativeReward": f"{self.env_ol.total_reward:+.2f}",
                    "meanRevisitInterval": f"{ol_mean_revisit:.1f} ms" if self._ol_revisit_count > 0 else f"{(len(self._ol_last_visit) * DWELL_DURATION_MS):.1f} ms",
                    "totalHits": int(self.env_ol.total_detected_pulses),
                    "dwellHits": int(self.env_ol.total_selected_active_steps),
                    "totalScanMisses": int(self.env_ol.total_scan_misses),
                    "totalMisses": int(self.env_ol.total_misses),
                    "totalDetected": int(self.env_ol.total_detected_pulses),
                    "totalActualEmissions": int(detectable_so_far),
                    "pulsesDetected": int(tr_ol.detected_pulses),
                },
            },
        }

        return dwell_item

    def get_dwell(self, dwell_idx_1_based: int) -> Optional[Dict[str, Any]]:
        """Get a dwell by 1-based index from cache, stepping on demand if needed."""
        if self.episode is not None and dwell_idx_1_based > len(self.cached_dwells):
            self.ensure_dwells(dwell_idx_1_based)
        idx = dwell_idx_1_based - 1
        if 0 <= idx < len(self.cached_dwells):
            return self.cached_dwells[idx]
        return None

    def get_dwell_history(self, from_idx: int = 1, to_idx: int = DEFAULT_TOTAL_DWELLS) -> List[Dict[str, Any]]:
        """Get historical dwell records by index range (1-indexed, inclusive), stepping on demand if needed."""
        if self.episode is not None and to_idx > len(self.cached_dwells):
            self.ensure_dwells(to_idx)
        start = max(0, from_idx - 1)
        end = min(len(self.cached_dwells), to_idx)
        return self.cached_dwells[start:end]

    def get_telemetry_snapshot(self) -> Dict[str, Any]:
        """Return latest telemetry snapshot compatible with the frontend."""
        total = self.total_dataset_dwells or len(self.cached_dwells)
        computed = len(self.cached_dwells)
        latest = self.cached_dwells[-1] if self.cached_dwells else None
        if not latest:
            return {"source": "backend", "status": "idle", "dwells": 0, "totalDwells": total}

        tail_start = max(0, computed - 20)
        batch = self.cached_dwells[tail_start:computed]
        is_done = not self.is_computing and computed >= total

        return {
            "source": "backend",
            "mode": "batch",
            "timestamp": int(time.time() * 1000),
            "totalDwells": total,
            "computedDwells": computed,
            "dwellIndex": computed,
            "isComputing": self.is_computing,
            "isComplete": is_done,
            "completionMessage": (
                f"Simulation completed! All {total} dwell windows "
                f"({(total * DWELL_DURATION_MS):.1f} ms) processed."
                if is_done else None
            ),
            "batch": batch,
            "batchStartIndex": tail_start + 1,
            "batchEndIndex": computed,
            "dwell": latest["environment"],
            "environment": latest["environment"],
            "adaptive": latest["adaptive"],
            "openLoop": latest["openLoop"],
            "modelState": self.get_linucb_model_state(),
        }

    def update_configuration(
        self,
        alpha: Optional[float] = None,
        regularization: Optional[float] = None,
        uncertainty_weight: Optional[float] = None,
        coverage_bonus_weight: Optional[float] = None,
        detection_probability: Optional[float] = None,
        amplitude_threshold_db: Optional[float] = None,
    ) -> None:
        """Update runtime configuration and recompute simulation."""
        if "linucb" not in self.raw_config:
            self.raw_config["linucb"] = {}
        if "receiver" not in self.raw_config:
            self.raw_config["receiver"] = {}

        if alpha is not None:
            self.raw_config["linucb"]["alpha"] = alpha
        if regularization is not None:
            self.raw_config["linucb"]["regularization"] = regularization
        if uncertainty_weight is not None:
            self.raw_config["linucb"]["uncertainty_weight"] = uncertainty_weight
        if coverage_bonus_weight is not None:
            self.raw_config["linucb"]["coverage_bonus_weight"] = coverage_bonus_weight
        if detection_probability is not None:
            self.raw_config["receiver"]["detection_probability"] = detection_probability
        if amplitude_threshold_db is not None:
            self.raw_config["receiver"]["amplitude_threshold_db"] = amplitude_threshold_db

        self.receiver_cfg = receiver_config(self.raw_config)
        self.reset_simulation()
        if self.episode is not None:
            self.start_background_compute()

    def get_detailed_metrics(self) -> Dict[str, Any]:
        """Return comprehensive scientific metrics comparing Adaptive ML with Open Loop."""
        if not self.env_ml or not self.env_ol:
            return {}

        sum_ml = self.env_ml.summary()
        sum_ol = self.env_ol.summary()

        return {
            "adaptive_ml": sum_ml,
            "open_loop": sum_ol,
            "figures_of_merit": {
                "relative_pulse_gain": (
                    (sum_ml["pulse_interception_ratio"] / max(sum_ol["pulse_interception_ratio"], 1e-6))
                    if sum_ol["pulse_interception_ratio"] > 0
                    else 1.0
                ),
                "relative_correct_scan_gain": (
                    (sum_ml["correct_scan_rate"] / max(sum_ol["correct_scan_rate"], 1e-6))
                    if sum_ol["correct_scan_rate"] > 0
                    else 1.0
                ),
                "delay_reduction_factor": (
                    (sum_ol["average_first_intercept_delay_s"] / max(sum_ml["average_first_intercept_delay_s"], 1e-6))
                    if sum_ml["average_first_intercept_delay_s"] > 0
                    else 1.0
                ),
            },
        }

    def get_linucb_model_state(self) -> Dict[str, Any]:
        """Return internal LinUCB model statistics and feature names."""
        if not self.linucb or self.linucb.a_inverse is None or self.linucb.b is None:
            return {"initialized": False}

        features = list(self.linucb._feature_names or [])
        shared = self.linucb.shared_model
        inverse = self.linucb.a_inverse[0] if shared else self.linucb.a_inverse
        b_vec = self.linucb.b[0] if shared else self.linucb.b
        theta = inverse @ b_vec if shared else (inverse @ b_vec[:, :, None]).squeeze(-1)

        weights = {
            features[i]: float(theta[i])
            for i in range(min(len(features), len(theta)))
        } if shared else {}

        return {
            "initialized": True,
            "shared_model": shared,
            "num_updates": self.linucb.num_updates,
            "last_predicted_reward": self.linucb.last_predicted_reward,
            "last_prediction_error": self.linucb.last_reward_prediction_error,
            "reward_prediction_mse": (
                self.linucb.reward_prediction_squared_error_sum
                / max(self.linucb.reward_prediction_count, 1)
            ),
            "feature_names": features,
            "weights": weights,
        }
