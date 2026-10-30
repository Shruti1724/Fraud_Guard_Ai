# Member A: Backend Gateway, SOC Dashboard and Customer App in Full Detail

This document explains, in plain language and without code, everything built in the gateway
(backend), the operations dashboard and the customer-facing payment app. Member A's work is
the layer that **connects everything**: it receives the payment, consults the ML layer, hands
suspicious cases to the agent layer, enforces the result, stores the evidence and shows it all
to people in real time. Use it to present this part with full understanding.

Contents:
1. Role of this layer
2. The system at a glance
3. The data model (what is stored and why)
4. The payment journey, step by step
5. The risk service and the bridge to the ML data
6. The investigation service (background verdict handling)
7. The ledger (money settlement)
8. Roles: how accounts are classified
9. The report parser
10. Real-time events
11. Service health and demo reset
12. The dashboard APIs
13. The customer app (mock UPI)
14. The SOC dashboard: overview
15. The 3D network graph
16. The Attack Director and narrator
17. The investigation panel and case file
18. Account 360, case queue and the other views
19. The KPIs and how they are computed
20. Design decisions and why
21. Failure handling and safety
22. Testing and verification that was done
23. Limits and honest caveats
24. Suggested improvements
25. Questions an examiner may ask, with answers
26. Glossary

---

## 1. Role of this layer

Member A's layer sits **between the people and the intelligence**.

- Towards customers it is a payment gateway: it accepts a payment request, decides quickly
  whether to let it through, and tells the customer what happened.
- Towards the machine intelligence it is an orchestrator: it asks Layer 1 (ML) for a quick
  score, and asks Layer 3 (agents) for a deeper investigation when needed.
- Towards fraud analysts it is an operations centre: a live dashboard that shows what is
  happening, why, and lets a human intervene.
- Towards the bank's record-keeping it is the system of record: accounts, payments, scores,
  cases and every action are stored.

The central engineering problem it solves: **machine investigation takes seconds, but a payment
must feel instant.** The solution is the hold-and-resolve pattern described in section 4.

---

## 2. The system at a glance

Four runnable parts talk to each other:

1. **The web application (frontend):** two faces: the customer's mobile-style app, and the
   analyst's dashboard.
2. **The gateway (backend):** a server that exposes the payment and dashboard interfaces,
   keeps a live channel to browsers, and talks to the database and to the two Python services.
3. **The ML service (Member C):** fast scoring.
4. **The agent service (Member B):** deep investigation.

A cloud database stores the data. A browser connected to the gateway receives live updates
pushed from the server.

The technology: a React-based web framework for the frontend, a Node.js server framework for the
gateway, a document database, and a real-time messaging library for live updates. For the
dashboard: a 3D graph visualisation library built on a browser 3D engine, a charting library
and a print helper for report export.

---

## 3. The data model (what is stored and why)

Five collections hold the system's memory.

### 3.1 Accounts
One record per account. It stores:
- identity: account identifier, payment address (VPA), holder name
- profile: age in days, verification level, balance, average payment size, payments per day,
  number of counterparties, device and network address
- risk state: a status that is one of **active**, **under investigation** or **frozen**
- an optional link to the matching account in the ML data (the **ML identifier**, see
  section 5)
- the last agent decision, when it was investigated, why it was frozen, and a timestamp if the
  agents **cleared** it (used to avoid re-flagging)

### 3.2 Transactions
One record per payment. It stores sender, receiver, amount, status, device, timestamps and:
- the status, one of **success**, **flagged** (held), **blocked**
- the risk score at the time
- a block reason when blocked
- a link to the investigation case
- a flag if it is simulation traffic
- a flag recording whether its balances have been settled (so money moves only once)

### 3.3 Risk scores
The most recent risk assessment per account: the blended score, the two individual model
scores, the risk level, the latency of the lookup, and the ML identifier used. This lets the
dashboard show the model breakdown without calling the ML service again.

### 3.4 Investigation cases
One record per agent investigation. It stores a case identifier, the account, what triggered it
(a flagged payment, a manual request, a simulation), the final decision, the action taken, the
full report text, the **structured findings** parsed from the report, how long it took, whether
the decision came from the agents, an analyst or the fail-safe, the status (resolved or awaiting
review), and any analyst note.

