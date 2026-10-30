require("dotenv").config();
const connectDB = require("./db");
const Account = require("./models/Account");
const RiskScore = require("./models/RiskScore");
const Transaction = require("./models/Transaction");
const InvestigationCase = require("./models/InvestigationCase");
const AuditAction = require("./models/AuditAction");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const accounts = [
  // User / Sender
  {
    account_id: "acc_user_101",
    vpa_address: "me@upi",
    account_holder_name: "You (Demo Sender)",
    account_age_days: 320,
    kyc_status: "FULL_BIOMETRIC_VERIFIED",
    current_balance: 250000,
    avg_tx_amount: 2500,
    tx_frequency_per_day: 4,
    unique_counterparties: 12,
    device_id: "DEV_USER_PHONE_01",
    ip_address: "49.36.128.10",
    risk_status: "ACTIVE",
  },
  // Ring Alpha: Mule Relay Chain
  {
    account_id: "acc_mule_chain_01",
    vpa_address: "mule.relay99@oksbi",
    account_holder_name: "Relay Node Alpha",
    account_age_days: 4,
    kyc_status: "PARTIAL_MINIMUM_OTP",
    current_balance: 120,
    avg_tx_amount: 48500,
    tx_frequency_per_day: 38.5,
    unique_counterparties: 14,
    device_id: "DEV_ANDROID_9921_MULE",
    ip_address: "103.21.144.12",
    risk_status: "FROZEN",
  },
  {
    account_id: "C_VICTIM_881",
    vpa_address: "victim.sharma@paytm",
    account_holder_name: "Aakash Sharma (Victim)",
    account_age_days: 450,
    kyc_status: "FULL_BIOMETRIC_VERIFIED",
    current_balance: 5200,
    avg_tx_amount: 1500,
    tx_frequency_per_day: 2,
    unique_counterparties: 8,
    device_id: "DEV_SAMSUNG_A52",
    ip_address: "157.34.88.19",
    risk_status: "ACTIVE",
  },
  {
    account_id: "C_VICTIM_902",
    vpa_address: "victim.patel@okhdfc",
    account_holder_name: "Pooja Patel (Victim)",
    account_age_days: 510,
    kyc_status: "FULL_BIOMETRIC_VERIFIED",
    current_balance: 8400,
    avg_tx_amount: 2200,
    tx_frequency_per_day: 3,
    unique_counterparties: 11,
    device_id: "DEV_ONEPLUS_9R",
    ip_address: "157.34.90.44",
    risk_status: "ACTIVE",
  },
  {
    account_id: "acc_aggregator_sink_09",
    vpa_address: "offshore.vault@crypto",
    account_holder_name: "Master Aggregator Sink",
    account_age_days: 2,
    kyc_status: "NONE",
    current_balance: 984000,
    avg_tx_amount: 95000,
    tx_frequency_per_day: 80,
    unique_counterparties: 42,
    device_id: "DEV_UNKNOWN_BOT",
    ip_address: "185.220.101.99",
    risk_status: "FROZEN",
  },
  // Ring Beta: Star-Burst Smurfing Fan-Out Hub
  {
    account_id: "acc_star_burst_02",
    vpa_address: "quicksplit.hub@paytm",
    account_holder_name: "QuickSplit Smurfing Hub",
    account_age_days: 12,
    kyc_status: "MINIMUM_KYC",
    current_balance: 450,
    avg_tx_amount: 9800,
    tx_frequency_per_day: 45,
    unique_counterparties: 18,
    device_id: "DEV_EMULATOR_881",
    ip_address: "45.112.55.90",
    risk_status: "FROZEN",
  },
  {
    account_id: "acc_source_syndicate",
    vpa_address: "syndicate.prime@darknet",
    account_holder_name: "Syndicate Cash Pool",
    account_age_days: 18,
    kyc_status: "NONE",
    current_balance: 1500000,
    avg_tx_amount: 100000,
    tx_frequency_per_day: 60,
    unique_counterparties: 30,
    device_id: "DEV_EMULATOR_881",
    ip_address: "45.112.55.90",
    risk_status: "FROZEN",
  },
  {
    account_id: "acc_leaf_node_01",
    vpa_address: "mule.leaf01@axis",
    account_holder_name: "Leaf Mule 01",
    account_age_days: 8,
    kyc_status: "MINIMUM_KYC",
    current_balance: 9900,
    avg_tx_amount: 9900,
    tx_frequency_per_day: 5,
    unique_counterparties: 2,
    device_id: "DEV_EMULATOR_881",
    ip_address: "45.112.55.91",
    risk_status: "FROZEN",
  },
  {
    account_id: "acc_leaf_node_02",
    vpa_address: "mule.leaf02@axis",
    account_holder_name: "Leaf Mule 02",
    account_age_days: 7,
    kyc_status: "MINIMUM_KYC",
    current_balance: 9900,
    avg_tx_amount: 9900,
    tx_frequency_per_day: 4,
    unique_counterparties: 2,
    device_id: "DEV_EMULATOR_881",
    ip_address: "45.112.55.92",
    risk_status: "FROZEN",
  },
  {
    account_id: "acc_leaf_node_03",
    vpa_address: "mule.leaf03@icici",
    account_holder_name: "Leaf Mule 03",
    account_age_days: 9,
    kyc_status: "MINIMUM_KYC",
    current_balance: 9900,
    avg_tx_amount: 9900,
    tx_frequency_per_day: 6,
    unique_counterparties: 2,
    device_id: "DEV_EMULATOR_881",
    ip_address: "45.112.55.93",
    risk_status: "FROZEN",
  },
  // Ring Gamma: Credential Takeover / Crypto Drain
  {
    account_id: "acc_suspicious_device_04",
    vpa_address: "rajesh.kumar77@icici",
    account_holder_name: "Rajesh Kumar (Compromised)",
    account_age_days: 580,
    kyc_status: "FULL_BIOMETRIC_VERIFIED",
    current_balance: 15000,
    avg_tx_amount: 1250,
    tx_frequency_per_day: 1.5,
    unique_counterparties: 22,
    device_id: "DEV_UNKNOWN_NEW_LINUX",
    ip_address: "185.220.101.5",
    risk_status: "UNDER_INVESTIGATION",
  },
  {
    account_id: "acc_crypto_p2p_desk",
    vpa_address: "p2p.exchange@global",
    account_holder_name: "Unregistered P2P Crypto Desk",
    account_age_days: 25,
    kyc_status: "PARTIAL_MINIMUM_OTP",
    current_balance: 450000,
    avg_tx_amount: 85000,
    tx_frequency_per_day: 40,
    unique_counterparties: 85,
    device_id: "DEV_P2P_BOT",
    ip_address: "194.26.29.11",
    risk_status: "UNDER_INVESTIGATION",
  },
  {
    account_id: "acc_overseas_remit",
    vpa_address: "dubai.remit.express@emirates",
    account_holder_name: "Cross-Border Hawala Node",
    account_age_days: 15,
    kyc_status: "NONE",
    current_balance: 620000,
    avg_tx_amount: 90000,
    tx_frequency_per_day: 25,
    unique_counterparties: 40,
    device_id: "DEV_OVERSEAS_GATEWAY",
    ip_address: "94.200.12.8",
    risk_status: "UNDER_INVESTIGATION",
  },
  // Benign Verified Network (Safe)
  {
    account_id: "acc_legit_retail_03",
    vpa_address: "sharma.kirana.store@hdfcbank",
    account_holder_name: "Sharma Kirana Store (Verified Merchant)",
    account_age_days: 820,
    kyc_status: "FULL_BIOMETRIC_VERIFIED",
    current_balance: 45200,
    avg_tx_amount: 340,
    tx_frequency_per_day: 45,
    unique_counterparties: 190,
    device_id: "DEV_POS_TERMINAL_22",
    ip_address: "122.161.44.89",
    risk_status: "ACTIVE",
  },
  {
    account_id: "C_CUSTOMER_01",
    vpa_address: "ananya.verma@okaxis",
    account_holder_name: "Ananya Verma",
    account_age_days: 640,
    kyc_status: "FULL_BIOMETRIC_VERIFIED",
    current_balance: 18000,
    avg_tx_amount: 450,
    tx_frequency_per_day: 3,
    unique_counterparties: 15,
    device_id: "DEV_IPHONE_14_ANANYA",
    ip_address: "122.161.44.10",
    risk_status: "ACTIVE",
  },
  {
    account_id: "C_CUSTOMER_02",
    vpa_address: "rohit.mehta@oksbi",
    account_holder_name: "Rohit Mehta",
    account_age_days: 900,
    kyc_status: "FULL_BIOMETRIC_VERIFIED",
    current_balance: 32000,
    avg_tx_amount: 600,
    tx_frequency_per_day: 2,
    unique_counterparties: 20,
    device_id: "DEV_PIXEL_7_ROHIT",
    ip_address: "122.161.44.12",
    risk_status: "ACTIVE",
  },
  {
    account_id: "C_CUSTOMER_03",
    vpa_address: "deepak.singh@paytm",
    account_holder_name: "Deepak Singh",
    account_age_days: 420,
    kyc_status: "FULL_BIOMETRIC_VERIFIED",
    current_balance: 12500,
    avg_tx_amount: 280,
    tx_frequency_per_day: 4,
    unique_counterparties: 18,
    device_id: "DEV_REDMI_NOTE_11",
    ip_address: "122.161.44.15",
    risk_status: "ACTIVE",
  },
];

