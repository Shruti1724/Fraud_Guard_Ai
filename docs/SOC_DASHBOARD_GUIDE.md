# FraudGuard AI: SOC Dashboard Explained (Presenter's Guide)

This document explains everything on the Security Operations Center (SOC) dashboard at
`http://localhost:3000/dashboard`: what every part is, what data drives it, what happens
behind it when you click or run something, and what to say to an examiner. Read Parts 1 to 3
first; they give the mental model that everything else hangs on.

---

## Part 1: The big picture

### 1.1 What problem does the project solve?
UPI (instant bank-to-bank payments in India) is irreversible within seconds. Fraudsters use
**mule accounts**: ordinary-looking accounts that receive stolen money and pass it on
(a "mule chain"), or split it into small pieces below reporting limits (**smurfing**).
Catching this in real time is hard because:

- A single ML model produces **false positives**: honest accounts (a salary-paying company,
  a family group, a flatmate splitting rent) look statistically like mules, so blocking on the
  score alone blocks real customers.
- Human analysts take **~25 minutes** to triage one alert. By then the money is gone.

### 1.2 The solution: three layers

| Layer | What | Speed | Where in repo |
|---|---|---|---|
| **Layer 1: ML scoring** | XGBoost (tabular behaviour) + GraphSAGE (graph neighbourhood). Blended score = `0.3 × XGB + 0.7 × SAGE`. Score ≥ 0.85 = **flag**, 0.70 to 0.85 = **warn**. | ~3 to 7 ms | `ml-service/` (port 8080) |
| **Layer 2: Gateway** | The Express backend. Runs the Layer 1 check before money moves, holds flagged payments, enforces freezes, records everything. | ~30 ms | `backend/` (port 4000) |
| **Layer 3: Agentic investigation** | Four AI agents (LangGraph) investigate a flagged account like an analyst and issue a verdict: **auto_block**, **escalate** or **clear**. | ~10 to 20 s | `agent-service/` (port 8001) |

The key idea for the examiner: **Layer 1 is fast but imprecise; Layer 3 is slower but
understands context.** The pair gives speed *and* precision. Layer 3 turns a 25-minute
human triage into seconds, and clears honest users that Layer 1 wrongly flagged.

### 1.3 What is the dashboard?
The dashboard is the **analyst's window** into all of that. It is not a mock-up with fake
numbers. Every number, node colour, log line and verdict is driven by the real backend,
which calls the real ML service and the real agent pipeline. The phone app (`/`) is the
customer's side; the dashboard is the bank's side. They share one backend, so a payment made
on the phone shows up on the dashboard instantly.

---

## Part 2: Architecture and data flow

```
 Phone app (/)  ──┐                         ┌── ML service  :8080  (Layer 1: XGB + GraphSAGE)
                  ├─►  Express backend :4000 ┤
 Dashboard (/dashboard)                      └── Agent service :8001 (Layer 3: 4 agents + Ollama LLM)
        ▲                │
        │  Socket.IO     └── MongoDB Atlas (accounts, transactions, risk scores, cases, audit)
        └────────────────┘   live events pushed to every open dashboard
```

### 2.1 Life of one flagged payment (the most important flow)
1. **Customer taps Pay** (phone app, or the Attack Director on the dashboard) →
   `POST /send-money`.
2. **Hard gate:** if sender or receiver account is already `FROZEN`, the backend returns
   **403** and records a `BLOCKED` transaction. No agent needed, the freeze holds.
3. **Layer 1 check** (`riskService.assessReceiver`): the backend asks the ML service for the
   receiver's score. If score ≥ 0.85 the payment is **FLAGGED** and *held* (money not moved).
   If 0.70 to 0.85 the customer gets a warning but may proceed. Below 0.70 it settles normally.
4. **Backend answers in ~30 ms** with the held transaction. The customer is not left waiting
   on a 10 to 20 s AI call.
5. **In the background** `investigationService` starts an agent investigation and emits the
   socket event `investigation:started`. The dashboard shows the four-stage pipeline running
   with a real timer.