### 3.5 Audit actions
An append-only trail of actions: who did what to which account and when (an agent decision, an
analyst override, a manual freeze). It supports accountability.

### 3.6 Why a document database
Cases carry nested, evolving structures (findings, evidence lists) and the data is read mostly
by account. A document store keeps those together without rigid schemas, and a cloud-hosted
instance means the team shares one source of truth.

---

## 4. The payment journey, step by step

This is the heart of the backend. A payment request names a sender, a receiver payment address,
an amount and a device.

### Step 1: Validation
The gateway checks the sender exists and the request is well-formed. Missing or unknown
accounts return a clear error, not a crash.

### Step 2: Hard gate on frozen accounts
If the sender or the receiver is already frozen, the payment is refused immediately with a
"forbidden" response and a **blocked** payment record is stored with the reason. No machine
intelligence is needed: a freeze means freeze. This is the mechanism by which a mule's later
cash-out attempts bounce at the gate.

### Step 3: Funds check
If the sender does not have enough balance, the payment is refused with an "unprocessable"
response (skipped for simulation traffic so demos do not run out of money).

### Step 4: Layer 1 check
The risk service looks up the receiver's score (section 5). Three outcomes:
- **Low risk:** continue.
- **Warning band:** the customer is told, and can proceed.
- **Flagged:** the customer must confirm; if they have not, the gateway asks for confirmation.

### Step 5: Create the payment
- Low risk or accepted warning: payment is created as **success** and settled at once.
- Flagged and confirmed: payment is created as **flagged**, which means **held**. The money has
  not moved.

### Step 6: Immediate answer
The gateway answers the customer in tens of milliseconds, whatever the case.

### Step 7: Background investigation (flagged only)
The investigation service (section 6) is started without making the customer wait. It tells
every dashboard that an investigation has begun.

### Step 8: Verdict applied later
When the agents finish, the gateway applies the result:
- **Auto-block:** the receiver is frozen; held payments become blocked; the money never moves.
- **Clear:** the receiver becomes active again and is marked as cleared; held payments become
  successful and balances settle.
- **Escalate:** the receiver is marked under investigation; payments stay held; a case is opened
  for a human.

### Step 9: Live notification
Every step emits events so the customer app and dashboards update without refreshing.

### Why this design
A customer cannot wait 10 to 20 seconds at checkout, and a bank cannot let money through while
it investigates. Holding the payment satisfies both. This is the single most important design
decision to explain.

---

## 5. The risk service and the bridge to the ML data

### 5.1 What it does
For a receiver payment address, it finds the account, asks the ML service for the score, and
returns a result with the score, level, flag, message and extras.

### 5.2 The identifier problem
The ML service knows 893,216 accounts by identifiers from its own dataset. The demo accounts in
the database have different identifiers. Without a link, the ML service would answer "not found"
for every demo account.

### 5.3 The bridge
Each demo account stores an **ML identifier**: the identifier of a real dataset account of the
same kind. When scoring, the gateway asks the ML service about that dataset account, then reports
the answer under the demo account's identity. For example, the demo's mule relay is scored as a
real dataset mule-chain account; the demo's payroll company is scored as a real dataset payroll
decoy that the models really do over-flag.

Consequences:
- **The scores, risk levels and the split between XGBoost and GraphSAGE are genuine model
  output.**
- **The graph shape, names and profiles are the demo's own** (hand-built), because the dataset's
  account and payment files are not in the repository.
- The accounts chosen for the "false alarm" scenarios are deliberately real model false
  alarms, to show the agent layer's value.

State this openly when presenting.

### 5.4 Fallback
If the ML service is unreachable or does not know an account, the gateway asks the agent
service's built-in scorer, so no account is silently treated as safe. The dashboard shows which
source was used.

### 5.5 The agent-clearance memory
If the agents recently cleared an account, the risk service lowers its level to medium for 24
hours and records why. This prevents the same honest customer from being flagged on every
payment. Cleared accounts show in cyan on the graph.

---

## 6. The investigation service (background verdict handling)

