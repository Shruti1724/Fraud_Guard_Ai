import React, { useEffect, useMemo, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { Search, Scale, Zap, FileText, Printer, ShieldCheck, ShieldX, Siren, Network, Brain, Database, GitCompare } from "lucide-react";
import { C, decisionMeta, riskColor, dur, inr } from "./theme";
import { Pill, Btn, Bar, Gauge, KV, Empty, SectionTitle, Dot } from "./ui";
import { resolveCase } from "../../lib/api";

function useNow(ms = 200, active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, active]);
  return now;
}

const STAGES = [
  { id: "investigator", label: "Investigator", icon: Search, blurb: "Reads the account profile and live graph neighborhood, scores suspicion and separates mule rings from innocent look-alikes.", weight: 0.42 },
  { id: "decision", label: "Decision", icon: Scale, blurb: "Hard compliance rules first, then LLM judgment, to auto-block, escalate or clear.", weight: 0.26 },
  { id: "action", label: "Action", icon: Zap, blurb: "Turns the verdict into a freeze, a step-up challenge or a release.", weight: 0.1 },
  { id: "report", label: "Report", icon: FileText, blurb: "Writes the audit report with the full evidence trail.", weight: 0.22 },
];

function Pipeline({ inv }) {
  const done = inv.state === "done";
  const failed = inv.state === "failed";
  const started = new Date(inv.started_at).getTime();
  const now = useNow(150, inv.state === "running");
  const elapsed = done ? inv.duration_ms : Math.max(0, now - started);
  // Stage timing is indicative (the pipeline reports only its total); the timer is real.
  const expected = 12000;
  const progress = done ? 1 : Math.min(0.96, elapsed / expected);
  let acc = 0;
  const staged = STAGES.map((s) => {
    const from = acc;
    acc += s.weight;
    const state = done ? "done" : progress >= acc ? "done" : progress >= from ? "active" : "wait";
    return { ...s, state };
  });

  return (
    <div style={{ padding: "4px 14px 14px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {failed ? <Pill color={C.red}>FAILED</Pill> : done ? <Pill color={C.green}>PIPELINE COMPLETE</Pill> : <Pill color={C.amber}><Dot color={C.amber} pulse size={6} /> AGENTS RUNNING</Pill>}
        </div>
        <span className="soc-mono" style={{ fontSize: 22, fontWeight: 800, color: failed ? C.red : done ? C.green : C.amber }}>{(elapsed / 1000).toFixed(1)}s</span>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {staged.map((s, i) => {
          const Icon = s.icon;
          const col = s.state === "done" ? C.green : s.state === "active" ? C.amber : C.dim;
          return (
            <div key={s.id} style={{ display: "flex", gap: 11, padding: "10px 11px", borderRadius: 12, background: s.state === "active" ? "rgba(255,176,32,.08)" : "rgba(255,255,255,.03)", border: `1px solid ${s.state === "wait" ? "rgba(130,160,210,.1)" : col + "55"}`, transition: "all .35s" }}>
              <div style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: `${col}1c`, color: col, flexShrink: 0 }}>
                <Icon size={15} className={s.state === "active" ? "soc-blink" : undefined} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 700 }}>
                  <span>{i + 1}. {s.label}</span>
                  <span style={{ fontSize: 10, letterSpacing: ".1em", color: col }}>{s.state === "done" ? "DONE" : s.state === "active" ? "WORKING" : "QUEUED"}</span>
                </div>
                <div style={{ fontSize: 11, color: C.mute, marginTop: 2, lineHeight: 1.45 }}>{s.blurb}</div>
              </div>
            </div>
          );
        })}
      </div>
      {inv.context && (
        <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 12, background: "rgba(56,216,255,.06)", border: "1px solid rgba(56,216,255,.2)", fontSize: 11.5, color: C.mute, lineHeight: 1.6 }}>
          <div style={{ color: C.cyan, fontWeight: 700, fontSize: 10.5, letterSpacing: ".1em", marginBottom: 3 }}><Network size={11} style={{ verticalAlign: -1 }} /> LIVE GRAPH CONTEXT SENT TO THE AGENTS</div>
          {inv.context.neighbors} counterparties · {inv.context.transactions} recent transactions
          {inv.context.victims ? ` · ${inv.context.victims} victim inflow${inv.context.victims > 1 ? "s" : ""}` : ""}
          {inv.context.sinks ? ` · ${inv.context.sinks} offshore sink outflow` : ""}
        </div>
      )}
      {failed && <div style={{ marginTop: 10, fontSize: 12, color: C.red }}>{inv.error}</div>}
    </div>
  );
}

