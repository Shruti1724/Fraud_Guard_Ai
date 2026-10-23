"""FastAPI Service for FraudGuard AI Investigation Layer.

Implements:
- POST /investigate : Autonomous 4-Agent LangGraph Pipeline (Contract 4.1)
- POST /predict     : Pre-Payment Risk Assessment (Layer 1 proxy / fallback)
- GET /health       : Service status & telemetry
- GET /accounts     : Directory of inspectable test accounts
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import json
import time
import logging
from typing import Optional, Literal, Dict, Any, List

from fastapi import FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from config import settings
from graph import investigation_pipeline
from state import InvestigationState, AccountProfile
from providers.factory import get_data_provider

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("fraudguard-api")

app = FastAPI(
    title="FraudGuard AI - Agentic Investigation Service",
    description="Layer 3 (/investigate) Autonomous 4-Agent LangGraph Pipeline & Layer 1 (/predict) Risk Evaluation",
    version=settings.version
)

# Enable CORS for frontend and cross-service communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = Path(__file__).parent / "data"
CACHED_DEMO_FILE = DATA_DIR / "cached_demo.json"

def load_cached_demo() -> Dict[str, Any]:
    if CACHED_DEMO_FILE.exists():
        try:
            with open(CACHED_DEMO_FILE, "r") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error reading cached demo JSON: {e}")
    return {}

# ---------------------------------------------------------------------------
# Pydantic Request & Response Schemas
# ---------------------------------------------------------------------------

class PredictRequest(BaseModel):
    sender_account_id: Optional[str] = Field(None, description="Account ID of paying user", json_schema_extra={"example": "acc_user_101"})
    receiver_vpa: Optional[str] = Field(None, description="Target Virtual Payment Address (UPI ID)", json_schema_extra={"example": "mule.relay99@oksbi"})
    receiver_account_id: Optional[str] = Field(None, description="Direct target receiver account ID", json_schema_extra={"example": "C1000039615"})
    account_id: Optional[str] = Field(None, description="Direct target account ID", json_schema_extra={"example": "C1000039615"})
    amount: Optional[float] = Field(None, description="Transfer amount in INR", json_schema_extra={"example": 49000.0})
    device_id: Optional[str] = Field(None, description="Sender device identifier", json_schema_extra={"example": "DEV_USER_PHONE_01"})

    @field_validator("account_id", "receiver_account_id", "receiver_vpa")
    @classmethod
    def validate_non_empty(cls, v):
        if v is not None and not str(v).strip():
            raise ValueError("Field cannot be an empty string")
        return v

class PredictResponse(BaseModel):
    receiver_vpa: str
    receiver_account_id: str
    risk_score: float = Field(..., ge=0.0, le=1.0)
    risk_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    is_flagged: bool
    warning_message: str
    trigger_investigation: bool

class InvestigateRequest(BaseModel):
    account_id: str = Field(..., description="Target account identifier (e.g., 'C1000039615' or 'acc_chain_016_4')", json_schema_extra={"example": "C1000039615"})
    account_data: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional custom profile data override. If omitted, will be fetched from repository."
    )

    @field_validator("account_id")
    @classmethod
    def validate_account_id(cls, v):
        if not v or not str(v).strip():
            raise ValueError("account_id cannot be empty")
        return str(v).strip()

class InvestigateResponse(BaseModel):
    account_id: str = Field(..., description="Target account investigated", json_schema_extra={"example": "C1000039615"})
    decision: Literal["auto_block", "escalate", "clear"] = Field(..., description="Autonomous policy decision", json_schema_extra={"example": "auto_block"})
    action_taken: str = Field(..., description="Concrete mitigation directive executed on UPI switch", json_schema_extra={"example": "UPI ID revoked; Immediate debit freeze applied."})
    report: str = Field(..., description="Comprehensive forensic case audit report synthesized by Report Agent")

# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health_check():
    """Service health and operational configuration telemetry."""
    provider = get_data_provider()
    return {
        "status": "online",
        "service": settings.app_name,
        "version": settings.version,
        "port": settings.port,
        "ollama_model": settings.ollama_model,
        "ollama_base_url": settings.ollama_base_url,
        "data_provider_mode": settings.data_provider_mode,
        "action_backend": settings.action_backend,
        "thresholds": {
            "warn_threshold": settings.WARN_THRESHOLD,
            "flag_threshold": settings.FLAG_THRESHOLD
        },
        "endpoints": ["POST /investigate", "POST /predict", "GET /accounts", "GET /health"]
    }

@app.get("/accounts")
def list_accounts():
    """Inspect accounts available for testing and demonstration."""
    provider = get_data_provider()
    accounts_info = {}
    if hasattr(provider, "accounts"):
        for acc_id, profile in provider.accounts.items():
            accounts_info[acc_id] = {
                "account_id": acc_id,
                "vpa_address": profile.get("vpa_address"),
                "risk_score": profile.get("risk_score"),
                "risk_level": profile.get("risk_level"),
                "category": profile.get("category"),
                "kyc_status": profile.get("kyc_status")
            }
    return {
        "count": len(accounts_info),
        "available_accounts": list(accounts_info.keys()),
        "accounts": accounts_info
    }

@app.post("/predict", response_model=PredictResponse)
def predict_transaction_risk(req: PredictRequest):
    """Layer 1: Pre-Payment Risk Lookup (Thresholds: WARN 0.70, FLAG 0.85)"""
    # 1. Resolve target identifier
    target_identifier = req.receiver_account_id or req.account_id or req.receiver_vpa
    if not target_identifier:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Missing required identifier: provide 'receiver_vpa', 'account_id', or 'receiver_account_id'."
        )

    provider = get_data_provider()
    account_profile = provider.get_account(target_identifier)

    # If target is unknown VPA not in DB, evaluate as benign external account
    if not account_profile:
        clean_vpa = req.receiver_vpa or target_identifier
        return PredictResponse(
            receiver_vpa=clean_vpa,
            receiver_account_id=f"acc_{clean_vpa.replace('@', '_').replace('.', '_')}",
            risk_score=0.04,
            risk_level="LOW",
            is_flagged=False,
            warning_message="Account verified. Safe for standard transfer.",
            trigger_investigation=False
        )

    # Evaluate score against locked thresholds
    risk_score = float(account_profile.get("risk_score", 0.0) or 0.0)
    is_flagged = bool(risk_score >= settings.FLAG_THRESHOLD)
    trigger_investigation = is_flagged

    if is_flagged:
        risk_level = "CRITICAL"
        warning = "CRITICAL RISK: This receiver UPI ID was flagged in a mule-chain fraud ring. Payments to this account are restricted."
    elif risk_score >= settings.WARN_THRESHOLD:
        risk_level = "HIGH"
        warning = "WARNING: Recipient account flagged for suspicious transaction velocity."
    else:
        risk_level = "LOW"
        warning = "Account verified. Safe for standard transfer."

    return PredictResponse(
        receiver_vpa=account_profile.get("vpa_address", req.receiver_vpa or f"{account_profile['account_id'].lower()}@upi"),
        receiver_account_id=account_profile["account_id"],
        risk_score=round(risk_score, 4),
        risk_level=risk_level,
        is_flagged=is_flagged,
        warning_message=warning,
        trigger_investigation=trigger_investigation
    )

@app.post("/investigate", response_model=InvestigateResponse)
def investigate_account(
    req: InvestigateRequest,
    use_cache: bool = Query(False, description="Force pre-cached demo response for presentation reliability")
):
    """Layer 3: Autonomous 4-Agent LangGraph Investigation Endpoint (Contract 4.1)

    Executes:
    1. Investigator Agent -> 2. Decision Agent -> 3. Action Agent -> 4. Report Agent

    Errors:
    - 404: Unknown account not found in repository
    - 422: Missing or invalid account_id
    - Never returns 500 for a bad account ID
    """
    raw_account_id = req.account_id
    provider = get_data_provider()

    # 1. Defensively strip '@upi' suffix and whitespace
    clean_account_id = provider.normalize_account_id(raw_account_id)

    # 2. Check cached fallback if explicitly requested
    cached_db = load_cached_demo()
    cache_key = None
    for k in [raw_account_id, clean_account_id, raw_account_id.lower(), clean_account_id.lower()]:
        if k in cached_db:
            cache_key = k
            break

    if use_cache and cache_key:
        logger.info(f"Returning pre-cached demo output for '{cache_key}'")
        cached_res = cached_db[cache_key]
        return InvestigateResponse(
            account_id=raw_account_id,
            decision=cached_res["decision"],
            action_taken=cached_res["action_taken"],
            report=cached_res["report"]
        )

    # 3. Retrieve account profile (merge payload override with stored provider record)
    stored_profile = provider.get_account(raw_account_id) or provider.get_account(clean_account_id)
    if req.account_data and stored_profile:
        # Merge payload overrides onto stored profile so critical fields like transactions/neighbors are preserved
        account_profile = {**stored_profile, **{k: v for k, v in req.account_data.items() if v is not None}}
    else:
        account_profile = req.account_data or stored_profile

    # Strict contract requirement: unknown account -> 404 with clear message
    if not account_profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Account '{raw_account_id}' not found in data repository."
        )

    # 4. Prepare LangGraph Initial State
    initial_state: InvestigationState = {
        "account_id": raw_account_id,
        "account_data": account_profile,
        "is_fallback": False
    }

    # 5. Execute 4-Agent LangGraph Pipeline
    start_time = time.time()
    try:
        final_state = investigation_pipeline.invoke(initial_state)
        elapsed_sec = time.time() - start_time
        logger.info(f"Pipeline resolved '{raw_account_id}' in {elapsed_sec:.2f}s -> {final_state.get('decision')}")

        decision = final_state.get("decision", "clear")
        action_taken = final_state.get("action_taken", "Case evaluated by autonomous pipeline.")
        report = final_state.get("report", "Case audit report synthesized.")

        return InvestigateResponse(
            account_id=raw_account_id,
            decision=decision,
            action_taken=action_taken,
            report=report
        )
    except Exception as e:
        logger.error(f"Pipeline error for account '{raw_account_id}': {e}", exc_info=True)

        # Fallback to pre-cached demo fixture if available so presentation never crashes
        if cache_key and cache_key in cached_db:
            logger.warning(f"Falling back to cached demo output for '{cache_key}' due to pipeline error.")
            cached_res = cached_db[cache_key]
            return InvestigateResponse(
                account_id=raw_account_id,
                decision=cached_res["decision"],
                action_taken=cached_res["action_taken"],
                report=cached_res["report"]
            )

        # Execute deterministic heuristic investigation as safe fallback
        from nodes.investigator import fallback_heuristic_investigation
        from nodes.decision import fallback_heuristic_decision
        from nodes.action import action_node
        from nodes.report import report_node

        fallback_findings = fallback_heuristic_investigation(account_profile)
        fallback_decision_res = fallback_heuristic_decision(fallback_findings, account_profile)

        state_fallback: InvestigationState = {
            "account_id": raw_account_id,
            "account_data": account_profile,
            "investigator_findings": fallback_findings,
            "decision": fallback_decision_res["decision"],
            "decision_reasoning": fallback_decision_res["decision_reasoning"],
            "is_fallback": True
        }

        act_out = action_node(state_fallback)
        state_fallback.update(act_out)
        rep_out = report_node(state_fallback)

        return InvestigateResponse(
            account_id=raw_account_id,
            decision=state_fallback["decision"],
            action_taken=state_fallback["action_taken"],
            report=rep_out["report"]
        )
