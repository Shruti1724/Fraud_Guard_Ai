"""Central configuration module for FraudGuard AI Layer-1 Fraud Risk Service.

No weights or thresholds may be hardcoded anywhere else.
"""

from typing import Dict, Any

# Blending weights
W_XGB = 0.3
W_SAGE = 0.7

# Operational decision thresholds
FLAG_THRESHOLD = 0.85
WARN_THRESHOLD = 0.70

# Risk level categories (per docs/api-contract.md)
RISK_LEVEL_CRITICAL = "CRITICAL"
RISK_LEVEL_HIGH = "HIGH"
RISK_LEVEL_LOW = "LOW"

# Standard warning messages per team contract alignment
MSG_CRITICAL = "CRITICAL RISK: This receiver UPI ID was flagged in a mule-chain fraud ring. Payments to this account are restricted."
MSG_WARN = "WARNING: Recipient account flagged for suspicious transaction velocity."
MSG_SAFE = "Account verified. Safe for standard transfer."

# File paths
ARTIFACTS_DIR = "artifacts"
BLENDED_SCORES_PATH = f"{ARTIFACTS_DIR}/blended_scores.csv"
ACCOUNTS_CSV_PATH = "data/v2/accounts.csv"
LABELS_CSV_PATH = "data/v2/labels.csv"
SAGE_OOF_PATH = "results/ensemble/sage_edge_L2_oof.csv"
V2_OOF_PATH = "results/v2/oof_predictions.csv"


def get_risk_evaluation(risk_score: float) -> Dict[str, Any]:
    """Evaluate risk score against locked thresholds.

    Uses >= consistently at both thresholds.
    """
    is_flagged = bool(risk_score >= FLAG_THRESHOLD)
    trigger_investigation = is_flagged

    if is_flagged:
        risk_level = RISK_LEVEL_CRITICAL
        warning_message = MSG_CRITICAL
    elif risk_score >= WARN_THRESHOLD:
        risk_level = RISK_LEVEL_HIGH
        warning_message = MSG_WARN
    else:
        risk_level = RISK_LEVEL_LOW
        warning_message = MSG_SAFE

    return {
        "risk_level": risk_level,
        "is_flagged": is_flagged,
        "warning_message": warning_message,
        "trigger_investigation": trigger_investigation,
    }
