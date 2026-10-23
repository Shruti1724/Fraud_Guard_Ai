#!/usr/bin/env bash
# ==============================================================================
# FraudGuard AI — Member C Agent Investigation Service cURL Examples
# Service Base URL: http://127.0.0.1:8001
# ==============================================================================

BASE_URL="http://127.0.0.1:8001"

echo "=================================================================="
echo "FRAUDGUARD AI — AGENTIC INVESTIGATION SERVICE (PORT 8001)"
echo "=================================================================="

# Function for clean output formatting
print_step() {
    echo ""
    echo "------------------------------------------------------------------"
    echo "STEP $1: $2"
    echo "------------------------------------------------------------------"
}

# 1. Health check & configuration telemetry
print_step "1" "Health Check & Operational Configuration"
curl -s -X GET "${BASE_URL}/health" | python3 -m json.tool

# 2. List available test accounts & decoys
print_step "2" "Inspect Available Test Accounts in Directory"
curl -s -X GET "${BASE_URL}/accounts" | python3 -m json.tool

# 3. Layer 1 Pre-Payment Risk Lookup
print_step "3" "POST /predict for Flagged Mule (c1000039615@upi)"
curl -s -X POST "${BASE_URL}/predict" \
     -H "Content-Type: application/json" \
     -d '{
       "sender_account_id": "acc_user_101",
       "receiver_vpa": "c1000039615@upi",
       "amount": 48500.0,
       "device_id": "DEV_USER_PHONE_01"
     }' | python3 -m json.tool

# 4. Investigate Real Mule Account (Expected: auto_block)
print_step "4" "POST /investigate for Real Mule (C1000039615 -> auto_block)"
curl -s -X POST "${BASE_URL}/investigate" \
     -H "Content-Type: application/json" \
     -d '{
       "account_id": "C1000039615"
     }' | python3 -m json.tool

# 5. Investigate Synthetic Ring Hop (Expected: auto_block)
print_step "5" "POST /investigate for Ring Member (acc_chain_016_4 -> auto_block)"
curl -s -X POST "${BASE_URL}/investigate" \
     -H "Content-Type: application/json" \
     -d '{
       "account_id": "acc_chain_016_4"
     }' | python3 -m json.tool

# 6. Investigate Innocent Look-Alike Decoy (Expected: clear)
print_step "6" "POST /investigate for Innocent Merchant Decoy (acc_decoy_merchant_03 -> clear)"
curl -s -X POST "${BASE_URL}/investigate" \
     -H "Content-Type: application/json" \
     -d '{
       "account_id": "acc_decoy_merchant_03"
     }' | python3 -m json.tool

# 7. Investigate Innocent Family Group Decoy (Expected: clear)
print_step "7" "POST /investigate for Innocent Family Decoy (acc_decoy_family_01 -> clear)"
curl -s -X POST "${BASE_URL}/investigate" \
     -H "Content-Type: application/json" \
     -d '{
       "account_id": "acc_decoy_family_01"
     }' | python3 -m json.tool

# 7B. Investigate Innocent Payroll Decoy (Expected: clear)
print_step "7B" "POST /investigate for Corporate Payroll Decoy (acc_decoy_payroll_04 -> clear)"
curl -s -X POST "${BASE_URL}/investigate" \
     -H "Content-Type: application/json" \
     -d '{
       "account_id": "acc_decoy_payroll_04"
     }' | python3 -m json.tool

# 8. Investigate Borderline Behavioral Anomaly (Expected: escalate)
print_step "8" "POST /investigate for Borderline Anomaly (acc_suspicious_device_04 -> escalate)"
curl -s -X POST "${BASE_URL}/investigate" \
     -H "Content-Type: application/json" \
     -d '{
       "account_id": "acc_suspicious_device_04"
     }' | python3 -m json.tool

# 8B. Investigate Clean Benign Dataset Account (Expected: clear)
print_step "8B" "POST /investigate for Benign Retail Customer (C1000621564 -> clear)"
curl -s -X POST "${BASE_URL}/investigate" \
     -H "Content-Type: application/json" \
     -d '{
       "account_id": "C1000621564"
     }' | python3 -m json.tool

# 9. Lightning-Fast Pre-Cached Demo Output
print_step "9" "POST /investigate?use_cache=true (Live Presentation Safety Fallback)"
curl -s -X POST "${BASE_URL}/investigate?use_cache=true" \
     -H "Content-Type: application/json" \
     -d '{
       "account_id": "C1000039615"
     }' | python3 -m json.tool

# 10. Contract Error Handling: Unknown Account (Expected: HTTP 404)
print_step "10" "Contract Error Check: Unknown Account (Expected HTTP 404)"
curl -s -w "\nHTTP Status: %{http_code}\n" -X POST "${BASE_URL}/investigate" \
     -H "Content-Type: application/json" \
     -d '{
       "account_id": "NON_EXISTENT_ACC_99999"
     }'

# 11. Contract Error Handling: Missing Account ID (Expected: HTTP 422)
print_step "11" "Contract Error Check: Missing ID (Expected HTTP 422)"
curl -s -w "\nHTTP Status: %{http_code}\n" -X POST "${BASE_URL}/investigate" \
     -H "Content-Type: application/json" \
     -d '{}'

echo ""
echo "=================================================================="
echo "cURL Verification Suite Complete!"
echo "=================================================================="
