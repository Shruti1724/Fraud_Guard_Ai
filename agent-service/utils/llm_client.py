"""Resilient LLM Client for FraudGuard AI.

Provides:
- Timeout enforcement
- Automatic single retry on failure/timeout/bad JSON
- JSON extraction and Pydantic validation
- Graceful deterministic fallback so pipeline never crashes
"""

import json
import re
import time
import logging
from typing import Dict, Any, Optional, Type, Callable
from pydantic import BaseModel, ValidationError
from langchain_ollama import ChatOllama
from langchain_core.messages import BaseMessage

from config import settings

logger = logging.getLogger("fraudguard-llm")

def extract_json(text: str) -> Dict[str, Any]:
    """Cleanly extract JSON dictionary from LLM response text."""
    text = text.strip()
    # Strip markdown code blocks if present
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
        text = text.strip()
        
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        return json.loads(match.group(0))
    return json.loads(text)

def call_ollama_structured(
    messages: list[BaseMessage],
    schema_cls: Optional[Type[BaseModel]] = None,
    fallback_fn: Optional[Callable[[], Dict[str, Any]]] = None,
    timeout_seconds: Optional[float] = None,
    max_retries: Optional[int] = None,
) -> Dict[str, Any]:
    """Invokes Ollama with retries, timeout, and schema validation.
    
    If all attempts fail, returns the result of fallback_fn() or an empty dict.
    Never raises an uncaught exception.
    """
    timeout = timeout_seconds if timeout_seconds is not None else settings.llm_timeout_seconds
    retries = max_retries if max_retries is not None else settings.llm_max_retries
    
    attempts = 0
    max_attempts = 1 + max(0, retries)
    last_error: Optional[Exception] = None
    
    while attempts < max_attempts:
        attempts += 1
        try:
            logger.info(f"Invoking Ollama ({settings.ollama_model}), attempt {attempts}/{max_attempts}...")
            # Initialize ChatOllama with request timeout
            llm = ChatOllama(
                base_url=settings.ollama_base_url,
                model=settings.ollama_model,
                temperature=settings.llm_temperature,
                timeout=timeout
            )
            
            response = llm.invoke(messages)
            raw_content = response.content if hasattr(response, "content") else str(response)
            
            # Extract JSON payload
            parsed = extract_json(raw_content)
            
            # Validate with Pydantic if schema provided
            if schema_cls:
                validated = schema_cls.model_validate(parsed)
                return validated.model_dump()
            return parsed
            
        except Exception as e:
            last_error = e
            logger.warning(
                f"LLM invocation attempt {attempts}/{max_attempts} failed: {type(e).__name__} - {e}"
            )
            if attempts < max_attempts:
                time.sleep(1.0)  # Brief backoff before single retry
                
    logger.error(
        f"All {max_attempts} LLM attempts failed. Invoking deterministic heuristic fallback. Last error: {last_error}"
    )
    if fallback_fn:
        return fallback_fn()
    return {}
