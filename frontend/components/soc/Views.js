import React, { useEffect, useMemo, useState } from "react";
import { Search, Brain, Timer, ShieldCheck, Layers } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { C, riskColor, statusColor, ROLE_LABEL, inr, dur, decisionMeta } from "./theme";
import { Pill, Bar, Empty, SectionTitle } from "./ui";
import { CaseQueue } from "./AccountPanel";
import { InvestigationPanel } from "./InvestigationPanel";
import { getModelMetrics } from "../../lib/api";

export function CasesView({ soc, focus, setFocus }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(340px, 480px) 1fr", gap: 14, padding: 14 }}>
      <CaseQueue soc={soc} focus={focus} onOpen={setFocus} />
      <div style={{ display: "flex", minHeight: 0, maxWidth: 820 }}>
        <InvestigationPanel soc={soc} focus={focus} onResolved={() => soc.refreshAll()} />
      </div>
    </div>
  );
}

export function AccountsView({ soc, onOpen }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return [...soc.nodesRef.current.values()]
      .filter((n) => !term || [n.id, n.vpa_address, n.account_holder_name, n.role].some((v) => v && String(v).toLowerCase().includes(term)))
      .sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, soc.version]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ position: "relative", width: 420 }}>
          <Search size={15} style={{ position: "absolute", left: 13, top: 11, color: C.dim }} />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search VPA, name, account id or role"
            style={{ width: "100%", padding: "9px 12px 9px 36px", borderRadius: 11, border: "1px solid rgba(130,160,210,.22)", background: "rgba(255,255,255,.04)", color: C.text, fontFamily: "inherit", fontSize: 13, outline: "none" }}
          />
        </div>
        <span style={{ color: C.mute, fontSize: 12 }}>{rows.length} accounts, sorted by Layer-1 risk</span>
      </div>
      <div className="soc-card soc-scroll" style={{ flex: 1, minHeight: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ position: "sticky", top: 0, background: "#0b101c", zIndex: 1 }}>
              {["Account", "Role", "Status", "Risk", "XGB / SAGE", "Balance", "Age"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "11px 14px", fontSize: 10.5, letterSpacing: ".12em", color: C.mute, fontWeight: 700, textTransform: "uppercase", borderBottom: "1px solid rgba(130,160,210,.16)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n.id} className="soc-row-hover" onClick={() => onOpen(n.id)} style={{ cursor: "pointer", borderBottom: "1px solid rgba(130,160,210,.07)" }}>
                <td style={{ padding: "10px 14px" }}>
                  <div style={{ fontWeight: 700 }}>{n.account_holder_name}</div>
                  <div className="soc-mono" style={{ fontSize: 11, color: C.dim }}>{n.vpa_address}</div>
                </td>
                <td style={{ padding: "10px 14px", color: C.mute }}>{ROLE_LABEL[n.role] || n.role}</td>
                <td style={{ padding: "10px 14px" }}><Pill color={statusColor(n.risk_status)}>{(n.risk_status || "ACTIVE").replace("_", " ")}</Pill></td>
                <td style={{ padding: "10px 14px", width: 190 }}><Bar value={n.risk_score || 0} marker={0.85} color={riskColor(n.risk_level)} height={5} right={`${n.risk_level} ${((n.risk_score || 0) * 100).toFixed(0)}%`} /></td>
                <td className="soc-mono" style={{ padding: "10px 14px", fontSize: 11.5, color: C.mute }}>{n.model_scores ? `${n.model_scores.xgb.toFixed(2)} / ${n.model_scores.sage.toFixed(2)}` : "—"}</td>
                <td style={{ padding: "10px 14px" }}>{inr(n.current_balance)}</td>
                <td style={{ padding: "10px 14px", color: C.mute }}>{n.account_age_days}d</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty>No accounts match.</Empty>}
      </div>
    </div>
  );
}

function Stat({ icon, label, value, sub, color = C.cyan }) {
  return (
    <div className="soc-card" style={{ padding: "16px 18px", flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10.5, letterSpacing: ".12em", color: C.mute, fontWeight: 700, textTransform: "uppercase" }}>
        <span style={{ color }}>{icon}</span>{label}
      </div>
      <div style={{ fontSize: 34, fontWeight: 800, marginTop: 6, color }}>{value}</div>
      <div style={{ fontSize: 12, color: C.mute, marginTop: 2, lineHeight: 1.45 }}>{sub}</div>
    </div>
  );
}

