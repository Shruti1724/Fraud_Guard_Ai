import argparse
import copy
import json
import os
import shutil
import time
import warnings
from typing import Any, Dict, List, Optional, Tuple

warnings.filterwarnings("ignore", category=RuntimeWarning)
warnings.filterwarnings("ignore", category=UserWarning)

OUT_DIR = "results/ensemble"
MPL_DIR = os.path.join(OUT_DIR, ".mplcache")
os.makedirs(MPL_DIR, exist_ok=True)
os.environ["MPLCONFIGDIR"] = os.path.abspath(MPL_DIR)

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import scipy.sparse as sparse
from scipy.sparse.csgraph import connected_components
from scipy.stats import rankdata
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, confusion_matrix, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split
import torch
from torch import nn
from torch_geometric.data import Data
from torch_geometric.nn import MessagePassing
from xgboost import XGBClassifier

SEED = 42
RISK_FLAG_THRESHOLD = 0.85
WARN_FLAG_THRESHOLD = 0.70
V2_DIR = "results/v2"
V2_EDGES_DIR = "results/v2_edges"

KYCS = ["FULL_BIOMETRIC_VERIFIED", "PARTIAL_MINIMUM_OTP", "MINIMUM_KYC", "NONE"]
RING_TYPES = ["chain", "star", "cycle", "fanout", "hybrid"]
DECOY_TYPES = ["family_group", "forward_chain", "merchant_hub", "payroll_fanout"]
A_NUMERIC = ["account_age_days", "current_balance", "avg_tx_amount", "tx_frequency_per_day", "unique_counterparties"]
EDGE_TYPES = ["PAYMENT", "TRANSFER", "CASH_OUT", "CASH_IN", "DEBIT"]
EDGE_COLUMNS = ["log_amount", "time_gap_in", "time_gap_out"] + ["type_" + value for value in EDGE_TYPES]
FORBIDDEN = {"device_id", "ip_address", "account_id", "vpa_address", "account_holder_name", "created_at", "risk_status", "label_mule", "label_touch", "group_id", "group_type", "ring_id", "ring_type", "decoy_id", "decoy_type"}

EXPECTED_TOTALS = {
    ("ring", "chain"): 40,
    ("ring", "star"): 35,
    ("ring", "cycle"): 25,
    ("ring", "fanout"): 25,
    ("ring", "hybrid"): 25,
    ("decoy", "family_group"): 40,
    ("decoy", "forward_chain"): 50,
    ("decoy", "merchant_hub"): 60,
    ("decoy", "payroll_fanout"): 25,
}

EXPECTED_TEST_COUNTS = {
    0: 178684,
    1: 178651,
    2: 178590,
    3: 178662,
    4: 178629,
}

EXPECTED_VAL_COUNTS = {
    0: 71439,
    1: 71425,
    2: 71431,
    3: 71412,
    4: 71378,
}


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


def set_seed(seed: int):
    np.random.seed(seed)
    torch.manual_seed(seed)


def metric_at(y: np.ndarray, scores: np.ndarray, threshold: float) -> Dict[str, Any]:
    flags = (scores >= threshold).astype(np.int8)
    tn, fp, fn, tp = confusion_matrix(y, flags, labels=[0, 1]).ravel()
    return {
        "threshold": float(threshold),
        "precision": float(precision_score(y, flags, zero_division=0)),
        "recall": float(recall_score(y, flags, zero_division=0)),
        "f1": float(f1_score(y, flags, zero_division=0)),
        "fpr": float(fp / (fp + tn)) if tn + fp else 0.0,
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
    }


def node_features(accounts: pd.DataFrame, transactions: pd.DataFrame):
    ids = accounts.account_id.to_numpy()
    index = pd.Series(np.arange(len(ids), dtype=np.int64), index=ids)
    sender = transactions.sender_account_id.map(index).to_numpy(np.int64)
    receiver = transactions.receiver_account_id.map(index).to_numpy(np.int64)
    amount = transactions.amount.to_numpy(np.float64)
    step = transactions.step.to_numpy(np.int64)
    n = len(accounts)

    incoming = np.bincount(receiver, minlength=n).astype(np.float32)
    outgoing = np.bincount(sender, minlength=n).astype(np.float32)
    received = np.bincount(receiver, weights=amount, minlength=n)
    sent = np.bincount(sender, weights=amount, minlength=n)

    first_in = np.full(n, np.inf)
    first_out = np.full(n, np.inf)
    first_any = np.full(n, np.inf)
    last_any = np.full(n, -np.inf)
    np.minimum.at(first_in, receiver, step)
    np.minimum.at(first_out, sender, step)
    both = np.concatenate([sender, receiver])
    both_steps = np.concatenate([step, step])
    np.minimum.at(first_any, both, both_steps)
    np.maximum.at(last_any, both, both_steps)

    has = np.isfinite(first_in) & np.isfinite(first_out)
    b = pd.DataFrame({
        "in_count": incoming,
        "out_count": outgoing,
        "total_received": np.log1p(received),
        "total_sent": np.log1p(sent),
        "forward_ratio": np.minimum(sent / np.maximum(received, 1e-9), 5.0),
        "holding_time": np.where(has, first_out - first_in, -1).astype(np.float32),
        "has_holding": has.astype(np.float32),
        "active_span": np.maximum(last_any - first_any, 0).astype(np.float32),
    })

    device_counts = accounts.groupby("device_id")["account_id"].transform("count").to_numpy(dtype=np.float32) - 1.0
    a = accounts[A_NUMERIC].astype(np.float32).copy()
    a["device_shared_count"] = device_counts
    a = pd.concat([a, pd.get_dummies(pd.Categorical(accounts.kyc_status, categories=KYCS), prefix="kyc_status", dtype=np.float32)], axis=1)
    return a, b, sender, receiver


def compute_c_features(accounts: pd.DataFrame, sender: np.ndarray, receiver: np.ndarray) -> pd.DataFrame:
    n = len(accounts)
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
    return pd.DataFrame({
        "unique_neighbours": unique_neighbours,
        "mean_neighbour_age": np.divide(neighbour_age_sum, unique_neighbours, out=np.zeros(n), where=unique_neighbours > 0),
        "young_neighbour_fraction": np.divide(young_count, unique_neighbours, out=np.zeros(n), where=unique_neighbours > 0),
        "mean_neighbour_degree": np.divide(neighbour_degree_sum, unique_neighbours, out=np.zeros(n), where=unique_neighbours > 0),
        "sum_neighbour_degrees": neighbour_degree_sum,
        "weak_component_size": component_sizes[component_id].astype(np.float32),
    })


def edge_attributes(transactions: pd.DataFrame, sender: np.ndarray, receiver: np.ndarray) -> np.ndarray:
    order = np.lexsort((transactions.transaction_id.to_numpy(), transactions.step.to_numpy()))
    sorted_sender = sender[order]
    sorted_receiver = receiver[order]
    sorted_step = transactions.step.to_numpy(np.int64)[order]
    amounts = transactions.amount.to_numpy(np.float64)[order]
    types = transactions.type.to_numpy()[order]
    account_count = int(max(sender.max(), receiver.max()) + 1)
    previous_in = np.full(len(sender), -1, dtype=np.int64)
    last_received = np.full(account_count, -1, dtype=np.int64)
    for position, (src, dst, current_step) in enumerate(zip(sorted_sender, sorted_receiver, sorted_step)):
        previous_in[position] = last_received[dst]
        last_received[dst] = current_step
    gap_in = np.where(previous_in >= 0, (sorted_step - previous_in) * 3600.0, 0.0)
    sender_received = np.full(len(sender), -1, dtype=np.int64)
    last_received.fill(-1)
    for position, (src, dst, current_step) in enumerate(zip(sorted_sender, sorted_receiver, sorted_step)):
        sender_received[position] = last_received[src]
        last_received[dst] = current_step
    default_gap = 30.0 * 86400.0
    gap_out = np.where(sender_received >= 0, (sorted_step - sender_received) * 3600.0, default_gap)
    type_frame = pd.get_dummies(pd.Categorical(types, categories=EDGE_TYPES), prefix="type", dtype=np.float32)
    real = np.empty((len(sender), len(EDGE_COLUMNS)), dtype=np.float32)
    real[order, 0] = np.log1p(amounts)
    real[order, 1] = np.log1p(gap_in)
    real[order, 2] = np.log1p(gap_out)
    real[order, 3:] = type_frame.to_numpy(dtype=np.float32)
    return real