function ScoreCompare({ scores }) {
  if (!scores || (scores.xgb == null && scores.sage == null)) return null;
  const gap = scores.xgb != null && scores.sage != null ? Math.abs(scores.sage - scores.xgb) : 0;
  return (
    <div style={{ padding: "0 14px 12px" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".12em", color: C.mute, marginBottom: 9, display: "flex", alignItems: "center", gap: 6 }}>
        <GitCompare size={12} /> LAYER-1 MODELS DISAGREE?
      </div>
      <div style={{ display: "grid", gap: 9 }}>
        {scores.xgb != null && <Bar label="XGBoost (tabular)" value={scores.xgb} marker={0.85} color={riskColor(scores.xgb >= 0.85 ? "CRITICAL" : scores.xgb >= 0.7 ? "HIGH" : "LOW")} right={scores.xgb.toFixed(3)} />}
        {scores.sage != null && <Bar label="GraphSAGE (network)" value={scores.sage} marker={0.85} color={riskColor(scores.sage >= 0.85 ? "CRITICAL" : scores.sage >= 0.7 ? "HIGH" : "LOW")} right={scores.sage.toFixed(3)} />}
        {scores.blended != null && <Bar label="Blended 0.3·XGB + 0.7·SAGE" value={scores.blended} marker={0.85} color={riskColor(scores.blended >= 0.85 ? "CRITICAL" : scores.blended >= 0.7 ? "HIGH" : "LOW")} right={scores.blended.toFixed(3)} />}
      </div>
      {gap > 0.4 && (
        <div style={{ marginTop: 9, fontSize: 11.5, color: C.cyan, background: "rgba(56,216,255,.07)", border: "1px solid rgba(56,216,255,.2)", borderRadius: 10, padding: "7px 10px", lineHeight: 1.5 }}>
          The network model and the profile model differ by {gap.toFixed(2)}. This is where the agent review earns its keep.
        </div>
      )}
    </div>
  );
}

function List({ title, items, color = C.mute }) {
  if (!items || !items.length) return null;
  return (
    <div style={{ padding: "0 14px 12px" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".12em", color: C.mute, marginBottom: 7 }}>{title}</div>
      <div style={{ display: "grid", gap: 5 }}>
        {items.map((t, i) => (
          <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, lineHeight: 1.45, color: C.text }}>
            <span style={{ color, marginTop: 2 }}>▸</span>
            <span>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Dossier({ kase, nameOf, onResolved }) {
  const f = kase.findings || {};
  const m = decisionMeta(kase.decision);
  const [busy, setBusy] = useState(false);
  const printRef = useRef(null);
  const print = useReactToPrint({ contentRef: printRef, documentTitle: kase.case_id });
  const needsAnalyst = kase.status === "UNDER_REVIEW";
  const scoreColor = f.suspicion_score >= 80 ? C.red : f.suspicion_score >= 50 ? C.orange : C.green;

  const act = async (action) => {
    setBusy(true);
    await resolveCase(kase.case_id, action, action === "OVERRIDE_CLEAR" ? "Reviewed: legitimate activity" : "Reviewed: confirmed fraud", "SOC Analyst");
    setBusy(false);
    onResolved && onResolved();
  };

  return (
    <div className="soc-rise">
      <div style={{ margin: "0 14px 12px", padding: "13px 14px", borderRadius: 14, background: `linear-gradient(135deg, ${m.color}26, ${m.color}08)`, border: `1px solid ${m.color}66`, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: `${m.color}22`, display: "grid", placeItems: "center", color: m.color }}>
          {kase.decision === "auto_block" ? <ShieldX size={22} /> : kase.decision === "clear" ? <ShieldCheck size={22} /> : <Siren size={22} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10.5, letterSpacing: ".14em", color: C.mute, fontWeight: 700 }}>AUTONOMOUS VERDICT</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: m.color, letterSpacing: ".02em" }}>{m.label}</div>
        </div>
        {f.suspicion_score != null && <Gauge value={f.suspicion_score} color={scoreColor} size={96} label={f.suspicion_score} sub="suspicion" />}
      </div>

      {kase.decision_source === "FAILSAFE" && (
        <div style={{ margin: "0 14px 12px", padding: "8px 11px", borderRadius: 10, background: "rgba(255,59,92,.1)", border: "1px solid rgba(255,59,92,.4)", fontSize: 12, color: "#ff8fa3" }}>
          Fail-safe: the AI pipeline was unavailable, so the account was held for a human instead of being allowed through.
        </div>
      )}

      <div style={{ padding: "0 14px 12px" }}>
        <KV k="Case" v={kase.case_id} mono />
        <KV k="Account" v={nameOf(kase.account_id)} mono />
        {f.topology && <KV k="Pattern" v={f.topology} />}
        <KV k="Resolved in" v={dur(kase.duration_ms)} color={C.violet} />
        <KV k="Decided by" v={kase.decision_source === "ANALYST" ? `Analyst ${kase.resolved_by || ""}` : kase.decision_source === "FAILSAFE" ? "Fail-safe" : "AI agents"} />
      </div>

      <ScoreCompare scores={f.scores} />

      {f.rationale && (
        <div style={{ padding: "0 14px 12px" }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".12em", color: C.mute, marginBottom: 6 }}>POLICY RATIONALE</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.55, color: C.text, padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,.04)", borderLeft: `3px solid ${m.color}` }}>{f.rationale}</div>
        </div>
      )}
      {f.divergence && (
        <div style={{ padding: "0 14px 12px", fontSize: 12, color: C.mute, lineHeight: 1.55 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".12em", marginBottom: 6 }}>MODEL DIVERGENCE ANALYSIS</div>
          {f.divergence}
        </div>
      )}
      <List title="RISK FACTORS" items={f.risk_factors} color={C.red} />
      <List title="EVIDENCE TRAIL" items={f.evidence} color={C.cyan} />

      <div style={{ padding: "0 14px 12px" }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".12em", color: C.mute, marginBottom: 6 }}>ACTION EXECUTED</div>
        <div style={{ fontSize: 12, color: C.text, lineHeight: 1.55 }}>{kase.action_taken}</div>
        {kase.analyst_note && <div style={{ marginTop: 6, fontSize: 12, color: C.violet }}>Analyst note: {kase.analyst_note}</div>}
      </div>

      <div style={{ padding: "0 14px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        {needsAnalyst && (
          <>
            <Btn solid color={C.red} disabled={busy} onClick={() => act("APPROVE_BLOCK")}><ShieldX size={13} /> Confirm block</Btn>
            <Btn solid color={C.green} disabled={busy} onClick={() => act("OVERRIDE_CLEAR")}><ShieldCheck size={13} /> Override: clear</Btn>
          </>
        )}
        <Btn color={C.violet} onClick={print}><Printer size={13} /> Export SAR</Btn>
      </div>

      {/* printable SAR (hidden on screen) */}
      <div style={{ position: "absolute", left: -99999, top: 0 }}>
        <div ref={printRef} className="soc-print" style={{ width: 760, background: "#fff", color: "#111", padding: 32, fontFamily: "Inter, sans-serif" }}>
          <div style={{ fontSize: 11, letterSpacing: ".2em", color: "#555", fontWeight: 700 }}>FRAUDGUARD AI · SUSPICIOUS ACTIVITY REPORT</div>
          <h1 style={{ margin: "6px 0 2px", fontSize: 24 }}>{kase.case_id}</h1>
          <div style={{ color: "#555", fontSize: 13 }}>{new Date(kase.created_at).toLocaleString()} · Verdict {m.label}</div>
          <hr style={{ margin: "14px 0", border: 0, borderTop: "1px solid #ddd" }} />
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.6, fontFamily: "ui-monospace, Menlo, monospace" }}>{kase.report}</pre>
          {kase.analyst_note && <p style={{ fontSize: 12 }}><b>Analyst note:</b> {kase.analyst_note}</p>}
          <div style={{ marginTop: 18, fontSize: 10, color: "#777" }}>Generated by FraudGuard AI. Freeze and block actions in this prototype are simulated.</div>
        </div>
      </div>
    </div>
  );
}

