import React, { useState, useEffect } from "react";
import Head from "next/head";
import { motion, AnimatePresence } from "framer-motion";
import { checkVpa, sendMoney } from "../lib/api";
import {
  Signal,
  Wifi,
  Battery,
  Shield,
  Eye,
  EyeOff,
  Send,
  QrCode,
  Bell,
  Home,
  History,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronLeft,
  Edit2,
  Lock,
  Building,
  Check,
  FileText,
  Clock,
  ArrowRight,
  ExternalLink,
  ShieldAlert
} from "lucide-react";

const SENDER_ACCOUNT_ID = "acc_user_101";
const SENDER_DEVICE_ID = "DEV_USER_PHONE_01";

const DEMO_PRESETS = [
  {
    id: "mule",
    name: "Mule Relay",
    vpa: "mule.relay99@oksbi",
    amount: "48500",
    riskBadge: "High Risk",
    riskColor: "#ef4444",
    iconBg: "#fee2e2",
    iconColor: "#dc2626",
    symbol: "M",
  },
  {
    id: "smurf",
    name: "Smurfing Hub",
    vpa: "quicksplit.hub@paytm",
    amount: "9900",
    riskBadge: "Medium Risk",
    riskColor: "#f59e0b",
    iconBg: "#fef3c7",
    iconColor: "#d97706",
    symbol: "S",
  },
  {
    id: "ato",
    name: "Account Takeover",
    vpa: "rajesh.kumar77@icici",
    amount: "95000",
    riskBadge: "High Risk",
    riskColor: "#ef4444",
    iconBg: "#fee2e2",
    iconColor: "#dc2626",
    symbol: "A",
  },
  {
    id: "retail",
    name: "Verified Retail",
    vpa: "sharma.kirana.store@hdfcbank",
    amount: "450",
    riskBadge: "Verified",
    riskColor: "#10b981",
    iconBg: "#dcfce7",
    iconColor: "#15803d",
    symbol: "V",
  },
];

const RECENT_CONTACTS = [
  { name: "Rahul", vpa: "rahul.sharma@paytm", initials: "RS", color: "#3b82f6", bg: "#dbeafe" },
  { name: "Ananya", vpa: "ananya.verma@okaxis", initials: "AP", color: "#8b5cf6", bg: "#ede9fe" },
  { name: "Manish", vpa: "manish.k@okhdfc", initials: "MK", color: "#06b6d4", bg: "#cffafe" },
  { name: "Pooja", vpa: "pooja.patel@icici", initials: "PJ", color: "#ec4899", bg: "#fce7f3" },
];

