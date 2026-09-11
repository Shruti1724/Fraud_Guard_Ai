// Client for the real FastAPI service Shruti built (agent-service/main.py),
// which implements BOTH /predict (Layer 1) and /investigate (Layer 2/3)
// per docs/api-contract.md. No stubs needed - this service already runs.

const BASE_URL = process.env.AGENT_SERVICE_URL || "http://127.0.0.1:8001";

async function predict({ sender_account_id, receiver_vpa, amount, device_id }) {
  const resp = await fetch(`${BASE_URL}/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender_account_id, receiver_vpa, amount, device_id }),
  });
  if (!resp.ok) {
    throw new Error(`/predict failed: ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

async function investigate({ account_id, account_data, use_cache = false }) {
  const url = new URL(`${BASE_URL}/investigate`);
  if (use_cache) url.searchParams.set("use_cache", "true");

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account_id, account_data }),
  });
  if (!resp.ok) {
    throw new Error(`/investigate failed: ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

module.exports = { predict, investigate };
