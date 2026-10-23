"""LangGraph Node: Action Agent (Layer 3)

Translates autonomous policy decisions into executable mitigation directives
for the UPI Switch / Core Banking System.

Architecture:
- Pluggable backends: SimulatedActionBackend (default) & MongoActionBackend
- Formal Action State Mapping:
    auto_block -> account_frozen
    escalate   -> flagged_for_review
    clear      -> cleared
- Never mutates Member B's precomputed risk scores
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import time
import logging
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional

from state import InvestigationState
from config import settings

logger = logging.getLogger("fraudguard-action")

# ---------------------------------------------------------------------------
# Pluggable Action Backend Abstraction
# ---------------------------------------------------------------------------

class ActionBackend(ABC):
    """Abstract interface for mitigation execution."""

    @abstractmethod
    def execute(
        self,
        account_id: str,
        decision: str,
        account_data: Dict[str, Any],
        action_taken: str,
        account_status: str,
        action_details: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute or persist the mitigation directive."""
        pass


class SimulatedActionBackend(ActionBackend):
    """Simulated execution engine that logs actions and produces audit records."""

    def execute(
        self,
        account_id: str,
        decision: str,
        account_data: Dict[str, Any],
        action_taken: str,
        account_status: str,
        action_details: Dict[str, Any]
    ) -> Dict[str, Any]:
        logger.info(
            f"[SimulatedAction] Applied status '{account_status}' for {account_id} -> {action_taken}"
        )
        return {
            "backend": "simulated",
            "persisted": False,
            "account_status": account_status,
            "timestamp": time.time(),
            "details": action_details
        }


class MongoActionBackend(ActionBackend):
    """Real database execution engine persisting changes to Member A's MongoDB."""

    def __init__(self, uri: Optional[str] = None, db_name: Optional[str] = None):
        self.uri = uri or settings.mongodb_uri
        self.db_name = db_name or settings.mongo_db_name
        self.client = None
        self.db = None
        self._init_mongo()

    def _init_mongo(self):
        try:
            import pymongo
            self.client = pymongo.MongoClient(self.uri, serverSelectionTimeoutMS=2000)
            self.client.admin.command('ping')
            self.db = self.client[self.db_name]
            logger.info(f"[MongoAction] Connected to MongoDB at {self.uri}")
        except Exception as e:
            logger.warning(f"[MongoAction] Failed to connect to MongoDB ({e}). Actions will run simulated.")
            self.client = None
            self.db = None

    def execute(
        self,
        account_id: str,
        decision: str,
        account_data: Dict[str, Any],
        action_taken: str,
        account_status: str,
        action_details: Dict[str, Any]
    ) -> Dict[str, Any]:
        if self.db is None:
            logger.info(f"[MongoAction] No DB connection. Falling back to simulated for {account_id}.")
            return {
                "backend": "mongo_simulated_fallback",
                "persisted": False,
                "account_status": account_status,
                "timestamp": time.time(),
                "details": action_details
            }

        try:
            # 1. Update account status in 'accounts' collection
            self.db.accounts.update_one(
                {"account_id": account_id},
                {
                    "$set": {
                        "status": account_status,
                        "last_investigated_at": time.time(),
                        "last_decision": decision
                    }
                },
                upsert=True
            )

            # 2. Record audit log in 'audit_actions' collection
            action_doc = {
                "action_id": f"ACT-{int(time.time() * 1000)}",
                "account_id": account_id,
                "action_type": decision.upper(),
                "account_status": account_status,
                "target_system": "UPI_SWITCH_NPCI",
                "action_taken": action_taken,
                "details": action_details,
                "created_at": time.time()
            }
            self.db.audit_actions.insert_one(action_doc)

            logger.info(f"[MongoAction] Successfully persisted mitigation for {account_id} into MongoDB.")
            return {
                "backend": "mongo",
                "persisted": True,
                "account_status": account_status,
                "action_id": action_doc["action_id"],
                "timestamp": action_doc["created_at"],
                "details": action_details
            }
        except Exception as e:
            logger.error(f"[MongoAction] Error writing to MongoDB for {account_id}: {e}")
            return {
                "backend": "mongo_error_fallback",
                "persisted": False,
                "error": str(e),
                "account_status": account_status,
                "timestamp": time.time(),
                "details": action_details
            }


# ---------------------------------------------------------------------------
# Backend Factory
# ---------------------------------------------------------------------------

def get_action_backend() -> ActionBackend:
    """Return configured ActionBackend singleton."""
    mode = settings.action_backend.lower()
    if mode == "mongo":
        return MongoActionBackend()
    return SimulatedActionBackend()


# ---------------------------------------------------------------------------
# LangGraph Action Node Entrypoint
# ---------------------------------------------------------------------------

def action_node(state: InvestigationState) -> Dict[str, Any]:
    """LangGraph Node: Action Agent"""
    decision = state.get("decision", "clear")
    account_id = state.get("account_id", "unknown")
    account_data = state.get("account_data") or {}
    vpa = account_data.get("vpa_address", f"{str(account_id).lower()}@upi")
    device_id = account_data.get("device_id", "UNKNOWN_DEV")

    if decision == "auto_block":
        account_status = "account_frozen"
        action_taken = (
            f"UPI ID '{vpa}' revoked; Immediate debit freeze applied on NPCI switch; "
            f"Device '{device_id}' blacklisted across inter-bank fraud registry."
        )
        action_details = {
            "freeze_debit": True,
            "revoke_upi_handle": True,
            "blacklist_device": device_id,
            "notify_npci_registry": True,
            "risk_status": "FROZEN"
        }
    elif decision == "escalate":
        account_status = "flagged_for_review"
        action_taken = (
            f"Transient 30-minute hold placed on outbound transfers; "
            f"Biometric step-up OTP challenge issued to registered device; Case flagged for Tier-2 fraud review."
        )
        action_details = {
            "freeze_debit": False,
            "transient_hold_minutes": 30,
            "step_up_challenge_sent": True,
            "compliance_ticket_created": True,
            "risk_status": "UNDER_REVIEW"
        }
    else:  # clear
        account_status = "cleared"
        action_taken = (
            f"No restrictions applied; Normal UPI payment flows authorized; "
            f"Telemetry logged as verified benign activity."
        )
        action_details = {
            "freeze_debit": False,
            "risk_status": "NORMAL",
            "audit_note": "False alarm cleared by Layer-3 investigation."
        }

    backend = get_action_backend()
    exec_result = backend.execute(
        account_id=account_id,
        decision=decision,
        account_data=account_data,
        action_taken=action_taken,
        account_status=account_status,
        action_details=action_details
    )

    return {
        "action_taken": action_taken,
        "account_status": account_status,
        "action_details": exec_result
    }
