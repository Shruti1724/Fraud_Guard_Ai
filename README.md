

### 1. Start Agent service first
```bash
cd agent-service
ollama run llama3.2:latest &   # if not already running
./.venv/bin/python run_service.py   # serves :8001
```
Confirm it's up: `curl http://127.0.0.1:8001/health`

### 2. Backend
```bash
cd backend
npm install
cp .env.example .env
# edit .env: put in your MongoDB Atlas URI
npm run seed     # loads 5 accounts that match agent-service/data/mock_accounts.json
npm run dev      # serves :4000
```

### 3. Frontend
```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev      # serves :3000
```

## Try it

Open http://localhost:3000, enter one of these seeded VPAs and any amount, and
tab out of the field:

| VPA | Expected |
|---|---|
| `mule.relay99@oksbi` | CRITICAL warning, auto_block after confirming |
| `quicksplit.hub@paytm` | HIGH warning, auto_block |
| `rajesh.kumar77@icici` | HIGH warning, escalate |
| `sharma.kirana.store@hdfcbank` | LOW risk, no warning, no investigation triggered |

Confirming a flagged payment ("Send anyway") writes to `transactions`,
`risk_scores`, `investigation_cases`, and `audit_actions` in Mongo, and emits
`transaction:new` / `risk_score:updated` / `agent:activity` over Socket.IO —
so the dashboard (whoever builds Cytoscape.js next) has real events to render
from day one.

