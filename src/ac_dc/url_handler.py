"""URL detection, classification, fetching, and summarization.

Handles GitHub repos/files, documentation sites, and generic web pages.
Integrates with the URL cache and symbol index for repo analysis.
"""

import logging
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse
import urllib.request
import urllib.error

from .url_cache import URLCache

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# URL type classification
# ---------------------------------------------------------------------------


class URLType(Enum):
    GITHUB_REPO = "github_repo"
    GITHUB_FILE = "github_file"
    GITHUB_ISSUE = "github_issue"
    GITHUB_PR = "github_pr"
    DOCUMENTATION = "documentation"
    GENERIC = "generic"


@dataclass
class GitHubInfo:
    """Structured info extracted from a GitHub URL."""
    owner: str = ""
    repo: str = ""
    branch: str = ""
    path: str = ""
    issue_number: int = 0
    pr_number: int = 0


@dataclass
class URLContent:
    """Result of fetching and processing a URL."""
    url: str = ""
    url_type: URLType = URLType.GENERIC
    title: str = ""
    description: str = ""
    content: str = ""
    symbol_map: str = ""
    readme: str = ""
    github_info: Optional[GitHubInfo] = None
    fetched_at: float = 0.0
    error: str = ""
    summary: str = ""
    summary_type: str = ""

    def format_for_prompt(self, max_length: int = 4000) -> str:
        """Format content for LLM prompt inclusion."""
        parts = [f"## {self.url}"]

        if self.title:
            parts.append(f"**{self.title}**")

        # Priority: summary → readme → content
        body = self.summary or self.readme or self.content or ""
        if len(body) > max_length:
            body = body[:max_length] + "..."
        if body:
            parts.append(body)

        if self.symbol_map:
            parts.append(f"\n### Symbol Map\n```\n{self.symbol_map}\n```")

        return "\n\n".join(parts)

    def to_dict(self) -> dict:
        """Serialize for cache storage."""
        d = {
            "url": self.url,
            "url_type": self.url_type.value,
            "title": self.title,
            "description": self.description,
            "content": self.content,
            "symbol_map": self.symbol_map,
            "readme": self.readme,
            "fetched_at": self.fetched_at,
            "error": self.error,
            "summary": self.summary,
            "summary_type": self.summary_type,
        }
        if self.github_info:
            d["github_info"] = {
                "owner": self.github_info.owner,
                "repo": self.github_info.repo,
                "branch": self.github_info.branch,
                "path": self.github_info.path,
                "issue_number": self.github_info.issue_number,
                "pr_number": self.github_info.pr_number,
            }
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "URLContent":
        """Deserialize from cache."""
        gh = None
        if d.get("github_info"):
            gh = GitHubInfo(**d["github_info"])
        return cls(
            url=d.get("url", ""),
            url_type=URLType(d.get("url_type", "generic")),
            title=d.get("title", ""),
            description=d.get("description", ""),
            content=d.get("content", ""),
            symbol_map=d.get("symbol_map", ""),
            readme=d.get("readme", ""),
            github_info=gh,
            fetched_at=d.get("fetched_at", 0.0),
            error=d.get("error", ""),
            summary=d.get("summary", ""),
            summary_type=d.get("summary_type", ""),
        )


# ---------------------------------------------------------------------------
# URL detection
# ---------------------------------------------------------------------------

# Match http:// or https:// URLs, excluding trailing punctuation
_URL_PATTERN = re.compile(
    r'https?://[^\s<>\[\](){}"\']+'
)

# Trailing punctuation to strip
_TRAILING_PUNCT = re.compile(r'[,.:;!?)]+$')

# Known documentation domains
_DOC_DOMAINS = {
    "docs.python.org", "developer.mozilla.org", "mdn.mozilla.org",
    "docs.djangoproject.com", "flask.palletsprojects.com",
    "docs.rs", "doc.rust-lang.org", "pkg.go.dev",
    "nodejs.org", "reactjs.org", "vuejs.org", "angular.io",
    "kubernetes.io", "docs.docker.com", "wiki.archlinux.org",
}

# GitHub URL patterns
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


