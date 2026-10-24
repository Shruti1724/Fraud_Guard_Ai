"""Comprehensive Pytest Suite for FraudGuard AI Investigation Service (Member C).

Validates:
- Strict adherence to Contract 4.1: POST /investigate (200 shape, 404 on unknown, 422 on missing ID)
- Layer-1 POST /predict operational thresholds (0.70 WARN, 0.85 FLAG)
- Multi-agent LangGraph pipeline execution
- Mule ring confirmation (auto_block) vs Innocent look-alike clearing (clear)
- Pre-cached demo fallback
- Pluggable action backends and data provider interfaces
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import json
import pytest
from fastapi.testclient import TestClient

from main import app
from graph import investigation_pipeline
from state import InvestigationState
from providers.factory import get_data_provider
from nodes.action import SimulatedActionBackend, MongoActionBackend

client = TestClient(app)

# ---------------------------------------------------------------------------
# 1. Health & Discovery Endpoints
# ---------------------------------------------------------------------------

def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"
    assert data["port"] == 8001
    assert "ollama_model" in data
    assert data["thresholds"]["warn_threshold"] == 0.70
    assert data["thresholds"]["flag_threshold"] == 0.85
    assert "POST /investigate" in data["endpoints"]
    assert "POST /predict" in data["endpoints"]

def test_accounts_directory():
    response = client.get("/accounts")
    assert response.status_code == 200
    data = response.json()
    assert data["count"] >= 8
    # Verify core test accounts from brief Section 4.3 exist
    assert "C1000018432" in data["available_accounts"]
    assert "C1001120910" in data["available_accounts"]
    assert "C1000039615" in data["available_accounts"]
    assert "acc_chain_016_4" in data["available_accounts"]
    assert "C1001991700" in data["available_accounts"]
    # Verify decoy look-alikes exist
    assert "acc_decoy_family_01" in data["available_accounts"]
    assert "acc_decoy_merchant_03" in data["available_accounts"]

# ---------------------------------------------------------------------------
# 2. Layer 1: POST /predict Tests
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("receiver_vpa,expected_risk_level,expected_flagged,expected_trigger", [
    ("c1000018432@upi", "LOW", False, False),
    ("c1001120910@upi", "HIGH", False, False),       # 0.703: Warning only, below 0.85 trigger
    ("c1000039615@upi", "CRITICAL", True, True),      # 0.937: Triggers investigation
    ("acc_chain_016_4@upi", "CRITICAL", True, True),  # 1.000: Ring member triggers
    ("c1001991700@upi", "LOW", False, False),         # 0.000: Innocent merchant
    ("unknown.user.test@axis", "LOW", False, False),  # Unrecognized VPA defaults to safe
])
def test_predict_thresholds_contract(receiver_vpa, expected_risk_level, expected_flagged, expected_trigger):
    payload = {
        "sender_account_id": "acc_user_101",
        "receiver_vpa": receiver_vpa,
        "amount": 25000.0,
        "device_id": "DEV_TEST_01"
    }
    response = client.post("/predict", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["risk_level"] == expected_risk_level
    assert data["is_flagged"] == expected_flagged
    assert data["trigger_investigation"] == expected_trigger
    assert 0.0 <= data["risk_score"] <= 1.0

# ---------------------------------------------------------------------------
# 3. Layer 3: POST /investigate Contract & Error Tests
# ---------------------------------------------------------------------------

def test_investigate_unknown_account_404():
    """Contract: Unknown account must return HTTP 404 with a clear message."""
    response = client.post("/investigate", json={"account_id": "NON_EXISTENT_ACC_99999"})
    assert response.status_code == 404
    data = response.json()
    assert "detail" in data
    assert "not found" in data["detail"].lower()

def test_investigate_missing_account_id_422():
    """Contract: Missing or empty account_id must return HTTP 422."""
    # Completely missing field
    res1 = client.post("/investigate", json={})
    assert res1.status_code == 422

    # Empty string
    res2 = client.post("/investigate", json={"account_id": ""})
    assert res2.status_code == 422

    # Whitespace only
    res3 = client.post("/investigate", json={"account_id": "   "})
    assert res3.status_code == 422

def test_investigate_cached_fallback_demo():
    """Contract: use_cache=true returns instant pre-cached response."""
    response = client.post("/investigate?use_cache=true", json={"account_id": "C1000039615"})
    assert response.status_code == 200
    data = response.json()
    assert set(data.keys()) == {"account_id", "decision", "action_taken", "report"}
    assert data["account_id"] == "C1000039615"
    assert data["decision"] == "auto_block"
    assert "FRAUDGUARD AI CASE AUDIT REPORT" in data["report"]

def test_investigate_vpa_normalization():
    """Contract: accept VPA with @upi and match case-insensitively."""
    # Using lowercase with @upi
    response = client.post("/investigate", json={"account_id": "c1000039615@upi"})
    assert response.status_code == 200
    data = response.json()
    assert data["decision"] in ["auto_block", "escalate", "clear"]

# ---------------------------------------------------------------------------
# 4. Multi-Agent Pipeline & Decision Accuracy Tests
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("account_id,expected_decision", [
    # 1. Real Mule Syndicates -> Must AUTO_BLOCK
    ("acc_mule_chain_01", "auto_block"),
    ("C1000039615", "auto_block"),
    ("acc_chain_016_4", "auto_block"),
    ("acc_star_burst_02", "auto_block"),
    
    # 2. Borderline Anomaly -> ESCALATE
    ("acc_suspicious_device_04", "escalate"),
    
    # 3. Innocent Accounts & Look-Alike Decoys -> Must CLEAR
    ("acc_legit_retail_03", "clear"),
    ("C1001991700", "clear"),
    ("C1000018432", "clear"),
    ("acc_decoy_family_01", "clear"),       # High graph score cleared as family decoy
    ("acc_decoy_merchant_03", "clear"),     # High graph score cleared as merchant decoy
    ("acc_decoy_forward_02", "clear"),      # High graph score cleared as split expense decoy
    ("acc_decoy_payroll_04", "clear"),      # High graph score cleared as payroll decoy
])
def test_pipeline_decision_accuracy(account_id, expected_decision):
    """Verifies that the hybrid decision engine correctly blocks mules and clears decoys."""
    provider = get_data_provider()
    profile = provider.get_account(account_id)
    assert profile is not None, f"Test account {account_id} must exist in repository"

    state: InvestigationState = {
        "account_id": account_id,
        "account_data": profile,
        "is_fallback": False
    }

    final_state = investigation_pipeline.invoke(state)

    # Validate output structure
    assert "investigator_findings" in final_state
    assert "decision" in final_state
    assert "action_taken" in final_state
    assert "report" in final_state

    # Validate expected decision
    assert final_state["decision"] == expected_decision, (
        f"Account {account_id} expected {expected_decision}, got {final_state['decision']}. "
        f"Reasoning: {final_state.get('decision_reasoning')}"
    )

    # Validate report contents
    report = final_state["report"]
    assert "FRAUDGUARD AI CASE AUDIT REPORT" in report
    assert account_id in report
    assert final_state["decision"].upper() in report

# ---------------------------------------------------------------------------
# 5. Pluggable Action Backend Tests
# ---------------------------------------------------------------------------

def test_simulated_action_backend():
    backend = SimulatedActionBackend()
    res = backend.execute(
        account_id="TEST_01",
        decision="auto_block",
        account_data={},
        action_taken="Debit freeze applied",
        account_status="account_frozen",
        action_details={"freeze": True}
    )
    assert res["backend"] == "simulated"
    assert res["account_status"] == "account_frozen"

def test_mongo_action_backend_fallback_when_offline():
    # Provide unreachable port
    backend = MongoActionBackend(uri="mongodb://localhost:27099/nonexistent")
    res = backend.execute(
        account_id="TEST_02",
        decision="clear",
        account_data={},
        action_taken="Cleared",
        account_status="cleared",
        action_details={}
    )
    assert "fallback" in res["backend"]
    assert res["account_status"] == "cleared"
