from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np


@dataclass(slots=True)
class Episode:
    """Time-frequency truth grid derived from one pulse-train file."""

    pulse_count: np.ndarray
    max_amplitude_db: np.ndarray
    emitter_presence: np.ndarray
    band_edges_mhz: np.ndarray
    time_bin_s: float
    emitter_labels: np.ndarray
    source: str = ""
    event_time_s: np.ndarray | None = None
    event_time_index: np.ndarray | None = None
    event_band_index: np.ndarray | None = None
    event_amplitude_db: np.ndarray | None = None
    event_emitter_index: np.ndarray | None = None
    cell_offsets: np.ndarray | None = None
    _truth_cache: dict[float, tuple[np.ndarray, np.ndarray, np.ndarray]] = field(
        default_factory=dict, init=False, repr=False
    )

    def __post_init__(self) -> None:
        if self.pulse_count.ndim != 2:
            raise ValueError("pulse_count must have shape [time, band]")
        if self.max_amplitude_db.shape != self.pulse_count.shape:
            raise ValueError("max_amplitude_db must match pulse_count")
        expected = (*self.pulse_count.shape, len(self.emitter_labels))
        if self.emitter_presence.shape != expected:
            raise ValueError(
                f"emitter_presence must have shape {expected}, got {self.emitter_presence.shape}"
            )
        if len(self.band_edges_mhz) != self.pulse_count.shape[1] + 1:
            raise ValueError("band_edges_mhz must contain one more edge than bands")
        if self.time_bin_s <= 0:
            raise ValueError("time_bin_s must be positive")
        event_arrays = (
            self.event_time_s,
            self.event_time_index,
            self.event_band_index,
            self.event_amplitude_db,
            self.event_emitter_index,
        )
        supplied = [value is not None for value in event_arrays]
        if any(supplied) and not all(supplied):
            raise ValueError("all sparse event arrays must be supplied together")
        if all(supplied):
            lengths = {len(value) for value in event_arrays if value is not None}
            if len(lengths) != 1:
                raise ValueError("sparse event arrays must have equal lengths")
            expected_offsets = self.num_steps * self.num_bands + 1
            if self.cell_offsets is None or len(self.cell_offsets) != expected_offsets:
                raise ValueError(f"cell_offsets must have length {expected_offsets}")

    @property
    def num_steps(self) -> int:
        return int(self.pulse_count.shape[0])

    @property
    def num_bands(self) -> int:
        return int(self.pulse_count.shape[1])

    @property
    def num_emitters(self) -> int:
        return int(self.emitter_presence.shape[2])

    @property
    def emitter_count(self) -> np.ndarray:
        return self.emitter_presence.sum(axis=2, dtype=np.int16)

    @property
    def has_sparse_events(self) -> bool:
        return self.event_time_s is not None

    def detectable_truth(
        self, amplitude_threshold_db: float
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Return pulse count, max amplitude, and emitter presence after pulse-level thresholding."""

        key = float(amplitude_threshold_db)
        if key in self._truth_cache:
            return self._truth_cache[key]
        if not self.has_sparse_events:
            detectable = self.max_amplitude_db >= key
            result = (
                self.pulse_count * detectable,
                np.where(detectable, self.max_amplitude_db, -np.inf),
                self.emitter_presence & detectable[:, :, None],
            )
            self._truth_cache[key] = result
            return result

        assert self.event_amplitude_db is not None
        assert self.event_time_index is not None
        assert self.event_band_index is not None
        assert self.event_emitter_index is not None
        selected = self.event_amplitude_db >= key
        time_index = self.event_time_index[selected]
        band_index = self.event_band_index[selected]
        counts = np.zeros((self.num_steps, self.num_bands), dtype=np.int32)
        maximum = np.full((self.num_steps, self.num_bands), -np.inf, dtype=np.float32)
        presence = np.zeros(
            (self.num_steps, self.num_bands, self.num_emitters), dtype=bool
        )
        np.add.at(counts, (time_index, band_index), 1)
        np.maximum.at(maximum, (time_index, band_index), self.event_amplitude_db[selected])
        presence[
            time_index,
            band_index,
            self.event_emitter_index[selected],
        ] = True
        result = (counts, maximum, presence)
        self._truth_cache[key] = result
        return result

    def cell_event_slice(self, time_index: int, band_index: int) -> slice:
        if self.cell_offsets is None:
            return slice(0, 0)
        cell = time_index * self.num_bands + band_index
        return slice(int(self.cell_offsets[cell]), int(self.cell_offsets[cell + 1]))

    def save(self, path: str | Path) -> Path:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = dict(
            pulse_count=self.pulse_count.astype(np.int32, copy=False),
            max_amplitude_db=self.max_amplitude_db.astype(np.float32, copy=False),
            emitter_presence=self.emitter_presence.astype(bool, copy=False),
            band_edges_mhz=self.band_edges_mhz.astype(np.float32, copy=False),
            time_bin_s=np.asarray(self.time_bin_s, dtype=np.float64),
            emitter_labels=self.emitter_labels,
            source=np.asarray(self.source),
        )
        if self.has_sparse_events:
            payload.update(
                event_time_s=np.asarray(self.event_time_s, dtype=np.float64),
                event_time_index=np.asarray(self.event_time_index, dtype=np.int32),
                event_band_index=np.asarray(self.event_band_index, dtype=np.int16),
                event_amplitude_db=np.asarray(self.event_amplitude_db, dtype=np.float32),
                event_emitter_index=np.asarray(self.event_emitter_index, dtype=np.int16),
                cell_offsets=np.asarray(self.cell_offsets, dtype=np.int64),
            )
        np.savez_compressed(target, **payload)
        return target

    @classmethod
    def load(cls, path: str | Path) -> "Episode":
        with np.load(path, allow_pickle=False) as payload:
            keys = set(payload.files)
            return cls(
                pulse_count=payload["pulse_count"],
                max_amplitude_db=payload["max_amplitude_db"],
                emitter_presence=payload["emitter_presence"],
                band_edges_mhz=payload["band_edges_mhz"],
                time_bin_s=float(payload["time_bin_s"]),
                emitter_labels=payload["emitter_labels"],
                source=str(payload["source"]),
                event_time_s=payload["event_time_s"] if "event_time_s" in keys else None,
                event_time_index=(
                    payload["event_time_index"] if "event_time_index" in keys else None
                ),
                event_band_index=(
                    payload["event_band_index"] if "event_band_index" in keys else None
                ),
                event_amplitude_db=(
                    payload["event_amplitude_db"] if "event_amplitude_db" in keys else None
                ),
                event_emitter_index=(
                    payload["event_emitter_index"] if "event_emitter_index" in keys else None
                ),
                cell_offsets=payload["cell_offsets"] if "cell_offsets" in keys else None,
            )
