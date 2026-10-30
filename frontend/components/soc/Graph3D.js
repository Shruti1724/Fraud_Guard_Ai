// The 3D fraud network. Nodes are glowing role-shaped objects whose look is driven every
// frame from live account data (risk, frozen, under investigation); edges carry particles
// that flow in the direction money moved. One-shot effects arrive over the bus.
//
// All accessors handed to ForceGraph3D live at module level on purpose: the library
// rebuilds every node object whenever an accessor's identity changes.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import SpriteText from "three-spritetext";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { forceX, forceY, forceZ } from "d3-force-3d";
import { C, riskColor, txnColor, inr, pct, ROLE_LABEL } from "./theme";

const endpoint = (v) => (v && typeof v === "object" ? v.id : v);
const shared = { neighbors: null, glowTex: null, hover: null, selected: null };

function getGlowTexture() {
  if (shared.glowTex) return shared.glowTex;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  shared.glowTex = new THREE.CanvasTexture(canvas);
  return shared.glowTex;
}

function geometryFor(role, r) {
  switch (role) {
    case "SINK": return new THREE.OctahedronGeometry(r * 1.35);
    case "SYNDICATE": return new THREE.IcosahedronGeometry(r * 1.3);
    case "SMURF": return new THREE.DodecahedronGeometry(r * 1.2);
    case "ATO": return new THREE.TetrahedronGeometry(r * 1.45);
    case "RELAY": return new THREE.OctahedronGeometry(r * 1.2, 1);
    case "MERCHANT":
    case "PAYROLL": return new THREE.BoxGeometry(r * 1.55, r * 1.55, r * 1.55);
    default: return new THREE.SphereGeometry(r, 20, 20);
  }
}

const nodeRadius = (n) => {
  const base = { SINK: 7, SYNDICATE: 7, RELAY: 6, SMURF: 6.5, HAWALA: 6, ATO: 5.5, MERCHANT: 5.5, PAYROLL: 5.5 }[n.role] || 4.2;
  return base + Math.min(2.5, (n.risk_score || 0) * 2);
};

// What colour a node should show right now.
function nodeTone(n) {
  if (n.risk_status === "FROZEN") return new THREE.Color(C.red);
  if (n._investigating || n.risk_status === "UNDER_INVESTIGATION") return new THREE.Color(C.amber);
  if (n.cleared_by_agent_at && n.risk_status === "ACTIVE") return new THREE.Color(C.cyan);
  return new THREE.Color(riskColor(n.risk_level));
}

function buildNode(n) {
  const r = nodeRadius(n);
  const group = new THREE.Group();
  const tone = nodeTone(n);

  const geo = geometryFor(n.role, r);
  const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: tone, transparent: true }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: tone.clone().offsetHSL(0, 0, 0.25), transparent: true }));
  edges.scale.setScalar(1.04);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color: tone, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.setScalar(r * 4);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 2, r * 0.09, 8, 64), new THREE.MeshBasicMaterial({ color: C.ice, transparent: true, opacity: 0.9 }));
  ring.visible = false;

  const text = n.vpa_address && n.vpa_address !== n.id ? n.vpa_address.split("@")[0] : n.label || n.id;
  const label = new SpriteText(text.length > 20 ? `${text.slice(0, 19)}…` : text, 2.8, "#cfe0ff");
  label.fontFace = "Inter, system-ui, sans-serif";
  label.fontWeight = "600";
  label.position.set(0, -(r + 5.5), 0);
  label.material.depthWrite = false;
  label.backgroundColor = "rgba(4,6,12,0.55)";
  label.padding = 1.2;
  label.borderRadius = 1.4;

  group.add(glow, core, edges, ring, label);
  group.userData = { core, edges, glow, ring, label, r, tone: tone.clone() };
  return group;
}

function nodeTooltip(n) {
  const col = riskColor(n.risk_level);
  const status = n.risk_status || "ACTIVE";
  const models = n.model_scores ? `<div style="margin-top:4px;color:#93a2bd">XGB ${n.model_scores.xgb.toFixed(2)} · GraphSAGE ${n.model_scores.sage.toFixed(2)}</div>` : "";
  return `<div class="soc-tip"><div style="font-weight:700;font-size:13px">${n.account_holder_name || n.id}</div>
    <div style="color:#93a2bd;font-family:ui-monospace,monospace;font-size:11px">${n.vpa_address}</div>
    <div style="margin-top:6px;display:flex;gap:6px;align-items:center"><span style="color:${col};font-weight:700">${n.risk_level} ${pct(n.risk_score, 0)}</span>
    <span style="opacity:.5">·</span><span>${status.replace("_", " ")}</span></div>
    <div style="color:#93a2bd;margin-top:2px">${ROLE_LABEL[n.role] || "Account"}</div>${models}</div>`;
}

