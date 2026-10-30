# Member B: The Agentic Investigation Layer (Layer 3) in Full Detail

This document explains, in plain language and without code, how the agentic layer works: why it
exists, how the four agents are arranged, what each one reads and produces, how decisions are
made, how failures are handled, and what the honest limits are. Use it to present this layer
with full understanding.

Contents:
1. Why a third layer exists
2. What "agentic" means here
3. The technology stack
4. The pipeline as a whole
5. The shared state (the case file the agents pass along)
6. Agent 1: the Investigator
7. Agent 2: the Decision agent
8. Agent 3: the Action agent
9. Agent 4: the Report agent
10. How the language model is called safely
11. Fallbacks: what happens without the language model
12. Where the data comes from (providers)
13. The service interface
14. How the suspicion score and verdict are produced
15. The innocent look-alike logic in depth
16. Worked examples (five cases, step by step)
17. Strengths
18. Limits and honest caveats
19. Suggested improvements
20. Questions an examiner may ask, with answers
21. Glossary

---

## 1. Why a third layer exists

Layer 1 produces a score. At the operating threshold only about 44 percent of flagged accounts
are truly mules. So if the system simply blocked everything above the threshold, more than half
of the blocked customers would be innocent: shopkeepers, employers paying salaries, family
members. That is unacceptable for a payment system.

A human fraud analyst handles this by **investigating**: looking at the account's age,
verification, balance, who it trades with, whether the two models agree, and then deciding to
block, release or ask a colleague. A human takes roughly 25 minutes per case, and by then the
money is gone.

Layer 3 automates that investigation. It does not replace the human; it does the routine work
in seconds, and passes only the genuinely ambiguous cases to a person.

The layer has three goals:
1. **Speed:** replace a long manual triage with a pipeline that finishes in seconds.
2. **Precision:** clear the false alarms Layer 1 raises, especially on honest look-alikes.
3. **Explainability:** leave a written trail of why each decision was made.

---

## 2. What "agentic" means here

An **agent** is a software component that takes in a situation, reasons about it (often with a
language model), and produces a result or action. "Agentic" systems chain several such
components, each with a defined role, so the whole behaves like a small team.

In this project the team is a **sequential pipeline of four specialists**, like a small
investigation department:

1. **The Investigator** gathers and interprets the evidence.
2. **The Decision agent** applies policy and decides.
3. **The Action agent** carries out the decision.
4. **The Report agent** documents everything.

It is deliberately a straight line rather than a free-form swarm. Each agent has a narrow job,
which makes behaviour predictable and easy to explain. That predictability is a feature in a
regulated domain.

It is also a **hybrid**: language-model reasoning is combined with fixed rules and
deterministic fallbacks. The rules guarantee behaviour in clear-cut cases; the model handles the
ambiguous middle; the fallbacks guarantee an answer even if the model is unavailable.

---

## 3. The technology stack

- **LangGraph:** a framework for wiring agents as a graph of steps passing a shared state. It
  gives the pipeline a clear definition: start, investigator, decision, action, report, end.
- **A local language model through Ollama:** the model runs on the team's own machine. No
  customer data leaves the computer, there is no per-call cost and no rate limit. The intended
  model is a small Llama; any locally installed model can be substituted by configuration.
- **A low "temperature" setting:** the model is set to be as deterministic as possible so that
  the same case tends to produce the same answer.
- **Pydantic schemas:** every model reply must match a strict structure (fields, types, ranges).
  Replies that do not match are rejected.
- **FastAPI:** exposes the pipeline as a web service.
- **Pluggable data providers:** the pipeline can read account data from a built-in mock set,
  from the ML team's files, or from the database.

---

## 4. The pipeline as a whole

When the gateway flags a payment, it asks the agent service to investigate the receiving
account. The service builds a **case**, hands it to the pipeline and returns the outcome.

The journey of one case:

1. **Intake:** the request names the account. Optionally the gateway also sends a *snapshot of
   the account and its neighbourhood* (profile, recent payments, who it traded with and how
   those counterparties are labelled). If it does not, the service loads the data itself.
2. **Investigator:** studies the evidence and produces findings, including a **suspicion
   score**.
3. **Decision agent:** takes the findings and applies policy to produce one of three verdicts.
4. **Action agent:** translates the verdict into an enforcement directive and an audit record.
5. **Report agent:** writes a structured, human-readable report.
6. **Return:** the service returns the verdict, the action taken and the report.

Typical duration is around ten seconds in fallback mode and varies with the language model's
speed. This is why the gateway does not make the customer wait: the payment is held and the
verdict arrives later.

