from __future__ import annotations

from pathlib import Path

import numpy as np

from smart_scan.data.download import load_manifest, remote_path
from smart_scan.data.episode import Episode


def pulse_train_to_episode(
    data: np.ndarray,
    labels: np.ndarray,
    *,
    frequency_min_mhz: float = 500.0,
    frequency_max_mhz: float = 18_000.0,
    bandwidth_mhz: float = 500.0,
    dwell_ms: float = 5.0,
    source: str = "",
) -> Episode:
    data = np.asarray(data)
    labels = np.asarray(labels).reshape(-1)
    if data.ndim != 2 or data.shape[1] < 5:
        raise ValueError("PDW data must have shape [pulses, >=5]")
    if len(data) != len(labels):
        raise ValueError("data and labels must contain the same number of pulses")
    if not frequency_max_mhz > frequency_min_mhz:
        raise ValueError("frequency_max_mhz must exceed frequency_min_mhz")
    if bandwidth_mhz <= 0 or dwell_ms <= 0:
        raise ValueError("bandwidth_mhz and dwell_ms must be positive")

    num_bands_float = (frequency_max_mhz - frequency_min_mhz) / bandwidth_mhz
    num_bands = int(round(num_bands_float))
    if not np.isclose(num_bands, num_bands_float):
        raise ValueError("frequency range must be divisible by bandwidth")
    edges = frequency_min_mhz + np.arange(num_bands + 1) * bandwidth_mhz

    if len(data) == 0:
        return Episode(
            pulse_count=np.zeros((1, num_bands), dtype=np.int32),
            max_amplitude_db=np.full((1, num_bands), -np.inf, dtype=np.float32),
            emitter_presence=np.zeros((1, num_bands, 0), dtype=bool),
            band_edges_mhz=edges,
            time_bin_s=dwell_ms / 1000.0,
            emitter_labels=np.asarray([], dtype=np.int64),
            source=source,
        )

    toa_us = data[:, 0].astype(np.float64, copy=False)
    frequency_mhz = data[:, 1].astype(np.float64, copy=False)
    amplitude_db = data[:, 4].astype(np.float32, copy=False)
    finite = np.isfinite(toa_us) & np.isfinite(frequency_mhz) & np.isfinite(amplitude_db)
    in_range = (frequency_mhz >= frequency_min_mhz) & (frequency_mhz < frequency_max_mhz)
    valid = finite & in_range
    if not np.any(valid):
        raise ValueError("no valid PDWs fall inside the configured frequency range")

    start_us = float(np.min(toa_us[valid]))
    time_bin_us = dwell_ms * 1000.0
    time_index = np.floor((toa_us[valid] - start_us) / time_bin_us).astype(np.int64)
    band_index = np.floor(
        (frequency_mhz[valid] - frequency_min_mhz) / bandwidth_mhz
    ).astype(np.int64)
    num_steps = int(time_index.max()) + 1

    counts = np.zeros((num_steps, num_bands), dtype=np.int32)
    max_amp = np.full((num_steps, num_bands), -np.inf, dtype=np.float32)
    np.add.at(counts, (time_index, band_index), 1)
    np.maximum.at(max_amp, (time_index, band_index), amplitude_db[valid])

    unique_labels, remapped = np.unique(labels[valid], return_inverse=True)
    presence = np.zeros((num_steps, num_bands, len(unique_labels)), dtype=bool)
    presence[time_index, band_index, remapped] = True

    cell_id = time_index * num_bands + band_index
    order = np.argsort(cell_id, kind="stable")
    sorted_cell_id = cell_id[order]
    cell_counts = np.bincount(sorted_cell_id, minlength=num_steps * num_bands)
    cell_offsets = np.concatenate(
        [np.asarray([0], dtype=np.int64), np.cumsum(cell_counts, dtype=np.int64)]
    )

    return Episode(
        pulse_count=counts,
        max_amplitude_db=max_amp,
        emitter_presence=presence,
        band_edges_mhz=edges,
        time_bin_s=dwell_ms / 1000.0,
        emitter_labels=unique_labels,
        source=source,
        event_time_s=((toa_us[valid] - start_us) / 1e6)[order],
        event_time_index=time_index[order].astype(np.int32, copy=False),
        event_band_index=band_index[order].astype(np.int16, copy=False),
        event_amplitude_db=amplitude_db[valid][order],
        event_emitter_index=remapped[order].astype(np.int16, copy=False),
        cell_offsets=cell_offsets,
    )


def preprocess_h5(path: str | Path, output_path: str | Path, **kwargs: float) -> Episode:
    try:
        import h5py
    except ImportError as exc:
        raise RuntimeError("h5py is required to preprocess the radar dataset") from exc

    source = Path(path)
    with h5py.File(source, "r") as handle:
        if "data" not in handle or "labels" not in handle:
            raise ValueError(f"{source} does not contain top-level data and labels datasets")
        data = handle["data"][:]
        labels = handle["labels"][:]
    episode = pulse_train_to_episode(data, labels, source=str(source), **kwargs)
    episode.save(output_path)
    return episode


def preprocess_manifest(
    manifest_path: str | Path,
    raw_dir: str | Path,
    output_dir: str | Path,
    **kwargs: float,
) -> list[Path]:
    manifest = load_manifest(manifest_path)
    raw_root = Path(raw_dir)
    processed_root = Path(output_dir)
    outputs: list[Path] = []
    for item in manifest["files"]:
        source = raw_root / remote_path(item)
        target = processed_root / item["mode"] / item["split"] / f"config_{item['config_id']}.npz"
        preprocess_h5(source, target, **kwargs)
        outputs.append(target)
    return outputs
