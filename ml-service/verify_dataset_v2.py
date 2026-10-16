import argparse
import math

import numpy as np
import pandas as pd
import scipy.sparse as sparse
from scipy.sparse.csgraph import connected_components
from sklearn.metrics import roc_auc_score
from xgboost import XGBClassifier

RING_COUNTS = {"chain": 40, "star": 35, "cycle": 25, "fanout": 25, "hybrid": 25}
DECOY_COUNTS = {"merchant_hub": 60, "payroll_fanout": 25, "forward_chain": 50, "family_group": 40}
TRANSACTION_COLUMNS = ["transaction_id", "sender_account_id", "sender_vpa", "receiver_account_id", "receiver_vpa", "amount", "type", "step", "timestamp", "status", "device_id", "is_fraud", "is_synthetic_ring", "ring_id", "ring_type", "sender_old_balance", "sender_new_balance", "decoy_id", "decoy_type"]
ACCOUNT_COLUMNS = ["account_id", "vpa_address", "account_holder_name", "account_age_days", "kyc_status", "current_balance", "avg_tx_amount", "tx_frequency_per_day", "unique_counterparties", "device_id", "ip_address", "risk_status", "created_at"]
LABEL_COLUMNS = ["account_id", "role", "group_type", "group_id", "label_touch", "label_mule"]
SPLIT_COLUMNS = ["account_id", "split", "fold", "label_touch", "label_mule", "role", "group_type", "group_id", "ring_type", "decoy_type"]
ALLOWED_KYC = {"FULL_BIOMETRIC_VERIFIED", "PARTIAL_MINIMUM_OTP", "MINIMUM_KYC", "NONE"}


