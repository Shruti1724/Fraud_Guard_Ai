# FraudGuard AI — Integration Notes (backend ⇄ ML ⇄ agents ⇄ frontend)

## Run order
```bash
# 1. ML service (Layer 1)      needs ml-service/artifacts/blended_scores.csv
cd ml-service && python -m uvicorn app:app --port 8080

# 2. Agent service (Layer 3)   Python 3.11, Ollama running (ollama run llama3.2)
cd agent-service
ACTION_BACKEND=simulated DATA_PROVIDER_MODE=csv python run_service.py     # :8001

# 3. Backend
cd backend && npm install && cp .env.example .env   # set MONGODB_URI
npm run seed            # fresh live-demo state (add `-- history` for pre-resolved incidents)
npm run dev             # :4000

# 4. Frontend
cd frontend && npm install && npm run dev            # :3000  (/ = phone app, /dashboard = SOC)
```
`GET /system/health` reports real status/latency of Mongo, ML, agent and Ollama.
If ML is down, Layer 1 falls back to the agent's heuristic scores; if the agent
pipeline fails, the account is held for a human analyst (fail-safe), never silently allowed.

## The ML bridge (why demo accounts show real model scores)
The ML service scores ~893K real/synthetic accounts by ID (`C1000039615`,
`acc_chain_016_4`, …). The demo's Mongo accounts (`acc_mule_chain_01`, …) are a
different namespace, so every seeded account carries `ml_account_id`, pointing at a
real account of the matching role (mule relay → `acc_chain_016_4`, payroll decoy →
`acc_employee_075_9`, …; see `ML_MAP` in `backend/seed.js`). `/predict` sends the ML
service that ID, so the score, risk level and XGB/SAGE split are genuine model
output. The *topology and account profiles* are the demo's own.
The scores in Mongo (`risk_scores.xgb_score/sage_score`) are loaded from the CSV at seed time.

## Flagged payment lifecycle
```
POST /send-money (flagged, confirmed)  →  201 in ~30ms, txn FLAGGED (held)
  └ background: investigation:started → agent pipeline (10–20s) → investigation:completed
       auto_block → account FROZEN,             held txns → BLOCKED
       clear      → account ACTIVE (+cleared_by_agent_at; Layer 1 downgrades it to MEDIUM for 24h),
                    held txns → SUCCESS (balances settle)
       escalate   → account UNDER_INVESTIGATION, held txns stay FLAGGED, case UNDER_REVIEW
                    └ analyst: POST /dashboard/cases/:id/resolve {APPROVE_BLOCK | OVERRIDE_CLEAR}
```
Payments to/from FROZEN accounts return 403 and are recorded as `BLOCKED`.

## Socket.IO events
| event | payload |
|---|---|
| `transaction:new` | `{ txn }` |
| `transaction:updated` | `{ txn }` (status resolved by an investigation / analyst) |
| `risk_score:updated` | `{ account_id, risk_score, risk_level, is_flagged, meta, model_scores }` |
| `investigation:started` | `{ ref, account_id, vpa, trigger, started_at, context }` |
| `investigation:completed` | `{ ref, case, decision, duration_ms, failsafe, account }` |
| `investigation:failed` | `{ ref, account_id, error }` |
| `account:updated` | `{ account_id, risk_status, current_balance?, last_decision?, freeze_reason? }` |
| `system:reset` | `{ mode, at }` |
| `agent:activity` | legacy summary |

## Known limits (be upfront about these in the demo)
* Topology edges for the demo graph are hand-built; only the *scores* are the real model's.
  The generated v2 `accounts.csv` / `transactions.csv` are not in the repo (they need the raw
  PaySim file), so the agent's CSV provider falls back to its mock profiles for those details.
* Without Ollama running, agents use their deterministic heuristic fallbacks (still end-to-end).
* Simulation traffic (`simulation: true`) skips balance/confirm checks and works only with `DEMO_MODE=true`.

## Ollama model fallback

The agent-service defaults to `llama3.2:latest`. If that model is not installed, pick whatever is
available locally before starting the agent (no agent code change needed, it reads `OLLAMA_MODEL`):

```powershell
$env:OLLAMA_MODEL = node scripts/pick-ollama-model.js   # e.g. qwen:latest
```

Preference: llama3.2 > llama3 > qwen > mistral/phi/gemma > any local model. `:cloud` tags are skipped.
If Ollama is down the script prints nothing and the agents use their heuristic fallbacks.
