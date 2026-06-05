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
    2. Wipe everything else from the tracker. Rebuild is the
       explicit reset point.
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
    # Also clear edit-invariant pin flags — the user's "fresh
    # start" gesture supersedes per-file edit history. Pins
    # protect mid-session edits from flux moves; rebuild
    # explicitly resets that protection so re-distributed
    # files compete normally for tier placement.
    history_items = {
        key: item
        for key, item in tracker.get_all_items().items()
        if key.startswith("history:")
    }
    tracker._items.clear()
    for key, item in history_items.items():
        tracker._items[key] = item
    tracker.clear_all_pins()

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

    Mode-gated, mirroring
    :func:`ac_dc.llm._stability._enumerate_dir_blocks`:

    - ``symbols:<dir>`` — code mode only.
    - ``docs:<dir>`` — doc mode only.
    - ``plain_files:<dir>`` — both modes; subtracts files
      already covered by the active-mode index.

    Cross-reference mode brings the opposite-mode index
    in on top via the cross-ref seeding step in
    :func:`rebuild_cache_impl`; this function emits only
    the primary-mode keys.

    The mtime for each key is the most recent file mtime
    inside that directory — :meth:`Repo.get_directory_mtime`
    handles the lookup.
    """
    repo = service._repo
    if repo is None:
        return

    from ac_dc.llm._stability import (
        _dir_has_unexcluded_indexed_file,
        _excluded_set,
        _indexed_paths_in_dir,
    )

    excluded = _excluded_set(service)
    mode = service._context.mode
    keys_with_mtimes: list[tuple[str, float, int]] = []
    seen_dirs: set[str] = set()

    # symbols:<dir> — code mode only. Render each block here
    # and capture its measured token count so the cache
    # viewer shows real numbers immediately after a rebuild
    # rather than the bin-packing placeholder until the
    # first turn replays update_stability. Skip directories
    # whose every indexed file is on the user's exclusion
    # list — the rendered block would be empty and the
    # entry would only litter the cache view.
    if mode == Mode.CODE and service._symbol_index is not None:
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
            if not _dir_has_unexcluded_indexed_file(
                symbol_paths, directory, excluded
            ):
                continue
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

    # docs:<dir> — doc mode only. Same exclusion filter as
    # symbols above.
    if mode == Mode.DOC:
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
            if not _dir_has_unexcluded_indexed_file(
                doc_paths, directory, excluded
            ):
                continue
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

    # plain_files:<dir> — both modes. Every directory whose
    # listing has at least one file NOT already covered by
    # the active-mode index AND not on the user's exclusion
    # list. Files that appear in the active-mode index are
    # subtracted — their filenames are already visible
    # through the corresponding symbols:/docs: block, and
    # listing them again is pure duplication. When every
    # file in a directory is indexed or excluded, the
    # plain-files block is omitted entirely.
    try:
        by_dir = repo.get_files_by_directory()
    except Exception:
        by_dir = {}
    for directory, files_in_dir in by_dir.items():
        covered = _indexed_paths_in_dir(service, directory)
        leftover = sorted(
            f for f in files_in_dir
            if f not in covered and f not in excluded
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


def _file_mtime(service: "LLMService", path: str) -> float:
    """Return the on-disk mtime for ``path``, or 0.0 if unknown.

    Per-file coldness signal for :func:`distribute_orphan_files`.
    Falls back to the file's parent-directory mtime when the
    file can't be stat'd directly (and 0.0 when even that
    fails), so a missing stat degrades to "as cold as its
    directory" rather than crashing the rebuild.
    """
    repo = service._repo
    if repo is None:
        return 0.0
    try:
        return (repo.root / path).stat().st_mtime
    except Exception:
        pass
    try:
        directory = path[: path.rfind("/")] if "/" in path else ""
        return repo.get_directory_mtime(directory)
    except Exception:
        return 0.0


def distribute_orphan_files(
    service: "LLMService",
    orphan_paths: list[str],
) -> None:
    """Seed selected files across L0–L3 by mtime coldness.

    Called by rebuild for selected files (whether or not they
    are in the primary index). Without this they'd land in
    ACTIVE on the next update pass and have to age through the
    admission gate before reaching a cached tier — rebuild's
    purpose is to skip that wait.

    Distribution is **mtime-based, coldest-into-L0**, mirroring
    :meth:`StabilityTracker.initialize_dir_blocks` so selected
    files and dir-blocks share the same edit-cost-aware
    seeding policy. Files are sorted coldest-first and walked
    against the mass-share schedule
    ``[L3 = 10%, L2 = 20%, L1 = 30%, L0 = 40%]`` of total
    selected-file mass: the coldest (least-recently-modified)
    files accumulate into L0 (most expensive tier to
    invalidate, least likely to be edited soon), the hottest
    into L3 (cheapest to invalidate, most likely to teleport
    back to Active on the next edit).

    This replaces the earlier greedy-min-across-L1/L2/L3 rule
    that reserved L0 against selected files entirely. That
    rule treated every selected file as uniformly hot; in
    practice a heavily-selected session (many files loaded as
    read-only reference) left L0 nearly empty while L1/L2/L3
    carried the full selected mass, producing a large positive
    V across the L1→L0 membrane and provoking promotion churn
    on the first few turns. Seeding by coldness inverts the
    post-seed token gradient — L0 heaviest, L3 lightest — so
    V ≤ 0 across every membrane at the rebuilt state and the
    rectified flux equation stays quiescent until a real edit
    teleports a file to Active.

    A 1:1 floor guarantees every tier receives at least one
    file when the population permits, so a single oversized
    cold file cannot fill L0 and strand L1/L2/L3 empty.

    Spec: ``specs4/3-llm/cache-tiering.md`` § Manual Cache
    Rebuild.
    """
    from ac_dc.stability_tracker import Tier, TrackedItem

    tracker = service._stability_tracker

    entries: list[tuple[str, float, int, str]] = []
    for path in orphan_paths:
        content = service._file_context.get_content(path)
        if content is None:
            continue
        tokens = service._counter.count(content)
        file_hash = hashlib.sha256(
            content.encode("utf-8")
        ).hexdigest()
        mtime = _file_mtime(service, path)
        entries.append((path, mtime, tokens, file_hash))

    if not entries:
        return

    # Coldest first (smallest mtime), key tiebreak for
    # determinism. The walk places the coldest files into L0
    # and advances toward L3 as it warms.
    entries.sort(key=lambda e: (e[1], e[0]))

    n = len(entries)
    # Cold → L0, hot → L3. Walking coldest-first, we fill L0
    # to its mass share, then L1, L2, and finally L3 absorbs
    # the hottest tail.
    tier_order = (Tier.L0, Tier.L1, Tier.L2, Tier.L3)
    share_per_tier = (0.40, 0.30, 0.20, 0.10)
    total_tokens = sum(e[2] for e in entries)
    targets = [total_tokens * s for s in share_per_tier]
    floor_active = n >= len(tier_order)

    cum_in_tier = 0
    tier_idx = 0
    for idx, (path, _mtime, tokens, file_hash) in enumerate(entries):
        if tier_idx < len(tier_order) - 1:
            items_left_after_this = n - idx - 1
            tiers_below_current = len(tier_order) - tier_idx - 1
            floor_advance = (
                floor_active
                and items_left_after_this < tiers_below_current
            )
            mass_advance = (
                cum_in_tier > 0
                and cum_in_tier + tokens > targets[tier_idx]
            )
            if floor_advance or mass_advance:
                tier_idx += 1
                cum_in_tier = 0

        tier = tier_order[tier_idx]
        entry_n = _TIER_CONFIG_LOOKUP[tier]["entry_n"]
        tracker._items[f"file:{path}"] = TrackedItem(
            key=f"file:{path}",
            tier=tier,
            n_value=entry_n,
            content_hash=file_hash,
            tokens=tokens,
        )
        cum_in_tier += tokens


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