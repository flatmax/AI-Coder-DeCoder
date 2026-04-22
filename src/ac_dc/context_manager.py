"""In-memory context manager — conversation + file + prompt state.

The central state holder for an LLM session. Owns:

- Conversation history (the working copy used for prompt assembly)
- File context (files selected for inclusion)
- System prompt (swappable for review and document modes)
- URL context (optional, injected between file tree and review context)
- Review context (optional, injected during review mode)
- Mode flag (code vs document — drives index selection downstream)
- Stability tracker and history compactor attachment points (Layer
  3.5 and 3.6 wire these in; this layer holds the references)

Scope points pinned by specs4/3-llm/context-model.md:

- **Not a singleton.** Multiple instances may coexist under one
  :class:`LLMService`. Mode switching swaps between two trackers on
  one context manager; a future parallel-agent mode (D10 contract)
  creates additional context managers per agent. No module-level
  state.
- **Thread-safety not required.** The orchestrator drives mutations
  from a single executor. Multiple context managers are themselves
  isolated from each other — they share only read-only access to
  the indexes and repository.
- **Path normalisation matches the repo / file-context layer.** The
  context manager itself doesn't store paths directly but passes
  them through to :class:`FileContext`, which normalises.
- **System-event messages are regular user messages with a flag.**
  ``role="user"`` plus ``system_event=True``. They're visible to the
  LLM in context, distinguishable in the UI, and counted for token
  budgets.

Non-goals for this layer:

- Prompt assembly — Layer 3.7 lands in a later turn
- Actual stability tracker — Layer 3.5 (this module holds the attachment point)
- Actual history compactor — Layer 3.6 (same)
- Persistence — history is the working copy; the JSONL store is the
  streaming handler's concern (Layer 3.2 delivers the store itself)
"""

from __future__ import annotations

import logging
from enum import Enum
from typing import TYPE_CHECKING, Any

from ac_dc.file_context import FileContext
from ac_dc.token_counter import TokenCounter

if TYPE_CHECKING:
    from ac_dc.repo import Repo

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Mode enum
# ---------------------------------------------------------------------------


class Mode(str, Enum):
    """Active mode — drives which index feeds context downstream.

    Subclasses :class:`str` so string comparisons (``mode == "code"``)
    work without unwrapping. The LLM service and webapp both hold
    mode values as plain strings over the wire; the enum is the
    authoritative set for in-process logic.
    """

    CODE = "code"
    DOC = "doc"


# ---------------------------------------------------------------------------
# Budget enforcement — module constants
# ---------------------------------------------------------------------------
#
# Pinned by specs3/3-llm-engine/context_and_history.md. Kept as module
# constants rather than config so tests can reference them directly
# and so the thresholds can't be accidentally tuned per-instance.

# Fraction of max_input_tokens above which pre-request shedding starts
# dropping files. 90% leaves headroom for the user's prompt, the
# system reminder, and small streaming overhead.
_SHED_THRESHOLD_FRACTION = 0.90

# Fixed overhead added to the budget estimate — accounts for header
# strings, legend, file-tree wrapping, acknowledgement messages, and
# the margin between our count and the provider's count. 500 tokens
# is generous; the shedding decision isn't sensitive to the exact
# value as long as it's positive.
_BUDGET_ESTIMATE_OVERHEAD = 500

# Emergency truncation: if history exceeds ``2 × compaction trigger``
# AND compaction has failed, drop oldest messages without summarising.
# A manual safety net for external callers — the streaming pipeline
# doesn't invoke it today.
_EMERGENCY_TRUNCATE_MULTIPLIER = 2


# ---------------------------------------------------------------------------
# ContextManager
# ---------------------------------------------------------------------------


