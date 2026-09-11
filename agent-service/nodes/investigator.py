import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from state import InvestigationState, InvestigatorFindings
from config import settings
import json
import re
import logging
from typing import Dict, Any
from langchain_ollama import ChatOllama
from langchain_core.messages import SystemMessage, HumanMessage

logger = logging.getLogger(__name__)

INVESTIGATOR_SYSTEM_PROMPT = """You are an expert Anti-Money Laundering (AML) and UPI Fraud Investigator for FraudGuard AI.
Your job is to analyze an account's profile, transaction velocity, counterparty behavior, and graph-neighborhood relationships.

Detect known financial fraud patterns:
1. Mule-Chain Layering: Rapid pass-through of funds from multiple source accounts to an aggregator with near-zero retained balance in new accounts.
2. Star-Burst / Smurfing: Sudden large credit fanned out immediately into multiple sub-threshold transactions to evade AML thresholds.
3. Account Takeover (ATO): Sudden shift in device/IP, unusual off-hours timing, or extreme deviation from historical ticket size.
4. Benign Activity: Consistent merchant or everyday retail transactions with verified KYC and long account tenure.

You MUST respond strictly with a valid JSON object (no markdown surrounding explanation, no conversational filler).
JSON Schema:
{
  "suspicion_score": <integer 0-100>,
  "risk_level": <"LOW" | "MEDIUM" | "HIGH" | "CRITICAL">,
  "mule_chain_detected": <boolean>,
  "star_burst_detected": <boolean>,
  "abnormal_velocity_detected": <boolean>,
  "risk_factors": [<list of concise risk factor strings>],
  "investigation_summary": "<concise 2-3 sentence forensic synthesis>",
  "evidence_trail": [<list of key observed data points>]
}
"""

def extract_json_from_response(text: str) -> Dict[str, Any]:
    """Helper to cleanly extract JSON even if LLM adds markdown backticks."""
    text = text.strip()
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        return json.loads(match.group(0))
    return json.loads(text)

def fallback_heuristic_investigation(account_data: Dict[str, Any]) -> InvestigatorFindings:
    """Deterministic fallback analysis in case LLM is unreachable."""
    age = account_data.get("account_age_days", 999)
    balance = account_data.get("current_balance", 0)
    txs = account_data.get("recent_transactions", [])
    neighbors = account_data.get("graph_neighbors", [])
    
    mule_flag = False
    star_flag = False
    velocity_flag = False
    risk_factors = []
    
    # Check for mule pattern
    has_victim_inflow = any("VICTIM" in str(n.get("risk_label", "")) for n in neighbors)
    has_sink_outflow = any("SINK" in str(n.get("risk_label", "")) for n in neighbors)
    if (has_victim_inflow or has_sink_outflow) and age < 30 and balance < 1000:
        mule_flag = True
        risk_factors.append("Mule chain layering pattern detected: rapid victim inflow to aggregator sink.")

    # Check for star pattern
    outflows = [t for t in txs if t.get("type") in ["PAYMENT", "TRANSFER"] and t.get("nameOrig") == account_data.get("account_id")]
    if len(outflows) >= 4 and age < 30:
        star_flag = True
        risk_factors.append("Star-burst dispersion topology: rapid fan-out to multiple leaf nodes.")

    # Check device/ATO
    device_id = str(account_data.get("device_id", ""))
    if "UNKNOWN" in device_id or "EMULATOR" in device_id or "MULE" in device_id:
        velocity_flag = True
        risk_factors.append(f"High risk device fingerprint: {device_id}")

    if mule_flag or star_flag:
        score = 92
        risk_level = "CRITICAL" if mule_flag else "HIGH"
    elif velocity_flag:
        score = 75
        risk_level = "MEDIUM"
    else:
        score = 10
        risk_level = "LOW"
        risk_factors.append("Consistent transaction pattern with standard KYC.")

    return {
        "suspicion_score": score,
        "risk_level": risk_level,
        "mule_chain_detected": mule_flag,
        "star_burst_detected": star_flag,
        "abnormal_velocity_detected": velocity_flag,
        "risk_factors": risk_factors,
        "investigation_summary": f"Heuristic investigation completed with suspicion score {score}/100. Factors: {', '.join(risk_factors)}",
        "evidence_trail": [f"Account age: {age} days", f"Balance: INR {balance}", f"Recent tx count: {len(txs)}"]
    }

def investigator_node(state: InvestigationState) -> Dict[str, Any]:
    """LangGraph Node: Investigator Agent"""
    account_id = state.get("account_id")
    account_data = state.get("account_data") or {}
    
    prompt_payload = {
        "account_id": account_id,
        "vpa_address": account_data.get("vpa_address", "unknown@upi"),
        "account_age_days": account_data.get("account_age_days", 0),
        "kyc_status": account_data.get("kyc_status", "UNKNOWN"),
        "avg_tx_amount": account_data.get("avg_tx_amount", 0.0),
        "tx_frequency_per_day": account_data.get("tx_frequency_per_day", 0.0),
        "unique_counterparties": account_data.get("unique_counterparties", 0),
        "device_id": account_data.get("device_id", "UNKNOWN"),
        "ip_address": account_data.get("ip_address", "UNKNOWN"),
        "current_balance": account_data.get("current_balance", 0.0),
        "recent_transactions": account_data.get("recent_transactions", []),
        "graph_neighbors": account_data.get("graph_neighbors", [])
    }
    
    findings: InvestigatorFindings
    try:
        llm = ChatOllama(
            base_url=settings.ollama_base_url,
            model=settings.ollama_model,
            temperature=settings.llm_temperature
        )
        
        user_message = f"Analyze the following UPI account and graph context:\n{json.dumps(prompt_payload, indent=2)}"
        response = llm.invoke([
            SystemMessage(content=INVESTIGATOR_SYSTEM_PROMPT),
            HumanMessage(content=user_message)
        ])
        
        parsed = extract_json_from_response(response.content)
        findings = {
            "suspicion_score": int(parsed.get("suspicion_score", 50)),
            "risk_level": parsed.get("risk_level", "MEDIUM"),
            "mule_chain_detected": bool(parsed.get("mule_chain_detected", False)),
            "star_burst_detected": bool(parsed.get("star_burst_detected", False)),
            "abnormal_velocity_detected": bool(parsed.get("abnormal_velocity_detected", False)),
            "risk_factors": list(parsed.get("risk_factors", [])),
            "investigation_summary": str(parsed.get("investigation_summary", "")),
            "evidence_trail": list(parsed.get("evidence_trail", []))
        }
    except Exception as e:
        logger.warning(f"Ollama LLM call failed or could not be parsed: {e}. Falling back to heuristic investigator.")
        findings = fallback_heuristic_investigation(account_data)

    return {
        "investigator_findings": findings
    }
