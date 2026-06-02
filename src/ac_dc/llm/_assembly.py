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
from ac_dc.llm._stability import _excluded_set, _indexed_paths_in_dir

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

    - ``symbols`` — concatenated dir-block bodies (symbols
      and docs blocks for directories assigned to this tier)
    - ``plain_files`` — concatenated plain-files blocks for
      directories whose files have no symbol/doc index
    - ``files`` — concatenated fenced file contents for
      ``file:`` items in this tier
    - ``history`` — history message dicts graduated to this
      tier (in original index order)
    - ``graduated_files`` — file paths whose full content is
      in this tier (used for active-files exclusion)
    - ``graduated_history_indices`` — history message indices
      in this tier (used for active-history exclusion)

    Key-prefix dispatch (D36):

    - ``symbols:{dir}`` — per-directory symbols block
      rendered live from the symbol index, excluding any
      file in Active full-text
    - ``docs:{dir}`` — per-directory docs block rendered
      live from the doc index, excluding any file in Active
      full-text
    - ``plain_files:{dir}`` — per-directory listing of
      filenames that have neither a symbol table nor a doc
      index
    - ``file:{path}`` — full file content as a fenced block
    - ``history:{N}`` — history message at index N
    - ``url:*`` — skipped (URL tier entry is deferred)

    Defensive filters skip:

    - ``file:`` entries for paths the user has excluded
      (tracker cleanup drops them on the next update cycle;
      this is a belt-and-suspenders guard for mid-cycle).
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
            "plain_files": "",
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
    tier_plain_files_fragments: dict[str, list[str]] = {
        t: [] for t in ("L0", "L1", "L2", "L3")
    }
    tier_file_fragments: dict[str, list[str]] = {
        t: [] for t in ("L0", "L1", "L2", "L3")
    }
    tier_history_entries: dict[
        str, list[tuple[int, dict[str, Any]]]
    ] = {t: [] for t in ("L0", "L1", "L2", "L3")}

    # Every dir-block's RENDERED bytes must be byte-identical
    # to the listing that ``_dir_block_active_items`` HASHES.
    # The provider caches the rendered bytes; the tracker
    # decides "did this block change?" from the hash. If the
    # two disagree for a fixed tracker state, the tracker
    # sees no change (no teleport, no tier reshuffle) while
    # the cached prefix silently drifts between turns — and
    # every cache warm-up plus roughly every other real turn
    # pays a full cold cache write at 0% hit. Aligning the
    # exclude sets below is the fix for that drift.
    #
    # ``_dir_block_active_items`` uses exactly:
    #   - symbols:/docs: → exclude_active = files loaded in
    #     Active (``file_context.get_files()``).
    #   - plain_files:   → subtract Active-loaded files, the
    #     index-covered set, AND the user-exclusion set.
    #
    # We reproduce those exact terms here. Note ``selected_set``
    # / ``active_excluded`` (picker selection ∪ user
    # exclusions) is NOT what the hash uses for symbols/docs —
    # using it would strip binary-deselected or user-excluded
    # files from the rendered block while the hash kept them.
    # ``excluded_set`` is retained only for the ``file:``
    # belt-and-suspenders skip further down.
    selected_set = set(scope.selected_files)
    excluded_set = set(
        getattr(service, "_excluded_index_files", [])
    )
    active_excluded = selected_set | excluded_set
    plain_files_active = set(
        scope.context.file_context.get_files()
    )
    plain_files_user_excluded = _excluded_set(service)

    for key in sorted(all_items.keys()):
        item = all_items[key]
        tier_name = getattr(
            item.tier, "value", str(item.tier)
        )
        if tier_name not in ("L0", "L1", "L2", "L3"):
            continue

        if key.startswith("symbols:"):
            directory = key[len("symbols:"):]
            if service._symbol_index is None:
                continue
            # exclude_active MUST be the same set the hash
            # uses — _dir_block_active_items hashes the block
            # with exclude_active = file_context.get_files()
            # (files actually loaded in Active), NOT the
            # picker's selected ∪ excluded union. Passing the
            # union here would strip binary-deselected and
            # user-excluded files from the rendered bytes
            # while the hash kept them, drifting the cached
            # prefix between turns and forcing cold cache
            # writes (same failure mode as the plain_files
            # block).
            block = service._symbol_index.get_dir_symbols_block(
                directory, exclude_active=plain_files_active
            )
            if block:
                tier_symbol_fragments[tier_name].append(block)
        elif key.startswith("docs:"):
            directory = key[len("docs:"):]
            if service._doc_index is None:
                continue
            # Same exclude-set rule as the symbols branch:
            # match _dir_block_active_items, which hashes
            # docs blocks with exclude_active =
            # file_context.get_files().
            block = service._doc_index.get_dir_docs_block(
                directory, exclude_active=plain_files_active
            )
            if block:
                tier_symbol_fragments[tier_name].append(block)
        elif key.startswith("plain_files:"):
            directory = key[len("plain_files:"):]
            if service._repo is None:
                continue
            try:
                by_dir = service._repo.get_files_by_directory()
            except Exception as exc:
                logger.debug(
                    "Tier content for %s skipped: "
                    "get_files_by_directory failed: %s",
                    key,
                    exc,
                )
                continue
            # MUST render byte-identical to the listing that
            # _dir_block_active_items hashes — same sort, same
            # subtractions. The tracker compares the SORTED,
            # index-subtracted, user-excluded listing; if the
            # rendered prompt bytes differ from that (e.g.
            # unsorted git-ls-files order, or covered files
            # left in), the tracker sees no change (hash
            # stable, no teleport) while the cached prefix
            # bytes silently drift between turns — every
            # cache warm-up and roughly every other real turn
            # then pays a full cold cache write at 0% hit.
            # The set subtracted here (active_excluded) already
            # folds in selected + user-excluded files; covered
            # (index-surfaced) files are subtracted explicitly
            # to match the hash's `not in covered` clause.
            covered = _indexed_paths_in_dir(service, directory)
            files_in_dir = sorted(
                f for f in by_dir.get(directory, [])
                if f not in plain_files_active
                and f not in covered
                and f not in plain_files_user_excluded
            )
            if files_in_dir:
                tier_plain_files_fragments[tier_name].append(
                    "\n".join(files_in_dir)
                )
        elif key.startswith("file:"):
            path = key[len("file:"):]
            if path in excluded_set:
                logger.debug(
                    "Tier content: skipping %s (excluded from "
                    "index by user); tracker entry will be "
                    "cleaned up on next update cycle",
                    key,
                )
                continue
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
        # url:* — intentionally skipped (URL tier entry is
        # deferred).

    # Finalise each tier. Symbols, plain_files and files join
    # with blank lines between fragments. History is sorted
    # by original index so multi-message tier content reads
    # in conversation order.
    for tier_name in ("L0", "L1", "L2", "L3"):
        result[tier_name]["symbols"] = "\n\n".join(
            tier_symbol_fragments[tier_name]
        )
        result[tier_name]["plain_files"] = "\n\n".join(
            tier_plain_files_fragments[tier_name]
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
    *,
    skip_active: bool = False,
) -> list[dict[str, Any]]:
    """Build the tiered message array.

    Renders the index legends live from the live indexes
    (D36: there is no L0 snapshot — dir-block content is
    rendered fresh per turn from each tier's tracker keys).
    The system prompt + legend(s) form the L0 system
    message and sit before L0 as the only non-flux head
    anchor.

    System reminder is appended to the user prompt so the
    tier assembler doesn't need to know about it.

    Legend routing per specs4/3-llm/modes.md and
    specs4/3-llm/prompt-assembly.md:

    - Doc mode primary: doc legend flows to the primary slot
      (``symbol_legend`` kwarg). The context manager's
      assembler picks ``DOC_MAP_HEADER`` based on
      ``scope.context.mode``.
    - Code mode + cross-reference: doc is the secondary;
      assembler places it under ``DOC_MAP_HEADER``.
    - Code mode without cross-ref: doc legend suppressed.

    ``skip_active`` is the cache-warmer's optimisation: when
    True, the Active tier (selected files + active history)
    is omitted from the assembled prompt. The cached prefix
    bytes (everything up to and including the last
    ``cache_control`` marker on L3) are identical to a real
    turn, so cache hits land normally; the post-cache tail
    shrinks to just the user prompt. Saves Active-tier
    input tokens on every warm-up. See
    :doc:`specs4/3-llm/cache-tiering` § Cache Warmer.
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

    # Index legends — rendered live from the live indexes.
    # Under D36 there is no L0 snapshot. The system prompt
    # sits before L0 as the only non-flux head anchor; its
    # stability is enforced structurally (it changes only at
    # the documented invalidation events — see
    # ``specs4/3-llm/cache-tiering.md``).
    primary_legend = ""
    secondary_legend = ""
    if scope.context.mode == Mode.DOC:
        if service._doc_index is not None:
            primary_legend = service._doc_index.get_legend()
        if service._cross_ref_enabled and service._symbol_index is not None:
            secondary_legend = service._symbol_index.get_legend()
    else:
        if service._symbol_index is not None:
            primary_legend = service._symbol_index.get_legend()
        if service._cross_ref_enabled and service._doc_index is not None:
            secondary_legend = service._doc_index.get_legend()

    # Delegate to the scope's ContextManager.
    return scope.context.assemble_tiered_messages(
        user_prompt=augmented_prompt,
        images=images if images else None,
        symbol_legend=primary_legend,
        doc_legend=secondary_legend,
        tiered_content=tiered_content,
        skip_active=skip_active,
    )


# ---------------------------------------------------------------------------
# Flat assembly — fallback during startup window
# ---------------------------------------------------------------------------


def assemble_messages_flat(
    service: "LLMService",
    user_prompt: str,
    images: list[str],
    scope: "ConversationScope | None" = None,
    *,
    skip_active: bool = False,
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

    ``skip_active`` is the cache-warmer's optimisation. In
    flat mode there are no cache-control markers anyway, so
    the savings are smaller, but we still skip the active
    files and active history (everything except the system
    prompt and the ping) to keep warm-up cost minimal. The
    flat path is only taken before the stability tracker
    initialises — a narrow window — so this matters less
    than the tiered case.
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

    # Assemble a repo-context block. Index legends are
    # rendered live from the live indexes — under D36 there
    # is no L0 snapshot. The legends sit on the system
    # message; per-directory dir-blocks are not surfaced in
    # the flat path (they're tracker-driven and only matter
    # once the tracker initialises and the tiered path
    # takes over).
    system_parts: list[str] = [system_prompt]

    from ac_dc.context_manager import (
        DOC_MAP_HEADER,
        REPO_MAP_HEADER,
    )

    # Primary legend — mode-aware header selection.
    if scope.context.mode == Mode.DOC:
        primary_legend = (
            service._doc_index.get_legend()
            if service._doc_index is not None else ""
        )
        primary_header = DOC_MAP_HEADER
    else:
        primary_legend = (
            service._symbol_index.get_legend()
            if service._symbol_index is not None else ""
        )
        primary_header = REPO_MAP_HEADER
    if primary_legend:
        system_parts.append(primary_header + primary_legend)

    # Secondary legend — cross-reference only, opposite-mode
    # header.
    if service._cross_ref_enabled:
        if scope.context.mode == Mode.DOC:
            secondary_legend = (
                service._symbol_index.get_legend()
                if service._symbol_index is not None else ""
            )
            secondary_header = REPO_MAP_HEADER
        else:
            secondary_legend = (
                service._doc_index.get_legend()
                if service._doc_index is not None else ""
            )
            secondary_header = DOC_MAP_HEADER
        if secondary_legend:
            system_parts.append(secondary_header + secondary_legend)

    # URL context, review context. Skipped for warm-ups
    # alongside Active files / history: a warm-up only needs
    # the system prompt and the ping tail. Everything else
    # is wasted input on every firing.
    if not skip_active:
        url_parts = scope.context.get_url_context()
        if url_parts:
            from ac_dc.context_manager import URL_CONTEXT_HEADER
            system_parts.append(
                URL_CONTEXT_HEADER + "\n---\n".join(url_parts)
            )

        review = scope.context.get_review_context()
        if review:
            from ac_dc.context_manager import REVIEW_CONTEXT_HEADER
            system_parts.append(REVIEW_CONTEXT_HEADER + review)

    # Active files — full content of everything selected.
    # Skipped for warm-up calls: a warm-up only needs the
    # system prompt and the tail ping; active files would
    # be billed as fresh input on every firing.
    if not skip_active:
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
    # images as the final message. Skipped for warm-up calls.
    if not skip_active:
        history = scope.context.get_history()
        if history and history[-1].get("role") == "user":
            history = history[:-1]
        # Sanitise replayed history — Bedrock rejects blank
        # text blocks in multimodal messages, which can occur
        # when a past turn was an image-only submission. See
        # ContextManager._sanitise_message_text_blocks.
        for msg in history:
            messages.append(
                scope.context._sanitise_message_text_blocks(
                    dict(msg)
                )
            )

    # Current user message — with images attached as content
    # blocks if any. Sanitise the text block so Bedrock
    # accepts image-only turns (empty user_prompt + images).
    if images:
        from ac_dc.context_manager import _sanitise_text_block
        content_blocks: list[dict[str, Any]] = [
            {
                "type": "text",
                "text": _sanitise_text_block(augmented_prompt),
            }
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