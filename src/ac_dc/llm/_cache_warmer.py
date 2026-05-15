"""Cache warm-keeper — periodic cache-prefix refresh.

Anthropic's prompt cache uses a 5-minute sliding TTL: any
read or write extends the window. During interactive coding
sessions the user often pauses for >5 minutes to think, read,
or context-switch. When the user comes back, the cached
prefix has expired and the next turn pays the full cache-
write price (1.25× input on Claude) to re-prime.

This module keeps the cache warm by issuing a tiny
``litellm.completion`` call every ``interval_seconds``
seconds of inactivity. The call:

- Reuses the EXACT cached prefix that a real turn would.
  Assembled via the same code path as ``stream_chat``, so
  every byte matches.
- Appends a minimal user message asking for a 1-token
  acknowledgement.
- Disables reasoning regardless of session config — a warm-
  up never benefits from hidden thinking, and the budget
  would defeat the cost-minimisation goal.
- Skips when any LLM stream is in flight (rate limits +
  provider concurrency).

The cumulative wait of any retry sequence is bounded against
the cache TTL: if a retry would push past 5 minutes, we
abort and disable. By that point a fresh warm-up would write
a new cache anyway, so paying the retry cost is pointless.

Lifecycle:

- Constructed lazily from :class:`LLMService.__init__`.
- ``start()`` schedules the first firing. Called from
  :func:`complete_deferred_init` (or the synchronous init
  path when ``deferred_init=False``) once the L0 snapshot is
  ready.
- ``cancel()`` stops the pending timer without rescheduling.
  Called at the start of every ``stream_chat`` invocation.
- ``reset(reason)`` cancels and reschedules. Called at the
  end of every ``stream_chat`` invocation, marking "user
  activity just happened".
- ``disable(reason)`` cancels and stays inert until
  ``enable()`` is called. Triggered by warm-up failure or
  retry-budget exhaustion. Step 1 logs disable events; step
  2 will broadcast to the UI for a toast + toggle update.

Single-instance per :class:`LLMService` — only the main
conversation is warmed. Agent contexts have transient cache
state by design (each spawn writes a fresh cache); warming
them would multiply provider load with no proportional
benefit.

Governing spec: ``cache_warmup`` section of ``app.json``.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ac_dc.llm_service import LLMService

logger = logging.getLogger("ac_dc.llm_service.cache_warmer")


# Tiny user prompt that doesn't meaningfully change the
# cached prefix tail. The exact wording matters less than
# the fact that it's the same every time — a stable suffix
# makes warm-ups easy to spot in provider logs.
_WARMUP_PROMPT = "ping (cache warm-up — respond with 'ok')"

# Output ceiling. Providers reject 0; 2 covers a single
# token plus any provider-specific framing tokens that
# might be counted against the limit.
_WARMUP_MAX_TOKENS = 2

# Cache TTL — used as the retry-budget cutoff. If our
# cumulative retry waits + estimated latency push past
# this, the cached prefix is gone regardless of whether
# the call eventually succeeds, so we disable rather than
# burn the rest of the retry budget.
_CACHE_TTL_SECONDS = 300.0

# How long the visible countdown lasts before the warm-up
# fires. The frontend renders a progress bar for this
# window — one tick per second — so the user sees a
# 30-second lead-in to every warm-up call rather than the
# call appearing out of nowhere. 30s is short enough not
# to be intrusive in a long idle window, long enough to
# give the user time to read the banner and decide whether
# to interrupt by sending a real message.
_COUNTDOWN_SECONDS = 30.0


class CacheWarmer:
    """Background timer keeping the provider cache warm."""

    def __init__(self, service: "LLMService") -> None:
        self._service = service
        self._task: asyncio.Task[Any] | None = None
        # Mirrors config at start time. ``disable()`` flips
        # this independently of config so a runtime failure
        # can turn the warmer off without rewriting config.
        # Re-enabling requires explicit ``enable()``.
        self._enabled: bool = True
        self._last_disabled_reason: str | None = None
        # Wall-clock time of the next scheduled firing.
        # ``None`` when no timer is active. Surfaced via
        # ``seconds_remaining`` for the UI countdown in step 2.
        self._scheduled_at: float | None = None

    # ------------------------------------------------------------------
    # Public state accessors (consumed by the future RPC + UI)
    # ------------------------------------------------------------------

    @property
    def enabled(self) -> bool:
        """Whether the warmer is currently active."""
        return self._enabled

    @property
    def last_disabled_reason(self) -> str | None:
        """Reason for the last automatic disable, if any."""
        return self._last_disabled_reason

    @property
    def seconds_remaining(self) -> float | None:
        """Seconds until the next firing, or None if idle."""
        if self._scheduled_at is None:
            return None
        return max(0.0, self._scheduled_at - time.time())

    @property
    def interval_seconds(self) -> float:
        """Configured interval between warm-up firings."""
        cfg = self._service._config.cache_warmup_config
        return float(cfg.get("interval_seconds", 270))

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        """Begin the warm-up cycle if config has it enabled."""
        cfg = self._service._config.cache_warmup_config
        if not cfg.get("enabled", True):
            logger.debug("Cache warmer disabled by config")
            self._enabled = False
            return
        self._enabled = True
        self._schedule()

    def cancel(self) -> None:
        """Cancel the pending timer without rescheduling."""
        if self._task is not None and not self._task.done():
            self._task.cancel()
        self._task = None
        self._scheduled_at = None

    def reset(self, reason: str) -> None:
        """Cancel and reschedule.

        Called on every event that resets the activity
        clock — successful stream completion, mode switch,
        cross-ref toggle, cache rebuild, new session.
        ``reason`` is logged at debug for diagnostic
        traces.
        """
        if not self._enabled:
            return
        logger.debug("Cache warmer reset: %s", reason)
        self.cancel()
        self._schedule()

    def disable(self, reason: str) -> None:
        """Cancel and stay inert until ``enable()`` is called."""
        logger.warning("Cache warmer disabled: %s", reason)
        self.cancel()
        self._enabled = False
        self._last_disabled_reason = reason

    def enable(self) -> None:
        """Re-enable after a runtime disable.

        Used by the future RPC. Clears the disabled-reason
        and reschedules.
        """
        self._enabled = True
        self._last_disabled_reason = None
        self._schedule()

    # ------------------------------------------------------------------
    # Internal — scheduling and firing
    # ------------------------------------------------------------------

    def _schedule(self) -> None:
        """Schedule the next firing.

        No-op when the warmer is disabled or no event loop
        is running. The latter happens during synchronous
        construction — ``start()`` may be called from
        ``__init__`` before the event loop is up. The first
        ``stream_chat`` invocation captures a loop and its
        trailing ``reset()`` picks the warmer up at that
        point.
        """
        if not self._enabled:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # No running loop — defer until next reset()
            # from a context that has one.
            return
        # Belt-and-braces: cancel any stale task. cancel()
        # already nulls _task, so this is for the case where
        # _schedule runs from a path that didn't go through
        # cancel() first.
        if self._task is not None and not self._task.done():
            self._task.cancel()
        interval = self.interval_seconds
        self._scheduled_at = time.time() + interval
        self._task = loop.create_task(self._run(interval))

    async def _run(self, delay: float) -> None:
        """Sleep ``delay``, run the visible countdown, fire warm-up.

        Two-phase wait. Most of the interval is silent:
        ``sleep(delay - countdown)``. The final
        ``_COUNTDOWN_SECONDS`` are visible — one
        ``cacheWarmupCountdown`` broadcast per second so
        the frontend can render a progress bar matching
        the retry-banner UX. After the countdown lands,
        ``cacheWarmupFiring`` flips the bar to "running",
        the warm-up call goes out, and
        ``cacheWarmupComplete`` (or ``cacheWarmupDisabled``
        on failure) closes the banner.

        A user-initiated stream during the countdown
        cancels the timer via the ``cancel()`` call in
        ``stream_chat`` — the asyncio.CancelledError below
        propagates and the broadcast loop exits cleanly.
        """
        # Silent phase. If ``delay`` is shorter than the
        # countdown window (e.g. a config with a tiny
        # interval, or a manually-triggered run), skip
        # straight to the visible phase.
        silent = max(0.0, delay - _COUNTDOWN_SECONDS)
        try:
            if silent > 0:
                await asyncio.sleep(silent)
        except asyncio.CancelledError:
            return
        # Stream-active check before the visible phase
        # begins — no point showing a countdown that
        # we'll just abort. Reschedule rather than disable.
        service = self._service
        if (
            service._active_user_request is not None
            or bool(service._active_agent_streams)
        ):
            logger.debug("Cache warmer skipping — stream active")
            self._scheduled_at = None
            self._schedule()
            return
        # Visible countdown phase. Tick once per second,
        # broadcasting remaining time so the frontend can
        # animate. The broadcast is best-effort —
        # an event-callback failure logs and continues.
        countdown = min(delay, _COUNTDOWN_SECONDS)
        ticks = int(countdown)
        try:
            for i in range(ticks, 0, -1):
                await self._broadcast(
                    "cacheWarmupCountdown",
                    {
                        "seconds_remaining": i,
                        "total": ticks,
                    },
                )
                await asyncio.sleep(1.0)
                # Re-check stream activity each tick so a
                # request that starts mid-countdown
                # cancels the visible bar via the bar's
                # own logic rather than letting it run
                # to zero and then aborting.
                if (
                    service._active_user_request is not None
                    or bool(service._active_agent_streams)
                ):
                    await self._broadcast(
                        "cacheWarmupCancelled",
                        {"reason": "stream-active"},
                    )
                    self._scheduled_at = None
                    self._schedule()
                    return
        except asyncio.CancelledError:
            # Clean cancel — banner closes via the chat
            # panel's own cancel handling on stream-start.
            await self._broadcast(
                "cacheWarmupCancelled",
                {"reason": "user-activity"},
            )
            return
        # Firing phase. Broadcast the transition so the
        # frontend can flip the bar from countdown to
        # spinner. The actual call follows.
        await self._broadcast("cacheWarmupFiring", {})
        try:
            await self._fire_warmup()
        except asyncio.CancelledError:
            await self._broadcast(
                "cacheWarmupCancelled",
                {"reason": "user-activity"},
            )
            return
        except Exception as exc:
            await self._broadcast(
                "cacheWarmupComplete",
                {
                    "success": False,
                    "reason": str(exc),
                },
            )
            self.disable(f"warm-up failed: {exc}")
            return
        # Successful firing — broadcast and schedule the next.
        await self._broadcast(
            "cacheWarmupComplete",
            {"success": True},
        )
        self._scheduled_at = None
        self._schedule()

    async def _broadcast(self, event_name: str, payload: Any) -> None:
        """Best-effort event broadcast.

        Failures here must not break the warmer's state
        machine — the event channel is an observability
        layer, not a correctness dependency.
        """
        try:
            await self._service._broadcast_event_async(
                event_name, payload,
            )
        except Exception as exc:
            logger.debug(
                "Cache warmer broadcast %s failed: %s",
                event_name, exc,
            )

    async def _fire_warmup(self) -> None:
        """Issue the warm-up call and log the cache stats."""
        service = self._service
        # Assemble messages exactly as a real turn would,
        # using the main scope so the cached prefix matches.
        scope = service._default_scope()
        tiered_content = service._build_tiered_content(scope)
        if tiered_content is None:
            messages = service._assemble_messages_flat(
                _WARMUP_PROMPT, [], scope,
            )
        else:
            messages = service._assemble_tiered(
                _WARMUP_PROMPT, [], tiered_content, scope,
            )
        loop = asyncio.get_running_loop()
        started = time.time()
        prompt_tokens, cache_read = await loop.run_in_executor(
            service._aux_executor,
            self._completion_sync,
            messages,
            started,
        )
        elapsed = time.time() - started
        hit_pct = (
            (cache_read / prompt_tokens * 100)
            if prompt_tokens else 0.0
        )
        # On a cold cache (first warm-up before any user
        # turn) cache_read will be 0 — that's a priming
        # write. After any real turn, subsequent warm-ups
        # should show cache_read > 0; persistent zeros mean
        # the cached prefix is drifting between calls and
        # there's a bug worth diagnosing.
        logger.info(
            "Cache warm-up: %.1fs prompt=%d cache_read=%d "
            "(%.0f%% hit)",
            elapsed, prompt_tokens, cache_read, hit_pct,
        )

    def _completion_sync(
        self,
        messages: list[dict[str, Any]],
        started: float,
    ) -> tuple[int, int]:
        """Blocking warm-up call. Runs in the aux executor.

        Returns ``(prompt_tokens, cache_read_tokens)``.
        Raises on any failure — the caller's ``except``
        block disables the warmer.
        """
        from ac_dc.llm._helpers import retry_litellm_completion
        try:
            import litellm
        except ImportError as exc:
            raise RuntimeError(
                "litellm not installed — cache warmer cannot run"
            ) from exc
        config = self._service._config

        def _call() -> Any:
            # No ``thinking`` kwarg — warm-ups never reason
            # regardless of session config. Cheap, fast,
            # cache-bytes-preserving by design.
            return litellm.completion(
                model=config.model,
                messages=messages,
                stream=False,
                max_tokens=_WARMUP_MAX_TOKENS,
                timeout=config.aux_request_timeout_seconds,
            )

        # Retry-budget guard. If a retry would push past the
        # cache TTL, the warm-up was pointless — abort and
        # let the caller disable.
        def _on_retry(info: dict[str, Any]) -> None:
            elapsed = time.time() - started
            wait = float(info.get("wait_seconds", 0.0))
            if elapsed + wait >= _CACHE_TTL_SECONDS:
                raise RuntimeError(
                    f"retry budget exceeded — elapsed "
                    f"{elapsed:.0f}s + wait {wait:.0f}s "
                    f">= TTL {_CACHE_TTL_SECONDS:.0f}s"
                )

        response = retry_litellm_completion(
            litellm,
            _call,
            max_attempts=config.num_retries + 1,
            context="cache warm-up",
            on_retry=_on_retry,
        )
        usage = getattr(response, "usage", None)
        if usage is None:
            return (0, 0)

        def _get(name: str, source: Any = usage) -> int:
            if isinstance(source, dict):
                val = source.get(name)
            else:
                val = getattr(source, name, None)
            try:
                return int(val) if val is not None else 0
            except (TypeError, ValueError):
                return 0

        prompt = _get("prompt_tokens")
        # Match the cache_read normalisation in
        # _streaming.run_completion_sync — Anthropic uses
        # cache_read_input_tokens, OpenAI uses
        # prompt_tokens_details.cached_tokens.
        prompt_details = (
            usage.get("prompt_tokens_details")
            if isinstance(usage, dict)
            else getattr(usage, "prompt_tokens_details", None)
        )
        prompt_cached = (
            _get("cached_tokens", source=prompt_details)
            if prompt_details is not None
            else 0
        )
        cache_read = max(
            _get("cache_read_input_tokens"),
            _get("cache_read_tokens"),
            prompt_cached,
        )
        return (prompt, cache_read)