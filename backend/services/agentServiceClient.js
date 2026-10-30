// FraudGuard AI — Dual-Service Client
//
// Layer 1 /predict     → ML Service  (port 8080)
//                        XGBoost + GraphSAGE blended scores over 893K accounts
//
// Layer 3 /investigate → Agent Service (port 8001)
//                        LangGraph 4-agent autonomous pipeline (Ollama LLM)

const ML_SERVICE_URL    = process.env.ML_SERVICE_URL    || "http://127.0.0.1:8080";
const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL || "http://127.0.0.1:8001";
const OLLAMA_URL        = process.env.OLLAMA_URL        || "http://127.0.0.1:11434";

// Agent benchmark: Ollama LLM inference takes 9.9–16.4s (median 13.1s) and the
// agent retries once, so the investigate timeout sits well above the p95.
const PREDICT_TIMEOUT_MS     = Number(process.env.PREDICT_TIMEOUT_MS     || 10_000);
const INVESTIGATE_TIMEOUT_MS = Number(process.env.INVESTIGATE_TIMEOUT_MS || 60_000);
const HEALTH_TIMEOUT_MS      = 2_500;

// Serve pre-cached agent output (agent-service/data/cached_demo.json) for demo reliability.
const AGENT_USE_CACHE = String(process.env.AGENT_USE_CACHE || "false").toLowerCase() === "true";

function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

/**
 * Layer 1 — Pre-payment risk lookup.
 * Primary:  ML Service — real XGBoost + GraphSAGE blended scores.
 * Fallback: Agent Service — heuristic/mock scores when ML is offline or doesn't know the account.
 * The returned object carries `meta: { source, latency_ms }` with real measurements.
 */
async function predict({ sender_account_id, receiver_vpa, amount, device_id, ml_account_id }) {
  const body    = JSON.stringify({ sender_account_id, receiver_vpa, amount, device_id });
  // The ML service scores real model accounts by ID, so a demo account that stands for
  // one is sent as that ID. The agent fallback only knows demo VPAs, so it never sees it.
  const mlBody  = ml_account_id ? JSON.stringify({ sender_account_id, receiver_account_id: ml_account_id, amount, device_id }) : body;
  const headers = { "Content-Type": "application/json" };
  const started = Date.now();

  try {
    const resp = await fetchWithTimeout(
      `${ML_SERVICE_URL}/predict`,
      { method: "POST", headers, body: mlBody },
      PREDICT_TIMEOUT_MS
    );
    if (resp.ok) {
      const data = await resp.json();
      return { ...data, meta: { source: "ml-service", latency_ms: Date.now() - started } };
    }
    const errText = await resp.text();
    console.warn(`[predict] ML Service ${resp.status}: ${errText} — falling back to Agent Service.`);
  } catch (e) {
    console.warn(`[predict] ML Service unreachable (${e.message}) — falling back to Agent Service.`);
  }

  const fallbackStart = Date.now();
  const fallback = await fetchWithTimeout(
    `${AGENT_SERVICE_URL}/predict`,
    { method: "POST", headers, body },
    PREDICT_TIMEOUT_MS
  );
  if (!fallback.ok) {
    throw new Error(`/predict failed on both services: ${fallback.status} ${await fallback.text()}`);
  }
  const data = await fallback.json();
  return {
    ...data,
    meta: {
      source: "agent-fallback",
      latency_ms: Date.now() - fallbackStart,
      total_ms: Date.now() - started,
    },
  };
}

/**
 * Layer 3 — Autonomous 4-agent LangGraph investigation (Agent Service only).
 */
async function investigate({ account_id, account_data, use_cache = AGENT_USE_CACHE }) {
  const url = new URL(`${AGENT_SERVICE_URL}/investigate`);
  if (use_cache) url.searchParams.set("use_cache", "true");

  console.log(`[investigate] sending to Agent Service: account_id=${account_id}${use_cache ? " (cached)" : ""}`);
  const resp = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id, account_data }),
    },
    INVESTIGATE_TIMEOUT_MS
  );
  if (!resp.ok) {
    throw new Error(`/investigate failed: ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

// ─── health probes ───────────────────────────────────────────────────────────

async function probe(name, url) {
  const started = Date.now();
  try {
    const resp = await fetchWithTimeout(url, {}, HEALTH_TIMEOUT_MS);
    const latency_ms = Date.now() - started;
    if (!resp.ok) return { name, status: "degraded", latency_ms, detail: `HTTP ${resp.status}` };
    let data = null;
    try { data = await resp.json(); } catch (_) { /* non-JSON health is still healthy */ }
    return { name, status: "online", latency_ms, data };
  } catch (e) {
    return { name, status: "offline", latency_ms: null, detail: e.name === "AbortError" ? "timeout" : e.message };
  }
}

async function getServiceHealth() {
  const [ml, agent, ollama] = await Promise.all([
    probe("ml-service", `${ML_SERVICE_URL}/health`),
    probe("agent-service", `${AGENT_SERVICE_URL}/health`),
    probe("ollama", `${OLLAMA_URL}/api/tags`),
  ]);
  return { ml, agent, ollama };
}

module.exports = { predict, investigate, getServiceHealth, AGENT_USE_CACHE };