const riskScores = [
  {
    account_id: "acc_mule_chain_01",
    vpa_address: "mule.relay99@oksbi",
    risk_score: 0.96,
    risk_level: "CRITICAL",
    is_flagged: true,
    warning_message: "CRITICAL ALERT: Rapid pass-through laundering mule detected. 98% volume washed in < 4 minutes.",
    updated_at: new Date(),
  },
  {
    account_id: "acc_star_burst_02",
    vpa_address: "quicksplit.hub@paytm",
    risk_score: 0.92,
    risk_level: "CRITICAL",
    is_flagged: true,
    warning_message: "CRITICAL ALERT: High-frequency star-burst smurfing hub dispersing illicit syndicate funds.",
    updated_at: new Date(),
  },
  {
    account_id: "acc_suspicious_device_04",
    vpa_address: "rajesh.kumar77@icici",
    risk_score: 0.88,
    risk_level: "HIGH",
    is_flagged: true,
    warning_message: "HIGH ALERT: Credential takeover suspected. Sudden Tor exit node IP & overseas crypto routing.",
    updated_at: new Date(),
  },
  {
    account_id: "acc_aggregator_sink_09",
    vpa_address: "offshore.vault@crypto",
    risk_score: 0.99,
    risk_level: "CRITICAL",
    is_flagged: true,
    warning_message: "CRITICAL ALERT: Known illicit sink endpoint.",
    updated_at: new Date(),
  },
  {
    account_id: "acc_source_syndicate",
    vpa_address: "syndicate.prime@darknet",
    risk_score: 0.98,
    risk_level: "CRITICAL",
    is_flagged: true,
    warning_message: "CRITICAL ALERT: Illicit syndicate origin pool.",
    updated_at: new Date(),
  },
  {
    account_id: "acc_leaf_node_01",
    vpa_address: "mule.leaf01@axis",
    risk_score: 0.87,
    risk_level: "HIGH",
    is_flagged: true,
    warning_message: "HIGH ALERT: Secondary dispersal mule node.",
    updated_at: new Date(),
  },
  {
    account_id: "acc_leaf_node_02",
    vpa_address: "mule.leaf02@axis",
    risk_score: 0.86,
    risk_level: "HIGH",
    is_flagged: true,
    warning_message: "HIGH ALERT: Secondary dispersal mule node.",
    updated_at: new Date(),
  },
  {
    account_id: "acc_leaf_node_03",
    vpa_address: "mule.leaf03@icici",
    risk_score: 0.85,
    risk_level: "HIGH",
    is_flagged: true,
    warning_message: "HIGH ALERT: Secondary dispersal mule node.",
    updated_at: new Date(),
  },
  {
    account_id: "acc_crypto_p2p_desk",
    vpa_address: "p2p.exchange@global",
    risk_score: 0.89,
    risk_level: "HIGH",
    is_flagged: true,
    warning_message: "HIGH ALERT: Unregistered high-velocity crypto desk.",
    updated_at: new Date(),
  },
  {
    account_id: "acc_overseas_remit",
    vpa_address: "dubai.remit.express@emirates",
    risk_score: 0.91,
    risk_level: "CRITICAL",
    is_flagged: true,
    warning_message: "CRITICAL ALERT: Unlicensed cross-border Hawala gateway.",
    updated_at: new Date(),
  },
  {
    account_id: "acc_legit_retail_03",
    vpa_address: "sharma.kirana.store@hdfcbank",
    risk_score: 0.04,
    risk_level: "LOW",
    is_flagged: false,
    warning_message: "Account verified. Low risk merchant.",
    updated_at: new Date(),
  },
  {
    account_id: "acc_user_101",
    vpa_address: "me@upi",
    risk_score: 0.02,
    risk_level: "LOW",
    is_flagged: false,
    warning_message: "Verified sender account.",
    updated_at: new Date(),
  },
  {
    account_id: "C_CUSTOMER_01",
    vpa_address: "ananya.verma@okaxis",
    risk_score: 0.03,
    risk_level: "LOW",
    is_flagged: false,
    warning_message: "Verified retail user.",
    updated_at: new Date(),
  },
  {
    account_id: "C_CUSTOMER_02",
    vpa_address: "rohit.mehta@oksbi",
    risk_score: 0.02,
    risk_level: "LOW",
    is_flagged: false,
    warning_message: "Verified retail user.",
    updated_at: new Date(),
  },
  {
    account_id: "C_CUSTOMER_03",
    vpa_address: "deepak.singh@paytm",
    risk_score: 0.04,
    risk_level: "LOW",
    is_flagged: false,
    warning_message: "Verified retail user.",
    updated_at: new Date(),
  },
  {
    account_id: "C_VICTIM_881",
    vpa_address: "victim.sharma@paytm",
    risk_score: 0.15,
    risk_level: "LOW",
    is_flagged: false,
    warning_message: "Victim account drained in phishing attack.",
    updated_at: new Date(),
  },
  {
    account_id: "C_VICTIM_902",
    vpa_address: "victim.patel@okhdfc",
    risk_score: 0.12,
    risk_level: "LOW",
    is_flagged: false,
    warning_message: "Victim account drained in phishing attack.",
    updated_at: new Date(),
  },
];

