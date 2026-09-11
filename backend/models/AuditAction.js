const mongoose = require("mongoose");

// Matches docs/mongo-schema.md exactly (collection: audit_actions)
const auditActionSchema = new mongoose.Schema(
  {
    action_id: { type: String, required: true, unique: true, index: true },
    case_id: { type: String, required: true, index: true },
    account_id: { type: String, required: true, index: true },
    action_type: { type: String, required: true },
    target_system: { type: String, default: "AGENT_SERVICE" },
    status: {
      type: String,
      enum: ["EXECUTED", "SIMULATED", "FAILED"],
      default: "SIMULATED",
    },
    details: { type: mongoose.Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now },
  },
  { collection: "audit_actions" }
);

module.exports = mongoose.model("AuditAction", auditActionSchema);
