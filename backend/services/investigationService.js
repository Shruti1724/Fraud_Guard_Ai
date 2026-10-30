// Layer 3 orchestration.
//
// Runs the agent pipeline in the background (the LLM takes 10-16s, so /send-money
// must not wait for it), feeds it live graph context from MongoDB, and then does
// what the simulated agent Action step cannot: updates the real account status,
// resolves the held transactions, writes the case + audit trail, and tells every
// dashboard over Socket.IO.
//
// Socket events emitted here:
//   investigation:started   { ref, account_id, vpa, trigger, started_at, context }
//   investigation:completed { ref, case, decision, duration_ms, account, failsafe }
//   investigation:failed    { ref, account_id, error }
//   transaction:updated     { txn }
//   account:updated         { account_id, risk_status, current_balance?, ... }
//   agent:activity          (legacy summary, kept for older clients)

const Account = require("../models/Account");
const RiskScore = require("../models/RiskScore");
const Transaction = require("../models/Transaction");
const InvestigationCase = require("../models/InvestigationCase");
const AuditAction = require("../models/AuditAction");
const { investigate, AGENT_USE_CACHE } = require("./agentServiceClient");
const { classifyRole, agentRiskLabel } = require("./roles");
const { parseReport } = require("./reportParser");
const { settleIfEligible } = require("./ledger");

const COOLDOWN_MS = Number(process.env.INVESTIGATION_COOLDOWN_MS || 90_000);
const CONTEXT_MODE = (process.env.AGENT_CONTEXT_MODE || "live").toLowerCase(); // live | stored

const ACCOUNT_STATUS_BY_DECISION = {
  auto_block: "FROZEN",
  escalate: "UNDER_INVESTIGATION",
  clear: "ACTIVE",
};
const TXN_STATUS_BY_DECISION = {
  auto_block: "BLOCKED",
  escalate: "FLAGGED",
  clear: "SUCCESS",
};

const inflight = new Map(); // account_id -> { ref, txnIds:Set }
const recent = new Map();   // account_id -> { decision, case_id, at }

const newRef = () => `INV-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36).toString(36).toUpperCase()}`;

// ─── live context for the agent ──────────────────────────────────────────────

async function buildAgentContext(accountId) {
  const acc = await Account.findOne({ account_id: accountId }).lean();
  if (!acc) return null;

  const [risk, txns] = await Promise.all([
    RiskScore.findOne({ account_id: accountId }).lean(),
    Transaction.find({ $or: [{ sender_account_id: accountId }, { receiver_account_id: accountId }] })
      .sort({ timestamp: -1 })
      .limit(50)
      .lean(),
  ]);

  const neighborIds = [
    ...new Set(
      txns.map((t) => (t.sender_account_id === accountId ? t.receiver_account_id : t.sender_account_id)).filter(Boolean)
    ),
  ];
  const [neighborAccs, neighborRisks] = await Promise.all([
    Account.find({ account_id: { $in: neighborIds } }).lean(),
    RiskScore.find({ account_id: { $in: neighborIds } }).lean(),
  ]);
  const accMap = Object.fromEntries(neighborAccs.map((a) => [a.account_id, a]));
  const riskMap = Object.fromEntries(neighborRisks.map((r) => [r.account_id, r]));

  const agg = new Map();
  for (const t of txns) {
    const outflow = t.sender_account_id === accountId;
    const nid = outflow ? t.receiver_account_id : t.sender_account_id;
    if (!nid) continue;
    const key = `${nid}|${outflow ? "outflow" : "inflow"}`;
    const entry = agg.get(key) || { neighbor_id: nid, relation: outflow ? "outflow" : "inflow", total_volume: 0, tx_count: 0 };
    entry.total_volume += t.amount || 0;
    entry.tx_count += 1;
    agg.set(key, entry);
  }

  const graph_neighbors = [...agg.values()].map((n) => {
    const { role } = classifyRole(accMap[n.neighbor_id], riskMap[n.neighbor_id], n.neighbor_id);
    return { ...n, risk_label: agentRiskLabel(role, riskMap[n.neighbor_id]) };
  });

  const ctx = {
    account_id: acc.account_id,
    vpa_address: acc.vpa_address,
    account_age_days: acc.account_age_days,
    kyc_status: acc.kyc_status,
    current_balance: acc.current_balance,
    avg_tx_amount: acc.avg_tx_amount,
    tx_frequency_per_day: acc.tx_frequency_per_day,
    unique_counterparties: acc.unique_counterparties,
    device_id: acc.device_id,
    ip_address: acc.ip_address,
    recent_transactions: txns.map((t, i) => ({
      step: i + 1,
      type: t.type || "PAYMENT",
      amount: t.amount,
      nameOrig: t.sender_account_id,
      nameDest: t.receiver_account_id,
      timestamp: new Date(t.timestamp).toISOString(),
      status: t.status,
    })),
    graph_neighbors,
  };
  if (risk) {
    ctx.risk_score = risk.risk_score;
    ctx.risk_level = risk.risk_level;
    if (risk.xgb_score !== undefined && risk.xgb_score !== null) ctx.xgb_score = risk.xgb_score;
    if (risk.sage_score !== undefined && risk.sage_score !== null) ctx.sage_score = risk.sage_score;
  }
  return ctx;
}

