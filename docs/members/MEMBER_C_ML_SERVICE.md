# Member C: The Machine Learning Layer (Layer 1) in Full Detail

This document explains, in plain language and without code, everything that happens in the
machine learning part of FraudGuard AI: the data, the features, the models, how they were
trained and judged, how the final score is produced, and how it is served. Use it to present
this layer with full understanding.

Contents:
1. Purpose of this layer
2. The problem in ML terms
3. The dataset: what it is and how it was made
4. Ground truth and labels
5. Splitting the data: why it is done by group
6. Feature engineering (three feature groups)
7. Model 1: XGBoost
8. Model 2: GraphSAGE (and the edge-aware version)
9. The experiments: how the final design was reached
10. Combining the models (ensembling)
11. Choosing thresholds
12. Evaluation: metrics explained
13. The results and how to read them
14. Out-of-fold scores and the precomputed table
15. The serving API
16. Integrity checks and reproducibility
17. Strengths, limits and honest caveats
18. Questions an examiner may ask, with answers
19. Glossary

---

## 1. Purpose of this layer

Layer 1 answers one question, very fast: **"How likely is it that this receiving account is a
mule account?"** It is the first line of defence. It runs before a payment settles, so it has
to be quick (a few milliseconds) and it has to cover every account in the system.

It is designed to be **sensitive**: to catch nearly all mule accounts. The price of that
sensitivity is that it also raises some false alarms. Handling those false alarms is the job of
Layer 3 (the agents), not Layer 1. Understanding this division of labour is the key to
presenting the ML work correctly: Layer 1 is not supposed to be perfect, it is supposed to
be a great filter.

---

## 2. The problem in ML terms

- **Task:** binary classification at the **account level**. Each account is labelled mule
  (positive) or not (negative).
- **Unit of prediction:** an account, not a single transaction. This matters because a mule
  account is defined by its behaviour over time and its position in a network of payments, not
  by one payment.
- **Class imbalance:** mule accounts are rare. A model that always says "not a mule" would be
  almost perfectly accurate and completely useless. So plain accuracy is never used; the project
  uses ranking and precision/recall measures instead (explained in section 12).
- **Graph nature:** fraud rings are connected structures. Money moves along edges between
  accounts. A single-account view misses the pattern "this account is two hops from a known
  sink". That is why a graph model is used alongside a tabular model.

---

## 3. The dataset: what it is and how it was made

### 3.1 The base: PaySim
PaySim is a well-known public **simulated mobile-money dataset**. It imitates the behaviour of
a real mobile-money service: customers, merchants, transfers, payments, cash-ins, cash-outs,
with a time step per hour. Because it is a simulation, it contains no real personal data and
can be shared freely.

The project samples roughly **half a million normal accounts** from it. This is the "ordinary
population": people paying merchants and each other.

### 3.2 What was added: injected fraud and decoys
Real mule data is private and not available to students, so the team **generated** it. The
generator creates two kinds of groups and plants them in the population.

**Fraud rings (150 groups), in five shapes:**
1. **Chain (40):** money passes quickly from account to account in a line, each hop keeping
   almost nothing, ending in a cash-out. This is "layering".
2. **Star (35):** one hub receives a big sum and splits it into many small pieces to leaf
   accounts, each piece below a reporting limit. This is "smurfing".
3. **Cycle (25):** money loops around a ring of accounts to create the appearance of
   legitimate turnover.
4. **Fan-out (25):** a source feeds several relays that converge on an aggregator.
5. **Hybrid (25):** combinations of the above.

**Innocent look-alike groups, called decoys (175 groups), in four kinds:**
1. **Merchant hubs (60):** a shop that receives many small payments from many customers. It
   looks like a star hub.
2. **Payroll fan-outs (25):** a company paying many employees on a schedule. It looks like a
   fan-out.
3. **Forwarding chains (50):** friends or flatmates passing money to each other to split
   expenses. It looks like a chain.
4. **Family groups (40):** relatives sending money back and forth. It looks like a cycle.

