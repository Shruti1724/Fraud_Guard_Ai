const fs = require("fs");
const path = require("path");
const express = require("express");
const Transaction = require("../models/Transaction");
const RiskScore = require("../models/RiskScore");
const Account = require("../models/Account");
const InvestigationCase = require("../models/InvestigationCase");
const AuditAction = require("../models/AuditAction");
const { classifyRole } = require("../services/roles");
const { requestInvestigation, applyDecision, resolveCase } = require("../services/investigationService");

const router = express.Router();

// GET /dashboard/graph
// Graph topology for the network view: nodes carry full account + risk metadata,
// edges are transactions.
router.get("/graph", async (req, res) => {
  try {
    const [transactions, riskScores, accounts] = await Promise.all([
      Transaction.find().sort({ timestamp: 1 }).lean(),
      RiskScore.find().lean(),
      Account.find().lean(),
    ]);

    const accountMap = Object.fromEntries(accounts.map((a) => [a.account_id, a]));
    const riskMap = Object.fromEntries(riskScores.map((r) => [r.account_id, r]));

    const accountSet = new Set(Object.keys(accountMap));
    transactions.forEach((tx) => {
      if (tx.sender_account_id) accountSet.add(tx.sender_account_id);
      if (tx.receiver_account_id) accountSet.add(tx.receiver_account_id);
    });

    const elements = [];

    accountSet.forEach((accountId) => {
      const acc = accountMap[accountId] || {};
      const risk = riskMap[accountId] || {};
      const { role, glyph } = classifyRole(acc, risk, accountId);

      let displayLabel = acc.account_holder_name || acc.vpa_address || accountId;
      if (displayLabel.length > 22) displayLabel = displayLabel.substring(0, 20) + "..";

      elements.push({
        data: {
          id: accountId,
          label: displayLabel,
          full_id: accountId,
          role,
          glyph,
          vpa_address: acc.vpa_address || risk.vpa_address || accountId,
          account_holder_name: acc.account_holder_name || "Unknown Entity",
          account_age_days: acc.account_age_days || 0,
          kyc_status: acc.kyc_status || "UNKNOWN",
          current_balance: acc.current_balance || 0,
          avg_tx_amount: acc.avg_tx_amount || 0,
          tx_frequency_per_day: acc.tx_frequency_per_day || 0,
          unique_counterparties: acc.unique_counterparties || 0,
          device_id: acc.device_id || "UNKNOWN",
          ip_address: acc.ip_address || "UNKNOWN",
          risk_status: acc.risk_status || "ACTIVE",
          last_decision: acc.last_decision || null,
          freeze_reason: acc.freeze_reason || null,
          cleared_by_agent_at: acc.cleared_by_agent_at || null,
          risk_level: risk.risk_level || "LOW",
          risk_score: risk.risk_score !== undefined ? risk.risk_score : 0.05,
          is_flagged: !!risk.is_flagged,
          ml_account_id: acc.ml_account_id || risk.ml_account_id || null,
          ml_source: risk.model_version || null,
          model_scores:
            risk.xgb_score !== undefined && risk.xgb_score !== null
              ? { xgb: risk.xgb_score, sage: risk.sage_score }
              : null,
          warning_message: risk.warning_message || "",
          known: !!accountMap[accountId],
        },
      });
    });

    transactions.forEach((tx) => {
      if (tx.sender_account_id && tx.receiver_account_id) {
        elements.push({
          data: {
            id: tx.transaction_id,
            source: tx.sender_account_id,
            target: tx.receiver_account_id,
            amount: tx.amount,
            status: tx.status,
            type: tx.type || "PAYMENT",
            timestamp: tx.timestamp,
            is_fraud: tx.is_fraud || false,
            block_reason: tx.block_reason || null,
            case_id: tx.case_id || null,
            simulated: !!tx.simulated,
          },
        });
      }
    });

    res.json(elements);
  } catch (err) {
    console.error("[dashboard/graph] error:", err.message);
    res.status(500).json({ error: "Failed to fetch graph data" });
  }
});