export default function MockUpiApp() {
  // Navigation & Flow State
  const [activeTab, setActiveTab] = useState("home"); // "home" | "history" | "alerts"
  const [screen, setScreen] = useState("home"); // "home" | "keypad" | "warning" | "pin" | "processing" | "success" | "blocked"
  
  // Payment Form Data
  const [recipient, setRecipient] = useState({ name: "Rajesh Kumar", vpa: "rajesh.kumar77@icici" });
  const [amountStr, setAmountStr] = useState("95000");
  const [paymentNote, setPaymentNote] = useState("");
  const [pin, setPin] = useState("");
  
  // Live ML / Defense State
  const [latency, setLatency] = useState(38);
  const [riskData, setRiskData] = useState(null);
  const [lastTxn, setLastTxn] = useState(null);
  const [showBalance, setShowBalance] = useState(true);
  const [processingStep, setProcessingStep] = useState(1);
  
  // History Filter
  const [historyFilter, setHistoryFilter] = useState("All");
  const [alertsFilter, setAlertsFilter] = useState("All");

  // Ledger & Alerts State
  const [transactions, setTransactions] = useState([
    { id: "TXN_001", name: "Sharma Kirana Store", vpa: "sharma.kirana.store@hdfcbank", amount: 450, time: "11:34 PM", date: "Today", status: "Success", symbol: "S", bg: "#ede9fe", color: "#7c3aed" },
    { id: "TXN_002", name: "Rajesh Kumar", vpa: "rajesh.kumar77@icici", amount: 95000, time: "11:22 PM", date: "Today", status: "Blocked", symbol: "R", bg: "#fee2e2", color: "#dc2626" },
    { id: "TXN_003", name: "quicksplit.hub@paytm", vpa: "quicksplit.hub@paytm", amount: 9900, time: "10:55 PM", date: "Today", status: "Flagged", symbol: "Q", bg: "#fef3c7", color: "#d97706" },
    { id: "TXN_004", name: "Amazon", vpa: "amazon.pay@apl", amount: 1299, time: "7:14 PM", date: "Today", status: "Success", symbol: "A", bg: "#dcfce7", color: "#16a34a" },
    { id: "TXN_005", name: "Priya Sharma", vpa: "priya.sharma@okhdfc", amount: 2000, time: "4:32 PM", date: "Today", status: "Success", symbol: "P", bg: "#dbeafe", color: "#2563eb" },
  ]);

  const [alerts, setAlerts] = useState([
    {
      id: "ALT_01",
      title: "Transaction Blocked",
      desc: "₹ 95,000 to rajesh.kumar77@icici blocked due to high fraud risk.",
      caseId: "CASE_001847",
      time: "11:34 PM",
      category: "Blocked",
      icon: "block",
    },
    {
      id: "ALT_02",
      title: "Smurfing Pattern Detected",
      desc: "Unusual transaction pattern detected for quicksplit.hub@paytm",
      time: "10:55 PM",
      category: "Warnings",
      icon: "warn",
    },
    {
      id: "ALT_03",
      title: "Account Verified",
      desc: "sharma.kirana.store@hdfcbank verified as legitimate merchant.",
      time: "9:12 PM",
      category: "Info",
      icon: "info",
    },
    {
      id: "ALT_04",
      title: "Multiple Small Transfers",
      desc: "5 transactions detected in 10 minutes.",
      time: "7:48 PM",
      category: "Warnings",
      icon: "warn",
    },
  ]);

  // Jitter latency slightly to look real-time alive
  useEffect(() => {
    const timer = setInterval(() => {
      setLatency(prev => Math.min(48, Math.max(32, prev + (Math.floor(Math.random() * 5) - 2))));
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  // Handle Keypad Entry
  const handleKeypadPress = (val) => {
    if (val === "del") {
      setAmountStr(prev => prev.length > 1 ? prev.slice(0, -1) : "");
    } else if (val === "00") {
      if (amountStr.length > 0 && amountStr.length < 6) setAmountStr(prev => prev + "00");
    } else {
      if (amountStr === "0") {
        setAmountStr(val);
      } else if (amountStr.length < 7) {
        setAmountStr(prev => prev + val);
      }
    }
  };

  // Select a preset demo scenario
  const handleSelectPreset = (preset) => {
    setRecipient({ name: preset.name, vpa: preset.vpa });
    setAmountStr(preset.amount);
    setScreen("keypad");
  };

  // Continue to Fraud Check
  const handleContinueFromKeypad = async () => {
    const amt = Number(amountStr) || 0;
    if (amt <= 0) return;

    // Trigger Layer 1 Predict check
    try {
      const res = await checkVpa({
        sender_account_id: SENDER_ACCOUNT_ID,
        receiver_vpa: recipient.vpa.trim().toLowerCase(),
        amount: amt,
        device_id: SENDER_DEVICE_ID,
      });
      setRiskData(res);

      if (res && res.is_flagged) {
        setScreen("warning");
      } else {
        setPin("");
        setScreen("pin");
      }
    } catch (e) {
      console.error("Predict check error", e);
      setScreen("pin");
    }
  };

  // Handle PIN Keypad
  const handlePinPress = (val) => {
    if (val === "del") {
      setPin(prev => prev.slice(0, -1));
    } else if (val === "ok") {
      if (pin.length >= 4) executePayment();
    } else {
      if (pin.length < 4) {
        const newPin = pin + val;
        setPin(newPin);
        if (newPin.length === 4) {
          setTimeout(() => executePayment(), 300);
        }
      }
    }
  };

  // Execute payment flow
  const executePayment = async (confirmDespiteWarning = false) => {
    setScreen("processing");
    setProcessingStep(1);

    // Step 1: Initiating
    await new Promise(r => setTimeout(r, 600));
    setProcessingStep(2);

    // Step 2: Verifying beneficiary
    await new Promise(r => setTimeout(r, 600));
    setProcessingStep(3);

    // Step 3: Checking risk
    await new Promise(r => setTimeout(r, 700));
    setProcessingStep(4);

    // Step 4: Bank execution
    const amt = Number(amountStr) || 0;
    try {
      const { status: httpStatus, data } = await sendMoney({
        sender_account_id: SENDER_ACCOUNT_ID,
        receiver_vpa: recipient.vpa.trim().toLowerCase(),
        amount: amt,
        device_id: SENDER_DEVICE_ID,
        confirmed_despite_warning: confirmDespiteWarning || (riskData && riskData.is_flagged),
      });

      setLastTxn(data);
      setProcessingStep(5);
      await new Promise(r => setTimeout(r, 500));

      const isBlockedOrFlagged = data?.txn?.status === "BLOCKED" || data?.txn?.status === "FLAGGED" || (riskData && riskData.is_flagged);

      if (isBlockedOrFlagged) {
        // Add to blocked history & alerts
        const newTx = {
          id: data?.txn?.transaction_id || `TXN_${Date.now()}`,
          name: recipient.name,
          vpa: recipient.vpa,
          amount: amt,
          time: "Just now",
          date: "Today",
          status: "Blocked",
          symbol: recipient.name.charAt(0),
          bg: "#fee2e2",
          color: "#dc2626",
        };
        setTransactions(prev => [newTx, ...prev]);

        setAlerts(prev => [
          {
            id: `ALT_${Date.now()}`,
            title: "Transaction Blocked",
            desc: `₹ ${amt.toLocaleString()} to ${recipient.vpa} blocked due to high fraud risk.`,
            caseId: data?.case?.case_id || "CASE_001847",
            time: "Just now",
            category: "Blocked",
            icon: "block",
          },
          ...prev,
        ]);

        setScreen("blocked");
      } else {
        // Successful transfer
        const newTx = {
          id: data?.txn?.transaction_id || `TXN_${Date.now()}`,
          name: recipient.name,
          vpa: recipient.vpa,
          amount: amt,
          time: "Just now",
          date: "Today",
          status: "Success",
          symbol: recipient.name.charAt(0),
          bg: "#dcfce7",
          color: "#16a34a",
        };
        setTransactions(prev => [newTx, ...prev]);
        setScreen("success");
      }
    } catch (err) {
      console.error("Payment error", err);
      setScreen("keypad");
      alert("Payment Error: " + err.message);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#05070a", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px 10px", fontFamily: "var(--font-sans)" }}>
      <Head>
        <title>FraudGuard AI - Ultra-Realistic Mock UPI Flow</title>
      </Head>

      {/* Main Realistic Phone Frame */}
      <div
        style={{
          width: 390,
          height: 820,
          background: "#ffffff",
          borderRadius: 48,
          boxShadow: "0 0 0 10px #181c24, 0 0 0 12px #2d3748, 0 30px 80px rgba(0,0,0,0.8), 0 0 40px rgba(59, 130, 246, 0.15)",
          position: "relative",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          color: "#0f172a",
        }}
      >
        {/* Dynamic Island / Top Hardware Notch */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: "50%",
            transform: "translateX(-50%)",
            width: 140,
            height: 24,
            background: "#181c24",
            borderBottomLeftRadius: 16,
            borderBottomRightRadius: 16,
            zIndex: 100,
          }}
        />

        {/* Status Bar */}
        <div style={{ padding: "12px 24px 6px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "13px", fontWeight: 600, color: screen === "pin" ? "#ffffff" : "#0f172a", zIndex: 90 }}>
          <span>11:34</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Signal size={14} />
            <Wifi size={14} />
            <Battery size={16} />
          </div>
        </div>

        {/* Global AI Fraud Shield Indicator Header */}
        <div style={{ padding: "0 18px 8px", display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 90 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 20,
              background: "#ecfdf5",
              border: "1px solid #a7f3d0",
              color: "#059669",
              fontSize: "11px",
              fontWeight: 700,
            }}
          >
            <Shield size={12} fill="#059669" color="#059669" />
            AI Fraud Shield Active
          </div>
          <span style={{ fontSize: "11px", fontWeight: 600, color: "#10b981", fontFamily: "monospace" }}>
            Latency: {latency}ms
          </span>
        </div>

        {/* SCREEN ROUTER */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
          <AnimatePresence mode="wait">
            
            {/* ========================================================= */}
            {/* SCREEN 1: HOME SCREEN                                     */}
            {/* ========================================================= */}
            {screen === "home" && activeTab === "home" && (
              <motion.div
                key="home_screen"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{ flex: 1, overflowY: "auto", padding: "8px 18px 80px" }}
              >
                {/* Profile Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 42, height: 42, borderRadius: "50%", background: "#e0e7ff", color: "#3730a3", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "16px" }}>
                      K
                    </div>
                    <div>
                      <p style={{ margin: 0, fontSize: "11px", color: "#64748b" }}>Good Evening,</p>
                      <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#0f172a" }}>Kosada</h3>
                    </div>
                  </div>
                  <div style={{ position: "relative", padding: 8, borderRadius: "50%", background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                    <Bell size={18} color="#475569" />
                    <span style={{ position: "absolute", top: 6, right: 6, width: 8, height: 8, borderRadius: "50%", background: "#ef4444" }} />
                  </div>
                </div>

                {/* Available Balance Card */}
                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 20, padding: 18, marginBottom: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 500 }}>Available Balance</span>
                    <button onClick={() => setShowBalance(!showBalance)} style={{ background: "transparent", border: "none", color: "#64748b", cursor: "pointer" }}>
                      {showBalance ? <Eye size={15} /> : <EyeOff size={15} />}
                    </button>
                  </div>
                  <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 800, color: "#0f172a", letterSpacing: "-0.5px" }}>
                    {showBalance ? "₹ 45,290" : "••••••"}
                  </h1>
                  <p style={{ margin: "4px 0 16px", fontSize: "10px", color: "#94a3b8" }}>
                    Last updated 11:34 PM
                  </p>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      onClick={() => { setRecipient({ name: "Rajesh Kumar", vpa: "rajesh.kumar77@icici" }); setAmountStr("95000"); setScreen("keypad"); }}
                      style={{ flex: 1, background: "#2563eb", color: "#fff", border: "none", borderRadius: 12, padding: "10px", fontWeight: 600, fontSize: "13px", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer" }}
                    >
                      <Send size={14} /> Send Money
                    </button>
                    <button
                      onClick={() => alert("Scan QR Activated")}
                      style={{ flex: 1, background: "#ffffff", color: "#0f172a", border: "1px solid #cbd5e1", borderRadius: 12, padding: "10px", fontWeight: 600, fontSize: "13px", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer" }}
                    >
                      <QrCode size={14} /> Scan QR
                    </button>
                  </div>
                </div>

                {/* Demo Presets (Tap to Try) */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>Demo Presets (Tap to Try)</span>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "#2563eb", cursor: "pointer" }}>See all</span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {DEMO_PRESETS.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => handleSelectPreset(p)}
                        style={{
                          background: "#ffffff",
                          border: "1px solid #e2e8f0",
                          borderRadius: 14,
                          padding: "10px 12px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 34, height: 34, borderRadius: "50%", background: p.iconBg, color: p.iconColor, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "13px" }}>
                            {p.symbol}
                          </div>
                          <div>
                            <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>{p.name}</div>
                            <div style={{ fontSize: "11px", color: "#64748b" }}>{p.vpa}</div>
                          </div>
                        </div>

                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>₹ {Number(p.amount).toLocaleString()}</div>
                          <span style={{ fontSize: "10px", fontWeight: 700, color: p.riskColor }}>{p.riskBadge}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recent Contacts */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>Recent Contacts</span>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "#2563eb", cursor: "pointer" }}>See all</span>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    {RECENT_CONTACTS.map((c, i) => (
                      <div
                        key={i}
                        onClick={() => { setRecipient({ name: c.name, vpa: c.vpa }); setAmountStr("1000"); setScreen("keypad"); }}
                        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, cursor: "pointer" }}
                      >
                        <div style={{ width: 46, height: 46, borderRadius: "50%", background: c.bg, color: c.color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "14px" }}>
                          {c.initials}
                        </div>
                        <span style={{ fontSize: "11px", color: "#475569", fontWeight: 500 }}>{c.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* ========================================================= */}
            {/* SCREEN 2: SEND MONEY (KEYPAD)                             */}
            {/* ========================================================= */}
            {screen === "keypad" && (
              <motion.div
                key="keypad_screen"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0 18px 18px" }}
              >
                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <button onClick={() => setScreen("home")} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#0f172a" }}>
                    <ChevronLeft size={22} />
                  </button>
                  <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, flex: 1, textAlign: "center", marginRight: 22 }}>Send Money</h3>
                </div>

                {/* Recipient Card */}
                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 16, padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#dbeafe", color: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "14px" }}>
                      {recipient.name.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>{recipient.name}</div>
                      <div style={{ fontSize: "11px", color: "#64748b" }}>{recipient.vpa}</div>
                    </div>
                  </div>
                  <Edit2 size={16} color="#64748b" style={{ cursor: "pointer" }} />
                </div>

                {/* Big Amount Display */}
                <div style={{ textAlign: "center", margin: "14px 0" }}>
                  <div style={{ fontSize: "36px", fontWeight: 800, color: "#0f172a", letterSpacing: "-1px" }}>
                    ₹ {Number(amountStr || 0).toLocaleString()}
                    <span style={{ animation: "blink 1s infinite", color: "#2563eb" }}>|</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 6 }}>
                    <span style={{ fontSize: "12px", color: "#94a3b8" }}>Add a note (optional)</span>
                  </div>
                </div>

                {/* Quick Amount Suggestion Pills */}
                <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 16 }}>
                  {["1000", "5000", "10000"].map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setAmountStr(amt)}
                      style={{
                        background: "#ffffff",
                        border: "1px solid #cbd5e1",
                        borderRadius: 20,
                        padding: "5px 14px",
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "#334155",
                        cursor: "pointer",
                      }}
                    >
                      ₹ {Number(amt).toLocaleString()}
                    </button>
                  ))}
                </div>

                {/* Numeric Keypad */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px 10px", marginTop: "auto", marginBottom: 14 }}>
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "del"].map((k) => (
                    <button
                      key={k}
                      onClick={() => handleKeypadPress(k)}
                      style={{
                        background: "#f8fafc",
                        border: "1px solid #eef2f6",
                        borderRadius: 12,
                        fontSize: k === "del" ? "17px" : "19px",
                        fontWeight: 600,
                        color: "#0f172a",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        height: 46,
                        transition: "background 0.1s ease",
                      }}
                      onMouseDown={(e) => (e.currentTarget.style.background = "#e2e8f0")}
                      onMouseUp={(e) => (e.currentTarget.style.background = "#f8fafc")}
                    >
                      {k === "del" ? "⌫" : k}
                    </button>
                  ))}
                </div>

                {/* Continue Button */}
                <button
                  onClick={handleContinueFromKeypad}
                  style={{
                    background: "#2563eb",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: 14,
                    padding: "14px",
                    fontSize: "15px",
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: "0 4px 12px rgba(37, 99, 235, 0.3)",
                  }}
                >
                  Continue
                </button>
              </motion.div>
            )}

            {/* ========================================================= */}
            {/* SCREEN 3: FRAUD WARNING                                   */}
            {/* ========================================================= */}
            {screen === "warning" && (
              <motion.div
                key="warning_screen"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0 18px 18px", overflowY: "auto" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <button onClick={() => setScreen("keypad")} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#0f172a" }}>
                    <ChevronLeft size={22} />
                  </button>
                  <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, flex: 1, textAlign: "center", marginRight: 22 }}>Send Money</h3>
                </div>

                {/* Recipient Header Card */}
                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 16, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#dbeafe", color: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "13px" }}>
                      {recipient.name.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>{recipient.name}</div>
                      <div style={{ fontSize: "11px", color: "#64748b" }}>{recipient.vpa}</div>
                    </div>
                  </div>
                  <Edit2 size={15} color="#64748b" />
                </div>

                {/* Red High Risk Alert Header */}
                <div style={{ background: "#fef2f2", border: "1px solid #fee2e2", borderRadius: 14, padding: "14px", marginBottom: 14, display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <AlertTriangle size={20} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <h4 style={{ margin: "0 0 2px", fontSize: "13px", fontWeight: 700, color: "#991b1b" }}>High Fraud Risk Detected</h4>
                    <p style={{ margin: 0, fontSize: "11px", color: "#b91c1c", lineHeight: 1.4 }}>
                      This account shows suspicious activity patterns based on our AI analysis.
                    </p>
                  </div>
                </div>

                {/* Risk Score Meter Visualizer */}
                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px", marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b" }}>Risk Score</span>
                    <span style={{ fontSize: "13px", fontWeight: 800, color: "#dc2626" }}>96%</span>
                  </div>
                  {/* Red Audio Bar Visualizer */}
                  <div style={{ display: "flex", gap: 3, height: 16, alignItems: "center" }}>
                    {[...Array(18)].map((_, i) => (
                      <div
                        key={i}
                        style={{
                          flex: 1,
                          height: i < 16 ? "100%" : "30%",
                          background: i < 16 ? "linear-gradient(to top, #ef4444, #dc2626)" : "#e2e8f0",
                          borderRadius: 2,
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* Identified Pattern Card */}
                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "12px", marginBottom: 12 }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: 6 }}>Identified Pattern</span>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <div style={{ padding: 6, borderRadius: 8, background: "#fee2e2", color: "#dc2626" }}>
                      <ShieldAlert size={16} />
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a" }}>Rapid pass-through mule</div>
                      <div style={{ fontSize: "10px", color: "#64748b", lineHeight: 1.3 }}>
                        This account is part of a high-velocity fund movement network.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Recommendation */}
                <div style={{ marginBottom: 16, display: "flex", gap: 6, alignItems: "center" }}>
                  <AlertTriangle size={14} color="#dc2626" />
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "#b91c1c" }}>Recommendation: Do not proceed with this payment.</span>
                </div>

                {/* Action Buttons */}
                <div style={{ display: "flex", gap: 10, marginTop: "auto" }}>
                  <button
                    onClick={() => setScreen("home")}
                    style={{ flex: 1, background: "#ffffff", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 12, padding: "12px", fontWeight: 700, fontSize: "12px", cursor: "pointer" }}
                  >
                    Cancel Payment
                  </button>
                  <button
                    onClick={() => { setPin(""); setScreen("pin"); }}
                    style={{ flex: 1, background: "#dc2626", color: "#ffffff", border: "none", borderRadius: 12, padding: "12px", fontWeight: 700, fontSize: "12px", cursor: "pointer" }}
                  >
                    Proceed Anyway <br /><span style={{ fontSize: "9px", opacity: 0.9 }}>(I know this person)</span>
                  </button>
                </div>
              </motion.div>
            )}

            {/* ========================================================= */}
            {/* SCREEN 4: UPI PIN ENTRY                                   */}
            {/* ========================================================= */}
            {screen === "pin" && (
              <motion.div
                key="pin_screen"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "#0c1017",
                  color: "#ffffff",
                  display: "flex",
                  flexDirection: "column",
                  padding: "44px 20px 24px",
                  zIndex: 80,
                }}
              >
                {/* Back Button */}
                <button onClick={() => setScreen(riskData?.is_flagged ? "warning" : "keypad")} style={{ background: "transparent", border: "none", color: "#fff", cursor: "pointer", alignSelf: "flex-start", marginBottom: 16 }}>
                  <ChevronLeft size={24} />
                </button>

                {/* Padlock Icon & Context */}
                <div style={{ textAlign: "center", marginBottom: 20 }}>
                  <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#1e293b", color: "#38bdf8", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                    <Lock size={22} />
                  </div>
                  <h2 style={{ margin: "0 0 4px", fontSize: "20px", fontWeight: 700 }}>
                    Paying ₹ {Number(amountStr || 0).toLocaleString()}
                  </h2>
                  <p style={{ margin: 0, fontSize: "12px", color: "#94a3b8" }}>
                    to {recipient.name} <br />
                    <span style={{ fontSize: "11px", color: "#64748b" }}>{recipient.vpa}</span>
                  </p>
                </div>

                {/* Enter UPI PIN Prompt */}
                <div style={{ textAlign: "center", marginBottom: 24 }}>
                  <p style={{ fontSize: "12px", color: "#cbd5e1", marginBottom: 12 }}>Enter your UPI PIN</p>
                  <div style={{ display: "flex", justifyContent: "center", gap: 14 }}>
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          background: pin.length > i ? "#ffffff" : "transparent",
                          border: "2px solid #64748b",
                          transition: "all 0.15s ease",
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* Dark PIN Keypad */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px 14px", alignItems: "center", justifyItems: "center", marginTop: "auto", paddingBottom: 16 }}>
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((k, idx) => (
                    k === "" ? <div key={idx} /> : (
                      <button
                        key={k}
                        onClick={() => handlePinPress(k)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#ffffff",
                          fontSize: k === "del" ? "18px" : "22px",
                          fontWeight: 500,
                          width: 58,
                          height: 58,
                          borderRadius: "50%",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          transition: "background 0.1s ease",
                        }}
                        onMouseDown={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
                        onMouseUp={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        {k === "del" ? "⌫" : k}
                      </button>
                    )
                  ))}
                </div>
              </motion.div>
            )}

            {/* ========================================================= */}
            {/* SCREEN 5: PROCESSING PAYMENT                              */}
            {/* ========================================================= */}
            {screen === "processing" && (
              <motion.div
                key="processing_screen"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 24px", textAlign: "center" }}
              >
                {/* Bank Building Icon with Halo */}
                <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#dbeafe", color: "#1d4ed8", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
                  <Building size={32} />
                </div>

                <h2 style={{ margin: "0 0 6px", fontSize: "18px", fontWeight: 700 }}>Processing Payment</h2>
                <p style={{ margin: "0 0 28px", fontSize: "12px", color: "#64748b" }}>Please do not close the app</p>

                {/* Live Progress Checklist */}
                <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 14, textAlign: "left" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <CheckCircle size={18} color={processingStep >= 1 ? "#10b981" : "#cbd5e1"} />
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#0f172a" }}>Initiating transaction</div>
                      <div style={{ fontSize: "10px", color: "#10b981" }}>Completed</div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <CheckCircle size={18} color={processingStep >= 2 ? "#10b981" : "#cbd5e1"} />
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#0f172a" }}>Verifying beneficiary</div>
                      <div style={{ fontSize: "10px", color: "#10b981" }}>Completed</div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <CheckCircle size={18} color={processingStep >= 3 ? "#10b981" : "#cbd5e1"} />
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#0f172a" }}>Checking account risk</div>
                      <div style={{ fontSize: "10px", color: riskData?.is_flagged ? "#ef4444" : "#10b981" }}>
                        {riskData?.is_flagged ? "High detected" : "Completed"}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 18, height: 18, borderRadius: "50%", border: "2px solid #2563eb", borderTopColor: "transparent", animation: "spin 1s linear infinite" }} />
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#0f172a" }}>Processing with bank</div>
                      <div style={{ fontSize: "10px", color: "#2563eb" }}>In progress...</div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 12, opacity: 0.5 }}>
                    <div style={{ width: 18, height: 18, borderRadius: "50%", border: "2px solid #cbd5e1" }} />
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#0f172a" }}>Finalizing transaction</div>
                      <div style={{ fontSize: "10px", color: "#64748b" }}>Waiting...</div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ========================================================= */}
            {/* SCREEN 6: PAYMENT SUCCESSFUL                              */}
            {/* ========================================================= */}
            {screen === "success" && (
              <motion.div
                key="success_screen"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 24px", textAlign: "center" }}
              >
                {/* Green Checkmark */}
                <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#dcfce7", color: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                  <Check size={36} strokeWidth={3} />
                </div>

                <h2 style={{ margin: "0 0 4px", fontSize: "18px", fontWeight: 700, color: "#0f172a" }}>Payment Successful</h2>
                <p style={{ margin: "0 0 24px", fontSize: "12px", color: "#64748b" }}>Your payment has been sent</p>

                {/* Receipt Card */}
                <div style={{ width: "100%", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 16, padding: "16px", textAlign: "left", marginBottom: 28 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ fontSize: "12px", color: "#64748b" }}>Amount</span>
                    <span style={{ fontSize: "14px", fontWeight: 800, color: "#0f172a" }}>₹ {Number(amountStr || 450).toLocaleString()}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ fontSize: "12px", color: "#64748b" }}>To</span>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a" }}>{recipient.name}</div>
                      <div style={{ fontSize: "10px", color: "#64748b" }}>{recipient.vpa}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ fontSize: "12px", color: "#64748b" }}>Txn ID</span>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "#0f172a", fontFamily: "monospace" }}>TXN_20260911_984721</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "12px", color: "#64748b" }}>Date & Time</span>
                    <span style={{ fontSize: "11px", color: "#0f172a" }}>11 Sep 2026, 11:34 PM</span>
                  </div>
                </div>

                {/* Bottom Buttons */}
                <div style={{ width: "100%", display: "flex", gap: 10 }}>
                  <button
                    onClick={() => alert("Receipt Dossier Downloaded")}
                    style={{ flex: 1, background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 12, padding: "12px", fontSize: "12px", fontWeight: 600, color: "#0f172a", cursor: "pointer" }}
                  >
                    View Details
                  </button>
                  <button
                    onClick={() => setScreen("home")}
                    style={{ flex: 1, background: "#2563eb", border: "none", borderRadius: 12, padding: "12px", fontSize: "12px", fontWeight: 700, color: "#ffffff", cursor: "pointer" }}
                  >
                    Back to Home
                  </button>
                </div>
              </motion.div>
            )}

            {/* ========================================================= */}
            {/* SCREEN 7: TRANSACTION STOPPED / BLOCKED RECEIPT           */}
            {/* ========================================================= */}
            {screen === "blocked" && (
              <motion.div
                key="blocked_screen"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 20px", textAlign: "center" }}
              >
                {/* Red Shield Warning */}
                <div style={{ width: 68, height: 68, borderRadius: "50%", background: "#fee2e2", color: "#dc2626", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                  <ShieldAlert size={34} />
                </div>

                <h2 style={{ margin: "0 0 2px", fontSize: "17px", fontWeight: 800, color: "#dc2626" }}>Transaction Stopped</h2>
                <p style={{ margin: "0 0 18px", fontSize: "11px", color: "#64748b" }}>AI Fraud Engine Intervention</p>

                {/* Blocked Dossier Card */}
                <div style={{ width: "100%", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px", textAlign: "left", marginBottom: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>Amount</span>
                    <span style={{ fontSize: "13px", fontWeight: 800, color: "#0f172a" }}>₹ {Number(amountStr || 95000).toLocaleString()}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>To</span>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a" }}>{recipient.name}</div>
                      <div style={{ fontSize: "10px", color: "#64748b" }}>{recipient.vpa}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>Risk Score</span>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "#dc2626" }}>96% (High Risk)</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>Reason</span>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "#0f172a" }}>Rapid Pass-Through Mule Network</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>Case ID</span>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "#0f172a", fontFamily: "monospace" }}>CASE_001847</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>Time</span>
                    <span style={{ fontSize: "11px", color: "#0f172a" }}>11 Sep 2026, 11:34 PM</span>
                  </div>
                </div>

                {/* Blocked Action Buttons */}
                <div style={{ width: "100%", display: "flex", gap: 8, marginBottom: 8 }}>
                  <button
                    onClick={() => alert("Evidence: Inflow surge ₹97k across 2 victims within 4 mins of creation. Shared device DEV_ANDROID_9921_MULE.")}
                    style={{ flex: 1, background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px", fontSize: "11px", fontWeight: 600, color: "#0f172a", cursor: "pointer" }}
                  >
                    View Evidence
                  </button>
                  <button
                    onClick={() => alert("SAR Dossier Generated for Case CASE_001847")}
                    style={{ flex: 1, background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px", fontSize: "11px", fontWeight: 600, color: "#0f172a", cursor: "pointer" }}
                  >
                    Generate Report
                  </button>
                </div>

                <button
                  onClick={() => setScreen("home")}
                  style={{ width: "100%", background: "#2563eb", border: "none", borderRadius: 10, padding: "12px", fontSize: "13px", fontWeight: 700, color: "#ffffff", cursor: "pointer" }}
                >
                  Return Home
                </button>
              </motion.div>
            )}

            {/* ========================================================= */}
            {/* SCREEN 8: TRANSACTION HISTORY                             */}
            {/* ========================================================= */}
            {activeTab === "history" && screen === "home" && (
              <motion.div
                key="history_screen"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{ flex: 1, overflowY: "auto", padding: "0 18px 80px" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <button onClick={() => setActiveTab("home")} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#0f172a" }}>
                    <ChevronLeft size={20} />
                  </button>
                  <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, flex: 1, textAlign: "center", marginRight: 20 }}>Transaction History</h3>
                </div>

                {/* Filter Tabs */}
                <div style={{ display: "flex", gap: 6, marginBottom: 16, overflowX: "auto" }}>
                  {["All", "Success", "Blocked", "Flagged"].map((f) => (
                    <button
                      key={f}
                      onClick={() => setHistoryFilter(f)}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 20,
                        border: "none",
                        background: historyFilter === f ? "#2563eb" : "#f1f5f9",
                        color: historyFilter === f ? "#ffffff" : "#64748b",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {f}
                    </button>
                  ))}
                </div>

                <div style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", marginBottom: 10 }}>Today</div>

                {/* Transactions List */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {transactions
                    .filter((t) => historyFilter === "All" || t.status.toLowerCase() === historyFilter.toLowerCase())
                    .map((t) => (
                      <div
                        key={t.id}
                        style={{
                          background: "#ffffff",
                          border: "1px solid #f1f5f9",
                          borderRadius: 14,
                          padding: "12px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 38, height: 38, borderRadius: "50%", background: t.bg, color: t.color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "14px" }}>
                            {t.symbol}
                          </div>
                          <div>
                            <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>{t.name}</div>
                            <div style={{ fontSize: "11px", color: "#64748b" }}>
                              {t.time} • <span style={{ color: t.status === "Success" ? "#10b981" : t.status === "Blocked" ? "#ef4444" : "#f59e0b", fontWeight: 600 }}>{t.status}</span>
                            </div>
                          </div>
                        </div>

                        <div style={{ fontSize: "14px", fontWeight: 800, color: "#0f172a" }}>
                          ₹ {t.amount.toLocaleString()}
                        </div>
                      </div>
                    ))}
                </div>
              </motion.div>
            )}

            {/* ========================================================= */}
            {/* SCREEN 9: FRAUD ALERTS NOTIFICATIONS                      */}
            {/* ========================================================= */}
            {activeTab === "alerts" && screen === "home" && (
              <motion.div
                key="alerts_screen"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{ flex: 1, overflowY: "auto", padding: "0 18px 80px" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <button onClick={() => setActiveTab("home")} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#0f172a" }}>
                    <ChevronLeft size={20} />
                  </button>
                  <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, flex: 1, textAlign: "center", marginRight: 20 }}>Fraud Alerts</h3>
                </div>

                {/* Filter Tabs */}
                <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                  {["All", "Blocked", "Warnings", "Info"].map((f) => (
                    <button
                      key={f}
                      onClick={() => setAlertsFilter(f)}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 20,
                        border: "none",
                        background: alertsFilter === f ? "#2563eb" : "#f1f5f9",
                        color: alertsFilter === f ? "#ffffff" : "#64748b",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {f}
                    </button>
                  ))}
                </div>

                <div style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", marginBottom: 10 }}>Today</div>

                {/* Alerts List */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {alerts
                    .filter((a) => alertsFilter === "All" || a.category.toLowerCase() === alertsFilter.toLowerCase())
                    .map((a) => (
                      <div
                        key={a.id}
                        style={{
                          background: "#ffffff",
                          border: "1px solid #f1f5f9",
                          borderRadius: 14,
                          padding: "12px",
                          display: "flex",
                          gap: 10,
                          alignItems: "flex-start",
                        }}
                      >
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            background: a.icon === "block" ? "#fee2e2" : a.icon === "warn" ? "#fef3c7" : "#dcfce7",
                            color: a.icon === "block" ? "#dc2626" : a.icon === "warn" ? "#d97706" : "#16a34a",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          {a.icon === "block" ? <ShieldAlert size={16} /> : a.icon === "warn" ? <AlertTriangle size={16} /> : <CheckCircle size={16} />}
                        </div>

                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>{a.title}</div>
                            <span style={{ fontSize: "10px", color: "#94a3b8" }}>{a.time}</span>
                          </div>
                          <p style={{ margin: "3px 0 0", fontSize: "11px", color: "#64748b", lineHeight: 1.3 }}>{a.desc}</p>
                          {a.caseId && (
                            <div style={{ fontSize: "10px", fontWeight: 600, color: "#2563eb", marginTop: 4 }}>
                              Case ID: {a.caseId}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>

        {/* ========================================================= */}
        {/* BOTTOM NAVIGATION BAR (Home, History, Alerts)             */}
        {/* ========================================================= */}
        {screen === "home" && (
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 64,
              background: "#ffffff",
              borderTop: "1px solid #f1f5f9",
              display: "flex",
              justifyContent: "space-around",
              alignItems: "center",
              paddingBottom: 10,
              zIndex: 70,
            }}
          >
            <button
              onClick={() => setActiveTab("home")}
              style={{ background: "transparent", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, cursor: "pointer", color: activeTab === "home" ? "#2563eb" : "#94a3b8" }}
            >
              <Home size={18} />
              <span style={{ fontSize: "10px", fontWeight: 600 }}>Home</span>
            </button>

            <button
              onClick={() => setActiveTab("history")}
              style={{ background: "transparent", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, cursor: "pointer", color: activeTab === "history" ? "#2563eb" : "#94a3b8" }}
            >
              <History size={18} />
              <span style={{ fontSize: "10px", fontWeight: 600 }}>History</span>
            </button>

            <button
              onClick={() => setActiveTab("alerts")}
              style={{ background: "transparent", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, cursor: "pointer", color: activeTab === "alerts" ? "#2563eb" : "#94a3b8", position: "relative" }}
            >
              <Bell size={18} />
              <span style={{ fontSize: "10px", fontWeight: 600 }}>Alerts</span>
              <span style={{ position: "absolute", top: -2, right: 10, width: 6, height: 6, borderRadius: "50%", background: "#ef4444" }} />
            </button>
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      ` }} />
    </div>
  );
}
