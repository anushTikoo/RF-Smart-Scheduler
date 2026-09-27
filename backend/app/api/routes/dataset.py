"""
Dataset information and file upload router.
"""

import shutil
from pathlib import Path
from fastapi import APIRouter, File, HTTPException, UploadFile, status

from app.core.config import UPLOAD_DIR
from app.services import engine

router = APIRouter(prefix="/api", tags=["Dataset"])
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@router.get("/dataset/info")
async def get_dataset_info():
    """Get metadata about the loaded HDF5 dataset."""
    return engine.get_dataset_info()


@router.post("/upload")
async def upload_dataset(file: UploadFile = File(...)):
    """Upload a new .h5 dataset file to run live scheduling on."""
    if not file.filename.lower().endswith(".h5"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be an HDF5 dataset with extension .h5",
        )

    saved_path = UPLOAD_DIR / file.filename
    try:
        with saved_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        info = engine.load_h5_dataset(saved_path, dataset_label=file.filename)
        return {
            "message": f"Successfully loaded dataset: {file.filename}",
            "dataset": info,
        }
    except Exception as exc:
        if saved_path.exists():
            saved_path.unlink()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to process HDF5 dataset: {exc}",
        )