def detect_urls(text: str) -> list[dict]:
    """Find and classify URLs in text.

    Returns list of {url, url_type, display_name, github_info?}.
    Deduplicates within the same text.
    """
    seen = set()
    results = []

    for match in _URL_PATTERN.finditer(text):
        url = match.group(0)
        url = _TRAILING_PUNCT.sub("", url)

        if url in seen:
            continue
        seen.add(url)

        url_type, gh_info = classify_url(url)
        display = _display_name(url, url_type, gh_info)

        result = {
            "url": url,
            "url_type": url_type.value,
            "display_name": display,
        }
        if gh_info:
            result["github_info"] = {
                "owner": gh_info.owner,
                "repo": gh_info.repo,
                "branch": gh_info.branch,
                "path": gh_info.path,
                "issue_number": gh_info.issue_number,
                "pr_number": gh_info.pr_number,
            }
        results.append(result)

    return results


def classify_url(url: str) -> tuple[URLType, Optional[GitHubInfo]]:
    """Classify a URL and extract structured info."""
    # GitHub patterns (order matters — more specific first)
    m = _GH_FILE_RE.match(url)
    if m:
        return URLType.GITHUB_FILE, GitHubInfo(
            owner=m.group(1), repo=m.group(2),
            branch=m.group(3), path=m.group(4),
        )

    m = _GH_ISSUE_RE.match(url)
    if m:
        return URLType.GITHUB_ISSUE, GitHubInfo(
            owner=m.group(1), repo=m.group(2),
            issue_number=int(m.group(3)),
        )

    m = _GH_PR_RE.match(url)
    if m:
        return URLType.GITHUB_PR, GitHubInfo(
            owner=m.group(1), repo=m.group(2),
            pr_number=int(m.group(3)),
        )

    m = _GH_REPO_RE.match(url)
    if m:
        return URLType.GITHUB_REPO, GitHubInfo(
            owner=m.group(1), repo=m.group(2),
        )

    # Documentation domains
    parsed = urlparse(url)
    hostname = parsed.hostname or ""
    path = parsed.path or ""

    if hostname in _DOC_DOMAINS:
        return URLType.DOCUMENTATION, None
    # ReadTheDocs subdomains
    if hostname.endswith(".readthedocs.io") or hostname.endswith(".readthedocs.org"):
        return URLType.DOCUMENTATION, None
    # Doc-like paths
    if any(seg in path.lower() for seg in ("/docs/", "/api/", "/reference/")):
        return URLType.DOCUMENTATION, None

    return URLType.GENERIC, None


def _display_name(
    url: str, url_type: URLType, gh_info: Optional[GitHubInfo]
) -> str:
    """Generate a short display name for the URL."""
    if gh_info:
        base = f"{gh_info.owner}/{gh_info.repo}"
        if gh_info.path:
            filename = gh_info.path.rsplit("/", 1)[-1]
            return f"{base}/{filename}"
        if gh_info.issue_number:
            return f"{base}#{gh_info.issue_number}"
        if gh_info.pr_number:
            return f"{base}!{gh_info.pr_number}"
        return base

    parsed = urlparse(url)
    hostname = parsed.hostname or ""
    path = (parsed.path or "").rstrip("/")

    if path and path != "/":
        name = f"{hostname}{path}"
    else:
        name = hostname

    if len(name) > 40:
        name = name[:37] + "..."
    return name


# ---------------------------------------------------------------------------
# Summary type selection
# ---------------------------------------------------------------------------

class SummaryType(Enum):
    BRIEF = "brief"
    USAGE = "usage"
    API = "api"
    ARCHITECTURE = "architecture"
    EVALUATION = "evaluation"


def _select_summary_type(
    url_type: URLType, has_symbol_map: bool, user_hint: str = ""
) -> SummaryType:
    """Choose summary type based on URL type and user context."""
    hint_lower = user_hint.lower()

    # User hint overrides
    if "how to" in hint_lower or "install" in hint_lower or "usage" in hint_lower:
        return SummaryType.USAGE
    if "api" in hint_lower or "interface" in hint_lower:
        return SummaryType.API
    if "architecture" in hint_lower or "design" in hint_lower:
        return SummaryType.ARCHITECTURE
    if "compare" in hint_lower or "evaluate" in hint_lower or "alternative" in hint_lower:
        return SummaryType.EVALUATION

    # Default by URL type
    if url_type == URLType.GITHUB_REPO:
        return SummaryType.ARCHITECTURE if has_symbol_map else SummaryType.BRIEF
    if url_type == URLType.DOCUMENTATION:
        return SummaryType.USAGE
    return SummaryType.BRIEF