class ContextManager:
    """Central state holder for an LLM session.

    Construct with the model name and optional knobs; mutate via the
    documented methods. The manager delegates heavy lifting
    (tokenisation, file I/O) to collaborators but owns the shape of
    the conversation state itself.
    """

    def __init__(
        self,
        model_name: str,
        *,
        repo: "Repo | None" = None,
        cache_target_tokens: int | None = None,
        compaction_config: dict[str, Any] | None = None,
        system_prompt: str = "",
    ) -> None:
        """Initialise a fresh context manager.

        Parameters
        ----------
        model_name:
            Provider-qualified model identifier (e.g.
            ``"anthropic/claude-sonnet-4-5"``). Used to construct the
            token counter and to pick model-family limits.
        repo:
            Optional :class:`Repo` reference passed through to
            :class:`FileContext` so ``add_file(path)`` without an
            explicit content argument reads from disk. Tests and
            standalone callers can omit it.
        cache_target_tokens:
            Optional cache-target value in tokens. Stored for Layer
            3.5 consumers (the stability tracker) — this layer
            exposes it via :attr:`cache_target_tokens` but doesn't
            otherwise use it.
        compaction_config:
            Optional history-compaction config. Stored for Layer
            3.6 — Layer 3.4 doesn't act on it. ``None`` means
            compaction is disabled on this context manager.
        system_prompt:
            Initial system prompt text. Defaults to empty; callers
            usually set it explicitly via :meth:`set_system_prompt`
            after reading the prompt from config.
        """
        self._model_name = model_name
        self._cache_target_tokens = cache_target_tokens
        self._compaction_config = (
            dict(compaction_config) if compaction_config is not None else None
        )

        # Core collaborators.
        self._counter = TokenCounter(model_name)
        self._file_context = FileContext(repo=repo)

        # Conversation history — list of {role, content, ...?} dicts.
        # The ``...?`` stands for optional fields like ``system_event``
        # that some callers attach. We never strip them; downstream
        # consumers either honour the fields or ignore them.
        self._history: list[dict[str, Any]] = []

        # System prompt — current + saved copy for review-mode swap
        # or mode-switch-back restoration.
        self._system_prompt = system_prompt
        self._saved_system_prompt: str | None = None

        # URL and review context — optional injected sections that
        # the prompt assembler (Layer 3.7) consumes. Lists for URL
        # context to preserve multi-URL ordering; single string for
        # review because review context is one block.
        self._url_context: list[str] = []
        self._review_context: str | None = None

        # Mode — code by default. Switching happens via
        # :meth:`set_mode`; the prompt assembler and LLM service
        # decide what to do when the value changes.
        self._mode: Mode = Mode.CODE

        # Layer 3.5 / 3.6 attachment points. Holders only — no logic
        # here. The stability tracker owns its own state; we just
        # point at it so downstream consumers (streaming handler,
        # budget reporting) can fetch what they need via a single
        # context manager reference.
        self._stability_tracker: Any = None
        self._compactor: Any = None

    # ------------------------------------------------------------------
    # Accessors — stable bits
    # ------------------------------------------------------------------

    @property
    def model(self) -> str:
        """The model name this context manager was constructed with."""
        return self._model_name

    @property
    def counter(self) -> TokenCounter:
        """The attached token counter.

        Exposed so callers can count arbitrary strings (system
        reminder, URL content, file tree) against the same
        tokeniser the budget uses. Never replaced after
        construction — the model is fixed for the lifetime of one
        context manager.
        """
        return self._counter

    @property
    def file_context(self) -> FileContext:
        """The attached :class:`FileContext` instance."""
        return self._file_context

    @property
    def cache_target_tokens(self) -> int | None:
        """Optional cache-target value passed at construction.

        Used by the stability tracker in Layer 3.5. None means the
        caller didn't supply one; consumers fall back to the token
        counter's model-aware computation.
        """
        return self._cache_target_tokens

    @property
    def compaction_config(self) -> dict[str, Any] | None:
        """The compaction config dict, or None.

        Read-through copy — returns the internal dict by reference
        rather than a copy, matching the "read through" contract
        specs4 pins (so config hot-reload is visible without
        reconstruction). Callers mutate at their own risk; in
        practice only Layer 3.6 reads this.
        """
        return self._compaction_config

    # ------------------------------------------------------------------
    # Mode
    # ------------------------------------------------------------------

    @property
    def mode(self) -> Mode:
        """The current mode (code or document)."""
        return self._mode

    def set_mode(self, mode: Mode | str) -> None:
        """Set the active mode.

        Accepts either the enum or the string form so callers that
        received a mode over the wire don't need to unwrap. Unknown
        string values raise :class:`ValueError`.

        The context manager doesn't act on mode changes — it just
        records the new value. The LLM service swaps the system
        prompt, switches which stability tracker is attached, and
        rebuilds tier content. This method is the single source of
        truth for "what mode is this context in".
        """
        if isinstance(mode, Mode):
            self._mode = mode
            return
        # String form — validate by constructing the enum.
        try:
            self._mode = Mode(mode)
        except ValueError as exc:
            raise ValueError(
                f"Unknown mode {mode!r}; expected one of "
                f"{[m.value for m in Mode]}"
            ) from exc

    # ------------------------------------------------------------------
    # Conversation history
    # ------------------------------------------------------------------

    def add_message(
        self,
        role: str,
        content: str,
        *,
        system_event: bool = False,
        **extra: Any,
    ) -> dict[str, Any]:
        """Append one message to the working-copy history.

        Parameters
        ----------
        role:
            ``"user"`` or ``"assistant"``. System-event messages use
            ``role="user"`` with ``system_event=True`` — matches
            specs4/3-llm/history.md.
        content:
            Message text. Multimodal messages aren't stored in the
            working copy — the streaming handler assembles
            image-bearing content blocks at prompt-assembly time,
            not here.
        system_event:
            When True, marks this message as an operational event
            (commit, reset, mode switch) for rendering purposes.
        extra:
            Additional fields to stash on the message dict (e.g.,
            ``files``, ``edit_results`` for the history browser).
            Forwarded unchanged; the context manager doesn't
            interpret them.

        Returns
        -------
        dict
            The message dict just appended. Returned by reference
            so callers can attach IDs or timestamps if needed.
        """
        msg: dict[str, Any] = {"role": role, "content": content}
        if system_event:
            msg["system_event"] = True
        if extra:
            msg.update(extra)
        self._history.append(msg)
        return msg

    def add_exchange(
        self,
        user_content: str,
        assistant_content: str,
    ) -> None:
        """Append a user/assistant pair atomically.

        Used for session restore — loading a previous conversation
        into the working copy. The streaming handler uses separate
        :meth:`add_message` calls (user before stream, assistant
        after) because they happen at different times.
        """
        self._history.append({"role": "user", "content": user_content})
        self._history.append(
            {"role": "assistant", "content": assistant_content}
        )

    def get_history(self) -> list[dict[str, Any]]:
        """Return a shallow copy of the current history.

        Callers often pass the result straight to prompt assembly
        or the streaming pipeline. Returning a copy means callers
        can filter or slice without accidentally mutating the
        stored conversation. Entries themselves are shared — a
        caller mutating a message's ``content`` in place would
        still affect the stored history, but no caller does that
        today.
        """
        return list(self._history)

    def set_history(self, messages: list[dict[str, Any]]) -> None:
        """Replace the history entirely.

        Used after compaction (Layer 3.6) and after loading a
        previous session. Each message is shallow-copied so mutations
        to the input list don't affect stored state.
        """
        self._history = [dict(m) for m in messages]

    def clear_history(self) -> None:
        """Empty the history and purge stability-tracker entries.

        If a stability tracker is attached, ``purge_history`` (if
        the tracker implements it) removes all tracked history
        items so new entries register fresh on the next request.
        Layer 3.5 defines the exact contract; we call defensively
        via :func:`getattr` so Layer 3.4 tests don't need a full
        tracker mock.
        """
        self._history = []
        self._purge_tracker_history()

    def _purge_tracker_history(self) -> None:
        """Invoke ``purge_history`` on the attached tracker if present.

        Defensive — the tracker's API isn't finalised in Layer 3.4.
        Missing method or missing tracker is a no-op; a runtime
        error from the tracker's own logic propagates so it can't
        silently corrupt cache state.
        """
        tracker = self._stability_tracker
        if tracker is None:
            return
        purge = getattr(tracker, "purge_history", None)
        if purge is None:
            return
        purge()

    def history_token_count(self) -> int:
        """Count tokens across the current history."""
        return self._counter.count(self._history)

    # ------------------------------------------------------------------
    # System prompt
    # ------------------------------------------------------------------

    def get_system_prompt(self) -> str:
        """Return the current system prompt."""
        return self._system_prompt

    def set_system_prompt(self, prompt: str) -> None:
        """Replace the current system prompt.

        Does NOT save the previous prompt — callers that want to
        restore later use :meth:`save_and_replace_system_prompt`.
        This matches the common case of mode switching where the
        new prompt is authoritative for the session going forward.
        """
        self._system_prompt = prompt

    def save_and_replace_system_prompt(self, new_prompt: str) -> None:
        """Save the current prompt, then install ``new_prompt``.

        Used by review-mode entry — the original coding prompt is
        saved so :meth:`restore_system_prompt` can put it back on
        exit.

        Calling twice before a restore overwrites the saved copy
        with the second call's current prompt. That's intentional:
        if a second save happens, the most recent "original" is
        what the user would want to return to.
        """
        self._saved_system_prompt = self._system_prompt
        self._system_prompt = new_prompt

    def restore_system_prompt(self) -> bool:
        """Restore the previously-saved system prompt.

        Returns True if a saved prompt existed and was restored,
        False if nothing was saved (nothing to restore). The saved
        slot is cleared on a successful restore so a subsequent
        call without another save is a no-op.
        """
        if self._saved_system_prompt is None:
            return False
        self._system_prompt = self._saved_system_prompt
        self._saved_system_prompt = None
        return True

    # ------------------------------------------------------------------
    # URL context
    # ------------------------------------------------------------------

    def set_url_context(self, parts: list[str] | None) -> None:
        """Set the URL context parts (or clear via None / empty list).

        The prompt assembler joins parts with a blank-line
        separator before injecting as a user/assistant pair. Empty
        or None input clears the context — the assembler then
        omits the URL section entirely.
        """
        if not parts:
            self._url_context = []
            return
        self._url_context = list(parts)

    def clear_url_context(self) -> None:
        """Clear the URL context."""
        self._url_context = []

    def get_url_context(self) -> list[str]:
        """Return a copy of the URL context parts."""
        return list(self._url_context)

    # ------------------------------------------------------------------
    # Review context
    # ------------------------------------------------------------------

    def set_review_context(self, review_text: str | None) -> None:
        """Set the review context string (or clear via None / empty).

        Empty strings are treated as clear — no point injecting an
        empty user/assistant pair in review-mode prompt assembly.
        """
        if not review_text:
            self._review_context = None
            return
        self._review_context = review_text

    def clear_review_context(self) -> None:
        """Clear the review context."""
        self._review_context = None

    def get_review_context(self) -> str | None:
        """Return the review context string or None."""
        return self._review_context

    # ------------------------------------------------------------------
    # Attachment points — stability tracker and compactor
    # ------------------------------------------------------------------

    @property
    def stability_tracker(self) -> Any:
        """The attached stability tracker, or None.

        Type left loose (``Any``) because the tracker lands in
        Layer 3.5 and its public shape isn't frozen yet. Layer 3.4
        only needs to hold the reference and invoke
        ``purge_history`` defensively on :meth:`clear_history`.
        """
        return self._stability_tracker

    def set_stability_tracker(self, tracker: Any) -> None:
        """Attach or replace the stability tracker.

        Used during mode switching — each mode's tracker instance
        is preserved so switching back is instant. Passing None
        detaches the tracker (e.g., when tests want a clean
        baseline).
        """
        self._stability_tracker = tracker

    @property
    def compactor(self) -> Any:
        """The attached history compactor, or None."""
        return self._compactor

    def set_compactor(self, compactor: Any) -> None:
        """Attach or replace the history compactor."""
        self._compactor = compactor

    # ------------------------------------------------------------------
    # Token budget reporting
    # ------------------------------------------------------------------

    def get_token_budget(self) -> dict[str, Any]:
        """Return a snapshot of the current token budget.

        Fields:

        - ``history_tokens`` — count of the current history
        - ``max_history_tokens`` — soft ceiling for history before
          compaction kicks in (from the counter)
        - ``max_input_tokens`` — hard ceiling for the whole prompt
        - ``remaining`` — ``max_input_tokens - history_tokens``,
          floored at zero
        - ``needs_compaction`` — True when history exceeds the
          compaction trigger (delegated to the compactor; False if
          no compactor attached)

        The UI's history bar reads this snapshot; the streaming
        pipeline uses it to decide whether to invoke post-response
        compaction. The numbers are computed on demand, not
        cached — the cost is one counter pass over history, which
        is cheap.
        """
        history_tokens = self.history_token_count()
        max_input = self._counter.max_input_tokens
        max_history = self._counter.max_history_tokens
        remaining = max(0, max_input - history_tokens)
        needs_compaction = self._needs_compaction(history_tokens)
        return {
            "history_tokens": history_tokens,
            "max_history_tokens": max_history,
            "max_input_tokens": max_input,
            "remaining": remaining,
            "needs_compaction": needs_compaction,
        }

    def _needs_compaction(self, history_tokens: int) -> bool:
        """Return True when history exceeds the compaction trigger.

        Reads the compactor's ``should_compact`` method if
        available. Defensive: a missing compactor or a missing
        method both return False (i.e., compaction isn't needed
        because compaction isn't configured). Matches the "no
        compactor means no compaction" semantics Layer 3.6 pins.
        """
        compactor = self._compactor
        if compactor is None:
            return False
        should = getattr(compactor, "should_compact", None)
        if should is None:
            return False
        try:
            return bool(should(history_tokens))
        except TypeError:
            # The compactor's signature isn't frozen in 3.4. Fall
            # back to a zero-arg call in case Layer 3.6 chose that
            # shape.
            return bool(should())

    def get_compaction_status(self) -> dict[str, Any]:
        """Return status fields for the UI's compaction indicator.

        Fields:

        - ``enabled`` — True when a compactor is attached
        - ``trigger_tokens`` — the compactor's trigger threshold
          (0 when disabled)
        - ``current_tokens`` — current history token count
        - ``percent`` — ``current_tokens / trigger_tokens`` as a
          rounded integer (0–100+). Capped at 999 to avoid
          ridiculous numbers in pathological cases; the UI only
          cares about the order of magnitude.

        When no compactor is attached, returns ``enabled=False``
        and zeros for the derived fields. Callers that want a
        history bar that only appears when compaction is live can
        gate on ``enabled``.
        """
        current = self.history_token_count()
        compactor = self._compactor
        if compactor is None:
            return {
                "enabled": False,
                "trigger_tokens": 0,
                "current_tokens": current,
                "percent": 0,
            }
        trigger = getattr(compactor, "trigger_tokens", 0) or 0
        if trigger <= 0:
            percent = 0
        else:
            percent = min(999, round((current / trigger) * 100))
        return {
            "enabled": True,
            "trigger_tokens": trigger,
            "current_tokens": current,
            "percent": percent,
        }

    # ------------------------------------------------------------------
    # Budget enforcement — Layer 2 emergency truncation
    # ------------------------------------------------------------------

    def emergency_truncate(self, trigger_tokens: int) -> int:
        """Drop the oldest messages until history fits.

        Used only as a fallback when compaction has failed AND
        history has grown past ``2 × trigger_tokens``. Returns the
        number of messages dropped.

        The current streaming pipeline doesn't call this — compaction
        is expected to succeed. The method exists as a manual
        safety net for external callers (support tooling, emergency
        RPCs) and to give Layer 3.6 a bail-out if its LLM-backed
        topic detector fails catastrophically.

        Preserves message order — drops from the front. Stops as
        soon as history fits under ``trigger_tokens`` (not the 2x
        ceiling — we aim to get back into the comfortable zone,
        not just barely under the emergency threshold).
        """
        if trigger_tokens <= 0:
            return 0
        dropped = 0
        while (
            self._history
            and self.history_token_count() > trigger_tokens
        ):
            self._history.pop(0)
            dropped += 1
        if dropped:
            logger.warning(
                "Emergency truncation dropped %d oldest messages "
                "(history now %d tokens)",
                dropped,
                self.history_token_count(),
            )
        return dropped

    # ------------------------------------------------------------------
    # Budget enforcement — Layer 3 pre-request file shedding
    # ------------------------------------------------------------------

    def estimate_request_tokens(self, user_prompt: str = "") -> int:
        """Rough estimate of total tokens a request would produce.

        Sums:

        - System prompt
        - File context (fenced blocks)
        - History
        - User prompt (passed in by the caller — empty when called
          for a background budget check)
        - Fixed overhead (:data:`_BUDGET_ESTIMATE_OVERHEAD`) for
          headers, legend, ack messages, and streaming margin

        Cheap — one counter pass per section. Accurate enough for
        the shedding decision; the absolute number only matters
        relative to ``max_input_tokens``.
        """
        total = self._counter.count(self._system_prompt)
        total += self._file_context.count_tokens(self._counter)
        total += self.history_token_count()
        if user_prompt:
            total += self._counter.count(user_prompt)
        total += _BUDGET_ESTIMATE_OVERHEAD
        return total

    def shed_files_if_needed(
        self,
        user_prompt: str = "",
    ) -> list[str]:
        """Drop the largest files until the estimate fits.

        Returns the list of paths removed, in the order they were
        dropped (largest first). Empty list when nothing was shed.

        Threshold is :data:`_SHED_THRESHOLD_FRACTION` of
        ``max_input_tokens`` — 90% leaves room for the streaming
        overhead and the system reminder. Caller (streaming
        handler) surfaces the returned list as a user-visible
        warning so the user sees which files dropped out.

        The loop computes per-file token counts fresh on each
        iteration — cheap relative to the disk I/O each file read
        would have cost in the first place. Stops as soon as the
        estimate fits or no files remain.
        """
        ceiling = int(
            self._counter.max_input_tokens * _SHED_THRESHOLD_FRACTION
        )
        dropped: list[str] = []
        while True:
            if self.estimate_request_tokens(user_prompt) <= ceiling:
                return dropped
            per_file = self._file_context.get_tokens_by_file(
                self._counter
            )
            if not per_file:
                return dropped
            # Pick the largest file by token count. Ties broken by
            # insertion order via the sort's stability — the oldest
            # largest file goes first, which is arbitrary but
            # deterministic.
            largest = max(per_file.items(), key=lambda kv: kv[1])[0]
            self._file_context.remove_file(largest)
            dropped.append(largest)
            logger.warning(
                "Shedding file %r (estimate exceeded %d-token ceiling)",
                largest,
                ceiling,
            )