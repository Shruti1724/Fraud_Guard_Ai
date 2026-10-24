"""State models and typing definitions for FraudGuard AI Multi-Agent LangGraph Pipeline.
"""

from typing import TypedDict, List, Dict, Any, Optional, Literal
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Data Models for Account & Transaction Profiles
# ---------------------------------------------------------------------------

class TransactionRecord(TypedDict, total=False):
    step: int
    type: str  # PAYMENT, TRANSFER, CASH_OUT, DEBIT
    amount: float
    nameOrig: str
    nameDest: str
    timestamp: Optional[str]
    device_id: Optional[str]
    ip_address: Optional[str]
    status: Optional[str]

class GraphNeighbor(TypedDict, total=False):
    neighbor_id: str
    relation: str  # 'inflow', 'outflow', 'shared_device', 'shared_ip'
    total_volume: float
    tx_count: int
    risk_label: Optional[str]  # e.g. 'VICTIM', 'HIGH_RISK_SINK', 'BENIGN'

class AccountProfile(TypedDict, total=False):
    account_id: str
    vpa_address: str
    account_age_days: int
    kyc_status: str  # 'FULL_BIOMETRIC_VERIFIED', 'PARTIAL_MINIMUM_OTP', 'MINIMUM_KYC'
    avg_tx_amount: float
    tx_frequency_per_day: float
    unique_counterparties: int
    device_id: str
    ip_address: str
    current_balance: float
    
    # ML Model scores (provided by Member B or derived)
    risk_score: Optional[float]   # blended 0.3*xgb + 0.7*sage (0.0 - 1.0)
    xgb_score: Optional[float]    # tabular score (0.0 - 1.0)
    sage_score: Optional[float]   # graph score (0.0 - 1.0)
    risk_level: Optional[Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]]
    
    # Metadata for decoy lookalike verification
    category: Optional[str]       # 'personal', 'merchant', 'payroll', 'family', 'relay'
    recent_transactions: List[TransactionRecord]
    graph_neighbors: List[GraphNeighbor]

# ---------------------------------------------------------------------------
# Agent Output Models (Pydantic for LLM JSON Schema Validation)
# ---------------------------------------------------------------------------

class InvestigatorFindings(TypedDict, total=False):
    suspicion_score: int  # 0 - 100
    risk_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    
    # Genuine Mule Topological Structures
    mule_chain_detected: bool
    star_burst_detected: bool
    cycle_detected: bool
    fan_out_detected: bool
    abnormal_velocity_detected: bool
    
    # Innocent Decoy Look-alike Patterns
    innocent_lookalike_detected: Optional[Literal[
        "family_group", 
        "forwarding_chain", 
        "merchant_hub", 
        "payroll_fanout", 
        "none"
    ]]
    decoy_confidence: float  # 0.0 - 1.0
    decoy_rationale: Optional[str]
    
    # Forensic Evidence
    model_divergence_observed: bool  # True if high sage_score but low xgb_score with benign profile
    risk_factors: List[str]
    investigation_summary: str
    evidence_trail: List[str]

class DecisionResult(TypedDict, total=False):
    decision: Literal["auto_block", "escalate", "clear"]
    decision_reasoning: str
    rule_triggered: Optional[str]
    confidence: float

class ActionResult(TypedDict, total=False):
    action_taken: str
    account_status: Literal["account_frozen", "flagged_for_review", "cleared"]
    action_details: Dict[str, Any]
    backend_used: str  # "simulated" or "mongo"

# ---------------------------------------------------------------------------
# LangGraph Workflow State
# ---------------------------------------------------------------------------

class InvestigationState(TypedDict, total=False):
    account_id: str
    account_data: Optional[AccountProfile]
    
    # 1. Output of Investigator Agent
    investigator_findings: Optional[InvestigatorFindings]
    
    # 2. Output of Decision Agent
    decision: Optional[Literal["auto_block", "escalate", "clear"]]
    decision_reasoning: Optional[str]
    rule_triggered: Optional[str]
    decision_confidence: Optional[float]
    
    # 3. Output of Action Agent
    action_taken: Optional[str]
    account_status: Optional[str]
    action_details: Optional[Dict[str, Any]]
    
    # 4. Output of Report Agent
    report: Optional[str]
    
    # Metadata, Telemetry & Resilience
    error: Optional[str]
    is_fallback: bool
    step_timings_ms: Optional[Dict[str, float]]
    total_latency_ms: Optional[float]