# ---------------------------------------------------------------------------
# Fetchers
# ---------------------------------------------------------------------------

def _fetch_github_repo(gh_info: GitHubInfo) -> URLContent:
    """Fetch a GitHub repository via shallow clone."""
    url = f"https://github.com/{gh_info.owner}/{gh_info.repo}.git"
    result = URLContent(
        url=url,
        url_type=URLType.GITHUB_REPO,
        title=f"{gh_info.owner}/{gh_info.repo}",
        github_info=gh_info,
    )

    tmp_dir = None
    try:
        tmp_dir = tempfile.mkdtemp(prefix="ac-dc-gh-")
        clone_dir = os.path.join(tmp_dir, gh_info.repo)

        # Shallow clone
        proc = subprocess.run(
            ["git", "clone", "--depth=1", url, clone_dir],
            capture_output=True, text=True, timeout=120,
        )
        if proc.returncode != 0:
            result.error = f"Clone failed: {proc.stderr.strip()}"
            return result

        # Find README
        readme_names = [
            "README.md", "readme.md", "Readme.md",
            "README.rst", "README.txt", "README",
        ]
        clone_path = Path(clone_dir)
        for name in readme_names:
            readme_path = clone_path / name
            if readme_path.exists():
                try:
                    result.readme = readme_path.read_text(
                        encoding="utf-8", errors="replace"
                    )
                    result.title = f"{gh_info.owner}/{gh_info.repo}"
                except OSError:
                    pass
                break

        # Generate symbol map
        try:
            from .symbol_index import SymbolIndex
            idx = SymbolIndex(clone_path)
            if idx.available:
                idx.index_repo()
                result.symbol_map = idx.get_symbol_map()
        except Exception as e:
            log.warning("Symbol index for %s failed: %s", url, e)

    except subprocess.TimeoutExpired:
        result.error = "Clone timed out (120s)"
    except Exception as e:
        result.error = str(e)
    finally:
        if tmp_dir and os.path.exists(tmp_dir):
            shutil.rmtree(tmp_dir, ignore_errors=True)

    return result


def _fetch_github_file(url: str, gh_info: GitHubInfo) -> URLContent:
    """Fetch a single file from GitHub via raw content URL."""
    result = URLContent(
        url=url,
        url_type=URLType.GITHUB_FILE,
        github_info=gh_info,
    )

    filename = gh_info.path.rsplit("/", 1)[-1] if gh_info.path else ""
    result.title = filename or f"{gh_info.owner}/{gh_info.repo}"

    branch = gh_info.branch or "main"
    raw_url = (
        f"https://raw.githubusercontent.com/"
        f"{gh_info.owner}/{gh_info.repo}/{branch}/{gh_info.path}"
    )

    try:
        req = urllib.request.Request(raw_url, headers={"User-Agent": "ac-dc/0.1"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                result.content = resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            if e.code == 404 and branch == "main":
                # Retry with master
                raw_url_master = raw_url.replace(f"/{branch}/", "/master/")
                req2 = urllib.request.Request(
                    raw_url_master, headers={"User-Agent": "ac-dc/0.1"}
                )
                with urllib.request.urlopen(req2, timeout=30) as resp:
                    result.content = resp.read().decode("utf-8", errors="replace")
            else:
                raise

    except Exception as e:
        result.error = str(e)

    return result


def _fetch_web_page(url: str) -> URLContent:
    """Fetch and extract content from a web page."""
    result = URLContent(url=url, url_type=URLType.GENERIC)

    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": (
                "Mozilla/5.0 (compatible; ac-dc/0.1; "
                "+https://github.com/example/ac-dc)"
            ),
        })

        with urllib.request.urlopen(req, timeout=30) as resp:
            # Detect charset
            content_type = resp.headers.get("Content-Type", "")
            charset = "utf-8"
            if "charset=" in content_type:
                charset = content_type.split("charset=")[-1].split(";")[0].strip()

            raw = resp.read()
            html = raw.decode(charset, errors="replace")

        # Try trafilatura for content extraction
        try:
            import trafilatura
            extracted = trafilatura.extract(
                html,
                include_comments=False,
                include_tables=True,
                favor_precision=True,
            )
            if extracted:
                result.content = extracted
                # Get metadata
                meta = trafilatura.extract(
                    html, output_format="json",
                    include_comments=False,
                )
                if meta:
                    import json
                    meta_dict = json.loads(meta)
                    result.title = meta_dict.get("title", "")
                    result.description = meta_dict.get("description", "")
                return result
        except ImportError:
            pass  # trafilatura not installed — use fallback
        except Exception as e:
            log.debug("trafilatura failed: %s, using fallback", e)

        # Fallback: basic HTML extraction
        result.content, result.title = _basic_html_extract(html)

    except Exception as e:
        result.error = str(e)

    return result