### 3.3 Why decoys are the clever part
If you plant only fraud, a model can learn "any hub is fraud" and score brilliantly while being
useless. Decoys force the models to learn the difference between **structure that is
suspicious** and **structure that merely resembles it**. Each decoy deliberately mimics a fraud
shape but differs in subtler properties: account age, verification level, balance retention,
timing and regularity. This is what makes the evaluation meaningful and what later motivates
the agent layer, because the hardest cases are exactly the decoys.

### 3.4 Account and payment records
Each account carries profile information: age in days, verification (KYC) level, balance,
average payment size, payments per day, number of distinct counterparties, device identifier
and network address. Each payment carries sender, receiver, amount, type, time and flags
recording whether it belongs to a planted group. Together they form the **payment graph**:
accounts are nodes, payments are directed edges.

### 3.5 Final size
About **893,216 accounts**. Of these, only a few thousand are planted group members; the rest
are the ordinary PaySim population.

---

## 4. Ground truth and labels

Because the team created the rings, it knows exactly which accounts are mules. Two label ideas
are recorded:

- **Touch label:** the account took part in a planted group in any way.
- **Mule label:** the account is a true mule (as opposed to an innocent participant such as a
  victim paying in, or a decoy member).

The mule label is the training target. Decoy members are labelled **not mule**, which is what
teaches the model to stay quiet on look-alikes. Each account also records its role in its group
and the type of ring or decoy, which is used later to report results per shape.

An important honesty point: all labels are simulation labels, produced by the dataset and the
generator, not investigator-confirmed real-world labels. (Member C should confirm exactly how
labels for the ordinary PaySim accounts were derived before presenting, since that step lives
in the dataset-generation script.)

---

## 5. Splitting the data: why it is done by group

### 5.1 The leakage problem in graph data
In a normal tabular problem you split rows randomly into train and test. In a graph this is
dangerous: if some members of a ring are in training and others in testing, the model has seen
the ring's pattern and its neighbours, so the "test" accounts are not truly unseen. The score
would look excellent and mean nothing.

### 5.2 The solution: split by group
The project assigns **whole groups** (all accounts of one ring or decoy) to one side. A ring is
either entirely in training or entirely in testing. Ordinary accounts not in any group are
split with stratification so each side has a similar fraud rate.

### 5.3 Folds
For cross-validation the groups are shuffled and dealt into **five folds**. In each round, four
folds are used for training and one is held out. Over five rounds every account is held out
exactly once.

### 5.4 Validation inside training
Within each round's training portion, about ten percent of the groups are set aside as
**validation**. Validation is used to decide when to stop training, to calibrate scores and to
choose blend weights. The held-out fold is never used for those decisions. Three roles
therefore exist per round:

- **Train:** the model learns from this.
- **Validation:** tune and stop; never learn weights from it directly.
- **Test (the held-out fold):** the honest exam.

---

## 6. Feature engineering (three feature groups)

Models see numbers, not stories, so the account's behaviour must be turned into features. The
project's experiments name three groups, added one at a time so their value can be measured.

### Group A: account profile
Facts about the account itself:
- age in days (mule accounts are typically very new)
- verification level (mule accounts often have minimal verification)
- current balance (mules retain almost nothing; they pass money on)
- average payment size
- payments per day (velocity)
- number of distinct counterparties

These are cheap and available for every account.

### Group B: transaction behaviour
Derived from the account's payment history:
- number of incoming and outgoing payments
- total received and total sent (on a logarithmic scale, so huge values do not dominate)
- **forward ratio**: how much of what came in went out. Near 1 means pass-through, typical of
  a mule.
- **holding time**: how long money sits between first arriving and first leaving. Mules hold
  money for a very short time.
- **active span**: how long the account has been active
- **shared-device count**: how many other accounts use the same device, a classic fraud
  signal

### Group C: neighbourhood
Describes who the account is connected to:
- number of unique neighbours
- average age of neighbours and the fraction of neighbours that are very young
- average and total degree of neighbours (how connected they are)
- size of the connected component the account belongs to

