"""Stability-based cache tier tracker for LLM prompt content.

Manages N values, tier graduation, ripple promotion cascades,
and content hash tracking for files, symbols, docs, URLs, and history.
"""

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)


# ── Tier Definitions ──────────────────────────────────────────────

class Tier(Enum):
    L0 = "L0"
    L1 = "L1"
    L2 = "L2"
    L3 = "L3"
    ACTIVE = "active"


# Tier configuration: entry_n and promotion_n (threshold to promote OUT of this tier)
TIER_CONFIG = {
    Tier.L0: {"entry_n": 12, "promotion_n": None},   # terminal
    Tier.L1: {"entry_n": 9, "promotion_n": 12},
    Tier.L2: {"entry_n": 6, "promotion_n": 9},
    Tier.L3: {"entry_n": 3, "promotion_n": 6},
    Tier.ACTIVE: {"entry_n": 0, "promotion_n": 3},
}

# Tier ordering for cascade (bottom-up)
TIER_ORDER = [Tier.L3, Tier.L2, Tier.L1, Tier.L0]

# The tier above each tier
TIER_ABOVE = {
    Tier.ACTIVE: Tier.L3,
    Tier.L3: Tier.L2,
    Tier.L2: Tier.L1,
    Tier.L1: Tier.L0,
}

# The tier below each tier
TIER_BELOW = {
    Tier.L0: Tier.L1,
    Tier.L1: Tier.L2,
    Tier.L2: Tier.L3,
    Tier.L3: Tier.ACTIVE,
}


@dataclass
class TrackedItem:
    """An item tracked by the stability system."""
    key: str
    tier: Tier = Tier.ACTIVE
    n: int = 0
    content_hash: str = ""
    tokens: int = 0


