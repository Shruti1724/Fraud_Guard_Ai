const express = require("express");
const { predict } = require("../services/agentServiceClient");
const RiskScore = require("../models/RiskScore");

const router = express.Router();

// POST /predict
// Layer 1: called by the Send Money screen the moment a VPA is entered,
// before the user confirms. Proxies straight to Shruti's FastAPI service
// per docs/api-contract.md, then logs the result to risk_scores so the
// dashboard has a history to read from.
router.post("/", async (req, res) => {
  try {
    const { sender_account_id, receiver_vpa, amount, device_id } = req.body;

    if (!sender_account_id || !receiver_vpa || amount === undefined) {
      return res.status(400).json({
        error: "sender_account_id, receiver_vpa and amount are required",
      });
    }

    const result = await predict({ sender_account_id, receiver_vpa, amount, device_id });

    await RiskScore.findOneAndUpdate(
      { account_id: result.receiver_account_id },
      {
        account_id: result.receiver_account_id,
        vpa_address: result.receiver_vpa,
        risk_score: result.risk_score,
        risk_level: result.risk_level,
        is_flagged: result.is_flagged,
        warning_message: result.warning_message,
        updated_at: new Date(),
      },
      { upsert: true }
    );

    res.json(result);
  } catch (err) {
    console.error("[predict] error:", err.message);
    res.status(502).json({ error: "risk check failed", detail: err.message });
  }
});

module.exports = router;
