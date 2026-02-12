"""URL handler — detection, classification, fetching, summarization, and service.

Detects URLs in user input, fetches and extracts content,
optionally summarizes via LLM, caches results, and formats for prompt injection.
"""

import hashlib
import html
import logging
import os
import re
import subprocess
import tempfile
import time
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse
from urllib.request import urlopen, Request
from urllib.error import URLError

import litellm

logger = logging.getLogger(__name__)

# Known documentation domains
DOC_DOMAINS = {
    "docs.python.org",
    "developer.mozilla.org",
    "devdocs.io",
    "wiki.python.org",
}

# ReadTheDocs pattern
READTHEDOCS_RE = re.compile(r"\.readthedocs\.(io|org)$")

# URL detection regex
URL_RE = re.compile(
    r"https?://[^\s\[\](){}<>\"']+",
)

# Trailing punctuation to strip
TRAILING_PUNCT = re.compile(r"[.,;:!?)]+$")

# GitHub patterns
GITHUB_REPO_RE = re.compile(
    r"^https?://github\.com/([^/]+)/([^/]+?)(?:\.git)?/?$"
)
GITHUB_FILE_RE = re.compile(
    r"^https?://github\.com/([^/]+)/([^/]+)/blob/([^/]+)/(.+)$"
)
GITHUB_ISSUE_RE = re.compile(
    r"^https?://github\.com/([^/]+)/([^/]+)/issues/(\d+)"
)
GITHUB_PR_RE = re.compile(
    r"^https?://github\.com/([^/]+)/([^/]+)/pull/(\d+)"
)


class URLType(str, Enum):
    GITHUB_REPO = "github_repo"
    GITHUB_FILE = "github_file"
    GITHUB_ISSUE = "github_issue"
    GITHUB_PR = "github_pr"
    DOCUMENTATION = "documentation"
    GENERIC = "generic"


class SummaryType(str, Enum):
    BRIEF = "BRIEF"
    USAGE = "USAGE"
    API = "API"
    ARCHITECTURE = "ARCHITECTURE"
    EVALUATION = "EVALUATION"


@dataclass
class GitHubInfo:
    owner: str = ""
    repo: str = ""
    branch: Optional[str] = None
    path: Optional[str] = None
    issue_number: Optional[int] = None
    pr_number: Optional[int] = None

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, d):
        if d is None:
            return None
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


@dataclass
class URLContent:
    url: str = ""
    url_type: str = "generic"
    title: Optional[str] = None
    description: Optional[str] = None
    content: Optional[str] = None
    symbol_map: Optional[str] = None
    readme: Optional[str] = None
    github_info: Optional[GitHubInfo] = None
    fetched_at: Optional[str] = None
    error: Optional[str] = None
    summary: Optional[str] = None
    summary_type: Optional[str] = None

    def format_for_prompt(self, max_length=50000):
        """Format content for LLM prompt inclusion.

        Priority: summary > readme > content.
        Symbol map appended if present. Truncated at max_length.
        """
        parts = [f"## {self.url}"]
        if self.title:
            parts.append(f"**{self.title}**")

        # Choose best content
        body = self.summary or self.readme or self.content or ""
        if len(body) > max_length:
            body = body[:max_length] + "\n\n... (truncated)"
        if body:
            parts.append(body)

        if self.symbol_map:
            parts.append(f"\n### Symbol Map\n{self.symbol_map}")

        return "\n\n".join(parts)

    def to_dict(self):
        d = asdict(self)
        if self.github_info:
            d["github_info"] = self.github_info.to_dict()
        return d

    @classmethod
    def from_dict(cls, d):
        if d is None:
            return cls()
        d = dict(d)
        gi = d.pop("github_info", None)
        # Remove internal cache fields
        d.pop("_cached_at", None)
        obj = cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})
        if gi:
            obj.github_info = GitHubInfo.from_dict(gi)
        return obj