### 6.1 Starting an investigation
- **De-duplication:** if one is already running for the account, a new request joins it.
- **Cooldown:** after a recent investigation, a repeat request reuses the cached result for a
  period (90 seconds) so a burst of payments does not flood the agents.
- The service marks the account as under investigation and announces the start.

### 6.2 Building the case file for the agents
It compiles a snapshot: the account's profile, its recent payments and its neighbours. Each
neighbour is **labelled** by role from the graph: a phishing **victim**, an offshore **sink**, an
already-flagged **mule**, a **high-risk** account, or **normal**. This gives the Investigator
the same picture an analyst would draw on a whiteboard, built from live data.

### 6.3 Calling the agents
It sends the request with a generous time limit, since the agents can take many seconds.

### 6.4 Applying the verdict
It converts the verdict into effects on the account and its held payments (section 4, step 8),
creates the case, writes an audit entry, parses the report into structured findings, and emits
completion events.

### 6.5 Failure: the fail-safe
If the agent service errors, times out or is unreachable, the account is **held for a human**,
the case is marked as a fail-safe decision, and the dashboard shows a clear banner. The system
never defaults to "allow".

### 6.6 Human resolution
An escalated case waits. An analyst can confirm the block or override it to clear. Either choice
updates the account and the held payments, records the analyst's name and note, and logs an
audit entry.

---

## 7. The ledger (money settlement)

Moving money correctly matters even in a prototype.

- Balances change only when a payment actually succeeds.
- Each payment records whether it has been settled; settlement is claimed atomically so it can
  never happen twice, even if two events race.
- Simulation traffic never changes balances.
- Held payments do not touch balances. When released, they settle; when blocked, they never do.

This avoids classic bugs: double-spending a released payment, or deducting money for a payment
that was stopped.

---

## 8. Roles: how accounts are classified

The graph, the account panel and the agent briefing all need to agree on what an account **is**.
A single classification module assigns each account a role: offshore sink, syndicate pool, mule
relay, leaf mule, smurfing hub, takeover victim, hawala gateway, phishing victim, merchant,
payroll account, family member, flatmate or ordinary customer. It derives the role from the
account's profile, risk and identity.

Using one module avoids the common inconsistency where the picture says one thing and the
agents are told another. It also produces the labels the agents use for neighbours.

---

## 9. The report parser

The agents write a text report. People want structured fields: a score, a pattern, a list of
evidence. The parser reads the report and extracts: suspicion score, risk level, the three model
scores, the detected pattern, summary, evidence list, risk factors, model-divergence note,
verdict, rationale and executed action.

It supports both the current report layout and an older one, so cached demo data and live data
both display correctly. If a field is absent it is left empty, never invented.

---

## 10. Real-time events

The server pushes events to every connected browser:

| Event | Meaning |
|---|---|
| New transaction | A payment was created (including held or blocked) |
| Transaction updated | A held payment was released or blocked |
| Risk score updated | A score was computed |
| Investigation started | The agents began work on an account |
| Investigation completed | The verdict is in, with the case |
| Investigation failed | The fail-safe took over |
| Account updated | Status, balance or clearance changed |
| System reset | The demo data was reseeded |

Why push instead of polling: events arrive instantly, the server is not hammered by repeated
requests, and a payment made on a phone appears on the dashboard in the same moment. The
customer app listens to the same channel so a held payment updates to its final outcome on the
phone.

---

## 11. Service health and demo reset

### 11.1 Health
One endpoint checks the database, the ML service, the agent service and the language model
server, and reports status and real round-trip time for each, plus which source is feeding Layer
1. The dashboard's status pills use it, so what you see is real, not decorative.

### 11.2 Reset
A demo-mode endpoint wipes and reseeds the data so every run-through starts clean. It is
disabled outside demo mode.

### 11.3 Seeding
The seed script creates the demo world: 21 accounts and 23 payments covering victims, a
syndicate pool, mule relays, leaf mules, a smurfing hub, a takeover target, a crypto desk,
merchants, a payroll company, a family account, a flatmate and ordinary customers. Scores are
loaded from the real ML table via the ML identifiers. Two modes exist: a fresh live-demo state,
and a history mode with pre-resolved incidents.

