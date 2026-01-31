"""
Generic stability tracker for content caching tiers.

Tracks how long content remains unchanged across LLM responses,
enabling intelligent caching decisions. Content that stays stable
gets promoted to cached tiers, reducing API costs.
"""

import hashlib
import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Callable, Literal, Union


# Type alias for tier names
TierName = Literal['active', 'L3', 'L2', 'L1', 'L0']


@dataclass
class StabilityInfo:
    """Stability tracking data for a single item."""
    content_hash: str           # SHA256 of content
    stable_count: int           # Consecutive unchanged responses
    current_tier: str           # 'active', 'L3', 'L2', 'L1', or 'L0'
    tier_entry_response: int    # Response number when entered current tier


class StabilityTracker:
    """
    Generic stability tracker for any content type.
    
    Tracks content stability over time and assigns items to tiers
    based on how long they've remained unchanged. Designed for reuse
    across file caching, symbol map ordering, and other use cases.
    
    Default tiers (Bedrock 4-cache-block optimized):
    - L0: Most stable content (N >= 12), cached first
    - L1: Very stable (N >= 9), cached second
    - L2: Stable (N >= 6), cached third
    - L3: Moderately stable (N >= 3), cached fourth
    - active: Recently changed content, not cached
    
    New items start in the initial_tier (default: L3) for immediate cache benefits.
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
            thresholds: Dict mapping tier names to stability thresholds.
                       Default: {'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}
                       Legacy l1_threshold/l0_threshold used if thresholds not provided.
            l1_threshold: (Legacy) Stable count needed for L1 tier
            l0_threshold: (Legacy) Stable count needed for L0 tier
            reorg_interval: Minimum responses between reorganizations
            reorg_drift_threshold: Fraction of misplaced items to trigger reorg
            initial_tier: Starting tier for new items ('L3', 'L1', or 'active')
        """
        self._persistence_path = Path(persistence_path)
        
        # Support both new thresholds dict and legacy 2-tier params
        if thresholds:
            self._thresholds = thresholds
        else:
            # Legacy 2-tier mode for backwards compatibility
            self._thresholds = {'L1': l1_threshold, 'L0': l0_threshold}
        
        # Sort thresholds by value ascending for tier computation
        self._tier_order = sorted(
            self._thresholds.keys(),
            key=lambda t: self._thresholds[t]
        )
        
        self._reorg_interval = reorg_interval
        self._reorg_drift_threshold = reorg_drift_threshold
        self._initial_tier = initial_tier
        
        self._stability: dict[str, StabilityInfo] = {}
        self._response_count: int = 0
        self._last_reorg_response: int = 0
        
        # Track promotions/demotions for the last update (for notifications)
        self._last_promotions: list[tuple[str, str]] = []  # [(item, new_tier), ...]
        self._last_demotions: list[tuple[str, str]] = []   # [(item, new_tier), ...]
        
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
        
        Args:
            items: All items currently in context
            get_content: Function to get content for an item
            modified: Items known to be modified (optimization)
        
        Returns:
            Dict mapping items to their new tiers (only changed items)
        """
        self._response_count += 1
        modified_set = set(modified or [])
        tier_changes = {}
        
        # Reset promotion/demotion tracking for this update
        self._last_promotions = []
        self._last_demotions = []
        
        for item in items:
            try:
                content = get_content(item)
                if content is None:
                    continue
                new_hash = self.compute_hash(content)
            except Exception:
                continue
            
            if item not in self._stability:
                # New item - greedy initialization
                self._stability[item] = self._initialize_item(item, new_hash)
                tier_changes[item] = self._stability[item].current_tier
                continue
            
            info = self._stability[item]
            old_tier = info.current_tier
            
            if item in modified_set or info.content_hash != new_hash:
                # Content changed - demote to active
                info.content_hash = new_hash
                info.stable_count = 0
                if info.current_tier != 'active':
                    info.current_tier = 'active'
                    info.tier_entry_response = self._response_count
                    tier_changes[item] = 'active'
                    self._last_demotions.append((item, 'active'))
            else:
                # Content unchanged - increment stability
                info.stable_count += 1
                new_tier = self._compute_tier(info.stable_count)
                if new_tier != info.current_tier:
                    info.current_tier = new_tier
                    info.tier_entry_response = self._response_count
                    tier_changes[item] = new_tier
                    # Track promotion (moving to a higher-threshold tier)
                    if self._is_promotion(old_tier, new_tier):
                        self._last_promotions.append((item, new_tier))
                    else:
                        self._last_demotions.append((item, new_tier))
        
        # Check for reorganization
        if self._should_reorganize():
            self._reorganize()
        
        self.save()
        return tier_changes
    
    def _is_promotion(self, old_tier: str, new_tier: str) -> bool:
        """Check if moving from old_tier to new_tier is a promotion.
        
        A promotion means moving to a tier with a higher threshold (more stable).
        """
        if old_tier == 'active':
            return new_tier != 'active'
        if new_tier == 'active':
            return False
        
        old_threshold = self._thresholds.get(old_tier, 0)
        new_threshold = self._thresholds.get(new_tier, 0)
        return new_threshold > old_threshold
    
    def _initialize_item(self, item: str, content_hash: str) -> StabilityInfo:
        """Greedily initialize new items in the initial tier.
        
        Sets stable_count to the tier's threshold so items can promote naturally.
        """
        if self._initial_tier == 'active':
            initial_count = 0
            initial_tier = 'active'
        elif self._initial_tier in self._thresholds:
            initial_count = self._thresholds[self._initial_tier]
            initial_tier = self._initial_tier
        else:
            # Fallback to lowest cached tier
            lowest_tier = self._tier_order[0] if self._tier_order else 'active'
            initial_count = self._thresholds.get(lowest_tier, 0)
            initial_tier = lowest_tier
        
        return StabilityInfo(
            content_hash=content_hash,
            stable_count=initial_count,
            current_tier=initial_tier,
            tier_entry_response=self._response_count
        )
    
    def _compute_tier(self, stable_count: int) -> str:
        """Compute tier based on stability count.
        
        Iterates through tiers in ascending threshold order,
        returning the highest tier whose threshold is met.
        """
        result_tier = 'active'
        for tier in self._tier_order:
            if stable_count >= self._thresholds[tier]:
                result_tier = tier
        return result_tier
    
    def get_tier(self, item: str) -> str:
        """Get current tier for an item."""
        if item in self._stability:
            return self._stability[item].current_tier
        return 'active'
    
    def get_stable_count(self, item: str) -> int:
        """Get stability count for an item."""
        if item in self._stability:
            return self._stability[item].stable_count
        return 0
    
    def get_items_by_tier(self, items: list[str] = None) -> dict[str, list[str]]:
        """
        Get items grouped by tier.
        
        Args:
            items: Filter to these items only. If None, return all tracked items.
        
        Returns:
            Dict with tier names as keys mapping to item lists,
            sorted by stable_count descending within each tier.
            Always includes 'active' plus all configured tiers.
        """
        # Initialize with all configured tiers plus active
        result = {'active': []}
        for tier in self._tier_order:
            result[tier] = []
        
        check_items = items if items is not None else list(self._stability.keys())
        
        for item in check_items:
            tier = self.get_tier(item)
            if tier not in result:
                result[tier] = []
            result[tier].append(item)
        
        # Sort within tiers by stable_count descending
        for tier in result:
            result[tier].sort(key=lambda x: self.get_stable_count(x), reverse=True)
        
        return result
    
    def _should_reorganize(self) -> bool:
        """Check if tier boundaries should be recomputed."""
        if self._response_count - self._last_reorg_response < self._reorg_interval:
            return False
        
        # Count misplaced items (items not in their computed tier)
        misplaced = 0
        total_cached = 0
        
        cached_tiers = set(self._tier_order)  # All non-active tiers
        
        for info in self._stability.values():
            if info.current_tier in cached_tiers:
                total_cached += 1
                expected_tier = self._compute_tier(info.stable_count)
                if expected_tier != info.current_tier:
                    misplaced += 1
        
        if total_cached == 0:
            return False
        
        return (misplaced / total_cached) > self._reorg_drift_threshold
    
    def _reorganize(self) -> None:
        """Recompute tiers based on current stability counts."""
        self._last_reorg_response = self._response_count
        
        for info in self._stability.values():
            new_tier = self._compute_tier(info.stable_count)
            if new_tier != info.current_tier:
                info.current_tier = new_tier
                info.tier_entry_response = self._response_count
    
    def save(self) -> None:
        """Persist stability data to disk."""
        self._persistence_path.parent.mkdir(parents=True, exist_ok=True)
        
        data = {
            'response_count': self._response_count,
            'last_reorg_response': self._last_reorg_response,
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
            self._last_reorg_response = data.get('last_reorg_response', 0)
            self._stability = {
                k: StabilityInfo(**v)
                for k, v in data.get('items', {}).items()
            }
        except (json.JSONDecodeError, TypeError, KeyError):
            # Corrupted file - start fresh
            self._stability = {}
            self._response_count = 0
            self._last_reorg_response = 0
    
    def clear(self) -> None:
        """Clear all stability data."""
        self._stability = {}
        self._response_count = 0
        self._last_reorg_response = 0
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
        """Get the tier thresholds.
        
        Returns:
            Dict mapping tier names to stability count thresholds
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
            Dict with current_tier, stable_count, next_tier, next_threshold, progress
        """
        current_tier = self.get_tier(item)
        stable_count = self.get_stable_count(item)
        
        # Find next tier (the one with the next higher threshold)
        next_tier = None
        next_threshold = None
        
        if current_tier == 'active':
            # Next tier is the lowest threshold tier
            if self._tier_order:
                next_tier = self._tier_order[0]
                next_threshold = self._thresholds[next_tier]
        elif current_tier in self._thresholds:
            # Find the tier with the next higher threshold
            current_threshold = self._thresholds[current_tier]
            for tier in self._tier_order:
                if self._thresholds[tier] > current_threshold:
                    next_tier = tier
                    next_threshold = self._thresholds[tier]
                    break
        
        # Calculate progress toward next tier
        progress = 0.0
        if next_threshold is not None and next_threshold > 0:
            progress = min(1.0, stable_count / next_threshold)
        elif current_tier == self._tier_order[-1] if self._tier_order else False:
            # Already at highest tier
            progress = 1.0
        
        return {
            'current_tier': current_tier,
            'stable_count': stable_count,
            'next_tier': next_tier,
            'next_threshold': next_threshold,
            'progress': progress,
        }
