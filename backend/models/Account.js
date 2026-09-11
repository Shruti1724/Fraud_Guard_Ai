const mongoose = require("mongoose");

// Matches docs/mongo-schema.md exactly (collection: accounts)
const accountSchema = new mongoose.Schema(
  {
    account_id: { type: String, required: true, unique: true, index: true },
    vpa_address: { type: String, required: true, unique: true, index: true },
    account_holder_name: { type: String, required: true },
    account_age_days: { type: Number, default: 0 },
    kyc_status: { type: String, default: "MINIMUM_OTP" },
    current_balance: { type: Number, default: 0 },
    avg_tx_amount: { type: Number },
    tx_frequency_per_day: { type: Number },
    unique_counterparties: { type: Number },
    device_id: { type: String, required: true },
    ip_address: { type: String },
    risk_status: {
      type: String,
      enum: ["ACTIVE", "FROZEN", "UNDER_INVESTIGATION"],
      default: "ACTIVE",
    },
    created_at: { type: Date, default: Date.now },
  },
  { collection: "accounts" }
);

module.exports = mongoose.model("Account", accountSchema);
