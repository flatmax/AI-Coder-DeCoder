"""Stability tracker — cache tier assignment for prompt content.

Drives the prompt-cache breakpoint placement that makes AC-DC's
large-context usage affordable. Content that stays structurally
unchanged across requests promotes upward across tier membranes
(Active → L3 → L2 → L1), driven by the rectified-flux controller
in :mod:`ac_dc.cache_membrane`. Content whose content hash changes
teleports to ``active`` with ``n=0`` and re-climbs from there.

This module owns tier assignments only. The streaming handler
(Layer 3.6) builds the active-items list each request and calls
:meth:`StabilityTracker.update`; the prompt assembler (Layer 3.7)
reads tier assignments via :meth:`get_tier_items`.

Governing specs:

- ``specs4/3-llm/cache-tiering.md`` — the contract-level spec
- ``specs-reference/3-llm/cache-tiering.md`` — the numeric detail
  reference
- ``specs4/impl-history/decisions.md`` D35 — the membrane / flux
  controller landed; rectified-GHK is the only supported variant

Design points pinned by the test suite and spec:

- **Per-context-manager scope.** The tracker is owned by its
  context manager. A future parallel-agent mode (D10) creates one
  tracker per agent; they share no state. Mode switching swaps
  between two trackers that the user-facing context manager
  points at — each mode preserves its own tier state when
  inactive.

- **Key prefixes dispatch by content type.** ``system:``,
  ``file:``, ``symbol:``, ``doc:``, ``url:``, ``history:``. The
  tracker itself doesn't interpret content — it just tracks the
  keys. Downstream consumers (prompt assembler, cache viewer)
  dispatch rendering on the prefix.

- **`n` is a pure age counter** — turns since last edit. Aged
  ``+1`` on every item every cycle. Reset to ``0`` only by
  hash mismatch (the edit invariant). The Active → L3 membrane
  has an admission floor ``n_admit`` (default 3) so newly-
  registered items cannot graduate until they have aged.

- **Promotion is rectified flux across membranes.** Each turn,
  the relaxation loop iterates to local equilibrium across the
  three live membranes (Active→L3, L3→L2, L2→L1). The L1→L0
  membrane is disabled — L0 is content-typed (D27) and is
  populated only by init / rebuild / cross-reference paths.

- **Direction and quiescence are intrinsic to the flux
  equation.** The rectification clamp pins direction (Φ ≥ 0
  — controller is upward-only); the deadband threshold
  absorbs steady-state noise so quiet turns with V ≈ 0 across
  all membranes self-arrest on the first pass without firing.
  The broken-tier set survives as a HUD diagnostic and as the
  gate for history-piggyback graduation, but no longer feeds
  the flux loop.

- **Edit invariant.** A hash mismatch teleports the file to
  Active with ``n = 0``. The entry is pinned; subsequent
  deselection / stale-cleanup skips it. Only application
  restart or explicit ``rebuild_cache`` clears pins.

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
# The shape ``{"entry_n": int, "promote_n": int}`` is preserved
# for backwards-compatibility with callers in
# ``ac_dc.llm._rebuild`` and ``ac_dc.llm._breakdown`` that read
# ``entry_n`` when materialising fresh items. The ``promote_n``
# values are no longer load-bearing — the relaxation loop in
# :mod:`ac_dc.cache_membrane` does not consult them — and are
# kept in place only so callers that read the dict shape don't
# break. New code should reach for the membrane parameters
# directly via :class:`FluxConfig`.
_L0_PROMOTE_SENTINEL = 9_999_999

_TIER_CONFIG: dict[Tier, dict[str, int]] = {
    Tier.ACTIVE: {"entry_n": 0, "promote_n": 3},
    Tier.L3: {"entry_n": 3, "promote_n": 6},
    Tier.L2: {"entry_n": 6, "promote_n": 9},
    Tier.L1: {"entry_n": 9, "promote_n": 12},
    Tier.L0: {"entry_n": 12, "promote_n": _L0_PROMOTE_SENTINEL},
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


# Deletion-marker text rendered into the prompt when a file is
# deleted during the session. The marker preserves the file's
# tracker entry (path-keyed) but replaces its content with this
# fixed string. Constant text means a constant hash, so deletion
# markers don't churn the cascade — they're stable from the
# tracker's perspective and survive until the next
# ``rebuild_cache`` (which re-extracts L0's aggregate maps from
# the now-current index, dropping references to the deleted file).
#
# Byte-identity matters: keep this string verbatim. The cache
# breakpoint hashes content directly and any wording variation
# would produce a different hash, defeating the
# stable-across-deletions invariant. Multiple deleted files
# legitimately share the same marker representation — that's
# the design.
#
# Spec: ``specs4/3-llm/cache-tiering.md`` § Deletion Markers.
# Reference: ``specs-reference/3-llm/cache-tiering.md`` §
# Deletion marker content.
DELETION_MARKER_TEXT = (
    "[deleted in this session — see L0 symbol/doc map for "
    "last-known structure]"
)


# Pre-computed hash of :data:`DELETION_MARKER_TEXT`. Cached at
# import time so the cascade doesn't re-hash the same constant
# on every Phase 0 deletion check.
def _compute_deletion_marker_hash() -> str:
    import hashlib

    return hashlib.sha256(
        DELETION_MARKER_TEXT.encode("utf-8")
    ).hexdigest()


_DELETION_MARKER_HASH = _compute_deletion_marker_hash()

# Placeholder token count — during initialisation we don't have
# real token counts (the formatted blocks haven't been rendered
# yet). A small per-entry estimate is used so L0 seeding doesn't
# over-fill. Real counts replace these on the first update cycle
# or via :meth:`_measure_tokens`.
#
# Chosen as a deliberate underestimate of real symbol/doc block
# sizes. Typical per-file symbol blocks measure at 80-300 tokens
# after rendering; typical doc blocks at 50-200. Using a
# conservative 100 here means L0 seeding packs ~4x as many files
# into L0 as a 400-token estimate would, so after measurement
# L0's real token total lands closer to the cache target rather
# than dramatically undershooting. The post-measurement backfill
# catches any remaining shortfall, but starting closer to target
# reduces the number of items backfill has to promote (each
# promotion marks a source tier broken and triggers a cascade
# pass on the next request — cheaper to over-seed initially than
# to churn tiers on the first cold-start).
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

    # ------------------------------------------------------------------
    # Pin flag and deletion marker helpers (L0-content-typed model)
    # ------------------------------------------------------------------

    def pin_file(self, key: str) -> bool:
        """Mark a ``file:`` entry as edit-pinned.

        Pinned entries are protected from automatic eviction
        — stale-cleanup and underfill demotion skip them. The
        edit invariant in the L0-content-typed model says: when
        a file's content hash changes during the session, its
        full text must remain present in some cached tier
        until application restart or explicit ``rebuild_cache``,
        even if the user deselects it. Pinning is the
        mechanism.

        Only ``file:`` keys can be pinned; calling on other
        prefixes is a no-op (returns False). Calling on an
        unknown key is also a no-op (returns False).

        Returns True when the pin was applied (or was already
        in place), False when the call had no effect.

        Spec: ``specs4/3-llm/cache-tiering.md`` § Edit Invariant.
        """
        if not key.startswith("file:"):
            return False
        item = self._items.get(key)
        if item is None:
            return False
        item._pinned = True  # type: ignore[attr-defined]
        return True

    def unpin_file(self, key: str) -> bool:
        """Clear the edit-pin flag on a ``file:`` entry.

        Used by ``rebuild_cache`` to clear all pins as part of
        the explicit reset — the user's "fresh start" gesture
        supersedes per-file edit history. Returns True when the
        pin was cleared, False when the entry was unknown or
        was not previously pinned.
        """
        if not key.startswith("file:"):
            return False
        item = self._items.get(key)
        if item is None:
            return False
        had_pin = bool(getattr(item, "_pinned", False))
        item._pinned = False  # type: ignore[attr-defined]
        return had_pin

    def is_pinned(self, key: str) -> bool:
        """Return True when ``key`` is a pinned ``file:`` entry."""
        item = self._items.get(key)
        if item is None:
            return False
        return bool(getattr(item, "_pinned", False))

    def mark_deleted(self, key: str) -> bool:
        """Convert a ``file:`` entry to a deletion marker.

        Replaces the item's content hash with the constant
        :data:`_DELETION_MARKER_HASH` and updates its token
        count to the marker text's measured length. Tier and
        N value are preserved — the entry rides the cascade
        from wherever it was (typically demoted to ACTIVE on
        the next update because the hash changed, then
        graduating upward as it stabilises).

        Pin flag is cleared because deletion markers are
        intrinsically stable (constant hash) and don't need
        pin-protection — only ``rebuild_cache`` and
        application restart clear them, and both already
        clear pin flags as part of their reset semantics.

        Returns True on success, False when the key is
        unknown or doesn't have a ``file:`` prefix.

        Spec: ``specs4/3-llm/cache-tiering.md`` §
        Deletion Markers and § Item Removal.
        """
        if not key.startswith("file:"):
            return False
        item = self._items.get(key)
        if item is None:
            return False
        item.content_hash = _DELETION_MARKER_HASH
        # Token count for the marker text. We measure it once
        # at module load if a counter is available; otherwise
        # fall back to a coarse character count. The exact
        # number doesn't matter much for cascade dynamics —
        # the marker text is short — but rendering accuracy
        # for the cache viewer expects a real-ish count.
        item.tokens = len(DELETION_MARKER_TEXT)
        item._pinned = False  # type: ignore[attr-defined]
        item._deleted = True  # type: ignore[attr-defined]
        return True

    def is_deleted(self, key: str) -> bool:
        """Return True when ``key`` is a deletion-marker entry.

        Distinct from :meth:`is_pinned` — a deletion marker
        is NOT pinned (the constant hash provides the
        protection that pinning would). The two flags never
        overlap; :meth:`mark_deleted` clears any prior pin.
        """
        item = self._items.get(key)
        if item is None:
            return False
        return bool(getattr(item, "_deleted", False))

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
        """Handle tracked items whose underlying file no longer exists.

        Two paths under the L0-content-typed model:

        - ``file:`` entries (pinned or not) transition to
          deletion-marker entries via :meth:`mark_deleted`.
          The entry stays in the tracker but its content and
          hash become the constant marker representation.
          The marker rides the cascade like a normal ``file:``
          entry; its constant hash means subsequent cycles
          see no change and N grows normally. Survives until
          the next ``rebuild_cache`` re-extracts L0's
          aggregate maps and removes the file from the
          structural index entirely.
        - ``symbol:`` and ``doc:`` entries are removed
          normally. These are tracker entries that haven't
          existed in the L0-content-typed model since
          startup-distribution was dropped (commit 3
          onward); the path is kept here for defensive
          cleanup of any leftover entries from earlier
          cycles or migrations.

        ``system:``, ``url:``, ``history:`` keys have no
        filesystem dependency and are left alone.

        Any tier that loses an item (or transitions a marker)
        is marked broken so the cascade pass reconsiders it.

        Spec: ``specs4/3-llm/cache-tiering.md`` § Item
        Removal and § Deletion Markers.
        """
        to_remove: list[str] = []
        to_mark_deleted: list[str] = []
        for key, item in self._items.items():
            path = self._path_from_key(key)
            if path is None:
                continue
            if path in existing_files:
                continue
            if key.startswith("file:"):
                # Transition to deletion marker — preserves
                # the entry's tier and N, replaces content
                # with the constant marker hash.
                to_mark_deleted.append(key)
            else:
                # symbol: / doc: — remove as before.
                to_remove.append(key)

        for key in to_remove:
            item = self._items.pop(key)
            self._mark_broken(item.tier, "stale file removal")
            self._log_change(
                f"{item.tier.value} → removed (stale): {key}"
            )

        for key in to_mark_deleted:
            item = self._items.get(key)
            if item is None:
                continue
            tier_label = item.tier.value
            self.mark_deleted(key)
            self._mark_broken(item.tier, "file deleted (marker)")
            self._log_change(
                f"{tier_label} → marker: {key} (file deleted)"
            )

    @staticmethod
    def _path_from_key(key: str) -> str | None:
        """Extract the file path suffix from a file-ish key.

        Returns None for keys that don't reference a file path
        (``system:``, ``url:``, ``history:``). Used by Phase 0
        stale removal and by tests.
        """
        for prefix in ("file:", "symbol:", "doc:"):
            if key.startswith(prefix):
                return key[len(prefix):]
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
                # Edit invariant — when a ``file:`` entry's
                # hash changes during the session, the file
                # has been edited and its full text must
                # remain cached until the next
                # ``rebuild_cache`` or application restart.
                # The pin flag protects against automatic
                # eviction (stale-cleanup, mover selection in
                # the relaxation loop). The transition out
                # of a deletion marker (file recreated at the
                # same path) does NOT pin — only edits to
                # existing files do.
                #
                # Spec: ``specs4/3-llm/cache-tiering.md`` §
                # Edit Invariant.
                was_marker = bool(
                    getattr(existing, "_deleted", False)
                )
                if key.startswith("file:") and not was_marker:
                    existing._pinned = True  # type: ignore[attr-defined]
                if was_marker:
                    # Re-creation: clear the deletion-marker
                    # flag. The file exists again; the entry
                    # behaves as a normal active item from
                    # here on.
                    existing._deleted = False  # type: ignore[attr-defined]
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
        # context (file deselected, history compacted). symbol:*
        # and doc:* items are NOT cleaned up this way — they
        # represent repo structure and persist in their earned
        # tier even when not actively referenced this request.
        #
        # Pinned ``file:`` entries (the edit invariant — see
        # above) and deletion-marker entries are also exempt:
        # they must survive deselection until the next
        # ``rebuild_cache`` or application restart. The
        # truthful current text of an edited file, or the
        # marker for a deleted-this-session file, stays in
        # the prompt regardless of selection state.
        for key in list(self._items.keys()):
            if key in active_items:
                continue
            if not (key.startswith("file:") or key.startswith("history:")):
                continue
            item = self._items[key]
            if key.startswith("file:") and (
                getattr(item, "_pinned", False)
                or getattr(item, "_deleted", False)
            ):
                # Pinned or marker — protected from departure
                # cleanup. Stays in its current tier. Active
                # items list will see it again on subsequent
                # cycles via the orchestrator's
                # ``file_context.get_files()`` (selected files)
                # OR via the deletion marker's path-keyed
                # presence in the tracker.
                continue
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
        # rebuilt this cycle. Nothing else.
        if Tier.L3 not in self._broken_tiers:
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
        the three live membranes (Active→L3, L3→L2, L2→L1).
        L1→L0 is structurally disabled — L0 is content-typed
        (D27) and is never written by the relaxation loop.

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
            is_protected=lambda f: bool(
                getattr(f, "_pinned", False)
                or getattr(f, "_deleted", False)
                or f.key.startswith("history:")
            ),
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
    # Initialisation from reference graph (startup seeding)
    # ------------------------------------------------------------------

    def initialize_from_reference_graph(
        self,
        ref_index: Any,
        files: list[str],
        l0_target_tokens: int | None = None,
    ) -> None:
        """Seed tier assignments from connectivity.

        Called at startup by the orchestrator. Runs the
        reference-graph clustering algorithm and distributes
        files across L1/L2/L3 based on connected components.
        Most-referenced files are seeded into L0 to meet the
        cache target on the first request.

        Parameters
        ----------
        ref_index:
            Object implementing :meth:`connected_components` and
            :meth:`file_ref_count`. Layer 2.4's
            :class:`ReferenceIndex` matches this shape, as does
            the doc-reference index.
        files:
            List of repo-relative file paths. Keys are built as
            ``symbol:{path}`` by default — callers that want doc
            mode should adjust keys before calling (or pass a
            pre-built items list; covered by
            :meth:`initialize_with_keys`).
        l0_target_tokens:
            Optional override for L0 seed capacity. Defaults to
            ``cache_target_tokens`` — which is the right choice
            for production but tests override it to exercise
            specific seed quantities.

        Per specs3 — items initialised this way get placeholder
        tokens and empty hash; Phase 1 accepts their first real
        hash without demoting.
        """
        self.initialize_with_keys(
            ref_index,
            keys=[f"symbol:{path}" for path in files],
            files=files,
            l0_target_tokens=l0_target_tokens,
        )

    def initialize_with_keys(
        self,
        ref_index: Any,
        keys: list[str],
        files: list[str],
        l0_target_tokens: int | None = None,
    ) -> None:
        """Seed with explicit keys — used by doc mode and tests.

        Distributes every key across all four cached tiers
        (L0/L1/L2/L3) by clustering connected components in the
        reference graph, then ranking clusters by aggregate
        incoming reference count, then bin-packing into tiers
        with the smallest current token total.

        **Why four-tier even split.** Earlier revisions seeded
        a target number of files into L0 up to
        ``cache_target_tokens`` and distributed the remainder
        across L1/L2/L3. On a sufficiently large repo that
        works, but on medium repos it under-fills L0 (because
        placeholder tokens overestimate real token counts —
        real measured tokens come in well under the 400-token
        placeholder, so L0's real post-measurement size lands
        way below the cache target). The four-tier split side-
        steps the problem: each tier gets ~25% of the repo's
        placeholder token budget, and the cascade sorts out
        which items genuinely deserve L0 residency via
        promotion/demotion over the next few request cycles.

        **Why stability-ranked cluster ordering.** Within the
        clustering pass, clusters are ranked by aggregate
        incoming ref count (sum of ``file_ref_count`` across
        the cluster's members) so the most-referenced
        structural clusters land in L0 on day one. Orphan
        files (no edges in the reference graph) sort last and
        fill whichever tier still has room. This gives the
        cascade a reasonable starting point — the anchor/cap/
        promote logic doesn't have to unwind bad initial
        placements across many turns before the provider cache
        becomes useful.

        **Ties — clusters of equal size and equal ref count**
        break deterministically by sorted member tuple so test
        fixtures see stable output across runs.

        The ``l0_target_tokens`` parameter is accepted for
        backwards compatibility with callers that pass the
        cache target; it is now ignored because the four-tier
        split makes it unnecessary. L0 ends up sized by fair-
        share budget, not by an explicit target.
        """
        if not keys:
            return
        if len(keys) != len(files):
            raise ValueError(
                f"keys length ({len(keys)}) must match "
                f"files length ({len(files)})"
            )

        # Unused — retained in signature for compatibility.
        del l0_target_tokens

        path_to_key = dict(zip(files, keys))
        all_paths = set(files)

        # Step 1 — gather connected components from the
        # reference graph and filter to the paths we're
        # actually placing. Components already seen (e.g. from
        # a prior init pass) are intentionally re-built here —
        # initialisation is a clean-slate operation.
        components = ref_index.connected_components()
        filtered_components: list[set[str]] = []
        seen_in_components: set[str] = set()
        for comp in components:
            filtered = {p for p in comp if p in all_paths}
            if filtered:
                filtered_components.append(filtered)
                seen_in_components.update(filtered)

        # Step 2 — orphan files (no edges in the reference
        # graph) become singleton "clusters" for the bin
        # packer. Without this, files with no references never
        # register.
        orphan_paths = all_paths - seen_in_components
        for p in sorted(
            orphan_paths,
            key=lambda pp: (-ref_index.file_ref_count(pp), pp),
        ):
            filtered_components.append({p})

        # Step 3 — rank clusters by aggregate stability. Sum
        # the incoming reference count across each cluster's
        # members so a five-file cluster where each member has
        # 3 incoming refs (aggregate 15) outranks a ten-file
        # cluster of orphans (aggregate 0). The ``-`` negates
        # for descending sort. Ties break by cluster size
        # descending (prefer placing larger clusters first so
        # the bin packer balances by token budget) and finally
        # by sorted member tuple for determinism.
        def _cluster_rank(
            comp: set[str],
        ) -> tuple[int, int, tuple[str, ...]]:
            aggregate = sum(
                ref_index.file_ref_count(p) for p in comp
            )
            return (-aggregate, -len(comp), tuple(sorted(comp)))

        filtered_components.sort(key=_cluster_rank)

        # Step 4 — bin-pack across all four cached tiers.
        # Greedy: each cluster goes to the tier with the
        # smallest current token total. Since we walk clusters
        # in descending-aggregate order, the first few (highest
        # ref count) clusters spread across L0/L1/L2/L3 before
        # any tier fills — but the L0 slot fills first on ties
        # because ``min`` picks in insertion order and L0 is
        # listed first below. Later, lower-ranked clusters
        # cluster toward whichever tier hasn't filled yet.
        tier_sizes = {
            Tier.L0: 0,
            Tier.L1: 0,
            Tier.L2: 0,
            Tier.L3: 0,
        }
        tier_contents: dict[Tier, list[str]] = {
            Tier.L0: [],
            Tier.L1: [],
            Tier.L2: [],
            Tier.L3: [],
        }
        tier_order_for_ties = {
            Tier.L0: 0,
            Tier.L1: 1,
            Tier.L2: 2,
            Tier.L3: 3,
        }

        for comp in filtered_components:
            target_tier = min(
                tier_sizes,
                key=lambda t: (
                    tier_sizes[t],
                    tier_order_for_ties[t],
                ),
            )
            for path in sorted(comp):
                key = path_to_key.get(path)
                if key is None:
                    continue
                tier_contents[target_tier].append(key)
            # Token budget uses placeholder tokens — real counts
            # replace these via :meth:`measure_tokens` after the
            # formatted blocks are rendered for the first time.
            tier_sizes[target_tier] += (
                len(comp) * _PLACEHOLDER_TOKENS
            )

        # Step 5 — instantiate TrackedItems at each tier's
        # entry N. Placeholder hash marks them as never-yet-
        # measured so the next :meth:`update` cycle accepts
        # their first real hash without demoting.
        for tier in (Tier.L0, Tier.L1, Tier.L2, Tier.L3):
            for key in tier_contents[tier]:
                self._items[key] = TrackedItem(
                    key=key,
                    tier=tier,
                    n_value=_TIER_CONFIG[tier]["entry_n"],
                    content_hash=_PLACEHOLDER_HASH,
                    tokens=_PLACEHOLDER_TOKENS,
                )

    def distribute_keys_by_clustering(
        self,
        ref_index: Any,
        keys: list[str],
        files: list[str],
    ) -> None:
        """Append keys to the tracker, distributed across L1/L2/L3.

        Used by cross-reference enable to seed opposite-index
        items into cached tiers on activation, mirroring how the
        primary index is distributed at startup — without the
        L0 seeding (L0 is reserved for primary content + the
        system prompt) and without touching any tracker entries
        that already exist.

        Keys already present in the tracker are skipped —
        preserves accumulated tier / N state from a prior
        cross-ref session, and keeps primary-index entries
        (``symbol:`` in code mode, ``doc:`` in doc mode) safe
        when the caller naively passes an overlapping key list.

        Uses placeholder hash and placeholder tokens; the
        caller should immediately measure real tokens via
        :meth:`measure_tokens` so downstream cascade passes
        work with accurate counts.

        Parameters
        ----------
        ref_index:
            Object implementing :meth:`connected_components` and
            :meth:`file_ref_count`. Same shape as
            :meth:`initialize_from_reference_graph` consumes.
        keys:
            List of tracker keys (e.g. ``doc:{path}`` or
            ``symbol:{path}``).
        files:
            Parallel list of repo-relative file paths.
        """
        if not keys:
            return
        if len(keys) != len(files):
            raise ValueError(
                f"keys length ({len(keys)}) must match "
                f"files length ({len(files)})"
            )

        # Skip keys already tracked — preserves existing tier
        # state from prior cross-ref enables and protects the
        # primary index's entries.
        pairs = [
            (key, path)
            for key, path in zip(keys, files)
            if key not in self._items
        ]
        if not pairs:
            return

        path_to_key = {path: key for key, path in pairs}
        remaining_paths = {path for _key, path in pairs}

        components = ref_index.connected_components()
        filtered_components: list[set[str]] = []
        seen_in_components: set[str] = set()
        for comp in components:
            filtered = {p for p in comp if p in remaining_paths}
            if filtered:
                filtered_components.append(filtered)
                seen_in_components.update(filtered)

        # Orphan files — not in any component. Each becomes its
        # own singleton "component" for the bin-packer.
        orphan_paths = remaining_paths - seen_in_components
        if orphan_paths:
            orphan_list = sorted(
                orphan_paths,
                key=lambda p: (-ref_index.file_ref_count(p), p),
            )
            for p in orphan_list:
                filtered_components.append({p})

        # Bin-pack across L1/L2/L3 — skip L0 (reserved for
        # primary content). Greedy: assign each component
        # (descending size) to the tier with the smallest
        # current size.
        tier_sizes = {Tier.L1: 0, Tier.L2: 0, Tier.L3: 0}
        tier_contents: dict[Tier, list[str]] = {
            Tier.L1: [],
            Tier.L2: [],
            Tier.L3: [],
        }
        filtered_components.sort(
            key=lambda c: (-len(c), tuple(sorted(c)))
        )
        for comp in filtered_components:
            target_tier = min(
                tier_sizes,
                key=lambda t: (tier_sizes[t], t.value),
            )
            for path in sorted(comp):
                key = path_to_key.get(path)
                if key is None:
                    continue
                tier_contents[target_tier].append(key)
            tier_sizes[target_tier] += len(comp)

        # Instantiate. Placeholder hash so Phase 1 of the next
        # update cycle accepts the first real hash without
        # demoting (same contract as primary init).
        affected_tiers: set[Tier] = set()
        for tier in (Tier.L1, Tier.L2, Tier.L3):
            for key in tier_contents[tier]:
                self._items[key] = TrackedItem(
                    key=key,
                    tier=tier,
                    n_value=_TIER_CONFIG[tier]["entry_n"],
                    content_hash=_PLACEHOLDER_HASH,
                    tokens=_PLACEHOLDER_TOKENS,
                )
                affected_tiers.add(tier)

        # Mark destination tiers broken so the next cascade
        # pass considers them and — critically — so the
        # provider cache for those tiers is rebuilt with the
        # new content included. Without this, the next
        # request would use stale cache breakpoints that
        # predate the seeding.
        for tier in affected_tiers:
            self._mark_broken(tier, "cross-ref seed")

    def register_system_prompt(
        self,
        prompt_hash: str,
        tokens: int,
    ) -> None:
        """Pin ``system:prompt`` into L0.

        Called by the orchestrator after L0 seeding. The system
        prompt is always the most stable content in the session;
        placing it at L0 entry_n ensures it never demotes during
        normal operation.

        Re-registering with the same hash is a no-op; a different
        hash reinstalls the item (rare — system prompt only
        changes on mode switch or review entry/exit, both of
        which create a fresh tracker anyway).
        """
        existing = self._items.get("system:prompt")
        if existing is not None and existing.content_hash == prompt_hash:
            # Update tokens (legend may have changed) but leave
            # tier and N alone.
            existing.tokens = tokens
            return
        self._items["system:prompt"] = TrackedItem(
            key="system:prompt",
            tier=Tier.L0,
            n_value=_TIER_CONFIG[Tier.L0]["entry_n"],
            content_hash=prompt_hash,
            tokens=tokens,
        )

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
    # Post-measurement L0 backfill
    # ------------------------------------------------------------------

    def backfill_l0_after_measurement(
        self,
        ref_index: Any,
        overshoot_multiplier: float = 2.0,
        candidate_keys: set[str] | None = None,
    ) -> int:
        """Top up L0 with real-token-count awareness post-measurement.

        The init-time placeholder (400 tokens/file) is a pessimistic
        upper bound — once ``_measure_tracker_tokens`` (the caller,
        on :class:`LLMService`) replaces placeholders with real
        counts, L0's actual token total is almost always well
        below ``cache_target_tokens``. Two consequences:

        1. The provider refuses to cache L0 at all (total below
           the provider's cache-min threshold — 4096 tokens on
           Sonnet 4.6, 1024 on Sonnet 4.5, etc.).
        2. L0 has no churn capacity — every item fits comfortably,
           so the cascade's "tier exceeds cache target → anchor
           veterans, promote above the line" path never triggers,
           and L1 items never promote upward even after they've
           earned it.

        This method pulls additional high-ref-count items from
        L1/L2/L3 into L0 until the real token total reaches
        ``cache_target_tokens × overshoot_multiplier``. The
        overshoot is deliberate — it pushes L0 well clear of
        the cache-min floor AND gives the cascade's anchoring
        logic something to work with, so L1 items can be
        promoted into L0 as lower-ref content cycles out.

        Ranking uses the reference index's ``file_ref_count``
        (same signal as initial L0 seeding) so the backfill
        preserves the "most-connected files live longest"
        intent. Ties break by key for determinism.

        Called post-measurement by both init paths
        (:meth:`LLMService._try_initialize_stability` and
        :meth:`LLMService._rebuild_cache_impl`). A no-op when
        ``cache_target_tokens == 0`` (caching disabled) or
        when no candidates exist below L0.

        Parameters
        ----------
        ref_index:
            Object implementing ``file_ref_count(path)``. Same
            object used by :meth:`initialize_with_keys`.
        overshoot_multiplier:
            Target token total is ``cache_target_tokens ×
            overshoot_multiplier``. Default 2.0 produces
            ~100% headroom above the cache-min floor —
            guarantees L0 clears the provider's cache-min
            threshold by a comfortable margin even when
            real measured tokens come in well under
            placeholder estimates. Values below 1.0 would
            leave L0 perpetually underfilled; values above
            3.0 push too much into L0 at the expense of
            L1-L3 distribution.

        Returns
        -------
        int
            The number of items promoted into L0. Useful for
            logging / debug.
        """
        if self._cache_target_tokens <= 0:
            return 0

        target = int(self._cache_target_tokens * overshoot_multiplier)

        # Compute current L0 token total from real (post-
        # measurement) counts. Iterates _items rather than
        # calling get_tier_items() to avoid the copy cost.
        current_l0_tokens = sum(
            item.tokens
            for item in self._items.values()
            if item.tier == Tier.L0
        )
        if current_l0_tokens >= target:
            return 0

        # Candidate pool — every item currently in L1, L2, or
        # L3 whose key references a file path. ``system:`` and
        # ``history:`` are L0-only or tier-protected and never
        # backfill candidates; ``url:`` is skipped because URL
        # content is session-scoped and shouldn't compete for
        # the cache-anchor slot.
        #
        # When ``candidate_keys`` is supplied, only items in
        # that set are eligible. Used by cross-reference
        # enable to restrict the backfill to the keys just
        # seeded by that pass — without the filter, a user-
        # accumulated tier state (e.g., a deliberately-placed
        # L2 entry from a prior session) would get promoted
        # to L0 as a side effect of toggling cross-ref on.
        candidates: list[TrackedItem] = []
        for item in self._items.values():
            if item.tier not in (Tier.L1, Tier.L2, Tier.L3):
                continue
            path = self._path_from_key(item.key)
            if path is None:
                continue
            if candidate_keys is not None and item.key not in candidate_keys:
                continue
            candidates.append(item)

        if not candidates:
            return 0

        # Rank by reference count descending, then by key for
        # deterministic tie-breaking (critical for test
        # stability and for reproducible startup behaviour).
        def _rank_key(it: TrackedItem) -> tuple[int, str]:
            path = self._path_from_key(it.key)
            # path is never None here — candidate loop already
            # filtered. Defensive fallback to empty string.
            count = ref_index.file_ref_count(path or "")
            return (-int(count), it.key)

        candidates.sort(key=_rank_key)

        # Promote until the target is met. Each promoted item
        # keeps its content_hash and its token count (both
        # already real post-measurement); only the tier and
        # n_value change. L0's entry_n is used so the item
        # lands as a fresh L0 resident, not mid-cycle.
        promoted = 0
        accumulated = current_l0_tokens
        l0_entry_n = _TIER_CONFIG[Tier.L0]["entry_n"]
        affected_source_tiers: set[Tier] = set()
        for item in candidates:
            if accumulated >= target:
                break
            source_tier = item.tier
            item.tier = Tier.L0
            item.n_value = l0_entry_n
            accumulated += item.tokens
            promoted += 1
            affected_source_tiers.add(source_tier)
            self._log_change(
                f"{source_tier.value} → L0: {item.key} "
                f"(post-measurement backfill)"
            )

        # Mark source tiers broken so the next cascade can
        # rebalance L1/L2/L3 distribution after the promotions.
        # L0 itself isn't marked broken — these items earned
        # their L0 slot via ref-count ranking; we don't want
        # the cascade immediately reconsidering them.
        for tier in affected_source_tiers:
            self._mark_broken(tier, "post-measurement backfill")

        return promoted

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