const transactions = [
  // Ring Alpha Transactions
  {
    transaction_id: "tx_alpha_01",
    sender_account_id: "C_VICTIM_881",
    receiver_account_id: "acc_mule_chain_01",
    receiver_vpa: "mule.relay99@oksbi",
    amount: 49000,
    status: "SUCCESS",
    type: "PAYMENT",
    timestamp: new Date(Date.now() - 1000 * 60 * 30),
    is_fraud: true,
    is_synthetic_ring: true,
  },
  {
    transaction_id: "tx_alpha_02",
    sender_account_id: "C_VICTIM_902",
    receiver_account_id: "acc_mule_chain_01",
    receiver_vpa: "mule.relay99@oksbi",
    amount: 48000,
    status: "SUCCESS",
    type: "PAYMENT",
    timestamp: new Date(Date.now() - 1000 * 60 * 25),
    is_fraud: true,
    is_synthetic_ring: true,
  },
  {
    transaction_id: "tx_alpha_03",
    sender_account_id: "acc_mule_chain_01",
    receiver_account_id: "acc_aggregator_sink_09",
    receiver_vpa: "offshore.vault@crypto",
    amount: 96800,
    status: "FLAGGED",
    type: "TRANSFER",
    timestamp: new Date(Date.now() - 1000 * 60 * 20),
    is_fraud: true,
    is_synthetic_ring: true,
  },
  // Ring Beta Transactions (Star-Burst)
  {
    transaction_id: "tx_beta_00",
    sender_account_id: "acc_source_syndicate",
    receiver_account_id: "acc_star_burst_02",
    receiver_vpa: "quicksplit.hub@paytm",
    amount: 100000,
    status: "SUCCESS",
    type: "TRANSFER",
    timestamp: new Date(Date.now() - 1000 * 60 * 45),
    is_fraud: true,
    is_synthetic_ring: true,
  },
  {
    transaction_id: "tx_beta_01",
    sender_account_id: "acc_star_burst_02",
    receiver_account_id: "acc_leaf_node_01",
    receiver_vpa: "mule.leaf01@axis",
    amount: 9900,
    status: "BLOCKED",
    type: "PAYMENT",
    timestamp: new Date(Date.now() - 1000 * 60 * 15),
    is_fraud: true,
    is_synthetic_ring: true,
  },
  {
    transaction_id: "tx_beta_02",
    sender_account_id: "acc_star_burst_02",
    receiver_account_id: "acc_leaf_node_02",
    receiver_vpa: "mule.leaf02@axis",
    amount: 9900,
    status: "BLOCKED",
    type: "PAYMENT",
    timestamp: new Date(Date.now() - 1000 * 60 * 14),
    is_fraud: true,
    is_synthetic_ring: true,
  },
  {
    transaction_id: "tx_beta_03",
    sender_account_id: "acc_star_burst_02",
    receiver_account_id: "acc_leaf_node_03",
    receiver_vpa: "mule.leaf03@icici",
    amount: 9900,
    status: "BLOCKED",
    type: "PAYMENT",
    timestamp: new Date(Date.now() - 1000 * 60 * 13),
    is_fraud: true,
    is_synthetic_ring: true,
  },
  // Ring Gamma Transactions (Takeover)
  {
    transaction_id: "tx_gamma_01",
    sender_account_id: "acc_suspicious_device_04",
    receiver_account_id: "acc_crypto_p2p_desk",
    receiver_vpa: "p2p.exchange@global",
    amount: 95000,
    status: "FLAGGED",
    type: "PAYMENT",
    timestamp: new Date(Date.now() - 1000 * 60 * 10),
    is_fraud: true,
    is_synthetic_ring: true,
  },
  {
    transaction_id: "tx_gamma_02",
    sender_account_id: "acc_suspicious_device_04",
    receiver_account_id: "acc_overseas_remit",
    receiver_vpa: "dubai.remit.express@emirates",
    amount: 90000,
    status: "BLOCKED",
    type: "PAYMENT",
    timestamp: new Date(Date.now() - 1000 * 60 * 5),
    is_fraud: true,
    is_synthetic_ring: true,
  },
  // Benign Retail Network
  {
    transaction_id: "tx_retail_01",
    sender_account_id: "C_CUSTOMER_01",
    receiver_account_id: "acc_legit_retail_03",
    receiver_vpa: "sharma.kirana.store@hdfcbank",
    amount: 450,
    status: "SUCCESS",
    type: "PAYMENT",
    timestamp: new Date(Date.now() - 1000 * 60 * 8),
    is_fraud: false,
    is_synthetic_ring: false,
  },
  {
    transaction_id: "tx_retail_02",
    sender_account_id: "C_CUSTOMER_02",
    receiver_account_id: "acc_legit_retail_03",
    receiver_vpa: "sharma.kirana.store@hdfcbank",
    amount: 1200,
    status: "SUCCESS",
    type: "PAYMENT",
    timestamp: new Date(Date.now() - 1000 * 60 * 6),
    is_fraud: false,
    is_synthetic_ring: false,
  },
  {
    transaction_id: "tx_retail_03",
    sender_account_id: "C_CUSTOMER_03",
    receiver_account_id: "acc_legit_retail_03",
    receiver_vpa: "sharma.kirana.store@hdfcbank",
    amount: 320,
    status: "SUCCESS",
    type: "PAYMENT",
    timestamp: new Date(Date.now() - 1000 * 60 * 3),
    is_fraud: false,
    is_synthetic_ring: false,
  },
  {
    transaction_id: "tx_retail_04",
    sender_account_id: "acc_user_101",
    receiver_account_id: "acc_legit_retail_03",
    receiver_vpa: "sharma.kirana.store@hdfcbank",
    amount: 850,
    status: "SUCCESS",
    type: "PAYMENT",
    timestamp: new Date(Date.now() - 1000 * 60 * 1),
    is_fraud: false,
    is_synthetic_ring: false,
  },
];

