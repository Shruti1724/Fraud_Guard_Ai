// Live state for the SOC dashboard: graph, events, cases, stats, service health.
// REST hydrates it; Socket.IO keeps it live. Graph node/link objects keep a stable
// identity so the 3D force layout (and its positions) survive every update.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { API_URL, getGraph, getCases, getStats, getHealth, getRecentTxns } from "../../lib/api";
import { inr, clock } from "./theme";

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const MAX_EVENTS = 200;

const endpoint = (v) => (v && typeof v === "object" ? v.id : v);

// Parallel edges between the same pair fan out as curves instead of overlapping.
function assignCurvature(links) {
  const groups = new Map();
  links.forEach((l) => {
    const a = endpoint(l.source);
    const b = endpoint(l.target);
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  });
  groups.forEach((group) => {
    group.sort((x, y) => new Date(x.timestamp) - new Date(y.timestamp));
    group.forEach((l, i) => {
      if (group.length === 1) { l.curve = 0; return; }
      const step = Math.ceil(i / 2) * 0.22;
      const sign = i % 2 === 0 ? 1 : -1;
      const flip = endpoint(l.source) < endpoint(l.target) ? 1 : -1;
      l.curve = i === 0 ? 0.08 * flip : sign * step * flip;
    });
  });
}