Intuition: a mule's neighbours are also young, highly connected, and part of a compact cluster.

### Deliberately excluded features
The training scripts keep an explicit **forbidden list**: account identifiers, names, payment
addresses, group identifiers, ring types and other fields that would leak the answer or let
the model memorise. A sanity check refuses to train if a forbidden column slips in. This guard
is a genuine mark of care, so mention it.

---

## 7. Model 1: XGBoost

### 7.1 What it is
XGBoost is a **gradient-boosted decision tree** model. It builds many small decision trees one
after another; each new tree focuses on the mistakes of the previous ones. It is a strong,
fast, standard choice for tabular data.

### 7.2 What it sees
Only the **row of features for one account**. It does not follow edges. Any network knowledge
it has must be pre-computed into the features (Groups B and C).

### 7.3 Training details (baseline)
- 300 trees, maximum depth 5, learning rate 0.1.
- Class imbalance handled by weighting mule examples higher in proportion to how rare they are.
- Objective is binary log-loss; the output is a probability-like score between 0 and 1.

### 7.4 Strengths and weaknesses
- Strengths: fast to train and run, robust, interpretable through feature importance, excellent
  at using profile and behaviour features.
- Weakness: blind to the wider network unless the neighbourhood features capture it. Two
  accounts with identical profiles but different neighbours look the same to it.

### 7.5 The ladder: A, A+B, A+B+C
The team trained three versions to measure what each feature group adds. This is a
mini ablation study:

| Version | Feature groups | Area under ROC | Meaning |
|---|---|---|---|
| xgb_A | profile only | 0.933 | Decent but weak: profile alone is not enough |
| xgb_AB | + transaction behaviour | 0.973 | Big jump: behaviour matters |
| xgb_ABC | + neighbourhood | 0.987 | Another gain: context matters |

The version used in the final blend is the richest one, **xgb_ABC**.

---

## 8. Model 2: GraphSAGE (and the edge-aware version)

### 8.1 What a graph neural network is
A graph neural network learns a representation of each node by **passing messages along
edges**. In each layer, a node collects information from its neighbours, combines it with its
own, and produces a new vector. Stack layers and a node can "see" neighbours of neighbours.
This is exactly the intuition behind "two hops from a sink".

### 8.2 Why GraphSAGE
GraphSAGE ("sample and aggregate") aggregates neighbour information, here by averaging, and
learns how to combine it with the node's own features. It scales to large graphs and can
generalise to nodes it has not seen, which suits a payments network that keeps growing.

### 8.3 What the project's GraphSAGE looks like
- Two message-passing layers, so each account sees up to two hops around it.
- 64-dimensional hidden representation, a dropout rate of 0.3 to reduce over-fitting, and a
  final layer that outputs one score per account.
- Trained with the Adam optimiser, a small weight penalty, and a loss that up-weights the rare
  mule class.
- Early stopping on validation so training ends when the validation measure stops improving,
  with a maximum number of epochs.

### 8.4 The edge-aware improvement
A plain GraphSAGE treats every edge as identical. But payments differ: a 9,900-rupee
transfer 20 seconds after receiving funds is very different from a 200-rupee grocery payment.
The edge-aware model feeds **edge attributes** into the messages:
- the logarithm of the amount
- time gap since incoming payments and since outgoing payments
- payment type (transfer, payment, cash-out and so on)

So the message a neighbour sends includes how and when the money moved. This is the model that
reached the best single-model performance, referred to as **sage_edge_L2** (edge-aware, two
layers). A three-layer version performed about the same, so the simpler two-layer one was kept.

### 8.5 A comparison variant
A graph-attention variant (GAT) was also tried. It performed worse than GraphSAGE here (area
under ROC 0.973 and lower precision-recall), so it was not used. Reporting a model that did
not win is good practice; it shows the choice was made by evidence.

---

## 9. The experiments: how the final design was reached

The repository shows a clear sequence of experiments, each answering a question:

1. **Baseline:** does a simple XGBoost on profile features work at all? (First training script.)
2. **Does a graph model help?** The first GraphSAGE script compares against the baseline.
3. **Ablation:** which pieces matter? Different feature sets and graph variants were run and
   summarised in a table and chart.
4. **Version 2 dataset and comparison:** a revised dataset with decoys and a fair comparison of
   all models under the same group-aware folds.
5. **Edge-aware models:** adding payment attributes to messages, compared side by side with the
   plain versions.
6. **Ensemble study:** combining the best XGBoost and the best GraphSAGE in several ways.

A good way to present this: "We did not pick a model first. We built a ladder of experiments
and let the numbers choose."

---

## 10. Combining the models (ensembling)

### 10.1 Why combine
XGBoost is good at profile and behaviour; GraphSAGE is good at network structure. Their errors
are different, so combining them can beat either alone.

### 10.2 Methods tried
- **Weighted score average** at several weights.
- **Rank average:** convert each model's scores to ranks and average them.
- **Calibrated rank blending:** rank-based with a calibration step so the 0.85 threshold keeps
  a sensible meaning.
- **Validation-optimised weights:** choose the weight that is best on validation.
- **Stacking:** train a small model that takes both scores as input.

### 10.3 The chosen one
A simple weighted average: **risk = 0.3 × XGBoost + 0.7 × GraphSAGE**. It is simple, fast,
needs no second model and is easy to explain. Its measured performance is nearly equal to the
best sophisticated alternatives, which is an argument for choosing the simple one.

### 10.4 Why GraphSAGE gets the larger weight
It is the stronger single model. The weight is a design decision that favours the network
signal; XGBoost contributes the profile signal.

### 10.5 What the blend trades
Compared with GraphSAGE alone, the blend slightly lowers recall but raises precision at the
operating threshold, which means fewer false alarms for the same catch rate. That trade-off is
precisely what the project cares about.

---

## 11. Choosing thresholds

Two cut-offs turn the blended score into an action:

- **Flag at 0.85 or above:** the account is considered likely mule. The payment is held and the
  agents investigate. The risk level shown is critical.
- **Warn from 0.70 up to below 0.85:** the customer sees a warning but may proceed. The risk
  level shown is high.
- **Below 0.70:** the account is treated as low risk.

These values are kept in one central configuration file so they cannot drift between services.
They were chosen to give high recall (catch nearly every ring) while keeping the number of
investigations manageable. They are operating-point decisions: moving them trades missed
fraud against false alarms.

---

## 12. Evaluation: metrics explained

Because mule accounts are rare, accuracy is meaningless. These measures are used instead.

- **Area under the ROC curve (AUC-ROC):** the probability that a random mule scores higher
  than a random non-mule. 0.5 is chance, 1.0 is perfect. It measures ranking quality but can
  look flattering when positives are rare.
- **Area under the precision-recall curve (PR-AUC):** a harsher measure for rare positives. It
  summarises the trade-off between catching fraud and avoiding false alarms. A good value here
  is much more impressive than the same AUC-ROC.
- **Precision at a threshold:** of the accounts flagged, what fraction are truly mules. Low
  precision means many false alarms.
- **Recall at a threshold:** of the true mules, what fraction were flagged.
- **False-positive rate at a threshold:** the fraction of non-mules that were flagged.
- **Recall at one percent false-positive rate:** how many mules are caught if you only allow 1
  percent of innocents to be flagged. A practical measure for an operations team.
- **Ring catch:** group-level: a ring counts as caught if at least half its mule accounts are
  flagged. Reported as, for example, 149 out of 150 rings.
- **Decoy false alarms:** how many innocent look-alike groups are wrongly flagged. Reported out
  of 175, and broken down by decoy type.

The results are reported as **mean and spread across the five folds**, which shows stability.

---

## 13. The results and how to read them

