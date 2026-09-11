const mongoose = require("mongoose");

// Matches docs/mongo-schema.md exactly (collection: investigation_cases)
const investigationCaseSchema = new mongoose.Schema(
  {
    case_id: { type: String, required: true, unique: true, index: true },
    account_id: { type: String, required: true, index: true },
    triggered_by: {
      type: String,
      enum: ["LAYER2_GNN_THRESHOLD", "MANUAL"],
      default: "LAYER2_GNN_THRESHOLD",
    },
    investigator_findings: { type: mongoose.Schema.Types.Mixed, default: {} },
    decision: {
      type: String,
      enum: ["auto_block", "escalate", "clear"],
      required: true,
    },
    action_taken: { type: String, required: true },
    report: { type: String, required: true },
    status: {
      type: String,
      enum: ["RESOLVED", "UNDER_REVIEW"],
      default: "RESOLVED",
    },
    created_at: { type: Date, default: Date.now },
  },
  { collection: "investigation_cases" }
);

module.exports = mongoose.model("InvestigationCase", investigationCaseSchema);
