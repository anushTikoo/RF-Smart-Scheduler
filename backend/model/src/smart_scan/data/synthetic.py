from __future__ import annotations

import numpy as np

from smart_scan.data.episode import Episode


def make_synthetic_episode(
    *,
    num_steps: int = 600,
    num_bands: int = 12,
    num_emitters: int = 8,
    time_bin_s: float = 0.005,
    seed: int = 42,
) -> Episode:
    """Create a deterministic, periodic environment for smoke tests and demos."""

    if min(num_steps, num_bands, num_emitters) <= 0:
        raise ValueError("synthetic dimensions must be positive")
    rng = np.random.default_rng(seed)
    pulse_count = np.zeros((num_steps, num_bands), dtype=np.int32)
    max_amplitude = np.full((num_steps, num_bands), -np.inf, dtype=np.float32)
    presence = np.zeros((num_steps, num_bands, num_emitters), dtype=bool)

    for emitter in range(num_emitters):
        home_band = int(rng.integers(0, num_bands))
        period = int(rng.integers(4, 25))
        phase = int(rng.integers(0, period))
        agile = emitter % 3 == 0
        for step in range(phase, num_steps, period):
            band = (home_band + (step // period if agile else 0)) % num_bands
            pulses = int(rng.integers(1, 6))
            pulse_count[step, band] += pulses
            max_amplitude[step, band] = max(max_amplitude[step, band], rng.uniform(-95, -45))
            presence[step, band, emitter] = True

    noise_events = rng.random((num_steps, num_bands)) < 0.01
    pulse_count[noise_events] += 1
    max_amplitude[noise_events] = np.maximum(max_amplitude[noise_events], -115.0)
    edges = 500.0 + np.arange(num_bands + 1) * 500.0
    return Episode(
        pulse_count=pulse_count,
        max_amplitude_db=max_amplitude,
        emitter_presence=presence,
        band_edges_mhz=edges,
        time_bin_s=time_bin_s,
        emitter_labels=np.arange(num_emitters, dtype=np.int16),
        source=f"synthetic:seed={seed}",
    )

