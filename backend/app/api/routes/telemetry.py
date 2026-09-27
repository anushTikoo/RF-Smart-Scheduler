"""
Telemetry and dwell history query router.
"""

from fastapi import APIRouter, HTTPException, Query, status
from app.core.config import DEFAULT_TOTAL_DWELLS
from app.services import engine

router = APIRouter(tags=["Telemetry"])


@router.get("/api/telemetry")
async def get_telemetry():
    """Return latest telemetry snapshot compatible with the frontend client."""
    return engine.get_telemetry_snapshot()


@router.get("/api/dwells")
async def get_dwell_history(
    from_index: int = Query(1, ge=1, description="Starting dwell index (1-indexed, inclusive)"),
    to_index: int = Query(DEFAULT_TOTAL_DWELLS, ge=1, description="Ending dwell index (1-indexed, inclusive)"),
    limit: int = Query(500, ge=1, le=10000, description="Maximum number of dwells to return"),
):
    """Retrieve historical dwell records by index range."""
    adjusted_to = min(to_index, from_index + limit - 1)
    dwells = engine.get_dwell_history(from_index, adjusted_to)
    return {
        "from_index": from_index,
        "to_index": adjusted_to,
        "count": len(dwells),
        "dwells": dwells,
    }


@router.get("/api/dwells/{dwell_index}")
async def get_single_dwell(dwell_index: int):
    """Retrieve details for a specific dwell window (1-indexed)."""
    dwell = engine.get_dwell(dwell_index)
    if not dwell:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dwell index {dwell_index} not found. Available range: 1 to {len(engine.cached_dwells)}",
        )
    return dwell


@router.post("/api/reset")
async def reset_simulation():
    """Reset the scan simulation back to step 0."""
    engine.reset_simulation()
    engine.start_background_compute()
    return {"message": "Simulation reset to dwell 0", "dataset": engine.dataset_name}


@router.get("/api/export/csv")
async def export_full_csv(
    view_mode: str = Query("receiver", pattern="^(receiver|environment)$"),
    filter_type: str = Query("all", pattern="^(all|interceptions|misses|emissions)$"),
):
    """
    Stream complete simulation dwell history as CSV directly from backend cache.
    Applies viewMode and filter criteria across all 58,415+ decisions.
    """
    import csv
    import io
    from fastapi.responses import StreamingResponse

    def generate_csv():
        output = io.StringIO()
        writer = csv.writer(output)

        is_env = view_mode == "environment"
        headers = (
            ["Dwell Index", "Time Window", "Selected Band", "Intercepted Frequency", "Result", "Reward", "Pulses Detected", "Active Emissions in Window", "Frequency Range"]
            if is_env
            else ["Dwell Index", "Time Window", "Selected Band", "Intercepted Frequency", "Result", "Reward", "Pulses Detected", "Frequency Range"]
        )
        writer.writerow(headers)
        yield output.getvalue()
        output.seek(0)
        output.truncate(0)

        for dwell in engine.cached_dwells:
            adapt = dwell.get("adaptive", {})
            env = dwell.get("environment", {})
            is_hit = bool(adapt.get("isIntercepted"))
            has_emissions = bool(env.get("actualEmissionBands"))

            # Filter check
            if filter_type == "interceptions" and not is_hit:
                continue
            if filter_type == "misses" and is_hit:
                continue
            if filter_type == "emissions" and not has_emissions:
                continue

            dwell_idx = dwell.get("dwellIndex", "")
            time_win = dwell.get("timeWindow", "")
            band_str = f"Band {adapt.get('currentBand', 1)}"
            intercepted_freq = adapt.get("interceptedFrequency", "-")
            res_str = adapt.get("result", "HIT" if is_hit else "SCAN MISS")
            reward_val = adapt.get("reward", 0.0)
            reward_str = f"+{reward_val:.2f}" if reward_val > 0 else f"{reward_val:.2f}"
            pulses = adapt.get("pulsesDetected", 0)
            freq_range = adapt.get("range", "")

            if is_env:
                emissions_list = env.get("emissions", [])
                if emissions_list:
                    em_str = " • ".join(
                        f"Band {e.get('bandId')} ({e.get('freq')}) [{'Detected' if e.get('isDetected') else 'Missed'}]"
                        for e in emissions_list
                    )
                else:
                    em_str = "None (Quiet Window)"
                row = [dwell_idx, time_win, band_str, intercepted_freq, res_str, reward_str, pulses, em_str, freq_range]
            else:
                row = [dwell_idx, time_win, band_str, intercepted_freq, res_str, reward_str, pulses, freq_range]

            writer.writerow(row)
            yield output.getvalue()
            output.seek(0)
            output.truncate(0)

    dataset_label = engine.dataset_name or "simulation"
    filename = f"rf_scheduler_{dataset_label}_{view_mode}_{filter_type}.csv"
    return StreamingResponse(
        generate_csv(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
