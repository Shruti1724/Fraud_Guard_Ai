"""Central Configuration for FraudGuard AI Layer-3 Agent Investigation Service.

Defines operational thresholds, ports, timeouts, LLM models, and data provider modes.
Single source of truth for Member C configuration.
"""

import os
from pathlib import Path
from pydantic import BaseModel, Field

# Base directories
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
ROOT_DIR = BASE_DIR.parent

class Settings(BaseModel):
    app_name: str = "FraudGuard AI Agentic Service"
    version: str = "2.0.0"
    
    # Network / Port (Member B runs on 8080, Member C runs on 8001)
    port: int = int(os.getenv("PORT", "8001"))
    host: str = os.getenv("HOST", "0.0.0.0")
    
    # LLM (Ollama) Settings
    ollama_base_url: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "llama3.2:latest")
    llm_temperature: float = 0.1
    llm_timeout_seconds: float = float(os.getenv("LLM_TIMEOUT_SECONDS", "25.0"))
    llm_max_retries: int = int(os.getenv("LLM_MAX_RETRIES", "1"))
    enable_cache_fallback: bool = True
    
    # Operational Thresholds (mirrors ml-service/config.py)
    WARN_THRESHOLD: float = 0.70
    FLAG_THRESHOLD: float = 0.85
    
    # Service Integration URLs
    ml_service_url: str = os.getenv("ML_SERVICE_URL", "http://127.0.0.1:8080")
    
    # Data Provider & Action Backend Modes
    # DATA_PROVIDER_MODE: "csv", "mock", or "mongo"
    data_provider_mode: str = os.getenv("DATA_PROVIDER_MODE", "csv").lower()
    # ACTION_BACKEND: "simulated" or "mongo"
    action_backend: str = os.getenv("ACTION_BACKEND", "simulated").lower()
    
    # MongoDB Settings (Member A integration)
    mongodb_uri: str = os.getenv("MONGODB_URI", "mongodb://localhost:27017/fraudguard")
    mongo_db_name: str = os.getenv("MONGO_DB_NAME", "fraudguard")
    
    # File Paths for CSV Data Provider (Member B artifacts)
    blended_scores_path: str = os.getenv(
        "BLENDED_SCORES_PATH", 
        str(ROOT_DIR / "ml-service" / "artifacts" / "blended_scores.csv")
    )
    accounts_csv_path: str = os.getenv(
        "ACCOUNTS_CSV_PATH", 
        str(ROOT_DIR / "ml-service" / "data" / "v2" / "accounts.csv")
    )
    edges_csv_path: str = os.getenv(
        "EDGES_CSV_PATH", 
        str(ROOT_DIR / "ml-service" / "data" / "v2" / "transactions.csv")
    )
    mock_accounts_file: str = str(DATA_DIR / "mock_accounts.json")
    cached_demo_file: str = str(DATA_DIR / "cached_demo.json")

settings = Settings()
