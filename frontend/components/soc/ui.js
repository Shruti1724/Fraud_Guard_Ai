import React from "react";
import { C } from "./theme";

export function Dot({ color = C.green, pulse = false, size = 8 }) {
  return (
    <span
      className={pulse ? "soc-blink" : undefined}
      style={{ width: size, height: size, borderRadius: "50%", background: color, display: "inline-block", boxShadow: `0 0 10px ${color}`, flexShrink: 0 }}
    />
  );
}

export function Pill({ children, color = C.cyan, solid = false, style }) {
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em",
        padding: "3px 8px", borderRadius: 999, color: solid ? "#04060c" : color,
        background: solid ? color : `${color}1f`, border: `1px solid ${color}55`, whiteSpace: "nowrap", ...style,
      }}
    >
      {children}
    </span>
  );
}

export function Btn({ children, onClick, color = C.cyan, disabled, solid = false, small = false, style, title }) {
  return (
    <button
      className="soc-btn"
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: "inherit",
        fontWeight: 700, fontSize: small ? 11 : 12.5, padding: small ? "5px 10px" : "8px 14px", borderRadius: 10,
        color: solid ? "#04060c" : color, background: solid ? color : `${color}14`, border: `1px solid ${color}55`, ...style,
      }}
    >
      {children}
    </button>
  );
}

export function SectionTitle({ children, right, icon }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px 8px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: ".12em", color: C.mute, textTransform: "uppercase" }}>
        {icon}
        {children}
      </div>
      {right}
    </div>
  );
}

export function Bar({ value, max = 1, color = C.cyan, height = 6, marker, label, right }) {
  const w = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div>
      {(label || right) && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.mute, marginBottom: 4 }}>
          <span>{label}</span>
          <span className="soc-mono" style={{ color: C.text }}>{right}</span>
        </div>
      )}
      <div style={{ position: "relative", height, borderRadius: height, background: "rgba(255,255,255,.07)" }}>
        <div style={{ width: `${w}%`, height: "100%", borderRadius: height, background: `linear-gradient(90deg, ${color}99, ${color})`, boxShadow: `0 0 12px ${color}66`, transition: "width .6s cubic-bezier(.2,.8,.2,1)" }} />
        {marker !== undefined && <div title="flag threshold" style={{ position: "absolute", left: `${marker * 100}%`, top: -3, bottom: -3, width: 2, background: C.amber, borderRadius: 2 }} />}
      </div>
    </div>
  );
}

export function Gauge({ value, max = 100, color = C.red, size = 120, label, sub }) {
  const r = size / 2 - 10;
  const circ = Math.PI * r;
  const p = Math.max(0, Math.min(1, value / max));
  return (
    <div style={{ width: size, textAlign: "center" }}>
      <svg width={size} height={size / 2 + 14} viewBox={`0 0 ${size} ${size / 2 + 14}`}>
        <path d={`M 10 ${size / 2} A ${r} ${r} 0 0 1 ${size - 10} ${size / 2}`} fill="none" stroke="rgba(255,255,255,.09)" strokeWidth="9" strokeLinecap="round" />
        <path
          d={`M 10 ${size / 2} A ${r} ${r} 0 0 1 ${size - 10} ${size / 2}`} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${circ * p} ${circ}`} style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: "stroke-dasharray .9s cubic-bezier(.2,.8,.2,1)" }}
        />
        <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fill={C.text} fontSize={size / 4} fontWeight="800">{label}</text>
      </svg>
      {sub && <div style={{ fontSize: 10.5, color: C.mute, marginTop: -4, letterSpacing: ".08em", textTransform: "uppercase" }}>{sub}</div>}
    </div>
  );
}

export function KV({ k, v, color, mono }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "6px 0", borderBottom: "1px solid rgba(130,160,210,.08)", fontSize: 12 }}>
      <span style={{ color: C.mute }}>{k}</span>
      <span className={mono ? "soc-mono" : undefined} style={{ color: color || C.text, fontWeight: 600, textAlign: "right", wordBreak: "break-all" }}>{v}</span>
    </div>
  );
}

export function Empty({ children }) {
  return <div style={{ padding: "28px 18px", textAlign: "center", color: C.dim, fontSize: 12.5, lineHeight: 1.6 }}>{children}</div>;
}
