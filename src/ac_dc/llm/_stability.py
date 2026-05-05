"""Stability tracker management — init, update, cross-reference.

Extracted from :mod:`ac_dc.llm_service` to keep that module
focused on the streaming pipeline. Contains:

- :func:`try_initialize_stability` — eager + lazy tracker seed
  from the reference graph. Mode-aware (code → symbol:, doc →
  doc:). Runs L0 backfill after token measurement.
- :func:`measure_tracker_tokens` — replace placeholder tokens
  with real measured counts for symbol: and doc: entries.
- :func:`update_stability` — per-request active items build +
  tracker update. Handles the specs-mandated order of
  operations including defensive excluded-files removal and
  cross-reference item registration.
- :func:`seed_cross_reference_items` — populate the tracker
  with opposite-index items when cross-reference is enabled.
- :func:`remove_cross_reference_items` — strip those items on
  disable / mode switch.

Every function takes the :class:`LLMService` as first argument
and reads/writes attributes on it. Keeping the service module
smaller without changing the state graph's shape.

Governing specs:
:doc:`specs4/3-llm/cache-tiering`,
:doc:`specs4/3-llm/modes`,
:doc:`specs-reference/3-llm/streaming` § Order of Operations.
"""

from __future__ import annotations

import hashlib
import logging
from typing import TYPE_CHECKING, Any

from ac_dc.context_manager import Mode

if TYPE_CHECKING:
    from ac_dc.llm._types import ConversationScope
    from ac_dc.llm_service import LLMService

logger = logging.getLogger("ac_dc.llm_service")


# ---------------------------------------------------------------------------
# Initialization
# ---------------------------------------------------------------------------


def try_initialize_stability(service: "LLMService") -> None:
    """Seed the stability tracker from the reference graph.

    Called eagerly during deferred startup (Phase 2) or lazily
    on the first chat request if eager init failed. Runs
    index_repo on the full file list, builds the reference
    graph, initializes tier assignments (including L0 seeding),
    measures real token counts for all tier items, and seeds
    the system prompt into L0.

    Mode-aware dispatch — in code mode the primary index is
    the symbol index and entries use the ``symbol:`` prefix;
    in doc mode the primary index is the doc index and entries
    use the ``doc:`` prefix. The two paths share the same
    clustering algorithm via ``initialize_with_keys``; the only
    differences are which index contributes the file list and
    which prefix the tracker keys get.

    In doc mode, if the doc index isn't ready yet
    (``_doc_index_ready is False`` — the background build
    hasn't completed), this function bails without setting
    ``_stability_initialized = True``. The next chat request's
    lazy-init retry will try again; once structural extraction
    completes, initialization succeeds on the retry. Users who
    switch to code mode in the interim get normal code-mode
    init on the switch.

    Safe to call multiple times — sets the per-mode initialized
    flag on the first successful run. Subsequent calls for the
    same mode are no-ops; subsequent calls for a DIFFERENT mode
    (after a switch_mode) initialize that mode's tracker fresh.
    """
    mode = service._context.mode
    if service._stability_initialized.get(mode, False):
        return
    if service._repo is None:
        return

    # Mode dispatch — doc mode needs the doc index ready;
    # code mode needs the symbol index attached.
    if mode == Mode.DOC:
        if not service._doc_index_ready:
            # Doc index still building. Skip init; the next
            # request's retry catches it, or a mode switch to
            # code picks up the code-mode path.
            return
    else:
        if service._symbol_index is None:
            return

    try:
        # Step 1: Index the repository. In code mode we re-run
        # the symbol index's incremental pass (cheap thanks to
        # mtime caching). In doc mode, the background build has
        # already indexed every doc file; we don't re-walk.
        file_list_raw = service._repo.get_flat_file_list()
        file_list = [f for f in file_list_raw.split("\n") if f]
        if mode == Mode.CODE:
            assert service._symbol_index is not None
            service._symbol_index.index_repo(file_list)

        # Step 2: Initialize tier assignments from reference
        # graph. Prefix must match the content type.
        cache_target = service._config.cache_target_tokens_for_model()
        service._stability_tracker.set_cache_target_tokens(
            cache_target
        )
        if mode == Mode.DOC:
            indexed_files = list(
                service._doc_index._all_outlines.keys()
            )
            ref_index = service._doc_index._ref_index
            prefix = "doc:"
        else:
            assert service._symbol_index is not None
            indexed_files = [
                path for path in file_list
                if path in service._symbol_index._all_symbols
            ]
            ref_index = service._symbol_index._ref_index
            prefix = "symbol:"

        keys = [f"{prefix}{path}" for path in indexed_files]
        service._stability_tracker.initialize_with_keys(
            ref_index,
            keys=keys,
            files=indexed_files,
            l0_target_tokens=cache_target,
        )

        # Step 3: Seed system prompt into L0.
        if mode == Mode.DOC:
            system_prompt = service._config.get_doc_system_prompt()
        else:
            system_prompt = service._config.get_system_prompt()
        if mode == Mode.DOC:
            legend = service._doc_index.get_legend()
        else:
            assert service._symbol_index is not None
            legend = service._symbol_index.get_legend()
        prompt_hash = hashlib.sha256(
            system_prompt.encode("utf-8")
        ).hexdigest()
        prompt_tokens = service._counter.count(system_prompt + legend)
        service._stability_tracker.register_system_prompt(
            prompt_hash, prompt_tokens
        )

        # Step 4: Measure real token counts. The four-tier
        # even split in :meth:`initialize_with_keys` already
        # placed the most-referenced clusters in L0, so no
        # post-measurement backfill is needed on the init
        # path — the cascade will rebalance as requests come
        # in if placeholder estimates diverged from real
        # token counts.
        measure_tracker_tokens(service)

        service._stability_initialized[mode] = True
        logger.info(
            "Stability tracker initialized (%s mode): %d items",
            mode.value,
            len(service._stability_tracker.get_all_items()),
        )

        service._print_init_hud()

    except Exception as exc:
        logger.warning(
            "Stability tracker initialization failed: %s", exc
        )


