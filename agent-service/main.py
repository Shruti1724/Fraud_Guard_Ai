import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import json
import os
import time
import logging
from typing import Optional, Literal, Dict, Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from config import settings
from graph import investigation_pipeline
from state import InvestigationState, AccountProfile

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("fraudguard-api")

app = FastAPI(
    title="FraudGuard AI - Agentic & ML Investigation Service",
    description="Layer 1 (/predict) Pre-Payment Risk Lookup & Layer 2 (/investigate) Multi-Agent LangGraph Pipeline",
    version=settings.version
)

# Enable CORS for frontend / inter-service communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = Path(__file__).parent / "data"
MOCK_ACCOUNTS_FILE = DATA_DIR / "mock_accounts.json"
CACHED_DEMO_FILE = DATA_DIR / "cached_demo.json"

def load_mock_accounts() -> Dict[str, Any]:
    if MOCK_ACCOUNTS_FILE.exists():
        with open(MOCK_ACCOUNTS_FILE, "r") as f:
            return json.load(f)
    return {}

def load_cached_demo() -> Dict[str, Any]:
    if CACHED_DEMO_FILE.exists():
        with open(CACHED_DEMO_FILE, "r") as f:
            return json.load(f)
    return {}

# --- Layer 1: /predict Models ---

class PredictRequest(BaseModel):
    sender_account_id: str = Field(..., description="Account ID of the sender initiating the transfer", json_schema_extra={"example": "acc_user_101"})
    receiver_vpa: str = Field(..., description="Target Virtual Payment Address (UPI ID) of the recipient", json_schema_extra={"example": "mule.relay99@oksbi"})
    amount: float = Field(..., description="Transfer amount in INR", json_schema_extra={"example": 49000.0})
    device_id: Optional[str] = Field(None, description="Sender device hardware fingerprint", json_schema_extra={"example": "DEV_USER_PHONE_01"})

class PredictResponse(BaseModel):
    receiver_vpa: str = Field(..., description="Target Virtual Payment Address evaluated", json_schema_extra={"example": "mule.relay99@oksbi"})
    receiver_account_id: str = Field(..., description="Resolved internal account identifier", json_schema_extra={"example": "acc_mule_chain_01"})
    risk_score: float = Field(..., ge=0.0, le=1.0, description="Normalized fraud probability (0.0 - 1.0)", json_schema_extra={"example": 0.95})
    risk_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = Field(..., description="Categorical risk tier", json_schema_extra={"example": "CRITICAL"})
    is_flagged: bool = Field(..., description="Flag indicating if account exceeds security threshold", json_schema_extra={"example": True})
    warning_message: str = Field(..., description="User-facing warning banner text for mock UPI frontend", json_schema_extra={"example": "CRITICAL RISK: Receiver flagged in mule ring."})
    trigger_investigation: bool = Field(..., description="Indicates whether backend should fire Layer-2 /investigate", json_schema_extra={"example": True})

# --- Layer 2: /investigate Models ---

class InvestigateRequest(BaseModel):
    account_id: str = Field(..., description="Target account identifier, e.g. 'acc_mule_chain_01' or 'acc_123'", json_schema_extra={"example": "acc_mule_chain_01"})
    account_data: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional custom profile data. If omitted, will be fetched from repository."
    )

class InvestigateResponse(BaseModel):
    account_id: str = Field(..., json_schema_extra={"example": "acc_mule_chain_01"})
    decision: Literal["auto_block", "escalate", "clear"] = Field(..., description="Autonomous policy decision", json_schema_extra={"example": "auto_block"})
    action_taken: str = Field(..., description="Simulated mitigation executed on banking/UPI core", json_schema_extra={"example": "UPI ID revoked; Immediate debit freeze applied."})
    report: str = Field(..., description="Executive case audit report synthesized by Report Agent")

# --- Endpoints ---

@app.get("/health")
def health_check():
    return {
        "status": "online",
        "service": settings.app_name,
        "ollama_model": settings.ollama_model,
        "ollama_base_url": settings.ollama_base_url,
        "endpoints": ["POST /predict", "POST /investigate", "GET /accounts", "GET /health"]
    }

@app.get("/accounts")
def list_mock_accounts():
    """Helper endpoint to inspect available mock accounts for testing and presentation."""
    mock_db = load_mock_accounts()
    return {
        "count": len(mock_db),
        "available_accounts": list(mock_db.keys()),
        "accounts": mock_db
    }

