"""Cache stability tracker — N-value tracking, tier assignment, and cascade promotion.

Organizes prompt content into stability-based tiers that align with provider
cache breakpoints. Content that remains unchanged promotes to higher tiers;
changed content demotes. This reduces LLM re-ingestion costs.

Three categories: files, symbol map entries, and history messages.
"""

import hashlib
import logging
from dataclasses import dataclass, field
from enum import IntEnum

logger = logging.getLogger(__name__)


class Tier(IntEnum):
    """Cache tier levels. Higher = more stable."""
    ACTIVE = 0
    L3 = 3
    L2 = 6
    L1 = 9
    L0 = 12


# Tier configuration
TIER_CONFIG = {
    Tier.ACTIVE: {"entry_n": 0, "promotion_n": 3, "destination": Tier.L3},
    Tier.L3: {"entry_n": 3, "promotion_n": 6, "destination": Tier.L2},
    Tier.L2: {"entry_n": 6, "promotion_n": 9, "destination": Tier.L1},
    Tier.L1: {"entry_n": 9, "promotion_n": 12, "destination": Tier.L0},
    Tier.L0: {"entry_n": 12, "promotion_n": None, "destination": None},  # terminal
}

# Tier processing order (bottom-up for cascade)
CASCADE_ORDER = [Tier.L3, Tier.L2, Tier.L1, Tier.L0]


@dataclass
class TrackedItem:
    """A tracked item in the stability system."""
    key: str           # e.g. "file:src/main.py", "symbol:src/main.py", "history:0"
    tier: Tier = Tier.ACTIVE
    n: int = 0
    content_hash: str = ""
    tokens: int = 0


