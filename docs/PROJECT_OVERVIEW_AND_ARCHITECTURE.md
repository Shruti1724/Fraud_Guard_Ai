# FraudGuard AI — Current System Status & Data Mechanics

---

## 1. Executive Summary of Current Runtime State

Right now, **4 distinct services are actively running and communicating with each other**:

1. **Frontend App (`http://localhost:3000`)** — Next.js 14 / React 18
   - Renders the 9-screen Mock UPI Mobile App on `/`
   - Renders the live Cytoscape Graph SOC Dashboard on `/dashboard`
2. **Backend API Gateway (`http://localhost:4000`)** — Node.js / Express
   - Manages WebSocket event pipeline (Socket.io)
   - Talks directly to MongoDB Atlas database
   - Proxies Layer 1 and Layer 3 requests to Python
3. **AI Agent Service (`http://127.0.0.1:8001`)** — Python 3.11 / FastAPI / LangGraph / Uvicorn
   - Runs `/predict` (<50ms real-time heuristic scoring)
   - Runs `/investigate` (4-agent LangGraph state machine)
4. **Primary Database (Cloud)** — MongoDB Atlas (`cluster0.tn6jbk5.mongodb.net/fraudguard_db`)
   - 5 collections: `accounts`, `transactions`, `risk_scores`, `investigation_cases`, `audit_actions`

---

## 2. The Data: WHAT Data Exists, WHY It Exists, and WHERE It Lives

### A. The Accounts (Nodes in the Graph)
**Where it lives**: MongoDB Atlas `accounts` collection + `agent-service/data/mock_accounts.json`

| Account ID (`account_id`) | UPI Address (`vpa_address`) | Account Age | KYC Tier | Current Balance | Baseline Velocity | WHY this data exists (Scenario & Role) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `acc_user_101` | `me@upi` | 320 days | `FULL_BIOMETRIC` | ₹75,000 | 4 tx/day, avg ₹2,500 | **The Sender (You)**: Normal legitimate sender account used to initiate all test payments. |
| `acc_mule_chain_01` | `mule.relay99@oksbi` | 4 days | `MINIMUM_OTP` | ₹120 | 38.5 tx/day, avg ₹48,500 | **Mule Relay Node (CRITICAL 0.96)**: Receives ₹48.5k from victims and immediately dumps 98% of funds to offshore sink within 4 minutes. |
| `acc_star_burst_02` | `quicksplit.hub@paytm` | 12 days | `MINIMUM_KYC` | ₹450 | 45.0 tx/day, avg ₹9,800 | **Smurfing Hub (CRITICAL 0.92)**: Receives ₹100,000 from syndicate pool and splits it into 10 uniform ₹9,900 batches targeting leaf mules. |
| `acc_suspicious_device_04` | `rajesh.kumar77@icici` | 580 days | `FULL_BIOMETRIC` | ₹15,000 | 1.5 tx/day, avg ₹1,250 | **Account Takeover / ATO (HIGH 0.88)**: 580-day old legacy account suddenly making a ₹95,000 payment from an unknown Linux machine via a Tor exit node. |
| `acc_legit_retail_03` | `sharma.kirana.store@hdfcbank`| 820 days | `FULL_BIOMETRIC` | ₹45,200 | 45.0 tx/day, avg ₹340 | **Verified Merchant (LOW 0.04)**: High-frequency legitimate retail grocery store with 190+ distinct customers and low ticket size. |
| `acc_aggregator_sink_09` | `offshore.vault@crypto` | 2 days | `NONE` | ₹984,000 | 80.0 tx/day, avg ₹95,000 | **Offshore Laundering Sink (CRITICAL 0.99)**: Terminal destination node where illicit mules send accumulated funds. |
| `acc_source_syndicate` | `syndicate.prime@darknet` | 18 days | `NONE` | ₹1,500,000 | 60.0 tx/day, avg ₹100,000 | **Syndicate Pool (CRITICAL 0.98)**: Origin funding pool for smurfing attacks. |
| `acc_leaf_node_01` to `03` | `mule.leaf01@axis` | 7-9 days | `MINIMUM_KYC` | ₹9,900 | 5.0 tx/day | **Leaf Mules (HIGH 0.86)**: Receiver nodes in the smurfing dispersal attack. |
| `C_VICTIM_881`, `C_VICTIM_902`| `victim.sharma@paytm` | 450-510 days | `FULL_BIOMETRIC` | ₹5,200-₹8,400 | 2-3 tx/day | **Victim Nodes (LOW 0.12)**: Legitimate users whose funds were drained into `acc_mule_chain_01`. |

