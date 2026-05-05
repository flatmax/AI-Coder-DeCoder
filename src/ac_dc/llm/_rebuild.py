"""Manual cache rebuild — the ``rebuild_cache`` pipeline.

Extracted from :mod:`ac_dc.llm_service` to keep that module
focused on the streaming pipeline. User-initiated via the
cache viewer's Rebuild button; wipes all non-history tracker
entries and redistributes tier assignments from scratch.

Governing spec: :doc:`specs-reference/3-llm/cache-tiering`
§ Manual Cache Rebuild.
"""

from __future__ import annotations

import hashlib
import logging
from typing import TYPE_CHECKING, Any

from ac_dc.context_manager import Mode
from ac_dc.llm._types import _TIER_CONFIG_LOOKUP

if TYPE_CHECKING:
    from ac_dc.llm_service import LLMService

logger = logging.getLogger("ac_dc.llm_service")


# ---------------------------------------------------------------------------
# Public RPC entry
# ---------------------------------------------------------------------------


def rebuild_cache(service: "LLMService") -> dict[str, Any]:
    """Wipe and redistribute all tier assignments from scratch.

    See :meth:`LLMService.rebuild_cache` for the full
    sequence documentation. This function wraps the impl in
    the localhost gate and a catch-all error handler so a
    rebuild bug surfaces as an RPC error dict rather than
    crashing the event loop.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted

    if service._symbol_index is None or service._repo is None:
        return {
            "error": (
                "Cache rebuild requires a repository and "
                "symbol index"
            )
        }

    # Call through the service's method so tests can
    # monkey-patch _rebuild_cache_impl without needing to
    # know about this module. The method delegates back to
    # rebuild_cache_impl in normal operation.
    try:
        return service._rebuild_cache_impl()
    except Exception as exc:
        logger.exception("Cache rebuild failed: %s", exc)
        return {"error": f"Cache rebuild failed: {exc}"}


# ---------------------------------------------------------------------------
# The rebuild pipeline
# ---------------------------------------------------------------------------


def rebuild_cache_impl(service: "LLMService") -> dict[str, Any]:
    """The actual rebuild pipeline.

    Twelve steps per specs-reference/3-llm/cache-tiering.md
    § Manual Cache Rebuild. See :meth:`LLMService.rebuild_cache`
    for step-by-step rationale — preserved there so the RPC
    docstring remains authoritative.
    """
    from ac_dc.stability_tracker import Tier, TrackedItem

    assert service._symbol_index is not None
    assert service._repo is not None

    tracker = service._stability_tracker
    mode = service._context.mode

    items_before = len(tracker.get_all_items())

    # Step 1-2: preserve history, wipe everything else.
    history_items = {
        key: item
        for key, item in tracker.get_all_items().items()
        if key.startswith("history:")
    }
    tracker._items.clear()
    for key, item in history_items.items():
        tracker._items[key] = item

    # Step 3: mark all tiers broken.
    tracker._broken_tiers = {
        Tier.L0, Tier.L1, Tier.L2, Tier.L3, Tier.ACTIVE,
    }
    tracker._changes = []

    # Step 4: load content for all selected files into
    # the file context.
    for path in service._selected_files:
        if not service._file_context.has_file(path):
            try:
                service._file_context.add_file(path)
            except Exception as exc:
                logger.debug(
                    "Could not load %s during rebuild: %s",
                    path, exc,
                )

    # Step 5: re-initialize from the reference graph.
    ref_index = service._symbol_index._ref_index
    file_list_raw = service._repo.get_flat_file_list()
    file_list = [f for f in file_list_raw.split("\n") if f]
    cache_target = service._config.cache_target_tokens_for_model()
    tracker.set_cache_target_tokens(cache_target)

    if mode == Mode.DOC:
        prefix = "doc:"
        indexed_files: list[str] = list(
            service._doc_index._all_outlines.keys()
        )
    else:
        prefix = "symbol:"
        indexed_files = [
            path for path in file_list
            if path in service._symbol_index._all_symbols
        ]
    keys = [f"{prefix}{path}" for path in indexed_files]
    tracker.initialize_with_keys(
        ref_index,
        keys=keys,
        files=indexed_files,
        l0_target_tokens=cache_target,
    )

    # Step 5b: cross-reference secondary index.
    if service._cross_ref_enabled:
        if mode == Mode.DOC:
            secondary_prefix = "symbol:"
            secondary_files = [
                p for p in file_list
                if p in service._symbol_index._all_symbols
            ]
            secondary_ref = service._symbol_index._ref_index
        else:
            secondary_prefix = "doc:"
            secondary_files = list(
                service._doc_index._all_outlines.keys()
            )
            secondary_ref = service._doc_index._ref_index
        secondary_keys = [
            f"{secondary_prefix}{p}" for p in secondary_files
        ]
        if secondary_keys:
            tracker.initialize_with_keys(
                secondary_ref,
                keys=secondary_keys,
                files=secondary_files,
                l0_target_tokens=0,
            )

    # Step 6: measure real token counts.
    service._measure_tracker_tokens()

    # Step 6b: post-measurement L0 backfill.
    promoted = tracker.backfill_l0_after_measurement(ref_index)
    if promoted > 0:
        logger.info(
            "Rebuild L0 backfill: promoted %d items to meet "
            "cache-min threshold",
            promoted,
        )

    # Step 7: swap selected files → file: entries at the
    # same tier; strip cross-reference secondary entries too.
    if prefix == "symbol:":
        secondary_prefix = "doc:"
    else:
        secondary_prefix = "symbol:"
    selected_set = set(service._selected_files)
    swapped_paths: set[str] = set()
    for path in list(selected_set):
        index_key = f"{prefix}{path}"
        existing = tracker._items.get(index_key)
        if existing is None:
            continue
        content = service._file_context.get_content(path)
        if content is None:
            continue
        file_hash = hashlib.sha256(
            content.encode("utf-8")
        ).hexdigest()
        file_tokens = service._counter.count(content)
        tracker._items.pop(index_key, None)
        secondary_key = f"{secondary_prefix}{path}"
        secondary_existing = tracker._items.pop(secondary_key, None)
        if secondary_existing is not None:
            tracker._broken_tiers.add(secondary_existing.tier)
        tracker._items[f"file:{path}"] = TrackedItem(
            key=f"file:{path}",
            tier=existing.tier,
            n_value=existing.n_value,
            content_hash=file_hash,
            tokens=file_tokens,
        )
        swapped_paths.add(path)

    # Step 8: distribute orphan selected files.
    orphan_paths = [
        path for path in service._selected_files
        if path not in swapped_paths
        and service._file_context.has_file(path)
    ]
    if orphan_paths:
        distribute_orphan_files(service, orphan_paths)

    # Step 9: re-seed system prompt into L0.
    if mode == Mode.DOC:
        system_prompt = service._config.get_doc_system_prompt()
    else:
        system_prompt = service._config.get_system_prompt()
    if system_prompt:
        legend = service._symbol_index.get_legend()
        prompt_hash = hashlib.sha256(
            system_prompt.encode("utf-8")
        ).hexdigest()
        prompt_tokens = service._counter.count(system_prompt + legend)
        tracker.register_system_prompt(prompt_hash, prompt_tokens)

    # Step 10: re-seed cross-reference items if active.
    # No-op today; the flag is preserved so a future rebuild
    # while cross-ref is on does the right thing once the
    # full cross-reference placement story is wired.

    # Step 11: graduate history via piggyback.
    rebuild_graduate_history(service, cache_target)

    # Step 12: mark initialized for the current mode.
    service._stability_initialized[mode] = True

    # Assemble the result dict.
    items_after = len(tracker.get_all_items())
    all_items = tracker.get_all_items()
    tier_counts: dict[str, int] = {
        t.value: 0 for t in (
            Tier.L0, Tier.L1, Tier.L2, Tier.L3, Tier.ACTIVE
        )
    }
    file_tier_counts: dict[str, int] = {
        t.value: 0 for t in (
            Tier.L0, Tier.L1, Tier.L2, Tier.L3, Tier.ACTIVE
        )
    }
    for item in all_items.values():
        tier_counts[item.tier.value] += 1
        if item.key.startswith("file:"):
            file_tier_counts[item.tier.value] += 1

    files_distributed = sum(file_tier_counts.values())

    tier_summary = " ".join(
        f"{name}={count}"
        for name, count in tier_counts.items()
        if count > 0
    )
    message = (
        f"Cache rebuild ({mode.value}): "
        f"{items_before} → {items_after} items | {tier_summary}"
    )

    logger.info(message)

    return {
        "status": "rebuilt",
        "mode": mode.value,
        "items_before": items_before,
        "items_after": items_after,
        "files_distributed": files_distributed,
        "tier_counts": tier_counts,
        "file_tier_counts": file_tier_counts,
        "message": message,
    }


# ---------------------------------------------------------------------------
# Orphan file distribution
# ---------------------------------------------------------------------------


def distribute_orphan_files(
    service: "LLMService",
    orphan_paths: list[str],
) -> None:
    """Bin-pack orphan selected files across L1/L2/L3.

    Called by rebuild for files that are selected but aren't
    in the primary index (non-source files — ``.md``,
    ``.json``, images, etc.). Without this they'd land in
    ACTIVE on the next update pass.

    Greedy bin-pack by current tier token count: each orphan
    placed in whichever of L1/L2/L3 currently holds the
    fewest tokens. L0 is excluded — L0 must be earned via
    promotion or explicit seeding.
    """
    from ac_dc.stability_tracker import Tier, TrackedItem

    tracker = service._stability_tracker
    target_tiers = (Tier.L1, Tier.L2, Tier.L3)

    tier_tokens: dict[Tier, int] = {t: 0 for t in target_tiers}
    for item in tracker.get_all_items().values():
        if item.tier in tier_tokens:
            tier_tokens[item.tier] += item.tokens

    orphans_with_tokens: list[tuple[str, int, str]] = []
    for path in orphan_paths:
        content = service._file_context.get_content(path)
        if content is None:
            continue
        tokens = service._counter.count(content)
        file_hash = hashlib.sha256(
            content.encode("utf-8")
        ).hexdigest()
        orphans_with_tokens.append((path, tokens, file_hash))
    orphans_with_tokens.sort(key=lambda x: (-x[1], x[0]))

    for path, tokens, file_hash in orphans_with_tokens:
        target_tier = min(
            target_tiers,
            key=lambda t: (tier_tokens[t], t.value),
        )
        entry_n = _TIER_CONFIG_LOOKUP[target_tier]["entry_n"]
        tracker._items[f"file:{path}"] = TrackedItem(
            key=f"file:{path}",
            tier=target_tier,
            n_value=entry_n,
            content_hash=file_hash,
            tokens=tokens,
        )
        tier_tokens[target_tier] += tokens


# ---------------------------------------------------------------------------
# History graduation (step 11 of rebuild)
# ---------------------------------------------------------------------------


def rebuild_graduate_history(
    service: "LLMService",
    cache_target_tokens: int,
) -> None:
    """Graduate older history to L3, keeping a verbatim window.

    Walks history messages newest → oldest, accumulating
    tokens until the next message would exceed
    ``cache_target_tokens``. Everything newer stays in ACTIVE
    as the verbatim window; everything older graduates to L3
    with that tier's entry_n.

    No-op when ``cache_target_tokens == 0`` — history stays
    in ACTIVE permanently per the cache-target=0 contract.
    """
    from ac_dc.stability_tracker import Tier

    if cache_target_tokens <= 0:
        return

    tracker = service._stability_tracker
    history_len = len(service._context.get_history())
    if history_len == 0:
        return

    accumulated = 0
    verbatim_start = 0
    for idx in range(history_len - 1, -1, -1):
        key = f"history:{idx}"
        item = tracker._items.get(key)
        if item is None:
            continue
        if accumulated + item.tokens > cache_target_tokens:
            verbatim_start = idx + 1
            break
        accumulated += item.tokens
    else:
        return

    l3_entry_n = _TIER_CONFIG_LOOKUP[Tier.L3]["entry_n"]
    for idx in range(verbatim_start):
        key = f"history:{idx}"
        item = tracker._items.get(key)
        if item is None:
            continue
        item.tier = Tier.L3
        item.n_value = l3_entry_n