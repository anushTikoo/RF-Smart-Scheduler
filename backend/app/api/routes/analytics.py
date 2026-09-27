"""
Model analytics, Figures of Merit, and benchmark router.
"""

from fastapi import APIRouter, HTTPException, status
from app.core.models import BenchmarkRequest
from app.services import BenchmarkService, engine

router = APIRouter(prefix="/api", tags=["Model Analytics"])


@router.get("/metrics")
async def get_metrics():
    """Retrieve detailed Figures of Merit (FOMs) and comparative performance analytics."""
    return engine.get_detailed_metrics()


@router.get("/model/state")
async def get_model_state():
    """Retrieve internal LinUCB learned parameter weights, prediction errors, and statistics."""
    return engine.get_linucb_model_state()


@router.post("/benchmark")
async def run_benchmark(req: BenchmarkRequest):
    """Run full comparative benchmark across LinUCB, RoundRobin, Random, and Oracle."""
    if engine.episode is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No dataset loaded to benchmark",
        )

    try:
        alpha = float(engine.raw_config.get("linucb", {}).get("alpha", 0.5))
        regularization = float(engine.raw_config.get("linucb", {}).get("regularization", 1.0))
        return BenchmarkService.run(
            episode=engine.episode,
            receiver_cfg=engine.receiver_cfg,
            reward_cfg=engine.reward_cfg,
            context_cfg=engine.context_cfg,
            dataset_name=engine.dataset_name,
            num_dwells=req.num_dwells,
            seed=int(engine.raw_config.get("seed", 42)),
            alpha=alpha,
            regularization=regularization,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Benchmark execution failed: {exc}",
        )
