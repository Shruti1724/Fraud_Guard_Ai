import React, { useState } from "react";
import {
  Shield, Activity, Database, Brain, Server, Cpu, Wifi, WifiOff, RotateCcw, Smartphone, FileText, Users, BarChart3,
  LayoutDashboard, Terminal, Siren, Timer, Lock, Eye, Banknote,
} from "lucide-react";
import { C, inr, inrShort, dur } from "./theme";
import { Dot, Btn, SectionTitle, Empty } from "./ui";
import { resetDemo } from "../../lib/api";

export const VIEWS = [
  { id: "command", label: "Command Center", icon: <LayoutDashboard size={14} /> },
  { id: "cases", label: "Cases", icon: <FileText size={14} /> },
  { id: "accounts", label: "Accounts", icon: <Users size={14} /> },
  { id: "intel", label: "Intelligence", icon: <BarChart3 size={14} /> },
];

function ServicePill({ icon, label, state, detail }) {
  const color = state === "online" ? C.green : state === "degraded" ? C.amber : C.red;
  return (
    <div
      title={detail}
      style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 10px", borderRadius: 10, background: `${color}12`, border: `1px solid ${color}40`, fontSize: 11.5, fontWeight: 600, color: C.text, whiteSpace: "nowrap" }}
    >
      <span style={{ color }}>{icon}</span>
      <span>{label}</span>
      <Dot color={color} size={6} pulse={state !== "online"} />
      {detail && <span className="soc-mono" style={{ color: C.mute, fontSize: 10.5 }}>{detail}</span>}
    </div>
  );
}

export function TopBar({ view, setView, health, connected, onReset, resetting }) {
  const h = health || {};
  const ms = (s) => (s && s.latency_ms != null ? `${s.latency_ms}ms` : "");
  const llm = h.ollama;
  const llmState = !llm ? "offline" : llm.status !== "online" ? "offline" : llm.model_loaded === false ? "degraded" : "online";
  const llmDetail = llmState === "online" ? llm.model : llmState === "degraded" ? "model missing" : "heuristic mode";
  const l1 = h.layer1_source;

  return (
    <header style={{ height: 58, display: "flex", alignItems: "center", gap: 18, padding: "0 18px", borderBottom: "1px solid rgba(130,160,210,.14)", background: "rgba(6,9,17,.9)", backdropFilter: "blur(16px)", position: "relative", zIndex: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg,#38d8ff,#4f8cff)", display: "grid", placeItems: "center", boxShadow: "0 0 24px rgba(56,216,255,.45)" }}>
          <Shield size={18} color="#04060c" fill="#04060c" />
        </div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: ".01em" }}>FraudGuard <span style={{ color: C.cyan }}>AI</span></div>
          <div style={{ fontSize: 9.5, letterSpacing: ".2em", color: C.dim, fontWeight: 700 }}>SECURITY OPERATIONS CENTER</div>
        </div>
      </div>

      <nav style={{ display: "flex", gap: 4, marginLeft: 10 }}>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className="soc-btn"
            onClick={() => setView(v.id)}
            style={{
              display: "flex", alignItems: "center", gap: 7, padding: "8px 13px", borderRadius: 10, fontFamily: "inherit", fontSize: 12.5, fontWeight: 600,
              color: view === v.id ? "#04060c" : C.mute, background: view === v.id ? C.cyan : "transparent", border: "1px solid " + (view === v.id ? C.cyan : "transparent"),
            }}
          >
            {v.icon}
            {v.label}
          </button>
        ))}
      </nav>

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", gap: 7, alignItems: "center", overflow: "hidden" }}>
        <ServicePill icon={<Database size={13} />} label="MongoDB" state={h.mongo ? h.mongo.status : "offline"} detail={h.mongo ? ms(h.mongo) : ""} />
        <ServicePill
          icon={<Cpu size={13} />}
          label="ML Layer 1"
          state={!h.ml ? "offline" : h.ml.status === "online" ? "online" : l1 === "agent-fallback" ? "degraded" : "offline"}
          detail={h.ml ? (h.ml.status === "online" ? `${(h.ml.data && h.ml.data.loaded_accounts ? (h.ml.data.loaded_accounts / 1000).toFixed(0) + "K acct" : ms(h.ml))}` : l1 === "agent-fallback" ? "fallback" : "down") : ""}
        />
        <ServicePill icon={<Brain size={13} />} label="Agents" state={h.agent ? h.agent.status : "offline"} detail={h.agent ? ms(h.agent) : ""} />
        <ServicePill icon={<Server size={13} />} label="LLM" state={llmState} detail={llmDetail} />
        <ServicePill icon={connected ? <Wifi size={13} /> : <WifiOff size={13} />} label={connected ? "Live" : "Offline"} state={connected ? "online" : "offline"} />
      </div>

      <Btn small color={C.amber} disabled={resetting} onClick={onReset} title="Wipe and reseed the demo data">
        <RotateCcw size={12} className={resetting ? "soc-spin" : undefined} /> Reset demo
      </Btn>
      <a href="/" style={{ textDecoration: "none" }}>
        <Btn small color={C.violet}><Smartphone size={12} /> UPI app</Btn>
      </a>
    </header>
  );
}

