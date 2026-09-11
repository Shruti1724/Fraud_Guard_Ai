const mongoose = require("mongoose");

// Matches docs/mongo-schema.md exactly (collection: transactions)
const transactionSchema = new mongoose.Schema(
  {
    transaction_id: { type: String, required: true, unique: true, index: true },
    step: { type: Number },
    type: { type: String, default: "PAYMENT" }, // PAYMENT | TRANSFER | CASH_OUT
    amount: { type: Number, required: true },
    sender_account_id: { type: String, required: true, index: true },
    sender_vpa: { type: String },
    receiver_account_id: { type: String, required: true, index: true },
    receiver_vpa: { type: String },
    timestamp: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ["SUCCESS", "BLOCKED", "FLAGGED"],
      default: "SUCCESS",
    },
    device_id: { type: String },
    is_fraud: { type: Boolean, default: false },
    is_synthetic_ring: { type: Boolean, default: false },
    ring_id: { type: String },
  },
  { collection: "transactions" }
);

module.exports = mongoose.model("Transaction", transactionSchema);