def _basic_html_extract(html: str) -> tuple[str, str]:
    """Basic HTML → text extraction without external libraries."""
    import re as _re

    # Extract title
    title = ""
    title_match = _re.search(r"<title[^>]*>(.*?)</title>", html, _re.DOTALL | _re.IGNORECASE)
    if title_match:
        title = title_match.group(1).strip()
        title = _re.sub(r"<[^>]+>", "", title)

    # Strip scripts, styles, and tags
    text = _re.sub(r"<script[^>]*>.*?</script>", "", html, flags=_re.DOTALL | _re.IGNORECASE)
    text = _re.sub(r"<style[^>]*>.*?</style>", "", text, flags=_re.DOTALL | _re.IGNORECASE)
    text = _re.sub(r"<!--.*?-->", "", text, flags=_re.DOTALL)
    text = _re.sub(r"<[^>]+>", " ", text)

    # Clean whitespace
    text = _re.sub(r"[ \t]+", " ", text)
    text = _re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
    text = text.strip()

    return text, title


# ---------------------------------------------------------------------------
# Summarizer
# ---------------------------------------------------------------------------

_SUMMARY_PROMPTS = {
    SummaryType.BRIEF: "Provide a 2-3 paragraph overview of this content. Focus on what it is, what it does, and key features.",
    SummaryType.USAGE: "Summarize how to use this. Focus on installation, key imports, common patterns, and getting started.",
    SummaryType.API: "Summarize the API surface. List main classes, functions, their signatures, and what they do.",
    SummaryType.ARCHITECTURE: "Describe the architecture and design. Cover modules, design patterns, data flow, and key abstractions.",
    SummaryType.EVALUATION: "Evaluate this project. Cover maturity, dependencies, maintenance activity, alternatives, and trade-offs.",
}