def detect_urls(text):
    """Find and classify URLs in text.

    Returns list of {url, url_type, display_name} dicts. Deduplicated.
    """
    if not text:
        return []

    matches = URL_RE.findall(text)
    seen = set()
    results = []

    for raw_url in matches:
        # Strip trailing punctuation
        url = TRAILING_PUNCT.sub("", raw_url)
        if url in seen:
            continue
        seen.add(url)

        url_type = classify_url(url)
        results.append({
            "url": url,
            "url_type": url_type.value,
            "display_name": display_name(url, url_type),
        })

    return results


def classify_url(url):
    """Classify a URL into a URLType."""
    # GitHub patterns (order matters — more specific first)
    if GITHUB_ISSUE_RE.match(url):
        return URLType.GITHUB_ISSUE
    if GITHUB_PR_RE.match(url):
        return URLType.GITHUB_PR
    if GITHUB_FILE_RE.match(url):
        return URLType.GITHUB_FILE
    if GITHUB_REPO_RE.match(url):
        return URLType.GITHUB_REPO

    # Documentation
    parsed = urlparse(url)
    hostname = parsed.hostname or ""

    if hostname in DOC_DOMAINS:
        return URLType.DOCUMENTATION
    if READTHEDOCS_RE.search(hostname):
        return URLType.DOCUMENTATION

    path = parsed.path or ""
    if any(seg in path for seg in ("/docs/", "/api/", "/reference/")):
        return URLType.DOCUMENTATION

    return URLType.GENERIC


def _parse_github_info(url, url_type):
    """Extract GitHubInfo from a URL."""
    if url_type == URLType.GITHUB_REPO:
        m = GITHUB_REPO_RE.match(url)
        if m:
            return GitHubInfo(owner=m.group(1), repo=m.group(2))
    elif url_type == URLType.GITHUB_FILE:
        m = GITHUB_FILE_RE.match(url)
        if m:
            return GitHubInfo(
                owner=m.group(1), repo=m.group(2),
                branch=m.group(3), path=m.group(4),
            )
    elif url_type == URLType.GITHUB_ISSUE:
        m = GITHUB_ISSUE_RE.match(url)
        if m:
            return GitHubInfo(
                owner=m.group(1), repo=m.group(2),
                issue_number=int(m.group(3)),
            )
    elif url_type == URLType.GITHUB_PR:
        m = GITHUB_PR_RE.match(url)
        if m:
            return GitHubInfo(
                owner=m.group(1), repo=m.group(2),
                pr_number=int(m.group(3)),
            )
    return None


def display_name(url, url_type=None):
    """Generate a short display name for a URL.

    GitHub: owner/repo, owner/repo/filename, owner/repo#N, owner/repo!N
    Generic: hostname/path (truncated to 40 chars).
    """
    if url_type is None:
        url_type = classify_url(url)

    if url_type == URLType.GITHUB_REPO:
        m = GITHUB_REPO_RE.match(url)
        if m:
            return f"{m.group(1)}/{m.group(2)}"

    if url_type == URLType.GITHUB_FILE:
        m = GITHUB_FILE_RE.match(url)
        if m:
            filename = m.group(4).rsplit("/", 1)[-1]
            return f"{m.group(1)}/{m.group(2)}/{filename}"

    if url_type == URLType.GITHUB_ISSUE:
        m = GITHUB_ISSUE_RE.match(url)
        if m:
            return f"{m.group(1)}/{m.group(2)}#{m.group(3)}"

    if url_type == URLType.GITHUB_PR:
        m = GITHUB_PR_RE.match(url)
        if m:
            return f"{m.group(1)}/{m.group(2)}!{m.group(3)}"

    # Generic
    parsed = urlparse(url)
    hostname = parsed.hostname or ""
    path = parsed.path.rstrip("/") or ""
    name = f"{hostname}{path}"
    if len(name) > 40:
        name = name[:37] + "..."
    return name


