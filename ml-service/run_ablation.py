import argparse
import copy
import json
import os
import time

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import scipy.sparse as sparse
import torch
from scipy.sparse.csgraph import connected_components
from sklearn.metrics import (average_precision_score, confusion_matrix, f1_score,
                             precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import train_test_split
from torch import nn
from torch_geometric.data import Data
from torch_geometric.nn import SAGEConv
from xgboost import XGBClassifier


SEED = 42
RISK_FLAG_THRESHOLD = 0.85
FEATURE_CONFIGS = {
    "full": ["account_age_days", "kyc_status", "current_balance", "avg_tx_amount", "tx_frequency_per_day", "unique_counterparties"],
    "no_age_kyc": ["current_balance", "avg_tx_amount", "tx_frequency_per_day", "unique_counterparties"],
    "no_age_kyc_balance": ["tx_frequency_per_day", "unique_counterparties"],
}
NUMERIC_FEATURES = ["account_age_days", "current_balance", "avg_tx_amount", "tx_frequency_per_day", "unique_counterparties"]
LOG_FEATURES = ["current_balance", "avg_tx_amount", "tx_frequency_per_day", "unique_counterparties"]
KYCS = ["FULL_BIOMETRIC_VERIFIED", "PARTIAL_MINIMUM_OTP", "MINIMUM_KYC", "NONE"]
FORBIDDEN = {"device_id", "ip_address", "account_id", "vpa_address", "account_holder_name", "ring_id", "ring_type", "sender_account_id", "receiver_account_id", "name"}
OUT_DIR = "results/ablation"
RUNS_PATH = os.path.join(OUT_DIR, "runs.jsonl")
SUMMARY_CSV = os.path.join(OUT_DIR, "summary.csv")
SUMMARY_JSON = os.path.join(OUT_DIR, "summary.json")
CHART_PATH = os.path.join(OUT_DIR, "comparison_chart.png")


def set_seed(seed):
    np.random.seed(seed)
    torch.manual_seed(seed)


def metric_dict(y_true, scores, threshold):
    flags = (scores >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, flags, labels=[0, 1]).ravel()
    return {"threshold": threshold, "precision": float(precision_score(y_true, flags, zero_division=0)), "recall": float(recall_score(y_true, flags, zero_division=0)), "f1": float(f1_score(y_true, flags, zero_division=0)), "fpr": float(fp / (fp + tn)) if fp + tn else 0.0, "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)}}


def ring_account_map(transactions):
    mapping = {}
    for row in transactions[transactions["is_synthetic_ring"]].itertuples(index=False):
        for account_id in (row.sender_account_id, row.receiver_account_id):
            current = (row.ring_id, row.ring_type)
            if account_id in mapping:
                assert mapping[account_id] == current
            mapping[account_id] = current
    return mapping


def feature_frame(accounts, split, config):
    if config == "structure_only":
        names = ["in_degree", "out_degree", "total_degree", "unique_neighbours", "weak_component_size", "accounts_within_2_hops"]
        return accounts[names].astype(np.float32), names
    raw = accounts[FEATURE_CONFIGS[config]].copy()
    if "kyc_status" in raw:
        raw["kyc_status"] = pd.Categorical(raw["kyc_status"], categories=KYCS)
        categorical = pd.get_dummies(raw[["kyc_status"]], columns=["kyc_status"], dtype=float)
    else:
        categorical = pd.DataFrame(index=raw.index)
    numeric_names = [column for column in NUMERIC_FEATURES if column in raw.columns]
    numeric = raw[numeric_names].astype(float).copy()
    for column in LOG_FEATURES:
        if column in numeric:
            numeric[column] = np.log1p(numeric[column].clip(lower=0.0))
    train_mask = split["split"].to_numpy() == "train"
    means = numeric.loc[train_mask].mean()
    stds = numeric.loc[train_mask].std(ddof=0).replace(0.0, 1.0)
    numeric = (numeric - means) / stds
    features = pd.concat([numeric, categorical], axis=1).astype(np.float32)
    return features, features.columns.tolist()


def structure_frame(accounts, transactions):
    account_ids = accounts["account_id"].tolist()
    index = dict(zip(account_ids, range(len(account_ids))))
    senders = transactions["sender_account_id"].map(index).to_numpy()
    receivers = transactions["receiver_account_id"].map(index).to_numpy()
    adjacency = sparse.coo_matrix((np.ones(len(senders)), (senders, receivers)), shape=(len(accounts), len(accounts)))
    undirected = ((adjacency + adjacency.T) > 0).astype(np.int8).tocsr()
    degrees_in = np.asarray(adjacency.sum(axis=0)).ravel()
    degrees_out = np.asarray(adjacency.sum(axis=1)).ravel()
    unique_neighbours = np.asarray((undirected > 0).sum(axis=1)).ravel()
    components, component_ids = connected_components(undirected, directed=False)
    sizes = np.bincount(component_ids)
    component_size = sizes[component_ids]
    two_hop = np.asarray(undirected.dot(unique_neighbours)).ravel()
    values = np.column_stack([degrees_in, degrees_out, degrees_in + degrees_out, unique_neighbours, component_size, two_hop]).astype(np.float32)
    names = ["in_degree", "out_degree", "total_degree", "unique_neighbours", "weak_component_size", "accounts_within_2_hops"]
    return pd.DataFrame(values, columns=names), names


class GraphSAGE(nn.Module):
    def __init__(self, input_size):
        super().__init__()
        self.conv1 = SAGEConv(input_size, 64, aggr="mean")
        self.conv2 = SAGEConv(64, 64, aggr="mean")
        self.dropout = nn.Dropout(0.3)
        self.output = nn.Linear(64, 1)

    def forward(self, x, edge_index):
        x = self.dropout(self.conv1(x, edge_index).relu())
        x = self.dropout(self.conv2(x, edge_index).relu())
        return self.output(x).squeeze(-1)


def make_edges(transactions, account_index, shuffle_seed=None):
    senders = transactions["sender_account_id"].map(account_index).to_numpy(dtype=np.int64)
    if shuffle_seed is None:
        receivers = transactions["receiver_account_id"].map(account_index).to_numpy(dtype=np.int64)
    else:
        receivers = np.random.RandomState(shuffle_seed).choice(len(account_index), size=len(senders), replace=True)
    forward = np.column_stack([senders, receivers])
    both = np.concatenate([forward, forward[:, ::-1]], axis=0)
    return torch.from_numpy(both.T.copy()).long(), len(both)


def fit_xgb(x_train, y_train, x_test, seed, epochs=200):
    model = XGBClassifier(n_estimators=300, max_depth=5, learning_rate=0.1, scale_pos_weight=float((y_train == 0).sum() / max(1, (y_train == 1).sum())), objective="binary:logistic", eval_metric="logloss", random_state=seed, n_jobs=1)
    model.fit(x_train, y_train)
    return model.predict_proba(x_test)[:, 1], model


def fit_gnn(x, edge_index, train_indices, validation_indices, test_indices, labels, seed, epochs, shuffled_labels=None):
    set_seed(seed)
    model = GraphSAGE(x.shape[1])
    optimizer = torch.optim.Adam(model.parameters(), lr=0.01, weight_decay=5e-4)
    train_labels = labels.clone() if shuffled_labels is None else shuffled_labels.clone()
    positives = float(train_labels[train_indices].sum())
    negatives = float(len(train_indices) - positives)
    loss_function = nn.BCEWithLogitsLoss(pos_weight=torch.tensor(negatives / max(1.0, positives)))
    train_mask = torch.zeros(len(labels), dtype=torch.bool)
    validation_mask = torch.zeros(len(labels), dtype=torch.bool)
    train_mask[train_indices] = True
    validation_mask[validation_indices] = True
    best_state = None
    best_pr_auc = -np.inf
    best_epoch = 0
    stale = 0
    durations = []
    for epoch in range(1, epochs + 1):
        started = time.time()
        model.train()
        optimizer.zero_grad()
        logits = model(x, edge_index)
        loss = loss_function(logits[train_mask], train_labels[train_mask])
        loss.backward()
        optimizer.step()
        model.eval()
        with torch.no_grad():
            validation_scores = torch.sigmoid(model(x, edge_index)[validation_mask]).numpy()
        validation_labels = train_labels[validation_mask].numpy()
        pr_auc = float(average_precision_score(validation_labels, validation_scores))
        durations.append(time.time() - started)
        if pr_auc > best_pr_auc:
            best_pr_auc, best_epoch = pr_auc, epoch
            best_state = copy.deepcopy(model.state_dict())
            stale = 0
        else:
            stale += 1
        if stale >= 20:
            break
    model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        scores = torch.sigmoid(model(x, edge_index)[test_indices]).numpy()
    return scores, {"epochs_run": len(durations), "best_epoch": best_epoch, "best_validation_pr_auc": best_pr_auc, "seconds_per_epoch": float(np.mean(durations))}


def catch_rates_for_threshold(test_accounts, flags, ring_map):
    ring_ids = set(test_accounts.map(lambda account_id: ring_map.get(account_id, (None, None))[0]).dropna())
    frame = pd.DataFrame({"ring_id": test_accounts.map(lambda account_id: ring_map.get(account_id, (None, None))[0]).tolist(), "ring_type": test_accounts.map(lambda account_id: ring_map.get(account_id, (None, None))[1]).tolist(), "flagged": flags})
    rates = {}
    for ring_type in ["chain", "star", "overall"]:
        subset = frame if ring_type == "overall" else frame[frame["ring_type"] == ring_type]
        groups = subset[subset["ring_id"].isin(ring_ids)].groupby("ring_id")
        total = len(groups)
        one = int(groups["flagged"].any().sum())
        half = int(groups["flagged"].mean().ge(0.5).sum())
        rates[ring_type] = {"at_least_one": {"caught": one, "total": total, "fraction": float(one / total) if total else 0.0}, "at_least_50_percent": {"caught": half, "total": total, "fraction": float(half / total) if total else 0.0}}
    return rates


def split_metrics(scores, test_indices, split, transactions, fraud_ids, ring_map):
    y_test = split.loc[test_indices, "label"].to_numpy()
    test_accounts = split.loc[test_indices, "account_id"]
    threshold_metrics = metric_dict(y_test, scores, RISK_FLAG_THRESHOLD)
    flags = scores >= RISK_FLAG_THRESHOLD
    catch = catch_rates_for_threshold(test_accounts, flags, ring_map)
    group_recalls = {}
    for name, ids in [("real_paysim_fraud_accounts", fraud_ids - set(ring_map)), ("injected_ring_accounts", set(ring_map)), ("injected_chain_accounts", {a for a, v in ring_map.items() if v[1] == "chain"}), ("injected_star_accounts", {a for a, v in ring_map.items() if v[1] == "star"})]:
        mask = test_accounts.isin(ids).to_numpy()
        group_recalls[name] = float(recall_score(y_test[mask], flags[mask], zero_division=0)) if mask.any() else 0.0
    threshold_sensitivity = {}
    for threshold in [0.5, 0.7, 0.85, 0.95]:
        threshold_flags = scores >= threshold
        threshold_sensitivity[str(threshold)] = metric_dict(y_test, scores, threshold)
        threshold_sensitivity[str(threshold)]["ring_catch_rates"] = catch_rates_for_threshold(test_accounts, threshold_flags, ring_map)
    return {"auc_roc": float(roc_auc_score(y_test, scores)), "average_precision_pr_auc": float(average_precision_score(y_test, scores)), "threshold_0.85": threshold_metrics, "threshold_sensitivity": threshold_sensitivity, "recall_by_test_group_at_0.85": group_recalls, "ring_catch_rates": catch}


def run_one(experiment, model_name, seed, config, accounts, transactions, split, fraud_ids, ring_map, base_edges, epochs, label_shuffle=False):
    start = time.time()
    features, feature_names = feature_frame(accounts, split, config)
    if model_name == "xgboost":
        train_indices = np.flatnonzero(split["split"].to_numpy() == "train")
        test_indices = np.flatnonzero(split["split"].to_numpy() == "test")
        y_train = split.loc[train_indices, "label"].to_numpy()
        if label_shuffle:
            y_train = np.random.RandomState(seed).permutation(y_train)
        scores, model = fit_xgb(features.iloc[train_indices], y_train, features.iloc[test_indices], seed, epochs)
        extra = {"feature_importances": dict(zip(feature_names, model.feature_importances_))}
    else:
        account_index = dict(zip(accounts["account_id"], range(len(accounts))))
        edge_index, edge_count = make_edges(transactions, account_index, seed if experiment == "edge_shuffle" else None)
        train_all = np.flatnonzero(split["split"].to_numpy() == "train")
        train_indices, validation_indices = train_test_split(train_all, test_size=0.10, random_state=seed, stratify=split.loc[train_all, "label"])
        test_indices = np.flatnonzero(split["split"].to_numpy() == "test")
        labels = torch.from_numpy(split["label"].to_numpy(dtype=np.float32))
        shuffled = labels.clone()
        if label_shuffle:
            shuffled[train_indices] = torch.from_numpy(np.random.RandomState(seed).permutation(shuffled[train_indices].numpy()))
        data = Data(x=torch.from_numpy(features.to_numpy()), edge_index=edge_index)
        scores, extra = fit_gnn(data.x, data.edge_index, train_indices, validation_indices, test_indices, labels, seed, epochs, shuffled if label_shuffle else None)
        extra["edge_count"] = edge_count
    result = {"experiment": experiment, "model": model_name, "seed": seed, "epochs_requested": epochs, "config": config, "feature_columns": feature_names, "label_shuffle": label_shuffle, "seconds": time.time() - start}
    result.update(split_metrics(scores, test_indices, split, transactions, fraud_ids, ring_map))
    result.update(extra)
    print("finished experiment=%s model=%s seed=%d seconds=%.2f AUC=%.6f" % (experiment, model_name, seed, result["seconds"], result["auc_roc"]))
    return result


def append_run(result, existing_keys):
    key = (result["experiment"], result["model"], result["seed"], result["epochs_requested"])
    if key not in existing_keys:
        with open(RUNS_PATH, "a") as output:
            output.write(json.dumps(result, default=lambda value: value.item() if isinstance(value, np.generic) else str(value)) + "\n")
        existing_keys.add(key)


def summarize(runs):
    metric_names = ["auc_roc", "average_precision_pr_auc", "threshold_0.85.precision", "threshold_0.85.recall", "threshold_0.85.f1", "threshold_0.85.fpr", "recall_by_test_group_at_0.85.real_paysim_fraud_accounts", "recall_by_test_group_at_0.85.injected_ring_accounts", "recall_by_test_group_at_0.85.injected_chain_accounts", "recall_by_test_group_at_0.85.injected_star_accounts", "ring_catch_rates.overall.at_least_one.fraction", "ring_catch_rates.overall.at_least_50_percent.fraction", "ring_catch_rates.star.at_least_50_percent.fraction"]
    rows = []
    for key, group in pd.DataFrame(runs).groupby(["experiment", "model"]):
        row = {"experiment": key[0], "model": key[1], "seeds": len(group)}
        for metric in metric_names:
            values = []
            for record in group.to_dict("records"):
                value = record
                parts = metric.split(".")
                position = 0
                while position < len(parts):
                    matched = None
                    for end in range(len(parts), position, -1):
                        candidate = ".".join(parts[position:end])
                        if isinstance(value, dict) and candidate in value:
                            matched = candidate
                            position = end
                            break
                    if matched is None:
                        raise KeyError(metric)
                    value = value[matched]
                values.append(float(value))
            row[metric.replace(".", "_") + "_mean"] = float(np.mean(values))
            row[metric.replace(".", "_") + "_std"] = float(np.std(values))
        rows.append(row)
    pd.DataFrame(rows).to_csv(SUMMARY_CSV, index=False)
    return rows


def plot_chart(summary_rows):
    configs = ["full", "no_age_kyc", "no_age_kyc_balance"]
    fig, axes = plt.subplots(1, 2, figsize=(13, 6), constrained_layout=True)
    for axis, mean_key, title in [(axes[0], "ring_catch_rates_overall_at_least_50_percent_fraction", "Overall ring catch rate (>=50% flagged)"), (axes[1], "recall_by_test_group_at_0.85_injected_star_accounts", "Star-account recall at 0.85")]:
        x = np.arange(len(configs))
        width = 0.34
        for offset, model in [(-width / 2, "xgboost"), (width / 2, "graphsage")]:
            selected = {row["experiment"]: row for row in summary_rows if row["model"] == model}
            means = [selected.get(config, {}).get(mean_key + "_mean", 0.0) for config in configs]
            stds = [selected.get(config, {}).get(mean_key + "_std", 0.0) for config in configs]
            axis.bar(x + offset, means, width, yerr=stds, capsize=4, label=model)
        axis.set_xticks(x, configs)
        axis.set_ylim(0, 1.05)
        axis.set_title(title)
        axis.set_ylabel("rate")
        axis.grid(axis="y", alpha=0.25)
        axis.legend()
    fig.savefig(CHART_PATH, dpi=160)
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seeds", nargs="+", type=int, default=[42, 43, 44])
    parser.add_argument("--epochs", type=int, default=200)
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--skip", nargs="*", default=[])
    args = parser.parse_args()
    seeds = [42] if args.quick else args.seeds
    epochs = 30 if args.quick else args.epochs
    os.makedirs(OUT_DIR, exist_ok=True)
    accounts = pd.read_csv("data/accounts.csv")
    transactions = pd.read_csv("data/transactions.csv", low_memory=False)
    split = pd.read_csv("data/splits.csv", low_memory=False)
    assert set(accounts["account_id"]) == set(split["account_id"])
    ring_map = ring_account_map(transactions)
    fraud_ids = set(transactions.loc[transactions["is_fraud"], "sender_account_id"]) | set(transactions.loc[transactions["is_fraud"], "receiver_account_id"])
    account_index = dict(zip(accounts["account_id"], range(len(accounts))))
    real_edges, real_edge_count = make_edges(transactions, account_index)
    existing = {}
    if os.path.exists(RUNS_PATH):
        with open(RUNS_PATH) as source:
            for line in source:
                if line.strip():
                    record = json.loads(line)
                    existing[(record["experiment"], record["model"], record["seed"], record.get("epochs_requested", 30))] = record
    run_specs = []
    for config in FEATURE_CONFIGS:
        run_specs.extend([(config, "xgboost", config), (config, "graphsage", config)])
    run_specs.append(("edge_shuffle", "graphsage", "full"))
    run_specs.append(("structure_only", "xgboost", "full"))
    for experiment, model, config in run_specs:
        if experiment in args.skip:
            continue
        for seed in seeds:
            key = (experiment, model, seed, epochs)
            if key not in existing:
                if experiment == "structure_only":
                    structure, structure_names = structure_frame(accounts, transactions)
                    result = run_one(experiment, model, seed, "structure_only", accounts.join(structure), transactions, split, fraud_ids, ring_map, real_edges, epochs)
                else:
                    result = run_one(experiment, model, seed, config, accounts, transactions, split, fraud_ids, ring_map, real_edges, epochs)
                append_run(result, set(existing))
                existing[key] = result
    for experiment, model in [("label_shuffle", "xgboost"), ("label_shuffle", "graphsage")]:
        if experiment not in args.skip and (experiment, model, 42, epochs) not in existing:
            result = run_one(experiment, model, 42, "full", accounts, transactions, split, fraud_ids, ring_map, real_edges, epochs, label_shuffle=True)
            append_run(result, set(existing))
            existing[(experiment, model, 42, epochs)] = result

    full_xgb = existing.get(("full", "xgboost", 42, epochs))
    full_gnn = existing.get(("full", "graphsage", 42, epochs))
    thresholds = {}
    for model, result in [("xgboost", full_xgb), ("graphsage", full_gnn)]:
        if result:
            thresholds[model] = result["threshold_sensitivity"]
    summary_rows = summarize(list(existing.values()))
    plot_chart(summary_rows)
    checks = {}
    test_ids = set(split.loc[split["split"] == "test", "account_id"])
    checks["test_ids_and_disjoint"] = test_ids == set(split.loc[split["split"] == "test", "account_id"]) and set(split.loc[split["split"] == "train", "account_id"]).isdisjoint(test_ids)
    checks["feature_lists_clean"] = all(not set(record["feature_columns"]) & FORBIDDEN for record in existing.values())
    checks["label_shuffle_auc_between_0.4_and_0.6"] = all(0.4 <= existing[("label_shuffle", model, 42, epochs)]["auc_roc"] <= 0.6 for model in ["xgboost", "graphsage"] if ("label_shuffle", model, 42, epochs) in existing)
    checks["reproducibility_xgb"] = full_xgb is not None and abs(full_xgb["auc_roc"] - json.load(open("results/xgb_metrics.json"))["auc_roc"]) <= 0.005
    checks["reproducibility_gnn"] = full_gnn is not None and abs(full_gnn["auc_roc"] - json.load(open("results/gnn_metrics.json"))["auc_roc"]) <= 0.01
    shuffled_edges, shuffled_count = make_edges(transactions, account_index, 42)
    checks["edge_shuffle_same_edge_count"] = shuffled_count == real_edge_count
    for name, passed in checks.items():
        print(("PASS" if passed else "FAIL") + " - " + name)
    summary = {"runs": list(existing.values()), "thresholds": thresholds, "checks": checks}
    with open(SUMMARY_JSON, "w") as output:
        json.dump(summary, output, indent=2)
    print("\nAblation summary (mean +/- std):")
    for row in summary_rows:
        print("%s / %s: AUC %.4f +/- %.4f, PR-AUC %.4f +/- %.4f, ring>=50%% %.4f +/- %.4f, star recall %.4f +/- %.4f" % (row["experiment"], row["model"], row["auc_roc_mean"], row["auc_roc_std"], row["average_precision_pr_auc_mean"], row["average_precision_pr_auc_std"], row["ring_catch_rates_overall_at_least_50_percent_fraction_mean"], row["ring_catch_rates_overall_at_least_50_percent_fraction_std"], row["recall_by_test_group_at_0_85_injected_star_accounts_mean"], row["recall_by_test_group_at_0_85_injected_star_accounts_std"]))
    print("Sanity summary: %d/%d checks passed" % (sum(checks.values()), len(checks)))


if __name__ == "__main__":
    main()