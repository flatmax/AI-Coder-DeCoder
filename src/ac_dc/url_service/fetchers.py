"""URL content fetchers — Layer 4.1.3.

Per-type fetch logic dispatched by :class:`~ac_dc.url_service.detection.URLType`:

- **Web page** (``fetch_web_page``) — HTTP GET via stdlib
  :mod:`urllib`, title extraction + main-content extraction via
  trafilatura (with a stdlib fallback when trafilatura is
  unavailable or fails).
- **GitHub file** (``fetch_github_file``) — constructs the raw
  content URL from parsed GitHub info, fetches via HTTP, falls
  back from ``main`` → ``master`` branch on failure.
- **GitHub repo** (``fetch_github_repo``) — shallow clone via
  ``git``. Attempts SSH first (``git@github.com:owner/repo.git``)
  with batch-mode flags to fail fast, falls back to anonymous
  HTTPS (D13). Locates and reads the README via a two-pass search
  (exact match in priority order, then case-insensitive). Produces
  a symbol map via an injected symbol-index class if supplied.

Design decisions pinned here:

- **Injected symbol-index class, not a module import.** The repo
  fetcher takes ``symbol_index_cls`` as a parameter so tests can
  pass a stub and production code can pass
  :class:`ac_dc.symbol_index.index.SymbolIndex`. Keeps the
  fetcher from importing heavy grammars at module load, and
  matches the D10 "no module-level coupling" pattern.

- **SSH-first with HTTPS fallback (D13).** Every GitHub clone
  attempt tries SSH first with ``BatchMode=yes`` + accept-new
  host-key policy. Non-zero exit triggers the HTTPS retry with
  all credential prompts disabled. Private-repo-without-access
  produces a clean error; public repos always succeed via the
  fallback.

- **Blocking subprocess + blocking HTTP.** The fetchers are
  designed to be called from an executor (see :class:`URLService`
  in Layer 4.1.5 — not yet delivered). The event loop stays
  responsive because the caller schedules via ``run_in_executor``.
  Making the fetchers themselves async would duplicate the
  responsibility.

- **Timeouts everywhere.** Git clone — 120s. HTTP GET — 30s.
  No retry loops beyond the SSH→HTTPS fallback. A fetch that
  times out surfaces an :class:`URLContent` with the ``error``
  field populated; the caller (URL service) refuses to cache
  error records.

- **No authentication for HTTPS.** Explicitly disabled via
  ``GIT_ASKPASS=/bin/true`` and ``GIT_TERMINAL_PROMPT=0``.
  Anonymous HTTPS succeeds for public repos; private-without-
  access fails with a clean error.

Governing spec: ``specs4/4-features/url-content.md#fetchers``.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ac_dc.url_service.models import GitHubInfo, URLContent

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Module constants
# ---------------------------------------------------------------------------


# HTTP request timeout in seconds. 30s handles slow servers without
# hanging the user's request indefinitely. The caller's event-loop
# scheduling should use ``asyncio.wait_for`` with a longer timeout to
# wrap this — we don't want two layers of timeout triggering at
# nearly-the-same instant.
_HTTP_TIMEOUT_SECONDS = 30

# Git clone timeout. 120s is generous — shallow clones of multi-MB
# repos over slow connections still fit. The SSH attempt gets the
# full budget; if it fails, the HTTPS fallback also gets the full
# budget (total 240s worst case).
_GIT_CLONE_TIMEOUT_SECONDS = 120

# User-Agent for HTTP fetches. Browser-like to avoid getting served
# mobile or bot-blocked pages. The specific version isn't critical —
# servers that care about exact versions are rare.
_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# README candidate filenames in priority order. First match wins in
# pass 1. Pass 2 falls back to case-insensitive lookup via a
# lowercase map.
_README_CANDIDATES = (
    "README.md",
    "README.rst",
    "README.txt",
    "README",
    "readme.md",
    "readme.rst",
    "readme.txt",
    "readme",
    "Readme.md",
    "Readme",
)

# Case-insensitive fallback keys for pass 2. Matches against the
# lowercased filename.
_README_CASE_INSENSITIVE_KEYS = (
    "readme.md",
    "readme.rst",
    "readme.txt",
    "readme",
)


# ---------------------------------------------------------------------------
# Title extraction
# ---------------------------------------------------------------------------


# Matches <title>...</title> case-insensitively, DOTALL so titles
# spanning lines still capture. Used as a pre-step before
# trafilatura so we always have a title even when trafilatura
# can't extract one (short pages, paywalls, etc.).
_TITLE_RE = re.compile(
    r"<title[^>]*>(.*?)</title>",
    re.IGNORECASE | re.DOTALL,
)


def _extract_title(html: str) -> str | None:
    """Return the <title> tag content or None.

    Collapses whitespace and strips so multi-line titles with
    indentation render cleanly. Returns None for missing or empty
    titles rather than an empty string so callers can distinguish.
    """
    match = _TITLE_RE.search(html)
    if not match:
        return None
    title = " ".join(match.group(1).split())
    return title or None


# ---------------------------------------------------------------------------
# Web page fetcher
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    """Return the current UTC time as ISO 8601 with Z suffix.

    Matches the shape used throughout the persistence layer (history
    store, cache records). Lexicographic ordering == chronological.
    """
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _http_get(url: str) -> str:
    """Fetch a URL as UTF-8 text with a browser-like User-Agent.

    Returns the response body. Raises on HTTP errors, network
    failures, and timeouts — the caller converts to an URLContent
    error record. latin-1 is the fallback decoding when UTF-8
    fails, since it can decode any byte sequence without raising
    (even if the result is garbage).
    """
    request = urllib.request.Request(
        url,
        headers={"User-Agent": _USER_AGENT},
    )
    with urllib.request.urlopen(
        request, timeout=_HTTP_TIMEOUT_SECONDS
    ) as response:
        raw = response.read()
    # Try UTF-8 first; fall back to latin-1 which never fails.
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


def _strip_html_tags(html: str) -> str:
    """Strip HTML tags and decode entities — the stdlib fallback.

    Used when trafilatura isn't installed or returns empty content.
    Not a general-purpose HTML-to-text tool — fine for "give the
    LLM something readable" but loses structure (headings, lists,
    code blocks all flatten to prose).
    """
    import html as html_module

    # Strip <script> and <style> blocks entirely — their content
    # is never useful and can confuse the tag stripper.
    html = re.sub(
        r"<script[^>]*>.*?</script>",
        " ",
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    html = re.sub(
        r"<style[^>]*>.*?</style>",
        " ",
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    # Strip remaining tags.
    text = re.sub(r"<[^>]+>", " ", html)
    # Decode HTML entities.
    text = html_module.unescape(text)
    # Collapse whitespace.
    return " ".join(text.split())


def _extract_content(html: str) -> str:
    """Extract main article content via trafilatura, fall back to stdlib.

    trafilatura strips navigation, ads, boilerplate — much better
    than the stdlib regex approach for typical blog/doc pages. But
    it's an optional dependency and may not be installed in
    stripped-down releases, so we degrade to the regex fallback
    rather than failing.

    trafilatura is also known to return None for pages it can't
    extract from (too-short content, unusual markup). The fallback
    catches that case too.
    """
    try:
        import trafilatura

        extracted = trafilatura.extract(html)
        if extracted:
            return extracted.strip()
    except ImportError:
        logger.debug(
            "trafilatura not installed; using regex fallback"
        )
    except Exception as exc:
        # trafilatura internals evolve; a broad catch keeps us from
        # breaking on a version mismatch.
        logger.warning(
            "trafilatura extraction failed: %s; using regex fallback",
            exc,
        )
    return _strip_html_tags(html)


def fetch_web_page(url: str) -> URLContent:
    """Fetch a generic web page.

    Returns an :class:`URLContent` with ``content`` populated on
    success, or ``error`` on any failure (HTTP error, timeout,
    network issue). Error records should NOT be cached — the
    caller (URL service) enforces that via the cache's refusal
    to persist records with a non-empty error field.
    """
    try:
        html = _http_get(url)
    except urllib.error.HTTPError as exc:
        return URLContent(
            url=url,
            url_type="generic",
            error=f"HTTP {exc.code}: {exc.reason}",
            fetched_at=_now_iso(),
        )
    except urllib.error.URLError as exc:
        return URLContent(
            url=url,
            url_type="generic",
            error=f"URL error: {exc.reason}",
            fetched_at=_now_iso(),
        )
    except Exception as exc:
        return URLContent(
            url=url,
            url_type="generic",
            error=f"Fetch failed: {exc}",
            fetched_at=_now_iso(),
        )

    title = _extract_title(html)
    content = _extract_content(html)

    return URLContent(
        url=url,
        url_type="generic",
        title=title,
        content=content,
        fetched_at=_now_iso(),
    )


# ---------------------------------------------------------------------------
# GitHub file fetcher
# ---------------------------------------------------------------------------


def _build_raw_url(info: GitHubInfo, branch: str) -> str:
    """Construct the raw.githubusercontent.com URL for a file.

    ``info.path`` must be non-None — callers verify before calling.
    """
    assert info.path is not None  # caller guarantees
    return (
        f"https://raw.githubusercontent.com/"
        f"{info.owner}/{info.repo}/{branch}/{info.path}"
    )


def fetch_github_file(
    url: str,
    info: GitHubInfo,
) -> URLContent:
    """Fetch a single file from GitHub via raw.githubusercontent.com.

    Tries the specified branch first, falls back to ``master`` if
    the original was ``main`` (the default). This covers the
    common case of a URL constructed from a default-branch
    assumption — no behaviour change for non-default branches.

    Returns :class:`URLContent` with ``content`` and ``title`` set
    (title is the filename), or ``error`` on total failure.
    """
    if not info.path:
        return URLContent(
            url=url,
            url_type="github_file",
            github_info=info,
            error="No file path in GitHub URL",
            fetched_at=_now_iso(),
        )

    branch = info.branch or "main"
    raw_url = _build_raw_url(info, branch)

    try:
        content = _http_get(raw_url)
    except urllib.error.HTTPError as exc:
        # Fall back to master only when the original branch was the
        # implicit "main" default. If the caller passed an explicit
        # branch name, a 404 should surface — retrying with master
        # would mask typos in the branch name.
        if branch == "main" and info.branch is None:
            try:
                raw_url = _build_raw_url(info, "master")
                content = _http_get(raw_url)
                branch = "master"  # for record-keeping
            except Exception:
                return URLContent(
                    url=url,
                    url_type="github_file",
                    github_info=info,
                    error=f"HTTP {exc.code}: {exc.reason}",
                    fetched_at=_now_iso(),
                )
        else:
            return URLContent(
                url=url,
                url_type="github_file",
                github_info=info,
                error=f"HTTP {exc.code}: {exc.reason}",
                fetched_at=_now_iso(),
            )
    except Exception as exc:
        return URLContent(
            url=url,
            url_type="github_file",
            github_info=info,
            error=f"Fetch failed: {exc}",
            fetched_at=_now_iso(),
        )

    filename = info.path.rsplit("/", 1)[-1]

    return URLContent(
        url=url,
        url_type="github_file",
        title=filename,
        content=content,
        github_info=info,
        fetched_at=_now_iso(),
    )


# ---------------------------------------------------------------------------
# GitHub repo fetcher — SSH first, HTTPS fallback (D13)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _CloneAttempt:
    """One clone attempt's parameters. Internal helper."""

    url: str
    env: dict[str, str]