class StabilityTracker:
    """Tracks content stability and manages tier assignments.

    Items are identified by string keys:
    - file:{path} — full file content
    - symbol:{path} — compact symbol block
    - history:{index} — conversation history message
    """

    def __init__(self, cache_target_tokens=1536):
        self._items = {}  # key -> TrackedItem
        self._cache_target_tokens = cache_target_tokens
        self._changes = []  # log of recent changes for frontend
        self._broken_tiers = set()  # tiers that were modified this cycle

    @property
    def items(self):
        """All tracked items."""
        return dict(self._items)

    @property
    def changes(self):
        """Recent change log."""
        return list(self._changes)

    def clear_changes(self):
        """Clear the change log."""
        self._changes.clear()

    # === Item Access ===

    def get_item(self, key):
        """Get a tracked item by key."""
        return self._items.get(key)

    def get_tier_items(self, tier):
        """Get all items in a specific tier."""
        return {k: v for k, v in self._items.items() if v.tier == tier}

    def get_tier_tokens(self, tier):
        """Total tokens in a tier."""
        return sum(item.tokens for item in self._items.values() if item.tier == tier)

    # === Content Hashing ===

    @staticmethod
    def hash_content(content):
        """SHA256 hash of content string."""
        if not content:
            return ""
        return hashlib.sha256(content.encode("utf-8", errors="replace")).hexdigest()[:16]

    # === Phase 0: Remove Stale Items ===

    def remove_stale(self, existing_files):
        """Remove tracked items whose files no longer exist.

        Args:
            existing_files: set of file paths that currently exist
        """
        to_remove = []
        for key, item in self._items.items():
            if key.startswith("file:") or key.startswith("symbol:"):
                path = key.split(":", 1)[1]
                if path not in existing_files:
                    to_remove.append(key)

        for key in to_remove:
            tier = self._items[key].tier
            del self._items[key]
            self._broken_tiers.add(tier)
            self._changes.append({"action": "removed", "key": key, "reason": "stale"})

    # === Phase 1: Process Active Items ===

    def process_active_items(self, active_items):
        """Process the active items list for this request.

        Args:
            active_items: list of dicts with {key, content_hash, tokens}

        For each item:
        - New: register at active, N=0
        - Changed (hash mismatch): N=0, demote to active
        - Unchanged: N++
        """
        for item_info in active_items:
            key = item_info["key"]
            new_hash = item_info["content_hash"]
            tokens = item_info.get("tokens", 0)

            existing = self._items.get(key)

            if existing is None:
                # New item
                self._items[key] = TrackedItem(
                    key=key, tier=Tier.ACTIVE, n=0,
                    content_hash=new_hash, tokens=tokens,
                )
            elif existing.content_hash != new_hash:
                if existing.content_hash == "":
                    # First measurement — item was pre-seeded with no hash.
                    # Accept the hash without demoting; keep tier and N.
                    existing.content_hash = new_hash
                    existing.tokens = tokens
                else:
                    # Changed — demote to active
                    old_tier = existing.tier
                    existing.tier = Tier.ACTIVE
                    existing.n = 0
                    existing.content_hash = new_hash
                    existing.tokens = tokens
                    if old_tier != Tier.ACTIVE:
                        self._broken_tiers.add(old_tier)
                        self._changes.append({
                            "action": "demoted", "key": key,
                            "from": old_tier.name, "to": "ACTIVE",
                        })
            else:
                # Unchanged — increment N
                existing.n += 1
                existing.tokens = tokens

    # === Phase 2: Determine Items Entering L3 ===

    def determine_graduates(self, controlled_history_graduation=True):
        """Find items eligible to graduate from active to L3.

        Three sources:
        1. Items leaving active context with N >= 3
        2. Active items with N >= 3 (still selected)
        3. Controlled history graduation

        Returns list of keys that should enter L3.
        """
        graduates = []

        for key, item in self._items.items():
            if item.tier != Tier.ACTIVE:
                continue

            if key.startswith("history:"):
                # History graduation is controlled separately
                continue

            if item.n >= 3:
                graduates.append(key)

        # Controlled history graduation
        if controlled_history_graduation:
            history_grads = self._determine_history_graduates()
            graduates.extend(history_grads)

        return graduates

    def _determine_history_graduates(self):
        """Determine which history items should graduate.

        Two conditions allow graduation:
        1. Piggyback: if L3 is already being rebuilt (broken), graduate for free
        2. Token threshold: if eligible history tokens exceed cache_target_tokens
        """
        eligible = []
        for key, item in self._items.items():
            if key.startswith("history:") and item.tier == Tier.ACTIVE:
                eligible.append(item)

        if not eligible:
            return []

        if self._cache_target_tokens == 0:
            return []  # History stays active permanently

        # Condition 1: Piggyback on L3 invalidation
        l3_broken = Tier.L3 in self._broken_tiers
        # Also check if any non-history items are graduating (which would break L3)
        any_non_history_grads = any(
            item.n >= 3 and item.tier == Tier.ACTIVE and not item.key.startswith("history:")
            for item in self._items.values()
        )

        if l3_broken or any_non_history_grads:
            return [item.key for item in eligible]

        # Condition 2: Token threshold
        total_eligible_tokens = sum(item.tokens for item in eligible)
        if total_eligible_tokens > self._cache_target_tokens:
            # Graduate oldest first, keep most recent cache_target_tokens in active
            eligible.sort(key=lambda i: int(i.key.split(":")[1]))
            graduates = []
            remaining_tokens = total_eligible_tokens
            for item in eligible:
                if remaining_tokens - item.tokens >= self._cache_target_tokens:
                    graduates.append(item.key)
                    remaining_tokens -= item.tokens
                else:
                    break
            return graduates

        return []

    def graduate_items(self, keys):
        """Move items from active to L3.

        Args:
            keys: list of item keys to graduate
        """
        for key in keys:
            item = self._items.get(key)
            if item and item.tier == Tier.ACTIVE:
                item.tier = Tier.L3
                item.n = TIER_CONFIG[Tier.L3]["entry_n"]
                self._broken_tiers.add(Tier.L3)
                self._changes.append({
                    "action": "graduated", "key": key,
                    "to": "L3",
                })

    # === Phase 3: Run Cascade ===

    def run_cascade(self):
        """Bottom-up cascade: place incoming, process veterans, check promotion.

        Repeats until no promotions occur.
        Post-cascade: demote underfilled tiers.
        """
        max_iterations = 10  # safety limit
        iteration = 0

        while iteration < max_iterations:
            iteration += 1
            any_promotion = False

            for tier in CASCADE_ORDER:
                config = TIER_CONFIG[tier]
                dest = config["destination"]
                promo_n = config["promotion_n"]

                if promo_n is None:
                    continue  # L0 is terminal

                # Check if tier above is broken/empty
                tier_above_broken = (
                    dest in self._broken_tiers or
                    not any(i.tier == dest for i in self._items.values())
                )

                # Process veterans in this tier
                veterans = [i for i in self._items.values() if i.tier == tier]
                if not veterans:
                    continue

                # Sort by N ascending for threshold anchoring
                veterans.sort(key=lambda i: i.n)

                if self._cache_target_tokens > 0:
                    # Threshold-aware processing
                    # Only anchor if the tier has enough content to protect
                    total_tier_tokens = sum(i.tokens for i in veterans)
                    do_anchoring = total_tier_tokens > self._cache_target_tokens

                    accumulated = 0
                    for item in veterans:
                        if do_anchoring and accumulated + item.tokens <= self._cache_target_tokens:
                            # Below threshold — anchored (N frozen, cannot promote)
                            accumulated += item.tokens
                            item._anchored = True
                        else:
                            accumulated += item.tokens
                            item._anchored = False
                            # Cap N at promotion threshold if tier above is stable
                            if not tier_above_broken and item.n >= promo_n:
                                item.n = promo_n  # cap

                # Check for promotions
                to_promote = []
                for item in veterans:
                    if tier_above_broken and item.n >= promo_n and not getattr(item, '_anchored', False):
                        to_promote.append(item)

                for item in to_promote:
                    old_tier = item.tier
                    item.tier = dest
                    item.n = TIER_CONFIG[dest]["entry_n"]
                    self._broken_tiers.add(old_tier)
                    self._broken_tiers.add(dest)
                    any_promotion = True
                    self._changes.append({
                        "action": "promoted", "key": item.key,
                        "from": old_tier.name, "to": dest.name,
                    })

            if not any_promotion:
                break

        # Post-cascade: demote underfilled tiers
        self._demote_underfilled()

    def _demote_underfilled(self):
        """Demote items from tiers below cache_target_tokens to the tier below.

        Each item demotes at most one level per call to avoid cascading
        double-demotions within a single pass.
        Skips tiers that were just promoted into this cycle (broken).
        Skips L0 (terminal tier) and L3 (would demote to active).
        """
        if self._cache_target_tokens <= 0:
            return

        demoted_keys = set()

        for tier in reversed(CASCADE_ORDER):
            if tier == Tier.L0:
                continue  # L0 is terminal — never demote from most-stable tier
            if tier == Tier.L3:
                continue  # L3 items would demote to active, handled differently

            # Skip tiers that received promotions this cycle — they are
            # intentionally populated and should not be immediately undone
            if tier in self._broken_tiers:
                continue

            tier_tokens = self.get_tier_tokens(tier)
            if 0 < tier_tokens < self._cache_target_tokens:
                # Find the tier below
                below = None
                for t in CASCADE_ORDER:
                    if TIER_CONFIG.get(t, {}).get("destination") == tier:
                        below = t
                        break

                if below is None:
                    continue

                # Demote all items one tier down (keeping their N)
                for item in list(self._items.values()):
                    if item.tier == tier and item.key not in demoted_keys:
                        item.tier = below
                        demoted_keys.add(item.key)
                        self._broken_tiers.add(tier)
                        self._changes.append({
                            "action": "demoted_underfilled", "key": item.key,
                            "from": tier.name, "to": below.name,
                        })

    # === Full Update Cycle ===

    def update(self, active_items, existing_files=None):
        """Run the full per-request update cycle.

        Args:
            active_items: list of {key, content_hash, tokens}
            existing_files: set of file paths that exist (for stale removal)

        Returns:
            dict with tier assignments and changes
        """
        self._broken_tiers.clear()
        self._changes.clear()

        # Phase 0: Remove stale
        if existing_files is not None:
            self.remove_stale(existing_files)

        # Phase 1: Process active items
        self.process_active_items(active_items)

        # Phase 2: Determine graduates
        graduates = self.determine_graduates()

        # Graduate them
        if graduates:
            self.graduate_items(graduates)

        # Phase 3: Run cascade
        self.run_cascade()

        return {
            "tiers": self._get_tier_summary(),
            "changes": list(self._changes),
            "broken_tiers": [t.name for t in self._broken_tiers],
        }

    def _get_tier_summary(self):
        """Summarize items per tier."""
        summary = {}
        for tier in [Tier.L0, Tier.L1, Tier.L2, Tier.L3, Tier.ACTIVE]:
            items = self.get_tier_items(tier)
            if items:
                summary[tier.name] = {
                    "count": len(items),
                    "tokens": sum(i.tokens for i in items.values()),
                    "items": [{"key": k, "n": v.n} for k, v in items.items()],
                }
        return summary

    # === History Management ===

    def purge_history_items(self):
        """Remove all history:* entries from the tracker."""
        to_remove = [k for k in self._items if k.startswith("history:")]
        for key in to_remove:
            tier = self._items[key].tier
            del self._items[key]
            self._broken_tiers.add(tier)

    # === Initialization from Reference Graph ===

    def initialize_from_reference_graph(self, ref_index, all_files, counter=None):
        """Initialize tier assignments from cross-file reference graph.

        No persistence — rebuilt fresh each session. Items receive their tier's
        entry_n and a placeholder content hash.

        Args:
            ref_index: ReferenceIndex instance
            all_files: list of all source file paths
            counter: TokenCounter for estimating tokens (optional)
        """
        if not all_files:
            return

        # Seed L0 with high-connectivity symbols to meet provider cache minimum.
        # System prompt is seeded separately by LLMService; here we add symbols.
        l0_seeded = set()
        if ref_index and hasattr(ref_index, 'file_ref_count'):
            l0_seeded = self._seed_l0_symbols(ref_index, all_files, counter)

        # Try clustering via mutual references (bidirectional edges)
        if ref_index and hasattr(ref_index, 'connected_components'):
            components = ref_index.connected_components()
            if components:
                self._init_from_clusters(components, counter, all_files, exclude=l0_seeded)
                return

        # Fallback: sort by reference count descending
        if ref_index and hasattr(ref_index, 'reference_count'):
            files_with_refs = [
                (f, ref_index.reference_count(f))
                for f in all_files
                if f not in l0_seeded
            ]
            files_with_refs.sort(key=lambda x: -x[1])
        else:
            files_with_refs = [(f, 0) for f in all_files if f not in l0_seeded]

        # Distribute across L1, L2, L3
        tiers = [Tier.L1, Tier.L2, Tier.L3]
        tier_idx = 0
        accumulated = 0

        for path, _refs in files_with_refs:
            tier = tiers[min(tier_idx, len(tiers) - 1)]
            key = f"symbol:{path}"
            self._items[key] = TrackedItem(
                key=key,
                tier=tier,
                n=TIER_CONFIG[tier]["entry_n"],
                content_hash="",  # placeholder
                tokens=0,
            )
            accumulated += 1

            # Move to next tier when we have enough
            if self._cache_target_tokens > 0 and tier_idx < len(tiers) - 1:
                # Simple distribution: roughly equal across tiers
                if accumulated >= len(files_with_refs) // len(tiers):
                    tier_idx += 1
                    accumulated = 0

    def _seed_l0_symbols(self, ref_index, all_files, counter):
        """Seed L0 with high-connectivity symbols to meet provider cache minimum.

        Selects the top few high-connectivity symbols by reference count
        descending. Uses a conservative per-symbol token estimate so we
        don't accidentally consume all files into L0. System prompt is
        seeded separately by LLMService; its tokens count toward L0.

        Returns set of paths placed in L0.
        """
        # Get current L0 tokens (system:prompt may already be seeded)
        l0_tokens = self.get_tier_tokens(Tier.L0)
        if l0_tokens >= self._cache_target_tokens:
            return set()

        # Rank files by reference count descending
        ranked = sorted(
            all_files,
            key=lambda f: ref_index.file_ref_count(f),
            reverse=True,
        )

        # Conservative per-symbol estimate — symbol blocks average ~200-500
        # tokens each. Using 400 avoids over-seeding L0 when real token
        # counts aren't available yet (they're corrected on first update).
        ESTIMATED_TOKENS_PER_SYMBOL = 400

        seeded = set()
        for path in ranked:
            if l0_tokens >= self._cache_target_tokens:
                break
            key = f"symbol:{path}"
            tokens = ESTIMATED_TOKENS_PER_SYMBOL
            self._items[key] = TrackedItem(
                key=key,
                tier=Tier.L0,
                n=TIER_CONFIG[Tier.L0]["entry_n"],
                content_hash="",
                tokens=tokens,
            )
            l0_tokens += tokens
            seeded.add(path)

        if seeded:
            logger.info(f"Seeded {len(seeded)} symbols into L0 for cache minimum ({l0_tokens:,} estimated tokens)")

        return seeded

    def _init_from_clusters(self, components, counter, all_files=None, exclude=None):
        """Initialize from connected components.

        Greedy bin-packing by cluster size, each cluster stays together.
        Files not in any component (no mutual references) are distributed
        into the smallest tier so they aren't left untracked.
        """
        tiers = [Tier.L1, Tier.L2, Tier.L3]
        tier_sizes = {t: 0 for t in tiers}
        placed = set(exclude or set())

        for component in sorted(components, key=len, reverse=True):
            # Place in smallest tier
            target = min(tiers, key=lambda t: tier_sizes[t])
            for path in component:
                if path in placed:
                    continue
                key = f"symbol:{path}"
                self._items[key] = TrackedItem(
                    key=key,
                    tier=target,
                    n=TIER_CONFIG[target]["entry_n"],
                    content_hash="",
                    tokens=0,
                )
                tier_sizes[target] += 1
                placed.add(path)

        # Distribute orphan files (no mutual references) into smallest tiers
        if all_files:
            for path in all_files:
                if path not in placed:
                    target = min(tiers, key=lambda t: tier_sizes[t])
                    key = f"symbol:{path}"
                    self._items[key] = TrackedItem(
                        key=key,
                        tier=target,
                        n=TIER_CONFIG[target]["entry_n"],
                        content_hash="",
                        tokens=0,
                    )
                    tier_sizes[target] += 1
                    placed.add(path)

        l0_count = len(exclude or set())
        logger.info(
            f"Tier init: {l0_count} L0, {tier_sizes[Tier.L1]} L1, {tier_sizes[Tier.L2]} L2, "
            f"{tier_sizes[Tier.L3]} L3 ({len(placed)} total, "
            f"{len(placed) - l0_count - sum(len(c) for c in components)} orphans)"
        )