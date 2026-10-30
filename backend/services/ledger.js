// Minimal ledger: moves money only when a transaction actually settles
// (SUCCESS). Held (FLAGGED) and BLOCKED transactions never touch balances.
// Simulation traffic is excluded so scripted attack scenarios (a victim "sending"
// more than their balance) don't distort the demo accounts.

const Account = require("../models/Account");
const Transaction = require("../models/Transaction");

async function settleIfEligible(txn) {
  if (!txn || txn.simulated || txn.settled || txn.status !== "SUCCESS") return null;

  // Claim the settlement atomically so a double release can't move money twice.
  const claimed = await Transaction.findOneAndUpdate(
    { transaction_id: txn.transaction_id, settled: { $ne: true } },
    { settled: true },
    { new: true }
  ).lean();
  if (!claimed) return null;

  const [sender, receiver] = await Promise.all([
    Account.findOneAndUpdate(
      { account_id: txn.sender_account_id },
      { $inc: { current_balance: -txn.amount } },
      { new: true }
    ).lean(),
    Account.findOneAndUpdate(
      { account_id: txn.receiver_account_id },
      { $inc: { current_balance: txn.amount } },
      { new: true }
    ).lean(),
  ]);

  return {
    sender: sender && { account_id: sender.account_id, current_balance: sender.current_balance },
    receiver: receiver && { account_id: receiver.account_id, current_balance: receiver.current_balance },
  };
}

module.exports = { settleIfEligible };
