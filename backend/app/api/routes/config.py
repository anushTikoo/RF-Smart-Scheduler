"""
Configuration inspection and tuning router.
"""

from fastapi import APIRouter
from app.core.config import DWELL_DURATION_MS
from app.core.models import ConfigUpdateRequest
from app.services import engine

router = APIRouter(prefix="/api/config", tags=["Configuration"])


@router.get("")
async def get_active_config():
    """Get current receiver, reward, and LinUCB algorithm configuration."""
    return {
        "receiver": {
            "frequency_min_mhz": 500.0,
            "frequency_max_mhz": 18000.0,
            "bandwidth_mhz": 875.0,
            "dwell_ms": DWELL_DURATION_MS,
            "amplitude_threshold_db": engine.receiver_cfg.amplitude_threshold_db,
            "detection_probability": engine.receiver_cfg.detection_probability,
            "false_alarm_probability": engine.receiver_cfg.false_alarm_probability,
        },
        "reward": {
            "pulse_intercept_weight": engine.reward_cfg.pulse_intercept_weight,
            "acquisition_delay_weight_per_s": engine.reward_cfg.acquisition_delay_weight_per_s,
            "miss_penalty": engine.reward_cfg.miss_penalty,
            "missed_opportunity_penalty_per_s": engine.reward_cfg.missed_opportunity_penalty_per_s,
        },
        "linucb": {
            "alpha": engine.linucb.alpha if engine.linucb else 0.5,
            "regularization": engine.linucb.regularization if engine.linucb else 1.0,
            "uncertainty_weight": engine.linucb.uncertainty_weight if engine.linucb else 0.75,
            "coverage_bonus_weight": engine.linucb.coverage_bonus_weight if engine.linucb else 1.0,
            "context_version": "v2",
            "shared_model": True,
        },
    }


@router.post("")
async def update_config(req: ConfigUpdateRequest):
    """Dynamically adjust RL and receiver parameters during runtime."""
    engine.update_configuration(
        alpha=req.alpha,
        regularization=req.regularization,
        uncertainty_weight=req.uncertainty_weight,
        coverage_bonus_weight=req.coverage_bonus_weight,
        detection_probability=req.detection_probability,
        amplitude_threshold_db=req.amplitude_threshold_db,
    )
    return {
        "message": "Configuration updated successfully and simulation recomputed",
        "new_config": await get_active_config(),
    }