class StabilityTracker:
    """Cache tier stability tracker.

    Manages N values, graduation from active to L3, ripple promotion
    through L3→L2→L1→L0, and demotion on content change.
    """

    def __init__(self, cache_target_tokens: int = 1126):
        self._items: dict[str, TrackedItem] = {}
        self._cache_target_tokens = cache_target_tokens
        self._broken_tiers: set[Tier] = set()
        self._changes: list[str] = []  # Log of promotions/demotions

    @property
    def cache_target_tokens(self) -> int:
        return self._cache_target_tokens

    @cache_target_tokens.setter
    def cache_target_tokens(self, value: int):
        self._cache_target_tokens = value

    # ── Item Access ───────────────────────────────────────────────

    def get_item(self, key: str) -> Optional[TrackedItem]:
        return self._items.get(key)

    def get_tier_items(self, tier: Tier) -> dict[str, TrackedItem]:
        """Get all items in a specific tier."""
        return {k: v for k, v in self._items.items() if v.tier == tier}

    def get_all_items(self) -> dict[str, TrackedItem]:
        return dict(self._items)

    def get_changes(self) -> list[str]:
        """Get and clear the change log."""
        changes = list(self._changes)
        self._changes.clear()
        return changes

    # ── Initialization ────────────────────────────────────────────

    def initialize_from_reference_graph(
        self,
        file_ref_counts: dict[str, int],
        connected_components: list[list[str]],
        all_files: list[str],
        key_prefix: str = "sym:",
    ):
        """Initialize tier assignments from the cross-file reference graph.

        Seeds L0 with high-connectivity items, distributes clusters
        across L1/L2/L3 via greedy bin-packing, and distributes orphans.
        """
        # Seed L0 with system prompt placeholder
        if "system:prompt" not in self._items:
            self._items["system:prompt"] = TrackedItem(
                key="system:prompt", tier=Tier.L0,
                n=TIER_CONFIG[Tier.L0]["entry_n"],
            )

        # Seed L0 with high-connectivity files
        l0_tokens = 0
        l0_files: set[str] = set()
        sorted_by_refs = sorted(all_files, key=lambda f: file_ref_counts.get(f, 0), reverse=True)

        for f in sorted_by_refs:
            if l0_tokens >= self._cache_target_tokens:
                break
            key = f"{key_prefix}{f}"
            if key not in self._items:
                self._items[key] = TrackedItem(
                    key=key, tier=Tier.L0,
                    n=TIER_CONFIG[Tier.L0]["entry_n"],
                    tokens=400,  # Conservative placeholder
                )
                l0_files.add(f)
                l0_tokens += 400

        # Collect files already in L0 for exclusion from clustering
        l0_set = {item.key.split(":", 1)[1] for item in self._items.values()
                   if item.tier == Tier.L0 and item.key.startswith(key_prefix)}

        # Distribute connected components across L1, L2, L3
        # Greedy bin-packing: assign each cluster to the smallest tier
        tier_sizes = {Tier.L1: 0, Tier.L2: 0, Tier.L3: 0}
        tier_targets = [Tier.L1, Tier.L2, Tier.L3]

        for component in sorted(connected_components, key=len, reverse=True):
            # Filter out L0-seeded files
            cluster_files = [f for f in component if f not in l0_set]
            if not cluster_files:
                continue

            # Pick the smallest tier
            target = min(tier_targets, key=lambda t: tier_sizes[t])
            for f in cluster_files:
                key = f"{key_prefix}{f}"
                if key not in self._items:
                    self._items[key] = TrackedItem(
                        key=key, tier=target,
                        n=TIER_CONFIG[target]["entry_n"],
                        tokens=400,
                    )
                    tier_sizes[target] += 1

        # Distribute orphan files (not in any component and not in L0)
        placed = {item.key.split(":", 1)[1] for item in self._items.values()
                  if item.key.startswith(key_prefix)}
        orphans = [f for f in all_files if f not in placed]

        for f in orphans:
            target = min(tier_targets, key=lambda t: tier_sizes[t])
            key = f"{key_prefix}{f}"
            if key not in self._items:
                self._items[key] = TrackedItem(
                    key=key, tier=target,
                    n=TIER_CONFIG[target]["entry_n"],
                    tokens=400,
                )
                tier_sizes[target] += 1

        # Merge underfilled tiers
        self._merge_underfilled_tiers(tier_targets, tier_sizes, key_prefix)

    def _merge_underfilled_tiers(self, tier_targets, tier_sizes, key_prefix):
        """Merge tiers below cache_target_tokens into the smallest other tier."""
        if self._cache_target_tokens <= 0:
            return
        for tier in list(tier_targets):
            tier_items = self.get_tier_items(tier)
            tier_tokens = sum(i.tokens for i in tier_items.values())
            if tier_tokens < self._cache_target_tokens and tier_sizes.get(tier, 0) > 0:
                # Find smallest other tier
                others = [t for t in tier_targets if t != tier and tier_sizes.get(t, 0) > 0]
                if not others:
                    continue
                dest = min(others, key=lambda t: tier_sizes[t])
                for item in tier_items.values():
                    item.tier = dest
                    item.n = TIER_CONFIG[dest]["entry_n"]
                tier_sizes[dest] += tier_sizes[tier]
                tier_sizes[tier] = 0

    # ── Per-Request Update ────────────────────────────────────────

    def update(self, active_items: dict[str, dict], existing_files: Optional[set[str]] = None):
        """Process active items for the current request.

        active_items: {key: {"hash": str, "tokens": int}}

        Runs: Phase 0 (stale removal), Phase 1 (process active),
        Phase 2 (determine L3 entrants), Phase 3 (cascade),
        Phase 4 (record changes).
        """
        self._changes.clear()
        self._broken_tiers.clear()

        # Phase 0: Remove stale items
        if existing_files is not None:
            self._remove_stale(existing_files)

        # Phase 1: Process active items
        graduating = self._process_active_items(active_items)

        # Phase 2: Determine items entering L3
        entering_l3 = self._determine_l3_entrants(graduating, active_items)

        # Phase 3: Run cascade
        if entering_l3:
            self._broken_tiers.add(Tier.L3)
        self._run_cascade(entering_l3, phase1_keys=set(active_items.keys()))

        # Phase 4: Post-cascade consolidation
        self._demote_underfilled()

    def _remove_stale(self, existing_files: set[str]):
        """Phase 0: Remove tracked items whose files no longer exist."""
        to_remove = []
        for key, item in self._items.items():
            if key.startswith(("sym:", "doc:", "file:")):
                path = key.split(":", 1)[1]
                if path not in existing_files:
                    to_remove.append(key)

        for key in to_remove:
            tier = self._items[key].tier
            del self._items[key]
            self._broken_tiers.add(tier)
            self._changes.append(f"🗑 removed stale: {key}")

    def _process_active_items(self, active_items: dict[str, dict]) -> list[str]:
        """Phase 1: Process each active item — register, increment, or demote.

        Also cleans up file: and history: items no longer in active_items.
        Returns list of keys graduating (N >= 3).
        """
        graduating = []

        for key, info in active_items.items():
            new_hash = info.get("hash", "")
            new_tokens = info.get("tokens", 0)

            item = self._items.get(key)
            if item is None:
                # New item
                self._items[key] = TrackedItem(
                    key=key, tier=Tier.ACTIVE, n=0,
                    content_hash=new_hash, tokens=new_tokens,
                )
            else:
                if item.content_hash == "":
                    # First measurement — accept without demotion
                    item.content_hash = new_hash
                    item.tokens = new_tokens
                    item.n += 1
                elif item.content_hash != new_hash:
                    # Content changed — demote
                    old_tier = item.tier
                    if old_tier != Tier.ACTIVE:
                        self._changes.append(f"📉 {old_tier.value} → active: {key}")
                        self._broken_tiers.add(old_tier)
                    item.tier = Tier.ACTIVE
                    item.n = 0
                    item.content_hash = new_hash
                    item.tokens = new_tokens
                else:
                    # Unchanged — increment
                    item.n += 1
                    item.tokens = new_tokens

            # Check graduation eligibility
            item = self._items[key]
            if item.tier == Tier.ACTIVE and item.n >= 3:
                graduating.append(key)

        # Cleanup: remove file: and history: items no longer in active_items
        # (sym: and doc: items are exempt — they persist in earned tiers)
        to_remove = []
        for key, item in self._items.items():
            if key.startswith(("file:", "history:")):
                if key not in active_items:
                    to_remove.append(key)

        for key in to_remove:
            tier = self._items[key].tier
            del self._items[key]
            if tier != Tier.ACTIVE:
                self._broken_tiers.add(tier)

        return graduating

    def _determine_l3_entrants(
        self, graduating: list[str], active_items: dict[str, dict],
    ) -> list[TrackedItem]:
        """Phase 2: Determine items entering L3.

        Three sources:
        1. Items leaving active with N >= 3
        2. Active items with N >= 3 (still selected)
        3. Controlled history graduation (piggyback or token threshold)
        """
        entering = []

        for key in graduating:
            item = self._items.get(key)
            if item and item.tier == Tier.ACTIVE:
                entering.append(item)

        # History graduation: piggyback on L3 invalidation or token threshold
        if Tier.L3 in self._broken_tiers or self._history_threshold_met(active_items):
            for key, item in self._items.items():
                if key.startswith("history:") and item.tier == Tier.ACTIVE:
                    if item not in entering:
                        entering.append(item)

        # URL items enter directly at L1 (skip L3)
        url_items = [i for i in entering if i.key.startswith("url:")]
        for item in url_items:
            entering.remove(item)
            item.tier = Tier.L1
            item.n = TIER_CONFIG[Tier.L1]["entry_n"]
            self._changes.append(f"📈 active → L1: {item.key}")
            self._broken_tiers.add(Tier.L1)

        return entering

    def _history_threshold_met(self, active_items: dict[str, dict]) -> bool:
        """Check if eligible history tokens exceed cache_target_tokens."""
        if self._cache_target_tokens <= 0:
            return False
        total = 0
        for key, item in self._items.items():
            if key.startswith("history:") and item.tier == Tier.ACTIVE:
                total += item.tokens
        return total >= self._cache_target_tokens

    def _run_cascade(self, entering_l3: list[TrackedItem], phase1_keys: Optional[set[str]] = None):
        """Phase 3: Bottom-up cascade — place incoming, process veterans, promote."""
        # Track items that just entered a tier this cascade — skip in veteran processing
        just_placed: set[str] = set()
        # Also skip items already processed (N incremented) in Phase 1
        skip_veterans: set[str] = set(phase1_keys) if phase1_keys else set()

        # Place incoming items into L3
        for item in entering_l3:
            item.tier = Tier.L3
            item.n = TIER_CONFIG[Tier.L3]["entry_n"]
            self._changes.append(f"📈 active → L3: {item.key}")
            just_placed.add(item.key)

        # Repeat cascade until stable
        max_iterations = 10
        for _ in range(max_iterations):
            promoted_any = False
            processed: set[Tier] = set()

            for tier in TIER_ORDER:
                above = TIER_ABOVE.get(tier)
                if above is None or above == Tier.ACTIVE:
                    continue

                # Should we process this tier?
                if tier in processed:
                    continue
                has_incoming = tier in self._broken_tiers
                above_broken = above in self._broken_tiers or not self.get_tier_items(above)

                if not has_incoming and not above_broken:
                    continue

                processed.add(tier)
                tier_items = self.get_tier_items(tier)
                if not tier_items:
                    continue

                promotion_n = TIER_CONFIG[tier].get("promotion_n")
                if promotion_n is None:
                    continue  # L0 is terminal

                # Process veterans (exclude items placed this cascade or processed in Phase 1)
                veterans = sorted(
                    [i for i in tier_items.values()
                     if i.key not in just_placed and i.key not in skip_veterans],
                    key=lambda i: i.n,
                )

                if self._cache_target_tokens > 0:
                    # Anchor items below cache_target_tokens
                    accumulated = 0
                    for item in veterans:
                        accumulated += item.tokens
                        if accumulated < self._cache_target_tokens:
                            # Anchored — freeze N
                            setattr(item, '_anchored', True)
                        else:
                            setattr(item, '_anchored', False)
                            # Increment N (but cap at promotion_n if above is stable)
                            if above_broken:
                                item.n += 1
                            else:
                                item.n = min(item.n + 1, promotion_n)
                else:
                    for item in veterans:
                        setattr(item, '_anchored', False)
                        item.n += 1

                # Check promotion
                if above_broken:
                    for item in list(veterans):
                        if getattr(item, '_anchored', False):
                            continue
                        if item.n >= promotion_n:
                            old_tier = item.tier
                            item.tier = above
                            item.n = TIER_CONFIG[above]["entry_n"]
                            self._changes.append(
                                f"📈 {old_tier.value} → {above.value}: {item.key}"
                            )
                            self._broken_tiers.add(tier)
                            promoted_any = True
                            just_placed.add(item.key)

            if not promoted_any:
                break

    def _demote_underfilled(self):
        """Post-cascade: demote underfilled tiers one level down.

        Skip tiers that were broken during this cycle.
        """
        for tier in TIER_ORDER:
            if tier in self._broken_tiers:
                continue
            if tier == Tier.L0:
                continue

            below = TIER_BELOW.get(tier)
            if below is None:
                continue

            tier_items = self.get_tier_items(tier)
            if not tier_items:
                continue

            tier_tokens = sum(i.tokens for i in tier_items.values())
            if self._cache_target_tokens > 0 and tier_tokens < self._cache_target_tokens:
                for item in tier_items.values():
                    item.tier = below
                    # Keep current N
                self._changes.append(f"📉 underfill {tier.value} → {below.value}")

    # ── Item Management ───────────────────────────────────────────

    def remove_item(self, key: str):
        """Remove a specific item and mark its tier as broken."""
        item = self._items.pop(key, None)
        if item and item.tier != Tier.ACTIVE:
            self._broken_tiers.add(item.tier)

    def remove_items_by_prefix(self, prefix: str) -> list[str]:
        """Remove all items matching a key prefix. Returns removed keys."""
        to_remove = [k for k in self._items if k.startswith(prefix)]
        for key in to_remove:
            self.remove_item(key)
        return to_remove

    def purge_history(self):
        """Remove all history:* entries (after compaction)."""
        self.remove_items_by_prefix("history:")

    def seed_item(self, key: str, tier: Tier, tokens: int = 0, content_hash: str = ""):
        """Manually seed an item into a tier (for system prompt, legend, etc.)."""
        self._items[key] = TrackedItem(
            key=key, tier=tier,
            n=TIER_CONFIG[tier]["entry_n"],
            tokens=tokens,
            content_hash=content_hash,
        )

    # ── Query Helpers ─────────────────────────────────────────────

    def get_tier_token_total(self, tier: Tier) -> int:
        """Total tokens in a tier."""
        return sum(i.tokens for i in self._items.values() if i.tier == tier)

    def get_tier_counts(self) -> dict[str, int]:
        """Item counts per tier."""
        counts: dict[str, int] = {}
        for item in self._items.values():
            name = item.tier.value
            counts[name] = counts.get(name, 0) + 1
        return counts

    def is_graduated(self, key: str) -> bool:
        """Check if an item is in any cached tier (not active)."""
        item = self._items.get(key)
        return item is not None and item.tier != Tier.ACTIVE