6. **The agents finish** → backend applies the verdict:

| Verdict | Account becomes | Held payments | Case status |
|---|---|---|---|
| `auto_block` | `FROZEN` | `BLOCKED` (money never moves) | Closed, AI-decided |
| `clear` | `ACTIVE` (flagged `cleared_by_agent_at`) | `SUCCESS`, released, balances settle | Closed, AI-decided |
| `escalate` | `UNDER_INVESTIGATION` | stay `FLAGGED` (held) | `UNDER_REVIEW`, waits for a human analyst |

7. **Socket events** (`investigation:completed`, `account:updated`, `transaction:updated`)
   update every dashboard and the phone app live: a node changes colour, a shockwave plays,
   the feed logs it, the KPI strip ticks up.

### 2.2 Safety rules baked in (good examiner talking points)
- **Fail-safe:** if the agent service crashes or times out, the account is *held for a human*
  (decision source `FAILSAFE`). The system never silently lets suspicious money through.
- **Cooldown + dedupe:** one investigation per account at a time, and a 90 s cooldown, so a
  burst of payments does not spawn duplicate investigations.
- **Agent clearance memory:** when agents clear an account, Layer 1 downgrades it to `MEDIUM`
  for 24 hours so the next legitimate payment is not flagged again. Visible as the cyan node
  colour and `overridden_by: agent_clearance`.
- **Human in the loop:** `escalate` hands the decision to an analyst, who can **Confirm block**
  or **Override: clear** from the dashboard. Every action is written to an audit log.
- **Simulation traffic is marked** `simulation: true` and only honoured when `DEMO_MODE` is on,
  so demo traffic can never move real balances.

### 2.3 The "ML bridge" (be upfront about this)
The ML service scores ~893,000 accounts from its dataset, by IDs like `acc_chain_016_4`.
The demo accounts in MongoDB (`acc_mule_chain_01`, ...) are a *different namespace*. So each
demo account carries an `ml_account_id` pointing to a real model-scored account of the same
type (the mule relay is scored as `acc_chain_016_4`). Result: **the scores, risk levels and
XGB/GraphSAGE split you see are genuine model output**, but the **graph layout and account
profiles are hand-built** for the demo. Say this if asked. It is honest and shows you
understand the data boundary.

---

## Part 3: Dashboard anatomy (top to bottom, left to right)

The default view is the **Command Center**, a three-column layout:

```
┌──────────────────────────────── Top bar ───────────────────────────────────────┐
│ Logo | Command Center · Cases · Accounts · Intelligence | service pills | Reset | UPI app │
├───────────┬───────────────────────────────────────────────────┬────────────────┤
│  Live     │  KPI strip (6 tiles)                              │  Right panel   │
│  event    │  ┌ filters  ┐   3D network graph      ┌ legend ┐   │  tabs:         │
│  stream   │  │ layouts  │   (nodes, flowing money)│        │   │  Investigation │
│           │  └ orbit    ┘                         └────────┘   │  Account       │
│           │  Narrator card (during scenarios)                  │  Cases         │
│           │  Attack Director dock                              │                │
└───────────┴───────────────────────────────────────────────────┴────────────────┘
```

### 3.1 Top bar
- **Logo + "Security Operations Center"**: branding.
- **View tabs:** Command Center, Cases, Accounts, Intelligence (see Part 6).
- **Service pills** (this is the *real* health, polled from `GET /system/health`):
  - **MongoDB**: green if the database answers, with latency in ms.
  - **ML Layer 1**: green when the ML service is up (shows how many accounts it loaded, e.g.
    `893K acct`); amber "fallback" if ML is down and Layer 1 is using the agent's heuristic scores.
  - **Agents**: the agent-service status and latency.
  - **LLM**: the Ollama model name (e.g. `qwen:latest`). Amber "model missing" if Ollama runs but
    the configured model is absent; red "heuristic mode" if Ollama is off (agents then use
    rule-based fallbacks).
  - **Live / Offline**: whether the Socket.IO connection to the backend is open.
