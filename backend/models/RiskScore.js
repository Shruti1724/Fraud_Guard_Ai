const mongoose = require("mongoose");

// Matches docs/mongo-schema.md exactly (collection: risk_scores)
// Written by Member A's backend after every /predict call, so the dashboard
// has a queryable history even though /predict itself computes on demand.
const riskScoreSchema = new mongoose.Schema(
  {
    account_id: { type: String, required: true, unique: true, index: true },
    vpa_address: { type: String, required: true },
    risk_score: { type: Number, required: true, min: 0, max: 1 },
    risk_level: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      required: true,
    },
    is_flagged: { type: Boolean, required: true },
    warning_message: { type: String, required: true },
    model_version: { type: String, default: "agent-service-v1" },
    topological_flags: { type: [String], default: [] },
    updated_at: { type: Date, default: Date.now },
  },
  { collection: "risk_scores" }
);

module.exports = mongoose.model("RiskScore", riskScoreSchema);