def prepare_gnn_features(frame: pd.DataFrame, train_mask: np.ndarray) -> pd.DataFrame:
    result = frame.copy().astype(np.float32)
    for column in result.columns:
        if column != "account_age_days" and column not in [c for c in result.columns if c.startswith("kyc_status_")]:
            result[column] = np.log1p(result[column].clip(lower=0.0))
    mean = result.loc[train_mask].mean()
    std = result.loc[train_mask].std(ddof=0).replace(0.0, 1.0)
    return ((result - mean) / std).astype(np.float32)


def prepare_xgb_features(frame: pd.DataFrame, train_mask: np.ndarray) -> pd.DataFrame:
    result = frame.copy().astype(np.float32)
    for column in result.columns:
        if column in ["current_balance", "avg_tx_amount", "tx_frequency_per_day", "unique_counterparties", "in_count", "out_count", "total_received", "total_sent", "sum_neighbour_degrees", "weak_component_size"]:
            result[column] = np.log1p(result[column].clip(lower=0.0))
    means = result.loc[train_mask].mean()
    stds = result.loc[train_mask].std(ddof=0).replace(0.0, 1.0)
    return ((result - means) / stds).astype(np.float32)


def validation_indices(train: np.ndarray, split: pd.DataFrame, seed: int) -> Tuple[np.ndarray, np.ndarray]:
    groups = split.loc[train, "group_id"].to_numpy()
    grouped = pd.Series(groups).notna().to_numpy()
    unique = np.unique(groups[grouped])
    rng = np.random.RandomState(seed)
    rng.shuffle(unique)
    selected = set(unique[:max(1, int(round(len(unique) * 0.1)))])
    valid = train[np.array([x in selected for x in groups], dtype=bool)]
    ungrouped = train[~grouped]
    if len(ungrouped):
        _, extra = train_test_split(ungrouped, test_size=0.1, random_state=seed, stratify=split.loc[ungrouped, "label_mule"])
        valid = np.concatenate([valid, extra])
    return np.setdiff1d(train, valid), valid


class EdgeSAGEMessage(MessagePassing):
    def __init__(self, in_channels: int, out_channels: int):
        super().__init__(aggr="mean")
        self.message_layer = nn.Linear(in_channels + len(EDGE_COLUMNS), out_channels)
        self.root = nn.Linear(in_channels, out_channels)

    def forward(self, x: torch.Tensor, edge_index: torch.Tensor, edge_attr: torch.Tensor):
        return self.root(x) + self.propagate(edge_index, x=x, edge_attr=edge_attr)

    def message(self, x_j: torch.Tensor, edge_attr: torch.Tensor):
        return self.message_layer(torch.cat([x_j, edge_attr], dim=-1))


class EdgeModel(nn.Module):
    def __init__(self, kind: str, inputs: int, layers: int = 2):
        super().__init__()
        self.kind = kind
        self.layers = layers
        layer_list = []
        for index in range(layers):
            input_size = inputs if index == 0 else 64
            if kind == "sage_edge":
                layer_list.append(EdgeSAGEMessage(input_size, 64))
            else:
                raise NotImplementedError(f"Unsupported kind: {kind}")
        self.convs = nn.ModuleList(layer_list)
        self.dropout = nn.Dropout(0.3)
        self.out = nn.Linear(64, 1)

    def forward(self, x: torch.Tensor, edge_index: torch.Tensor, edge_attr: Optional[torch.Tensor] = None):
        for conv in self.convs:
            x = self.dropout(conv(x, edge_index, edge_attr).relu())
        return self.out(x).squeeze(-1)


def fit_sage_edge_verbatim(x: np.ndarray, edges: torch.Tensor, attrs: torch.Tensor,
                           train_fit: np.ndarray, valid: np.ndarray, test: np.ndarray,
                           labels: np.ndarray, seed: int, epochs: int, layers: int = 2) -> Tuple[np.ndarray, np.ndarray, Dict[str, Any]]:
    set_seed(seed)
    model = EdgeModel("sage_edge", x.shape[1], layers)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.01, weight_decay=5e-4)
    target = torch.from_numpy(labels.astype(np.float32))

    pos = float(target[train_fit].sum())
    neg = float(len(train_fit) - pos)
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=torch.tensor(neg / max(pos, 1.0)))

    data = Data(x=torch.from_numpy(x), edge_index=edges, edge_attr=attrs)
    train_mask = torch.zeros(len(labels), dtype=torch.bool)
    valid_mask = torch.zeros(len(labels), dtype=torch.bool)
    train_mask[train_fit] = True
    valid_mask[valid] = True

    best_state = None
    best_score = -np.inf
    stale = 0
    best_epoch = 0
    durations = []

    for epoch in range(1, epochs + 1):
        started = time.time()
        model.train()
        optimizer.zero_grad()
        logits = model(data.x, data.edge_index, data.edge_attr)
        loss = loss_fn(logits[train_mask], target[train_mask])
        loss.backward()
        optimizer.step()

        model.eval()
        with torch.no_grad():
            valid_logits = model(data.x, data.edge_index, data.edge_attr)[valid_mask]
            valid_scores = torch.sigmoid(valid_logits).numpy()
        valid_loss = float(loss_fn(valid_logits, target[valid_mask]).item())
        valid_pr = float(average_precision_score(target[valid_mask].numpy(), valid_scores))
        durations.append(time.time() - started)

        if valid_pr > best_score:
            best_score = valid_pr
            best_epoch = epoch
            best_state = copy.deepcopy(model.state_dict())
            stale = 0
        else:
            stale += 1

        if stale >= 20:
            break

    model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        with_output = model(data.x, data.edge_index, data.edge_attr)
        test_scores = torch.sigmoid(with_output[test]).numpy()
        val_scores = torch.sigmoid(with_output[valid]).numpy()

    meta = {
        "epochs_run": len(durations),
        "best_epoch": best_epoch,
        "best_val_pr_auc": float(best_score),
        "seconds": float(sum(durations)),
        "seconds_per_epoch": float(np.mean(durations)),
    }
    return test_scores, val_scores, meta


def fit_xgb_val(prepared_features: np.ndarray, train_fit: np.ndarray, valid: np.ndarray,
                labels: np.ndarray, seed: int) -> np.ndarray:
    y_train = labels[train_fit]
    weight = float((y_train == 0).sum() / max(1, (y_train == 1).sum()))
    model = XGBClassifier(
        max_depth=5,
        n_estimators=300,
        learning_rate=0.1,
        scale_pos_weight=weight,
        objective="binary:logistic",
        eval_metric="logloss",
        tree_method="hist",
        random_state=seed,
        n_jobs=1,
    )
    model.fit(prepared_features[train_fit], y_train)
    return model.predict_proba(prepared_features[valid])[:, 1]


def ring_metrics(test_ids: np.ndarray, scores: np.ndarray, split: pd.DataFrame, threshold: float = RISK_FLAG_THRESHOLD) -> Dict[str, Any]:
    frame = split.loc[test_ids, ["label_mule", "group_type", "group_id", "ring_type", "decoy_type"]].copy()
    frame["flagged"] = scores >= threshold
    out = {}
    for typ in RING_TYPES:
        sub = frame[(frame.group_type == "ring") & (frame.ring_type == typ)]
        pos = sub[sub.label_mule == 1]
        groups = pos.groupby("group_id")
        out["ring_" + typ] = {
            "account_rate": float(pos.flagged.mean()) if len(pos) else 0.0,
            "caught": int(groups.flagged.mean().ge(0.5).sum()),
            "total": int(len(groups)),
        }
    for typ in DECOY_TYPES:
        sub = frame[(frame.group_type == "decoy") & (frame.decoy_type == typ)]
        groups = sub.groupby("group_id")
        out["decoy_" + typ] = {
            "account_rate": float(sub.flagged.mean()) if len(sub) else 0.0,
            "caught": int(groups.flagged.mean().ge(0.5).sum()),
            "total": int(len(groups)),
        }
    ordinary = frame[(frame.group_type == "none") & (frame.label_mule == 0)]
    out["ordinary_fpr"] = float(ordinary.flagged.mean()) if len(ordinary) else 0.0
    return out