export function useSoc(bus) {
  const nodesRef = useRef(new Map());
  const linksRef = useRef(new Map());
  const invRef = useRef([]);
  const [version, setVersion] = useState(0);
  const [tick, setTick] = useState(0); // re-render panels when node data mutates in place
  const [events, setEvents] = useState([]);
  const [cases, setCases] = useState([]);
  const [stats, setStats] = useState({});
  const [health, setHealth] = useState(null);
  const [connected, setConnected] = useState(false);
  const [investigations, setInvestigationsState] = useState([]);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const setInvestigations = useCallback((updater) => {
    setInvestigationsState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      invRef.current = next;
      return next;
    });
  }, []);

  const nameOf = useCallback((id) => {
    const n = nodesRef.current.get(id);
    return n ? n.vpa_address || n.label || id : id;
  }, []);

  const pushEvent = useCallback((e) => {
    setEvents((prev) => [{ id: uid(), time: clock(), ...e }, ...prev].slice(0, MAX_EVENTS));
  }, []);

  // ── graph merge ────────────────────────────────────────────────────────────
  const mergeGraph = useCallback((elements) => {
    const seenNodes = new Set();
    const seenLinks = new Set();
    elements.forEach((el) => {
      const d = el.data;
      if (!d) return;
      if (d.source) {
        seenLinks.add(d.id);
        const existing = linksRef.current.get(d.id);
        if (existing) {
          const { source, target, ...rest } = d;
          Object.assign(existing, rest);
        } else {
          linksRef.current.set(d.id, { ...d });
        }
      } else {
        seenNodes.add(d.id);
        const existing = nodesRef.current.get(d.id);
        if (existing) Object.assign(existing, d);
        else nodesRef.current.set(d.id, { ...d });
      }
    });
    [...nodesRef.current.keys()].forEach((id) => { if (!seenNodes.has(id)) nodesRef.current.delete(id); });
    [...linksRef.current.keys()].forEach((id) => { if (!seenLinks.has(id)) linksRef.current.delete(id); });
    assignCurvature([...linksRef.current.values()]);
  }, []);

  const refreshGraph = useCallback(async () => {
    try {
      mergeGraph(await getGraph());
      bump();
    } catch (_) { /* backend offline: the Offline pill shows it */ }
  }, [mergeGraph, bump]);

  const refreshCases = useCallback(async () => {
    try { setCases(await getCases()); } catch (_) { /* offline */ }
  }, []);

  const statsTimer = useRef(null);
  const refreshStats = useCallback(() => {
    clearTimeout(statsTimer.current);
    statsTimer.current = setTimeout(async () => {
      try { setStats(await getStats()); } catch (_) { /* offline */ }
    }, 400);
  }, []);

  const refreshHealth = useCallback(async () => {
    try { setHealth(await getHealth()); } catch (_) { setHealth(null); }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshGraph(), refreshCases(), refreshHealth()]);
    refreshStats();
  }, [refreshGraph, refreshCases, refreshHealth, refreshStats]);

  // ── initial load + polling ─────────────────────────────────────────────────
  useEffect(() => {
    refreshAll();
    getRecentTxns(8)
      .then((txns) =>
        setEvents(
          txns.reverse().map((t) => ({
            id: uid(),
            time: new Date(t.timestamp).toLocaleTimeString([], { hour12: false }),
            kind: "txn",
            level: t.status === "BLOCKED" ? "critical" : t.status === "FLAGGED" ? "warning" : "info",
            title: `${inr(t.amount)}  ${t.sender_account_id} → ${t.receiver_vpa || t.receiver_account_id}`,
            detail: `${t.status} · history`,
          }))
        )
      )
      .catch(() => {});
    const h = setInterval(refreshHealth, 10000);
    const s = setInterval(refreshStats, 15000);
    return () => { clearInterval(h); clearInterval(s); };
  }, [refreshAll, refreshHealth, refreshStats]);

  // ── live socket ────────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io(API_URL, { transports: ["websocket", "polling"] });
    let graphTimer = null;
    const scheduleGraph = () => { clearTimeout(graphTimer); graphTimer = setTimeout(refreshGraph, 350); };

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("transaction:new", ({ txn }) => {
      if (!txn) return;
      let link = linksRef.current.get(txn.transaction_id);
      if (!link) {
        link = {
          id: txn.transaction_id,
          source: txn.sender_account_id,
          target: txn.receiver_account_id,
          amount: txn.amount,
          status: txn.status,
          type: txn.type || "PAYMENT",
          timestamp: txn.timestamp,
          is_fraud: !!txn.is_fraud,
          block_reason: txn.block_reason || null,
          case_id: txn.case_id || null,
          simulated: !!txn.simulated,
          _born: Date.now(),
        };
        linksRef.current.set(link.id, link);
        const missing = [txn.sender_account_id, txn.receiver_account_id].filter((id) => !nodesRef.current.has(id));
        missing.forEach((id) =>
          nodesRef.current.set(id, { id, label: id, role: "USER", vpa_address: id, risk_status: "ACTIVE", risk_level: "LOW", risk_score: 0.05, known: false })
        );
        if (missing.length) scheduleGraph();
        assignCurvature([...linksRef.current.values()]);
        bump();
      }
      bus.emit("txn", link);
      pushEvent({
        kind: "txn",
        level: txn.status === "BLOCKED" ? "critical" : txn.status === "FLAGGED" ? "warning" : "info",
        title: `${inr(txn.amount)}  ${nameOf(txn.sender_account_id)} → ${txn.receiver_vpa || nameOf(txn.receiver_account_id)}`,
        detail: txn.status === "BLOCKED" ? `BLOCKED — ${txn.block_reason || "frozen account"}` : txn.status === "FLAGGED" ? "HELD for investigation" : "Settled",
      });
      refreshStats();
    });

    socket.on("transaction:updated", ({ txn }) => {
      if (!txn) return;
      const link = linksRef.current.get(txn.transaction_id);
      if (link) {
        Object.assign(link, { status: txn.status, block_reason: txn.block_reason || null, case_id: txn.case_id || null, is_fraud: !!txn.is_fraud });
        bump();
      }
      pushEvent({
        kind: "txn",
        level: txn.status === "BLOCKED" ? "critical" : txn.status === "SUCCESS" ? "success" : "warning",
        title: `${inr(txn.amount)} to ${txn.receiver_vpa || nameOf(txn.receiver_account_id)}`,
        detail: txn.status === "BLOCKED" ? "Held payment BLOCKED by verdict" : txn.status === "SUCCESS" ? "Held payment RELEASED after review" : "Still held for analyst",
      });
      refreshStats();
    });

    socket.on("risk_score:updated", (r) => {
      const id = r.account_id || r.receiver_account_id;
      const node = nodesRef.current.get(id);
      if (node) {
        Object.assign(node, {
          risk_score: r.risk_score,
          risk_level: r.risk_level,
          is_flagged: r.is_flagged,
          warning_message: r.warning_message,
          model_scores: r.model_scores || node.model_scores,
          ml_source: r.meta && r.meta.source,
          ...(r.overridden_by === "agent_clearance" ? { cleared_by_agent_at: node.cleared_by_agent_at || new Date().toISOString() } : {}),
        });
      }
      pushEvent({
        kind: "risk",
        level: r.is_flagged ? "warning" : "info",
        title: `Layer 1 scored ${nameOf(id)}: ${((r.risk_score || 0) * 100).toFixed(1)}% ${r.risk_level}`,
        detail: r.meta ? `${r.overridden_by === "agent_clearance" ? "downgraded after agent clearance · " : ""}${r.meta.source} · ${r.meta.latency_ms}ms${r.model_scores ? ` · XGB ${r.model_scores.xgb.toFixed(2)} / SAGE ${r.model_scores.sage.toFixed(2)}` : ""}` : "",
      });
      bus.emit("risk", { id, ...r });
      setTick((t) => t + 1);
    });

    socket.on("investigation:started", (p) => {
      const node = nodesRef.current.get(p.account_id);
      if (node) node._investigating = true;
      setInvestigations((prev) => [{ ...p, state: "running" }, ...prev.filter((x) => x.ref !== p.ref)].slice(0, 30));
      bus.emit("investigate", { id: p.account_id, ref: p.ref });
      bus.emit("inv:started", p);
      pushEvent({
        kind: "agent",
        level: "agent",
        title: `Layer 3 investigation opened — ${p.vpa}`,
        detail: p.context ? `Live graph context: ${p.context.neighbors} neighbors${p.context.victims ? `, ${p.context.victims} victims` : ""}${p.context.sinks ? `, ${p.context.sinks} sink` : ""}` : p.trigger,
      });
    });

    socket.on("investigation:completed", (p) => {
      const accountId = p.case && p.case.account_id;
      const node = nodesRef.current.get(accountId);
      if (node) node._investigating = false;
      setInvestigations((prev) => {
        const found = prev.some((x) => x.ref === p.ref);
        const merged = { ...(prev.find((x) => x.ref === p.ref) || { ref: p.ref, account_id: accountId, started_at: p.case.created_at }), state: "done", decision: p.decision, duration_ms: p.duration_ms, case: p.case, failsafe: p.failsafe };
        return found ? prev.map((x) => (x.ref === p.ref ? merged : x)) : [merged, ...prev];
      });
      bus.emit("inv:completed", p);
      pushEvent({
        kind: "agent",
        level: p.decision === "clear" ? "success" : p.decision === "auto_block" ? "critical" : "warning",
        title: `Verdict ${String(p.decision).toUpperCase().replace("_", "-")} — ${nameOf(accountId)}`,
        detail: `${p.analyst ? "Analyst resolution" : `Pipeline finished in ${p.duration_ms ? (p.duration_ms / 1000).toFixed(1) + "s" : "—"}`}${p.failsafe ? " · FAIL-SAFE (AI unavailable)" : ""}`,
      });
      refreshCases();
      refreshStats();
    });

    socket.on("investigation:failed", (p) => {
      const node = nodesRef.current.get(p.account_id);
      if (node) node._investigating = false;
      setInvestigations((prev) => prev.map((x) => (x.ref === p.ref ? { ...x, state: "failed", error: p.error } : x)));
      bus.emit("inv:failed", p);
      pushEvent({ kind: "agent", level: "critical", title: `Investigation failed — ${nameOf(p.account_id)}`, detail: p.error });
    });

    socket.on("account:updated", (a) => {
      const node = nodesRef.current.get(a.account_id);
      if (!node) return;
      const before = node.risk_status;
      const patch = {};
      ["risk_status", "current_balance", "last_decision", "freeze_reason", "cleared_by_agent_at"].forEach((k) => { if (a[k] !== undefined) patch[k] = a[k]; });
      Object.assign(node, patch);
      setTick((t) => t + 1);
      if (a.risk_status && a.risk_status !== before) {
        if (a.risk_status === "FROZEN") bus.emit("freeze", { id: a.account_id });
        if (a.risk_status === "ACTIVE" && before !== "ACTIVE") bus.emit("clear", { id: a.account_id });
        if (a.risk_status === "UNDER_INVESTIGATION") bus.emit("hold", { id: a.account_id });
        pushEvent({
          kind: "account",
          level: a.risk_status === "FROZEN" ? "critical" : a.risk_status === "ACTIVE" ? "success" : "warning",
          title: `${nameOf(a.account_id)} → ${a.risk_status.replace("_", " ")}`,
          detail: a.freeze_reason || (a.risk_status === "ACTIVE" ? "Restrictions lifted" : ""),
        });
        refreshStats();
      }
    });

    socket.on("system:reset", () => {
      setEvents([]);
      setInvestigations([]);
      nodesRef.current.clear();
      linksRef.current.clear();
      refreshAll();
    });

    return () => { clearTimeout(graphTimer); socket.disconnect(); };
  }, [bus, bump, nameOf, pushEvent, refreshAll, refreshCases, refreshGraph, refreshStats, setInvestigations]);

  // Resolves once the investigation for an account finishes. If none starts (decision
  // reused from a very recent case), resolves quickly instead of hanging a simulation.
  const waitForCompletion = useCallback(
    (accountId, { startWindowMs = 4000, maxMs = 120000 } = {}) =>
      new Promise((resolve) => {
        const running = () => invRef.current.some((i) => i.account_id === accountId && i.state === "running");
        let done = false;
        const finish = (v) => { if (!done) { done = true; offA(); offB(); offC(); clearTimeout(t1); clearTimeout(t2); resolve(v); } };
        const offA = bus.on("inv:completed", (p) => { if (p.case && p.case.account_id === accountId) finish(p); });
        const offB = bus.on("inv:failed", (p) => { if (p.account_id === accountId) finish(null); });
        const offC = bus.on("inv:started", () => {});
        const t1 = setTimeout(() => { if (!running()) finish(null); }, startWindowMs);
        const t2 = setTimeout(() => finish(null), maxMs);
      }),
    [bus]
  );

  const graphData = useMemo(
    () => ({ nodes: [...nodesRef.current.values()], links: [...linksRef.current.values()] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]
  );

  const clearEvents = useCallback(() => setEvents([]), []);

  return { graphData, version, tick, nodesRef, linksRef, events, cases, stats, health, connected, investigations, refreshAll, refreshGraph, refreshCases, refreshStats, waitForCompletion, nameOf, clearEvents, pushEvent };
}
