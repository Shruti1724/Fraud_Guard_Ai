import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, ShieldAlert, Cpu, Filter } from 'lucide-react';

export default function LiveTerminal({ activities = [], onSelectAccount }) {
  const [filter, setFilter] = useState('ALL');

  const filteredLogs = activities.filter(act => {
    if (filter === 'AGENT') return act.level === 'agent' || act.msg.includes('AGENT');
    if (filter === 'CRITICAL') return act.level === 'critical' || act.level === 'warning';
    return true;
  });

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(10, 14, 22, 0.9)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Terminal size={15} color="var(--accent-cyan)" />
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>
            agent:audit_stream
          </span>
        </div>

        {/* Filter Pills */}
        <div style={{ display: 'flex', gap: 4 }}>
          {['ALL', 'AGENT', 'CRITICAL'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                border: 'none',
                background: filter === f ? 'var(--accent-color)' : 'rgba(255,255,255,0.05)',
                color: filter === f ? '#fff' : '#94a3b8',
                fontSize: '0.65rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Logs Viewport */}
      <div className="terminal-feed terminal-font" style={{ flex: 1, fontSize: '0.75rem', lineHeight: 1.6 }}>
        {filteredLogs.length === 0 ? (
          <div style={{ color: '#475569', textAlign: 'center', paddingTop: 30 }}>
            [STREAM_LISTENING] Real-time multi-agent reasoning logs will appear here...
          </div>
        ) : (
          <AnimatePresence>
            {filteredLogs.map((act, i) => {
              let color = '#38bdf8'; // info cyan
              if (act.level === 'warning') color = '#fbbf24'; // amber
              if (act.level === 'critical') color = '#f87171'; // red
              if (act.level === 'success') color = '#34d399'; // green
              if (act.level === 'agent') color = '#c084fc'; // purple

              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  style={{ marginBottom: 6, color }}
                >
                  <span style={{ opacity: 0.45, marginRight: 6, color: '#94a3b8' }}>
                    [{act.time instanceof Date ? act.time.toLocaleTimeString() : new Date(act.time).toLocaleTimeString()}]
                  </span>
                  {act.msg}
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
