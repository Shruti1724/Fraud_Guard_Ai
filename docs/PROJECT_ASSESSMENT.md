# FraudGuard AI: Honest Assessment Before the Examination

This is a frank review of the whole project: is it good, what is solid, what is weak, what to
fix before presenting, and how to present it. It is written for the three team members. The
companion documents describe each member's part in detail:

- `docs/members/MEMBER_A_FRONTEND_BACKEND.md` : Member A (frontend + backend + dashboard)
- `docs/members/MEMBER_B_AGENTIC_LAYER.md` : Member B (the four-agent investigation layer)
- `docs/members/MEMBER_C_ML_SERVICE.md` : Member C (dataset, models, scores)

A note on naming: the repository's older documents label the people differently (for example
the agent README calls itself "Member C"). This set uses the labelling the team confirmed:
A = frontend and backend, B = agentic layer, C = ML. Say this once at the start of the
presentation so nobody is confused by older documents.

---

## 1. The short verdict

**Yes, this is a project worth presenting as a final-year project.** It is not senseless. It is
a genuine end-to-end system with a clear problem, a layered design, real trained models,
an agentic decision layer, a working gateway, a live operations dashboard and a customer app.

Why it is worth a final:

1. **A real problem with a real design argument.** Fraud detection models over-flag. The team
   measured that its best blended model is only about 44% precise at the operating threshold.
   Rather than hiding that, the project builds a second layer specifically to fix it. That is a
   good story: measure the weakness, then engineer around it.
2. **It spans the full stack.** Data generation, feature engineering, classical ML, graph neural
   networks, evaluation, a model-serving API, an API gateway with a database, an agent
   framework, a local LLM, a real-time web dashboard and a mobile-style app. Each piece is
   non-trivial and they are connected.
3. **The layers are decoupled by contracts.** Each service has a clear input and output. The ML
   service can be replaced without touching the dashboard. The agent can be replaced without
   touching the models. This is the engineering maturity examiners look for.
4. **It has failure handling.** If the AI is down the account is held for a human. If the ML
   service is down Layer 1 falls back. Nothing silently lets suspicious money through.
5. **It is demonstrable.** The dashboard can run repeatable scenarios live, and the phone app
   shows the customer-side experience. A project you can demonstrate beats one you can only
   describe.

What keeps it from being "excellent" as it stands (detailed in section 4):

- The accuracy numbers are on synthetic data and are cross-validation results, so they are
  optimistic.
- The agent layer has not been measured quantitatively. We claim it clears false alarms, and
  the demo shows it, but there is no table proving how much it improves precision.
- A few shortcuts in the agent code (hard-coded "known mule" account IDs) undermine the claim
  that the agents reason.
- The dashboard shows 21 hand-built accounts, not the 893,216 scored accounts.

None of these is fatal. Most can be addressed or at least openly acknowledged. An examiner
rewards a team that knows its own limitations far more than one that is surprised by them.

---

## 2. What has been implemented properly

### 2.1 Machine learning (Member C)
- A reproducible synthetic dataset generator built on the PaySim log, with injected fraud
  rings of five shapes and four kinds of innocent look-alike groups, each with ground-truth
  labels.
- Group-aware splitting into folds so a fraud ring is never split between training and test.
  This is the correct way to avoid leakage in graph data and is a real strength.
- A baseline XGBoost model, and a progression of feature sets (profile only, plus transaction
  behaviour, plus neighbourhood features), showing measurable gains at each step.
- GraphSAGE models, including an edge-aware version that uses payment amount, timing and type.
- A systematic comparison of models and several ways of combining them (weighted averaging,
  rank averaging, calibrated ranks, validation-optimised weights, stacking).
- A documented operating point: blend of 0.3 XGBoost and 0.7 GraphSAGE, flag at 0.85, warn at
  0.70, with metrics reported as mean and spread across folds.
- Out-of-fold scores for all 893,216 accounts, precomputed into one table, with integrity
  checks (row counts, uniqueness, range, metric reproduction) before serving.
- A small FastAPI service that answers a score request in a few milliseconds from memory.

### 2.2 Agentic layer (Member B)
- A four-stage sequential pipeline (Investigator, Decision, Action, Report) built on LangGraph.
- Prompts that encode domain knowledge: mule topologies, innocent look-alike patterns, and how
  to interpret disagreement between the two models.
- Structured, schema-validated model output with retries and a timeout.
- Deterministic fallbacks at every stage so the pipeline always returns an answer even without
  the language model.