const initialCases = [
  {
    case_id: "CASE-MULE-8819",
    account_id: "acc_mule_chain_01",
    triggered_by: "LAYER2_GNN_THRESHOLD",
    decision: "auto_block",
    action_taken: "Account frozen, VPA blacklisted, NPCI SAR-Dossier #992 generated",
    report: "CRITICAL INCIDENT DOSSIER: Pass-Through Laundering Mule. High-velocity transfer routing funds through relay node to offshore crypto aggregator within 4 minutes. All counterparty nodes isolated.",
    status: "RESOLVED",
    investigator_findings: {
      risk_score: 0.96,
      risk_level: "CRITICAL",
      autonomous: true,
      timeline: [
        { step: "OBSERVE", description: "Inflow surge: ₹97,000 across 2 victims within 4 mins of account creation.", timestamp: new Date(Date.now() - 1000 * 60 * 28) },
        { step: "ORIENT", description: "Graph 2-hop traversal revealed connection to High-Risk Sink acc_aggregator_sink_09.", timestamp: new Date(Date.now() - 1000 * 60 * 26) },
        { step: "DECIDE", description: "AI Agent converged on confidence score 0.96 (Pass-Through Laundering Mule).", timestamp: new Date(Date.now() - 1000 * 60 * 24) },
        { step: "ACT", description: "Auto-Freeze executed; Outflow transfer blocked; SAR-Dossier filed.", timestamp: new Date(Date.now() - 1000 * 60 * 20) },
      ],
      agent_reasoning: "The target account exhibits high-confidence mule characteristics: newly provisioned account (4 days old), near 100% velocity ratio (funds deposited and immediately evacuated to offshore aggregator), and unverified OTP-only KYC tier.",
      evidence: [
        "Inflow ₹49,000 from C_VICTIM_881 + ₹48,000 from C_VICTIM_902",
        "Immediate egress attempt of ₹96,800 to acc_aggregator_sink_09",
        "Shared device DEV_ANDROID_9921_MULE associated with 8 prior fraud reports",
        "Tor / VPN exit IP 103.21.144.12"
      ],
    },
    created_at: new Date(Date.now() - 1000 * 60 * 20),
  },
  {
    case_id: "CASE-SMURF-4102",
    account_id: "acc_star_burst_02",
    triggered_by: "LAYER2_GNN_THRESHOLD",
    decision: "auto_block",
    action_taken: "Fan-out dispersal blocked, 4 leaf mule VPAs flagged for ring isolation",
    report: "CRITICAL INCIDENT DOSSIER: Smurfing Fan-Out Syndicate. Structured dispersal of ₹100,000 across 10 sub-threshold batches targeting newly registered leaf nodes under single device emulator.",
    status: "RESOLVED",
    investigator_findings: {
      risk_score: 0.92,
      risk_level: "CRITICAL",
      autonomous: true,
      timeline: [
        { step: "OBSERVE", description: "Inflow ₹100,000 from syndicate pool followed by 10 sub-₹10,000 instant transfers.", timestamp: new Date(Date.now() - 1000 * 60 * 40) },
        { step: "ORIENT", description: "Star-burst smurfing topology matched with 94.2% structural similarity.", timestamp: new Date(Date.now() - 1000 * 60 * 38) },
        { step: "DECIDE", description: "Rule and Graph AI consensus: Smurfing evasion attack below ₹10k KYC threshold.", timestamp: new Date(Date.now() - 1000 * 60 * 35) },
        { step: "ACT", description: "Dispersal transfers blocked; Ring isolation protocol enforced across nodes.", timestamp: new Date(Date.now() - 1000 * 60 * 15) },
      ],
      agent_reasoning: "Structured micro-structuring (smurfing) detected. High concentration of incoming capital fragmented into uniform ₹9,900 batches targeting distinct destination VPAs under identical device emulation signature DEV_EMULATOR_881.",
      evidence: [
        "Syndicate source volume ₹100,000",
        "Rapid fan-out ratio 1:10 within 3 minutes",
        "Consistent amount: ₹9,900 (structuring below ₹10,000 threshold)",
        "Emulated Android device environment detected"
      ],
    },
    created_at: new Date(Date.now() - 1000 * 60 * 15),
  },
  {
    case_id: "CASE-TAKEOVER-1092",
    account_id: "acc_suspicious_device_04",
    triggered_by: "LAYER2_GNN_THRESHOLD",
    decision: "escalate",
    action_taken: "Outflow suspended, Step-up biometric challenge sent to user registered phone",
    report: "HIGH THREAT ALERT: Account Takeover & Rapid Crypto Egress. Sudden session transfer to Tor Exit Node IP from unauthorized Linux client. Volume exceeds 70x moving average.",
    status: "UNDER_REVIEW",
    investigator_findings: {
      risk_score: 0.88,
      risk_level: "HIGH",
      autonomous: true,
      timeline: [
        { step: "OBSERVE", description: "Legacy account (580 days, avg ₹1,250) initiates ₹95,000 payment from new Linux device.", timestamp: new Date(Date.now() - 1000 * 60 * 12) },
        { step: "ORIENT", description: "IP 185.220.101.5 identified as Tor Exit Node; Geolocation jump from Mumbai to Frankfurt.", timestamp: new Date(Date.now() - 1000 * 60 * 11) },
        { step: "DECIDE", description: "Account Takeover (ATO) probability 88.4%. High anomaly delta from baseline.", timestamp: new Date(Date.now() - 1000 * 60 * 10) },
        { step: "ACT", description: "Transaction halted; Step-up video KYC / SMS biometric challenge requested.", timestamp: new Date(Date.now() - 1000 * 60 * 5) },
      ],
      agent_reasoning: "Extreme velocity and behavioral variance: transaction amount is 76x higher than 12-month moving average, originating from an unknown Linux user agent via a Tor Exit Node IP address.",
      evidence: [
        "Baseline average ₹1,250 vs anomalous transaction ₹95,000",
        "New device fingerprint DEV_UNKNOWN_NEW_LINUX",
        "Tor exit node IP address 185.220.101.5",
        "Destination: Unregistered P2P Crypto Desk"
      ],
    },
    created_at: new Date(Date.now() - 1000 * 60 * 5),
  },
];

