import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from typing import Dict, Any
from state import InvestigationState

def decision_node(state: InvestigationState) -> Dict[str, Any]:
    """LangGraph Node: Decision Agent
    Evaluates findings against the compliance risk matrix and produces:
    - 'auto_block' : High confidence fraud (mule chain, star burst smurfing, score >= 80)
    - 'escalate'   : Suspicious anomaly requiring verification/OTP challenge (score 50-79)
    - 'clear'      : Benign account activity (score < 50)
    """
    findings = state.get("investigator_findings") or {}
    score = findings.get("suspicion_score", 0)
    mule_detected = findings.get("mule_chain_detected", False)
    star_detected = findings.get("star_burst_detected", False)
    
    if mule_detected or (star_detected and score >= 75) or score >= 80:
        decision = "auto_block"
        reasoning = (
            f"Automated block triggered: High suspicion score ({score}/100) and critical topology match "
            f"(Mule Chain: {mule_detected}, Star Burst: {star_detected})."
        )
    elif score >= 50 or findings.get("abnormal_velocity_detected", False):
        decision = "escalate"
        reasoning = (
            f"Escalation required: Moderate suspicion score ({score}/100) or behavioral anomaly. "
            f"Step-up verification and compliance hold recommended."
        )
    else:
        decision = "clear"
        reasoning = (
            f"Account cleared: Low suspicion score ({score}/100) with no malicious topological patterns."
        )
        
    return {
        "decision": decision,
        "decision_reasoning": reasoning
    }
