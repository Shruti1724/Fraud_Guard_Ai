"""Mock Data Provider for testing and local demonstration.

Loads accounts from data/mock_accounts.json and handles case-insensitive
and VPA-normalized lookups.
"""

import json
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any

from .base import DataProvider
from state import AccountProfile, GraphNeighbor, TransactionRecord
from config import settings

logger = logging.getLogger("fraudguard-mock-provider")

class MockDataProvider(DataProvider):
    """In-memory DataProvider backed by mock_accounts.json."""

    def __init__(self, data_file: Optional[str] = None):
        self.data_file = Path(data_file or settings.mock_accounts_file)
        self.accounts: Dict[str, AccountProfile] = {}
        self.vpa_lookup: Dict[str, str] = {}
        self.case_insensitive_map: Dict[str, str] = {}
        self.load_data()

    def load_data(self):
        """Load account records from JSON file."""
        if not self.data_file.exists():
            logger.warning(f"Mock accounts file not found: {self.data_file}")
            return
            
        try:
            with open(self.data_file, "r") as f:
                data = json.load(f)
                
            self.accounts = data
            for acc_id, profile in data.items():
                # Map account_id normalized
                norm_id = self.normalize_account_id(acc_id).lower()
                self.case_insensitive_map[norm_id] = acc_id
                
                # Map VPA address if present
                vpa = profile.get("vpa_address")
                if vpa:
                    vpa_clean = vpa.strip().lower()
                    self.vpa_lookup[vpa_clean] = acc_id
                    vpa_no_domain = self.normalize_account_id(vpa_clean).lower()
                    self.case_insensitive_map[vpa_no_domain] = acc_id
                    
            logger.info(f"MockDataProvider loaded {len(self.accounts)} accounts.")
        except Exception as e:
            logger.error(f"Failed to load mock accounts: {e}")

    def _resolve_account_id(self, identifier: str) -> Optional[str]:
        """Resolve identifier (id, VPA, normalized) to exact key in self.accounts."""
        if not identifier:
            return None
        # 1. Exact match
        if identifier in self.accounts:
            return identifier
            
        # 2. VPA match
        vpa_clean = identifier.strip().lower()
        if vpa_clean in self.vpa_lookup:
            return self.vpa_lookup[vpa_clean]
            
        # 3. Normalized ID match
        norm = self.normalize_account_id(identifier).lower()
        if norm in self.case_insensitive_map:
            return self.case_insensitive_map[norm]
            
        return None

    def account_exists(self, account_id: str) -> bool:
        return self._resolve_account_id(account_id) is not None

    def get_account(self, account_id: str) -> Optional[AccountProfile]:
        resolved_id = self._resolve_account_id(account_id)
        if not resolved_id:
            return None
        return self.accounts.get(resolved_id)

    def get_neighbors(self, account_id: str, hops: int = 1) -> List[GraphNeighbor]:
        acc = self.get_account(account_id)
        if not acc:
            return []
        return acc.get("graph_neighbors", [])

    def get_transactions(self, account_id: str, limit: int = 50) -> List[TransactionRecord]:
        acc = self.get_account(account_id)
        if not acc:
            return []
        txs = acc.get("recent_transactions", [])
        return txs[:limit]

    def get_scores(self, account_id: str) -> Optional[Dict[str, float]]:
        acc = self.get_account(account_id)
        if not acc:
            return None
        return {
            "risk_score": acc.get("risk_score", 0.0),
            "xgb_score": acc.get("xgb_score", 0.0),
            "sage_score": acc.get("sage_score", 0.0)
        }
