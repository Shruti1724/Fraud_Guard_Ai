export const C = {
  bg: "#04060c",
  panel: "rgba(11, 16, 28, 0.78)",
  panelSolid: "#0b101c",
  raised: "rgba(255,255,255,0.04)",
  border: "rgba(130, 160, 210, 0.16)",
  text: "#e8eefb",
  mute: "#93a2bd",
  dim: "#5d6d89",
  cyan: "#38d8ff",
  green: "#2ee6a6",
  amber: "#ffb020",
  orange: "#ff8a3d",
  red: "#ff3b5c",
  violet: "#a78bfa",
  blue: "#4f8cff",
  ice: "#9fd0ff",
};

export const riskColor = (level) =>
  ({ CRITICAL: C.red, HIGH: C.orange, MEDIUM: C.amber, LOW: C.green }[level] || C.green);

export const statusColor = (status) =>
  ({ FROZEN: C.red, UNDER_INVESTIGATION: C.amber, ACTIVE: C.green }[status] || C.green);

export const txnColor = (status) =>
  ({ BLOCKED: C.red, FLAGGED: C.amber, SUCCESS: "#4aa3c7" }[status] || "#4aa3c7");

export const decisionMeta = (decision) =>
  ({
    auto_block: { label: "AUTO-BLOCK", color: C.red, verb: "Blocked" },
    escalate: { label: "ESCALATE", color: C.amber, verb: "Held for review" },
    clear: { label: "CLEARED", color: C.green, verb: "Cleared" },
  }[decision] || { label: "PENDING", color: C.mute, verb: "Pending" });

export const ROLE_LABEL = {
  SINK: "Offshore sink",
  SYNDICATE: "Syndicate pool",
  RELAY: "Mule relay",
  MULE: "Leaf mule",
  SMURF: "Smurfing hub",
  ATO: "Takeover victim",
  HAWALA: "Hawala gateway",
  VICTIM: "Phishing victim",
  MERCHANT: "Merchant",
  PAYROLL: "Payroll account",
  FAMILY: "Family account",
  FLATMATE: "Flatmate",
  USER: "Customer",
};

export const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
export const inrShort = (n) => {
  const v = Number(n || 0);
  if (v >= 1e7) return "₹" + (v / 1e7).toFixed(2) + "Cr";
  if (v >= 1e5) return "₹" + (v / 1e5).toFixed(2) + "L";
  if (v >= 1e3) return "₹" + (v / 1e3).toFixed(1) + "k";
  return "₹" + v.toFixed(0);
};
export const pct = (n, d = 1) => (Number(n || 0) * 100).toFixed(d) + "%";
export const dur = (ms) => (ms == null ? "—" : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`);
export const clock = (d = new Date()) => d.toLocaleTimeString([], { hour12: false });
