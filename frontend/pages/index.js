import React, { useState, useEffect, useRef } from "react";
import Head from "next/head";
import { motion, AnimatePresence } from "framer-motion";
import { io } from "socket.io-client";
import { API_URL, checkVpa, sendMoney, getAccount, getTransactions } from "../lib/api";
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
  const [screen, setScreen] = useState("home"); // "home" | "send" | "keypad" | "warning" | "pin" | "processing" | "success" | "blocked"

  // Payment Form Data
  const [recipient, setRecipient] = useState({ name: "", vpa: "" });
  const [upiInputStr, setUpiInputStr] = useState("");
  const [upiError, setUpiError] = useState("");
  const [amountStr, setAmountStr] = useState("500");
  const [paymentNote, setPaymentNote] = useState("");
  const [pin, setPin] = useState("");
  
  // Live ML / Defense State
  const [latency, setLatency] = useState(null); // real Layer-1 round trip, ms
  const [outcome, setOutcome] = useState(null); // live verdict for a held payment
  const [payError, setPayError] = useState("");
  const [showEvidence, setShowEvidence] = useState(false);
  const [clockStr, setClockStr] = useState("");
  const txnRef = useRef(null);
  const [riskData, setRiskData] = useState(null);
  const [lastTxn, setLastTxn] = useState(null);
  const [showBalance, setShowBalance] = useState(true);
  const [processingStep, setProcessingStep] = useState(1);
  const [accountInfo, setAccountInfo] = useState(null);

  // History Filter
  const [historyFilter, setHistoryFilter] = useState("All");
  const [alertsFilter, setAlertsFilter] = useState("All");

  // Ledger & Alerts State
  const [transactions, setTransactions] = useState([]);

  const [alerts, setAlerts] = useState([]);

  const loadAccountData = async () => {
    try {
      const acc = await getAccount(SENDER_ACCOUNT_ID);
      if (acc && acc.account_id) {
        setAccountInfo(acc);
      }
      const txs = await getTransactions(SENDER_ACCOUNT_ID, 20);
      if (Array.isArray(txs) && txs.length > 0) {
        setTransactions(
          txs.map((t) => {
            const isSender = t.sender_account_id === SENDER_ACCOUNT_ID;
            const displayVpa = isSender ? (t.receiver_vpa || t.receiver_account_id) : (t.sender_vpa || t.sender_account_id);
            const rawName = (displayVpa || "Unknown").split("@")[0].replace(/[._]/g, " ");
            const displayName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
            const dateObj = t.timestamp ? new Date(t.timestamp) : null;
            const timeStr = dateObj && !isNaN(dateObj) ? dateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Recent";
            const isSuccess = t.status === "SUCCESS";
            const isBlocked = t.status === "BLOCKED";
            return {
              id: t.transaction_id || t._id,
              name: displayName,
              vpa: displayVpa,
              amount: t.amount,
              time: timeStr,
              date: "Today",
              status: isSuccess ? "Success" : isBlocked ? "Blocked" : "Flagged",
              symbol: displayName.charAt(0).toUpperCase(),
              bg: isSuccess ? "#dcfce7" : isBlocked ? "#fee2e2" : "#fef3c7",
              color: isSuccess ? "#16a34a" : isBlocked ? "#dc2626" : "#d97706",
            };
          })
        );
      }
    } catch (e) {
      console.warn("loadAccountData error:", e.message);
    }
  };

  useEffect(() => {
    loadAccountData();
  }, []);

  // Real clock for the status bar
  useEffect(() => {
    const tick = () => setClockStr(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }));
    tick();
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, []);

  // A flagged payment is held while the agents investigate. Their verdict arrives here.
  useEffect(() => {
    const socket = io(API_URL, { transports: ["websocket", "polling"] });

    socket.on("investigation:completed", (p) => {
      const mine = txnRef.current;
      if (!mine || !p.case || p.case.account_id !== mine.receiverId) return;
      const f = p.case.findings || {};
      setOutcome((prev) => ({
        ...(prev || {}),
        caseId: p.case.case_id,
        topology: f.topology,
        rationale: f.rationale,
        evidence: f.risk_factors && f.risk_factors.length ? f.risk_factors : f.evidence,
        decisionMs: p.duration_ms,
        decision: p.decision,
      }));
    });

    socket.on("transaction:updated", ({ txn }) => {
      const mine = txnRef.current;
      if (!mine || !txn || txn.transaction_id !== mine.id) return;
      const state = txn.status === "BLOCKED" ? "blocked" : txn.status === "SUCCESS" ? "released" : "escalated";
      setOutcome((prev) => ({ ...(prev || {}), state }));
      const when = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setAlerts((prev) => [
        {
          id: `ALT_${Date.now()}`,
          title: state === "blocked" ? "Transaction Blocked" : state === "released" ? "Payment Released" : "Payment Held for Review",
          desc: `₹ ${Number(txn.amount).toLocaleString()} to ${txn.receiver_vpa || txn.receiver_account_id} ${state === "blocked" ? "was blocked after investigation." : state === "released" ? "was cleared after review and sent." : "is awaiting an analyst."}`,
          caseId: txn.case_id,
          time: when,
          category: state === "blocked" ? "Blocked" : "Warnings",
          icon: state === "blocked" ? "block" : "warn",
        },
        ...prev,
      ]);
      loadAccountData();
    });

    return () => socket.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setUpiInputStr(preset.vpa);
    setUpiError("");
    setRecipient({ name: preset.name, vpa: preset.vpa });
    setAmountStr(preset.amount);
    setScreen("keypad");
  };

  // Continue from UPI entry — validates the VPA format, builds recipient name, moves to keypad
  const handleUpiContinue = () => {
    const vpa = upiInputStr.trim().toLowerCase();
    if (!vpa) { setUpiError("Please enter a UPI ID"); return; }
    // Loose validation: must contain @
    if (!vpa.includes("@")) { setUpiError("Invalid UPI ID — must contain '@' (e.g. name@bank)"); return; }
    // Derive a display name from the part before @
    const rawHandle = vpa.split("@")[0].replace(/[._-]/g, " ");
    const displayName = rawHandle
      .split(" ")
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    setRecipient({ name: displayName, vpa });
    setAmountStr("500");
    setUpiError("");
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
      setLatency(res && res.meta ? res.meta.total_ms || res.meta.latency_ms : null);

      if (res && (res.is_flagged || res.risk_level === "HIGH")) {
        setScreen("warning");
      } else {
        setPin("");
        setScreen("pin");
      }
    } catch (e) {
      console.error("Predict check error", e);
      setLatency(null);
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
    setPayError("");
    setOutcome(null);
    setShowEvidence(false);
    txnRef.current = null;

    await new Promise((r) => setTimeout(r, 600));
    setProcessingStep(2);
    await new Promise((r) => setTimeout(r, 600));
    setProcessingStep(3);
    await new Promise((r) => setTimeout(r, 700));
    setProcessingStep(4);

    const amt = Number(amountStr) || 0;
    const addHistory = (status, bg, color) =>
      setTransactions((prev) => [
        { id: `TXN_${Date.now()}`, name: recipient.name, vpa: recipient.vpa, amount: amt, time: "Just now", date: "Today", status, symbol: recipient.name.charAt(0), bg, color },
        ...prev,
      ]);

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
      await new Promise((r) => setTimeout(r, 500));

      // Rejected before any money moved: tell the user why, stay on the keypad.
      if (httpStatus === 422 || httpStatus === 404) {
        setPayError(data?.message || "This payment could not be processed.");
        setScreen("keypad");
        return;
      }
      // The recipient's risk changed since the check: show the warning again.
      if (httpStatus === 409) {
        setRiskData(data.risk || riskData);
        setScreen("warning");
        return;
      }
      // Hard block: sender or receiver was frozen by an earlier investigation.
      if (httpStatus === 403) {
        setOutcome({ state: "blocked", frozen: true, reason: data?.message, caseId: data?.txn?.case_id || null });
        addHistory("Blocked", "#fee2e2", "#dc2626");
        setScreen("blocked");
        setTimeout(() => loadAccountData(), 1500);
        return;
      }

      if (data?.txn?.status === "FLAGGED") {
        // Held while the 4-agent pipeline investigates. The verdict arrives over the socket.
        txnRef.current = { id: data.txn.transaction_id, receiverId: data.txn.receiver_account_id };
        setOutcome({ state: "reviewing", ref: data.investigation?.ref });
        addHistory("Flagged", "#fef3c7", "#d97706");
        setScreen("blocked");
        setTimeout(() => loadAccountData(), 1500);
      } else {
        addHistory("Success", "#dcfce7", "#16a34a");
        setScreen("success");
        setTimeout(() => loadAccountData(), 1500);
      }
    } catch (err) {
      console.error("Payment error", err);
      setPayError("Payment failed: " + err.message);
      setScreen("keypad");
    }
  };

  const isCritical = !!(riskData && riskData.is_flagged);
  const riskPct = Math.round(((riskData && riskData.risk_score) || 0) * 100);
  const tone = isCritical
    ? { main: "#dc2626", dark: "#991b1b", soft: "#b91c1c", bg: "#fef2f2", border: "#fee2e2", chip: "#fee2e2" }
    : { main: "#d97706", dark: "#92400e", soft: "#b45309", bg: "#fffbeb", border: "#fde68a", chip: "#fef3c7" };

  return (
    <div style={{ minHeight: "100vh", background: "#05070a", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px 10px", fontFamily: "var(--font-sans)" }}>
      <Head>
        <title>FraudGuard AI - Ultra-Realistic Mock UPI Flow</title>
      </Head>

      {/* Floating Link to Admin SOC Dashboard */}
      <a
        href="/dashboard"
        style={{
          position: "fixed",
          top: 20,
          right: 24,
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
          color: "#38bdf8",
          border: "1px solid rgba(56, 189, 248, 0.3)",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4), 0 0 15px rgba(56, 189, 248, 0.2)",
          borderRadius: 30,
          padding: "10px 18px",
          fontSize: "13px",
          fontWeight: 700,
          textDecoration: "none",
          zIndex: 9999,
          cursor: "pointer",
        }}
      >
        <Shield size={16} color="#38bdf8" />
        <span>Admin SOC Dashboard</span>
        <ArrowRight size={14} color="#38bdf8" />
      </a>

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

        {payError && (
          <div
            onClick={() => setPayError("")}
            style={{ position: "absolute", top: 44, left: 14, right: 14, zIndex: 120, background: "#7f1d1d", color: "#fff", borderRadius: 12, padding: "10px 12px", fontSize: "12px", fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,.35)", cursor: "pointer" }}
          >
            {payError}
          </div>
        )}

        {/* Status Bar */}
        <div style={{ padding: "12px 24px 6px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "13px", fontWeight: 600, color: screen === "pin" ? "#ffffff" : "#0f172a", zIndex: 90 }}>
          <span>{clockStr || "--:--"}</span>
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
            Layer-1: {latency != null ? `${latency}ms` : "n/a"}
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
                      {(accountInfo?.name || "Kosada").charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p style={{ margin: 0, fontSize: "11px", color: "#64748b" }}>Good Evening,</p>
                      <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#0f172a" }}>{accountInfo?.name || "Kosada"}</h3>
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
                    {showBalance ? (accountInfo?.balance !== undefined ? `₹ ${Number(accountInfo.balance).toLocaleString("en-IN")}` : "Loading...") : "••••••"}
                  </h1>
                  <p style={{ margin: "4px 0 16px", fontSize: "10px", color: "#94a3b8" }}>
                    {accountInfo ? "Live • MongoDB Atlas" : "Syncing balance..."}
                  </p>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      onClick={() => { setUpiInputStr(""); setUpiError(""); setScreen("send"); }}
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
                        onClick={() => { setUpiInputStr(c.vpa); setUpiError(""); setRecipient({ name: c.name, vpa: c.vpa }); setAmountStr("1000"); setScreen("keypad"); }}
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
            {/* SCREEN 1b: ENTER UPI ID                                   */}
            {/* ========================================================= */}
            {screen === "send" && (
              <motion.div
                key="send_screen"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0 18px 18px" }}
              >
                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                  <button onClick={() => setScreen("home")} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#0f172a" }}>
                    <ChevronLeft size={22} />
                  </button>
                  <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, flex: 1, textAlign: "center", marginRight: 22 }}>Enter UPI ID</h3>
                </div>

                {/* UPI Input Box */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: 6 }}>Pay to UPI ID / VPA</label>
                  <div style={{ position: "relative" }}>
                    <input
                      autoFocus
                      type="text"
                      value={upiInputStr}
                      onChange={(e) => { setUpiInputStr(e.target.value); setUpiError(""); }}
                      placeholder="example@oksbi"
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        padding: "13px 40px 13px 14px",
                        border: `1.5px solid ${upiError ? "#ef4444" : "#cbd5e1"}`,
                        borderRadius: 12,
                        fontSize: "15px",
                        fontWeight: 500,
                        color: "#0f172a",
                        background: "#f8fafc",
                        outline: "none",
                        transition: "border-color 0.2s",
                      }}
                      onFocus={e => e.target.style.borderColor = "#2563eb"}
                      onBlur={e => e.target.style.borderColor = upiError ? "#ef4444" : "#cbd5e1"}
                      onKeyDown={(e) => { if (e.key === "Enter") handleUpiContinue(); }}
                    />
                    {upiInputStr && (
                      <button
                        onClick={() => { setUpiInputStr(""); setUpiError(""); }}
                        style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: "18px", lineHeight: 1 }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {upiError && <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#ef4444", fontWeight: 500 }}>{upiError}</p>}
                </div>

                {/* Demo VPA Suggestions */}
                <div style={{ marginBottom: 20 }}>
                  <p style={{ margin: "0 0 10px", fontSize: "12px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>Or pick a demo scenario</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[
                      { label: "🔴 Mule Chain (FROZEN)", vpa: "mule.relay99@oksbi", badge: "Auto-Blocked", badgeColor: "#ef4444", badgeBg: "#fee2e2" },
                      { label: "🟡 Smurfing Hub (FROZEN)", vpa: "quicksplit.hub@paytm", badge: "Auto-Blocked", badgeColor: "#ef4444", badgeBg: "#fee2e2" },
                      { label: "🟠 ATO Device (Under Investigation)", vpa: "rajesh.kumar77@icici", badge: "Escalated", badgeColor: "#f59e0b", badgeBg: "#fef3c7" },
                      { label: "🟠 Offshore Hawala (Under Investigation)", vpa: "dubai.remit.express@emirates", badge: "Escalated", badgeColor: "#f59e0b", badgeBg: "#fef3c7" },
                      { label: "✅ Verified Merchant", vpa: "sharma.kirana.store@hdfcbank", badge: "Cleared", badgeColor: "#10b981", badgeBg: "#dcfce7" },
                      { label: "✅ Rohit Mehta (Safe)", vpa: "rohit.mehta@oksbi", badge: "Safe", badgeColor: "#10b981", badgeBg: "#dcfce7" },
                    ].map((s) => (
                      <div
                        key={s.vpa}
                        onClick={() => { setUpiInputStr(s.vpa); setUpiError(""); }}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, cursor: "pointer", transition: "border-color 0.15s" }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = "#2563eb"}
                        onMouseLeave={e => e.currentTarget.style.borderColor = "#e2e8f0"}
                      >
                        <div>
                          <div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>{s.label}</div>
                          <div style={{ fontSize: "11px", color: "#64748b", marginTop: 2 }}>{s.vpa}</div>
                        </div>
                        <span style={{ fontSize: "10px", fontWeight: 700, color: s.badgeColor, background: s.badgeBg, padding: "3px 8px", borderRadius: 20, whiteSpace: "nowrap" }}>{s.badge}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Continue Button */}
                <div style={{ marginTop: "auto" }}>
                  <button
                    onClick={handleUpiContinue}
                    disabled={!upiInputStr.trim()}
                    style={{
                      width: "100%",
                      background: upiInputStr.trim() ? "#2563eb" : "#cbd5e1",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: 14,
                      padding: "14px",
                      fontSize: "15px",
                      fontWeight: 700,
                      cursor: upiInputStr.trim() ? "pointer" : "not-allowed",
                      boxShadow: upiInputStr.trim() ? "0 4px 12px rgba(37, 99, 235, 0.3)" : "none",
                      transition: "all 0.2s",
                    }}
                  >
                    Continue →
                  </button>
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
                  <button
                    onClick={() => { setUpiInputStr(recipient.vpa || ""); setUpiError(""); setScreen("send"); }}
                    style={{ background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, color: "#2563eb", fontSize: "12px", fontWeight: 600 }}
                  >
                    <Edit2 size={14} /> Change
                  </button>
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
                <div style={{ background: tone.bg, border: "1px solid " + tone.border, borderRadius: 14, padding: "14px", marginBottom: 14, display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <AlertTriangle size={20} color={tone.main} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <h4 style={{ margin: "0 0 2px", fontSize: "13px", fontWeight: 700, color: tone.dark }}>{isCritical ? "High Fraud Risk Detected" : "Caution: Elevated Risk"}</h4>
                    <p style={{ margin: 0, fontSize: "11px", color: tone.soft, lineHeight: 1.4 }}>
                      {(riskData && riskData.warning_message) || "This account shows suspicious activity patterns based on our AI analysis."}
                    </p>
                  </div>
                </div>

                {/* Risk Score Meter Visualizer */}
                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px", marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b" }}>Risk Score</span>
                    <span style={{ fontSize: "13px", fontWeight: 800, color: tone.main }}>{riskPct}%</span>
                  </div>
                  {/* Red Audio Bar Visualizer */}
                  <div style={{ display: "flex", gap: 3, height: 16, alignItems: "center" }}>
                    {[...Array(18)].map((_, i) => (
                      <div
                        key={i}
                        style={{
                          flex: 1,
                          height: i < Math.max(1, Math.round((riskPct / 100) * 18)) ? "100%" : "30%",
                          background: i < Math.max(1, Math.round((riskPct / 100) * 18)) ? `linear-gradient(to top, ${tone.main}, ${tone.dark})` : "#e2e8f0",
                          borderRadius: 2,
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* Identified Pattern Card */}
                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "12px", marginBottom: 12 }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: 6 }}>Model assessment</span>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <div style={{ padding: 6, borderRadius: 8, background: tone.chip, color: tone.main }}>
                      <ShieldAlert size={16} />
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a" }}>{isCritical ? "Flagged above the 0.85 threshold" : "Elevated, below the block threshold"}</div>
                      <div style={{ fontSize: "10px", color: "#64748b", lineHeight: 1.3 }}>
                        {riskData && riskData.model_scores
                          ? `Tabular model ${riskData.model_scores.xgb.toFixed(2)} · network model ${riskData.model_scores.sage.toFixed(2)}`
                          : `Scored by ${(riskData && riskData.meta && riskData.meta.source) || "the risk engine"}`}
                        {isCritical ? ". Our AI agents will review this payment if you continue." : ""}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Recommendation */}
                <div style={{ marginBottom: 16, display: "flex", gap: 6, alignItems: "center" }}>
                  <AlertTriangle size={14} color={tone.main} />
                  <span style={{ fontSize: "11px", fontWeight: 600, color: tone.soft }}>{isCritical ? "Recommendation: Do not proceed with this payment." : "Recommendation: Continue only if you know this person."}</span>
                </div>

                {/* Action Buttons */}
                <div style={{ display: "flex", gap: 10, marginTop: "auto" }}>
                  <button
                    onClick={() => setScreen("home")}
                    style={{ flex: 1, background: "#ffffff", color: tone.main, border: "1px solid " + tone.border, borderRadius: 12, padding: "12px", fontWeight: 700, fontSize: "12px", cursor: "pointer" }}
                  >
                    Cancel Payment
                  </button>
                  <button
                    onClick={() => { setPin(""); setScreen("pin"); }}
                    style={{ flex: 1, background: tone.main, color: "#ffffff", border: "none", borderRadius: 12, padding: "12px", fontWeight: 700, fontSize: "12px", cursor: "pointer" }}
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
                    <span style={{ fontSize: "11px", color: "#0f172a" }}>{new Date().toLocaleString()}</span>
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
            {screen === "blocked" && (() => {
              const oc = outcome || { state: "blocked" };
              const tones = {
                reviewing: { c: "#d97706", bg: "#fef3c7", title: "Payment On Hold", sub: "FraudGuard AI is reviewing this payment", Icon: Clock },
                blocked: { c: "#dc2626", bg: "#fee2e2", title: "Transaction Stopped", sub: "AI Fraud Engine Intervention", Icon: ShieldAlert },
                released: { c: "#16a34a", bg: "#dcfce7", title: "Payment Released", sub: "Review complete: this recipient was verified", Icon: CheckCircle },
                escalated: { c: "#d97706", bg: "#fef3c7", title: "Held for Manual Review", sub: "A fraud analyst will review this payment", Icon: Clock },
              };
              const t = tones[oc.state] || tones.blocked;
              const Icon = t.Icon;
              const reviewing = oc.state === "reviewing";
              const reason = reviewing
                ? "Agents are investigating..."
                : oc.topology || oc.reason || (oc.state === "released" ? "Cleared as a false alarm" : "Flagged by the fraud model");
              const row = (k, v, extra) => (
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, gap: 10 }}>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>{k}</span>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "#0f172a", textAlign: "right", ...extra }}>{v}</span>
                </div>
              );
              return (
                <motion.div
                  key="blocked_screen"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 20px", textAlign: "center", overflowY: "auto" }}
                >
                  <div style={{ width: 68, height: 68, borderRadius: "50%", background: t.bg, color: t.c, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                    <motion.div animate={reviewing ? { rotate: 360 } : { rotate: 0 }} transition={reviewing ? { repeat: Infinity, duration: 2.4, ease: "linear" } : { duration: 0.3 }}>
                      <Icon size={34} />
                    </motion.div>
                  </div>

                  <h2 style={{ margin: "0 0 2px", fontSize: "17px", fontWeight: 800, color: t.c }}>{t.title}</h2>
                  <p style={{ margin: "0 0 18px", fontSize: "11px", color: "#64748b" }}>{t.sub}</p>

                  <div style={{ width: "100%", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px", textAlign: "left", marginBottom: 14 }}>
                    {row("Amount", `₹ ${Number(amountStr || 0).toLocaleString()}`, { fontSize: "13px", fontWeight: 800 })}
                    {row("To", <span>{recipient.name}<br /><span style={{ fontSize: "10px", color: "#64748b", fontWeight: 400 }}>{recipient.vpa}</span></span>)}
                    {riskData && row("Risk Score", `${riskPct}% (${riskData.risk_level})`, { color: t.c, fontWeight: 700 })}
                    {row("Reason", reason)}
                    {row("Case ID", oc.caseId || (reviewing ? "Opening case..." : "n/a"), { fontFamily: "monospace" })}
                    {oc.decisionMs ? row("Decided in", `${(oc.decisionMs / 1000).toFixed(1)}s by AI agents`) : null}
                    {row("Time", new Date().toLocaleString())}
                  </div>

                  {oc.rationale && (
                    <div style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "10px 12px", textAlign: "left", fontSize: "11px", color: "#334155", lineHeight: 1.5, marginBottom: 12 }}>
                      <b style={{ color: "#0f172a" }}>Why:</b> {oc.rationale}
                    </div>
                  )}
                  {reviewing && (
                    <p style={{ margin: "0 0 12px", fontSize: "11px", color: "#64748b", lineHeight: 1.5 }}>
                      Your money has not left your account. This screen updates the moment the review finishes.
                    </p>
                  )}

                  {showEvidence && oc.evidence && oc.evidence.length > 0 && (
                    <div style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "10px 12px", textAlign: "left", fontSize: "11px", color: "#334155", lineHeight: 1.5, marginBottom: 10 }}>
                      {oc.evidence.map((e, i) => <div key={i} style={{ marginBottom: 3 }}>• {e}</div>)}
                    </div>
                  )}

                  <div style={{ width: "100%", display: "flex", gap: 8, marginBottom: 8 }}>
                    <button
                      disabled={!oc.evidence || oc.evidence.length === 0}
                      onClick={() => setShowEvidence((v) => !v)}
                      style={{ flex: 1, background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px", fontSize: "11px", fontWeight: 600, color: "#0f172a", cursor: "pointer", opacity: oc.evidence && oc.evidence.length ? 1 : 0.5 }}
                    >
                      {showEvidence ? "Hide Evidence" : "View Evidence"}
                    </button>
                    <a
                      href="/dashboard"
                      target="_blank"
                      rel="noreferrer"
                      style={{ flex: 1, background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px", fontSize: "11px", fontWeight: 600, color: "#0f172a", textDecoration: "none", textAlign: "center" }}
                    >
                      Open in SOC
                    </a>
                  </div>

                  <button
                    onClick={() => { setOutcome(null); txnRef.current = null; setScreen("home"); }}
                    style={{ width: "100%", background: "#2563eb", border: "none", borderRadius: 10, padding: "12px", fontSize: "13px", fontWeight: 700, color: "#ffffff", cursor: "pointer" }}
                  >
                    Return Home
                  </button>
                </motion.div>
              );
            })()}

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
