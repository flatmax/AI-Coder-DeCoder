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

# Placeholder token count — during initialisation we don't have
# real token counts (the formatted blocks haven't been rendered
# yet). A small per-entry estimate is used so L0 seeding doesn't
# over-fill. Real counts replace these on the first update cycle
# or via :meth:`_measure_tokens`.
_PLACEHOLDER_TOKENS = 400


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
      invalidated this cycle. Consumed by the cascade to decide
      which tiers can accept promotions; also controls underfill
      demotion (broken tiers don't demote).

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
        self._broken_tiers: set[Tier] = set()

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
        self._broken_tiers |= tiers_affected

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
        # Reset per-cycle state. Broken tiers accumulate during
        # the cycle (hash changes, item removals, graduation).
        self._changes = []
        self._broken_tiers = set()

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

        # Phase 3 — cascade. Bottom-up pass, anchoring,
        # promotion, post-cascade underfill demotion.
        self._run_cascade()

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
            self._broken_tiers.add(item.tier)
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
                self._items[key] = TrackedItem(
                    key=key,
                    tier=Tier.ACTIVE,
                    n_value=0,
                    content_hash=new_hash,
                    tokens=new_tokens,
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
                    self._broken_tiers.add(old_tier)
                    self._log_change(
                        f"{old_tier.value} → active: {key} (hash changed)"
                    )
            else:
                # Unchanged — increment N. Cap is applied later
                # in the cascade phase (it depends on whether the
                # tier above is stable).
                existing.n_value += 1

            # Graduation check — items at or above the active
            # promote threshold are candidates for L3.
            if (
                existing.tier == Tier.ACTIVE
                and existing.n_value >= _TIER_CONFIG[Tier.ACTIVE]["promote_n"]
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
            self._broken_tiers.add(item.tier)
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
        self._broken_tiers.add(Tier.L3)

    # ------------------------------------------------------------------
    # Phase 3 — cascade (the complex bit)
    # ------------------------------------------------------------------

    def _run_cascade(self) -> None:
        """Run the bottom-up cascade until no more promotions occur.

        Each pass processes each tier once in L3 → L0 order:

        1. Anchoring — items below cache target freeze their N
           (can't promote)
        2. N-cap — items above the anchor line increment N but
           cap at the promotion threshold if the tier above is
           stable
        3. Promotion — items with N ≥ promote_n move up if the
           tier above is broken or empty

        Post-cascade — any tier below cache_target (except L0
        and broken tiers) demotes one item level as underfill
        cleanup.

        Tracked via ``processed`` set so anchoring and cap math
        run at most once per tier per cascade cycle, even when
        multiple passes happen.
        """
        # Up to 8 iterations — real cascades converge in 1–2,
        # cap is defensive against logic bugs creating a cycle.
        processed: set[Tier] = set()
        for _ in range(8):
            made_progress = False
            for tier in _CASCADE_ORDER:
                if tier in processed:
                    # Re-visit only to check promotion eligibility
                    # based on a newly-broken upper tier; skip
                    # the anchor/cap pass which we already did.
                    if self._try_promote_from(tier):
                        made_progress = True
                    continue
                # First visit — full processing.
                self._process_tier_veterans(tier)
                processed.add(tier)
                if self._try_promote_from(tier):
                    made_progress = True
            if not made_progress:
                break

        # Post-cascade underfill demotion. Runs in reverse cascade
        # order (L0 → L1 → L2 → L3) so a demotion from L1 into L2
        # can flow through to L2's own underfill check in the
        # same call.
        self._demote_underfilled()

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
        above_tier = _TIER_ABOVE[tier]
        upper_is_stable = (
            above_tier is not None
            and above_tier not in self._broken_tiers
        )
        promote_n = _TIER_CONFIG[tier]["promote_n"]
        for item in tier_items:
            if accumulated < self._cache_target_tokens:
                # Below the line — anchored.
                item._anchored = True  # type: ignore[attr-defined]
            else:
                # Above the line — not anchored. Cap N at
                # promotion threshold if the tier above is
                # stable (can't promote there anyway, so N
                # shouldn't grow).
                item._anchored = False  # type: ignore[attr-defined]
                if upper_is_stable and item.n_value > promote_n:
                    item.n_value = promote_n
            accumulated += item.tokens

    def _try_promote_from(self, tier: Tier) -> bool:
        """Promote eligible items from ``tier`` to the tier above.

        An item is eligible when:

        - It is not anchored
        - Its N ≥ the tier's promote_n threshold
        - The tier above is broken or empty (no tier above = L0
          = not promotable)

        Returns True if any items promoted. The cascade uses this
        to decide whether another pass is needed.
        """
        above = _TIER_ABOVE[tier]
        if above is None:
            # L0 — no tier above, can't promote.
            return False

        # Promotion only flows into broken or empty tiers.
        # Empty check doesn't require knowing all tier contents
        # ahead of time — we can compute it here.
        upper_items = [
            item for item in self._items.values() if item.tier == above
        ]
        upper_empty = len(upper_items) == 0
        upper_broken = above in self._broken_tiers

        if not (upper_broken or upper_empty):
            return False

        promote_n = _TIER_CONFIG[tier]["promote_n"]
        promoted_any = False

        # Collect candidates first — mutating during iteration
        # is error-prone.
        candidates = [
            item
            for item in self._items.values()
            if item.tier == tier
            and not getattr(item, "_anchored", False)
            and item.n_value >= promote_n
        ]

        for item in candidates:
            item.tier = above
            item.n_value = _TIER_CONFIG[above]["entry_n"]
            self._log_change(
                f"{tier.value} → {above.value}: {item.key} (promoted)"
            )
            promoted_any = True

        if promoted_any:
            # Source tier loses items → broken. Destination was
            # already broken (that's why we promoted into it) or
            # was empty; either way it now has content.
            self._broken_tiers.add(tier)
            self._broken_tiers.add(above)

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
            self._broken_tiers.add(tier)
            self._broken_tiers.add(below)

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

        Separates key construction from tier assignment so the
        same algorithm can serve code mode (``symbol:{path}``),
        doc mode (``doc:{path}``), and tests that want to verify
        the distribution directly.
        """
        if not keys:
            return
        if len(keys) != len(files):
            raise ValueError(
                f"keys length ({len(keys)}) must match "
                f"files length ({len(files)})"
            )

        # Step 1 — L0 seeding by reference count. Most-referenced
        # files go to L0 up to the cache target.
        target = (
            l0_target_tokens
            if l0_target_tokens is not None
            else self._cache_target_tokens
        )
        # Rank files by incoming reference count descending. Ties
        # broken by file path for determinism.
        ranked = sorted(
            zip(keys, files),
            key=lambda kf: (-ref_index.file_ref_count(kf[1]), kf[1]),
        )

        l0_keys: set[str] = set()
        if target > 0:
            accumulated = 0
            for key, _path in ranked:
                if accumulated >= target:
                    break
                l0_keys.add(key)
                accumulated += _PLACEHOLDER_TOKENS
                if len(l0_keys) >= len(ranked):
                    break

        for key, path in ranked:
            if key not in l0_keys:
                continue
            self._items[key] = TrackedItem(
                key=key,
                tier=Tier.L0,
                n_value=_TIER_CONFIG[Tier.L0]["entry_n"],
                content_hash=_PLACEHOLDER_HASH,
                tokens=_PLACEHOLDER_TOKENS,
            )

        # Step 2 — cluster remaining files via connected
        # components and distribute across L1/L2/L3.
        remaining_pairs = [
            (key, path) for key, path in zip(keys, files)
            if key not in l0_keys
        ]
        if not remaining_pairs:
            return

        path_to_key = {path: key for key, path in remaining_pairs}
        remaining_paths = {path for _key, path in remaining_pairs}

        components = ref_index.connected_components()
        # Filter each component to the remaining paths (L0 files
        # are already placed and shouldn't be re-distributed).
        filtered_components: list[set[str]] = []
        seen_in_components: set[str] = set()
        for comp in components:
            filtered = {p for p in comp if p in remaining_paths}
            if filtered:
                filtered_components.append(filtered)
                seen_in_components.update(filtered)

        # Orphan files (not in any component) — bin-pack into the
        # smallest tier so they get tracked. Without this, files
        # with only one-way or no references never register.
        orphan_paths = remaining_paths - seen_in_components
        if orphan_paths:
            # Sort orphans by ref count descending for stable
            # placement. Unreferenced orphans (count = 0) fall
            # last and get placed in whichever tier has room.
            orphan_list = sorted(
                orphan_paths,
                key=lambda p: (-ref_index.file_ref_count(p), p),
            )
            # One orphan per component means each orphan becomes
            # its own "component" for distribution — keeps the
            # bin-packer simple.
            for p in orphan_list:
                filtered_components.append({p})

        # Step 3 — bin-pack components across L1/L2/L3. Greedy:
        # assign each component (sorted by size descending) to
        # the tier with the smallest current size.
        tier_sizes = {Tier.L1: 0, Tier.L2: 0, Tier.L3: 0}
        tier_contents: dict[Tier, list[str]] = {
            Tier.L1: [],
            Tier.L2: [],
            Tier.L3: [],
        }

        # Sort components by size descending; ties broken
        # deterministically by sorted member tuple.
        filtered_components.sort(
            key=lambda c: (-len(c), tuple(sorted(c)))
        )

        for comp in filtered_components:
            # Target tier = smallest current. Ties broken by
            # tier name (L3 < L2 < L1 lexicographically? no —
            # L1, L2, L3 in that order). We want L3 first on
            # ties so lightly-connected clusters go into the
            # less-stable tier.
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

        # Instantiate items in their assigned tiers.
        for tier in (Tier.L1, Tier.L2, Tier.L3):
            for key in tier_contents[tier]:
                self._items[key] = TrackedItem(
                    key=key,
                    tier=tier,
                    n_value=_TIER_CONFIG[tier]["entry_n"],
                    content_hash=_PLACEHOLDER_HASH,
                    tokens=_PLACEHOLDER_TOKENS,
                )

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
    # Internal helpers
    # ------------------------------------------------------------------

    def _log_change(self, description: str) -> None:
        """Record a tier change for the cycle's change log.

        Wrapped so future enhancements (structured log records,
        event dispatch) have one place to hook.
        """
        self._changes.append(description)
        logger.debug("tier change: %s", description)