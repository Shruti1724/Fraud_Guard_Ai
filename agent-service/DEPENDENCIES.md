# FraudGuard AI — Dependency Register (Member C)

**Service**: `agent-service/` (Investigation Layer 3)  
**Author**: Shruti Jaggi (Member C)  
**Date**: October 16, 2026

Per Section 6 of the Member C Work Brief, changes required from Member A or Member B are registered here as requests rather than editing their respective codebases.

---

## Dependency Table

| # | Needed from | What | Blocks | Current Status | Notes & Action for Team |
|---|---|---|---|---|---|
| **1** | **Member B** | `artifacts/blended_scores.csv` & `data/v2/accounts.csv` | `CsvProvider` real-data run | **Delivered & Integrated** | Received from Member B, deduplicated, and placed into canonical paths (`ml-service/artifacts/blended_scores.csv` and `ml-service/data/v2/accounts.csv`). Loaded by `CsvProvider` across all 893,216 accounts. |
| **2** | **Member B** | `data/v2/transactions.csv` (transaction edges & neighborhood) | Investigator real-data graph neighborhood | **Delivered & Integrated** | Received from Member B, placed in `ml-service/data/v2/transactions.csv`, and indexed across 519,454 transactions into bidirectional graph neighbors with topological risk tags (`MULE_CHAIN`, `DECOY_FAMILY_GROUP`, etc.). |
| **3** | **Member B** | Per-model scores (`xgb_score`, `sage_score`) exposed via `/predict` or CSV | Model divergence evidence signal | **Implemented & Ready** | Layer 3 now utilizes both `xgb_score` and `sage_score` for model divergence forensic analysis. If Member B can include them in the `/predict` JSON response, Layer 3 can consume them in real-time. |
| **4** | **Member B** | 2–3 flagged-but-innocent accounts from real dataset for evaluation | Evaluation of `clear` path on live dataset | **Fixtures Active** | Test fixtures for 4 decoy types (`family_group`, `forwarding_chain`, `merchant_hub`, `payroll_fanout`) are active and verified. Requesting 2-3 real account IDs from `data/v2/splits.csv` once Member B runs the test split. |
| **5** | **Member B** | `ml-service` running on port `8080` | Live `/predict` service calls | **Open** | Member C service strictly binds to port `8001`, leaving port `8080` dedicated to Member B. |
| **6** | **Member A** | Decision: Who writes to MongoDB? | Action agent real backend | **Resolved / Supported Both Ways** | Pluggable `ActionBackend` supports both `SimulatedAction` and `MongoAction`. Furthermore, Member A's `backend/routes/sendMoney.js` already persists the `/investigate` response directly into `InvestigationCase` and `AuditAction`! |
| **7** | **Member A** | MongoDB connection string & write access | Action/Report DB persistence | **Configured** | Default set to `mongodb://localhost:27017/fraudguard` in `config.py`. Please provide remote credentials if hosted on Mongo Atlas. |
| **8** | **Member A** | Account `status` field values in Mock UPI app | Ensuring freeze actually blocks payment | **Proposal Submitted** | Member C outputs standard account states: `account_frozen` (for `auto_block`), `flagged_for_review` (for `escalate`), and `cleared` (for `clear`). **Request for Member A:** In the frontend/backend Send Money flow, verify that if an account has `status === 'account_frozen'`, payment authorization is blocked. |
| **9** | **Member A** | Backend calls `/investigate` on port 8001 with adequate timeout | End-to-end payment-to-investigation flow | **Verified / Request Timeout** | Member A's `backend/services/agentServiceClient.js` already points to `http://127.0.0.1:8001`! **Request for Member A:** Ensure HTTP fetch timeout is configured to at least 25–30 seconds to accommodate local Ollama LLM inference. |
| **10** | **Member A** | Socket.IO event mechanism for agent feed on dashboard | Live dashboard updates | **Verified & Working** | Member A's `backend/routes/sendMoney.js` already emits `io.emit("agent:activity", investigation)`. |
| **11** | **You $\rightarrow$ B** | Share flag-to-decision latency metrics | Member B's comparison against 20-30 min human baseline | **Completed** | Benchmark script `benchmark_timing.py` has measured flag-to-decision time. Telemetry shared in section below. |
| **12** | **A to confirm** | `backend/routes/predict.js` matches B's field names | A/B service integration | **Open (A/B)** | A/B interface verification. |

---

## Flag-to-Decision Timing Report (For Member B)

To assist Member B in comparing FraudGuard AI's autonomous layer against the **20–30 minute human analyst baseline**, Member C measured the latency of `POST /investigate` across 11 representative accounts:

- **Human Analyst Baseline**: 20–30 minutes ($\sim 1,500$ seconds)
- **Agentic Pipeline (Layer 3 Live Ollama Evaluation)**:
  - **Median Latency**: **13.12 seconds**
  - **P95 Latency**: **16.41 seconds**
  - **Minimum Latency**: **9.92 seconds**
  - **Speedup**: Over **114.3× faster** than manual compliance review.
  - **Turnaround Reduction**: **99.13% time reduction** with instant automated debit freeze for confirmed rings and immediate clearance for innocent look-alike decoys.
  - Telemetry source: `agent-service/timing_benchmark.json`
