/**
 * FraudGuard AI — Security Operations Center
 * 3D live fraud network, agent investigations, simulation director, analyst workflow.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import dynamic from "next/dynamic";
import { Maximize2, Orbit, Waypoints, Radar, GitBranch, Eye, Snowflake, Flag, Network } from "lucide-react";
import { createBus } from "../lib/bus";
import { useSoc } from "../components/soc/useSoc";
import { C } from "../components/soc/theme";
import { TopBar, KpiStrip, Feed, useResetDemo } from "../components/soc/Chrome";
import { InvestigationPanel } from "../components/soc/InvestigationPanel";
import { AccountPanel, CaseQueue } from "../components/soc/AccountPanel";
import { CasesView, AccountsView, IntelligenceView } from "../components/soc/Views";
import Director from "../components/soc/Director";
import { Btn } from "../components/soc/ui";

const Graph3D = dynamic(() => import("../components/soc/Graph3D"), {
  ssr: false,
  loading: () => (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: C.mute, fontSize: 13 }}>
      <div style={{ textAlign: "center" }}>
        <Network size={28} color={C.cyan} className="soc-blink" />
        <div style={{ marginTop: 10 }}>Initialising 3D network…</div>
      </div>
    </div>
  ),
});

const FILTERS = [
  { id: "ALL", label: "All", icon: <Eye size={12} /> },
  { id: "RINGS", label: "Fraud rings", icon: <Radar size={12} /> },
  { id: "FLAGGED", label: "Flagged flow", icon: <Flag size={12} /> },
  { id: "FROZEN", label: "Frozen / review", icon: <Snowflake size={12} /> },
];
const LAYOUTS = [
  { id: "force", label: "Organic", icon: <Waypoints size={12} /> },
  { id: "flow", label: "Money flow", icon: <GitBranch size={12} /> },
  { id: "radial", label: "Radial", icon: <Orbit size={12} /> },
];

const LEGEND = [
  [C.green, "Low risk"],
  [C.amber, "Under review"],
  [C.orange, "High risk"],
  [C.red, "Frozen / critical"],
  [C.cyan, "Cleared by agents"],
];

function Tabs({ tab, setTab, queueBadge }) {
  const items = [
    { id: "inv", label: "Investigation" },
    { id: "acct", label: "Account" },
    { id: "queue", label: "Cases", badge: queueBadge },
  ];
  return (
    <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 12, background: "rgba(255,255,255,.04)", border: "1px solid rgba(130,160,210,.12)" }}>
      {items.map((t) => (
        <button
          key={t.id}
          className="soc-btn"
          onClick={() => setTab(t.id)}
          style={{ flex: 1, padding: "7px 8px", borderRadius: 9, fontFamily: "inherit", fontSize: 12, fontWeight: 700, color: tab === t.id ? "#04060c" : C.mute, background: tab === t.id ? C.cyan : "transparent", border: "1px solid transparent", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        >
          {t.label}
          {t.badge > 0 && <span style={{ background: C.amber, color: "#04060c", borderRadius: 999, fontSize: 10, fontWeight: 800, padding: "0 6px" }}>{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

const noop = () => {};
const chipStyle = { justifyContent: "flex-start", border: "1px solid transparent" };

export default function Dashboard() {
  const bus = useMemo(() => createBus(), []);
  const soc = useSoc(bus);
  const [resetting, onReset] = useResetDemo(soc);

  const [view, setView] = useState("command");
  const [selectedId, setSelectedId] = useState(null);
  const [rightTab, setRightTab] = useState("inv");
  const [focus, setFocus] = useState(null);
  const [filter, setFilter] = useState("ALL");
  const [layout, setLayout] = useState("force");
  const [autoRotate, setAutoRotate] = useState(true);
  const [directing, setDirecting] = useState(false);

  // Follow the newest investigation automatically.
  const newestRef = soc.investigations[0] && soc.investigations[0].ref;
  const lastRef = useRef(null);
  useEffect(() => {
    if (newestRef && newestRef !== lastRef.current) {
      lastRef.current = newestRef;
      setFocus({ ref: newestRef });
      setRightTab("inv");
    }
  }, [newestRef]);

  const onSelectNode = useCallback((id) => {
    setSelectedId(id);
    if (id) setRightTab("acct");
  }, []);

  const openInvestigation = useCallback((f) => {
    setFocus(f);
    setRightTab("inv");
  }, []);

  const selectedNode = selectedId ? soc.nodesRef.current.get(selectedId) : null;
  const openCases = soc.cases.filter((c) => c.status === "UNDER_REVIEW").length;

  const openAccountFromTable = (id) => {
    setSelectedId(id);
    setRightTab("acct");
    setView("command");
    setTimeout(() => bus.emit("focus", { id }), 700);
  };

  return (
    <div className="soc-root" style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden", background: "radial-gradient(1200px 700px at 50% -10%, #0c1530 0%, #04060c 60%)" }}>
      <Head>
        <title>FraudGuard AI · Security Operations Center</title>
      </Head>

      <TopBar view={view} setView={setView} health={soc.health} connected={soc.connected} onReset={onReset} resetting={resetting} />

      {view === "command" && (
        <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "320px minmax(0,1fr) 410px", gap: 12, padding: 12 }}>
          {/* left: event stream */}
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <Feed events={soc.events} onClear={soc.clearEvents} />
          </div>

          {/* centre: 3D network */}
          <div style={{ position: "relative", minHeight: 0, borderRadius: 18, overflow: "hidden", border: "1px solid rgba(130,160,210,.16)", background: "#04060c", boxShadow: "inset 0 0 120px rgba(56,216,255,.04)" }}>
            <Graph3D
              graphData={soc.graphData}
              selectedId={selectedId}
              onSelectNode={onSelectNode}
              onSelectLink={noop}
              bus={bus}
              layout={layout}
              autoRotate={autoRotate && !directing}
              filter={filter}
            />

            {/* vignette so overlays stay readable */}
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(180deg, rgba(4,6,12,.82) 0%, rgba(4,6,12,0) 22%, rgba(4,6,12,0) 70%, rgba(4,6,12,.75) 100%)" }} />

            <div style={{ position: "absolute", top: 12, left: 12, right: 12, zIndex: 4 }}>
              <KpiStrip stats={soc.stats} />
            </div>

            <div style={{ position: "absolute", top: 118, left: 12, zIndex: 4, display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="soc-card" style={{ padding: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                {FILTERS.map((f) => (
                  <Btn key={f.id} small color={filter === f.id ? C.cyan : C.mute} solid={filter === f.id} onClick={() => setFilter(f.id)} style={chipStyle}>
                    {f.icon} {f.label}
                  </Btn>
                ))}
              </div>
              <div className="soc-card" style={{ padding: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                {LAYOUTS.map((l) => (
                  <Btn key={l.id} small color={layout === l.id ? C.violet : C.mute} solid={layout === l.id} onClick={() => setLayout(l.id)} style={chipStyle}>
                    {l.icon} {l.label}
                  </Btn>
                ))}
              </div>
              <div className="soc-card" style={{ padding: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                <Btn small color={autoRotate ? C.green : C.mute} onClick={() => setAutoRotate((v) => !v)} style={chipStyle}>
                  <Orbit size={12} /> Auto-orbit {autoRotate ? "on" : "off"}
                </Btn>
                <Btn small color={C.mute} onClick={() => { setSelectedId(null); bus.emit("home"); }} style={chipStyle}>
                  <Maximize2 size={12} /> Recenter
                </Btn>
              </div>
            </div>

            <div className="soc-card" style={{ position: "absolute", top: 118, right: 12, zIndex: 4, padding: "10px 12px", display: "grid", gap: 6 }}>
              {LEGEND.map(([c, l]) => (
                <div key={l} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: C.mute }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: c, boxShadow: `0 0 8px ${c}` }} />
                  {l}
                </div>
              ))}
              <div style={{ borderTop: "1px solid rgba(130,160,210,.14)", paddingTop: 6, marginTop: 2, display: "grid", gap: 5 }}>
                {[[C.cyan, "Settled payment"], [C.amber, "Held payment"], [C.red, "Blocked attempt"]].map(([c, l]) => (
                  <div key={l} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: C.mute }}>
                    <span style={{ width: 14, height: 2, background: c, borderRadius: 2, boxShadow: `0 0 6px ${c}` }} />
                    {l}
                  </div>
                ))}
              </div>
            </div>

            <Director soc={soc} bus={bus} onRunningChange={setDirecting} />
          </div>

          {/* right: investigation / account / cases */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
            <Tabs tab={rightTab} setTab={setRightTab} queueBadge={openCases} />
            {rightTab === "inv" && <InvestigationPanel soc={soc} focus={focus} onResolved={soc.refreshAll} />}
            {rightTab === "acct" && <AccountPanel node={selectedNode} soc={soc} onOpenInvestigation={openInvestigation} />}
            {rightTab === "queue" && <CaseQueue soc={soc} focus={focus} onOpen={openInvestigation} />}
          </div>
        </div>
      )}

      {view === "cases" && <CasesView soc={soc} focus={focus} setFocus={setFocus} />}
      {view === "accounts" && <AccountsView soc={soc} onOpen={openAccountFromTable} />}
      {view === "intel" && <IntelligenceView soc={soc} />}
    </div>
  );
}
