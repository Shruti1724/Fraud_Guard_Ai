/**
 * FraudGuard AI — Shared TypeScript Contracts
 * Used by Member A (Frontend / Node.js Backend)
 */

// --- Layer 1: /predict ---

export interface PredictRequest {
  sender_account_id: string;
  receiver_vpa: string;
  amount: number;
  device_id?: string;
}

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface PredictResponse {
  receiver_vpa: string;
  receiver_account_id: string;
  risk_score: number; // 0.0 to 1.0
  risk_level: RiskLevel;
  is_flagged: boolean;
  warning_message: string;
  trigger_investigation: boolean;
}

// --- Layer 2: /investigate ---

export type InvestigationDecision = "auto_block" | "escalate" | "clear";

export interface InvestigateRequest {
  account_id: string;
  account_data?: Record<string, any>;
}

export interface InvestigateResponse {
  account_id: string;
  decision: InvestigationDecision;
  action_taken: string;
  report: string;
}

// --- Database Document Interfaces ---

export interface AccountDoc {
  account_id: string;
  vpa_address: string;
  account_holder_name: string;
  account_age_days: number;
  kyc_status: string;
  current_balance: number;
  avg_tx_amount?: number;
  tx_frequency_per_day?: number;
  unique_counterparties?: number;
  device_id: string;
  ip_address?: string;
  risk_status: "ACTIVE" | "FROZEN" | "UNDER_INVESTIGATION";
  created_at: Date;
}

export interface TransactionDoc {
  transaction_id: string;
  step?: number;
  type: string;
  amount: number;
  sender_account_id: string;
  sender_vpa?: string;
  receiver_account_id: string;
  receiver_vpa?: string;
  timestamp: Date;
  status: "SUCCESS" | "BLOCKED" | "FLAGGED";
  device_id?: string;
  is_fraud?: boolean;
  is_synthetic_ring?: boolean;
  ring_id?: string;
}

export interface RiskScoreDoc {
  account_id: string;
  vpa_address: string;
  risk_score: number;
  risk_level: RiskLevel;
  is_flagged: boolean;
  warning_message: string;
  model_version: string;
  topological_flags?: string[];
  updated_at: Date;
}

export interface InvestigationCaseDoc {
  case_id: string;
  account_id: string;
  triggered_by: string;
  investigator_findings: Record<string, any>;
  decision: InvestigationDecision;
  action_taken: string;
  report: string;
  status: "RESOLVED" | "UNDER_REVIEW";
  created_at: Date;
}

export interface AuditActionDoc {
  action_id: string;
  case_id: string;
  account_id: string;
  action_type: string;
  target_system: string;
  status: "EXECUTED" | "SIMULATED" | "FAILED";
  details?: Record<string, any>;
  timestamp: Date;
}
