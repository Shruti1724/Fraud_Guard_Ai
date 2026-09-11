2. Abstract
The Unified Payments Interface (UPI) has become the backbone of digital payments in India, and its scale has made it an attractive target for fraud rings that route money through chains of mule accounts before it disappears. Existing fraud checks largely evaluate one transaction at a time and cannot see the network-level patterns that connect a fraud ring together, and by the time a human analyst investigates a suspicious account, the money has often already moved. This project proposes FraudGaurd AI, a two-layer fraud detection and investigation system. Layer 1 is an instant, user-facing pre-payment risk check that warns a user the moment they enter a receiver's VPA, if that account has already been flagged. Layer 2 is a continuous, event-triggered background pipeline that models every account and transaction as a graph and uses a Graph Neural Network (GraphSAGE/GCN) to re-score accounts as new transactions occur, catching multi-hop mule chains and fraud rings that a single-transaction model would miss. When an account's score crosses a threshold, a four-agent LLM pipeline (Investigator, Decision, Action, Report), orchestrated with LangGraph, investigates the account, decides whether to auto-block, escalate, or clear it, executes the decision through simulated tool-calls, and generates a readable case report. The system is demonstrated on a self-built mock UPI application, bootstrapped with the PaySim dataset and augmented with synthetically injected fraud rings so that the graph-based model has genuine structural patterns to learn from. The project's core claim is evaluated by comparing the GraphSAGE/GCN model against a non-graph XGBoost baseline on the same data, reporting the percentage of injected fraud rings the graph model catches that the baseline misses, along with standard classification metrics and system-level timing metrics.
3. Introduction
Digital payments in India have grown at an extraordinary pace since the launch of UPI, which now processes billions of peer-to-peer and peer-to-merchant transactions every month. This growth has been accompanied by a corresponding rise in fraud: phishing links, fake collect requests, QR code scams, and social-engineering attacks that trick users into paying into accounts that quickly forward the money onward through a chain of mule accounts, making the funds difficult to trace and recover once the transaction is complete.
Most fraud-detection systems in production today, and much of the published research on UPI fraud specifically, treat each transaction as an independent record and apply supervised classifiers such as logistic regression, decision trees, or gradient-boosted models to features like amount, time, and device. These approaches are effective at catching individually anomalous transactions, but they are structurally blind to the relational pattern that defines a fraud ring: a coordinated chain or star of accounts that looks unremarkable transaction-by-transaction, but is clearly suspicious once the network of connections is considered as a whole.
This project addresses that gap by modelling the entire transaction ecosystem as a graph and applying Graph Neural Networks to detect fraud rings and mule-account patterns from neighbourhood structure, not just individual transaction statistics. Because a brand-new payment cannot be deep-analysed from scratch in the time a user is willing to wait before confirming it, the system separates the problem into two cooperating layers: a background layer that continuously keeps every account's risk score fresh, and a lightweight foreground layer that simply reads that precomputed score the instant it is needed. A coordinated pipeline of LLM-based agents then automates the investigation, decision, and reporting steps that a human fraud analyst would otherwise have to perform manually for every flagged account.
4. Background
4.1 Problem Statement
To design and build a system that warns a user before they send money to a suspicious UPI account, and that continuously investigates the entire transaction network in the background using Graph Neural Networks and multi-agent LLM reasoning, so that fraudulent accounts are detected and frozen quickly, before scam money can move further downstream and disappear.
4.2 Motivation / Need of Project
Rule-based and single-transaction fraud checks miss coordinated fraud rings because they never look beyond the transaction directly in front of them. By the time a flagged account is manually investigated, typically tens of minutes after the fact, the money has often already been moved through several hops and withdrawn. There is a genuine need for a system that (a) warns the paying user at the one moment intervention is still useful, before the money leaves their account, and (b) never stops re-evaluating the transaction network in the background, so that the warning shown at that moment is based on current information rather than a stale, one-time check.
4.3 Objectives
Build a working mock UPI application (frontend and backend) that mimics real VPA-based P2P/P2M UPI transfers, since access to real UPI/NPCI transaction data is restricted to licensed institutions.
Model all transactions as a graph, with accounts as nodes and transactions as edges, and train a Graph Neural Network (GraphSAGE/GCN) to detect fraud rings and mule-account patterns that single-transaction rule-based systems miss.
Build a pre-payment risk check that performs an instant lookup and warns a user if the receiver's account has already been flagged, shown before the user confirms a payment.
Build a continuous, event-triggered background investigation pipeline using four coordinated LLM agents (Investigator, Decision, Action, Report) that re-score accounts as new transactions occur and automatically freeze or flag high-risk accounts.
Demonstrate, with measurable metrics, that the graph-based approach catches fraud ring patterns that a standard non-graph model (XGBoost) misses, by injecting synthetic multi-hop fraud rings into the training data.
Deliver a live dashboard showing the transaction graph, real-time agent activity, and downloadable case reports for a clear, explainable demonstration.
4.4 Scope of the Project
The project builds a complete, working demonstration of the two-layer detection approach end-to-end: a mock UPI application, a trained GraphSAGE/GCN model compared against an XGBoost baseline, a four-agent LangGraph investigation pipeline running on a locally-hosted LLM (Ollama), and a live dashboard. The following boundaries are stated explicitly and will be reported honestly in the final documentation:
This is not a production-ready replacement for NPCI or bank-grade fraud detection systems.
The system does not use real UPI transaction data, since such data is restricted to banks and NPCI member institutions; it uses a self-built mock UPI system, bootstrapped with the PaySim dataset for training volume and augmented with synthetically injected fraud rings so the graph model has genuine multi-hop structure to learn from.
Freeze and block actions taken by the Action Agent are simulated within the project's own database and are not real bank or NPCI actions.
The background pipeline is event-triggered on each new transaction rather than a constantly-polling process, which keeps the system responsive without unnecessary continuous computation.
5. Literature Survey
The following papers were reviewed to position FraudGaurd AI against existing work on graph-based fraud detection, UPI-specific fraud detection, and LLM-based agentic investigation:
Sr. No.
Title of the Paper
Year of Publication
Publisher
Methodology
Conclusion
1
Graph Neural Networks for Financial Fraud Detection: A Review
2024/25
Frontiers of Computer Science (Springer)
Systematic review unifying GNN methodologies (GCN, GAT, GraphSAGE and variants) applied across financial fraud domains.
GNNs consistently outperform traditional, non-relational fraud detection methods by capturing relational patterns between accounts.
3
Enhancing UPI Fraud Detection: A Machine Learning Approach Using Stacked Generalization
2025
International Journal of Multidisciplinary on Science and Management
Stacked ensemble combining behavioural analytics and network-based anomaly detection features on UPI transaction data.
Combining behavioural and network-derived features improves fraud detection performance over single-model baselines, supporting the value of relational features.
4
Enhancing Anomaly Detection in Financial Markets with an LLM-based Multi-Agent Framework
2024
arXiv (Bank for International Settlements)
A multi-agent LLM framework with agents specialised in data conversion, expert web-research analysis, and report consolidation, coordinated to validate system-flagged anomalies.
Coordinated, role-specialised LLM agents can automate and improve the validation and interpretation of flagged financial anomalies, reducing manual review effort.
5
Toward Auditable Fraud Detection: Combining Graph Features, Model Explanations, and Agentic Case Investigation
2026
arXiv
Layered pipeline on the PaySim dataset combining a gradient-boosted classifier, graph-derived structural features, SHAP explanations, and a bounded LLM investigation agent for uncertain cases.
On unmodified PaySim, graph features gave little improvement, but with injected multi-account fraud rings, structural features recovered all injected fraud transactions while the tabular baseline missed roughly a quarter of them, directly supporting the need for synthetic ring injection.