- **Reset demo**: wipes and reseeds the demo data (only works with `DEMO_MODE` on). Use between
  runs.
- **UPI app**: jumps to the phone app.

### 3.2 KPI strip (six tiles over the graph)
All computed on the backend by `GET /dashboard/stats` and refreshed on every event:

| Tile | Meaning |
|---|---|
| **Throughput** | Payments per second over the last minute, plus total payments. |
| **Protected** | Total rupees *blocked* (never reached the fraudster); sub-line shows rupees currently *held* for review. |
| **Accounts** | Count of frozen accounts; sub-line: under review / active. |
| **Decision time** | Average time the agents take to decide; sub-line shows "~N× faster than manual triage" using a 25-minute human baseline. |
| **False alarms cleared** | Honest accounts Layer 1 flagged and Layer 3 cleared. This is the precision story. |
| **Needs analyst** | Escalated cases waiting for a human. Glows amber when > 0. |

### 3.3 Live event stream (left column)
A scrolling log of everything happening, newest first, each with a timestamp and a tag:
- **TXN** (cyan): a payment occurred.
- **HOLD** (amber): a payment was held.
- **BLOCK** (red): a payment/account was blocked or frozen.
- **CLEAR** (green): cleared or released.
- **AGENT** (violet): an agent investigation started/finished.

It is fed by socket events, not polling, so it is instant. The "clear" link empties it.

---

## Part 4: The 3D network graph (the centrepiece)

Built with `react-force-graph-3d` (three.js / WebGL), plus bloom post-processing, a starfield
and fog for depth. File: `frontend/components/soc/Graph3D.js`.

### 4.1 What a node is
Each node is a bank account. Its **shape** tells you its role; its **colour** tells you its
current risk state.

| Shape | Role |
|---|---|
| Octahedron (large) | **SINK**: offshore/crypto exit where stolen money ends up |
| Icosahedron | **SYNDICATE**: the fraud pool that funds a ring |
| Dodecahedron | **SMURF**: smurfing hub that splits money into small chunks |
| Tetrahedron | **ATO**: account-takeover victim account |
| Octahedron (detailed) | **RELAY**: mule relay passing money along |
| Cube | **MERCHANT / PAYROLL**: legitimate business-type accounts |
| Sphere | Everyone else (customers, victims, leaf mules, family, flatmate) |

Role comes from the backend (`services/roles.js`) and is derived from account profile and
risk, so the graph, the right-hand panels and the agents all agree on what each account is.

**Node colour:**
| Colour | State |
|---|---|
| Green | Low risk |
| Amber | Under review / investigation in progress |
| Orange | High risk |
| Red | Frozen or critical |
| **Cyan** | **Cleared by the agents**: Layer 1 flagged it, Layer 3 said it is innocent |

Node **size** grows with role importance and with risk score. The soft halo is a glow sprite;
the faint outline is the wireframe edge of the shape. Labels show the VPA name (the part
before the `@`).

### 4.2 What an edge is
Each edge is a payment, arrowed in the direction money moved.
- **Cyan, thin**: settled payment.
- **Amber, thick**: held (flagged) payment.
- **Red, thick**: blocked attempt.
- **Moving particles** on each edge show money flowing. More particles and faster speed on
  flagged/blocked edges; particle width scales with the amount (log scale).
- Hover an edge for amount, status, route and block reason.

### 4.3 Interaction
- **Orbit/zoom/pan** with the mouse. **Auto-orbit** slowly rotates the scene when idle
  (toggle; it pauses automatically while a scenario is directing the camera).
- **Click a node:** selects it, flies the camera to it, dims every unconnected edge so you
  see only that account's neighbourhood, and opens the **Account** tab.
- **Hover a node:** tooltip with name, VPA, risk level and %, status, role, XGB and
  GraphSAGE scores.
- Node *dragging* is disabled on purpose (a three.js bug crashed on pointer-cancel).

### 4.4 Controls on the left of the graph
- **Filters:** *All*, *Fraud rings* (rings + critical + frozen), *Flagged flow* (only accounts
  involved in held/blocked payments), *Frozen / review*.
