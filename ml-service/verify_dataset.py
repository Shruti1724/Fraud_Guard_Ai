import math

import pandas as pd
from sklearn.metrics import roc_auc_score


TRANSACTION_COLUMNS = [
    "transaction_id", "sender_account_id", "sender_vpa", "receiver_account_id", "receiver_vpa",
    "amount", "type", "step", "timestamp", "status", "device_id", "is_fraud",
    "is_synthetic_ring", "ring_id", "ring_type", "sender_old_balance", "sender_new_balance",
]
ACCOUNT_COLUMNS = [
    "account_id", "vpa_address", "account_holder_name", "account_age_days", "kyc_status",
    "current_balance", "avg_tx_amount", "tx_frequency_per_day", "unique_counterparties",
    "device_id", "ip_address", "risk_status", "created_at",
]
ALLOWED_KYC = {"FULL_BIOMETRIC_VERIFIED", "PARTIAL_MINIMUM_OTP", "MINIMUM_KYC", "NONE"}

transactions = pd.read_csv("data/transactions.csv")
accounts = pd.read_csv("data/accounts.csv")
results = []


def check(label, callback):
    try:
        callback()
        results.append(True)
        print("PASS - " + label)
    except Exception as error:
        results.append(False)
        print("FAIL - " + label + ": " + str(error))


def required_columns():
    assert transactions.columns.tolist() == TRANSACTION_COLUMNS
    assert accounts.columns.tolist() == ACCOUNT_COLUMNS


def unique_ids():
    assert transactions["transaction_id"].is_unique
    assert accounts["account_id"].is_unique


def account_references():
    known = set(accounts["account_id"])
    assert set(transactions["sender_account_id"]).issubset(known)
    assert set(transactions["receiver_account_id"]).issubset(known)


def no_required_nulls():
    required_transaction = [column for column in TRANSACTION_COLUMNS if column not in ["ring_id", "ring_type"]]
    assert not transactions[required_transaction].isnull().any().any()
    assert not accounts.isnull().any().any()


def allowed_values():
    assert set(accounts["kyc_status"]).issubset(ALLOWED_KYC)
    assert set(accounts["risk_status"]) == {"ACTIVE"}
    assert (transactions["amount"] > 0).all()


def ring_counts():
    rings = transactions[transactions["is_synthetic_ring"]]
    assert rings["ring_id"].nunique() == 75
    assert rings.groupby("ring_type")["ring_id"].nunique().to_dict() == {"chain": 45, "star": 30}
    assert rings["is_fraud"].all()


def chain_rules():
    for ring_id, ring in transactions[transactions["ring_type"] == "chain"].groupby("ring_id"):
        ring = ring.sort_values("step")
        assert 3 <= len(ring) <= 5, ring_id
        assert (ring["amount"].diff().dropna() < 0).all(), ring_id
        assert (ring["receiver_account_id"].iloc[:-1].values == ring["sender_account_id"].iloc[1:].values).all(), ring_id
        assert ring["type"].iloc[-1] == "CASH_OUT"


def star_rules():
    for ring_id, ring in transactions[transactions["ring_type"] == "star"].groupby("ring_id"):
        ring = ring.sort_values("step")
        cash_out = ring[ring["type"] == "CASH_OUT"]
        victims = ring[ring["type"] == "TRANSFER"]
        assert 3 <= len(victims) <= 6, ring_id
        assert len(cash_out) == 1, ring_id
        mule = cash_out["sender_account_id"].iloc[0]
        assert victims["receiver_account_id"].nunique() == 1
        assert victims["receiver_account_id"].iloc[0] == mule
        assert math.isclose(cash_out["amount"].iloc[0], victims["amount"].sum() * 0.97, rel_tol=0.001, abs_tol=0.05), ring_id


def timeline_rules():
    starts = transactions[transactions["is_synthetic_ring"]].groupby("ring_id")["step"].min()
    print("Ring start steps: min=%d max=%d mean=%.2f" % (starts.min(), starts.max(), starts.mean()))
    assert starts.max() <= 700
    assert starts.min() < starts.max()


def profile_rules():
    ring_accounts = set(transactions.loc[transactions["is_synthetic_ring"], "sender_account_id"])
    chain_relay_ids = {account for account in ring_accounts if account.startswith("acc_chain_") and not account.endswith("_0")}
    mule_ids = {account for account in ring_accounts if "_mule" in account}
    fraud_ids = set(transactions.loc[transactions["is_fraud"], "sender_account_id"]) | set(transactions.loc[transactions["is_fraud"], "receiver_account_id"])
    normal_ids = set(accounts["account_id"]) - fraud_ids
    for label, ids in [("chain relay", chain_relay_ids), ("star mule", mule_ids), ("normal", normal_ids)]:
        subset = accounts[accounts["account_id"].isin(ids)]
        print(label + " mean age:", round(subset["account_age_days"].mean(), 2))
        print(label + " kyc counts:", subset["kyc_status"].value_counts().to_dict())
    assert accounts[accounts["account_id"].isin(chain_relay_ids)]["account_age_days"].mean() < 30
    assert accounts[accounts["account_id"].isin(normal_ids)]["account_age_days"].mean() > 500


def auc_rules():
    fraud_ids = set(transactions.loc[transactions["is_fraud"], "sender_account_id"]) | set(transactions.loc[transactions["is_fraud"], "receiver_account_id"])
    labels = accounts["account_id"].isin(fraud_ids).astype(int)
    auc = roc_auc_score(labels, -accounts["account_age_days"])
    print("Account age fraud-touch AUC:", round(auc, 4))
    assert 0.70 <= auc <= 0.97


check("exact schema", required_columns)
check("unique identifiers", unique_ids)
check("transaction account references", account_references)
check("required columns have no nulls", no_required_nulls)
check("allowed values and positive amounts", allowed_values)
check("75 fraud rings and fraud flags", ring_counts)
check("chain ring structure", chain_rules)
check("star ring structure", star_rules)
check("ring timeline spread", timeline_rules)
check("account profile overlap", profile_rules)
check("account age leakage AUC", auc_rules)

print("Sample accounts:")
print(accounts.head(3).to_string(index=False))
print("Sample normal transactions:")
print(transactions[~transactions["is_fraud"]].head(3).to_string(index=False))
for ring_id in ["ring_chain_01", "ring_star_01"]:
    print("Sample " + ring_id + ":")
    print(transactions[transactions["ring_id"] == ring_id].to_string(index=False))
print("Summary: %d/%d checks passed" % (sum(results), len(results)))