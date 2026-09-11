import React from 'react';
import { Play, ShieldAlert, Zap, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';

export default function DemoScenariosBar({ onSelectScenario, onSimulateBurst, isSimulating }) {
  const scenarios = [
    {
      id: 'mule_relay',
      title: 'Mule Relay Cascade',
      subtitle: 'Pass-through rapid laundering',
      vpa: 'mule.relay99@oksbi',
      amount: 48500,
      risk: 'CRITICAL',
      icon: <ShieldAlert size={14} color="#ef4444" />,
      color: '#ef4444',
      badge: '0.96 Score',
    },
    {
      id: 'star_burst',
      title: 'Star-Burst Smurfing',
      subtitle: '1:10 micro-fragmentation',
      vpa: 'quicksplit.hub@paytm',
      amount: 9900,
      risk: 'CRITICAL',
      icon: <Zap size={14} color="#f59e0b" />,
      color: '#f59e0b',
      badge: '0.92 Score',
    },
    {
      id: 'account_takeover',
      title: 'Account Takeover (ATO)',
      subtitle: 'Tor IP + High-Value Egress',
      vpa: 'rajesh.kumar77@icici',
      amount: 95000,
      risk: 'HIGH',
      icon: <AlertTriangle size={14} color="#ec4899" />,
      color: '#ec4899',
      badge: '0.88 Score',
    },
    {
      id: 'verified_retailer',
      title: 'Verified Merchant',
      subtitle: 'Benign high-volume micro-tx',
      vpa: 'sharma.kirana.store@hdfcbank',
      amount: 450,
      risk: 'LOW',
      icon: <CheckCircle size={14} color="#10b981" />,
      color: '#10b981',
      badge: '0.04 Safe',
    },
  ];

  return (
    <div
      style={{
        background: 'linear-gradient(90deg, rgba(15, 18, 24, 0.95) 0%, rgba(20, 26, 38, 0.95) 100%)',
        borderBottom: '1px solid var(--border-color)',
        padding: '10px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        overflowX: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 'max-content' }}>
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--accent-cyan)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-cyan)' }} />
          Demo Scenarios:
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 'max-content' }}>
        {scenarios.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelectScenario(s)}
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: `1px solid rgba(255, 255, 255, 0.08)`,
              borderRadius: 8,
              padding: '6px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = s.color;
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{s.icon}</div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>{s.title}</span>
                <span
                  style={{
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    padding: '1px 5px',
                    borderRadius: 4,
                    background: `${s.color}22`,
                    color: s.color,
                    border: `1px solid ${s.color}44`,
                  }}
                >
                  {s.badge}
                </span>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-sub)' }}>{s.vpa}</div>
            </div>
          </button>
        ))}
      </div>

      <div style={{ minWidth: 'max-content' }}>
        <button
          onClick={onSimulateBurst}
          disabled={isSimulating}
          className="primary-button"
          style={{
            fontSize: '0.75rem',
            padding: '7px 14px',
            background: isSimulating
              ? 'rgba(59, 130, 246, 0.3)'
              : 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
          }}
        >
          <RefreshCw size={13} className={isSimulating ? 'spin-anim' : ''} />
          {isSimulating ? 'Streaming Bursts...' : 'Simulate Live Burst'}
        </button>
      </div>
    </div>
  );
}
