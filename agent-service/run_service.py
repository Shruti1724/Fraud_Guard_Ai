import sys
from pathlib import Path
import uvicorn

# Ensure the agent-service directory is in sys.path
BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

if __name__ == "__main__":
    print("==================================================================")
    print("Starting FraudGuard AI Agentic Investigation Service...")
    print("Swagger UI Docs : http://127.0.0.1:8001/docs")
    print("Endpoint        : POST http://127.0.0.1:8001/investigate")
    print("==================================================================")
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8001,
        reload=True,
        app_dir=str(BASE_DIR)
    )
