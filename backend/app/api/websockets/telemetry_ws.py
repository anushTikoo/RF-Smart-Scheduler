"""
WebSocket endpoints for live real-time telemetry streaming.

Two modes:
- "batch" (live): Model runs at full speed in background thread. WS polls
  cached_dwells every ~400ms and sends the LATEST batch + progress to frontend.
  NO calls to ensure_dwells or get_dwell_history — just reads from cached_dwells.
- "slow" (replay): After computation completes, steps through saved history
  one dwell at a time for decision-by-decision inspection.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Dict

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.core.config import DWELL_DURATION_MS
from app.services import engine

ws_router = APIRouter(tags=["WebSocket Telemetry"])


@ws_router.websocket("/ws/telemetry")
@ws_router.websocket("/ws/scan")
@ws_router.websocket("/ws/live")
async def websocket_telemetry_endpoint(
    websocket: WebSocket,
    mode: str = Query("batch", pattern="^(batch|slow)$"),
    batch_size: int = Query(20, ge=1, le=100),
    interval_ms: int = Query(400, ge=50, le=5000),
    auto_start: bool = Query(True),
    start_index: int = Query(0, ge=0),
):
    """
    WebSocket endpoint streaming live telemetry.

    LIVE mode (batch): Model runs at full speed in background thread.
    We just poll cached_dwells every ~400ms — NO computation gating, NO blocking.

    REPLAY mode (slow): Steps through saved cached_dwells one at a time.
    """
    await websocket.accept()

    # Session state
    is_active = auto_start
    stream_mode = mode
    chunk_size = batch_size
    step_interval = interval_ms / 1000.0
    current_index = start_index
    # Track how far we've reported to the frontend in live mode
    last_reported_computed = start_index

    # Command queue for bi-directional communication
    command_queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue()

    async def client_listener():
        try:
            while True:
                text = await websocket.receive_text()
                try:
                    await command_queue.put(json.loads(text))
                except json.JSONDecodeError:
                    pass
        except (WebSocketDisconnect, asyncio.CancelledError):
            pass

    listener_task = asyncio.create_task(client_listener())

    def get_total_dwells() -> int:
        if engine.total_dataset_dwells > 0:
            return engine.total_dataset_dwells
        if engine.episode is not None and engine.episode.num_steps > 0:
            return engine.episode.num_steps
        return len(engine.cached_dwells)

    try:
        while True:
            total_dwells = get_total_dwells()
            computed = len(engine.cached_dwells)

            # ── Process queued commands ──────────────────────────────
            while not command_queue.empty():
                cmd_data = command_queue.get_nowait()
                cmd = cmd_data.get("command", "").lower()

                if cmd == "start":
                    is_active = True
                    stream_mode = cmd_data.get("mode", stream_mode)
                    chunk_size = int(cmd_data.get("batch_size", chunk_size))
                    step_interval = float(cmd_data.get("interval_ms", step_interval * 1000)) / 1000.0
                    si = int(cmd_data.get("start_index", current_index))
                    current_index = si
                    last_reported_computed = si

                elif cmd == "pause":
                    if "dwell_index" in cmd_data:
                        current_index = max(0, min(total_dwells, int(cmd_data["dwell_index"])))
                        last_reported_computed = current_index
                    is_active = False

                elif cmd == "resume":
                    if "dwell_index" in cmd_data:
                        current_index = max(0, min(total_dwells, int(cmd_data["dwell_index"])))
                        last_reported_computed = current_index
                    is_active = True

                elif cmd == "replay":
                    current_index = 0
                    last_reported_computed = 0
                    is_active = True
                    if stream_mode == "batch" and engine.episode is not None:
                        engine.reset_simulation()
                        engine.start_background_compute()

                elif cmd == "scrub":
                    if total_dwells > 0:
                        if "dwell_index" in cmd_data:
                            current_index = max(0, min(total_dwells, int(cmd_data["dwell_index"])))
                        elif "time_ms" in cmd_data:
                            current_index = max(0, min(total_dwells, round(float(cmd_data["time_ms"]) / DWELL_DURATION_MS)))
                        last_reported_computed = current_index

                        # Return immediate snapshot from cache (no blocking ensure_dwells)
                        idx = min(current_index, computed)
                        if idx > 0 and idx <= computed:
                            dwell = engine.cached_dwells[idx - 1]
                            snap = {
                                "source": "backend",
                                "mode": "slow",
                                "timestamp": int(time.time() * 1000),
                                "totalDwells": total_dwells,
                                "computedDwells": computed,
                                "dwellIndex": idx,
                                "isComputing": engine.is_computing,
                                "isComplete": not engine.is_computing and idx >= total_dwells,
                                "singleDwell": dwell,
                                "environment": dwell["environment"],
                                "adaptive": dwell["adaptive"],
                                "openLoop": dwell["openLoop"],
                            }
                            await websocket.send_text(json.dumps(snap))

                elif cmd == "set_mode":
                    new_mode = cmd_data.get("mode", stream_mode)
                    if new_mode != stream_mode:
                        stream_mode = new_mode
                        if stream_mode == "slow":
                            current_index = 0
                            last_reported_computed = 0

                elif cmd == "set_interval":
                    step_interval = float(cmd_data.get("interval_ms", 400)) / 1000.0

                elif cmd == "reset":
                    current_index = 0
                    last_reported_computed = 0
                    is_active = False

                elif cmd == "step":
                    if computed > 0 and current_index < computed:
                        current_index += 1
                        dwell = engine.cached_dwells[current_index - 1]
                        snap = {
                            "source": "backend",
                            "mode": "slow",
                            "timestamp": int(time.time() * 1000),
                            "totalDwells": total_dwells,
                            "computedDwells": computed,
                            "dwellIndex": current_index,
                            "isComputing": engine.is_computing,
                            "isComplete": not engine.is_computing and current_index >= total_dwells,
                            "singleDwell": dwell,
                            "environment": dwell["environment"],
                            "adaptive": dwell["adaptive"],
                            "openLoop": dwell["openLoop"],
                        }
                        await websocket.send_text(json.dumps(snap))

            # ── Refresh counts ──────────────────────────────────────
            computed = len(engine.cached_dwells)

            if not computed and not engine.is_computing:
                await asyncio.sleep(0.3)
                continue

            if is_active:
                if stream_mode == "batch":
                    # ════════════════════════════════════════════════════
                    # LIVE MODE: Just poll cached_dwells — NO blocking.
                    # Send latest chunk_size dwells from the tail.
                    # ════════════════════════════════════════════════════
                    is_done = not engine.is_computing and computed >= total_dwells
                    if computed > last_reported_computed or is_done:
                        tail_start = max(0, computed - chunk_size)
                        batch = engine.cached_dwells[tail_start:computed]
                        latest = batch[-1] if batch else None

                        if latest:
                            snapshot = {
                                "source": "backend",
                                "mode": "batch",
                                "timestamp": int(time.time() * 1000),
                                "totalDwells": total_dwells,
                                "computedDwells": computed,
                                "dwellIndex": computed,
                                "isComputing": engine.is_computing,
                                "isComplete": is_done,
                                "completionMessage": (
                                    f"Simulation completed! All {total_dwells} dwell windows "
                                    f"({(total_dwells * DWELL_DURATION_MS):.1f} ms) processed."
                                    if is_done else None
                                ),
                                "batch": batch,
                                "batchStartIndex": tail_start + 1,
                                "batchEndIndex": computed,
                                "environment": latest["environment"],
                                "adaptive": latest["adaptive"],
                                "openLoop": latest["openLoop"],
                            }
                            await websocket.send_text(json.dumps(snapshot))

                        last_reported_computed = computed
                        if is_done:
                            is_active = False

                else:
                    # ════════════════════════════════════════════════════
                    # REPLAY MODE: Step through saved history one at a time.
                    # Read directly from cache — NO blocking ensure_dwells.
                    # ════════════════════════════════════════════════════
                    if current_index < computed:
                        current_index += 1
                        is_complete = not engine.is_computing and current_index >= total_dwells
                        dwell = engine.cached_dwells[current_index - 1]

                        snapshot = {
                            "source": "backend",
                            "mode": "slow",
                            "timestamp": int(time.time() * 1000),
                            "totalDwells": total_dwells,
                            "computedDwells": computed,
                            "dwellIndex": current_index,
                            "isComputing": engine.is_computing,
                            "isComplete": is_complete,
                            "completionMessage": (
                                f"Replay completed! All {total_dwells} dwells "
                                f"({(total_dwells * DWELL_DURATION_MS):.1f} ms) inspected."
                                if is_complete else None
                            ),
                            "singleDwell": dwell,
                            "environment": dwell["environment"],
                            "adaptive": dwell["adaptive"],
                            "openLoop": dwell["openLoop"],
                        }
                        await websocket.send_text(json.dumps(snapshot))

                        if is_complete:
                            is_active = False

            await asyncio.sleep(step_interval if is_active else 0.2)

    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    finally:
        listener_task.cancel()