def select_summary_type(url_type, has_symbol_map=False, user_text=""):
    """Select the appropriate summary type based on URL type and context.

    User text keywords can override the default.
    """
    text_lower = user_text.lower() if user_text else ""

    # User keyword overrides
    if "how to" in text_lower or "usage" in text_lower or "install" in text_lower:
        return SummaryType.USAGE
    if "api" in text_lower:
        return SummaryType.API
    if "architecture" in text_lower or "design" in text_lower:
        return SummaryType.ARCHITECTURE
    if "compare" in text_lower or "evaluation" in text_lower or "alternatives" in text_lower:
        return SummaryType.EVALUATION

    # Auto-select by URL type
    if isinstance(url_type, str):
        url_type = URLType(url_type)

    if url_type == URLType.GITHUB_REPO:
        return SummaryType.ARCHITECTURE if has_symbol_map else SummaryType.BRIEF
    if url_type == URLType.DOCUMENTATION:
        return SummaryType.USAGE

    return SummaryType.BRIEF


def extract_html_content(html_text):
    """Extract readable content from HTML.

    Primary: trafilatura. Fallback: basic tag stripping.

    Returns (title, content) tuple.
    """
    title = None
    content = None

    # Extract title
    title_match = re.search(r"<title[^>]*>(.*?)</title>", html_text, re.IGNORECASE | re.DOTALL)
    if title_match:
        title = html.unescape(title_match.group(1)).strip()

    # Try trafilatura first
    try:
        import trafilatura
        content = trafilatura.extract(html_text)
        if content:
            return title, content
    except (ImportError, Exception):
        pass

    # Fallback: basic HTML stripping
    text = html_text
    # Remove scripts and styles
    text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.IGNORECASE | re.DOTALL)
    # Remove tags
    text = re.sub(r"<[^>]+>", " ", text)
    # Decode entities
    text = html.unescape(text)
    # Clean whitespace
    text = re.sub(r"\s+", " ", text).strip()

    return title, text if text else None


def _fetch_web_page(url, timeout=30):
    """Fetch a web page and extract content.

    Returns URLContent.
    """
    result = URLContent(url=url, url_type=URLType.GENERIC.value)
    try:
        req = Request(url, headers={"User-Agent": "Mozilla/5.0 ac-dc URL fetcher"})
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            try:
                html_text = raw.decode("utf-8")
            except UnicodeDecodeError:
                html_text = raw.decode("latin-1")

        title, content = extract_html_content(html_text)
        result.title = title
        result.content = content
        result.fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    except Exception as e:
        result.error = str(e)
        logger.warning(f"Failed to fetch {url}: {e}")

    return result


def _fetch_github_file(url, github_info):
    """Fetch a GitHub file via raw content URL.

    Returns URLContent.
    """
    result = URLContent(
        url=url,
        url_type=URLType.GITHUB_FILE.value,
        github_info=github_info,
    )

    owner = github_info.owner
    repo = github_info.repo
    branch = github_info.branch or "main"
    path = github_info.path or ""

    raw_url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"

    try:
        req = Request(raw_url, headers={"User-Agent": "Mozilla/5.0 ac-dc URL fetcher"})
        with urlopen(req, timeout=30) as resp:
            content = resp.read().decode("utf-8")
        result.content = content
        result.title = path.rsplit("/", 1)[-1] if path else f"{owner}/{repo}"
        result.fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    except Exception:
        # Retry with "master" if "main" failed
        if branch == "main":
            raw_url_master = f"https://raw.githubusercontent.com/{owner}/{repo}/master/{path}"
            try:
                req = Request(raw_url_master, headers={"User-Agent": "Mozilla/5.0 ac-dc URL fetcher"})
                with urlopen(req, timeout=30) as resp:
                    content = resp.read().decode("utf-8")
                result.content = content
                result.title = path.rsplit("/", 1)[-1] if path else f"{owner}/{repo}"
                result.fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            except Exception as e:
                result.error = str(e)
                logger.warning(f"Failed to fetch GitHub file {url}: {e}")
        else:
            result.error = f"Failed to fetch {raw_url}"
            logger.warning(f"Failed to fetch GitHub file {url}")

    return result