---

### B. The Transactions (Edges in the Graph)
**Where it lives**: MongoDB Atlas `transactions` collection

| Transaction ID | Sender | Receiver | Amount | Status | Reason & Type |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `tx_alpha_01` | `C_VICTIM_881` | `acc_mule_chain_01` | ₹49,000 | `SUCCESS` | Inflow phishing drain from victim to mule. |
| `tx_alpha_02` | `C_VICTIM_902` | `acc_mule_chain_01` | ₹48,000 | `SUCCESS` | Inflow phishing drain from victim to mule. |
| `tx_alpha_03` | `acc_mule_chain_01` | `acc_aggregator_sink_09` | ₹96,800 | `FLAGGED` | Rapid egress pass-through laundering attempt to offshore vault. |
| `tx_beta_00` | `acc_source_syndicate`| `acc_star_burst_02` | ₹100,000 | `SUCCESS` | Initial funding of smurfing hub. |
| `tx_beta_01` to `03` | `acc_star_burst_02` | `acc_leaf_node_01`..`03` | ₹9,900 | `BLOCKED` | Structured dispersal below ₹10k KYC threshold — intercepted. |
| `tx_gamma_01` | `acc_suspicious_device_04`| `acc_crypto_p2p_desk` | ₹95,000 | `FLAGGED` | Anomalous drain from hijacked account to P2P crypto exchange. |
| `tx_retail_01` to `04`| `C_CUSTOMER_01`..`03` | `acc_legit_retail_03` | ₹320 - ₹1,200 | `SUCCESS` | Normal retail purchases at kirana store. |

---

### C. The Precomputed Evaluations (`risk_scores` Collection)
**Where it lives**: MongoDB Atlas `risk_scores` collection

Stores the latest risk assessment for each account so that when a user types a VPA in the mobile app, the lookup takes **< 50ms**:
- `mule.relay99@oksbi` $\rightarrow$ `risk_score: 0.96`, `risk_level: "CRITICAL"`, `is_flagged: true`
- `quicksplit.hub@paytm` $\rightarrow$ `risk_score: 0.92`, `risk_level: "CRITICAL"`, `is_flagged: true`
- `rajesh.kumar77@icici` $\rightarrow$ `risk_score: 0.88`, `risk_level: "HIGH"`, `is_flagged: true`
- `sharma.kirana.store@hdfcbank` $\rightarrow$ `risk_score: 0.04`, `risk_level: "LOW"`, `is_flagged: false`

---

### D. The Investigation Cases (`investigation_cases` Collection)
**Where it lives**: MongoDB Atlas `investigation_cases` collection

Stores complete forensic dossiers produced by LangGraph:
- `CASE-MULE-8819`: Mule Relay pass-through laundering verdict (`auto_block`). Contains 4-step OODA timeline (`OBSERVE` $\rightarrow$ `ORIENT` $\rightarrow$ `DECIDE` $\rightarrow$ `ACT`).
- `CASE-SMURF-4102`: Smurfing Star-Burst syndicate verdict (`auto_block`).
- `CASE-TAKEOVER-1092`: Account Takeover Tor Exit verdict (`escalate` to biometric step-up).

---

## 3. HOW Data Moves: The Exact Step-by-Step Lifecycle

