import copy
import json
import os
import time

import numpy as np
import pandas as pd
import torch
from sklearn.metrics import (average_precision_score, confusion_matrix, f1_score,
                             precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import train_test_split
from torch import nn
from torch_geometric.data import Data
from torch_geometric.nn import SAGEConv


SEED = 42
RISK_FLAG_THRESHOLD = 0.85
HIDDEN_SIZE = 64
DROPOUT = 0.3
LEARNING_RATE = 0.01
WEIGHT_DECAY = 5e-4
MAX_EPOCHS = 200
EARLY_STOPPING_PATIENCE = 20
VALIDATION_FRACTION = 0.10
FEATURE_COLUMNS = [
    "account_age_days", "kyc_status", "current_balance", "avg_tx_amount",
    "tx_frequency_per_day", "unique_counterparties",
]
NUMERIC_FEATURES = [
    "account_age_days", "current_balance", "avg_tx_amount",
    "tx_frequency_per_day", "unique_counterparties",
]
LOG_FEATURES = ["current_balance", "avg_tx_amount", "tx_frequency_per_day", "unique_counterparties"]
FORBIDDEN_FEATURE_COLUMNS = {
    "device_id", "ip_address", "account_id", "vpa_address", "account_holder_name",
    "ring_id", "ring_type", "sender_account_id", "receiver_account_id", "label",
}
KYCS = ["FULL_BIOMETRIC_VERIFIED", "PARTIAL_MINIMUM_OTP", "MINIMUM_KYC", "NONE"]
ACCOUNT_PATH = "data/accounts.csv"
TRANSACTION_PATH = "data/transactions.csv"
SPLIT_PATH = "data/splits.csv"
MODEL_PATH = "models/gnn_graphsage.pt"
METRICS_PATH = "results/gnn_metrics.json"
PREDICTIONS_PATH = "data/gnn_predictions.csv"


def set_seed():
    np.random.seed(SEED)
    torch.manual_seed(SEED)


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
            current = (row.ring_id, row.ring_type)
            if account_id in ring_accounts:
                assert ring_accounts[account_id] == current, "account belongs to multiple rings: %s" % account_id
            ring_accounts[account_id] = current
    return ring_accounts


def make_features(accounts, split):
    raw = accounts[FEATURE_COLUMNS].copy()
    raw["kyc_status"] = pd.Categorical(raw["kyc_status"], categories=KYCS)
    categorical = pd.get_dummies(raw[["kyc_status"]], columns=["kyc_status"], dtype=float)
    numeric = raw[NUMERIC_FEATURES].astype(float).copy()
    for column in LOG_FEATURES:
        numeric[column] = np.log1p(numeric[column].clip(lower=0.0))
    train_mask = split["split"].to_numpy() == "train"
    means = numeric.loc[train_mask].mean()
    stds = numeric.loc[train_mask].std(ddof=0).replace(0.0, 1.0)
    numeric = (numeric - means) / stds
    features = pd.concat([numeric, categorical], axis=1)
    return features.astype(np.float32), features.columns.tolist()


class GraphSAGEModel(nn.Module):
    def __init__(self, input_size):
        super().__init__()
        self.conv1 = SAGEConv(input_size, HIDDEN_SIZE, aggr="mean")
        self.conv2 = SAGEConv(HIDDEN_SIZE, HIDDEN_SIZE, aggr="mean")
        self.dropout = nn.Dropout(DROPOUT)
        self.output = nn.Linear(HIDDEN_SIZE, 1)

    def forward(self, x, edge_index):
        x = self.conv1(x, edge_index).relu()
        x = self.dropout(x)
        x = self.conv2(x, edge_index).relu()
        x = self.dropout(x)
        return self.output(x).squeeze(-1)


def ring_catch_rates(predictions, test_ring_set):
    ring_predictions = predictions[predictions["ring_id"].isin(test_ring_set)].copy()
    ring_predictions["flagged"] = ring_predictions["score"] >= RISK_FLAG_THRESHOLD
    rates = {}
    for ring_type in ["chain", "star"]:
        subset = ring_predictions[ring_predictions["ring_type"] == ring_type]
        groups = subset.groupby("ring_id")
        total = len(groups)
        caught = int(groups["flagged"].any().sum())
        strongly_caught = int(groups["flagged"].mean().ge(0.5).sum())
        rates[ring_type] = {
            "caught_at_least_one": {"caught": caught, "total": total, "rate": float(caught / total) if total else 0.0},
            "strongly_caught_at_least_half": {"caught": strongly_caught, "total": total, "rate": float(strongly_caught / total) if total else 0.0},
        }
        print("RING CATCH RATE - %s - at least 1: caught %d of %d rings; at least 50%%: caught %d of %d rings" % (
            ring_type, caught, total, strongly_caught, total
        ))
    groups = ring_predictions.groupby("ring_id")
    total = len(groups)
    caught = int(groups["flagged"].any().sum())
    strongly_caught = int(groups["flagged"].mean().ge(0.5).sum())
    rates["overall"] = {
        "caught_at_least_one": {"caught": caught, "total": total, "rate": float(caught / total) if total else 0.0},
        "strongly_caught_at_least_half": {"caught": strongly_caught, "total": total, "rate": float(strongly_caught / total) if total else 0.0},
    }
    print("RING CATCH RATE - overall - at least 1: caught %d of %d rings; at least 50%%: caught %d of %d rings" % (
        caught, total, strongly_caught, total
    ))
    return rates


def recall_by_group(test_accounts, y_test, scores, fraud_ids, ring_accounts, split):
    ring_account_ids = set(ring_accounts)
    chain_accounts = {account_id for account_id in ring_account_ids if split.loc[split["account_id"] == account_id, "ring_type"].iloc[0] == "chain"}
    star_accounts = {account_id for account_id in ring_account_ids if split.loc[split["account_id"] == account_id, "ring_type"].iloc[0] == "star"}
    groups = {
        "real_paysim_fraud_accounts": fraud_ids - ring_account_ids,
        "injected_ring_accounts": ring_account_ids,
        "injected_chain_accounts": chain_accounts,
        "injected_star_accounts": star_accounts,
    }
    recalls = {}
    flags = scores >= RISK_FLAG_THRESHOLD
    for name, account_ids in groups.items():
        mask = test_accounts.isin(account_ids).to_numpy()
        recalls[name] = float(recall_score(y_test[mask], flags[mask], zero_division=0)) if mask.any() else 0.0
    return recalls


def sanity_checks(accounts, split, feature_columns, test_predictions, test_ids, auc):
    checks = []

    def check(label, condition):
        try:
            assert condition
            checks.append(True)
            print("PASS - " + label)
        except Exception:
            checks.append(False)
            print("FAIL - " + label)

    split_test_ids = set(split.loc[split["split"] == "test", "account_id"])
    split_train_ids = set(split.loc[split["split"] == "train", "account_id"])
    check("test account ids exactly match splits.csv", test_ids == split_test_ids)
    check("train and test accounts are disjoint", split_train_ids.isdisjoint(split_test_ids))
    check("node count equals accounts.csv rows", len(accounts) == len(split))
    check("feature list contains no forbidden columns", not set(feature_columns) & FORBIDDEN_FEATURE_COLUMNS)
    if auc > 0.99:
        print("WARNING - AUC-ROC is %.6f; features may leak the label" % auc)
    check("test AUC-ROC was computed", np.isfinite(auc))
    print("Sanity summary: %d/%d checks passed" % (sum(checks), len(checks)))
    return all(checks)


def main():
    set_seed()
    os.makedirs("models", exist_ok=True)
    os.makedirs("results", exist_ok=True)
    accounts = pd.read_csv(ACCOUNT_PATH)
    transactions = pd.read_csv(TRANSACTION_PATH, low_memory=False)
    split = pd.read_csv(SPLIT_PATH, low_memory=False)
    assert split.columns.tolist() == ["account_id", "split", "label", "ring_id", "ring_type"]
    assert set(accounts["account_id"]) == set(split["account_id"])
    accounts = accounts.reset_index(drop=True)
    split = split.set_index("account_id").loc[accounts["account_id"]].reset_index()
    ring_accounts = ring_account_map(transactions)
    fraud_ids = set(transactions.loc[transactions["is_fraud"], "sender_account_id"]) | set(transactions.loc[transactions["is_fraud"], "receiver_account_id"])
    assert split["label"].equals(split["account_id"].isin(fraud_ids).astype(int).rename("label"))

    features, feature_columns = make_features(accounts, split)
    account_to_index = dict(zip(accounts["account_id"], range(len(accounts))))
    sender_indices = transactions["sender_account_id"].map(account_to_index).to_numpy(dtype=np.int64)
    receiver_indices = transactions["receiver_account_id"].map(account_to_index).to_numpy(dtype=np.int64)
    forward_edges = np.column_stack([sender_indices, receiver_indices])
    edge_array = np.concatenate([forward_edges, forward_edges[:, ::-1]], axis=0)
    edge_index = torch.from_numpy(edge_array.T.copy()).long()
    data = Data(x=torch.from_numpy(features.to_numpy()), edge_index=edge_index)
    labels = torch.from_numpy(split["label"].to_numpy(dtype=np.float32))
    train_indices = np.flatnonzero(split["split"].to_numpy() == "train")
    test_indices = np.flatnonzero(split["split"].to_numpy() == "test")
    train_labels = split.loc[train_indices, "label"].to_numpy()
    train_fit_indices, validation_indices = train_test_split(
        train_indices, test_size=VALIDATION_FRACTION, random_state=SEED, stratify=train_labels
    )
    train_mask = torch.zeros(len(accounts), dtype=torch.bool)
    validation_mask = torch.zeros(len(accounts), dtype=torch.bool)
    test_mask = torch.zeros(len(accounts), dtype=torch.bool)
    train_mask[train_fit_indices] = True
    validation_mask[validation_indices] = True
    test_mask[test_indices] = True

    model = GraphSAGEModel(features.shape[1])
    optimizer = torch.optim.Adam(model.parameters(), lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY)
    positives = float(labels[train_mask].sum())
    negatives = float(train_mask.sum() - labels[train_mask].sum())
    criterion = nn.BCEWithLogitsLoss(pos_weight=torch.tensor(negatives / positives))
    best_state = None
    best_validation_pr_auc = -np.inf
    best_epoch = 0
    epochs_without_improvement = 0
    epoch_seconds = []
    for epoch in range(1, MAX_EPOCHS + 1):
        start = time.time()
        model.train()
        optimizer.zero_grad()
        logits = model(data.x, data.edge_index)
        loss = criterion(logits[train_mask], labels[train_mask])
        loss.backward()
        optimizer.step()
        model.eval()
        with torch.no_grad():
            validation_scores = torch.sigmoid(model(data.x, data.edge_index)[validation_mask]).numpy()
        validation_pr_auc = float(average_precision_score(labels[validation_mask].numpy(), validation_scores))
        duration = time.time() - start
        epoch_seconds.append(duration)
        if validation_pr_auc > best_validation_pr_auc:
            best_validation_pr_auc = validation_pr_auc
            best_epoch = epoch
            best_state = copy.deepcopy(model.state_dict())
            epochs_without_improvement = 0
        else:
            epochs_without_improvement += 1
        if epoch == 1 or epoch % 10 == 0:
            print("Epoch %d/%d loss=%.6f validation_pr_auc=%.6f seconds=%.2f" % (
                epoch, MAX_EPOCHS, float(loss.item()), validation_pr_auc, duration
            ))
        if epochs_without_improvement >= EARLY_STOPPING_PATIENCE:
            break

    model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        scores = torch.sigmoid(model(data.x, data.edge_index)).numpy()
    test_scores = scores[test_indices]
    y_test = split.loc[test_indices, "label"].to_numpy()
    test_ids = split.loc[test_indices, "account_id"]
    test_predictions = pd.DataFrame({
        "account_id": test_ids.tolist(), "score": test_scores, "split": "test", "label": y_test,
        "ring_id": split.loc[test_indices, "ring_id"].tolist(), "ring_type": split.loc[test_indices, "ring_type"].tolist(),
    })
    train_scores = scores[train_indices]
    train_predictions = pd.DataFrame({
        "account_id": split.loc[train_indices, "account_id"].tolist(), "score": train_scores, "split": "train",
        "label": split.loc[train_indices, "label"].tolist(), "ring_id": split.loc[train_indices, "ring_id"].tolist(),
        "ring_type": split.loc[train_indices, "ring_type"].tolist(),
    })
    predictions = pd.concat([train_predictions, test_predictions], ignore_index=True)
    predictions.to_csv(PREDICTIONS_PATH, index=False)
    torch.save({"model_state_dict": model.state_dict(), "feature_columns": feature_columns, "seed": SEED}, MODEL_PATH)

    auc = float(roc_auc_score(y_test, test_scores))
    metrics_085 = binary_metrics(y_test, test_scores, RISK_FLAG_THRESHOLD)
    metrics_05 = binary_metrics(y_test, test_scores, 0.5)
    metrics = {
        "seed": SEED, "risk_flag_threshold": RISK_FLAG_THRESHOLD, "feature_columns": feature_columns,
        "scale_pos_weight": float(negatives / positives), "train_accounts": int(len(train_indices)),
        "test_accounts": int(len(test_indices)), "train_positive_accounts": int(labels[train_mask].sum()),
        "test_positive_accounts": int(labels[test_mask].sum()), "auc_roc": auc,
        "average_precision_pr_auc": float(average_precision_score(y_test, test_scores)),
        "threshold_0.85": metrics_085, "threshold_0.5": metrics_05,
        "recall_by_test_group_at_0.85": recall_by_group(test_ids, y_test, test_scores, fraud_ids, ring_accounts, split),
        "ring_catch_rates_at_0.85": ring_catch_rates(test_predictions, set(test_predictions.loc[test_predictions["ring_id"].notna(), "ring_id"])),
        "best_validation_pr_auc": best_validation_pr_auc, "best_epoch": best_epoch,
        "epochs_run": len(epoch_seconds), "seconds_per_epoch": float(np.mean(epoch_seconds)),
        "num_nodes": int(data.num_nodes), "num_edges": int(data.num_edges),
    }
    with open(METRICS_PATH, "w") as output_file:
        json.dump(metrics, output_file, indent=2)

    print("Nodes: %d" % data.num_nodes)
    print("Edges (including reverse): %d" % data.num_edges)
    print("Seconds per epoch: %.4f" % np.mean(epoch_seconds))
    print("Epochs run: %d" % len(epoch_seconds))
    print("Best epoch: %d (validation PR-AUC=%.6f)" % (best_epoch, best_validation_pr_auc))
    print("AUC-ROC: %.6f" % auc)
    print("Average precision (PR-AUC): %.6f" % metrics["average_precision_pr_auc"])
    print("Metrics at threshold 0.85:", json.dumps(metrics_085, sort_keys=True))
    print("Metrics at threshold 0.5:", json.dumps(metrics_05, sort_keys=True))
    print("Recall by test group at threshold 0.85:", json.dumps(metrics["recall_by_test_group_at_0.85"], sort_keys=True))
    sanity_checks(accounts, split, feature_columns, test_predictions, set(test_ids), auc)


if __name__ == "__main__":
    main()