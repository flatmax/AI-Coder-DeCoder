"""Stability-based cache tier tracker.

Manages N-value tracking, tier assignment, content hashing, graduation,
and ripple promotion for the prompt cache tiering system.

Items tracked: files, symbol map entries, history messages.
Each item has an N-value (consecutive unchanged appearances) and a tier.
Content is hashed to detect changes.  Tiers promote upward when stable;
demote to active when content changes.

Tier structure (most → least stable):
    L0 (entry_n=12)  — system prompt, legend, core content
    L1 (entry_n=9)   — very stable
    L2 (entry_n=6)   — stable
    L3 (entry_n=3)   — entry tier for graduated content
    active (n=0)      — recently changed / new, not cached
"""

import hashlib
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Optional

log = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────
# Tier definitions
# ──────────────────────────────────────────────────────────────────────

class Tier(IntEnum):
    """Cache tiers ordered from most stable to least."""
    L0 = 0
    L1 = 1
    L2 = 2
    L3 = 3
    ACTIVE = 4


# Per-tier configuration
TIER_CONFIG = {
    Tier.L0: {"entry_n": 12, "promotion_n": None, "name": "L0"},
    Tier.L1: {"entry_n": 9, "promotion_n": 12, "name": "L1"},
    Tier.L2: {"entry_n": 6, "promotion_n": 9, "name": "L2"},
    Tier.L3: {"entry_n": 3, "promotion_n": 6, "name": "L3"},
    Tier.ACTIVE: {"entry_n": 0, "promotion_n": 3, "name": "active"},
}


# ──────────────────────────────────────────────────────────────────────
# Item types
# ──────────────────────────────────────────────────────────────────────

class ItemType:
    FILE = "file"
    SYMBOL = "symbol"
    HISTORY = "history"


@dataclass
class TrackedItem:
    """A single tracked item in the stability system."""
    key: str                     # e.g. "file:src/main.py", "symbol:src/main.py", "history:3"
    item_type: str               # ItemType constant
    tier: Tier = Tier.ACTIVE
    n: int = 0                   # Consecutive unchanged count
    content_hash: str = ""       # SHA-256 prefix for change detection
    token_estimate: int = 0      # Approximate token count


@dataclass
class TierChange:
    """Record of a tier change for UI notification."""
    key: str
    item_type: str
    old_tier: Tier
    new_tier: Tier

    @property
    def is_promotion(self) -> bool:
        return self.new_tier.value < self.old_tier.value

    @property
    def is_demotion(self) -> bool:
        return self.new_tier.value > self.old_tier.value


