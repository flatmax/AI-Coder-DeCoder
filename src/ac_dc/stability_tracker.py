"""Stability tracker — cache tier assignment for prompt content.

Drives the prompt-cache breakpoint placement that makes AC-DC's
large-context usage affordable. Content that stays structurally
unchanged across requests promotes upward across tier membranes
(Active → L3 → L2 → L1 → L0), driven by the rectified-flux
controller in :mod:`ac_dc.cache_membrane`. Content whose content
hash changes teleports to ``active`` with ``n=0`` and re-climbs
from there.

This module owns tier assignments only. The streaming handler
(Layer 3.6) builds the active-items list each request and calls
:meth:`StabilityTracker.update`; the prompt assembler (Layer 3.7)
reads tier assignments via :meth:`get_tier_items`.

Governing specs:

- ``specs4/3-llm/cache-tiering.md`` — the contract-level spec
- ``specs-reference/3-llm/cache-tiering.md`` — the numeric detail
  reference
- ``specs4/impl-history/decisions.md`` D36 — L0 is no longer
  content-typed; every tier participates in flux uniformly,
  and aggregate L0 maps are replaced by per-directory dir-blocks
- ``specs4/impl-history/decisions.md`` D35 — the membrane / flux
  controller landed; rectified-GHK is the only supported variant

Design points pinned by the test suite and spec:

- **Per-context-manager scope.** The tracker is owned by its
  context manager. A future parallel-agent mode (D10) creates one
  tracker per agent; they share no state. Mode switching swaps
  between two trackers that the user-facing context manager
  points at — each mode preserves its own tier state when
  inactive.

- **Key prefixes dispatch by content type.** ``file:``,
  ``symbols:<dir>``, ``docs:<dir>``, ``plain_files:<dir>``,
  ``url:``, ``history:``. The system prompt sits before L0 as
  the only non-flux head anchor and is NOT a tracker entry.
  The tracker itself doesn't interpret content — it just
  tracks the keys. Downstream consumers (prompt assembler,
  cache viewer) dispatch rendering on the prefix.

- **`n` is a pure age counter** — turns since last edit. Aged
  ``+1`` on every item every cycle. Reset to ``0`` only by
  hash mismatch (the edit invariant). The Active → L3 membrane
  has an admission floor ``n_admit`` (default 3) so newly-
  registered items cannot graduate until they have aged.

- **Promotion is rectified flux across membranes.** Each turn,
  the relaxation loop iterates to local equilibrium across the
  four live membranes (Active→L3, L3→L2, L2→L1, L1→L0). Under
  D36 the L1→L0 membrane participates uniformly — L0 is no
  longer content-typed.

- **Direction and quiescence are intrinsic to the flux
  equation.** The rectification clamp pins direction (Φ ≥ 0
  — controller is upward-only); the deadband threshold
  absorbs steady-state noise so quiet turns with V ≈ 0 across
  all membranes self-arrest on the first pass without firing.
  The broken-tier set survives as a HUD diagnostic and as the
  gate for history-piggyback graduation, but no longer feeds
  the flux loop.

- **Edit invariant.** A hash mismatch teleports the file to
  Active with ``n = 0``. The membrane / flux model handles
  the rest — when the file is deselected, its parent
  directory's dir-block continues to carry its structural
  presence, and re-selection brings the full text back.

Anchoring, N-cap-at-stable-above, and post-cascade underfill
demotion are all removed — the membrane controller subsumes the
first two, and prompt assembly handles the third (cache target
is consulted at breakpoint emission time, not by rearranging
tier contents).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Any

from ac_dc.cache_membrane import (
    ACTIVE_IDX,
    L0_IDX,
    L1_IDX,
    L2_IDX,
    L3_IDX,
    LIVE_MEMBRANES,
    FluxConfig,
    relax,
)

if TYPE_CHECKING:
    # Reference index is consumed for initialisation only; the
    # tracker holds no reference after init. Lazy import to keep
    # Layer 3.5 loadable without Layer 2 dependencies resolved.
    pass

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tier enum and per-tier config
# ---------------------------------------------------------------------------


class Tier(str, Enum):
    """Cache tier identifiers.

    Subclasses :class:`str` so string comparisons and dict
    serialisation work without explicit conversion. The wire
    format uses the string values (``"L0"``, ``"active"``, …).

    Ordering convention: L0 is most stable (longest-lived cache
    block), active is uncached. Cascade processes bottom-up in
    the order L3 → L2 → L1 → L0.
    """

    ACTIVE = "active"
    L3 = "L3"
    L2 = "L2"
    L1 = "L1"
    L0 = "L0"


# Per-tier ``entry_n`` — the age stamp assigned to an item when
# it is *placed* at this tier by init / rebuild / cross-reference
# seeding paths. Under the membrane model these values are
# effectively decorative: ``n`` is a pure age counter, and the
# only place ``n`` is read in the relaxation loop is the
# Active → L3 admission floor (``n_admit``, configured per-
# membrane). Items seeded at L3 / L2 / L1 / L0 by init paths
# bypass the admission gate entirely (they're already past the
# membrane it gates).
#
# Per D37 (and D35 retiring the N-counter cascade), only Active
# carries a ``promote_n`` field — its value is the admission gate
# (``n_admit``, default 3) for the Active → L3 membrane. L0 / L1 /
# L2 / L3 no longer carry ``promote_n``: the legacy "L3→L2 at N=6,
# L2→L1 at N=9, L1→L0 at N=12" thresholds are gone. ``entry_n``
# survives on every tier because :mod:`ac_dc.llm._rebuild` and
# :mod:`ac_dc.llm._breakdown` still consult it to assign a fresh
# item's N value at its target tier (so a new L0-seeded item
# starts above zero rather than triggering an immediate demotion
# on first measurement). Above the Active → L3 admission gate the
# membrane controller in :mod:`ac_dc.cache_membrane` drives every
# promotion via the rectified GHK flux equation; new code should
# reach for the membrane parameters via :class:`FluxConfig`.
_TIER_CONFIG: dict[Tier, dict[str, int]] = {
    Tier.ACTIVE: {"entry_n": 0, "promote_n": 3},
    Tier.L3: {"entry_n": 3},
    Tier.L2: {"entry_n": 6},
    Tier.L1: {"entry_n": 9},
    Tier.L0: {"entry_n": 12},
}


# Mapping between the :class:`Tier` enum and the integer indices
# the membrane controller uses. Higher index = more stable.
_TIER_TO_IDX: dict[Tier, int] = {
    Tier.ACTIVE: ACTIVE_IDX,
    Tier.L3: L3_IDX,
    Tier.L2: L2_IDX,
    Tier.L1: L1_IDX,
    Tier.L0: L0_IDX,
}
_IDX_TO_TIER: dict[int, Tier] = {idx: tier for tier, idx in _TIER_TO_IDX.items()}


# Placeholder content hash assigned during initialisation from the
# reference graph. Phase 1 treats empty-string hash as "never
# measured" and accepts the first real hash without demotion.
_PLACEHOLDER_HASH = ""


# Placeholder token count — during initialisation we don't have
# real token counts (the formatted blocks haven't been rendered
# yet). A small per-entry estimate is used so dir-block seeding
# doesn't over-fill any single tier. Real counts replace these
# on the first update cycle or via :meth:`measure_tokens`.
_PLACEHOLDER_TOKENS = 100


# ---------------------------------------------------------------------------
# TrackedItem
# ---------------------------------------------------------------------------


@dataclass
class TrackedItem:
    """One tracked item — a key, its tier, N value, hash, token count.

    Mutable by design — the tracker rewrites fields in place during
    cascade processing. The test suite constructs these directly
    for setup; production code never creates them outside the
    tracker itself.

    The ``_anchored`` attribute is dynamically attached during
    cascade processing (never declared here) — anchoring is a
    transient per-cycle property, not persistent state. Adding it
    as a field would confuse the contract and make test fixtures
    more verbose.
    """

    key: str
    tier: Tier
    n_value: int = 0
    content_hash: str = _PLACEHOLDER_HASH
    tokens: int = 0
    # Per-cycle change log — not part of the tracked state, but
    # convenient for the cascade to annotate moves that happened
    # to this item in the current cycle. Consumed by the frontend
    # cache viewer's "recent changes" display.
    last_change: str | None = field(default=None, compare=False)


# ---------------------------------------------------------------------------
# StabilityTracker
# ---------------------------------------------------------------------------


class StabilityTracker:
    """Tier assignment and promotion/demotion driver.

    Construct once per context manager, then drive via
    :meth:`update` on every LLM request. Queries via
    :meth:`get_tier_items` and :meth:`get_signature_hash` are
    consumed by the prompt assembler and the cache viewer.

    State:

    - ``_items``: dict of key → TrackedItem for every known key.
      Items in ``active`` are in this dict too.
    - ``_changes``: list of change descriptions for the most recent
      cascade cycle. Cleared at the start of each update.
    - ``_broken_tiers``: set of tiers whose cache block has been
      invalidated. Sticky across boundaries — external mutation
      paths (cross-reference disable, file exclusion, selection
      change, history purge) accumulate into this set between
      turns, and :meth:`update` consumes them on the next
      cascade. Cleared only after the cascade completes a stable
      pass. Controls underfill demotion (broken tiers don't
      demote) and preserves signal for promotion bookkeeping.

    Not thread-safe — the orchestrator drives updates from a single
    executor. Multiple tracker instances are independent; they
    share no state.
    """

    def __init__(
        self,
        cache_target_tokens: int = 0,
        flux_config: FluxConfig | None = None,
    ) -> None:
        """Initialise an empty tracker.

        Parameters
        ----------
        cache_target_tokens:
            The target token count each cached tier tries to meet.
            Per specs, this is ``max(cache_min_tokens,
            min_cacheable_tokens) × buffer_multiplier`` — computed
            by :meth:`ConfigManager.cache_target_tokens_for_model`
            and passed in. Read by prompt assembly to decide
            whether to emit a cache breakpoint; **does not**
            enter the flux equation under the membrane model
            (D35).
        flux_config:
            The membrane / flux controller configuration. When
            None, defaults to :class:`FluxConfig` (rectified-GHK
            with the synth-tuner's headline parameters). Tests
            construct explicit configs to exercise specific
            parameter values.
        """
        self._cache_target_tokens = cache_target_tokens
        self._flux_config = flux_config if flux_config is not None else FluxConfig()
        self._items: dict[str, TrackedItem] = {}
        self._changes: list[str] = []
        # Per-cycle registration log. Distinct from
        # ``_changes`` because a fresh tracker registration is
        # not a tier transition (the item didn't exist before)
        # and including it in the change log would break tests
        # that pin "no transitions → empty change log". The
        # HUD reads this list separately so operators still see
        # ➕ entries for newly-selected files, newly-fetched
        # URLs, freshly-mentioned symbols. Cleared at the start
        # of each :meth:`update`.
        self._registrations: list[str] = []
        self._broken_tiers: set[Tier] = set()
        # Set of keys pinned by the edit invariant — protected
        # from flux moves so a mid-session edit can keep its
        # truthful current text in cache without competing
        # for promotion. Cleared on rebuild (see
        # :mod:`ac_dc.llm._rebuild`).
        self._pinned_keys: set[str] = set()
        # Parallel diagnostic map — every entry in
        # ``_broken_tiers`` has matching reason strings here.
        # Set membership and reasons are kept in lockstep via
        # :meth:`_mark_broken`, which is the only sanctioned
        # write path. Read by the post-response HUD to surface
        # *why* a cascade fired, not just which tiers
        # invalidated. External callers in
        # :mod:`ac_dc.llm._rpc_state` and
        # :mod:`ac_dc.llm._stability` use the public
        # :meth:`mark_broken` so their reasons land here too.
        self._broken_reasons: dict[Tier, list[str]] = {}

    # ------------------------------------------------------------------
    # Configuration accessors
    # ------------------------------------------------------------------

    @property
    def cache_target_tokens(self) -> int:
        """Current cache-target tokens value."""
        return self._cache_target_tokens

    def set_cache_target_tokens(self, value: int) -> None:
        """Update the cache target mid-session.

        Used by mode switching — the model may differ between
        code and doc mode trackers, and the effective cache
        target is model-aware.
        """
        self._cache_target_tokens = value

    # ------------------------------------------------------------------
    # Broken-tier tracking with diagnostic reasons
    # ------------------------------------------------------------------

    def _mark_broken(self, tier: Tier, reason: str) -> None:
        """Mark ``tier`` as broken and record the diagnostic reason.

        The single sanctioned write path for ``_broken_tiers``
        and its parallel ``_broken_reasons`` map. Internal
        callers use this helper so the post-response HUD can
        surface *why* a cascade fired, not just which tiers
        invalidated.

        Multiple reasons accumulate on the same tier across a
        cycle (a tier might be marked broken first by an
        external mutation, then again by a graduation, then
        again by a promotion). The HUD reports them all so the
        operator can see the full set of triggers.
        """
        self._broken_tiers.add(tier)
        self._broken_reasons.setdefault(tier, []).append(reason)

    def mark_broken(self, tier: Tier, reason: str) -> None:
        """Public mark-broken — for external callers to record reasons.

        :mod:`ac_dc.llm._rpc_state` (selection, exclusion,
        mode switch) and :mod:`ac_dc.llm._stability`
        (defensive removal during update) need to mark tiers
        broken without invoking a full update cycle. Calling
        this method instead of mutating ``_broken_tiers``
        directly attaches a reason that the HUD will surface.
        """
        self._mark_broken(tier, reason)

    def log_change(self, description: str) -> None:
        """Public change-log accessor — for external callers.

        :mod:`ac_dc.llm._stability` removes tracker entries
        directly when files are excluded or when selected
        files swap their compact index entry for full
        content. Those removals invalidate cache tiers (and
        the partner :meth:`mark_broken` calls record *why*)
        but the per-item removal also belongs in the change
        log so the post-response HUD can render a demotion
        line. Without this, the HUD's promotion/demotion
        counters undercount demotions that happened outside
        a full :meth:`update` cycle.
        """
        self._log_change(description)

    def get_broken_reasons(self) -> dict[Tier, list[str]]:
        """Return a snapshot of broken tiers and their reasons.

        Read-only — caller mutations don't leak. Empty
        immediately after a cascade clears state, populated
        between turns as external mutations accumulate
        signals for the next cascade. The post-response HUD
        captures this BEFORE the cascade clears it.
        """
        return {
            tier: list(reasons)
            for tier, reasons in self._broken_reasons.items()
        }

    def get_entry_broken_reasons(self) -> dict[Tier, list[str]]:
        """Return the snapshot of broken-tier reasons at cycle entry.

        Captured by :meth:`update` BEFORE the cascade runs
        and BEFORE the live ``_broken_reasons`` map is
        cleared. Surfaces the *triggers* that motivated the
        cascade — typically external mutations from the
        previous turn (file exclusion, cross-ref toggle,
        history purge, mode switch). Distinct from
        :meth:`get_broken_reasons`, which after a cascade
        is empty (cleared by :meth:`_run_cascade`).

        Returns an empty dict before the first :meth:`update`
        call. Read-only — caller mutations don't leak.
        """
        snapshot = getattr(self, "_entry_broken_reasons", None)
        if not snapshot:
            return {}
        return {
            tier: list(reasons)
            for tier, reasons in snapshot.items()
        }

    # ------------------------------------------------------------------
    # Edit-invariant pinning
    # ------------------------------------------------------------------

    def pin_file(self, key: str) -> None:
        """Pin a tracked key so flux cannot move it.

        Used by the edit invariant: when a ``file:<path>``
        entry's content hash changes mid-session, the truthful
        current text must stay cached without competing for
        promotion against unedited content. Pinning excludes
        the key from the relax loop's mover pool.

        No-op for unknown keys — callers that pin defensively
        before the entry exists won't crash.

        Cleared by manual cache rebuild (see :mod:`ac_dc.llm
        ._rebuild`); the user's "fresh start" gesture
        supersedes per-file edit history.
        """
        self._pinned_keys.add(key)

    def unpin_file(self, key: str) -> None:
        """Remove a pin. No-op for unpinned keys."""
        self._pinned_keys.discard(key)

    def is_pinned(self, key: str) -> bool:
        """Return True when ``key`` is pinned (or has the legacy ``_pinned`` flag).

        The first form is the public API — pins set via
        :meth:`pin_file`. The second form supports tests and
        any caller that attaches ``_pinned = True`` directly
        to a :class:`TrackedItem` instance (rebuild's pin-
        clear path was originally written against this older
        shape; we keep both readable until that path is
        rewritten).
        """
        if key in self._pinned_keys:
            return True
        item = self._items.get(key)
        if item is not None and getattr(item, "_pinned", False):
            return True
        return False

    def clear_all_pins(self) -> None:
        """Drop every pin — the edit-invariant reset hook.

        Called by manual cache rebuild. Also strips any legacy
        ``_pinned`` attributes from :class:`TrackedItem`
        instances so the two pin representations agree on the
        empty state.
        """
        self._pinned_keys.clear()
        for item in self._items.values():
            if hasattr(item, "_pinned"):
                try:
                    delattr(item, "_pinned")
                except AttributeError:
                    pass

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    def get_tier_items(self, tier: Tier) -> dict[str, TrackedItem]:
        """Return all items currently in ``tier``.

        Returned dict is a fresh snapshot — callers mutating it
        don't affect tracker state. Used by the prompt assembler
        to gather tier content per request.
        """
        return {
            key: item
            for key, item in self._items.items()
            if item.tier == tier
        }

    def get_signature_hash(self, key: str) -> str | None:
        """Return the content hash for a tracked key, or None.

        Used by the cache viewer for display. Missing keys return
        None rather than empty string — empty string is a valid
        placeholder hash for initialised-but-not-measured items.
        """
        item = self._items.get(key)
        if item is None:
            return None
        return item.content_hash

    def has_item(self, key: str) -> bool:
        """Return True when ``key`` is tracked in any tier.

        Convenience for callers (the cache viewer, debugging)
        that want a cheap membership probe without fetching the
        full item.
        """
        return key in self._items

    def get_changes(self) -> list[str]:
        """Return change-log entries for the most recent update.

        Each entry is a human-readable string like
        ``"L3 → L2: symbol:src/foo.py"``. Consumed by the terminal
        HUD and the cache viewer's "recent changes" list.

        Returns a fresh list — safe to iterate or filter without
        affecting the tracker.
        """
        return list(self._changes)

    def get_registrations(self) -> list[str]:
        """Return registration-log entries for the most recent update.

        Each entry is a human-readable string like
        ``"new → active: file:src/foo.py (registered)"`` and
        records a fresh tracker key that did not exist before
        the most recent :meth:`update` cycle. Distinct from
        :meth:`get_changes` because a registration is not a
        tier transition and must not pollute the change-log
        contract that downstream code (and tests) depend on.

        Returns a fresh list — safe to iterate or filter without
        affecting the tracker.
        """
        return list(self._registrations)

    def get_all_items(self) -> dict[str, TrackedItem]:
        """Return a snapshot of every tracked item.

        Returned dict is fresh; mutating it doesn't affect the
        tracker. Used primarily by tests and by the cache
        viewer's full-tier display.
        """
        return dict(self._items)

    # ------------------------------------------------------------------
    # History purge (called by context manager on clear_history)
    # ------------------------------------------------------------------

    def purge_history(self) -> None:
        """Remove every ``history:*`` item across all tiers.

        Called by the context manager when history is cleared
        (compaction, new session, session load). Per specs3:
        "all ``history:*`` entries are purged from the tracker.
        Compacted messages re-enter as new active items with
        N = 0."

        Marks every tier that had history items as broken so the
        next cascade pass rebuilds them cleanly.
        """
        to_remove = [
            key for key in self._items if key.startswith("history:")
        ]
        tiers_affected: set[Tier] = set()
        for key in to_remove:
            tiers_affected.add(self._items[key].tier)
            del self._items[key]
        # Every tier that held history is now potentially
        # under-full; mark them broken so the next update cascade
        # re-balances correctly.
        for tier in tiers_affected:
            self._mark_broken(tier, "history purge")

    # ------------------------------------------------------------------
    # Update entry point (the main driver)
    # ------------------------------------------------------------------

    def update(
        self,
        active_items: dict[str, dict[str, Any]],
        existing_files: set[str] | None = None,
    ) -> list[str]:
        """Run one full update cycle — the main entry point.

        Parameters
        ----------
        active_items:
            Dict of key → ``{"hash": str, "tokens": int}`` for
            every item the streaming handler considers "active"
            this request. The tracker compares each entry's hash
            against the stored one, increments or resets N, and
            decides graduation candidates.
        existing_files:
            Optional set of repo-relative file paths that
            currently exist. Items whose key references a
            non-existent file (``file:{path}``, ``symbol:{path}``,
            ``doc:{path}``) are removed in Phase 0. When None,
            Phase 0 is skipped — useful for tests that don't want
            to simulate file deletions.

        Returns
        -------
        list[str]
            The change log for this cycle. Same content that
            :meth:`get_changes` would return afterwards; returned
            for convenience so callers don't need a second call.
        """
        # Change log is per-cycle, but external mutators
        # (selection index→content swap, exclusion sweep,
        # history purge) call ``log_change`` before update()
        # runs to record their removals. Those pre-cycle
        # entries belong in this cycle's log so the post-
        # response HUD can render them as 🗑️ demotion lines
        # alongside the cascade's promotion output. Capture
        # the pre-cycle entries, then reset the log to collect
        # this cycle's cascade entries, then prepend the
        # captured ones at the end so the final ordering is
        # external-mutations-first, cascade-second — the right
        # reading order for an operator debugging a cascade.
        pre_cycle_changes = list(self._changes)
        self._changes = []
        self._registrations = []
        # Snapshot broken-tier reasons at cycle entry so the
        # post-response HUD can surface *why* the cascade fired
        # — purely a diagnostic. Captured here, before any of
        # this update's mutations add their own reasons,
        # AND before :meth:`_run_cascade` clears the live
        # ``_broken_reasons`` map at end-of-cycle. The
        # snapshot stays readable via
        # :meth:`get_entry_broken_reasons` until the next
        # update overwrites it. Mutations during this update
        # (graduations, demotions, promotions, backfill, etc.)
        # accumulate on the live ``_broken_reasons`` and the
        # HUD also reads them via :meth:`get_changes`-derived
        # buckets — so the snapshot here covers *only* the
        # external triggers that motivated the cascade.
        self._entry_broken_reasons: dict[Tier, list[str]] = {
            tier: list(reasons)
            for tier, reasons in self._broken_reasons.items()
        }
        # NOTE: _broken_tiers is NOT wiped here. External mutation
        # paths (cross-reference disable, file exclusion, selection
        # change, history purge) populate it between turns; wiping
        # on entry would discard those signals before the cascade
        # could act on them. Broken tiers accumulate from all
        # sources and are consumed by the cascade — cleared at the
        # end of :meth:`_run_cascade` once the cascade has
        # stabilised.

        # Phase 0 — stale removal. Also filters active_items so
        # Phase 1 doesn't re-register entries for files that no
        # longer exist. Without this filter, a file deleted
        # between the orchestrator building active_items and the
        # tracker running stale removal would get re-created as
        # a fresh active entry moments after Phase 0 dropped it.
        if existing_files is not None:
            self._remove_stale(existing_files)
            active_items = self._filter_active_items(
                active_items, existing_files
            )

        # Phase 1 — process active items. Hash compare, uniform
        # age increment, edit teleport, cleanup of file:*/history:*
        # items no longer present. No graduation happens here —
        # Active→L3 is decided by the relaxation loop in Phase 4.
        self._process_active_items(active_items)

        # Phase 2b — controlled history graduation. History is
        # immutable so the flux equation's V/c imbalance is the
        # wrong signal. Per specs4/3-llm/cache-tiering.md §
        # "History Graduation", history graduates only when L3
        # is already broken this cycle — a piggyback on an
        # invalidation that's going to rebuild the L3 cache block
        # anyway. Runs BEFORE the relaxation loop so any history
        # additions to L3 participate uniformly in the flux
        # equation.
        self._graduate_history_if_eligible()

        # Phase 4/5 — run relax loop, clear broken-tiers
        # diagnostic state. Replaces the legacy cascade.
        self._run_cascade()

        # Prepend the pre-cycle changes (external mutations
        # captured at update() entry) so the final log reads
        # external-first, cascade-second.
        if pre_cycle_changes:
            self._changes = pre_cycle_changes + self._changes

        return self.get_changes()

    # ------------------------------------------------------------------
    # Phase 0 — stale removal
    # ------------------------------------------------------------------

    def _remove_stale(self, existing_files: set[str]) -> None:
        """Drop tracked items whose underlying file no longer exists.

        Under D36 there is no deletion marker. When a file is
        deleted during the session:

        - Its ``file:<path>`` tracker entry (if any) is removed
          outright. The file is no longer renderable.
        - Its presence in any ``symbols:<dir>`` / ``docs:<dir>``
          / ``plain_files:<dir>`` block is owned by the dir-block
          indexer; removing the file from that block produces a
          new block hash, which Phase 1 detects and teleports
          the block to Active to re-ride the flux.

        ``url:`` and ``history:`` keys have no filesystem
        dependency and are left alone. Dir-block keys
        (``symbols:``, ``docs:``, ``plain_files:``) reference
        directories rather than individual files; their stale
        cleanup is handled by the indexer's own per-turn
        rebuild, not here.

        Any tier that loses an item is marked broken so the
        cascade pass reconsiders it.

        Spec: ``specs4/3-llm/cache-tiering.md`` § Item Removal.
        """
        to_remove: list[str] = []
        for key, item in self._items.items():
            path = self._path_from_key(key)
            if path is None:
                continue
            if path in existing_files:
                continue
            to_remove.append(key)

        for key in to_remove:
            item = self._items.pop(key)
            self._mark_broken(item.tier, "stale file removal")
            self._log_change(
                f"{item.tier.value} → removed (stale): {key}"
            )

    @staticmethod
    def _path_from_key(key: str) -> str | None:
        """Extract the file path suffix from a per-file key.

        Returns None for keys that don't reference a single
        file path. Under D36 only ``file:`` keys reference
        individual files; dir-block keys (``symbols:``,
        ``docs:``, ``plain_files:``) reference directories
        and are not subject to per-file stale removal.
        ``url:``, ``history:`` keys have no filesystem
        dependency. Used by Phase 0 stale removal and by tests.
        """
        if key.startswith("file:"):
            return key[len("file:"):]
        return None

    @classmethod
    def _filter_active_items(
        cls,
        active_items: dict[str, dict[str, Any]],
        existing_files: set[str],
    ) -> dict[str, dict[str, Any]]:
        """Drop file-ish entries whose path is not in existing_files.

        Companion to :meth:`_remove_stale` — Phase 0 drops stale
        tracker entries, this filter drops stale active-items
        entries for the same cycle so Phase 1 does not resurrect
        them. Non-file-ish keys (``system:``, ``url:``,
        ``history:``) pass through unchanged.
        """
        filtered: dict[str, dict[str, Any]] = {}
        for key, payload in active_items.items():
            path = cls._path_from_key(key)
            if path is not None and path not in existing_files:
                continue
            filtered[key] = payload
        return filtered

    # ------------------------------------------------------------------
    # Phase 1 — process active items
    # ------------------------------------------------------------------

    def _process_active_items(
        self,
        active_items: dict[str, dict[str, Any]],
    ) -> None:
        """Compare hashes, age every tracked item, clean up departed.

        Per ``specs4/3-llm/cache-tiering.md`` § Per-Item State, ``n``
        increments by 1 per cycle for every tracked item — the
        membrane model treats it as a pure age counter, decoupled
        from promotion eligibility above the Active→L3 admission
        floor. Items present in ``active_items`` then have their
        hash and tokens reconciled; mismatch teleports them to
        Active with ``n=0`` (the only downward force in the
        rectified variants). Active→L3 graduation is no longer
        threshold-driven here — the relaxation loop in
        :func:`ac_dc.cache_membrane.relax` decides flux moves
        based on token-mass imbalance and the per-membrane
        ``n_admit`` floor.
        """
        # Uniform age increment — every tracked item, including
        # cached-tier residents that don't appear in active_items
        # this cycle, ages by one. The flux equation reads tokens
        # and counts, but the Active→L3 admission floor reads
        # ``n``, and pinned/marker entries that sit in upper
        # tiers without an active_items appearance must still
        # age so their pick-rule tiebreakers stay stable.
        for item in self._items.values():
            item.n_value += 1

        # Step 1 — process every currently-active item.
        for key, payload in active_items.items():
            new_hash = payload.get("hash", "")
            new_tokens = payload.get("tokens", 0)

            existing = self._items.get(key)
            if existing is None:
                # New item — register at active with N=0.
                # The change log records *transitions* between
                # tiers, and a fresh registration is not a
                # transition (the item didn't exist before).
                # Existing tests rely on the change log being
                # empty when no transitions have occurred, so
                # we route registrations into a separate
                # ``_registrations`` list instead. The HUD
                # reads both lists so operators still see ➕
                # entries for newly-selected files, newly-
                # fetched URLs, freshly-mentioned symbols.
                self._items[key] = TrackedItem(
                    key=key,
                    tier=Tier.ACTIVE,
                    n_value=0,
                    content_hash=new_hash,
                    tokens=new_tokens,
                )
                self._registrations.append(
                    f"new → active: {key} (registered)"
                )
                continue

            # Existing item — update tokens (always — tokens may
            # change due to re-rendering without a structural
            # change), then decide on hash comparison. Aging
            # (``n_value += 1``) was already applied uniformly
            # at the top of this method; the only paths that
            # touch n_value here are first-measurement (no
            # change) and hash-mismatch (reset to 0).
            existing.tokens = new_tokens

            if existing.content_hash == _PLACEHOLDER_HASH:
                # First-measurement acceptance — items seeded from
                # the reference graph with empty-string hash
                # accept their first real hash without demoting.
                # Without this, every initialised item would
                # demote on the first request after startup.
                existing.content_hash = new_hash
            elif existing.content_hash != new_hash:
                # Hash changed — teleport to active, reset N.
                # Per spec § Edit Invariant: this is the only
                # downward force in the rectified variants.
                old_tier = existing.tier
                existing.content_hash = new_hash
                existing.n_value = 0
                if old_tier != Tier.ACTIVE:
                    existing.tier = Tier.ACTIVE
                    self._mark_broken(old_tier, "hash changed")
                    self._log_change(
                        f"{old_tier.value} → active: {key} (hash changed)"
                    )
            # Else: unchanged hash. Aging already applied at
            # the top of this method. The relaxation loop
            # decides flux promotion below.

        # Step 2 — clean up file:* and history:* items that are
        # no longer in the active list. These departed from
        # context (file deselected, history compacted). Dir-block
        # entries (symbols:*, docs:*, plain_files:*) are NOT
        # cleaned up this way — they represent repo structure
        # and persist in their earned tier even when not
        # actively referenced this request.
        #
        # Under the membrane / flux cache model, deselected
        # files no longer need pin protection — the parent
        # directory's ``symbols:<dir>`` / ``docs:<dir>`` /
        # ``plain_files:<dir>`` block continues to represent
        # the file's structural presence, and the user can
        # re-select to pull the full text back into context.
        for key in list(self._items.keys()):
            if key in active_items:
                continue
            if not (key.startswith("file:") or key.startswith("history:")):
                continue
            item = self._items[key]
            self._items.pop(key)
            self._mark_broken(item.tier, "item departed")
            self._log_change(
                f"{item.tier.value} → removed: {key} (not in active)"
            )

    # ------------------------------------------------------------------
    # Phase 2b — controlled history graduation
    # ------------------------------------------------------------------

    def _graduate_history_if_eligible(self) -> None:
        """Graduate history to L3 on piggyback only.

        Per specs4/3-llm/cache-tiering.md § "History Graduation",
        history does not follow the standard N-based promotion
        path. The single gate that permits graduation is:

        - **Piggyback** — if L3 is already in ``_broken_tiers``
          this cycle (because some file/symbol graduated into
          it, or some L3 item demoted/promoted out), the cache
          block is going to be rebuilt regardless. Graduating
          history at the same time costs nothing extra in
          cache churn — we get the history into a cached tier
          "for free".

        When the gate does not hold, history stays in active.
        When ``cache_target_tokens == 0``, the entire mechanism
        is disabled and history remains active permanently.

        Earlier revisions also graduated on a token-threshold
        rule (active history tokens > cache_target_tokens).
        That rule misfired — cache_target_tokens is a small
        per-tier caching floor (~4 KB on Opus), not a
        conversation-length cap. Active history routinely
        blows past it after a handful of exchanges, and the
        rule then fired every turn, tearing down L3's cache on
        every request. Unbounded active history is a concern
        for compaction (which has its own much larger
        ``trigger_tokens`` budget and purges tracker history
        when it runs), not for cache tiering.

        Graduation walks NEWEST → OLDEST, accumulating tokens
        into a verbatim window sized at ``cache_target_tokens``.
        Everything newer than the window stays in active;
        everything older graduates to L3 at L3's entry N.

        Marks L3 broken when any graduation occurs so downstream
        cascade passes see the invalidation. A no-op piggyback
        (gate passed but no items graduated — the whole history
        fits in the verbatim window) leaves ``_broken_tiers``
        untouched.
        """
        if self._cache_target_tokens <= 0:
            # Never rule — history stays active when caching is
            # disabled.
            return

        # Piggyback gate — only fires when L3 is already being
        # rebuilt this cycle by some *other* cause. Nothing else.
        #
        # The original gate was "L3 in broken_tiers". That
        # misfires when ``purge_history`` (called by
        # compaction, new_session, session-load) wipes
        # history items from L3 — purge marks L3 broken with
        # reason "history purge", and on the next update the
        # gate naively passes, dragging the freshly-registered
        # post-compaction history straight into L3 and
        # defeating the verbatim window. The compaction work
        # was wasted: the user's recent messages, which
        # compaction took care to keep verbatim, get cached
        # away on the very next turn.
        #
        # The intent is "free ride on someone *else's*
        # invalidation". History-caused invalidations
        # (history purge, history piggyback itself) are
        # excluded — they're not free rides, they're history
        # paying its own freight. ``hash changed`` /
        # ``stale file removal`` / ``flux move`` /
        # ``cross-ref seed`` / ``item departed`` from
        # non-history items all qualify; ``history purge``
        # and ``history piggyback`` do not.
        l3_reasons = self._broken_reasons.get(Tier.L3, ())
        non_history_reasons = [
            r for r in l3_reasons
            if "history" not in r
        ]
        if not non_history_reasons:
            return

        # Collect active history items and sort newest → oldest
        # by index. Keys are ``history:{N}`` where N is the
        # conversation-order index — higher N means more recent.
        active_history: list[tuple[int, TrackedItem]] = []
        for key, item in self._items.items():
            if item.tier != Tier.ACTIVE:
                continue
            if not key.startswith("history:"):
                continue
            try:
                idx = int(key[len("history:"):])
            except ValueError:
                continue
            active_history.append((idx, item))
        if not active_history:
            return
        active_history.sort(key=lambda p: p[0], reverse=True)

        # Walk newest → oldest, keeping the verbatim window. The
        # first message whose inclusion would overflow the window
        # becomes the boundary; it and every older message
        # graduates to L3.
        accumulated = 0
        graduation_boundary: int | None = None
        for idx, item in active_history:
            if accumulated + item.tokens > self._cache_target_tokens:
                graduation_boundary = idx
                break
            accumulated += item.tokens
        if graduation_boundary is None:
            # Whole history fits in the verbatim window. Nothing
            # to graduate — the piggyback gate passed but there's
            # no item to promote. Leave everything in active.
            return

        l3_entry_n = _TIER_CONFIG[Tier.L3]["entry_n"]
        graduated_any = False
        for idx, item in active_history:
            if idx > graduation_boundary:
                # Newer than the boundary — stays in verbatim
                # window.
                continue
            item.tier = Tier.L3
            item.n_value = l3_entry_n
            self._log_change(
                f"active → L3: history:{idx} (piggyback)"
            )
            graduated_any = True

        if graduated_any:
            self._mark_broken(Tier.L3, "history piggyback")

    # ------------------------------------------------------------------
    # Phases 2/3/4/5 — relaxation cascade
    # ------------------------------------------------------------------

    def _run_cascade(self) -> None:
        """Drive the membrane / flux relaxation loop.

        Replaces the legacy N-counter cascade. The relaxation
        loop iterates to within-turn flux equilibrium across
        the four live membranes (Active→L3, L3→L2, L2→L1,
        L1→L0). Under D36 every tier participates in flux
        uniformly; L0 is no longer content-typed.

        Pipeline (matches ``specs4/3-llm/cache-tiering.md`` §
        Order of Operations Phases 3–5):

        - **Phase 3** — already done in :meth:`update` before
          this call (history piggyback graduation).
        - **Phase 4** — call :func:`ac_dc.cache_membrane.relax`
          with the live ``_items`` and the configured
          :class:`FluxConfig`. Direction is fixed by the
          rectification clamp (Φ ≥ 0); the deadband threshold
          absorbs steady-state noise so quiet turns
          self-arrest. Each move logs to ``_changes`` and
          marks both source and destination tiers broken
          (HUD diagnostic).
        - **Phase 5** — clear ``_broken_tiers`` and
          ``_broken_reasons``. External callers will repopulate
          between turns.
        """
        stats = relax(
            list(self._items.values()),
            config=self._flux_config,
            tier_of=lambda f: _TIER_TO_IDX[f.tier],
            set_tier=self._apply_relax_move,
            n_of=lambda f: f.n_value,
            tokens_of=lambda f: f.tokens,
            key_of=lambda f: f.key,
            # ``history:*`` items are excluded from regular flux —
            # they only enter L3 via the piggyback path
            # (:meth:`_graduate_history_if_eligible`), which fires
            # only when L3 is already broken by another mutation.
            # Otherwise the conversation would churn the L3 cache
            # block on every stable turn.
            #
            # Pinned items (edit invariant — see :meth:`pin_file`)
            # are also protected: a file edited mid-session keeps
            # its truthful current text in its current tier until
            # the next manual rebuild clears the pin.
            is_protected=lambda f: (
                f.key.startswith("history:")
                or self.is_pinned(f.key)
            ),
            # D37 — history is also excluded from V/c
            # accumulation, not just mover selection. Bytes still
            # sit in L3 (and the prompt is truthful), but the
            # flux equation does not interpret a long L3 history
            # block as pressure. Pinned files do NOT match here:
            # their mass is real and contributes to V even though
            # they cannot move.
            is_balance_excluded=lambda f: f.key.startswith("history:"),
        )
        if stats.iters >= 1000:
            logger.warning(
                "stability_tracker: relax loop did not converge "
                "(iters=%d, moves=%d)",
                stats.iters,
                len(stats.moves),
            )

        # Phase 5 — broken-tier signals consumed. Next cycle
        # starts fresh; external mutations between now and the
        # next :meth:`update` repopulate the set.
        self._broken_tiers.clear()
        self._broken_reasons.clear()

    def _apply_relax_move(self, item: TrackedItem, new_idx: int) -> None:
        """Set-tier callback used by :func:`relax`.

        Records the change-log entry, marks both source and
        destination tiers broken, and resets ``n_value`` to 0
        on the destination so the per-membrane ``n_admit``
        floor on a *subsequent* turn applies cleanly. (For
        upward moves the floor is only meaningful on the
        Active→L3 membrane; resetting on every move keeps the
        semantics uniform.)
        """
        old_tier = item.tier
        new_tier = _IDX_TO_TIER[new_idx]
        item.tier = new_tier
        # ``n`` resets on every flux move — the age counter
        # measures residency-since-last-edit-or-move, which
        # is what the Active→L3 admission floor wants. For
        # higher membranes (n_admit=0) the reset is harmless.
        item.n_value = 0
        self._mark_broken(old_tier, "flux move (source)")
        self._mark_broken(new_tier, "flux move (destination)")
        self._log_change(
            f"{old_tier.value} → {new_tier.value}: "
            f"{item.key} (flux)"
        )

    # ------------------------------------------------------------------
    # Initialisation — mtime-based dir-block seeding
    # ------------------------------------------------------------------

    def initialize_dir_blocks(
        self,
        keys_with_mtimes: list[tuple[str, float] | tuple[str, float, int]],
    ) -> None:
        """Seed dir-block entries across L0–L3 by directory mtime.

        Under D36 the cache initialisation strategy is mtime-
        based rather than reference-graph clustering. The
        seed direction is **edit-cost-aware**: hot directories
        (recently-modified) seed *cooler* tiers so they sit
        near the bottom of the cache, and cold directories
        (untouched in a long time) seed *warmer* tiers up to
        and including L0.

        The reasoning: an mtime-hot directory is the most
        likely to be edited again soon. When that edit lands,
        the affected dir-block teleports to Active (the
        rectified membrane's only downward force), invalidating
        whichever cached tier it currently occupies. Tearing
        down a small L3 cache block on every edit is cheap;
        tearing down L0 is expensive — L0 is the largest
        cached block, sits closest to the prefix root, and a
        misplaced hot block at L0 forces the rest of L0 to be
        re-cached on every churn. Seeding hot content at L3
        absorbs the churn near the membrane's entry point.

        Cold content at L0 is the right invariant: it's
        unlikely to be edited soon, so the L0 cache block
        survives across many turns. If a cold directory
        suddenly *does* get edited, it teleports to Active
        and re-rides the flux — same cost as any other edit.
        The bet is that "recently edited" predicts "likely to
        be edited again soon" more often than not, which
        matches typical interactive coding (sessions are
        usually continuations of recent work, not pivots to
        long-untouched code).

        The membrane controller takes over from there: across
        the next few request cycles, the rectified-flux loop
        rebalances based on real token mass and aging signals,
        and the initial mtime-based seed becomes incidental.

        Parameters
        ----------
        keys_with_mtimes:
            List of ``(key, mtime)`` or ``(key, mtime, tokens)``
            tuples for every dir-block to seed. ``key`` is a
            fully-prefixed tracker key (``symbols:<dir>``,
            ``docs:<dir>``, ``plain_files:<dir>``). ``mtime``
            is the directory's most recent file mtime (seconds
            since epoch) — :meth:`Repo.get_directory_mtime`
            returns ``max(file.stat().st_mtime for file in
            dir)``, so a directory with one freshly-edited
            file and many cold files registers as hot. 0.0
            for empty / non-existent directories. ``tokens``
            is the rendered block's real token count when the
            caller has measured it — passing it here avoids
            the Context-tab-before-first-turn window where
            every seeded item shows a placeholder count. When
            omitted the placeholder
            (:data:`_PLACEHOLDER_TOKENS`) is used as a stop-
            gap until the first :meth:`update` cycle replaces
            it with a measured value.

        Tier assignment splits the sorted-by-mtime-descending
        list into four roughly-equal quartiles: hottest →
        **L3**, then L2, L1, and coolest → **L0**. Ties on
        mtime fall back to alphabetical key ordering for
        determinism.

        Items receive an empty hash regardless; Phase 1 of
        the next :meth:`update` cycle accepts the first real
        hash without demoting.
        """
        if not keys_with_mtimes:
            return

        # Sort hottest-first; ties broken by key for
        # determinism so test fixtures see stable output.
        # Sort key uses mtime + key, ignoring the optional
        # tokens slot.
        ranked = sorted(
            keys_with_mtimes,
            key=lambda pair: (-pair[1], pair[0]),
        )
        n = len(ranked)
        # Quartile boundaries — hottest quartile lands at
        # L3 (cheapest to invalidate when edits happen),
        # coldest at L0 (most expensive to invalidate, but
        # least likely to be edited soon).
        tier_order = (Tier.L3, Tier.L2, Tier.L1, Tier.L0)
        for idx, entry in enumerate(ranked):
            key = entry[0]
            tokens = (
                entry[2] if len(entry) >= 3 else _PLACEHOLDER_TOKENS
            )
            quartile = min(
                len(tier_order) - 1,
                idx * len(tier_order) // n,
            )
            tier = tier_order[quartile]
            self._items[key] = TrackedItem(
                key=key,
                tier=tier,
                n_value=_TIER_CONFIG[tier]["entry_n"],
                content_hash=_PLACEHOLDER_HASH,
                tokens=tokens,
            )

    def cross_ref_seed_dir_blocks(
        self,
        keys_with_mtimes: list[tuple[str, float] | tuple[str, float, int]],
    ) -> None:
        """Append cross-ref dir-block keys, distributed across L1–L3.

        Used by cross-reference enable to seed opposite-index
        dir-blocks (the docs side in code mode, or the symbols
        side in doc mode) into cached tiers on activation. The
        primary index has already claimed its share via
        :meth:`initialize_dir_blocks`; the cross-ref pass adds
        the secondary set without touching any existing entries
        and without competing for L0 (reserved as the warmest
        tier for primary content).

        Keys already present in the tracker are skipped —
        preserves accumulated tier / N state from a prior
        cross-ref session.

        Parameters
        ----------
        keys_with_mtimes:
            List of ``(key, mtime)`` or ``(key, mtime, tokens)``
            tuples for every dir-block to seed. Same shape as
            :meth:`initialize_dir_blocks` — when the caller has
            already rendered the block, passing real tokens
            here avoids the placeholder-count window in the
            Context tab.

        Distribution strategy mirrors
        :meth:`initialize_dir_blocks`: hottest → **L3** (the
        cheapest tier to invalidate when an edit lands),
        middle → L2, coldest → **L1**. L0 stays reserved for
        primary content on cross-reference seeding so the
        secondary index has one membrane of climbing to do
        before it can compete for the top slot. The cascade
        promotes earned content upward across subsequent
        requests.
        """
        if not keys_with_mtimes:
            return

        new_pairs = [
            entry
            for entry in keys_with_mtimes
            if entry[0] not in self._items
        ]
        if not new_pairs:
            return

        ranked = sorted(
            new_pairs,
            key=lambda pair: (-pair[1], pair[0]),
        )
        n = len(ranked)
        tier_order = (Tier.L3, Tier.L2, Tier.L1)
        affected_tiers: set[Tier] = set()
        for idx, entry in enumerate(ranked):
            key = entry[0]
            tokens = (
                entry[2] if len(entry) >= 3 else _PLACEHOLDER_TOKENS
            )
            third = min(
                len(tier_order) - 1,
                idx * len(tier_order) // n,
            )
            tier = tier_order[third]
            self._items[key] = TrackedItem(
                key=key,
                tier=tier,
                n_value=_TIER_CONFIG[tier]["entry_n"],
                content_hash=_PLACEHOLDER_HASH,
                tokens=tokens,
            )
            affected_tiers.add(tier)

        # Mark destination tiers broken so the next cascade
        # rebuilds the provider cache to include the new
        # content. Without this, the next request would use
        # stale cache breakpoints that predate the seeding.
        for tier in affected_tiers:
            self._mark_broken(tier, "cross-ref seed")

    # ------------------------------------------------------------------
    # Token measurement hook
    # ------------------------------------------------------------------

    def measure_tokens(self, key: str, tokens: int) -> None:
        """Update the token count for a tracked item.

        Called by the orchestrator after initialisation to
        replace placeholder token counts with real ones (derived
        from formatted output). A no-op for unknown keys.
        """
        item = self._items.get(key)
        if item is None:
            return
        item.tokens = tokens

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _log_change(self, description: str) -> None:
        """Record a tier change for the cycle's change log.

        Wrapped so future enhancements (structured log records,
        event dispatch) have one place to hook.
        """
        self._changes.append(description)
        logger.debug("tier change: %s", description)