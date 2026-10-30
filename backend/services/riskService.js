// Layer 1 risk assessment used by both POST /predict and POST /send-money.
//
// The ML score is the source of truth and is what we persist in risk_scores.
// On top of it we apply what Layer 3 has learned: an account the agent
// investigated and CLEARED as a false positive (merchant, payroll, family...)
// is downgraded for a while so honest users stop seeing a CRITICAL warning for
// it, which is exactly the false-positive reduction the agent pipeline exists for.

const Account = require("../models/Account");
const RiskScore = require("../models/RiskScore");
const { predict } = require("./agentServiceClient");

const CLEAR_TTL_MS = Number(process.env.AGENT_CLEAR_TTL_HOURS || 24) * 3600 * 1000;

async function assessReceiver({ sender_account_id, receiver_vpa, amount, device_id }) {
  // A demo account stands for a real model-scored account (ml_account_id), so the
  // score comes from the trained XGBoost + GraphSAGE blend. Unknown VPAs go by VPA.
  const known = await Account.findOne({ vpa_address: receiver_vpa }).lean();
  const ml_account_id = known && known.ml_account_id;

  const raw = await predict({ sender_account_id, receiver_vpa, amount, device_id, ml_account_id });

  if (known && raw.meta && raw.meta.source === "ml-service" && ml_account_id) {
    // The ML service echoes its own account id / synthetic VPA; present the demo identity.
    raw.receiver_account_id = known.account_id;
    raw.receiver_vpa = known.vpa_address;
    raw.meta.ml_account_id = ml_account_id;
  }

  const account = known && known.account_id === raw.receiver_account_id
    ? known
    : await Account.findOne({ account_id: raw.receiver_account_id }).lean();
  const clearedAt = account && account.cleared_by_agent_at && new Date(account.cleared_by_agent_at).getTime();
  const clearedRecently = clearedAt && Date.now() - clearedAt < CLEAR_TTL_MS;

  const stored = await RiskScore.findOne({ account_id: raw.receiver_account_id }, "xgb_score sage_score").lean();
  const model_scores = stored && stored.xgb_score !== undefined && stored.xgb_score !== null
    ? { xgb: stored.xgb_score, sage: stored.sage_score }
    : null;
  if (model_scores) raw.model_scores = model_scores;

  if (clearedRecently && (raw.is_flagged || raw.risk_level === "HIGH")) {
    return {
      raw,
      effective: {
        ...raw,
        is_flagged: false,
        trigger_investigation: false,
        risk_level: "MEDIUM",
        warning_message:
          "Previously flagged by the risk model, then reviewed and cleared as a false positive by FraudGuard investigation.",
        overridden_by: "agent_clearance",
      },
    };
  }

  return { raw, effective: raw };
}

async function persistRisk(raw) {
  return RiskScore.findOneAndUpdate(
    { account_id: raw.receiver_account_id },
    {
      account_id: raw.receiver_account_id,
      vpa_address: raw.receiver_vpa,
      risk_score: raw.risk_score,
      risk_level: raw.risk_level,
      is_flagged: raw.is_flagged,
      warning_message: raw.warning_message,
      model_version: raw.meta ? raw.meta.source : undefined,
      latency_ms: raw.meta ? raw.meta.latency_ms : undefined,
      updated_at: new Date(),
    },
    { upsert: true, new: true }
  );
}

module.exports = { assessReceiver, persistRisk };