- A hard-rule pre-filter before the language model, so clear-cut cases never depend on the
  model's mood.
- A pluggable action backend (simulated by default) and an auditable report.
- Pluggable data providers (mock, CSV, database) so the agent can run on different sources.

### 2.3 Backend and dashboard (Member A)
- The payment gateway: validate, check Layer 1, hold flagged payments, respond immediately,
  investigate in the background, then apply the verdict (freeze, release, or escalate to a
  human), with balances settled exactly once.
- Hard blocking of payments to or from frozen accounts, recorded as blocked transactions.
- Cooldown and de-duplication of investigations; fail-safe holding when the agent fails.
- A feedback memory: accounts cleared by the agents are treated as lower risk for 24 hours.
- Real-time events over sockets to every open client.
- A parser that turns the agent's text report into structured findings for display.
- A service-health endpoint probing every dependency with real latency.
- A 3D operations dashboard: role-shaped glowing nodes, flowing payment particles, camera
  flights, shockwave effects, filters, three layouts.
- An Attack Director with five narrated scenarios running through the real pipeline, plus
  background traffic with optional fraud injection.
- Case file with the pipeline stepper, verdict, model comparison, rationale, risk factors,
  evidence, analyst override buttons and a printable suspicious-activity report.
- Cases, Accounts and Intelligence views, including the ML team's own evaluation table.
- A mobile-style UPI app showing the customer's experience of warnings, held payments and
  final outcomes.

### 2.4 Integration
- All four services genuinely talk to each other, verified end to end with the real ML service,
  the real agent pipeline, a database and a real browser.
- The mapping between demo accounts and real model-scored accounts means the scores shown are
  real model output.

---

## 3. Is it "AI" or just rules? (Expect this question)

Be prepared to answer precisely:

- **Layer 1 is genuinely machine learning:** trained models, measured on held-out data.
- **Layer 3 is a hybrid:** a language model reasons over structured evidence, but a layer of
  hand-written rules sits in front of it and overrides it in some cases. This is a legitimate
  and common design (policy rules plus model judgment), as long as you describe it honestly
  as a hybrid, not as a pure autonomous AI.
- **The suspicion score is not a trained probability.** It is a rule-guided language-model
  judgment, or one of a few fixed values when the model is offline.
- **The dashboard is a presentation and control layer.** It computes statistics but contains no
  detection logic.

Saying this up front shows understanding. Claiming "the AI decides everything" invites a
question the team cannot defend.

---

## 4. Weaknesses and risks, ranked by how likely an examiner finds them

### 4.1 No quantitative evaluation of the agent layer (highest priority)
The ML half has a rigorous table. The agent half has demos. The central claim of the project is
"Layer 3 fixes Layer 1's false positives", yet there is no number for it.

**What to do:** run the agent pipeline over a labelled set of flagged accounts (for example
all dataset accounts flagged at 0.85 that belong to a ring or a decoy group, a few hundred are
enough) and report, per outcome, how many fraud accounts were blocked or escalated and how many
decoys were cleared. Then state the precision after Layer 3 next to the 44% before. Even a
modest, honest improvement is a strong result. This single table turns a demo into evidence.
Caveat to state: the agent needs profile and neighbour data for those accounts, which requires
the transaction and account files that are not in the repository.

### 4.2 Hard-coded known-mule account IDs in the agent
The agent code treats four specific account IDs as "known mules" and forces a block for them.
Two of those are the demo accounts. An examiner reading the code will see that the headline
demo result is partly pre-decided.

**What to do:** remove those shortcuts, or replace them with a general, explainable rule (for
example "account younger than 30 days with a victim inflow and a sink outflow"). Then re-run
the scenarios and confirm they still end the same way for the right reasons. If the team
prefers to keep the shortcut as a safety net, say so openly and explain why.

### 4.3 Synthetic data and optimistic metrics
The dataset is PaySim plus rings the team generated, and the models are scored by
cross-validation, not on a final untouched test set. An area-under-curve of 0.99 reflects how
distinctive the injected rings are.

**What to do:** state it plainly as a proof of architecture. Add a one-line limitation in the
report. Optionally hold out one fold or a regenerated dataset with a different seed as a true
final test and report that too.

### 4.4 The dashboard does not show the full population
Only 21 hand-built accounts appear, because the topology files are not in the repository and a
3D browser view cannot draw 893K nodes.

