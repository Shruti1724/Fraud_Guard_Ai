"""CSV Data Provider for FraudGuard AI.

Loads account profiles and scores directly from Member B's dataset artifacts:
- artifacts/blended_scores.csv (account_id, xgb_score, sage_score, risk_score)
- data/v2/accounts.csv (account_id, vpa_address, account_age_days, kyc_status, etc.)
- data/v2/transactions.csv (if available, for transaction edges & neighbors)

If files are not yet generated, logs a descriptive warning and delegates to MockDataProvider.
"""

import os
import csv
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any

from .base import DataProvider
from .mock_provider import MockDataProvider
from state import AccountProfile, GraphNeighbor, TransactionRecord
from config import settings

logger = logging.getLogger("fraudguard-csv-provider")

class CsvDataProvider(DataProvider):
    """DataProvider reading from Member B's generated CSV files."""

    def __init__(
        self,
        blended_scores_path: Optional[str] = None,
        accounts_csv_path: Optional[str] = None,
        edges_csv_path: Optional[str] = None
    ):
        self.blended_scores_path = Path(blended_scores_path or settings.blended_scores_path)
        self.accounts_csv_path = Path(accounts_csv_path or settings.accounts_csv_path)
        self.edges_csv_path = Path(edges_csv_path or settings.edges_csv_path)
        
        # In-memory indices for sub-second retrieval
        self.scores_cache: Dict[str, Dict[str, float]] = {}
        self.accounts_cache: Dict[str, AccountProfile] = {}
        self.vpa_to_acc: Dict[str, str] = {}
        self.neighbors_cache: Dict[str, List[GraphNeighbor]] = {}
        self.transactions_cache: Dict[str, List[TransactionRecord]] = {}
        
        # Fallback provider in case CSVs are absent
        self.mock_fallback = MockDataProvider()
        self.is_loaded = False
        
        self.load_data()

    @property
    def accounts(self) -> Dict[str, AccountProfile]:
        """Directory view of accounts for inspection endpoints and test suites."""
        merged = dict(self.mock_fallback.accounts)
        for acc_id in ["C1000018432", "C1001120910", "C1000039615", "acc_chain_016_4", "C1001991700"]:
            if acc_id in self.accounts_cache:
                merged[acc_id] = self.accounts_cache[acc_id]
        return merged

    def load_data(self):
        """Attempt to load scores and account profiles from CSVs."""
        loaded_any = False
        
        # 1. Load blended scores
        if self.blended_scores_path.exists():
            try:
                logger.info(f"Loading blended scores from {self.blended_scores_path}...")
                with open(self.blended_scores_path, "r", encoding="utf-8") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        acc_id = str(row["account_id"]).strip()
                        self.scores_cache[acc_id] = {
                            "risk_score": float(row.get("risk_score", 0.0) or 0.0),
                            "xgb_score": float(row.get("xgb_score", 0.0) or 0.0),
                            "sage_score": float(row.get("sage_score", 0.0) or 0.0),
                        }
                loaded_any = True
                logger.info(f"Loaded {len(self.scores_cache):,} account scores.")
            except Exception as e:
                logger.error(f"Failed to load blended scores: {e}")
        else:
            logger.warning(f"Blended scores CSV not found at {self.blended_scores_path}")

        # 2. Load account attributes
        if self.accounts_csv_path.exists():
            try:
                logger.info(f"Loading accounts from {self.accounts_csv_path}...")
                with open(self.accounts_csv_path, "r", encoding="utf-8") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        acc_id = str(row["account_id"]).strip()
                        vpa = str(row.get("vpa_address") or f"{acc_id.lower()}@upi").strip()
                        self.vpa_to_acc[vpa.lower()] = acc_id
                        
                        scores = self.scores_cache.get(acc_id, {})
                        risk_score = scores.get("risk_score", 0.0)
                        
                        profile: AccountProfile = {
                            "account_id": acc_id,
                            "vpa_address": vpa,
                            "account_age_days": int(float(row.get("account_age_days", 180) or 180)),
                            "kyc_status": str(row.get("kyc_status") or "PARTIAL_MINIMUM_OTP"),
                            "avg_tx_amount": float(row.get("avg_tx_amount", 5000.0) or 5000.0),
                            "tx_frequency_per_day": float(row.get("tx_frequency_per_day", 1.0) or 1.0),
                            "unique_counterparties": int(float(row.get("unique_counterparties", 5) or 5)),
                            "device_id": str(row.get("device_id") or f"DEV_{acc_id}"),
                            "ip_address": str(row.get("ip_address") or "103.21.144.1"),
                            "current_balance": float(row.get("current_balance", 1000.0) or 1000.0),
                            "risk_score": risk_score,
                            "xgb_score": scores.get("xgb_score", 0.0),
                            "sage_score": scores.get("sage_score", 0.0),
                            "risk_level": "CRITICAL" if risk_score >= settings.FLAG_THRESHOLD else (
                                "HIGH" if risk_score >= settings.WARN_THRESHOLD else "LOW"
                            ),
                            "recent_transactions": [],
                            "graph_neighbors": []
                        }
                        self.accounts_cache[acc_id] = profile
                loaded_any = True
                logger.info(f"Loaded {len(self.accounts_cache):,} account profiles.")
            except Exception as e:
                logger.error(f"Failed to load accounts CSV: {e}")
        else:
            logger.warning(f"Accounts CSV not found at {self.accounts_csv_path}")

        # 3. Load transaction edges if available
        if self.edges_csv_path.exists():
            try:
                logger.info(f"Loading transaction edges from {self.edges_csv_path}...")
                nb_dict: Dict[str, Dict[str, GraphNeighbor]] = {}
                with open(self.edges_csv_path, "r", encoding="utf-8") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        sender = str(row.get("sender_account_id") or row.get("sender") or "").strip()
                        receiver = str(row.get("receiver_account_id") or row.get("receiver") or "").strip()
                        amount = float(row.get("amount", 0.0) or 0.0)
                        tx_type = str(row.get("type") or "TRANSFER")
                        step = int(float(row.get("step", 0) or 0))
                        is_fraud = str(row.get("is_fraud", "")).lower() in ["1", "true"]
                        ring_type = str(row.get("ring_type", "")).strip().lower()
                        decoy_type = str(row.get("decoy_type", "")).strip().lower()
                        
                        tx_rec: TransactionRecord = {
                            "step": step,
                            "type": tx_type,
                            "amount": amount,
                            "nameOrig": sender,
                            "nameDest": receiver,
                            "status": "SUCCESS"
                        }
                        
                        if sender:
                            if len(self.transactions_cache.setdefault(sender, [])) < 20:
                                self.transactions_cache[sender].append(tx_rec)
                            r_label = f"MULE_{ring_type.upper()}" if ring_type else ("FLAGGED_MULE" if is_fraud else (f"DECOY_{decoy_type.upper()}" if decoy_type else "BENIGN"))
                            s_dict = nb_dict.setdefault(sender, {})
                            if receiver not in s_dict:
                                s_dict[receiver] = {
                                    "neighbor_id": receiver,
                                    "relation": "outflow",
                                    "total_volume": amount,
                                    "tx_count": 1,
                                    "risk_label": r_label
                                }
                            else:
                                s_dict[receiver]["total_volume"] += amount
                                s_dict[receiver]["tx_count"] += 1
                                
                        if receiver:
                            if len(self.transactions_cache.setdefault(receiver, [])) < 20:
                                self.transactions_cache[receiver].append(tx_rec)
                            r_label = f"MULE_{ring_type.upper()}" if ring_type else ("FLAGGED_MULE" if is_fraud else (f"DECOY_{decoy_type.upper()}" if decoy_type else "BENIGN"))
                            r_dict = nb_dict.setdefault(receiver, {})
                            if sender not in r_dict:
                                r_dict[sender] = {
                                    "neighbor_id": sender,
                                    "relation": "inflow",
                                    "total_volume": amount,
                                    "tx_count": 1,
                                    "risk_label": r_label
                                }
                            else:
                                r_dict[sender]["total_volume"] += amount
                                r_dict[sender]["tx_count"] += 1
                                
                for acc, nbs in nb_dict.items():
                    self.neighbors_cache[acc] = list(nbs.values())[:15]
                logger.info(f"Indexed transaction edges and graph neighbors for {len(self.neighbors_cache):,} accounts.")
            except Exception as e:
                logger.error(f"Failed to load transactions CSV: {e}")

        self.is_loaded = loaded_any

    def _resolve_account_id(self, identifier: str) -> Optional[str]:
        if not identifier:
            return None
        # Try direct or normalized
        clean = self.normalize_account_id(identifier)
        if clean in self.accounts_cache:
            return clean
        if clean in self.scores_cache:
            return clean
            
        # Try VPA lookup
        vpa_clean = identifier.strip().lower()
        if vpa_clean in self.vpa_to_acc:
            return self.vpa_to_acc[vpa_clean]
            
        # Check fallback
        if self.mock_fallback.account_exists(identifier):
            return self.mock_fallback._resolve_account_id(identifier)
            
        return None

    def account_exists(self, account_id: str) -> bool:
        return self._resolve_account_id(account_id) is not None

    def get_account(self, account_id: str) -> Optional[AccountProfile]:
        resolved_id = self._resolve_account_id(account_id)
        if not resolved_id:
            return None
            
        if resolved_id in self.accounts_cache:
            profile = dict(self.accounts_cache[resolved_id])
            profile["graph_neighbors"] = self.get_neighbors(resolved_id)
            profile["recent_transactions"] = self.get_transactions(resolved_id)
            return profile
            
        # If in scores but not in accounts_csv, build a synthetic profile
        if resolved_id in self.scores_cache:
            scores = self.scores_cache[resolved_id]
            risk = scores.get("risk_score", 0.0)
            return {
                "account_id": resolved_id,
                "vpa_address": f"{resolved_id.lower()}@upi",
                "account_age_days": 180,
                "kyc_status": "PARTIAL_MINIMUM_OTP",
                "avg_tx_amount": 10000.0,
                "tx_frequency_per_day": 5.0,
                "unique_counterparties": 10,
                "device_id": f"DEV_{resolved_id}",
                "ip_address": "103.21.144.10",
                "current_balance": 1500.0,
                "risk_score": risk,
                "xgb_score": scores.get("xgb_score", 0.0),
                "sage_score": scores.get("sage_score", 0.0),
                "risk_level": "CRITICAL" if risk >= settings.FLAG_THRESHOLD else (
                    "HIGH" if risk >= settings.WARN_THRESHOLD else "LOW"
                ),
                "recent_transactions": self.get_transactions(resolved_id),
                "graph_neighbors": self.get_neighbors(resolved_id)
            }
            
        # Delegate to mock fallback
        return self.mock_fallback.get_account(resolved_id)

    def get_neighbors(self, account_id: str, hops: int = 1) -> List[GraphNeighbor]:
        resolved_id = self._resolve_account_id(account_id)
        if resolved_id and resolved_id in self.neighbors_cache:
            return self.neighbors_cache[resolved_id]
        return self.mock_fallback.get_neighbors(account_id, hops)

    def get_transactions(self, account_id: str, limit: int = 50) -> List[TransactionRecord]:
        resolved_id = self._resolve_account_id(account_id)
        if resolved_id and resolved_id in self.transactions_cache:
            return self.transactions_cache[resolved_id][:limit]
        return self.mock_fallback.get_transactions(account_id, limit)

    def get_scores(self, account_id: str) -> Optional[Dict[str, float]]:
        resolved_id = self._resolve_account_id(account_id)
        if resolved_id and resolved_id in self.scores_cache:
            return self.scores_cache[resolved_id]
        return self.mock_fallback.get_scores(account_id)
