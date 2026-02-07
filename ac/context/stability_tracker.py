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

With threshold-aware promotion:
- Tiers must meet a minimum token count before veterans can promote
- Low-N veterans "anchor" tiers by filling the cache threshold
- Once threshold is met, remaining veterans can progress toward higher tiers
- This ensures cache blocks meet provider minimums (e.g., 1024 tokens for Anthropic)
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

# Derived constants (single source of truth for tier configuration)
TIER_THRESHOLDS = {k: v['entry_n'] for k, v in TIER_CONFIG.items()}
TIER_NAMES = {
    'L0': 'Most Stable',
    'L1': 'Very Stable',
    'L2': 'Stable',
    'L3': 'Moderately Stable',
    'active': 'Active',
}
TIER_ORDER = ['L0', 'L1', 'L2', 'L3', 'active']
CACHE_TIERS = ['L0', 'L1', 'L2', 'L3']


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
    
    With threshold-aware promotion:
    - Tiers must accumulate enough tokens before veterans can promote
    - Low-N veterans "anchor" tiers by filling the cache threshold
    - Once threshold is met, remaining veterans can get N++ and potentially promote
    
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
        initial_tier: str = 'L3',
        cache_target_tokens: int = 0,
    ):
        """
        Initialize stability tracker.
        
        Args:
            persistence_path: Path to JSON file for persistence
            thresholds: Dict mapping tier names to entry thresholds.
                       Defines entry_n values for each tier.
                       Defaults to 4-tier config: L3=3, L2=6, L1=9, L0=12.
            initial_tier: Starting tier for new items (default: 'L3')
            cache_target_tokens: Target tokens per cache block (0 = disabled).
                                Veterans below this threshold anchor the tier.
        """
        self._persistence_path = Path(persistence_path)
        
        if thresholds:
            self._thresholds = thresholds
        else:
            self._thresholds = {k: v['entry_n'] for k, v in TIER_CONFIG.items()}
        
        # Sort thresholds by value ascending for tier order
        self._tier_order = sorted(
            self._thresholds.keys(),
            key=lambda t: self._thresholds[t]
        )
        
        self._initial_tier = initial_tier
        self._cache_target_tokens = cache_target_tokens
        
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
        modified: list[str] = None,
        get_tokens: Callable[[str], int] = None,
    ) -> dict[str, str]:
        """
        Update stability tracking after an assistant response.
        
        Implements ripple promotion with optional threshold-aware behavior:
        1. Items in Active context stay active (N=0)
        2. Items leaving Active enter L3 with N=3
        3. Modified cached items return to Active with N=0
        4. Items entering a tier trigger processing for existing items
        5. With cache_target_tokens > 0: low-N veterans anchor tiers,
           only veterans past the threshold get N++ and can promote
        6. Promotions cascade through tiers
        
        Args:
            items: All items currently in Active context
            get_content: Function to get content for an item (for hash computation)
            modified: Items known to be modified this round
            get_tokens: Optional function to get token count for an item.
                       Required if cache_target_tokens > 0 for threshold-aware promotion.
        
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
            self._process_tier_entries(items_entering_l3, 'L3', tier_changes, get_tokens)
        
        # Update tracking for next round
        self._last_active_items = current_active.copy()
        
        self.save()
        return tier_changes
    
    def _process_tier_entries(
        self,
        initial_entering_items: list[str],
        initial_tier: str,
        tier_changes: dict[str, str],
        get_tokens: Callable[[str], int] = None,
    ) -> None:
        """
        Process items entering cache tiers with ripple promotion.
        
        Ripple promotion is computed independently per tier:
        1. Items entering a tier get that tier's entry_n value
        2. With threshold-aware mode (cache_target_tokens > 0):
           a. Accumulate tokens from entering items
           b. Sort veterans by N ascending (lowest first)
           c. Veterans below token threshold anchor the tier (no N++)
           d. Veterans past threshold get N++ and can promote
        3. Without threshold mode: all veterans get N++ once per cycle
        4. If any veteran reaches promotion_threshold, they promote to the next tier
        5. Promoted items become direct entries for the next tier
        6. If no promotions occur, higher tiers remain unchanged
        
        Each tier's computation depends only on direct entries to that tier,
        not on activity in other tiers.
        
        Args:
            initial_entering_items: Items initially entering (from Active leaving or threshold)
            initial_tier: The first tier being entered (typically 'L3')
            tier_changes: Dict to record tier changes (mutated)
            get_tokens: Optional function to get token count for items
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
            accumulated_tokens = 0
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
                
                # Accumulate tokens from entering items
                if get_tokens and self._cache_target_tokens > 0:
                    try:
                        accumulated_tokens += get_tokens(item)
                    except Exception:
                        pass
            
            # Process veterans with threshold-aware logic
            items_to_promote = []
            
            if self._cache_target_tokens > 0 and get_tokens:
                # Threshold-aware mode: sort veterans by N ascending (lowest first)
                # Low-N veterans anchor the tier, high-N veterans can promote
                veterans_sorted = sorted(
                    veterans_in_tier,
                    key=lambda x: self._stability[x].n_value
                )
                
                for veteran_item in veterans_sorted:
                    veteran_info = self._stability[veteran_item]
                    
                    if accumulated_tokens < self._cache_target_tokens:
                        # Below threshold: veteran anchors tier (no N++)
                        try:
                            accumulated_tokens += get_tokens(veteran_item)
                        except Exception:
                            pass
                        # No N++ for anchoring veterans
                    else:
                        # Threshold met: veteran gets N++ and can potentially promote
                        veteran_info.n_value += 1
                        
                        if promotion_threshold is not None and veteran_info.n_value >= promotion_threshold:
                            items_to_promote.append(veteran_item)
            else:
                # Original behavior: all veterans get N++ once per cycle
                for veteran_item in veterans_in_tier:
                    veteran_info = self._stability[veteran_item]
                    veteran_info.n_value += 1
                    
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
    
    def get_n_value(self, item: str) -> int:
        """Get N value for an item."""
        if item in self._stability:
            return self._stability[item].n_value
        return 0
    
    def get_stable_count(self, item: str) -> int:
        """Deprecated: use get_n_value instead."""
        return self.get_n_value(item)
    
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
            result[tier].sort(key=lambda x: self.get_n_value(x), reverse=True)
        
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
        files_with_refs: list[tuple[str, int]] | list[tuple[str, int, int]],
        exclude_active: Optional[set[str]] = None,
        target_tokens: Optional[int] = None,
    ) -> dict[str, str]:
        """
        Initialize tier placement based on reference counts (heuristic).
        
        Only runs if stability data is empty (fresh start). Uses ←refs counts
        to distribute files across tiers based on structural importance.
        
        With threshold-aware mode (target_tokens provided and files have token counts):
        - Fill tiers top-down (L0 → L1 → L2 → L3) until each meets target_tokens
        - Files are sorted by ref count descending (most referenced first)
        - Each tier fills to threshold before moving to the next
        - L3 absorbs all remaining files
        
        Without threshold mode (legacy behavior):
        - Top 20% by refs → L1 (N=9) - core/central files
        - Next 30% → L2 (N=6) - moderately referenced
        - Bottom 50% → L3 (N=3) - leaf files, tests, utilities
        
        L0 is never assigned heuristically - must be earned through stability.
        
        Args:
            files_with_refs: List of (file_path, ref_count) or (file_path, ref_count, tokens) tuples
            exclude_active: Files currently in Active context (will be skipped)
            target_tokens: Target tokens per tier for threshold-aware initialization.
                          If None, uses self._cache_target_tokens. If 0, uses legacy behavior.
        
        Returns:
            Dict mapping file paths to their assigned tiers
        """
        # Only initialize if we have no existing data
        if self._stability:
            return {}
        
        if not files_with_refs:
            return {}
        
        exclude = exclude_active or set()
        
        # Determine target tokens
        effective_target = target_tokens if target_tokens is not None else self._cache_target_tokens
        
        # Check if we have token information (3-tuples)
        has_tokens = len(files_with_refs[0]) >= 3 if files_with_refs else False
        
        # Sort by ref count descending
        sorted_files = sorted(files_with_refs, key=lambda x: x[1], reverse=True)
        
        # Filter out active files
        if has_tokens:
            sorted_files = [(f, r, t) for f, r, t in sorted_files if f not in exclude]
        else:
            sorted_files = [(f, r) for f, r in sorted_files if f not in exclude]
        
        if not sorted_files:
            return {}
        
        tier_assignments = {}
        
        # Threshold-aware initialization
        if effective_target > 0 and has_tokens:
            # Fill tiers top-down: L1 → L2 → L3 (skip L0 - must be earned)
            tier_order = ['L1', 'L2', 'L3']
            tier_n_values = {'L1': 9, 'L2': 6, 'L3': 3}
            
            file_index = 0
            for tier in tier_order:
                tier_tokens = 0
                n_value = tier_n_values[tier]
                
                while file_index < len(sorted_files):
                    file_path, ref_count, tokens = sorted_files[file_index]
                    
                    # Add file to this tier
                    content_hash = f"heuristic:{file_path}"
                    self._stability[file_path] = StabilityInfo(
                        content_hash=content_hash,
                        n_value=n_value,
                        tier=tier
                    )
                    tier_assignments[file_path] = tier
                    tier_tokens += tokens
                    file_index += 1
                    
                    # Check if tier meets threshold (except L3 which absorbs all remaining)
                    if tier != 'L3' and tier_tokens >= effective_target:
                        break
        else:
            # Legacy percentile-based initialization
            total = len(sorted_files)
            top_20_cutoff = total // 5
            top_50_cutoff = total // 2
            
            for i, item in enumerate(sorted_files):
                file_path = item[0]
                
                if i < top_20_cutoff:
                    tier, n_value = 'L1', 9
                elif i < top_50_cutoff:
                    tier, n_value = 'L2', 6
                else:
                    tier, n_value = 'L3', 3
                
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
    
    def remove_by_prefix(self, prefix: str) -> list[str]:
        """Remove all tracked items whose key starts with prefix.
        
        Used for lifecycle events like history clear/compaction/session load
        where a category of items needs to be purged.
        
        Args:
            prefix: Key prefix to match (e.g., 'history:')
            
        Returns:
            List of removed item keys
        """
        to_remove = [k for k in self._stability if k.startswith(prefix)]
        for k in to_remove:
            del self._stability[k]
        # Also clean from last_active_items
        self._last_active_items = {
            item for item in self._last_active_items
            if not item.startswith(prefix)
        }
        if to_remove:
            self.save()
        return to_remove
    
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
    
    def get_cache_target_tokens(self) -> int:
        """Get the cache target tokens threshold.
        
        Returns:
            Target tokens per cache block, or 0 if disabled
        """
        return self._cache_target_tokens
    
    def set_cache_target_tokens(self, target: int) -> None:
        """Set the cache target tokens threshold.
        
        Args:
            target: Target tokens per cache block, or 0 to disable
        """
        self._cache_target_tokens = target
    
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
            next_tier = 'L3'
            next_threshold = TIER_CONFIG['L3']['entry_n']
        elif current_tier in TIER_CONFIG:
            promotion_threshold = TIER_CONFIG[current_tier]['promotion_threshold']
            if promotion_threshold:
                next_tier = self._get_next_tier(current_tier)
                next_threshold = promotion_threshold
        
        # Calculate progress toward next tier
        progress = 0.0
        if next_threshold is not None and next_threshold > 0:
            progress = min(1.0, n_value / next_threshold)
        elif current_tier == 'L0':
            progress = 1.0
        
        return {
            'current_tier': current_tier,
            'stable_count': n_value,
            'next_tier': next_tier,
            'next_threshold': next_threshold,
            'progress': progress,
        }
