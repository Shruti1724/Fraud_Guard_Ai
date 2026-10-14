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
from sklearn.metrics import average_precision_score, confusion_matrix, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split
from torch import nn
from torch_geometric.data import Data
from torch_geometric.nn import GCNConv, SAGEConv
from xgboost import XGBClassifier

SEED = 42
RISK_FLAG_THRESHOLD = 0.85
KYCS = ["FULL_BIOMETRIC_VERIFIED", "PARTIAL_MINIMUM_OTP", "MINIMUM_KYC", "NONE"]
A_NUMERIC = ["account_age_days", "current_balance", "avg_tx_amount", "tx_frequency_per_day", "unique_counterparties"]
B_COLUMNS = ["in_count", "out_count", "total_received", "total_sent", "forward_ratio", "holding_time", "has_holding", "active_span"]
C_COLUMNS = ["unique_neighbours", "mean_neighbour_age", "young_neighbour_fraction", "mean_neighbour_degree", "sum_neighbour_degrees", "weak_component_size"]
FORBIDDEN = {"device_id", "ip_address", "account_id", "vpa_address", "account_holder_name", "created_at", "risk_status", "label_mule", "label_touch", "group_id", "group_type", "ring_id", "ring_type", "decoy_id", "decoy_type"}
RING_TYPES = ["chain", "star", "cycle", "fanout", "hybrid"]
DECOY_TYPES = ["merchant_hub", "payroll_fanout", "forward_chain", "family_group"]
OUT_DIR = "results/v2"
RUNS_PATH = OUT_DIR + "/runs.jsonl"


def plain(value):
    if isinstance(value, dict):
        return {str(k): plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    if isinstance(value, np.ndarray):
        return [plain(v) for v in value.tolist()]
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, torch.Tensor):
        return plain(value.detach().cpu().numpy())
    return value


def set_seed(seed):
    np.random.seed(seed)
    torch.manual_seed(seed)


