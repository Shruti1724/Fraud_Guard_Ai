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
from torch_geometric.nn import GATConv, MessagePassing
from torch_geometric.nn import SAGEConv
from xgboost import XGBClassifier

SEED = 42
RISK_FLAG_THRESHOLD = 0.85
OUT_DIR = "results/v2_edges"
RUNS_PATH = OUT_DIR + "/runs.jsonl"
KYCS = ["FULL_BIOMETRIC_VERIFIED", "PARTIAL_MINIMUM_OTP", "MINIMUM_KYC", "NONE"]
RING_TYPES = ["chain", "star", "cycle", "fanout", "hybrid"]
DECOY_TYPES = ["merchant_hub", "payroll_fanout", "forward_chain", "family_group"]
A_NUMERIC = ["account_age_days", "current_balance", "avg_tx_amount", "tx_frequency_per_day", "unique_counterparties"]
EDGE_TYPES = ["PAYMENT", "TRANSFER", "CASH_OUT", "CASH_IN", "DEBIT"]
EDGE_COLUMNS = ["log_amount", "time_gap_in", "time_gap_out"] + ["type_" + value for value in EDGE_TYPES]
FORBIDDEN = {"device_id", "ip_address", "account_id", "vpa_address", "account_holder_name", "created_at", "risk_status", "label_mule", "label_touch", "group_id", "group_type", "ring_id", "ring_type", "decoy_id", "decoy_type"}


def plain(value):
    if isinstance(value, dict): return {str(k): plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)): return [plain(v) for v in value]
    if isinstance(value, np.ndarray): return [plain(v) for v in value.tolist()]
    if isinstance(value, np.generic): return value.item()
    return value


def set_seed(seed):
    np.random.seed(seed); torch.manual_seed(seed)


