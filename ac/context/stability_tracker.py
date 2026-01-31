"""
Ripple promotion stability tracker for content caching tiers.

Implements a "ripple promotion" policy where:
1. Files in Active context start with N=0
2. Edited files reset to N=0
3. Veteran files (in Active, not edited) get N++ each response
4. When N reaches 3, the file enters L3 (or when leaving Active context)
5. When items enter a tier, veterans (existing items in that tier) get N++ once
6. When a veteran's N reaches the tier's promotion threshold, it promotes
7. Promoted items become direct entries for the next tier, triggering ripple there
8. If no veterans promote in a tier, higher tiers remain unchanged (ripple stops)

Each tier's computation is independent - it only depends on direct entries to that tier.
This ensures stable files gradually move to higher cache tiers while keeping
the promotion logic predictable and testable.
"""

import hashlib
import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Callable, Literal, Optional


# Type alias for tier names
TierName = Literal['active', 'L3', 'L2', 'L1', 'L0']


# Tier configuration: entry_n is the N value when entering, promotion_threshold triggers promotion
TIER_CONFIG = {
    'L3': {'entry_n': 3, 'promotion_threshold': 6},
    'L2': {'entry_n': 6, 'promotion_threshold': 9},
    'L1': {'entry_n': 9, 'promotion_threshold': 12},
    'L0': {'entry_n': 12, 'promotion_threshold': None},  # Terminal tier
}

# Tier promotion order (from lowest to highest)
TIER_PROMOTION_ORDER = ['L3', 'L2', 'L1', 'L0']


@dataclass
class StabilityInfo:
    """Stability tracking data for a single item."""
    content_hash: str      # SHA256 of content
    n_value: int           # Current N value
    tier: str              # 'active', 'L3', 'L2', 'L1', or 'L0'


