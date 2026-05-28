"""Stability tracker management — init, update, cross-reference.

Extracted from :mod:`ac_dc.llm_service` to keep that module
focused on the streaming pipeline. Contains:

- :func:`try_initialize_stability` — eager + lazy tracker seed
  via D36 dir-block initialisation. Mode-aware (code → symbols:,
  doc → docs:). Quartile-splits dir-blocks across L0–L3 by
  directory mtime.
- :func:`update_stability` — per-request active items build +
  tracker update.
- :func:`seed_cross_reference_items` — populate the tracker
  with opposite-index dir-blocks when cross-reference is
  enabled.
- :func:`remove_cross_reference_items` — strip those items on
  disable / mode switch.

Every function takes the :class:`LLMService` as first argument
and reads/writes attributes on it. Keeping the service module
smaller without changing the state graph's shape.

Governing specs:
:doc:`specs-reference/3-llm/cache-tiering`,
:doc:`specs-reference/3-llm/modes`,
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
# Dir-block enumeration
# ---------------------------------------------------------------------------


def _indexed_paths_in_dir(
    service: "LLMService",
    directory: str,
) -> set[str]:
    """Return the set of paths in ``directory`` covered by either index.

    A file is "covered" when it appears as a key in the
    symbol index or the doc index — its content already
    rides the cascade via the corresponding ``symbols:``
    or ``docs:`` dir-block, so listing its filename in
    ``plain_files:<directory>`` would be pure duplication.

    Used by both initial seeding and per-turn refresh to
    subtract indexed files from the plain-files block.
    """
    covered: set[str] = set()
    if service._symbol_index is not None:
        try:
            for path in service._symbol_index._all_symbols.keys():
                parent = (
                    path[: path.rfind("/")] if "/" in path else ""
                )
                if parent == directory:
                    covered.add(path)
        except Exception:
            pass
    try:
        for path in service._doc_index._all_outlines.keys():
            parent = (
                path[: path.rfind("/")] if "/" in path else ""
            )
            if parent == directory:
                covered.add(path)
    except Exception:
        pass
    return covered


def _enumerate_dir_blocks(
    service: "LLMService",
) -> list[tuple[str, float, int]]:
    """Return ``[(key, mtime, tokens), ...]`` for all primary-mode dir-blocks.

    Walks the index and repo to produce three families of
    keys:

    - ``symbols:<dir>`` — directories with at least one
      file in the symbol index.
    - ``docs:<dir>`` — directories with at least one
      file in the doc index.
    - ``plain_files:<dir>`` — directories with at least
      one file NOT already covered by the symbol or doc
      index. Files that appear in either index are
      subtracted from the plain-files listing — their
      filenames are already visible to the LLM through
      the index block, and listing them again would
      duplicate tokens for no gain.

    The keys are deduplicated within each family (a single
    directory contributes one of each kind it qualifies for).
    Each key carries:

    - The most recent file mtime in its directory so the
      tracker's quartile-split seeding can put hot
      directories into warmer tiers.
    - The rendered block's real token count, measured here
      and propagated into :meth:`StabilityTracker.initialize_dir_blocks`
      so the Context tab shows real numbers immediately
      instead of the bin-packing placeholder until the
      first turn completes.

    Rendering errors fall back to a zero token count so the
    seed still happens; the next :meth:`update` cycle will
    overwrite tokens with the real count anyway.
    """
    repo = service._repo
    if repo is None:
        return []

    keys: list[tuple[str, float, int]] = []

    # symbols:<dir>
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
            keys.append((f"symbols:{directory}", mtime, tokens))

    # docs:<dir>
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
        keys.append((f"docs:{directory}", mtime, tokens))

    # plain_files:<dir> — subtract files already covered by
    # either index. When every file in a directory is indexed,
    # the plain-files block has nothing to add and is omitted.
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
        keys.append((f"plain_files:{directory}", mtime, tokens))

    return keys


# ---------------------------------------------------------------------------
# Initialization
# ---------------------------------------------------------------------------


def try_initialize_stability(service: "LLMService") -> None:
    """Initialize the stability tracker for the current mode.

    Called eagerly during deferred startup (Phase 2) or lazily
    on the first chat request if eager init failed. Under D36
    dir-blocks the sequence is:

    1. Refresh the symbol index in code mode (doc mode has
       already indexed in the background build).
    2. Configure the tracker's cache target (model-aware).
    3. Enumerate dir-block keys with their mtimes and hand
       them to :meth:`StabilityTracker.initialize_dir_blocks`,
       which quartile-splits them across L0/L1/L2/L3 by
       hottest-first.

    The system prompt is no longer a tracker entry — it sits
    before L0 as a non-flux head anchor and is rendered live
    from the context manager at assembly time.

    Mode-aware dispatch — code mode requires the symbol index
    to be attached; doc mode requires the doc index's
    background build to have completed. In doc mode, if the
    doc index isn't ready yet (``_doc_index_ready is False``),
    the function bails without setting the per-mode init flag.

    Safe to call multiple times — sets the per-mode initialized
    flag on the first successful run.

    Spec: :doc:`specs-reference/3-llm/cache-tiering`
    § Initialization.
    """
    mode = service._context.mode
    if service._stability_initialized.get(mode, False):
        return
    if service._repo is None:
        return

    if mode == Mode.DOC:
        if not service._doc_index_ready:
            return
    else:
        if service._symbol_index is None:
            return

    try:
        if mode == Mode.CODE:
            assert service._symbol_index is not None
            file_list_raw = service._repo.get_flat_file_list()
            file_list = [f for f in file_list_raw.split("\n") if f]
            service._symbol_index.index_repo(file_list)

        cache_target = service._config.cache_target_tokens_for_model()
        service._stability_tracker.set_cache_target_tokens(
            cache_target
        )

        keys_with_mtimes = _enumerate_dir_blocks(service)
        if keys_with_mtimes:
            service._stability_tracker.initialize_dir_blocks(
                keys_with_mtimes
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


# ---------------------------------------------------------------------------
# Per-request update
# ---------------------------------------------------------------------------


def _dir_block_active_items(
    service: "LLMService",
    scope: "ConversationScope",
) -> dict[str, dict[str, Any]]:
    """Build the active-items entries for every dir-block.

    Each tracker entry must show up in active_items every
    turn so its hash and tokens stay current. The hash is the
    directory's signature hash (which excludes files in
    Active full-text); tokens come from rendering the block
    with the same exclude set.

    Files currently in Active full-text move out of their
    dir-block — the block hash changes, the entry shows up
    in active_items with the new hash, and the membrane
    cascade demotes the block to Active to re-ride flux.
    """
    items: dict[str, dict[str, Any]] = {}

    active_excluded = set(scope.context.file_context.get_files())

    repo = service._repo
    if repo is None:
        return items

    for key in list(scope.tracker.get_all_items().keys()):
        if key.startswith("symbols:"):
            if service._symbol_index is None:
                continue
            directory = key[len("symbols:"):]
            try:
                block = service._symbol_index.get_dir_symbols_block(
                    directory, exclude_active=active_excluded
                )
                sig = service._symbol_index.get_dir_signature_hash(
                    directory, exclude_active=active_excluded
                )
            except Exception:
                continue
            tokens = (
                service._counter.count(block) if block else 0
            )
            items[key] = {"hash": sig, "tokens": tokens}
        elif key.startswith("docs:"):
            directory = key[len("docs:"):]
            try:
                block = service._doc_index.get_dir_docs_block(
                    directory, exclude_active=active_excluded
                )
                sig = service._doc_index.get_dir_signature_hash(
                    directory, exclude_active=active_excluded
                )
            except Exception:
                continue
            tokens = (
                service._counter.count(block) if block else 0
            )
            items[key] = {"hash": sig, "tokens": tokens}
        elif key.startswith("plain_files:"):
            directory = key[len("plain_files:"):]
            try:
                by_dir = repo.get_files_by_directory()
            except Exception:
                by_dir = {}
            covered = _indexed_paths_in_dir(service, directory)
            files_in_dir = sorted(
                f for f in by_dir.get(directory, [])
                if f not in active_excluded and f not in covered
            )
            block = "\n".join(files_in_dir)
            tokens = (
                service._counter.count(block) if block else 0
            )
            sig = hashlib.sha256(
                block.encode("utf-8")
            ).hexdigest()
            items[key] = {"hash": sig, "tokens": tokens}

    return items


def update_stability(
    service: "LLMService",
    scope: "ConversationScope | None" = None,
) -> None:
    """Build active items and run the tracker update.

    Builds the active-items dict from the content categories
    that ride the cascade under D36 dir-blocks: selected
    files as full-content ``file:{path}`` entries, dir-blocks
    (``symbols:<dir>`` / ``docs:<dir>`` / ``plain_files:<dir>``),
    and history messages. The system prompt is NOT a tracker
    entry — it sits before L0 as a non-flux head anchor.

    Order of operations:

    0. Defensive excluded-files removal from the tracker.
    1. Selected files — full content hash, ``file:{path}``.
    2. Dir-blocks — current signature hash + tokens. Files
       currently in Active full-text are excluded from the
       block, so a file moving in/out of Active changes the
       parent directory's hash and re-rides flux.
    3. History messages.
    4. Run tracker.update().

    Spec: :doc:`specs-reference/3-llm/cache-tiering`
    § Always-resident invariant.
    """
    if scope is None:
        scope = service._default_scope()

    excluded = getattr(service, "_excluded_index_files", None) or ()
    for path in excluded:
        file_key = "file:" + path
        existing = scope.tracker._items.get(file_key)
        if existing is not None:
            scope.tracker.mark_broken(
                existing.tier,
                "excluded file (defensive sweep)",
            )
            scope.tracker.log_change(
                f"{existing.tier.value} → removed: "
                f"{file_key} (excluded by user)"
            )
            scope.tracker._items.pop(file_key, None)

    active_items: dict[str, dict[str, Any]] = {}

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

    active_items.update(_dir_block_active_items(service, scope))

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

    # Snapshot the change log onto the service so the
    # frontend's get_context_breakdown can read it. The
    # terminal HUD's print_post_response_hud drains the
    # tracker's live _changes list after rendering, which
    # races against the browser's streamComplete-driven
    # breakdown fetch — by the time the RPC arrives, the
    # tracker's log is empty and the UI shows "No changes
    # this cycle" while the terminal shows 17 promotions.
    # The snapshot persists across the drain so both
    # consumers see the same data.
    #
    # Stored only for the main scope's tracker (the one
    # the breakdown RPC reads when no agent_tag is given);
    # agent scopes get their own snapshot on their own
    # service field via the agent breakdown path. For now
    # we snapshot only the main scope — agent breakdowns
    # currently fall through to live tracker.get_changes()
    # and inherit the same race, but agents don't have a
    # terminal HUD draining their tracker so the race is
    # benign there.
    if scope.tracker is service._stability_tracker:
        service._last_tier_changes = list(
            scope.tracker.get_changes()
        )


# ---------------------------------------------------------------------------
# Cross-reference item management
# ---------------------------------------------------------------------------


def seed_cross_reference_items(service: "LLMService") -> None:
    """Seed opposite-index dir-blocks into the tracker.

    Under D36 cross-reference adds dir-blocks from the
    *opposite* mode's index — when in code mode with
    cross-ref on, the doc-index's per-directory ``docs:<dir>``
    blocks join the cascade alongside the primary
    ``symbols:<dir>`` blocks.

    Uses :meth:`StabilityTracker.cross_ref_seed_dir_blocks`
    which third-splits the new keys across L1/L2/L3 by
    mtime — never L0 (cross-ref dir-blocks earn promotion
    to L0 the same way primary blocks do, via the cascade).

    Each seeded entry carries a measured token count so the
    Context tab shows real numbers as soon as cross-ref
    enables, instead of the placeholder until the first
    turn completes.
    """
    repo = service._repo
    if repo is None:
        return

    mode = service._context.mode
    keys: list[tuple[str, float, int]] = []

    if mode == Mode.CODE:
        try:
            doc_paths = list(
                service._doc_index._all_outlines.keys()
            )
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
                block = service._doc_index.get_dir_docs_block(
                    directory
                )
                tokens = (
                    service._counter.count(block) if block else 0
                )
            except Exception:
                tokens = 0
            keys.append((f"docs:{directory}", mtime, tokens))
    else:
        if service._symbol_index is None:
            return
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
            keys.append((f"symbols:{directory}", mtime, tokens))

    if keys:
        service._stability_tracker.cross_ref_seed_dir_blocks(keys)


def remove_cross_reference_items(service: "LLMService") -> None:
    """Strip opposite-index dir-blocks from the tracker.

    Companion to :func:`seed_cross_reference_items`. When
    cross-ref disables (or mode switches), the opposite-mode
    dir-blocks must leave the tracker so the next prompt
    assembly doesn't render their content. Marks the affected
    tiers broken so the cascade rebuilds without them.
    """
    from ac_dc.stability_tracker import Tier

    tracker = service._stability_tracker
    if service._context.mode == Mode.CODE:
        target_prefix = "docs:"
    else:
        target_prefix = "symbols:"

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
        tracker.mark_broken(tier, "cross-ref disabled")