**What to do:** add a population panel (counts at each threshold, score histogram, searchable
top-flagged list). Optionally import the real ring and decoy subgraphs once the topology files
are available. The explanation in the dashboard guide covers this if it cannot be built.

### 4.5 The language model has not been tested with the intended model
The intended model (a small Llama) is not installed; tests ran in fallback mode and a quick
check with a different small model. Behaviour and speed will differ.

**What to do:** install the intended model, run every scenario three times, and record the
results. Check that the verdicts are stable.

### 4.6 Security is prototype-grade
No login for analyst actions, open cross-origin settings, simulation controlled by a single
flag. Acceptable for a prototype if stated; indefensible if claimed as production-ready.

**What to do:** add a simple analyst PIN or token for action endpoints, tighten allowed origins,
and list the rest as future work.

### 4.7 Documentation drift
Some older documents describe a previous design (a different graph library, different member
labels, numbers that no longer match). An examiner who opens them may see contradictions.

**What to do:** refresh or remove outdated documents. The new documents in `docs/` are meant to
be the current truth.

### 4.8 No automated tests for the gateway and dashboard
The ML service has a test file; the backend and frontend rely on manual and scripted browser
checks.

**What to do:** add a small set of backend tests for the payment path (frozen sender, held
payment, release, escalation) so you can show a passing test run.

---

## 5. Recommended work plan before presenting

**Must do (highest value for effort):**
1. Install the intended language model and run all scenarios; record results.
2. Build the Layer 3 evaluation table (section 4.1), even on a modest sample.
3. Remove or openly justify the hard-coded known-mule shortcuts.
4. Rehearse the live demo end to end at least three times, including a failure (kill a service)
   to show the fail-safe.
5. Prepare a backup: a recorded screen capture of the full demo in case of network, memory or
   service problems on the day.
6. Reseed the demo data before every run-through.

**Should do:**
7. Add the population view to the dashboard.
8. Add analyst PIN and tighter cross-origin settings.
9. Add a few backend tests and keep a screenshot of them passing.
10. Update or remove outdated documents; make one README the entry point.
11. Create a one-page architecture diagram (three layers, four services, data flow).

**Nice to have:**
12. Import real ring and decoy subgraphs into the 3D view.
13. Hold out a true final test set and report it.
14. Show a per-layer latency budget (Layer 1 milliseconds, gateway tens of milliseconds, agents
    seconds).
15. Add a small "what-if" panel where the examiner types a payment and watches it flow.

---

## 6. Suggested presentation structure (about 20 minutes)

1. **Problem (2 min).** UPI fraud is instant and irreversible; mule chains and smurfing; why
   single models over-flag; the 25-minute human triage problem.
2. **Architecture (3 min).** Three layers and four services on one slide. Who built what.
3. **Member C: data and models (4 min).** Dataset construction, group-aware folds, the model
   progression, the metrics table, the 44% precision finding.
4. **Member B: agents (4 min).** Why a second layer, the four stages, hybrid rules plus
   language model, fail-safes, the false-alarm clearing, the evaluation table if built.
5. **Member A: gateway and dashboard (5 min, live demo).** Run the mule chain, the false alarm
   and the takeover scenarios; show the analyst override; show the phone app.
6. **Limitations and future work (2 min).** State them yourselves.
7. **Questions.**

Each member should be able to answer questions about the *other two* layers at a high level,
because examiners often ask the wrong person.

---

## 7. How to answer the three hardest questions

**"Is this real data?"** The base is a public simulated mobile-money dataset; fraud structures
were injected by us with known labels. It demonstrates the method, not real-world accuracy.

**"Why do you need agents? Just raise the threshold."** Raising the threshold trades recall for
precision and still cannot tell a payroll account from a mule. The agents use context the models
do not see, like tenure, KYC, retained balance and what the neighbours are, and can explain
their decision. Our measurements show the single model alone is only 44% precise.

**"What if the AI is wrong?"** There are three safety nets: uncertain cases are escalated to a
human, AI failure leads to a hold not an approval, and a human can override any decision from
the dashboard with an audit record.

---

## 8. Final judgment

A well-scoped, well-integrated, demonstrable system with an honest evaluation of its first
layer. With the agent-layer evaluation, the removal of hard-coded shortcuts, a tested language
model and a rehearsed demo, it is comfortably a strong final-year project. Without them it is
still a good one, provided the team states its limits before being asked.