export function IntelligenceView({ soc }) {
  const [metrics, setMetrics] = useState(null);
  useEffect(() => { getModelMetrics().then(setMetrics).catch(() => setMetrics({ available: false })); }, []);
  const s = soc.stats || {};
  const d = s.decisions || {};
  const pie = [
    { name: "Auto-block", value: d.auto_block || 0, color: C.red },
    { name: "Escalate", value: d.escalate || 0, color: C.amber },
    { name: "Cleared", value: d.clear || 0, color: C.green },
  ].filter((x) => x.value > 0);
  const speedup = s.avg_decision_ms ? Math.round((s.human_baseline_minutes * 60 * 1000) / s.avg_decision_ms) : null;
  const blend = metrics && metrics.models && metrics.models[metrics.models.length - 1];

  return (
    <div className="soc-scroll" style={{ flex: 1, minHeight: 0, padding: 14, display: "grid", gap: 14, alignContent: "start" }}>
      <div style={{ display: "flex", gap: 14 }}>
        <Stat icon={<Timer size={14} />} label="Agent decision time" color={C.violet} value={dur(s.avg_decision_ms)} sub={speedup ? `Roughly ${speedup}× faster than the ${s.human_baseline_minutes}-minute manual triage the project set out to beat.` : "Resolve a case to measure."} />
        <Stat icon={<ShieldCheck size={14} />} label="False alarms cleared" color={C.green} value={s.false_positives_cleared || 0} sub="Honest accounts the graph model flagged and Layer 3 cleared, so real customers aren't blocked." />
        <Stat icon={<Brain size={14} />} label="Cases investigated" color={C.cyan} value={s.cases || 0} sub={`${d.auto_block || 0} blocked · ${d.escalate || 0} escalated · ${d.clear || 0} cleared`} />
        <Stat icon={<Layers size={14} />} label="Money stopped" color={C.red} value={`₹${((s.money_blocked || 0) / 1000).toFixed(0)}k`} sub={`${s.blocked || 0} payments blocked at the gate or after review`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 14 }}>
        <div className="soc-card" style={{ padding: 0 }}>
          <SectionTitle icon={<Layers size={13} />}>Why a second layer exists: model evaluation (ml-service results)</SectionTitle>
          {!metrics && <Empty>Loading evaluation results…</Empty>}
          {metrics && !metrics.available && <Empty>Evaluation results not found in ml-service/results.</Empty>}
          {metrics && metrics.available && (
            <div style={{ padding: "0 14px 16px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr>
                    {["Model", "ROC-AUC", "Precision @0.85", "Recall @0.85", "Fraud rings caught", "Honest accounts wrongly flagged"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "8px 8px", fontSize: 10, letterSpacing: ".1em", color: C.mute, fontWeight: 700, textTransform: "uppercase", borderBottom: "1px solid rgba(130,160,210,.16)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metrics.models.map((m, i) => (
                    <tr key={m.label} style={{ borderBottom: "1px solid rgba(130,160,210,.07)", background: i === metrics.models.length - 1 ? "rgba(56,216,255,.06)" : "transparent" }}>
                      <td style={{ padding: "10px 8px", fontWeight: 700 }}>{m.label}</td>
                      <td className="soc-mono" style={{ padding: "10px 8px" }}>{m.auc_roc.toFixed(3)}</td>
                      <td style={{ padding: "10px 8px", width: 150 }}><Bar value={m.precision} color={m.precision > 0.4 ? C.green : C.orange} height={5} right={`${(m.precision * 100).toFixed(0)}%`} /></td>
                      <td style={{ padding: "10px 8px", width: 150 }}><Bar value={m.recall} color={C.cyan} height={5} right={`${(m.recall * 100).toFixed(0)}%`} /></td>
                      <td className="soc-mono" style={{ padding: "10px 8px" }}>{m.rings ? `${m.rings.caught}/${m.rings.total}` : "—"}</td>
                      <td className="soc-mono" style={{ padding: "10px 8px", color: C.amber }}>{m.decoy_false_alarms ? `${m.decoy_false_alarms.caught}/${m.decoy_false_alarms.total}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {blend && (
                <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 12, background: "rgba(255,176,32,.07)", border: "1px solid rgba(255,176,32,.28)", fontSize: 12.5, lineHeight: 1.6, color: C.text }}>
                  <b style={{ color: C.amber }}>The gap Layer 3 closes.</b> The production blend catches {blend.rings.caught} of {blend.rings.total} injected fraud rings, but at the 0.85 flag threshold only {(blend.precision * 100).toFixed(0)}% of flagged accounts are truly fraudulent. The rest are honest look-alikes (merchants, payroll, family). The four-agent pipeline exists to tell them apart before anyone is blocked.
                </div>
              )}
              <div style={{ marginTop: 8, fontSize: 11, color: C.dim }}>Source: {metrics.source}</div>
            </div>
          )}
        </div>

        <div className="soc-card" style={{ padding: 0 }}>
          <SectionTitle>Live verdict mix</SectionTitle>
          {pie.length === 0 ? <Empty>Verdicts will appear here as cases resolve.</Empty> : (
            <div style={{ height: 250, padding: "0 10px" }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={3} stroke="none">
                    {pie.map((p) => <Cell key={p.name} fill={p.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#0b101c", border: "1px solid rgba(130,160,210,.3)", borderRadius: 10, color: "#e8eefb", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <div style={{ padding: "0 14px 16px", display: "grid", gap: 7 }}>
            {pie.map((p) => (
              <div key={p.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                <span style={{ color: p.color, fontWeight: 700 }}>{p.name}</span><span className="soc-mono">{p.value}</span>
              </div>
            ))}
            <div style={{ marginTop: 6, borderTop: "1px solid rgba(130,160,210,.12)", paddingTop: 10 }}>
              {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((lvl) => (
                <Bar key={lvl} label={lvl} value={(s.risk_levels || {})[lvl] || 0} max={s.total_accounts || 1} color={riskColor(lvl)} height={4} right={(s.risk_levels || {})[lvl] || 0} />
              ))}
              <div style={{ fontSize: 10.5, color: C.dim, marginTop: 6 }}>Layer-1 risk levels across accounts</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export { decisionMeta };
