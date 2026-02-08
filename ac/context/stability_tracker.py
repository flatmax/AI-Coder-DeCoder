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
from collections import defaultdict
from dataclasses import dataclass
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


def find_connected_components(
    edges: set[tuple[str, str]],
    all_nodes: set[str] = None,
) -> list[set[str]]:
    """Find connected components using union-find.
    
    Args:
        edges: Set of (node_a, node_b) undirected edges
        all_nodes: Complete node set (to include isolated nodes as singletons).
                   If None, only nodes appearing in edges are included.
    
    Returns:
        List of sets, each a connected component. Isolated nodes
        (not in any edge) are singleton sets.
    """
    parent = {}
    
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]  # Path compression
            x = parent[x]
        return x
    
    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    
    # Initialize all nodes
    nodes = set()
    if all_nodes:
        nodes.update(all_nodes)
    for a, b in edges:
        nodes.add(a)
        nodes.add(b)
    
    for node in nodes:
        parent[node] = node
    
    # Union edges
    for a, b in edges:
        union(a, b)
    
    # Collect components
    components = defaultdict(set)
    for node in nodes:
        components[find(node)].add(node)
    
    return list(components.values())


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
        thresholds: dict[str, int] = None,
        initial_tier: str = 'L3',
        cache_target_tokens: int = 0,
    ):
        """
        Initialize stability tracker.
        
        Stability data is ephemeral — not persisted across sessions.
        On each startup, tiers rebuild from the reference graph.
        
        Args:
            thresholds: Dict mapping tier names to entry thresholds.
                       Defines entry_n values for each tier.
                       Defaults to 4-tier config: L3=3, L2=6, L1=9, L0=12.
            initial_tier: Starting tier for new items (default: 'L3')
            cache_target_tokens: Target tokens per cache block (0 = disabled).
                                Veterans below this threshold anchor the tier.
        """
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
    
    def compute_hash(self, content: str) -> str:
        """Compute SHA256 hash of content."""
        return hashlib.sha256(content.encode()).hexdigest()
    
    def update_after_response(
        self,
        items: list[str],
        get_content: Callable[[str], str],
        modified: list[str] = None,
        get_tokens: Callable[[str], int] = None,
        broken_tiers: set[str] = None,
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
            broken_tiers: Optional set of tiers pre-invalidated by external events
                         (e.g., stale item removal). These tiers are treated as
                         broken for cascade purposes.
        
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
        # Start with any pre-invalidated tiers (e.g., from stale item removal)
        broken_tiers = set(broken_tiers) if broken_tiers else set()
        
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
                        broken_tiers.add(old_tier)  # Tier lost an item
                        info.tier = 'active'
                        tier_changes[item] = 'active'
                        self._last_demotions.append((item, old_tier))
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
        
        # Note: Items that reach N >= 3 while still in the active items list
        # do NOT auto-promote to L3. They stay active with their accumulated N.
        # This allows the caller to control graduation timing (e.g., for history
        # messages that should only graduate when piggybacking on a file/symbol
        # ripple or when a token threshold is met). Items enter L3 only when
        # they leave the active items list.
        
        # Run cascade: process tier entries with broken tier guard.
        # The cascade runs even if nothing enters L3 — demotions from cached
        # tiers create openings that veterans below can fill.
        self._process_tier_entries(items_entering_l3, tier_changes, get_tokens,
                                   broken_tiers=broken_tiers)
        
        # Update tracking for next round
        self._last_active_items = current_active.copy()
        
        return tier_changes
    
    def _process_tier_entries(
        self,
        entering_l3_items: list[str],
        tier_changes: dict[str, str],
        get_tokens: Callable[[str], int] = None,
        broken_tiers: set[str] = None,
    ) -> None:
        """
        Process items entering cache tiers with ripple promotion.
        
        Uses multi-pass bottom-up cascade with broken tier guard:
        1. Items entering L3 get that tier's entry_n value
        2. Each tier is processed bottom-up (L3 → L2 → L1 → L0)
        3. Veterans only promote into tiers that are broken (invalidated)
        4. When items enter or leave a tier, that tier is marked broken
        5. N is capped at the promotion threshold when the tier above is stable
        6. With threshold-aware mode: low-N veterans anchor, high-N can promote
        7. Multi-pass repeats until no promotions occur (cascade converges)
        
        Args:
            entering_l3_items: Items entering L3 from active graduation
            tier_changes: Dict to record tier changes (mutated)
            get_tokens: Optional function to get token count for items
            broken_tiers: Set of tiers already invalidated (e.g., from demotions).
                         Mutated during cascade as tiers gain/lose items.
        """
        if broken_tiers is None:
            broken_tiers = set()
        
        # Separate tracking: broken_tiers tracks tiers whose cache block content
        # changed (demotions, items entering/leaving). promotable_tiers includes
        # broken_tiers PLUS empty tiers (safe to promote into — no cache to break).
        promotable_tiers = set(broken_tiers)
        for tier in TIER_PROMOTION_ORDER:
            if not any(1 for info in self._stability.values() if info.tier == tier):
                promotable_tiers.add(tier)
        
        # Seed: items entering L3 from active graduation
        entering_items_for_tier = {
            'L3': list(entering_l3_items) if entering_l3_items else [],
            'L2': [], 'L1': [], 'L0': [],
        }
        
        # Track which tiers have had their veterans processed this cascade.
        # Veterans get N++ at most once per cascade cycle.
        tiers_processed = set()
        
        # Multi-pass bottom-up: repeat until no promotions occur.
        # Multiple passes handle the case where a higher-tier promotion
        # breaks a tier that a lower tier's veterans could promote into.
        # Example: L1 broken → L2 vet promotes to L1 → L2 broken →
        #          pass 2: L3 vet promotes into L2
        any_promoted = True
        while any_promoted:
            any_promoted = False
            
            for current_tier in TIER_PROMOTION_ORDER:
                entering_items = entering_items_for_tier[current_tier]
                entering_items_for_tier[current_tier] = []  # Consume
                
                config = TIER_CONFIG[current_tier]
                entry_n = config['entry_n']
                promotion_threshold = config['promotion_threshold']
                next_tier = self._get_next_tier(current_tier)
                
                # Process this tier if:
                # 1. Items are entering (new content to place), OR
                # 2. Veterans haven't been processed yet AND the tier was
                #    touched by the cascade (in broken_tiers — content changed)
                #    or the tier above is broken (veterans could promote into it)
                needs_veteran_processing = (
                    current_tier not in tiers_processed
                    and (current_tier in broken_tiers
                         or (next_tier and next_tier in broken_tiers))
                )
                
                if not entering_items and not needs_veteran_processing:
                    continue
                
                # Snapshot veterans (items already in this tier, not entering)
                entering_set = set(entering_items)
                veterans_in_tier = [
                    item for item, info in self._stability.items()
                    if info.tier == current_tier and item not in entering_set
                ]
                
                # Move all entering items to this tier with entry_n
                accumulated_tokens = 0
                if entering_items:
                    broken_tiers.add(current_tier)  # Tier content changed
                    promotable_tiers.add(current_tier)
                
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
                
                # Process veterans (only once per cascade cycle)
                items_to_promote = []
                next_tier_is_promotable = next_tier and next_tier in promotable_tiers
                
                if current_tier not in tiers_processed:
                    tiers_processed.add(current_tier)
                    
                    if self._cache_target_tokens > 0 and get_tokens:
                        # Threshold-aware mode: sort veterans by N ascending
                        # Low-N veterans anchor the tier, high-N can promote
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
                            else:
                                # Threshold met: N++ and can potentially promote
                                veteran_info.n_value += 1
                                
                                if promotion_threshold is not None and veteran_info.n_value >= promotion_threshold:
                                    if next_tier_is_promotable:
                                        items_to_promote.append(veteran_item)
                                    else:
                                        veteran_info.n_value = promotion_threshold
                    else:
                        # Non-threshold mode: all veterans get N++ once
                        for veteran_item in veterans_in_tier:
                            veteran_info = self._stability[veteran_item]
                            veteran_info.n_value += 1
                            
                            if promotion_threshold is not None and veteran_info.n_value >= promotion_threshold:
                                if next_tier_is_promotable:
                                    items_to_promote.append(veteran_item)
                                else:
                                    veteran_info.n_value = promotion_threshold
                
                # Promoted veterans become entries for the next tier
                if items_to_promote and next_tier:
                    entering_items_for_tier[next_tier].extend(items_to_promote)
                    broken_tiers.add(current_tier)  # Items left this tier
                    promotable_tiers.add(current_tier)
                    any_promoted = True
    
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
        
        return tier_assignments
    
    def initialize_from_clusters(
        self,
        clusters: list[set[str]],
        get_tokens: Callable[[str], int],
        target_tokens: int = 0,
        exclude_active: set[str] = None,
    ) -> dict[str, str]:
        """Initialize tiers by distributing clusters across L1/L2/L3.
        
        Uses greedy bin-packing: sort clusters by total tokens descending,
        assign each to the tier (L1, L2, L3) with the fewest tokens so far.
        Each cluster stays together in one tier.
        
        L0 is never assigned — must be earned through ripple promotion.
        
        If total content is insufficient to fill all three tiers above
        target_tokens, fill fewer tiers (L1 first, then L2, then L3).
        An empty tier is better than a tier below the provider minimum.
        
        Only runs if stability data is empty (fresh start).
        
        Args:
            clusters: List of sets, each containing item keys (e.g., "symbol:file.py")
            get_tokens: Function to get token count for an item
            target_tokens: Minimum tokens per tier (0 = no minimum)
            exclude_active: Items to exclude (e.g., files in active context)
            
        Returns:
            Dict mapping item keys to their assigned tiers
        """
        if self._stability:
            return {}
        
        if not clusters:
            return {}
        
        exclude = exclude_active or set()
        
        # Filter excluded items from clusters and remove empty clusters
        filtered_clusters = []
        for cluster in clusters:
            filtered = cluster - exclude
            if filtered:
                filtered_clusters.append(filtered)
        
        if not filtered_clusters:
            return {}
        
        # Compute total tokens per cluster
        cluster_tokens = []
        for cluster in filtered_clusters:
            total = sum(get_tokens(item) for item in cluster)
            cluster_tokens.append((cluster, total))
        
        # Sort by total tokens descending (largest clusters first)
        cluster_tokens.sort(key=lambda x: x[1], reverse=True)
        
        # Greedy bin-packing: assign each cluster to tier with fewest tokens
        tiers = ['L1', 'L2', 'L3']
        tier_n_values = {'L1': 9, 'L2': 6, 'L3': 3}
        tier_totals = {t: 0 for t in tiers}
        tier_items = {t: [] for t in tiers}
        
        for cluster, tokens in cluster_tokens:
            # Pick tier with minimum tokens
            best_tier = min(tiers, key=lambda t: tier_totals[t])
            tier_totals[best_tier] += tokens
            tier_items[best_tier].extend(cluster)
        
        # Consolidate underfilled tiers: merge tiers below target into fewer, fuller ones
        if target_tokens > 0:
            # Collect items from tiers that don't meet minimum, starting from L3
            # Prefer fewer fuller tiers over many thin ones
            for merge_from in reversed(tiers):  # L3, L2, L1
                if tier_totals[merge_from] > 0 and tier_totals[merge_from] < target_tokens:
                    # Find the best tier to merge into (smallest that isn't this one)
                    candidates = [t for t in tiers if t != merge_from and tier_totals[t] > 0]
                    if candidates:
                        merge_into = min(candidates, key=lambda t: tier_totals[t])
                        tier_totals[merge_into] += tier_totals[merge_from]
                        tier_items[merge_into].extend(tier_items[merge_from])
                        tier_totals[merge_from] = 0
                        tier_items[merge_from] = []
                    elif tier_totals[merge_from] > 0:
                        # No other tier has content — this is the only tier, keep it
                        pass
        
        # Assign items to stability tracker
        tier_assignments = {}
        for tier in tiers:
            n_value = tier_n_values[tier]
            for item in tier_items[tier]:
                content_hash = f"cluster:{item}"
                self._stability[item] = StabilityInfo(
                    content_hash=content_hash,
                    n_value=n_value,
                    tier=tier,
                )
                tier_assignments[item] = tier
        
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
