# FraudGuard AI — UI Specification (v2, detailed)

Every screen the project needs, with realistic fintech-app-level detail —
not just the bare minimum to satisfy the contract. Status tags: **[BUILT]**,
**[TODO]**, **[NOT YOUR SCOPE]**.

---

## PART A — User-Facing App (Mock UPI)

### 1. Home / Wallet Screen — **[TODO, new]**

Real UPI apps don't drop you straight into "Send Money" — there's a home
screen first. Adding this makes the demo feel like an actual app instead of
a single form.

- **Balance card** — shows `current_balance` for the demo sender account, with a masked/unmasked toggle (eye icon).
- **Quick actions row** — "Send Money", "Request Money" (non-functional, just for realism), "Scan QR" (non-functional).
- **Recent contacts** — 3–4 avatar chips of VPAs sent to before (pulled from your own transaction history), tappable to pre-fill the Send Money screen.
- **Recent transactions list** (last 5) — payee name, amount, date, status badge (SUCCESS / FLAGGED / BLOCKED), tappable to open Transaction Detail.
- **A subtle security banner** if the account itself has ever been flagged — "Your account has an active security notice" (only relevant if you seed a flagged sender for demo purposes).

### 2. Send Money Screen — **[BUILT, expand]**

What you have covers the mechanics. To make it feel real:

- **VPA input with live validation states**: idle → checking (spinner) → resolved (shows receiver's masked name if `account_holder_name` comes back, e.g. "M••• R•••" — real UPI apps confirm the name before you pay) → invalid VPA format.
- **Amount input** with a numeric keypad feel (large font, INR symbol prefixed), plus quick-amount chips (₹100 / ₹500 / ₹1000 / Custom).
- **Note/remark field** (optional, cosmetic — not sent to backend unless you want it stored on the transaction).
- **Risk banner**, upgraded:
  - Icon + color per level (LOW = subtle info icon, MEDIUM = yellow triangle, HIGH = red triangle, CRITICAL = red shield-cross, filled background).
  - Expandable "Why is this flagged?" line showing 1–2 `topological_flags` in plain language if present (e.g. "Unusually high transaction frequency", "New account, low activity history") — nice demo talking point even with placeholder flags.
  - "Send anyway" button requires a confirmation sub-step (e.g. a checkbox "I understand the risk" before it activates) — small UX detail that sells the "we take this seriously" narrative in a review.
- **PIN entry step (simulated)** — after tapping Pay, show a fake 4–6 digit UPI PIN pad before actually calling `/send-money`. Doesn't need real validation logic; it's for realism and to create a natural pause where the risk banner has already been seen.
- **Payment result screen** (currently just a status line — make it a full screen):
  - Success: checkmark animation, amount, payee, transaction ID, timestamp, "Download receipt" button (can be a no-op or a simple generated text/PDF).
  - Blocked/escalated: different visual (not a green checkmark) — "Payment held for review" state, explaining the account is under investigation, with a case reference number if `investigation_cases` was created.

### 3. Transaction History Screen — **[TODO, new]**

- Full list of all transactions for the demo sender account, newest first.
- Each row: payee VPA/name, amount, date/time, status badge, small risk-level dot.
- Filter chips: All / Success / Flagged / Blocked.
- Tap a row → Transaction Detail (amount, both account IDs, device ID, timestamp, and if flagged, the risk_level + warning_message at the time of sending).

### 4. Notifications / Alerts Screen — **[TODO, new]**

- Feed of things that happened to *this user's* account: "Payment to mule.relay99@oksbi was flagged HIGH risk", "Your payment was blocked pending review", "Case CASE-1234 was resolved: cleared".
- Driven by the same Socket.IO events already emitted, filtered to the current sender.
- Unread badge count on a bell icon (frontend-only state, no backend needed).

---

## PART B — Admin / Analyst Side

### 5. Live Admin Dashboard — **[TODO]**

The synopsis's centerpiece. Expanded from the basic version:

- **Transaction graph (Cytoscape.js)**
  - Nodes sized by `tx_frequency_per_day` or degree (number of connections) — busier accounts look bigger, visually surfacing hubs.
  - Node color by `risk_level`: grey (unscored) → green (LOW) → yellow (MEDIUM) → orange (HIGH) → red (CRITICAL), with a pulsing animation on nodes that just got flagged live.
  - Edge thickness by transaction amount; edge color dims for older transactions so recent activity visually pops.
  - Layout toggle: force-directed (default) vs. hierarchical (useful for showing mule chains as a clear left-to-right flow).
  - Click a node → side drawer with account details (see #7 below) instead of navigating away, so the graph stays in context.
  - Click an edge → mini transaction detail popover.
- **Real-time agent activity feed** (right sidebar or bottom panel)
  - Live-scrolling list of `agent:activity` events, each as a card: account, decision badge (color-coded), action taken, "View full report" link.
  - A subtle "typing"/"investigating" indicator while an investigation is in flight (nice touch: emit an `agent:investigating` socket event when `/investigate` is called, before the result comes back, so the feed shows activity even during the LLM's think time).
- **Top summary stat cards** across the top: Total Accounts, Flagged Now, Investigations Today, Frozen Accounts, Avg. Time to Decision.
- **Search/filter bar** — search by VPA or account_id to jump the graph to a specific node.
- **Threshold indicator** — small readout showing the current `RISK_FLAG_THRESHOLD` config value, so reviewers can see the flagging boundary is configurable, not hardcoded per-file (matches your Phase 1 contract note).

### 6. Case Reports Screen — **[TODO]**

- **List view**: sortable/filterable table — `case_id`, `account_id`, `decision` (color badge), `status`, `created_at`. Filters: decision type, date range.
- **Detail view**, expanded:
  - Header: account VPA, decision badge, case ID, timestamp.
  - "Investigation timeline" — a simple vertical stepper showing the 4 agent stages (Investigator → Decision → Action → Report) as completed steps, even if you only have the final combined output — you can still visually break the single `report` text into these 4 labeled sections if the report text is structured that way, or just label the whole card "Full Investigation Report" if not.
  - Full `report` text, nicely formatted (headings/paragraphs, not a raw text blob).
  - Linked `audit_actions` entries: what was actually done (e.g. "Account frozen", target system, status).
  - "Related transactions" mini-list: the transactions involving this account around the time of the investigation.
  - Download/export button (PDF or plain text export — satisfies "downloadable case reports" from the synopsis).

### 7. Account Detail Drawer/Page — **[TODO, new]**

Opens from the dashboard graph or from search. This is the analyst's single-account view:

- Header: `account_holder_name`, `vpa_address`, `risk_status` badge (ACTIVE/FROZEN/UNDER_INVESTIGATION).
- Key stats grid: `account_age_days`, `kyc_status`, `current_balance`, `avg_tx_amount`, `tx_frequency_per_day`, `unique_counterparties`, `device_id`.
- Current risk: `risk_score` (as a gauge/progress bar, not just a number), `risk_level` badge, `warning_message`.
- Mini transaction graph scoped to just this account's immediate neighbors (1-hop).
- History of past `investigation_cases` for this account, if any (most accounts will have none — that's fine, shows "No prior investigations").
- Manual action buttons for the analyst (optional, nice demo feature): "Freeze account" / "Clear flag" — even if these just write directly to Mongo without going through the agent pipeline, it shows human-in-the-loop override is possible.

### 8. Settings / Config Screen — **[TODO, optional]**

Small but useful for a review — shows the system isn't hardcoded:

- Editable `RISK_FLAG_THRESHOLD` value (the one from your `.env`), with a save button that updates the config (even if it just restarts requiring a small mechanism, or is read-only display if live-editing is too much scope).
- Toggle for demo/fallback mode vs. live agent calls (maps to Member C's "cached demo fallback" concept).
- List of currently seeded demo accounts with one-tap "reset demo data" button (calls your seed script).

---

## PART C — Not Your Scope

### 9. Model Comparison View — **[NOT YOUR SCOPE]**

Member B's (Ananya's) output — GraphSAGE/GCN vs. XGBoost metrics. Lives in
the report/slides, not the running app, unless the team wants a read-only
"Model Performance" tab on the dashboard summarizing Precision/Recall/F1/
AUC-ROC and % of injected rings caught. If added, it's a static chart fed by
a JSON file Member B exports — no new backend logic on your side.

---

## Summary table

| # | Screen | Status | New in v2 |
|---|---|---|---|
| 1 | Home / Wallet | To do | Yes |
| 2 | Send Money | Built, needs expansion | Validation states, PIN step, result screen |
| 3 | Transaction History | To do | Yes |
| 4 | Notifications | To do | Yes |
| 5 | Live Admin Dashboard | To do | Node sizing, search, stat cards, threshold readout |
| 6 | Case Reports | To do | Timeline stepper, related transactions, export |
| 7 | Account Detail | To do | Yes |
| 8 | Settings/Config | To do (optional) | Yes |
| 9 | Model Comparison | Not your scope | — |

## Realistic build priority for a 10-week project

1. **Core loop** (Send Money end-to-end, already built) + Payment result screen.
2. **Home/Wallet + Transaction History** — cheap wins, make the demo look like a real app, reuse data you already have.
3. **Live Admin Dashboard v1** — graph + activity feed, no polish yet.
4. **Case Reports** — list + detail.
5. **Account Detail drawer** — ties dashboard and case reports together.
6. **Notifications, Settings, dashboard polish** (node sizing/animation, search) — last, time-permitting.