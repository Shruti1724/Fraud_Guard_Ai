// Turns the Report Agent's plain-text audit report into structured findings so
// the dashboard can render score bars, topology, risk factors and rationale
// without any change to agent-service. Format reference: nodes/report.py.

function sectionBody(report, name) {
  const re = new RegExp(`\\[${name}\\]([\\s\\S]*?)(?=\\n\\[[^\\]]+\\]|\\n={5,}|$)`);
  const m = report.match(re);
  return m ? m[1].trim() : "";
}

function bullets(text) {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*-\s*/, "").trim())
    .filter((l) => l && !/^None identified|^Baseline account attributes verified/i.test(l));
}

function field(report, label) {
  const re = new RegExp(`^${label}\\s*:\\s*(.+)$`, "m");
  const m = report.match(re);
  return m ? m[1].trim() : null;
}

function num(v) {
  if (v === null || v === undefined) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function parseReport(report) {
  if (typeof report !== "string" || !report.includes("FRAUDGUARD AI CASE AUDIT REPORT")) {
    return { parsed: false };
  }

  // Live reports (nodes/report.py) and the older cached_demo.json fixtures use
  // slightly different labels, so each field tries both.
  const riskLine = field(report, "Risk Score") || field(report, "Risk Assessment") || "";
  const suspicion = riskLine.match(/(\d+)\s*\/\s*100/);
  const level = riskLine.match(/\((\w+)\)/) || riskLine.match(/^(LOW|MEDIUM|HIGH|CRITICAL)/);

  const scoreText = `${field(report, "Model Blending") || ""} ${riskLine}`;
  const pick = (re) => {
    const m = scoreText.match(re);
    return m ? num(m[1]) : null;
  };

  const summary =
    sectionBody(report, "Investigation Summary") || field(report, "Evidence Summary") || "";
  const evidence = bullets(sectionBody(report, "Forensic Evidence Trail"));

  return {
    parsed: true,
    report_case_id: field(report, "Case ID"),
    suspicion_score: suspicion ? Number(suspicion[1]) : null,
    risk_level: level ? level[1] : null,
    scores: {
      blended: pick(/Risk Score:\s*([\d.]+)/),
      xgb: pick(/XGB\)?:\s*([\d.]+)/),
      sage: pick(/SAGE\)?:\s*([\d.]+)/),
    },
    topology: field(report, "Topology Found") || field(report, "Pattern Detected"),
    summary,
    evidence: evidence.length ? evidence : summary ? [summary] : [],
    risk_factors: bullets(sectionBody(report, "Identified Risk Factors")),
    divergence: sectionBody(report, "Model Divergence Analysis") || null,
    verdict: field(report, "Autonomous Verdict") || field(report, "Decision"),
    account_state: field(report, "Account State"),
    rationale: field(report, "Policy Rationale"),
    action_executed: field(report, "Action Executed") || field(report, "Action Taken"),
    generated_at: field(report, "Generated At"),
  };
}

module.exports = { parseReport };
