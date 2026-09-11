# FraudGuard AI — Complete 9-Screen Mock UPI App & SOC Dashboard Walkthrough

## Summary of Completed Design Implementation

We have implemented the complete 9-screen flow for the **Mock UPI User App** in [`frontend/pages/index.js`](file:///c:/Users/kosada%20bhat/Desktop/Fraud_Guard_Ai/frontend/pages/index.js), matching your design specification image:

---

### 📱 9-Screen Interactive Experience Breakdown

1. **Screen 1: Home Screen**
   - User profile header (`Good Evening, Kosada`) with notification bell.
   - Available balance card (`₹ 45,290`) with show/hide toggle and quick **Send Money** / **Scan QR** actions.
   - **Demo Presets (Tap to Try)**:
     - 🚨 Mule Relay (`mule.relay99@oksbi` • ₹48,500 • High Risk)
     - ⚡ Smurfing Hub (`quicksplit.hub@paytm` • ₹9,900 • Medium Risk)
     - 🕵️ Account Takeover (`rajesh.kumar77@icici` • ₹95,000 • High Risk)
     - 🛡️ Verified Retail (`sharma.kirana.store@hdfcbank` • ₹450 • Verified)
   - **Recent Contacts**: Circular avatar bubbles (`RS`, `AP`, `MK`, `PJ`).
   - Bottom navigation (`Home`, `History`, `Alerts`).

2. **Screen 2: Send Money (Keypad)**
   - Recipient header with avatar, name, and VPA.
   - Large amount typography with blinking cursor (`₹ 95,000|`).
   - Quick amount suggestion pills (`₹ 1,000`, `₹ 5,000`, `₹ 10,000`).
   - Full 12-key numeric keypad (`1-9`, `00`, `0`, `⌫`).
   - Solid blue **Continue** action button.

3. **Screen 3: Fraud Warning Modal**
   - Red alert banner: `⚠️ High Fraud Risk Detected`.
   - **Risk Score Meter**: Segmented audio-bar visualizer showing `96%` in gradient red.
   - **Identified Pattern**: `Rapid pass-through mule` badge with structural pattern explanation.
   - Recommendation note: `Do not proceed with this payment.`
   - Dual actions: **Cancel Payment** (white with red border) vs **Proceed Anyway** (solid red).

4. **Screen 4: UPI PIN Entry**
   - Full dark theme (`#0c1017`) with padlock icon.
   - Target recipient context: `Paying ₹ 95,000 to Rajesh Kumar rajesh.kumar77@icici`.
   - 4-dot active PIN indicator with tactile dark keypad.

5. **Screen 5: Processing Payment**
   - Animated bank pillar icon inside circular halo.
   - Step-by-step progress checklist:
     - ✅ Initiating transaction (Completed)
     - ✅ Verifying beneficiary (Completed)
     - ✅ Checking account risk (High detected)
     - ⏳ Processing with bank (In progress...)
     - ⚪ Finalizing transaction (Waiting...)

6. **Screen 6: Payment Successful Receipt**
   - Large green checkmark with ripple glow.
   - Receipt card with Amount, Beneficiary, Txn ID (`TXN_20260911_984721`), and Date/Time.
   - **View Details** and **Back to Home** buttons.

7. **Screen 7: Transaction Stopped / Blocked Receipt**
   - Red shield alert badge with `Transaction Stopped: AI Fraud Engine Intervention`.
   - Incident dossier card displaying Amount, Recipient, Risk Score (`96% High Risk`), Reason (`Rapid Pass-Through Mule Network`), Case ID (`CASE_001847`), and Time.
   - **View Evidence**, **Generate Report**, and **Return Home** buttons.

8. **Screen 8: Transaction History**
   - Category filter pills: `All`, `Success`, `Blocked`, `Flagged`.
   - Chronological ledger with color-coded status pills.

9. **Screen 9: Fraud Alerts**
   - Notification center filtered by `All`, `Blocked`, `Warnings`, `Info`.
   - Detailed incident notifications linking to Case IDs.

---

### 🛡️ Global Top Bar (On Every Screen)
- **AI Fraud Shield Active**: Emerald badge with real-time dynamic latency readout (`Latency: 38ms`).

---

### Verification
- **Mock UPI Phone App**: `http://localhost:3000` (HTTP 200)
- **Cyber SOC Dashboard**: `http://localhost:3000/dashboard` (HTTP 200)