```
[User Types VPA on Phone] 
       │ 
       ▼ (1) POST /predict (HTTP)
[Node.js :4000] ──► [FastAPI :8001 /predict] ──► Returns risk_score (<50ms)
       │
       ▼ (2) If risk_score > 0.85 ──► Displays Red Warning Banner on Mobile Screen
       │
[User Enters PIN & Confirms]
       │
       ▼ (3) POST /send-money (HTTP)
[Node.js :4000] ──► Writes to MongoDB `transactions` (status: BLOCKED)
       │
       ├─► (4) POST /investigate (HTTP) ──► [LangGraph Engine :8001] (Generates Case Dossier)
       │
       └─► (5) WebSocket emit ("transaction:new", "agent:activity")
                  │
                  ▼
          [Dashboard :3000/dashboard]
          • Cytoscape renders red glowing edge
          • Terminal streams agent reasoning
          • Case Dossier appears in list
```

### Detailed Timeline of Events:

1. **WHEN: User selects or types a recipient in Mock App (`/`)**
   - **How**: Frontend sends `POST http://localhost:4000/predict` with `{ sender_account_id: "acc_user_101", receiver_vpa: "mule.relay99@oksbi", amount: 48500 }`.
   - **Backend Action**: Node.js calls `http://127.0.0.1:8001/predict` (FastAPI).
   - **Result**: Returns `{ risk_score: 0.96, risk_level: "CRITICAL", is_flagged: true, warning_message: "..." }` in **38ms**.
   - **UI Action**: If `is_flagged: true`, opens **Screen 3 (High Fraud Risk Warning Modal)** with red audio-bar meter at 96%.

2. **WHEN: User taps "Proceed Anyway" and enters UPI PIN**
   - **How**: Frontend sends `POST http://localhost:4000/send-money`.
   - **Backend Action**:
     1. Inserts transaction document into MongoDB with `status: "BLOCKED"`, `is_fraud: true`.
     2. Calls `http://127.0.0.1:8001/investigate` with `account_id: "acc_mule_chain_01"`.
     3. Emits `transaction:new` over WebSocket to all connected browser tabs.
     4. Emits `agent:activity` over WebSocket with the decision and action taken.
   - **UI Action**: Mobile phone transitions to **Screen 5 (Processing checklist)** $\rightarrow$ then shows **Screen 7 (Transaction Stopped Receipt)**.

3. **WHEN: SOC Admin Dashboard is open (`/dashboard`)**
   - **How**: Dashboard listens on Socket.io client.
   - **Action**: 
     1. The new transaction is immediately added to Cytoscape graph $\rightarrow$ an animated red directed arrow appears with label `₹48.5k`.
     2. The terminal box appends `[AGENT_ACTION] Decision: AUTO_BLOCK | Action: Account frozen, VPA blacklisted`.
     3. The **Autonomous Incident Dossiers** list re-fetches `/dashboard/cases` and renders the new case.
     4. Clicking **SAR PDF** formats and opens the browser print/export dialog.

---

## 4. WHERE Everything is Configured (Single Source of Truth)

- **MongoDB Atlas URI**: `backend/.env` (`MONGODB_URI=mongodb+srv://kosada:kosada%4023@cluster0.tn6jbk5.mongodb.net/fraudguard_db`)
- **FastAPI Python URL**: `backend/.env` (`AGENT_SERVICE_URL=http://127.0.0.1:8001`)
- **Risk Thresholds**: `shared/contracts/schemas.py`:
  - `RISK_FLAG_THRESHOLD = 0.85` (Auto-block + triggers investigation)
  - `RISK_WARNING_THRESHOLD = 0.70` (Displays mobile warning banner)
  - `RISK_LOW_CEILING = 0.30` (Instant safe clearance)
- **Node Backend Port**: `4000`
- **FastAPI Python Port**: `8001`
- **Next.js Frontend Port**: `3000`

---

## 5. Current Component Health Checklist

- [x] **MongoDB Atlas Connection**: Active and healthy.
- [x] **Node Backend (`server.js`)**: Running on port 4000 with Express + Socket.io.
- [x] **Python Agent Service (`run_service.py`)**: Running on Python 3.11 on port 8001 with FastAPI + LangGraph.
- [x] **Next.js Frontend (`npm run dev`)**: Running on port 3000 with zero build or runtime errors.
- [x] **Mobile App (`/`)**: All 9 screens matching reference design with real API integration.
- [x] **Admin Dashboard (`/dashboard`)**: Cytoscape graph, Recharts telemetry, 360° drawer, and SAR PDF export verified working.
