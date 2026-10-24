#!/usr/bin/env python3
"""Benchmark Timing Script for FraudGuard AI Layer-3 Agent Investigation Service.

Measures flag-to-agent-decision turnaround time across a representative batch
of accounts (mule rings, look-alike decoys, and borderline anomalies).
Outputs latency metrics (Median, P95, Min, Max, Average) and compares against
the 20-30 minute human analyst baseline for Member B.
"""

import sys
import time
import json
import statistics
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

BENCHMARK_ACCOUNTS = [
    # 1. Real Mule Syndicates (Critical)
    "C1000039615",
    "acc_chain_016_4",
    "acc_mule_chain_01",
    "acc_star_burst_02",
    
    # 2. Innocent Decoy Look-alikes (Over-flagged by Layer 1, cleared by Layer 3)
    "acc_decoy_family_01",
    "acc_decoy_merchant_03",
    "acc_decoy_forward_02",
    "acc_decoy_payroll_04",
    
    # 3. Borderline & Benign Accounts
    "acc_suspicious_device_04",
    "C1001991700",
    "acc_legit_retail_03"
]

def run_benchmark():
    print("=" * 80)
    print("FRAUDGUARD AI — AGENT PIPELINE TIMING BENCHMARK (MEMBER C)")
    print("Benchmarking Flag-to-Agent-Decision Latency")
    print(f"Target Service Endpoint: POST /investigate (App version 2.0.0)")
    print("=" * 80)

    durations = []
    results = []

    for idx, acc_id in enumerate(BENCHMARK_ACCOUNTS, 1):
        print(f"[{idx}/{len(BENCHMARK_ACCOUNTS)}] Investigating account: {acc_id:<26} ... ", end="", flush=True)
        start_t = time.perf_counter()
        
        try:
            resp = client.post("/investigate", json={"account_id": acc_id})
            duration_s = time.perf_counter() - start_t
            durations.append(duration_s)
            
            if resp.status_code == 200:
                data = resp.json()
                decision = data.get("decision", "unknown").upper()
                print(f"DONE in {duration_s:.2f}s -> Decision: {decision}")
                results.append({
                    "account_id": acc_id,
                    "status_code": resp.status_code,
                    "duration_seconds": round(duration_s, 3),
                    "decision": decision
                })
            else:
                print(f"FAILED (HTTP {resp.status_code}) in {duration_s:.2f}s")
                results.append({
                    "account_id": acc_id,
                    "status_code": resp.status_code,
                    "duration_seconds": round(duration_s, 3),
                    "error": resp.text
                })
        except Exception as e:
            duration_s = time.perf_counter() - start_t
            durations.append(duration_s)
            print(f"ERROR ({e}) in {duration_s:.2f}s")

    if not durations:
        print("No timing data collected.")
        return

    # Calculate statistics
    median_latency = statistics.median(durations)
    p95_latency = statistics.quantiles(durations, n=20)[18] if len(durations) >= 20 else max(durations)
    min_latency = min(durations)
    max_latency = max(durations)
    avg_latency = statistics.mean(durations)

    human_baseline_seconds = 25 * 60  # 25 minutes = 1500 seconds
    speedup_factor = human_baseline_seconds / median_latency if median_latency > 0 else 0

    print("\n" + "=" * 80)
    print("BENCHMARK RESULTS SUMMARY (FLAG-TO-DECISION LATENCY)")
    print("=" * 80)
    print(f"Total Accounts Evaluated : {len(durations)}")
    print(f"Minimum Latency          : {min_latency:.3f} s")
    print(f"Median Latency           : {median_latency:.3f} s")
    print(f"P95 Latency              : {p95_latency:.3f} s")
    print(f"Average Latency          : {avg_latency:.3f} s")
    print(f"Maximum Latency          : {max_latency:.3f} s")
    print("-" * 80)
    print(f"Human Analyst Baseline   : 20–30 minutes (avg 1,500 s)")
    print(f"Agentic Pipeline Speedup : {speedup_factor:.1f}x faster ({median_latency:.2f}s vs 1500s)")
    print(f"Turnaround Reduction    : {((1 - (median_latency / human_baseline_seconds)) * 100):.2f}% time saved")
    print("=" * 80)

    # Save artifact
    output_payload = {
        "timestamp": time.time(),
        "total_accounts": len(durations),
        "median_latency_seconds": round(median_latency, 3),
        "p95_latency_seconds": round(p95_latency, 3),
        "min_latency_seconds": round(min_latency, 3),
        "max_latency_seconds": round(max_latency, 3),
        "average_latency_seconds": round(avg_latency, 3),
        "human_analyst_baseline_seconds": human_baseline_seconds,
        "speedup_factor": round(speedup_factor, 1),
        "runs": results
    }

    out_file = BASE_DIR / "timing_benchmark.json"
    with open(out_file, "w") as f:
        json.dump(output_payload, f, indent=2)
    print(f"Detailed timing telemetry saved to: {out_file}\n")

if __name__ == "__main__":
    run_benchmark()