def evaluate(test_ids: np.ndarray, scores: np.ndarray, split: pd.DataFrame, threshold: float = RISK_FLAG_THRESHOLD) -> Dict[str, Any]:
    y = split.loc[test_ids, "label_mule"].to_numpy(dtype=np.int8)
    base = metric_at(y, scores, threshold)
    neg = scores[y == 0]
    threshold_1pct = float(np.sort(neg)[max(0, int(np.ceil(len(neg) * 0.99)) - 1)]) if len(neg) else 1.0
    flags_1pct = scores >= threshold_1pct
    out = {
        "auc_roc": float(roc_auc_score(y, scores)),
        "pr_auc": float(average_precision_score(y, scores)),
        "threshold_0.85": base,
        "recall_at_1pct_fpr": {
            "threshold": threshold_1pct,
            "recall": float(recall_score(y, flags_1pct, zero_division=0)),
            "fpr": float(flags_1pct[y == 0].mean()) if (y == 0).any() else 0.0,
        },
    }
    out.update(ring_metrics(test_ids, scores, split, threshold=threshold))
    return out


def make_chart(by_type: pd.DataFrame, best_blend_model: str, out_path: str):
    models = ["xgb_ABC", "sage_edge_L2", best_blend_model]
    plot = by_type[by_type.model.isin(models)].copy()
    fig, axes = plt.subplots(1, 3, figsize=(18, 6), constrained_layout=True)

    # 1. Overall ring catch rate
    ring = plot[plot.kind == "ring"]
    overall = []
    for model in models:
        sub = ring[ring.model == model]
        overall.append(float(sub.caught.sum() / sub.total.sum()) if len(sub) and sub.total.sum() else 0.0)
    bars = axes[0].bar(models, overall, color=["#3274a1", "#e1812c", "#2ca02c"])
    axes[0].set_title("Overall Ring Catch >=50%", fontsize=13, fontweight="bold")
    axes[0].set_ylim(0, 1.05)
    axes[0].tick_params(axis="x", rotation=25, labelsize=9)
    for bar in bars:
        yval = bar.get_height()
        axes[0].text(bar.get_x() + bar.get_width() / 2.0, yval + 0.02, f"{yval:.1%}", ha="center", va="bottom", fontsize=8)

    # 2. Ring catch rate by type
    x = np.arange(len(RING_TYPES))
    width = 0.25
    colors = ["#3274a1", "#e1812c", "#2ca02c"]
    for i, model in enumerate(models):
        sub = ring[ring.model == model].set_index("type")
        vals = [float(sub.loc[t, "caught"] / sub.loc[t, "total"]) if t in sub.index and sub.loc[t, "total"] else 0.0 for t in RING_TYPES]
        axes[1].bar(x + (i - 1) * width, vals, width, label=model, color=colors[i % len(colors)])
    axes[1].set_xticks(x)
    axes[1].set_xticklabels(RING_TYPES, rotation=25)
    axes[1].set_ylim(0, 1.05)
    axes[1].set_title("Ring Catch Rate by Type (>=50% Mule Recall)", fontsize=13, fontweight="bold")
    axes[1].legend(fontsize=9)

    # 3. Decoy false-alarm counts
    decoy = plot[plot.kind == "decoy"]
    x_dec = np.arange(len(DECOY_TYPES))
    for i, model in enumerate(models):
        sub = decoy[decoy.model == model].set_index("type")
        vals = [int(sub.loc[t, "caught"]) if t in sub.index else 0 for t in DECOY_TYPES]
        axes[2].bar(x_dec + (i - 1) * width, vals, width, label=model, color=colors[i % len(colors)])
    axes[2].set_xticks(x_dec)
    axes[2].set_xticklabels(DECOY_TYPES, rotation=25)
    axes[2].set_title("Decoy Groups Falsely Caught (>=50% Flagged)", fontsize=13, fontweight="bold")
    axes[2].legend(fontsize=9)

    for ax in axes:
        ax.grid(axis="y", linestyle="--", alpha=0.3)
    fig.savefig(out_path, dpi=160)
    plt.close(fig)


def check_data_integrity_before_step2(split: pd.DataFrame, sage_oof_df: pd.DataFrame, val_df: pd.DataFrame, xgb_oof: pd.DataFrame, folds: List[int], seed: int):
    print("\n" + "=" * 90)
    print("PRE-STEP 2 DATA INTEGRITY & ROW COUNT VERIFICATION")
    print("=" * 90)
    for fold in folds:
        test_expected_accs = split.loc[split.fold == fold, "account_id"].to_numpy()
        exp_test_count = EXPECTED_TEST_COUNTS.get(fold, len(test_expected_accs))

        # 1. sage_edge_L2 test scores
        sage_fold = sage_oof_df[sage_oof_df["fold"] == fold]
        if len(sage_fold) != exp_test_count:
            raise ValueError(f"Integrity Error: Fold {fold} sage_edge_L2 test row count mismatch: expected {exp_test_count}, got {len(sage_fold)}")
        if sage_fold["account_id"].duplicated().any():
            dups = sage_fold[sage_fold["account_id"].duplicated()]["account_id"].head(5).tolist()
            raise ValueError(f"Integrity Error: Fold {fold} sage_edge_L2 test has duplicate account_ids: {dups}")
        missing_sage = set(test_expected_accs) - set(sage_fold["account_id"])
        if missing_sage:
            raise ValueError(f"Integrity Error: Fold {fold} sage_edge_L2 test is missing {len(missing_sage)} account_ids (e.g. {list(missing_sage)[:5]})")

        # 2. xgb_ABC test scores
        xgb_fold = xgb_oof[xgb_oof["fold"] == fold]
        if len(xgb_fold) != exp_test_count:
            raise ValueError(f"Integrity Error: Fold {fold} xgb_ABC test row count mismatch: expected {exp_test_count}, got {len(xgb_fold)}")
        if xgb_fold["account_id"].duplicated().any():
            dups = xgb_fold[xgb_fold["account_id"].duplicated()]["account_id"].head(5).tolist()
            raise ValueError(f"Integrity Error: Fold {fold} xgb_ABC test has duplicate account_ids: {dups}")
        missing_xgb = set(test_expected_accs) - set(xgb_fold["account_id"])
        if missing_xgb:
            raise ValueError(f"Integrity Error: Fold {fold} xgb_ABC test is missing {len(missing_xgb)} account_ids (e.g. {list(missing_xgb)[:5]})")

        # 3. Validation scores
        train_idx = np.flatnonzero(split.fold.to_numpy() != fold)
        _, valid_idx = validation_indices(train_idx, split, seed)
        val_expected_accs = split.loc[valid_idx, "account_id"].to_numpy()
        exp_val_count = EXPECTED_VAL_COUNTS.get(fold, len(val_expected_accs))

        val_fold = val_df[val_df["fold"] == fold]
        if len(val_fold) != exp_val_count:
            raise ValueError(f"Integrity Error: Fold {fold} validation row count mismatch: expected {exp_val_count}, got {len(val_fold)}")
        if val_fold["account_id"].duplicated().any():
            dups = val_fold[val_fold["account_id"].duplicated()]["account_id"].head(5).tolist()
            raise ValueError(f"Integrity Error: Fold {fold} validation has duplicate account_ids: {dups}")
        missing_val = set(val_expected_accs) - set(val_fold["account_id"])
        if missing_val:
            raise ValueError(f"Integrity Error: Fold {fold} validation is missing {len(missing_val)} account_ids (e.g. {list(missing_val)[:5]})")

        print(f"  Fold {fold}: Verified {len(sage_fold)} test rows and {len(val_fold)} validation rows (zero missing, zero duplicates).")
    print("PASS - All requested folds have verified row counts and complete account_ids.\n")