---

## 12. The dashboard APIs

| Interface | Purpose |
|---|---|
| Graph | All accounts as nodes with role, risk, status, model scores and last decision, and payments as links |
| Transactions | Recent payments for the feed and account histories |
| Cases | All investigation cases with structured findings |
| Resolve case | Analyst confirms block or overrides to clear |
| Action | Manual investigate, freeze or clear on an account |
| Stats | All KPI numbers |
| Model metrics | The ML team's evaluation table, read from their results file |
| Health and reset | Described above |
| Predict | The Layer 1 check used by the apps |
| Send money | The payment path |
| Account details and history | For the customer app |

---

## 13. The customer app (mock UPI)

A mobile-style web app that imitates a UPI payment experience. It exists to show the **customer
side** of the system: what a person sees when the fraud layers act.

### 13.1 Screens and flow
1. **Home:** account summary, quick actions, recent contacts.
2. **Send:** enter the receiver's payment address; the app checks it with Layer 1 as soon as it
   is entered.
3. **Keypad / amount:** enter the amount and a note.
4. **Warning:** shown for risky receivers.
   - Flagged accounts (0.85 and above) show a red high-risk warning with the real score, the
     message and the model breakdown.
   - Accounts in the warning band (0.70 to 0.85) show a softer amber warning; the customer may
     proceed.
5. **PIN entry:** the usual authorisation step.
6. **Processing:** an animation while the gateway responds.
7. **Result screens:**
   - **Successful:** payment went through.
   - **On hold:** a flagged payment is being investigated; the screen updates **live** to
     released, stopped or held for manual review, with a real case identifier and reason when
     the agents finish.
   - **Blocked:** the payment was refused because an account is frozen.
8. **History and alerts tabs:** past payments and security alerts, with filters.

### 13.2 What is real
- The risk score and latency shown come from the actual check and its timing.
- The clock is real.
- The final outcome and case information come from the actual investigation.
- Errors (insufficient funds, unknown receiver) are shown in the app, not as browser pop-ups.

### 13.3 Why it matters for the demo
It shows that the intelligence is not only for analysts: customers get a clear, humane
explanation, and honest customers whose payments are held get released automatically when the
agents clear them.

---

## 14. The SOC dashboard: overview

The dashboard is the analyst's view. It has four views: **Command Center**, **Cases**,
**Accounts** and **Intelligence**.

The Command Center is a three-column layout:
- **Left:** the live event stream.
- **Centre:** the 3D network graph, with a row of six KPI tiles on top, filter and layout
  controls on the left, a legend on the right, and the Attack Director at the bottom.
- **Right:** three tabs: Investigation, Account and Cases.

A top bar shows navigation and live health pills for the database, ML layer, agents, language
model and the live connection, plus a reset button and a link to the customer app.

### 14.1 The state hook
A single hook holds the dashboard's live state. It loads initial data, then keeps it current by
listening to the real-time events. Nodes and links are kept as stable objects and patched in
place; this avoids rebuilding the 3D scene on every update, which would cause flicker and lag.
An internal event bus carries one-shot visual effects (flash a node, fly the camera) separately
from data.

---

## 15. The 3D network graph

### 15.1 What it shows
Each account is a node, each payment a directed edge. It turns a table of payments into a
picture of how money flows, which is how fraud rings are really recognised.

### 15.2 Node appearance
- **Shape reflects role:** large diamonds for sinks, faceted spheres for syndicate pools, cubes
  for merchants and payroll, tetrahedra for takeover victims, and so on.
- **Colour reflects state:** green low risk, orange high risk, amber under review, red frozen or
  critical, cyan cleared by the agents.
- **Size** grows with importance and risk.
- A soft glow and bloom make nodes readable against the dark background; a starfield and fog
  give depth.
- Labels show the short account name.

### 15.3 Edge appearance
- Direction shown by arrows and by **particles moving along the edge**.
- Colour by status: cyan settled, amber held, red blocked.
- Particle count and speed higher on flagged and blocked edges; particle size grows with amount.