def _summarize(
    content: URLContent,
    summary_type: SummaryType,
    model: str,
) -> str:
    """Generate an LLM summary of the URL content."""
    if not model:
        return ""

    # Build input
    body = content.readme or content.content or ""
    if not body:
        return ""

    # Truncate to reasonable size for summarization
    if len(body) > 8000:
        body = body[:8000] + "\n...[truncated]"

    prompt_instruction = _SUMMARY_PROMPTS.get(summary_type, _SUMMARY_PROMPTS[SummaryType.BRIEF])

    symbol_context = ""
    if content.symbol_map:
        symbol_context = f"\n\nSymbol map:\n```\n{content.symbol_map[:3000]}\n```"

    user_content = f"{prompt_instruction}\n\nContent from {content.url}:\n\n{body}{symbol_context}"

    try:
        import litellm
        response = litellm.completion(
            model=model,
            messages=[
                {"role": "system", "content": "You are a technical content summarizer. Be concise and informative."},
                {"role": "user", "content": user_content},
            ],
            stream=False,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        log.warning("Summarization failed for %s: %s", content.url, e)
        return ""


# ---------------------------------------------------------------------------
# URL Service (orchestrator)
# ---------------------------------------------------------------------------

class URLService:
    """Orchestrates URL detection, fetching, caching, and summarization.

    Exposed via RPC through the LLM service.
    """

    def __init__(self, cache_config: dict, smaller_model: str = ""):
        self._cache = URLCache(
            cache_dir=cache_config.get("path", ""),
            ttl_hours=cache_config.get("ttl_hours", 24),
        )
        self._model = smaller_model
        # In-memory state for fetched URLs
        self._fetched: dict[str, URLContent] = {}

    @property
    def cache(self) -> URLCache:
        return self._cache

    def detect_urls(self, text: str) -> list[dict]:
        """Find and classify URLs in text."""
        return detect_urls(text)

    def fetch_url(
        self,
        url: str,
        use_cache: bool = True,
        summarize: bool = True,
        user_hint: str = "",
    ) -> dict:
        """Fetch URL content with caching and optional summarization.

        Returns serialized URLContent dict.
        """
        # Check cache
        if use_cache:
            cached = self._cache.get(url)
            if cached:
                content = URLContent.from_dict(cached)
                # If summary requested but not cached, generate it
                if summarize and not content.summary and self._model:
                    stype = _select_summary_type(
                        content.url_type,
                        bool(content.symbol_map),
                        user_hint,
                    )
                    content.summary = _summarize(content, stype, self._model)
                    content.summary_type = stype.value
                    # Update cache with summary
                    self._cache.set(url, content.to_dict())

                self._fetched[url] = content
                return content.to_dict()

        # Classify and fetch
        url_type, gh_info = classify_url(url)

        if url_type == URLType.GITHUB_REPO and gh_info:
            content = _fetch_github_repo(gh_info)
        elif url_type == URLType.GITHUB_FILE and gh_info:
            content = _fetch_github_file(url, gh_info)
        elif url_type in (URLType.GITHUB_ISSUE, URLType.GITHUB_PR):
            # Fetch as web page (GitHub renders issues/PRs as HTML)
            content = _fetch_web_page(url)
            content.url_type = url_type
            content.github_info = gh_info
        elif url_type == URLType.DOCUMENTATION:
            content = _fetch_web_page(url)
            content.url_type = URLType.DOCUMENTATION
        else:
            content = _fetch_web_page(url)

        # Ensure URL is set
        content.url = url

        # Summarize
        if summarize and not content.error and self._model:
            stype = _select_summary_type(
                content.url_type,
                bool(content.symbol_map),
                user_hint,
            )
            content.summary = _summarize(content, stype, self._model)
            content.summary_type = stype.value

        # Cache
        if not content.error:
            self._cache.set(url, content.to_dict())

        self._fetched[url] = content
        return content.to_dict()

    def get_url_content(self, url: str) -> dict:
        """Get previously fetched content for display."""
        if url in self._fetched:
            return self._fetched[url].to_dict()
        # Try cache
        cached = self._cache.get(url)
        if cached:
            content = URLContent.from_dict(cached)
            self._fetched[url] = content
            return content.to_dict()
        return {"error": f"No content for {url}"}

    def invalidate_url_cache(self, url: str) -> dict:
        """Remove a URL from the cache."""
        self._cache.invalidate(url)
        self._fetched.pop(url, None)
        return {"ok": True}

    def clear_url_cache(self) -> dict:
        """Clear all cached URLs."""
        self._cache.clear()
        self._fetched.clear()
        return {"ok": True}

    def get_fetched_urls(self) -> list[dict]:
        """Return all currently fetched URLs."""
        return [c.to_dict() for c in self._fetched.values()]

    def remove_fetched(self, url: str):
        """Remove a URL from the fetched set (not from cache)."""
        self._fetched.pop(url, None)

    def clear_fetched(self):
        """Clear all fetched URLs (e.g., on conversation clear)."""
        self._fetched.clear()

    def format_url_context(
        self,
        urls: list[str],
        excluded: set[str] | None = None,
        max_length: int = 4000,
    ) -> str:
        """Format fetched URLs for LLM prompt inclusion."""
        excluded = excluded or set()
        parts = []
        for url in urls:
            if url in excluded:
                continue
            content = self._fetched.get(url)
            if content and not content.error:
                parts.append(content.format_for_prompt(max_length))
        return "\n---\n".join(parts)
