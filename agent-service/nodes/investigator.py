"""LangGraph Node: Investigator Agent (Layer 3)

Analyzes account profiles, transaction patterns, graph neighborhood,
per-model scores (XGBoost vs GraphSAGE), and distinguishes genuine
mule rings from innocent decoy look-alikes (family, forwarding, merchant, payroll).
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import json
import logging
from typing import Dict, Any, List, Optional, Literal
from pydantic import BaseModel, Field

from langchain_core.messages import SystemMessage, HumanMessage

from state import InvestigationState, InvestigatorFindings
from config import settings
from utils.llm_client import call_ollama_structured

logger = logging.getLogger("fraudguard-investigator")

# ---------------------------------------------------------------------------
# Pydantic Schema for Structured Output Validation
# ---------------------------------------------------------------------------

class InvestigatorOutputSchema(BaseModel):
    suspicion_score: int = Field(..., ge=0, le=100, description="Forensic suspicion score (0 - 100)")
    risk_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    mule_chain_detected: bool = Field(default=False)
    star_burst_detected: bool = Field(default=False)
    cycle_detected: bool = Field(default=False)
    fan_out_detected: bool = Field(default=False)
    abnormal_velocity_detected: bool = Field(default=False)
    innocent_lookalike_detected: Literal[
        "family_group", "forwarding_chain", "merchant_hub", "payroll_fanout", "none"
    ] = Field(default="none")
    decoy_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    decoy_rationale: Optional[str] = Field(default=None)
    model_divergence_observed: bool = Field(default=False)
    risk_factors: List[str] = Field(default_factory=list)
    investigation_summary: str = Field(...)
    evidence_trail: List[str] = Field(default_factory=list)

# ---------------------------------------------------------------------------
# Investigator System Prompt
# ---------------------------------------------------------------------------

INVESTIGATOR_SYSTEM_PROMPT = """You are the Senior AML & UPI Fraud Forensic Investigator for FraudGuard AI.
Your objective is to conduct a forensic investigation on an account flagged by Layer-1 ML models (GraphSAGE and XGBoost).

CRITICAL MISSION:
At the 0.85 flag threshold, model precision is ~0.43 (over half of flagged accounts are innocent look-alikes).
You MUST distinguish genuine mule syndicates from innocent look-alikes (decoys).

1. GENUINE FRAUD TOPOLOGIES:
- Mule-Chain Layering: Fast pass-through of funds across hops with near-zero retained balance (< 5%), new accounts (< 30 days), minimal KYC, immediate relay to sink.
- Star-Burst / Smurfing: Sudden large credit broken into multiple sub-threshold transactions (< INR 10,000) dispersed rapidly to leaf wallets.
- Cycle Ring: Rapid looping of funds (A -> B -> C -> A) to create synthetic turnover, ending in a cashout sink.
- Fan-Out Syndicate: Source sends to multiple smurf relays who pass to a single aggregator for final cashout.
- Account Takeover (ATO): Sudden shift to emulator/Linux/Tor IP, off-hours timing, radical deviation from historical ticket size.

2. INNOCENT LOOK-ALIKES (DECOYS TO CLEAR):
- Merchant Hub: High volume of small incoming customer payments (100 - 5,000 INR), routine periodic vendor/bank payouts, account tenure > 180 days, verified KYC, healthy balance.
- Payroll Fan-Out: Established company account paying regular employee salaries (25k - 80k INR) on fixed monthly cycles.
- Forwarding Chain (Split Expenses): Peer-to-peer flatmate/colleague transfers (rent/bills) with realistic hours/days gaps, organic tenure, no aggregator sink.
- Family Group: Bidirectional transfers between verified family members with shared domestic history, long tenure (> 1 year), and consistent personal KYC.

3. MODEL DIVERGENCE ANALYSIS:
- If GraphSAGE score (sage_score) is high (>= 0.85) but XGBoost score (xgb_score) is low (< 0.30), the account was flagged purely due to network degree or proximity. If KYC is verified and tenure > 180 days, this strongly suggests a benign decoy.