### 15.4 Interaction
- Orbit, zoom and pan; slow automatic rotation that pauses during scripted scenarios.
- Clicking a node focuses the camera, dims unrelated edges and opens its details.
- Hover tooltips show name, address, risk, status, role and the two model scores.
- Node dragging is intentionally off, because of a known crash in the underlying 3D library
  when a pointer interaction is cancelled.

### 15.5 Filters and layouts
- Filters: all, fraud rings, flagged flow, frozen or under review.
- Layouts: organic (free-floating), money-flow (left to right, so a chain reads as a path from
  victim to sink), and radial.

### 15.6 Effects
- Expanding shockwave rings: red on freeze, green on clear, amber on hold or when an
  investigation starts, orange when Layer 1 flags.
- Camera fly-to when something happens.
- A burst of particles along a new payment.

### 15.7 Performance design
The visual settings are defined once and reused so the library does not rebuild every object
whenever something changes. Updates change colours and links in place. The scene is designed for
tens to a few thousand nodes, not hundreds of thousands.

### 15.8 Why only 21 accounts
Two reasons: the account and payment files needed to draw the real network are not in the
repository, and a 3D browser view cannot draw 893 thousand nodes. A production tool would show a
focused subgraph around alerts. The population-level statistics are better shown as a table and
histogram.

---

## 16. The Attack Director and narrator

### 16.1 Purpose
To let a presenter, or anyone, **see** detection happen without needing real fraud. Scripted
scenarios send real payments through the real pipeline, while a narrator card explains each step
in plain language and the camera follows the action.

### 16.2 The five scenarios
1. **Mule chain ring:** two victims pay a new relay; the agents investigate with the live graph;
   the relay is frozen; its attempts to cash out to an offshore vault and a leaf mule are
   blocked at the gate.
2. **Smurfing burst:** a syndicate funds a hub that then splits money into amounts just under
   the reporting limit; the hub is frozen and every dispersal is blocked.
3. **Account takeover:** large transfers around a compromised account on a suspicious device;
   the agents escalate to a human instead of freezing; a follow-up investigation runs on the
   receiving crypto desk.
4. **False alarm cleared:** Layer 1 flags an honest payroll account and a flatmate; the agents
   clear them and release the payments; the next payment goes straight through.
5. **Legitimate traffic:** ordinary retail payments, including one in the warning band that is
   allowed; shows the system is not trigger-happy.

### 16.3 Other controls
- **Full wave:** runs four scenarios back to back.
- **Speed:** normal or double pacing.
- **Stop:** cancels the running scenario.
- **Live traffic:** a background stream of ordinary payments to keep the graph alive.
- **Fraud injection:** occasionally mixes fraud into the live traffic so detections appear on
  their own.