// focus: { ref } for a live/just-finished investigation, or { case_id } for a stored case
export function InvestigationPanel({ soc, focus, onResolved }) {
  const inv = focus && focus.ref ? soc.investigations.find((i) => i.ref === focus.ref) : null;
  const kase = useMemo(() => {
    if (focus && focus.case_id) return soc.cases.find((c) => c.case_id === focus.case_id);
    if (inv && inv.case) return soc.cases.find((c) => c.case_id === inv.case.case_id) || inv.case;
    return null;
  }, [focus, inv, soc.cases]);

  const title = inv ? soc.nameOf(inv.account_id) : kase ? soc.nameOf(kase.account_id) : null;

  if (!inv && !kase) {
    return (
      <div className="soc-card" style={{ flex: 1 }}>
        <SectionTitle icon={<Brain size={13} />}>Investigation</SectionTitle>
        <Empty>
          No case selected.<br />
          When Layer 1 flags a payment, the four agents open a case here and you can watch it resolve live. Pick a case from the queue to read its dossier.
        </Empty>
      </div>
    );
  }

  return (
    <div className="soc-card soc-scroll" style={{ flex: 1, minHeight: 0, position: "relative" }}>
      <SectionTitle icon={<Brain size={13} />} right={inv && <span className="soc-mono" style={{ fontSize: 10.5, color: C.dim }}>{inv.ref}</span>}>
        Investigation
      </SectionTitle>
      <div style={{ padding: "0 14px 10px" }}>
        <div className="soc-mono" style={{ fontSize: 13.5, fontWeight: 700, wordBreak: "break-all" }}>{title}</div>
      </div>
      {inv && inv.state !== "done" && <Pipeline inv={inv} />}
      {kase && <Dossier kase={kase} nameOf={soc.nameOf} onResolved={onResolved} />}
      {inv && inv.state === "done" && !kase && <Empty>Loading dossier…</Empty>}
    </div>
  );
}

export { inr };