def _ssh_clone_attempt(info: GitHubInfo) -> _CloneAttempt:
    """Build the SSH clone attempt parameters."""
    return _CloneAttempt(
        url=f"git@github.com:{info.owner}/{info.repo}.git",
        env={
            # BatchMode=yes — fail rather than prompt for password.
            # accept-new — auto-accept GitHub's known host key on
            # first contact but refuse changed keys (CI-safe).
            "GIT_SSH_COMMAND": (
                "ssh -o BatchMode=yes "
                "-o StrictHostKeyChecking=accept-new"
            ),
            # Belt-and-braces — ensure git itself never prompts.
            "GIT_TERMINAL_PROMPT": "0",
        },
    )


def _https_clone_attempt(info: GitHubInfo) -> _CloneAttempt:
    """Build the HTTPS clone attempt parameters.

    All credential sources disabled so the clone is strictly
    anonymous. Works for public repos; private repos without
    access fail cleanly.
    """
    return _CloneAttempt(
        url=f"https://github.com/{info.owner}/{info.repo}.git",
        env={
            "GIT_TERMINAL_PROMPT": "0",
            "GIT_ASKPASS": "/bin/true",
            "SSH_ASKPASS": "/bin/true",
            # Ignore user/system git config so credential helpers
            # from a global .gitconfig don't inject auth.
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_CONFIG_SYSTEM": "/dev/null",
        },
    )


