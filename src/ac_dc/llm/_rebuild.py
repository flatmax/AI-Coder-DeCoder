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

    Under D36 dir-blocks the rebuild sequence is:

    1. Preserve history entries.
    2. Wipe everything else from the tracker — including pin
       flags. Rebuild is the explicit reset point that
       supersedes per-file edit history.
    3. Mark all tiers broken; configure cache target
       (model-aware).
    4. Load content for selected files (so step 5's bin-pack
       can compute real token counts).
    5. Distribute selected files across L1/L2/L3 via bin-pack.
       Active is excluded — rebuild's purpose is to skip the
       graduation wait.
    6. Seed dir-blocks (``symbols:<dir>`` / ``docs:<dir>`` /
       ``plain_files:<dir>``) across L0–L3 sorted by directory
       mtime; hottest directories land warmer.
    7. Cross-reference seeding if enabled.
    8. Graduate eligible history via piggyback.
    9. Mark initialized for current mode.

    Removed under D36:

    - **No system-prompt tracker entry.** The system prompt
      sits before L0 as a non-flux head anchor and is
      rendered live from the context manager at assembly
      time.
    - **No L0 snapshot freeze.** Content under D36 is
      participating in flux uniformly — the cache viewer
      reads tracker state directly.

    Spec: :doc:`specs-reference/3-llm/cache-tiering`
    § Manual Cache Rebuild.
    """
    from ac_dc.llm._stability import seed_cross_reference_items
    from ac_dc.stability_tracker import Tier

    assert service._symbol_index is not None
    assert service._repo is not None

    tracker = service._stability_tracker
    mode = service._context.mode

    # Refresh both indexes BEFORE any step that reads
    # index state. The per-turn streaming pipeline does
    # this on every chat request, so the common path
    # never hits stale indexes — but rebuild can fire
    # without a chat turn since the last filesystem
    # change (user deletes files in a terminal, switches
    # to AC-DC, clicks Rebuild). Without this pass the
    # symbol/doc indexes still hold deleted files'
    # blocks and dir-block seeding (step 6 below) places
    # stale entries into the new tracker. Same file-list
    # shape and same try/except discipline as
    # :func:`ac_dc.llm._streaming.stream_chat`.
    try:
        file_list_raw = service._repo.get_flat_file_list()
        file_list = [
            f for f in file_list_raw.split("\n") if f
        ]
        service._symbol_index.index_repo(file_list)
        if service._doc_index_ready:
            doc_files = [
                f for f in file_list
                if service._doc_index._extension_of(f)
                in service._doc_index._extractors
            ]
            service._doc_index.index_repo(doc_files)
    except Exception as exc:
        logger.warning(
            "Index refresh during cache rebuild failed: %s",
            exc,
        )

    items_before = len(tracker.get_all_items())

    # Step 1-2: preserve history, wipe everything else.
    # Wiping includes any pin flags — rebuild is the
    # explicit "fresh start" gesture that supersedes
    # per-file edit history.
    history_items = {
        key: item
        for key, item in tracker.get_all_items().items()
        if key.startswith("history:")
    }
    for item in history_items.values():
        if hasattr(item, "_pinned"):
            item._pinned = False
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

    # Step 5: distribute selected files across L1/L2/L3.
    # Under D36 every selected file gets a ``file:`` tracker
    # entry; the directories that hold them participate via
    # dir-blocks seeded in step 6.
    selected_loaded = [
        path for path in service._selected_files
        if service._file_context.has_file(path)
    ]
    if selected_loaded:
        distribute_orphan_files(service, selected_loaded)

    # Step 6: seed dir-blocks across L0–L3 by directory
    # mtime. Hottest directories land warmer — see
    # :meth:`StabilityTracker.initialize_dir_blocks`. The
    # ``symbols:<dir>``, ``docs:<dir>``, and
    # ``plain_files:<dir>`` keys cover the repo's structural
    # presence; their content is rendered live at assembly
    # time from the indexes (excluding any files currently
    # in Active).
    seed_dir_blocks_for_rebuild(service)

    # Step 7: seed cross-reference items if enabled.
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
# Dir-block seeding (D36)
# ---------------------------------------------------------------------------


def seed_dir_blocks_for_rebuild(service: "LLMService") -> None:
    """Enumerate per-directory dir-block keys with their mtimes.

    Builds the ``(key, mtime)`` list :meth:`StabilityTracker
    .initialize_dir_blocks` consumes, then hands it over for
    the quartile-split mtime-based tier seeding.

    Three key families:

    - ``symbols:<dir>`` — directories that contain at least
      one file with a symbol-index block.
    - ``docs:<dir>`` — directories with at least one
      doc-outline block.
    - ``plain_files:<dir>`` — directories whose listed files
      are not covered by either index (or are partially
      covered, with the uncovered files becoming the block's
      content).

    The mtime for each key is the most recent file mtime
    inside that directory — :meth:`Repo.get_directory_mtime`
    handles the lookup.
    """
    repo = service._repo
    if repo is None:
        return

    keys_with_mtimes: list[tuple[str, float, int]] = []
    seen_dirs: set[str] = set()

    # Collect directories from the symbol index. Render each
    # block here and capture its measured token count so the
    # cache viewer shows real numbers immediately after a
    # rebuild — rather than the bin-packing placeholder
    # until the first turn replays update_stability.
    if service._symbol_index is not None:
        try:
            symbol_paths = list(
                service._symbol_index._all_symbols.keys()
            )
        except Exception:
            symbol_paths = []
        symbol_dirs: set[str] = set()
        for path in symbol_paths:
            symbol_dirs.add(
                path[: path.rfind("/")] if "/" in path else ""
            )
        for directory in symbol_dirs:
            mtime = repo.get_directory_mtime(directory)
            try:
                block = service._symbol_index.get_dir_symbols_block(
                    directory
                )
                tokens = (
                    service._counter.count(block) if block else 0
                )
            except Exception:
                tokens = 0
            keys_with_mtimes.append(
                (f"symbols:{directory}", mtime, tokens)
            )
            seen_dirs.add(directory)

    # Collect directories from the doc index.
    try:
        doc_paths = list(service._doc_index._all_outlines.keys())
    except Exception:
        doc_paths = []
    doc_dirs: set[str] = set()
    for path in doc_paths:
        doc_dirs.add(
            path[: path.rfind("/")] if "/" in path else ""
        )
    for directory in doc_dirs:
        mtime = repo.get_directory_mtime(directory)
        try:
            block = service._doc_index.get_dir_docs_block(directory)
            tokens = service._counter.count(block) if block else 0
        except Exception:
            tokens = 0
        keys_with_mtimes.append(
            (f"docs:{directory}", mtime, tokens)
        )
        seen_dirs.add(directory)

    # Plain-files dir-blocks: every directory whose listing
    # has at least one file NOT already covered by the
    # symbol or doc index. Files that appear in either
    # index are subtracted — their filenames are already
    # visible through the corresponding symbols:/docs:
    # block, and listing them again is pure duplication.
    # When every file in a directory is indexed, the
    # plain-files block is omitted entirely.
    from ac_dc.llm._stability import _indexed_paths_in_dir
    try:
        by_dir = repo.get_files_by_directory()
    except Exception:
        by_dir = {}
    for directory, files_in_dir in by_dir.items():
        covered = _indexed_paths_in_dir(service, directory)
        leftover = sorted(
            f for f in files_in_dir if f not in covered
        )
        if not leftover:
            continue
        mtime = repo.get_directory_mtime(directory)
        block = "\n".join(leftover)
        try:
            tokens = service._counter.count(block) if block else 0
        except Exception:
            tokens = 0
        keys_with_mtimes.append(
            (f"plain_files:{directory}", mtime, tokens)
        )
        seen_dirs.add(directory)

    if keys_with_mtimes:
        service._stability_tracker.initialize_dir_blocks(
            keys_with_mtimes
        )


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