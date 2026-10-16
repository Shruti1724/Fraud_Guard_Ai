#!/usr/bin/env bash
# FraudGuard AI - Layer-1 /predict and /health Curl Test Suite
# Tests all endpoints and edge cases against a running FastAPI server.

set -e

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8080}"
BASE_URL="http://${HOST}:${PORT}"

echo "======================================================================"
echo "FraudGuard AI - API Demonstration & Validation Suite"
echo "Target Base URL: ${BASE_URL}"
echo "======================================================================"

# Helper function to print headers
print_step() {
    echo ""
    echo "----------------------------------------------------------------------"
    echo "TEST $1: $2"
    echo "----------------------------------------------------------------------"
}

# 1. Health check
print_step "1" "GET /health"
echo "Command: curl -s -X GET \"${BASE_URL}/health\""
curl -s -X GET "${BASE_URL}/health" | jq .

# 2. Valid account with risk < 0.70 (LOW)
print_step "2" "POST /predict for valid account below 0.70 (LOW risk)"
echo "Command: curl -s -X POST \"${BASE_URL}/predict\" -H 'Content-Type: application/json' -d '{\"receiver_account_id\": \"C1000018432\", \"amount\": 250.0}'"
curl -s -X POST "${BASE_URL}/predict" \
  -H "Content-Type: application/json" \
  -d '{"receiver_account_id": "C1000018432", "amount": 250.0}' | jq .

# 3. Valid account in [0.70, 0.85) (HIGH / WARN)
print_step "3" "POST /predict for valid account in [0.70, 0.85) (HIGH / WARN)"
echo "Command: curl -s -X POST \"${BASE_URL}/predict\" -H 'Content-Type: application/json' -d '{\"receiver_account_id\": \"C1001120910\", \"amount\": 7500.0}'"
curl -s -X POST "${BASE_URL}/predict" \
  -H "Content-Type: application/json" \
  -d '{"receiver_account_id": "C1001120910", "amount": 7500.0}' | jq .

# 4. Valid account >= 0.85 (CRITICAL / FLAG)
print_step "4" "POST /predict for valid account >= 0.85 (CRITICAL / FLAG)"
echo "Command: curl -s -X POST \"${BASE_URL}/predict\" -H 'Content-Type: application/json' -d '{\"receiver_account_id\": \"C1000039615\", \"amount\": 45000.0}'"
curl -s -X POST "${BASE_URL}/predict" \
  -H "Content-Type: application/json" \
  -d '{"receiver_account_id": "C1000039615", "amount": 45000.0}' | jq .

# 5. Mule ring member (acc_chain_016_4)
print_step "5" "POST /predict for Mule Ring Member (acc_chain_016_4 / acc_chain_016_4@upi)"
echo "Command: curl -s -X POST \"${BASE_URL}/predict\" -H 'Content-Type: application/json' -d '{\"receiver_vpa\": \"acc_chain_016_4@upi\", \"amount\": 95000.0}'"
curl -s -X POST "${BASE_URL}/predict" \
  -H "Content-Type: application/json" \
  -d '{"receiver_vpa": "acc_chain_016_4@upi", "amount": 95000.0}' | jq .

# 6. Innocent decoy (C1001991700)
print_step "6" "POST /predict for Innocent Merchant Decoy (C1001991700 / c1001991700@upi)"
echo "Command: curl -s -X POST \"${BASE_URL}/predict\" -H 'Content-Type: application/json' -d '{\"receiver_vpa\": \"c1001991700@upi\", \"amount\": 120.0}'"
curl -s -X POST "${BASE_URL}/predict" \
  -H "Content-Type: application/json" \
  -d '{"receiver_vpa": "c1001991700@upi", "amount": 120.0}' | jq .

# 7. Unknown account (Expected: 404 Not Found)
print_step "7" "POST /predict for Unknown Account (Expected: 404 Not Found)"
echo "Command: curl -s -w \"\\nHTTP_STATUS: %{http_code}\\n\" -X POST \"${BASE_URL}/predict\" -H 'Content-Type: application/json' -d '{\"receiver_account_id\": \"UNKNOWN_ACCOUNT_9999\", \"amount\": 1000.0}'"
curl -s -w "\nHTTP_STATUS: %{http_code}\n" -X POST "${BASE_URL}/predict" \
  -H "Content-Type: application/json" \
  -d '{"receiver_account_id": "UNKNOWN_ACCOUNT_9999", "amount": 1000.0}'

# 8. Missing or invalid fields (Expected: 422 Unprocessable Entity)
print_step "8" "POST /predict with Missing Account Identifier (Expected: 422 Unprocessable Entity)"
echo "Command: curl -s -w \"\\nHTTP_STATUS: %{http_code}\\n\" -X POST \"${BASE_URL}/predict\" -H 'Content-Type: application/json' -d '{\"amount\": 500.0}'"
curl -s -w "\nHTTP_STATUS: %{http_code}\n" -X POST "${BASE_URL}/predict" \
  -H "Content-Type: application/json" \
  -d '{"amount": 500.0}'

echo ""
echo "======================================================================"
echo "ALL CURL TESTS COMPLETED SUCCESSFULLY"
echo "======================================================================"
