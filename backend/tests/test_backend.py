"""
Tests for RF-Smart-Scheduler Backend
Validates REST endpoints, WebSocket streaming, and LinUCB model integration.
"""

import pytest
from starlette.testclient import TestClient

from main import app
from pathlib import Path
from scheduler_engine import SPECTRUM_BANDS, engine


@pytest.fixture(scope="module")
def client():
    sample_path = Path(__file__).resolve().parent.parent / "config_1.h5"
    if not sample_path.exists():
        sample_path = Path(__file__).resolve().parent.parent.parent / "sample_datasets" / "config_1.h5"
    if sample_path.exists() and engine.episode is None:
        engine.load_h5_dataset(sample_path, dataset_label="config_1.h5")

    with TestClient(app) as test_client:
        yield test_client


def test_health_check(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"
    assert "LinUCB" in data["model"]
    assert "dataset" in data


def test_root_endpoint(client):
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"
    assert "endpoints" in data
    assert "/ws/telemetry" in data["endpoints"]["websocket_telemetry"]


def test_spectrum_bands(client):
    response = client.get("/api/bands")
    assert response.status_code == 200
    data = response.json()
    assert data["total_bands"] == 20
    assert len(data["bands"]) == 20
    assert data["bands"][0]["id"] == 1
    assert data["bands"][19]["id"] == 20
    assert data["bands"][13]["center"] == "12.31 GHz"


def test_dataset_info(client):
    response = client.get("/api/dataset/info")
    assert response.status_code == 200
    data = response.json()
    assert data["loaded"] is True
    assert data["num_bands"] == 20
    assert data["total_pulses"] > 0
    assert data["total_dwells"] > 0


def test_telemetry_snapshot(client):
    response = client.get("/api/telemetry")
    assert response.status_code == 200
    data = response.json()
    assert data["source"] == "backend"
    assert "environment" in data
    assert "adaptive" in data
    assert "openLoop" in data
    assert "metrics" in data["adaptive"]
    assert "correctScanRate" in data["adaptive"]["metrics"]
    assert "probDetection" in data["adaptive"]["metrics"]


def test_dwell_history(client):
    response = client.get("/api/dwells?from_index=1&to_index=20")
    assert response.status_code == 200
    data = response.json()
    assert data["from_index"] == 1
    assert len(data["dwells"]) == 20
    assert data["dwells"][0]["dwellIndex"] == 1
    assert data["dwells"][19]["dwellIndex"] == 20


def test_single_dwell(client):
    response = client.get("/api/dwells/5")
    assert response.status_code == 200
    data = response.json()
    assert data["dwellIndex"] == 5
    assert "adaptive" in data
    assert "openLoop" in data
    assert "environment" in data


def test_config_endpoints(client):
    response = client.get("/api/config")
    assert response.status_code == 200
    cfg = response.json()
    assert "receiver" in cfg
    assert "linucb" in cfg
    assert cfg["linucb"]["alpha"] == 0.5

    # Update config
    update_res = client.post("/api/config", json={"alpha": 0.8})
    assert update_res.status_code == 200
    assert update_res.json()["new_config"]["linucb"]["alpha"] == 0.8

    # Reset back to 0.5
    client.post("/api/config", json={"alpha": 0.5})


def test_metrics_endpoint(client):
    response = client.get("/api/metrics")
    assert response.status_code == 200
    data = response.json()
    assert "adaptive_ml" in data
    assert "open_loop" in data
    assert "figures_of_merit" in data
    fom = data["figures_of_merit"]
    assert "relative_pulse_gain" in fom
    assert "relative_correct_scan_gain" in fom


def test_model_state(client):
    response = client.get("/api/model/state")
    assert response.status_code == 200
    data = response.json()
    assert data["initialized"] is True
    assert "feature_names" in data
    assert "weights" in data


def test_benchmark_endpoint(client):
    response = client.post("/api/benchmark", json={"num_dwells": 25})
    assert response.status_code == 200
    data = response.json()
    assert "schedulers" in data
    assert "linucb" in data["schedulers"]
    assert "round_robin" in data["schedulers"]
    assert "random" in data["schedulers"]
    assert "oracle" in data["schedulers"]


def test_websocket_telemetry(client):
    with client.websocket_connect("/ws/telemetry?mode=batch&batch_size=5&interval_ms=100") as ws:
        # Receive first batch snapshot
        msg = ws.receive_json()
        assert msg["source"] == "backend"
        assert msg["mode"] == "batch"
        assert len(msg["batch"]) == 5
        assert "adaptive" in msg
        assert "openLoop" in msg
        assert "environment" in msg

        # Send pause command
        ws.send_json({"command": "pause"})

        # Send step command
        ws.send_json({"command": "step"})
        step_msg = ws.receive_json()
        while step_msg.get("mode") == "batch":
            step_msg = ws.receive_json()
        assert step_msg["mode"] == "slow"
        assert "singleDwell" in step_msg

        # Send resume
        ws.send_json({"command": "resume"})


def test_reset_endpoint(client):
    response = client.post("/api/reset")
    assert response.status_code == 200
    data = response.json()
    assert "Simulation reset" in data["message"]
    assert "dataset" in data


def test_upload_dataset(client):
    sample_path = Path(__file__).resolve().parent.parent / "config_1.h5"
    if not sample_path.exists():
        sample_path = Path(__file__).resolve().parent.parent.parent / "sample_datasets" / "config_1.h5"
    if sample_path.exists():
        with open(sample_path, "rb") as f:
            response = client.post(
                "/api/upload",
                files={"file": ("config_test_upload.h5", f, "application/x-hdf5")},
            )
        assert response.status_code == 200
        data = response.json()
        assert "Successfully loaded dataset" in data["message"]
        assert data["dataset"]["loaded"] is True
        assert data["dataset"]["total_dwells"] == 58415


def test_dynamic_stepping_beyond_1000(client):
    dwell = engine.get_dwell(1500)
    assert dwell is not None
    assert dwell["dwellIndex"] == 1500
    assert len(engine.cached_dwells) >= 1500


