"""Cache-warmer cacheable-prefix floor gate.

The warmer must not fire a provider call when the cacheable
prefix (everything up to the last ``cache_control`` marker) is
below the model's minimum cacheable length. Anthropic / Bedrock
silently ignore the marker in that case, so the firing writes 0 /
reads 0 — a guaranteed 0% hit that is pure cost. Early in a
session, when nearly all content sits on the Active tier and the
cached tiers L0–L3 are tiny, this is exactly the state that
produced the field report of a "virtually empty cache" warmer
firing every interval with 0% hit.

These tests pin:

- ``_cacheable_prefix_tokens`` counts only up to the last marker
  and returns 0 when no marker is present.
- ``_run`` skips the firing (no provider call, ``skipped: True``
  broadcast, clean reschedule, no strike) when the prefix is
  below the floor.
- ``_run`` proceeds normally when the prefix meets the floor.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from ac_dc.config import ConfigManager
from ac_dc.llm._cache_warmer import CacheWarmer


@pytest.fixture
def warmer_service(
    config: ConfigManager,
    repo,
    history_store,
    event_cb,
    fake_litellm,
):
    """Service with the cache warmer enabled.

    The shared ``config`` fixture force-disables the warmer for
    the rest of the suite; re-enable it here so ``start()`` /
    ``_run`` exercise real scheduling. Tests cancel the warmer
    explicitly in teardown to avoid leaking the timer task.
    """
    if isinstance(config._app_config, dict):
        config._app_config.setdefault("cache_warmup", {})["enabled"] = True
    from ac_dc.llm_service import LLMService

    svc = LLMService(
        config=config,
        repo=repo,
        event_callback=event_cb,
        history_store=history_store,
    )
    return svc


def _marked(text: str) -> dict[str, Any]:
    """A message carrying a cache_control marker on its text block."""
    return {
        "role": "user",
        "content": [
            {
                "type": "text",
                "text": text,
                "cache_control": {"type": "ephemeral"},
            }
        ],
    }


def _plain(text: str, role: str = "user") -> dict[str, Any]:
    return {"role": role, "content": text}


class TestCacheablePrefixTokens:
    def test_zero_when_no_marker(self, warmer_service):
        """No cache_control anywhere → no cacheable prefix → 0."""
        warmer = warmer_service._cache_warmer
        messages = [_plain("system text"), _plain("hi there")]
        assert warmer._cacheable_prefix_tokens(messages) == 0

    def test_counts_only_up_to_last_marker(self, warmer_service):
        """Tokens after the last marker don't count toward the floor."""
        warmer = warmer_service._cache_warmer
        counter = warmer_service._counter
        prefix_msgs = [_plain("alpha beta gamma"), _marked("delta epsilon")]
        tail = _plain("this tail is uncached and should not count")
        expected = sum(counter.count_message(m) for m in prefix_msgs)

        got = warmer._cacheable_prefix_tokens(prefix_msgs + [tail])

        assert got == expected
        # Sanity: the tail genuinely carries tokens we excluded.
        assert counter.count_message(tail) > 0

    def test_last_of_multiple_markers_wins(self, warmer_service):
        """Prefix extends to the LAST marker, not the first."""
        warmer = warmer_service._cache_warmer
        counter = warmer_service._counter
        msgs = [_marked("first block"), _plain("mid"), _marked("second block")]
        expected = sum(counter.count_message(m) for m in msgs)
        assert warmer._cacheable_prefix_tokens(msgs) == expected


class TestPrefixGate:
    """``_run`` skips the firing below the floor, fires above it."""

    def _drive_fire_phase(self, warmer: CacheWarmer) -> None:
        """Run just the firing phase of ``_run``.

        ``_run`` is a long two-phase coroutine; we don't want to
        wait out the silent/countdown phases. Set ``_scheduled_at``
        to now so both phases fall through immediately, then run
        the coroutine to completion on a fresh loop.
        """
        import time

        warmer._scheduled_at = time.time()
        asyncio.run(warmer._run(0.0))

    def test_skips_firing_below_floor(
        self, warmer_service, fake_litellm, event_cb, monkeypatch
    ):
        """Tiny cacheable prefix → no provider call, skipped broadcast."""
        warmer = warmer_service._cache_warmer
        # Force the assembled prefix below the model floor.
        monkeypatch.setattr(
            warmer, "_cacheable_prefix_tokens", lambda messages: 10
        )
        monkeypatch.setattr(
            type(warmer_service._counter),
            "min_cacheable_tokens",
            property(lambda self: 4096),
        )

        before = fake_litellm.call_count
        self._drive_fire_phase(warmer)

        # No provider call fired.
        assert fake_litellm.call_count == before
        # A skipped-success broadcast went out.
        skipped = [
            args for (name, args) in event_cb.events
            if name == "cacheWarmupComplete"
            and args and isinstance(args[0], dict)
            and args[0].get("skipped")
        ]
        assert skipped, "expected a skipped cacheWarmupComplete broadcast"
        assert skipped[0][0]["success"] is True
        # Skip is a healthy state — no strike accrued.
        assert warmer._consecutive_drift_strikes == 0
        # No cacheWarmupFiring broadcast (the call never went out).
        assert not any(
            name == "cacheWarmupFiring" for (name, _args) in event_cb.events
        )

    def test_fires_when_prefix_meets_floor(
        self, warmer_service, fake_litellm, event_cb, monkeypatch
    ):
        """Prefix at/above the floor → the warm-up call proceeds."""
        warmer = warmer_service._cache_warmer
        monkeypatch.setattr(
            warmer, "_cacheable_prefix_tokens", lambda messages: 5000
        )
        monkeypatch.setattr(
            type(warmer_service._counter),
            "min_cacheable_tokens",
            property(lambda self: 4096),
        )

        before = fake_litellm.call_count
        self._drive_fire_phase(warmer)

        # The warm-up provider call fired.
        assert fake_litellm.call_count == before + 1
        # A firing broadcast went out (countdown → spinner transition).
        assert any(
            name == "cacheWarmupFiring" for (name, _args) in event_cb.events
        )
