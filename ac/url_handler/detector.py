"""URL detection and type classification."""

import re
from typing import Optional, List, Tuple
from urllib.parse import urlparse, unquote

from .models import URLType, GitHubInfo


class URLDetector:
    """Detect and classify URLs in text."""
    
    # URL pattern that matches common URL formats
    URL_PATTERN = re.compile(
        r'https?://[^\s<>\[\]()"\'\`]+[^\s<>\[\]()"\'\`,.:;!?]',
        re.IGNORECASE
    )
    
    # GitHub URL patterns
    GITHUB_REPO_PATTERN = re.compile(
        r'^https?://github\.com/([^/]+)/([^/]+)/?$'
    )
    GITHUB_FILE_PATTERN = re.compile(
        r'^https?://github\.com/([^/]+)/([^/]+)/blob/([^/]+)/(.+)$'
    )
    GITHUB_TREE_PATTERN = re.compile(
        r'^https?://github\.com/([^/]+)/([^/]+)/tree/([^/]+)(?:/(.*))?$'
    )
    GITHUB_ISSUE_PATTERN = re.compile(
        r'^https?://github\.com/([^/]+)/([^/]+)/issues/(\d+)'
    )
    GITHUB_PR_PATTERN = re.compile(
        r'^https?://github\.com/([^/]+)/([^/]+)/pull/(\d+)'
    )
    GITHUB_RAW_PATTERN = re.compile(
        r'^https?://raw\.githubusercontent\.com/([^/]+)/([^/]+)/([^/]+)/(.+)$'
    )
    
    # Known documentation sites
    DOC_DOMAINS = {
        'docs.python.org',
        'docs.djangoproject.com',
        'flask.palletsprojects.com',
        'fastapi.tiangolo.com',
        'reactjs.org',
        'vuejs.org',
        'angular.io',
        'nodejs.org',
        'developer.mozilla.org',
        'docs.rs',
        'pkg.go.dev',
        'readthedocs.io',
        'readthedocs.org',
    }
    
    @classmethod
    def find_urls(cls, text: str) -> List[str]:
        """
        Find all URLs in text.
        
        Args:
            text: Text to search for URLs
            
        Returns:
            List of URL strings found
        """
        return cls.URL_PATTERN.findall(text)
    
    @classmethod
    def detect_type(cls, url: str) -> Tuple[URLType, Optional[GitHubInfo]]:
        """
        Detect the type of URL and extract metadata.
        
        Args:
            url: URL to classify
            
        Returns:
            Tuple of (URLType, optional GitHubInfo)
        """
        url = url.strip()
        
        # Check GitHub patterns first
        github_info = cls._parse_github_url(url)
        if github_info:
            url_type = cls._github_info_to_type(github_info)
            return url_type, github_info
        
        # Check for documentation sites
        if cls._is_documentation_site(url):
            return URLType.DOCUMENTATION, None
        
        # Generic web URL
        parsed = urlparse(url)
        if parsed.scheme in ('http', 'https') and parsed.netloc:
            return URLType.GENERIC_WEB, None
        
        return URLType.UNKNOWN, None
    
    @classmethod
    def _parse_github_url(cls, url: str) -> Optional[GitHubInfo]:
        """Parse GitHub URL into GitHubInfo."""
        # GitHub raw file
        match = cls.GITHUB_RAW_PATTERN.match(url)
        if match:
            return GitHubInfo(
                owner=match.group(1),
                repo=match.group(2),
                branch=match.group(3),
                path=unquote(match.group(4)),
            )
        
        # GitHub file (blob)
        match = cls.GITHUB_FILE_PATTERN.match(url)
        if match:
            return GitHubInfo(
                owner=match.group(1),
                repo=match.group(2),
                branch=match.group(3),
                path=unquote(match.group(4)),
            )
        
        # GitHub tree (directory)
        match = cls.GITHUB_TREE_PATTERN.match(url)
        if match:
            return GitHubInfo(
                owner=match.group(1),
                repo=match.group(2),
                branch=match.group(3),
                path=unquote(match.group(4)) if match.group(4) else None,
            )
        
        # GitHub issue
        match = cls.GITHUB_ISSUE_PATTERN.match(url)
        if match:
            return GitHubInfo(
                owner=match.group(1),
                repo=match.group(2),
                issue_number=int(match.group(3)),
            )
        
        # GitHub PR
        match = cls.GITHUB_PR_PATTERN.match(url)
        if match:
            return GitHubInfo(
                owner=match.group(1),
                repo=match.group(2),
                pr_number=int(match.group(3)),
            )
        
        # GitHub repo (must be last - most general)
        match = cls.GITHUB_REPO_PATTERN.match(url)
        if match:
            return GitHubInfo(
                owner=match.group(1),
                repo=match.group(2),
            )
        
        return None
    
    @classmethod
    def _github_info_to_type(cls, info: GitHubInfo) -> URLType:
        """Determine URL type from GitHubInfo."""
        if info.issue_number:
            return URLType.GITHUB_ISSUE
        if info.pr_number:
            return URLType.GITHUB_PR
        if info.path:
            return URLType.GITHUB_FILE
        return URLType.GITHUB_REPO
    
    @classmethod
    def _is_documentation_site(cls, url: str) -> bool:
        """Check if URL is a known documentation site."""
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        
        # Direct match
        if domain in cls.DOC_DOMAINS:
            return True
        
        # Check for readthedocs subdomains
        if domain.endswith('.readthedocs.io') or domain.endswith('.readthedocs.org'):
            return True
        
        # Check for common doc path patterns
        path = parsed.path.lower()
        if any(seg in path for seg in ['/docs/', '/documentation/', '/api/', '/reference/']):
            return True
        
        return False
    
    @classmethod
    def extract_urls_with_types(cls, text: str) -> List[Tuple[str, URLType, Optional[GitHubInfo]]]:
        """
        Find all URLs in text and classify them.
        
        Args:
            text: Text to search
            
        Returns:
            List of (url, type, github_info) tuples
        """
        urls = cls.find_urls(text)
        results = []
        seen = set()
        
        for url in urls:
            if url in seen:
                continue
            seen.add(url)
            url_type, github_info = cls.detect_type(url)
            results.append((url, url_type, github_info))
        
        return results
