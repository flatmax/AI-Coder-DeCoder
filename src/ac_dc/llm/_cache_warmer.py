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


# ---------------------------------------------------------------------------
# Event-loop heartbeat (diagnostic for D34a follow-up)
# ---------------------------------------------------------------------------
#
# Field observation post-D34a: every third or fourth cycle
# stalls for ~120s with the broadcast `await` taking 119s
# despite (a) no executor queueing (queue_duration=0),
# (b) a clean LiteLLM call (3s), (c) sub-millisecond
# broadcasts on the immediately-prior cycles. The pattern
# rules out the warmer's own code paths and points at the
# event loop being held by something else for the duration.
#
# This heartbeat task wakes up every 100ms and logs at
# WARNING when the gap between wakes exceeds 1 second. A
# 100ms cadence is small enough to catch sub-second stalls
# but large enough that the heartbeat itself doesn't
# dominate scheduler time. The 1-second WARNING threshold
# is large enough that ordinary scheduler jitter (50-150ms
# under load) doesn't trigger noise.
#
# Heartbeat runs forever once started — it's a service-
# wide diagnostic, not a per-warmer thing. Started from
# the warmer's `start()` so it only runs when the warmer
# is enabled. Cancelled by `cancel()` and `disable()`.
#
# This is INSTRUMENTATION, not a fix. The goal is to
# narrow down what's holding the loop. Once we know,
# remove this code.

_HEARTBEAT_INTERVAL_SECONDS = 0.1
_HEARTBEAT_WARN_THRESHOLD_SECONDS = 1.0


async def _heartbeat_loop() -> None:
    """Wake every 100ms; log when the gap exceeds 1s.

    The expected gap is `_HEARTBEAT_INTERVAL_SECONDS` plus
    small scheduler jitter. A gap of >1s means the event
    loop was held — by a blocking call, a long synchronous
    code path, or OS-level process suspension.
    """
    last_wake = time.monotonic()
    while True:
        await asyncio.sleep(_HEARTBEAT_INTERVAL_SECONDS)
        now = time.monotonic()
        gap = now - last_wake
        if gap > _HEARTBEAT_WARN_THRESHOLD_SECONDS:
            logger.warning(
                "Event loop stalled: %.1fs gap (expected "
                "%.1fs). Something held the loop.",
                gap, _HEARTBEAT_INTERVAL_SECONDS,
            )
        last_wake = now


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

# Silent-phase heartbeat cadence. Two jobs:
#
# 1. **Drift resistance.** ``asyncio.sleep(N)`` doesn't
#    guarantee wall-clock fidelity — OS suspensions
#    (laptop sleep, App Nap, container pause) stretch one
#    big sleep. Polling in short chunks against a
#    wall-clock deadline means the worst-case overshoot
#    is bounded by this constant plus whatever the OS
#    held us paused for. D34a fixed the post-suspension
#    overshoot by anchoring deadlines to ``time.time()``
#    rather than ``time.monotonic()``.
#
# 2. **Idle-period kernel throttling.** macOS App Nap and
#    similar mechanisms aggressively park processes that
#    look idle. Once parked, timer wakes can slip by tens
#    of seconds even when nothing is suspended. A 1-second
#    poll keeps the process visibly active to the OS — the
#    kernel doesn't park a process that's running a
#    coroutine every second. Cost is ~270 awaits per
#    interval, well below the threshold of CPU we'd
#    measure on any workload.
#
# Was 5.0s under D34/D34a; tightened to 1.0s as part of
# re-plugging the warmer (Option 1 — heartbeat during
# silent phase).
_HEARTBEAT_POLL_SECONDS = 1.0

# Circuit breaker — number of consecutive cycles where the
# firing drifted past ``_CACHE_TTL_SECONDS`` before we
# auto-disable. A single drift can be a transient pause
# (NTP step, brief CPU spike, container freezer); three
# in a row is the clear "this environment is broken" signal
# and we should stop bleeding tokens until the operator
# investigates. Reset to zero on any in-TTL cycle.
_CIRCUIT_BREAKER_STRIKES = 3

