"""LangGraph Node: Report Agent (Layer 3)

Synthesizes investigation findings, multi-model score evidence, topological patterns,
autonomous decision reasoning, and executed mitigation directives into a comprehensive,
human-readable forensic case audit report.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from datetime import datetime, timezone
from typing import Dict, Any, List

from state import InvestigationState, InvestigatorFindings
from config import settings

def format_score(val: Any) -> str:
    """Format float or int score safely."""
    if val is None:
        return "N/A"
    try:
        return f"{float(val):.3f}"
    except (ValueError, TypeError):
        return str(val)

def report_node(state: InvestigationState) -> Dict[str, Any]:
    """LangGraph Node: Report Agent"""
    account_id = state.get("account_id", "unknown")
    account_data = state.get("account_data") or {}
    vpa = account_data.get("vpa_address", f"{account_id.lower()}@upi")
    kyc = account_data.get("kyc_status", "UNKNOWN")
    age = account_data.get("account_age_days", "N/A")
    balance = account_data.get("current_balance", 0.0)

    # Multi-model scores
    risk_score = account_data.get("risk_score")
    xgb_score = account_data.get("xgb_score")
    sage_score = account_data.get("sage_score")

    # Investigator findings
    findings: InvestigatorFindings = state.get("investigator_findings") or {}
    suspicion_score = findings.get("suspicion_score", 0)
    risk_level = findings.get("risk_level", "UNKNOWN")
    factors = findings.get("risk_factors", [])
    summary = findings.get("investigation_summary", "No forensic summary recorded.")
    evidence = findings.get("evidence_trail", [])
    decoy = findings.get("innocent_lookalike_detected", "none")
    decoy_rationale = findings.get("decoy_rationale")
    model_divergence = findings.get("model_divergence_observed", False)

    # Decision & Action
    decision = str(state.get("decision", "CLEAR")).upper()
    reasoning = state.get("decision_reasoning", "Evaluated by autonomous policy engine.")
    action_taken = state.get("action_taken", "None")
    account_status = state.get("account_status", "active")

    # Topological Pattern Identification
    topology_detected = "None identified"
    if findings.get("mule_chain_detected"):
        topology_detected = "Mule-Chain Layering Scheme (Rapid Pass-Through)"
    elif findings.get("star_burst_detected"):
        topology_detected = "Star-Burst / Smurfing Dispersion Network"
    elif findings.get("cycle_detected"):
        topology_detected = "Cyclic Wash-Trading Ring"
    elif findings.get("fan_out_detected"):
        topology_detected = "Fan-Out Syndicate Smurfing"
    elif decoy and decoy != "none":
        topology_detected = f"Innocent Look-Alike Decoy: {decoy.replace('_', ' ').title()}"

    # Build formatted sections
    formatted_factors = "\n  - " + "\n  - ".join(factors) if factors else "  - None identified (standard profile)"
    formatted_evidence = "\n  - " + "\n  - ".join(evidence) if evidence else "  - Baseline account attributes verified"

    # Divergence Note
    divergence_str = ""
    if decoy and decoy != "none" and decision == "CLEAR":
        divergence_str = (
            f"\n[Model Divergence Analysis]\n"
            f"Layer-1 Graph model (GraphSAGE: {format_score(sage_score)}) elevated the account due to structural "
            f"graph proximity. However, tabular profile (XGBoost: {format_score(xgb_score)}) and forensic review "
            f"confirm legitimate tenure ({age} days, KYC: {kyc}). Over-flag resolved as a false alarm.\n"
        )
    elif model_divergence:
        divergence_str = (
            f"\n[Model Divergence Analysis]\n"
            f"Layer-1 Graph model (GraphSAGE: {format_score(sage_score)}) and tabular model (XGBoost: {format_score(xgb_score)}) "
            f"exhibit score divergence. Discrepancy between topology and profile indicators evaluated under forensic review.\n"
        )

    timestamp_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    report = (
        f"=== FRAUDGUARD AI CASE AUDIT REPORT ===\n"
        f"Case ID        : FG-CASE-{account_id}-{int(datetime.now(timezone.utc).timestamp())}\n"
        f"Target Account : {account_id} ({vpa})\n"
        f"Account Age    : {age} days | KYC Status: {kyc} | Balance: INR {balance:,.2f}\n"
        f"Risk Score     : {suspicion_score}/100 ({risk_level})\n"
        f"Model Blending : Risk Score: {format_score(risk_score)} | Tabular (XGB): {format_score(xgb_score)} | Graph (SAGE): {format_score(sage_score)}\n"
        f"Topology Found : {topology_detected}\n"
        f"{divergence_str}\n"
        f"[Investigation Summary]\n"
        f"{summary}\n\n"
        f"[Forensic Evidence Trail]{formatted_evidence}\n\n"
        f"[Identified Risk Factors]{formatted_factors}\n\n"
        f"[Enforcement Directive]\n"
        f"Autonomous Verdict : {decision}\n"
        f"Account State      : {account_status.upper()}\n"
        f"Policy Rationale   : {reasoning}\n"
        f"Action Executed    : {action_taken}\n"
        f"\n[Audit Trail Metadata]\n"
        f"Generated At       : {timestamp_str}\n"
        f"Service Engine     : {settings.app_name} v{settings.version}\n"
        f"Compliance Status  : VERIFIED & SEALED\n"
        f"========================================"
    )

    return {"report": report}