// GET /dashboard/transactions?limit=50 — newest first, for hydrating live feeds on load.
router.get("/transactions", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    res.json(await Transaction.find().sort({ timestamp: -1 }).limit(limit).lean());
  } catch (err) {
    console.error("[dashboard/transactions] error:", err.message);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

// GET /dashboard/cases — investigation cases with their audit actions
router.get("/cases", async (req, res) => {
  try {
    const cases = await InvestigationCase.find().sort({ created_at: -1 }).lean();
    const auditActions = await AuditAction.find({ case_id: { $in: cases.map((c) => c.case_id) } }).lean();

    res.json(
      cases.map((c) => ({
        ...c,
        final_decision: c.decision, // alias kept for older dashboard builds
        actions: auditActions.filter((a) => a.case_id === c.case_id),
      }))
    );
  } catch (err) {
    console.error("[dashboard/cases] error:", err.message);
    res.status(500).json({ error: "Failed to fetch cases" });
  }
});

// POST /dashboard/cases/:caseId/resolve
// Human-in-the-loop: body { action: "APPROVE_BLOCK" | "OVERRIDE_CLEAR", analyst, note }
router.post("/cases/:caseId/resolve", async (req, res) => {
  try {
    const { action, analyst, note } = req.body;
    if (!["APPROVE_BLOCK", "OVERRIDE_CLEAR"].includes(action)) {
      return res.status(400).json({ error: "action must be APPROVE_BLOCK or OVERRIDE_CLEAR" });
    }
    const kase = await resolveCase(req.app.get("io"), { case_id: req.params.caseId, action, analyst, note });
    if (!kase) return res.status(404).json({ error: "Case not found" });
    res.json({ success: true, case: kase });
  } catch (err) {
    console.error("[dashboard/resolve] error:", err.message);
    res.status(500).json({ error: "Failed to resolve case" });
  }
});

// POST /dashboard/action — manual SOC actions: FREEZE, CLEAR, FLAG
// FLAG launches a real agent investigation; FREEZE / CLEAR are direct overrides.
router.post("/action", async (req, res) => {
  try {
    const { account_id, action_type, reason } = req.body;
    if (!account_id || !action_type) {
      return res.status(400).json({ error: "account_id and action_type are required" });
    }
    if (!["FREEZE", "CLEAR", "FLAG"].includes(action_type)) {
      return res.status(400).json({ error: "action_type must be FREEZE, CLEAR or FLAG" });
    }

    const account = await Account.findOne({ account_id }).lean();
    if (!account) return res.status(404).json({ error: "Account not found", account_id });

    const io = req.app.get("io");
    const note = reason || "Analyst manual command";

    if (action_type === "FLAG") {
      const investigation = await requestInvestigation(io, { account_id, trigger: "MANUAL" });
      return res.json({ success: true, account_id, risk_status: "UNDER_INVESTIGATION", investigation });
    }

    const decision = action_type === "FREEZE" ? "auto_block" : "clear";
    const { account: updated } = await applyDecision(io, {
      account_id,
      decision,
      case_id: undefined,
      reason: `SOC manual override: ${note}`,
    });

    await AuditAction.create({
      action_id: `ACT-${Date.now().toString(36).toUpperCase()}`,
      case_id: `MANUAL-${Date.now()}`,
      account_id,
      action_type: `SOC_${action_type}`,
      target_system: "SOC_CONSOLE",
      status: "EXECUTED",
      details: { reason: note },
    });

    io.emit("agent:activity", {
      account_id,
      decision: decision === "auto_block" ? "auto_block" : "clear",
      action_taken: `SOC Manual Override: ${action_type} executed on ${account_id}. Reason: ${note}`,
    });

    res.json({ success: true, account_id, risk_status: updated.risk_status });
  } catch (err) {
    console.error("[dashboard/action] error:", err.message);
    res.status(500).json({ error: "Failed to execute action" });
  }
});

// GET /dashboard/stats — real aggregates for the KPI strip
router.get("/stats", async (req, res) => {
  try {
    const minuteAgo = new Date(Date.now() - 60_000);
    const [byStatus, protectedAgg, heldAgg, accounts, cases, tpsCount, riskLevels] = await Promise.all([
      Transaction.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
      Transaction.aggregate([{ $match: { status: "BLOCKED" } }, { $group: { _id: null, v: { $sum: "$amount" } } }]),
      Transaction.aggregate([{ $match: { status: "FLAGGED" } }, { $group: { _id: null, v: { $sum: "$amount" } } }]),
      Account.find({}, "risk_status").lean(),
      InvestigationCase.find({}, "decision status duration_ms decision_source").lean(),
      Transaction.countDocuments({ timestamp: { $gte: minuteAgo } }),
      RiskScore.aggregate([{ $group: { _id: "$risk_level", n: { $sum: 1 } } }]),
    ]);

    const count = (s) => (byStatus.find((x) => x._id === s) || {}).n || 0;
    const timed = cases.filter((c) => c.duration_ms && c.decision_source === "AGENT");
    const avgMs = timed.length ? Math.round(timed.reduce((s, c) => s + c.duration_ms, 0) / timed.length) : null;
    const decisions = { auto_block: 0, escalate: 0, clear: 0 };
    cases.forEach((c) => { if (decisions[c.decision] !== undefined) decisions[c.decision] += 1; });

    res.json({
      total: byStatus.reduce((s, x) => s + x.n, 0),
      success: count("SUCCESS"),
      blocked: count("BLOCKED"),
      flagged: count("FLAGGED"),
      money_blocked: (protectedAgg[0] || {}).v || 0,
      money_held: (heldAgg[0] || {}).v || 0,
      tps_1m: Math.round((tpsCount / 60) * 100) / 100,
      txns_last_minute: tpsCount,
      cases: cases.length,
      open_cases: cases.filter((c) => c.status === "UNDER_REVIEW").length,
      decisions,
      false_positives_cleared: decisions.clear,
      avg_decision_ms: avgMs,
      human_baseline_minutes: 25, // 20-30 min analyst triage quoted in the project synopsis
      active: accounts.filter((a) => a.risk_status === "ACTIVE").length,
      frozen: accounts.filter((a) => a.risk_status === "FROZEN").length,
      investigating: accounts.filter((a) => a.risk_status === "UNDER_INVESTIGATION").length,
      total_accounts: accounts.length,
      risk_levels: Object.fromEntries(riskLevels.map((r) => [r._id, r.n])),
    });
  } catch (err) {
    console.error("[dashboard/stats] error:", err.message);
    res.status(500).json({ error: "Failed to fetch dashboard stats" });
  }
});

// GET /dashboard/model-metrics
// Real evaluation results from the ML team (ml-service/results). Read-only.
const RESULTS_DIR = path.join(__dirname, "..", "..", "ml-service", "results");
const num = (v) => {
  const n = parseFloat(String(v).split("±")[0]);
  return Number.isFinite(n) ? n : null;
};
const frac = (v) => {
  const m = String(v).match(/(\d+)\s*\/\s*(\d+)/);
  return m ? { caught: Number(m[1]), total: Number(m[2]) } : null;
};

router.get("/model-metrics", (req, res) => {
  try {
    const file = path.join(RESULTS_DIR, "ensemble", "final_table.csv");
    if (!fs.existsSync(file)) return res.json({ available: false });

    const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
    const cols = lines[0].split(",");
    const rows = lines.slice(1).map((l) => {
      const cells = l.split(",");
      return Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
    });

    const pick = (model, noteIncludes) =>
      rows.find((r) => r.model === model && (!noteIncludes || (r.notes || "").includes(noteIncludes)));
    const shape = (label, r) =>
      r && {
        label,
        model: r.model,
        auc_roc: num(r.auc_roc),
        pr_auc: num(r.pr_auc),
        precision: num(r.precision_085),
        recall: num(r.recall_085),
        fpr: num(r.fpr_085),
        rings: frac(r.ring_catch_total),
        decoy_false_alarms: frac(r.decoy_fa_total),
      };

    const models = [
      shape("XGBoost (tabular)", pick("xgb_A", "Original")),
      shape("XGBoost + graph features", pick("xgb_ABC", "pooled")),
      shape("GraphSAGE", pick("sage_edge_L2", "pooled")),
      shape("Blend 0.3·XGB + 0.7·SAGE (production)", pick("blend_score_w0.3")),
    ].filter(Boolean);

    res.json({ available: true, threshold: 0.85, models, source: "ml-service/results/ensemble/final_table.csv" });
  } catch (err) {
    console.error("[dashboard/model-metrics] error:", err.message);
    res.status(500).json({ error: "Failed to read model metrics" });
  }
});

module.exports = router;