You MUST respond strictly with a valid JSON object matching the schema below:
{
  "suspicion_score": <integer 0-100>,
  "risk_level": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "mule_chain_detected": <boolean>,
  "star_burst_detected": <boolean>,
  "cycle_detected": <boolean>,
  "fan_out_detected": <boolean>,
  "abnormal_velocity_detected": <boolean>,
  "innocent_lookalike_detected": "family_group" | "forwarding_chain" | "merchant_hub" | "payroll_fanout" | "none",
  "decoy_confidence": <float 0.0-1.0>,
  "decoy_rationale": "<explanation if innocent decoy, else null>",
  "model_divergence_observed": <boolean>,
  "risk_factors": [<concise risk factor strings>],
  "investigation_summary": "<concise 2-3 sentence forensic synthesis>",
  "evidence_trail": [<key observed factual data points>]
}
"""

# ---------------------------------------------------------------------------
# Deterministic Heuristic Fallback
# ---------------------------------------------------------------------------

def fallback_heuristic_investigation(account_data: Dict[str, Any]) -> InvestigatorFindings:
    """Deterministic rule-based forensic analysis used when Ollama is unreachable."""
    age = account_data.get("account_age_days", 365)
    balance = account_data.get("current_balance", 0.0)
    kyc = account_data.get("kyc_status", "UNKNOWN")
    category = account_data.get("category", "personal")
    txs = account_data.get("recent_transactions", [])
    neighbors = account_data.get("graph_neighbors", [])
    device_id = str(account_data.get("device_id", ""))
    
    xgb_score = float(account_data.get("xgb_score", 0.0) or 0.0)
    sage_score = float(account_data.get("sage_score", 0.0) or 0.0)
    risk_score = float(account_data.get("risk_score", 0.0) or 0.0)

    # 1. Check for innocent look-alike decoys
    is_decoy = False
    decoy_type = "none"
    decoy_confidence = 0.0
    decoy_rationale = None

    # Merchant Hub Decoy Check
    if category == "merchant" or category == "merchant_hub" or (age > 180 and "MERCHANT" in device_id or "POS" in device_id):
        if not any("SINK" in str(n.get("risk_label", "")) for n in neighbors):
            is_decoy = True
            decoy_type = "merchant_hub"
            decoy_confidence = 0.95
            decoy_rationale = "Legitimate merchant operations: high counterparty volume with verified POS hardware and established tenure."

    # Payroll Fan-Out Decoy Check
    elif category == "payroll" or category == "payroll_fanout" or (age > 300 and balance > 100000 and "CORP" in device_id):
        is_decoy = True
        decoy_type = "payroll_fanout"
        decoy_confidence = 0.92
        decoy_rationale = "Legitimate corporate payroll distribution: scheduled batch payments from corporate liquidity account."

    # Family Group Decoy Check
    elif category == "family" or (age > 365 and kyc == "FULL_BIOMETRIC_VERIFIED" and len(neighbors) <= 5):
        has_bidirectional = any(n.get("relation") == "inflow" for n in neighbors) and any(n.get("relation") == "outflow" for n in neighbors)
        if has_bidirectional and not any("SINK" in str(n.get("risk_label", "")) for n in neighbors):
            is_decoy = True
            decoy_type = "family_group"
            decoy_confidence = 0.90
            decoy_rationale = "Benign family support cluster: reciprocal transfers between verified relatives with high account age."

    # Forwarding Chain Decoy Check
    elif category == "forward_chain" or (age > 180 and kyc == "FULL_BIOMETRIC_VERIFIED" and balance > 5000):
        if not any("SINK" in str(n.get("risk_label", "")) for n in neighbors):
            is_decoy = True
            decoy_type = "forwarding_chain"
            decoy_confidence = 0.85
            decoy_rationale = "Benign personal expense sharing: staggered forwarding with substantial balance retention."

    # Model divergence observation
    model_divergence = bool(sage_score >= 0.80 and xgb_score < 0.30 and age > 90)

    # 2. Check for malicious patterns
    mule_chain = False
    star_burst = False
    cycle_detected = False
    velocity_anomaly = False
    risk_factors = []
    
    has_victim = any("VICTIM" in str(n.get("risk_label", "")) for n in neighbors)
    has_sink = any("SINK" in str(n.get("risk_label", "")) for n in neighbors)

    if (has_victim or has_sink) and age < 30 and balance < 2000:
        mule_chain = True
        risk_factors.append("Mule-chain layering confirmed: rapid victim inflow to aggregator sink with near-zero retained balance.")

    outflows = [t for t in txs if t.get("type") in ["PAYMENT", "TRANSFER"] and t.get("nameOrig") == account_data.get("account_id")]
    if len(outflows) >= 4 and age < 30 and "EMULATOR" in device_id:
        star_burst = True
        risk_factors.append("Star-burst smurfing detected: rapid dispersal into multiple sub-threshold micro-transactions.")

    if "EMULATOR" in device_id or "MULE" in device_id or "TOR" in str(neighbors):
        risk_factors.append(f"Compromised device/network fingerprint: {device_id}")
        velocity_anomaly = True

    if is_decoy:
        suspicion_score = 15
        risk_level = "LOW"
        risk_factors.append(f"Innocent look-alike detected ({decoy_type}). Layer-1 GNN flag dismissed as graph proximity false-positive.")
    elif mule_chain or (star_burst and age < 15):
        suspicion_score = 95
        risk_level = "CRITICAL"
    elif velocity_anomaly or risk_score >= settings.WARN_THRESHOLD:
        suspicion_score = 72
        risk_level = "HIGH"
    else:
        suspicion_score = 10
        risk_level = "LOW"
        risk_factors.append("Standard verified transaction profile with consistent balance.")

    summary = (
        f"Forensic investigation completed (heuristic fallback). Suspicion score: {suspicion_score}/100. "
        f"{'Decoy profile: ' + decoy_type if is_decoy else 'Risk factors: ' + '; '.join(risk_factors)}"
    )

    return {
        "suspicion_score": suspicion_score,
        "risk_level": risk_level,
        "mule_chain_detected": mule_chain,
        "star_burst_detected": star_burst,
        "cycle_detected": cycle_detected,
        "fan_out_detected": False,
        "abnormal_velocity_detected": velocity_anomaly,
        "innocent_lookalike_detected": decoy_type,
        "decoy_confidence": decoy_confidence,
        "decoy_rationale": decoy_rationale,
        "model_divergence_observed": model_divergence,
        "risk_factors": risk_factors,
        "investigation_summary": summary,
        "evidence_trail": [
            f"Account age: {age} days",
            f"KYC status: {kyc}",
            f"Current balance: INR {balance}",
            f"Blended risk score: {risk_score:.3f} (XGB: {xgb_score:.3f}, SAGE: {sage_score:.3f})",
            f"Counterparties count: {account_data.get('unique_counterparties', 0)}"
        ]
    }

# ---------------------------------------------------------------------------
# LangGraph Investigator Node Entrypoint
# ---------------------------------------------------------------------------

def investigator_node(state: InvestigationState) -> Dict[str, Any]:
    """LangGraph Node: Investigator Agent"""
    account_id = state.get("account_id")
    account_data = state.get("account_data") or {}

    age = account_data.get("account_age_days", 999)
    balance = float(account_data.get("current_balance", 0.0) or 0.0)
    neighbors = account_data.get("graph_neighbors", [])
    txs = account_data.get("recent_transactions", [])
    device_id = str(account_data.get("device_id", ""))

    has_mule_neighbor = any("MULE" in str(n.get("risk_label", "")).upper() or "FLAGGED" in str(n.get("risk_label", "")).upper() for n in neighbors)
    has_victim = any("VICTIM" in str(n.get("risk_label", "")).upper() for n in neighbors)
    has_sink = any("SINK" in str(n.get("risk_label", "")).upper() for n in neighbors)
    is_factual_mule = (has_victim or has_sink or has_mule_neighbor) and (age < 45 or balance < 2000 or float(account_data.get("risk_score", 0.0) or 0.0) >= settings.FLAG_THRESHOLD)
    is_emulator = "EMULATOR" in device_id.upper() or "MULE" in device_id.upper()

    payload = {
        "account_id": account_id,
        "vpa_address": account_data.get("vpa_address", f"{str(account_id).lower()}@upi"),
        "account_age_days": age if age != 999 else "UNKNOWN",
        "kyc_status": account_data.get("kyc_status", "UNKNOWN"),
        "current_balance": balance,
        "avg_tx_amount": account_data.get("avg_tx_amount", 0.0),
        "tx_frequency_per_day": account_data.get("tx_frequency_per_day", 0.0),
        "unique_counterparties": account_data.get("unique_counterparties", 0),
        "device_id": device_id,
        "category": account_data.get("category", "personal"),
        "scores": {
            "risk_score": account_data.get("risk_score", 0.0),
            "xgb_score": account_data.get("xgb_score", 0.0),
            "sage_score": account_data.get("sage_score", 0.0)
        },
        "factual_graph_signals": {
            "has_mule_adjacency": has_mule_neighbor,
            "has_victim_inflow": has_victim,
            "has_aggregator_sink_outflow": has_sink,
            "is_confirmed_mule_chain": is_factual_mule,
            "is_suspicious_device": is_emulator
        },
        "recent_transactions": txs,
        "graph_neighbors": neighbors
    }

    user_prompt = f"Analyze the following UPI account profile and graph context:\n{json.dumps(payload, indent=2)}"
    messages = [
        SystemMessage(content=INVESTIGATOR_SYSTEM_PROMPT),
        HumanMessage(content=user_prompt)
    ]

    findings_dict = call_ollama_structured(
        messages=messages,
        schema_cls=InvestigatorOutputSchema,
        fallback_fn=lambda: fallback_heuristic_investigation(account_data)
    )

    # Cast to InvestigatorFindings typed dict
    findings: InvestigatorFindings = {
        "suspicion_score": int(findings_dict.get("suspicion_score", 50)),
        "risk_level": findings_dict.get("risk_level", "MEDIUM"),
        "mule_chain_detected": bool(findings_dict.get("mule_chain_detected", False)),
        "star_burst_detected": bool(findings_dict.get("star_burst_detected", False)),
        "cycle_detected": bool(findings_dict.get("cycle_detected", False)),
        "fan_out_detected": bool(findings_dict.get("fan_out_detected", False)),
        "abnormal_velocity_detected": bool(findings_dict.get("abnormal_velocity_detected", False)),
        "innocent_lookalike_detected": findings_dict.get("innocent_lookalike_detected", "none"),
        "decoy_confidence": float(findings_dict.get("decoy_confidence", 0.0)),
        "decoy_rationale": findings_dict.get("decoy_rationale"),
        "model_divergence_observed": bool(findings_dict.get("model_divergence_observed", False)),
        "risk_factors": list(findings_dict.get("risk_factors", [])),
        "investigation_summary": str(findings_dict.get("investigation_summary", "")),
        "evidence_trail": list(findings_dict.get("evidence_trail", []))
    }

    # Deterministic enforcement: factual ground-truth cannot be overridden by LLM hallucination
    if is_factual_mule or has_mule_neighbor or float(account_data.get("risk_score", 0.0) or 0.0) >= settings.FLAG_THRESHOLD:
        findings["mule_chain_detected"] = True
        findings["suspicion_score"] = max(findings["suspicion_score"], 95)
        findings["risk_level"] = "CRITICAL"
        findings["innocent_lookalike_detected"] = "none"
        if not any("mule" in rf.lower() for rf in findings["risk_factors"]):
            findings["risk_factors"].append("Mule ring connectivity confirmed: direct adjacency to flagged mule/syndicate nodes.")

    return {"investigator_findings": findings}
