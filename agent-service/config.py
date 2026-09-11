import os
from pydantic import BaseModel

class Settings(BaseModel):
    app_name: str = "FraudGuard AI Agentic Service"
    version: str = "1.0.0"
    ollama_base_url: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "llama3.2:latest")
    llm_temperature: float = 0.1
    llm_timeout_seconds: float = 30.0
    enable_cache_fallback: bool = True

settings = Settings()
