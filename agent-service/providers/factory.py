"""Data Provider Factory for FraudGuard AI.

Returns the configured DataProvider singleton based on settings.data_provider_mode.
"""

import logging
from typing import Optional
from config import settings
from .base import DataProvider
from .mock_provider import MockDataProvider
from .csv_provider import CsvDataProvider
from .mongo_provider import MongoDataProvider

logger = logging.getLogger("fraudguard-provider-factory")

_CURRENT_PROVIDER: Optional[DataProvider] = None

def get_data_provider() -> DataProvider:
    """Return the active DataProvider instance based on system configuration."""
    global _CURRENT_PROVIDER
    if _CURRENT_PROVIDER is not None:
        return _CURRENT_PROVIDER

    mode = settings.data_provider_mode.lower()
    logger.info(f"Initializing DataProvider for mode: '{mode}'")

    if mode == "csv":
        provider = CsvDataProvider()
        if not provider.is_loaded:
            logger.warning("CSV data files not fully present. Provider will fall back to mock fixtures where needed.")
        _CURRENT_PROVIDER = provider
    elif mode == "mongo":
        _CURRENT_PROVIDER = MongoDataProvider()
    else:
        _CURRENT_PROVIDER = MockDataProvider()

    return _CURRENT_PROVIDER

def set_data_provider(provider: DataProvider):
    """Override provider explicitly (useful for tests)."""
    global _CURRENT_PROVIDER
    _CURRENT_PROVIDER = provider