| Model | AUC-ROC | PR-AUC | Precision at 0.85 | Recall at 0.85 | Rings caught | Decoy false alarms |
|---|---|---|---|---|---|---|
| XGBoost, profile only | 0.933 | 0.338 | 0.170 | 0.702 | 150/150 | 11/175 |
| XGBoost, + behaviour | 0.973 | 0.585 | 0.307 | 0.788 | 149/150 | 3/175 |
| XGBoost, + neighbourhood | 0.987 | 0.754 | 0.372 | 0.824 | 148/150 | 4/175 |
| GraphSAGE (edge-aware, 2 layers) | 0.995 | 0.824 | 0.382 | 0.906 | 150/150 | 23/175 |
| **Blend (0.3 XGB + 0.7 SAGE), deployed** | **0.994** | **0.819** | **0.436** | **0.874** | **149/150** | not listed in this summary |

How to read this:

1. **Ranking is excellent.** Area under ROC around 0.99 and PR-AUC around 0.82 on held-out
   folds. The models are good at putting mules above non-mules.
2. **The ladder shows value at every step.** Each feature group and the graph structure add
   measurable improvement.
3. **The graph model is the strongest single model** but it raises more decoy false alarms
   (23 of 175 versus 4 of 175 for the best XGBoost). Graph proximity makes honest look-alikes
   look suspicious.
4. **The blend recovers some precision.** 0.436 versus 0.382 for GraphSAGE alone, at a small
   cost in recall.
5. **Precision at 0.85 is still only about 44 percent.** More than half the flagged accounts
   are not mules. This is the most important number in the whole project, because it is the
   reason Layer 3 exists. Present it as a finding, not as an embarrassment.

Per-shape results (available in the results folder) show that chain, star and cycle rings are
caught almost perfectly and that the family and forwarding decoys are the hardest to keep quiet
on.

---

## 14. Out-of-fold scores and the precomputed table

### 14.1 What out-of-fold means
In each of the five rounds, the model predicts the fold it did not train on. Collecting those
five sets of predictions gives **one score per account, produced by a model that never saw
that account in training**. These are called out-of-fold (OOF) predictions.

### 14.2 The precomputed table
A build script joins the XGBoost OOF scores and the GraphSAGE OOF scores for every account and
computes the blended score. The result is one table with four columns: account identifier,
XGBoost score, GraphSAGE score, blended score. It has 893,216 rows.

The script also **re-verifies** the table: it checks the row count, that every account appears
once, that there are no missing values and that all scores lie between zero and one. It then
recomputes the area under ROC and PR-AUC from this table and checks they match the ensemble
study to within a tiny tolerance, and it checks performance at the 0.85 threshold.

### 14.3 Why precompute instead of running the models live
- **Speed:** a lookup in memory takes microseconds; running a graph neural network per payment
  would take far longer and need the whole graph in memory.
- **Consistency:** every consumer sees identical scores.
- **Honesty of numbers:** the served scores are exactly the held-out ones that were evaluated.

The trade-off: the table covers **known accounts only** and does not update by itself. A brand
new account has no score until the pipeline is re-run. In production this would be solved with
a periodic batch refresh plus a lightweight online model for new accounts. State this as future
work.

---

## 15. The serving API

A small web service loads the table into memory at start-up (about 893 thousand accounts, a few
seconds) and answers score requests.

- **Input:** a receiver identifier (account id or payment address), optionally sender, amount
  and device.
- **Lookup:** find the account, read its blended score.
- **Output:** the score, the risk level, whether it is flagged, a human-readable warning message
  and whether an investigation should be triggered.
- **Speed:** a few milliseconds.
- **Unknown accounts:** the service reports not found; the gateway then falls back to the agent
  service's own estimate, so a new account is never silently treated as safe.
- **Health endpoint:** reports how many accounts are loaded, which the dashboard shows.
- **Contract:** the response format, thresholds and messages follow an agreed API contract so
  the gateway and agents can rely on them.

There is also a test file that checks the service against the contract.

The service does not run the neural network at request time, and says so in its own header.
That is a deliberate, documented design choice.

---

## 16. Integrity checks and reproducibility

