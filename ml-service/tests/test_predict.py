"""Tests for FraudGuard AI Layer-1 /predict and /health service.
"""

import os
import sys
import time

# Ensure parent directory (ml-service) is on sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import app, SCORES_CACHE, ACC_TO_VPA
from config import (
    FLAG_THRESHOLD,
    WARN_THRESHOLD,
    MSG_CRITICAL,
    MSG_WARN,
    MSG_SAFE,
    RISK_LEVEL_CRITICAL,
    RISK_LEVEL_HIGH,
    RISK_LEVEL_LOW,
)

EXPECTED_RESPONSE_KEYS = {
    "receiver_vpa",
    "receiver_account_id",
    "risk_score",
    "risk_level",
    "is_flagged",
    "warning_message",
    "trigger_investigation",
}

client = TestClient(app)


def test_health():
    """Verify /health endpoint status, loaded accounts, and configuration."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"
    assert data["loaded_accounts"] == 893216
    assert data["weights"]["xgb"] == 0.3
    assert data["weights"]["sage"] == 0.7
    assert data["thresholds"]["flag"] == FLAG_THRESHOLD
    assert data["thresholds"]["warn"] == WARN_THRESHOLD


def test_response_keys_contract():
    """Assert response keys match contract exactly (no extra, no missing)."""
    response = client.post("/predict", json={
        "sender_account_id": "acc_user_101",
        "receiver_vpa": "c1000018432@upi",
        "amount": 1500.0,
    })
    assert response.status_code == 200
    data = response.json()
    assert set(data.keys()) == EXPECTED_RESPONSE_KEYS


def test_low_risk_account():
    """Account below 0.70 threshold."""
    acc_id = "C1000018432"
    response = client.post("/predict", json={
        "sender_account_id": "acc_user_101",
        "account_id": acc_id,
        "amount": 500.0,
    })
    assert response.status_code == 200
    data = response.json()
    assert data["receiver_account_id"] == acc_id
    assert isinstance(data["risk_score"], float)
    assert data["risk_score"] < WARN_THRESHOLD
    assert data["risk_level"] == RISK_LEVEL_LOW
    assert data["is_flagged"] is False
    assert data["trigger_investigation"] is False
    assert data["warning_message"] == MSG_SAFE


def test_medium_high_warn_account():
    """Account in [0.70, 0.85) warn band."""
    acc_id = "C1001120910"
    response = client.post("/predict", json={
        "sender_account_id": "acc_user_101",
        "account_id": acc_id,
        "amount": 10000.0,
    })
    assert response.status_code == 200
    data = response.json()
    assert data["receiver_account_id"] == acc_id
    assert WARN_THRESHOLD <= data["risk_score"] < FLAG_THRESHOLD
    assert data["risk_level"] == RISK_LEVEL_HIGH
    assert data["is_flagged"] is False
    assert data["trigger_investigation"] is False
    assert data["warning_message"] == MSG_WARN


def test_critical_flagged_account():
    """Account at or above 0.85 flag threshold."""
    acc_id = "C1000039615"
    response = client.post("/predict", json={
        "sender_account_id": "acc_user_101",
        "account_id": acc_id,
        "amount": 50000.0,
    })
    assert response.status_code == 200
    data = response.json()
    assert data["receiver_account_id"] == acc_id
    assert data["risk_score"] >= FLAG_THRESHOLD
    assert data["risk_level"] == RISK_LEVEL_CRITICAL
    assert data["is_flagged"] is True
    assert data["trigger_investigation"] is True
    assert data["warning_message"] == MSG_CRITICAL


def test_boundary_thresholds_gte():
    """Test boundary conditions to ensure >= is consistently applied."""
    # Temporarily inject boundary accounts into cache for strict precision testing
    b_flag_exact = "TEST_BOUNDARY_085"
    b_flag_below = "TEST_BOUNDARY_084999"
    b_warn_exact = "TEST_BOUNDARY_070"
    b_warn_below = "TEST_BOUNDARY_069999"

    SCORES_CACHE[b_flag_exact] = 0.85000000
    SCORES_CACHE[b_flag_below] = 0.84999999
    SCORES_CACHE[b_warn_exact] = 0.70000000
    SCORES_CACHE[b_warn_below] = 0.69999999

    try:
        # Exactly at 0.85 -> CRITICAL, is_flagged=True
        r1 = client.post("/predict", json={"account_id": b_flag_exact}).json()
        assert r1["risk_level"] == RISK_LEVEL_CRITICAL
        assert r1["is_flagged"] is True
        assert r1["trigger_investigation"] is True

        # Just below 0.85 -> HIGH, is_flagged=False
        r2 = client.post("/predict", json={"account_id": b_flag_below}).json()
        assert r2["risk_level"] == RISK_LEVEL_HIGH
        assert r2["is_flagged"] is False
        assert r2["trigger_investigation"] is False

        # Exactly at 0.70 -> HIGH, is_flagged=False
        r3 = client.post("/predict", json={"account_id": b_warn_exact}).json()
        assert r3["risk_level"] == RISK_LEVEL_HIGH
        assert r3["is_flagged"] is False

        # Just below 0.70 -> LOW, is_flagged=False
        r4 = client.post("/predict", json={"account_id": b_warn_below}).json()
        assert r4["risk_level"] == RISK_LEVEL_LOW
        assert r4["is_flagged"] is False
    finally:
        del SCORES_CACHE[b_flag_exact]
        del SCORES_CACHE[b_flag_below]
        del SCORES_CACHE[b_warn_exact]
        del SCORES_CACHE[b_warn_below]


def test_unknown_account():
    """Unknown account returns 404 with clear message."""
    response = client.post("/predict", json={"account_id": "NON_EXISTENT_ACC_9999"})
    assert response.status_code == 404
    data = response.json()
    assert "not found in precomputed risk table" in data["detail"]


def test_missing_and_empty_inputs():
    """Empty payload or empty strings return 422 Unprocessable Entity."""
    # Completely empty body
    r1 = client.post("/predict", json={})
    assert r1.status_code == 422

    # Empty string account_id
    r2 = client.post("/predict", json={"account_id": ""})
    assert r2.status_code == 422

    # Empty whitespace receiver_vpa
    r3 = client.post("/predict", json={"receiver_vpa": "   "})
    assert r3.status_code == 422

    # Invalid amount type
    r4 = client.post("/predict", json={"account_id": "C1000018432", "amount": "invalid_number"})
    assert r4.status_code == 422


def test_ring_mule_and_decoy_accounts(capsys):
    """Print and assert predictions for real fraud ring mule and innocent decoy."""
    mule_acc = "acc_chain_016_4"
    decoy_acc = "C1001991700"

    r_mule = client.post("/predict", json={"account_id": mule_acc, "amount": 49000.0})
    assert r_mule.status_code == 200
    d_mule = r_mule.json()

    r_decoy = client.post("/predict", json={"account_id": decoy_acc, "amount": 450.0})
    assert r_decoy.status_code == 200
    d_decoy = r_decoy.json()

    # Assertions
    assert d_mule["is_flagged"] is True
    assert d_mule["risk_level"] == RISK_LEVEL_CRITICAL
    assert d_decoy["is_flagged"] is False
    assert d_decoy["risk_level"] == RISK_LEVEL_LOW

    # Output to stdout for test report
    print("\n" + "=" * 60)
    print("MULE ACCOUNT PREDICTION (Ring Chain Member):")
    print(d_mule)
    print("-" * 60)
    print("INNOCENT DECOY PREDICTION (Merchant Hub Member):")
    print(d_decoy)
    print("=" * 60)


def test_latency_benchmark():
    """Measure latency over 1,000 requests, report p50 and p95 in ms."""
    acc_id = "C1000018432"
    payload = {"account_id": acc_id}
    num_requests = 1000
    latencies_ms = []

    # Warmup
    for _ in range(20):
        client.post("/predict", json=payload)

    # Benchmark loop
    for _ in range(num_requests):
        t0 = time.perf_counter()
        resp = client.post("/predict", json=payload)
        t1 = time.perf_counter()
        assert resp.status_code == 200
        latencies_ms.append((t1 - t0) * 1000.0)

    p50 = float(np.percentile(latencies_ms, 50))
    p95 = float(np.percentile(latencies_ms, 95))
    mean_lat = float(np.mean(latencies_ms))

    print(f"\n[LATENCY BENCHMARK ({num_requests:,} requests)]")
    print(f"  Mean : {mean_lat:.3f} ms")
    print(f"  p50  : {p50:.3f} ms")
    print(f"  p95  : {p95:.3f} ms")

    # In-memory dict lookup should easily be sub-5ms (and often sub-1ms)
    assert p95 < 20.0, f"p95 latency too high: {p95:.3f} ms"