- **Layouts:**
  - *Organic*: free-floating force layout (clusters form naturally).
  - *Money flow*: left-to-right directed layout, so you read the path of money from victim →
    relay → sink.
  - *Radial*: concentric rings.
- **Auto-orbit** toggle and **Recenter** (zoom to fit everything).
- **Legend** (top right of graph) explains node and edge colours.

### 4.5 One-shot visual effects (the "wow" moments)
Triggered over an internal event bus when something happens:
- **Shockwave rings** expanding from a node: a double red/ice ring on **freeze**, green on **clear**, amber on **hold** and when an **investigation starts** (two pulses), orange when Layer 1 flags a score.
- **Camera fly-to** to the account being paid or investigated.
- **Particle burst** (four quick particles) along an edge when a new payment lands.

### 4.6 Rendering notes (if asked about performance)
- Node/edge accessors are module-level so the library does not rebuild every object on each
  state change; node objects are stable and only their material colours are updated each frame.
- The graph data is built once from `/dashboard/graph`, then **patched live** by socket
  events (a new payment adds an edge, a verdict changes a node), never reloaded wholesale.

---

## Part 5: The Attack Director (simulation) and narrator

The dock at the bottom of the graph. Every step is a **real** call to `/send-money` (marked
as simulation), so Layer 1 and Layer 3 run for real. A **narrator card** floats above the
dock and explains each step in plain English while the camera moves.

### 5.1 The five scenarios

| Scenario | Tag | What happens | Expected outcome |
|---|---|---|---|
| **Mule Chain Ring** | CRITICAL | Two phishing victims pay a 4-day-old relay account. Agents investigate with the live graph. The relay then tries to push money to an offshore vault and a leaf mule. | Relay **auto_block**ed and frozen. Both cash-out attempts **blocked at the gate** (403). |
| **Smurfing Burst** | CRITICAL | A syndicate funds a hub with ₹1,00,000. Hub then tries three uniform ₹9,900 payments (just under the ₹10k KYC limit) to leaf mules. | Hub frozen; all dispersal attempts blocked. |
| **Account Takeover** | HIGH | ₹95,000 hits a legacy account whose device suddenly switched (Linux behind a Tor exit). Account then tries to drain ₹90,000 to a crypto P2P desk. | Agents **escalate**: evidence is not enough to freeze outright, so a human decides. A second investigation runs on the crypto desk. |
| **False Alarm Cleared** | FALSE POSITIVE | Payment to an honest payroll account that the graph model scores ~0.91 (a false positive). Then a flatmate rent split scored ~0.99. | Agents **clear** both; payments released; the next payment to payroll goes straight through (24 h downgrade). Without Layer 3 both honest users would have been blocked. |
| **Legitimate Traffic** | LOW | Grocery payment, a peer-to-peer transfer, and a sweet-shop payment (score ~0.79, in the warn band). | Nothing blocked. Shows the system is not trigger-happy. |

### 5.2 Other controls
- **Full wave:** runs Mule Chain → Smurfing → False Alarm → Takeover back-to-back
  (the best "show everything" button; takes about 2 to 3 minutes).
- **Stop:** cancels the running scenario.
- **Speed 1× / 2×:** playback speed of the narration pauses.
- **Live traffic:** a background stream of ordinary retail payments through the real pipeline,
  so the graph looks alive. The counter shows how many have been sent.
- **Fraud on/off:** when Live traffic is on, ~14% of the payments are fraud injections
  (victim → mule, smurfing amounts, large hawala remittance) so you see detections happen
  spontaneously.

### 5.3 How a scenario runs (under the hood)
For each step: set the narrator caption → either `pay` (send a payment, show the outcome
chip: *Held*, *Blocked at the gate*, *Settled*) or `await` (wait on `waitForCompletion(account)`
for the `investigation:completed` socket event, then show the verdict and how many seconds it
took). Step chips under the caption turn from hourglass → spinning bolt → green/amber/red.

---

## Part 6: The right-hand panel and the other views

