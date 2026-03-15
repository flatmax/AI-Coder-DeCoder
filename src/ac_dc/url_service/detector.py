"""URL detection and classification."""

import re
from typing import Optional

from ac_dc.url_service.models import GitHubInfo, URLType

# URL pattern: http(s)://non-whitespace, non-bracket
_URL_RE = re.compile(
    r'https?://[^\s<>\[\](){}\'"]+',
)

# Trailing punctuation to strip
_TRAILING_PUNCT = re.compile(r'[.,;:!?)]+$')

# GitHub patterns
_GH_REPO_RE = re.compile(
    r'^https?://github\.com/([^/]+)/([^/]+?)(?:\.git)?/?$'
)
_GH_FILE_RE = re.compile(
    r'^https?://github\.com/([^/]+)/([^/]+)/blob/([^/]+)/(.+)$'
)
_GH_ISSUE_RE = re.compile(
    r'^https?://github\.com/([^/]+)/([^/]+)/issues/(\d+)'
)
_GH_PR_RE = re.compile(
    r'^https?://github\.com/([^/]+)/([^/]+)/pull/(\d+)'
)
_GH_RAW_RE = re.compile(
    r'^https?://raw\.githubusercontent\.com/([^/]+)/([^/]+)/([^/]+)/(.+)$'
)

# Known documentation domains
_DOC_DOMAINS = {
    "docs.python.org",
    "developer.mozilla.org",
    "devdocs.io",
}

# Documentation path patterns
_DOC_PATH_PATTERNS = (
    "/docs/", "/documentation/", "/api/", "/reference/",
)


def detect_urls(text: str) -> list[dict]:
    """Find and classify URLs in text.

    Returns list of {url, type, display_name} dicts.
    Deduplicates within same text.
    """
    seen: set[str] = set()
    results = []

    for match in _URL_RE.finditer(text):
        url = match.group(0)
        # Strip trailing punctuation
        url = _TRAILING_PUNCT.sub("", url)
        # Strip trailing comma
        url = url.rstrip(",")

        if url in seen:
            continue
        seen.add(url)

        url_type, github_info = classify_url(url)
        from ac_dc.url_service.models import display_name as dn
        results.append({
            "url": url,
            "type": url_type.value,
            "display_name": dn(url, url_type, github_info),
        })

    return results


def classify_url(url: str) -> tuple[URLType, Optional[GitHubInfo]]:
    """Classify a URL and extract structured info."""
    # GitHub raw file
    m = _GH_RAW_RE.match(url)
    if m:
        return URLType.GITHUB_FILE, GitHubInfo(
            owner=m.group(1), repo=m.group(2),
            branch=m.group(3), path=m.group(4),
        )

    # GitHub issue
    m = _GH_ISSUE_RE.match(url)
    if m:
        return URLType.GITHUB_ISSUE, GitHubInfo(
            owner=m.group(1), repo=m.group(2),
            issue_number=int(m.group(3)),
        )

    # GitHub PR
    m = _GH_PR_RE.match(url)
    if m:
        return URLType.GITHUB_PR, GitHubInfo(
            owner=m.group(1), repo=m.group(2),
            pr_number=int(m.group(3)),
        )

    # GitHub file
    m = _GH_FILE_RE.match(url)
    if m:
        return URLType.GITHUB_FILE, GitHubInfo(
            owner=m.group(1), repo=m.group(2),
            branch=m.group(3), path=m.group(4),
        )

    # GitHub repo
    m = _GH_REPO_RE.match(url)
    if m:
        return URLType.GITHUB_REPO, GitHubInfo(
            owner=m.group(1), repo=m.group(2),
        )

    # Documentation
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        hostname = parsed.hostname or ""

        # Known doc domains
        if hostname in _DOC_DOMAINS:
            return URLType.DOCUMENTATION, None

        # ReadTheDocs subdomains
        if hostname.endswith(".readthedocs.io") or hostname.endswith(".readthedocs.org"):
            return URLType.DOCUMENTATION, None

        # Doc path patterns
        path = parsed.path.lower()
        for pattern in _DOC_PATH_PATTERNS:
            if pattern in path:
                return URLType.DOCUMENTATION, None
    except Exception:
        pass

    # Reject non-http schemes
    if not url.startswith(("http://", "https://")):
        return URLType.UNKNOWN, None

    return URLType.GENERIC_WEB, None


def select_summary_type(
    url_type: URLType,
    has_symbol_map: bool = False,
    user_text: str = "",
) -> str:
    """Auto-select the appropriate summary type."""
    lower = user_text.lower() if user_text else ""

    # User hint overrides
    if "how to" in lower or "install" in lower or "setup" in lower:
        return "usage"
    if "api" in lower:
        return "api"
    if "architecture" in lower or "design" in lower:
        return "architecture"
    if "compare" in lower or "evaluate" in lower or "alternative" in lower:
        return "evaluation"

    # Auto-selection by type
    if url_type == URLType.GITHUB_REPO:
        return "architecture" if has_symbol_map else "brief"
    if url_type == URLType.DOCUMENTATION:
        return "usage"

    return "brief"