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

        # Step 4: Measure real token counts.
        measure_tracker_tokens(service)

        # Step 4b: Post-measurement L0 backfill. Placeholder
        # tokens overestimate real block sizes; backfill pulls
        # high-ref-count candidates from L1-L3 into L0 until
        # real tokens reach the target with overshoot headroom.
        promoted = (
            service._stability_tracker.backfill_l0_after_measurement(
                ref_index,
            )
        )
        if promoted > 0:
            logger.info(
                "L0 backfill: promoted %d items to meet "
                "cache-min threshold",
                promoted,
            )

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
    """Add opposite-index items to the active tracker.

    Iterates the non-primary index's files (doc outlines in
    code mode, symbol files in doc mode) and creates tracker
    entries at ACTIVE with N=0. The next ``update_stability``
    cycle promotes them via the standard N-value machinery.

    Selected files are excluded — they carry content via
    ``file:`` entries and the cross-ref entry would be
    redundant. Missing blocks (outline not yet loaded, symbol
    index empty) are skipped silently. Items already tracked
    (from a prior enable or mode switch edge case) are left
    alone to preserve their tier/N state.
    """
    from ac_dc.stability_tracker import Tier, TrackedItem

    tracker = service._stability_tracker
    selected_set = set(service._selected_files)
    affected_tiers: set[Tier] = set()

    if service._context.mode == Mode.CODE:
        # Code mode primary → add doc: entries as secondary.
        for path in list(service._doc_index._all_outlines.keys()):
            if path in selected_set:
                continue
            block = service._doc_index.get_file_doc_block(path)
            if not block:
                continue
            sig_hash = service._doc_index.get_signature_hash(path)
            key = f"doc:{path}"
            if key in tracker._items:
                continue
            tracker._items[key] = TrackedItem(
                key=key,
                tier=Tier.ACTIVE,
                n_value=0,
                content_hash=sig_hash or "",
                tokens=service._counter.count(block),
            )
            affected_tiers.add(Tier.ACTIVE)
    else:
        # Doc mode primary → add symbol: entries as secondary.
        if service._symbol_index is None:
            return
        for path in list(service._symbol_index._all_symbols.keys()):
            if path in selected_set:
                continue
            block = service._symbol_index.get_file_symbol_block(path)
            if not block:
                continue
            sig_hash = service._symbol_index.get_signature_hash(path)
            key = f"symbol:{path}"
            if key in tracker._items:
                continue
            tracker._items[key] = TrackedItem(
                key=key,
                tier=Tier.ACTIVE,
                n_value=0,
                content_hash=sig_hash or "",
                tokens=service._counter.count(block),
            )
            affected_tiers.add(Tier.ACTIVE)

    for tier in affected_tiers:
        tracker._broken_tiers.add(tier)


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