import React, { useRef } from 'react';
import { Download, AlertCircle, FileText, Activity } from 'lucide-react';

export default function CaseReport({ caseData }) {
  const componentRef = useRef(null);

  const handlePrint = () => {
    if (typeof window === 'undefined') return;
    const content = componentRef.current;
    if (!content) return;

    const printWindow = window.open('', '_blank', 'width=850,height=950');
    if (!printWindow) {
      window.print();
      return;
    }

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>FraudGuard_Case_${caseData.case_id || 'Report'}</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              padding: 40px;
              color: #0f172a;
              line-height: 1.5;
            }
            h1 { font-size: 24px; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 20px; }
            h3 { font-size: 16px; margin-top: 24px; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
            p { margin: 6px 0; font-size: 14px; }
            .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; font-size: 13px; font-family: monospace; white-space: pre-wrap; margin-top: 8px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
            th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
            th { background: #f1f5f9; font-weight: 600; }
            .badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-weight: 700; font-size: 12px; text-transform: uppercase; background: #fee2e2; color: #b91c1c; }
            .badge-clear { background: #dcfce7; color: #15803d; }
            .footer { margin-top: 40px; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 10px; }
          </style>
        </head>
        <body>
          ${content.innerHTML}
        </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 400);
  };

  const isClear = caseData.decision === 'clear';

  return (
    <div className="glass-panel" style={{ padding: 18, marginBottom: 14 }}>
      
      {/* Header Summary */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-sub)', fontFamily: 'var(--font-mono)' }}>
            CASE // {caseData.case_id}
          </span>
          <h4 style={{ margin: '2px 0 6px', fontSize: '1rem', fontWeight: 700, color: '#fff' }}>
            Target: {caseData.account_id}
          </h4>
          <span
            style={{
              padding: '3px 8px',
              borderRadius: 4,
              fontSize: '0.75rem',
              fontWeight: 700,
              background: isClear ? 'var(--risk-low-bg)' : 'var(--risk-critical-bg)',
              color: isClear ? 'var(--risk-low)' : 'var(--risk-critical)',
              border: `1px solid ${isClear ? 'var(--risk-low-border)' : 'var(--risk-critical-border)'}`,
              textTransform: 'uppercase',
            }}
          >
            {caseData.decision || 'INVESTIGATED'}
          </span>
        </div>
        <button
          className="secondary-button"
          onClick={handlePrint}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', fontSize: '0.75rem' }}
        >
          <Download size={13} /> SAR PDF
        </button>
      </div>

      {/* Investigation Timeline Stepper */}
      <div style={{ padding: '12px 0', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: '0.7rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent-cyan)', fontWeight: 600 }}>
            <Activity size={12} /> Triage
          </div>
          <div style={{ flex: 1, height: 1, background: 'var(--accent-cyan)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent-purple)', fontWeight: 600 }}>
            <FileText size={12} /> Evidence
          </div>
          <div style={{ flex: 1, height: 1, background: 'var(--accent-purple)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: isClear ? 'var(--risk-low)' : 'var(--risk-critical)', fontWeight: 600 }}>
            <AlertCircle size={12} /> {(caseData.decision || 'RESOLVED').toUpperCase()}
          </div>
        </div>
      </div>

      {/* Short Report Preview */}
      <div>
        <p style={{ margin: 0, fontSize: '0.8rem', lineHeight: 1.5, color: 'var(--text-muted)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {caseData.report}
        </p>
      </div>

      {/* Hidden container for print template */}
      <div style={{ position: 'absolute', left: '-9999px', top: '-9999px' }}>
        <div ref={componentRef}>
          <h1>FraudGuard AI — Autonomous Suspicious Activity Dossier</h1>
          <p><strong>Case ID:</strong> {caseData.case_id}</p>
          <p><strong>Target Account ID:</strong> {caseData.account_id}</p>
          <p>
            <strong>Decision:</strong> <span className={isClear ? "badge badge-clear" : "badge"}>{caseData.decision}</span>
          </p>
          <p><strong>Action Taken:</strong> {caseData.action_taken}</p>
          <p><strong>Status:</strong> {caseData.status || 'RESOLVED'}</p>
          
          <h3>Autonomous Agent Reasoning & Narrative</h3>
          <div className="box">
            {caseData.report}
          </div>

          <h3>Audit Trail & Enforcement Actions</h3>
          {caseData.actions && caseData.actions.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Action Type</th>
                  <th>Target System</th>
                  <th>Status</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {caseData.actions.map((a, i) => (
                  <tr key={i}>
                    <td>{a.action_type}</td>
                    <td>{a.target_system}</td>
                    <td>{a.status}</td>
                    <td>{new Date(a.timestamp || a.created_at || Date.now()).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No auxiliary manual audit actions recorded.</p>
          )}

          <div className="footer">
            Generated autonomously by FraudGuard AI Multi-Agent Case Resolution System on {new Date().toLocaleString()}.
          </div>
        </div>
      </div>

    </div>
  );
}
