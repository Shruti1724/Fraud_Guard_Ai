const express = require("express");
const Transaction = require("../models/Transaction");
const RiskScore = require("../models/RiskScore");
const Account = require("../models/Account");
const InvestigationCase = require("../models/InvestigationCase");
const AuditAction = require("../models/AuditAction");

const router = express.Router();

// GET /dashboard/graph
// Returns the graph topology for Cytoscape.js with full node & edge metadata
router.get("/graph", async (req, res) => {
  try {
    const transactions = await Transaction.find().lean();
    const riskScores = await RiskScore.find().lean();
    const accounts = await Account.find().lean();

    const elements = [];
    const accountMap = {};
    const riskMap = {};

    accounts.forEach(acc => {
      accountMap[acc.account_id] = acc;
    });

    riskScores.forEach(r => {
      riskMap[r.account_id] = r;
    });

    const accountSet = new Set(Object.keys(accountMap));
    transactions.forEach(tx => {
      if (tx.sender_account_id) accountSet.add(tx.sender_account_id);
      if (tx.receiver_account_id) accountSet.add(tx.receiver_account_id);
    });

    // Create Nodes
    accountSet.forEach(accountId => {
      const acc = accountMap[accountId] || {};
      const risk = riskMap[accountId] || {};

      let displayLabel = acc.vpa_address || acc.account_holder_name || accountId;
      if (displayLabel.length > 20) {
        displayLabel = displayLabel.substring(0, 18) + "...";
      }

      elements.push({
        data: {
          id: accountId,
          label: displayLabel,
          full_id: accountId,
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
          risk_level: risk.risk_level || "LOW",
          risk_score: risk.risk_score || 0.05,
          warning_message: risk.warning_message || "",
        }
      });
    });

    // Create Edges
    transactions.forEach(tx => {
      if (tx.sender_account_id && tx.receiver_account_id) {
        elements.push({
          data: {
            id: tx.transaction_id || `tx_${Math.random().toString(36).substr(2, 9)}`,
            source: tx.sender_account_id,
            target: tx.receiver_account_id,
            amount: tx.amount,
            status: tx.status,
            type: tx.type || "PAYMENT",
            timestamp: tx.timestamp,
            is_fraud: tx.is_fraud || false,
          }
        });
      }
    });

    res.json(elements);
  } catch (err) {
    console.error("[dashboard/graph] error:", err.message);
    res.status(500).json({ error: "Failed to fetch graph data" });
  }
});

// GET /dashboard/cases
// Returns investigation cases with audit actions
router.get("/cases", async (req, res) => {
  try {
    const cases = await InvestigationCase.find().sort({ created_at: -1 }).lean();
    const caseIds = cases.map(c => c.case_id);
    
    // Fetch associated audit actions
    const auditActions = await AuditAction.find({ case_id: { $in: caseIds } }).lean();
    
    // Attach actions to cases
    const casesWithActions = cases.map(c => {
      return {
        ...c,
        actions: auditActions.filter(a => a.case_id === c.case_id)
      };
    });

    res.json(casesWithActions);
  } catch (err) {
    console.error("[dashboard/cases] error:", err.message);
    res.status(500).json({ error: "Failed to fetch cases" });
  }
});

// POST /dashboard/action
// Trigger manual SOC actions: FREEZE, CLEAR, FLAG
router.post("/action", async (req, res) => {
  try {
    const { account_id, action_type, reason } = req.body;
    if (!account_id || !action_type) {
      return res.status(400).json({ error: "account_id and action_type are required" });
    }

    let riskLevel = "LOW";
    let riskStatus = "ACTIVE";
    let riskScore = 0.05;

    if (action_type === "FREEZE") {
      riskLevel = "CRITICAL";
      riskStatus = "FROZEN";
      riskScore = 0.99;
    } else if (action_type === "FLAG") {
      riskLevel = "HIGH";
      riskStatus = "UNDER_INVESTIGATION";
      riskScore = 0.85;
    } else if (action_type === "CLEAR") {
      riskLevel = "LOW";
      riskStatus = "ACTIVE";
      riskScore = 0.02;
    }

    await Account.findOneAndUpdate(
      { account_id },
      { risk_status: riskStatus }
    );

    await RiskScore.findOneAndUpdate(
      { account_id },
      { risk_level: riskLevel, risk_score: riskScore, updated_at: new Date() },
      { upsert: true }
    );

    // Broadcast update via socket if available
    const io = req.app.get("io");
    if (io) {
      io.emit("risk_score:updated", {
        account_id,
        risk_level: riskLevel,
        risk_score: riskScore,
      });
      io.emit("agent:activity", {
        decision: action_type === "FREEZE" ? "auto_block" : action_type === "CLEAR" ? "clear" : "escalate",
        action_taken: `SOC Manual Override: ${action_type} executed on ${account_id}. Reason: ${reason || 'Analyst Manual Command'}`,
      });
    }

    res.json({ success: true, account_id, risk_level: riskLevel, risk_status: riskStatus });
  } catch (err) {
    console.error("[dashboard/action] error:", err.message);
    res.status(500).json({ error: "Failed to execute action" });
  }
});

module.exports = router;