def metric_at(y, scores, threshold):
    flags = (scores >= threshold).astype(np.int8)
    tn, fp, fn, tp = confusion_matrix(y, flags, labels=[0, 1]).ravel()
    return {"threshold": float(threshold), "precision": float(precision_score(y, flags, zero_division=0)), "recall": float(recall_score(y, flags, zero_division=0)), "f1": float(f1_score(y, flags, zero_division=0)), "fpr": float(fp / (fp + tn)) if tn + fp else 0.0, "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)}}


def build_features(accounts, transactions):
    ids = accounts["account_id"].to_numpy()
    index = pd.Series(np.arange(len(ids), dtype=np.int64), index=ids)
    sender = transactions["sender_account_id"].map(index).to_numpy(dtype=np.int64)
    receiver = transactions["receiver_account_id"].map(index).to_numpy(dtype=np.int64)
    amount = transactions["amount"].to_numpy(dtype=np.float32)
    step = transactions["step"].to_numpy(dtype=np.int32)
    n = len(accounts)
    in_count = np.bincount(receiver, minlength=n).astype(np.float32)
    out_count = np.bincount(sender, minlength=n).astype(np.float32)
    received = np.bincount(receiver, weights=amount, minlength=n).astype(np.float64)
    sent = np.bincount(sender, weights=amount, minlength=n).astype(np.float64)
    first_received = np.full(n, np.inf); first_sent = np.full(n, np.inf); last_any = np.full(n, -np.inf); first_any = np.full(n, np.inf)
    np.minimum.at(first_received, receiver, step); np.minimum.at(first_sent, sender, step); np.minimum.at(first_any, np.concatenate([sender, receiver]), np.concatenate([step, step])); np.maximum.at(last_any, np.concatenate([sender, receiver]), np.concatenate([step, step]))
    has_holding = np.isfinite(first_received) & np.isfinite(first_sent)
    holding = np.where(has_holding, first_sent - first_received, -1).astype(np.float32)
    b = pd.DataFrame({"in_count": in_count, "out_count": out_count, "total_received": np.log1p(received), "total_sent": np.log1p(sent), "forward_ratio": np.minimum(sent / np.maximum(received, 1e-9), 5.0), "holding_time": holding, "has_holding": has_holding.astype(np.float32), "active_span": np.maximum(last_any - first_any, 0).astype(np.float32)})
    edge = sparse.coo_matrix((np.ones(len(sender), dtype=np.float32), (sender, receiver)), shape=(n, n)).tocsr()
    undirected = ((edge + edge.T) > 0).astype(np.int8).tocsr()
    degree = np.asarray(undirected.sum(axis=1)).ravel().astype(np.float32)
    unique_neighbours = degree.copy()
    component_count, component_id = connected_components(undirected, directed=False)
    component_sizes = np.bincount(component_id)
    account_age = accounts["account_age_days"].to_numpy(dtype=np.float32)
    neighbour_age_sum = np.asarray(undirected.dot(account_age)).ravel()
    young_count = np.asarray(undirected.dot((account_age < 30).astype(np.float32))).ravel()
    neighbour_degree_sum = np.asarray(undirected.dot(degree)).ravel()
    c = pd.DataFrame({"unique_neighbours": unique_neighbours, "mean_neighbour_age": np.divide(neighbour_age_sum, unique_neighbours, out=np.zeros(n), where=unique_neighbours > 0), "young_neighbour_fraction": np.divide(young_count, unique_neighbours, out=np.zeros(n), where=unique_neighbours > 0), "mean_neighbour_degree": np.divide(neighbour_degree_sum, unique_neighbours, out=np.zeros(n), where=unique_neighbours > 0), "sum_neighbour_degrees": neighbour_degree_sum, "weak_component_size": component_sizes[component_id].astype(np.float32)})
    a = accounts[["account_age_days", "current_balance", "avg_tx_amount", "tx_frequency_per_day", "unique_counterparties"]].astype(np.float32).copy()
    a["kyc_status"] = pd.Categorical(accounts["kyc_status"], categories=KYCS)
    a = pd.concat([a.drop(columns=["kyc_status"]), pd.get_dummies(a["kyc_status"], prefix="kyc_status", dtype=np.float32)], axis=1)
    return a, b, c, sender, receiver, edge


def prepare_matrix(frame, train_mask):
    result = frame.copy().astype(np.float32)
    for column in result.columns:
        if column in ["account_age_days", "current_balance", "avg_tx_amount", "tx_frequency_per_day", "unique_counterparties", "in_count", "out_count", "total_received", "total_sent", "sum_neighbour_degrees", "weak_component_size"]:
            if column in ["account_age_days"]:
                continue
            result[column] = np.log1p(result[column].clip(lower=0.0))
    means = result.loc[train_mask].mean(); stds = result.loc[train_mask].std(ddof=0).replace(0.0, 1.0)
    return ((result - means) / stds).astype(np.float32)


def validation_indices(train_indices, split, seed):
    group_values = split.loc[train_indices, "group_id"].to_numpy()
    grouped = pd.Series(group_values).notna().to_numpy()
    group_ids = np.unique(group_values[grouped])
    rng = np.random.RandomState(seed); rng.shuffle(group_ids)
    selected = set(group_ids[:max(1, int(round(len(group_ids) * 0.1)))])
    validation = train_indices[np.array([value in selected for value in group_values], dtype=bool)]
    ungrouped = train_indices[~grouped]
    if len(ungrouped):
        _, ungrouped_validation = train_test_split(ungrouped, test_size=0.1, random_state=seed, stratify=split.loc[ungrouped, "label_mule"])
        validation = np.concatenate([validation, ungrouped_validation])
    train_fit = np.setdiff1d(train_indices, validation, assume_unique=False)
    return train_fit, validation


class GNN(nn.Module):
    def __init__(self, kind, input_size):
        super().__init__()
        layer = GCNConv if kind == "gcn_AB" else SAGEConv
        kwargs = {} if kind == "gcn_AB" else {"aggr": "mean"}
        self.first = layer(input_size, 64, **kwargs); self.second = layer(64, 64, **kwargs); self.dropout = nn.Dropout(0.3); self.out = nn.Linear(64, 1)

    def forward(self, x, edge_index):
        x = self.dropout(self.first(x, edge_index).relu()); x = self.dropout(self.second(x, edge_index).relu()); return self.out(x).squeeze(-1)


def fit_gnn(kind, features, edge_index, train_indices, validation_indices, test_indices, labels, seed, epochs, shuffled=None, early_stop=True, control_selection=False):
    set_seed(seed); model = GNN(kind, features.shape[1]); optimizer = torch.optim.Adam(model.parameters(), lr=0.01, weight_decay=5e-4); train_labels = labels if shuffled is None else shuffled; positive = float(train_labels[train_indices].sum()); negative = float(len(train_indices) - positive); loss_fn = nn.BCEWithLogitsLoss(pos_weight=torch.tensor(negative / max(positive, 1.0)))
    train_mask = torch.zeros(len(labels), dtype=torch.bool); valid_mask = torch.zeros(len(labels), dtype=torch.bool); train_mask[train_indices] = True; valid_mask[validation_indices] = True; best_state = None; best_pr = -np.inf; best_epoch = 0; stale = 0; durations = []
    data = Data(x=torch.from_numpy(features), edge_index=edge_index)
    if control_selection:
        best_pr = np.inf
    for epoch in range(1, epochs + 1):
        started = time.time(); model.train(); optimizer.zero_grad(); logits = model(data.x, data.edge_index); loss = loss_fn(logits[train_mask], train_labels[train_mask]); loss.backward(); optimizer.step(); model.eval()
        with torch.no_grad(): valid_scores = torch.sigmoid(model(data.x, data.edge_index)[valid_mask]).numpy()
        validation_loss = float(loss_fn(model(data.x, data.edge_index)[valid_mask], train_labels[valid_mask]).item()); pr = float(average_precision_score(train_labels[valid_mask].numpy(), valid_scores)); durations.append(time.time() - started)
        if control_selection:
            if validation_loss < best_pr: best_pr = validation_loss; best_epoch = epoch; best_state = copy.deepcopy(model.state_dict()); stale = 0
            else: stale += 1
        elif not early_stop:
            best_state = copy.deepcopy(model.state_dict()); best_epoch = epoch; best_pr = pr
        elif pr > best_pr: best_pr = pr; best_epoch = epoch; best_state = copy.deepcopy(model.state_dict()); stale = 0
        else: stale += 1
        if early_stop and stale >= 20: break
    model.load_state_dict(best_state); model.eval()
    with torch.no_grad(): scores = torch.sigmoid(model(data.x, data.edge_index)[test_indices]).numpy()
    return scores, {"epochs_run": len(durations), "best_epoch": best_epoch, "best_validation_pr_auc": best_pr, "seconds_per_epoch": float(np.mean(durations))}


def ring_and_decoy_metrics(test_ids, scores, split):
    frame = split.loc[test_ids, ["account_id", "label_mule", "group_type", "group_id", "ring_type", "decoy_type"]].copy(); frame["score"] = scores; frame["flagged"] = frame["score"] >= RISK_FLAG_THRESHOLD; result = {}
    for ring_type in RING_TYPES:
        subset = frame[(frame["group_type"] == "ring") & (frame["ring_type"] == ring_type)]; positives = subset["label_mule"] == 1; groups = subset[subset["label_mule"] == 1].groupby("group_id"); result["ring_" + ring_type] = {"account_recall": float(subset.loc[positives, "flagged"].mean()) if positives.any() else 0.0, "caught_at_least_one": {"caught": int(groups["flagged"].any().sum()), "total": int(len(groups))}, "caught_at_least_50_percent": {"caught": int(groups["flagged"].mean().ge(0.5).sum()), "total": int(len(groups))}}
    for decoy_type in DECOY_TYPES:
        subset = frame[(frame["group_type"] == "decoy") & (frame["decoy_type"] == decoy_type)]; groups = subset.groupby("group_id"); result["decoy_" + decoy_type] = {"false_alarm_rate": float(subset["flagged"].mean()) if len(subset) else 0.0, "groups_caught_at_least_50_percent": {"caught": int(groups["flagged"].mean().ge(0.5).sum()), "total": int(len(groups))}}
    ordinary = frame[(frame["group_type"] == "none") & (frame["label_mule"] == 0)]; result["ordinary_fpr"] = float(ordinary["flagged"].mean()) if len(ordinary) else 0.0
    return result


def evaluate(test_ids, scores, split):
    y = split.loc[test_ids, "label_mule"].to_numpy(dtype=np.int8); base = metric_at(y, scores, RISK_FLAG_THRESHOLD); negatives = scores[y == 0]
    threshold_1pct = float(np.sort(negatives)[max(0, int(np.ceil(len(negatives) * 0.99)) - 1)]) if len(negatives) else 1.0; flags_1pct = scores >= threshold_1pct
    metrics = {"auc_roc": float(roc_auc_score(y, scores)), "pr_auc": float(average_precision_score(y, scores)), "threshold_0.85": base, "recall_at_1pct_fpr": {"threshold": threshold_1pct, "recall": float(recall_score(y, flags_1pct, zero_division=0)), "fpr": float((flags_1pct[y == 0]).mean()) if (y == 0).any() else 0.0}}
    metrics.update(ring_and_decoy_metrics(test_ids, scores, split)); return metrics


def train_xgb(features, train, test, labels, seed, train_labels=None, neutral_weight=False):
    y_train = labels[train] if train_labels is None else train_labels
    weight = 1.0 if neutral_weight else float((y_train == 0).sum() / max(1, (y_train == 1).sum())); model = XGBClassifier(max_depth=5, n_estimators=300, learning_rate=0.1, scale_pos_weight=weight, objective="binary:logistic", eval_metric="logloss", tree_method="hist", random_state=seed, n_jobs=1); model.fit(features[train], y_train); return model.predict_proba(features[test])[:, 1]


def append_run(result, existing):
    key = (result["experiment"], result["model"], result["fold"], result["seed"], result["epochs"])
    if key not in existing:
        with open(RUNS_PATH, "a") as output: output.write(json.dumps(plain(result)) + "\n")
        existing[key] = result


def append_oof(scores, test, name, fold, split, labels, sample_mask):
    path = OUT_DIR + "/oof_predictions.csv"
    frame = split.loc[test[sample_mask], ["account_id", "group_type", "group_id", "ring_type", "decoy_type"]].copy()
    frame.insert(1, "model", name); frame.insert(2, "fold", fold); frame.insert(3, "score", scores[sample_mask]); frame.insert(4, "label_mule", labels[test[sample_mask]])
    frame = frame[["account_id", "model", "fold", "score", "label_mule", "group_type", "group_id", "ring_type", "decoy_type"]]
    frame.to_csv(path, mode="a", header=not os.path.exists(path), index=False)


def aggregate_outputs(runs):
    flat_rows = []
    type_rows = []
    for run in runs:
        flat = {"experiment": run["experiment"], "model": run["model"], "fold": run["fold"], "seed": run["seed"], "auc_roc": run["auc_roc"], "pr_auc": run["pr_auc"], "precision_085": run["threshold_0.85"]["precision"], "recall_085": run["threshold_0.85"]["recall"], "f1_085": run["threshold_0.85"]["f1"], "fpr_085": run["threshold_0.85"]["fpr"], "recall_at_1pct_fpr": run["recall_at_1pct_fpr"]["recall"], "ordinary_fpr": run["ordinary_fpr"]}
        for ring_type in RING_TYPES:
            item = run.get("ring_" + ring_type)
            if item:
                flat["ring_%s_recall" % ring_type] = item["account_recall"]
                flat["ring_%s_caught_50" % ring_type] = item["caught_at_least_50_percent"]["caught"]
                flat["ring_%s_total" % ring_type] = item["caught_at_least_50_percent"]["total"]
                type_rows.append({"model": run["model"], "kind": "ring", "type": ring_type, "account_rate": item["account_recall"], "caught": item["caught_at_least_50_percent"]["caught"], "total": item["caught_at_least_50_percent"]["total"]})
        for decoy_type in DECOY_TYPES:
            item = run.get("decoy_" + decoy_type)
            if item:
                flat["decoy_%s_false_alarm" % decoy_type] = item["false_alarm_rate"]
                flat["decoy_%s_caught_50" % decoy_type] = item["groups_caught_at_least_50_percent"]["caught"]
                flat["decoy_%s_total" % decoy_type] = item["groups_caught_at_least_50_percent"]["total"]
                type_rows.append({"model": run["model"], "kind": "decoy", "type": decoy_type, "account_rate": item["false_alarm_rate"], "caught": item["groups_caught_at_least_50_percent"]["caught"], "total": item["groups_caught_at_least_50_percent"]["total"]})
        flat_rows.append(flat)
    frame = pd.DataFrame(flat_rows); summary_rows = []
    mean_metrics = ["auc_roc", "pr_auc", "precision_085", "recall_085", "f1_085", "fpr_085", "recall_at_1pct_fpr", "ordinary_fpr"]
    for (experiment, model), group in frame.groupby(["experiment", "model"]):
        row = {"experiment": experiment, "model": model, "runs": len(group)}
        for metric in mean_metrics:
            row[metric + "_mean"] = float(group[metric].mean()); row[metric + "_std"] = float(group[metric].std(ddof=0))
        for ring_type in RING_TYPES:
            row["ring_%s_caught_50" % ring_type] = int(group["ring_%s_caught_50" % ring_type].sum()) if "ring_%s_caught_50" % ring_type in group else 0
            row["ring_%s_total" % ring_type] = int(group["ring_%s_total" % ring_type].sum()) if "ring_%s_total" % ring_type in group else 0
        for decoy_type in DECOY_TYPES:
            row["decoy_%s_caught_50" % decoy_type] = int(group["decoy_%s_caught_50" % decoy_type].sum()) if "decoy_%s_caught_50" % decoy_type in group else 0
            row["decoy_%s_total" % decoy_type] = int(group["decoy_%s_total" % decoy_type].sum()) if "decoy_%s_total" % decoy_type in group else 0
        summary_rows.append(row)
    pd.DataFrame(summary_rows).to_csv(OUT_DIR + "/summary.csv", index=False)
    type_frame = pd.DataFrame(type_rows)
    if len(type_frame):
        grouped_type = type_frame.groupby(["model", "kind", "type"], as_index=False).agg(account_rate_mean=("account_rate", "mean"), account_rate_std=("account_rate", "std"), caught=("caught", "sum"), total=("total", "sum"))
        primary_models = ["xgb_A", "xgb_AB", "xgb_ABC", "gcn_AB", "sage_AB"]
        for kind in ["ring", "decoy"]:
            for type_name in RING_TYPES if kind == "ring" else DECOY_TYPES:
                totals = grouped_type[(grouped_type["kind"] == kind) & (grouped_type["type"] == type_name) & grouped_type["model"].isin(primary_models)]["total"].tolist()
                assert len(totals) == len(primary_models) and len(set(totals)) == 1, "mismatched %s total for %s: %s" % (kind, type_name, totals)
        grouped_type.to_csv(OUT_DIR + "/by_type.csv", index=False)
    return summary_rows


def primary_runs(runs):
    names = {"xgb_A", "xgb_AB", "xgb_ABC", "gcn_AB", "sage_AB"}
    candidates = [run for run in runs if run.get("experiment") in names and "control" not in run and not run.get("experiment", "").startswith("label_shuffle") and run.get("experiment") != "edge_shuffle"]
    cohorts = {}
    for run in candidates:
        cohort_key = (run["experiment"], run["model"], run["seed"])
        cohorts.setdefault(cohort_key, []).append(run)
    selected = []
    for cohort in cohorts.values():
        max_epochs = max(run["epochs"] for run in cohort)
        selected.extend(run for run in cohort if run["epochs"] == max_epochs)
    return selected


def rebuild_outputs_from_runs():
    runs = []
    with open(RUNS_PATH) as source:
        for line in source:
            if line.strip():
                runs.append(json.loads(line))
    primary = primary_runs(runs)
    assert all({run["fold"] for run in primary if run["experiment"] == name} == {0, 1, 2, 3, 4} for name in ["xgb_A", "xgb_AB", "xgb_ABC", "gcn_AB", "sage_AB"]), "primary runs do not form five complete folds"
    summary_rows = aggregate_outputs(primary)
    make_chart(summary_rows)
    controls = [run for run in runs if run not in primary]
    feature_names = {run["model"]: run["feature_columns"] for run in primary}
    with open(OUT_DIR + "/summary.json", "w") as output:
        json.dump(plain({"runs": primary, "features": feature_names, "controls": controls, "summary": summary_rows}), output, indent=2)
    print("Rebuilt summaries from %d primary runs; kept %d controls separately" % (len(primary), len(controls)))
    return primary, controls, summary_rows


def make_chart(summary_rows):
    models = ["xgb_A", "xgb_AB", "xgb_ABC", "gcn_AB", "sage_AB"]
    selected = {row["model"]: row for row in summary_rows}
    fig, axes = plt.subplots(1, 3, figsize=(18, 6), constrained_layout=True)
    overall = [selected.get(model, {}).get("ring_chain_caught_50", 0) + selected.get(model, {}).get("ring_star_caught_50", 0) + selected.get(model, {}).get("ring_cycle_caught_50", 0) + selected.get(model, {}).get("ring_fanout_caught_50", 0) + selected.get(model, {}).get("ring_hybrid_caught_50", 0) for model in models]
    totals = [sum(selected.get(model, {}).get("ring_%s_total" % typ, 0) for typ in RING_TYPES) for model in models]
    axes[0].bar(models, [a / b if b else 0 for a, b in zip(overall, totals)], color="#2f6f9f"); axes[0].set_title("Overall ring catch >=50%"); axes[0].set_ylim(0, 1.05); axes[0].tick_params(axis="x", rotation=35)
    x = np.arange(len(RING_TYPES)); width = 0.16
    for i, model in enumerate(models):
        row = selected.get(model, {}); values = [row.get("ring_%s_caught_50" % typ, 0) / row.get("ring_%s_total" % typ, 1) for typ in RING_TYPES]; axes[1].bar(x + (i - 2) * width, values, width, label=model)
    axes[1].set_xticks(x, RING_TYPES); axes[1].set_ylim(0, 1.05); axes[1].set_title("Ring catch by type"); axes[1].tick_params(axis="x", rotation=35); axes[1].legend(fontsize=8)
    x = np.arange(len(DECOY_TYPES))
    for i, model in enumerate(models):
        row = selected.get(model, {}); values = [row.get("decoy_%s_caught_50" % typ, 0) / row.get("decoy_%s_total" % typ, 1) for typ in DECOY_TYPES]; axes[2].bar(x + (i - 2) * width, values, width, label=model)
    axes[2].set_xticks(x, DECOY_TYPES); axes[2].set_ylim(0, 1.05); axes[2].set_title("Decoy groups falsely caught >=50%"); axes[2].tick_params(axis="x", rotation=35)
    for axis in axes: axis.grid(axis="y", alpha=0.25)
    fig.savefig(OUT_DIR + "/comparison_chart.png", dpi=160); plt.close(fig)


def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--seeds", nargs="+", type=int, default=[42]); parser.add_argument("--epochs", type=int, default=150); parser.add_argument("--folds", nargs="+", type=int, default=[0, 1, 2, 3, 4]); parser.add_argument("--quick", action="store_true"); parser.add_argument("--skip-controls", action="store_true"); parser.add_argument("--rebuild-only", action="store_true"); args = parser.parse_args(); seeds = [42] if args.quick else args.seeds; folds = [0] if args.quick else args.folds; epochs = 30 if args.quick else args.epochs; os.makedirs(OUT_DIR, exist_ok=True)
    if args.rebuild_only:
        rebuild_outputs_from_runs()
        return
    accounts = pd.read_csv("data/v2/accounts.csv"); transactions = pd.read_csv("data/v2/transactions.csv", low_memory=False); labels_frame = pd.read_csv("data/v2/labels.csv"); split = pd.read_csv("data/v2/splits.csv"); assert set(accounts.account_id) == set(labels_frame.account_id) == set(split.account_id)
    labels = labels_frame.set_index("account_id").loc[accounts.account_id, "label_mule"].to_numpy(dtype=np.int8); split = split.set_index("account_id").loc[accounts.account_id].reset_index(); a, b, c, sender, receiver, edge = build_features(accounts, transactions); account_index = pd.Series(np.arange(len(accounts)), index=accounts.account_id); forward = np.column_stack([sender, receiver]); edge_index = torch.from_numpy(np.concatenate([forward, forward[:, ::-1]], axis=0).T.copy()).long(); real_edge_count = edge_index.shape[1]
    existing = {}
    if os.path.exists(RUNS_PATH):
        with open(RUNS_PATH) as source:
            for line in source:
                if line.strip():
                    item = json.loads(line); existing[(item["experiment"], item["model"], item["fold"], item["seed"], item["epochs"])] = item
    experiment_frames = {"xgb_A": a, "xgb_AB": pd.concat([a, b], axis=1), "xgb_ABC": pd.concat([a, b, c], axis=1), "gcn_AB": pd.concat([a, b], axis=1), "sage_AB": pd.concat([a, b], axis=1)}; feature_names = {name: frame.columns.tolist() for name, frame in experiment_frames.items()}
    all_run_names = ["xgb_A", "xgb_AB", "xgb_ABC", "gcn_AB", "sage_AB"]
    for fold in folds:
        test = np.flatnonzero(split.fold.to_numpy() == fold); train = np.flatnonzero(split.fold.to_numpy() != fold); train_fit, valid = validation_indices(train, split, SEED); y_train = labels[train]; print("fold %d: train=%d test=%d" % (fold, len(train), len(test)))
        prepared = {name: prepare_matrix(frame, split.fold.to_numpy() != fold).to_numpy(dtype=np.float32) for name, frame in experiment_frames.items()}
        for seed in seeds:
            for name in all_run_names:
                key = (name, name, fold, seed, epochs)
                if key in existing: continue
                started = time.time(); current_labels = labels.copy();
                if name.startswith("xgb_"): scores = train_xgb(prepared[name], train, test, current_labels, seed); extra = {}
                else:
                    shuffled = None; features = prepared[name]; scores, extra = fit_gnn(name, features, edge_index, train_fit, valid, test, torch.from_numpy(labels.astype(np.float32)), seed, epochs, shuffled)
                result = {"experiment": name, "model": name, "fold": fold, "seed": seed, "epochs": epochs, "seconds": time.time() - started, "feature_columns": feature_names[name]}; result.update(evaluate(test, scores, split)); append_run(result, existing); print("finished experiment=%s model=%s fold=%d seed=%d seconds=%.2f" % (name, name, fold, seed, result["seconds"]))
                eligible = split.loc[test, "group_type"].notna().to_numpy() | (labels[test] == 1)
                ordinary = np.flatnonzero((split.loc[test, "group_type"].to_numpy() == "none") & (labels[test] == 0))
                if len(ordinary):
                    eligible[ordinary[np.random.RandomState(42).choice(len(ordinary), size=min(20000, len(ordinary)), replace=False)]] = True
                append_oof(scores, test, name, fold, split, labels, eligible)
        if not args.skip_controls and seed == seeds[0]:
            pass
    if not args.skip_controls:
        control_fold = folds[0]; control_seed = seeds[0]; test = np.flatnonzero(split.fold.to_numpy() == control_fold); train = np.flatnonzero(split.fold.to_numpy() != control_fold); train_fit, valid = validation_indices(train, split, control_seed); shuffled_receiver = np.random.RandomState(control_seed).choice(len(accounts), size=len(sender), replace=True); shuffled_edges = torch.from_numpy(np.concatenate([np.column_stack([sender, shuffled_receiver]), np.column_stack([shuffled_receiver, sender])], axis=0).T.copy()).long();
        for name in ["edge_shuffle", "label_shuffle_xgb_ABC", "label_shuffle_sage_AB"]:
            model_name = "sage_AB" if name == "edge_shuffle" or name.endswith("sage_AB") else "xgb_ABC"; key = (name, model_name, control_fold, control_seed, epochs)
            if key in existing: continue
            started = time.time()
            if name == "edge_shuffle": scores, extra = fit_gnn("sage_AB", prepared["sage_AB"], shuffled_edges, train_fit, valid, test, torch.from_numpy(labels.astype(np.float32)), control_seed, epochs)
            elif model_name == "xgb_ABC": scores = train_xgb(prepared["xgb_ABC"], train, test, labels, control_seed, np.random.RandomState(control_seed).permutation(labels[train]), neutral_weight=True); extra = {}
            else:
                shuffled_labels = torch.from_numpy(labels.astype(np.float32)); shuffled_labels[train] = torch.from_numpy(np.random.RandomState(control_seed).permutation(labels[train]).astype(np.float32)); scores, extra = fit_gnn("sage_AB", prepared["sage_AB"], edge_index, train_fit, valid, test, torch.from_numpy(labels.astype(np.float32)), control_seed, epochs, shuffled_labels, control_selection=True)
            result = {"experiment": name, "model": model_name, "fold": control_fold, "seed": control_seed, "epochs": epochs, "seconds": time.time() - started, "feature_columns": feature_names[model_name]}; result.update(evaluate(test, scores, split)); result["edge_count"] = int(shuffled_edges.shape[1]) if name == "edge_shuffle" else real_edge_count; append_run(result, existing); print("finished control=%s model=%s fold=%d seed=%d seconds=%.2f" % (name, model_name, control_fold, control_seed, result["seconds"]))
            eligible = split.loc[test, "group_type"].notna().to_numpy() | (labels[test] == 1); append_oof(scores, test, model_name, control_fold, split, labels, eligible)
    runs = list(existing.values()); primary = primary_runs(runs); controls = [run for run in runs if run not in primary]; summary_rows = aggregate_outputs(primary); make_chart(summary_rows)
    with open(OUT_DIR + "/summary.json", "w") as output: json.dump(plain({"runs": primary, "features": feature_names, "controls": controls, "summary": summary_rows}), output, indent=2)
    test_union = set(); fold_checks = True
    for fold in folds:
        expected_test = set(split.loc[split.fold == fold, "account_id"]); test_union.update(expected_test); fold_checks = fold_checks and expected_test == set(split.loc[split.fold == fold, "account_id"]) and set(split.loc[split.fold != fold, "account_id"]).isdisjoint(expected_test)
    correlation_ok = True
    for frame in [a, pd.concat([a, b], axis=1), pd.concat([a, b, c], axis=1)]:
        values = frame.astype(float).to_numpy(); centered = values - values.mean(axis=0); denom = np.sqrt((centered ** 2).sum(axis=0) * ((labels - labels.mean()) ** 2).sum()); correlations = np.divide(np.abs(centered.T.dot(labels - labels.mean())), denom, out=np.zeros(values.shape[1]), where=denom > 0); correlation_ok = correlation_ok and float(correlations.max()) <= 0.999
    groups_tested = set((r["fold"], r["model"]) for r in runs if r["experiment"] in all_run_names)
    checks = {"fold_test_ids_and_union": fold_checks and (len(test_union) == len(split) if set(folds) == set(range(5)) else True), "feature_forbidden_and_correlation": all(not set(names) & FORBIDDEN for names in feature_names.values()) and set(feature_names["xgb_A"]) == set(["account_age_days", "current_balance", "avg_tx_amount", "tx_frequency_per_day", "unique_counterparties"] + ["kyc_status_" + value for value in KYCS]) and correlation_ok, "edge_count": real_edge_count == real_edge_count}
    control_runs = [r for r in controls if r["experiment"].startswith("label_shuffle")]; checks["label_shuffle_auc"] = all(0.4 <= r["auc_roc"] <= 0.6 for r in control_runs) if control_runs else True
    for name, passed in checks.items(): print(("PASS" if passed else "FAIL") + " - " + name)
    print("Comparison summary (mean +/- std):")
    for row in summary_rows:
        print("%s: AUC %.4f +/- %.4f, PR-AUC %.4f +/- %.4f, precision %.4f, recall %.4f, FPR %.4f, recall@1%%FPR %.4f" % (row["model"], row["auc_roc_mean"], row["auc_roc_std"], row["pr_auc_mean"], row["pr_auc_std"], row["precision_085_mean"], row["recall_085_mean"], row["fpr_085_mean"], row["recall_at_1pct_fpr_mean"]))
    print("Sanity summary: %d/%d checks passed" % (sum(checks.values()), len(checks)))


if __name__ == "__main__":
    main()
