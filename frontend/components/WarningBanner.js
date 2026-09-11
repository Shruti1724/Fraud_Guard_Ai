import { motion } from "framer-motion";
import { AlertTriangle, ShieldCheck, AlertCircle, XCircle } from "lucide-react";

export default function WarningBanner({ risk, onConfirm, onCancel }) {
  if (!risk || !risk.is_flagged) return null;

  const levelConfig = {
    LOW: { color: "var(--risk-low)", bg: "var(--risk-low-bg)", icon: ShieldCheck },
    MEDIUM: { color: "var(--risk-medium)", bg: "var(--risk-medium-bg)", icon: AlertCircle },
    HIGH: { color: "var(--risk-high)", bg: "var(--risk-high-bg)", icon: AlertTriangle },
    CRITICAL: { color: "var(--risk-critical)", bg: "var(--risk-critical-bg)", icon: XCircle },
  };

  const config = levelConfig[risk.risk_level] || levelConfig.HIGH;
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-panel"
      style={{
        padding: "20px",
        margin: "24px 0",
        borderLeft: `4px solid ${config.color}`,
        background: `linear-gradient(to right, ${config.bg}, transparent)`,
        position: "relative",
        overflow: "hidden"
      }}
    >
      {risk.risk_level === "CRITICAL" && (
        <motion.div
          animate={{ opacity: [0.1, 0.3, 0.1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          style={{
            position: "absolute",
            inset: 0,
            background: config.color,
            pointerEvents: "none",
            zIndex: 0
          }}
        />
      )}

      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <Icon color={config.color} size={24} />
          <strong style={{ color: config.color, fontSize: "1.1rem", letterSpacing: "0.5px" }}>
            {risk.risk_level} RISK DETECTED
          </strong>
        </div>

        <p style={{ color: "var(--text-main)", fontSize: "0.95rem", lineHeight: 1.5, marginBottom: 8 }}>
          {risk.warning_message}
        </p>
        
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: 20 }}>
          Computed Risk Score: <strong style={{ color: "var(--text-main)" }}>{(risk.risk_score * 100).toFixed(1)}%</strong>
        </p>

        <div style={{ display: "flex", gap: 12 }}>
          <button 
            className="primary-button" 
            onClick={onCancel}
            style={{ background: "var(--border-color)", color: "var(--text-main)", boxShadow: "none" }}
          >
            Cancel Payment
          </button>
          <button 
            className="secondary-button" 
            onClick={onConfirm}
            style={{ color: config.color, borderColor: config.color }}
          >
            Proceed Anyway
          </button>
        </div>
      </div>
    </motion.div>
  );
}
