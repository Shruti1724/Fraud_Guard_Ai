import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from typing import Dict, Any
from state import InvestigationState

def action_node(state: InvestigationState) -> Dict[str, Any]:
    """LangGraph Node: Action Agent
    Translates the decision into executable mitigation directives for the UPI switch / banking core.
    """
    decision = state.get("decision", "clear")
    account_data = state.get("account_data") or {}
    vpa = account_data.get("vpa_address", "account_vpa")
    device_id = account_data.get("device_id", "UNKNOWN_DEV")
    
    action_details = {}
    if decision == "auto_block":
        action_taken = (
            f"UPI ID '{vpa}' revoked; Immediate debit freeze applied on NPCI switch; "
            f"Device '{device_id}' blacklisted across inter-bank fraud registry."
        )
        action_details = {
            "freeze_debit": True,
            "revoke_upi_handle": True,
            "blacklist_device": device_id,
            "notify_npci_registry": True
        }
    elif decision == "escalate":
        action_taken = (
            f"Transient 30-minute hold placed on outbound transfers; "
            f"Biometric step-up OTP challenge issued to registered device; Case flagged for Tier-2 fraud review."
        )
        action_details = {
            "freeze_debit": False,
            "transient_hold_minutes": 30,
            "step_up_challenge_sent": True,
            "compliance_ticket_created": True
        }
    else:  # clear
        action_taken = (
            f"No restrictions applied; Normal UPI payment flows authorized; "
            f"Telemetry logged as verified benign activity."
        )
        action_details = {
            "freeze_debit": False,
            "risk_status": "NORMAL"
        }

    return {
        "action_taken": action_taken,
        "action_details": action_details
    }
