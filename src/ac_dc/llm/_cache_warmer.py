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


class _WarmupCancelled(Exception):
    """Internal marker — warmer cancelled mid-retry.

    Distinguishes "user activity arrived during a retry
    backoff" (clean reschedule) from "warm-up failed"
    (disable). Raised by ``_on_retry`` when the generation
    counter has advanced; caught in ``_run``'s exception
    chain to take the cancel branch instead of the
    failure branch.
    """

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


def _extract_int(usage: Any, name: str) -> int:
    """Pull a non-negative int field from a usage object.

    Tolerant of dict and attribute access (LiteLLM's usage
    objects vary by provider integration). Missing,
    non-numeric, or null values normalise to 0.
    """
    if usage is None:
        return 0
    if isinstance(usage, dict):
        val = usage.get(name)
    else:
        val = getattr(usage, name, None)
    try:
        return int(val) if val is not None else 0
    except (TypeError, ValueError):
        return 0


def _extract_cache_read(usage: Any) -> int:
    """Cross-provider cache-read extraction.

    Anthropic uses ``cache_read_input_tokens``, OpenAI
    uses ``prompt_tokens_details.cached_tokens``, LiteLLM
    sometimes flattens to ``cache_read_tokens``. Take the
    max so the result reflects whatever the provider
    actually reported.
    """
    if usage is None:
        return 0
    prompt_details = (
        usage.get("prompt_tokens_details")
        if isinstance(usage, dict)
        else getattr(usage, "prompt_tokens_details", None)
    )
    prompt_cached = (
        _extract_int(prompt_details, "cached_tokens")
        if prompt_details is not None
        else 0
    )
    return max(
        _extract_int(usage, "cache_read_input_tokens"),
        _extract_int(usage, "cache_read_tokens"),
        prompt_cached,
    )