def _fetch_github_repo(url, github_info, symbol_index_cls=None):
    """Fetch a GitHub repository: shallow clone, extract README and symbol map.

    Returns URLContent.
    """
    result = URLContent(
        url=url,
        url_type=URLType.GITHUB_REPO.value,
        github_info=github_info,
    )

    owner = github_info.owner
    repo_name = github_info.repo
    clone_url = f"https://github.com/{owner}/{repo_name}.git"

    tmp_dir = None
    try:
        tmp_dir = tempfile.mkdtemp(prefix="ac-dc-gh-")
        clone_path = os.path.join(tmp_dir, repo_name)

        # Shallow clone with timeout
        proc = subprocess.run(
            ["git", "clone", "--depth", "1", clone_url, clone_path],
            capture_output=True,
            timeout=120,
        )
        if proc.returncode != 0:
            result.error = f"Clone failed: {proc.stderr.decode(errors='replace')[:200]}"
            return result

        # Find README
        for name in ("README.md", "README.rst", "README.txt", "README"):
            readme_path = os.path.join(clone_path, name)
            if os.path.exists(readme_path):
                try:
                    result.readme = Path(readme_path).read_text(encoding="utf-8")
                    result.title = f"{owner}/{repo_name}"
                except (OSError, UnicodeDecodeError):
                    pass
                break

        # Generate symbol map if index class available
        if symbol_index_cls:
            try:
                idx = symbol_index_cls(clone_path)
                idx.index_repo()
                result.symbol_map = idx.get_symbol_map()
            except Exception as e:
                logger.warning(f"Symbol map generation failed for {url}: {e}")

        result.fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    except subprocess.TimeoutExpired:
        result.error = "Clone timed out (120s)"
        logger.warning(f"GitHub repo clone timed out: {url}")
    except Exception as e:
        result.error = str(e)
        logger.warning(f"Failed to fetch GitHub repo {url}: {e}")
    finally:
        # Cleanup
        if tmp_dir:
            import shutil
            try:
                shutil.rmtree(tmp_dir, ignore_errors=True)
            except Exception:
                pass

    return result