// ─── applying a decision ─────────────────────────────────────────────────────

async function applyDecision(io, { account_id, decision, case_id, txnIds = [], reason }) {
  const now = new Date();
  const set = {
    risk_status: ACCOUNT_STATUS_BY_DECISION[decision],
    last_decision: decision,
    last_investigated_at: now,
  };
  const update = { $set: set };
  if (decision === "auto_block") set.freeze_reason = reason || "Frozen by FraudGuard investigation";
  if (decision === "clear") { set.cleared_by_agent_at = now; update.$unset = { freeze_reason: "" }; }
  else if (decision === "escalate") update.$unset = { cleared_by_agent_at: "" };
  else update.$unset = { cleared_by_agent_at: "" };

  const account = await Account.findOneAndUpdate({ account_id }, update, { new: true }).lean();

  const txnStatus = TXN_STATUS_BY_DECISION[decision];
  const updatedTxns = [];
  for (const id of txnIds) {
    const patch = { status: txnStatus, case_id };
    if (decision === "auto_block") {
      patch.block_reason = reason || "Receiver frozen by FraudGuard investigation";
      patch.is_fraud = true;
    }
    const txn = await Transaction.findOneAndUpdate({ transaction_id: id }, patch, { new: true }).lean();
    if (!txn) continue;
    updatedTxns.push(txn);
    if (decision === "clear") {
      const moved = await settleIfEligible(txn);
      if (moved) io.emit("account:updated", { account_id: txn.sender_account_id, ...moved.sender });
      if (moved) io.emit("account:updated", { account_id: txn.receiver_account_id, ...moved.receiver });
    }
    io.emit("transaction:updated", { txn });
  }

  io.emit("account:updated", {
    account_id,
    risk_status: account ? account.risk_status : set.risk_status,
    last_decision: decision,
    freeze_reason: account ? account.freeze_reason : undefined,
    cleared_by_agent_at: decision === "clear" ? set.cleared_by_agent_at : null,
  });
  return { account, txns: updatedTxns };
}

// ─── the investigation itself ────────────────────────────────────────────────

async function execute(io, { account_id, trigger, ref, entry }) {
  const startedAt = new Date();
  const t0 = Date.now();
  const acc = await Account.findOne({ account_id }).lean();
  const vpa = acc ? acc.vpa_address : account_id;

  let ctx = null;
  if (CONTEXT_MODE === "live") {
    try { ctx = await buildAgentContext(account_id); } catch (e) { console.warn("[investigation] context build failed:", e.message); }
  }

  io.emit("investigation:started", {
    ref,
    account_id,
    vpa,
    trigger,
    started_at: startedAt.toISOString(),
    context: ctx && {
      mode: CONTEXT_MODE,
      neighbors: ctx.graph_neighbors.length,
      transactions: ctx.recent_transactions.length,
      victims: ctx.graph_neighbors.filter((n) => n.risk_label === "VICTIM").length,
      sinks: ctx.graph_neighbors.filter((n) => n.risk_label === "SINK").length,
    },
  });

  let result = null;
  let failure = null;
  try {
    result = await investigate({ account_id, account_data: ctx || undefined });
  } catch (e) {
    failure = e;
    console.error(`[investigation] ${ref} agent pipeline failed:`, e.message);
    io.emit("investigation:failed", { ref, account_id, error: e.message });
  }

  // Fail safe: if the AI layer is down, hold the account for a human instead of
  // letting the payment through or silently dropping the case.
  const failsafe = !result;
  const decision = result ? result.decision : "escalate";
  const action_taken = result
    ? result.action_taken
    : `AI pipeline unavailable (${failure.message}). Account placed on hold and routed to a Tier-2 analyst.`;
  const report = result
    ? result.report
    : "FraudGuard AI investigation could not complete. The account has been held for manual review.";

  const duration_ms = Date.now() - t0;
  const findings = parseReport(report);
  const case_id = `CASE-${ref}`;

  const triggeredBy = ["MANUAL", "SIMULATION"].includes(trigger) ? trigger : "LAYER2_GNN_THRESHOLD";
  const txnIds = [...entry.txnIds];

  const caseDoc = await InvestigationCase.create({
    case_id,
    account_id,
    triggered_by: triggeredBy,
    decision,
    action_taken,
    report,
    status: decision === "escalate" ? "UNDER_REVIEW" : "RESOLVED",
    decision_source: failsafe ? "FAILSAFE" : "AGENT",
    duration_ms,
    trigger_txn_id: txnIds[0],
    findings,
    investigator_findings: {
      ref,
      context_mode: ctx ? CONTEXT_MODE : "stored",
      agent_cached: AGENT_USE_CACHE,
      neighbors: ctx ? ctx.graph_neighbors : [],
    },
  });

  await AuditAction.create({
    action_id: `ACT-${ref}`,
    case_id,
    account_id,
    action_type: decision.toUpperCase(),
    target_system: "AGENT_SERVICE",
    status: failsafe ? "FAILED" : "SIMULATED",
    details: { action_taken, duration_ms, txn_ids: txnIds, rationale: findings.rationale || null },
  });

  const reason = findings.rationale || action_taken;
  const { account } = await applyDecision(io, { account_id, decision, case_id, txnIds, reason });

  recent.set(account_id, { decision, case_id, at: Date.now() });

  const caseObj = caseDoc.toObject();
  io.emit("investigation:completed", {
    ref,
    case: caseObj,
    decision,
    duration_ms,
    failsafe,
    account: account && { account_id, risk_status: account.risk_status },
  });
  io.emit("agent:activity", { account_id, case_id, decision, action_taken, report, duration_ms });

  return caseObj;
}

