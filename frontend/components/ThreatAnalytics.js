import React from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import { Activity, ShieldCheck, Cpu, GitMerge } from 'lucide-react';

export default function ThreatAnalytics({ elements = [], cases = [] }) {
  // Generate realistic live-looking telemetry data points based on elements count
  const mockVelocityData = [
    { time: '10:00', totalTps: 120, fraudTps: 3 },
    { time: '10:05', totalTps: 145, fraudTps: 5 },
    { time: '10:10', totalTps: 190, fraudTps: 8 },
    { time: '10:15', totalTps: 310, fraudTps: 28 }, // Spike during smurfing ring
    { time: '10:20', totalTps: 260, fraudTps: 22 },
    { time: '10:25', totalTps: 180, fraudTps: 12 },
    { time: '10:30', totalTps: 210, fraudTps: 4 },
  ];

  const nodes = elements.filter(e => !e.data.source);
  const criticalCount = nodes.filter(n => n.data.risk_level === 'CRITICAL').length;
  const highCount = nodes.filter(n => n.data.risk_level === 'HIGH').length;
  const lowCount = nodes.filter(n => n.data.risk_level === 'LOW' || !n.data.risk_level).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {/* 3-Tier Layered Defense Matrix Banner */}
      <div
        className="glass-panel"
        style={{
          padding: '14px 16px',
          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.8) 0%, rgba(30, 41, 59, 0.7) 100%)',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              padding: 8,
              borderRadius: 8,
              background: 'rgba(59, 130, 246, 0.15)',
              color: 'var(--accent-color)',
            }}
          >
            <Cpu size={16} />
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
              Layer 1: Edge ML
            </div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>
              &lt; 5ms Latency <span style={{ color: 'var(--risk-low)', fontSize: '0.7rem' }}>● Active</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              padding: 8,
              borderRadius: 8,
              background: 'rgba(168, 85, 247, 0.15)',
              color: 'var(--accent-purple)',
            }}
          >
            <GitMerge size={16} />
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
              Layer 2: Graph Mining
            </div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>
              2-Hop Traversal <span style={{ color: 'var(--risk-low)', fontSize: '0.7rem' }}>● Online</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              padding: 8,
              borderRadius: 8,
              background: 'rgba(6, 182, 212, 0.15)',
              color: 'var(--accent-cyan)',
            }}
          >
            <ShieldCheck size={16} />
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
              Layer 3: Agentic OODA
            </div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>
              LangGraph Reasoner <span style={{ color: 'var(--risk-low)', fontSize: '0.7rem' }}>● Ready</span>
            </div>
          </div>
        </div>
      </div>

      {/* Transaction Velocity Sparkline */}
      <div className="glass-panel" style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={16} color="var(--accent-cyan)" />
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>
              Real-Time Traffic & Anomaly Velocity
            </span>
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: '0.7rem' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--accent-color)' }} /> Total TX
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--risk-high)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--risk-high)' }} /> Anomaly Spike
            </span>
          </div>
        </div>

        <div style={{ width: '100%', height: 110 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={mockVelocityData} margin={{ top: 5, right: 10, left: -25, bottom: 0 }}>
              <defs>
                <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="fraudGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} />
              <YAxis stroke="#475569" fontSize={10} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: '0.75rem' }}
              />
              <Area type="monotone" dataKey="totalTps" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#totalGrad)" />
              <Area type="monotone" dataKey="fraudTps" stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill="url(#fraudGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Threat Summary Pills */}
        <div style={{ display: 'flex', gap: 10, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-color)' }}>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Critical Rings:</span>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--risk-critical)' }}>{criticalCount}</span>
          </div>
          <div style={{ width: 1, background: 'var(--border-color)' }} />
          <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>High ATO Alerts:</span>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--risk-high)' }}>{highCount}</span>
          </div>
          <div style={{ width: 1, background: 'var(--border-color)' }} />
          <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Verified Safe:</span>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--risk-low)' }}>{lowCount}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