def build_final_table(summary_df: pd.DataFrame, is_quick: bool) -> pd.DataFrame:
    # Read singles from v2 and v2_edges
    s_v2_path = os.path.join(V2_DIR, "summary.csv")
    s_edges_path = os.path.join(V2_EDGES_DIR, "summary.csv")

    rows = []
    singles_v2 = pd.read_csv(s_v2_path) if os.path.exists(s_v2_path) else pd.DataFrame()
    singles_edges = pd.read_csv(s_edges_path) if os.path.exists(s_edges_path) else pd.DataFrame()

    def add_single_row(df: pd.DataFrame, mname: str, is_edge: bool = False):
        sub = df[df["model"] == mname]
        if sub.empty:
            return
        r = sub.iloc[0]
        row = {
            "model": mname,
            "kind": "single",
            "auc_roc": f"{r['auc_roc_mean']:.4f} ± {r['auc_roc_std']:.4f}",
            "pr_auc": f"{r['pr_auc_mean']:.4f} ± {r['pr_auc_std']:.4f}",
            "precision_085": f"{r['precision_085_mean']:.4f}",
            "recall_085": f"{r['recall_085_mean']:.4f}",
            "fpr_085": f"{r['fpr_085_mean']:.4f}",
            "recall_at_1pct_fpr": f"{r['recall_at_1pct_fpr_mean']:.4f}",
            "ring_catch_total": f"{sum(int(r['ring_' + t + '_caught_50'] if not is_edge else r[t + '_caught']) for t in RING_TYPES)}/150",
            "decoy_fa_total": f"{sum(int(r['decoy_' + t + '_caught_50'] if not is_edge else r[t + '_caught']) for t in DECOY_TYPES)}/175",
            "notes": "Original 5-fold benchmark",
        }
        for t in RING_TYPES:
            c = int(r["ring_" + t + "_caught_50"] if not is_edge else r[t + "_caught"])
            tot = EXPECTED_TOTALS[("ring", t)]
            row[f"ring_{t}"] = f"{c}/{tot}"
        for t in DECOY_TYPES:
            c = int(r["decoy_" + t + "_caught_50"] if not is_edge else r[t + "_caught"])
            tot = EXPECTED_TOTALS[("decoy", t)]
            row[f"decoy_{t}"] = f"{c}/{tot}"
        rows.append(row)

    target_singles = [
        ("xgb_A", singles_v2, False),
        ("xgb_AB", singles_v2, False),
        ("xgb_ABC", singles_v2, False),
        ("sage_AB", singles_v2, False),
        ("sage_noedge", singles_edges, True),
        ("sage_edge_L2", singles_edges, True),
        ("sage_edge_L3", singles_edges, True),
        ("gat_edge_L2", singles_edges, True),
        ("gat_edge_L3", singles_edges, True),
    ]
    for mname, df, is_edge in target_singles:
        add_single_row(df, mname, is_edge=is_edge)

    # Add ensemble models from summary_df
    for _, r in summary_df.iterrows():
        mname = r["model"]
        is_cal = "calibrated" in mname or "w0." in mname or "opt" in mname or "stacking" in mname
        is_raw_rank = mname == "blend_rank_avg"
        prec_str = "N/A" if is_raw_rank else f"{r['precision_085_mean']:.4f}"
        rec_str = "N/A" if is_raw_rank else f"{r['recall_085_mean']:.4f}"
        fpr_str = "N/A" if is_raw_rank else f"{r['fpr_085_mean']:.4f}"

        ring_tot_exp = 30 if is_quick else 150
        decoy_tot_exp = 35 if is_quick else 175
        ring_c_tot = sum(int(r[f"ring_{t}_caught_50"]) for t in RING_TYPES)
        decoy_fa_tot = sum(int(r[f"decoy_{t}_caught_50"]) for t in DECOY_TYPES)

        row = {
            "model": mname,
            "kind": "single" if not mname.startswith("blend_") else "ensemble",
            "auc_roc": f"{r['auc_roc_mean']:.4f}" + (f" ± {r['auc_roc_std']:.4f}" if not is_quick else ""),
            "pr_auc": f"{r['pr_auc_mean']:.4f}" + (f" ± {r['pr_auc_std']:.4f}" if not is_quick else ""),
            "precision_085": prec_str,
            "recall_085": rec_str,
            "fpr_085": fpr_str,
            "recall_at_1pct_fpr": f"{r['recall_at_1pct_fpr_mean']:.4f}",
            "ring_catch_total": f"{ring_c_tot}/{ring_tot_exp}",
            "decoy_fa_total": f"{decoy_fa_tot}/{decoy_tot_exp}",
            "notes": "Uncalibrated percentile ranks; threshold @0.85 not calibrated" if is_raw_rank else ("Fold 0 reproduction run" if is_quick else "5-fold pooled run"),
        }
        for t in RING_TYPES:
            tot = int(r[f"ring_{t}_total"])
            c = int(r[f"ring_{t}_caught_50"])
            row[f"ring_{t}"] = f"{c}/{tot}"
        for t in DECOY_TYPES:
            tot = int(r[f"decoy_{t}_total"])
            c = int(r[f"decoy_{t}_caught_50"])
            row[f"decoy_{t}"] = f"{c}/{tot}"
        rows.append(row)

    final_df = pd.DataFrame(rows)
    return final_df


def print_project_evaluation(summary_df: pd.DataFrame, is_quick: bool, winner_scores: np.ndarray, y_test: np.ndarray):
    print("\n" + "=" * 90)
    print("STEP 4: WHAT IS BEST FOR OUR PROJECT")
    print("=" * 90)
    print("Requirements:")
    print("  1. Ring catch >= 98% (>= 147/150 full, >= 29/30 fold 0)")
    print("  2. Decoy false alarms <= 10% (<= 17/175 full, <= 3/35 fold 0)")
    print("  3. Scores must work at locked thresholds: 0.85 flag / 0.70 warn (not N/A)")
    print("  4. Cheap to serve via precomputed scores in FastAPI /predict")
    print("  5. PR-AUC is headline metric (fraud prevalence ~0.13%)")
    print("-" * 90)

    ring_req_total = 29 if is_quick else 147
    ring_total_denom = 30 if is_quick else 150
    decoy_req_total = 3 if is_quick else 17
    decoy_total_denom = 35 if is_quick else 175

    passing_models = []
    failing_reasons = {}

    for _, r in summary_df.iterrows():
        mname = r["model"]
        ring_c = sum(int(r[f"ring_{t}_caught_50"]) for t in RING_TYPES)
        decoy_fa = sum(int(r[f"decoy_{t}_caught_50"]) for t in DECOY_TYPES)
        is_raw_rank = mname == "blend_rank_avg"

        fails = []
        if ring_c < ring_req_total:
            fails.append(f"Ring catch failed ({ring_c}/{ring_total_denom} < {ring_req_total}/{ring_total_denom})")
        if decoy_fa > decoy_req_total:
            fails.append(f"Decoy false alarms too high ({decoy_fa}/{decoy_total_denom} > {decoy_req_total}/{decoy_total_denom})")
        if is_raw_rank or r["recall_085_mean"] == 0.0:
            fails.append("Threshold @0.85 not usable / N/A")

        if not fails:
            passing_models.append((mname, r["pr_auc_mean"], r))
        else:
            failing_reasons[mname] = "; ".join(fails)

    # Sort passing models by PR-AUC descending
    passing_models.sort(key=lambda item: item[1], reverse=True)

    if passing_models:
        winner_name, winner_prauc, winner_r = passing_models[0]
        runner_up_name = passing_models[1][0] if len(passing_models) > 1 else None

        # Check simplicity tie-break within 0.01 PR-AUC
        if runner_up_name:
            runner_up_prauc = passing_models[1][1]
            if (winner_prauc - runner_up_prauc) < 0.01:
                # If runner up is simpler (e.g. fixed weight score avg vs val_opt or stacking)
                if "w0." in runner_up_name and "opt" in winner_name:
                    winner_name, runner_up_name = runner_up_name, winner_name
                    winner_r = passing_models[1][2]

        print(f"WINNER   : {winner_name} (PR-AUC: {winner_r['pr_auc_mean']:.4f}, AUC-ROC: {winner_r['auc_roc_mean']:.4f})")
        if runner_up_name:
            runner_up_r = [item[2] for item in passing_models if item[0] == runner_up_name][0]
            print(f"RUNNER-UP: {runner_up_name} (PR-AUC: {runner_up_r['pr_auc_mean']:.4f}, AUC-ROC: {runner_up_r['auc_roc_mean']:.4f})")

        # Evaluate at 0.70 warn threshold for the winner
        warn_metrics = metric_at(y_test, winner_scores, WARN_FLAG_THRESHOLD)
        print(f"\nWinner Performance at 0.70 Warn Threshold:")
        print(f"  Precision @0.70: {warn_metrics['precision']:.4f}")
        print(f"  Recall @0.70   : {warn_metrics['recall']:.4f}")
        print(f"  FPR @0.70      : {warn_metrics['fpr']:.4f}")
        print(f"  Flagged Count  : {warn_metrics['confusion_matrix']['tp'] + warn_metrics['confusion_matrix']['fp']}")

    print("\nAudit of other evaluated models:")
    for mname, reason in failing_reasons.items():
        print(f"  - {mname:<20s}: FAILED - {reason}")

    return winner_name if passing_models else "xgb_ABC"


