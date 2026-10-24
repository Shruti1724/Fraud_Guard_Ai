"""FastAPI Layer-1 Pre-Payment Risk Assessment Service.

Serves blended fraud scores: risk_score = 0.3 * xgb_ABC + 0.7 * sage_edge_L2
from precomputed artifacts/blended_scores.csv.
"""

import os
import sys
from typing import Optional, Dict, Any

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
import pandas as pd

from config import (
    W_XGB,
    W_SAGE,
    FLAG_THRESHOLD,
    WARN_THRESHOLD,
    BLENDED_SCORES_PATH,
    ACCOUNTS_CSV_PATH,
    get_risk_evaluation,
)

# ---------------------------------------------------------
# Startup In-Memory Cache
# ---------------------------------------------------------
if not os.path.exists(BLENDED_SCORES_PATH):
    sys.stderr.write(
        f"CRITICAL STARTUP ERROR: Precomputed scores file not found: {BLENDED_SCORES_PATH}.\n"
        "Run `python build_blended_scores.py` before launching the API service.\n"
    )
    raise RuntimeError(f"Missing precomputed scores file: {BLENDED_SCORES_PATH}")

print("=" * 70)
print("STARTING FRAUDGUARD AI PRE-PAYMENT RISK SERVICE (Layer 1)")
print(f"Weights in use: W_XGB = {W_XGB}, W_SAGE = {W_SAGE}")
print(f"Thresholds    : FLAG = {FLAG_THRESHOLD}, WARN = {WARN_THRESHOLD}")
print(f"Loading precomputed scores from {BLENDED_SCORES_PATH}...")

# Load blended scores into dictionary: account_id -> float (unrounded risk score)
_scores_df = pd.read_csv(BLENDED_SCORES_PATH)
SCORES_CACHE: Dict[str, float] = dict(zip(_scores_df["account_id"], _scores_df["risk_score"]))
print(f"Loaded {len(SCORES_CACHE):,} precomputed accounts into memory.")

# Load VPA <-> account_id mapping if accounts.csv exists
VPA_TO_ACC: Dict[str, str] = {}
ACC_TO_VPA: Dict[str, str] = {}

if os.path.exists(ACCOUNTS_CSV_PATH):
    print(f"Loading VPA mapping from {ACCOUNTS_CSV_PATH}...")
    _acc_df = pd.read_csv(ACCOUNTS_CSV_PATH, usecols=["account_id", "vpa_address"])
    for acc_id, vpa in zip(_acc_df["account_id"], _acc_df["vpa_address"]):
        if pd.notna(vpa):
            VPA_TO_ACC[str(vpa).lower()] = str(acc_id)
            ACC_TO_VPA[str(acc_id)] = str(vpa)
    print(f"Loaded {len(VPA_TO_ACC):,} VPA mappings.")
print("=" * 70)

# ---------------------------------------------------------
# FastAPI App & Middleware
# ---------------------------------------------------------
app = FastAPI(
    title="FraudGuard AI - Pre-Payment Risk Assessment Service",
    description="Layer 1 (/predict) Instant Precomputed Fraud Scoring API",
    version="2.0.0",
)

# Restrict to frontend and service origins
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:8001",
    "http://127.0.0.1:8001",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------
class PredictRequest(BaseModel):
    sender_account_id: Optional[str] = Field(None, description="Account ID of paying user")
    receiver_vpa: Optional[str] = Field(None, description="Target Virtual Payment Address (UPI ID)")
    receiver_account_id: Optional[str] = Field(None, description="Direct target receiver account ID (e.g. C1000004082)")
    account_id: Optional[str] = Field(None, description="Direct target account ID (e.g. C1000004082)")
    amount: Optional[float] = Field(None, description="Transfer amount in INR")
    device_id: Optional[str] = Field(None, description="Device identifier of payer")

    @field_validator("account_id", "receiver_account_id", "receiver_vpa")
    @classmethod
    def validate_non_empty(cls, v):
        if v is not None and not str(v).strip():
            raise ValueError("Field cannot be an empty string")
        return v


class PredictResponse(BaseModel):
    receiver_vpa: str
    receiver_account_id: str
    risk_score: float
    risk_level: str
    is_flagged: bool
    warning_message: str
    trigger_investigation: bool


# ---------------------------------------------------------
# Endpoints
# ---------------------------------------------------------
@app.get("/health")
def health():
    return {
        "status": "online",
        "loaded_accounts": len(SCORES_CACHE),
        "weights": {
            "xgb": W_XGB,
            "sage": W_SAGE,
        },
        "thresholds": {
            "flag": FLAG_THRESHOLD,
            "warn": WARN_THRESHOLD,
        },
    }


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    # Validate that at least one target identifier is provided
    target_account_id = None
    target_vpa = None

    acc_id_candidate = req.receiver_account_id or req.account_id
    if acc_id_candidate and acc_id_candidate.strip():
        target_account_id = acc_id_candidate.strip()
    elif req.receiver_vpa and req.receiver_vpa.strip():
        vpa_clean = req.receiver_vpa.strip().lower()
        target_vpa = req.receiver_vpa.strip()
        # Resolve from VPA to internal account_id
        target_account_id = VPA_TO_ACC.get(vpa_clean, req.receiver_vpa.strip())
    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Missing or empty account identifier: specify 'receiver_account_id', 'account_id', or 'receiver_vpa'.",
        )

    # Check against precomputed score registry
    if target_account_id not in SCORES_CACHE:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Account '{target_account_id}' not found in precomputed risk table",
        )

    # Fetch unrounded score and evaluate against locked thresholds
    unrounded_risk_score = SCORES_CACHE[target_account_id]
    eval_result = get_risk_evaluation(unrounded_risk_score)

    # Resolve VPA for response
    if not target_vpa:
        target_vpa = ACC_TO_VPA.get(target_account_id, f"{target_account_id.lower()}@upi")

    return PredictResponse(
        receiver_vpa=target_vpa,
        receiver_account_id=target_account_id,
        risk_score=round(unrounded_risk_score, 4),
        risk_level=eval_result["risk_level"],
        is_flagged=eval_result["is_flagged"],
        warning_message=eval_result["warning_message"],
        trigger_investigation=eval_result["trigger_investigation"],
    )
