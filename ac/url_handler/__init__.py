"""URL handling for fetching and processing external content."""

from .models import URLContent, URLResult, URLType
from .detector import URLDetector
from .config import URLConfig

__all__ = [
    'URLContent',
    'URLResult', 
    'URLType',
    'URLDetector',
    'URLConfig',
]