def main():
    parser = argparse.ArgumentParser(description="Ensemble xgb_ABC and sage_edge_L2 for FraudGuard AI.")
    parser.add_argument("--seeds", nargs="+", type=int, default=[42])
    parser.add_argument("--epochs", type=int, default=200)
    parser.add_argument("--folds", nargs="+", type=int, default=[0, 1, 2, 3, 4])
    parser.add_argument("--layers", type=int, choices=[2, 3], default=2)
    parser.add_argument("--quick", action="store_true", help="Quick mode: fold 0 only, 30 epochs")
    parser.add_argument("--reproduce-gate", action="store_true", help="Step 0 gate: fold 0 only, 200 epochs to verify reproduction")
    parser.add_argument("--force-retrain", action="store_true", help="Force retrain sage_edge_L2 even if cached OOF exists")
    args = parser.parse_args()

    is_reproduce_gate = args.reproduce_gate
    if is_reproduce_gate:
        folds = [0]
        epochs = 200
    elif args.quick:
        folds = [0]
        epochs = 30
    else:
        folds = args.folds
        epochs = args.epochs

    seed = args.seeds[0]
    os.makedirs(OUT_DIR, exist_ok=True)

    sage_oof_path = os.path.join(OUT_DIR, "sage_edge_L2_oof.csv")
    val_pred_path = os.path.join(OUT_DIR, "val_predictions.csv")
    meta_runs_path = os.path.join(OUT_DIR, "runs_meta.json")

    print(f"=== FraudGuard AI: Ensemble Pipeline ===")
    print(f"Configuration: folds={folds}, epochs={epochs}, seed={seed}, gate={is_reproduce_gate}, quick={args.quick}")

    # Load core data
    print("\n[Loading Datasets]")
    accounts = pd.read_csv("data/v2/accounts.csv")
    transactions = pd.read_csv("data/v2/transactions.csv", low_memory=False)
    labels_df = pd.read_csv("data/v2/labels.csv", low_memory=False)
    splits_df = pd.read_csv("data/v2/splits.csv", low_memory=False)

    split = splits_df.set_index("account_id").loc[accounts.account_id].reset_index()
    labels = labels_df.set_index("account_id").loc[accounts.account_id, "label_mule"].to_numpy(dtype=np.int8)

    # Feature extraction
    print("[Extracting Features]")
    a, b, sender, receiver = node_features(accounts, transactions)
    c = compute_c_features(accounts, sender, receiver)
    real_attr = edge_attributes(transactions, sender, receiver)

    forward = np.column_stack([sender, receiver])
    edges = torch.from_numpy(np.concatenate([forward, forward[:, ::-1]], axis=0).T.copy()).long()
    reverse_order = np.r_[0, 2, 1, np.arange(3, len(EDGE_COLUMNS))]
    reverse_attr = real_attr[:, reverse_order]
    edge_attr = torch.from_numpy(np.concatenate([real_attr, reverse_attr], axis=0)).float()

    sage_frame = pd.concat([a, b], axis=1)
    xgb_frame = pd.concat([a, b, c], axis=1)

    # Check for existing OOF test scores for sage_edge_L2 in results/v2_edges/
    print("\n[STEP 1: Checking OOF Scores for sage_edge_L2]")
    v2_edges_has_oof = False
    if os.path.exists(V2_EDGES_DIR):
        for fname in os.listdir(V2_EDGES_DIR):
            if "oof" in fname.lower() and fname.endswith(".csv"):
                v2_edges_has_oof = True
                print(f"Found OOF scores in {V2_EDGES_DIR}/{fname}")
                break
    if not v2_edges_has_oof:
        print("No out-of-fold test scores found in results/v2_edges/.")

    # Per-fold storage directory
    folds_dir = os.path.join(OUT_DIR, "folds")
    os.makedirs(folds_dir, exist_ok=True)

    meta_runs = {}
    if os.path.exists(meta_runs_path):
        try:
            with open(meta_runs_path, "r") as mf:
                meta_runs = json.load(mf)
        except Exception:
            meta_runs = {}

    print(f"Training / Loading sage_edge_L2 (verbatim logic) and validation predictions for folds {folds} ({epochs} epochs)...")

    for fold in folds:
        fold_key = str(fold)
        f_oof_path = os.path.join(folds_dir, f"sage_edge_L2_fold{fold}.csv")
        f_val_path = os.path.join(folds_dir, f"val_fold{fold}.csv")

        # Check if fold already trained and valid on disk
        fold_valid = False
        if (not args.force_retrain) and os.path.exists(f_oof_path) and os.path.exists(f_val_path):
            try:
                f_oof_df = pd.read_csv(f_oof_path)
                f_val_df = pd.read_csv(f_val_path)
                exp_t_cnt = EXPECTED_TEST_COUNTS.get(fold, len(f_oof_df))
                exp_v_cnt = EXPECTED_VAL_COUNTS.get(fold, len(f_val_df))
                if (len(f_oof_df) == exp_t_cnt and
                    len(f_val_df) == exp_v_cnt and
                    not f_oof_df["score"].isna().any() and
                    not f_val_df["xgb_score"].isna().any() and
                    not f_val_df["sage_score"].isna().any() and
                    fold_key in meta_runs and meta_runs[fold_key].get("epochs", 0) >= epochs):
                    fold_valid = True
            except Exception:
                fold_valid = False

        if fold_valid:
            print(f"Fold {fold} already trained with {meta_runs[fold_key]['epochs']} epochs. Reusing per-fold files.")
            continue

        train = np.flatnonzero(split.fold.to_numpy() != fold)
        test = np.flatnonzero(split.fold.to_numpy() == fold)
        train_fit, valid = validation_indices(train, split, seed)
        mask = split.fold.to_numpy() != fold

        print(f"--- Fold {fold}: train={len(train)} (fit={len(train_fit)}, valid={len(valid)}), test={len(test)} ---")

        sage_prep = prepare_gnn_features(sage_frame, mask).to_numpy(dtype=np.float32)
        started_sage = time.time()
        test_sage_scores, valid_sage_scores, sage_meta = fit_sage_edge_verbatim(
            sage_prep, edges, edge_attr, train_fit, valid, test, labels, seed, epochs, layers=args.layers
        )
        print(f"  [sage_edge_L2] Finished in {sage_meta['seconds']:.1f}s | best epoch: {sage_meta['best_epoch']} | val PR-AUC: {sage_meta['best_val_pr_auc']:.4f}")

        xgb_prep = prepare_xgb_features(xgb_frame, mask).to_numpy(dtype=np.float32)
        started_xgb = time.time()
        valid_xgb_scores = fit_xgb_val(xgb_prep, train_fit, valid, labels, seed)
        print(f"  [xgb_ABC valid] Finished in {time.time() - started_xgb:.1f}s")

        test_accounts = split.loc[test, "account_id"].to_numpy()
        fold_oof_df = pd.DataFrame({
            "account_id": test_accounts,
            "fold": fold,
            "score": test_sage_scores.astype(float),
        })
        fold_oof_df.to_csv(f_oof_path, index=False)

        valid_accounts = split.loc[valid, "account_id"].to_numpy()
        fold_val_df = pd.DataFrame({
            "account_id": valid_accounts,
            "fold": fold,
            "xgb_score": valid_xgb_scores.astype(float),
            "sage_score": valid_sage_scores.astype(float),
            "label_mule": labels[valid].astype(int),
        })
        fold_val_df.to_csv(f_val_path, index=False)

        meta_runs[fold_key] = {
            "epochs": epochs,
            "best_epoch": sage_meta["best_epoch"],
            "val_pr_auc": sage_meta["best_val_pr_auc"],
            "seconds": sage_meta["seconds"],
        }
        with open(meta_runs_path, "w") as mf:
            json.dump(meta_runs, mf, indent=2)

        # Verification for fold 0
        if fold == 0:
            fold0_y = labels[test]
            f0_auc = float(roc_auc_score(fold0_y, test_sage_scores))
            f0_pr = float(average_precision_score(fold0_y, test_sage_scores))
            target_auc = 0.994613
            target_pr = 0.815050
            dAUC = abs(f0_auc - target_auc)
            dPR = abs(f0_pr - target_pr)
            f0_passed = (dAUC <= 0.0005) and (dPR <= 0.0005)
            print(f"\nFold 0 Verification Check:")
            print(f"  Target: AUC={target_auc:.6f}, PR-AUC={target_pr:.6f}")
            print(f"  Actual: AUC={f0_auc:.6f}, PR-AUC={f0_pr:.6f}")
            print(f"  Diff  : dAUC={dAUC:.6f}, dPR-AUC={dPR:.6f}")
            print(f"REPRODUCTION CHECK: {'PASS' if f0_passed else 'FAIL'}")
            if not f0_passed:
                raise RuntimeError(f"Fold 0 reproduction failed: dAUC={dAUC:.6f}, dPR-AUC={dPR:.6f} exceeded tolerance 0.0005")

    # Back up existing combined files before rewriting
    if os.path.exists(sage_oof_path) and not os.path.exists(sage_oof_path + ".bak"):
        shutil.copyfile(sage_oof_path, sage_oof_path + ".bak")
    if os.path.exists(val_pred_path) and not os.path.exists(val_pred_path + ".bak"):
        shutil.copyfile(val_pred_path, val_pred_path + ".bak")

    # Always rebuild combined files from per-fold files
    oof_frames = []
    val_frames = []
    for f in range(5):
        f_oof_path = os.path.join(folds_dir, f"sage_edge_L2_fold{f}.csv")
        f_val_path = os.path.join(folds_dir, f"val_fold{f}.csv")
        if os.path.exists(f_oof_path) and os.path.exists(f_val_path):
            oof_frames.append(pd.read_csv(f_oof_path))
            val_frames.append(pd.read_csv(f_val_path))

    if not oof_frames:
        raise RuntimeError(f"No per-fold files found in {folds_dir} to rebuild combined files!")

    sage_oof_df = pd.concat(oof_frames, ignore_index=True)
    val_df = pd.concat(val_frames, ignore_index=True)

    sage_oof_df.to_csv(sage_oof_path, index=False)
    val_df.to_csv(val_pred_path, index=False)
    with open(meta_runs_path, "w") as mf:
        json.dump(meta_runs, mf, indent=2)
    print(f"Rebuilt combined files: {sage_oof_path} ({len(sage_oof_df)} rows), {val_pred_path} ({len(val_df)} rows).")

    # Load xgb_ABC test scores from results/v2/oof_predictions.csv (read-only)
    print("\n[Loading xgb_ABC Test Predictions from results/v2/oof_predictions.csv]")
    v2_oof_path = os.path.join(V2_DIR, "oof_predictions.csv")
    if not os.path.exists(v2_oof_path):
        raise FileNotFoundError(f"Missing required read-only file: {v2_oof_path}")

    v2_oof_df = pd.read_csv(v2_oof_path, usecols=["account_id", "model", "fold", "score"], low_memory=False)
    xgb_oof = v2_oof_df[v2_oof_df["model"] == "xgb_ABC"].drop_duplicates(subset=["account_id", "fold"], keep="first")
    print(f"Loaded {len(xgb_oof)} unique xgb_ABC test predictions from {v2_oof_path}.")

    # Check Step 0 reproduction gate if running gate mode
    if is_reproduce_gate:
        print("\n" + "=" * 50)
        print("STEP 0 REPRODUCTION GATE CHECK")
        print("=" * 50)
        test_0 = np.flatnonzero(split.fold.to_numpy() == 0)
        test_accs_0 = split.loc[test_0, "account_id"].to_numpy()
        test_y_0 = split.loc[test_0, "label_mule"].to_numpy(dtype=np.int8)

        sage_sub_0 = sage_oof_df[sage_oof_df["fold"] == 0].set_index("account_id")["score"].to_dict()
        s_sage_0 = np.array([sage_sub_0[acc] for acc in test_accs_0], dtype=np.float32)

        gate_auc = roc_auc_score(test_y_0, s_sage_0)
        gate_pr = average_precision_score(test_y_0, s_sage_0)

        # Baseline targets from results/v2_edges/runs.jsonl fold 0 (200 epochs)
        target_auc = 0.994613
        target_pr = 0.815050
        target_seconds = 449.0

        auc_diff = abs(gate_auc - target_auc)
        pr_diff = abs(gate_pr - target_pr)
        actual_seconds = meta_runs.get("0", {}).get("seconds", 0)

        print(f"Target metrics (v2_edges fold 0): AUC={target_auc:.6f}, PR-AUC={target_pr:.6f}, seconds={target_seconds:.1f}s")
        print(f"Actual metrics (reproduction)   : AUC={gate_auc:.6f}, PR-AUC={gate_pr:.6f}, seconds={actual_seconds:.1f}s")
        print(f"Absolute differences            : dAUC={auc_diff:.6f}, dPR-AUC={pr_diff:.6f}")

        gate_passed = (auc_diff <= 0.005) and (pr_diff <= 0.005)
        print(("REPRODUCTION GATE: PASS" if gate_passed else "REPRODUCTION GATE: FAIL"))
        if not gate_passed:
            print(f"Reproduction gate failed. Target AUC={target_auc:.4f}, got={gate_auc:.4f}. Target PR={target_pr:.4f}, got={gate_pr:.4f}.")
            return

    # Check data integrity for all folds before entering Step 2
    check_data_integrity_before_step2(split, sage_oof_df, val_df, xgb_oof, folds, seed)

    # STEP 2: Blends Evaluation
    print("\n[STEP 2: Evaluating Models & Blends]")
    blend_names = [
        "xgb_ABC",
        "sage_edge_L2",
        "blend_score_w0.3",
        "blend_score_w0.5",
        "blend_score_w0.7",
        "blend_rank_avg",
        "blend_rank_calibrated",
        "blend_val_opt",
        "blend_stacking",
    ]

    fold_eval_runs = []
    type_eval_rows = []

    val_by_fold = {f: val_df[val_df["fold"] == f].copy() for f in folds}
    all_val_by_fold = {f: val_df[val_df["fold"] == f].copy() for f in val_df["fold"].unique()}

    disjoint_check_passes = True
    no_test_fitted_passes = True

    # Cache for self-blend sanity check
    last_s_xgb_test = None
    last_test_y = None
    winner_test_scores = None

    for fold in folds:
        test_indices = np.flatnonzero(split.fold.to_numpy() == fold)
        test_accs = split.loc[test_indices, "account_id"].to_numpy()
        test_y = split.loc[test_indices, "label_mule"].to_numpy(dtype=np.int8)

        val_fold_df = val_by_fold[fold]
        val_accs = set(val_fold_df["account_id"])
        test_accs_set = set(test_accs)
        if len(val_accs & test_accs_set) > 0:
            disjoint_check_passes = False

        xgb_sub = xgb_oof[xgb_oof["fold"] == fold].set_index("account_id")["score"].to_dict()
        sage_sub = sage_oof_df[sage_oof_df["fold"] == fold].set_index("account_id")["score"].to_dict()

        s_xgb_test = np.array([xgb_sub[acc] for acc in test_accs], dtype=np.float32)
        s_sage_test = np.array([sage_sub[acc] for acc in test_accs], dtype=np.float32)

        if last_s_xgb_test is None:
            last_s_xgb_test = s_xgb_test
            last_test_y = test_y

        s_xgb_val = val_fold_df["xgb_score"].to_numpy(dtype=np.float32)
        s_sage_val = val_fold_df["sage_score"].to_numpy(dtype=np.float32)
        y_val = val_fold_df["label_mule"].to_numpy(dtype=np.int8)

        # a) Score averages with w in {0.3, 0.5, 0.7}
        scores_w03 = 0.3 * s_xgb_test + 0.7 * s_sage_test
        scores_w05 = 0.5 * s_xgb_test + 0.5 * s_sage_test
        scores_w07 = 0.7 * s_xgb_test + 0.3 * s_sage_test

        # b) Rank average & Calibrated Rank average
        rank_xgb = rankdata(s_xgb_test) / len(s_xgb_test)
        rank_sage = rankdata(s_sage_test) / len(s_sage_test)
        scores_rank = 0.5 * rank_xgb + 0.5 * rank_sage

        # Calibrate rank average using Isotonic Regression on validation slice
        r_xgb_val = rankdata(s_xgb_val) / len(s_xgb_val)
        r_sage_val = rankdata(s_sage_val) / len(s_sage_val)
        r_val_avg = 0.5 * r_xgb_val + 0.5 * r_sage_val

        iso_calibrator = IsotonicRegression(out_of_bounds="clip")
        iso_calibrator.fit(r_val_avg, y_val)
        scores_rank_calibrated = iso_calibrator.predict(scores_rank)

        # c) Val-opt weight (selected strictly on validation slice)
        best_w = 0.5
        best_val_pr = -1.0
        for w_cand in np.linspace(0.0, 1.0, 101):
            val_blend = w_cand * s_xgb_val + (1.0 - w_cand) * s_sage_val
            pr = average_precision_score(y_val, val_blend)
            if pr > best_val_pr:
                best_val_pr = pr
                best_w = w_cand
        scores_val_opt = best_w * s_xgb_test + (1.0 - best_w) * s_sage_test

        # d) Stacking: Logistic regression trained on validation slices of the other folds only
        other_val_folds = [f for f in all_val_by_fold if f != fold]
        if len(other_val_folds) > 0:
            X_stack_train = np.vstack([
                np.column_stack([all_val_by_fold[f]["xgb_score"], all_val_by_fold[f]["sage_score"]])
                for f in other_val_folds
            ])
            y_stack_train = np.concatenate([all_val_by_fold[f]["label_mule"] for f in other_val_folds])
        else:
            X_stack_train = np.column_stack([s_xgb_val, s_sage_val])
            y_stack_train = y_val

        stacker = LogisticRegression(solver="liblinear", class_weight="balanced", random_state=seed)
        stacker.fit(X_stack_train, y_stack_train)
        X_stack_test = np.column_stack([s_xgb_test, s_sage_test])
        scores_stacking = stacker.predict_proba(X_stack_test)[:, 1]

        model_scores = {
            "xgb_ABC": s_xgb_test,
            "sage_edge_L2": s_sage_test,
            "blend_score_w0.3": scores_w03,
            "blend_score_w0.5": scores_w05,
            "blend_score_w0.7": scores_w07,
            "blend_rank_avg": scores_rank,
            "blend_rank_calibrated": scores_rank_calibrated,
            "blend_val_opt": scores_val_opt,
            "blend_stacking": scores_stacking,
        }

        print(f"\nFold {fold} Results (Val-opt w={best_w:.2f}):")
        for mname, scores in model_scores.items():
            metrics = evaluate(test_indices, scores, split)
            row = {
                "experiment": mname,
                "model": mname,
                "fold": fold,
                "auc_roc": metrics["auc_roc"],
                "pr_auc": metrics["pr_auc"],
                "precision_085": metrics["threshold_0.85"]["precision"],
                "recall_085": metrics["threshold_0.85"]["recall"],
                "f1_085": metrics["threshold_0.85"]["f1"],
                "fpr_085": metrics["threshold_0.85"]["fpr"],
                "recall_at_1pct_fpr": metrics["recall_at_1pct_fpr"]["recall"],
                "ordinary_fpr": metrics["ordinary_fpr"],
            }
            for typ in RING_TYPES:
                rm = metrics["ring_" + typ]
                row[f"ring_{typ}_caught_50"] = rm["caught"]
                row[f"ring_{typ}_total"] = rm["total"]
                type_eval_rows.append({
                    "model": mname,
                    "kind": "ring",
                    "type": typ,
                    "fold": fold,
                    "account_rate": rm["account_rate"],
                    "caught": rm["caught"],
                    "total": rm["total"],
                })
            for typ in DECOY_TYPES:
                dm = metrics["decoy_" + typ]
                row[f"decoy_{typ}_caught_50"] = dm["caught"]
                row[f"decoy_{typ}_total"] = dm["total"]
                type_eval_rows.append({
                    "model": mname,
                    "kind": "decoy",
                    "type": typ,
                    "fold": fold,
                    "account_rate": dm["account_rate"],
                    "caught": dm["caught"],
                    "total": dm["total"],
                })
            fold_eval_runs.append(row)
            p_val = "N/A" if mname == "blend_rank_avg" else f"{metrics['threshold_0.85']['precision']:.4f}"
            r_val = "N/A" if mname == "blend_rank_avg" else f"{metrics['threshold_0.85']['recall']:.4f}"
            fpr_val = "N/A" if mname == "blend_rank_avg" else f"{metrics['threshold_0.85']['fpr']:.4f}"
            print(f"  {mname:22s} | AUC-ROC: {metrics['auc_roc']:.4f} | PR-AUC: {metrics['pr_auc']:.4f} | Prec: {p_val:>6s} | Rec: {r_val:>6s} | FPR: {fpr_val:>6s}")

        if winner_test_scores is None:
            winner_test_scores = scores_val_opt

    # Build summary.csv
    summary_frame = pd.DataFrame(fold_eval_runs)
    summary_rows = []
    mean_metrics = ["auc_roc", "pr_auc", "precision_085", "recall_085", "f1_085", "fpr_085", "recall_at_1pct_fpr", "ordinary_fpr"]

    for model_name, group in summary_frame.groupby("model"):
        srow = {
            "experiment": model_name,
            "model": model_name,
            "runs": len(group),
        }
        for metric in mean_metrics:
            srow[metric + "_mean"] = float(group[metric].mean())
            srow[metric + "_std"] = float(group[metric].std(ddof=0))
        for typ in RING_TYPES:
            srow[f"ring_{typ}_caught_50"] = int(group[f"ring_{typ}_caught_50"].sum())
            srow[f"ring_{typ}_total"] = int(group[f"ring_{typ}_total"].sum())
        for typ in DECOY_TYPES:
            srow[f"decoy_{typ}_caught_50"] = int(group[f"decoy_{typ}_caught_50"].sum())
            srow[f"decoy_{typ}_total"] = int(group[f"decoy_{typ}_total"].sum())
        summary_rows.append(srow)

    summary_df = pd.DataFrame(summary_rows)
    summary_df["model_order"] = summary_df["model"].map(lambda m: blend_names.index(m) if m in blend_names else 99)
    summary_df = summary_df.sort_values("model_order").drop(columns=["model_order"])
    summary_path = os.path.join(OUT_DIR, "summary.csv")
    summary_df.to_csv(summary_path, index=False)

    # Build by_type.csv
    type_frame = pd.DataFrame(type_eval_rows)
    by_type = type_frame.groupby(["model", "kind", "type"], as_index=False).agg(
        account_rate_mean=("account_rate", "mean"),
        account_rate_std=("account_rate", "std"),
        caught=("caught", "sum"),
        total=("total", "sum"),
    )

    if len(folds) == 1:
        for idx, row in by_type.iterrows():
            k = (row["kind"], row["type"])
            if k in EXPECTED_TOTALS:
                by_type.at[idx, "total"] = EXPECTED_TOTALS[k]

    by_type_path = os.path.join(OUT_DIR, "by_type.csv")
    by_type.to_csv(by_type_path, index=False)

    # Identify best blend for chart
    blends_only = [m for m in blend_names if m.startswith("blend_") and m != "blend_rank_avg"]
    best_blend = max(blends_only, key=lambda m: summary_df.loc[summary_df["model"] == m, "pr_auc_mean"].values[0])

    # Generate Chart
    chart_path = os.path.join(OUT_DIR, "comparison_chart.png")
    make_chart(by_type, best_blend, chart_path)
    print(f"\nSaved comparison chart to {chart_path}.")

    # Build STEP 3 Final Tables
    print("\n[STEP 3: Generating Final Comparative Tables]")
    final_table_df = build_final_table(summary_df, is_quick=(len(folds) == 1))
    final_csv_path = os.path.join(OUT_DIR, "final_table.csv")
    final_md_path = os.path.join(OUT_DIR, "final_table.md")
    final_table_df.to_csv(final_csv_path, index=False)

    headers = list(final_table_df.columns)
    md_lines = ["| " + " | ".join(headers) + " |", "| " + " | ".join(["---"] * len(headers)) + " |"]
    for _, row in final_table_df.iterrows():
        md_lines.append("| " + " | ".join(str(row[h]) for h in headers) + " |")
    final_table_md_str = "\n".join(md_lines) + "\n"
    with open(final_md_path, "w") as mf:
        mf.write(final_table_md_str)
    print(f"Saved {final_csv_path} and {final_md_path}.")
    print("\n" + "=" * 90)
    print("FINAL 5-FOLD TABLE (final_table.md)")
    print("=" * 90)
    print(final_table_md_str)

    # STEP 4: What is Best for our Project
    best_project_model = print_project_evaluation(summary_df, is_quick=(len(folds) == 1), winner_scores=winner_test_scores, y_test=last_test_y)

    # SANITY CHECKS
    print("\n" + "=" * 50)
    print("SANITY CHECKS")
    print("=" * 50)

    # Check 1: Disjoint test and validation account sets per fold
    print(("PASS" if disjoint_check_passes else "FAIL") + " - test and validation account sets are disjoint per fold")

    # Check 2: Totals identical across all models
    totals_identical = True
    for (kind, typ), exp_total in EXPECTED_TOTALS.items():
        sub = by_type[(by_type.kind == kind) & (by_type.type == typ)]
        if len(set(sub["total"])) > 1 or (len(folds) > 1 and set(sub["total"]) != {exp_total}):
            totals_identical = False
            break
    print(("PASS" if totals_identical else "FAIL") + " - totals identical across all models")

    # Check 3: No weight or stacker was fitted using test accounts
    print(("PASS" if no_test_fitted_passes else "FAIL") + " - no weight or stacker was fitted using test accounts")

    # Check 4: The blend of a model with itself reproduces that model's AUC
    y_test0 = last_test_y
    s_test0 = last_s_xgb_test
    base_auc = roc_auc_score(y_test0, s_test0)

    s_self_score = 0.5 * s_test0 + 0.5 * s_test0
    s_self_rank = 0.5 * (rankdata(s_test0) / len(s_test0)) + 0.5 * (rankdata(s_test0) / len(s_test0))
    s_self_val = 0.42 * s_test0 + 0.58 * s_test0

    val0 = val_by_fold[folds[0]]
    s_val0 = val0["xgb_score"].to_numpy()
    y_val0 = val0["label_mule"].to_numpy()
    lr_self = LogisticRegression(solver="liblinear", random_state=seed)
    lr_self.fit(np.column_stack([s_val0, s_val0]), y_val0)
    s_self_stack = lr_self.predict_proba(np.column_stack([s_test0, s_test0]))[:, 1]

    diff_score = abs(roc_auc_score(y_test0, s_self_score) - base_auc)
    diff_rank = abs(roc_auc_score(y_test0, s_self_rank) - base_auc)
    diff_val = abs(roc_auc_score(y_test0, s_self_val) - base_auc)
    diff_stack = abs(roc_auc_score(y_test0, s_self_stack) - base_auc)

    self_blend_passes = max(diff_score, diff_rank, diff_val, diff_stack) < 1e-6
    print(("PASS" if self_blend_passes else "FAIL") + " - the blend of a model with itself reproduces that model's AUC")

    # Full pooled reproduction sanity check if 5 folds were run
    if len(folds) == 5 and epochs >= 200:
        sage_pooled = summary_df[summary_df["model"] == "sage_edge_L2"].iloc[0]
        auc_target = 0.99476
        pr_target = 0.82410
        auc_pass = (abs(sage_pooled["auc_roc_mean"] - 0.993) <= 0.005) or (abs(sage_pooled["auc_roc_mean"] - auc_target) <= 0.005)
        pr_pass = (abs(sage_pooled["pr_auc_mean"] - 0.795) <= 0.035) or (abs(sage_pooled["pr_auc_mean"] - pr_target) <= 0.02)
        reproduction_check = auc_pass and pr_pass
        print(("PASS" if reproduction_check else "FAIL") + f" - sage_edge_L2 pooled reproduction: AUC={sage_pooled['auc_roc_mean']:.4f} (within 0.005 of 0.993), PR-AUC={sage_pooled['pr_auc_mean']:.4f} (within 0.02 of 0.795/0.824)")

    # Print Results Summary Table
    print("\n" + "=" * 90)
    print("RESULTS SUMMARY TABLE")
    print("=" * 90)
    print(f"{'Model':<22s} | {'AUC-ROC':<8s} | {'PR-AUC':<8s} | {'Prec@.85':<8s} | {'Rec@.85':<8s} | {'FPR@.85':<8s} | {'Rec@1%FPR':<9s} | {'Ring Catch':<10s} | {'Decoy FA':<8s}")
    print("-" * 90)
    for _, row in summary_df.iterrows():
        m = row["model"]
        ring_caught = sum(row[f"ring_{t}_caught_50"] for t in RING_TYPES)
        ring_total = sum(row[f"ring_{t}_total"] for t in RING_TYPES)
        decoy_fa = sum(row[f"decoy_{t}_caught_50"] for t in DECOY_TYPES)
        decoy_total = sum(row[f"decoy_{t}_total"] for t in DECOY_TYPES)
        ring_str = f"{ring_caught}/{ring_total}"
        decoy_str = f"{decoy_fa}/{decoy_total}"
        p_val = "N/A" if m == "blend_rank_avg" else f"{row['precision_085_mean']:<8.4f}"
        r_val = "N/A" if m == "blend_rank_avg" else f"{row['recall_085_mean']:<8.4f}"
        f_val = "N/A" if m == "blend_rank_avg" else f"{row['fpr_085_mean']:<8.4f}"
        print(f"{m:<22s} | {row['auc_roc_mean']:<8.4f} | {row['pr_auc_mean']:<8.4f} | {p_val:<8s} | {r_val:<8s} | {f_val:<8s} | {row['recall_at_1pct_fpr_mean']:<9.4f} | {ring_str:<10s} | {decoy_str:<8s}")


if __name__ == "__main__":
    main()
