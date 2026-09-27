"""
Pydantic models and request/response schemas for the API.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class ConfigUpdateRequest(BaseModel):
    alpha: Optional[float] = Field(None, ge=0.0, description="LinUCB exploration parameter alpha")
    regularization: Optional[float] = Field(None, gt=0.0, description="Ridge regression regularization lambda")
    uncertainty_weight: Optional[float] = Field(None, ge=0.0, description="Weight for uncertainty bonus")
    coverage_bonus_weight: Optional[float] = Field(None, ge=0.0, description="Urgency / coverage bonus weight")
    detection_probability: Optional[float] = Field(None, ge=0.0, le=1.0, description="Receiver detection probability")
    amplitude_threshold_db: Optional[float] = Field(None, description="Receiver sensitivity threshold in dB")


class BenchmarkRequest(BaseModel):
    num_dwells: int = Field(120, ge=10, le=2000, description="Number of dwells to evaluate across schedulers")
