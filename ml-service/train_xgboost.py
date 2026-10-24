import json
import os

import numpy as np
import pandas as pd
from sklearn.metrics import (average_precision_score, confusion_matrix, f1_score,
                             precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier


SEED = 42
RISK_FLAG_THRESHOLD = 0.85
TEST_CHAIN_RINGS = 13
TEST_STAR_RINGS = 9
FEATURE_COLUMNS = [
    "account_age_days", "kyc_status", "current_balance", "avg_tx_amount",
    "tx_frequency_per_day", "unique_counterparties",
]
FORBIDDEN_FEATURE_COLUMNS = {
    "device_id", "ip_address", "account_id", "vpa_address", "account_holder_name",
    "ring_id", "ring_type", "sender_account_id", "receiver_account_id",
}
KYCS = ["FULL_BIOMETRIC_VERIFIED", "PARTIAL_MINIMUM_OTP", "MINIMUM_KYC", "NONE"]
ACCOUNT_PATH = "data/accounts.csv"
TRANSACTION_PATH = "data/transactions.csv"
SPLIT_PATH = "data/splits.csv"
MODEL_PATH = "models/xgb_baseline.json"
METRICS_PATH = "results/xgb_metrics.json"
PREDICTIONS_PATH = "data/xgb_predictions.csv"


def safe_metric(metric, y_true, y_pred):
    return float(metric(y_true, y_pred, zero_division=0))


def binary_metrics(y_true, scores, threshold):
    flags = (scores >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, flags, labels=[0, 1]).ravel()
    return {
        "threshold": float(threshold),
        "precision": safe_metric(precision_score, y_true, flags),
        "recall": safe_metric(recall_score, y_true, flags),
        "f1": safe_metric(f1_score, y_true, flags),
        "fpr": float(fp / (fp + tn)) if (fp + tn) else 0.0,
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "flagged_accounts": int(flags.sum()),
    }


def ring_account_map(transactions):
    ring_accounts = {}
    for row in transactions[transactions["is_synthetic_ring"]].itertuples(index=False):
        for account_id in [row.sender_account_id, row.receiver_account_id]:
            existing = ring_accounts.get(account_id)
            current = (row.ring_id, row.ring_type)
            if existing is not None:
                assert existing == current, "account belongs to multiple rings: %s" % account_id
            ring_accounts[account_id] = current
    return ring_accounts


def make_split(accounts, transactions, labels):
    ring_accounts = ring_account_map(transactions)
    ring_info = transactions[transactions["is_synthetic_ring"]].groupby("ring_id", dropna=False).agg(
        ring_type=("ring_type", "first")
    ).reset_index()
    rng = np.random.RandomState(SEED)
    test_rings = []
    for ring_type, count in [("chain", TEST_CHAIN_RINGS), ("star", TEST_STAR_RINGS)]:
        available = ring_info[ring_info["ring_type"] == ring_type]["ring_id"].tolist()
        test_rings.extend(rng.choice(available, size=count, replace=False).tolist())
    test_ring_set = set(test_rings)

    ring_mask = accounts["account_id"].isin(ring_accounts)
    ring_split = accounts.loc[ring_mask, "account_id"].map(
        lambda account_id: "test" if ring_accounts[account_id][0] in test_ring_set else "train"
    )
    non_ring = accounts.loc[~ring_mask, ["account_id"]].copy()
    non_ring["label"] = non_ring["account_id"].map(labels).astype(int)
    non_ring_train, non_ring_test = train_test_split(
        non_ring, test_size=0.30, random_state=SEED, stratify=non_ring["label"]
    )
    split_by_account = dict(zip(accounts.loc[ring_mask, "account_id"], ring_split))
    split_by_account.update(dict.fromkeys(non_ring_train["account_id"], "train"))
    split_by_account.update(dict.fromkeys(non_ring_test["account_id"], "test"))

    split = pd.DataFrame({"account_id": accounts["account_id"]})
    split["split"] = split["account_id"].map(split_by_account)
    split["label"] = split["account_id"].map(labels).astype(int)
    split["ring_id"] = split["account_id"].map(lambda account_id: ring_accounts.get(account_id, (None, None))[0])
    split["ring_type"] = split["account_id"].map(lambda account_id: ring_accounts.get(account_id, (None, None))[1])
    return split, test_ring_set


def feature_frame(accounts):
    features = accounts[FEATURE_COLUMNS].copy()
    features["kyc_status"] = pd.Categorical(features["kyc_status"], categories=KYCS)
    features = pd.get_dummies(features, columns=["kyc_status"], dtype=float)
    return features.astype(float)


def ring_catch_rates(predictions, test_ring_set):
    test_ring_predictions = predictions[predictions["ring_id"].isin(test_ring_set)].copy()
    test_ring_predictions["flagged"] = test_ring_predictions["score"] >= RISK_FLAG_THRESHOLD
    rates = {}
    for ring_type in ["chain", "star"]:
        subset = test_ring_predictions[test_ring_predictions["ring_type"] == ring_type]
        ring_groups = subset.groupby("ring_id")
        total = len(ring_groups)
        caught = int(ring_groups["flagged"].any().sum())
        strongly_caught = int(ring_groups["flagged"].mean().ge(0.5).sum())
        rates[ring_type] = {
            "caught_at_least_one": {"caught": caught, "total": total, "rate": float(caught / total) if total else 0.0},
            "strongly_caught_at_least_half": {"caught": strongly_caught, "total": total, "rate": float(strongly_caught / total) if total else 0.0},
        }
        print("RING CATCH RATE - %s - at least 1: caught %d of %d rings; at least 50%%: caught %d of %d rings" % (
            ring_type, caught, total, strongly_caught, total
        ))
    all_groups = test_ring_predictions.groupby("ring_id")
    total = len(all_groups)
    caught = int(all_groups["flagged"].any().sum())
    strongly_caught = int(all_groups["flagged"].mean().ge(0.5).sum())
    rates["overall"] = {
        "caught_at_least_one": {"caught": caught, "total": total, "rate": float(caught / total) if total else 0.0},
        "strongly_caught_at_least_half": {"caught": strongly_caught, "total": total, "rate": float(strongly_caught / total) if total else 0.0},
    }
    print("RING CATCH RATE - overall - at least 1: caught %d of %d rings; at least 50%%: caught %d of %d rings" % (
        caught, total, strongly_caught, total
    ))
    return rates


def run_sanity_checks(accounts, transactions, split, feature_columns, predictions, test_ring_set, auc):
    checks = []

    def check(label, condition):
        try:
            assert condition
            checks.append(True)
            print("PASS - " + label)
        except Exception:
            checks.append(False)
            print("FAIL - " + label)

    train_ids = set(split.loc[split["split"] == "train", "account_id"])
    test_ids = set(split.loc[split["split"] == "test", "account_id"])
    train_rings = set(split.loc[(split["split"] == "train") & split["ring_id"].notna(), "ring_id"])
    test_rings = set(split.loc[(split["split"] == "test") & split["ring_id"].notna(), "ring_id"])
    check("no account appears in both train and test", train_ids.isdisjoint(test_ids))
    check("no ring has accounts in both train and test", train_rings.isdisjoint(test_rings))
    check("test set contains chain and star rings", set(split.loc[split["ring_id"].isin(test_ring_set), "ring_type"]) == {"chain", "star"})
    check("feature list contains no forbidden columns", not set(feature_columns) & FORBIDDEN_FEATURE_COLUMNS)
    if auc >= 0.99:
        print("WARNING - AUC-ROC is %.4f; features may leak the label" % auc)
    check("test AUC-ROC is below 0.99", auc < 0.99)
    print("Top feature importances:")
    for feature, importance in sorted(zip(feature_columns, predictions.attrs["feature_importances"]), key=lambda item: item[1], reverse=True):
        print("  %s: %.6f" % (feature, importance))
    print("Sanity summary: %d/%d checks passed" % (sum(checks), len(checks)))
    return all(checks)


def main():
    os.makedirs("models", exist_ok=True)
    os.makedirs("results", exist_ok=True)
    accounts = pd.read_csv(ACCOUNT_PATH)
    transactions = pd.read_csv(TRANSACTION_PATH, low_memory=False)
    fraud_transactions = transactions[transactions["is_fraud"]]
    fraud_ids = set(fraud_transactions["sender_account_id"]) | set(fraud_transactions["receiver_account_id"])
    labels = accounts["account_id"].isin(fraud_ids).astype(int)
    labels = dict(zip(accounts["account_id"], labels))

    split, test_ring_set = make_split(accounts, transactions, labels)
    split.to_csv(SPLIT_PATH, index=False)
    features = feature_frame(accounts)
    feature_columns = features.columns.tolist()
    train_mask = split["split"] == "train"
    test_mask = split["split"] == "test"
    y_train = split.loc[train_mask, "label"].to_numpy()
    y_test = split.loc[test_mask, "label"].to_numpy()
    scale_pos_weight = float((y_train == 0).sum() / (y_train == 1).sum())
    model = XGBClassifier(
        n_estimators=300, max_depth=5, learning_rate=0.1, scale_pos_weight=scale_pos_weight,
        objective="binary:logistic", eval_metric="logloss", random_state=SEED, n_jobs=1,
    )
    model.fit(features.loc[train_mask], y_train)
    model.save_model(MODEL_PATH)
    scores = model.predict_proba(features.loc[test_mask])[:, 1]
    predictions = pd.DataFrame({
        "account_id": split.loc[test_mask, "account_id"].tolist(), "score": scores,
        "split": "test", "label": y_test,
        "ring_id": split.loc[test_mask, "ring_id"].tolist(),
        "ring_type": split.loc[test_mask, "ring_type"].tolist(),
    })
    train_scores = model.predict_proba(features.loc[train_mask])[:, 1]
    train_predictions = pd.DataFrame({
        "account_id": split.loc[train_mask, "account_id"].tolist(), "score": train_scores,
        "split": "train", "label": y_train,
        "ring_id": split.loc[train_mask, "ring_id"].tolist(),
        "ring_type": split.loc[train_mask, "ring_type"].tolist(),
    })
    all_predictions = pd.concat([train_predictions, predictions], ignore_index=True)
    all_predictions.to_csv(PREDICTIONS_PATH, index=False)
    all_predictions.attrs["feature_importances"] = model.feature_importances_.tolist()

    auc = float(roc_auc_score(y_test, scores))
    average_precision = float(average_precision_score(y_test, scores))
    metrics_085 = binary_metrics(y_test, scores, RISK_FLAG_THRESHOLD)
    metrics_05 = binary_metrics(y_test, scores, 0.5)
    test_accounts = split.loc[test_mask, "account_id"]
    ring_account_ids = set(ring_account_map(transactions))
    real_fraud_ids = fraud_ids - ring_account_ids
    group_recalls = {}
    for group, ids in [
        ("real_paysim_fraud_accounts", real_fraud_ids),
        ("injected_ring_accounts", ring_account_ids),
        ("injected_chain_accounts", {account for account in ring_account_ids if split.loc[split["account_id"] == account, "ring_type"].iloc[0] == "chain"}),
        ("injected_star_accounts", {account for account in ring_account_ids if split.loc[split["account_id"] == account, "ring_type"].iloc[0] == "star"}),
    ]:
        mask = test_accounts.isin(ids).to_numpy()
        group_recalls[group] = float(recall_score(y_test[mask], (scores[mask] >= RISK_FLAG_THRESHOLD).astype(int), zero_division=0)) if mask.any() else 0.0

    metrics = {
        "seed": SEED, "risk_flag_threshold": RISK_FLAG_THRESHOLD, "feature_columns": feature_columns,
        "scale_pos_weight": scale_pos_weight, "train_accounts": int(train_mask.sum()), "test_accounts": int(test_mask.sum()),
        "train_positive_accounts": int(y_train.sum()), "test_positive_accounts": int(y_test.sum()),
        "auc_roc": auc, "average_precision_pr_auc": average_precision,
        "threshold_0.85": metrics_085, "threshold_0.5": metrics_05,
        "recall_by_test_group_at_0.85": group_recalls,
        "ring_catch_rates_at_0.85": ring_catch_rates(all_predictions[all_predictions["split"] == "test"], test_ring_set),
    }
    with open(METRICS_PATH, "w") as output_file:
        json.dump(metrics, output_file, indent=2)

    print("Train accounts: %d (positive=%d), test accounts: %d (positive=%d)" % (
        len(y_train), int(y_train.sum()), len(y_test), int(y_test.sum())
    ))
    print("scale_pos_weight: %.6f" % scale_pos_weight)
    print("AUC-ROC: %.6f" % auc)
    print("Average precision (PR-AUC): %.6f" % average_precision)
    print("Metrics at threshold 0.85:", json.dumps(metrics_085, sort_keys=True))
    print("Metrics at threshold 0.5:", json.dumps(metrics_05, sort_keys=True))
    print("Recall by test group at threshold 0.85:", json.dumps(group_recalls, sort_keys=True))
    run_sanity_checks(accounts, transactions, split, feature_columns, all_predictions, test_ring_set, auc)


if __name__ == "__main__":
    main()