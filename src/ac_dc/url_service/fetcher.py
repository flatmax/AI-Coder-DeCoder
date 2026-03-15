"""URL fetching — per-type handlers for content extraction."""

import logging
import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

from ac_dc.url_service.models import GitHubInfo, URLContent, URLType

logger = logging.getLogger(__name__)

_USER_AGENT = (
    "Mozilla/5.0 (compatible; AC-DC/1.0; +https://github.com/ac-dc)"
)

_FETCH_TIMEOUT = 30
_CLONE_TIMEOUT = 120

# README priority order
_README_NAMES = [
    "README.md", "readme.md", "Readme.md",
    "README.rst", "readme.rst",
    "README.txt", "readme.txt",
    "README", "readme",
]

# Source file extensions for symbol map generation
_SOURCE_EXTS = {
    ".py", ".js", ".mjs", ".jsx", ".ts", ".tsx",
    ".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".hxx",
    ".m",
}

# Directories excluded during repo scan
_EXCLUDED_DIRS = {
    "node_modules", "__pycache__", "venv", ".venv",
    "dist", "build", ".git", ".ac-dc", ".egg-info",
}


def fetch_url(url: str, url_type: URLType,
              github_info: Optional[GitHubInfo] = None) -> URLContent:
    """Fetch content based on URL type."""
    try:
        if url_type == URLType.GITHUB_REPO and github_info:
            return _fetch_github_repo(url, github_info)
        elif url_type == URLType.GITHUB_FILE and github_info:
            return _fetch_github_file(url, github_info)
        else:
            return _fetch_web_page(url)
    except Exception as e:
        logger.warning(f"Fetch failed for {url}: {e}")
        return URLContent(
            url=url, url_type=url_type, error=str(e),
            fetched_at=datetime.now(timezone.utc),
        )


def _fetch_github_repo(url: str, info: GitHubInfo) -> URLContent:
    """Shallow clone, extract README and symbol map."""
    tmp_dir = tempfile.mkdtemp(prefix="ac_dc_gh_")
    try:
        # Shallow clone
        result = subprocess.run(
            ["git", "clone", "--depth", "1", info.clone_url, tmp_dir],
            capture_output=True, text=True, timeout=_CLONE_TIMEOUT,
        )
        if result.returncode != 0:
            return URLContent(
                url=url, url_type=URLType.GITHUB_REPO,
                github_info=info,
                error=f"Clone failed: {result.stderr.strip()[:200]}",
                fetched_at=datetime.now(timezone.utc),
            )

        # Find README
        readme_content = None
        for name in _README_NAMES:
            readme_path = Path(tmp_dir) / name
            if readme_path.exists():
                try:
                    readme_content = readme_path.read_text(
                        encoding="utf-8", errors="replace"
                    )
                    break
                except OSError:
                    continue

        # Generate symbol map
        symbol_map = _generate_symbol_map(tmp_dir)

        return URLContent(
            url=url, url_type=URLType.GITHUB_REPO,
            title=f"{info.owner}/{info.repo}",
            github_info=info,
            readme=readme_content,
            symbol_map=symbol_map,
            fetched_at=datetime.now(timezone.utc),
        )
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _generate_symbol_map(repo_dir: str) -> Optional[str]:
    """Generate symbol map using SymbolIndex if available."""
    try:
        from ac_dc.symbol_index.index import SymbolIndex
        idx = SymbolIndex(repo_dir)
        idx.index_repo()
        sm = idx.get_symbol_map()
        return sm if sm and sm.strip() else None
    except Exception as e:
        logger.debug(f"Symbol map generation failed: {e}")
        return None


def _fetch_github_file(url: str, info: GitHubInfo) -> URLContent:
    """Fetch a single file from GitHub via raw URL."""
    branch = info.branch or "main"
    raw_url = (
        f"https://raw.githubusercontent.com/"
        f"{info.owner}/{info.repo}/{branch}/{info.path}"
    )

    try:
        content = _http_get(raw_url)
    except HTTPError as e:
        if e.code == 404 and branch == "main":
            # Retry with master
            raw_url_master = (
                f"https://raw.githubusercontent.com/"
                f"{info.owner}/{info.repo}/master/{info.path}"
            )
            try:
                content = _http_get(raw_url_master)
            except Exception as e2:
                return URLContent(
                    url=url, url_type=URLType.GITHUB_FILE,
                    github_info=info, error=str(e2),
                    fetched_at=datetime.now(timezone.utc),
                )
        else:
            return URLContent(
                url=url, url_type=URLType.GITHUB_FILE,
                github_info=info, error=str(e),
                fetched_at=datetime.now(timezone.utc),
            )

    filename = info.path.rsplit("/", 1)[-1] if info.path else ""
    return URLContent(
        url=url, url_type=URLType.GITHUB_FILE,
        title=filename,
        content=content,
        github_info=info,
        fetched_at=datetime.now(timezone.utc),
    )


def _fetch_web_page(url: str) -> URLContent:
    """Fetch and extract content from a web page."""
    html = _http_get(url)

    # Try trafilatura first
    title, description, content = _extract_with_trafilatura(html)

    if not content:
        # Fallback extraction
        title_fb, description_fb, content_fb = _extract_fallback(html)
        title = title or title_fb
        description = description or description_fb
        content = content or content_fb

    return URLContent(
        url=url, url_type=URLType.GENERIC_WEB,
        title=title,
        description=description,
        content=content,
        fetched_at=datetime.now(timezone.utc),
    )


def _extract_with_trafilatura(html: str) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """Extract content using trafilatura if available."""
    try:
        import trafilatura
        result = trafilatura.extract(
            html, include_tables=True, include_comments=False,
            include_links=False,
        )
        metadata = trafilatura.extract_metadata(html)
        title = metadata.title if metadata else None
        description = metadata.description if metadata else None
        return title, description, result
    except ImportError:
        return None, None, None
    except Exception:
        return None, None, None


def _extract_fallback(html: str) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """Fallback HTML extraction — strip tags, extract title/meta."""
    title = None
    description = None

    # Title
    m = re.search(r'<title[^>]*>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
    if m:
        title = _decode_entities(m.group(1).strip())

    # Meta description
    m = re.search(
        r'<meta\s+name=["\']description["\']\s+content=["\']([^"\']*)["\']',
        html, re.IGNORECASE,
    )
    if m:
        description = _decode_entities(m.group(1).strip())

    # Strip scripts and styles
    text = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL | re.IGNORECASE)

    # Strip all tags
    text = re.sub(r'<[^>]+>', ' ', text)

    # Decode entities
    text = _decode_entities(text)

    # Clean whitespace
    text = re.sub(r'\s+', ' ', text).strip()

    return title, description, text if text else None


def _decode_entities(text: str) -> str:
    """Decode common HTML entities."""
    try:
        import html
        return html.unescape(text)
    except Exception:
        replacements = {
            "&amp;": "&", "&lt;": "<", "&gt;": ">",
            "&quot;": '"', "&#39;": "'", "&nbsp;": " ",
        }
        for entity, char in replacements.items():
            text = text.replace(entity, char)
        return text


def _http_get(url: str) -> str:
    """Fetch URL content via HTTP GET."""
    req = Request(url, headers={"User-Agent": _USER_AGENT})
    with urlopen(req, timeout=_FETCH_TIMEOUT) as resp:
        # Detect charset
        content_type = resp.headers.get("Content-Type", "")
        charset = "utf-8"
        if "charset=" in content_type:
            charset = content_type.split("charset=")[-1].split(";")[0].strip()
        return resp.read().decode(charset, errors="replace")