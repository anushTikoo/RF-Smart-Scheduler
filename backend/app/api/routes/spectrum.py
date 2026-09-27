"""
RF Spectrum channels and band definitions router.
"""

from fastapi import APIRouter
from app.core.config import SPECTRUM_BANDS

router = APIRouter(prefix="/api/bands", tags=["Spectrum"])


@router.get("")
async def get_spectrum_bands():
    """Return definition of all 20 RF spectrum channels (500 MHz - 18 GHz)."""
    return {
        "total_bands": len(SPECTRUM_BANDS),
        "bandwidth_per_channel_mhz": 875.0,
        "frequency_min_mhz": 500.0,
        "frequency_max_mhz": 18000.0,
        "bands": SPECTRUM_BANDS,
    }
