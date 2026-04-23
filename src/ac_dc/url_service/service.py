"""URL service orchestration — Layer 4.1.5.

Wires detection, classification, fetching, caching, and
summarization into a single surface the streaming handler
consumes during a chat request. The streaming handler (Layer
3.7) calls :meth:`URLService.detect_and_fetch` from inside
``_stream_chat`` to detect URLs in the user prompt, fetch any
that aren't already cached, and format the results for prompt
injection.

Governing spec: ``specs4/4-features/url-content.md#url-service``.

Design points pinned by spec and tests:

- **In-memory fetched dict is authoritative for the session.**
  Keyed by URL string (exact match — no normalisation beyond
  what detection does). A URL appears in ``_fetched`` when the
  service has attempted to fetch it at least once during the
  current session. Entries include both successes and errors;
  callers check the ``error`` field to distinguish.

- **Filesystem cache is a cross-session persistence layer.**
  The ``URLCache`` refuses to persist error records (enforced
  in its ``set()``). The service writes successful fetches to
  the cache when ``use_cache=True`` and reads from it on
  cache-check before issuing a new fetch.

- **Sentinel error for "not yet fetched".** :meth:`get_url_content`
  returns a :class:`URLContent` with ``error="URL not yet
  fetched"`` when the URL isn't in ``_fetched`` or in the
  filesystem cache. The streaming handler compares the error
  field against the sentinel string to decide whether to issue
  a fetch.

- **Per-message fetch limit.** The spec calls out a limit of
  around 3 URLs per message during streaming to prevent
  unbounded fetching. The service's ``detect_and_fetch``
  accepts ``max_urls`` as a parameter — the streaming handler
  passes the configured limit; the limit isn't hardcoded here.

- **Summary cache update on cached-with-summary-requested.**
  When a caller requests ``summarize=True`` but the cached
  entry lacks a summary, the service runs the summarizer and
  updates the cache entry in place. Avoids re-fetching source
  content just to add a summary.

- **Synchronous by design.** All methods are blocking. The
  streaming handler schedules them via ``run_in_executor``
  because network I/O and git clones block the event loop if
  called inline. The service doesn't wrap its own calls in
  executor dispatch — that's the caller's responsibility.

- **Injection points, not hardcoded dependencies.** The
  ``URLCache``, ``smaller_model`` name, and ``symbol_index_cls``
  are all injected at construction. Tests pass stubs; the
  streaming handler passes real values from ``ConfigManager``
  and ``SymbolIndex``.
"""

from __future__ import annotations

import logging
from typing import Any

