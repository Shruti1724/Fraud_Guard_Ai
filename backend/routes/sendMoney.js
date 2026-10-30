const express = require("express");
const { randomUUID } = require("crypto");
const Transaction = require("../models/Transaction");
const Account = require("../models/Account");
const { assessReceiver, persistRisk } = require("../services/riskService");
const { requestInvestigation } = require("../services/investigationService");
const { settleIfEligible } = require("../services/ledger");

const FROZEN = new Set(["FROZEN", "account_frozen"]);
const DEMO_MODE = String(process.env.DEMO_MODE || "true").toLowerCase() !== "false";

module.exports = function buildSendMoneyRouter(io) {
  const router = express.Router();

  // Records an attempt that was stopped at the gate, so it shows up as a red
  // BLOCKED edge on the dashboard and counts in the stats.
  async function recordBlocked({ sender_account_id, receiverAccount, receiver_vpa, amount, device_id, simulated, reason, risk_score }) {
    const txn = await Transaction.create({
      transaction_id: `tx_${randomUUID()}`,
      type: "PAYMENT",
      amount,
      sender_account_id,
      receiver_account_id: receiverAccount ? receiverAccount.account_id : `acc_${receiver_vpa.replace(/[@.]/g, "_")}`,
      receiver_vpa,
      timestamp: new Date(),
      status: "BLOCKED",
      device_id,
      block_reason: reason,
      simulated,
      is_fraud: true,
      risk_score,
    });
    io.emit("transaction:new", { txn });
    return txn;
  }

  // POST /send-money
  // body: { sender_account_id, receiver_vpa, amount, device_id, confirmed_despite_warning, simulation }
  //
  // Responds right away. A flagged payment is HELD (status FLAGGED) while the
  // 4-agent investigation runs in the background; its outcome is pushed over
  // Socket.IO (transaction:updated / investigation:completed) and resolves the
  // payment to BLOCKED (auto_block), SUCCESS (clear) or keeps it held (escalate).
  router.post("/", async (req, res) => {
    try {
      const { sender_account_id, device_id, confirmed_despite_warning } = req.body;
      const receiver_vpa = typeof req.body.receiver_vpa === "string" ? req.body.receiver_vpa.trim().toLowerCase() : "";
      const amount = Number(req.body.amount);
      // Scripted attack traffic from the SOC simulator. Only honoured in demo mode,
      // because it bypasses the balance check and the confirm-the-warning step.
      const simulated = req.body.simulation === true && DEMO_MODE;

      if (!sender_account_id || !receiver_vpa || !Number.isFinite(amount) || amount <= 0) {
        return res
          .status(400)
          .json({ error: "sender_account_id, receiver_vpa and a positive amount are required" });
      }

      const [senderAccount, receiverAccount] = await Promise.all([
        Account.findOne({ account_id: sender_account_id }).lean(),
        Account.findOne({ vpa_address: receiver_vpa }).lean(),
      ]);

      if (!senderAccount) {
        return res.status(404).json({ error: "sender_not_found", message: "Sender account does not exist." });
      }

      // Frozen accounts (sender or receiver) are hard-blocked, even if the user
      // bypasses the warning. This is how an earlier auto_block keeps paying off.
      if (FROZEN.has(senderAccount.risk_status)) {
        const txn = await recordBlocked({ sender_account_id, receiverAccount, receiver_vpa, amount, device_id, simulated, reason: "Sender account frozen by FraudGuard AI" });
        return res.status(403).json({
          error: "sender_frozen",
          message: "This account has been frozen by FraudGuard AI. Outgoing payments are disabled.",
          txn,
        });
      }
      if (receiverAccount && FROZEN.has(receiverAccount.risk_status)) {
        const txn = await recordBlocked({ sender_account_id, receiverAccount, receiver_vpa, amount, device_id, simulated, reason: "Receiver frozen by FraudGuard AI" });
        return res.status(403).json({
          error: "account_frozen",
          message: "This UPI ID has been frozen by FraudGuard AI following a fraud investigation. Payment cannot be processed.",
          txn,
        });
      }

      if (!simulated && senderAccount.current_balance < amount) {
        return res.status(422).json({
          error: "insufficient_funds",
          message: `Insufficient balance. Available: ₹${senderAccount.current_balance.toLocaleString("en-IN")}.`,
        });
      }

      // Always re-check server-side — never trust the client's earlier /predict call.
      const { raw, effective: risk } = await assessReceiver({ sender_account_id, receiver_vpa, amount, device_id });
      await persistRisk(raw);
      io.emit("risk_score:updated", { account_id: risk.receiver_account_id, ...risk });

      if (risk.is_flagged && !confirmed_despite_warning && !simulated) {
        return res.status(409).json({
          error: "receiver_flagged",
          message: risk.warning_message,
          risk,
        });
      }

      const txn = await Transaction.create({
        transaction_id: `tx_${randomUUID()}`,
        type: "PAYMENT",
        amount,
        sender_account_id,
        sender_vpa: senderAccount.vpa_address,
        receiver_account_id: risk.receiver_account_id,
        receiver_vpa: risk.receiver_vpa,
        timestamp: new Date(),
        status: risk.is_flagged ? "FLAGGED" : "SUCCESS",
        device_id,
        simulated,
        risk_score: risk.risk_score,
      });
      io.emit("transaction:new", { txn });

      let investigation = null;
      if (risk.trigger_investigation) {
        investigation = await requestInvestigation(io, {
          account_id: risk.receiver_account_id,
          trigger: simulated ? "SIMULATION" : "LAYER2_GNN_THRESHOLD",
          txn,
        });
      } else if (txn.status === "SUCCESS") {
        const moved = await settleIfEligible(txn);
        if (moved) {
          io.emit("account:updated", { account_id: sender_account_id, ...moved.sender });
          io.emit("account:updated", { account_id: risk.receiver_account_id, ...moved.receiver });
        }
      }

      res.status(201).json({ txn, risk, investigation });
    } catch (err) {
      console.error("[send-money] error:", err.message);
      res.status(502).json({ error: "send-money failed", detail: err.message });
    }
  });

  return router;
};