class StabilityTracker:
    """
    Ripple promotion stability tracker for cache tier management.
    
    Uses a ripple promotion policy where each tier is computed independently:
    - Items in Active context have N=0
    - Veteran items in Active (not edited) get N++ each response
    - When N reaches 3, the item enters L3 (or when it leaves Active context)
    - When items enter a tier, veterans (existing items) in that tier get N++ once
    - If a veteran reaches the tier's promotion threshold, it promotes to the next tier
    - Promoted items become direct entries for the next tier, triggering ripple there
    - If no promotions occur in a tier, higher tiers remain unchanged
    - Edited items reset to N=0 and return to Active
    
    Tiers (Bedrock 4-cache-block optimized):
    - L0: Most stable content (N >= 12), cached first
    - L1: Very stable (N >= 9), cached second
    - L2: Stable (N >= 6), cached third
    - L3: Moderately stable (N >= 3), cached fourth
    - active: In current context, not cached (N=0)
    """
    
    def __init__(
        self,
        persistence_path: Path,
        thresholds: dict[str, int] = None,
        l1_threshold: int = 3,
        l0_threshold: int = 5,
        reorg_interval: int = 10,
        reorg_drift_threshold: float = 0.2,
        initial_tier: str = 'L3'
    ):
        """
        Initialize stability tracker.
        
        Args:
            persistence_path: Path to JSON file for persistence
            thresholds: Dict mapping tier names to entry thresholds (for compatibility).
                       In ripple mode, these define entry_n values.
            l1_threshold: (Legacy) Used for 2-tier mode compatibility
            l0_threshold: (Legacy) Used for 2-tier mode compatibility
            reorg_interval: Unused in ripple mode (kept for API compatibility)
            reorg_drift_threshold: Unused in ripple mode (kept for API compatibility)
            initial_tier: Starting tier for new items (default: 'L3')
        """
        self._persistence_path = Path(persistence_path)
        
        # Support both new thresholds dict and legacy 2-tier params
        if thresholds:
            self._thresholds = thresholds
        else:
            # Legacy 2-tier mode for backwards compatibility
            self._thresholds = {'L1': l1_threshold, 'L0': l0_threshold}
        
        # Sort thresholds by value ascending for tier order
        self._tier_order = sorted(
            self._thresholds.keys(),
            key=lambda t: self._thresholds[t]
        )
        
        self._initial_tier = initial_tier
        
        self._stability: dict[str, StabilityInfo] = {}
        self._response_count: int = 0
        
        # Track promotions/demotions for the last update (for notifications)
        self._last_promotions: list[tuple[str, str]] = []
        self._last_demotions: list[tuple[str, str]] = []
        
        # Track items that were in Active last response (to detect exits)
        self._last_active_items: set[str] = set()
        
        self.load()
    
    def compute_hash(self, content: str) -> str:
        """Compute SHA256 hash of content."""
        return hashlib.sha256(content.encode()).hexdigest()
    
    def update_after_response(
        self,
        items: list[str],
        get_content: Callable[[str], str],
        modified: list[str] = None
    ) -> dict[str, str]:
        """
        Update stability tracking after an assistant response.
        
        Implements ripple promotion:
        1. Items in Active context stay active (N=0)
        2. Items leaving Active enter L3 with N=3
        3. Modified cached items return to Active with N=0
        4. Items entering a tier trigger N++ for existing items in that tier
        5. Promotions cascade through tiers
        
        Args:
            items: All items currently in Active context
            get_content: Function to get content for an item (for hash computation)
            modified: Items known to be modified this round
        
        Returns:
            Dict mapping items to their new tiers (only changed items)
        """
        self._response_count += 1
        modified_set = set(modified or [])
        tier_changes = {}
        current_active = set(items)
        
        # Reset promotion/demotion tracking for this update
        self._last_promotions = []
        self._last_demotions = []
        
        # Phase 1: Update hashes for all items and handle modifications
        for item in items:
            try:
                content = get_content(item)
                if content is None:
                    continue
                new_hash = self.compute_hash(content)
            except Exception:
                continue
            
            if item not in self._stability:
                # New item in Active - starts as active with N=0
                self._stability[item] = StabilityInfo(
                    content_hash=new_hash,
                    n_value=0,
                    tier='active'
                )
                tier_changes[item] = 'active'
            else:
                info = self._stability[item]
                old_tier = info.tier
                
                # Check if content changed or item was modified
                if item in modified_set or info.content_hash != new_hash:
                    info.content_hash = new_hash
                    # Reset N and demote to active
                    info.n_value = 0
                    if old_tier != 'active':
                        info.tier = 'active'
                        tier_changes[item] = 'active'
                        self._last_demotions.append((item, 'active'))
                else:
                    # Veteran active file, not edited - reward stability with N++
                    info.n_value += 1
        
        # Phase 2: Handle items entering L3
        # This includes:
        # - Items that left Active context (not in current items list)
        # - Veteran items that reached N=3 threshold while in Active
        items_leaving_active = self._last_active_items - current_active
        items_entering_l3 = []
        
        # Items leaving Active context
        for item in items_leaving_active:
            if item in self._stability:
                info = self._stability[item]
                if info.tier == 'active':
                    items_entering_l3.append(item)
        
        # Veteran items that reached L3 threshold (N >= 3) while still in Active
        for item in current_active:
            if item in self._stability:
                info = self._stability[item]
                if info.tier == 'active' and info.n_value >= TIER_CONFIG['L3']['entry_n']:
                    items_entering_l3.append(item)
        
        # Process all items entering L3 as a batch (triggers ripple promotions)
        if items_entering_l3:
            self._process_tier_entries(items_entering_l3, 'L3', tier_changes)
        
        # Update tracking for next round
        self._last_active_items = current_active.copy()
        
        self.save()
        return tier_changes
    
    def _process_tier_entries(
        self,
        initial_entering_items: list[str],
        initial_tier: str,
        tier_changes: dict[str, str]
    ) -> None:
        """
        Process items entering cache tiers with ripple promotion.
        
        Ripple promotion is computed independently per tier:
        1. Items entering a tier get that tier's entry_n value
        2. Veterans (items already in that tier) get N++ once per cycle
        3. If any veteran reaches promotion_threshold, they promote to the next tier
        4. Promoted items become direct entries for the next tier
        5. If no promotions occur, higher tiers remain unchanged
        
        Each tier's computation depends only on direct entries to that tier,
        not on activity in other tiers.
        
        Args:
            initial_entering_items: Items initially entering (from Active leaving or threshold)
            initial_tier: The first tier being entered (typically 'L3')
            tier_changes: Dict to record tier changes (mutated)
        """
        if not initial_entering_items or initial_tier not in TIER_CONFIG:
            return
        
        # Process tiers in order, starting from initial_tier
        current_tier = initial_tier
        entering_items = list(initial_entering_items)
        
        while entering_items and current_tier and current_tier in TIER_CONFIG:
            config = TIER_CONFIG[current_tier]
            entry_n = config['entry_n']
            promotion_threshold = config['promotion_threshold']
            
            # Snapshot veterans (items already in this tier before this cycle)
            veterans_in_tier = [
                item for item, info in self._stability.items()
                if info.tier == current_tier and item not in entering_items
            ]
            
            # Move all entering items to this tier with entry_n
            for item in entering_items:
                if item not in self._stability:
                    continue
                
                info = self._stability[item]
                old_tier = info.tier
                info.tier = current_tier
                info.n_value = entry_n
                tier_changes[item] = current_tier
                if self._is_promotion(old_tier, current_tier):
                    self._last_promotions.append((item, current_tier))
            
            # Veterans get N++ once per cycle (only if there are direct entries)
            items_to_promote = []
            for veteran_item in veterans_in_tier:
                veteran_info = self._stability[veteran_item]
                veteran_info.n_value += 1
                
                # Check if this veteran should promote
                if promotion_threshold is not None and veteran_info.n_value >= promotion_threshold:
                    items_to_promote.append(veteran_item)
            
            # Promoted veterans become direct entries for the next tier
            entering_items = items_to_promote
            current_tier = self._get_next_tier(current_tier)
    
    def _get_next_tier(self, tier: str) -> str | None:
        """Get the next tier in promotion order, or None if at L0."""
        try:
            idx = TIER_PROMOTION_ORDER.index(tier)
            if idx + 1 < len(TIER_PROMOTION_ORDER):
                return TIER_PROMOTION_ORDER[idx + 1]
        except ValueError:
            pass
        return None
    
    def _compute_tier_from_n(self, n_value: int) -> str:
        """Compute the appropriate tier based on N value.
        
        Uses entry_n thresholds from TIER_CONFIG:
        - N < 3: 'active'
        - N >= 3 and N < 6: 'L3'
        - N >= 6 and N < 9: 'L2'
        - N >= 9 and N < 12: 'L1'
        - N >= 12: 'L0'
        """
        if n_value >= TIER_CONFIG['L0']['entry_n']:
            return 'L0'
        elif n_value >= TIER_CONFIG['L1']['entry_n']:
            return 'L1'
        elif n_value >= TIER_CONFIG['L2']['entry_n']:
            return 'L2'
        elif n_value >= TIER_CONFIG['L3']['entry_n']:
            return 'L3'
        else:
            return 'active'
    
    def _is_promotion(self, old_tier: str, new_tier: str) -> bool:
        """Check if moving from old_tier to new_tier is a promotion.
        
        A promotion means moving to a higher tier (closer to L0).
        """
        if old_tier == 'active':
            return new_tier != 'active'
        if new_tier == 'active':
            return False
        
        try:
            old_idx = TIER_PROMOTION_ORDER.index(old_tier)
            new_idx = TIER_PROMOTION_ORDER.index(new_tier)
            return new_idx > old_idx
        except ValueError:
            # Fallback to threshold comparison for legacy mode
            old_threshold = self._thresholds.get(old_tier, 0)
            new_threshold = self._thresholds.get(new_tier, 0)
            return new_threshold > old_threshold
    
    def get_tier(self, item: str) -> str:
        """Get current tier for an item."""
        if item in self._stability:
            return self._stability[item].tier
        return 'active'
    
    def get_stable_count(self, item: str) -> int:
        """Get stability count (N value) for an item."""
        if item in self._stability:
            return self._stability[item].n_value
        return 0
    
    def get_n_value(self, item: str) -> int:
        """Get N value for an item (alias for get_stable_count)."""
        return self.get_stable_count(item)
    
    def get_items_by_tier(self, items: list[str] = None) -> dict[str, list[str]]:
        """
        Get items grouped by tier.
        
        Args:
            items: Filter to these items only. If None, return all tracked items.
        
        Returns:
            Dict with tier names as keys mapping to item lists,
            sorted by n_value descending within each tier.
            Always includes 'active' plus all configured tiers.
        """
        # Initialize with all configured tiers plus active
        result = {'active': []}
        for tier in self._tier_order:
            result[tier] = []
        
        # Also ensure L3, L2, L1, L0 are present for 4-tier mode
        for tier in TIER_PROMOTION_ORDER:
            if tier not in result:
                result[tier] = []
        
        check_items = items if items is not None else list(self._stability.keys())
        
        for item in check_items:
            tier = self.get_tier(item)
            if tier not in result:
                result[tier] = []
            result[tier].append(item)
        
        # Sort within tiers by n_value descending
        for tier in result:
            result[tier].sort(key=lambda x: self.get_stable_count(x), reverse=True)
        
        return result
    
    def save(self) -> None:
        """Persist stability data to disk."""
        self._persistence_path.parent.mkdir(parents=True, exist_ok=True)
        
        data = {
            'response_count': self._response_count,
            'last_active_items': list(self._last_active_items),
            'items': {k: asdict(v) for k, v in self._stability.items()}
        }
        
        self._persistence_path.write_text(json.dumps(data, indent=2))
    
    def load(self) -> None:
        """Load stability data from disk."""
        if not self._persistence_path.exists():
            return
        
        try:
            data = json.loads(self._persistence_path.read_text())
            self._response_count = data.get('response_count', 0)
            self._last_active_items = set(data.get('last_active_items', []))
            
            # Load items, handling both old and new format
            items_data = data.get('items', {})
            self._stability = {}
            for k, v in items_data.items():
                # Handle migration from old format
                if 'stable_count' in v and 'n_value' not in v:
                    v['n_value'] = v.pop('stable_count')
                if 'current_tier' in v and 'tier' not in v:
                    v['tier'] = v.pop('current_tier')
                # Remove fields that no longer exist
                v.pop('tier_entry_response', None)
                
                self._stability[k] = StabilityInfo(**v)
                
        except (json.JSONDecodeError, TypeError, KeyError) as e:
            # Corrupted file - start fresh
            self._stability = {}
            self._response_count = 0
            self._last_active_items = set()
    
    def initialize_from_refs(
        self,
        files_with_refs: list[tuple[str, int]],
        exclude_active: Optional[set[str]] = None
    ) -> dict[str, str]:
        """
        Initialize tier placement based on reference counts (heuristic).
        
        Only runs if stability data is empty (fresh start). Uses ←refs counts
        to distribute files across tiers based on structural importance:
        - Top 20% by refs → L1 (N=9) - core/central files
        - Next 30% → L2 (N=6) - moderately referenced
        - Bottom 50% → L3 (N=3) - leaf files, tests, utilities
        
        L0 is never assigned heuristically - must be earned through stability.
        
        Args:
            files_with_refs: List of (file_path, ref_count) tuples, need not be sorted
            exclude_active: Files currently in Active context (will be skipped)
        
        Returns:
            Dict mapping file paths to their assigned tiers
        """
        # Only initialize if we have no existing data
        if self._stability:
            return {}
        
        if not files_with_refs:
            return {}
        
        exclude = exclude_active or set()
        
        # Sort by ref count descending
        sorted_files = sorted(files_with_refs, key=lambda x: x[1], reverse=True)
        
        # Filter out active files
        sorted_files = [(f, r) for f, r in sorted_files if f not in exclude]
        
        if not sorted_files:
            return {}
        
        total = len(sorted_files)
        top_20_cutoff = total // 5
        top_50_cutoff = total // 2
        
        tier_assignments = {}
        
        for i, (file_path, ref_count) in enumerate(sorted_files):
            if i < top_20_cutoff:
                tier, n_value = 'L1', 9
            elif i < top_50_cutoff:
                tier, n_value = 'L2', 6
            else:
                tier, n_value = 'L3', 3
            
            # Compute a placeholder hash - will be updated on first real access
            content_hash = f"heuristic:{file_path}"
            
            self._stability[file_path] = StabilityInfo(
                content_hash=content_hash,
                n_value=n_value,
                tier=tier
            )
            tier_assignments[file_path] = tier
        
        self.save()
        return tier_assignments
    
    def is_initialized(self) -> bool:
        """Check if the tracker has any stability data."""
        return bool(self._stability)
    
    def clear(self) -> None:
        """Clear all stability data."""
        self._stability = {}
        self._response_count = 0
        self._last_active_items = set()
        self._last_promotions = []
        self._last_demotions = []
        if self._persistence_path.exists():
            self._persistence_path.unlink()
    
    def get_last_promotions(self) -> list[tuple[str, str]]:
        """Get items promoted in the last update.
        
        Returns:
            List of (item, new_tier) tuples
        """
        return self._last_promotions.copy()
    
    def get_last_demotions(self) -> list[tuple[str, str]]:
        """Get items demoted in the last update.
        
        Returns:
            List of (item, new_tier) tuples
        """
        return self._last_demotions.copy()
    
    def get_thresholds(self) -> dict[str, int]:
        """Get the tier thresholds (entry_n values).
        
        Returns:
            Dict mapping tier names to entry N values
        """
        return self._thresholds.copy()
    
    def get_tier_order(self) -> list[str]:
        """Get tiers in ascending threshold order.
        
        Returns:
            List of tier names from lowest to highest threshold
        """
        return self._tier_order.copy()
    
    def get_item_info(self, item: str) -> dict:
        """Get detailed stability info for an item.
        
        Returns:
            Dict with current_tier, stable_count (n_value), next_tier, next_threshold, progress
        """
        current_tier = self.get_tier(item)
        n_value = self.get_n_value(item)
        
        # Find next tier and its promotion threshold
        next_tier = None
        next_threshold = None
        
        if current_tier == 'active':
            # Next tier is L3
            next_tier = 'L3'
            next_threshold = TIER_CONFIG['L3']['entry_n']
        elif current_tier in TIER_CONFIG:
            # Use promotion threshold from current tier's config
            promotion_threshold = TIER_CONFIG[current_tier]['promotion_threshold']
            if promotion_threshold:
                next_tier = self._get_next_tier(current_tier)
                next_threshold = promotion_threshold
        
        # Fallback to legacy threshold lookup
        if next_tier is None and current_tier in self._thresholds:
            current_threshold = self._thresholds[current_tier]
            for tier in self._tier_order:
                if self._thresholds[tier] > current_threshold:
                    next_tier = tier
                    next_threshold = self._thresholds[tier]
                    break
        
        # Calculate progress toward next tier
        progress = 0.0
        if next_threshold is not None and next_threshold > 0:
            progress = min(1.0, n_value / next_threshold)
        elif current_tier == 'L0':
            # Already at highest tier
            progress = 1.0
        
        return {
            'current_tier': current_tier,
            'stable_count': n_value,
            'next_tier': next_tier,
            'next_threshold': next_threshold,
            'progress': progress,
        }
    
    # Legacy compatibility method
    def _compute_tier(self, stable_count: int) -> str:
        """Compute tier based on stability count (legacy compatibility).
        
        In ripple mode, tiers are explicitly tracked, not computed.
        This is kept for legacy 2-tier mode compatibility.
        """
        result_tier = 'active'
        for tier in self._tier_order:
            if stable_count >= self._thresholds[tier]:
                result_tier = tier
        return result_tier