// ─── Innocent look-alikes (the false positives Layer 3 exists to clear) ──────
// Same identities the agent service already knows (agent-service/data/mock_accounts.json).
const decoyAccounts = [
  { account_id: "acc_decoy_payroll_04", vpa_address: "apex.tech.salaries@hdfcbank", account_holder_name: "Apex Tech Payroll", account_age_days: 1100, kyc_status: "FULL_BIOMETRIC_VERIFIED", current_balance: 450000, avg_tx_amount: 55000, tx_frequency_per_day: 20, unique_counterparties: 25, device_id: "DEV_CORP_FINANCE_SERVER", ip_address: "122.161.40.10", risk_status: "ACTIVE" },
  { account_id: "acc_decoy_forward_02", vpa_address: "vikram.roommate@paytm", account_holder_name: "Vikram (Flatmate)", account_age_days: 730, kyc_status: "FULL_BIOMETRIC_VERIFIED", current_balance: 22000, avg_tx_amount: 12000, tx_frequency_per_day: 0.8, unique_counterparties: 5, device_id: "DEV_ONEPLUS_PERSONAL", ip_address: "122.161.99.30", risk_status: "ACTIVE" },
  { account_id: "acc_decoy_family_01", vpa_address: "anita.family@oksbi", account_holder_name: "Anita (Family Account)", account_age_days: 1280, kyc_status: "FULL_BIOMETRIC_VERIFIED", current_balance: 34000, avg_tx_amount: 3200, tx_frequency_per_day: 0.5, unique_counterparties: 4, device_id: "DEV_IPHONE_FAMILY_MOM", ip_address: "49.36.12.80", risk_status: "ACTIVE" },
  { account_id: "acc_decoy_merchant_03", vpa_address: "gupta.sweets.express@icici", account_holder_name: "Gupta Sweets (Merchant Hub)", account_age_days: 950, kyc_status: "FULL_BIOMETRIC_VERIFIED", current_balance: 85000, avg_tx_amount: 480, tx_frequency_per_day: 65, unique_counterparties: 280, device_id: "DEV_BILLING_DESK_GUPTA", ip_address: "103.21.144.5", risk_status: "ACTIVE" },
];
const decoyTransactions = [
  ["tx_decoy_01", "acc_decoy_payroll_04", "C_CUSTOMER_01", "ananya.verma@okaxis", 62000, 50],
  ["tx_decoy_02", "acc_decoy_payroll_04", "C_CUSTOMER_02", "rohit.mehta@oksbi", 58000, 49],
  ["tx_decoy_03", "acc_decoy_payroll_04", "C_CUSTOMER_03", "deepak.singh@paytm", 55000, 48],
  ["tx_decoy_04", "C_CUSTOMER_03", "acc_decoy_forward_02", "vikram.roommate@paytm", 14500, 47],
  ["tx_decoy_05", "acc_decoy_forward_02", "C_CUSTOMER_02", "rohit.mehta@oksbi", 29000, 46],
  ["tx_decoy_06", "C_CUSTOMER_02", "acc_decoy_family_01", "anita.family@oksbi", 4000, 44],
  ["tx_decoy_07", "acc_decoy_family_01", "C_CUSTOMER_01", "ananya.verma@okaxis", 2500, 43],
  ["tx_decoy_08", "C_CUSTOMER_01", "acc_decoy_merchant_03", "gupta.sweets.express@icici", 320, 42],
  ["tx_decoy_09", "C_CUSTOMER_03", "acc_decoy_merchant_03", "gupta.sweets.express@icici", 540, 41],
  ["tx_decoy_10", "acc_user_101", "acc_decoy_merchant_03", "gupta.sweets.express@icici", 780, 40],
].map(([transaction_id, sender_account_id, receiver_account_id, receiver_vpa, amount, minsAgo]) => ({
  transaction_id, sender_account_id, receiver_account_id, receiver_vpa, amount,
  status: "SUCCESS", type: "PAYMENT", timestamp: new Date(Date.now() - 1000 * 60 * minsAgo),
  is_fraud: false, is_synthetic_ring: false,
}));

