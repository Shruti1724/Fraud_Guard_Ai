#!/usr/bin/env node
// Prints the best locally installed Ollama model so the agent-service can be
// started without pulling llama3.2:
//   PowerShell: $env:OLLAMA_MODEL = node scripts/pick-ollama-model.js
//   bash:       export OLLAMA_MODEL=$(node scripts/pick-ollama-model.js)
// Preference order: llama3.2 > llama3 > qwen > mistral/phi/gemma > anything local.
// Cloud-hosted tags (":cloud") are skipped. Prints nothing if Ollama is down,
// in which case the agents use their built-in heuristics.
const base = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const PREFER = [/^llama3\.2/, /^llama3/, /^qwen/, /^mistral/, /^phi/, /^gemma/];

(async () => {
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const names = ((await res.json()).models || []).map((m) => m.name).filter((n) => !n.includes(":cloud"));
    for (const re of PREFER) {
      const hit = names.find((n) => re.test(n));
      if (hit) return console.log(hit);
    }
    if (names[0]) console.log(names[0]);
  } catch (_) {
    /* Ollama not running: print nothing */
  }
})();
