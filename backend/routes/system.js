const express = require("express");
const mongoose = require("mongoose");
const { getServiceHealth } = require("../services/agentServiceClient");
const { resetState } = require("../services/investigationService");
const { seedDatabase } = require("../seed");

const router = express.Router();
const DEMO_MODE = String(process.env.DEMO_MODE || "true").toLowerCase() !== "false";

// GET /system/health — real status + latency of every dependency
router.get("/health", async (req, res) => {
  const started = Date.now();
  let mongoMs = null;
  let mongoStatus = "offline";
  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db.admin().ping();
      mongoMs = Date.now() - started;
      mongoStatus = "online";
    }
  } catch (_) { /* reported as offline */ }

  const svc = await getServiceHealth();
  const ml = svc.ml;
  const agent = svc.agent;
  const ollama = svc.ollama;

  const ollamaModels = ollama.data && Array.isArray(ollama.data.models) ? ollama.data.models.map((m) => m.name) : [];
  const wantedModel = agent.data && agent.data.ollama_model;

  res.json({
    checked_at: new Date().toISOString(),
    backend: { name: "backend", status: "online", latency_ms: 0, demo_mode: DEMO_MODE },
    mongo: { name: "mongodb", status: mongoStatus, latency_ms: mongoMs },
    ml,
    agent,
    ollama: {
      ...ollama,
      model: wantedModel || null,
      model_loaded: wantedModel ? ollamaModels.some((n) => n === wantedModel || n.startsWith(wantedModel.split(":")[0])) : null,
    },
    // layer1 degrades gracefully to the agent's heuristics if the ML service is down
    layer1_source: ml.status === "online" ? "ml-service" : agent.status === "online" ? "agent-fallback" : "unavailable",
  });
});

// POST /system/reset { mode: "fresh" | "history" } — wipe & reseed for a clean demo run
router.post("/reset", async (req, res) => {
  if (!DEMO_MODE) return res.status(403).json({ error: "Reset is disabled outside DEMO_MODE" });
  try {
    const mode = req.body && req.body.mode === "history" ? "history" : "fresh";
    const result = await seedDatabase({ mode, connect: false });
    resetState();
    req.app.get("io").emit("system:reset", { mode, at: new Date().toISOString() });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[system/reset] error:", err.message);
    res.status(500).json({ error: "Reset failed", detail: err.message });
  }
});

module.exports = router;