// ─── ML bridge ────────────────────────────────────────────────────────────────
// Each demo account stands for a REAL account scored by the trained XGBoost + GraphSAGE
// models (ml-service/artifacts/blended_scores.csv). /predict sends the ML service that
// ID, so the dashboard shows genuine model output. Topology and profiles are the demo's.
const ML_MAP = {
  acc_user_101: "C1000036340",
  C_CUSTOMER_01: "acc_merchant_customer_024_10",
  C_CUSTOMER_02: "acc_merchant_customer_021_23",
  C_CUSTOMER_03: "acc_merchant_customer_036_16",
  C_VICTIM_881: "acc_star_victim_042_3",
  C_VICTIM_902: "acc_star_victim_042_4",
  acc_mule_chain_01: "acc_chain_016_4",
  acc_aggregator_sink_09: "acc_fanout_sink_110_0",
  acc_source_syndicate: "acc_fanout_collector_109_0",
  acc_star_burst_02: "acc_star_final_042_0",
  acc_leaf_node_01: "acc_star_mule_042_0",
  acc_leaf_node_02: "acc_star_mule_049_0",
  acc_leaf_node_03: "acc_star_mule_052_0",
  acc_suspicious_device_04: "C1001129353",
  acc_crypto_p2p_desk: "acc_cycle_sink_089_0",
  acc_overseas_remit: "acc_hybrid_final_149_3",
  acc_legit_retail_03: "M1000004668",
  acc_decoy_payroll_04: "acc_employee_075_9",   // real decoy, flagged 0.909
  acc_decoy_forward_02: "acc_forward_094_1",    // real decoy, flagged 0.986
  acc_decoy_family_01: "acc_family_173_1",      // real decoy, warning band 0.748
  acc_decoy_merchant_03: "acc_merchant_006_0",  // real decoy, warning band 0.792
};

