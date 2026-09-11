"""
FraudGuard AI — Shared Python / Pydantic Schemas
Used by Member B (ML/GNN Pipeline) and Member C (Agent Service)
"""

from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field

# --- Standard Threshold Constants ---
RISK_FLAG_THRESHOLD: float = 0.85     # Triggers autonomous investigation & auto_block
RISK_WARNING_THRESHOLD: float = 0.70  # Displays UI cautionary warning to user
RISK_LOW_CEILING: float = 0.30        # Instant pass-through for verified accounts

# --- Layer 1: /predict ---

class PredictRequest(BaseModel):
    sender_account_id: str = Field(..., description="Account ID of sender")
    receiver_vpa: str = Field(..., description="Target UPI VPA address")
    amount: float = Field(..., description="Amount in INR")
    device_id: Optional[str] = Field(None, description="Sender device ID")

class PredictResponse(BaseModel):
    receiver_vpa: str
    receiver_account_id: str
    risk_score: float = Field(..., ge=0.0, le=1.0, description="Normalized risk score 0.0 to 1.0")
    risk_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    is_flagged: bool
    warning_message: str
    trigger_investigation: bool

# --- Layer 2: /investigate ---

class InvestigateRequest(BaseModel):
    account_id: str = Field(..., description="Target account identifier, e.g. 'acc_mule_chain_01'")
    account_data: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional custom profile data. If omitted, loaded from DB / mock repo."
    )

class InvestigateResponse(BaseModel):
    account_id: str
    decision: Literal["auto_block", "escalate", "clear"]
    action_taken: str
    report: str