---

## 5. The shared state (the case file the agents pass along)

All four agents read from and write to one shared record, like a case folder passed from desk
to desk. It holds:

- **Input:** the account identifier and the account snapshot.
- **Investigator's findings:** suspicion score, risk level, which fraud patterns were seen,
  which innocent look-alike (if any), confidence, risk factors, a short summary, and an
  evidence list.
- **Decision:** the verdict, the reasoning, which rule fired, and a confidence value.
- **Action:** what was done, the resulting account status and execution details.
- **Report:** the final text.

Because everything is in one structured record, every step is auditable and each agent can be
tested in isolation.

---

## 6. Agent 1: the Investigator

### 6.1 Job
Turn raw account data and Layer 1's scores into a **forensic assessment**: what is going on,
how suspicious is it, and could this be an innocent look-alike?

### 6.2 What it reads
- **Profile:** age, verification level, balance, average payment size, payments per day,
  number of counterparties, device identifier, category (for example merchant or personal).
- **Layer 1 scores:** the blended score and both individual model scores.
- **Neighbourhood:** the accounts it paid or was paid by, each labelled by the gateway as a
  victim, a sink, a flagged mule, a high-risk account or a normal account.
- **Recent payments.**
- **Pre-computed factual signals:** whether there is a victim inflow, a sink outflow, a mule
  neighbour, a suspicious device, and whether those together make a confirmed mule chain.

### 6.3 How the language model is briefed
The model receives a long, carefully written briefing that teaches it the domain:

**Genuine fraud patterns:**
- *Mule-chain layering:* money passes quickly through new accounts, little is retained, minimal
  verification, immediate relay to a sink.
- *Star-burst smurfing:* a large credit is split into amounts under the ten-thousand-rupee
  reporting limit and dispersed to leaf accounts.
- *Cycle:* money loops through accounts to fake turnover and ends in a cash-out.
- *Fan-out syndicate:* a source feeds several relays that converge on an aggregator.
- *Account takeover:* a sudden change of device or network (emulator, Linux, anonymising
  network), odd hours, payment sizes far from history.

**Innocent look-alikes to clear:**
- *Merchant hub:* many small customer payments, regular payouts, long tenure, verified, healthy
  balance.
- *Payroll fan-out:* an established company paying salaries on a fixed cycle.
- *Forwarding chain:* friends or flatmates splitting rent and bills at human pace.
- *Family group:* relatives sending money both ways, verified, long history.

**Model divergence rule:** if the graph model is very high and the tabular model is low, the
account was probably flagged only because of who it is connected to; with verified
identification and long tenure, that suggests an innocent look-alike.

The briefing also tells the model the key fact: at the flag threshold the first layer is only
about 44 percent precise, so it must actively look for innocents.

### 6.4 What it produces
A structured assessment: a suspicion score from zero to one hundred, a risk level, true/false
flags for each fraud pattern, which innocent look-alike it believes it is (or none), a
confidence for that, a short rationale, whether the two models disagreed, a list of risk
factors, a two-to-three-sentence summary and an evidence list.

### 6.5 The correction layer after the model
After the language model answers, the Investigator applies a **ground-truth alignment step** in
code. This is where hand-written rules refine or override the model's output, in a fixed
order:

1. **Verified innocent look-alike.** If the account is older than 90 days, fully
   biometrically verified, holds more than a few thousand rupees, shows no suspicious device,
   has a low tabular-model score, and its category or name marks it as merchant, payroll,
   family or forwarding, then it is treated as a verified decoy. The suspicion score is capped
   low, fraud flags are cleared, divergence is noted and the rationale explains it. This holds
   only if there is no victim or sink connection and the account is not on the known-mule list.
2. **Suspicious environment without a confirmed ring.** If the device or neighbours indicate
   takeover (emulator, Linux, anonymising network, crypto link) but no mule ring is confirmed,
   the score is set to a moderate-high fixed value with high risk. This is the case that later
   gets escalated to a human.
3. **Confirmed mule.** If there is a victim or sink neighbour (or a mule neighbour on a very
   new account) together with low balance or very young age, or the account is on the
   known-mule list, the score is raised to at least the critical range and the mule-chain flag
   is set.

The reason for this layer: small local language models are inconsistent. The rules pin down the
behaviour for cases where the domain logic is unambiguous.

---

## 7. Agent 2: the Decision agent

### 7.1 Job
Turn findings into one of three verdicts under a clear policy:

- **Auto-block:** high-confidence genuine fraud. The account is frozen.
- **Clear:** benign or an innocent look-alike. Payments are released.
- **Escalate:** ambiguous. A human takes over; the account is held and a step-up challenge is
  indicated.

