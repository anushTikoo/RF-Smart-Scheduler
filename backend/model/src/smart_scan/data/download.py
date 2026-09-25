from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

DATASET_ID = "alan-turing-institute/turing-synthetic-radar-dataset"
TOKEN_VARIABLES = ("HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "HUGGING_FACE_TOKEN")


def load_manifest(path: str | Path) -> dict[str, Any]:
    with Path(path).open("r", encoding="utf-8") as stream:
        manifest = json.load(stream)
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise ValueError("manifest must contain a non-empty files list")
    return manifest


def remote_path(item: dict[str, Any]) -> str:
    split = str(item["split"])
    mode = str(item["mode"])
    config_id = int(item["config_id"])
    if split not in {"train", "val", "test"}:
        raise ValueError(f"unsupported split: {split}")
    if mode not in {"stare", "scan"}:
        raise ValueError(f"unsupported mode: {mode}")
    return f"{mode}/{split}_{mode}/config_{config_id}.h5"


def configured_token() -> str | None:
    return next((os.environ.get(name) for name in TOKEN_VARIABLES if os.environ.get(name)), None)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_manifest(
    manifest_path: str | Path,
    output_dir: str | Path,
    *,
    token: str | None = None,
) -> list[dict[str, Any]]:
    """Download only the files explicitly named in the manifest."""

    try:
        from huggingface_hub import hf_hub_download
    except ImportError as exc:
        raise RuntimeError("Install the project dependencies before downloading data") from exc

    manifest = load_manifest(manifest_path)
    repo_id = manifest.get("dataset_id", DATASET_ID)
    access_token = token or configured_token()
    if not access_token:
        raise RuntimeError(
            "No Hugging Face token found. Set HF_TOKEN in the current shell after "
            "accepting the gated dataset conditions."
        )

    root = Path(output_dir)
    root.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, Any]] = []
    for item in manifest["files"]:
        filename = remote_path(item)
        downloaded = Path(
            hf_hub_download(
                repo_id=repo_id,
                repo_type="dataset",
                filename=filename,
                local_dir=root,
                token=access_token,
            )
        )
        records.append(
            {
                **item,
                "remote_path": filename,
                "local_path": str(downloaded),
                "size_bytes": downloaded.stat().st_size,
                "sha256": sha256(downloaded),
            }
        )

    receipt = root / "download_receipt.json"
    receipt.write_text(json.dumps(records, indent=2), encoding="utf-8")
    return records

