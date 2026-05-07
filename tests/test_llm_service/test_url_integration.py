"""URL service integration in the streaming pipeline.

Covers :class:`TestURLIntegration` — :meth:`LLMService._detect_and_fetch_urls`
and its interaction with :meth:`LLMService.chat_streaming`. Verifies
URLs are detected, fetched during streaming, injected into the
context manager's URL section, skipped when already fetched,
capped per-message, and excluded per the ``excluded_urls``
argument.

Thin RPC surface (:func:`detect_urls`, :func:`get_url_content`,
:func:`invalidate_url_cache`, :func:`remove_fetched_url`,
:func:`clear_url_cache`) is also pinned here — those methods
delegate to the URL service.

Governing spec: :doc:`specs4/4-features/url-content`.
"""

from __future__ import annotations

import asyncio

import pytest

from ac_dc.llm_service import LLMService

from .conftest import _FakeLiteLLM, _RecordingEventCallback


class TestURLIntegration:
    """URL service integration in LLMService — Layer 4.1.6."""

    def test_url_service_constructed(
        self,
        service: LLMService,
    ) -> None:
        """LLMService constructs a URL service with cache and model."""
        assert service._url_service is not None
        # Cache present — config defaults to a temp-dir path.
        assert service._url_service._cache is not None
        # Smaller model wired from config.
        assert service._url_service._smaller_model == (
            service._config.smaller_model
        )

    def test_detect_urls_delegates(self, service: LLMService) -> None:
        """detect_urls RPC passes through to the URL service."""
        result = service.detect_urls(
            "see https://example.com and https://github.com/a/b"
        )
        assert len(result) == 2
        assert result[0]["url"] == "https://example.com"
        assert result[0]["type"] == "generic"
        assert result[1]["type"] == "github_repo"

    def test_get_url_content_sentinel_when_not_fetched(
        self,
        service: LLMService,
    ) -> None:
        """Unknown URL returns the not-fetched sentinel."""
        result = service.get_url_content("https://unknown.example.com")
        assert result["error"] == "URL not yet fetched"

    def test_invalidate_url_cache_delegates(
        self,
        service: LLMService,
    ) -> None:
        """invalidate_url_cache returns the service's status dict."""
        result = service.invalidate_url_cache("https://never-fetched.com")
        assert result["status"] == "ok"
        assert result["fetched_removed"] is False

    def test_remove_fetched_url_delegates(
        self,
        service: LLMService,
    ) -> None:
        """remove_fetched_url returns the service's status dict."""
        result = service.remove_fetched_url("https://never-fetched.com")
        assert result["status"] == "ok"
        assert result["removed"] is False

    def test_clear_url_cache_delegates(
        self,
        service: LLMService,
    ) -> None:
        """clear_url_cache returns the service's status dict."""
        result = service.clear_url_cache()
        assert result["status"] == "ok"
        assert "cache_cleared" in result

    async def test_streaming_with_url_triggers_fetch(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Streaming a message with a URL fetches and notifies."""
        from ac_dc.url_service.models import URLContent

        # Stub the URL service's fetch_url to avoid real network.
        # Populates _fetched so format_url_context emits content.
        fetched_content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="page body",
            fetched_at="2025-01-01T00:00:00Z",
        )

        def fake_fetch(url, **kwargs):
            service._url_service._fetched[url] = fetched_content
            return fetched_content

        monkeypatch.setattr(
            service._url_service, "fetch_url", fake_fetch
        )

        # Minimal streaming response — we just care about the
        # pre-assembly URL fetch, not the LLM output.
        fake_litellm.set_streaming_chunks(["ok"])

        await service.chat_streaming(
            request_id="r1",
            message="check this out: https://example.com",
        )
        await asyncio.sleep(0.3)

        # compactionEvent fired twice — url_fetch then url_ready.
        compaction_events = [
            args
            for name, args in event_cb.events
            if name == "compactionEvent"
        ]
        url_events = [
            ev for ev in compaction_events
            if ev[1].get("stage") in ("url_fetch", "url_ready")
        ]
        assert len(url_events) == 2
        assert url_events[0][1]["stage"] == "url_fetch"
        assert url_events[0][1]["url"] == "example.com"
        assert url_events[1][1]["stage"] == "url_ready"

    async def test_streaming_skips_already_fetched_urls(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Already-fetched URLs produce no fetch events."""
        from ac_dc.url_service.models import URLContent

        # Pre-populate the URL service's fetched dict.
        service._url_service._fetched["https://example.com"] = URLContent(
            url="https://example.com",
            url_type="generic",
            content="cached body",
            fetched_at="2025-01-01T00:00:00Z",
        )

        fetch_calls = []

        def fake_fetch(url, **kwargs):
            fetch_calls.append(url)
            return service._url_service._fetched[url]

        monkeypatch.setattr(
            service._url_service, "fetch_url", fake_fetch
        )

        fake_litellm.set_streaming_chunks(["ok"])

        await service.chat_streaming(
            request_id="r1",
            message="revisit https://example.com",
        )
        await asyncio.sleep(0.3)

        # No fetch happened since the URL was already fetched.
        assert fetch_calls == []

        # No fetch-progress events either.
        url_events = [
            args
            for name, args in event_cb.events
            if name == "compactionEvent"
            and args[1].get("stage") in ("url_fetch", "url_ready")
        ]
        assert url_events == []

    async def test_streaming_without_urls_skips_fetch_path(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Messages with no URLs produce no URL-related events."""
        fake_litellm.set_streaming_chunks(["ok"])

        await service.chat_streaming(
            request_id="r1",
            message="hello, no urls here",
        )
        await asyncio.sleep(0.3)

        url_events = [
            args
            for name, args in event_cb.events
            if name == "compactionEvent"
            and args[1].get("stage") in ("url_fetch", "url_ready")
        ]
        assert url_events == []

    async def test_streaming_injects_url_content_into_context(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Fetched URL content lands in context manager's URL section."""
        from ac_dc.url_service.models import URLContent

        fetched_content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="this is the page body",
            fetched_at="2025-01-01T00:00:00Z",
        )

        def fake_fetch(url, **kwargs):
            service._url_service._fetched[url] = fetched_content
            return fetched_content

        monkeypatch.setattr(
            service._url_service, "fetch_url", fake_fetch
        )

        fake_litellm.set_streaming_chunks(["ok"])

        await service.chat_streaming(
            request_id="r1",
            message="explain https://example.com",
        )
        await asyncio.sleep(0.3)

        # URL content attached to context manager.
        url_context = service._context.get_url_context()
        assert len(url_context) == 1
        assert "example.com" in url_context[0]
        assert "this is the page body" in url_context[0]

    async def test_per_message_url_limit_applied(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Only the first 3 URLs in a message get fetched."""
        from ac_dc.url_service.models import URLContent

        fetched_urls = []

        def fake_fetch(url, **kwargs):
            fetched_urls.append(url)
            content = URLContent(
                url=url,
                url_type="generic",
                content="body",
                fetched_at="2025-01-01T00:00:00Z",
            )
            service._url_service._fetched[url] = content
            return content

        monkeypatch.setattr(
            service._url_service, "fetch_url", fake_fetch
        )

        fake_litellm.set_streaming_chunks(["ok"])

        # Five URLs in the prompt; only first three should fetch.
        message = (
            "https://a.example.com https://b.example.com "
            "https://c.example.com https://d.example.com "
            "https://e.example.com"
        )
        await service.chat_streaming(
            request_id="r1",
            message=message,
        )
        await asyncio.sleep(0.3)

        assert len(fetched_urls) == 3

    async def test_excluded_urls_omitted_from_prompt_context(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """``excluded_urls`` kwarg drops URLs from this turn's prompt.

        End-to-end contract for the chip UI's include checkbox.
        The user has two fetched URLs from a prior turn; on
        send they uncheck one. The streaming handler receives
        the exclusion list and threads it through to
        :meth:`URLService.format_url_context` so the excluded
        URL's content doesn't appear in ``_url_context`` on the
        context manager.

        The URLs themselves STAY in the URL service's
        session-scoped ``_fetched`` dict — the chip remains
        visible so the user can re-include on a later turn by
        rechecking the box. This is the distinguishing behaviour
        from :meth:`remove_fetched_url`, which drops the chip
        entirely.
        """
        from ac_dc.url_service.models import URLContent

        # Pre-populate two fetched URLs from prior turns.
        service._url_service._fetched["https://keep.example.com"] = (
            URLContent(
                url="https://keep.example.com",
                url_type="generic",
                content="keep body",
                fetched_at="2025-01-01T00:00:00Z",
            )
        )
        service._url_service._fetched["https://drop.example.com"] = (
            URLContent(
                url="https://drop.example.com",
                url_type="generic",
                content="drop body",
                fetched_at="2025-01-01T00:00:00Z",
            )
        )

        fake_litellm.set_streaming_chunks(["ok"])

        # User sends a message with no new URLs but asks to
        # exclude drop.example.com from this turn.
        await service.chat_streaming(
            request_id="r1",
            message="tell me about what we discussed",
            excluded_urls=["https://drop.example.com"],
        )
        await asyncio.sleep(0.3)

        # URL context built for the LLM contains only the kept
        # URL's content.
        url_context = service._context.get_url_context()
        assert len(url_context) == 1
        joined = url_context[0]
        assert "keep body" in joined
        assert "keep.example.com" in joined
        # Excluded URL's content is ABSENT.
        assert "drop body" not in joined
        assert "drop.example.com" not in joined

        # Both URLs still in the session-scoped fetched dict —
        # chips stay visible, user can re-include on next turn.
        fetched_keys = set(service._url_service._fetched.keys())
        assert "https://keep.example.com" in fetched_keys
        assert "https://drop.example.com" in fetched_keys

    async def test_excluded_urls_empty_list_is_noop(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Empty exclusion list → all fetched URLs contribute.

        Regression guard: a falsy-but-not-None argument must
        behave the same as no argument. The `or []` coalescing
        in :meth:`chat_streaming` handles the None case; this
        test pins the explicit empty list behaviour so a future
        refactor that collapses the two paths doesn't
        accidentally treat `[]` as "exclude everything".
        """
        from ac_dc.url_service.models import URLContent

        service._url_service._fetched["https://a.example.com"] = (
            URLContent(
                url="https://a.example.com",
                url_type="generic",
                content="a body",
                fetched_at="2025-01-01T00:00:00Z",
            )
        )
        service._url_service._fetched["https://b.example.com"] = (
            URLContent(
                url="https://b.example.com",
                url_type="generic",
                content="b body",
                fetched_at="2025-01-01T00:00:00Z",
            )
        )

        fake_litellm.set_streaming_chunks(["ok"])
        await service.chat_streaming(
            request_id="r1",
            message="ask something",
            excluded_urls=[],
        )
        await asyncio.sleep(0.3)

        url_context = service._context.get_url_context()
        assert len(url_context) == 1
        joined = url_context[0]
        # Both URLs contribute when nothing is excluded.
        assert "a body" in joined
        assert "b body" in joined

    async def test_excluded_urls_multiple_all_omitted(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Multiple excluded URLs are all dropped.

        Covers the set-conversion path in
        :meth:`_detect_and_fetch_urls`: the list arrives as a
        list, gets converted to a set, and every member is
        filtered by :meth:`URLService.format_url_context`.
        """
        from ac_dc.url_service.models import URLContent

        for i, url in enumerate(
            [
                "https://a.example.com",
                "https://b.example.com",
                "https://c.example.com",
            ]
        ):
            service._url_service._fetched[url] = URLContent(
                url=url,
                url_type="generic",
                content=f"body {i}",
                fetched_at="2025-01-01T00:00:00Z",
            )

        fake_litellm.set_streaming_chunks(["ok"])
        await service.chat_streaming(
            request_id="r1",
            message="ask",
            excluded_urls=[
                "https://a.example.com",
                "https://c.example.com",
            ],
        )
        await asyncio.sleep(0.3)

        url_context = service._context.get_url_context()
        assert len(url_context) == 1
        joined = url_context[0]
        # Only b survives.
        assert "body 1" in joined
        assert "body 0" not in joined
        assert "body 2" not in joined

    async def test_excluded_urls_all_fetched_clears_context(
        self,
        service: LLMService,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Excluding every fetched URL → empty URL context.

        When the exclusion set covers all fetched URLs,
        :meth:`URLService.format_url_context` returns an empty
        string. The streaming handler's branch on
        ``if url_context:`` then calls
        :meth:`ContextManager.clear_url_context` instead of
        attaching — so the prompt has no URL section at all.
        """
        from ac_dc.url_service.models import URLContent

        service._url_service._fetched["https://only.example.com"] = (
            URLContent(
                url="https://only.example.com",
                url_type="generic",
                content="only body",
                fetched_at="2025-01-01T00:00:00Z",
            )
        )

        fake_litellm.set_streaming_chunks(["ok"])
        await service.chat_streaming(
            request_id="r1",
            message="ask",
            excluded_urls=["https://only.example.com"],
        )
        await asyncio.sleep(0.3)

        # No URL context attached — format returned empty.
        assert service._context.get_url_context() == []
        # URL still in fetched dict.
        assert (
            "https://only.example.com"
            in service._url_service._fetched
        )