import React, { useEffect, useState } from "react";
import { Lock, Unlock, ScanSearch, ArrowDownLeft, ArrowUpRight, User, Link2 } from "lucide-react";
import { C, riskColor, statusColor, ROLE_LABEL, inr, pct, txnColor, decisionMeta } from "./theme";
import { Pill, Btn, Bar, KV, Empty, SectionTitle } from "./ui";
import { getTransactions, socAction } from "../../lib/api";

export function AccountPanel({ node, soc, onOpenInvestigation }) {
  const [txns, setTxns] = useState([]);
  const [busy, setBusy] = useState(false);
  const id = node && node.id;

  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    getTransactions(id, 8).then((t) => alive && setTxns(Array.isArray(t) ? t : [])).catch(() => alive && setTxns([]));
    return () => { alive = false; };
  }, [id, soc.version]);

  if (!node) {
    return (
      <div className="soc-card" style={{ flex: 1 }}>
        <SectionTitle icon={<User size={13} />}>Account 360°</SectionTitle>
        <Empty>Click a node in the network to inspect the account, its model scores and recent flow.</Empty>
      </div>
    );
  }

  const act = async (type) => {
    setBusy(true);
    await socAction(node.id, type, "Analyst intervention from the SOC console");
    setBusy(false);
    soc.refreshAll();
  };

  const col = riskColor(node.risk_level);
  const sCol = statusColor(node.risk_status);
  const lastCase = soc.cases.find((c) => c.account_id === node.id);
  const ms = node.model_scores;

  return (
    <div className="soc-card soc-scroll" style={{ flex: 1, minHeight: 0 }}>
      <SectionTitle icon={<User size={13} />} right={<Pill color={sCol}>{(node.risk_status || "ACTIVE").replace("_", " ")}</Pill>}>
        Account 360°
      </SectionTitle>

      <div style={{ padding: "0 14px 12px" }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>{node.account_holder_name}</div>
        <div className="soc-mono" style={{ fontSize: 12, color: C.cyan, marginTop: 2 }}>{node.vpa_address}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <Pill color={C.violet}>{ROLE_LABEL[node.role] || "Account"}</Pill>
          <Pill color={col}>{node.risk_level} {pct(node.risk_score, 0)}</Pill>
          {node.cleared_by_agent_at && <Pill color={C.green}>Cleared by agents</Pill>}
        </div>
      </div>

      <div style={{ padding: "0 14px 12px", display: "grid", gap: 9 }}>
        <Bar label="Layer-1 blended risk" value={node.risk_score || 0} marker={0.85} color={col} right={(node.risk_score || 0).toFixed(3)} />
        {ms && <Bar label="XGBoost" value={ms.xgb} marker={0.85} color={riskColor(ms.xgb >= 0.85 ? "CRITICAL" : ms.xgb >= 0.7 ? "HIGH" : "LOW")} right={ms.xgb.toFixed(3)} />}
        {ms && <Bar label="GraphSAGE" value={ms.sage} marker={0.85} color={riskColor(ms.sage >= 0.85 ? "CRITICAL" : ms.sage >= 0.7 ? "HIGH" : "LOW")} right={ms.sage.toFixed(3)} />}
      </div>

      {node.freeze_reason && (
        <div style={{ margin: "0 14px 12px", padding: "9px 11px", borderRadius: 10, background: "rgba(255,59,92,.09)", border: "1px solid rgba(255,59,92,.35)", fontSize: 12, color: "#ff9db0", lineHeight: 1.5 }}>
          <b>Frozen:</b> {node.freeze_reason}
        </div>
      )}

      <div style={{ padding: "0 14px 12px" }}>
        <KV k="Balance" v={inr(node.current_balance)} />
        <KV k="KYC" v={(node.kyc_status || "UNKNOWN").replace(/_/g, " ")} />
        <KV k="Account age" v={`${node.account_age_days} days`} />
        <KV k="Velocity" v={`${node.tx_frequency_per_day || 0} tx/day · avg ${inr(node.avg_tx_amount)}`} />
        <KV k="Counterparties" v={node.unique_counterparties} />
        <KV k="Device" v={node.device_id} mono />
        <KV k="IP" v={node.ip_address} mono />
        {node.ml_account_id && <KV k="Scored as (ML id)" v={node.ml_account_id} mono color={C.violet} />}
      </div>

      <div style={{ padding: "0 14px 12px", display: "flex", gap: 7, flexWrap: "wrap" }}>
        <Btn small color={C.amber} disabled={busy} onClick={() => act("FLAG")}><ScanSearch size={12} /> Investigate</Btn>
        <Btn small color={C.red} disabled={busy || node.risk_status === "FROZEN"} onClick={() => act("FREEZE")}><Lock size={12} /> Freeze</Btn>
        <Btn small color={C.green} disabled={busy || node.risk_status === "ACTIVE"} onClick={() => act("CLEAR")}><Unlock size={12} /> Clear</Btn>
        {lastCase && <Btn small color={C.violet} onClick={() => onOpenInvestigation({ case_id: lastCase.case_id })}><Link2 size={12} /> Latest case</Btn>}
      </div>

      <SectionTitle>Recent flow</SectionTitle>
      <div style={{ padding: "0 8px 14px" }}>
        {txns.length === 0 && <Empty>No transactions yet.</Empty>}
        {txns.map((t) => {
          const out = t.sender_account_id === node.id;
          const other = out ? t.receiver_vpa || t.receiver_account_id : t.sender_vpa || t.sender_account_id;
          return (
            <div key={t.transaction_id} className="soc-row-hover" style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 7px", borderRadius: 9 }}>
              {out ? <ArrowUpRight size={14} color={C.orange} /> : <ArrowDownLeft size={14} color={C.green} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="soc-mono" style={{ fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{other}</div>
                <div style={{ fontSize: 10.5, color: C.dim }}>{new Date(t.timestamp).toLocaleTimeString([], { hour12: false })}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{inr(t.amount)}</div>
                <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".08em", color: txnColor(t.status) }}>{t.status}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CaseQueue({ soc, focus, onOpen }) {
  const open = soc.cases.filter((c) => c.status === "UNDER_REVIEW");
  const rest = soc.cases.filter((c) => c.status !== "UNDER_REVIEW");
  const row = (c) => {
    const m = decisionMeta(c.decision);
    const active = focus && (focus.case_id === c.case_id || (focus.ref && `CASE-${focus.ref}` === c.case_id));
    return (
      <div key={c.case_id} className="soc-row-hover" onClick={() => onOpen({ case_id: c.case_id })}
        style={{ cursor: "pointer", display: "flex", gap: 10, padding: "9px 10px", borderRadius: 11, borderLeft: `3px solid ${m.color}`, background: active ? "rgba(56,216,255,.08)" : "transparent" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="soc-mono" style={{ fontSize: 11.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{soc.nameOf(c.account_id)}</div>
          <div style={{ fontSize: 10.5, color: C.dim, marginTop: 1 }}>{c.case_id} · {new Date(c.created_at).toLocaleTimeString([], { hour12: false })}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <Pill color={m.color}>{m.label}</Pill>
          {c.status === "UNDER_REVIEW" && <div style={{ fontSize: 9.5, color: C.amber, fontWeight: 800, marginTop: 3, letterSpacing: ".08em" }}>NEEDS ANALYST</div>}
        </div>
      </div>
    );
  };
  return (
    <div className="soc-card soc-scroll" style={{ flex: 1, minHeight: 0 }}>
      <SectionTitle>Case queue ({soc.cases.length})</SectionTitle>
      <div style={{ padding: "0 6px 10px" }}>
        {soc.cases.length === 0 && <Empty>No cases yet. They appear the moment Layer 1 flags a payment.</Empty>}
        {open.length > 0 && <div style={{ padding: "4px 8px", fontSize: 10, fontWeight: 800, letterSpacing: ".12em", color: C.amber }}>AWAITING ANALYST</div>}
        {open.map(row)}
        {open.length > 0 && rest.length > 0 && <div style={{ padding: "8px 8px 4px", fontSize: 10, fontWeight: 800, letterSpacing: ".12em", color: C.dim }}>RESOLVED</div>}
        {rest.map(row)}
      </div>
    </div>
  );
}
