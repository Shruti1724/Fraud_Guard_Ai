// Scripted attack scenarios. Each step either sends a real payment through /send-money
// (so Layer 1 + Layer 3 run for real) or waits for the agents to finish a case.
// Captions are the narration shown over the 3D graph.

export const SCENARIOS = [
  {
    id: "mule_chain",
    name: "Mule Chain Ring",
    tag: "CRITICAL",
    blurb: "Two phishing victims pay a fresh relay. The agents freeze it, then its cash-out attempts bounce.",
    steps: [
      { kind: "pay", from: "C_VICTIM_881", vpa: "mule.relay99@oksbi", amount: 49000, caption: "A phishing victim is tricked into paying a 4-day-old UPI ID." },
      { kind: "pay", from: "C_VICTIM_902", vpa: "mule.relay99@oksbi", amount: 48000, caption: "A second victim pays the same relay within minutes. Layer 1 already scores it 1.00." },
      { kind: "await", account: "acc_mule_chain_01", caption: "Layer 3 is investigating with the live graph: two victim inflows, one offshore outflow." },
      { kind: "pay", from: "acc_mule_chain_01", vpa: "offshore.vault@crypto", amount: 96800, caption: "The relay tries to push everything to the offshore vault." },
      { kind: "pay", from: "acc_mule_chain_01", vpa: "mule.leaf01@axis", amount: 20000, caption: "It tries to fan funds out to a leaf mule instead. The freeze holds." },
    ],
  },
  {
    id: "smurfing",
    name: "Smurfing Burst",
    tag: "CRITICAL",
    blurb: "A syndicate funds a hub, which splits money below the ₹10k KYC limit across leaf mules.",
    steps: [
      { kind: "pay", from: "acc_source_syndicate", vpa: "quicksplit.hub@paytm", amount: 100000, caption: "A syndicate pool funds a smurfing hub with ₹1,00,000." },
      { kind: "await", account: "acc_star_burst_02", caption: "The agents trace the star topology around the hub." },
      { kind: "pay", from: "acc_star_burst_02", vpa: "mule.leaf01@axis", amount: 9900, caption: "The hub starts dispersing in uniform ₹9,900 chunks, just under the limit." },
      { kind: "pay", from: "acc_star_burst_02", vpa: "mule.leaf02@axis", amount: 9900, caption: "Second chunk. The gate is already shut." },
      { kind: "pay", from: "acc_star_burst_02", vpa: "mule.leaf03@icici", amount: 9900, caption: "Third chunk. All dispersal attempts are blocked." },
    ],
  },
  {
    id: "ato",
    name: "Account Takeover",
    tag: "HIGH",
    blurb: "Large transfers around a compromised account. The agents escalate to a human instead of freezing.",
    steps: [
      { kind: "pay", from: "C_CUSTOMER_02", vpa: "rajesh.kumar77@icici", amount: 95000, caption: "₹95,000 hits a legacy account whose device just switched to Linux behind a Tor exit node." },
      { kind: "await", account: "acc_suspicious_device_04", caption: "Not enough evidence of a mule ring to freeze it. The agents decide whether to escalate." },
      { kind: "pay", from: "acc_suspicious_device_04", vpa: "p2p.exchange@global", amount: 90000, caption: "The compromised account then drains funds toward a crypto P2P desk." },
      { kind: "await", account: "acc_crypto_p2p_desk", caption: "The receiving crypto desk gets its own investigation." },
    ],
  },
  {
    id: "false_alarm",
    name: "False Alarm Cleared",
    tag: "FALSE POSITIVE",
    blurb: "Layer 1 flags an honest payroll account. The agents clear it and release the payment.",
    steps: [
      { kind: "pay", from: "acc_user_101", vpa: "apex.tech.salaries@hdfcbank", amount: 62000, caption: "A payment to an honest payroll account. The graph model scores it 0.91, a false positive." },
      { kind: "await", account: "acc_decoy_payroll_04", caption: "The agents compare XGBoost against GraphSAGE and check tenure, KYC and balance." },
      { kind: "pay", from: "acc_user_101", vpa: "apex.tech.salaries@hdfcbank", amount: 5000, caption: "The next payment goes straight through. The cleared flag is downgraded for 24 hours." },
      { kind: "pay", from: "C_CUSTOMER_03", vpa: "vikram.roommate@paytm", amount: 14500, caption: "A flatmate rent split is also flagged by Layer 1 (0.99)." },
      { kind: "await", account: "acc_decoy_forward_02", caption: "Cleared as well. Without Layer 3 both honest users would have been blocked." },
    ],
  },
  {
    id: "clean",
    name: "Legitimate Traffic",
    tag: "LOW",
    blurb: "Ordinary retail payments. Nothing should be flagged.",
    steps: [
      { kind: "pay", from: "acc_user_101", vpa: "sharma.kirana.store@hdfcbank", amount: 450, caption: "Grocery purchase. Scored 0.002." },
      { kind: "pay", from: "C_CUSTOMER_01", vpa: "rohit.mehta@oksbi", amount: 2000, caption: "Peer-to-peer transfer between two regular customers." },
      { kind: "pay", from: "C_CUSTOMER_03", vpa: "gupta.sweets.express@icici", amount: 540, caption: "A sweet-shop payment lands in the warning band (0.79) but is allowed." },
    ],
  },
];

export const LIVE_TRAFFIC = [
  { from: "C_CUSTOMER_01", vpa: "sharma.kirana.store@hdfcbank", amount: [120, 900] },
  { from: "C_CUSTOMER_02", vpa: "gupta.sweets.express@icici", amount: [200, 1500] },
  { from: "C_CUSTOMER_03", vpa: "sharma.kirana.store@hdfcbank", amount: [90, 700] },
  { from: "acc_user_101", vpa: "ananya.verma@okaxis", amount: [500, 4000] },
  { from: "C_CUSTOMER_01", vpa: "rohit.mehta@oksbi", amount: [300, 2500] },
  { from: "C_CUSTOMER_02", vpa: "deepak.singh@paytm", amount: [150, 1800] },
];

export const FRAUD_INJECTIONS = [
  { from: "C_VICTIM_881", vpa: "mule.relay99@oksbi", amount: [20000, 50000] },
  { from: "C_VICTIM_902", vpa: "quicksplit.hub@paytm", amount: [9000, 9900] },
  { from: "C_CUSTOMER_02", vpa: "dubai.remit.express@emirates", amount: [40000, 120000] },
];

export function outcomeOf(res) {
  const { status, data } = res;
  if (status === 403 && data && data.error === "sender_frozen") return { state: "blocked", text: "Blocked at the gate: sender frozen" };
  if (status === 403 && data && data.error === "account_frozen") return { state: "blocked", text: "Blocked at the gate: receiver frozen" };
  if (status === 201 && data.txn && data.txn.status === "FLAGGED") return { state: "held", text: `Held for investigation (${data.risk ? Math.round(data.risk.risk_score * 100) : "?"}% risk)` };
  if (status === 201 && data.txn) return { state: "done", text: "Settled" };
  return { state: "error", text: (data && (data.message || data.error)) || `HTTP ${status}` };
}

export const rand = (lo, hi) => Math.round(lo + Math.random() * (hi - lo));