const ML_SCORES_CSV = process.env.ML_SCORES_CSV || path.join(__dirname, "..", "ml-service", "artifacts", "blended_scores.csv");
const FLAG = 0.85;
const WARN = 0.7;
const MSG = {
  CRITICAL: "CRITICAL RISK: This receiver UPI ID was flagged in a mule-chain fraud ring. Payments to this account are restricted.",
  HIGH: "WARNING: Recipient account flagged for suspicious transaction velocity.",
  LOW: "Account verified. Safe for standard transfer.",
};

// Streams the ~890K-row CSV once and keeps only the accounts we alias.
async function loadMlScores() {
  if (!fs.existsSync(ML_SCORES_CSV)) return null;
  const wanted = new Set(Object.values(ML_MAP));
  const found = {};
  const rl = readline.createInterface({ input: fs.createReadStream(ML_SCORES_CSV), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    const [id, xgb, sage, risk] = line.split(",");
    if (wanted.has(id)) found[id] = { xgb_score: Number(xgb), sage_score: Number(sage), risk_score: Number(risk) };
    if (Object.keys(found).length === wanted.size) { rl.close(); break; }
  }
  return found;
}

function scoreDoc(account_id, vpa_address, s, ml_account_id) {
  const level = s.risk_score >= FLAG ? "CRITICAL" : s.risk_score >= WARN ? "HIGH" : "LOW";
  return {
    account_id, vpa_address, ml_account_id,
    risk_score: Number(s.risk_score.toFixed(4)), xgb_score: s.xgb_score, sage_score: s.sage_score,
    risk_level: level, is_flagged: s.risk_score >= FLAG, warning_message: MSG[level],
    model_version: "ml-service (blended XGB 0.3 + GraphSAGE 0.7)", updated_at: new Date(),
  };
}

const LOADED_AT = Date.now();

// mode "fresh"   - clean live-demo start: every account ACTIVE, no cases yet, the ring's
//                  history looks like ordinary completed payments. Layer 1 already scores
//                  the ring as risky, so freezing happens live when the agents decide.
// mode "history" - pre-resolved incidents: rings already frozen, three finished cases.
async function seedDatabase({ mode = "fresh", connect = true } = {}) {
  if (connect && mongoose.connection.readyState === 0) await connectDB();

  const shift = Date.now() - LOADED_AT; // keep the seeded timeline "recent" on every reset
  const fresh = mode !== "history";

  const accountDocs = [...accounts, ...decoyAccounts].map((a) => ({
    ...a,
    risk_status: fresh ? "ACTIVE" : a.risk_status || "ACTIVE",
    ml_account_id: ML_MAP[a.account_id],
  }));
  const txnDocs = [...transactions, ...decoyTransactions].map((t) => ({
    ...t,
    timestamp: new Date(t.timestamp.getTime() + shift),
    status: fresh ? "SUCCESS" : t.status,
  }));
  const caseDocs = fresh
    ? []
    : initialCases.map((c) => ({ ...c, created_at: new Date(c.created_at.getTime() + shift) }));
  // Replace the hand-written scores with the real model output wherever the CSV is available.
  const ml = await loadMlScores();
  const vpaOf = Object.fromEntries(accountDocs.map((a) => [a.account_id, a.vpa_address]));
  const handScores = Object.fromEntries(riskScores.map((r) => [r.account_id, r]));
  const scoreDocs = accountDocs.map((a) => {
    const real = ml && ML_MAP[a.account_id] && ml[ML_MAP[a.account_id]];
    if (real) return scoreDoc(a.account_id, vpaOf[a.account_id], real, ML_MAP[a.account_id]);
    const hand = handScores[a.account_id];
    if (hand) return { ...hand, ml_account_id: ML_MAP[a.account_id], updated_at: new Date() };
    return scoreDoc(a.account_id, vpaOf[a.account_id], { risk_score: 0.05, xgb_score: 0, sage_score: 0 }, ML_MAP[a.account_id]);
  });

  await Account.deleteMany({});
  await RiskScore.deleteMany({});
  await Transaction.deleteMany({});
  await InvestigationCase.deleteMany({});
  await AuditAction.deleteMany({});

  await Account.insertMany(accountDocs);
  await RiskScore.insertMany(scoreDocs);
  await Transaction.insertMany(txnDocs);
  if (caseDocs.length) await InvestigationCase.insertMany(caseDocs);

  return { mode: fresh ? "fresh" : "history", scores: ml ? "real ML model output" : "hand-written (blended_scores.csv not found)", accounts: accountDocs.length, risk_scores: scoreDocs.length, transactions: txnDocs.length, cases: caseDocs.length };
}

module.exports = { seedDatabase };

// CLI: `npm run seed` (fresh) or `npm run seed -- history`
if (require.main === module) {
  const mode = process.argv[2] === "history" ? "history" : "fresh";
  seedDatabase({ mode })
    .then(async (r) => {
      console.log(`[seed] Loaded SOC graph network in "${r.mode}" mode`);
      console.log(`[seed] risk scores: ${r.scores}`);
      console.log(`[seed] ${r.accounts} accounts, ${r.risk_scores} risk scores, ${r.transactions} transactions, ${r.cases} cases`);
      console.log("\n[seed] Pre-configured Demo VPAs:");
      console.log("  1. mule.relay99@oksbi           -> CRITICAL (0.96) mule relay, expect auto_block");
      console.log("  2. quicksplit.hub@paytm         -> CRITICAL (0.92) smurfing hub, expect auto_block");
      console.log("  3. rajesh.kumar77@icici         -> HIGH     (0.88) account takeover, expect escalate");
      console.log("  4. sharma.kirana.store@hdfcbank -> LOW      (0.04) verified merchant, expect clear");
      await mongoose.disconnect();
    })
    .catch((err) => {
      console.error("[seed] failed:", err);
      process.exit(1);
    });
}
