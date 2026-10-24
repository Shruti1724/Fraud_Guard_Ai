"""Abstract Data Provider Interface for FraudGuard AI.

The agentic pipeline only ever interacts with this interface, never with CSV or Mongo directly.
"""

from abc import ABC, abstractmethod
from typing import Optional, List, Dict, Any
from state import AccountProfile, GraphNeighbor, TransactionRecord

class DataProvider(ABC):
    """Abstract interface for account data, graph topology, and transaction retrieval."""
    
    @staticmethod
    def normalize_account_id(identifier: str) -> str:
        """Defensively strip '@upi' suffix and whitespace, and normalize casing."""
        if not identifier:
            return ""
        ident = str(identifier).strip()
        if "@" in ident:
            ident = ident.split("@")[0]
        return ident

    @abstractmethod
    def get_account(self, account_id: str) -> Optional[AccountProfile]:
        """Fetch full account profile including balance, KYC, age, and transactions."""
        pass

    @abstractmethod
    def get_neighbors(self, account_id: str, hops: int = 1) -> List[GraphNeighbor]:
        """Fetch multi-hop graph neighborhood (inflows, outflows, shared devices)."""
        pass

    @abstractmethod
    def get_transactions(self, account_id: str, limit: int = 50) -> List[TransactionRecord]:
        """Fetch recent transaction history."""
        pass

    @abstractmethod
    def get_scores(self, account_id: str) -> Optional[Dict[str, float]]:
        """Fetch ML model scores (blended risk_score, xgb_score, sage_score)."""
        pass
    
    @abstractmethod
    def account_exists(self, account_id: str) -> bool:
        """Check if an account exists in the data source."""
        pass
