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
from typing import TYPE_CHECKING, Any, Callable

from ac_dc.file_context import FileContext
from ac_dc.token_counter import TokenCounter

if TYPE_CHECKING:
    from ac_dc.repo import Repo

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Header constants
# ---------------------------------------------------------------------------
#
# Named constants used when building the LLM message array. Their values
# are pinned by specs4/3-llm/prompt-assembly.md — implementers must not
# vary the wording casually since the LLM's behaviour depends on these
# exact headers (system prompts reference them, edit-protocol
# documentation relies on the "Working Files" label).
#
# Kept at module level rather than on ContextManager itself — they are
# assembly-layer concerns, not instance state. Multiple ContextManager
# instances (future parallel-agent mode, D10) share one set of headers.

REPO_MAP_HEADER = (
    "# Repository Structure\n\n"
    "Below is a map of the repository showing classes, functions, "
    "and their relationships.\nUse this to understand the codebase "
    "structure and find relevant code.\n\n"
)

DOC_MAP_HEADER = (
    "# Document Structure\n\n"
    "Below is an outline map of documentation files showing "
    "headings, keywords, and cross-references.\nUse this to "
    "navigate and reference documentation without loading every "
    "file.\n\n"
)

FILE_TREE_HEADER = (
    "# Repository Files\n\n"
    "Complete list of files in the repository:\n\n"
)

URL_CONTEXT_HEADER = (
    "# URL Context\n\n"
    "The following content was fetched from URLs mentioned in the "
    "conversation:\n\n"
)

FILES_ACTIVE_HEADER = (
    "# Working Files\n\n"
    "Here are the files:\n\n"
)

FILES_L0_HEADER = (
    "# Reference Files (Stable)\n\n"
    "These files are included for reference:\n\n"
)

FILES_L1_HEADER = (
    "# Reference Files\n\n"
    "These files are included for reference:\n\n"
)

FILES_L2_HEADER = (
    "# Reference Files (L2)\n\n"
    "These files are included for reference:\n\n"
)

FILES_L3_HEADER = (
    "# Reference Files (L3)\n\n"
    "These files are included for reference:\n\n"
)

TIER_SYMBOLS_HEADER = "# Repository Structure (continued)\n\n"

REVIEW_CONTEXT_HEADER = "# Code Review Context\n\n"


# Per-tier file-section headers keyed by Tier enum value. Used by the
# assembly helper to pick the right header for each cached tier.
_TIER_FILE_HEADERS: dict[str, str] = {
    "L0": FILES_L0_HEADER,
    "L1": FILES_L1_HEADER,
    "L2": FILES_L2_HEADER,
    "L3": FILES_L3_HEADER,
}


