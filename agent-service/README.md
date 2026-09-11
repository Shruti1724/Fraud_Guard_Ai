# FraudGuard AI — Agentic AI Investigation Service

The **Agentic AI Investigation Layer** for FraudGuard AI (UPI Fraud Detection System). This service functions as the Layer-3 multi-agent reasoning pipeline that investigates accounts flagged by upstream VPA Lookups (Layer 1) and Graph Neural Network models (Layer 2 / GraphSAGE).

---

## 4-Agent LangGraph Architecture

```
[ POST /investigate ] 
       │
       ▼
1. Investigator Agent  --> Ollama LLM (llama3.2) deep-dives into account history, velocity, & graph neighbors
       │
       ▼
2. Decision Agent      --> Applies policy & risk matrix rules (auto_block | escalate | clear)
       │
       ▼
3. Action Agent        --> Issues concrete mitigation (UPI handle revocation, debit freeze, 2FA challenge)
       │
       ▼
4. Report Agent        --> Generates executive case audit narrative for compliance and banking logs
       │
       ▼
[ Response JSON ]
```

---

## API Contract

### Request: `POST /investigate`
```json
{
  "account_id": "acc_mule_chain_01"
}
```

### Response:
```json
{
  "account_id": "acc_mule_chain_01",
  "decision": "auto_block",
  "action_taken": "UPI ID 'mule.relay99@oksbi' revoked; Immediate debit freeze applied on NPCI switch; Device 'DEV_ANDROID_9921_MULE' blacklisted across inter-bank fraud registry.",
  "report": "=== FRAUDGUARD AI CASE AUDIT REPORT ===\nTarget Account : acc_mule_chain_01 (mule.relay99@oksbi)\nAccount Age    : 4 days | KYC Status: PARTIAL_MINIMUM_OTP\nRisk Level     : CRITICAL (Score: 95/100)\n\n[Investigation Summary]\nRapid pass-through layering ring detected from multiple victim inflows to single aggregator sink.\n..."
}
```

---

## Quick Start

### 1. Start Ollama (if not already running)
```bash
ollama run llama3.2:latest
```

### 2. Start the FastAPI Service
```bash
cd agent-service
./.venv/bin/python run_service.py
```
Or directly with uvicorn:
```bash
PYTHONPATH=agent-service ./agent-service/.venv/bin/uvicorn main:app --reload --port 8001
```

### 3. Test with `curl`

**Live LLM Investigation (Mule Chain):**
```bash
curl -X POST http://127.0.0.1:8001/investigate \
     -H "Content-Type: application/json" \
     -d '{"account_id": "acc_mule_chain_01"}'
```

**Fast Presentation Demo Fallback (Pre-cached):**
```bash
curl -X POST "http://127.0.0.1:8001/investigate?use_cache=true" \
     -H "Content-Type: application/json" \
     -d '{"account_id": "acc_mule_chain_01"}'
```

**List Available Dummy Test Accounts:**
```bash
curl http://127.0.0.1:8001/accounts
```

---

## Test Accounts Included

| Account ID | Pattern / Scenario | Expected Decision |
| :--- | :--- | :--- |
| `acc_mule_chain_01` | Rapid victim inflows -> aggregate sink pass-through (Mule Ring) | `auto_block` |
| `acc_star_burst_02` | High-velocity credit fan-out into micro amounts (Star Smurfing) | `auto_block` |
| `acc_suspicious_device_04` | High-value transfer from unknown Tor exit node (Account Takeover) | `escalate` |
| `acc_legit_retail_03` | Verified retail merchant with regular small-value transactions | `clear` |

---

## Running Tests
```bash
PYTHONPATH=agent-service ./agent-service/.venv/bin/python -m pytest test_pipeline.py -v
```
