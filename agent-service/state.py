from typing import TypedDict, List, Dict, Any, Optional, Literal

class TransactionRecord(TypedDict, total=False):
    step: int
    type: str
    amount: float
    nameOrig: str
    nameDest: str
    timestamp: Optional[str]
    device_id: Optional[str]
    ip_address: Optional[str]
    status: Optional[str]

class GraphNeighbor(TypedDict, total=False):
    neighbor_id: str
    relation: str  # e.g., 'inflow', 'outflow', 'shared_device', 'shared_ip'
    total_volume: float
    tx_count: int
    risk_label: Optional[str]

class AccountProfile(TypedDict, total=False):
    account_id: str
    account_age_days: int
    avg_tx_amount: float
    tx_frequency_per_day: float
    unique_counterparties: int
    device_id: str
    ip_address: str
    kyc_status: str
    vpa_address: str
    current_balance: float
    recent_transactions: List[TransactionRecord]
    graph_neighbors: List[GraphNeighbor]

class InvestigatorFindings(TypedDict, total=False):
    suspicion_score: int  # 0 - 100
    risk_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    mule_chain_detected: bool
    star_burst_detected: bool
    abnormal_velocity_detected: bool
    risk_factors: List[str]
    investigation_summary: str
    evidence_trail: List[str]

class InvestigationState(TypedDict, total=False):
    account_id: str
    account_data: Optional[AccountProfile]
    
    # 1. Output of Investigator Agent
    investigator_findings: Optional[InvestigatorFindings]
    
    # 2. Output of Decision Agent
    decision: Optional[Literal["auto_block", "escalate", "clear"]]
    decision_reasoning: Optional[str]
    
    # 3. Output of Action Agent
    action_taken: Optional[str]
    action_details: Optional[Dict[str, Any]]
    
    # 4. Output of Report Agent
    report: Optional[str]
    
    # Pipeline Metadata & Fallback
    error: Optional[str]
    is_fallback: bool
    execution_time_ms: Optional[float]
