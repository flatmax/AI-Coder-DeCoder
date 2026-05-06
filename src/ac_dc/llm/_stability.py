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
    """Initialize the stability tracker for the current mode.

    Called eagerly during deferred startup (Phase 2) or lazily
    on the first chat request if eager init failed. Under the
    L0-content-typed model (D27) initialization is a thin
    operation:

    1. Re-run the symbol index's incremental pass (code mode
       only — doc mode has already indexed in the background
       build) so its mtime cache is current.
    2. Configure the tracker's cache-target tokens (model-
       aware).
    3. Register the system prompt into L0 via
       :meth:`register_system_prompt`. This is the only
       cascade-tracked entry that lives in L0; the aggregate
       symbol/doc maps that L0 also presents to the LLM are
       regenerated from the index at assembly time, not held
       as tracker entries.

    What init does NOT do under the new model:

    - **No four-tier file distribution.** Earlier revisions
      bin-packed every indexed file across L0/L1/L2/L3 via
      reference-graph clustering. That optimised "every cached
      tier is full from turn one" but interacted badly with
      routine churn — every selection toggle and every edit
      shifted bytes in cached tiers and triggered demotion
      cascades. Under the new model L1/L2/L3/Active start
      empty; files enter Active when selected and graduate
      upward through the cascade as they stabilise. The user
      can trigger immediate redistribution via
      ``rebuild_cache`` if they prefer warm caches over the
      natural graduation path.
    - **No post-measurement L0 backfill on the init path.**
      The legacy backfill compensated for placeholder-vs-real
      token-count divergence after the four-tier seed — with
      no seed there's nothing to backfill. The
      :meth:`backfill_l0_after_measurement` call remains
      wired into the cross-reference activation path, where
      it serves a different role (promoting the most-
      connected opposite-index items into L0 alongside the
      primary aggregate map).

    Mode-aware dispatch — code mode requires the symbol index
    to be attached; doc mode requires the doc index's
    background build to have completed. In doc mode, if the
    doc index isn't ready yet (``_doc_index_ready is False``),
    the function bails without setting the per-mode init flag.
    The next chat request's lazy-init retry tries again; once
    structural extraction completes, init succeeds on the
    retry.

    Safe to call multiple times — sets the per-mode initialized
    flag on the first successful run. Subsequent calls for the
    same mode are no-ops; subsequent calls for a DIFFERENT mode
    (after a switch_mode) initialize that mode's tracker fresh.

    Spec: ``specs4/3-llm/cache-tiering.md`` § Initialization
    and § Why no startup file distribution.
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
        # Step 1: Refresh the symbol index in code mode. In doc
        # mode the background build has already indexed every
        # doc file; we don't re-walk.
        if mode == Mode.CODE:
            assert service._symbol_index is not None
            file_list_raw = service._repo.get_flat_file_list()
            file_list = [f for f in file_list_raw.split("\n") if f]
            service._symbol_index.index_repo(file_list)

        # Step 2: Configure the tracker's cache target. The
        # tracker uses this for anchoring and underfill
        # demotion calculations during the cascade.
        cache_target = service._config.cache_target_tokens_for_model()
        service._stability_tracker.set_cache_target_tokens(
            cache_target
        )

        # Step 3: Register the system prompt into L0. The
        # aggregate symbol/doc maps that L0 also presents to
        # the LLM are NOT tracker entries — they're rebuilt
        # at assembly time from the index. Only system:prompt
        # is cascade-tracked.
        if mode == Mode.DOC:
            system_prompt = service._config.get_doc_system_prompt()
            legend = service._doc_index.get_legend()
        else:
            assert service._symbol_index is not None
            system_prompt = service._config.get_system_prompt()
            legend = service._symbol_index.get_legend()
        prompt_hash = hashlib.sha256(
            system_prompt.encode("utf-8")
        ).hexdigest()
        prompt_tokens = service._counter.count(system_prompt + legend)
        service._stability_tracker.register_system_prompt(
            prompt_hash, prompt_tokens
        )

        service._stability_initialized[mode] = True
        logger.info(
            "Stability tracker initialized (%s mode): %d items "
            "(L0-content-typed: only system:prompt held in tracker)",
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
                scope.tracker.mark_broken(
                    existing.tier,
                    "excluded file (defensive sweep)",
                )
                scope.tracker.log_change(
                    f"{existing.tier.value} → removed: "
                    f"{entry_key} (excluded by user)"
                )
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
                    scope.tracker.mark_broken(
                        tier, "selected file (index→content swap)"
                    )
                    scope.tracker.log_change(
                        f"{tier.value} → removed: {entry_key} "
                        "(selected, swapped for full content)"
                    )

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

    # Step 4 — Cross-reference is L0-only under D27. The
    # secondary aggregate map is regenerated from the
    # opposite-mode index at assembly time (see
    # :func:`ac_dc.llm._assembly.assemble_tiered`) and does
    # not produce per-file tracker entries.

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
    """No-op under the L0-content-typed model.

    Earlier revisions of cross-reference seeded per-file
    ``doc:{path}`` (or ``symbol:{path}``) tracker entries
    into L1/L2/L3 via reference-graph clustering, then
    backfilled the most-connected ones into L0. That
    mechanism violates the L0-content-typed invariant
    pinned by ``specs4/3-llm/cache-tiering.md``:

    > L1, L2, L3 hold promoted concrete content only —
    > full file text, fetched URL content, graduated
    > history. Symbol blocks and doc blocks never appear
    > in L1–L3; the aggregate maps in L0 are their
    > permanent home.

    And from ``specs4/3-llm/modes.md`` § Cross-Reference
    Mode:

    > Both legends included in the L0 cache block

    Cross-reference is now an L0-only affair: the
    secondary aggregate map is regenerated from the
    opposite-mode index at assembly time and rendered
    into L0's system message under the appropriate
    secondary header. No per-file tracker entries are
    created, so nothing distributes through L1/L2/L3.

    The seed function remains as a no-op so call sites
    in :mod:`ac_dc.llm._rebuild` and
    :mod:`ac_dc.llm._rpc_state` keep working without
    conditional dispatch. Toggling cross-ref on/off has
    no effect on the tracker state at all; the next
    prompt assembly observes the flag directly.
    """
    del service  # unused — kept for signature stability


def remove_cross_reference_items(service: "LLMService") -> None:
    """No-op under the L0-content-typed model.

    Companion to :func:`seed_cross_reference_items` — both
    are stubs now. Cross-reference state is observed
    directly at assembly time; there are no per-file
    tracker entries to strip on disable.

    Defensive sweep: any pre-existing ``doc:{path}`` /
    ``symbol:{path}`` entries left over from migration
    (or from a previous build that DID seed them) are
    cleaned up here so a session that started under the
    old code and then toggled cross-ref off doesn't keep
    stale entries scattered across L1/L2/L3. Once those
    legacy entries are gone, this function does nothing.
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
        tracker.mark_broken(tier, "cross-ref legacy sweep")