### 16.4 How a step runs
Each step either sends a payment or waits for an investigation to finish. A caption is shown
while it runs; a chip under the caption turns from waiting, to running, to a result (held,
blocked, settled, or the agents' verdict and how long it took).

### 16.5 Honesty about simulation
Simulated payments are marked as simulation and only honoured in demo mode. They never alter
balances. Everything else (scoring, investigation, verdicts, freezes) is real pipeline
behaviour.

---

## 17. The investigation panel and case file

### 17.1 While the agents work
A four-stage stepper (Investigator, Decision, Action, Report) with a **real running timer**.
Be upfront: the service reports only the total time, so which stage is highlighted is an
estimate; the timer and final duration are real. A box shows the graph context sent to the
agents: number of counterparties, recent payments, victim inflows and sink outflows.

### 17.2 After the verdict (the dossier)
- A verdict banner (auto-block, escalate, cleared) with a suspicion gauge.
- Case identifier, account, detected pattern, time to resolve and who decided: the agents, an
  analyst or the fail-safe.
- **Model comparison:** bars for XGBoost, GraphSAGE and the blend with the flag threshold marked.
  When the two disagree by a large margin, a note explains that this is exactly where agent
  review adds value.
- **Policy rationale, divergence analysis, risk factors and evidence trail**, taken from the
  agents' report.
- **Action executed**, and any analyst note.
- **Analyst buttons** for escalated cases: confirm the block or override to clear.
- **Export:** a printable suspicious-activity report built from the case.
- A fail-safe banner if the AI was unavailable.

### 17.3 Why this matters
This panel is the **explainability** of the project. Every decision can be traced: what the
models said, what the agents found, which rule or reasoning decided, what was done and who
approved it.

---

## 18. Account 360, case queue and the other views

### 18.1 Account 360
For a selected node: status, role, risk gauge and scores, balance, verification level, age,
velocity, counterparties, device, address, the ML identifier it is scored as, and recent flow.
Buttons let an analyst manually investigate, freeze or clear, with audit logging.

### 18.2 Case queue
All cases, newest first, with a badge for how many are waiting for an analyst.

### 18.3 Cases view
A full-page list and dossier side by side.

### 18.4 Accounts view
A searchable table of all accounts, sorted by Layer 1 risk, with a risk bar and status; clicking
a row opens its detail in the Command Center.

### 18.5 Intelligence view
Analytics for the story:
- agent decision time compared with a 25-minute human baseline
- false alarms cleared
- cases investigated by verdict
- money stopped
- the ML team's model evaluation table (precision, recall, ring catch), showing why a second
  layer is needed
- a donut chart of verdicts and risk-level distribution

---

## 19. The KPIs and how they are computed

| KPI | How it is computed |
|---|---|
| Throughput | Payments in the last minute divided by sixty, plus the total |
| Protected | Sum of amounts of blocked payments; also the sum currently held |
| Accounts | Counts of frozen, under-review and active accounts |
| Decision time | Average duration of resolved agent cases |
| Faster than manual | The 25-minute manual baseline divided by the average agent time |
| False alarms cleared | Cases where Layer 1 flagged an account and the agents cleared it |
| Needs analyst | Cases currently awaiting human review |

The 25-minute baseline is an assumption set at the start of the project, not a measured
industry figure. Say so.

---

## 20. Design decisions and why

1. **Hold and resolve:** instant response with deferred verdict. (Customer experience and
   safety.)
2. **Hard gate before any intelligence:** frozen means frozen; no model needed.
3. **Gateway enforces, agents recommend:** one owner of account state; avoids conflicts.
4. **Push events instead of polling:** immediacy and efficiency.
5. **Feedback memory (24-hour clearance):** reduces repeat false alarms.
6. **One shared role classifier:** consistent picture across graph, panels and agents.
7. **Parsing text into structure:** keeps the agent service unchanged while the UI gets clean
   fields.
8. **Adapt around teammates' services:** no changes were needed in the ML or agent code, so the
   layers stay independently owned.
9. **Fail-safe by default:** failure holds money for a human.
10. **Real data wherever possible:** real model scores, real latency, real health, real
    outcomes; only the topology is hand-built and the freeze is simulated.
11. **Demo safety:** simulation flag, demo-mode reset, no effect on balances.

---

## 21. Failure handling and safety

| Failure | Behaviour |
|---|---|
| ML service down | Fallback scorer in the agent service; dashboard pill shows fallback |
| Unknown account in ML | Fallback scorer; never assumed safe |
| Agent service down or slow | Fail-safe: account held for a human; banner shown |
| Language model off | Agents run on built-in rules; pill shows heuristic mode |
| Database slow | Health pill shows latency |
| Repeated payments to a flagged account | De-duplicated and cooled down |
| Frozen account used again | Blocked at the gate, recorded |
| Two events race to settle | Atomic claim ensures settlement happens once |
| Browser loses connection | Status pill shows offline; data reloads on reconnect |

---

## 22. Testing and verification that was done

The integrated system was exercised end to end with the real ML service, the real agent
pipeline (in rule-based mode, plus a quick check of a local model), a temporary database and a
real browser. Results:

- The ML check answered in a few milliseconds for each demo address; an unknown address
  correctly fell back to the agent scorer.
- Mule relay: held, then blocked by the agents in about eleven seconds; account frozen; later
  attempts blocked at the gate.
- Payroll and flatmate look-alikes: held, then cleared; payments released; the next payment
  passed straight through.
- Account takeover: escalated for a human.
- Warning-band merchant: amber warning, payment went through.
- The dashboard rendered and each scenario ran to completion; the customer app flows (hold →
  released, hold → stopped, warning → success) displayed correct results.
- Browser consoles showed no unexpected errors; the only logged errors were the intentional
  "forbidden" responses for blocked payments.
- A production build compiled.
- A known crash from node dragging in the 3D library was found and removed by disabling dragging.

What was not verified: the intended language model, large graphs, narrow phone-width layouts of
the dashboard, and the cloud database under load (testing used a temporary local database; the
cloud one was reseeded afterwards).

---

## 23. Limits and honest caveats

1. **Hand-built topology:** 21 accounts and 23 payments, linked to real model scores by a
   mapping.
2. **Simulated enforcement:** freezes and blocks are statuses in the project's database.
3. **Stage animation is an estimate;** only total time is real.
4. **No analyst authentication;** cross-origin access is permissive; simulation depends on a
   flag. Acceptable for a prototype, not for production.
5. **No full-population view** of the 893 thousand scored accounts.
6. **Few automated tests** for the gateway.
7. **Manual and scripted browser verification** rather than a formal test suite.
8. **The 25-minute baseline is an assumption.**
9. **Dashboard is built for desktop;** phone-width behaviour was not verified.
10. **Dependency on teammates' services' behaviour** (for example, the text report format).

---

## 24. Suggested improvements

1. A population panel from the full score table: counts at each threshold, histogram, searchable
   top-flagged list.
2. Real ring and decoy subgraphs once the dataset's account and payment files are available.
3. Analyst login or token on action endpoints; tighter allowed origins.
4. Backend tests for the payment path (frozen sender, held payment, release, escalation) with a
   passing run to show.
5. Per-stage agent timing from the agent service.
6. A startup script that launches all services in order.
7. Rate limiting and idempotency keys for payments.
8. An analyst audit view listing every action.
9. Responsive layout for tablets.
10. A "what-if" payment tool on the dashboard for examiners.

---

## 25. Questions an examiner may ask, with answers

**Why does the payment return before the investigation finishes?** Because the investigation
takes seconds and checkout must feel instant. The payment is held, not approved, so it is safe,
and the verdict is applied when ready and pushed to the screens.

**What stops a fraudster retrying after a block?** A frozen account is blocked at the gate for
every later attempt, and each attempt is recorded.

**What if the agents are wrong?** Uncertain cases are escalated to a human. An analyst can
override any decision. Every action is audit-logged.

**What if the agents are down?** The account is held for a human. Money is never released
because something failed.

**Is the data on the dashboard real?** The scores, latency, health, verdicts and outcomes are
real outputs of the running system. The graph's accounts and payments are a hand-built demo
network, linked to real model-scored accounts.

**Why only 21 accounts?** The files needed to draw the real network are not in the repository,
and a browser cannot draw 893 thousand nodes in 3D; a real SOC shows a focused subgraph.

**How does the dashboard update live?** The server pushes events over a persistent connection to
every open browser; the dashboard patches its state in place.

**Why 3D?** Fraud is a network phenomenon. Seeing money flow along edges from victims through
relays to a sink makes the pattern and the intervention immediately understandable, including
for non-technical stakeholders.

**How do you prevent double settlement?** Settlement is claimed atomically once per payment.

**How is the demo reproducible?** A reset endpoint reseeds the database; scenarios are scripted
and run through the real pipeline.

**What would you do next?** Population view, real subgraphs, authentication, backend tests and
the agent evaluation.

---

## 26. Glossary

- **Gateway:** the backend that sits in front of payments and coordinates other services.
- **VPA:** virtual payment address, a UPI identifier like name@bank.
- **Held payment:** created but not settled while under investigation.
- **Hold and resolve:** respond immediately, decide later.
- **Fail-safe:** failure leads to a hold, not an approval.
- **Escalate:** hand a case to a human analyst.
- **Audit trail:** record of who did what and when.
- **Sink:** where stolen money finally leaves the network.
- **Mule:** an account used to pass illicit money along.
- **Socket event:** a message pushed from server to browser.
- **SOC:** security operations centre.
- **SAR:** suspicious activity report.
- **KPI:** key performance indicator.
- **Bloom:** a glow effect in the 3D renderer.
- **Particle:** a moving dot along an edge representing money flow.