function Kpi({ icon, label, value, sub, color = C.cyan, accent }) {
  return (
    <div className="soc-card" style={{ padding: "10px 14px", minWidth: 0, flex: 1, borderColor: accent ? `${color}55` : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: C.mute, textTransform: "uppercase", whiteSpace: "nowrap" }}>
        <span style={{ color }}>{icon}</span>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 3, color: C.text, letterSpacing: "-.01em", whiteSpace: "nowrap" }}>{value}</div>
      <div style={{ fontSize: 11, color: C.mute, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
    </div>
  );
}

export function KpiStrip({ stats }) {
  const s = stats || {};
  const speedup = s.avg_decision_ms ? Math.round((s.human_baseline_minutes * 60 * 1000) / s.avg_decision_ms) : null;
  return (
    <div style={{ display: "flex", gap: 10, width: "100%" }}>
      <Kpi icon={<Activity size={13} />} label="Throughput" value={`${(s.tps_1m || 0).toFixed(2)}/s`} sub={`${s.total || 0} payments · ${s.txns_last_minute || 0} in last min`} />
      <Kpi icon={<Banknote size={13} />} label="Protected" color={C.green} accent value={inrShort(s.money_blocked)} sub={`${inrShort(s.money_held)} held for review`} />
      <Kpi icon={<Lock size={13} />} label="Accounts" color={C.red} value={`${s.frozen || 0} frozen`} sub={`${s.investigating || 0} under review · ${s.active || 0} active`} />
      <Kpi icon={<Timer size={13} />} label="Decision time" color={C.violet} value={dur(s.avg_decision_ms)} sub={speedup ? `~${speedup}× faster than manual triage` : "no cases resolved yet"} />
      <Kpi icon={<Eye size={13} />} label="False alarms cleared" color={C.cyan} value={s.false_positives_cleared || 0} sub={`of ${s.cases || 0} cases investigated`} />
      <Kpi icon={<Siren size={13} />} label="Needs analyst" color={C.amber} accent={(s.open_cases || 0) > 0} value={s.open_cases || 0} sub="escalated, awaiting review" />
    </div>
  );
}

const LEVEL = {
  critical: { color: C.red, tag: "BLOCK" },
  warning: { color: C.amber, tag: "HOLD" },
  success: { color: C.green, tag: "CLEAR" },
  agent: { color: C.violet, tag: "AGENT" },
  info: { color: C.cyan, tag: "TXN" },
};

export function Feed({ events, onClear }) {
  return (
    <div className="soc-card" style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <SectionTitle icon={<Terminal size={13} />} right={<button onClick={onClear} style={{ background: "none", border: 0, color: C.dim, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>clear</button>}>
        Live event stream
      </SectionTitle>
      <div className="soc-scroll" style={{ flex: 1, minHeight: 0, padding: "0 6px 8px" }}>
        {events.length === 0 && <Empty>Listening for activity.<br />Run a scenario from the Attack Director below, or send a payment from the UPI app.</Empty>}
        {events.map((e) => {
          const lv = LEVEL[e.level] || LEVEL.info;
          return (
            <div key={e.id} className="soc-slide soc-row-hover" style={{ display: "flex", gap: 9, padding: "7px 8px", borderRadius: 9, borderLeft: `2px solid ${lv.color}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
                  <span className="soc-mono" style={{ fontSize: 10, color: C.dim }}>{e.time}</span>
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".08em", color: lv.color }}>{lv.tag}</span>
                </div>
                <div style={{ fontSize: 12, color: C.text, lineHeight: 1.4, wordBreak: "break-word" }}>{e.title}</div>
                {e.detail && <div style={{ fontSize: 11, color: C.mute, marginTop: 1, lineHeight: 1.4 }}>{e.detail}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function useResetDemo(soc) {
  const [resetting, setResetting] = useState(false);
  const run = async () => {
    setResetting(true);
    try { await resetDemo("fresh"); } finally { setTimeout(() => setResetting(false), 600); }
    soc.refreshAll();
  };
  return [resetting, run];
}

export { inr };