# Ordered tier names for cascade iteration during assembly. L0 is
# handled specially (its content lives on the system message); L1–L3
# each produce a user/assistant pair.
_CACHED_TIERS: tuple[str, ...] = ("L0", "L1", "L2", "L3")


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
# Pinned by specs-reference/3-llm/context-model.md. Kept as module
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
        turn_id: str | None = None,
        archival_sink: Callable[..., Any] | None = None,
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
        turn_id:
            Optional turn identifier for agent ContextManagers
            spawned under a parent turn (see
            specs4/7-future/parallel-agents.md § Turn ID
            Propagation). When set, :meth:`add_message` and
            :meth:`add_exchange` include the turn_id in the
            archival sink's payload so every agent record in
            ``.ac-dc4/agents/{turn_id}/agent-NN.jsonl`` carries
            the parent turn's ID. The main user-facing
            ContextManager leaves this None — its records land
            in the main history store via a different code path.
        archival_sink:
            Optional callable for persisting agent messages to
            disk. Called after every :meth:`add_message` /
            :meth:`add_exchange` append with keyword arguments
            matching :meth:`HistoryStore.append_agent_message`'s
            shape minus ``turn_id`` and ``agent_idx`` (the sink
            closes over those). When None, the ContextManager
            is in-memory only — its messages live in
            :attr:`_history` but don't persist anywhere. This is
            the correct state for the main user-facing
            ContextManager; agent ContextManagers get a sink
            that writes to their per-agent archive file.
        """
        self._model_name = model_name
        self._cache_target_tokens = cache_target_tokens
        self._compaction_config = (
            dict(compaction_config) if compaction_config is not None else None
        )
        # Turn ID and archival sink — optional per-agent plumbing
        # for the parallel-agents foundation. Neither affects the
        # in-memory history semantics; the sink fires as a
        # fire-and-forget side effect after each append so a
        # broken sink can't corrupt conversation state. See
        # _invoke_archival_sink for the exception-handling
        # contract.
        self._turn_id = turn_id
        self._archival_sink = archival_sink

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

    @property
    def turn_id(self) -> str | None:
        """The turn ID this ContextManager is scoped to, or None.

        Set at construction for agent ContextManagers; None for
        the main user-facing ContextManager. Exposed read-only so
        downstream code (archival sinks, prompt assembly, the
        agent browser UI) can correlate records without needing
        to look up the parent turn separately.
        """
        return self._turn_id

    @property
    def archival_sink(self) -> Callable[..., Any] | None:
        """The archival sink callable, or None.

        Exposed for tests and for diagnostic callers that want to
        verify a sink is attached. In normal operation, code
        should not invoke the sink directly — :meth:`add_message`
        and :meth:`add_exchange` drive it.
        """
        return self._archival_sink

    def _invoke_archival_sink(
        self,
        role: str,
        content: str,
        *,
        system_event: bool = False,
        **extra: Any,
    ) -> None:
        """Fire the archival sink with a single message's fields.

        No-op when no sink is attached. When a sink is attached
        but raises, the exception is logged at WARNING and
        swallowed — the in-memory history append has already
        happened, and a broken sink must not roll that back or
        propagate into the streaming pipeline. Same defensive
        discipline as :meth:`_purge_tracker_history` and
        :meth:`Repo._fire_post_write`.

        The sink's keyword-argument shape matches
        :meth:`HistoryStore.append_agent_message` minus
        ``turn_id`` and ``agent_idx`` — the caller that
        constructed the ContextManager closes over those values
        when building the sink.
        """
        sink = self._archival_sink
        if sink is None:
            return
        try:
            sink(
                role=role,
                content=content,
                system_event=system_event,
                **extra,
            )
        except Exception as exc:
            logger.warning(
                "Archival sink raised for turn_id=%s role=%s: %s",
                self._turn_id,
                role,
                exc,
            )

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
        # Fire the archival sink as a side effect. Happens AFTER
        # the in-memory append so a sink exception (swallowed
        # inside the helper) can't leave us with a dropped
        # message. The sink receives the canonical fields —
        # role, content, system_event, and any extras — minus
        # turn_id/agent_idx which the sink closes over.
        self._invoke_archival_sink(
            role,
            content,
            system_event=system_event,
            **extra,
        )
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
        # Fire the sink for both messages in order. Matches the
        # semantics of two back-to-back add_message calls from
        # the sink's perspective — the caller-supplied sink sees
        # a user record followed by an assistant record, same as
        # it would for the normal streaming-handler path.
        self._invoke_archival_sink("user", user_content)
        self._invoke_archival_sink("assistant", assistant_content)

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

    # ------------------------------------------------------------------
    # Prompt assembly — helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _with_cache_control(msg: dict[str, Any]) -> dict[str, Any]:
        """Wrap a message's content in the structured cache-control form.

        Takes a plain ``{"role": ..., "content": "text"}`` dict and
        returns the same role with ``content`` wrapped as a single
        text block carrying ``cache_control: {"type": "ephemeral"}``.
        Providers (Anthropic, Bedrock Claude via litellm) treat this
        as a cache breakpoint — everything from the start of the
        prompt up to and including this message is cacheable.

        Idempotent — if the content is already a structured list,
        the cache-control marker is attached to the last text block
        without rewrapping. Matters for multimodal messages where
        content is already a list of text + image blocks.
        """
        content = msg.get("content", "")
        if isinstance(content, str):
            msg["content"] = [{
                "type": "text",
                "text": content,
                "cache_control": {"type": "ephemeral"},
            }]
            return msg
        if isinstance(content, list) and content:
            # Attach the marker to the last text block. Image
            # blocks can't carry cache_control.
            for block in reversed(content):
                if (
                    isinstance(block, dict)
                    and block.get("type") == "text"
                ):
                    block["cache_control"] = {"type": "ephemeral"}
                    return msg
        # Fallback — wrap the stringified content.
        msg["content"] = [{
            "type": "text",
            "text": str(content),
            "cache_control": {"type": "ephemeral"},
        }]
        return msg

    # ------------------------------------------------------------------
    # Prompt assembly — tiered (primary mode)
    # ------------------------------------------------------------------

    def assemble_tiered_messages(
        self,
        user_prompt: str,
        images: list[str] | None = None,
        symbol_map: str = "",
        symbol_legend: str = "",
        doc_legend: str = "",
        file_tree: str = "",
        tiered_content: dict[str, dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        """Assemble the tiered message array for the LLM.

        Produces a structured message list with ``cache_control``
        markers at tier boundaries. Each non-empty cached tier
        (L0–L3) gets exactly one breakpoint so the provider can
        reuse the preceding prefix across requests.

        Parameters
        ----------
        user_prompt:
            The current user input text. The system reminder is
            already appended upstream by the streaming handler.
        images:
            Optional list of base64 data URIs. When present, the
            final user message becomes a multimodal content block
            list instead of a plain string.
        symbol_map:
            The symbol or doc map body (excluding graduated
            file blocks — those live in their tier's content
            instead). Empty when no map is available.
        symbol_legend:
            The primary index's legend block — goes under
            :data:`REPO_MAP_HEADER` when in code mode, or
            :data:`DOC_MAP_HEADER` when in document mode.
        doc_legend:
            Optional secondary legend for cross-reference mode.
            When non-empty, appended to L0 under the *opposite*
            mode's header.
        file_tree:
            The flat file-tree text produced by the streaming
            handler. Rendered as its own uncached user/assistant
            pair.
        tiered_content:
            Dict keyed by tier name (``"L0"``, ``"L1"``, ``"L2"``,
            ``"L3"``) mapping to per-tier content dicts with keys
            ``symbols``, ``files``, ``history``,
            ``graduated_files``, ``graduated_history_indices``.
            When ``None``, callers should have fallen back to
            flat assembly.
        """
        if tiered_content is None:
            raise ValueError(
                "assemble_tiered_messages requires a tiered_content "
                "dict; use assemble_messages for flat assembly"
            )

        # Which mode decides the primary map header.
        if self._mode == Mode.DOC:
            primary_header = DOC_MAP_HEADER
            cross_ref_header = REPO_MAP_HEADER
        else:
            primary_header = REPO_MAP_HEADER
            cross_ref_header = DOC_MAP_HEADER

        # Graduated paths and history indices collapse across all
        # tiers — a file graduated to L2 must be excluded from the
        # active "Working Files" section, not just from L2 content.
        all_graduated_history: set[int] = set()
        for tier_name in _CACHED_TIERS:
            tier = tiered_content.get(tier_name) or {}
            for idx in tier.get("graduated_history_indices", ()) or ():
                all_graduated_history.add(int(idx))

        messages: list[dict[str, Any]] = []

        # L0 — system message with prompt + map header + legend +
        # L0 index entries + L0 file contents + optional cross-ref
        # legend. Cache-control goes on the system message itself
        # when L0 has no history, else on the last L0 history msg.
        l0 = tiered_content.get("L0") or {}
        l0_symbols = l0.get("symbols") or ""
        l0_files = l0.get("files") or ""
        l0_history = l0.get("history") or []

        system_parts: list[str] = [self._system_prompt]
        if symbol_legend or l0_symbols or symbol_map:
            system_parts.append(primary_header + symbol_legend)
            if l0_symbols:
                system_parts.append(l0_symbols)
            if symbol_map:
                system_parts.append(symbol_map)
        if doc_legend:
            system_parts.append(cross_ref_header + doc_legend)
        if l0_files:
            system_parts.append(FILES_L0_HEADER + l0_files)
        system_content = "\n\n".join(p for p in system_parts if p)

        if l0_history:
            messages.append({
                "role": "system",
                "content": system_content,
            })
            for i, msg in enumerate(l0_history):
                copied = dict(msg)
                if i == len(l0_history) - 1:
                    messages.append(self._with_cache_control(copied))
                else:
                    messages.append(copied)
        else:
            messages.append({
                "role": "system",
                "content": [{
                    "type": "text",
                    "text": system_content,
                    "cache_control": {"type": "ephemeral"},
                }],
            })

        # L1, L2, L3 — each produces a user/assistant pair + history
        # when non-empty. Cache-control on the last message of the
        # tier's sequence.
        for tier_name in ("L1", "L2", "L3"):
            tier = tiered_content.get(tier_name) or {}
            tier_symbols = tier.get("symbols") or ""
            tier_files = tier.get("files") or ""
            tier_history = tier.get("history") or []
            if not (tier_symbols or tier_files or tier_history):
                continue

            tier_messages: list[dict[str, Any]] = []
            body_parts: list[str] = []
            if tier_symbols:
                body_parts.append(TIER_SYMBOLS_HEADER + tier_symbols)
            if tier_files:
                body_parts.append(
                    _TIER_FILE_HEADERS[tier_name] + tier_files
                )
            if body_parts:
                tier_messages.append({
                    "role": "user",
                    "content": "\n\n".join(body_parts),
                })
                tier_messages.append({
                    "role": "assistant",
                    "content": "Ok.",
                })
            for msg in tier_history:
                tier_messages.append(dict(msg))

            # Mark the last message of the tier as the breakpoint.
            if tier_messages:
                tier_messages[-1] = self._with_cache_control(
                    tier_messages[-1]
                )
                messages.extend(tier_messages)

        # File tree — uncached user/assistant pair.
        if file_tree:
            messages.append({
                "role": "user",
                "content": FILE_TREE_HEADER + file_tree,
            })
            messages.append({
                "role": "assistant",
                "content": "Ok.",
            })

        # URL context — uncached user/assistant pair. Joined with a
        # blank-line separator when multiple parts are present.
        if self._url_context:
            messages.append({
                "role": "user",
                "content": URL_CONTEXT_HEADER + "\n---\n".join(
                    self._url_context
                ),
            })
            messages.append({
                "role": "assistant",
                "content": "Ok, I've reviewed the URL content.",
            })

        # Review context — uncached user/assistant pair when active.
        if self._review_context:
            messages.append({
                "role": "user",
                "content": REVIEW_CONTEXT_HEADER + self._review_context,
            })
            messages.append({
                "role": "assistant",
                "content": "Ok, I've reviewed the code changes.",
            })

        # Active files — files not graduated to any cached tier.
        # The file context's insertion order is preserved.
        active_files_text = self._format_active_files(
            tiered_content
        )
        if active_files_text:
            messages.append({
                "role": "user",
                "content": FILES_ACTIVE_HEADER + active_files_text,
            })
            messages.append({
                "role": "assistant",
                "content": "Ok.",
            })

        # Active history — messages whose index is not in any
        # cached tier's graduated indices.
        history = self._history
        for i, msg in enumerate(history):
            if i in all_graduated_history:
                continue
            # Strip the last user message — that's the one we're
            # about to render with images. The streaming handler
            # added it before calling assembly.
            if i == len(history) - 1 and msg.get("role") == "user":
                continue
            messages.append(dict(msg))

        # Current user message — text-only or multimodal.
        messages.append(self._build_user_message(user_prompt, images))

        return messages

    def _format_active_files(
        self,
        tiered_content: dict[str, dict[str, Any]],
    ) -> str:
        """Format active files — those not in any cached tier.

        Collects graduated paths from every tier's
        ``graduated_files`` list, then renders every file context
        entry whose path is not in that set. Order is the file
        context's insertion order (preserved across requests).
        """
        graduated: set[str] = set()
        for tier_name in _CACHED_TIERS:
            tier = tiered_content.get(tier_name) or {}
            for path in tier.get("graduated_files", ()) or ():
                graduated.add(path)

        blocks: list[str] = []
        for path in self._file_context.get_files():
            if path in graduated:
                continue
            content = self._file_context.get_content(path)
            if content is None:
                continue
            blocks.append(f"{path}\n```\n{content}\n```")
        return "\n\n".join(blocks)

    def _build_user_message(
        self,
        user_prompt: str,
        images: list[str] | None,
    ) -> dict[str, Any]:
        """Build the current-turn user message, multimodal if images."""
        if not images:
            return {"role": "user", "content": user_prompt}
        content_blocks: list[dict[str, Any]] = [
            {"type": "text", "text": user_prompt}
        ]
        for uri in images:
            if isinstance(uri, str) and uri.startswith("data:"):
                content_blocks.append({
                    "type": "image_url",
                    "image_url": {"url": uri},
                })
        return {"role": "user", "content": content_blocks}

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