/**
 * Ask for an investigation of `account_id`. Never blocks on the agent.
 * Returns immediately with { state, ref } where state is one of:
 *   started - a new background investigation was launched
 *   joined  - one is already running; `txn` will be resolved with its outcome
 *   cached  - the account was investigated moments ago; its decision is reused
 */
async function requestInvestigation(io, { account_id, trigger = "LAYER2_GNN_THRESHOLD", txn = null }) {
  const running = inflight.get(account_id);
  if (running) {
    if (txn) running.txnIds.add(txn.transaction_id);
    return { state: "joined", ref: running.ref };
  }

  const prior = recent.get(account_id);
  if (prior && trigger !== "MANUAL" && Date.now() - prior.at < COOLDOWN_MS) {
    if (txn) {
      await applyDecision(io, {
        account_id,
        decision: prior.decision,
        case_id: prior.case_id,
        txnIds: [txn.transaction_id],
        reason: "Decision reused from a just-completed investigation of the same account",
      });
    }
    return { state: "cached", ref: prior.case_id.replace(/^CASE-/, ""), case_id: prior.case_id, decision: prior.decision };
  }

  const ref = newRef();
  const entry = { ref, txnIds: new Set(txn ? [txn.transaction_id] : []) };
  inflight.set(account_id, entry);

  execute(io, { account_id, trigger, ref, entry })
    .catch((e) => {
      console.error(`[investigation] ${ref} crashed:`, e);
      io.emit("investigation:failed", { ref, account_id, error: e.message });
    })
    .finally(() => inflight.delete(account_id));

  return { state: "started", ref };
}

/** Analyst resolves a held case: approve the block, or override and clear. */
async function resolveCase(io, { case_id, action, analyst = "SOC Analyst", note }) {
  const kase = await InvestigationCase.findOne({ case_id });
  if (!kase) return null;

  const decision = action === "OVERRIDE_CLEAR" ? "clear" : "auto_block";
  const held = await Transaction.find({
    receiver_account_id: kase.account_id,
    status: "FLAGGED",
    case_id,
  }).lean();

  await applyDecision(io, {
    account_id: kase.account_id,
    decision,
    case_id,
    txnIds: held.map((t) => t.transaction_id),
    reason: `Analyst ${analyst}: ${note || (decision === "clear" ? "overrode agent decision" : "confirmed block")}`,
  });

  kase.decision = decision;
  kase.status = "RESOLVED";
  kase.decision_source = "ANALYST";
  kase.resolved_by = analyst;
  kase.analyst_note = note;
  kase.updated_at = new Date();
  await kase.save();

  await AuditAction.create({
    action_id: `ACT-${Date.now().toString(36).toUpperCase()}`,
    case_id,
    account_id: kase.account_id,
    action_type: `ANALYST_${action}`,
    target_system: "SOC_CONSOLE",
    status: "EXECUTED",
    details: { analyst, note },
  });

  recent.set(kase.account_id, { decision, case_id, at: Date.now() });
  const obj = kase.toObject();
  io.emit("investigation:completed", { ref: case_id.replace(/^CASE-/, ""), case: obj, decision, analyst: true });
  return obj;
}

function resetState() {
  inflight.clear();
  recent.clear();
}

module.exports = { requestInvestigation, applyDecision, resolveCase, buildAgentContext, resetState };