### 6.1 Investigation tab: the "case file"
Shown automatically the moment an investigation starts.

**While running** (live pipeline):
1. **Investigator**: reads the account profile and live graph neighbourhood, scores
   suspicion, separates mule rings from innocent look-alikes.
2. **Decision**: hard compliance rules first, then LLM judgment: auto-block, escalate or clear.
3. **Action**: turns the verdict into a freeze, step-up challenge or release.
4. **Report**: writes the audit report with the full evidence trail.

The big number is a **real running timer**. *Honest note:* the agent service reports only its
**total** time, so the highlighting of which stage is "working" is an estimated animation;
the timer and the final duration are real.

A cyan box shows the **live graph context sent to the agents**: how many counterparties and
recent transactions, how many victim inflows and offshore sink outflows. This is how the
agents "see" the network: the backend builds an `account_data` snapshot from MongoDB and
labels neighbours (VICTIM / SINK / FLAGGED_MULE / HIGH_RISK / NORMAL).

**When done** (the dossier):
- **Autonomous verdict** banner (AUTO-BLOCK / ESCALATE / CLEARED) with a **suspicion gauge** 0 to 100.
- Case ID, account, detected **pattern** (e.g. Mule-Chain), time to resolve, decided by
  (AI agents / Analyst / Fail-safe).
- **Layer-1 models disagree?**: bar chart of XGBoost, GraphSAGE and blended scores with the
  0.85 threshold marked. When the two differ by more than 0.4, a note explains that is exactly
  where agent review earns its keep. *(This is the explainability story: you can see why a
  single model could be wrong.)*
- **Policy rationale**: the agents' reasoning in plain language.
- **Model divergence analysis**, **Risk factors**, **Evidence trail**: parsed from the
  agent's report by `services/reportParser.js` into structured lists (the agent returns
  free text; the backend turns it into fields).
- **Action executed**: what was actually done (frozen / released / held), plus any analyst note.
- **Buttons:** for escalated cases, **Confirm block** and **Override: clear** (analyst
  decision; calls `POST /dashboard/cases/:id/resolve`, updates account and payments,
  logs an audit action). **Export SAR** prints a Suspicious Activity Report (case, verdict,
  full report text) as a PDF via the browser print dialog.
- A red **fail-safe banner** appears if the AI pipeline was unavailable and the account was
  held for a human.

### 6.2 Account tab: Account 360°
For whichever node you clicked: status pill, role, risk gauge with score breakdown, balance,
KYC, account age, velocity (tx/day and average amount), counterparties, device, IP, and the
ML ID it is scored as. **Recent flow** lists its latest payments in/out.
Analyst buttons:
- **Investigate**: manually starts a real agent investigation.
- **Freeze** / **Clear**: manual overrides (audit logged).
- **Latest case**: jumps to its most recent dossier.

### 6.3 Cases tab: the queue
All cases, newest first, with a badge for how many need an analyst. Click one to open its
dossier in the Investigation tab.

### 6.4 The other top-level views
- **Cases**: a full-page list + dossier side by side.
- **Accounts**: searchable table (by VPA, name, account id or role) of every account, sorted by
  Layer-1 risk, with a risk bar and status; click a row to open its Account 360° in the command center.
- **Intelligence**: analytics for the story:
  - Decision-time vs a 25-minute human baseline (the "N× faster" number).
  - False alarms cleared, cases investigated (blocked / escalated / cleared), money stopped.
  - **Model evaluation table** read from `ml-service/results/ensemble/final_table.csv`:
    AUC, PR-AUC, precision/recall at the 0.85 threshold, ring-catch rate per model.
    The key finding: the deployed blend (0.3·XGB + 0.7·SAGE) has only about **44% precision (43.6%)** at the
    0.85 threshold (many flags are false alarms) while catching ~148 to 150 of 150 fraud rings.
    That precision gap is *why a second layer exists*.
  - Live verdict mix (donut chart, recharts) and risk-level distribution bars.

---

## Part 7: Backend APIs the dashboard uses

