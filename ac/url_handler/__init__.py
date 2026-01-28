"""URL handling for fetching and processing external content."""

from .models import URLContent, URLResult, URLType
from .detector import URLDetector
from .config import URLConfig
from .github_handler import GitHubHandler

__all__ = [
    'URLContent',
    'URLResult', 
    'URLType',
    'URLDetector',
    'URLConfig',
    'GitHubHandler',
]