def _extract_cache_write(usage: Any) -> int:
    """Cross-provider cache-write extraction.

    Anthropic uses ``cache_creation_input_tokens``,
    LiteLLM sometimes uses ``cache_creation_tokens``.
    OpenAI doesn't report cache writes at all — its
    contribution to the max is always zero.
    """
    if usage is None:
        return 0
    return max(
        _extract_int(usage, "cache_creation_input_tokens"),
        _extract_int(usage, "cache_creation_tokens"),
    )


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
        # Stash for the most recent warm-up's token counts.
        # Populated by :meth:`_fire_warmup` after successful
        # completion; read by :meth:`_run` when broadcasting
        # ``cacheWarmupComplete`` so the frontend can render
        # a Token HUD for the warm-up. Cleared on the next
        # firing's start so a stale snapshot can't bleed
        # into a subsequent broadcast.
        self._last_warmup_tokens: dict[str, Any] | None = None
        # Generation counter — incremented by :meth:`cancel`.
        # ``_completion_sync`` captures the current value
        # when it starts and checks it on every retry. If
        # the counter has advanced, the warm-up was cancelled
        # while a retry was sleeping in the executor thread
        # (which the asyncio cancel can't interrupt), so the
        # next retry attempt raises before firing a stale
        # provider call. Without this, a user message
        # arriving during a rate-limit backoff would race
        # against the warmer's in-flight retry — the user's
        # call goes first, then the deferred warmup fires
        # anyway, hitting the rate limiter a second time
        # and potentially delaying subsequent user calls.
        self._generation: int = 0

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
        """Configured interval between warm-up firings.

        Clamped to ``_CACHE_TTL_SECONDS - 30`` (270s) at the
        upper end. Anthropic's prompt cache uses a 5-minute
        sliding TTL — a warm-up at the 300-second mark or
        beyond fires *after* the cached prefix has already
        expired, so every firing becomes a cold cache write
        and the warmer becomes pure cost with no payoff. The
        30-second margin covers the visible countdown phase
        (``_COUNTDOWN_SECONDS``) and provider request latency
        so the actual provider call lands well inside the
        TTL window.

        A user config with ``interval_seconds: 600`` would
        otherwise produce 0% cache hit on every warm-up
        (observed in the field). Clamping silently here is
        safer than raising — operators see "warmer running
        every 4:30 instead of every 10 min" in the HUD and
        can investigate, whereas a startup error would just
        disable the warmer entirely.
        """
        cfg = self._service._config.cache_warmup_config
        configured = float(cfg.get("interval_seconds", 270))
        ceiling = _CACHE_TTL_SECONDS - 30.0
        if configured > ceiling:
            logger.warning(
                "Cache warmer interval_seconds=%.0f exceeds "
                "Anthropic's 5-minute cache TTL — clamping to "
                "%.0fs to keep warm-ups inside the TTL window. "
                "Update cache_warmup.interval_seconds in app.json "
                "to a value <= %.0f to silence this warning.",
                configured, ceiling, ceiling,
            )
            return ceiling
        return configured

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        """Begin the warm-up cycle if all gates are open.

        Double-gated: BOTH the CLI ``--experimental`` flag
        AND ``app.json::cache_warmup.enabled`` must be
        true. Either being false keeps the warmer inert
        (logs at debug, sets ``_enabled = False`` so the
        UI's ``get_cache_warmer_status`` reports it
        accurately, and skips scheduling).

        The experimental gate is checked first — if
        ``--experimental`` is off, we don't even read the
        config flag. This means operators running without
        ``--experimental`` see "warmer disabled by
        experimental flag" in logs rather than "warmer
        disabled by config", which is the correct
        diagnostic signal for that mode of operation.

        Both gates default to off. Operators must opt in
        via both the CLI flag and the app-config flag to
        try warming. The two-key requirement is
        deliberate — the warmer has a small but non-zero
        risk of provider-side rate-limit interactions, so
        a config-only opt-in is too easy to leave on by
        accident across upgrades.
        """
        if not getattr(self._service, "_experimental", False):
            logger.debug(
                "Cache warmer disabled — "
                "--experimental flag not set"
            )
            self._enabled = False
            return
        cfg = self._service._config.cache_warmup_config
        if not cfg.get("enabled", False):
            logger.debug(
                "Cache warmer disabled — "
                "cache_warmup.enabled is false in app.json"
            )
            self._enabled = False
            return
        self._enabled = True
        self._schedule()

    def cancel(self) -> None:
        """Cancel the pending timer without rescheduling.

        Bumps the generation counter so any in-flight retry
        in the executor thread aborts before its next
        attempt — see :attr:`_generation`. The asyncio task
        cancellation handles the silent / countdown phases
        cleanly; the generation bump handles the case where
        a retry is sleeping inside `litellm.completion`'s
        backoff logic on the executor thread (which asyncio
        cannot interrupt).
        """
        if self._task is not None and not self._task.done():
            self._task.cancel()
        self._task = None
        self._scheduled_at = None
        self._generation += 1

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
        # ``_scheduled_at`` represents actual firing time —
        # the moment ``_fire_warmup`` is invoked. The visible
        # countdown phase (the last ``_COUNTDOWN_SECONDS`` of
        # the interval) is NOT extra time on top of the
        # interval; it's part of the interval itself. The
        # UI's ``seconds_remaining`` poll-derived countdown
        # and the popup's broadcast-derived countdown must
        # therefore agree at firing time.
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
        # Compute the absolute firing target up front. Both
        # the silent and visible phases anchor to this
        # wall-clock time, so accumulated broadcast latency
        # inside the visible-phase loop cannot drift the
        # actual fire time later than the UI's countdown
        # display promises.
        scheduled_at = self._scheduled_at or (time.time() + delay)
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
        # Visible countdown phase. Each tick computes its
        # remaining seconds from the absolute ``scheduled_at``
        # target rather than counting down via ``sleep(1.0)``
        # accumulators. This means broadcast latency inside
        # the loop cannot drift the firing time — if a tick
        # took 1.2s instead of 1.0s, the next tick simply
        # displays one less second and the actual fire still
        # lands on schedule. Without this anchoring, 30
        # ticks × small per-tick overhead compounds into
        # multi-second drift, and the popup's "0s" frame
        # shows several seconds before the fire actually
        # happens.
        countdown = min(delay, _COUNTDOWN_SECONDS)
        total_ticks = int(countdown)
        try:
            last_displayed: int | None = None
            while True:
                remaining_secs = scheduled_at - time.time()
                if remaining_secs <= 0:
                    break
                # Round UP so the displayed countdown reaches
                # zero exactly at ``scheduled_at``, not one
                # tick before. The popup's "0" frame should
                # coincide with the firing broadcast.
                display = max(1, int(remaining_secs + 0.999))
                if display != last_displayed:
                    await self._broadcast(
                        "cacheWarmupCountdown",
                        {
                            "seconds_remaining": display,
                            "total": total_ticks,
                        },
                    )
                    last_displayed = display
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
                # Sleep until the next whole-second boundary
                # of the countdown, capped at 1s so we can
                # re-check activity at least every second.
                next_boundary = remaining_secs - (display - 1)
                await asyncio.sleep(min(1.0, max(0.05, next_boundary)))
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
        # Clear the stash so a stale snapshot from the
        # previous firing can't leak into a failure
        # broadcast (failures don't populate the stash).
        self._last_warmup_tokens = None
        try:
            await self._fire_warmup()
        except asyncio.CancelledError:
            await self._broadcast(
                "cacheWarmupCancelled",
                {"reason": "user-activity"},
            )
            return
        except _WarmupCancelled:
            # Cancelled while a retry was sleeping in the
            # executor thread — clean reschedule, NOT a
            # disable. The asyncio CancelledError branch
            # handles cancellation that lands during the
            # silent or visible countdown phases; this
            # branch handles cancellation that lands while
            # the retry-backoff sleep is in progress.
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
        # Successful firing — broadcast with token data so
        # the frontend can render a Token HUD, and
        # schedule the next.
        payload: dict[str, Any] = {"success": True}
        if self._last_warmup_tokens is not None:
            payload.update(self._last_warmup_tokens)
        await self._broadcast("cacheWarmupComplete", payload)
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
        """Issue the warm-up call, accumulate, log, and broadcast.

        Three side effects beyond the raw provider call:

        - ``service._accumulate_usage(usage)`` — the
          warm-up's prompt/cache tokens enter
          ``_session_totals`` alongside real-turn usage. A
          warm-up is a paid LLM call (cache writes cost
          1.25× input on Claude); making it visible in
          session cumulative counters keeps the cost
          accounting honest. The Token HUD's session totals
          section reflects warm-ups exactly the same way
          it reflects real turns.
        - Stats logged at INFO for operator diagnosis.
        - ``cacheWarmupComplete`` broadcast carries the
          tokens so the frontend can render a Token HUD
          for the warm-up. Backwards-compatible extension
          of the existing payload — older clients that
          ignore the new fields keep working.
        """
        service = self._service
        # Assemble messages exactly as a real turn would,
        # using the main scope so the cached prefix matches.
        # ``skip_active=True`` omits the Active tier (selected
        # files + active history) — Active sits after the last
        # ``cache_control`` marker, so the cached prefix bytes
        # are unchanged and L0–L3 cache hits still land. Saves
        # Active-tier input tokens on every warm-up firing.
        scope = service._default_scope()
        tiered_content = service._build_tiered_content(scope)
        if tiered_content is None:
            messages = service._assemble_messages_flat(
                _WARMUP_PROMPT, [], scope, skip_active=True,
            )
        else:
            messages = service._assemble_tiered(
                _WARMUP_PROMPT, [], tiered_content, scope,
                skip_active=True,
            )
        loop = asyncio.get_running_loop()
        started = time.time()
        usage = await loop.run_in_executor(
            service._aux_executor,
            self._completion_sync,
            messages,
            started,
        )
        elapsed = time.time() - started
        # Accumulate into session totals via the same
        # extraction path that real turns use. Single source
        # of truth for "how do we read tokens off a litellm
        # response" — keeps Anthropic / Bedrock / OpenAI
        # field-shape differences in one place.
        service._accumulate_usage(usage)
        # Pull the same numbers back out for logging and
        # broadcasting. The accumulator wrote them into
        # session totals using its own field-priority
        # logic; we extract here using the warmer's
        # narrower needs (prompt + cache_read +
        # cache_write only).
        prompt_tokens = _extract_int(usage, "prompt_tokens")
        cache_read = _extract_cache_read(usage)
        cache_write = _extract_cache_write(usage)
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
            "cache_write=%d (%.0f%% hit)",
            elapsed, prompt_tokens, cache_read, cache_write,
            hit_pct,
        )
        # Stash the tokens so the broadcast site can carry
        # them in cacheWarmupComplete. _run() (the caller)
        # owns the broadcast — we don't broadcast here
        # because the caller already broadcasts the
        # success/failure event and we want a single
        # broadcast site per outcome, not two.
        self._last_warmup_tokens = {
            "prompt_tokens": prompt_tokens,
            "cache_read_tokens": cache_read,
            "cache_write_tokens": cache_write,
            "elapsed_seconds": elapsed,
        }
        # Print the standard post-response terminal HUD so
        # operators see the same five-section block (cache
        # tiers, last-request usage, history budget, tier
        # changes, session totals) for warm-ups that they
        # see for real chat turns. Builds a ``request_usage``
        # dict in the same shape ``_run_completion_sync``
        # produces — the HUD's ``Last Request`` section
        # consumes that shape directly. Warm-ups have no
        # completion / reasoning output (max_tokens=2,
        # ``thinking`` disabled) so those fields are zero;
        # cost is None because LiteLLM's pricing path was
        # not consulted on this code path. Wrapped in
        # try/except so an HUD bug (e.g. a future formatting
        # change that mishandles a zero field) cannot
        # cascade into a warm-up failure that disables the
        # warmer.
        try:
            warmup_usage: dict[str, Any] = {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": 0,
                "reasoning_tokens": 0,
                "cache_read_tokens": cache_read,
                "cache_write_tokens": cache_write,
                "prompt_cached_tokens": cache_read,
                "cost_usd": None,
            }
            service._print_post_response_hud(warmup_usage)
        except Exception as exc:
            logger.debug(
                "Cache warmer terminal HUD print failed: %s",
                exc,
            )

    def _completion_sync(
        self,
        messages: list[dict[str, Any]],
        started: float,
    ) -> Any:
        """Blocking warm-up call. Runs in the aux executor.

        Returns the raw provider ``usage`` object (or
        ``None`` if the response had none). The caller
        (:meth:`_fire_warmup`) feeds it through
        :meth:`LLMService._accumulate_usage` and the
        helper extractors below to pull individual
        numeric fields.

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
        # Capture the generation at start. If ``cancel()``
        # bumps it during a retry sleep, ``_on_retry`` sees
        # the mismatch and raises rather than letting the
        # retry fire a stale provider call.
        start_generation = self._generation

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

        # Retry-budget guard. Two reasons to abort a retry:
        # (1) cumulative waits would push past the cache TTL
        # — the warm-up was pointless. (2) the warmer was
        # cancelled while we were sleeping in the executor
        # thread (e.g. a user message started a real stream).
        # The asyncio cancel can't interrupt our sleep; the
        # generation bump signals it instead.
        def _on_retry(info: dict[str, Any]) -> None:
            if self._generation != start_generation:
                raise _WarmupCancelled(
                    "warm-up cancelled during retry backoff "
                    f"(generation {start_generation} → "
                    f"{self._generation})"
                )
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
        return getattr(response, "usage", None)