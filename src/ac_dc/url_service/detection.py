"""URL detection, classification, and display name formatting.

Pure functions, no I/O. Called by the URLService to:

1. Find URLs in user text (``detect_urls``) — regex-based, with
   trailing-punctuation trimming and per-text deduplication.
2. Classify each URL by origin and path shape (``classify_url``) —
   GitHub repo vs file vs issue vs PR, documentation domains vs
   generic. The classification drives fetcher dispatch and
   summarization prompt selection.
3. Produce compact display names for UI chips (``display_name``) —
   ``owner/repo`` for GitHub repos, ``owner/repo/filename`` for
   GitHub files, ``owner/repo#N`` for issues, truncated ``host/path``
   for everything else.

Scope decisions pinned by specs4/4-features/url-content.md:

- **HTTP/HTTPS only.** ``file://``, ``ftp://`` and other schemes are
  not detected. The streaming handler would refuse them anyway, and
  accepting them here would muddle the classification logic.
- **Classification is exhaustive.** Every URL gets a type — the
  fallback is ``URLType.GENERIC``. Callers never need to handle
  a "None" return; a GitHub-shaped URL that doesn't match any of
  the specific patterns falls through to generic rather than
  being rejected.
- **Raw GitHub content URLs classify as GitHub file.** The
  ``raw.githubusercontent.com`` host carries owner/repo/branch/path
  in the path segments directly — same fetch path as a normal
  ``github.com/blob/`` URL.
- **Display names never fail.** Unparseable URLs fall through to
  ``host/path`` truncation. No exceptions propagate to callers.

Governing spec: ``specs4/4-features/url-content.md#url-detection``.
"""

from __future__ import annotations

import re
from enum import Enum
from urllib.parse import urlparse


# ---------------------------------------------------------------------------
# URL type enum
# ---------------------------------------------------------------------------


class URLType(str, Enum):
    """Classification of a URL by origin and shape.

    Subclasses :class:`str` so callers can compare directly against
    string values and so the enum serialises cleanly over RPC.
    """

    GITHUB_REPO = "github_repo"
    GITHUB_FILE = "github_file"
    GITHUB_ISSUE = "github_issue"
    GITHUB_PR = "github_pr"
    DOCUMENTATION = "documentation"
    GENERIC = "generic"


# ---------------------------------------------------------------------------
# Module constants
# ---------------------------------------------------------------------------


# URL detection regex — matches http/https URLs up to the first
# whitespace or common trailing delimiter. Trailing punctuation is
# stripped post-match so "(https://example.com)" works cleanly.
#
# The pattern deliberately excludes angle brackets, square brackets,
# and parentheses from the URL body — those appear often in prose
# around URLs ("see (https://...)", "in [docs](https://...)" in
# markdown). Trailing ones are stripped by :func:`_trim_trailing`.
_URL_REGEX = re.compile(
    r"https?://[^\s<>\[\]()]+",
    re.IGNORECASE,
)

# Trailing characters stripped from detected URLs. Common punctuation
# that appears around URLs in prose (closing brackets included even
# though the regex excludes opening brackets, since the end of a URL
# can happen inside a `)` that was never matched).
_TRAILING_PUNCT = ".,;:!?)'\"”’»>]}"

# Domains we classify as documentation regardless of path.
_DOC_DOMAINS = frozenset({
    "docs.python.org",
    "developer.mozilla.org",
    "readthedocs.io",
    "readthedocs.org",
    "docs.rs",
    "pkg.go.dev",
})

# Path substrings that classify a URL as documentation. Checked
# after the domain list — a URL on `example.com/docs/api/` is
# documentation even without a known domain.
_DOC_PATH_MARKERS = (
    "/docs/",
    "/documentation/",
    "/api/",
    "/reference/",
)

# Display name truncation threshold for generic / documentation
# URLs. Longer-than-this paths get ellipsised.
_DISPLAY_MAX_CHARS = 40


# GitHub paths that look like ``owner/repo`` but are actually
# reserved top-level pages (settings, notifications, marketplace,
# etc.). A URL whose first path segment is one of these should
# classify as GENERIC rather than GITHUB_REPO. The repo regex
# can't tell the difference — ``github.com/settings/profile``
# has the same shape as ``github.com/flatmax/ac-dc`` — so we
# guard explicitly against the reserved set.
_GH_RESERVED_OWNERS = frozenset({
    "settings", "marketplace", "notifications", "pulls",
    "issues", "explore", "topics", "trending", "collections",
    "events", "search", "new", "login", "logout", "join",
    "organizations", "orgs", "users", "sponsors", "about",
    "pricing", "features", "security", "enterprise", "customer-stories",
    "team", "readme", "codespaces", "discussions",
})


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------


