const express = require("express");
const Account = require("../models/Account");
const Transaction = require("../models/Transaction");

const router = express.Router();

// GET /accounts/:accountId
// Returns account metadata, balance, KYC status
router.get("/:accountId", async (req, res) => {
  try {
    const { accountId } = req.params;
    const account = await Account.findOne({ account_id: accountId }).lean();
    if (!account) {
      return res.status(404).json({ error: "Account not found", account_id: accountId });
    }

    res.json({
      account_id: account.account_id,
      name: account.account_holder_name,
      account_holder_name: account.account_holder_name,
      vpa: account.vpa_address,
      vpa_address: account.vpa_address,
      balance: account.current_balance,
      current_balance: account.current_balance,
      kyc_status: account.kyc_status,
      risk_status: account.risk_status,
      device_id: account.device_id,
    });
  } catch (err) {
    console.error("[accounts] error fetching account:", err);
    res.status(500).json({ error: "Failed to fetch account" });
  }
});

// GET /accounts/:accountId/transactions?limit=20
// Returns recent transactions involving this account
router.get("/:accountId/transactions", async (req, res) => {
  try {
    const { accountId } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

    const txns = await Transaction.find({
      $or: [{ sender_account_id: accountId }, { receiver_account_id: accountId }],
    })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    res.json(txns);
  } catch (err) {
    console.error("[accounts] error fetching transactions:", err);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

module.exports = router;
