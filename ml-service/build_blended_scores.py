#!/usr/bin/env python3
"""Build and verify precomputed blended scores table for FraudGuard AI.

Calculates risk_score = W_XGB * xgb_score + W_SAGE * sage_score
Saves to artifacts/blended_scores.csv.
"""

import os
import sys
import pandas as pd
import numpy as np
from sklearn.metrics import roc_auc_score, average_precision_score, confusion_matrix, precision_score, recall_score

from config import (
    W_XGB,
    W_SAGE,
    FLAG_THRESHOLD,
    WARN_THRESHOLD,
    ARTIFACTS_DIR,
    BLENDED_SCORES_PATH,
    LABELS_CSV_PATH,
    SAGE_OOF_PATH,
    V2_OOF_PATH,
)

EXPECTED_COUNT = 893216


def build_and_verify():
    print("=" * 80)
    print("STEP 1: BUILDING BLENDED PRECOMPUTED SCORES TABLE")
    print(f"Weights: W_XGB={W_XGB}, W_SAGE={W_SAGE}")
    print(f"Thresholds: FLAG={FLAG_THRESHOLD}, WARN={WARN_THRESHOLD}")
    print("=" * 80)

    # 1. Check inputs exist
    if not os.path.exists(SAGE_OOF_PATH):
        raise FileNotFoundError(f"Missing required input: {SAGE_OOF_PATH}")
    if not os.path.exists(V2_OOF_PATH):
        raise FileNotFoundError(f"Missing required input: {V2_OOF_PATH}")
    if not os.path.exists(LABELS_CSV_PATH):
        raise FileNotFoundError(f"Missing required input: {LABELS_CSV_PATH}")

    # 2. Load sage_edge_L2 OOF predictions
    print(f"Loading sage_edge_L2 predictions from {SAGE_OOF_PATH}...")
    sage_df = pd.read_csv(SAGE_OOF_PATH, usecols=["account_id", "fold", "score"])
    print(f"Loaded {len(sage_df)} rows for sage_edge_L2.")

    # 3. Load xgb_ABC predictions from v2 oof_predictions.csv
    print(f"Loading xgb_ABC predictions from {V2_OOF_PATH}...")
    v2_df = pd.read_csv(V2_OOF_PATH, usecols=["account_id", "model", "fold", "score"], low_memory=False)
    xgb_df = v2_df[v2_df["model"] == "xgb_ABC"].copy()
    xgb_df = xgb_df.drop_duplicates(subset=["account_id", "fold"], keep="first")
    print(f"Loaded {len(xgb_df)} unique xgb_ABC predictions.")

    # 4. Check duplicates in individual datasets
    if sage_df["account_id"].duplicated().any():
        dups = sage_df[sage_df["account_id"].duplicated()]["account_id"].head(5).tolist()
        raise ValueError(f"Duplicate account_ids found in sage_edge_L2: {dups}")
    if xgb_df["account_id"].duplicated().any():
        dups = xgb_df[xgb_df["account_id"].duplicated()]["account_id"].head(5).tolist()
        raise ValueError(f"Duplicate account_ids found in xgb_ABC: {dups}")

    # 5. Merge on account_id
    print("Joining sage_edge_L2 and xgb_ABC on account_id...")
    merged = pd.merge(
        xgb_df[["account_id", "score"]].rename(columns={"score": "xgb_score"}),
        sage_df[["account_id", "score"]].rename(columns={"score": "sage_score"}),
        on="account_id",
        how="inner",
    )
    print(f"Joined table contains {len(merged)} rows.")

    # 6. Verify row count and fail loudly on any discrepancy
    if len(merged) != EXPECTED_COUNT:
        raise ValueError(f"Row count mismatch: expected {EXPECTED_COUNT}, got {len(merged)}")
    if merged["xgb_score"].isna().any():
        raise ValueError(f"Found {merged['xgb_score'].isna().sum()} NaN values in xgb_score!")
    if merged["sage_score"].isna().any():
        raise ValueError(f"Found {merged['sage_score'].isna().sum()} NaN values in sage_score!")

    # 7. Compute blended risk_score
    print("Computing blended risk_score...")
    merged["risk_score"] = W_XGB * merged["xgb_score"] + W_SAGE * merged["sage_score"]

    if merged["risk_score"].isna().any():
        raise ValueError("Computed risk_score contains NaNs!")

    # 8. Save artifacts/blended_scores.csv
    os.makedirs(ARTIFACTS_DIR, exist_ok=True)
    out_df = merged[["account_id", "xgb_score", "sage_score", "risk_score"]]
    out_df.to_csv(BLENDED_SCORES_PATH, index=False)
    print(f"Saved {BLENDED_SCORES_PATH} ({len(out_df)} rows).")

    # 9. Verifications
    print("\n" + "=" * 80)
    print("VERIFICATION & METRICS AUDIT")
    print("=" * 80)

    # a) Row count, uniqueness, NaNs, range [0, 1]
    count_ok = len(out_df) == EXPECTED_COUNT
    unique_ok = out_df["account_id"].nunique() == EXPECTED_COUNT
    no_nan_ok = not out_df.isna().any().any()
    range_ok = (
        (out_df["xgb_score"].min() >= 0.0)
        and (out_df["xgb_score"].max() <= 1.0)
        and (out_df["sage_score"].min() >= 0.0)
        and (out_df["sage_score"].max() <= 1.0)
        and (out_df["risk_score"].min() >= 0.0)
        and (out_df["risk_score"].max() <= 1.0)
    )
    test_a_pass = count_ok and unique_ok and no_nan_ok and range_ok

    print(f"Check (a) Row count & data integrity:")
    print(f"  - Total rows : {len(out_df):,} (expected {EXPECTED_COUNT:,})")
    print(f"  - Unique IDs : {out_df['account_id'].nunique():,}")
    print(f"  - NaNs       : {out_df.isna().sum().to_dict()}")
    print(f"  - Score range: [{out_df['risk_score'].min():.4f}, {out_df['risk_score'].max():.4f}]")
    print(f"  -> CHECK (a): {'PASS' if test_a_pass else 'FAIL'}")

    # Load labels
    labels_df = pd.read_csv(LABELS_CSV_PATH, low_memory=False).set_index("account_id")
    y_true = labels_df.loc[out_df["account_id"], "label_mule"].to_numpy(dtype=np.int8)
    risk_scores = out_df["risk_score"].to_numpy(dtype=np.float64)

    # b) Pooled AUC and PR-AUC
    pooled_auc = float(roc_auc_score(y_true, risk_scores))
    pooled_pr_auc = float(average_precision_score(y_true, risk_scores))

    # Expected: AUC 0.9944 +/- 0.0005, PR-AUC 0.8185 +/- 0.002
    auc_diff = abs(pooled_auc - 0.9944)
    pr_diff = abs(pooled_pr_auc - 0.8185)
    test_b_pass = (auc_diff <= 0.0005) and (pr_diff <= 0.002)

    print(f"\nCheck (b) Pooled AUC and PR-AUC against ensemble run:")
    print(f"  - Pooled AUC-ROC : {pooled_auc:.6f} (target 0.9944 ± 0.0005, diff {auc_diff:.6f})")
    print(f"  - Pooled PR-AUC  : {pooled_pr_auc:.6f} (target 0.8185 ± 0.0020, diff {pr_diff:.6f})")
    print(f"  -> CHECK (b): {'PASS' if test_b_pass else 'FAIL'}")

    # c) Performance at 0.85 flag threshold
    flags_085 = (risk_scores >= FLAG_THRESHOLD).astype(np.int8)
    tn_085, fp_085, fn_085, tp_085 = confusion_matrix(y_true, flags_085, labels=[0, 1]).ravel()
    prec_085 = float(precision_score(y_true, flags_085, zero_division=0))
    rec_085 = float(recall_score(y_true, flags_085, zero_division=0))
    fpr_085 = float(fp_085 / (fp_085 + tn_085))

    test_c_pass = (abs(prec_085 - 0.436) <= 0.015) and (abs(rec_085 - 0.874) <= 0.015)
    print(f"\nCheck (c) Locked 0.85 Flag Threshold (5-fold pooled):")
    print(f"  - Precision @0.85: {prec_085:.4f} (target ~0.436)")
    print(f"  - Recall @0.85   : {rec_085:.4f} (target ~0.874)")
    print(f"  - FPR @0.85      : {fpr_085:.4f}")
    print(f"  - Flagged count  : {tp_085 + fp_085:,} (TP={tp_085:,}, FP={fp_085:,}, FN={fn_085:,}, TN={tn_085:,})")
    print(f"  -> CHECK (c): {'PASS' if test_c_pass else 'FAIL'}")

    # d) Re-evaluated 5-fold pooled 0.70 Warn Threshold and risk bands
    flags_070 = (risk_scores >= WARN_THRESHOLD).astype(np.int8)
    tn_070, fp_070, fn_070, tp_070 = confusion_matrix(y_true, flags_070, labels=[0, 1]).ravel()
    prec_070 = float(precision_score(y_true, flags_070, zero_division=0))
    rec_070 = float(recall_score(y_true, flags_070, zero_division=0))
    fpr_070 = float(fp_070 / (fp_070 + tn_070))
    flagged_070 = tp_070 + fp_070

    # Risk bands
    band_low = int((risk_scores < WARN_THRESHOLD).sum())
    band_warn = int(((risk_scores >= WARN_THRESHOLD) & (risk_scores < FLAG_THRESHOLD)).sum())
    band_flag = int((risk_scores >= FLAG_THRESHOLD).sum())

    print(f"\nCheck (d) Re-evaluated 0.70 Warn Threshold & Risk Bands (5-fold pooled):")
    print(f"  - Precision @0.70: {prec_070:.4f}")
    print(f"  - Recall @0.70   : {rec_070:.4f}")
    print(f"  - FPR @0.70      : {fpr_070:.4f}")
    print(f"  - Flagged count  : {flagged_070:,} (TP={tp_070:,}, FP={fp_070:,})")
    print(f"  - Risk bands:")
    print(f"    * Below 0.70 (LOW)       : {band_low:,} accounts ({band_low / EXPECTED_COUNT * 100:.2f}%)")
    print(f"    * [0.70, 0.85) (HIGH/WARN): {band_warn:,} accounts ({band_warn / EXPECTED_COUNT * 100:.2f}%)")
    print(f"    * >= 0.85 (CRITICAL/FLAG): {band_flag:,} accounts ({band_flag / EXPECTED_COUNT * 100:.2f}%)")
    print(f"    * Sum across bands       : {band_low + band_warn + band_flag:,} (must equal {EXPECTED_COUNT:,})")
    bands_ok = (band_low + band_warn + band_flag) == EXPECTED_COUNT
    print(f"  -> CHECK (d): {'PASS' if bands_ok else 'FAIL'}")

    all_passed = test_a_pass and test_b_pass and test_c_pass and bands_ok
    print("\n" + "=" * 80)
    print(f"OVERALL STEP 1 STATUS: {'ALL VERIFICATIONS PASSED' if all_passed else 'FAILED'}")
    print("=" * 80)

    if not all_passed:
        sys.exit(1)


if __name__ == "__main__":
    build_and_verify()