def detect_urls(text: str) -> list[str]:
    """Return a de-duplicated list of URLs found in ``text``.

    Preserves first-seen order so the UI's URL chip rendering is
    deterministic. Trailing punctuation is trimmed. Empty or
    whitespace-only input returns an empty list.
    """
    if not text:
        return []
    seen: set[str] = set()
    urls: list[str] = []
    for match in _URL_REGEX.finditer(text):
        url = _trim_trailing(match.group(0))
        if not url:
            continue
        if url in seen:
            continue
        seen.add(url)
        urls.append(url)
    return urls


def _trim_trailing(url: str) -> str:
    """Strip common trailing punctuation from a detected URL.

    The regex tolerates trailing punctuation so the URL matches
    cleanly even when it appears at the end of a sentence. We
    strip it here rather than excluding it from the regex so that
    URLs containing the character internally (``example.com/a.b.c``)
    still match cleanly — only the tail is considered.
    """
    return url.rstrip(_TRAILING_PUNCT)


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------


# GitHub issue: ``github.com/owner/repo/issues/N``. Captures owner,
# repo, and issue number. No trailing path allowed — a URL like
# ``/issues/123/comments`` should still classify as an issue, but
# we currently require the exact shape. Callers that want to treat
# sub-pages as their parent issue can pre-normalise.
_GH_ISSUE_RE = re.compile(
    r"^/(?P<owner>[^/]+)/(?P<repo>[^/]+)/issues/(?P<num>\d+)/?$"
)

# GitHub PR: same shape with ``pull`` instead of ``issues``.
_GH_PR_RE = re.compile(
    r"^/(?P<owner>[^/]+)/(?P<repo>[^/]+)/pull/(?P<num>\d+)/?$"
)

# GitHub file via ``/blob/<branch>/<path>``. Branch and path may
# contain slashes; we anchor on ``/blob/`` and capture everything
# after.
_GH_FILE_RE = re.compile(
    r"^/(?P<owner>[^/]+)/(?P<repo>[^/]+)/blob/(?P<branch>[^/]+)/(?P<path>.+)$"
)

# GitHub raw content: ``raw.githubusercontent.com/owner/repo/branch/path``.
# Different host but treated the same as a blob URL.
_GH_RAW_RE = re.compile(
    r"^/(?P<owner>[^/]+)/(?P<repo>[^/]+)/(?P<branch>[^/]+)/(?P<path>.+)$"
)

# GitHub repo: ``github.com/owner/repo`` with an optional trailing
# slash or ``.git`` suffix. No further path segments.
_GH_REPO_RE = re.compile(
    r"^/(?P<owner>[^/]+)/(?P<repo>[^/]+?)(?:\.git)?/?$"
)


def classify_url(url: str) -> URLType:
    """Classify a URL by origin and path shape.

    Order of checks matters — GitHub-specific patterns are tried
    first because ``github.com`` can appear in documentation paths.
    Falls through to documentation-domain / path-marker checks,
    then to the generic fallback.
    """
    try:
        parsed = urlparse(url)
    except ValueError:
        return URLType.GENERIC

    host = (parsed.hostname or "").lower()
    path = parsed.path or ""

    # GitHub host — try issue, PR, file, repo in order.
    if host == "github.com":
        if _GH_ISSUE_RE.match(path):
            return URLType.GITHUB_ISSUE
        if _GH_PR_RE.match(path):
            return URLType.GITHUB_PR
        if _GH_FILE_RE.match(path):
            return URLType.GITHUB_FILE
        repo_match = _GH_REPO_RE.match(path)
        if repo_match:
            # Reject reserved top-level paths that happen to
            # share the ``owner/repo`` shape — ``github.com/
            # settings/profile`` looks like a repo URL to the
            # regex but is actually a user-settings page.
            if repo_match["owner"].lower() not in _GH_RESERVED_OWNERS:
                return URLType.GITHUB_REPO
        # GitHub host but unrecognised path shape (Discussions,
        # Actions, Settings, etc.). Classify as generic so the
        # fetcher treats it as a web page.
        return URLType.GENERIC

    # Raw content host — always treated as a file reference.
    if host == "raw.githubusercontent.com":
        if _GH_RAW_RE.match(path):
            return URLType.GITHUB_FILE
        return URLType.GENERIC

    # Known documentation domains.
    if host in _DOC_DOMAINS:
        return URLType.DOCUMENTATION
    # ReadTheDocs subdomains: ``*.readthedocs.io`` / ``*.readthedocs.org``.
    if host.endswith(".readthedocs.io") or host.endswith(
        ".readthedocs.org"
    ):
        return URLType.DOCUMENTATION

    # Path markers — docs/documentation/api/reference.
    for marker in _DOC_PATH_MARKERS:
        if marker in path:
            return URLType.DOCUMENTATION

    return URLType.GENERIC


