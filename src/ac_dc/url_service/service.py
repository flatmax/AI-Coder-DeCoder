"""URL service — orchestrates detection, fetching, caching, summarization."""

import logging
from datetime import datetime, timezone
from typing import Optional

from ac_dc.url_service.cache import URLCache
from ac_dc.url_service.detector import classify_url, detect_urls, select_summary_type
from ac_dc.url_service.fetcher import fetch_url
from ac_dc.url_service.models import URLContent, URLType, url_hash, display_name

logger = logging.getLogger(__name__)

# Summarization prompts per type
_SUMMARY_PROMPTS = {
    "brief": "Provide a 2-3 paragraph overview of this content. Focus on what it is, its purpose, and key features.",
    "usage": "Summarize the installation steps, usage patterns, and key imports. Focus on practical how-to information.",
    "api": "Summarize the main classes, functions, and their signatures. Focus on the public API surface.",
    "architecture": "Summarize the module structure, design patterns, and data flow. Focus on how components relate.",
    "evaluation": "Evaluate the maturity, dependencies, and alternatives. Focus on decision-making factors.",
}

# Max chars for content sent to summarizer
_MAX_SUMMARY_INPUT = 100000


class URLService:
    """Manages the lifecycle of URL content — detect, fetch, cache, summarize."""

    def __init__(
        self,
        cache_dir: Optional[str] = None,
        ttl_hours: int = 24,
        model: Optional[str] = None,
    ):
        self._cache = URLCache(cache_dir=cache_dir, ttl_hours=ttl_hours)
        self._model = model
        self._fetched: dict[str, URLContent] = {}  # url -> content (in-memory)

    # ── Detection ─────────────────────────────────────────────────

    def detect_urls(self, text: str) -> list[dict]:
        """Find and classify URLs in text."""
        return detect_urls(text)

    # ── Fetch ─────────────────────────────────────────────────────

    def fetch_url(
        self,
        url: str,
        use_cache: bool = True,
        summarize: bool = False,
        summary_type: Optional[str] = None,
        user_text: Optional[str] = None,
    ) -> URLContent:
        """Fetch URL content, with optional caching and summarization.

        Flow:
        1. Cache check (if use_cache)
        2. Type detection
        3. Handler dispatch
        4. Cache write (if success)
        5. Summarization (if requested)
        """
        url_type, github_info = classify_url(url)

        # 1. Cache check
        if use_cache:
            cached = self._cache.get(url)
            if cached:
                if summarize and not cached.summary:
                    # Generate missing summary
                    stype = summary_type or select_summary_type(
                        cached.url_type,
                        has_symbol_map=bool(cached.symbol_map),
                        user_text=user_text or "",
                    )
                    cached.summary = self._summarize(cached, stype)
                    cached.summary_type = stype
                    self._cache.set(url, cached)
                self._fetched[url] = cached
                return cached

        # 2-3. Fetch
        content = fetch_url(url, url_type, github_info)

        # 4. Cache write (only successful fetches)
        if not content.error:
            self._cache.set(url, content)

        # 5. Summarization
        if summarize and not content.error:
            stype = summary_type or select_summary_type(
                content.url_type,
                has_symbol_map=bool(content.symbol_map),
                user_text=user_text or "",
            )
            content.summary = self._summarize(content, stype)
            content.summary_type = stype
            if not content.error:
                self._cache.set(url, content)

        self._fetched[url] = content
        return content

    def detect_and_fetch(
        self,
        text: str,
        use_cache: bool = True,
        summarize: bool = False,
    ) -> list[URLContent]:
        """Detect all URLs in text and fetch sequentially."""
        detected = self.detect_urls(text)
        results = []
        for d in detected:
            result = self.fetch_url(
                d["url"], use_cache=use_cache, summarize=summarize,
            )
            results.append(result)
        return results

    # ── Content Access ────────────────────────────────────────────

    def get_url_content(self, url: str) -> URLContent:
        """Get content for display. Checks in-memory first, then cache."""
        if url in self._fetched:
            return self._fetched[url]
        cached = self._cache.get(url)
        if cached:
            self._fetched[url] = cached
            return cached
        return URLContent(
            url=url, url_type=URLType.UNKNOWN,
            error="URL not fetched",
        )

    def get_fetched_urls(self) -> list[URLContent]:
        """List all fetched URLContent objects."""
        return list(self._fetched.values())

    # ── Removal ───────────────────────────────────────────────────

    def invalidate_url_cache(self, url: str) -> dict:
        """Remove from both filesystem cache and in-memory."""
        found = self._cache.invalidate(url)
        self._fetched.pop(url, None)
        return {"status": "invalidated", "found": found}

    def remove_fetched(self, url: str) -> dict:
        """Remove from in-memory only. Cache preserved."""
        removed = url in self._fetched
        self._fetched.pop(url, None)
        return {"status": "removed", "found": removed}

    def clear_fetched(self):
        """Clear in-memory fetched dict."""
        self._fetched.clear()

    def clear_url_cache(self) -> dict:
        """Clear all cached and fetched URLs."""
        count = self._cache.clear()
        self._fetched.clear()
        return {"status": "cleared", "count": count}

    # ── Context Formatting ────────────────────────────────────────

    def format_url_context(
        self,
        urls: Optional[list[str]] = None,
        excluded: Optional[set[str]] = None,
        max_length: int = 4000,
    ) -> str:
        """Format fetched URLs for prompt injection.

        Excludes specified URLs and errors.
        """
        excluded = excluded or set()
        if urls is None:
            sources = list(self._fetched.values())
        else:
            sources = [self._fetched[u] for u in urls if u in self._fetched]

        parts = []
        for content in sources:
            if content.url in excluded:
                continue
            if content.error:
                continue
            formatted = content.format_for_prompt(max_length=max_length)
            if formatted:
                parts.append(formatted)

        return "\n---\n".join(parts)

    # ── Summarization ─────────────────────────────────────────────

    def _summarize(self, content: URLContent, summary_type: str) -> Optional[str]:
        """Generate LLM summary of content."""
        if not self._model:
            return None

        # Assemble text
        parts = []
        if content.title:
            parts.append(f"Title: {content.title}")
        if content.description:
            parts.append(f"Description: {content.description}")
        if content.readme:
            parts.append(content.readme)
        if content.symbol_map:
            parts.append(f"Symbol Map:\n{content.symbol_map}")
        if content.content:
            parts.append(content.content)

        full_text = "\n\n".join(parts)
        if len(full_text) > _MAX_SUMMARY_INPUT:
            full_text = full_text[:_MAX_SUMMARY_INPUT]

        prompt = _SUMMARY_PROMPTS.get(summary_type, _SUMMARY_PROMPTS["brief"])

        try:
            import litellm
            response = litellm.completion(
                model=self._model,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": full_text},
                ],
                temperature=0.3,
                max_tokens=1000,
            )
            return response.choices[0].message.content
        except Exception as e:
            logger.warning(f"Summarization failed: {e}")
            return None