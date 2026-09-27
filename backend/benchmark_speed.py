"""
Benchmark: Time how fast the raw model runs on THIS machine.
No frontend, no WebSocket, no threading — pure model speed.
"""
import sys
import time
from pathlib import Path

# Add model source to path
sys.path.insert(0, str(Path(__file__).resolve().parent / "model" / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.services.simulation_engine import SimulationEngine

H5_PATH = Path(__file__).resolve().parent / "config_1.h5"
if not H5_PATH.exists():
    print(f"ERROR: {H5_PATH} not found")
    sys.exit(1)

print(f"Loading dataset: {H5_PATH}")
engine = SimulationEngine()

t0 = time.perf_counter()
info = engine.load_h5_dataset(H5_PATH, dataset_label="config_1.h5")
t_load = time.perf_counter() - t0
print(f"Dataset loaded in {t_load:.2f}s")
print(f"Total dwells: {engine.total_dataset_dwells}")
print(f"Background thread started: is_computing={engine.is_computing}")

# Stop the background thread — we want to benchmark synchronously
engine.stop_background_compute()
engine.reset_simulation()
print(f"After reset: cached_dwells={len(engine.cached_dwells)}")

# Benchmark: compute ALL dwells synchronously
total = engine.total_dataset_dwells
print(f"\nBenchmarking {total} dwells synchronously (no WS, no threads)...")
t_start = time.perf_counter()
last_report = t_start

for step in range(total):
    dwell = engine._step_one_dwell(step)
    engine.cached_dwells.append(dwell)

    now = time.perf_counter()
    if now - last_report >= 2.0:
        elapsed = now - t_start
        rate = (step + 1) / elapsed
        eta = (total - step - 1) / rate if rate > 0 else 0
        print(f"  Step {step+1}/{total} | {rate:.0f} dwells/sec | elapsed={elapsed:.1f}s | ETA={eta:.1f}s")
        last_report = now

t_end = time.perf_counter()
total_time = t_end - t_start
rate = total / total_time if total_time > 0 else 0

print(f"\n{'='*60}")
print(f"BENCHMARK RESULTS:")
print(f"  Total dwells:    {total}")
print(f"  Total time:      {total_time:.2f}s")
print(f"  Speed:           {rate:.0f} dwells/sec")
print(f"  Per dwell:       {(total_time/total)*1000:.3f} ms")
print(f"{'='*60}")

# Also test: how fast is the background THREAD?
engine.reset_simulation()
print(f"\nBenchmarking background thread (same dwells)...")
t_thread_start = time.perf_counter()
engine.start_background_compute()

# Wait for it to finish
while engine.is_computing:
    time.sleep(0.5)
    computed = len(engine.cached_dwells)
    elapsed = time.perf_counter() - t_thread_start
    rate = computed / elapsed if elapsed > 0 else 0
    print(f"  Thread progress: {computed}/{total} | {rate:.0f} dwells/sec | {elapsed:.1f}s elapsed")

t_thread_end = time.perf_counter()
thread_time = t_thread_end - t_thread_start
thread_rate = total / thread_time if thread_time > 0 else 0

print(f"\nTHREAD BENCHMARK RESULTS:")
print(f"  Total dwells:    {total}")
print(f"  Total time:      {thread_time:.2f}s")
print(f"  Speed:           {thread_rate:.0f} dwells/sec")
print(f"  Per dwell:       {(thread_time/total)*1000:.3f} ms")
print(f"{'='*60}")