### 7.2 Two stages

**Stage 1: hard rules (run first, in order).**
1. *Decoy cleared.* If the Investigator identified an innocent look-alike with high confidence
   and the account is old and fully verified, clear it.
2. *Confirmed mule layering.* If the suspicion is very high and Layer 1 is at or above the flag
   threshold, or the mule signals are present on a very young, nearly empty account (and there
   is no decoy), auto-block.
3. *Star-burst smurfing.* If the splitting pattern is detected with a high suspicion score on a
   young account, auto-block.
4. *Benign baseline.* If suspicion is low, there are no victim or sink links, no pattern flags,
   and Layer 1 is below the warning threshold, clear. A safety guard ensures an account with
   victim or sink links, or a Layer 1 score in the warning band, is never cleared by this rule.

**Stage 2: language-model judgment.** Only cases that no hard rule settles reach the model.
It acts as a "chief risk officer": it receives the scores, the Investigator's findings and the
policy framework, and must answer with a verdict, a short reasoning and a confidence. The
policy text reminds it that over-flagging is expected and that it must clear honest merchants,
payroll, family and expense-sharing accounts, and that genuinely ambiguous anomalies should be
escalated.

### 7.3 Why rules first
Clear-cut cases should not depend on a language model's variability. Rules give determinism,
speed and auditability where the situation is unambiguous. The model is reserved for grey
areas.

### 7.4 Safety default
If the model's answer is missing or invalid, the verdict defaults to **escalate**, never to
clear. Uncertainty leads to a human, not to approval.

---

## 8. Agent 3: the Action agent

### 8.1 Job
Convert the verdict into a concrete directive for the payment system and record it.

### 8.2 The mapping
- Auto-block leads to an **account-frozen** status and a freeze directive.
- Escalate leads to a **flagged-for-review** status, a step-up verification challenge and a
  place in the human queue.
- Clear leads to a **cleared** status and release.

### 8.3 Pluggable backends
Execution is separated from decision through an interface:
- **Simulated backend (default):** logs the action and produces an audit record without
  changing anything. Safe for demos and testing.
- **Database backend:** writes the status to the database.

The gateway applies its own real effects (freezing, releasing payments, settling balances), so
the agent runs in simulated mode. This avoids two systems both trying to own the account's
state. Describe it as a clean separation: *the agents decide and recommend; the gateway
enforces.*

### 8.4 Important honesty point
The Action agent does not move money. In this prototype, "freeze" is a status in the project's
own database, not an instruction to a real bank.

---

## 9. Agent 4: the Report agent

### 9.1 Job
Produce the written record that a compliance officer or regulator would expect.

### 9.2 What the report contains
- Case header and time.
- Account and verdict.
- Layer 1 scores, including the two individual models and their blend.
- Pattern or topology detected.
- Summary, evidence, risk factors and model-divergence note.
- The decision reasoning and which rule applied.
- The action executed.

### 9.3 Why it matters
- **Explainability:** every decision has a readable justification.
- **Auditability:** the same text is stored with the case and can be printed as a suspicious
  activity report.
- **Integration:** the gateway parses this text back into structured fields for display. The
  parser is designed to handle both the current and an older report layout.

---

## 10. How the language model is called safely

Every call to the model passes through one safe wrapper that provides:

- **Structured output:** the model is told to answer with strict JSON; the reply is extracted
  from surrounding text if needed and validated against the schema.
- **Validation:** type and range checks (for example, a score must be an integer between zero
  and one hundred).
- **Timeout:** a hard time limit so a slow model cannot stall the pipeline.
- **Retry:** one retry after a short pause.
- **Fallback:** if all attempts fail, a deterministic function supplies the answer.
- **No uncaught errors:** the wrapper never throws; the pipeline always completes.
- **Low temperature:** minimises randomness.

The principle: **the pipeline must always return an answer**, and it must never hang.

---

## 11. Fallbacks: what happens without the language model

If the model is not running, each stage that uses it switches to rules.

**Investigator fallback (fixed outcomes):**
- Recognised innocent look-alike: low suspicion, fixed low value.
- Confirmed mule chain or fresh star-burst: critical, fixed very high value.
- Device anomaly or Layer 1 score in the warning band or higher: high, fixed moderately high
  value.
- Otherwise: low, fixed low value.

**Decision fallback:** based on the suspicion score and detected patterns, choosing block,
escalate or clear with the same logic family as the hard rules.

