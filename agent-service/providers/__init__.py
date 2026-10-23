"""Data Providers package for FraudGuard AI.
"""

from .base import DataProvider
from .factory import get_data_provider

__all__ = ["DataProvider", "get_data_provider"]
