"""Message assembly — tiered and flat prompt construction.

Extracted from :mod:`ac_dc.llm_service` to keep that module
focused on the streaming pipeline. Three functions:

- :func:`build_tiered_content` — walk the stability tracker
  and bucket items into per-tier content dicts. Returns None
  when the tracker is empty, signalling the flat-assembly
  fallback.
- :func:`assemble_tiered` — the primary message assembly
  path. Computes the exclusion set (selected files + tier-
  graduated file paths), builds the symbol/doc legend pair
  (mode-aware with cross-reference routing), and delegates
  to :meth:`ContextManager.assemble_tiered_messages`.
- :func:`assemble_messages_flat` — fallback used when the
  tracker hasn't been initialised yet. Produces a flat
  system + history + user sequence with no cache-control
  markers. Must still carry the symbol map, file tree, URL
  context, review context, and active-file content —
  otherwise an uninitialised tracker silently drops every
  selected file from the prompt.

All three functions take the :class:`LLMService` as their
first argument and a :class:`ConversationScope` as their
second. Scope-aware so future parallel-agent spawning can
assemble prompts for per-agent ContextManagers without
changes to the assembly code.

Governing spec: :doc:`specs4/3-llm/prompt-assembly`.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from ac_dc.context_manager import Mode

if TYPE_CHECKING:
    from ac_dc.llm._types import ConversationScope
    from ac_dc.llm_service import LLMService

logger = logging.getLogger("ac_dc.llm_service")


# ---------------------------------------------------------------------------
# Tiered content builder
# ---------------------------------------------------------------------------


def build_tiered_content(
    service: "LLMService",
    scope: "ConversationScope | None" = None,
) -> dict[str, dict[str, Any]] | None:
    """Walk the stability tracker and build per-tier content dicts.

    Returns ``None`` when the tracker has no items yet —
    the streaming handler uses that as the signal to fall
    back to flat assembly. An empty-but-initialised tracker
    returns an empty-but-non-None dict (all tiers with empty
    content lists), so the fallback only fires during a
    narrow pre-init window.

    Each tier entry has keys:

    - ``symbols`` — concatenated symbol/doc index blocks
    - ``files`` — concatenated fenced file contents for
      ``file:`` items in this tier
    - ``history`` — history message dicts graduated to this
      tier (in original index order)
    - ``graduated_files`` — file paths whose full content is
      in this tier (used for active-files exclusion)
    - ``graduated_history_indices`` — history message indices
      in this tier (used for active-history exclusion)

    Key-prefix dispatch:

    - ``symbol:{path}`` — symbol index block for the file
    - ``doc:{path}`` — doc index block (shares the ``symbols``
      field with symbol blocks so cross-reference mode
      produces one coherent block per tier)
    - ``file:{path}`` — full file content as a fenced block
    - ``history:{N}`` — history message at index N
    - ``system:*``, ``url:*`` — skipped (system prompt is
      handled by the assembler directly; URL tier entry is
      deferred)

    Defensive filters skip:

    - Items whose path is user-excluded (tracker cleanup will
      drop them on the next update cycle; belt-and-suspenders
      guard prevents leakage mid-cycle)
    - ``symbol:``/``doc:`` items for selected files (their
      full content renders via ``file:`` or active Working
      Files; the index block would be a duplicate)
    """
    if scope is None:
        scope = service._default_scope()
    if scope.tracker is None:
        return None
    all_items = scope.tracker.get_all_items()
    if not all_items:
        return None

    # Result skeleton — every tier gets an entry even when
    # empty, so the assembler's `tiered_content.get(tier) or
    # {}` fallback always finds the right shape.
    result: dict[str, dict[str, Any]] = {
        tier: {
            "symbols": "",
            "files": "",
            "history": [],
            "graduated_files": [],
            "graduated_history_indices": [],
        }
        for tier in ("L0", "L1", "L2", "L3")
    }

    history = scope.context.get_history()

    # Walk items once, dispatching by tier + prefix. Each
    # tier builds lists of fragments first, then joins at
    # the end so the fragment ordering is deterministic
    # (sort by key for stability).
    tier_symbol_fragments: dict[str, list[str]] = {
        t: [] for t in ("L0", "L1", "L2", "L3")
    }
    tier_file_fragments: dict[str, list[str]] = {
        t: [] for t in ("L0", "L1", "L2", "L3")
    }
    tier_history_entries: dict[
        str, list[tuple[int, dict[str, Any]]]
    ] = {t: [] for t in ("L0", "L1", "L2", "L3")}

    # Defensive filter sets per specs-reference/3-llm/
    # prompt-assembly.md § Uniqueness invariants.
    selected_set = set(scope.selected_files)
    excluded_set = set(
        getattr(service, "_excluded_index_files", [])
    )

    for key in sorted(all_items.keys()):
        item = all_items[key]
        tier_name = getattr(
            item.tier, "value", str(item.tier)
        )
        if tier_name not in ("L0", "L1", "L2", "L3"):
            continue

        # Extract the path once for defensive filters below.
        path_suffix: str | None = None
        for prefix in ("symbol:", "doc:", "file:"):
            if key.startswith(prefix):
                path_suffix = key[len(prefix):]
                break

        # Defensive: skip user-excluded paths regardless of
        # prefix.
        if (
            path_suffix is not None
            and path_suffix in excluded_set
        ):
            logger.debug(
                "Tier content: skipping %s (excluded from "
                "index by user); tracker entry will be "
                "cleaned up on next update cycle",
                key,
            )
            continue

        # Defensive: skip symbol:/doc: for selected files.
        if (
            key.startswith(("symbol:", "doc:"))
            and path_suffix is not None
            and path_suffix in selected_set
        ):
            logger.debug(
                "Tier content: skipping %s (full content "
                "present via selection); tracker entry "
                "will be cleaned up on next update cycle",
                key,
            )
            continue

        if key.startswith("symbol:"):
            path = key[len("symbol:"):]
            if service._symbol_index is None:
                continue
            block = service._symbol_index.get_file_symbol_block(
                path
            )
            if block:
                tier_symbol_fragments[tier_name].append(block)
                result[tier_name]["graduated_files"].append(path)
        elif key.startswith("doc:"):
            path = key[len("doc:"):]
            block = service._doc_index.get_file_doc_block(path)
            if block:
                tier_symbol_fragments[tier_name].append(block)
                result[tier_name]["graduated_files"].append(path)
        elif key.startswith("file:"):
            path = key[len("file:"):]
            content = scope.context.file_context.get_content(path)
            if content is None:
                logger.debug(
                    "Tier content for %s skipped: no "
                    "content in file context (stale "
                    "tracker entry, cleanup on next cycle)",
                    key,
                )
                continue
            tier_file_fragments[tier_name].append(
                f"{path}\n```\n{content}\n```"
            )
            result[tier_name]["graduated_files"].append(path)
        elif key.startswith("history:"):
            try:
                idx = int(key[len("history:"):])
            except ValueError:
                continue
            if 0 <= idx < len(history):
                tier_history_entries[tier_name].append(
                    (idx, dict(history[idx]))
                )
                result[tier_name][
                    "graduated_history_indices"
                ].append(idx)
        # system:*, url:* — intentionally skipped.

    # Finalise each tier. Symbols and files join with blank
    # lines between fragments. History is sorted by original
    # index so multi-message tier content reads in conversation
    # order.
    for tier_name in ("L0", "L1", "L2", "L3"):
        result[tier_name]["symbols"] = "\n\n".join(
            tier_symbol_fragments[tier_name]
        )
        result[tier_name]["files"] = "\n\n".join(
            tier_file_fragments[tier_name]
        )
        tier_history_entries[tier_name].sort(key=lambda p: p[0])
        result[tier_name]["history"] = [
            msg for _idx, msg in tier_history_entries[tier_name]
        ]

    return result


# ---------------------------------------------------------------------------
# Tiered assembly — primary path
# ---------------------------------------------------------------------------


def assemble_tiered(
    service: "LLMService",
    user_prompt: str,
    images: list[str],
    tiered_content: dict[str, dict[str, Any]],
    scope: "ConversationScope | None" = None,
) -> list[dict[str, Any]]:
    """Build the tiered message array.

    Computes the symbol map with tier-aware exclusions (two-
    pass: exclude selected files from the map, then exclude
    tier-graduated file paths too) and delegates message
    assembly to the context manager.

    System reminder is appended to the user prompt so the
    tier assembler doesn't need to know about it.

    Legend routing per specs4/3-llm/modes.md and
    specs4/3-llm/prompt-assembly.md § "Cross-Reference Legend
    Headers":

    - Doc mode primary: doc legend flows to the primary slot
      (``symbol_legend`` kwarg). The context manager's
      assembler picks ``DOC_MAP_HEADER`` based on
      ``scope.context.mode``.
    - Code mode + cross-reference: doc is the secondary;
      assembler places it under ``DOC_MAP_HEADER``.
    - Code mode without cross-ref: doc legend suppressed.
    """
    if scope is None:
        scope = service._default_scope()

    # Per-turn agent-state descriptor — only for the
    # orchestrator's prompt. Agent ContextManagers don't
    # see the descriptor (they're already that scope's
    # peers, and self-referencing the live registry
    # would be confusing for them). Identity check on
    # ``scope.context`` rather than ``scope`` because
    # ``_default_scope()`` builds a fresh wrapper each
    # call but always around the same long-lived
    # ``service._context``. Per
    # :doc:`specs4/7-future/parallel-agents` § "Single-
    # copy invariant — assembly-time injection", the
    # descriptor is assembled fresh per turn and never
    # persisted to history.
    descriptor = ""
    if scope.context is service._context:
        from ac_dc.llm._agents import build_agent_descriptor
        descriptor = build_agent_descriptor(service)

    # Append the system reminder before assembly so it lands
    # at the end of the user's text — closest to where the
    # model generates. Descriptor goes before the user's
    # text (informational header); reminder goes after
    # (behavioural tail).
    reminder = service._config.get_system_reminder()
    descriptor_prefix = (
        descriptor + "\n\n" if descriptor else ""
    )
    augmented_prompt = (
        descriptor_prefix + user_prompt + (reminder or "")
    )

    # Build the exclusion set: selected files (full content
    # in active Working Files) plus every path graduated into
    # a cached tier as a file: item (full content in that
    # tier, so main symbol map shouldn't render it).
    exclude_files: set[str] = set(scope.selected_files)
    for tier_name in ("L0", "L1", "L2", "L3"):
        tier = tiered_content.get(tier_name) or {}
        for path in tier.get("graduated_files", ()) or ():
            exclude_files.add(path)

    symbol_map = ""
    symbol_legend = ""
    if service._symbol_index is not None:
        symbol_map = service._symbol_index.get_symbol_map(
            exclude_files=exclude_files
        )
        symbol_legend = service._symbol_index.get_legend()

    # Doc legend — emitted when the doc index contributes to
    # the prompt.
    doc_legend = ""
    if scope.context.mode == Mode.DOC:
        # Doc mode primary: swap the legends so the primary
        # slot carries the doc legend.
        doc_legend_text = service._doc_index.get_legend()
        symbol_legend = doc_legend_text
        # In cross-reference mode, the symbol index's legend
        # becomes the secondary and goes to doc_legend.
        if (
            service._cross_ref_enabled
            and service._symbol_index is not None
        ):
            doc_legend = service._symbol_index.get_legend()
    elif service._cross_ref_enabled:
        # Code mode + cross-ref: symbol legend stays primary;
        # doc legend is secondary.
        doc_legend = service._doc_index.get_legend()

    # File tree — the flat repo listing.
    file_tree = ""
    if service._repo is not None:
        try:
            file_tree = service._repo.get_flat_file_list()
        except Exception as exc:
            logger.warning(
                "Failed to fetch file tree for prompt: %s", exc
            )

    # Delegate to the scope's ContextManager.
    return scope.context.assemble_tiered_messages(
        user_prompt=augmented_prompt,
        images=images if images else None,
        symbol_map=symbol_map,
        symbol_legend=symbol_legend,
        doc_legend=doc_legend,
        file_tree=file_tree,
        tiered_content=tiered_content,
    )


# ---------------------------------------------------------------------------
# Flat assembly — fallback during startup window
# ---------------------------------------------------------------------------


def assemble_messages_flat(
    service: "LLMService",
    user_prompt: str,
    images: list[str],
    scope: "ConversationScope | None" = None,
) -> list[dict[str, Any]]:
    """Build a flat message array for the LLM call.

    Fallback path used when the stability tracker hasn't
    been initialised yet. Produces a system prompt + repo
    context + history + user prompt sequence with no
    cache-control markers.

    Must still include the user's selected-file content,
    the symbol map, the file tree, and URL/review context —
    otherwise an uninitialised tracker produces a context-free
    prompt and the LLM has no view of the repo. Without this,
    the user's selection is silently dropped on every flat-
    mode request.
    """
    if scope is None:
        scope = service._default_scope()

    system_prompt = scope.context.get_system_prompt()

    # Descriptor injection — orchestrator only. Same
    # rationale as in :func:`assemble_tiered` above.
    descriptor = ""
    if scope.context is service._context:
        from ac_dc.llm._agents import build_agent_descriptor
        descriptor = build_agent_descriptor(service)

    reminder = service._config.get_system_reminder()
    descriptor_prefix = (
        descriptor + "\n\n" if descriptor else ""
    )
    augmented_prompt = (
        descriptor_prefix + user_prompt + (reminder or "")
    )

    # Assemble a repo-context block.
    system_parts: list[str] = [system_prompt]

    # Symbol map + legend (mode-aware header).
    if service._symbol_index is not None:
        try:
            legend = service._symbol_index.get_legend()
            symbol_map = service._symbol_index.get_symbol_map(
                exclude_files=set(scope.selected_files)
            )
            if legend or symbol_map:
                from ac_dc.context_manager import (
                    DOC_MAP_HEADER,
                    REPO_MAP_HEADER,
                )
                header = (
                    DOC_MAP_HEADER
                    if scope.context.mode == Mode.DOC
                    else REPO_MAP_HEADER
                )
                system_parts.append(header + legend)
                if symbol_map:
                    system_parts.append(symbol_map)
        except Exception as exc:
            logger.warning(
                "Flat assembly: symbol map fetch failed: %s",
                exc,
            )

    # File tree.
    if service._repo is not None:
        try:
            file_tree = service._repo.get_flat_file_list()
            if file_tree:
                from ac_dc.context_manager import (
                    FILE_TREE_HEADER,
                )
                system_parts.append(
                    FILE_TREE_HEADER + file_tree
                )
        except Exception as exc:
            logger.warning(
                "Flat assembly: file tree fetch failed: %s",
                exc,
            )

    # URL context.
    url_parts = scope.context.get_url_context()
    if url_parts:
        from ac_dc.context_manager import URL_CONTEXT_HEADER
        system_parts.append(
            URL_CONTEXT_HEADER + "\n---\n".join(url_parts)
        )

    # Review context.
    review = scope.context.get_review_context()
    if review:
        from ac_dc.context_manager import REVIEW_CONTEXT_HEADER
        system_parts.append(REVIEW_CONTEXT_HEADER + review)

    # Active files — full content of everything selected.
    file_body = scope.context.file_context.format_for_prompt()
    if file_body:
        from ac_dc.context_manager import FILES_ACTIVE_HEADER
        system_parts.append(FILES_ACTIVE_HEADER + file_body)

    combined_system = "\n\n".join(p for p in system_parts if p)

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": combined_system},
    ]

    # Active history — already includes the user message we
    # just added via add_message. Strip it off before appending
    # so we don't duplicate; we add the current prompt with
    # images as the final message.
    history = scope.context.get_history()
    if history and history[-1].get("role") == "user":
        history = history[:-1]
    messages.extend(history)

    # Current user message — with images attached as content
    # blocks if any.
    if images:
        content_blocks: list[dict[str, Any]] = [
            {"type": "text", "text": augmented_prompt}
        ]
        for uri in images:
            if isinstance(uri, str) and uri.startswith("data:"):
                content_blocks.append({
                    "type": "image_url",
                    "image_url": {"url": uri},
                })
        messages.append(
            {"role": "user", "content": content_blocks}
        )
    else:
        messages.append(
            {"role": "user", "content": augmented_prompt}
        )
    return messages