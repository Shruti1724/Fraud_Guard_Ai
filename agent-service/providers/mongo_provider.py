"""MongoDB Data Provider for FraudGuard AI.

Connects to Member A's MongoDB database to query account records,
graph relations, and transaction history.
Falls back to MockDataProvider if MongoDB is unreachable.
"""

import logging
from typing import Optional, List, Dict, Any

from .base import DataProvider
from .mock_provider import MockDataProvider
from state import AccountProfile, GraphNeighbor, TransactionRecord
from config import settings

logger = logging.getLogger("fraudguard-mongo-provider")

class MongoDataProvider(DataProvider):
    """DataProvider connecting to MongoDB."""

    def __init__(self, uri: Optional[str] = None, db_name: Optional[str] = None):
        self.uri = uri or settings.mongodb_uri
        self.db_name = db_name or settings.mongo_db_name
        self.client = None
        self.db = None
        self.mock_fallback = MockDataProvider()
        self._init_connection()

    def _init_connection(self):
        try:
            import pymongo
            self.client = pymongo.MongoClient(self.uri, serverSelectionTimeoutMS=2000)
            self.client.admin.command('ping')
            self.db = self.client[self.db_name]
            logger.info(f"Connected to MongoDB at {self.uri}")
        except Exception as e:
            logger.warning(
                f"MongoDB connection failed ({e}). Falling back to MockDataProvider."
            )
            self.client = None
            self.db = None

    def account_exists(self, account_id: str) -> bool:
        if self.db is not None:
            try:
                clean = self.normalize_account_id(account_id)
                count = self.db.accounts.count_documents({"account_id": clean})
                if count > 0:
                    return True
            except Exception:
                pass
        return self.mock_fallback.account_exists(account_id)

    def get_account(self, account_id: str) -> Optional[AccountProfile]:
        clean = self.normalize_account_id(account_id)
        if self.db is not None:
            try:
                doc = self.db.accounts.find_one({"account_id": clean})
                if doc:
                    risk_doc = self.db.risk_scores.find_one({"account_id": clean}) or {}
                    return {
                        "account_id": doc.get("account_id", clean),
                        "vpa_address": doc.get("vpa_address", f"{clean.lower()}@upi"),
                        "account_age_days": doc.get("account_age_days", 180),
                        "kyc_status": doc.get("kyc_status", "PARTIAL_MINIMUM_OTP"),
                        "avg_tx_amount": doc.get("avg_tx_amount", 5000.0),
                        "tx_frequency_per_day": doc.get("tx_frequency_per_day", 2.0),
                        "unique_counterparties": doc.get("unique_counterparties", 5),
                        "device_id": doc.get("device_id", "DEV_UNKNOWN"),
                        "ip_address": doc.get("ip_address", "103.21.144.1"),
                        "current_balance": doc.get("balance", doc.get("current_balance", 1000.0)),
                        "risk_score": risk_doc.get("risk_score", 0.0),
                        "xgb_score": risk_doc.get("xgb_score", 0.0),
                        "sage_score": risk_doc.get("sage_score", 0.0),
                        "risk_level": risk_doc.get("risk_level", "LOW"),
                        "recent_transactions": self.get_transactions(clean),
                        "graph_neighbors": self.get_neighbors(clean)
                    }
            except Exception as e:
                logger.error(f"Error querying Mongo for account {clean}: {e}")
                
        return self.mock_fallback.get_account(account_id)

    def get_neighbors(self, account_id: str, hops: int = 1) -> List[GraphNeighbor]:
        clean = self.normalize_account_id(account_id)
        if self.db is not None:
            try:
                # Query recent transactions where account is sender or receiver
                txs = list(self.db.transactions.find({
                    "$or": [{"sender_account_id": clean}, {"receiver_account_id": clean}]
                }).limit(50))
                
                neighbors = []
                for t in txs:
                    if t.get("sender_account_id") == clean:
                        neighbors.append({
                            "neighbor_id": t.get("receiver_account_id", ""),
                            "relation": "outflow",
                            "total_volume": float(t.get("amount", 0.0)),
                            "tx_count": 1,
                            "risk_label": t.get("status", "NORMAL")
                        })
                    else:
                        neighbors.append({
                            "neighbor_id": t.get("sender_account_id", ""),
                            "relation": "inflow",
                            "total_volume": float(t.get("amount", 0.0)),
                            "tx_count": 1,
                            "risk_label": t.get("status", "NORMAL")
                        })
                if neighbors:
                    return neighbors
            except Exception as e:
                logger.error(f"Error querying Mongo neighbors for {clean}: {e}")
                
        return self.mock_fallback.get_neighbors(account_id, hops)

    def get_transactions(self, account_id: str, limit: int = 50) -> List[TransactionRecord]:
        clean = self.normalize_account_id(account_id)
        if self.db is not None:
            try:
                txs = list(self.db.transactions.find({
                    "$or": [{"sender_account_id": clean}, {"receiver_account_id": clean}]
                }).sort("timestamp", -1).limit(limit))
                
                results = []
                for idx, t in enumerate(txs):
                    results.append({
                        "step": idx + 1,
                        "type": t.get("type", "PAYMENT"),
                        "amount": float(t.get("amount", 0.0)),
                        "nameOrig": t.get("sender_account_id", ""),
                        "nameDest": t.get("receiver_account_id", ""),
                        "timestamp": str(t.get("timestamp", "")),
                        "status": t.get("status", "SUCCESS")
                    })
                if results:
                    return results
            except Exception as e:
                logger.error(f"Error querying Mongo transactions for {clean}: {e}")
                
        return self.mock_fallback.get_transactions(account_id, limit)

    def get_scores(self, account_id: str) -> Optional[Dict[str, float]]:
        clean = self.normalize_account_id(account_id)
        if self.db is not None:
            try:
                doc = self.db.risk_scores.find_one({"account_id": clean})
                if doc:
                    return {
                        "risk_score": float(doc.get("risk_score", 0.0)),
                        "xgb_score": float(doc.get("xgb_score", 0.0)),
                        "sage_score": float(doc.get("sage_score", 0.0))
                    }
            except Exception as e:
                logger.error(f"Error querying Mongo scores for {clean}: {e}")
                
        return self.mock_fallback.get_scores(account_id)
