const express = require("express");
const { randomUUID } = require("crypto");
const Transaction = require("../models/Transaction");
const RiskScore = require("../models/RiskScore");
const InvestigationCase = require("../models/InvestigationCase");
const AuditAction = require("../models/AuditAction");
const { predict, investigate } = require("../services/agentServiceClient");

module.exports = function buildSendMoneyRouter(io) {
  const router = express.Router();

  // POST /send-money
  // body: { sender_account_id, receiver_vpa, amount, device_id, confirmed_despite_warning }
  router.post("/", async (req, res) => {
    try {
      const {
        sender_account_id,
        receiver_vpa,
        amount,
        device_id,
        confirmed_despite_warning,
      } = req.body;

      if (!sender_account_id || !receiver_vpa || amount === undefined) {
        return res
          .status(400)
          .json({ error: "sender_account_id, receiver_vpa and amount are required" });
      }

      // Always re-check server-side with the real service - never trust the
      // client's earlier /predict call alone.
      const risk = await predict({ sender_account_id, receiver_vpa, amount, device_id });

      if (risk.is_flagged && !confirmed_despite_warning) {
        return res.status(409).json({
          error: "receiver_flagged",
          message: risk.warning_message,
          risk,
        });
      }

      // Record the transaction against the agreed schema.
      const txn = await Transaction.create({
        transaction_id: `tx_${randomUUID()}`,
        type: "PAYMENT",
        amount,
        sender_account_id,
        receiver_account_id: risk.receiver_account_id,
        receiver_vpa: risk.receiver_vpa,
        timestamp: new Date(),
        status: risk.is_flagged ? "FLAGGED" : "SUCCESS",
        device_id,
      });
      io.emit("transaction:new", { txn });

      // Keep risk_scores fresh for the dashboard / next lookup.
      await RiskScore.findOneAndUpdate(
        { account_id: risk.receiver_account_id },
        {
          account_id: risk.receiver_account_id,
          vpa_address: risk.receiver_vpa,
          risk_score: risk.risk_score,
          risk_level: risk.risk_level,
          is_flagged: risk.is_flagged,
          warning_message: risk.warning_message,
          updated_at: new Date(),
        },
        { upsert: true }
      );
      io.emit("risk_score:updated", risk);

      // Layer 3: trigger the real 4-agent pipeline if the service says to.
      let investigationCase = null;
      if (risk.trigger_investigation) {
        const investigation = await investigate({ account_id: risk.receiver_account_id });

        investigationCase = await InvestigationCase.create({
          case_id: `CASE-${Date.now()}`,
          account_id: risk.receiver_account_id,
          triggered_by: "LAYER2_GNN_THRESHOLD",
          decision: investigation.decision,
          action_taken: investigation.action_taken,
          report: investigation.report,
          status: "RESOLVED",
        });

        await AuditAction.create({
          action_id: `ACT-${Date.now()}`,
          case_id: investigationCase.case_id,
          account_id: risk.receiver_account_id,
          action_type: investigation.decision.toUpperCase(),
          target_system: "AGENT_SERVICE",
          status: "SIMULATED",
          details: { action_taken: investigation.action_taken },
        });

        io.emit("agent:activity", investigation);
      }

      res.status(201).json({ txn, risk, case: investigationCase });
    } catch (err) {
      console.error("[send-money] error:", err.message);
      res.status(502).json({ error: "send-money failed", detail: err.message });
    }
  });

  return router;
};