Consequences to explain:
- The system is fully functional without the model, just less nuanced.
- In fallback mode the suspicion score takes only a few distinct values, so the dashboard may
  show the same numbers repeatedly. This is expected.
- It is a deliberate resilience feature, and a good one to demonstrate by turning the language
  model off during the demo.

---

## 12. Where the data comes from (providers)

The agent needs account facts. A provider abstraction supplies them from:

1. **Mock provider:** a small built-in set of accounts for development and for the cached demo.
2. **CSV provider:** loads Layer 1 scores from the ML team's table and account/payment files
   if present. The score table is in the repository; the account and payment files are not, so
   profile data is missing in this mode unless supplied.
3. **Database provider:** reads from the project's database.

In the integrated system the gateway **supplies the account snapshot with the request**, built
from the live database, including neighbour labels. This makes the investigation work on the
current state of the network and avoids dependence on the missing files. Explain it as "the
gateway hands the agents a fresh case file."

---

## 13. The service interface

- **Health:** reports service status.
- **Account list:** lists known accounts.
- **Predict:** a fallback scorer used by the gateway when the ML service cannot score an
  account. It uses heuristics and the same thresholds.
- **Investigate:** runs the whole pipeline for an account and returns the verdict, action,
  report and timing.

Cross-origin access is restricted to the known local addresses.

---

## 14. How the suspicion score and verdict are produced

Putting it together for a single case:

1. The language model reads the profile, scores and neighbours and proposes a score and flags.
2. The correction layer enforces domain logic: decoy cap, takeover value, mule floor.
3. The Decision agent reads the final suspicion score together with the Layer 1 blended score,
   the flags, the account age, balance and verification.
4. Hard rules fire if their conditions hold; otherwise the model decides, with escalate as the
   default.

Two numbers must not be confused:
- **Layer 1 score:** statistical, from trained models, between zero and one.
- **Suspicion score:** the Investigator's judgment, between zero and one hundred. It is *not a
  trained probability*. It is produced by the language model and nudged by rules, or takes one
  of a few fixed values in fallback mode.

The verdict depends on **both**: the first layer's statistical score is a precondition for
blocking (a very suspicious-looking account with a low Layer 1 score is not automatically
blocked) and the Investigator's contextual judgment decides between block, clear and escalate.

---

## 15. The innocent look-alike logic in depth

This is the layer's most valuable contribution, so be able to explain it.

**Why graph models flag innocents:** a payroll account pays many people at once. In the graph it
looks like a hub with many outgoing edges, exactly like a fraud fan-out. A merchant receives
many small payments, like a star hub. Flatmates pass money like a chain. Relatives exchange
money like a cycle. Graph proximity to those shapes raises the score.

**What distinguishes them in reality:**
- *Time on the platform:* innocents have long history; mules are days old.
- *Verification:* innocents are fully verified; mules have minimal verification.
- *Retained balance:* innocents hold money; mules pass it on immediately.
- *Regularity:* payroll follows monthly cycles; mules act in bursts.
- *Counterparty quality:* innocents trade with normal accounts; mules touch victims and sinks.
- *Model disagreement:* a high graph score with a low tabular score is a tell-tale of
  "flagged by association".

The agent checks these facts in order and, if they point to innocence, clears the account and
says why. The customer's payment is then released, and the gateway remembers the clearance for
24 hours so the next legitimate payment is not blocked again.

---

## 16. Worked examples

### Case 1: Mule relay
A four-day-old account with almost no balance, two victim inflows and an outflow to an offshore
sink. Layer 1 score is near the maximum. Investigator: mule-chain flagged, suspicion in the
nineties, critical. Decision: hard rule for confirmed mule layering fires. Action: freeze.
Report: mule topology, evidence of victim and sink links. **Result: auto-block.**

### Case 2: Smurfing hub
A new account receives a large sum and starts splitting into uniform sub-limit amounts. Star
pattern detected with high suspicion on a young account. Decision: smurfing rule fires.
**Result: auto-block.**

### Case 3: Account takeover
An older legacy account whose device suddenly appears as a different operating system behind an
anonymising network, followed by large transfers toward a crypto desk. No victim or sink ring
is confirmed. Investigator sets a moderate-high fixed suspicion with high risk. No hard rule
fits; the model weighs it and the policy for ambiguous anomalies applies. **Result: escalate** to
a human analyst, with a step-up challenge.

### Case 4: Payroll company (false positive)
Layer 1 scores it 0.91 because it fans money out to many employees. It is old, fully verified,
holds a large balance and has no victim, sink or suspicious device. Models disagree: the graph
model is high, the tabular model low. Investigator: verified payroll look-alike. Decision: the
decoy-cleared rule fires. **Result: clear**, payments released, clearance remembered.

