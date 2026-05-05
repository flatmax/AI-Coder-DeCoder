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
from ac_dc.edit_protocol import AgentBlock
from ac_dc.llm._types import ConversationScope
from ac_dc.stability_tracker import StabilityTracker

if TYPE_CHECKING:
    from ac_dc.llm_service import LLMService

logger = logging.getLogger("ac_dc.llm_service")


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

    See :meth:`LLMService._spawn_agents_for_turn` for the full
    prose. Each block gets a fresh scope via
    :func:`build_agent_scope`; each child request ID follows
    ``{parent}-agent-{NN}``. All tasks run concurrently via
    :func:`asyncio.gather` with ``return_exceptions=True``.
    After gathering, :func:`assimilate_agent_changes` folds
    per-agent file changes into the parent.
    """
    if not agent_blocks:
        return
    tasks: list[asyncio.Task[Any]] = []
    for agent_idx, block in enumerate(agent_blocks):
        agent_scope = build_agent_scope(
            service,
            block=block,
            agent_idx=agent_idx,
            parent_scope=parent_scope,
            turn_id=turn_id,
        )
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

    See :meth:`LLMService._build_agent_scope` for the full
    prose describing each field's semantics. Registers the
    scope in ``service._agent_contexts`` so follow-up user
    replies to the agent tab can look it up.

    Agent mode requires a history store — the archive IS
    the transcript the main LLM reads in synthesis. Without
    one, raises :class:`RuntimeError`.
    """
    if service._history_store is None:
        raise RuntimeError(
            "Agent spawning requires a history store; "
            "construct LLMService with history_store=... "
            "to enable agent mode."
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
    )
    agent_tracker = StabilityTracker(
        cache_target_tokens=(
            service._config.cache_target_tokens_for_model()
        ),
    )
    agent_context.set_stability_tracker(agent_tracker)
    scope = ConversationScope(
        context=agent_context,
        tracker=agent_tracker,
        session_id=parent_scope.session_id,
        selected_files=list(parent_scope.selected_files),
        archival_append=agent_context.archival_sink,
    )

    # Register in the agent context registry so the scope
    # outlives the spawn's asyncio.gather and is reachable
    # for follow-up replies.
    service._agent_contexts.setdefault(turn_id, {})[agent_idx] = scope

    return scope


# ---------------------------------------------------------------------------
# Per-turn agent-state descriptor
# ---------------------------------------------------------------------------


def build_agent_descriptor(service: "LLMService") -> str:
    """Render the per-turn agent-state descriptor.

    Walks every live agent in ``service._agent_contexts`` and
    builds a markdown block listing each agent's id and the
    paths it currently has loaded, classified by depth.

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

    # Flatten {turn_id: {agent_idx: scope}} into a list
    # of (turn_id, agent_idx, scope) tuples sorted for
    # determinism. Sort by turn_id first then agent_idx
    # so multiple turns appear in spawn order; within a
    # turn, lower indices come first.
    flat: list[tuple[str, int, ConversationScope]] = []
    for turn_id, agents in contexts.items():
        for agent_idx, scope in agents.items():
            flat.append((turn_id, agent_idx, scope))

    # Empty after flattening (every turn key holds an
    # empty inner dict — defensive against partial
    # cleanup races) means no descriptor at all, not a
    # heading with no body.
    if not flat:
        return ""

    flat.sort(key=lambda item: (item[0], item[1]))

    lines: list[str] = ["## Live agents", ""]

    for turn_id, agent_idx, scope in flat:
        agent_id = f"{turn_id}/agent-{agent_idx:02d}"
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