@app.post("/predict", response_model=PredictResponse)
def predict_transaction_risk(req: PredictRequest):
    """Layer 1: Instant Pre-Payment Risk Lookup Endpoint
    Called by Frontend when a user types or selects a receiver VPA on the Send Money screen.
    """
    mock_db = load_mock_accounts()
    
    # 1. Resolve receiver account by VPA or account_id
    matched_account_id = None
    matched_account = None
    for acc_id, acc_data in mock_db.items():
        if acc_data.get("vpa_address", "").lower() == req.receiver_vpa.lower() or acc_id == req.receiver_vpa:
            matched_account_id = acc_id
            matched_account = acc_data
            break
            
    if not matched_account:
        # Default benign evaluation for unrecognized test VPAs
        matched_account_id = f"acc_ext_{req.receiver_vpa.replace('@', '_').replace('.', '_')}"
        return PredictResponse(
            receiver_vpa=req.receiver_vpa,
            receiver_account_id=matched_account_id,
            risk_score=0.05,
            risk_level="LOW",
            is_flagged=False,
            warning_message="Account verified. Safe for standard transfer.",
            trigger_investigation=False
        )

    # 2. Risk evaluation based on account profile / precomputed flags
    age = matched_account.get("account_age_days", 365)
    neighbors = matched_account.get("graph_neighbors", [])
    
    has_victim_inflow = any("VICTIM" in str(n.get("risk_label", "")) for n in neighbors)
    has_sink_outflow = any("SINK" in str(n.get("risk_label", "")) for n in neighbors)
    device_id = str(matched_account.get("device_id", ""))

    if has_victim_inflow or has_sink_outflow or "MULE" in device_id:
        risk_score = 0.95
        risk_level = "CRITICAL"
        is_flagged = True
        warning = "CRITICAL RISK: This receiver UPI ID was flagged in a mule-chain fraud ring. Payments to this account are restricted."
        trigger = True
    elif "EMULATOR" in device_id or matched_account_id == "acc_star_burst_02":
        risk_score = 0.88
        risk_level = "HIGH"
        is_flagged = True
        warning = "HIGH RISK: Unusual smurfing / fan-out velocity detected on recipient account."
        trigger = True
    elif "UNKNOWN" in device_id or matched_account_id == "acc_suspicious_device_04":
        risk_score = 0.74
        risk_level = "HIGH"
        is_flagged = True
        warning = "WARNING: Suspicious device anomaly and off-hours activity detected for recipient."
        trigger = True
    else:
        risk_score = 0.08
        risk_level = "LOW"
        is_flagged = False
        warning = "Account verified. Safe for standard transfer."
        trigger = False

    return PredictResponse(
        receiver_vpa=req.receiver_vpa,
        receiver_account_id=matched_account_id,
        risk_score=risk_score,
        risk_level=risk_level,
        is_flagged=is_flagged,
        warning_message=warning,
        trigger_investigation=trigger
    )

@app.post("/investigate", response_model=InvestigateResponse)
def investigate_account(
    req: InvestigateRequest,
    use_cache: bool = Query(False, description="Force pre-cached demo response for lightning fast presentations")
):
    """Layer 2: Autonomous 4-Agent LangGraph Investigation Endpoint
    Runs the sequential 4-agent LangGraph pipeline:
    1. Investigator -> 2. Decision -> 3. Action -> 4. Report
    """
    account_id = req.account_id
    start_time = time.time()
    
    # 1. Check if user requested demo fallback cache explicitly
    cached_db = load_cached_demo()
    if use_cache and account_id in cached_db:
        logger.info(f"Returning pre-cached demo response for {account_id}")
        cached_res = cached_db[account_id]
        return InvestigateResponse(
            account_id=account_id,
            decision=cached_res["decision"],
            action_taken=cached_res["action_taken"],
            report=cached_res["report"]
        )

    # 2. Resolve account data (from request payload or mock repository)
    mock_db = load_mock_accounts()
    account_data = req.account_data or mock_db.get(account_id)
    
    if not account_data:
        # Default minimal profile if an unknown account ID is passed
        account_data = {
            "account_id": account_id,
            "account_age_days": 1,
            "avg_tx_amount": 50000.0,
            "tx_frequency_per_day": 25.0,
            "unique_counterparties": 10,
            "device_id": f"DEV_DYNAMIC_{account_id}",
            "ip_address": "192.168.1.1",
            "kyc_status": "MINIMAL_OTP",
            "current_balance": 50.0,
            "recent_transactions": [],
            "graph_neighbors": []
        }

    # 3. Initialize LangGraph State
    initial_state: InvestigationState = {
        "account_id": account_id,
        "account_data": account_data,
        "is_fallback": False
    }

    # 4. Execute LangGraph Pipeline
    try:
        final_state = investigation_pipeline.invoke(initial_state)
        elapsed = time.time() - start_time
        logger.info(f"Pipeline finished in {elapsed:.2f}s for {account_id} -> {final_state.get('decision')}")
        
        decision = final_state.get("decision", "escalate")
        action_taken = final_state.get("action_taken", "Case marked for manual review.")
        report = final_state.get("report", "Report generation pending.")
        
        return InvestigateResponse(
            account_id=account_id,
            decision=decision,
            action_taken=action_taken,
            report=report
        )
    except Exception as e:
        logger.error(f"Pipeline execution error for {account_id}: {e}", exc_info=True)
        # Fallback to cached response if available
        if account_id in cached_db:
            cached_res = cached_db[account_id]
            return InvestigateResponse(
                account_id=account_id,
                decision=cached_res["decision"],
                action_taken=cached_res["action_taken"],
                report=cached_res["report"]
            )
        raise HTTPException(status_code=500, detail=f"Pipeline processing failed: {str(e)}")
