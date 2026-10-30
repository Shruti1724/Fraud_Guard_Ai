// Role classification for graph nodes. Shared by the dashboard graph route
// (visual role/glyph) and the investigation service (risk_label hints that the
// agent's Investigator keys on: VICTIM / SINK / FLAGGED_MULE).

function classifyRole(acc = {}, risk = {}, accountId = "") {
  const idLower = (accountId || acc.account_id || "").toLowerCase();
  const vpaLower = (acc.vpa_address || risk.vpa_address || "").toLowerCase();
  const nameLower = (acc.account_holder_name || "").toLowerCase();

  if (idLower.includes("sink") || vpaLower.includes("crypto") || vpaLower.includes("vault")) {
    return { role: "SINK", glyph: "SINK" };
  }
  if (idLower.includes("syndicate") || vpaLower.includes("syndicate") || vpaLower.includes("darknet")) {
    return { role: "SYNDICATE", glyph: "SYND" };
  }
  if (idLower.includes("mule_chain") || vpaLower.includes("relay") || nameLower.includes("relay")) {
    return { role: "RELAY", glyph: "RELAY" };
  }
  if (idLower.includes("leaf") || vpaLower.includes("leaf") || nameLower.includes("leaf")) {
    return { role: "MULE", glyph: "MULE" };
  }
  if (idLower.includes("burst") || vpaLower.includes("quicksplit") || vpaLower.includes("hub")) {
    return { role: "SMURF", glyph: "HUB" };
  }
  if (idLower.includes("suspicious") || idLower.includes("ato") || nameLower.includes("compromised")) {
    return { role: "ATO", glyph: "ATO" };
  }
  if (idLower.includes("remit") || vpaLower.includes("hawala") || vpaLower.includes("emirates") || nameLower.includes("hawala")) {
    return { role: "HAWALA", glyph: "HAWALA" };
  }
  if (idLower.includes("victim") || nameLower.includes("victim")) {
    return { role: "VICTIM", glyph: "VICTIM" };
  }
  if (idLower.includes("payroll") || nameLower.includes("payroll")) return { role: "PAYROLL", glyph: "PAY" };
  if (idLower.includes("family") || nameLower.includes("family")) return { role: "FAMILY", glyph: "FAM" };
  if (idLower.includes("forward") || nameLower.includes("flatmate")) return { role: "FLATMATE", glyph: "FWD" };
  if (idLower.includes("retail") || vpaLower.includes("kirana") || nameLower.includes("merchant") || nameLower.includes("store")) {
    return { role: "MERCHANT", glyph: "SHOP" };
  }
  return { role: "USER", glyph: "U" };
}

// Label understood by agent-service/nodes/investigator.py and decision.py.
function agentRiskLabel(role, risk = {}) {
  if (role === "SINK") return "SINK";
  if (role === "VICTIM") return "VICTIM";
  if (["RELAY", "MULE", "SMURF", "SYNDICATE"].includes(role)) return "FLAGGED_MULE";
  if (["ATO", "HAWALA"].includes(role)) return "HIGH_RISK";
  if (risk.risk_level === "CRITICAL" || risk.risk_level === "HIGH") return "HIGH_RISK";
  return "NORMAL";
}

module.exports = { classifyRole, agentRiskLabel };
