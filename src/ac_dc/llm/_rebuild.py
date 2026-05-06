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

    Under the L0-content-typed model (D27) rebuild is much
    simpler than the legacy 12-step sequence. The steps are:

    1. Preserve history entries.
    2. Wipe everything else from the tracker — including pin
       flags and deletion markers. Rebuild is the explicit
       reset point that supersedes per-file edit history.
    3. Configure cache target (model-aware).
    4. Register ``system:prompt`` into L0 with real token
       counts. The aggregate symbol/doc maps that L0 also
       presents to the LLM are NOT held as tracker entries —
       they're regenerated from the index at assembly time.
    5. Distribute selected files across L1/L2/L3 via bin-pack.
       L0 is excluded (content-typed for structural maps);
       Active is excluded (rebuild's purpose is to skip the
       graduation wait).
    6. Seed cross-reference items into L0 if cross-ref is
       active. Cross-ref items are structural (symbol/doc
       blocks) — they legitimately belong in L0 alongside the
       primary aggregate map.
    7. Graduate eligible history via piggyback.
    8. Mark initialized for current mode.

    What's removed from the legacy implementation:

    - **No file-prefix placement** (``symbol:{path}`` /
      ``doc:{path}`` entries from indexed files). Those map
      blocks are part of L0's structural content and don't
      need cascade tracking.
    - **No selected-file primary→file swap dance.** Selected
      files go directly into L1/L2/L3 via ``distribute_orphan_files``.
    - **No post-measurement cross-tier backfill** of
      indexed files. The cross-reference seeding path still
      uses backfill for its own purpose (promoting
      most-connected opposite-index items into L0).

    Spec: ``specs4/3-llm/cache-tiering.md`` § Manual Cache
    Rebuild and § L0 Stability Contract.
    """
    from ac_dc.llm._stability import seed_cross_reference_items
    from ac_dc.stability_tracker import Tier

    assert service._symbol_index is not None
    assert service._repo is not None

    tracker = service._stability_tracker
    mode = service._context.mode

    items_before = len(tracker.get_all_items())

    # Step 1-2: preserve history, wipe everything else.
    # Wiping includes any pin flags and deletion markers —
    # rebuild is the explicit "fresh start" gesture that
    # supersedes per-file edit/delete state.
    history_items = {
        key: item
        for key, item in tracker.get_all_items().items()
        if key.startswith("history:")
    }
    # Clear transient flags on preserved history entries too —
    # history items don't carry pin/marker semantics, but a
    # defensive reset keeps the post-rebuild state clean.
    for item in history_items.values():
        if hasattr(item, "_pinned"):
            item._pinned = False
        if hasattr(item, "_deleted"):
            item._deleted = False
    tracker._items.clear()
    for key, item in history_items.items():
        tracker._items[key] = item

    # Step 3: mark all tiers broken; configure cache target.
    tracker._broken_tiers = {
        Tier.L0, Tier.L1, Tier.L2, Tier.L3, Tier.ACTIVE,
    }
    tracker._changes = []
    cache_target = service._config.cache_target_tokens_for_model()
    tracker.set_cache_target_tokens(cache_target)

    # Step 4: load content for all selected files into
    # the file context (so step 5's bin-pack can compute real
    # token counts).
    for path in service._selected_files:
        if not service._file_context.has_file(path):
            try:
                service._file_context.add_file(path)
            except Exception as exc:
                logger.debug(
                    "Could not load %s during rebuild: %s",
                    path, exc,
                )

    # Step 5: re-seed system prompt into L0. Mode-aware —
    # the prompt and legend differ between code and doc mode.
    if mode == Mode.DOC:
        system_prompt = service._config.get_doc_system_prompt()
        legend = service._doc_index.get_legend()
    else:
        system_prompt = service._config.get_system_prompt()
        legend = service._symbol_index.get_legend()
    if system_prompt:
        prompt_hash = hashlib.sha256(
            system_prompt.encode("utf-8")
        ).hexdigest()
        prompt_tokens = service._counter.count(system_prompt + legend)
        tracker.register_system_prompt(prompt_hash, prompt_tokens)

    # Step 6: distribute selected files across L1/L2/L3.
    # Under D27 every selected file is treated as an
    # "orphan" — there's no primary-index tracker entry to
    # swap from — so distribute_orphan_files handles all of
    # them uniformly.
    selected_loaded = [
        path for path in service._selected_files
        if service._file_context.has_file(path)
    ]
    if selected_loaded:
        distribute_orphan_files(service, selected_loaded)

    # Step 7: seed cross-reference items if enabled. Promotes
    # most-connected opposite-index items into L0 alongside
    # the primary aggregate map (the latter regenerated at
    # assembly time, not held as tracker entries).
    if service._cross_ref_enabled:
        seed_cross_reference_items(service)

    # Step 8: graduate eligible history via piggyback.
    rebuild_graduate_history(service, cache_target)

    # Step 9: mark initialized for the current mode.
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