function linkColor(l) {
  const sel = shared.neighbors;
  if (sel && !(sel.has(endpoint(l.source)) && sel.has(endpoint(l.target)))) return "rgba(70,85,115,0.12)";
  return l.status === "SUCCESS" ? "rgba(104,205,245,0.55)" : txnColor(l.status);
}
const linkWidth = (l) => (l.status === "SUCCESS" ? 0.8 : 1.6);
const linkCurvature = (l) => l.curve || 0;
const arrowLength = (l) => (l.status === "SUCCESS" ? 2.2 : 3.6);
const particleCount = (l) => (l.status === "BLOCKED" ? 3 : l.status === "FLAGGED" ? 4 : l._born && Date.now() - l._born < 20000 ? 3 : 1);
const particleWidth = (l) => 1.2 + Math.min(2.2, Math.log10((l.amount || 1) + 1) * 0.45);
const particleSpeed = (l) => (l.status === "SUCCESS" ? 0.004 : 0.007);
const particleColor = (l) => (l.status === "SUCCESS" ? C.cyan : txnColor(l.status));
const linkTooltip = (l) =>
  `<div class="soc-tip"><b>${inr(l.amount)}</b> · ${l.status}<br/><span style="color:#93a2bd">${endpoint(l.source)} → ${endpoint(l.target)}</span>${l.block_reason ? `<br/><span style="color:#ff6b86">${l.block_reason}</span>` : ""}</div>`;
const onNodeHover = (n) => {
  shared.hover = n ? n.id : null;
  if (typeof document !== "undefined") document.body.style.cursor = n ? "pointer" : "default";
};
const noop = () => {};

