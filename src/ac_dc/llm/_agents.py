"""Agent spawning — filter, spawn, assimilate.

Extracted from :mod:`ac_dc.llm_service` to keep that module
focused on the service class and its RPC surface. Five entry
points:

- :func:`filter_dispatchable_agents` — gate + filter for
  agent-spawn dispatch. Returns the subset of blocks that
  should actually spawn, after checking the ``agents.enabled``
  toggle and filtering out malformed (``valid=False``)
  blocks. Logs at INFO for successful dispatches and
  WARNING when every block was invalid.
- :func:`spawn_agents_for_turn` — fan out N agents under a
  single user turn. Builds a per-agent :class:`ConversationScope`
  for each block, derives child request IDs of the shape
  ``{parent}-agent-{NN}``, invokes ``service._agent_stream_impl``
  concurrently via :func:`asyncio.gather` with
  ``return_exceptions=True`` so one agent raising doesn't
  kill siblings, then calls :func:`assimilate_agent_changes`.
- :func:`assimilate_agent_changes` — union ``files_modified``
  and ``files_created`` across every agent's completion
  result, append to the parent scope's selection, refresh
  file context content for each path, and broadcast
  ``filesChanged`` + ``filesModified``. Skips exception
  entries so sibling failures don't block assimilation.
- :func:`build_agent_scope` — construct the per-agent
  :class:`ConversationScope`. Splits out from
  :func:`spawn_agents_for_turn` so the construction logic
  is easy to test in isolation. Registers the scope in
  ``service._agent_contexts`` so follow-up user replies
  to the agent tab can look it up by ``(turn_id, agent_idx)``.
- :func:`build_agent_descriptor` — render the per-turn
  agent-state descriptor for orchestrator-prompt
  injection. Walks every live agent in
  ``service._agent_contexts``, classifies each loaded path
  by depth (``full`` from file_context, ``symbol`` /
  ``doc`` from the agent's stability tracker), and returns
  a markdown block. Empty registry returns an empty
  string so the assembly path can drop the section
  cleanly.

Governing spec: :doc:`specs4/7-future/parallel-agents`.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from ac_dc.agent_factory import build_agent_context_manager
from ac_dc.cache_membrane import FluxConfig
from ac_dc.context_manager import Mode
from ac_dc.edit_protocol import AgentBlock
from ac_dc.llm._types import ConversationScope
from ac_dc.stability_tracker import StabilityTracker

if TYPE_CHECKING:
    from ac_dc.llm_service import LLMService

logger = logging.getLogger("ac_dc.llm_service")


# ---------------------------------------------------------------------------
# Mode-string resolution
# ---------------------------------------------------------------------------


def _resolve_agent_mode(
    block_mode: str,
    parent_mode: Mode,
    parent_cross_ref: bool,
) -> tuple[Mode, bool]:
    """Resolve an agent's ``(Mode, cross_ref)`` from its block.

    Per ``specs4/7-future/parallel-agents.md`` § "Agent-spawn
    block format":

    - Empty ``block_mode`` → inherit the orchestrator's
      current mode (both axes).
    - One of the four valid mode strings → flatten back into
      ``(Mode, bool)``.

    The parser already validated the value (commit 1) so any
    non-empty string we see here is one of the four; an
    invalid string would have been flagged ``valid=False``
    upstream and filtered out by ``filter_dispatchable_agents``
    before reaching this code.

    A defensive ``ValueError`` for unrecognised strings stays
    in place anyway — if the validation pipeline is ever
    bypassed (test-only construction of an AgentBlock with a
    bad mode), failing loudly here is better than silently
    inheriting parent mode.
    """
    if not block_mode:
        return parent_mode, parent_cross_ref
    if block_mode == "code":
        return Mode.CODE, False
    if block_mode == "doc":
        return Mode.DOC, False
    if block_mode == "code+xref":
        return Mode.CODE, True
    if block_mode == "doc+xref":
        return Mode.DOC, True
    raise ValueError(
        f"Unrecognised agent mode {block_mode!r}; expected one "
        f"of '', 'code', 'doc', 'code+xref', 'doc+xref'."
    )


# ---------------------------------------------------------------------------
# Dispatch gating
# ---------------------------------------------------------------------------


def filter_dispatchable_agents(
    service: "LLMService",
    agent_blocks: list[AgentBlock],
    parent_request_id: str,
    turn_id: str,
) -> list[AgentBlock]:
    """Gate + filter for agent-spawn dispatch.

    See :meth:`LLMService._filter_dispatchable_agents` for the
    full prose. Three gating rules:

    1. ``config.agents_enabled`` is True.
    2. ``agent_blocks`` is non-empty.
    3. At least one block has ``valid=True``.

    When every block is invalid, logs a WARNING so malformed
    LLM output surfaces rather than being silently dropped.
    When dispatch proceeds, logs one INFO header plus one
    INFO per-block line so operators can trace fan-outs.
    """
    if not service._config.agents_enabled:
        return []
    if not agent_blocks:
        return []
    valid_blocks = [b for b in agent_blocks if b.valid]
    if not valid_blocks:
        logger.warning(
            "Agent mode enabled and LLM emitted %d agent "
            "block(s), but all were invalid (missing id "
            "or task). Parent request %s, turn %s.",
            len(agent_blocks),
            parent_request_id,
            turn_id,
        )
        return []
    logger.info(
        "Agent spawn: dispatching %d agent(s) under "
        "parent request %s (turn %s).",
        len(valid_blocks),
        parent_request_id,
        turn_id,
    )
    for block in valid_blocks:
        logger.info(
            "  agent id=%r task=%r extras=%r",
            block.id,
            block.task,
            block.extras,
        )
    return valid_blocks


# ---------------------------------------------------------------------------
# Spawn orchestrator
# ---------------------------------------------------------------------------


async def spawn_agents_for_turn(
    service: "LLMService",
    agent_blocks: list[AgentBlock],
    parent_scope: ConversationScope,
    parent_request_id: str,
    turn_id: str,
) -> None:
    """Fan out N agents under a single user turn.

    Each block has an LLM-chosen ``id`` (e.g.
    ``"frontend-chat"``). The id is the registry key. The
    dispatch on each block:

    - **Hit + mode matches** — retask. Reuse the existing
      scope; the task arrives as the next user message in
      the agent's existing conversation. ContextManager,
      file context, stability tracker, archival sink (with
      its baked-in ``agent_idx``) are all preserved. Provider
      cache stays warm.
    - **Hit + mode mismatches** — skip with a warning. The
      existing agent stays in its current mode; the
      orchestrator's malformed decomposition is surfaced via
      the log line. The agent isn't started for this turn.
    - **Miss** — fresh spawn via :func:`build_agent_scope`.
      A new ContextManager + tracker is constructed and
      registered; the task drives the agent's first turn.

    Each child request ID follows ``{parent}-agent-{NN:02d}``
    where NN is the block's positional index in this turn's
    spawn list — used only for stream routing on the
    frontend, not for identity. The on-disk archive file
    (``agent-NN.jsonl``) is keyed by the agent's ORIGINAL
    ``agent_idx`` from its first spawn (baked into the
    archival sink closure), so retasked agents continue to
    write to the same archive file across turns.

    All tasks run concurrently via :func:`asyncio.gather`
    with ``return_exceptions=True``. After gathering,
    :func:`assimilate_agent_changes` folds per-agent file
    changes into the parent.

    Per ``specs4/7-future/parallel-agents.md`` § "Agent
    Reuse by ID".
    """
    if not agent_blocks:
        return
    tasks: list[asyncio.Task[Any]] = []
    for agent_idx, block in enumerate(agent_blocks):
        agent_scope = _resolve_or_spawn_agent_scope(
            service,
            block=block,
            agent_idx=agent_idx,
            parent_scope=parent_scope,
            turn_id=turn_id,
        )
        if agent_scope is None:
            # Mode-conflict skip. Logged inside the resolver.
            # The block doesn't reach the LLM this turn.
            continue
        child_request_id = (
            f"{parent_request_id}-agent-{agent_idx:02d}"
        )
        task = asyncio.ensure_future(
            service._agent_stream_impl(
                child_request_id,
                block.task,
                [],  # files — agents start with empty file list
                [],  # images — agents never carry images
                [],  # excluded_urls — agents start fresh
                scope=agent_scope,
                agent_key=block.id,
            )
        )
        tasks.append(task)
    # return_exceptions=True so one agent raising doesn't
    # take down its siblings. Each agent's _stream_chat
    # returns its completion result dict (or the exception
    # instance when it raised); assimilate filters out
    # exceptions and unions the successful results.
    agent_results = await asyncio.gather(
        *tasks, return_exceptions=True
    )
    await assimilate_agent_changes(
        service, agent_results, parent_scope
    )


def _resolve_or_spawn_agent_scope(
    service: "LLMService",
    *,
    block: AgentBlock,
    agent_idx: int,
    parent_scope: ConversationScope,
    turn_id: str,
) -> ConversationScope | None:
    """Look up an existing agent or spawn a fresh one.

    Returns the scope to stream into, or ``None`` when the
    block should be skipped (mode conflict on retask).

    Three cases per ``specs4/7-future/parallel-agents.md``
    § "Agent Reuse by ID":

    - **Hit, mode matches** — return the existing scope.
      Caller proceeds to stream the new task into the same
      ContextManager, which appends it as the next user
      message in the agent's accumulated conversation.
    - **Hit, mode mismatches** — log a warning and return
      None. The orchestrator's malformed decomposition is
      surfaced; the existing agent stays untouched.
    - **Miss** — call :func:`build_agent_scope` to construct
      a fresh ContextManager + tracker, register it, and
      return the new scope.

    Mode resolution for the comparison uses the same logic
    as :func:`build_agent_scope` — empty ``block.mode``
    inherits the orchestrator's current mode. So an
    orchestrator that emits a bare ``id: foo`` block to
    retask agent ``foo`` succeeds when its own mode hasn't
    drifted since the agent's last spawn, and is rejected
    when it has. That's the behaviour the spec wants:
    inherited mode is implicit, but the implicit value
    still has to match the existing agent.
    """
    existing = service._agent_contexts.get(block.id)
    if existing is None or existing.context is None:
        # Miss — fresh spawn.
        return build_agent_scope(
            service,
            block=block,
            agent_idx=agent_idx,
            parent_scope=parent_scope,
            turn_id=turn_id,
        )

    # Hit — validate mode against the existing scope.
    parent_cm = parent_scope.context
    parent_mode = parent_cm.mode if parent_cm else Mode.CODE
    parent_cross_ref = (
        parent_cm.cross_reference_enabled if parent_cm else False
    )
    resolved_mode, resolved_cross_ref = _resolve_agent_mode(
        block.mode, parent_mode, parent_cross_ref,
    )
    existing_mode = existing.context.mode
    existing_cross_ref = existing.context.cross_reference_enabled
    if (
        existing_mode != resolved_mode
        or existing_cross_ref != resolved_cross_ref
    ):
        logger.warning(
            "Agent %r already exists in mode %s; "
            "cannot retask with mode %s. Skipping this "
            "spawn block. The orchestrator must close the "
            "existing agent and respawn to switch modes.",
            block.id,
            _format_mode(existing_mode, existing_cross_ref),
            _format_mode(resolved_mode, resolved_cross_ref),
        )
        return None

    # Hit + mode matches — retask. Return the existing scope
    # unchanged. The caller's _agent_stream_impl will
    # append block.task as the next user message in the
    # agent's existing conversation and stream the response
    # into the same ContextManager.
    logger.info(
        "Retasking agent %r (mode=%s) — preserving "
        "ContextManager, file context, tracker.",
        block.id,
        _format_mode(existing_mode, existing_cross_ref),
    )
    return existing


# ---------------------------------------------------------------------------
# Post-spawn assimilation
# ---------------------------------------------------------------------------


async def assimilate_agent_changes(
    service: "LLMService",
    agent_results: list[Any],
    parent_scope: ConversationScope,
) -> None:
    """Fold agent-modified files into the parent's context.

    See :meth:`LLMService._assimilate_agent_changes` for the
    full prose. Four steps:

    1. Union ``files_modified`` + ``files_created`` across
       every successful agent result. Exception entries and
       non-dict entries (None from a stub impl) are skipped.
    2. For each path in the union: append to the parent's
       ``selected_files`` if not already present, refresh
       content in the parent's file context.
    3. Broadcast ``filesChanged`` with the updated selection.
    4. Broadcast ``filesModified`` with the union of paths.

    No automatic synthesis LLM call fires — review and
    iteration are user-driven on follow-up turns.
    """
    if not agent_results:
        return
    union_paths: list[str] = []
    seen: set[str] = set()
    sibling_exceptions = 0
    for result in agent_results:
        if isinstance(result, BaseException):
            sibling_exceptions += 1
            logger.warning(
                "Agent raised during assimilation: %r",
                result,
            )
            continue
        if not isinstance(result, dict):
            continue
        for key in ("files_modified", "files_created"):
            entries = result.get(key) or []
            if not isinstance(entries, list):
                continue
            for path in entries:
                if not isinstance(path, str):
                    continue
                if path in seen:
                    continue
                seen.add(path)
                union_paths.append(path)

    if not union_paths:
        if sibling_exceptions > 0:
            logger.info(
                "Agent assimilation: no files modified "
                "across %d agent result(s) (%d raised).",
                len(agent_results),
                sibling_exceptions,
            )
        return

    # Extend selection and refresh file context.
    added_to_selection: list[str] = []
    for path in union_paths:
        if path not in parent_scope.selected_files:
            parent_scope.selected_files.append(path)
            added_to_selection.append(path)
    # Refresh content for every path in the union, not just
    # newly-added ones. A path already in the parent's
    # selection had its content loaded at the start of the
    # parent's turn; if an agent then edited it, the cached
    # content is stale.
    file_context = parent_scope.context.file_context
    refresh_failures = 0
    for path in union_paths:
        try:
            file_context.add_file(path)
        except Exception as exc:
            refresh_failures += 1
            logger.warning(
                "Agent assimilation: failed to refresh "
                "file context for %s: %s. Parent's next "
                "turn may see stale content.",
                path, exc,
            )

    # Broadcast so the frontend picker reloads.
    service._broadcast_event(
        "filesChanged", list(parent_scope.selected_files)
    )
    service._broadcast_event(
        "filesModified", list(union_paths)
    )

    logger.info(
        "Agent assimilation: %d file(s) unioned, %d added "
        "to parent selection (%d refresh failure(s), "
        "%d sibling exception(s)).",
        len(union_paths),
        len(added_to_selection),
        refresh_failures,
        sibling_exceptions,
    )


# ---------------------------------------------------------------------------
# Per-agent scope construction
# ---------------------------------------------------------------------------


def build_agent_scope(
    service: "LLMService",
    block: AgentBlock,
    agent_idx: int,
    parent_scope: ConversationScope,
    turn_id: str,
) -> ConversationScope:
    """Construct a per-agent :class:`ConversationScope`.

    Registry shape: ``service._agent_contexts`` is flat,
    keyed by ``block.id`` directly. Reusing a known id is
    not handled here — :func:`spawn_agents_for_turn` does
    the lookup-or-spawn dispatch and only calls this
    function on a miss. When called, this function creates
    a fresh scope unconditionally.

    The ``agent_idx`` parameter is positional only — used
    by the archive sink (file naming on disk follows
    ``agent-NN.jsonl`` for stable ordering) and surfaced to
    the agent's ContextManager for diagnostics. It is NOT
    part of the agent's identity. Identity is the LLM-chosen
    id alone.

    Agent mode requires a history store — the archive IS
    the transcript the main LLM reads in synthesis. Without
    one, raises :class:`RuntimeError`.

    Mode resolution: ``block.mode`` (one of ``""``, ``code``,
    ``doc``, ``code+xref``, ``doc+xref``) is flattened back
    into ``(Mode, cross_reference_enabled)`` and applied to
    the agent's ContextManager via the factory. An empty
    ``block.mode`` inherits both axes from
    ``parent_scope.context``.

    This function ALWAYS constructs a fresh scope and
    overwrites any existing entry for ``block.id`` in the
    registry. The retask-vs-fresh-spawn dispatch — and the
    mode-conflict check that goes with it — lives in
    :func:`spawn_agents_for_turn`, not here. Calling this
    function directly when an entry for ``block.id`` already
    exists will throw away the existing scope's
    ContextManager, conversation history, file context, and
    stability tracker. Most callers should use
    :func:`spawn_agents_for_turn`.
    """
    if service._history_store is None:
        raise RuntimeError(
            "Agent spawning requires a history store; "
            "construct LLMService with history_store=... "
            "to enable agent mode."
        )

    # Resolve the agent's (mode, cross_ref) pair. Inherits
    # from the parent scope's ContextManager when the block
    # didn't specify a mode.
    parent_cm = parent_scope.context
    parent_mode = parent_cm.mode if parent_cm else Mode.CODE
    parent_cross_ref = (
        parent_cm.cross_reference_enabled if parent_cm else False
    )
    resolved_mode, resolved_cross_ref = _resolve_agent_mode(
        block.mode, parent_mode, parent_cross_ref,
    )

    agent_context = build_agent_context_manager(
        turn_id=turn_id,
        agent_idx=agent_idx,
        model_name=service._config.model,
        history_store=service._history_store,
        repo=service._repo,
        cache_target_tokens=(
            service._config.cache_target_tokens_for_model()
        ),
        compaction_config=service._config.compaction_config,
        # Agents need the same behavioural instructions
        # as a non-agent turn — edit protocol, context-
        # trust rules, tone — because they run through
        # the same streaming pipeline with the same
        # edit parser and apply path. Without this, an
        # agent has never been told the edit block
        # format exists and invents plausible-looking
        # alternatives (XML, JSON, diff headers) that
        # the parser silently drops. The agentic
        # appendix is deliberately NOT included — tree
        # depth is 1 per spec, agents don't spawn
        # sub-agents.
        system_prompt=service._config.get_agent_system_prompt(),
        mode=resolved_mode,
        cross_reference_enabled=resolved_cross_ref,
    )
    agent_tracker = StabilityTracker(
        cache_target_tokens=(
            service._config.cache_target_tokens_for_model()
        ),
        flux_config=FluxConfig.from_dict(
            service._config.cache_tiering_config
        ),
    )
    agent_context.set_stability_tracker(agent_tracker)
    scope = ConversationScope(
        context=agent_context,
        tracker=agent_tracker,
        session_id=parent_scope.session_id,
        selected_files=list(parent_scope.selected_files),
        archival_append=agent_context.archival_sink,
        agent_idx=agent_idx,
    )

    # Register flat under the LLM-chosen id. Agents persist
    # for the lifetime of the session and survive across
    # ``new_session`` (which clears each agent's chat
    # history but keeps the scope alive — see
    # :func:`new_session` in ``_rpc_state.py``).
    service._agent_contexts[block.id] = scope

    return scope


def _format_mode(mode: Mode, cross_ref: bool) -> str:
    """Render a ``(Mode, bool)`` pair as the user-facing string.

    Inverse of :func:`_resolve_agent_mode`. Used in error
    messages so the orchestrator (and the user reading the
    backend log) sees ``code+xref`` rather than the raw
    ``Mode.CODE / cross_ref=True`` representation.
    """
    base = mode.value  # "code" or "doc"
    return f"{base}+xref" if cross_ref else base


# Mode-change event format.
#
# ``switch_agent_mode`` and ``set_agent_cross_reference`` in
# ``_rpc_state.py`` write archive events with content::
#
#     "Mode changed: {old} → {new}."
#
# where {old}/{new} are produced by :func:`_format_mode`. The
# arrow is U+2192 RIGHTWARDS ARROW. The four valid mode
# strings are the same set ``_resolve_agent_mode`` recognises.
#
# Replay parses these events in order and updates running
# ``(Mode, cross_ref)`` state. Malformed events skip without
# raising — the running state continues from the previous
# record.
_MODE_CHANGE_PREFIX = "Mode changed: "
_MODE_CHANGE_ARROW = " → "
_VALID_MODE_STRINGS: frozenset[str] = frozenset(
    {"code", "doc", "code+xref", "doc+xref"}
)


def _parse_mode_string(mode_str: str) -> tuple[Mode, bool] | None:
    """Parse a mode string back to ``(Mode, cross_ref)``.

    Inverse of :func:`_format_mode`. Returns None for
    unrecognised strings — the four-element valid set is
    the only acceptable input. Empty strings, garbage,
    case mismatches all return None so the replay walk
    can skip them defensively.
    """
    if mode_str not in _VALID_MODE_STRINGS:
        return None
    if mode_str == "code":
        return Mode.CODE, False
    if mode_str == "doc":
        return Mode.DOC, False
    if mode_str == "code+xref":
        return Mode.CODE, True
    if mode_str == "doc+xref":
        return Mode.DOC, True
    return None  # unreachable but keeps type checker happy


def _replay_mode_events(
    archive_messages: list[dict[str, Any]],
    initial_mode: Mode,
    initial_cross_ref: bool,
) -> tuple[Mode, bool]:
    """Replay archive mode-change events on top of a baseline.

    Walks ``archive_messages`` in order looking for
    ``system_event: true`` records whose content matches the
    format ``switch_agent_mode`` and
    ``set_agent_cross_reference`` write. Each valid event
    advances the running ``(Mode, cross_ref)`` state to the
    parsed target.

    Per spec specs4/3-llm/history.md § Session-Load
    Reconstruction step 5 — replay strategy (b) is the
    authoritative source of truth for an agent's mode at
    session-save time. The spawn-time baseline supplied by
    the caller is just the starting point; archived
    transitions are what land the agent in its final state.

    Defensive parsing rules:

    - Records without ``system_event: true`` are skipped
      without inspection. Non-event records (the agent's
      actual conversation) outnumber events; this is the
      hot path.
    - Records with malformed content (missing prefix,
      missing arrow, missing terminator, unrecognised mode
      strings on either side of the arrow) are skipped
      with no state change. The running state continues
      from the previous valid record.
    - The terminating ``"."`` is required — without it,
      a content like ``"Mode changed: code → doc"``
      should not be treated as an event because that's
      not the format the writers produce. Strict matching
      surfaces a writer-side regression as a quietly
      lost replay rather than a silently-tolerated drift.

    Old mode (left of arrow) is parsed but only used as a
    sanity check — the replay applies the right-side mode
    regardless. A drift between persisted-old and
    running-state would indicate either a malformed event
    or two different agents' events mixing in one archive;
    in either case the right-side mode is the authoritative
    "what mode is the agent NOW" answer.

    Parameters
    ----------
    archive_messages:
        The agent's concatenated archive, in chronological
        order. Same shape passed to
        :func:`reconstruct_agent_scope` for history
        population.
    initial_mode:
        Spawn-time baseline mode from the latest
        ``agent_blocks`` record.
    initial_cross_ref:
        Spawn-time baseline cross-reference flag.

    Returns
    -------
    tuple[Mode, bool]
        The agent's final mode + cross_ref after replaying
        every valid event. When no events match, returns
        the baseline unchanged.
    """
    mode = initial_mode
    cross_ref = initial_cross_ref

    for record in archive_messages:
        if not isinstance(record, dict):
            continue
        if record.get("system_event") is not True:
            continue
        content = record.get("content")
        if not isinstance(content, str):
            continue
        # Strict format match. The writers always produce
        # the prefix + arrow + period shape; loosening here
        # would tolerate writer drift silently.
        if not content.startswith(_MODE_CHANGE_PREFIX):
            continue
        if not content.endswith("."):
            continue
        # Strip prefix + trailing period, then split on the
        # arrow. Both halves must parse to valid mode
        # strings.
        body = content[len(_MODE_CHANGE_PREFIX):-1]
        if _MODE_CHANGE_ARROW not in body:
            continue
        old_str, new_str = body.split(
            _MODE_CHANGE_ARROW, 1,
        )
        old_str = old_str.strip()
        new_str = new_str.strip()
        # Validate left side. We don't compare it against
        # the running state — see the docstring for why.
        if _parse_mode_string(old_str) is None:
            continue
        parsed = _parse_mode_string(new_str)
        if parsed is None:
            continue
        mode, cross_ref = parsed

    return mode, cross_ref


# ---------------------------------------------------------------------------
# Per-turn agent-state descriptor
# ---------------------------------------------------------------------------


def build_agent_descriptor(service: "LLMService") -> str:
    """Render the per-turn agent-state descriptor.

    Walks every live agent in ``service._agent_contexts`` and
    builds a markdown block listing each agent's id, the
    model it speaks to, its repo-view mode, and the paths
    it currently has loaded, classified by depth.

    Each entry's identity line takes the shape
    ``**{id}** — model: {model}, mode: {mode}`` where
    ``{model}`` is the provider-qualified identifier the
    agent's ContextManager was constructed with (e.g.
    ``anthropic/claude-sonnet-4-5``) and ``{mode}`` is one
    of ``code``, ``doc``, ``code+xref``, ``doc+xref`` —
    matching the four-string surface the orchestrator
    uses in spawn blocks. The orchestrator reads this to
    decide which agent is the right target for a given
    task: a code-mode agent is good for refactors, a
    doc-mode agent for documentation work, the ``+xref``
    variants for tasks spanning both. The model hint
    matters when agents run on heterogenous models —
    retasking a cheap-fast agent for a problem that needs
    a stronger model is a routing error the orchestrator
    can avoid when it sees both.

    Three depth values per
    :doc:`specs4/7-future/parallel-agents` § "Per-agent state
    descriptor":

    - ``full`` — file content is in the agent's
      ``file_context`` (selected by the user, auto-added
      from edit blocks, or created by the agent). The
      orchestrator can retask precise edits onto this
      agent without a re-read penalty.
    - ``symbol`` — only the symbol-map summary. The agent
      has structural awareness but will re-read the body
      to edit.
    - ``doc`` — only the document-index outline. Heading
      and link structure only; same re-read implication
      as ``symbol``.

    A path that appears at ``full`` depth is omitted from
    ``symbol`` / ``doc`` listings — the orchestrator only
    needs to know the deepest level the agent has loaded.

    Empty registry returns an empty string. Callers (the
    assembly path) drop the section cleanly when the
    descriptor is empty so single-agent and zero-agent
    operation produces no descriptor noise in the prompt.

    The descriptor is built fresh on every call. There is
    no caching: ``new_session`` clears each agent's chat
    history but preserves their identity and file context,
    file selections change between turns as agents work,
    and tier promotions reshape the symbol/doc lists.
    Rebuilding from live state is cheap (dict iteration
    plus prefix matching) and avoids invalidation bugs.

    See the spec's "Single-copy invariant — assembly-time
    injection" section for why this is a transient
    string and not persisted to history.

    Returns
    -------
    str
        Markdown block starting with a level-2 heading
        (``## Live agents``) and one bullet per agent.
        Empty string when no agents are registered.
    """
    contexts = service._agent_contexts
    if not contexts:
        return ""

    # Flat registry: {agent_id: scope}. Sort by agent id
    # for deterministic output regardless of insertion
    # order — operator-friendly, test-friendly.
    sorted_ids = sorted(contexts.keys())

    lines: list[str] = ["## Live agents", ""]

    for agent_id in sorted_ids:
        scope = contexts[agent_id]
        # Surface the agent's identity (model + mode)
        # inline with its id so the orchestrator can route
        # work appropriately. Two pieces:
        #
        # - model — the provider-qualified id the agent
        #   speaks to (e.g. ``anthropic/claude-sonnet-4-5``).
        #   Different agents can in principle run on
        #   different models; surfacing the model lets the
        #   orchestrator avoid retasking a fast-cheap agent
        #   onto a problem that needs a stronger model and
        #   vice versa.
        # - mode — the four-string surface ``code`` /
        #   ``doc`` / ``code+xref`` / ``doc+xref``.
        #
        # Agents without a ContextManager (defensive —
        # shouldn't happen in practice) get no
        # parenthesised hint.
        meta_parts: list[str] = []
        if scope.context is not None:
            model = getattr(scope.context, "model", "") or ""
            if model:
                meta_parts.append(f"model: {model}")
            mode_str = _format_mode(
                scope.context.mode,
                scope.context.cross_reference_enabled,
            )
            if mode_str:
                meta_parts.append(f"mode: {mode_str}")
        if meta_parts:
            lines.append(
                f"- **{agent_id}** — {', '.join(meta_parts)}"
            )
        else:
            lines.append(f"- **{agent_id}**")

        full_paths, symbol_paths, doc_paths = _classify_agent_paths(scope)

        if not full_paths and not symbol_paths and not doc_paths:
            lines.append("  - (no files loaded)")
            continue

        if full_paths:
            joined = ", ".join(full_paths)
            lines.append(f"  - full: {joined}")
        if symbol_paths:
            joined = ", ".join(symbol_paths)
            lines.append(f"  - symbol: {joined}")
        if doc_paths:
            joined = ", ".join(doc_paths)
            lines.append(f"  - doc: {joined}")

    return "\n".join(lines)


def _classify_agent_paths(
    scope: ConversationScope,
) -> tuple[list[str], list[str], list[str]]:
    """Bucket an agent's loaded paths into full / symbol / doc.

    Reads three sources:

    - ``scope.context.file_context`` — paths whose full
      content is loaded
    - ``scope.tracker`` items prefixed ``symbol:`` —
      symbol-map entries
    - ``scope.tracker`` items prefixed ``doc:`` —
      doc-index entries

    Deduplication: a path that's in ``file_context`` is
    always classified as ``full`` and removed from the
    ``symbol`` / ``doc`` lists. ``symbol`` and ``doc``
    can overlap when cross-reference mode is enabled (the
    same path appears in both indexes); we keep both
    listings so the orchestrator sees the full picture.

    Each list is sorted alphabetically for deterministic
    output. Sort cost is negligible compared to assembly
    overhead.
    """
    full_set: set[str] = set()
    if scope.context is not None:
        full_set = set(scope.context.file_context.get_files())

    symbol_set: set[str] = set()
    doc_set: set[str] = set()
    if scope.tracker is not None:
        for key in scope.tracker.get_all_items().keys():
            if key.startswith("symbol:"):
                symbol_set.add(key[len("symbol:"):])
            elif key.startswith("doc:"):
                doc_set.add(key[len("doc:"):])

    # Deepest-only: if a path is in file_context, drop it
    # from the structural lists. The orchestrator already
    # knows the agent has full content; the structural
    # entry is redundant.
    symbol_set -= full_set
    doc_set -= full_set

    return (
        sorted(full_set),
        sorted(symbol_set),
        sorted(doc_set),
    )


# ---------------------------------------------------------------------------
# Session-load reconstruction
# ---------------------------------------------------------------------------


def reconstruct_agent_scope(
    service: "LLMService",
    *,
    agent_id: str,
    turn_id: str,
    agent_idx: int,
    model: str | None,
    mode: Mode,
    cross_ref: bool,
    archive_messages: list[dict[str, Any]],
) -> ConversationScope:
    """Reconstruct an agent scope from persisted archive content.

    Mirrors :func:`build_agent_scope` but for the session-load
    path: no parent_scope (no orchestrator turn in flight at
    load time), no spawn-block mode resolution (caller has
    already resolved mode + cross_ref from persisted state),
    no deep copy of selected_files (selections aren't
    persisted; reconstructed agents start with empty
    selection — the spec defers that).

    Per :doc:`specs4/3-llm/history` § Session-Load Reconstruction
    steps 6-8: build a fresh ContextManager via the factory,
    pre-populate its history from the archive, attach a fresh
    StabilityTracker (cache starts cold), construct the scope,
    register in ``service._agent_contexts[agent_id]``.

    The ``model`` parameter is informational — the agent's
    ContextManager always uses ``service._config.model`` for
    LLM calls (per-agent model overrides aren't supported
    yet). When the persisted ``agent_blocks`` entry carries a
    ``model`` field, callers thread it through for future
    routing logic; today the value is recorded but not acted
    on. None means the persisted record predated Increment 3a.

    Replay strategy (b) for mode is the spec's authoritative
    contract, but Commit 1 supplies only the spawn-time
    baseline. Commit 2 will add ``_replay_mode_events`` and
    update this function to call it before constructing the
    ContextManager. Until then, an agent toggled mid-session
    reconstructs as its spawn-time mode — known-wrong
    intermediate state.

    Parameters
    ----------
    service:
        The :class:`LLMService` whose ``_agent_contexts``
        registry will receive the reconstructed scope.
    agent_id:
        The LLM-chosen identifier from the agent's spawn
        block. Becomes the registry key.
    turn_id:
        The turn ID the agent's archive directory is named
        by. Used by the archival sink closure so post-load
        messages append to the same ``agent-NN.jsonl`` file.
    agent_idx:
        The agent's positional index within its spawn turn.
        Determines the archive filename. Stable across
        retasks within the session.
    model:
        Provider-qualified model identifier from the
        persisted ``agent_blocks`` entry, or None for
        pre-Increment-3a records. Currently informational.
    mode:
        The agent's primary mode at session-save time. Per
        replay strategy (b) this should be the post-replay
        mode; Commit 1 supplies the spawn-time baseline only
        and Commit 2 adds the replay step.
    cross_ref:
        Whether cross-reference is enabled for this agent.
        Same replay caveat as ``mode``.
    archive_messages:
        The agent's full conversation, concatenated across
        every turn it participated in, in chronological
        order. Each entry is a dict with at minimum ``role``
        and ``content``; ``system_event`` and other optional
        fields round-trip through ContextManager.add_message.

    Returns
    -------
    ConversationScope
        The reconstructed scope, already registered in the
        service's ``_agent_contexts`` map. Caller does not
        need to register separately.

    Raises
    ------
    RuntimeError
        If the service has no history store attached. Agent
        reconstruction requires the same persistence
        infrastructure as agent spawning.
    """
    if service._history_store is None:
        raise RuntimeError(
            "Agent reconstruction requires a history store; "
            "construct LLMService with history_store=... to "
            "enable session-load agent rehydration."
        )

    # Replay mode-change events on top of the spawn-time
    # baseline. Per spec § Session-Load Reconstruction step
    # 5, replay-from-archive is the authoritative source of
    # truth for an agent's mode at session-save time. The
    # ``mode``/``cross_ref`` parameters are the spawn-time
    # baseline — the starting point for the replay walk;
    # the post-replay values are what land in the
    # ContextManager.
    final_mode, final_cross_ref = _replay_mode_events(
        archive_messages, mode, cross_ref,
    )

    # Construct the ContextManager via the same factory the
    # spawn path uses. The factory bakes turn_id and
    # agent_idx into the archival sink closure, so messages
    # the agent produces post-load append to the correct
    # archive file. ``model`` is currently informational —
    # the factory uses ``service._config.model`` for LLM
    # routing.
    del model  # informational only; unused in Commit 1
    agent_context = build_agent_context_manager(
        turn_id=turn_id,
        agent_idx=agent_idx,
        model_name=service._config.model,
        history_store=service._history_store,
        repo=service._repo,
        cache_target_tokens=(
            service._config.cache_target_tokens_for_model()
        ),
        compaction_config=service._config.compaction_config,
        system_prompt=service._config.get_agent_system_prompt(),
        mode=final_mode,
        cross_reference_enabled=final_cross_ref,
    )

    # Pre-populate history from the archive. Each archive
    # record is a dict with role/content plus optional
    # fields; ContextManager.add_message takes role and
    # content positionally and forwards extras via **kwargs.
    # We strip backend-internal fields the ContextManager
    # doesn't know about (turn_id, agent_idx, id, timestamp)
    # but pass through the user-relevant ones (system_event,
    # files, files_modified, edit_results, image_refs).
    for record in archive_messages:
        if not isinstance(record, dict):
            continue
        role = record.get("role")
        content = record.get("content", "")
        if role not in ("user", "assistant"):
            continue
        # Forward optional fields ContextManager / its sink
        # know about. The sink will re-route them through
        # append_agent_message, which is itself the source
        # of these archive records — so the round-trip
        # preserves them. system_event is the load-bearing
        # one for Commit 2's replay step.
        extras: dict[str, Any] = {}
        if record.get("system_event") is True:
            extras["system_event"] = True
        # Pass through optional list/dict fields verbatim;
        # ContextManager.add_message accepts arbitrary
        # **kwargs and stores them on the message dict.
        for key in ("files", "files_modified",
                    "edit_results", "image_refs"):
            if key in record:
                extras[key] = record[key]
        agent_context.add_message(role, content, **extras)

    # Fresh StabilityTracker — cache starts cold per spec.
    # Saved tracker tier assignments are not persisted, so
    # rebuilding from scratch is the only option. The next
    # turn the agent runs will rebuild tier state naturally
    # from its loaded history + symbol/doc index activity.
    agent_tracker = StabilityTracker(
        cache_target_tokens=(
            service._config.cache_target_tokens_for_model()
        ),
        flux_config=FluxConfig.from_dict(
            service._config.cache_tiering_config
        ),
    )
    agent_context.set_stability_tracker(agent_tracker)

    # Selections are not persisted (per spec). Reconstructed
    # agents start with empty selection lists; the user can
    # re-tick files in the picker if needed, or the
    # orchestrator can grant files via edit blocks.
    scope = ConversationScope(
        context=agent_context,
        tracker=agent_tracker,
        session_id=service._session_id,
        selected_files=[],
        archival_append=agent_context.archival_sink,
        agent_idx=agent_idx,
    )

    service._agent_contexts[agent_id] = scope
    logger.info(
        "Reconstructed agent %r (turn %s, idx %d, mode %s) — "
        "%d archive message(s) loaded",
        agent_id,
        turn_id,
        agent_idx,
        _format_mode(final_mode, final_cross_ref),
        len(archive_messages),
    )
    return scope