Notable good practice in this part of the project:

- fixed random seeds throughout
- group-aware folds with explicit checks that each fold has the expected number of accounts
  and no duplicates or missing accounts
- a forbidden-feature guard
- a sanity check that warns if a score is suspiciously perfect (possible leakage)
- results stored as files (tables, charts, run logs) so they can be shown rather than asserted
- repeatable scripts for dataset generation, verification, training, ablation and ensembling
- verification scripts that check the dataset itself (balances, ring patterns)

These are the details that separate a serious experiment from a one-off notebook.

---

## 17. Strengths, limits and honest caveats

### Strengths
- Principled evaluation: group-aware folds, mean and spread, multiple metrics.
- Decoys make the benchmark meaningful.
- Clear experimental ladder and reasoned model choice.
- Fast, simple, contract-based serving.

### Limits to state openly
1. **Synthetic data.** Rings were generated by one script and found by a model trained on that
   script's patterns. Real fraud is messier. Results demonstrate method, not real-world
   accuracy.
2. **Cross-validation, not a final holdout.** Thresholds and blend weights were chosen within
   the same study, so reported numbers are somewhat optimistic.
3. **Low precision at the operating point** (about 44 percent). Known and addressed by Layer 3.
4. **Static scores.** The table is a snapshot; new accounts and changing behaviour are not
   scored live.
5. **Large inputs not in the repository.** The raw dataset and some intermediate files are too
   large to commit; the final scores are included.
6. **Explainability is limited.** The blended score does not itself say why. Feature
   importance helps for XGBoost; the graph model is harder to explain, which is another reason
   for an explaining layer on top.

---

## 18. Questions an examiner may ask, with answers

**Why is accuracy not reported?** Fraud is rare; always predicting "not fraud" gives very high
accuracy and no value. We use ranking and precision/recall measures.

**Why group-wise splits?** To prevent leakage: parts of a ring in training would reveal the
ring in testing.

**Why GraphSAGE and not a simpler method?** Fraud is a network phenomenon. The model's
message-passing lets an account's score depend on its neighbours. The experiments show the
graph model beats the tabular one on ranking.

**Why include XGBoost if GraphSAGE is better?** It is better at some things (profile,
behaviour) and has fewer decoy false alarms. The blend raises precision.

**Why 0.3 and 0.7?** The graph model is stronger so it gets more weight; the blend was among
the best options in the study and is the simplest.

**Why 0.85?** It gives high ring recall with a manageable alert volume, and it is what the
agents are told. It is an operating-point choice that can be moved.

**Precision is only 44 percent. Is that not bad?** It is expected for a sensitive first stage
on rare fraud, and it is exactly why a second layer exists. The honest report of this number is
a strength.

**What stops the model from simply memorising?** Forbidden identifier features, group-aware
splits, dropout, weight penalty, early stopping on validation and out-of-fold scoring.

**Can it score a new account?** Not from the table. In production we would add a batch refresh
and an online model for cold start.

**Is this real data?** Public simulated base plus planted fraud with known labels.

---

## 19. Glossary

- **Mule account:** an account that receives and passes on illicit money.
- **Layering:** moving money through several accounts to obscure its origin.
- **Smurfing:** splitting a sum into many small payments to avoid limits.
- **Decoy:** an innocent group deliberately built to look like a fraud ring.
- **Fold:** one of the five parts the data is divided into for cross-validation.
- **Out-of-fold:** a prediction for an account made by a model that did not train on it.
- **Validation set:** data held back during training to tune and stop.
- **Test set:** data used only for the final judgement.
- **AUC-ROC, PR-AUC:** ranking quality measures.
- **Precision, recall:** purity and coverage of the flagged set.
- **Ensemble / blend:** combining models.
- **Node, edge:** a point and a line in a graph; accounts and payments here.
- **Message passing:** how a graph network gathers information from neighbours.
- **Edge attributes:** extra facts about each edge (amount, timing, type).
- **Leakage:** when information from the answer sneaks into training.
