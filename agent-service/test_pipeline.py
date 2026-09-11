import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import json
import pytest
from fastapi.testclient import TestClient
from main import app, load_mock_accounts
from graph import investigation_pipeline
from state import InvestigationState

client = TestClient(app)

def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"
    assert "ollama_model" in data
    assert "POST /predict" in data["endpoints"]
    assert "POST /investigate" in data["endpoints"]

def test_mock_accounts_list():
    response = client.get("/accounts")
    assert response.status_code == 200
    data = response.json()
    assert data["count"] >= 4
    assert "acc_mule_chain_01" in data["available_accounts"]

@pytest.mark.parametrize("receiver_vpa,expected_risk_level,expected_flagged", [
    ("mule.relay99@oksbi", "CRITICAL", True),
    ("quicksplit.hub@paytm", "HIGH", True),
    ("rajesh.kumar77@icici", "HIGH", True),
    ("sharma.kirana.store@hdfcbank", "LOW", False),
    ("unknown.user@axis", "LOW", False)
])
def test_predict_endpoint(receiver_vpa, expected_risk_level, expected_flagged):
    payload = {
        "sender_account_id": "acc_user_101",
        "receiver_vpa": receiver_vpa,
        "amount": 25000.0,
        "device_id": "DEV_TEST_01"
    }
    response = client.post("/predict", json=payload)
    assert response.status_code == 200
    data = response.json()
    
    # Contract validation
    expected_keys = {
        "receiver_vpa", "receiver_account_id", "risk_score",
        "risk_level", "is_flagged", "warning_message", "trigger_investigation"
    }
    assert set(data.keys()) == expected_keys
    assert data["receiver_vpa"] == receiver_vpa
    assert data["risk_level"] == expected_risk_level
    assert data["is_flagged"] == expected_flagged
    assert isinstance(data["risk_score"], float)
    assert 0.0 <= data["risk_score"] <= 1.0

@pytest.mark.parametrize("account_id,expected_decision", [
    ("acc_mule_chain_01", "auto_block"),
    ("acc_star_burst_02", "auto_block"),
    ("acc_suspicious_device_04", "escalate"),
    ("acc_legit_retail_03", "clear"),
])
def test_pipeline_graph_direct(account_id, expected_decision):
    mock_db = load_mock_accounts()
    account_data = mock_db[account_id]
    
    state: InvestigationState = {
        "account_id": account_id,
        "account_data": account_data
    }
    
    result = investigation_pipeline.invoke(state)
    
    assert "investigator_findings" in result
    assert result["investigator_findings"]["suspicion_score"] is not None
    assert result["decision"] in ["auto_block", "escalate", "clear"]
    assert len(result["action_taken"]) > 0
    assert len(result["report"]) > 0

def test_api_investigate_post():
    payload = {"account_id": "acc_mule_chain_01"}
    response = client.post("/investigate", json=payload)
    
    assert response.status_code == 200
    data = response.json()
    
    # Verify strict contract match
    assert set(data.keys()) == {"account_id", "decision", "action_taken", "report"}
    assert data["account_id"] == "acc_mule_chain_01"
    assert data["decision"] in ["auto_block", "escalate", "clear"]
    assert isinstance(data["action_taken"], str)
    assert isinstance(data["report"], str)

def test_api_cached_fallback():
    response = client.post("/investigate?use_cache=true", json={"account_id": "acc_mule_chain_01"})
    assert response.status_code == 200
    data = response.json()
    assert data["decision"] == "auto_block"
    assert "Mule-Chain" in data["report"] or "mule" in data["report"].lower()

if __name__ == "__main__":
    print("Running manual test runner...")
    for acc_id in ["acc_mule_chain_01", "acc_star_burst_02", "acc_suspicious_device_04", "acc_legit_retail_03"]:
        print(f"\n--- Testing account: {acc_id} ---")
        res = client.post("/investigate", json={"account_id": acc_id})
        print("Status:", res.status_code)
        print("Response JSON:", json.dumps(res.json(), indent=2))