def measure_tracker_tokens(service: "LLMService") -> None:
    """Replace placeholder token counts with real measured values.

    Iterates all symbol: and doc: items and replaces their
    placeholder tokens (from ``initialize_with_keys``) with the
    actual token count of the formatted block. Skips items
    whose index isn't attached or whose path doesn't resolve to
    a block — those keep the placeholder, which the next update
    cycle will refresh from the measured active-items data.

    Both prefixes are handled so doc-mode init gets real token
    counts too. A tracker may hold items of both kinds
    simultaneously (cross-reference mode), and each prefix
    dispatches to its own index.
    """
    all_items = service._stability_tracker.get_all_items()
    for key in all_items:
        if key.startswith("symbol:"):
            if service._symbol_index is None:
                continue
            path = key[len("symbol:"):]
            block = service._symbol_index.get_file_symbol_block(path)
            if block:
                tokens = service._counter.count(block)
                service._stability_tracker.measure_tokens(key, tokens)
        elif key.startswith("doc:"):
            path = key[len("doc:"):]
            block = service._doc_index.get_file_doc_block(path)
            if block:
                tokens = service._counter.count(block)
                service._stability_tracker.measure_tokens(key, tokens)


# ---------------------------------------------------------------------------
# Per-request update
# ---------------------------------------------------------------------------


