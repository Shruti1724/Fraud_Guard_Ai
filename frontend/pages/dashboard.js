import React, { useEffect, useState, useRef } from 'react';
import Head from 'next/head';
import { io } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Activity, FileText, Search, User, Terminal, X, ShieldAlert, Cpu, Sparkles, Database } from 'lucide-react';
import dynamic from 'next/dynamic';
import CaseReport from '../components/CaseReport';
import DemoScenariosBar from '../components/DemoScenariosBar';
import ThreatAnalytics from '../components/ThreatAnalytics';
import AccountDrawer from '../components/AccountDrawer';
import LiveTerminal from '../components/LiveTerminal';

const GraphView = dynamic(() => import('../components/GraphView'), { ssr: false });

export default function Dashboard() {
  const [elements, setElements] = useState([]);
  const [activities, setActivities] = useState([]);
  const [cases, setCases] = useState([]);
  const [connected, setConnected] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);
  
  const socketRef = useRef(null);

  // Fetch initial graph topology and investigation cases
  const refreshData = async () => {
    try {
      const graphRes = await fetch('http://localhost:4000/dashboard/graph');
      const graphData = await graphRes.json();
      setElements(graphData);

      const casesRes = await fetch('http://localhost:4000/dashboard/cases');
      const casesData = await casesRes.json();
      setCases(casesData);
    } catch (err) {
      console.error("Fetch initial data failed", err);
    }
  };

  useEffect(() => {
    refreshData();

    // Initial system logs in terminal
    setActivities([
      { msg: '[SYSTEM:INIT] Layer 1 Edge XGBoost Inference Engine (Threshold: 0.85) Online.', level: 'info', time: new Date() },
      { msg: '[SYSTEM:INIT] Layer 2 GraphSAGE 2-Hop Network Topology Service Online.', level: 'info', time: new Date() },
      { msg: '[SYSTEM:INIT] Layer 3 LangGraph Multi-Agent Autonomous Reasoner Ready.', level: 'agent', time: new Date() },
    ]);

    socketRef.current = io('http://localhost:4000');
    socketRef.current.on('connect', () => {
      setConnected(true);
      logTerminal('[NETWORK] Connected to FraudGuard WebSocket event pipeline.', 'info');
    });
    socketRef.current.on('disconnect', () => {
      setConnected(false);
      logTerminal('[NETWORK] Disconnected from WebSocket event pipeline.', 'warning');
    });

    socketRef.current.on('transaction:new', (data) => {
      const { txn } = data;
      setElements(prev => [
        ...prev,
        {
          data: {
            id: txn.transaction_id,
            source: txn.sender_account_id,
            target: txn.receiver_account_id,
            amount: txn.amount,
            status: txn.status,
            type: txn.type,
            is_fraud: txn.is_fraud,
          }
        }
      ]);
      const isBad = txn.status === 'BLOCKED' || txn.status === 'FLAGGED' || txn.is_fraud;
      logTerminal(`[TXN] ${txn.sender_account_id} ➔ ${txn.receiver_account_id} | ₹${txn.amount?.toLocaleString()} | Status: ${txn.status}`, isBad ? 'critical' : 'info');
    });

    socketRef.current.on('risk_score:updated', (data) => {
      setElements(prev => prev.map(el => el.data.id === data.account_id ? { ...el, data: { ...el.data, risk_level: data.risk_level, risk_score: data.risk_score } } : el));
      const isHigh = data.risk_level === 'HIGH' || data.risk_level === 'CRITICAL';
      logTerminal(`[RISK_UPDATE] ${data.account_id} evaluated at ${(data.risk_score * 100).toFixed(1)}% | Status: ${data.risk_level}`, isHigh ? 'warning' : 'info');
    });

    socketRef.current.on('agent:activity', (data) => {
      if (data.report && data.report.includes('heartbeat')) return;
      refreshData();
      logTerminal(`[AGENT_ACTION] Decision: ${(data.decision || 'INVESTIGATE').toUpperCase()} | Action: ${data.action_taken}`, data.decision === 'clear' ? 'success' : 'agent');
    });

    return () => socketRef.current.disconnect();
  }, []);

  function logTerminal(msg, level = 'info') {
    setActivities(prev => [{ msg, level, time: new Date() }, ...prev].slice(0, 75));
  }

  // Handle manual SOC intervention (freeze / clear / escalate)
  const handleManualAction = async (accountId, actionType) => {
    try {
      const res = await fetch('http://localhost:4000/dashboard/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, action_type: actionType, reason: `Manual SOC console intervention: ${actionType}` })
      });
      const data = await res.json();
      if (data.success) {
        logTerminal(`[SOC_OVERRIDE] Executed ${actionType} on account ${accountId}`, actionType === 'FREEZE' ? 'critical' : 'success');
        refreshData();
        setSelectedNode(null);
      }
    } catch (err) {
      console.error("Manual action failed", err);
    }
  };

  // Simulate a live burst scenario for presentation demo
  const handleSimulateBurst = async () => {
    setIsSimulating(true);
    logTerminal('[DEMO:BURST] Simulating real-time synthetic transaction burst across network...', 'agent');

    const burstTransactions = [
      { sender: 'acc_user_101', receiver_vpa: 'sharma.kirana.store@hdfcbank', amount: 350 },
      { sender: 'C_CUSTOMER_01', receiver_vpa: 'mule.relay99@oksbi', amount: 48000 },
      { sender: 'acc_star_burst_02', receiver_vpa: 'mule.leaf01@axis', amount: 9900 },
    ];

    for (let i = 0; i < burstTransactions.length; i++) {
      const tx = burstTransactions[i];
      await new Promise(r => setTimeout(r, 600));
      try {
        await fetch('http://localhost:4000/send-money', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender_account_id: tx.sender,
            receiver_vpa: tx.receiver_vpa,
            amount: tx.amount,
            device_id: 'DEV_DEMO_STREAM'
          })
        });
      } catch (e) {
        console.error("Burst simulation item failed", e);
      }
    }

    setIsSimulating(false);
    logTerminal('[DEMO:BURST] Synthetic burst completed and ingested into graph.', 'success');
  };

  // Preset demo trigger
  const handleSelectScenario = (scenario) => {
    logTerminal(`[DEMO:SCENARIO] Selected scenario: ${scenario.title} (${scenario.vpa}) | Risk: ${scenario.risk}`, 'agent');
    // Find node in elements and open drawer
    const targetNode = elements.find(e => !e.data.source && (e.data.vpa_address === scenario.vpa || e.data.id === scenario.vpa));
    if (targetNode) {
      setSelectedNode(targetNode.data);
    }
  };

  const nodes = elements.filter(e => !e.data.source);
  const criticalCount = nodes.filter(n => n.data.risk_level === 'CRITICAL').length;
  const highCount = nodes.filter(n => n.data.risk_level === 'HIGH').length;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg-color)', color: 'var(--text-main)' }}>
      <Head>
        <title>FraudGuard AI - Next-Gen Fraud Intelligence SOC</title>
      </Head>

      {/* Cyber Sidebar */}
      <div
        style={{
          width: 72,
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '20px 0',
          background: 'rgba(12, 16, 24, 0.95)',
          zIndex: 20,
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: 'linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 36,
            boxShadow: '0 0 20px rgba(59, 130, 246, 0.5)',
          }}
        >
          <Shield color="#fff" size={24} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, color: 'var(--text-muted)' }}>
          <button
            title="Live Network SOC"
            style={{
              background: 'rgba(59, 130, 246, 0.15)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              color: 'var(--accent-cyan)',
              padding: 10,
              borderRadius: 10,
              cursor: 'pointer',
            }}
          >
            <Activity size={20} />
          </button>
          <button
            onClick={() => refreshData()}
            title="Refresh Data"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              padding: 10,
              borderRadius: 10,
              cursor: 'pointer',
            }}
          >
            <Database size={20} />
          </button>
        </div>
      </div>

      {/* Main Command Center Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        
        {/* Top SOC HUD Header */}
        <header
          style={{
            height: 64,
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 24px',
            justifyContent: 'space-between',
            background: 'rgba(15, 18, 26, 0.85)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <h1 style={{ fontSize: '1.1rem', fontWeight: 700, letterSpacing: '-0.02em', margin: 0, color: '#fff' }}>
              FraudGuard AI <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--accent-cyan)', marginLeft: 6 }}>// SOC Intelligence Command</span>
            </h1>
            <span
              style={{
                fontSize: '0.65rem',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                background: 'rgba(59, 130, 246, 0.15)',
                color: 'var(--accent-color)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
              }}
            >
              v2.4 REALTIME
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <span>RISK_THRESHOLD:</span>
              <strong style={{ color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>&gt; 0.85</strong>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 12px',
                borderRadius: 20,
                background: connected ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                border: `1px solid ${connected ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                fontSize: '0.75rem',
                fontWeight: 600,
                color: connected ? 'var(--risk-low)' : 'var(--risk-high)',
              }}
            >
              <div
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: connected ? 'var(--risk-low)' : 'var(--risk-high)',
                  boxShadow: `0 0 10px ${connected ? 'var(--risk-low)' : 'var(--risk-high)'}`,
                }}
              />
              {connected ? 'LIVE NETWORK PIPELINE' : 'DISCONNECTED'}
            </div>
          </div>
        </header>

        {/* Demo Scenarios Quick-Action Bar */}
        <DemoScenariosBar
          onSelectScenario={handleSelectScenario}
          onSimulateBurst={handleSimulateBurst}
          isSimulating={isSimulating}
        />

        {/* Grid Content Layout */}
        <div style={{ flex: 1, display: 'flex', padding: '16px 20px', gap: 16, overflow: 'hidden' }}>
          
          {/* Left / Center Column: Graph + Telemetry */}
          <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            
            {/* Top Stat Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <div className="glass-panel" style={{ padding: '12px 16px' }}>
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                  Network Nodes
                </p>
                <h2 style={{ margin: '4px 0 0', fontSize: '1.4rem', fontWeight: 700 }}>
                  {nodes.length}
                </h2>
              </div>

              <div className="glass-panel" style={{ padding: '12px 16px', borderLeft: '3px solid var(--risk-critical)' }}>
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                  Critical Mule Rings
                </p>
                <h2 style={{ margin: '4px 0 0', fontSize: '1.4rem', fontWeight: 700, color: 'var(--risk-critical)' }}>
                  {criticalCount}
                </h2>
              </div>

              <div className="glass-panel" style={{ padding: '12px 16px', borderLeft: '3px solid var(--risk-high)' }}>
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                  ATO Suspects
                </p>
                <h2 style={{ margin: '4px 0 0', fontSize: '1.4rem', fontWeight: 700, color: 'var(--risk-high)' }}>
                  {highCount}
                </h2>
              </div>

              <div className="glass-panel" style={{ padding: '12px 16px', borderLeft: '3px solid var(--accent-cyan)' }}>
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                  Autonomous Cases
                </p>
                <h2 style={{ margin: '4px 0 0', fontSize: '1.4rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                  {cases.length}
                </h2>
              </div>
            </div>

            {/* Network Topology Graph */}
            <div className="glass-panel" style={{ flex: 1, minHeight: 380, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <GraphView
                elements={elements}
                onNodeClick={(data) => setSelectedNode(data)}
                selectedNodeId={selectedNode?.id}
              />
            </div>

            {/* Threat Analytics Widget */}
            <div style={{ height: 180 }}>
              <ThreatAnalytics elements={elements} cases={cases} />
            </div>

          </div>

          {/* Right Column: AI Terminal + Investigation Cases */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 380 }}>
            
            {/* Multi-Agent Live Terminal */}
            <div style={{ height: 260 }}>
              <LiveTerminal activities={activities} onSelectAccount={(id) => setSelectedNode(elements.find(e => e.data.id === id)?.data)} />
            </div>

            {/* Autonomous Investigation Cases */}
            <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border-color)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'rgba(12, 16, 24, 0.9)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={16} color="var(--accent-cyan)" />
                  <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700 }}>
                    Autonomous Incident Dossiers ({cases.length})
                  </h3>
                </div>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {cases.length === 0 ? (
                  <div style={{ color: 'var(--text-sub)', textAlign: 'center', padding: 30, fontSize: '0.85rem' }}>
                    No incident cases generated yet. Send a transaction from a mule VPA to trigger autonomous agent analysis!
                  </div>
                ) : (
                  cases.map(c => <CaseReport key={c._id || c.case_id} caseData={c} />)
                )}
              </div>
            </div>

          </div>

        </div>
      </div>

      {/* Account Detail 360° Drawer */}
      <AnimatePresence>
        {selectedNode && (
          <AccountDrawer
            node={selectedNode}
            onClose={() => setSelectedNode(null)}
            onAction={handleManualAction}
            allElements={elements}
          />
        )}
      </AnimatePresence>

    </div>
  );
}