| Endpoint | Purpose |
|---|---|
| `GET /dashboard/graph` | Nodes (accounts with role, risk, ML ids, last decision) + links (transactions) |
| `GET /dashboard/stats` | KPI numbers (money blocked/held, tps, decisions, avg decision time...) |
| `GET /dashboard/transactions` | Recent payments for the feed and account flows |
| `GET /dashboard/cases` | All investigation cases with parsed findings |
| `POST /dashboard/cases/:id/resolve` | Analyst resolves an escalated case |
| `POST /dashboard/action` | Manual FLAG (starts investigation) / FREEZE / CLEAR |
| `GET /dashboard/model-metrics` | ML evaluation table for the Intelligence view |
| `GET /system/health` | Real status + latency of Mongo, ML, agents, Ollama |
| `POST /system/reset` | Reseed demo data (DEMO_MODE only) |
| `POST /send-money`, `POST /predict` | The payment path and the Layer 1 check |

### Socket.IO events (backend → dashboard)
`transaction:new`, `transaction:updated`, `risk_score:updated`, `investigation:started`,
`investigation:completed`, `investigation:failed`, `account:updated`, `system:reset`.
The `useSoc` hook (`components/soc/useSoc.js`) listens to all of them and keeps one live
state object: graph nodes/links, events, investigations, cases, stats, health.

---

## Part 8: Code map

| File | Role |
|---|---|
| `frontend/pages/dashboard.js` | Page layout: three columns, filters/layout state, view switching |
| `frontend/components/soc/Graph3D.js` | The 3D graph, effects, camera, bloom |
| `frontend/components/soc/useSoc.js` | Live state hook: fetch + socket events |
| `frontend/components/soc/Chrome.js` | Top bar, KPI strip, event feed, reset hook |
| `frontend/components/soc/Director.js` | Attack Director, narrator, live traffic |
| `frontend/components/soc/scenarios.js` | The five scenarios and traffic pools |
| `frontend/components/soc/InvestigationPanel.js` | Pipeline stepper, dossier, SAR export |
| `frontend/components/soc/AccountPanel.js` | Account 360° and case queue |
| `frontend/components/soc/Views.js` | Cases / Accounts / Intelligence pages |
| `frontend/components/soc/theme.js`, `ui.js` | Colours, formatters, UI atoms |
| `backend/services/investigationService.js` | Runs investigations, applies verdicts, fail-safe |
| `backend/services/riskService.js` | Layer 1 check, ML bridge, clearance downgrade |
| `backend/services/reportParser.js` | Turns agent report text into structured fields |
| `backend/services/roles.js` | Account role classification used everywhere |
| `backend/services/ledger.js` | Safe, one-time balance settlement |
| `backend/routes/*.js` | `sendMoney`, `predict`, `dashboard`, `system`, `accounts` |

---

## Part 9: Suggested live-demo script (about 6 minutes)

1. **Open the dashboard.** Point at the service pills: "all four services are real and
   monitored: database, the ML model, the agents, the local LLM."
2. **Orbit the graph.** Explain shapes and colours using the legend: "sinks, syndicate, relays,
   merchants."
3. **Run *Mule Chain Ring*.** Narrate along with the narrator card: victims pay a new relay →
   held within milliseconds → the pipeline stepper runs live → relay frozen (red shockwave) →
   cash-out attempts bounce at the gate. Click the case: show verdict, XGB vs GraphSAGE, evidence.
4. **Run *False Alarm Cleared*.** "Layer 1 would have blocked these honest users at 0.91 and
   0.99. The agents cleared them" (cyan nodes, payment released). This is the strongest slide
   for precision.
5. **Run *Account Takeover*.** Show **escalate**: the AI knows its limits. Click **Confirm
   block** or **Override** as the human analyst.
6. **Open Intelligence.** Show the model table and the 44% precision point: "this is why
   the second layer exists", plus the decision-time vs the 25-minute human baseline.
7. **Optional:** turn on *Live traffic* + *Fraud on* and let detections appear on their own.
8. **Switch to the phone app** and make a payment to a mule VPA to show the customer-side hold
   and the real-time result.