def _hash_content(content: str) -> str:
    """Compute a short hash for change detection."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


# ──────────────────────────────────────────────────────────────────────
# Stability Tracker
# ──────────────────────────────────────────────────────────────────────

class StabilityTracker:
    """Tracks item stability across requests and manages tier assignments.

    The tracker implements the full cache tiering algorithm:
    - N-value tracking with content hashing
    - Graduation from active → L3
    - Ripple promotion cascade (L3 → L2 → L1 → L0)
    - Threshold-aware anchoring within tiers
    - Demotion on content change
    - Controlled history graduation
    """

    def __init__(self, cache_target_tokens: int = 1536):
        self.cache_target_tokens = cache_target_tokens

        # Primary state: key → TrackedItem
        self._items: dict[str, TrackedItem] = {}

        # Previous request's active items list (for graduation detection)
        self._prev_active_keys: set[str] = set()

        # Tier broken flags (set during cascade)
        self._tier_broken: dict[Tier, bool] = {t: False for t in Tier}

        # Changes from last update cycle
        self._changes: list[TierChange] = []

    # ------------------------------------------------------------------
    # Public API — Querying
    # ------------------------------------------------------------------

    def get_item(self, key: str) -> Optional[TrackedItem]:
        return self._items.get(key)

    def get_tier_items(self, tier: Tier) -> list[TrackedItem]:
        """Get all items in a given tier, sorted by key for stability."""
        return sorted(
            [it for it in self._items.values() if it.tier == tier],
            key=lambda it: it.key,
        )

    def get_tier_tokens(self, tier: Tier) -> int:
        """Total token estimate for a tier."""
        return sum(it.token_estimate for it in self._items.values() if it.tier == tier)

    def get_changes(self) -> list[TierChange]:
        """Get and consume changes from last update cycle."""
        changes = list(self._changes)
        self._changes.clear()
        return changes

    def get_all_items(self) -> dict[str, TrackedItem]:
        return dict(self._items)

    @property
    def item_count(self) -> int:
        return len(self._items)

    # ------------------------------------------------------------------
    # Public API — Initialization
    # ------------------------------------------------------------------

    def initialize_from_reference_graph(
        self,
        clusters: list[tuple[Tier, list[str]]],
        token_estimates: dict[str, int],
    ):
        """Initialize tier assignments from reference graph clustering.

        Args:
            clusters: list of (tier, [symbol_keys]) from the clustering algorithm
            token_estimates: key → token count for each item
        """
        for tier, keys in clusters:
            entry_n = TIER_CONFIG[tier]["entry_n"]
            for key in keys:
                tokens = token_estimates.get(key, 0)
                self._items[key] = TrackedItem(
                    key=key,
                    item_type=ItemType.SYMBOL,
                    tier=tier,
                    n=entry_n,
                    content_hash="",  # Placeholder — updated on first request
                    token_estimate=tokens,
                )

    # ------------------------------------------------------------------
    # Public API — Per-Request Update
    # ------------------------------------------------------------------

    def update_after_response(
        self,
        active_items: dict[str, dict],
        modified_files: list[str],
        all_repo_files: set[str],
    ) -> list[TierChange]:
        """Run the full per-request update cycle.

        Args:
            active_items: key → {"hash": str, "tokens": int, "type": str}
                          The current active items list.
            modified_files: files modified by edits this response.
            all_repo_files: current set of repo-relative file paths.

        Returns:
            List of tier changes for UI notification.
        """
        self._changes.clear()
        self._tier_broken = {t: False for t in Tier}

        # Phase 0: Remove stale items
        self._phase0_remove_stale(all_repo_files)

        # Phase 1: Process active items
        self._phase1_process_active(active_items, modified_files)

        # Phase 2: Determine items entering L3
        entering_l3 = self._phase2_graduation(active_items)

        # Phase 3: Run cascade
        self._phase3_cascade(entering_l3)

        # Phase 4: Record
        self._prev_active_keys = set(active_items.keys())

        log.info(
            "Stability update: %d items, %d changes",
            len(self._items), len(self._changes),
        )
        for change in self._changes:
            direction = "📈" if change.is_promotion else "📉"
            log.info(
                "  %s %s → %s: %s",
                direction,
                TIER_CONFIG[change.old_tier]["name"],
                TIER_CONFIG[change.new_tier]["name"],
                change.key,
            )

        return list(self._changes)

    # ------------------------------------------------------------------
    # Public API — History Management
    # ------------------------------------------------------------------

    def purge_history_items(self):
        """Remove all history items (after compaction)."""
        to_remove = [k for k, it in self._items.items() if it.item_type == ItemType.HISTORY]
        for k in to_remove:
            item = self._items.pop(k)
            if item.tier != Tier.ACTIVE:
                self._tier_broken[item.tier] = True

    def register_item(self, key: str, item_type: str, content_hash: str,
                      token_estimate: int, tier: Tier = Tier.ACTIVE):
        """Register or update a single item."""
        if key in self._items:
            item = self._items[key]
            if item.content_hash != content_hash and item.content_hash != "":
                # Content changed — demote
                old_tier = item.tier
                item.tier = Tier.ACTIVE
                item.n = 0
                item.content_hash = content_hash
                item.token_estimate = token_estimate
                if old_tier != Tier.ACTIVE:
                    self._tier_broken[old_tier] = True
                    self._changes.append(TierChange(key, item_type, old_tier, Tier.ACTIVE))
            else:
                item.content_hash = content_hash
                item.token_estimate = token_estimate
        else:
            self._items[key] = TrackedItem(
                key=key,
                item_type=item_type,
                tier=tier,
                n=TIER_CONFIG[tier]["entry_n"],
                content_hash=content_hash,
                token_estimate=token_estimate,
            )

    # ------------------------------------------------------------------
    # Phase 0: Remove stale items
    # ------------------------------------------------------------------

    def _phase0_remove_stale(self, all_repo_files: set[str]):
        """Remove items whose files no longer exist."""
        to_remove = []
        for key, item in self._items.items():
            if item.item_type in (ItemType.FILE, ItemType.SYMBOL):
                # Extract path from key like "file:src/main.py" or "symbol:src/main.py"
                path = key.split(":", 1)[1] if ":" in key else key
                if path not in all_repo_files:
                    to_remove.append(key)

        for key in to_remove:
            item = self._items.pop(key)
            if item.tier != Tier.ACTIVE:
                self._tier_broken[item.tier] = True
            log.debug("Removed stale item: %s", key)

    # ------------------------------------------------------------------
    # Phase 1: Process active items
    # ------------------------------------------------------------------

    def _phase1_process_active(
        self,
        active_items: dict[str, dict],
        modified_files: list[str],
    ):
        """Process each item in the active items list."""
        # Build set of modified keys
        modified_keys = set()
        for fpath in modified_files:
            modified_keys.add(f"file:{fpath}")
            modified_keys.add(f"symbol:{fpath}")

        for key, info in active_items.items():
            content_hash = info["hash"]
            tokens = info["tokens"]
            item_type = info["type"]

            if key in self._items:
                item = self._items[key]
                # Check for content change or explicit modification
                hash_changed = (
                    item.content_hash != ""
                    and item.content_hash != content_hash
                )
                # Also treat as changed if hash was placeholder and item is in a cached tier
                placeholder_in_cached = (
                    item.content_hash == ""
                    and item.tier != Tier.ACTIVE
                )
                is_modified = key in modified_keys

                if hash_changed or is_modified or placeholder_in_cached:
                    # Demote to active, reset N
                    old_tier = item.tier
                    if old_tier != Tier.ACTIVE:
                        self._tier_broken[old_tier] = True
                        self._changes.append(
                            TierChange(key, item_type, old_tier, Tier.ACTIVE)
                        )
                    item.tier = Tier.ACTIVE
                    item.n = 0
                    item.content_hash = content_hash
                    item.token_estimate = tokens
                else:
                    # Content unchanged — increment N
                    item.n += 1
                    item.content_hash = content_hash
                    item.token_estimate = tokens
            else:
                # New item
                self._items[key] = TrackedItem(
                    key=key,
                    item_type=item_type,
                    tier=Tier.ACTIVE,
                    n=0,
                    content_hash=content_hash,
                    token_estimate=tokens,
                )

    # ------------------------------------------------------------------
    # Phase 2: Determine items entering L3
    # ------------------------------------------------------------------

    def _phase2_graduation(self, active_items: dict[str, dict]) -> list[str]:
        """Determine which items should enter L3.

        Returns list of keys entering L3.
        """
        entering_l3: list[str] = []
        current_active_keys = set(active_items.keys())

        # Source 1: Items leaving active context
        # Items that were in the active list last request but aren't now
        leaving_active = self._prev_active_keys - current_active_keys
        for key in leaving_active:
            item = self._items.get(key)
            if item is None:
                continue
            # Only graduate if currently in active tier
            if item.tier != Tier.ACTIVE:
                continue
            # Files/symbols need N ≥ 3 to graduate
            if item.item_type in (ItemType.FILE, ItemType.SYMBOL):
                if item.n >= TIER_CONFIG[Tier.ACTIVE]["promotion_n"]:
                    entering_l3.append(key)
            # History is immutable — always eligible (but controlled below)

        # Source 2: Controlled history graduation
        # If file/symbol entries are about to enter L3, that will break L3 —
        # pre-set the broken flag so history can piggyback.
        if entering_l3:
            self._tier_broken[Tier.L3] = True

        history_graduating = self._graduate_history(current_active_keys)
        entering_l3.extend(history_graduating)

        return entering_l3

    def _graduate_history(self, current_active_keys: set[str]) -> list[str]:
        """Determine which history items should graduate to L3.

        Two conditions for graduation:
        1. Piggyback: L3 is already broken this cycle — all active-tier history graduates
        2. Token threshold: eligible history tokens exceed cache_target_tokens
        """
        if self.cache_target_tokens <= 0:
            return []

        # Condition 1: Piggyback on L3 invalidation — ALL active-tier history graduates
        if self._tier_broken[Tier.L3]:
            all_history = []
            for key, item in sorted(self._items.items()):
                if item.item_type != ItemType.HISTORY:
                    continue
                if item.tier != Tier.ACTIVE:
                    continue
                all_history.append(key)
            return all_history

        # Find active-tier history items not in current active list
        eligible = []
        eligible_tokens = 0
        for key, item in sorted(self._items.items()):
            if item.item_type != ItemType.HISTORY:
                continue
            if item.tier != Tier.ACTIVE:
                continue
            if key in current_active_keys:
                continue
            eligible.append((key, item))
            eligible_tokens += item.token_estimate

        if not eligible:
            return []

        # Condition 2: Token threshold
        if eligible_tokens <= self.cache_target_tokens:
            return []

        # Graduate oldest first, keeping cache_target_tokens worth in active
        # Sort by key (history:N — N is the message index, so sorted = oldest first)
        eligible.sort(key=lambda pair: pair[0])

        graduating = []
        remaining_tokens = eligible_tokens
        for key, item in eligible:
            if remaining_tokens - item.token_estimate < self.cache_target_tokens:
                break
            graduating.append(key)
            remaining_tokens -= item.token_estimate

        return graduating

    # ------------------------------------------------------------------
    # Phase 3: Cascade
    # ------------------------------------------------------------------

    def _phase3_cascade(self, entering_l3: list[str]):
        """Run the ripple promotion cascade.

        Bottom-up pass through L3 → L2 → L1 → L0:
        - Place incoming items with tier's entry_n
        - Process veterans: threshold anchoring, N increment, promotion check
        - Repeat until no promotions occur
        - Post-cascade: demote items from underfilled tiers
        """
        # Place items entering L3 and mark them as already processed
        newly_placed: set[str] = set()
        for key in entering_l3:
            item = self._items.get(key)
            if item is None:
                continue
            old_tier = item.tier
            item.tier = Tier.L3
            item.n = TIER_CONFIG[Tier.L3]["entry_n"]
            self._tier_broken[Tier.L3] = True
            newly_placed.add(key)
            if old_tier != Tier.L3:
                self._changes.append(TierChange(key, item.item_type, old_tier, Tier.L3))

        # Run cascade passes until stable
        max_iterations = 10
        for _ in range(max_iterations):
            promoted_any = False
            processed: set[str] = set(newly_placed)

            # Process tiers bottom-up: L3 → L2 → L1 → L0
            for tier in [Tier.L3, Tier.L2, Tier.L1, Tier.L0]:
                dest_tier = Tier(tier.value - 1) if tier != Tier.L0 else None

                # Skip if this tier doesn't need processing
                if not self._tier_broken[tier] and (
                    dest_tier is None or not self._tier_broken[dest_tier]
                ):
                    # Check if there are incoming items (already placed above)
                    if not any(
                        it.key not in processed and it.tier == tier
                        for it in self._items.values()
                    ):
                        continue

                tier_items = [
                    it for it in self._items.values()
                    if it.tier == tier and it.key not in processed
                ]
                if not tier_items:
                    continue

                # Mark all as processed
                for it in tier_items:
                    processed.add(it.key)

                # Determine if tier above is stable (not broken and not empty)
                tier_above_stable = (
                    dest_tier is not None
                    and not self._tier_broken[dest_tier]
                    and self.get_tier_tokens(dest_tier) > 0
                ) if dest_tier is not None else True

                promotion_n = TIER_CONFIG[tier]["promotion_n"]

                if self.cache_target_tokens > 0 and tier != Tier.L0:
                    # Threshold-aware processing
                    tier_items.sort(key=lambda it: it.n)
                    accumulated_tokens = 0

                    for it in tier_items:
                        accumulated_tokens += it.token_estimate
                        if accumulated_tokens <= self.cache_target_tokens:
                            # Anchored — N frozen
                            continue
                        else:
                            # Past threshold — N++
                            if tier_above_stable and promotion_n is not None:
                                # Cap N at promotion threshold
                                it.n = min(it.n + 1, promotion_n)
                            else:
                                it.n += 1

                            # Check promotion (broken OR empty dest tier)
                            dest_open = (
                                dest_tier is not None
                                and (self._tier_broken[dest_tier]
                                     or self.get_tier_tokens(dest_tier) == 0)
                            )
                            if (
                                promotion_n is not None
                                and dest_tier is not None
                                and it.n >= promotion_n
                                and dest_open
                            ):
                                # Promote!
                                old_tier = it.tier
                                it.tier = dest_tier
                                it.n = TIER_CONFIG[dest_tier]["entry_n"]
                                self._tier_broken[tier] = True
                                self._changes.append(
                                    TierChange(it.key, it.item_type, old_tier, dest_tier)
                                )
                                promoted_any = True
                else:
                    # No threshold — all veterans get N++
                    for it in tier_items:
                        if promotion_n is not None:
                            if tier_above_stable:
                                it.n = min(it.n + 1, promotion_n)
                            else:
                                it.n += 1
                        # L0 has no promotion
                        dest_open = (
                            dest_tier is not None
                            and (self._tier_broken[dest_tier]
                                 or self.get_tier_tokens(dest_tier) == 0)
                        )
                        if (
                            promotion_n is not None
                            and dest_tier is not None
                            and it.n >= promotion_n
                            and dest_open
                        ):
                            old_tier = it.tier
                            it.tier = dest_tier
                            it.n = TIER_CONFIG[dest_tier]["entry_n"]
                            self._tier_broken[tier] = True
                            self._changes.append(
                                TierChange(it.key, it.item_type, old_tier, dest_tier)
                            )
                            promoted_any = True

            if not promoted_any:
                break

        # Post-cascade: demote underfilled tiers
        self._demote_underfilled()

    def _demote_underfilled(self):
        """Demote items from tiers below cache_target_tokens.

        Only demotes one level per tier. Tiers that receive demoted items
        are skipped to prevent cascading demotions to active.
        """
        if self.cache_target_tokens <= 0:
            return

        received_demotions: set[Tier] = set()

        for tier in [Tier.L1, Tier.L2]:
            if tier in received_demotions:
                continue
            tier_tokens = self.get_tier_tokens(tier)
            if 0 < tier_tokens < self.cache_target_tokens:
                # Demote all items one tier down
                dest = Tier(tier.value + 1)
                received_demotions.add(dest)
                for it in list(self._items.values()):
                    if it.tier == tier:
                        old_tier = it.tier
                        it.tier = dest
                        # Keep current N
                        self._changes.append(
                            TierChange(it.key, it.item_type, old_tier, dest)
                        )


# ──────────────────────────────────────────────────────────────────────
# Reference Graph Clustering
# ──────────────────────────────────────────────────────────────────────

def cluster_for_tiers(
    ref_index,
    symbol_index,
    cache_target_tokens: int,
) -> list[tuple[Tier, list[str]]]:
    """Cluster symbol entries into L1/L2/L3 from the reference graph.

    Uses bidirectional edge analysis and greedy bin-packing.

    Args:
        ref_index: ReferenceIndex instance
        symbol_index: SymbolIndex instance
        cache_target_tokens: minimum tokens per tier

    Returns:
        list of (tier, [symbol_key, ...]) assignments
    """
    from .token_counter import TokenCounter

    # Step 1: Get bidirectional components
    components = ref_index.connected_components()

    # Step 2: Estimate tokens per component
    counter = TokenCounter()
    comp_info: list[tuple[set[str], int]] = []

    for component in components:
        keys = []
        tokens = 0
        for fpath in component:
            key = f"symbol:{fpath}"
            block = symbol_index.get_file_block(fpath)
            if block:
                t = max(1, len(block) // 4)  # Rough estimate
                tokens += t
                keys.append(key)
        if keys:
            comp_info.append((set(keys), tokens))

    # Also include files NOT in any component (singletons)
    all_in_components = set()
    for comp in components:
        all_in_components.update(comp)

    all_files = set(symbol_index.all_symbols.keys())
    singletons = all_files - all_in_components

    for fpath in singletons:
        key = f"symbol:{fpath}"
        block = symbol_index.get_file_block(fpath)
        if block:
            tokens = max(1, len(block) // 4)
            comp_info.append(({key}, tokens))

    if not comp_info:
        return []

    # Step 3: Sort by size descending
    comp_info.sort(key=lambda x: -x[1])

    # Step 4: Greedy bin-packing into 3 tiers
    tier_bins: dict[Tier, list[str]] = {
        Tier.L1: [],
        Tier.L2: [],
        Tier.L3: [],
    }
    tier_tokens: dict[Tier, int] = {
        Tier.L1: 0,
        Tier.L2: 0,
        Tier.L3: 0,
    }

    for keys, tokens in comp_info:
        # Assign to tier with fewest tokens
        target = min(
            [Tier.L1, Tier.L2, Tier.L3],
            key=lambda t: tier_tokens[t],
        )
        tier_bins[target].extend(keys)
        tier_tokens[target] += tokens

    # Step 5: Merge underfilled tiers
    result: list[tuple[Tier, list[str]]] = []
    for tier in [Tier.L1, Tier.L2, Tier.L3]:
        if tier_bins[tier] and tier_tokens[tier] >= cache_target_tokens:
            result.append((tier, tier_bins[tier]))
        elif tier_bins[tier]:
            # Underfilled — merge into the smallest other tier
            smallest = None
            smallest_tokens = float("inf")
            for other in [Tier.L1, Tier.L2, Tier.L3]:
                if other != tier and tier_tokens[other] < smallest_tokens:
                    smallest = other
                    smallest_tokens = tier_tokens[other]
            if smallest is not None:
                tier_bins[smallest].extend(tier_bins[tier])
                tier_tokens[smallest] += tier_tokens[tier]
                tier_bins[tier] = []
                tier_tokens[tier] = 0

    # Re-collect after merge
    if not result:
        result = []
        for tier in [Tier.L1, Tier.L2, Tier.L3]:
            if tier_bins[tier]:
                result.append((tier, tier_bins[tier]))

    return result