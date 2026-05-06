"""Stability tracker — cache tier assignment for prompt content.

Drives the prompt-cache breakpoint placement that makes AC-DC's
large-context usage affordable. Content that stays structurally
unchanged across requests graduates into higher tiers (L3 → L2 →
L1 → L0), which map to provider cache breakpoints. Content that
changes demotes to ``active`` and pays the re-ingestion cost.

This module owns tier assignments only. The streaming handler
(Layer 3.6) builds the active-items list each request and calls
:meth:`StabilityTracker.update`; the prompt assembler (Layer 3.7)
reads tier assignments via :meth:`get_tier_items`.

Governing specs:

- ``specs4/3-llm/cache-tiering.md`` — the contract-level spec
- ``specs-reference/3-llm/cache-tiering.md`` — the numeric detail
  reference (entry N and promotion thresholds, cascade order,
  anchoring algorithm)

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

- **The N value measures consecutive unchanged appearances.**
  Incremented when an item's content hash is unchanged across a
  request; reset to 0 when the hash changes (demotion to active).
  N ≥ 3 triggers graduation from active into L3.

- **Cascade is bottom-up L3 → L2 → L1 → L0.** Processed once per
  update cycle, up to a few iterations until stable. Only broken
  tiers promote items into them — a stable tier blocks promotions
  to keep its cache breakpoint valid.

- **Anchoring prevents cache-target drain.** When a tier holds
  more tokens than ``cache_target_tokens``, items below the
  threshold are anchored — their N is frozen and they cannot
  promote until the tier shrinks. Prevents a cascade of
  promotions from emptying a tier below its caching threshold.

- **N cap at promotion threshold when tier above is stable.**
  An item past the anchoring threshold increments N normally
  but caps at the promotion-N value when the tier above is
  stable — otherwise N would grow unbounded on long-lived stable
  content, eventually causing a spurious promotion when the tier
  above gets invalidated.

- **Post-cascade underfill demotion.** Any tier below
  ``cache_target_tokens`` (except L0 and tiers broken this
  cycle) has items demoted one level. Prevents wasting a cache
  breakpoint on an under-full tier that won't actually be
  cached by the provider.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Any

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


# Per-tier entry N and promotion N thresholds, from specs3. These
# are the canonical numbers — the spec table and the cascade
# algorithm both depend on exactly these values.
#
# - ``entry_n``: the N value an item is assigned when it enters
#   the tier (on graduation from below, or on promotion from a
#   lower tier).
# - ``promote_n``: the N value at which the item becomes eligible
#   for promotion to the tier above. L0 has no promotion (it's
#   terminal); we use a sentinel large value rather than None so
#   the N-cap arithmetic stays simple.
_L0_PROMOTE_SENTINEL = 9_999_999

_TIER_CONFIG: dict[Tier, dict[str, int]] = {
    # Active is the entry tier for new items. Graduation to L3
    # happens at N ≥ 3.
    Tier.ACTIVE: {"entry_n": 0, "promote_n": 3},
    Tier.L3: {"entry_n": 3, "promote_n": 6},
    Tier.L2: {"entry_n": 6, "promote_n": 9},
    Tier.L1: {"entry_n": 9, "promote_n": 12},
    # L0 is terminal — no promotion path. Entry N stays 12 so an
    # item that promotes from L1 lands with the documented value.
    Tier.L0: {"entry_n": 12, "promote_n": _L0_PROMOTE_SENTINEL},
}


# Cascade processing order — bottom-up. L3 processes incoming
# graduates from active first, then L2 handles L3's promotions,
# and so on up to L0. Active is never in the cascade order — it's
# processed separately in Phase 1.
_CASCADE_ORDER: tuple[Tier, ...] = (Tier.L3, Tier.L2, Tier.L1, Tier.L0)

# Adjacency map — the tier above each cached tier. Used for
# promotion targeting. L0 has no tier above; the sentinel lets
# cascade code check "is there anywhere to promote to" without
# special-casing.
_TIER_ABOVE: dict[Tier, Tier | None] = {
    Tier.ACTIVE: Tier.L3,
    Tier.L3: Tier.L2,
    Tier.L2: Tier.L1,
    Tier.L1: Tier.L0,
    Tier.L0: None,
}

# Adjacency map — the tier below each cached tier. Used for
# underfill demotion. Active has no tier below.
_TIER_BELOW: dict[Tier, Tier | None] = {
    Tier.L0: Tier.L1,
    Tier.L1: Tier.L2,
    Tier.L2: Tier.L3,
    Tier.L3: Tier.ACTIVE,
    Tier.ACTIVE: None,
}


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
    ) -> None:
        """Initialise an empty tracker.

        Parameters
        ----------
        cache_target_tokens:
            The target token count each cached tier tries to meet.
            Per specs, this is ``max(cache_min_tokens,
            min_cacheable_tokens) × buffer_multiplier`` — computed
            by :meth:`ConfigManager.cache_target_tokens_for_model`
            and passed in. Zero disables anchoring and underfill
            demotion (tests use 0 when they want to exercise the
            simple promote/demote path without anchoring
            interference).
        """
        self._cache_target_tokens = cache_target_tokens
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

        # Phase 1 — process active items. Hash compare, N
        # increment or reset, cleanup of file:*/history:* items
        # no longer present.
        graduates = self._process_active_items(active_items)

        # Phase 2 — place graduates into L3 as entry N.
        self._place_graduates(graduates)

        # Phase 2b — controlled history graduation. History is
        # immutable so the N-based progression that drives file
        # and symbol graduation is the wrong signal. Per
        # specs4/3-llm/cache-tiering.md § "History Graduation",
        # history graduates only when:
        #
        #   - cache_target_tokens > 0 (otherwise history stays
        #     active permanently), AND
        #   - either L3 is already broken this cycle (piggyback
        #     on an invalidation that's going to rebuild the L3
        #     cache block anyway — free ride), OR
        #   - eligible history tokens exceed the cache target
        #     (token-threshold rule; keeps the verbatim window
        #     bounded regardless of cache state).
        #
        # Runs AFTER _place_graduates so the file/symbol graduates
        # that just marked L3 broken unlock the piggyback path.
        # Runs BEFORE _run_cascade so any history additions to L3
        # participate in the cascade's anchor/cap/promote logic
        # uniformly with other L3 content.
        self._graduate_history_if_eligible()

        # Phase 3 — cascade. Bottom-up pass, anchoring,
        # promotion, post-cascade underfill demotion.
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

        Only applies to prefixes that reference repo files:
        ``file:``, ``symbol:``, ``doc:``. ``system:``, ``url:``,
        ``history:`` are always left alone (they have no
        filesystem dependency, or their lifecycle is managed
        elsewhere).

        Any tier that loses an item is marked broken so the
        cascade pass reconsiders it.
        """
        to_remove: list[str] = []
        for key, item in self._items.items():
            path = self._path_from_key(key)
            if path is None:
                continue
            if path not in existing_files:
                to_remove.append(key)

        for key in to_remove:
            item = self._items.pop(key)
            self._mark_broken(item.tier, "stale file removal")
            self._log_change(
                f"{item.tier.value} → removed (stale): {key}"
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
    ) -> list[str]:
        """Compare hashes, update N values, clean up departed items.

        Returns the list of keys that should graduate into L3
        this cycle (items with N ≥ 3 in active, plus items
        leaving active with N ≥ 3). History graduation is
        controlled — see the "controlled history graduation"
        paragraph later.
        """
        graduates: list[str] = []

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
            # change), then decide on hash comparison.
            existing.tokens = new_tokens

            if existing.content_hash == _PLACEHOLDER_HASH:
                # First-measurement acceptance — items seeded from
                # the reference graph with empty-string hash
                # accept their first real hash without demoting.
                # Without this, every initialised item would
                # demote on the first request after startup.
                existing.content_hash = new_hash
                # Still increment N — the item is unchanged from
                # the tracker's perspective (it had no prior
                # real hash to compare to).
                existing.n_value += 1
            elif existing.content_hash != new_hash:
                # Hash changed — demote to active, reset N.
                old_tier = existing.tier
                existing.content_hash = new_hash
                existing.n_value = 0
                if old_tier != Tier.ACTIVE:
                    existing.tier = Tier.ACTIVE
                    self._mark_broken(old_tier, "hash changed")
                    self._log_change(
                        f"{old_tier.value} → active: {key} (hash changed)"
                    )
            else:
                # Unchanged — increment N. Cap is applied later
                # in the cascade phase (it depends on whether the
                # tier above is stable).
                existing.n_value += 1

            # Graduation check — items at or above the active
            # promote threshold are candidates for L3. History
            # is excluded: per specs4/3-llm/cache-tiering.md
            # § "History Graduation", history is immutable so
            # N-based progression is the wrong signal. History
            # graduation is controlled separately — piggyback
            # on L3 invalidation, or token-threshold-driven —
            # and runs in a dedicated phase after _place_graduates
            # via _graduate_history_if_eligible.
            if (
                existing.tier == Tier.ACTIVE
                and existing.n_value >= _TIER_CONFIG[Tier.ACTIVE]["promote_n"]
                and not key.startswith("history:")
            ):
                graduates.append(key)

        # Step 2 — clean up file:* and history:* items that are
        # no longer in the active list. These departed from
        # context (file deselected, history compacted). symbol:*
        # and doc:* items are NOT cleaned up this way — they
        # represent repo structure and persist in their earned
        # tier even when not actively referenced this request.
        for key in list(self._items.keys()):
            if key in active_items:
                continue
            if not (key.startswith("file:") or key.startswith("history:")):
                continue
            item = self._items.pop(key)
            self._mark_broken(item.tier, "item departed")
            self._log_change(
                f"{item.tier.value} → removed: {key} (not in active)"
            )

        return graduates

    # ------------------------------------------------------------------
    # Phase 2 — place graduates into L3
    # ------------------------------------------------------------------

    def _place_graduates(self, graduates: list[str]) -> None:
        """Move graduated items from active to L3.

        Each graduate gets L3's entry N (=3). The source tier
        (active) doesn't need to be marked broken — active isn't
        cached. L3 is marked broken because new content arriving
        invalidates any prior cache state on that tier.
        """
        if not graduates:
            return
        for key in graduates:
            item = self._items.get(key)
            if item is None:
                continue
            old_tier = item.tier
            item.tier = Tier.L3
            item.n_value = _TIER_CONFIG[Tier.L3]["entry_n"]
            self._log_change(
                f"{old_tier.value} → L3: {key} (graduated)"
            )
        self._mark_broken(Tier.L3, "graduation incoming")

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
    # Phase 3 — cascade (the complex bit)
    # ------------------------------------------------------------------

    def _run_cascade(self) -> None:
        """Run the bottom-up cascade until no more promotions occur.

        Each pass processes each tier once in L3 → L0 order:

        1. Anchoring — items below the cache-target anchor line
           freeze their N this cycle (cannot promote). Items
           above the line are unanchored and increment N
           normally. N is NOT capped — letting it grow means
           items above the anchor stay promotion-eligible every
           turn rather than bouncing between promote_n and
           promote_n+1 under stable upstream conditions.
        2. Promotion — items with N ≥ promote_n move up into
           tiers that are broken or empty at cascade entry.
           Cascade happens every turn for every eligible item —
           the cache block's re-ingestion cost is the price of
           letting content flow upward to where it belongs.

        Post-cascade — any tier below cache_target (except L0
        and broken tiers) demotes one item level as underfill
        cleanup.

        Tracked via ``processed`` set so anchoring and cap math
        run at most once per tier per cascade cycle, even when
        multiple passes happen.

        Promotion gating uses a snapshot of ``_broken_tiers``
        taken at cascade entry. Per the spec's Ripple Promotion
        rule — "if a tier is stable, nothing promotes into it
        and tiers below remain cached" — one external
        invalidation opens exactly one upward promotion path,
        not a chain. Mutations to ``_broken_tiers`` made during
        the cascade (for external consumers and the L0 backfill
        probe) are preserved but do not feed back into
        promotion gating within the same cycle. Without the
        snapshot, an external L1 invalidation would mark L2
        broken when L2→L1 promotes, then mark L3 broken when
        L3→L2 follows, cascading a single user action into
        full-stack drain.
        """
        # Snapshot the broken-tiers set at cascade entry. All
        # promotion gating below reads from this snapshot; the
        # live self._broken_tiers set continues to receive
        # updates during the cascade (for the L0 backfill probe,
        # _demote_underfilled, and the post-cascade clear) but
        # those updates do not feed back into _try_promote_from.
        cascade_broken = set(self._broken_tiers)
        # Also snapshot which tiers were EMPTY at entry. The
        # promotion gate accepts "broken OR empty" destinations
        # — and emptiness must be frozen at entry too, not
        # recomputed per-iteration. Without this snapshot, a
        # tier that was stable (populated, not broken) at entry
        # but becomes empty mid-cascade (because its own
        # residents promoted upward) would start accepting
        # content from the tier below, recreating the
        # chain-cascade bug through a different path. The spec's
        # "tiers below remain cached" rule is that one external
        # invalidation opens exactly one upward path — and that
        # path is pinned by BOTH the broken set and the empty
        # set, captured at the same instant.
        cascade_empty: set[Tier] = set()
        for tier in _CASCADE_ORDER + (Tier.ACTIVE,):
            has_items = any(
                it.tier == tier for it in self._items.values()
            )
            if not has_items:
                cascade_empty.add(tier)
        # Did external mutations invalidate any tier at cascade
        # entry? When yes, the cascade is permitted to piggyback
        # an L0 backfill probe on the existing invalidation —
        # the cache block is going to be rebuilt regardless, so
        # topping L0 up costs nothing extra. When no, the
        # cascade must NOT invent a fresh L0 invalidation: doing
        # so would chain L1 → L0, then L2 → L1, then L3 → L2
        # every turn that L0 happened to sit a few hundred
        # tokens below cache_target, draining cached tiers
        # without any structural reason. Permanent L0 underfill
        # is the dedicated job of
        # :meth:`backfill_l0_after_measurement`, called once at
        # init / cache rebuild — not the per-turn cascade.
        had_external_invalidation = bool(cascade_broken)

        # Up to 8 iterations — real cascades converge in 1–2,
        # cap is defensive against logic bugs creating a cycle.
        processed: set[Tier] = set()
        for _ in range(8):
            made_progress = False
            # L0 backfill probe — only fires when we're already
            # rebuilding some cache block this cycle. See the
            # ``had_external_invalidation`` comment above for
            # why this is gated rather than unconditional.
            #
            # When permitted, the probe adds L0 to the
            # promotion-gate snapshot so _try_promote_from
            # treats it as "needs content" and promotes
            # eligible L1 items upward. The probe legitimately
            # opens an upward path so it's added to BOTH the
            # live set (so external consumers see L0 as broken)
            # and the snapshot (so promotion gating responds
            # this cycle).
            if (
                self._cache_target_tokens > 0
                and had_external_invalidation
            ):
                l0_tokens = sum(
                    item.tokens
                    for item in self._items.values()
                    if item.tier == Tier.L0
                )
                if l0_tokens < self._cache_target_tokens:
                    if Tier.L0 not in cascade_broken:
                        cascade_broken.add(Tier.L0)
                        self._mark_broken(
                            Tier.L0, "L0 backfill probe"
                        )
                        made_progress = True
            for tier in _CASCADE_ORDER:
                if tier in processed:
                    # Re-visit only to check promotion eligibility
                    # based on a newly-broken upper tier; skip
                    # the anchor/cap pass which we already did.
                    if self._try_promote_from(
                        tier, cascade_broken, cascade_empty
                    ):
                        made_progress = True
                    continue
                # First visit — full processing.
                self._process_tier_veterans(tier)
                processed.add(tier)
                if self._try_promote_from(
                    tier, cascade_broken, cascade_empty
                ):
                    made_progress = True
            if not made_progress:
                break

        # Post-cascade underfill demotion. Runs in reverse cascade
        # order (L0 → L1 → L2 → L3) so a demotion from L1 into L2
        # can flow through to L2's own underfill check in the
        # same call.
        self._demote_underfilled()

        # Cascade has consumed the broken-tier signals. Clear the
        # set so the next cycle starts fresh — external mutations
        # between now and the next :meth:`update` will repopulate
        # it. Note: _demote_underfilled may have added entries
        # (its own source/destination marks), so we clear AFTER
        # it runs. The next update's cascade will see an empty
        # set plus whatever external paths added since.
        self._broken_tiers.clear()
        self._broken_reasons.clear()

    def _process_tier_veterans(self, tier: Tier) -> None:
        """Anchor items below cache target; cap N above it.

        Only runs when cache_target_tokens > 0 AND the tier's
        total tokens exceed cache_target. Otherwise no items
        are anchored and no caps are applied — the simple
        promote-when-N-reaches-threshold path handles it.

        The anchoring flag is attached dynamically via
        ``_anchored`` attribute — transient per-cycle state that
        doesn't persist between updates.
        """
        if self._cache_target_tokens <= 0:
            # Anchoring disabled — clear any stale flags and
            # return.
            for item in self._items.values():
                if item.tier == tier:
                    item._anchored = False  # type: ignore[attr-defined]
            return

        tier_items = [
            item for item in self._items.values() if item.tier == tier
        ]
        total_tokens = sum(item.tokens for item in tier_items)

        if total_tokens <= self._cache_target_tokens:
            # Tier under cache target — no anchoring this cycle.
            for item in tier_items:
                item._anchored = False  # type: ignore[attr-defined]
            return

        # Sort by N ascending — items with the lowest N get
        # anchored first. Ties broken by key for determinism
        # (crucial for test stability — otherwise the anchoring
        # boundary drifts per-run).
        tier_items.sort(key=lambda it: (it.n_value, it.key))

        # Accumulate tokens; items consumed before reaching
        # cache_target are anchored (N frozen this cycle).
        accumulated = 0
        for item in tier_items:
            if accumulated < self._cache_target_tokens:
                # Below the line — anchored. N is frozen this
                # cycle; the item cannot promote and stays
                # pinned to the bottom of the tier keeping the
                # cache block valid.
                item._anchored = True  # type: ignore[attr-defined]
            else:
                # Above the line — not anchored. N is NOT
                # capped here; letting it grow means items
                # above the anchor stay promotion-eligible
                # every turn rather than bouncing between
                # promote_n and promote_n+1 under stable
                # upstream conditions.
                item._anchored = False  # type: ignore[attr-defined]
            accumulated += item.tokens

    def _try_promote_from(
        self,
        tier: Tier,
        cascade_broken: set[Tier] | None = None,
        cascade_empty: set[Tier] | None = None,
    ) -> bool:
        """Promote eligible items from ``tier`` to the tier above.

        Promotion is gated on the destination tier being
        broken or empty — ripple-promotion per
        specs4/3-llm/cache-tiering.md § Ripple Promotion.
        When the upper tier's cache block is already
        invalidated (or doesn't exist), moving veterans in
        costs nothing extra. When it's stable, we leave it
        alone — disturbing a cached tier for a steady-state
        promotion would trash the cache on every turn.

        The ``cascade_broken`` and ``cascade_empty`` parameters
        are snapshots of the broken-tiers set and the set of
        empty tiers, taken at cascade entry (see
        :meth:`_run_cascade`) and then augmented during the
        cascade to track **structural** invalidations — tiers
        that became broken because their own residents
        promoted upward and drained them. When provided,
        gating reads from these augmented snapshots rather
        than the live tracker state.

        The subtle point: two kinds of invalidation exist, and
        they chain differently.

        - **External** invalidation (user deselects a file,
          a file's hash changes, the orchestrator marks a
          tier broken before calling :meth:`update`) must
          NOT chain. Per spec § Ripple Promotion, one
          external invalidation opens exactly one upward
          path. Without this constraint, a single deselect
          of an L1 item would cascade L2→L1, L3→L2, active
          graduation, potentially drain L0 — tearing down
          the whole cache.

        - **Structural** invalidation (a tier's cache block
          needs rebuilding because its own residents just
          promoted out, leaving the tier's token content
          changed) MUST chain. This is the legitimate Ripple
          Promotion the spec describes: L2 veterans promote
          into broken L1, L2 is now structurally broken,
          L3 veterans flow into L2, and so on up the chain.
          Stopping at the external invalidation point
          instead of propagating structural invalidations
          leaves tiers stranded — L3 veterans ready to flow
          upward but the cascade blocks them because "L2
          wasn't broken at cascade entry".

        The snapshots handle both cases: they start with
        only the external invalidations (what ``_broken_tiers``
        held at cascade entry) and what was empty at entry.
        When a promotion succeeds, the source tier is added
        to the snapshot — subsequent iterations see it as
        broken and allow the chain to continue. The
        destination tier is NOT added to the snapshot (it
        was the target of the invalidation, not a new source
        of one) — this preserves the "external L1
        invalidation doesn't drain L0" guarantee, because
        the L1 destination mark never feeds back into
        gating.

        When either snapshot is None (callers outside the
        cascade, plus tests), gating falls back to the live
        ``self._broken_tiers`` set and a live emptiness
        probe — preserves the prior contract for direct
        callers who don't need cycle-stable gating.

        An item is eligible when:

        - The tier above was broken OR empty at cascade entry,
          OR the tier above became structurally broken
          earlier in this cascade (per augmented snapshot),
          AND
        - It is not anchored (above the cache-target anchor
          line within its current tier), AND
        - Its N ≥ the tier's promote_n threshold

        Returns True if any items promoted. The cascade uses
        this to decide whether another pass is needed.
        """
        above = _TIER_ABOVE[tier]
        if above is None:
            # L0 — no tier above, can't promote.
            return False

        # Gate: only promote into tiers that were broken OR
        # empty at cascade entry. Both signals are snapshotted
        # so mid-cascade mutations (source-tier marking after
        # promotion, a tier emptying because its residents just
        # promoted upward) do not feed back into gating. See
        # docstring for why both snapshots matter.
        broken_gate = cascade_broken if cascade_broken is not None else self._broken_tiers
        if cascade_empty is not None:
            empty_gate = above in cascade_empty
        else:
            # Live fallback for non-cascade callers — probe
            # the current state.
            empty_gate = not any(
                it.tier == above for it in self._items.values()
            )
        upper_broken = above in broken_gate
        if not upper_broken and not empty_gate:
            return False

        promote_n = _TIER_CONFIG[tier]["promote_n"]
        candidates = [
            item
            for item in self._items.values()
            if item.tier == tier
            and not getattr(item, "_anchored", False)
            and item.n_value >= promote_n
        ]
        if not candidates:
            return False

        promoted_any = False
        for item in candidates:
            item.tier = above
            item.n_value = _TIER_CONFIG[above]["entry_n"]
            self._log_change(
                f"{tier.value} → {above.value}: {item.key} (promoted)"
            )
            promoted_any = True

        if promoted_any:
            # Source tier shed items → its cache block needs
            # rebuilding. Destination tier gained items → its
            # cache block also needs rebuilding. Mark both in
            # the live set so external consumers (prompt
            # assembler, underfill demotion which skips broken
            # tiers) see the structural change.
            self._mark_broken(tier, "promoted out")
            self._mark_broken(above, "promoted in")

            # Structural invalidation propagation — the
            # source tier just lost residents, so its cache
            # block is genuinely broken for the remainder of
            # this cascade. Add it to the snapshot so the
            # next iteration's gate sees the invalidation
            # and allows the tier below to chain into it.
            # This is the spec's Ripple Promotion: L1
            # invalidation opens L2→L1, which opens L3→L2,
            # which opens active→L3.
            #
            # The DESTINATION tier is deliberately NOT added
            # to ``cascade_broken``. The destination received
            # content — it's being rebuilt because it was
            # already broken (the precondition of this
            # promotion firing). Adding it to the snapshot
            # would re-open a path that was just closed by
            # this very promotion, producing the chain-
            # cascade bug that the snapshot was introduced
            # to prevent: external L1 invalidation would
            # mark L0 "broken" when L1→L0 promotes, letting
            # L2 promote up through the chain without any
            # L0-side invalidation having occurred.
            if cascade_broken is not None:
                cascade_broken.add(tier)

        return promoted_any

    def _demote_underfilled(self) -> None:
        """Demote items from tiers that are below the cache target.

        Wastes a cache breakpoint to hold a tier below
        cache_target — the provider won't cache it. Each
        under-full tier (excluding L0 which is terminal and
        tiers broken this cycle, which we already reprocessed)
        demotes one item level.

        Iterates L0 → L1 → L2 → L3 so a demoted item can
        participate in its new tier's underfill check on the
        next outer iteration. L3 is processed with demotion
        target ``active``, which absorbs without limit.

        Each item demotes AT MOST ONCE per call to avoid
        cascading double-demotions within a single pass.
        """
        if self._cache_target_tokens <= 0:
            return

        # Items we've already demoted this pass — prevent
        # re-demotion if a tier becomes under-full after its
        # demoted items have already left.
        demoted_this_call: set[str] = set()

        for tier in (Tier.L0, Tier.L1, Tier.L2, Tier.L3):
            if tier == Tier.L0:
                # L0 is terminal — never demoted via underfill.
                # An under-full L0 is the "backfill" scenario;
                # the cascade's normal L1→L0 promotion path tops
                # it up when L1 is invalidated, not this demotion
                # path.
                continue
            if tier in self._broken_tiers:
                # Broken tiers received promotions this cycle —
                # don't immediately undo them.
                continue

            below = _TIER_BELOW[tier]
            if below is None:
                continue

            tier_items = [
                item
                for item in self._items.values()
                if item.tier == tier and item.key not in demoted_this_call
            ]
            total = sum(item.tokens for item in tier_items)
            if total >= self._cache_target_tokens:
                continue
            if not tier_items:
                continue

            # Demote every item — a tier below cache target
            # isn't worth a breakpoint. Their N is preserved;
            # they may re-promote on the next cycle if the tier
            # above stabilises.
            for item in tier_items:
                item.tier = below
                demoted_this_call.add(item.key)
                self._log_change(
                    f"{tier.value} → {below.value}: {item.key} "
                    f"(underfill demotion)"
                )
            # Both tiers experience structural change.
            self._mark_broken(tier, "underfill demotion (source)")
            self._mark_broken(below, "underfill demotion (dest)")

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