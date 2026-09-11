import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from typing import Dict, Any
from state import InvestigationState

def report_node(state: InvestigationState) -> Dict[str, Any]:
    """LangGraph Node: Report Agent
    Synthesizes investigation findings, decision rationale, and mitigation steps into a clean audit report.
    """
    account_id = state.get("account_id", "unknown")
    account_data = state.get("account_data") or {}
    vpa = account_data.get("vpa_address", "N/A")
    kyc = account_data.get("kyc_status", "N/A")
    age = account_data.get("account_age_days", "N/A")
    
    findings = state.get("investigator_findings") or {}
    score = findings.get("suspicion_score", 0)
    risk_level = findings.get("risk_level", "UNKNOWN")
    factors = findings.get("risk_factors", [])
    summary = findings.get("investigation_summary", "No summary provided.")
    
    decision = state.get("decision", "UNKNOWN").upper()
    action_taken = state.get("action_taken", "None")
    
    formatted_factors = "\n  - " + "\n  - ".join(factors) if factors else " None identified."
    
    report = (
        f"=== FRAUDGUARD AI CASE AUDIT REPORT ===\n"
        f"Target Account : {account_id} ({vpa})\n"
        f"Account Age    : {age} days | KYC Status: {kyc}\n"
        f"Risk Level     : {risk_level} (Score: {score}/100)\n\n"
        f"[Investigation Summary]\n"
        f"{summary}\n\n"
        f"[Identified Risk Factors]{formatted_factors}\n\n"
        f"[Enforcement Directive]\n"
        f"Decision     : {decision}\n"
        f"Action Taken : {action_taken}\n"
        f"========================================"
    )
    
    return {
        "report": report
    }
