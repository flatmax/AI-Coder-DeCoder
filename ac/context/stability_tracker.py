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
from typing import Callable, Literal


@dataclass
class StabilityInfo:
    """Stability tracking data for a single item."""
    content_hash: str           # SHA256 of content
    stable_count: int           # Consecutive unchanged responses
    current_tier: Literal['active', 'L1', 'L0']
    tier_entry_response: int    # Response number when entered current tier


class StabilityTracker:
    """
    Generic stability tracker for any content type.
    
    Tracks content stability over time and assigns items to tiers
    based on how long they've remained unchanged. Designed for reuse
    across file caching, symbol map ordering, and other use cases.
    
    Tiers:
    - L0: Most stable content (N >= l0_threshold), cached first
    - L1: Moderately stable (N >= l1_threshold), cached second
    - active: Recently changed content, not cached
    
    New items start in L1 (greedy) for immediate cache benefits.
    """
    
    def __init__(
        self,
        persistence_path: Path,
        l1_threshold: int = 3,
        l0_threshold: int = 5,
        reorg_interval: int = 10,
        reorg_drift_threshold: float = 0.2,
        initial_tier: str = 'L1'
    ):
        """
        Initialize stability tracker.
        
        Args:
            persistence_path: Path to JSON file for persistence
            l1_threshold: Stable count needed for L1 tier (default: 3)
            l0_threshold: Stable count needed for L0 tier (default: 10)
            reorg_interval: Minimum responses between reorganizations
            reorg_drift_threshold: Fraction of misplaced items to trigger reorg
            initial_tier: Starting tier for new items ('L1' or 'active')
        """
        self._persistence_path = Path(persistence_path)
        self._l1_threshold = l1_threshold
        self._l0_threshold = l0_threshold
        self._reorg_interval = reorg_interval
        self._reorg_drift_threshold = reorg_drift_threshold
        self._initial_tier = initial_tier
        
        self._stability: dict[str, StabilityInfo] = {}
        self._response_count: int = 0
        self._last_reorg_response: int = 0
        
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
            
            if item in modified_set or info.content_hash != new_hash:
                # Content changed - demote to active
                info.content_hash = new_hash
                info.stable_count = 0
                if info.current_tier != 'active':
                    info.current_tier = 'active'
                    info.tier_entry_response = self._response_count
                    tier_changes[item] = 'active'
            else:
                # Content unchanged - increment stability
                info.stable_count += 1
                new_tier = self._compute_tier(info.stable_count)
                if new_tier != info.current_tier:
                    info.current_tier = new_tier
                    info.tier_entry_response = self._response_count
                    tier_changes[item] = new_tier
        
        # Check for reorganization
        if self._should_reorganize():
            self._reorganize()
        
        self.save()
        return tier_changes
    
    def _initialize_item(self, item: str, content_hash: str) -> StabilityInfo:
        """Greedily initialize new items in L1."""
        initial_count = self._l1_threshold if self._initial_tier == 'L1' else 0
        initial_tier = self._initial_tier if self._initial_tier in ('L1', 'active') else 'L1'
        return StabilityInfo(
            content_hash=content_hash,
            stable_count=initial_count,
            current_tier=initial_tier,
            tier_entry_response=self._response_count
        )
    
    def _compute_tier(self, stable_count: int) -> str:
        """Compute tier based on stability count."""
        if stable_count >= self._l0_threshold:
            return 'L0'
        elif stable_count >= self._l1_threshold:
            return 'L1'
        return 'active'
    
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
            Dict with keys 'L0', 'L1', 'active' mapping to item lists,
            sorted by stable_count descending within each tier.
        """
        result = {'L0': [], 'L1': [], 'active': []}
        
        check_items = items if items is not None else list(self._stability.keys())
        
        for item in check_items:
            tier = self.get_tier(item)
            result[tier].append(item)
        
        # Sort within tiers by stable_count descending
        for tier in result:
            result[tier].sort(key=lambda x: self.get_stable_count(x), reverse=True)
        
        return result
    
    def _should_reorganize(self) -> bool:
        """Check if L0/L1 boundary should be recomputed."""
        if self._response_count - self._last_reorg_response < self._reorg_interval:
            return False
        
        # Count misplaced items
        misplaced = 0
        total_cached = 0
        
        for info in self._stability.values():
            if info.current_tier in ('L0', 'L1'):
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
        if self._persistence_path.exists():
            self._persistence_path.unlink()