from ac_dc.url_service.cache import URLCache
from ac_dc.url_service.detection import (
    URLType,
    classify_url,
    detect_urls,
    display_name,
)
from ac_dc.url_service.fetchers import (
    fetch_github_file,
    fetch_github_repo,
    fetch_web_page,
)
from ac_dc.url_service.models import GitHubInfo, URLContent
from ac_dc.url_service.summarizer import (
    SummaryType,
    summarize,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Module constants
# ---------------------------------------------------------------------------


# Sentinel error string for URLs that haven't been fetched yet.
# The streaming handler uses an exact-string compare against this
# to decide whether to issue a fetch — any other error value (or
# no error) means the URL has been attempted before and should
# not be re-fetched within the same session.
_SENTINEL_NOT_FETCHED = "URL not yet fetched"

# Default max length for prompt context formatting. Matches
# URLContent.format_for_prompt's default. A single URL's rendered
# content is capped at this length; the service's
# format_url_context joins multiple URLs without adding further
# caps (the LLM's overall context budget handles the aggregate).
_DEFAULT_FORMAT_MAX_LENGTH = 50_000

# Separator between multiple URL parts in format_url_context.
# Matches the separator the streaming handler expects when it
# sets url_context on the ContextManager. Blank-line-surrounded
# hyphen line — visually distinct from markdown `---` (which
# some models treat as a heading underline when preceded by
# text) because of the surrounding blank lines.
_URL_SEPARATOR = "\n---\n"


# ---------------------------------------------------------------------------
# Parse GitHub info from a URL
# ---------------------------------------------------------------------------


def _parse_github_info(url: str, url_type: URLType) -> GitHubInfo:
    """Extract owner/repo/branch/path/numbers from a GitHub URL.

    Defensive — the detection regexes are reused here rather than
    importing them, so the parse never fails for a URL that
    classified as a GitHub type. Returns a partially-populated
    :class:`GitHubInfo` with whatever fields the URL shape
    provides; fetchers tolerate missing fields gracefully (e.g.,
    file fetcher returns an error record if ``path`` is absent).
    """
    from urllib.parse import urlparse

    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    path = (parsed.path or "").strip("/")
    segments = path.split("/") if path else []

    info = GitHubInfo()

    # Raw content URLs have the shape ``owner/repo/branch/path...``.
    if host == "raw.githubusercontent.com" and len(segments) >= 4:
        info.owner = segments[0]
        info.repo = segments[1]
        info.branch = segments[2]
        info.path = "/".join(segments[3:])
        return info

    # Regular github.com URLs always have owner/repo as the first
    # two segments. The rest of the shape depends on type.
    if host == "github.com" and len(segments) >= 2:
        info.owner = segments[0]
        # Strip trailing .git (a repo URL like owner/repo.git).
        repo = segments[1]
        if repo.endswith(".git"):
            repo = repo[:-4]
        info.repo = repo

        if url_type == URLType.GITHUB_FILE and len(segments) >= 5:
            # owner/repo/blob/branch/path...
            # segments[2] is the literal "blob".
            info.branch = segments[3]
            info.path = "/".join(segments[4:])
        elif url_type == URLType.GITHUB_ISSUE and len(segments) >= 4:
            # owner/repo/issues/N
            try:
                info.issue_number = int(segments[3])
            except ValueError:
                pass
        elif url_type == URLType.GITHUB_PR and len(segments) >= 4:
            # owner/repo/pull/N
            try:
                info.pr_number = int(segments[3])
            except ValueError:
                pass

    return info


# ---------------------------------------------------------------------------
# URLService
# ---------------------------------------------------------------------------


class URLService:
    """Orchestrates detect → classify → fetch → cache → summarize.

    Construct once per LLM service (in single-agent operation —
    future parallel-agent mode may create one per context
    manager). Shared across chat requests within a session;
    ``_fetched`` accumulates until cleared via :meth:`clear_fetched`
    or :meth:`new_session` on the owning LLM service.
    """

    def __init__(
        self,
        cache: URLCache | None = None,
        smaller_model: str | None = None,
        symbol_index_cls: Any = None,
    ) -> None:
        """Construct the service.

        Parameters
        ----------
        cache:
            Optional :class:`URLCache` for cross-session
            persistence. When None, every fetch hits the
            network; no persistence across sessions. Normal
            construction passes a real cache from
            :meth:`ConfigManager.url_cache_config`.
        smaller_model:
            Optional provider-qualified model identifier used
            for summarization. When None, summarization is
            silently skipped — ``fetch_url(summarize=True)``
            succeeds but the returned record has no summary.
            Normal construction passes ``config.smaller_model``.
        symbol_index_cls:
            Optional symbol index class for GitHub repo
            fetches. When supplied, the repo fetcher
            instantiates it on the cloned directory and
            attaches the symbol map to the result. When None,
            GitHub repo fetches return content without a
            symbol map. Normal construction passes
            ``SymbolIndex`` directly (not an instance).
        """
        self._cache = cache
        self._smaller_model = smaller_model
        self._symbol_index_cls = symbol_index_cls
        # Fetched results for the current session. Keyed by URL
        # string (exact match). Both successes and errors are
        # stored — the error field distinguishes.
        self._fetched: dict[str, URLContent] = {}

    # ------------------------------------------------------------------
    # Detection (thin delegation)
    # ------------------------------------------------------------------

    def detect_urls(self, text: str) -> list[dict[str, Any]]:
        """Detect URLs in ``text`` with classification and display names.

        Returned shape matches what the frontend URL chips RPC
        wants: a list of dicts with ``url``, ``type`` (string
        form of the enum for wire-format friendliness), and
        ``display_name``. The type is emitted as the enum's
        ``value`` so RPC serialisation doesn't need special
        handling.
        """
        urls = detect_urls(text)
        return [
            {
                "url": url,
                "type": classify_url(url).value,
                "display_name": display_name(url),
            }
            for url in urls
        ]

    # ------------------------------------------------------------------
    # Fetch orchestration
    # ------------------------------------------------------------------

    def fetch_url(
        self,
        url: str,
        use_cache: bool = True,
        summarize: bool = False,
        summary_type: SummaryType | None = None,
        user_text: str | None = None,
    ) -> URLContent:
        """Fetch a URL through the full pipeline.

        1. Cache check (if ``use_cache``). On hit: return
           immediately unless ``summarize=True`` and the cached
           entry lacks a summary — in that case, generate the
           summary and update the cache in place.
        2. Classification.
        3. Handler dispatch by type.
        4. Cache write (if successful fetch and ``use_cache``).
        5. Summarization (if ``summarize=True`` and the fetch
           succeeded).
        6. Store in ``_fetched`` (regardless of success).

        Parameters
        ----------
        url:
            The URL to fetch. Must be a fully-qualified HTTP(S)
            URL — the service does not re-normalise or validate.
        use_cache:
            When True, check the filesystem cache before
            fetching and write the result on success.
        summarize:
            When True, run the summarizer on the fetched
            content. Silently no-op when no smaller model is
            configured.
        summary_type:
            Optional explicit summary type. When None, the
            summarizer picks one based on URL type and
            ``user_text``.
        user_text:
            Optional user prompt for summary-type
            auto-selection. Passed through to the summarizer.

        Returns
        -------
        URLContent
            The fetched content with optional summary. Error
            records have the ``error`` field populated and no
            content. The same record is also stored in
            ``_fetched`` keyed by URL.
        """
        # Step 1 — cache check.
        if use_cache and self._cache is not None:
            cached_dict = self._cache.get(url)
            if cached_dict is not None:
                content = URLContent.from_dict(cached_dict)
                # Cache hit. If summary is requested but absent,
                # generate it and update the cache entry in place.
                if summarize and not content.summary and not content.error:
                    content = self._summarize(
                        content, summary_type, user_text
                    )
                    self._cache.set(url, content.to_dict())
                self._fetched[url] = content
                return content

        # Step 2 — classify.
        url_type = classify_url(url)

        # Step 3 — dispatch.
        content = self._dispatch_fetch(url, url_type)

        # Step 4 — cache write on success. The cache itself
        # refuses error records, so this is safe unconditionally.
        if use_cache and self._cache is not None and not content.error:
            self._cache.set(url, content.to_dict())

        # Step 5 — summarize on success.
        if summarize and not content.error:
            content = self._summarize(content, summary_type, user_text)
            # Update cache with the summary so subsequent fetches
            # hit the cached summary path.
            if use_cache and self._cache is not None:
                self._cache.set(url, content.to_dict())

        # Step 6 — store in memory.
        self._fetched[url] = content
        return content

    def _dispatch_fetch(
        self,
        url: str,
        url_type: URLType,
    ) -> URLContent:
        """Route to the appropriate fetcher based on URL type.

        Unknown types fall through to the generic web-page
        fetcher. Issue and PR URLs currently also go through the
        generic fetcher — a future enhancement could use the
        GitHub API for structured issue/PR data.
        """
        if url_type == URLType.GITHUB_REPO:
            info = _parse_github_info(url, url_type)
            return fetch_github_repo(
                url, info, symbol_index_cls=self._symbol_index_cls
            )
        if url_type == URLType.GITHUB_FILE:
            info = _parse_github_info(url, url_type)
            return fetch_github_file(url, info)
        # GitHub issues, PRs, documentation, generic — all go
        # through the web page fetcher.
        content = fetch_web_page(url)
        # Overwrite the url_type to match what classify_url said,
        # so callers can distinguish a fetched docs page from a
        # fetched generic page. The web fetcher sets url_type to
        # "generic" unconditionally.
        content.url_type = url_type.value
        # Attach github_info when the URL parsed as a GitHub
        # issue/PR — useful for the UI chip's display.
        if url_type in (URLType.GITHUB_ISSUE, URLType.GITHUB_PR):
            content.github_info = _parse_github_info(url, url_type)
        return content

    def _summarize(
        self,
        content: URLContent,
        summary_type: SummaryType | None,
        user_text: str | None,
    ) -> URLContent:
        """Invoke the summarizer with the configured smaller model.

        Returns the input unchanged when no model is configured
        — summarization becomes a silent no-op in that case.
        The summarizer itself handles all error paths (missing
        litellm, LLM failure, malformed response) by returning
        a record with ``summary_type="error"``.
        """
        if not self._smaller_model:
            logger.debug(
                "No smaller model configured; skipping summary for %s",
                content.url,
            )
            return content
        return summarize(
            content,
            model=self._smaller_model,
            summary_type=summary_type,
            user_text=user_text,
        )

    def detect_and_fetch(
        self,
        text: str,
        use_cache: bool = True,
        summarize: bool = False,
        max_urls: int | None = None,
    ) -> list[URLContent]:
        """Detect URLs in ``text`` and fetch each one sequentially.

        Convenience wrapper the streaming handler calls with the
        user's prompt. Fetches are sequential rather than
        parallel — per-message URL volume is small (typically
        0–3), and serial fetching avoids hammering upstream
        services when users paste a batch of links.

        Already-fetched URLs are skipped — if the URL is already
        in ``_fetched`` from an earlier turn, it's not re-fetched.
        The returned list contains one entry per URL in the
        text, including skipped-as-already-fetched ones (using
        the cached-in-memory result).

        Parameters
        ----------
        text:
            User prompt or any text to scan for URLs.
        use_cache:
            Passed through to :meth:`fetch_url`.
        summarize:
            Passed through to :meth:`fetch_url`. User text for
            auto-type selection is inferred from ``text``
            itself.
        max_urls:
            Optional cap on the number of URLs processed. The
            streaming handler passes the configured per-message
            limit (typically 3); other callers may pass None to
            process all detected URLs.

        Returns
        -------
        list[URLContent]
            One entry per URL up to ``max_urls``. Already-fetched
            URLs return their cached-in-memory result without
            re-issuing a fetch. Errors are included as records
            with the ``error`` field populated.
        """
        detected = detect_urls(text)
        if max_urls is not None:
            detected = detected[:max_urls]

        results: list[URLContent] = []
        for url in detected:
            if url in self._fetched:
                # Already fetched this session — reuse.
                results.append(self._fetched[url])
                continue
            result = self.fetch_url(
                url,
                use_cache=use_cache,
                summarize=summarize,
                user_text=text,
            )
            results.append(result)
        return results

    # ------------------------------------------------------------------
    # Retrieval and cache management
    # ------------------------------------------------------------------

    def get_url_content(self, url: str) -> URLContent:
        """Return content for display; sentinel error when not fetched.

        Check order: in-memory fetched dict → filesystem cache.
        When the URL is in neither, returns a :class:`URLContent`
        with ``error=_SENTINEL_NOT_FETCHED`` — the streaming
        handler compares against that exact string to decide
        whether to fetch during a streaming request.

        Filesystem-cache hits update the in-memory dict so
        subsequent calls return in O(1) without hitting disk
        again.
        """
        # In-memory first — fastest path.
        if url in self._fetched:
            return self._fetched[url]
        # Filesystem cache fallback.
        if self._cache is not None:
            cached_dict = self._cache.get(url)
            if cached_dict is not None:
                content = URLContent.from_dict(cached_dict)
                self._fetched[url] = content
                return content
        # Sentinel.
        return URLContent(url=url, error=_SENTINEL_NOT_FETCHED)

    def invalidate_url_cache(self, url: str) -> dict[str, Any]:
        """Remove a URL from both filesystem cache and in-memory dict.

        Returns status info including whether entries were
        actually present. Idempotent — calling on an unknown URL
        succeeds with both ``cache_removed`` and ``fetched_removed``
        flags set to False.
        """
        cache_removed = False
        if self._cache is not None:
            cache_removed = self._cache.invalidate(url)
        fetched_removed = self._fetched.pop(url, None) is not None
        return {
            "status": "ok",
            "cache_removed": cache_removed,
            "fetched_removed": fetched_removed,
        }

    def clear_url_cache(self) -> dict[str, Any]:
        """Remove all cached and in-memory fetched URLs.

        Returns the count of removed cache entries. In-memory
        dict is always fully cleared regardless of cache
        availability. Used by the "Clear URL cache" RPC the user
        invokes from the UI.
        """
        cleared = 0
        if self._cache is not None:
            cleared = self._cache.clear()
        self._fetched.clear()
        return {"status": "ok", "cache_cleared": cleared}

    # ------------------------------------------------------------------
    # In-memory fetched dict management
    # ------------------------------------------------------------------

    def get_fetched_urls(self) -> list[URLContent]:
        """Return all currently-fetched URLContent objects.

        Used by the frontend URL chip rendering to show what's
        in the current session's context. Order matches
        insertion order (Python dict since 3.7), so chips render
        in the order URLs were first encountered.
        """
        return list(self._fetched.values())

    def remove_fetched(self, url: str) -> dict[str, Any]:
        """Remove from in-memory dict only; filesystem cache preserved.

        Differs from :meth:`invalidate_url_cache` — this only
        evicts the URL from the current session's active
        context, so a later :meth:`fetch_url` with the same URL
        hits the filesystem cache and avoids re-fetching.

        Returns status info indicating whether the URL was
        present.
        """
        removed = self._fetched.pop(url, None) is not None
        return {"status": "ok", "removed": removed}

    def clear_fetched(self) -> dict[str, Any]:
        """Clear the in-memory fetched dict only.

        Filesystem cache is preserved. The next request that
        detects a previously-fetched URL will hit the cache
        rather than the network.
        """
        count = len(self._fetched)
        self._fetched.clear()
        return {"status": "ok", "cleared": count}

    # ------------------------------------------------------------------
    # Prompt context formatting
    # ------------------------------------------------------------------

    def format_url_context(
        self,
        urls: list[str] | None = None,
        excluded: set[str] | None = None,
        max_length: int | None = None,
    ) -> str:
        """Format fetched URLs for prompt injection.

        Parameters
        ----------
        urls:
            Optional explicit list of URLs to include. When
            None, all fetched URLs (except excluded) are
            included. The streaming handler passes the list of
            URLs the user has left included via the URL chips
            UI.
        excluded:
            Optional set of URLs to skip. Allows the frontend's
            exclude-checkbox state to override the included
            list.
        max_length:
            Optional per-URL formatting cap. Passed through to
            :meth:`URLContent.format_for_prompt`. The service
            does not cap the aggregate — the LLM's overall
            context budget handles it.

        Returns
        -------
        str
            Joined rendered URLs, separated by
            :data:`_URL_SEPARATOR`. Empty string when no URLs
            qualify (none fetched, all excluded, all errored).
        """
        excluded_set = excluded or set()
        effective_max = (
            max_length
            if max_length is not None
            else _DEFAULT_FORMAT_MAX_LENGTH
        )

        if urls is None:
            # Default — all fetched URLs.
            candidates = list(self._fetched.keys())
        else:
            candidates = urls

        parts: list[str] = []
        for url in candidates:
            if url in excluded_set:
                continue
            content = self._fetched.get(url)
            if content is None:
                # Not in memory — try filesystem cache before
                # giving up. Keeps the method robust even when
                # the caller has a URL list that predates the
                # current session's fetched dict (e.g., session
                # restore).
                if self._cache is not None:
                    cached = self._cache.get(url)
                    if cached is not None:
                        content = URLContent.from_dict(cached)
                        # Not hoisted into _fetched — the caller
                        # asked about a specific URL, not about
                        # populating the in-memory dict.
            if content is None:
                continue
            if content.error:
                continue
            rendered = content.format_for_prompt(
                max_length=effective_max
            )
            if rendered:
                parts.append(rendered)

        return _URL_SEPARATOR.join(parts)