import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Lock, CheckCircle2, AlertTriangle, Shield, User, Smartphone, Globe, CreditCard, Activity, ArrowRight } from 'lucide-react';
import dynamic from 'next/dynamic';

const GraphView = dynamic(() => import('./GraphView'), { ssr: false });

export default function AccountDrawer({ node, onClose, onAction, allElements = [] }) {
  const [loadingAction, setLoadingAction] = useState(false);

  if (!node) return null;

  // Extract 1-hop neighbors
  const nodeId = node.id;
  const edges = allElements.filter(e => e.data.source === nodeId || e.data.target === nodeId);
  const nodeIds = new Set();
  edges.forEach(e => { nodeIds.add(e.data.source); nodeIds.add(e.data.target); });
  const neighborNodes = allElements.filter(e => nodeIds.has(e.data.id) && !e.data.source);
  const oneHopElements = [...neighborNodes, ...edges];

  const riskScore = node.risk_score !== undefined ? (node.risk_score * 100).toFixed(1) : '5.0';
  const isCritical = node.risk_level === 'CRITICAL';
  const isHigh = node.risk_level === 'HIGH';
  const isLow = node.risk_level === 'LOW';

  const riskColor = isCritical ? '#dc2626' : isHigh ? '#f59e0b' : '#10b981';

  const handleManualAction = async (actionType) => {
    setLoadingAction(true);
    try {
      if (onAction) {
        await onAction(nodeId, actionType);
      }
    } finally {
      setLoadingAction(false);
    }
  };

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 220 }}
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 480,
        background: '#0d1117',
        borderLeft: '1px solid var(--border-color)',
        zIndex: 1000,
        boxShadow: '-15px 0 40px rgba(0,0,0,0.7)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          background: 'rgba(15, 20, 30, 0.95)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span
              style={{
                padding: '3px 8px',
                borderRadius: 4,
                fontSize: '0.7rem',
                fontWeight: 700,
                background: `${riskColor}22`,
                color: riskColor,
                border: `1px solid ${riskColor}44`,
              }}
            >
              {node.risk_level || 'EVALUATED'} RISK ({riskScore}%)
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-sub)' }}>
              KYC: {node.kyc_status || 'VERIFIED'}
            </span>
          </div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>
            {node.vpa_address || node.account_holder_name || nodeId}
          </h2>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
            ID: {nodeId}
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-muted)',
            borderRadius: 6,
            padding: 6,
            cursor: 'pointer',
          }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: 24, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        
        {/* Warning Alert if Flagged */}
        {node.warning_message && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 8,
              background: `${riskColor}15`,
              border: `1px solid ${riskColor}44`,
              color: riskColor,
              fontSize: '0.8rem',
              lineHeight: 1.4,
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
            }}
          >
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>{node.warning_message}</div>
          </div>
        )}

        {/* 360 Telemetry Grid */}
        <div>
          <h4 style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-sub)', margin: '0 0 10px' }}>
            Account Telemetry & Baseline
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="glass-panel" style={{ padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                <CreditCard size={14} /> Current Balance
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', marginTop: 4 }}>
                ₹{(node.current_balance || 0).toLocaleString()}
              </div>
            </div>

            <div className="glass-panel" style={{ padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                <Activity size={14} /> Daily Frequency
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', marginTop: 4 }}>
                {node.tx_frequency_per_day || 0} tx/day
              </div>
            </div>

            <div className="glass-panel" style={{ padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                <Smartphone size={14} /> Device Fingerprint
              </div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', marginTop: 4, fontFamily: 'monospace' }}>
                {node.device_id || 'DEV_UNKNOWN'}
              </div>
            </div>

            <div className="glass-panel" style={{ padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                <Globe size={14} /> IP Address
              </div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', marginTop: 4, fontFamily: 'monospace' }}>
                {node.ip_address || '127.0.0.1'}
              </div>
            </div>
          </div>
        </div>

        {/* 1-Hop Neighborhood Graph */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h4 style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-sub)', margin: 0 }}>
              1-Hop Graph Topology ({edges.length} connections)
            </h4>
          </div>
          <div
            className="glass-panel"
            style={{
              height: 180,
              width: '100%',
              overflow: 'hidden',
              position: 'relative',
              background: '#07090e',
            }}
          >
            <GraphView elements={oneHopElements} layoutType="cose" />
          </div>
        </div>

        {/* Manual SOC Interventions */}
        <div>
          <h4 style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-sub)', margin: '0 0 10px' }}>
            SOC Enforcement Controls
          </h4>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => handleManualAction('FREEZE')}
              disabled={loadingAction}
              className="danger-button"
              style={{ flex: 1, justifyContent: 'center' }}
            >
              <Lock size={15} /> Freeze Account
            </button>
            <button
              onClick={() => handleManualAction('FLAG')}
              disabled={loadingAction}
              className="secondary-button"
              style={{ flex: 1, justifyContent: 'center', borderColor: 'var(--risk-high-border)', color: 'var(--risk-high)' }}
            >
              <AlertTriangle size={15} /> Escalate KYC
            </button>
            <button
              onClick={() => handleManualAction('CLEAR')}
              disabled={loadingAction}
              className="secondary-button"
              style={{ flex: 1, justifyContent: 'center', borderColor: 'var(--risk-low-border)', color: 'var(--risk-low)' }}
            >
              <CheckCircle2 size={15} /> Clear Flag
            </button>
          </div>
        </div>

      </div>
    </motion.div>
  );
}