def update_stability(
    service: "LLMService",
    scope: "ConversationScope | None" = None,
) -> None:
    """Build active items and run the tracker update.

    Full implementation per specs4/3-llm/streaming.md —
    _update_stability pseudocode. Builds the active-items dict
    from all content categories (system prompt, selected files,
    index entries for non-selected files, cross-reference
    items, history messages), removes user-excluded items, and
    runs the tracker update with the current repo file set for
    stale-removal.

    Order of operations per specs-reference/3-llm/streaming.md:

    0a. Defensive excluded-files removal from the tracker.
    0b. System prompt + legend — always present, stabilizes to
        L0. Hash only the prompt text (not legend) for stability.
    1. Selected files — full content hash.
    2. Remove symbol/doc entries for selected files (full
       content present → index block redundant).
    3. Primary index entries for ALL indexed files NOT in
       selected files AND NOT excluded.
    4. Cross-reference items (opposite index) when cross-ref on.
    5. History messages.
    6. Run tracker.update().
    """
    if scope is None:
        scope = service._default_scope()

    # Step 0a — defensive excluded-files removal.
    excluded = getattr(service, "_excluded_index_files", None) or ()
    for path in excluded:
        for prefix in ("symbol:", "doc:", "file:"):
            entry_key = prefix + path
            existing = scope.tracker._items.get(entry_key)
            if existing is not None:
                scope.tracker._broken_tiers.add(existing.tier)
                scope.tracker._items.pop(entry_key, None)

    active_items: dict[str, dict[str, Any]] = {}

    # Step 0b — System prompt + legend.
    if scope.context.mode == Mode.DOC:
        system_prompt = service._config.get_doc_system_prompt()
    else:
        system_prompt = service._config.get_system_prompt()
    if system_prompt:
        legend = ""
        if service._symbol_index is not None:
            try:
                legend = service._symbol_index.get_legend()
            except Exception:
                pass
        system_content = system_prompt + legend
        prompt_hash = hashlib.sha256(
            system_prompt.encode("utf-8")
        ).hexdigest()
        active_items["system:prompt"] = {
            "hash": prompt_hash,
            "tokens": service._counter.count(system_content),
        }

    # Step 1 — Selected files: full content hash.
    for path in scope.selected_files:
        content = scope.context.file_context.get_content(path)
        if content:
            h = hashlib.sha256(
                content.encode("utf-8")
            ).hexdigest()
            active_items[f"file:{path}"] = {
                "hash": h,
                "tokens": service._counter.count(content),
            }

    # Step 2 — Remove symbol/doc entries for selected files.
    for path in scope.selected_files:
        for prefix in ("symbol:", "doc:"):
            entry_key = prefix + path
            if scope.tracker.has_item(entry_key):
                all_items = scope.tracker.get_all_items()
                item = all_items.get(entry_key)
                if item is not None:
                    tier = item.tier
                    scope.tracker._items.pop(entry_key, None)
                    scope.tracker._broken_tiers.add(tier)

    # Step 3 — Primary index entries for non-selected,
    # non-excluded files.
    selected_set = set(scope.selected_files)
    excluded_set = set(excluded)
    if scope.context.mode == Mode.DOC:
        for path in list(service._doc_index._all_outlines.keys()):
            if path in selected_set or path in excluded_set:
                continue
            block = service._doc_index.get_file_doc_block(path)
            if not block:
                continue
            sig_hash = service._doc_index.get_signature_hash(path)
            active_items[f"doc:{path}"] = {
                "hash": sig_hash or hashlib.sha256(
                    block.encode("utf-8")
                ).hexdigest(),
                "tokens": service._counter.count(block),
            }
    else:
        if service._symbol_index is not None:
            for path in list(service._symbol_index._all_symbols.keys()):
                if path in selected_set or path in excluded_set:
                    continue
                block = service._symbol_index.get_file_symbol_block(path)
                if not block:
                    continue
                sig_hash = service._symbol_index.get_signature_hash(path)
                active_items[f"symbol:{path}"] = {
                    "hash": sig_hash or hashlib.sha256(
                        block.encode("utf-8")
                    ).hexdigest(),
                    "tokens": service._counter.count(block),
                }

    # Step 4 — Cross-reference items when enabled.
    if service._cross_ref_enabled:
        if scope.context.mode == Mode.CODE:
            # Add doc: entries as secondary.
            for path in list(service._doc_index._all_outlines.keys()):
                if path in selected_set or path in excluded_set:
                    continue
                block = service._doc_index.get_file_doc_block(path)
                if not block:
                    continue
                sig_hash = service._doc_index.get_signature_hash(path)
                active_items[f"doc:{path}"] = {
                    "hash": sig_hash or hashlib.sha256(
                        block.encode("utf-8")
                    ).hexdigest(),
                    "tokens": service._counter.count(block),
                }
        else:
            # Doc mode + cross-ref: add symbol: as secondary.
            if service._symbol_index is not None:
                for path in list(
                    service._symbol_index._all_symbols.keys()
                ):
                    if path in selected_set or path in excluded_set:
                        continue
                    block = service._symbol_index.get_file_symbol_block(
                        path
                    )
                    if not block:
                        continue
                    sig_hash = service._symbol_index.get_signature_hash(
                        path
                    )
                    active_items[f"symbol:{path}"] = {
                        "hash": sig_hash or hashlib.sha256(
                            block.encode("utf-8")
                        ).hexdigest(),
                        "tokens": service._counter.count(block),
                    }

    # Step 5 — History messages.
    history = scope.context.get_history()
    for i, msg in enumerate(history):
        role = msg.get("role", "user")
        content = msg.get("content", "") or ""
        if not isinstance(content, str):
            content = str(content)
        h = hashlib.sha256(
            f"{role}:{content}".encode("utf-8")
        ).hexdigest()
        active_items[f"history:{i}"] = {
            "hash": h,
            "tokens": service._counter.count(msg),
        }

    # Step 6 — Run tracker update.
    existing_files: set[str] | None = None
    if service._repo is not None:
        try:
            flat = service._repo.get_flat_file_list()
            existing_files = (
                set(flat.split("\n")) if flat else set()
            )
        except Exception:
            pass
    scope.tracker.update(
        active_items, existing_files=existing_files
    )