### Case 5: Flatmate rent split
Layer 1 scores it very high because of chain-like forwarding. It has long tenure, verified
identification and balance retention. **Result: clear.**

---

## 17. Strengths

- Clear, explainable pipeline with defined roles.
- Hybrid design: rules for certainty, model for ambiguity, fallbacks for resilience.
- Domain knowledge encoded in the briefing, including the hardest part: innocent look-alikes.
- Never hangs, never throws, always returns a result.
- Safe defaults: uncertainty escalates; failure holds.
- Local model: private, free, no rate limits.
- Pluggable providers and action backends.
- Auditable written report per case.

---

## 18. Limits and honest caveats

1. **No quantitative evaluation of this layer yet.** Demonstrations show correct outcomes, but
   there is no table measuring precision and recall after Layer 3 on a labelled set.
2. **Hard-coded known-mule identifiers.** The code lists four specific account identifiers as
   known mules and forces a block for them; two are the demo accounts. This makes the headline
   demo partly pre-decided and should be removed or justified.
3. **Rules that look at names and categories.** Some rules decide "merchant" or "payroll" from
   the account's name or category label. In real data those labels may not exist; this is a
   stand-in for properly derived features.
4. **The suspicion score is not calibrated.** It is a heuristic and language-model judgment.
5. **Small local model.** Smaller models are less reliable; that is why rules back them up.
   Results with the intended model have not been fully tested.
6. **Hybrid nature.** Rules sometimes override the model. Describe it honestly as policy plus
   model, not pure autonomy.
7. **Only a straight-line pipeline.** There is no branching, re-investigation or tool use such
   as querying more data mid-case.
8. **Simulated actions.** Nothing is enforced at a real bank.
9. **Data availability.** Account and payment files used by the CSV provider are not in the
   repository; the integrated system works around this by sending the snapshot from the gateway.

---

## 19. Suggested improvements

1. Build an evaluation: run the pipeline over a labelled sample of flagged accounts and report
   precision and recall after Layer 3.
2. Remove the known-mule shortcut or replace it with a general rule.
3. Test with the intended language model and record consistency across repeated runs.
4. Let the Investigator request more data (tool use): for example, expand to a third hop.
5. Add a confidence-based escalation: escalate when the model's confidence is low.
6. Add per-stage timing from the service so the dashboard shows real stage durations.
7. Log every decision with its inputs for later replay and audit.
8. Calibrate the suspicion score against labelled outcomes.

---

## 20. Questions an examiner may ask, with answers

**Why agents instead of one more model?** Because the missing information is contextual and
explanatory: tenure, verification, balance, neighbour labels, model disagreement. A rules and
language-model pipeline can use and explain it; another statistical model would need labelled
examples of exactly these look-alikes and would still not explain.

**Why four agents?** Separation of concerns: analysis, policy, enforcement and documentation
are different jobs with different failure modes. Splitting them makes each testable and the
whole auditable.

**Is the language model making the decision?** In ambiguous cases yes, within a fixed policy
and with rules around it. In clear-cut cases, rules decide. We call it a hybrid.

**What if the model hallucinates?** Output is schema-validated; invalid output is rejected;
rules constrain results; fallbacks substitute; escalation is the default.

**Why run a local model?** Privacy, cost and availability: no customer data leaves the machine.

**How do you know it works?** Scenario tests with the real pipeline show correct outcomes for
five fraud and benign cases. A larger quantitative evaluation is planned work.

**What is the suspicion score?** The Investigator's judgment between zero and one hundred; not a
calibrated probability.

**What stops it blocking innocents?** The decoy logic, the Layer 1 precondition for blocking, the
escalation default and human override.

**Does it actually freeze accounts?** The agents recommend; the gateway applies a freeze status
in our database. It is a simulation of the bank action.

---

## 21. Glossary

- **Agent:** a component with a defined role that reasons and acts.
- **LangGraph:** framework to connect agents into a pipeline with shared state.
- **LLM / Ollama:** language model and the local server that runs it.
- **Temperature:** randomness control of the model.
- **Schema validation:** checking that output has the expected structure.
- **Hybrid decision:** rules plus model judgment.
- **Fail-safe:** behaviour on failure that avoids harm (hold, not approve).
- **Escalate:** hand over to a human.
- **Decoy / look-alike:** innocent account pattern resembling fraud.
- **Model divergence:** the two Layer 1 models disagree.
- **Step-up challenge:** extra verification, for example a second factor.
- **SAR:** suspicious activity report.