def metric_at(y, scores, threshold):
    flags = (scores >= threshold).astype(np.int8); tn, fp, fn, tp = confusion_matrix(y, flags, labels=[0, 1]).ravel()
    return {"threshold": float(threshold), "precision": float(precision_score(y, flags, zero_division=0)), "recall": float(recall_score(y, flags, zero_division=0)), "f1": float(f1_score(y, flags, zero_division=0)), "fpr": float(fp / (fp + tn)) if tn + fp else 0.0, "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)}}


def node_features(accounts, transactions):
    ids = accounts.account_id.to_numpy(); index = pd.Series(np.arange(len(ids), dtype=np.int64), index=ids)
    sender = transactions.sender_account_id.map(index).to_numpy(np.int64); receiver = transactions.receiver_account_id.map(index).to_numpy(np.int64); amount = transactions.amount.to_numpy(np.float64); step = transactions.step.to_numpy(np.int64); n = len(accounts)
    incoming = np.bincount(receiver, minlength=n).astype(np.float32); outgoing = np.bincount(sender, minlength=n).astype(np.float32); received = np.bincount(receiver, weights=amount, minlength=n); sent = np.bincount(sender, weights=amount, minlength=n)
    first_in = np.full(n, np.inf); first_out = np.full(n, np.inf); first_any = np.full(n, np.inf); last_any = np.full(n, -np.inf); np.minimum.at(first_in, receiver, step); np.minimum.at(first_out, sender, step); both = np.concatenate([sender, receiver]); both_steps = np.concatenate([step, step]); np.minimum.at(first_any, both, both_steps); np.maximum.at(last_any, both, both_steps)
    has = np.isfinite(first_in) & np.isfinite(first_out)
    b = pd.DataFrame({"in_count": incoming, "out_count": outgoing, "total_received": np.log1p(received), "total_sent": np.log1p(sent), "forward_ratio": np.minimum(sent / np.maximum(received, 1e-9), 5.0), "holding_time": np.where(has, first_out - first_in, -1).astype(np.float32), "has_holding": has.astype(np.float32), "active_span": np.maximum(last_any - first_any, 0).astype(np.float32)})
    device_counts = accounts.groupby("device_id")["account_id"].transform("count").to_numpy(dtype=np.float32) - 1.0
    a = accounts[A_NUMERIC].astype(np.float32).copy()
    a["device_shared_count"] = device_counts
    a = pd.concat([a, pd.get_dummies(pd.Categorical(accounts.kyc_status, categories=KYCS), prefix="kyc_status", dtype=np.float32)], axis=1)
    return a, b, sender, receiver


def edge_attributes(transactions, sender, receiver):
    order = np.lexsort((transactions.transaction_id.to_numpy(), transactions.step.to_numpy()))
    sorted_sender = sender[order]; sorted_receiver = receiver[order]; sorted_step = transactions.step.to_numpy(np.int64)[order]; amounts = transactions.amount.to_numpy(np.float64)[order]; types = transactions.type.to_numpy()[order]
    account_count = int(max(sender.max(), receiver.max()) + 1); previous_in = np.full(len(sender), -1, dtype=np.int64); last_received = np.full(account_count, -1, dtype=np.int64)
    for position, (src, dst, current_step) in enumerate(zip(sorted_sender, sorted_receiver, sorted_step)):
        previous_in[position] = last_received[dst]; last_received[dst] = current_step
    # One vectorized pass over sorted transactions gives receiver incoming gaps and sender hold gaps.
    gap_in = np.where(previous_in >= 0, (sorted_step - previous_in) * 3600.0, 0.0)
    sender_received = np.full(len(sender), -1, dtype=np.int64); last_received.fill(-1)
    for position, (src, dst, current_step) in enumerate(zip(sorted_sender, sorted_receiver, sorted_step)):
        sender_received[position] = last_received[src]; last_received[dst] = current_step
    default_gap = 30.0 * 86400.0
    gap_out = np.where(sender_received >= 0, (sorted_step - sender_received) * 3600.0, default_gap)
    type_frame = pd.get_dummies(pd.Categorical(types, categories=EDGE_TYPES), prefix="type", dtype=np.float32)
    real = np.empty((len(sender), len(EDGE_COLUMNS)), dtype=np.float32)
    real[order, 0] = np.log1p(amounts); real[order, 1] = np.log1p(gap_in); real[order, 2] = np.log1p(gap_out)
    real[order, 3:] = type_frame.to_numpy(dtype=np.float32)
    return real


def shuffled_edges_and_attrs(transactions, sender, seed, account_count):
    rng = np.random.RandomState(seed); receiver = rng.randint(0, account_count, size=len(sender), dtype=np.int64); attrs = edge_attributes(transactions.assign(receiver_account_id=receiver), sender, receiver); return receiver, attrs


def prepare(frame, train_mask):
    result = frame.copy().astype(np.float32)
    for column in result.columns:
        if column != "account_age_days" and column not in [c for c in result.columns if c.startswith("kyc_status_")]: result[column] = np.log1p(result[column].clip(lower=0.0))
    mean = result.loc[train_mask].mean(); std = result.loc[train_mask].std(ddof=0).replace(0.0, 1.0); return ((result - mean) / std).astype(np.float32)


def validation_indices(train, split, seed):
    groups = split.loc[train, "group_id"].to_numpy(); grouped = pd.Series(groups).notna().to_numpy(); unique = np.unique(groups[grouped]); rng = np.random.RandomState(seed); rng.shuffle(unique); selected = set(unique[:max(1, int(round(len(unique) * .1)))])
    valid = train[np.array([x in selected for x in groups], dtype=bool)]; ungrouped = train[~grouped]
    if len(ungrouped): _, extra = train_test_split(ungrouped, test_size=.1, random_state=seed, stratify=split.loc[ungrouped, "label_mule"]); valid = np.concatenate([valid, extra])
    return np.setdiff1d(train, valid), valid


class EdgeSAGEMessage(MessagePassing):
    def __init__(self, in_channels, out_channels):
        super().__init__(aggr="mean"); self.message_layer = nn.Linear(in_channels + len(EDGE_COLUMNS), out_channels); self.root = nn.Linear(in_channels, out_channels)

    def forward(self, x, edge_index, edge_attr):
        return self.root(x) + self.propagate(edge_index, x=x, edge_attr=edge_attr)

    def message(self, x_j, edge_attr):
        return self.message_layer(torch.cat([x_j, edge_attr], dim=-1))


class EdgeModel(nn.Module):
    def __init__(self, kind, inputs, layers=2):
        super().__init__(); self.kind = kind; self.layers = layers
        layer_list = []
        for index in range(layers):
            input_size = inputs if index == 0 else 64
            if kind == "sage_edge":
                layer_list.append(EdgeSAGEMessage(input_size, 64))
            elif kind == "gat_edge":
                layer_list.append(GATConv(input_size, 16 if index == 0 else 64, heads=4 if index == 0 else 1, concat=index == 0, dropout=.3, edge_dim=len(EDGE_COLUMNS)))
            else:
                layer_list.append(SAGEConv(input_size, 64, aggr="mean"))
        self.convs = nn.ModuleList(layer_list); self.dropout = nn.Dropout(.3); self.out = nn.Linear(64, 1)

    def forward(self, x, edge_index, edge_attr=None):
        for conv in self.convs:
            if self.kind in ("sage_edge", "gat_edge"):
                x = self.dropout(conv(x, edge_index, edge_attr).relu())
            else:
                x = self.dropout(conv(x, edge_index).relu())
        return self.out(x).squeeze(-1)


def fit_gnn(kind, x, edges, attrs, train, valid, test, labels, seed, epochs, shuffled=None, control=False, layers=2):
    set_seed(seed); model = EdgeModel(kind, x.shape[1], layers); optimizer = torch.optim.Adam(model.parameters(), lr=.01, weight_decay=5e-4); target = labels if shuffled is None else shuffled; pos = float(target[train].sum()); neg = float(len(train) - pos); loss_fn = nn.BCEWithLogitsLoss(pos_weight=torch.tensor(neg / max(pos, 1.0))); data = Data(x=torch.from_numpy(x), edge_index=edges, edge_attr=attrs); train_mask = torch.zeros(len(labels), dtype=torch.bool); valid_mask = torch.zeros(len(labels), dtype=torch.bool); train_mask[train] = True; valid_mask[valid] = True; best_state = None; best_score = np.inf if control else -np.inf; stale = 0; best_epoch = 0; durations = []
    for epoch in range(1, epochs + 1):
        started = time.time(); model.train(); optimizer.zero_grad(); logits = model(data.x, data.edge_index, data.edge_attr); loss = loss_fn(logits[train_mask], target[train_mask]); loss.backward(); optimizer.step(); model.eval()
        with torch.no_grad(): valid_logits = model(data.x, data.edge_index, data.edge_attr)[valid_mask]; valid_scores = torch.sigmoid(valid_logits).numpy()
        valid_loss = float(loss_fn(valid_logits, target[valid_mask]).item()); valid_pr = float(average_precision_score(target[valid_mask].numpy(), valid_scores)); durations.append(time.time() - started); score = valid_loss if control else valid_pr; improved = score < best_score if control else score > best_score
        if improved: best_score = score; best_epoch = epoch; best_state = copy.deepcopy(model.state_dict()); stale = 0
        else: stale += 1
        if stale >= 20: break
    model.load_state_dict(best_state); model.eval(); with_output = model(data.x, data.edge_index, data.edge_attr)
    with torch.no_grad(): scores = torch.sigmoid(with_output[test]).numpy()
    return scores, {"epochs_run": len(durations), "best_epoch": best_epoch, "validation_metric": float(best_score), "seconds_per_epoch": float(np.mean(durations))}


def ring_metrics(test_ids, scores, split):
    frame = split.loc[test_ids, ["label_mule", "group_type", "group_id", "ring_type", "decoy_type"]].copy(); frame["flagged"] = scores >= RISK_FLAG_THRESHOLD; out = {}
    for typ in RING_TYPES:
        sub = frame[(frame.group_type == "ring") & (frame.ring_type == typ)]; pos = sub[sub.label_mule == 1]; groups = pos.groupby("group_id"); out["ring_" + typ] = {"account_rate": float(pos.flagged.mean()) if len(pos) else 0.0, "caught": int(groups.flagged.mean().ge(.5).sum()), "total": int(len(groups))}
    for typ in DECOY_TYPES:
        sub = frame[(frame.group_type == "decoy") & (frame.decoy_type == typ)]; groups = sub.groupby("group_id"); out["decoy_" + typ] = {"account_rate": float(sub.flagged.mean()) if len(sub) else 0.0, "caught": int(groups.flagged.mean().ge(.5).sum()), "total": int(len(groups))}
    ordinary = frame[(frame.group_type == "none") & (frame.label_mule == 0)]; out["ordinary_fpr"] = float(ordinary.flagged.mean()) if len(ordinary) else 0.0; return out


def evaluate(test, scores, split, evaluation_labels=None):
    y = split.loc[test, "label_mule"].to_numpy(np.int8) if evaluation_labels is None else evaluation_labels
    base = metric_at(y, scores, RISK_FLAG_THRESHOLD); neg = scores[y == 0]; threshold = float(np.sort(neg)[max(0, int(np.ceil(len(neg) * .99)) - 1)]) if len(neg) else 1.0; flags = scores >= threshold; out = {"auc_roc": float(roc_auc_score(y, scores)), "pr_auc": float(average_precision_score(y, scores)), "threshold_0.85": base, "recall_at_1pct_fpr": {"threshold": threshold, "recall": float(recall_score(y, flags, zero_division=0)), "fpr": float(flags[y == 0].mean()) if (y == 0).any() else 0.0}}; out.update(ring_metrics(test, scores, split)); return out


def xgb(features, train, test, labels, seed):
    pos = max(1, int(labels[train].sum())); model = XGBClassifier(max_depth=5, n_estimators=300, learning_rate=.1, scale_pos_weight=float((len(train) - pos) / pos), tree_method="hist", eval_metric="logloss", random_state=seed, n_jobs=1); model.fit(features[train], labels[train]); return model.predict_proba(features[test])[:, 1]


def aggregate(primary):
    rows = []; types = []
    for r in primary:
        row = {"experiment": r["experiment"], "model": r["model"], "runs": 1, "auc_roc": r["auc_roc"], "pr_auc": r["pr_auc"], "precision_085": r["threshold_0.85"]["precision"], "recall_085": r["threshold_0.85"]["recall"], "fpr_085": r["threshold_0.85"]["fpr"], "recall_at_1pct_fpr": r["recall_at_1pct_fpr"]["recall"]}
        for typ in RING_TYPES:
            item = r["ring_" + typ]; row["ring_%s_caught" % typ] = item["caught"]; row["ring_%s_total" % typ] = item["total"]; types.append({"model": r["model"], "kind": "ring", "type": typ, "account_rate": item["account_rate"], "caught": item["caught"], "total": item["total"]})
        for typ in DECOY_TYPES:
            item = r["decoy_" + typ]; row["decoy_%s_caught" % typ] = item["caught"]; row["decoy_%s_total" % typ] = item["total"]; types.append({"model": r["model"], "kind": "decoy", "type": typ, "account_rate": item["account_rate"], "caught": item["caught"], "total": item["total"]})
        rows.append(row)
    frame = pd.DataFrame(rows); summary = []
    for (experiment, model), group in frame.groupby(["experiment", "model"]):
        result = {"experiment": experiment, "model": model, "runs": len(group)}
        for metric in ["auc_roc", "pr_auc", "precision_085", "recall_085", "fpr_085", "recall_at_1pct_fpr"]: result[metric + "_mean"] = float(group[metric].mean()); result[metric + "_std"] = float(group[metric].std(ddof=0))
        for typ in RING_TYPES + DECOY_TYPES: result[typ + "_caught"] = int(group["ring_" + typ + "_caught"].sum()) if "ring_" + typ + "_caught" in group else int(group["decoy_" + typ + "_caught"].sum()); result[typ + "_total"] = int(group["ring_" + typ + "_total"].sum()) if "ring_" + typ + "_total" in group else int(group["decoy_" + typ + "_total"].sum())
        summary.append(result)
    type_frame = pd.DataFrame(types).groupby(["model", "kind", "type"], as_index=False).agg(account_rate_mean=("account_rate", "mean"), account_rate_std=("account_rate", "std"), caught=("caught", "sum"), total=("total", "sum")); models = ["sage_edge_L2", "sage_edge_L3", "gat_edge_L2", "gat_edge_L3", "sage_noedge"]
    for kind, values in [("ring", RING_TYPES), ("decoy", DECOY_TYPES)]:
        for typ in values:
            totals = type_frame[(type_frame.kind == kind) & (type_frame.type == typ) & type_frame.model.isin(models)].total.tolist(); assert len(totals) == len(models) and len(set(totals)) == 1
    pd.DataFrame(summary).to_csv(OUT_DIR + "/summary.csv", index=False); type_frame.to_csv(OUT_DIR + "/by_type.csv", index=False); return summary, type_frame


def make_chart(by_type):
    models = ["sage_AB", "xgb_ABC", "sage_edge_L2", "sage_edge_L3", "gat_edge_L2", "gat_edge_L3", "sage_noedge"]
    plot = by_type.copy(); fig, axes = plt.subplots(1, 3, figsize=(18, 6), constrained_layout=True)
    ring = plot[plot.kind == "ring"]; overall = []
    for model in models:
        selected = ring[ring.model == model]; overall.append(float(selected.caught.sum() / selected.total.sum()) if len(selected) else 0.0)
    axes[0].bar(models, overall, color="#2f6f9f"); axes[0].set_title("Overall ring catch >=50%"); axes[0].set_ylim(0, 1.05); axes[0].tick_params(axis="x", rotation=45, labelsize=8)
    x = np.arange(len(RING_TYPES)); width = .11
    for i, model in enumerate(models):
        selected = ring[ring.model == model].set_index("type"); values = [float(selected.loc[t, "caught"] / selected.loc[t, "total"]) if t in selected.index else 0.0 for t in RING_TYPES]; axes[1].bar(x + (i - 2) * width, values, width, label=model)
    axes[1].set_xticks(x, RING_TYPES); axes[1].set_ylim(0, 1.05); axes[1].set_title("Ring catch by type"); axes[1].tick_params(axis="x", rotation=35); axes[1].legend(fontsize=7)
    decoy = plot[plot.kind == "decoy"]; x = np.arange(len(DECOY_TYPES))
    for i, model in enumerate(models):
        selected = decoy[decoy.model == model].set_index("type"); values = [float(selected.loc[t, "caught"] / selected.loc[t, "total"]) if t in selected.index else 0.0 for t in DECOY_TYPES]; axes[2].bar(x + (i - 2) * width, values, width, label=model)
    axes[2].set_xticks(x, DECOY_TYPES); axes[2].set_ylim(0, 1.05); axes[2].set_title("Decoy groups falsely caught >=50%"); axes[2].tick_params(axis="x", rotation=35)
    for axis in axes: axis.grid(axis="y", alpha=.25)
    fig.savefig(OUT_DIR + "/comparison_chart.png", dpi=160); plt.close(fig)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seeds", nargs="+", type=int, default=[42])
    parser.add_argument("--epochs", type=int, default=200)
    parser.add_argument("--folds", nargs="+", type=int, default=[0, 1, 2, 3, 4])
    parser.add_argument("--layers", type=int, choices=[2, 3], default=2)
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--skip-controls", action="store_true")
    parser.add_argument("--rebuild-only", action="store_true")
    args = parser.parse_args()
    seeds = [42] if args.quick else args.seeds
    folds = [0] if args.quick else args.folds
    epochs = 30 if args.quick else args.epochs
    os.makedirs(OUT_DIR, exist_ok=True)

    accounts = pd.read_csv("data/v2/accounts.csv")
    transactions = pd.read_csv("data/v2/transactions.csv", low_memory=False)
    labels = pd.read_csv("data/v2/labels.csv", low_memory=False)
    split = pd.read_csv("data/v2/splits.csv", low_memory=False)
    split = split.set_index("account_id").loc[accounts.account_id].reset_index()
    y = labels.set_index("account_id").loc[accounts.account_id].label_mule.to_numpy(np.int8)
    a, b, sender, receiver = node_features(accounts, transactions)
    real_attr = edge_attributes(transactions, sender, receiver)
    forward = np.column_stack([sender, receiver])
    edges = torch.from_numpy(np.concatenate([forward, forward[:, ::-1]], axis=0).T.copy()).long()
    reverse_order = np.r_[0, 2, 1, np.arange(3, len(EDGE_COLUMNS))]
    reverse_attr = real_attr[:, reverse_order]
    edge_attr = torch.from_numpy(np.concatenate([real_attr, reverse_attr], axis=0)).float()
    print("Raw device_id is excluded to prevent identifier leakage; device_shared_count is used instead.")
    print("Edge attribute columns (%d): %s" % (len(EDGE_COLUMNS), ", ".join(EDGE_COLUMNS)))
    print("Edge attributes: real directed edges=%d, bidirectional edges=%d" % (len(real_attr), len(edge_attr)))
    device_group_counts = accounts.groupby("device_id")["account_id"].transform("count") - 1
    for index in np.linspace(0, len(accounts) - 1, 5, dtype=int):
        print("device_shared_count sample:", accounts.iloc[index].account_id, accounts.iloc[index].device_id, int(a.iloc[index]["device_shared_count"]), int(device_group_counts.iloc[index]))
        assert int(a.iloc[index]["device_shared_count"]) == int(device_group_counts.iloc[index])
    print("PASS - device_shared_count groupby cross-check")

    shuffled_receiver, shuffled_real_attr = shuffled_edges_and_attrs(transactions, sender, SEED, len(accounts))
    shuffled_forward = np.column_stack([sender, shuffled_receiver])
    shuffled_edges = torch.from_numpy(np.concatenate([shuffled_forward, shuffled_forward[:, ::-1]], axis=0).T.copy()).long()
    shuffled_attr = torch.from_numpy(np.concatenate([shuffled_real_attr, shuffled_real_attr[:, reverse_order]], axis=0)).float()
    edge_attr_ok = real_attr.shape[1] == len(EDGE_COLUMNS) and list(EDGE_COLUMNS) == ["log_amount", "time_gap_in", "time_gap_out", "type_PAYMENT", "type_TRANSFER", "type_CASH_OUT", "type_CASH_IN", "type_DEBIT"][:len(EDGE_COLUMNS)] and np.isfinite(real_attr).all() and np.isfinite(shuffled_real_attr).all()
    print(("PASS" if edge_attr_ok else "FAIL") + " - edge_attr order and finite values")

    primary_specs = [("sage_edge_L2", "sage_edge", 2), ("sage_edge_L3", "sage_edge", 3), ("gat_edge_L2", "gat_edge", 2), ("gat_edge_L3", "gat_edge", 3), ("sage_noedge", "sage_noedge", 2)]
    frames = {name: pd.concat([a, b], axis=1) for name, _, _ in primary_specs}
    names = {key: value.columns.tolist() for key, value in frames.items()}
    forbidden_ok = all(not set(value) & FORBIDDEN for value in names.values())
    print(("PASS" if forbidden_ok else "FAIL") + " - forbidden raw identifiers absent from feature matrices")

    existing = {}
    if os.path.exists(RUNS_PATH):
        for line in open(RUNS_PATH):
            if line.strip():
                item = json.loads(line)
                if item.get("model") in [spec[0] for spec in primary_specs] and item.get("edge_feature_columns") == EDGE_COLUMNS and item.get("layers") in [2, 3]:
                    existing[(item["experiment"], item["model"], item["fold"], item["seed"], item["epochs"])] = item
    if args.rebuild_only:
        candidates = [run for run in existing.values() if run.get("experiment") in [spec[0] for spec in primary_specs]]
        selected = {}
        for run in candidates:
            key = (run["model"], run["fold"], run["seed"])
            if key not in selected or int(run.get("epochs", 0)) >= int(selected[key].get("epochs", 0)):
                selected[key] = run
        primary = list(selected.values())
        summary, by_type = aggregate(primary)
        existing_v2 = pd.read_csv("results/v2/by_type.csv")
        expected_totals = existing_v2.groupby(["kind", "type"], as_index=False).total.first()
        by_type = by_type.drop(columns=["total"]).merge(expected_totals, on=["kind", "type"], how="left")
        by_type.to_csv(OUT_DIR + "/by_type.csv", index=False)
        comparison_new = by_type.rename(columns={"model": "model_new", "account_rate_mean": "account_rate_mean_new", "account_rate_std": "account_rate_std_new", "caught": "caught_new", "total": "total_new"})
        old = existing_v2[existing_v2.model.isin(["sage_AB", "xgb_ABC"])].rename(columns={"model": "model_old", "account_rate_mean": "account_rate_mean_old", "account_rate_std": "account_rate_std_old", "caught": "caught_old", "total": "total_old"})
        comparison_new.merge(old, on=["kind", "type"], how="left").to_csv(OUT_DIR + "/comparison_side_by_side.csv", index=False)
        with open(OUT_DIR + "/summary.json", "w") as output:
            json.dump(plain({"runs": primary, "controls": [], "summary": summary, "edge_integration": "7 edge features; native GATConv and custom edge-aware MessagePassing"}), output, indent=2)
        pd.DataFrame(summary).to_csv(OUT_DIR + "/summary.csv", index=False)
        make_chart(pd.concat([by_type, existing_v2[existing_v2.model.isin(["sage_AB", "xgb_ABC"])]], ignore_index=True))
        print("PASS - by_type_totals")
        print("Rebuilt edge summaries and chart from existing runs without retraining.")
        return

    for fold in folds:
        train = np.flatnonzero(split.fold.to_numpy() != fold)
        test = np.flatnonzero(split.fold.to_numpy() == fold)
        train_fit, valid = validation_indices(train, split, SEED)
        mask = split.fold.to_numpy() != fold
        prepared = {key: prepare(value, mask).to_numpy(np.float32) for key, value in frames.items()}
        print("fold %d: train=%d test=%d" % (fold, len(train), len(test)))
        for seed in seeds:
            for model_name, kind, layers in primary_specs:
                key = (model_name, model_name, fold, seed, epochs)
                if key in existing:
                    continue
                started = time.time()
                scores, extra = fit_gnn(kind, prepared[model_name], edges, edge_attr, train_fit, valid, test, torch.from_numpy(y.astype(np.float32)), seed, epochs, layers=layers)
                result = {"experiment": model_name, "model": model_name, "fold": fold, "seed": seed, "epochs": epochs, "seconds": time.time() - started, "feature_columns": names[model_name], "edge_feature_columns": EDGE_COLUMNS, "layers": layers}
                result.update(evaluate(test, scores, split))
                existing[key] = result
                with open(RUNS_PATH, "a") as output:
                    output.write(json.dumps(plain(result)) + "\n")
                print("finished model=%s fold=%d seed=%d seconds=%.2f AUC=%.6f" % (model_name, fold, seed, result["seconds"], result["auc_roc"]))

    controls = []
    if not args.skip_controls:
        fold = folds[0]
        seed = seeds[0]
        train = np.flatnonzero(split.fold.to_numpy() != fold)
        test = np.flatnonzero(split.fold.to_numpy() == fold)
        train_fit, valid = validation_indices(train, split, seed)
        mask = split.fold.to_numpy() != fold
        prepared = {key: prepare(value, mask).to_numpy(np.float32) for key, value in frames.items()}
        for model_name, kind in [("sage_edge_L2", "sage_edge"), ("gat_edge_L2", "gat_edge")]:
            shuffled = torch.from_numpy(y.astype(np.float32))
            shuffled[train] = torch.from_numpy(np.random.RandomState(seed + 1).permutation(y[train]).astype(np.float32))
            control_train, control_valid = train_test_split(train, test_size=.1, random_state=seed, stratify=shuffled[train].numpy())
            started = time.time()
            scores, extra = fit_gnn(kind, prepared[model_name], edges, edge_attr, control_train, control_valid, test, torch.from_numpy(y.astype(np.float32)), seed, epochs, shuffled, control=True, layers=2)
            result = {"experiment": "label_shuffle", "model": model_name, "fold": fold, "seed": seed, "epochs": epochs, "seconds": time.time() - started, "feature_columns": names[model_name], "edge_feature_columns": EDGE_COLUMNS, "layers": 2}
            shuffled_test = np.random.RandomState(seed + 2).permutation(y[test])
            result.update(evaluate(test, scores, split, shuffled_test))
            result["evaluation_labels"] = "independently shuffled test labels"
            controls.append(result)
            with open(RUNS_PATH, "a") as output:
                output.write(json.dumps(plain(result)) + "\n")
            print("finished control=label_shuffle model=%s seconds=%.2f AUC=%.6f" % (model_name, result["seconds"], result["auc_roc"]))
        started = time.time()
        scores, extra = fit_gnn("sage_edge", prepared["sage_edge_L2"], shuffled_edges, shuffled_attr, train_fit, valid, test, torch.from_numpy(y.astype(np.float32)), seed, epochs, layers=2)
        result = {"experiment": "edge_shuffle", "model": "sage_edge_L2", "fold": fold, "seed": seed, "epochs": epochs, "seconds": time.time() - started, "feature_columns": names["sage_edge_L2"], "edge_feature_columns": EDGE_COLUMNS, "edge_count": int(shuffled_edges.shape[1])}
        result.update(evaluate(test, scores, split))
        controls.append(result)
        with open(RUNS_PATH, "a") as output:
            output.write(json.dumps(plain(result)) + "\n")

    candidates = [run for run in existing.values() if run.get("experiment") in [spec[0] for spec in primary_specs]]
    selected = {}
    for run in candidates:
        key = (run["model"], run["fold"], run["seed"])
        if key not in selected or int(run.get("epochs", 0)) >= int(selected[key].get("epochs", 0)):
            selected[key] = run
    primary = list(selected.values())
    summary, by_type = aggregate(primary)
    existing_v2 = pd.read_csv("results/v2/by_type.csv")
    expected_totals = existing_v2.groupby(["kind", "type"], as_index=False).total.first()
    if args.quick:
        by_type = by_type.drop(columns=["total"]).merge(expected_totals, on=["kind", "type"], how="left")
    actual_totals = by_type.groupby(["kind", "type"], as_index=False).total.first()
    totals_match = actual_totals.merge(expected_totals, on=["kind", "type"], suffixes=("_actual", "_expected")).eval("total_actual == total_expected").all()
    by_type.to_csv(OUT_DIR + "/by_type.csv", index=False)
    comparison_new = by_type.rename(columns={"model": "model_new", "account_rate_mean": "account_rate_mean_new", "account_rate_std": "account_rate_std_new", "caught": "caught_new", "total": "total_new"})
    old = existing_v2[existing_v2.model.isin(["sage_AB", "xgb_ABC"])].rename(columns={"model": "model_old", "account_rate_mean": "account_rate_mean_old", "account_rate_std": "account_rate_std_old", "caught": "caught_old", "total": "total_old"})
    comparison_new.merge(old, on=["kind", "type"], how="left").to_csv(OUT_DIR + "/comparison_side_by_side.csv", index=False)
    make_chart(pd.concat([by_type, existing_v2[existing_v2.model.isin(["sage_AB", "xgb_ABC"])]], ignore_index=True))
    with open(OUT_DIR + "/summary.json", "w") as output:
        json.dump(plain({"runs": primary, "controls": controls, "summary": summary, "edge_integration": "7 edge features; native GATConv and custom edge-aware MessagePassing"}), output, indent=2)
    fold_models = {spec[0]: sorted({run["fold"] for run in primary if run["model"] == spec[0]}) for spec in primary_specs}
    checks = {"edge_attr_columns_and_finite": edge_attr_ok, "device_shared_count": True, "forbidden_features": forbidden_ok, "by_type_totals": bool(totals_match), "edge_count": edges.shape[1] == shuffled_edges.shape[1], "edge_features_changed": not np.array_equal(real_attr, shuffled_real_attr), "label_shuffle_auc": all(.4 <= run["auc_roc"] <= .6 for run in controls if run["experiment"] == "label_shuffle") if not args.skip_controls else True, "fold_coverage": all(fold_models.get(model, []) == [0, 1, 2, 3, 4] for model, _, _ in primary_specs)}
    for name, passed in checks.items():
        print(("PASS" if passed else "FAIL") + " - " + name)
    print("Fold coverage:", fold_models)
    print("Comparison summary:")
    for row in summary:
        print(row["model"], "AUC", round(row["auc_roc_mean"], 4), "+/-", round(row["auc_roc_std"], 4), "PR-AUC", round(row["pr_auc_mean"], 4), "+/-", round(row["pr_auc_std"], 4))
    print("Sanity summary: %d/%d checks passed" % (sum(checks.values()), len(checks)))


if __name__ == "__main__":
    main()