# ---------------------------------------------------------------------------
# Cross-reference item management
# ---------------------------------------------------------------------------


def seed_cross_reference_items(service: "LLMService") -> None:
    """Distribute opposite-index items across L0/L1/L2/L3 on enable.

    Runs the same reference-graph clustering the primary index
    uses at startup, scoped to the opposite index. Cross-ref
    items land across L1/L2/L3 via clustering, then the most-
    connected ones promote into L0 via the post-measurement
    backfill — so the provider cache absorbs them on the next
    request rather than ingesting the whole opposite index as
    a single uncached block.

    L0 promotion follows the same "most-connected lives
    longest" intent as primary-index seeding. Primary-index
    items already in L0 are never evicted: the backfill
    method only considers candidates currently in L1/L2/L3.

    The earlier implementation seeded every cross-ref item at
    ACTIVE with N=0, which meant turning cross-ref on produced
    a single massive active-context block. That block would
    only shrink as individual items cycled through many
    update_stability calls (one N-increment per turn) before
    graduating to L3 and slowly promoting upward — effectively
    never reaching a stable distribution for a repo of any
    size.

    Selected files are excluded — they carry content via
    ``file:`` entries and the cross-ref entry would be
    redundant. Missing blocks (outline not yet loaded, symbol
    index empty) are skipped. Items already tracked
    (``symbol:*`` in code mode, ``doc:*`` in doc mode, or
    leftover cross-ref entries from a prior enable) are left
    alone — the new
    :meth:`StabilityTracker.distribute_keys_by_clustering`
    method skips any key already in the tracker.

    Real token counts replace placeholders immediately via
    :meth:`measure_tracker_tokens` so the next cascade has
    accurate numbers for the anchor / cap / underfill logic.
    """
    tracker = service._stability_tracker
    selected_set = set(service._selected_files)
    excluded_set = set(
        getattr(service, "_excluded_index_files", None) or ()
    )

    if service._context.mode == Mode.CODE:
        # Code mode primary → doc: entries as secondary.
        ref_index = service._doc_index._ref_index
        candidate_paths = [
            path
            for path in service._doc_index._all_outlines.keys()
            if path not in selected_set
            and path not in excluded_set
            and service._doc_index.get_file_doc_block(path)
        ]
        keys = [f"doc:{path}" for path in candidate_paths]
    else:
        # Doc mode primary → symbol: entries as secondary.
        if service._symbol_index is None:
            return
        ref_index = service._symbol_index._ref_index
        candidate_paths = [
            path
            for path in service._symbol_index._all_symbols.keys()
            if path not in selected_set
            and path not in excluded_set
            and service._symbol_index.get_file_symbol_block(path)
        ]
        keys = [f"symbol:{path}" for path in candidate_paths]

    if not candidate_paths:
        return

    # Snapshot the tracker's key set BEFORE distribution so we
    # can determine which keys were actually newly added by
    # this pass. distribute_keys_by_clustering skips keys that
    # are already tracked — so the ``keys`` input list may be
    # a superset of what actually got added. We need the
    # strict subset (additions only) for the backfill's
    # candidate restriction below.
    keys_before = set(tracker._items.keys())

    tracker.distribute_keys_by_clustering(
        ref_index,
        keys=keys,
        files=candidate_paths,
    )

    # Replace placeholder tokens with real measured counts so
    # the next cascade's anchor / cap / underfill decisions
    # are based on accurate sizes.
    measure_tracker_tokens(service)

    # Promote the most-connected cross-ref items into L0
    # until the L0 token total reaches the cache-target
    # overshoot threshold. Mirrors what the primary index's
    # init path does: post-measurement, real token counts
    # almost always come in well under the placeholder
    # estimate, which leaves L0 underfilled. The backfill
    # pass brings L0 up to ~1.5x the cache target so the
    # provider actually caches it. See
    # :meth:`StabilityTracker.backfill_l0_after_measurement`.
    #
    # Restrict candidates to the keys actually added by the
    # distribution pass above — NOT every key in the input
    # list. An item in the input list that was already
    # tracked (pre-existing cross-ref entry from a prior
    # enable, or a primary-index item under the same key)
    # was deliberately skipped by
    # distribute_keys_by_clustering to preserve its state;
    # including it here would let the backfill promote it to
    # L0 as a side effect of toggling cross-ref on, undoing
    # the preservation.
    #
    # L0 items from the primary index are safe regardless
    # (the backfill's tier filter already excludes L0
    # candidates), but L1/L2/L3 pre-existing items need the
    # explicit "newly-added only" restriction to stay put.
    newly_added_keys = set(tracker._items.keys()) - keys_before
    if newly_added_keys:
        tracker.backfill_l0_after_measurement(
            ref_index,
            candidate_keys=newly_added_keys,
        )


def remove_cross_reference_items(service: "LLMService") -> None:
    """Strip opposite-index items from the active tracker.

    Called when cross-reference is disabled (explicitly or via
    mode switch reset). Walks the tracker and removes every
    entry whose prefix is the OPPOSITE of the current mode's
    primary — ``doc:*`` in code mode, ``symbol:*`` in doc mode.

    Selected files' ``file:`` entries are always preserved
    regardless of mode — they're primary content, not
    cross-reference data. Same for ``system:``, ``url:``, and
    ``history:`` entries.

    Marks every tier that held removed items as broken so the
    next cascade rebalances cleanly.
    """
    from ac_dc.stability_tracker import Tier

    tracker = service._stability_tracker
    if service._context.mode == Mode.CODE:
        target_prefix = "doc:"
    else:
        target_prefix = "symbol:"

    to_remove: list[str] = []
    affected_tiers: set[Tier] = set()
    all_items = tracker.get_all_items()
    for key, item in all_items.items():
        if key.startswith(target_prefix):
            to_remove.append(key)
            affected_tiers.add(item.tier)

    for key in to_remove:
        tracker._items.pop(key, None)

    for tier in affected_tiers:
        tracker._broken_tiers.add(tier)