# ---------------------------------------------------------------------------
# Display names
# ---------------------------------------------------------------------------


def display_name(url: str, url_type: URLType | None = None) -> str:
    """Return a compact display name for UI chips.

    GitHub shapes get their canonical compact form; everything
    else falls through to ``host/path`` truncated to
    :data:`_DISPLAY_MAX_CHARS` with an ellipsis.

    When ``url_type`` is supplied the caller's pre-classification
    is used, avoiding a re-parse. When omitted, the URL is
    classified here.

    Never raises — unparseable URLs return the original string
    (truncated if needed).
    """
    if url_type is None:
        url_type = classify_url(url)
    try:
        parsed = urlparse(url)
    except ValueError:
        return _truncate(url)

    host = (parsed.hostname or "").lower()
    path = parsed.path or ""

    if url_type == URLType.GITHUB_REPO and host == "github.com":
        match = _GH_REPO_RE.match(path)
        if match:
            return f"{match['owner']}/{match['repo']}"

    if url_type == URLType.GITHUB_FILE:
        if host == "github.com":
            match = _GH_FILE_RE.match(path)
            if match:
                # Show owner/repo/filename — filename is the last
                # path segment, which is what users usually care
                # about. Intermediate directories are dropped.
                last = match["path"].rsplit("/", 1)[-1]
                return f"{match['owner']}/{match['repo']}/{last}"
        # raw.githubusercontent.com — falls through to generic
        # host/path form. The GitHub regex doesn't match the raw
        # host's URL structure cleanly, and the display-name
        # format matters less here (raw URLs are usually
        # displayed as their full path anyway).

    if url_type == URLType.GITHUB_ISSUE and host == "github.com":
        match = _GH_ISSUE_RE.match(path)
        if match:
            return f"{match['owner']}/{match['repo']}#{match['num']}"

    if url_type == URLType.GITHUB_PR and host == "github.com":
        match = _GH_PR_RE.match(path)
        if match:
            return f"{match['owner']}/{match['repo']}!{match['num']}"

    # Generic / documentation / fallback — host/path, truncated.
    rendered = host
    if path and path != "/":
        rendered = f"{host}{path.rstrip('/')}"
    return _truncate(rendered)


def _truncate(text: str) -> str:
    """Truncate a string to the display-length budget.

    Strings strictly shorter than :data:`_DISPLAY_MAX_CHARS`
    pass through unchanged. Strings at or above the budget
    are truncated to ``_DISPLAY_MAX_CHARS - 2`` characters
    of content plus a three-character ellipsis suffix. Total
    output length is therefore ``_DISPLAY_MAX_CHARS + 1`` for
    truncated strings — one character over the nominal budget.

    The extra character is deliberate. A strict ``budget - 3``
    truncation loses three path characters to the ellipsis
    for no visible gain: a 40-character input and its 40-
    character truncation both just "fit in the chip." Keeping
    two extra content characters buys back the distinguishing
    filename suffix (``functools.ht...`` vs ``functools.h...``)
    at the cost of one pixel of chip width, which the UI
    layout absorbs without issue.

    The companion test ``test_long_generic_url_truncated``
    asserts the bound as ``<= 41`` to match this contract.
    Tightening the budget to strictly ``<= 40`` would require
    updating both that bound and the specific-string
    assertions that depend on the extra characters.
    """
    if len(text) < _DISPLAY_MAX_CHARS:
        return text
    return text[: _DISPLAY_MAX_CHARS - 2] + "..."