# Maximum time to wait for a single cacheWarmup* broadcast
# before logging and continuing. The original parked warmer
# observed broadcasts hanging for ~120s, wedging the warmer's
# event loop. With this bound, a hung broadcast affects only
# the one cycle: log, continue, next cycle gets a fresh
# attempt. 5s is generous for a healthy WebSocket send
# (sub-millisecond in normal operation) but short enough
# that operators see "broadcast timed out" warnings within
# seconds of the underlying issue manifesting.
_BROADCAST_TIMEOUT_SECONDS = 5.0


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
        # Diagnostic heartbeat — see module-level comment.
        # Lifecycle parallels `_task`: started by `start()`,
        # cancelled by `cancel()` and `disable()`.
        self._heartbeat_task: asyncio.Task[Any] | None = None
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
        # Circuit breaker — counts consecutive cycles where
        # the firing drifted past the cache TTL. After
        # ``_CIRCUIT_BREAKER_STRIKES`` strikes the warmer
        # auto-disables. Reset to 0 on any in-TTL cycle.
        # A perpetually-drifting warmer is strictly negative
        # ROI (every firing is a full cache write at 1.25x
        # input cost with 0% hit rate); the breaker stops
        # the bleed when the underlying execution
        # environment is bad enough that even the polling
        # loop and dedicated executor can't recover.
        self._consecutive_drift_strikes: int = 0
        # Last clamped interval value we logged a warning
        # for. The ``interval_seconds`` property is read
        # by the HUD's poll loop (once per second from
        # ``seconds_remaining``), so a naive log-every-call
        # produces a flood of warnings when the user's
        # ``app.json`` carries a stale value above the
        # TTL-margin clamp. Tracking the last-warned value
        # lets us log once per distinct stale value: if the
        # user edits config from 600 → 500 → 240, that's
        # two warnings (600 and 500), then silence after
        # 240 lands inside the clamp.
        self._last_warned_clamp_value: float | None = None

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

        Clamped to ``_CACHE_TTL_SECONDS - 60`` (240s) at the
        upper end. Anthropic's prompt cache uses a 5-minute
        sliding TTL — a warm-up at the 300-second mark or
        beyond fires *after* the cached prefix has already
        expired, so every firing becomes a cold cache write
        and the warmer becomes pure cost with no payoff.

        The 60-second margin (raised from 30s) covers the
        visible countdown phase (``_COUNTDOWN_SECONDS`` =
        30s), provider request latency (typically 1-5s),
        AND a budget for system-level drift (event-loop
        scheduling jitter, brief OS-level pauses, NTP
        adjustments). Field observation showed +50 to +170s
        of drift in cycles where the 30s margin produced
        100% miss rate; the larger margin absorbs the
        observed range without making the warmer fire so
        early that consecutive warm-ups overlap.

        A user config with ``interval_seconds: 600`` would
        otherwise produce 0% cache hit on every warm-up
        (observed in the field). Clamping silently here is
        safer than raising — operators see "warmer running
        every 4:00 instead of every 10 min" in the HUD and
        can investigate, whereas a startup error would just
        disable the warmer entirely.
        """
        cfg = self._service._config.cache_warmup_config
        configured = float(cfg.get("interval_seconds", 240))
        ceiling = _CACHE_TTL_SECONDS - 60.0
        if configured > ceiling:
            # Deduplicate the warning. The HUD polls this
            # property once per second; logging on every
            # call floods stderr. Log once per distinct
            # stale value — if the user edits the config
            # to a different (still-stale) value, that's
            # worth a fresh warning. A user who fixes the
            # config to <= ceiling sees the warning stop
            # immediately on next poll. Stored as a float
            # so re-equal comparisons are exact (the
            # config read produces the same float every
            # call when the underlying value is unchanged).
            if self._last_warned_clamp_value != configured:
                logger.warning(
                    "Cache warmer interval_seconds=%.0f "
                    "exceeds Anthropic's 5-minute cache TTL "
                    "minus the 60s drift margin — clamping "
                    "to %.0fs to keep warm-ups inside the "
                    "TTL window. Update "
                    "cache_warmup.interval_seconds in "
                    "app.json to a value <= %.0f to silence "
                    "this warning.",
                    configured, ceiling, ceiling,
                )
                self._last_warned_clamp_value = configured
            return ceiling
        # Configured value is within bounds — clear the
        # warning state so a future hot-reload that pushes
        # the value back above the ceiling produces a
        # fresh warning rather than being silently
        # suppressed.
        self._last_warned_clamp_value = None
        return configured

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        """Schedule the first firing.

        Re-plugged after the D34/D34a unplug. Two new
        protections compared to the originally-parked
        version:

        - **Sub-second heartbeat during silent phase.** The
          polling loop wakes every ``_HEARTBEAT_POLL_SECONDS``
          (1s) instead of the previous 5s. This keeps the
          process visible to OS-level idle throttling
          (macOS App Nap and similar) which had been
          letting timer wakes slip by tens of seconds
          during long idle windows.

        - **Bounded broadcast waits.** Each cacheWarmup*
          broadcast is wrapped in ``asyncio.wait_for`` so
          a hung WebSocket send can't wedge the warmer's
          event loop the way it did during the field
          observations that motivated the original
          unplug. A timed-out broadcast is logged and the
          warmer continues; subsequent broadcasts get
          fresh timeout budgets.

        No-op when ``cache_warmup.enabled: false`` in
        config or when the warmer was disabled at runtime
        by the circuit breaker or a prior failure.
        """
        cfg = self._service._config.cache_warmup_config
        if not cfg.get("enabled", True):
            logger.info(
                "Cache warmer disabled in config "
                "(cache_warmup.enabled = false)"
            )
            self._enabled = False
            self._last_disabled_reason = "disabled in config"
            return
        self._enabled = True
        self._last_disabled_reason = None
        self._start_heartbeat()
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

        Heartbeat is NOT touched here. ``reset()`` is the
        user-call hook and it restarts the heartbeat
        explicitly; ``cancel()`` is the bare-cancel
        primitive used by code paths that don't want a
        diagnostic-window restart (e.g. the warmer's own
        internal scheduling, ``disable()``'s teardown).
        Heartbeat cancellation proper lives in
        ``disable()``.
        """
        if self._task is not None and not self._task.done():
            self._task.cancel()
        self._task = None
        self._scheduled_at = None
        self._generation += 1

    def reset(self, reason: str) -> None:
        """Cancel and reschedule.

        Called at the START of every user-initiated LLM
        call (from ``stream_chat`` with reason
        ``"user-send"``) so each user-call cycle gets a
        fresh diagnostic window. Also called by other
        activity-clock events that should restart the idle
        timer: mode switch, cross-ref toggle, cache
        rebuild, new session.

        NOT called at stream end. Pinning resets to LLM-
        call starts (rather than ends) means the heartbeat
        and warmer schedule are anchored to the moment a
        call begins; mid-stream and post-stream activity
        run under the same diagnostic window as the call
        itself, which is the boundary worth measuring.

        Restarts the event-loop heartbeat task so its
        diagnostic window is bounded by LLM-call
        boundaries rather than running continuously across
        the warmer's enabled lifetime. Any stall warning is
        attributable to work that happened during this
        call, not aggregated noise from earlier cycles.

        The warmer's own firing path uses
        ``_start_heartbeat`` directly (not ``reset``)
        because it's already mid-cycle and rescheduling
        would create a second pending timer.

        ``reason`` is logged at debug for diagnostic
        traces.
        """
        if not self._enabled:
            return
        logger.debug("Cache warmer reset: %s", reason)
        self.cancel()
        # Restart the heartbeat so each LLM-call cycle's
        # diagnostic window starts fresh. ``_start_heartbeat``
        # cancels any stale task before spawning the new one,
        # so calling it on every reset is idempotent and
        # safe.
        self._start_heartbeat()
        self._schedule()

    def disable(self, reason: str) -> None:
        """Cancel and stay inert until ``enable()`` is called."""
        logger.warning("Cache warmer disabled: %s", reason)
        self.cancel()
        self._stop_heartbeat()
        self._enabled = False
        self._last_disabled_reason = reason

    def enable(self) -> None:
        """Re-enable after a runtime disable.

        Clears the disabled-reason, restarts the
        diagnostic heartbeat, and schedules the next
        firing. Intended for the operator-driven
        re-enable path after the circuit breaker or a
        warm-up failure auto-disabled the warmer — once
        the underlying issue is resolved, the operator
        can flip the warmer back on without restarting
        the service.

        Idempotent — calling on an already-enabled warmer
        re-runs the schedule (cancelling any pending task
        first via ``_schedule``'s belt-and-braces guard)
        but is otherwise a no-op.

        No-op when ``cache_warmup.enabled: false`` in
        config — the operator cannot re-enable a warmer
        the config has explicitly disabled. Edit
        ``app.json`` first.
        """
        cfg = self._service._config.cache_warmup_config
        if not cfg.get("enabled", True):
            logger.info(
                "Cache warmer enable() called but "
                "cache_warmup.enabled is false in config — "
                "no-op. Edit app.json to re-enable."
            )
            return
        logger.info("Cache warmer re-enabled")
        self._enabled = True
        self._last_disabled_reason = None
        self._consecutive_drift_strikes = 0
        self._start_heartbeat()
        self._schedule()

    def _start_heartbeat(self) -> None:
        """Spawn the diagnostic heartbeat task.

        Idempotent — a stale task gets cancelled first.
        No-op when no event loop is running yet (the same
        deferral logic as `_schedule`).
        """
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            logger.warning(
                "Cache warmer heartbeat NOT started: no "
                "running event loop. Loop-stall diagnostic "
                "will be silent until next reset()."
            )
            return
        if (
            self._heartbeat_task is not None
            and not self._heartbeat_task.done()
        ):
            self._heartbeat_task.cancel()
        self._heartbeat_task = loop.create_task(_heartbeat_loop())
        logger.info(
            "Cache warmer heartbeat started — will warn on "
            "event-loop gaps > %.1fs",
            _HEARTBEAT_WARN_THRESHOLD_SECONDS,
        )

    def _stop_heartbeat(self) -> None:
        """Cancel the diagnostic heartbeat task."""
        if (
            self._heartbeat_task is not None
            and not self._heartbeat_task.done()
        ):
            self._heartbeat_task.cancel()
        self._heartbeat_task = None

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
        logger.info(
            "Cache warmer scheduled: interval=%.1fs, "
            "expected fire at T+%.1fs (epoch=%.1f)",
            interval, interval, self._scheduled_at,
        )
        self._task = loop.create_task(self._run(interval))

    async def _run(self, delay: float) -> None:
        """Sleep ``delay``, run the visible countdown, fire warm-up.

        Two-phase wait. Most of the interval is silent:
        a polling loop against a monotonic-clock deadline.
        The final ``_COUNTDOWN_SECONDS`` are visible — one
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

        **Drift resistance.** ``asyncio.sleep(N)`` does NOT
        guarantee wall-clock fidelity: if the OS suspends
        the process (laptop sleep, App Nap, container
        pause), one big sleep stretches by the suspension
        duration. Anthropic's prompt cache has a 5-minute
        TTL — a +75s drift on a 270s interval (observed in
        the field) pushes the firing past 300s and every
        warm-up becomes a cold cache write.

        We mitigate by polling against a monotonic-clock
        deadline with short ``asyncio.sleep`` chunks
        (``_DRIFT_POLL_SECONDS``). After every wake we
        reassess: if the OS suspended us mid-sleep, the
        next wake sees the deadline has passed (or is
        about to) and we proceed to the firing phase.
        Catastrophic drift past the cache TTL is detected
        post-fire and logged at WARNING; the firing still
        runs (the warm-up writes a fresh cache for the
        next window).
        """
        # Compute the absolute firing target up front. Both
        # the silent and visible phases anchor to this
        # wall-clock time. ``scheduled_at`` is the absolute
        # ``time.time()`` epoch at which the warmer is
        # supposed to fire; the silent phase ends one
        # ``_COUNTDOWN_SECONDS`` window before that.
        #
        # Wall-clock anchoring (``time.time``), not monotonic.
        # On macOS / Linux the process can be suspended (App
        # Nap, container freezer, laptop sleep). During
        # suspension ``time.monotonic`` may not advance — the
        # polling loop wakes up post-resume, sees the deadline
        # is still in the future against monotonic time, and
        # sleeps another 5s of post-resume wall-clock time
        # before re-checking. The firing then lands long after
        # the cached prefix expired. Field observation: an
        # 84s drift past the cache TTL with a 5s polling
        # cadence and 60s margin — only explicable if the
        # monotonic clock paused during a system suspension.
        #
        # ``time.time`` always advances. NTP jumps could in
        # principle perturb the deadline, but at the
        # 240s-interval scale realistic NTP step magnitudes
        # are well below the 60s margin we already build in.
        scheduled_at = self._scheduled_at or (time.time() + delay)
        silent_deadline = scheduled_at - _COUNTDOWN_SECONDS
        logger.info(
            "Cache warmer entering silent phase: %.1fs until "
            "countdown begins (deadline epoch=%.1f)",
            silent_deadline - time.time(), silent_deadline,
        )
        # Silent phase — poll the deadline in short chunks so
        # OS-level suspensions can't stretch a single long
        # sleep past the cache TTL. If ``delay`` is shorter
        # than the countdown window, the deadline is already
        # past and we skip straight to the visible phase.
        try:
            while True:
                remaining = silent_deadline - time.time()
                if remaining <= 0:
                    break
                await asyncio.sleep(min(_HEARTBEAT_POLL_SECONDS, remaining))
        except asyncio.CancelledError:
            logger.info("Cache warmer cancelled during silent phase")
            return
        logger.info(
            "Cache warmer silent phase complete; entering "
            "visible countdown phase",
        )
        # No stream-active gate here. The warmer fires in
        # parallel with any active stream — a long reasoning
        # turn that exceeds Anthropic's 5-minute cache TTL
        # would otherwise lose the cache mid-stream and the
        # next user turn would pay a cold-write cost. Letting
        # the warmer fire concurrently keeps the cache hot
        # across in-flight requests of any duration.
        service = self._service
        # Visible countdown phase. Anchored on
        # ``scheduled_at`` (a wall-clock epoch) for the same
        # reason the silent phase is — OS suspensions
        # mid-countdown must overshoot the deadline rather
        # than stretch it. The countdown window is the last
        # ``_COUNTDOWN_SECONDS`` before the firing target;
        # the loop exits when wall-clock time crosses the
        # firing deadline.
        countdown = min(delay, _COUNTDOWN_SECONDS)
        total_ticks = int(countdown)
        fire_deadline = scheduled_at
        try:
            last_displayed: int | None = None
            while True:
                remaining_secs = fire_deadline - time.time()
                if remaining_secs <= 0:
                    break
                # Round UP so the displayed countdown reaches
                # zero exactly at the deadline, not one tick
                # before. The popup's "0" frame should
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
        if scheduled_at is not None:
            actual_delay = time.time() - (scheduled_at - delay)
            drift = actual_delay - delay
            log_fn = logger.info
            ttl_exceeded = actual_delay >= _CACHE_TTL_SECONDS
            # Drift past the cache TTL means the cached
            # prefix expired before we got around to
            # warming it — the call about to fire would be
            # a pure cache write at 0% hit rate. We skip
            # the firing entirely on the TTL-exceeded path:
            # writing a fresh cache here just to prime the
            # next 5-minute window is the same outcome as
            # letting the next user turn write the cache,
            # at the same provider cost, with no benefit.
            # The skip path still counts as a strike so
            # repeated suspensions trip the circuit breaker.
            if ttl_exceeded:
                log_fn = logger.warning
                self._consecutive_drift_strikes += 1
            else:
                # In-TTL cycle resets the strike counter.
                # A single recovered cycle is enough — we
                # don't want a one-off transient pause to
                # accumulate strikes across an otherwise
                # healthy session.
                self._consecutive_drift_strikes = 0
            log_fn(
                "Cache warmer firing: planned=%.1fs, "
                "actual=%.1fs, drift=%+.1fs%s",
                delay, actual_delay, drift,
                " (drift exceeded cache TTL — skipping "
                "firing; strikes=%d/%d)" % (
                    self._consecutive_drift_strikes,
                    _CIRCUIT_BREAKER_STRIKES,
                )
                if ttl_exceeded else "",
            )
            # Circuit breaker: trip after N consecutive
            # TTL-exceeded cycles. Disabling here BEFORE
            # the firing means we don't fire the broken
            # warmup; the next call would be wasted spend.
            if (
                self._consecutive_drift_strikes
                >= _CIRCUIT_BREAKER_STRIKES
            ):
                await self._broadcast(
                    "cacheWarmupComplete",
                    {
                        "success": False,
                        "reason": (
                            f"circuit breaker tripped — "
                            f"{_CIRCUIT_BREAKER_STRIKES} "
                            f"consecutive cycles drifted past "
                            f"the {_CACHE_TTL_SECONDS:.0f}s "
                            f"cache TTL"
                        ),
                    },
                )
                self.disable(
                    f"circuit breaker — drift exceeded TTL "
                    f"{_CIRCUIT_BREAKER_STRIKES} times in a row"
                )
                return
            # TTL-exceeded but breaker not tripped — skip
            # this firing and reschedule for the next
            # window. The fresh schedule re-computes
            # ``scheduled_at`` from the current time, so
            # the next interval starts cleanly.
            if ttl_exceeded:
                self._scheduled_at = None
                self._schedule()
                return
        # Cacheable-prefix floor guard. Anthropic / Bedrock
        # only honour a ``cache_control`` marker when the
        # prefix up to that marker meets the model's minimum
        # cacheable length — 1024 tokens for most models, 4096
        # for Opus 4.5+ and Haiku 4.5. Early in a session, or
        # any time the cached tiers (L0–L3) are nearly empty
        # because the stability tracker hasn't graduated
        # content off the Active tier yet, the warmer's
        # cacheable prefix (system prompt + tier bodies, up to
        # the last marker) falls below that floor. The provider
        # then silently ignores the marker and the firing
        # writes 0 / reads 0 — a guaranteed 0% hit that is pure
        # cost. A real turn in the same state caches nothing
        # either, so there is no warm cache to keep alive.
        #
        # Assemble once here and reuse for the firing below so
        # the count reflects exactly the bytes we'd send. Skip
        # and reschedule when below the floor; the warmer
        # resumes automatically on a later cycle once the
        # cached tiers grow past the minimum. This is a healthy
        # state, not a failure — no strike, no disable.
        messages = self._assemble_warmup_messages()
        prefix_tokens = self._cacheable_prefix_tokens(messages)
        min_cacheable = self._service._counter.min_cacheable_tokens
        if prefix_tokens < min_cacheable:
            logger.info(
                "Cache warmer: cacheable prefix %d tokens < "
                "%d-token provider minimum for %s — the "
                "cache_control marker would be ignored (0%% "
                "hit, pure cost). Skipping this firing; will "
                "retry next cycle once the cached tiers grow "
                "past the floor.",
                prefix_tokens, min_cacheable,
                self._service._config.model,
            )
            await self._broadcast(
                "cacheWarmupComplete",
                {
                    "success": True,
                    "skipped": True,
                    "reason": (
                        f"cacheable prefix {prefix_tokens} tokens "
                        f"below the {min_cacheable}-token provider "
                        f"minimum — nothing to cache yet"
                    ),
                },
            )
            self._scheduled_at = None
            self._schedule()
            return
        # D34a-followup diagnostic: the broadcast and
        # the executor handoff both run on the event
        # loop thread. Field traces show 80+ seconds
        # between the "firing" log and the
        # "queue_duration" log inside the executor —
        # somewhere in this synchronous-ish stretch the
        # loop is being held. These four log lines
        # narrow it to a specific step.
        _t0 = time.monotonic()
        logger.info(
            "Cache warmer: about to broadcast cacheWarmupFiring",
        )
        await self._broadcast("cacheWarmupFiring", {})
        _t1 = time.monotonic()
        logger.info(
            "Cache warmer: cacheWarmupFiring broadcast took %.1fs",
            _t1 - _t0,
        )
        # Clear the stash so a stale snapshot from the
        # previous firing can't leak into a failure
        # broadcast (failures don't populate the stash).
        self._last_warmup_tokens = None
        logger.info("Cache warmer: about to call _fire_warmup")
        try:
            await self._fire_warmup(messages)
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
        # D34a-followup diagnostic: the gap between
        # "_fire_warmup returned" and "next schedule" was
        # the second 116-second stall in the field trace.
        # Same instrumentation pattern as the firing-side
        # broadcast.
        _t2 = time.monotonic()
        logger.info(
            "Cache warmer: _fire_warmup returned in %.1fs",
            _t2 - _t1,
        )
        # Successful firing — broadcast with token data so
        # the frontend can render a Token HUD, and
        # schedule the next.
        payload: dict[str, Any] = {"success": True}
        if self._last_warmup_tokens is not None:
            payload.update(self._last_warmup_tokens)
        logger.info(
            "Cache warmer: about to broadcast cacheWarmupComplete",
        )
        _t3 = time.monotonic()
        await self._broadcast("cacheWarmupComplete", payload)
        _t4 = time.monotonic()
        logger.info(
            "Cache warmer: cacheWarmupComplete broadcast took %.1fs",
            _t4 - _t3,
        )
        self._scheduled_at = None
        self._schedule()

    async def _broadcast(self, event_name: str, payload: Any) -> None:
        """Best-effort event broadcast with bounded wait.

        Failures here must not break the warmer's state
        machine — the event channel is an observability
        layer, not a correctness dependency.

        Wrapped in ``asyncio.wait_for`` because field
        observations on the original (parked) warmer
        showed the WebSocket / jrpc-oo broadcast path
        sometimes hanging for ~120 seconds during a
        warm-up cycle (cause not yet diagnosed; tracked
        as parked work). Without the timeout, a hung
        broadcast would wedge the warmer's event loop and
        prevent the rest of ``_run`` from making progress
        — so a single bad cycle could stall the warmer's
        timer for the duration of the hang.

        With the timeout, a stall affects only the one
        broadcast: it logs and we continue. The next
        warmer cycle gets fresh timeout budgets. The
        diagnostic heartbeat task runs independently of
        this loop, so a broadcast hang still surfaces
        loop-stall warnings via the heartbeat's own log
        path even when this helper's own log doesn't.
        """
        logger.debug(
            "Cache warmer broadcasting %s payload=%s",
            event_name, payload,
        )
        try:
            await asyncio.wait_for(
                self._service._broadcast_event_async(
                    event_name, payload,
                ),
                timeout=_BROADCAST_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "Cache warmer broadcast %s timed out after "
                "%.1fs — continuing. The WebSocket / jrpc-oo "
                "send path appears stalled; check the "
                "heartbeat log for event-loop gap warnings.",
                event_name, _BROADCAST_TIMEOUT_SECONDS,
            )
        except Exception as exc:
            logger.debug(
                "Cache warmer broadcast %s failed: %s",
                event_name, exc,
            )

    def _assemble_warmup_messages(self) -> list[dict[str, Any]]:
        """Assemble the warm-up message array.

        Mirrors a real turn's assembly via the main scope so
        the cached prefix bytes match byte-for-byte. Pulled
        out of :meth:`_fire_warmup` so the firing path can
        assemble once, count the cacheable prefix to decide
        whether the firing is worth making, then reuse the
        same messages for the provider call — no double
        assembly, no risk of the counted bytes diverging from
        the sent bytes.

        ``skip_active=True`` omits the Active tier (selected
        files + active history). Active sits after the last
        ``cache_control`` marker, so the cached prefix bytes
        are unchanged and L0–L3 cache hits still land. Saves
        Active-tier input tokens on every warm-up firing.
        """
        service = self._service
        scope = service._default_scope()
        # D34a-followup diagnostic: tier assembly is
        # synchronous on the event loop. For a 100K+ token
        # prompt it does real work (string concatenation,
        # token counting). Worth knowing if it's the
        # source of the stall.
        _ta0 = time.monotonic()
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
        _ta1 = time.monotonic()
        logger.info(
            "Cache warmer: prompt assembly took %.1fs",
            _ta1 - _ta0,
        )
        return messages

    def _cacheable_prefix_tokens(
        self, messages: list[dict[str, Any]]
    ) -> int:
        """Count tokens in the cacheable prefix of ``messages``.

        The cacheable prefix is everything up to and including
        the last message carrying a ``cache_control`` marker —
        that's the span the provider will try to cache. Bytes
        after the final marker (none, for a warm-up, since
        ``skip_active`` drops the post-marker tail except the
        ping) don't count toward the floor.

        Returns 0 when no message carries a marker — there is
        no cacheable prefix at all, which is correctly below
        any positive floor and skips the firing.

        Counting mirrors the budget path (``service._counter``)
        so the estimate matches what other cost accounting
        sees. The marker lives on a content block's
        ``cache_control`` key; we scan from the end so the
        first hit is the last marker.
        """
        last_marked = -1
        for i, msg in enumerate(messages):
            content = msg.get("content")
            if isinstance(content, list) and any(
                isinstance(block, dict)
                and "cache_control" in block
                for block in content
            ):
                last_marked = i
        if last_marked < 0:
            return 0
        counter = self._service._counter
        return sum(
            counter.count_message(m)
            for m in messages[: last_marked + 1]
        )

    async def _fire_warmup(
        self, messages: list[dict[str, Any]]
    ) -> None:
        """Issue the warm-up call, accumulate, log, and broadcast.

        ``messages`` is the pre-assembled array from
        :meth:`_assemble_warmup_messages` — the caller
        (:meth:`_run`) assembles it once, gates the firing on
        its cacheable-prefix size, then hands the same array
        here so the counted bytes and the sent bytes can't
        diverge.

        Restarts the heartbeat as the first action so the
        warmer's own LLM-call cycle gets a fresh diagnostic
        window — symmetric with the user-call path, where
        ``stream_chat`` resets the warmer before sending.
        Any event-loop stall warning during the warm-up's
        firing phase is then attributable to work this
        cycle did, not aggregated noise from earlier idle
        time.

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
        # Restart the heartbeat for this warmer-LLM-call
        # cycle. Same rationale as ``stream_chat``'s
        # ``warmer.reset("user-send")`` — pin the
        # diagnostic window to LLM-call boundaries so
        # stalls are attributable to a specific call.
        # Direct ``_start_heartbeat`` rather than ``reset``
        # because we don't want the rescheduling side
        # effect: ``_run`` is already mid-cycle and about
        # to fire the warm-up; rescheduling would create
        # a second pending timer.
        self._start_heartbeat()
        service = self._service
        # ``messages`` is pre-assembled and prefix-gated by the
        # caller — see :meth:`_assemble_warmup_messages` and the
        # cacheable-prefix floor guard in :meth:`_run`.
        loop = asyncio.get_running_loop()
        started = time.time()
        # Submit to the dedicated warmer executor. ``queue_submitted``
        # is captured here so the worker can measure how long the
        # task waited before a worker picked it up — with a
        # single-worker dedicated pool this should be ~0; if the
        # measurement ever shows non-trivial queue time it means
        # something has accidentally been routed onto the warmer
        # pool, or the warmer's previous firing is somehow still
        # in flight. Either way the log surfaces the regression.
        queue_submitted = time.monotonic()
        usage = await loop.run_in_executor(
            service._warmer_executor,
            self._completion_sync,
            messages,
            started,
            queue_submitted,
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
        queue_submitted: float | None = None,
    ) -> Any:
        """Blocking warm-up call. Runs in the warmer executor.

        Returns the raw provider ``usage`` object (or
        ``None`` if the response had none). The caller
        (:meth:`_fire_warmup`) feeds it through
        :meth:`LLMService._accumulate_usage` and the
        helper extractors below to pull individual
        numeric fields.

        ``queue_submitted`` is the ``time.monotonic()``
        timestamp from the moment the caller submitted
        the task to ``run_in_executor``. We log the
        ``entry - queue_submitted`` duration as a queue-
        wait metric. With the dedicated single-worker
        warmer pool this should always be near zero. A
        non-trivial reading is the load-bearing signal
        that something is wrong with executor isolation
        and the warmer is queueing again.

        Raises on any failure — the caller's ``except``
        block disables the warmer.
        """
        # Measure queue-wait first thing on entry, before
        # any other work. Logged at INFO so it's visible in
        # default-verbosity operator runs.
        if queue_submitted is not None:
            queue_duration = time.monotonic() - queue_submitted
            log_fn = (
                logger.warning if queue_duration > 1.0
                else logger.info
            )
            log_fn(
                "Cache warmer: queue_duration=%.3fs%s",
                queue_duration,
                " (warmer queueing detected — check executor "
                "isolation)" if queue_duration > 1.0 else "",
            )
        from ac_dc.llm._helpers import (
            build_thinking_kwargs,
            retry_litellm_completion,
        )
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

        # Match the most recent user-call's resolved
        # reasoning state. The UI toggle (sent per-request
        # via the ``reasoning`` arg) is the authoritative
        # user-facing control; the streaming pipeline
        # writes the resolved bool onto
        # ``service._last_reasoning_used`` after every
        # user call, and we mirror that here so warmer
        # firings prime the same Bedrock cache slot the
        # next reasoning user call will read from.
        #
        # Defaults to False on startup so warm-ups before
        # any user call are cheap. Once the user fires a
        # reasoning call the warmer adopts that posture
        # and stays there until the user toggles back. A
        # toggle change is reflected on the next warmer
        # firing (one-cycle adaptation lag, worst case).
        #
        # Cost trade-off: with thinking enabled, warm-ups
        # burn reasoning tokens on every firing. Adaptive
        # models (Opus 4.5+) decide their own budget; a
        # "ping respond with ok" prompt should produce
        # minimal reasoning. Legacy models reason for the
        # full configured budget regardless of prompt
        # simplicity. Watch the post-warm-up token HUD —
        # if reasoning_tokens is non-trivial per cycle,
        # toggle reasoning off in the UI to suppress.
        last_used = getattr(
            self._service, "_last_reasoning_used", False,
        )
        thinking_kwargs = (
            build_thinking_kwargs(config, True) if last_used
            else {}
        )
        if thinking_kwargs:
            payload = thinking_kwargs["thinking"]
            if payload.get("type") == "adaptive":
                # Adaptive models bound their own thinking
                # budget; max_tokens=2 is fine because the
                # provider produces only as much completion
                # as fits. Reasoning tokens are billed
                # separately, not capped by max_tokens.
                warmup_max_tokens = _WARMUP_MAX_TOKENS
            else:
                # Legacy thinking requires
                # max_tokens > budget_tokens. The +100
                # leaves room for a minimal completion
                # after the reasoning pass.
                warmup_max_tokens = (
                    int(payload.get("budget_tokens", 0)) + 100
                )
            # Reasoning calls can spend many minutes on the
            # reasoning pass before producing tokens. Use
            # the reasoning timeout (default 1200s) rather
            # than the aux timeout (60s) so the warm-up
            # doesn't abort prematurely.
            warmup_timeout = (
                config.reasoning_request_timeout_seconds
            )
            logger.info(
                "Cache warmer: reasoning shape matched "
                "(max_tokens=%d, timeout=%.0fs)",
                warmup_max_tokens, warmup_timeout,
            )
        else:
            warmup_max_tokens = _WARMUP_MAX_TOKENS
            warmup_timeout = config.aux_request_timeout_seconds

        def _call() -> Any:
            # ``thinking`` kwarg is empty when reasoning is
            # off in config — falls through as a normal
            # non-reasoning call. When reasoning is on,
            # adaptive payloads carry ``effort`` and legacy
            # payloads carry ``budget_tokens``; LiteLLM
            # routes either correctly.
            return litellm.completion(
                model=config.model,
                messages=messages,
                stream=False,
                max_tokens=warmup_max_tokens,
                timeout=warmup_timeout,
                **thinking_kwargs,
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