def _try_clone(
    attempt: _CloneAttempt,
    target_dir: Path,
) -> bool:
    """Run one ``git clone`` attempt. Return True on success.

    Uses ``--depth 1`` for shallow clone (we only need README +
    top-level file list). Stdin closed so git never hangs waiting
    for credential input even if our env-var guards miss something.
    """
    # Build the full environment — inherit the current process env
    # for PATH and other essentials, then overlay the attempt's
    # credentials-disabling settings.
    env = os.environ.copy()
    env.update(attempt.env)

    try:
        result = subprocess.run(
            [
                "git", "clone",
                "--depth", "1",
                "--quiet",
                attempt.url,
                str(target_dir),
            ],
            env=env,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=_GIT_CLONE_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        logger.debug("Clone timed out: %s", attempt.url)
        return False
    except FileNotFoundError:
        # git binary missing — not a per-attempt failure, but
        # surfacing the distinction to the caller would require a
        # richer return type. Return False and log.
        logger.warning("git binary not found on PATH")
        return False

    if result.returncode == 0:
        return True

    # Log stderr at debug for diagnostics. Don't surface to the
    # user per-attempt — the caller produces a single error
    # message covering the combined failure.
    stderr = result.stderr.decode("utf-8", errors="replace").strip()
    logger.debug(
        "Clone failed for %s: exit %d: %s",
        attempt.url, result.returncode, stderr[:200],
    )
    return False


def _find_readme(repo_dir: Path) -> tuple[str, str] | None:
    """Two-pass README search. Returns (filename, content) or None.

    Pass 1 — exact match against the priority-ordered candidate
    list. Matches GitHub's own README rendering priority.

    Pass 2 — case-insensitive lookup via a lowercase map. Catches
    ``README.MD`` / ``Readme.md`` / platform-dependent case
    variations.

    Read failures (permission denied, binary content mislabeled
    as README) are treated as "not found" — the caller falls
    through to a repo without a README field.
    """
    # Pass 1 — exact.
    for candidate in _README_CANDIDATES:
        path = repo_dir / candidate
        if path.is_file():
            try:
                return candidate, path.read_text(
                    encoding="utf-8", errors="replace"
                )
            except OSError:
                continue

    # Pass 2 — case-insensitive.
    try:
        entries = os.listdir(repo_dir)
    except OSError:
        return None
    lower_map = {name.lower(): name for name in entries}
    for key in _README_CASE_INSENSITIVE_KEYS:
        actual = lower_map.get(key)
        if actual is None:
            continue
        path = repo_dir / actual
        if not path.is_file():
            continue
        try:
            return actual, path.read_text(
                encoding="utf-8", errors="replace"
            )
        except OSError:
            continue

    return None


def _generate_symbol_map(
    repo_dir: Path,
    symbol_index_cls: Any,
) -> str | None:
    """Build a symbol map for a cloned repo.

    Instantiates ``symbol_index_cls`` on ``repo_dir``, calls
    ``index_repo(files)`` with all files under the repo, then
    returns ``get_symbol_map()``. Any failure is logged and None
    is returned — the caller just omits the field.
    """
    try:
        index = symbol_index_cls(repo_root=repo_dir)
    except Exception as exc:
        logger.warning(
            "Symbol index construction failed for %s: %s",
            repo_dir, exc,
        )
        return None

    # Build the file list — walk the repo, skip .git, make paths
    # relative to repo_dir. The orchestrator's index_repo expects
    # repo-relative paths.
    try:
        files: list[str] = []
        for root, dirs, filenames in os.walk(repo_dir):
            # Skip .git entirely.
            dirs[:] = [d for d in dirs if d != ".git"]
            for fname in filenames:
                full = Path(root) / fname
                rel = full.relative_to(repo_dir)
                files.append(str(rel))
    except Exception as exc:
        logger.warning("Failed to walk %s: %s", repo_dir, exc)
        return None

    try:
        index.index_repo(files)
        return index.get_symbol_map()
    except Exception as exc:
        logger.warning(
            "Symbol map generation failed for %s: %s",
            repo_dir, exc,
        )
        return None


def fetch_github_repo(
    url: str,
    info: GitHubInfo,
    symbol_index_cls: Any = None,
) -> URLContent:
    """Fetch a GitHub repository — clone, read README, optionally index.

    Uses the SSH-first-then-HTTPS pattern (D13). On any clone
    success, searches for a README and optionally produces a
    symbol map via the injected index class. The temp clone
    directory is cleaned up in a ``finally`` block.

    Parameters
    ----------
    url:
        The original GitHub URL (for record-keeping).
    info:
        Parsed GitHub info (must have ``owner`` and ``repo``).
    symbol_index_cls:
        Optional class to instantiate for symbol-map generation.
        When None, the returned URLContent has no symbol_map.
        Tests pass a stub; production passes
        :class:`ac_dc.symbol_index.index.SymbolIndex`.

    Returns
    -------
    URLContent
        With ``readme``, ``symbol_map``, and ``title`` populated
        on success. On clone failure, returns an error record
        with a combined-failure message.
    """
    if not info.owner or not info.repo:
        return URLContent(
            url=url,
            url_type="github_repo",
            github_info=info,
            error="Missing owner or repo in GitHub URL",
            fetched_at=_now_iso(),
        )

    tmp_dir = Path(tempfile.mkdtemp(prefix="ac-dc-gh-clone-"))
    try:
        # SSH first. Use a subdirectory since git clone requires
        # an empty or nonexistent target.
        clone_target = tmp_dir / "repo"

        ssh_attempt = _ssh_clone_attempt(info)
        if not _try_clone(ssh_attempt, clone_target):
            # SSH failed — clean up target and try HTTPS.
            if clone_target.exists():
                shutil.rmtree(clone_target, ignore_errors=True)
            https_attempt = _https_clone_attempt(info)
            if not _try_clone(https_attempt, clone_target):
                # Both failed. Single combined error message
                # covering both auth and access cases per D13.
                return URLContent(
                    url=url,
                    url_type="github_repo",
                    github_info=info,
                    error=(
                        "Could not clone repository. "
                        "The repository may be private or you may "
                        "lack access."
                    ),
                    fetched_at=_now_iso(),
                )

        # Clone succeeded. Find README.
        readme_result = _find_readme(clone_target)
        readme_content = (
            readme_result[1] if readme_result is not None else None
        )

        # Optionally generate symbol map.
        symbol_map = None
        if symbol_index_cls is not None:
            symbol_map = _generate_symbol_map(
                clone_target, symbol_index_cls
            )

        return URLContent(
            url=url,
            url_type="github_repo",
            title=f"{info.owner}/{info.repo}",
            readme=readme_content,
            symbol_map=symbol_map,
            github_info=info,
            fetched_at=_now_iso(),
        )

    finally:
        # Always clean up the temp directory. ignore_errors since
        # partial state from a failed clone might have weird
        # permissions.
        shutil.rmtree(tmp_dir, ignore_errors=True)