function Graph3D({ graphData, selectedId, onSelectNode, onSelectLink, bus, layout = "force", autoRotate = true, filter = "ALL" }) {
  const fgRef = useRef(null);
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const effectsRef = useRef([]);
  const rotateTimer = useRef(null);
  const autoRef = useRef(autoRotate);
  autoRef.current = autoRotate;
  const movedRef = useRef(false);
  const handlers = useRef({});
  handlers.current = { onSelectNode, onSelectLink, bus };
  shared.selected = selectedId;

  const onNodeClick = useCallback((n) => {
    handlers.current.onSelectNode && handlers.current.onSelectNode(n.id);
    handlers.current.bus.emit("focus", { id: n.id });
  }, []);
  const onLinkClick = useCallback((l) => handlers.current.onSelectLink && handlers.current.onSelectLink(l), []);
  // Once the layout settles, frame the whole network (unless the analyst is driving).
  const onEngineStop = useCallback(() => {
    if (!movedRef.current && fgRef.current) fgRef.current.zoomToFit(900, 150);
  }, []);
  const onBackgroundClick = useCallback(() => handlers.current.onSelectNode && handlers.current.onSelectNode(null), []);

  // ── size ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!wrapRef.current) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.max(200, Math.floor(width)), h: Math.max(200, Math.floor(height)) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // ── filtering ─────────────────────────────────────────────────────────────
  const visibleData = useMemo(() => {
    if (filter === "ALL") return graphData;
    const rings = new Set(["SINK", "SYNDICATE", "RELAY", "MULE", "SMURF", "ATO", "HAWALA"]);
    let keep;
    if (filter === "RINGS") keep = new Set(graphData.nodes.filter((n) => rings.has(n.role) || n.risk_level === "CRITICAL" || n.risk_status === "FROZEN").map((n) => n.id));
    else if (filter === "FROZEN") keep = new Set(graphData.nodes.filter((n) => n.risk_status !== "ACTIVE").map((n) => n.id));
    else if (filter === "FLAGGED") {
      const ids = new Set();
      graphData.links.forEach((l) => { if (l.status !== "SUCCESS") { ids.add(endpoint(l.source)); ids.add(endpoint(l.target)); } });
      keep = ids;
    } else return graphData;
    return {
      nodes: graphData.nodes.filter((n) => keep.has(n.id)),
      links: graphData.links.filter((l) => keep.has(endpoint(l.source)) && keep.has(endpoint(l.target))),
    };
  }, [graphData, filter]);

  // The library mutates these very node/link objects (positions, __threeObj) and its ref
  // has no getter for them, so keep our own handle to the current data.
  const dataRef = useRef(visibleData);
  dataRef.current = visibleData;

  // ── scene setup: bloom, fog, starfield, controls, render-loop animation ──
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return undefined;

    const scene = fg.scene();
    scene.fog = new THREE.FogExp2(0x04060c, 0.0011);

    const starGeo = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 1400; i += 1) {
      const rr = 700 + Math.random() * 900;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pts.push(rr * Math.sin(ph) * Math.cos(th), rr * Math.sin(ph) * Math.sin(th), rr * Math.cos(ph));
    }
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x6d86b8, size: 2.2, sizeAttenuation: true, transparent: true, opacity: 0.55, depthWrite: false }));
    scene.add(stars);

    let bloom = null;
    try {
      bloom = new UnrealBloomPass(new THREE.Vector2(size.w, size.h), 0.55, 0.5, 0.32);
      fg.postProcessingComposer().addPass(bloom);
    } catch (e) { /* renderer without a composer: skip bloom */ }

    const controls = fg.controls();
    let onStart = null;
    if (controls) {
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.autoRotate = autoRef.current;
      controls.autoRotateSpeed = 0.55;
      onStart = () => {
        movedRef.current = true;
        controls.autoRotate = false;
        clearTimeout(rotateTimer.current);
        rotateTimer.current = setTimeout(() => { controls.autoRotate = autoRef.current; movedRef.current = false; }, 9000);
      };
      controls.addEventListener("start", onStart);
    }

    fg.cameraPosition({ x: 0, y: 40, z: 330 });

    // Spacing that suits the node sizes, plus a light pull to the centre so disconnected
    // rings stay in frame together instead of drifting apart.
    const charge = fg.d3Force("charge");
    if (charge) charge.strength(-120);
    const link = fg.d3Force("link");
    if (link) link.distance(52);
    fg.d3Force("gx", forceX(0).strength(0.05));
    fg.d3Force("gy", forceY(0).strength(0.05));
    fg.d3Force("gz", forceZ(0).strength(0.05));

    let raf;
    const tick = (t) => {
      const time = t / 1000;
      const sel = shared.neighbors;
      const nodes = dataRef.current.nodes;
      for (let i = 0; i < nodes.length; i += 1) {
        const n = nodes[i];
        const ud = n.__threeObj && n.__threeObj.userData;
        if (!ud || !ud.core) continue;

        ud.tone.lerp(nodeTone(n), 0.12);
        ud.core.material.color.copy(ud.tone);
        ud.edges.material.color.copy(ud.tone).offsetHSL(0, 0, 0.25);
        ud.glow.material.color.copy(ud.tone);

        const critical = n.risk_level === "CRITICAL" || n.risk_level === "HIGH";
        const busy = n._investigating;
        const pulse = 1 + (critical || busy ? 0.16 * Math.sin(time * (busy ? 7 : 2.4) + i) : 0.03 * Math.sin(time + i));
        const dimmed = sel && !sel.has(n.id);
        const fade = dimmed ? 0.22 : 1;
        ud.glow.scale.setScalar(ud.r * 4.2 * pulse * (n.risk_status === "FROZEN" ? 0.85 : 1));
        ud.core.material.opacity = fade;
        ud.edges.material.opacity = 0.9 * fade;
        ud.glow.material.opacity = (critical ? 0.7 : 0.38) * fade;
        ud.label.material.opacity = dimmed ? 0.15 : 1;

        const frozen = n.risk_status === "FROZEN";
        const scanning = busy || n.risk_status === "UNDER_INVESTIGATION";
        ud.ring.visible = frozen || scanning;
        if (ud.ring.visible) {
          ud.ring.material.color.set(frozen ? C.ice : C.amber);
          ud.ring.material.opacity = (frozen ? 0.9 : 0.55 + 0.4 * Math.sin(time * 6)) * fade;
          ud.ring.rotation.x = Math.PI / 2 + (scanning ? Math.sin(time * 2) * 0.5 : 0.35);
          ud.ring.rotation.z += scanning ? 0.07 : 0.004;
        }
        ud.core.rotation.y += n.role === "SINK" || n.role === "SYNDICATE" ? 0.012 : 0.004;
        ud.edges.rotation.copy(ud.core.rotation);
      }

      const fx = effectsRef.current;
      for (let k = fx.length - 1; k >= 0; k -= 1) {
        const e = fx[k];
        const p = (t - e.t0) / e.dur;
        if (p >= 1) { scene.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh.material.dispose(); fx.splice(k, 1); continue; }
        e.mesh.scale.setScalar(1 + p * e.grow);
        e.mesh.material.opacity = (1 - p) * 0.9;
        if (e.follow && e.follow.x !== undefined) e.mesh.position.set(e.follow.x, e.follow.y, e.follow.z);
        e.mesh.lookAt(fg.camera().position);
      }
      stars.rotation.y += 0.00015;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(rotateTimer.current);
      if (controls && onStart) controls.removeEventListener("start", onStart);
      scene.remove(stars);
      if (bloom) { try { fg.postProcessingComposer().removePass(bloom); } catch (e) { /* ignore */ } }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── selection neighbourhood (dims everything else) ─────────────────────────
  useEffect(() => {
    if (!selectedId) shared.neighbors = null;
    else {
      const set = new Set([selectedId]);
      graphData.links.forEach((l) => {
        const a = endpoint(l.source);
        const b = endpoint(l.target);
        if (a === selectedId) set.add(b);
        if (b === selectedId) set.add(a);
      });
      shared.neighbors = set;
    }
    if (fgRef.current) fgRef.current.refresh();
  }, [selectedId, graphData]);

  useEffect(() => { if (fgRef.current) fgRef.current.d3ReheatSimulation(); }, [layout]);

  // ── one-shot effects over the bus ──────────────────────────────────────────
  useEffect(() => {
    const fg = () => fgRef.current;
    const nodeById = (id) => dataRef.current.nodes.find((n) => n.id === id);

    const shock = (id, color, grow = 14, dur = 1400) => {
      const f = fg();
      const n = nodeById(id);
      if (!f || !n) return;
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(5, 5.8, 64),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      mesh.position.set(n.x || 0, n.y || 0, n.z || 0);
      f.scene().add(mesh);
      effectsRef.current.push({ mesh, t0: performance.now(), dur, grow, follow: n });
    };

    const fly = ({ id, dist = 200 }) => {
      const f = fg();
      const n = nodeById(id);
      if (!f || !n) return;
      const len = Math.hypot(n.x || 0, n.y || 0, n.z || 0);
      if (len < 1) f.cameraPosition({ x: 0, y: 30, z: dist + 60 }, n, 1400);
      else {
        const ratio = 1 + dist / len;
        f.cameraPosition({ x: n.x * ratio, y: n.y * ratio + 12, z: n.z * ratio }, n, 1400);
      }
      const c = f.controls();
      if (c) { c.autoRotate = false; clearTimeout(rotateTimer.current); rotateTimer.current = setTimeout(() => { c.autoRotate = autoRef.current; }, 12000); }
    };

    const offs = [
      bus.on("txn", (link) => {
        const f = fg();
        const live = f && dataRef.current.links.find((l) => l.id === link.id);
        if (!live) return;
        for (let i = 0; i < 4; i += 1) setTimeout(() => f.emitParticle(live), i * 140);
      }),
      bus.on("freeze", ({ id }) => { shock(id, C.red, 18, 1700); setTimeout(() => shock(id, C.ice, 12, 1500), 260); }),
      bus.on("clear", ({ id }) => shock(id, C.green, 14, 1500)),
      bus.on("hold", ({ id }) => shock(id, C.amber, 12, 1300)),
      bus.on("investigate", ({ id }) => { shock(id, C.amber, 10, 1100); setTimeout(() => shock(id, C.amber, 16, 1500), 500); }),
      bus.on("risk", ({ id, is_flagged }) => { if (is_flagged) shock(id, C.orange, 9, 900); }),
      bus.on("focus", fly),
      bus.on("home", () => { const f = fg(); if (f) f.cameraPosition({ x: 0, y: 40, z: 330 }, { x: 0, y: 0, z: 0 }, 1400); }),
    ];
    return () => offs.forEach((off) => off());
  }, [bus]);

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
      <ForceGraph3D
        ref={fgRef}
        width={size.w}
        height={size.h}
        graphData={visibleData}
        backgroundColor="#04060c"
        controlType="orbit"
        showNavInfo={false}
        nodeId="id"
        nodeThreeObject={buildNode}
        nodeThreeObjectExtend={false}
        nodeLabel={nodeTooltip}
        onNodeHover={onNodeHover}
        onNodeClick={onNodeClick}
        onLinkClick={onLinkClick}
        onBackgroundClick={onBackgroundClick}
        linkColor={linkColor}
        linkOpacity={0.9}
        linkWidth={linkWidth}
        linkCurvature={linkCurvature}
        linkCurveRotation={0.6}
        linkDirectionalArrowLength={arrowLength}
        linkDirectionalArrowRelPos={0.98}
        linkDirectionalArrowColor={linkColor}
        linkDirectionalParticles={particleCount}
        linkDirectionalParticleWidth={particleWidth}
        linkDirectionalParticleSpeed={particleSpeed}
        linkDirectionalParticleColor={particleColor}
        linkLabel={linkTooltip}
        dagMode={layout === "flow" ? "lr" : layout === "radial" ? "radialout" : null}
        dagLevelDistance={layout === "flow" ? 80 : 60}
        onDagError={noop}
        onEngineStop={onEngineStop}
        cooldownTicks={140}
        d3AlphaDecay={0.025}
        d3VelocityDecay={0.32}
      />
    </div>
  );
}

export default React.memo(Graph3D);