6. Methodology
6.1 Block Diagram

6.2 Hardware and Software Requirements
Hardware:
A standard laptop or desktop (multi-core processor, 8 GB RAM or more) for application, backend, and dashboard development.
A machine with a dedicated GPU (6 GB VRAM or more) is required for training the GraphSAGE/GCN model within a reasonable time frame.A machine (8 GB RAM or more) is to run the local LLM agent pipeline via Ollama; a GPU improves response speed but is optional.
Software:
Frontend/Backend: React/Next.js or similar, Node.js, Express
Database: MongoDB (MongoDB Atlas for free-tier deployment)
ML/GNN: Python, PyTorch, PyTorch Geometric, XGBoost, scikit-learn
Agent orchestration: LangGraph, Ollama (locally-hosted LLM)
Services: FastAPI (/predict and /investigate endpoints)
Dashboard/visualisation: Cytoscape.js, Socket.IO
Deployment: Vercel (frontend), Render (backend services), MongoDB Atlas (database)
Dataset: PaySim (Kaggle) for bootstrap transaction volume, augmented with synthetically injected multi-hop fraud rings
6.3 Flow Chart


6.4 Working Principle
FraudGaurd AI operates on a two-layer protection model. Layer 1 is a pre-payment risk check: the instant a user enters a receiver's VPA on the Send Money screen, the system performs a simple, sub-second database lookup against a precomputed risk-score table and shows a warning banner if the account is already flagged. Layer 1 is deliberately kept this simple because a payment cannot be deep-analysed from scratch in the time a user is willing to wait; it only works because Layer 2 keeps every account's score continuously fresh.
Layer 2 is the background investigation pipeline. All transactions are modelled as a graph, with accounts as nodes (features: account age, average transaction amount, transaction frequency, unique counterparties, device ID) and transactions as edges (features: amount, timestamp, type). A GraphSAGE/GCN model, trained using PyTorch Geometric, classifies nodes by fraud probability using neighbourhood structure, star patterns, chains, and dense clusters, rather than individual transaction statistics alone. A baseline XGBoost model is trained on the same data without graph structure, to produce the project's central comparison metric.
A key methodological step, informed by the literature survey, is that the raw PaySim dataset does not by itself contain genuine multi-hop fraud-ring structure; its fraud pattern is largely a single-hop rule. To give the GraphSAGE/GCN model a real structural signal to learn from, and to make the GNN-vs-XGBoost comparison meaningful, synthetic multi-hop fraud rings and mule-account chains are deliberately injected into the training graph, in addition to the on-demand admin/seed-fraud-ring endpoint used for the live demo.
Whenever an account's score crosses a defined threshold, a four-agent pipeline, orchestrated with LangGraph and running on a locally-hosted LLM (Ollama), is triggered. The Investigator Agent pulls the account's history and graph neighbourhood and reasons over it; the Decision Agent classifies the case as auto-block, escalate to a human, or clear, combining LLM judgment with hard business rules; the Action Agent executes the decision through simulated tool-calls, updating MongoDB and logging the action; and the Report Agent generates a readable case report explaining what was found and why. Because this pipeline runs live LLM calls on stage, one demo path is pre-validated and cached as a fallback to reduce the risk of a stall during presentation. All of this activity is surfaced on a live dashboard, built with Cytoscape.js for the transaction graph and Socket.IO for a real-time agent activity feed.
7. Expected Conclusions
By the end of this project, FraudGaurd AI is expected to demonstrate the following, backed by measurable evidence:
A working mock UPI application in which a pre-payment warning is shown to the user within a fraction of a second of entering a flagged receiver's VPA.
A quantified comparison showing the percentage of injected fraud rings that the GraphSAGE/GCN model detects which the non-graph XGBoost baseline misses, evidencing that graph structure adds real value over single-transaction models.
Standard classification metrics (Precision, Recall, F1, AUC-ROC) for both the graph model and the baseline, reported alongside the false positive rate to reflect the real business cost of over-flagging genuine users.
System-level timing metrics: average time from a new transaction to an updated risk score, and average time from a flag to an agent decision, compared against a human analyst's typical review time of roughly 20-30 minutes.
A live, explainable dashboard and auto-generated case reports that make the reasoning behind each flagged account transparent to a reviewer.
A clearly documented set of limitations: the system is a research prototype built on mock/simulated data and simulated freeze actions, not a production NPCI or bank-grade system.
