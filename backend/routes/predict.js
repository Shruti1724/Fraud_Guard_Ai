const express = require("express");
const { assessReceiver, persistRisk } = require("../services/riskService");

const router = express.Router();

// POST /predict
// Layer 1: called by the Send Money screen the moment a VPA is entered,
// before the user confirms. The ML service answers (agent heuristics are the
// fallback); the raw model score is logged to risk_scores for the dashboard,
// and the response includes real round-trip latency under `meta`.
router.post("/", async (req, res) => {
  try {
    const { sender_account_id, receiver_vpa, amount, device_id } = req.body;

    if (!sender_account_id || !receiver_vpa || amount === undefined) {
      return res.status(400).json({
        error: "sender_account_id, receiver_vpa and amount are required",
      });
    }

    const started = Date.now();
    const { raw, effective } = await assessReceiver({
      sender_account_id,
      receiver_vpa: String(receiver_vpa).trim().toLowerCase(),
      amount,
      device_id,
    });
    await persistRisk(raw);

    res.json({ ...effective, meta: { ...effective.meta, total_ms: Date.now() - started } });
  } catch (err) {
    console.error("[predict] error:", err.message);
    res.status(502).json({ error: "risk check failed", detail: err.message });
  }
});

module.exports = router;
