// The Attack Director: runs scripted fraud scenarios and background traffic through the
// real pipeline, narrating every step over the 3D graph.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square, Radio, Zap, Gauge as GaugeIcon, CheckCircle2, ShieldX, Hourglass, AlertTriangle, Layers } from "lucide-react";
import { simulatePayment } from "../../lib/api";
import { SCENARIOS, LIVE_TRAFFIC, FRAUD_INJECTIONS, outcomeOf, rand } from "./scenarios";
import { C, decisionMeta } from "./theme";
import { Btn, Pill } from "./ui";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TAG_COLOR = { CRITICAL: C.red, HIGH: C.orange, LOW: C.green, "FALSE POSITIVE": C.cyan };

const STATE_ICON = {
  pending: <Hourglass size={13} color={C.dim} />,
  running: <Zap size={13} color={C.amber} className="soc-blink" />,
  done: <CheckCircle2 size={13} color={C.green} />,
  held: <AlertTriangle size={13} color={C.amber} />,
  blocked: <ShieldX size={13} color={C.red} />,
  error: <AlertTriangle size={13} color={C.red} />,
};

export default function Director({ soc, bus, onRunningChange }) {
  const [running, setRunning] = useState(null);
  const [scenario, setScenario] = useState(null);
  const [steps, setSteps] = useState([]);
  const [idx, setIdx] = useState(0);
  const [caption, setCaption] = useState("");
  const [speed, setSpeed] = useState(1);
  const [live, setLive] = useState(false);
  const [inject, setInject] = useState(true);
  const [liveCount, setLiveCount] = useState(0);
  const cancel = useRef(false);
  const speedRef = useRef(1);
  speedRef.current = speed;
  const injectRef = useRef(true);
  injectRef.current = inject;

  useEffect(() => { onRunningChange && onRunningChange(!!running); }, [running, onRunningChange]);

  const patchStep = (i, patch) => setSteps((prev) => prev.map((s, k) => (k === i ? { ...s, ...patch } : s)));

  const run = useCallback(
    async (sc) => {
      cancel.current = false;
      setRunning(sc.id);
      setScenario(sc);
      setSteps(sc.steps.map(() => ({ state: "pending", text: "" })));
      bus.emit("home");
      await sleep(900 / speedRef.current);

      for (let i = 0; i < sc.steps.length; i += 1) {
        if (cancel.current) break;
        const step = sc.steps[i];
        setIdx(i);
        setCaption(step.caption);
        patchStep(i, { state: "running", text: step.kind === "await" ? "Agents investigating…" : "Sending payment…" });

        if (step.kind === "pay") {
          const res = await simulatePayment({ sender_account_id: step.from, receiver_vpa: step.vpa, amount: step.amount, device_id: "DEV_SIMULATION_ENGINE" });
          const out = outcomeOf(res);
          const target = (res.data.txn && res.data.txn.receiver_account_id) || null;
          if (target) bus.emit("focus", { id: target, dist: 210 });
          patchStep(i, out);
          await sleep(1700 / speedRef.current);
        } else {
          bus.emit("focus", { id: step.account, dist: 200 });
          const p = await soc.waitForCompletion(step.account);
          if (p) {
            const m = decisionMeta(p.decision);
            patchStep(i, { state: p.decision === "auto_block" ? "blocked" : p.decision === "clear" ? "done" : "held", text: `${m.label} in ${(p.duration_ms / 1000).toFixed(1)}s` });
          } else {
            patchStep(i, { state: "done", text: "Decision already on file" });
          }
          await sleep(1600 / speedRef.current);
        }
      }

      setCaption(cancel.current ? "Scenario stopped." : "Scenario complete. Check the case file on the right.");
      setRunning(null);
      soc.refreshStats();
      await sleep(2600);
      setScenario((cur) => (cur && cur.id === sc.id ? null : cur));
    },
    [bus, soc]
  );

  const runWave = useCallback(async () => {
    const order = ["mule_chain", "smurfing", "false_alarm", "ato"];
    for (const id of order) {
      if (cancel.current) break;
      // eslint-disable-next-line no-await-in-loop
      await run(SCENARIOS.find((s) => s.id === id));
      // eslint-disable-next-line no-await-in-loop
      await sleep(1200);
    }
  }, [run]);

  const stop = () => { cancel.current = true; };

  // background traffic
  useEffect(() => {
    if (!live) return undefined;
    let alive = true;
    (async () => {
      while (alive) {
        // eslint-disable-next-line no-await-in-loop
        await sleep((2600 + Math.random() * 2200) / speedRef.current);
        if (!alive) break;
        const pool = injectRef.current && Math.random() < 0.14 ? FRAUD_INJECTIONS : LIVE_TRAFFIC;
        const t = pool[Math.floor(Math.random() * pool.length)];
        try {
          // eslint-disable-next-line no-await-in-loop
          await simulatePayment({ sender_account_id: t.from, receiver_vpa: t.vpa, amount: rand(t.amount[0], t.amount[1]), device_id: "DEV_SIMULATION_ENGINE" });
          setLiveCount((c) => c + 1);
        } catch (_) { /* backend offline */ }
      }
    })();
    return () => { alive = false; };
  }, [live]);

  const busy = !!running;

  return (
    <>
      {/* narrator */}
      {scenario && (
        <div className="soc-rise" style={{ position: "absolute", left: 0, right: 0, margin: "0 auto", bottom: 118, width: "min(720px, 92%)", zIndex: 5 }}>
          <div className="soc-card" style={{ padding: "14px 18px", background: "rgba(7,11,20,.95)", borderColor: `${TAG_COLOR[scenario.tag] || C.cyan}66`, boxShadow: `0 20px 60px -20px ${TAG_COLOR[scenario.tag] || C.cyan}66` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <Pill color={TAG_COLOR[scenario.tag] || C.cyan}>{scenario.tag}</Pill>
              <span style={{ fontWeight: 800, fontSize: 14 }}>{scenario.name}</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: C.mute }}>Step {Math.min(idx + 1, scenario.steps.length)} / {scenario.steps.length}</span>
            </div>
            <div key={caption} className="soc-slide" style={{ fontSize: 15, lineHeight: 1.5, color: C.text, minHeight: 44 }}>{caption}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              {steps.map((s, i) => (
                <span key={i} title={scenario.steps[i].caption} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, padding: "3px 8px", borderRadius: 8, background: i === idx && running ? "rgba(255,255,255,.09)" : "rgba(255,255,255,.04)", color: C.mute, border: "1px solid rgba(130,160,210,.14)" }}>
                  {STATE_ICON[s.state]} {s.text || (scenario.steps[i].kind === "await" ? "Investigation" : "Payment")}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* dock */}
      <div style={{ position: "absolute", left: 0, right: 0, margin: "0 auto", bottom: 16, zIndex: 5, width: "min(980px, 96%)" }}>
        <div className="soc-card" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "rgba(7,11,20,.95)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10.5, fontWeight: 800, letterSpacing: ".14em", color: C.mute, paddingRight: 6 }}>
            <Radio size={14} color={C.cyan} /> ATTACK DIRECTOR
          </div>
          {SCENARIOS.map((sc) => (
            <Btn key={sc.id} small disabled={busy} color={TAG_COLOR[sc.tag] || C.cyan} onClick={() => run(sc)} title={sc.blurb}>
              <Play size={11} /> {sc.name}
            </Btn>
          ))}
          <Btn small solid disabled={busy} color={C.violet} onClick={runWave} title="Mule chain, smurfing, false alarm, takeover back to back">
            <Layers size={12} /> Full wave
          </Btn>
          <div style={{ flex: 1 }} />
          {busy && <Btn small color={C.red} onClick={stop}><Square size={11} /> Stop</Btn>}
          <Btn small color={speed === 2 ? C.amber : C.mute} onClick={() => setSpeed((s) => (s === 1 ? 2 : 1))} title="Playback speed">
            <GaugeIcon size={12} /> {speed}×
          </Btn>
          <Btn small color={live ? C.green : C.mute} solid={live} onClick={() => setLive((v) => !v)} title="Background retail traffic through the real pipeline">
            <span className={live ? "soc-blink" : undefined} style={{ width: 7, height: 7, borderRadius: "50%", background: live ? "#04060c" : C.mute }} />
            Live traffic{live ? ` · ${liveCount}` : ""}
          </Btn>
          {live && (
            <Btn small color={inject ? C.red : C.mute} onClick={() => setInject((v) => !v)} title="Occasionally inject fraud into the live traffic">
              <Zap size={12} /> Fraud {inject ? "on" : "off"}
            </Btn>
          )}
        </div>
      </div>
    </>
  );
}