def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--out-dir", default="data/v2"); args = parser.parse_args()
    root = args.out_dir; transactions = pd.read_csv(root + "/transactions.csv", low_memory=False); accounts = pd.read_csv(root + "/accounts.csv", low_memory=False); labels = pd.read_csv(root + "/labels.csv", low_memory=False); splits = pd.read_csv(root + "/splits.csv", low_memory=False); results = []
    def check(name, function):
        try:
            function(); results.append(True); print("PASS - " + name)
        except Exception as error:
            results.append(False); print("FAIL - " + name + ": " + str(error))
    def schema():
        assert transactions.columns.tolist() == TRANSACTION_COLUMNS; assert accounts.columns.tolist() == ACCOUNT_COLUMNS; assert labels.columns.tolist() == LABEL_COLUMNS; assert splits.columns.tolist() == SPLIT_COLUMNS
    def integrity():
        assert transactions.transaction_id.is_unique; assert accounts.account_id.is_unique; known = set(accounts.account_id); assert set(transactions.sender_account_id).issubset(known); assert set(transactions.receiver_account_id).issubset(known); required = [c for c in TRANSACTION_COLUMNS if c not in ["ring_id", "ring_type", "decoy_id", "decoy_type"]]; assert not transactions[required].isnull().any().any(); assert not accounts.isnull().any().any(); assert (transactions.amount > 0).all(); assert set(accounts.kyc_status).issubset(ALLOWED_KYC)
    def group_flags():
        rings = transactions[transactions.is_synthetic_ring]; decoys = transactions[transactions.decoy_id.notna()]; ring_counts = rings.groupby("ring_type").ring_id.nunique().to_dict(); decoy_counts = decoys.groupby("decoy_type").decoy_id.nunique().to_dict(); expected_rings = RING_COUNTS if sum(ring_counts.values()) == sum(RING_COUNTS.values()) else {key: max(1, value // 5) for key, value in RING_COUNTS.items()}; expected_decoys = DECOY_COUNTS if sum(decoy_counts.values()) == sum(DECOY_COUNTS.values()) else {key: max(1, value // 5) for key, value in DECOY_COUNTS.items()}; assert ring_counts == expected_rings; assert decoy_counts == expected_decoys; assert rings.is_fraud.all() and rings.is_synthetic_ring.all(); assert (~decoys.is_fraud).all() and (~decoys.is_synthetic_ring).all()
    def ring_structure():
        for gid, g in transactions[transactions.is_synthetic_ring].groupby("ring_id"):
            typ = g.ring_type.iloc[0]; ordered = g.sort_values(["step", "transaction_id"])
            if typ == "chain":
                assert 3 <= len(g) <= 6; assert (ordered.amount.diff().dropna() < 0).all(); assert (ordered.receiver_account_id.iloc[:-1].values == ordered.sender_account_id.iloc[1:].values).all()
            elif typ == "star":
                victims = g[g.type == "TRANSFER"]; cash = g[g.type == "CASH_OUT"]; assert 3 <= len(victims) <= 8 and len(cash) == 1; assert victims.receiver_account_id.nunique() == 1; assert cash.sender_account_id.iloc[0] == victims.receiver_account_id.iloc[0]
            elif typ == "cycle":
                core = g[g.type == "TRANSFER"]; assert 3 <= core.sender_account_id.nunique() <= 5; assert core.sender_account_id.iloc[0] == core.receiver_account_id.iloc[-1] or set(core.sender_account_id).intersection(set(core.receiver_account_id))
            elif typ == "fanout":
                core = g[g.type == "TRANSFER"]; source = core.sender_account_id.value_counts().index[0]; smurfs = set(core.loc[core.sender_account_id == source, "receiver_account_id"]); assert 4 <= len(smurfs) <= 8; assert core[core.sender_account_id.isin(smurfs)].receiver_account_id.nunique() == 1
            elif typ == "hybrid":
                transfers = g[g.type == "TRANSFER"]; cash = g[g.type == "CASH_OUT"]; source = transfers.sender_account_id.iloc[0]; assert 3 <= len(set(cash.sender_account_id)) <= 5; assert len(cash) >= 3; assert source in set(transfers.sender_account_id)
    def decoy_structure():
        for gid, g in transactions[transactions.decoy_id.notna()].groupby("decoy_id"):
            typ = g.decoy_type.iloc[0]
            if typ == "merchant_hub": assert g[g.type.isin(["PAYMENT", "TRANSFER"])].sender_account_id.nunique() >= 5
            elif typ == "payroll_fanout": assert g[g.type == "TRANSFER"].receiver_account_id.nunique() >= 5
            elif typ == "forward_chain": assert 3 <= g[g.type == "TRANSFER"].shape[0] <= 5
            elif typ == "family_group":
                people = set(g.sender_account_id) | set(g.receiver_account_id); pairs = {(r.receiver_account_id, r.sender_account_id) for r in g.itertuples()}; assert 3 <= len(people) <= 6; assert any((r.sender_account_id, r.receiver_account_id) in pairs for r in g.itertuples())
    def no_overlap():
        group_members = {}
        for frame, column in [(transactions[transactions.ring_id.notna()], "ring_id"), (transactions[transactions.decoy_id.notna()], "decoy_id")]:
            for gid, g in frame.groupby(column):
                for account in set(g.sender_account_id) | set(g.receiver_account_id):
                    assert account not in group_members or group_members[account] == gid; group_members[account] = gid
    def timing():
        ring_duration = transactions[transactions.is_synthetic_ring].groupby("ring_id").step.agg(lambda x: x.max() - x.min()); forward_duration = transactions[transactions.decoy_type == "forward_chain"].groupby("decoy_id").step.agg(lambda x: x.max() - x.min()); print("median ring duration:", float(ring_duration.median()), "median decoy forward duration:", float(forward_duration.median())); assert (forward_duration <= 3).any(); assert (ring_duration > 24).any()
    def profiles():
        merged = accounts.merge(labels, on="account_id"); grouped = merged[merged.group_type != "none"]; ordinary = merged[merged.group_type == "none"]
        for name, frame in [("ring relay", merged[merged.group_type == "ring"]), ("decoy", merged[merged.group_type == "decoy"]), ("ordinary", ordinary)]: print(name, "mean age", round(frame.account_age_days.mean(), 2), "kyc", frame.kyc_status.value_counts().to_dict())
        auc_all = roc_auc_score(merged.label_mule, -merged.account_age_days); auc_grouped = roc_auc_score(grouped.label_mule, -grouped.account_age_days); print("age AUC all:", round(auc_all, 4), "grouped:", round(auc_grouped, 4)); assert 0.65 <= auc_all <= 0.90; assert 0.55 <= auc_grouped <= 0.85
    def structure_leakage():
        index = dict(zip(accounts.account_id, range(len(accounts)))); s = transactions.sender_account_id.map(index).to_numpy(); r = transactions.receiver_account_id.map(index).to_numpy(); adj = sparse.coo_matrix((np.ones(len(s)), (s, r)), shape=(len(accounts), len(accounts))); und = ((adj + adj.T) > 0).astype(np.int8).tocsr(); count, ids = connected_components(und, directed=False); sizes = np.bincount(ids); comp = sizes[ids]; degree = np.asarray(und.sum(axis=1)).ravel(); frame = splits.copy(); frame["component"] = comp; frame["degree"] = degree; frame = frame[frame.group_type != "none"]; comp_auc = roc_auc_score(frame.label_mule, frame.component); degree_auc = roc_auc_score(frame.label_mule, frame.degree); print("grouped component-size AUC:", round(comp_auc, 4), "degree AUC:", round(degree_auc, 4)); assert 0.15 <= comp_auc <= 0.85 and 0.15 <= degree_auc <= 0.85
    def tabular_leakage():
        x = accounts[["account_age_days", "current_balance", "avg_tx_amount", "tx_frequency_per_day", "unique_counterparties"]].copy(); x = pd.concat([x, pd.get_dummies(accounts.kyc_status, dtype=float)], axis=1); train = splits.split == "train"; test = splits.split == "test"; model = XGBClassifier(n_estimators=50, max_depth=3, learning_rate=0.1, random_state=42, n_jobs=1); model.fit(x.loc[train], splits.loc[train, "label_mule"]); auc = roc_auc_score(splits.loc[test, "label_mule"], model.predict_proba(x.loc[test])[:, 1]); print("quick tabular label_mule AUC:", round(auc, 4)); assert auc < 0.97
    def split_checks():
        assert set(accounts.account_id) == set(splits.account_id); assert splits.account_id.is_unique; assert set(splits.loc[splits.split == "train", "account_id"]).isdisjoint(set(splits.loc[splits.split == "test", "account_id"])); assert splits.fold.isin([0, 1, 2, 3, 4]).all(); assert splits.groupby("account_id").fold.nunique().max() == 1
        for gid, g in splits[splits.group_id.notna()].groupby("group_id"): assert g.split.nunique() == 1
        assert set(splits[splits.split == "test"].ring_type.dropna()) == set(RING_COUNTS); assert set(splits[splits.split == "test"].decoy_type.dropna()) == set(DECOY_COUNTS)
    check("exact schemas", schema); check("integrity and allowed values", integrity); check("ring and decoy counts/flags", group_flags); check("fraud ring structures", ring_structure); check("decoy structures", decoy_structure); check("no account belongs to two groups", no_overlap); check("timing overlap", timing); check("profile overlap and age AUC", profiles); check("structure leakage", structure_leakage); check("quick tabular leakage", tabular_leakage); check("grouped splits and folds", split_checks)
    print("Sample accounts:\n", accounts.head(3).to_string(index=False)); print("Sample normal transactions:\n", transactions[(~transactions.is_fraud) & transactions.ring_id.isna() & transactions.decoy_id.isna()].head(3).to_string(index=False))
    for typ in RING_COUNTS:
        gid = transactions.loc[transactions.ring_type == typ, "ring_id"].dropna().iloc[0]; print("Sample ring", typ); print(transactions[transactions.ring_id == gid].to_string(index=False))
    for typ in DECOY_COUNTS:
        gid = transactions.loc[transactions.decoy_type == typ, "decoy_id"].dropna().iloc[0]; print("Sample decoy", typ); print(transactions[transactions.decoy_id == gid].to_string(index=False))
    print("%d/%d checks passed" % (sum(results), len(results)))


if __name__ == "__main__":
    main()