async def _summarize_content(url_content, summary_type, model):
    """Summarize URL content using an LLM call.

    Args:
        url_content: URLContent object
        summary_type: SummaryType enum value
        model: model name for summarization

    Returns:
        summary string or None
    """
    body = url_content.readme or url_content.content or ""
    if not body:
        return None

    focus_prompts = {
        SummaryType.BRIEF: "Provide a 2-3 paragraph overview of this content.",
        SummaryType.USAGE: "Focus on installation, usage patterns, and key imports.",
        SummaryType.API: "Focus on classes, functions, signatures, and API surface.",
        SummaryType.ARCHITECTURE: "Focus on modules, design patterns, and data flow.",
        SummaryType.EVALUATION: "Evaluate maturity, dependencies, and alternatives.",
    }

    prompt = focus_prompts.get(summary_type, focus_prompts[SummaryType.BRIEF])

    # Truncate body for summarization
    max_body = 30000
    if len(body) > max_body:
        body = body[:max_body] + "\n\n... (truncated)"

    user_content = f"{prompt}\n\nContent from {url_content.url}:\n\n{body}"
    if url_content.symbol_map:
        user_content += f"\n\nSymbol Map:\n{url_content.symbol_map}"

    try:
        response = litellm.completion(
            model=model,
            messages=[
                {"role": "system", "content": "Summarize the following content concisely."},
                {"role": "user", "content": user_content},
            ],
            stream=False,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        logger.warning(f"Summarization failed for {url_content.url}: {e}")
        return None


class URLService:
    """Manages the lifecycle of URL content: detection, fetching, caching, formatting.

    State:
        _cache: filesystem cache for fetched content
        _model: smaller model for summarization
        _fetched: dict of fetched URLContent objects (in-memory, keyed by URL)
    """

    def __init__(self, cache=None, model=None, symbol_index_cls=None):
        """Initialize URL service.

        Args:
            cache: URLCache instance (or creates default)
            model: model name for summarization
            symbol_index_cls: SymbolIndex class for GitHub repo symbol maps
        """
        self._cache = cache
        self._model = model
        self._symbol_index_cls = symbol_index_cls
        self._fetched = {}  # url -> URLContent

    def detect_urls(self, text):
        """Find and classify URLs in text.

        Returns list of {url, url_type, display_name} dicts.
        """
        return detect_urls(text)

    async def fetch_url(self, url, use_cache=True, summarize=True,
                        summary_type=None, user_text=""):
        """Fetch URL content, cache, and optionally summarize.

        Args:
            url: URL to fetch
            use_cache: check cache first
            summarize: generate summary via LLM
            summary_type: explicit summary type override
            user_text: user message text for auto-selecting summary type

        Returns:
            URLContent object
        """
        # Check cache
        if use_cache and self._cache:
            cached = self._cache.get(url)
            if cached:
                content = URLContent.from_dict(cached)
                self._fetched[url] = content
                return content

        # Classify and fetch
        url_type = classify_url(url)
        github_info = _parse_github_info(url, url_type)

        if url_type == URLType.GITHUB_REPO:
            content = _fetch_github_repo(url, github_info, self._symbol_index_cls)
        elif url_type == URLType.GITHUB_FILE:
            content = _fetch_github_file(url, github_info)
        else:
            content = _fetch_web_page(url)
            content.url_type = url_type.value

        # Don't cache errors
        if content.error:
            self._fetched[url] = content
            return content

        # Summarize
        if summarize and self._model and not content.error:
            st = summary_type
            if st is None:
                st = select_summary_type(
                    url_type,
                    has_symbol_map=bool(content.symbol_map),
                    user_text=user_text,
                )
            elif isinstance(st, str):
                st = SummaryType(st)

            summary = await _summarize_content(content, st, self._model)
            if summary:
                content.summary = summary
                content.summary_type = st.value

        # Cache result
        if self._cache and not content.error:
            self._cache.set(url, content.to_dict())

        self._fetched[url] = content
        return content

    def get_url_content(self, url):
        """Return cached/fetched content for a URL.

        Returns URLContent or error URLContent if not fetched.
        """
        if url in self._fetched:
            return self._fetched[url]
        return URLContent(url=url, error="URL not yet fetched")

    def invalidate_url_cache(self, url):
        """Remove URL from cache and fetched dict."""
        if self._cache:
            self._cache.invalidate(url)
        self._fetched.pop(url, None)

    def clear_url_cache(self):
        """Clear all cached and fetched URLs."""
        if self._cache:
            self._cache.clear()
        self._fetched.clear()

    def get_fetched_urls(self):
        """List all fetched URLContent objects."""
        return list(self._fetched.values())

    def remove_fetched(self, url):
        """Remove from in-memory fetched dict."""
        self._fetched.pop(url, None)

    def clear_fetched(self):
        """Clear in-memory fetched dict."""
        self._fetched.clear()

    def format_url_context(self, urls=None, excluded=None, max_length=50000):
        """Format fetched URLs for prompt injection.

        Args:
            urls: list of URLs to include (None = all fetched)
            excluded: set of URLs to exclude
            max_length: max chars per URL content

        Returns:
            Formatted string or empty string.
        """
        excluded = set(excluded or [])
        if urls is None:
            urls = list(self._fetched.keys())

        parts = []
        for url in urls:
            if url in excluded:
                continue
            content = self._fetched.get(url)
            if content is None or content.error:
                continue
            parts.append(content.format_for_prompt(max_length=max_length))

        return "\n---\n".join(parts)