# FraudGuard AI — Member C Agent Pipeline Status Assessment

**Date**: October 16, 2026  
**Service**: `agent-service/` (Investigation Layer 3)  
**Author**: Shruti Jaggi (Member C)

---

## 1. Executive Summary

A comprehensive forensic audit of the existing codebase in `agent-service/` was performed prior to implementing Phase A & B enhancements. Below is the exact fact-based status of each pipeline component and agent node.

| Agent Node | Status | Implementation Details | Gaps to Address |
| :--- | :--- | :--- | :--- |
| **1. Investigator Agent** (`nodes/investigator.py`) | **Partial / Heuristic + LLM** | Calls `ChatOllama` (`llama3.2:latest`) with basic prompt for 4 patterns (mule-chain, star-burst, ATO, benign) and fallback heuristics. | Lacks discrimination for Member B's decoy look-alikes (family groups, forwarding chains, merchant hubs, payroll fan-outs). Needs robust retries, timeout enforcement, Pydantic schema validation, and multi-model score integration (`xgb_score`, `sage_score`). |
| **2. Decision Agent** (`nodes/decision.py`) | **Stub (Rule-Based Only)** | ~40 lines of static conditional checks on `suspicion_score` and flags. Always confirms high scores. | No hybrid architecture (rules + LLM). Cannot intelligently `clear` high-scoring false-positive decoys (precision is ~0.43 at 0.85 flag). Needs business rules filter followed by LLM second-opinion reasoning to clear innocent accounts. |
| **3. Action Agent** (`nodes/action.py`) | **Stub (Static Strings)** | Returns hardcoded strings based on decision (`UPI ID revoked...`). | No pluggable backend architecture (`SimulatedAction` vs `MongoAction`). Needs clean abstraction, formal mapping (`account_frozen`, `flagged_for_review`, `cleared`), and persistence readiness for Member A's MongoDB. |
| **4. Report Agent** (`nodes/report.py`) | **Stub (Basic Template)** | Formats a static 40-line text string with basic state parameters. | Lacks dynamic LLM case synthesis, per-model score breakdowns, forensic graph pattern attribution, and ISO timestamping. |

---

## 2. Infrastructure & Service Status

| Component | Current State | Target State (Brief Requirements) |
| :--- | :--- | :--- |
| **FastAPI Service (`main.py`)** | Implements both `/predict` and `/investigate` on port 8001. Handles `/investigate` but defaults to generating a synthetic dummy profile for unknown accounts instead of returning HTTP 404. | Strict compliance with Contract 4.1: return HTTP 404 on unknown account, HTTP 422 on missing ID, case-insensitive VPA stripping (`@upi`). Leave `/predict` to Member B (`ml-service` port 8080) or proxy, while keeping `/investigate` robust. |
| **Data Provider** | Reads from static `data/mock_accounts.json` only. | Abstract `DataProvider` interface with `CsvProvider` (for Member B's `blended_scores.csv` & `accounts.csv`) and `MongoProvider` (for Member A's DB), plus `MockProvider`. |
| **Configuration (`config.py`)** | 14 lines containing basic Ollama settings and timeout. | Central unified config: port (8001), Ollama model, thresholds (WARN: 0.70, FLAG: 0.85 matching `ml-service/config.py`), timeouts, retry limits, data provider mode. |
| **Resilience & Fallbacks** | Basic try/except with 1 hardcoded fallback JSON and heuristic method. | Robust Pydantic output validation, 1 retry on LLM failure, strict timeouts, deterministic heuristic fallback for each node, and cached demo fixtures for live demo safety. |
| **Telemetry & Timing** | Simple `time.time()` logging in `main.py`. | Flag-to-decision latency measurement script and server-side timing telemetry (median, p95) to benchmark against 20–30 min human analyst baseline. |

---

## 3. Plan of Action (Immediate Next Steps)

1. **Config Unification**: Update `agent-service/config.py` with thresholds (0.70 / 0.85), port (8001), timeouts, retry parameters, and provider modes.
2. **Data Provider Interface**: Create `agent-service/providers/` with `DataProvider` ABC, `MockProvider`, and `CsvProvider` (ready for Member B's datasets).
3. **Robust LLM Client & Validation**: Implement resilient Ollama invocation with Pydantic structured output, retry logic, and deterministic fallback.
4. **Enhanced Investigator Node**: Teach recognition of genuine fraud rings vs Member B's decoy look-alikes (family, forwarding, merchant, payroll).
5. **Hybrid Decision Node**: Business rules pre-filter + LLM forensic judgment capable of clearing false alarms.
6. **Pluggable Action Node**: Build `SimulatedAction` and `MongoAction` backends.
7. **Comprehensive Report Node**: Executive forensic audit report with full evidence trail and timestamps.
8. **Endpoint Hardening**: Fix 404/422 responses and VPA handling in `main.py`.
9. **Pytest Suite**: Expand unit and integration test coverage.