**Tip:** run one test investigation before presenting. The first one is slower because the LLM
loads into memory. Use *Reset demo* between run-throughs.

---

## Part 10: Likely examiner questions, with honest answers

**Q: Is this real data or a mock?**
The scores come from the real trained models (XGBoost + GraphSAGE) and the verdicts from the
real agent pipeline. The accounts and graph topology in the demo are hand-built and mapped to
real model-scored accounts via `ml_account_id`. Money movement is simulated; no real bank is
involved and freeze/block actions are simulated in this prototype.

**Q: Why do you need agents if you already have ML?**
Because ML precision at the 0.85 threshold is only ~44%: more than half the flags are
honest users. The agents combine the two models' disagreement with account context (tenure,
KYC, neighbours) the way an analyst would, and clear the false alarms, in seconds not 25 minutes.

**Q: What if the AI is wrong or down?**
Down: the account is held for a human (fail-safe), never allowed through. Uncertain: the agents
`escalate`. Wrong: an analyst can override from the dashboard and every action is audit-logged.

**Q: Why does the payment return before the agents finish?**
The agents take 10 to 20 s. Making the customer wait on that is unacceptable, so the payment is
*held*, the response is immediate, and the verdict is applied asynchronously and pushed live.

**Q: What is the "N× faster" number?**
Average agent decision time compared with a 25-minute manual-triage baseline set at the start of
the project. It is a stated assumption, not a measured industry figure.

**Q: How do you stop repeated false alarms?**
Cleared accounts are downgraded to MEDIUM by Layer 1 for 24 hours (`cleared_by_agent_at`).

**Q: What happens with 100,000 accounts?**
This demo graph has ~21 accounts. The ML service itself scores 893K accounts, but the 3D view
is a visual of an investigated neighbourhood; at scale you would show a filtered subgraph.
Large-graph performance is not tested.

**Q: Can the dashboard be abused?**
Not hardened yet: analyst actions have no login, CORS is open, and simulation endpoints rely
on `DEMO_MODE`. These are listed as production TODOs, not claimed as done.

---

## Part 11: Known limitations (state them before they are asked)

- Stage-by-stage highlighting in the pipeline is an estimate; only total time is real.
- Topology is hand-built; real graph import needs the ML team's raw dataset files.
- LLM behaviour was tested with the heuristic fallback and a quick check of `qwen:latest`;
  the intended `llama3.2` model was not installed. Results may differ slightly in wording.
- The smurfing hub is labelled "Mule-Chain" in the agent report because the agent's
  known-mule shortcut fires first. The decision is correct; the label is the agent's.
- No analyst authentication, tightened CORS, or large-graph testing yet.
- Freeze/block are simulated actions inside this prototype's database, not a real bank core.

---

## Part 12: Glossary

- **UPI / VPA**: India's instant payment system / Virtual Payment Address (`name@bank`).
- **Mule account**: an account used to pass stolen money along.
- **Smurfing**: splitting a large sum into many small transfers to stay under limits.
- **ATO**: Account Takeover; a legitimate account taken over by a fraudster.
- **Sink**: where laundered money finally exits (offshore, crypto, hawala).
- **XGBoost**: gradient-boosted decision trees on tabular features (behaviour of the account).
- **GraphSAGE**: a graph neural network that scores an account using its neighbours' features.
- **False positive**: honest activity wrongly flagged as fraud.
- **SAR**: Suspicious Activity Report, filed by banks for regulators.
- **SOC**: Security Operations Center.
- **LangGraph**: framework used to wire the four agents into a pipeline.
- **Ollama**: runs the local LLM; no cloud API or data leaves the machine.

---

## Part 13: Where the data and scores come from (train / validation / test)

**Short answer:** every XGBoost, GraphSAGE and blended score on the dashboard is a *held-out
(out-of-fold) test prediction*, not a training-set score. But the 21 accounts on the dashboard
are hand-written demo accounts that *borrow* a real dataset account's scores. Details:

### 13.1 The dataset
- Built by `ml-service/generate_dataset_v2.py` from the public **PaySim** simulated mobile-money
  log (a 500,000-account sample of "normal" activity) **plus synthetic fraud injected by the
  team**: 150 mule rings (40 chain, 35 star, 25 cycle, 25 fan-out, 25 hybrid) and 175
  look-alike **decoys** (merchant hubs, payroll fan-outs, forward chains, family groups).
  Total 893,216 accounts. So it is **synthetic, not real bank data**.
- Labels (`label_mule`) are known by construction because the team created the rings.

### 13.2 How it was split
- Accounts are split **by group**, not individually (all accounts of one ring or decoy go to the
  same side), into train/test and into **5 folds**, so a model never sees part of a ring in
  training and the rest in testing (this prevents leakage).
- For each fold: train on the other 4 folds; carve a **validation** set (~10% of training groups)
  used for early stopping, calibration and blend-weight selection; then predict the held-out
  fold = **test**.
- Pooling the 5 held-out folds gives one score per account for all 893,216 accounts. These are
  **out-of-fold (OOF)** predictions. `build_blended_scores.py` joins the XGBoost OOF scores and
  the GraphSAGE (edge-aware, 2-layer) OOF scores and computes `risk_score = 0.3·xgb + 0.7·sage`
  into `artifacts/blended_scores.csv`. Every account's score therefore comes from a model that
  did **not** train on that account.

### 13.3 So which set do dashboard scores come from?
| Item on the dashboard | Source | Train / val / test? |
|---|---|---|
| XGB, GraphSAGE, blended score of a demo account | Looked up in `blended_scores.csv` via `ml_account_id` | **Test (out-of-fold)** prediction of the mapped dataset account |
| Model table in Intelligence (AUC, precision...) | `results/ensemble/final_table.csv` | Pooled **5-fold cross-validation (held-out)** metrics |
| Agent **suspicion score (0 to 100)** | Produced by the agent: LLM judgment, or fixed heuristic values (e.g. 95 / 72 / 15 / 10) if the LLM is off | **Not a trained model**; no train/test concept |
| Verdict (auto_block / escalate / clear) | Agent rules + LLM, fed the scores above and the live graph | Not trained |
| Graph nodes, edges, balances, KYC, device, IP | **Hand-written** `backend/seed.js` (21 accounts, 23 transactions) | Not from the dataset |

### 13.4 Be upfront about these caveats
1. **The accounts shown are not dataset accounts.** The demo uses 21 hand-built accounts. Each
   has an `ml_account_id` pointing to a real dataset account of the same kind (e.g. mule relay →
   `acc_chain_016_4`, scores 0.99999; payroll decoy → `acc_employee_075_9`, scores 0.91). The
   scores are genuine model output; the **graph shape, profiles and names are ours**.
2. **The four "false-alarm" accounts were chosen on purpose** as dataset decoys that the model
   does flag, to demonstrate Layer 3 clearing them. They are real examples of the model's
   false alarms, but not typical: only a minority of decoys are flagged (the evaluation table
   shows roughly 4 to 24 false alarms per 175 decoys, depending on model).
3. **I could not check which fold or split each mapped account sits in**, because `splits.csv`
   and `oof` files are not in the repo (they are large or ignored). By construction all are
   held-out predictions, but ask the ML teammate to confirm the fold of the ~16 mapped IDs.
4. **It is cross-validation, not a final untouched test set.** Blend weight and the 0.85
   threshold were chosen within this setup, so the metrics are somewhat optimistic.
5. **Synthetic data is easier than real data.** AUC 0.99 is on rings generated by one script
   and found by a model trained on that same generator's patterns. Real-world performance would
   be lower; frame it as a proof of architecture, not a deployable accuracy claim.
6. The agent's `csv` data mode reads the same `blended_scores.csv`; its account profiles
   (`data/v2/accounts.csv`) are not in the repo, so for live investigations the backend sends
   the demo profile and neighbours directly (`account_data`), and the scores come from the
   same file.
