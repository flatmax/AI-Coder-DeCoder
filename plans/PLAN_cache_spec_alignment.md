# Plan: Align Cache Management Implementation with Specification

## Summary

The `specs/cache_management.md` spec describes a mature cache management system. The current implementation covers ~80% of it, but several areas diverge or are missing. This plan identifies each gap and describes the changes needed to bring the code into full alignment.

## Analysis: Current State vs Spec

### ✅ Already Implemented Correctly

1. **Tier structure** (L0-L3 + active) with correct entry_n and promotion thresholds
2. **N value tracking** — increment for veterans in active, reset on modification
3. **Basic ripple promotion** — cascade through tiers when items enter
4. **Threshold-aware promotion** — token-gated veteran N++ with anchoring
5. **Graduation from active → L3** when items leave active items list
6. **History graduation control** — piggybacking on file/symbol ripple, token threshold
7. **`_select_history_to_graduate`** — keeps newest, graduates oldest
8. **`remove_by_prefix`** for history compaction cleanup
9. **Heuristic initialization from refs** (percentile-based and threshold-aware)
10. **Cache block structure** in streaming — L0 system block, L1-L3 tier blocks, active content
11. **Symbol map exclusion** for active context files
12. **Demotion** on content hash change or explicit modification
13. **Persistence** save/load with format migration

### ❌ Gaps to Address

#### Gap 1: No Reference-Graph Clustering for Initialization
**Spec says**: Initialize tiers using bidirectional reference graph edges → connected components → greedy bin-packing across L1/L2/L3.
**Current code**: `initialize_from_refs` uses simple percentile-based (top 20% → L1, next 30% → L2, rest → L3) or threshold-aware fill (top-down L1 → L2 → L3 by token count). Neither uses the mutual reference graph or connected components.
**Impact**: Suboptimal initial clustering — mutually coupled files may land in different tiers, causing unnecessary cache invalidation when one is edited.

#### Gap 2: History Sent as Formatted Strings in Cached Tiers, Not Native Pairs
**Spec says**: History messages are **always** sent as native user/assistant message pairs, whether cached or active. The `cache_control` marker goes on the **last message** in each tier's sequence.
**Current code**: `_format_history_for_cache` in `streaming.py` formats history as markdown strings (`### User\n...`, `### Assistant\n...`) inside a single user message block. Only active history uses native pairs.
**Impact**: LLM sees quoted markdown instead of real conversation turns in cached tiers, reducing comprehension quality.

#### Gap 3: N Increment in Cached Tiers Only Happens on Entry (Not Every Request)
**Spec says**: N continues incrementing in **all tiers** — active, L3, L2, L1, and L0. Veterans in cached tiers get N++ each request when items enter their tier. The per-tier algorithm runs during the cascade for **each tier that receives incoming items**.
**Current code**: `_process_tier_entries` only processes veterans in tiers that receive new entering items. If no items enter L3 on a given request (nothing leaves active), veterans in L3/L2/L1/L0 get no N++ at all. The cascade only runs when `items_entering_l3` is non-empty.
**Spec clarification**: The spec says "When items enter a tier, veterans (existing items in that tier) get N++ once" — this means N++ happens **per cascade cycle that touches the tier**, not per request. If no cascade reaches a tier, its veterans don't increment. This is actually what the code does. However, the spec also says in "N Progression" point 2: "Item unchanged across a request: N increments by 1 each request" — this is for items in **active** context. For cached tiers, the increment is tied to the cascade. **This is consistent with current behavior.** Reclassifying as ✅.

#### Gap 4: No "Only Promote Into Broken Tiers" Guard
**Spec says**: Veterans only promote into tiers that are **invalidated** (cache miss). If L1 is stable, nothing promotes into L1 — L2 and L3 stay cached. The cascade stops at stable tiers.
**Current code**: `_process_tier_entries` always cascades promotions upward without checking whether the destination tier is invalidated. If a veteran in L3 reaches N=6, it promotes to L2 regardless of whether L2's cache block changed. This means a promotion in L3 can break L2's cache even when L2 was stable.
**Impact**: Unnecessary cache invalidation in higher tiers. The whole point of the guard is that stable tiers stay cached.

#### Gap 5: No N Cap When Tier Above Is Stable
**Spec says**: When the tier above is NOT invalidated, N++ still applies but is **capped at the promotion threshold**. Veterans cannot accumulate N past the threshold when they can't leave.
**Current code**: No N cap. Veterans accumulate N indefinitely. When the tier above finally breaks, they promote immediately (which is correct), but the uncapped N means multiple veterans could over-qualify simultaneously, causing a larger cascade than necessary.
**Impact**: Minor — the practical effect is that when a tier finally breaks, more veterans may promote at once. The cap would make behavior more predictable.

#### Gap 6: No Persistence Disabled / Fresh Start Each Session
**Spec says**: "There is no persistence — stability data is rebuilt fresh each session." The `save()` and `load()` methods exist but the spec explicitly says data is NOT persisted across sessions.
**Current code**: `save()` and `load()` are called, and the tracker loads from disk on init. This means tier assignments persist across restarts, which the spec says should not happen.
**Impact**: Stale state across sessions. The spec wants fresh initialization from the reference graph each time.
**Resolution**: This is a design choice that may need discussion. The persistence code is useful for within-session recovery (crash resilience). The spec's rationale is that cross-session persistence causes stale L0 assignments. Options: (a) delete persistence entirely, (b) keep persistence but mark it as session-scoped (clear on startup), (c) keep as-is and update spec. **Recommend (b): clear on startup, keep within-session persistence for crash resilience.**

#### Gap 7: Missing Bidirectional Reference Graph Infrastructure
**Spec says**: The initialization algorithm needs bidirectional edges from `ReferenceIndex._file_deps` and `_file_refs`, connected components, and greedy bin-packing.
**Current code**: `ReferenceIndex` has `_file_deps` and `_file_refs` but no methods to extract bidirectional edges, find connected components, or do bin-packing. `initialize_from_refs` takes a flat list of `(file, ref_count)` tuples — no graph structure.
**Impact**: Required for Gap 1.

#### Gap 8: History in L0 Block Uses Formatted Strings
**Spec says**: L0 block contains system prompt + legend + L0 symbols + L0 files. History in L0 (if any) uses native pairs with `cache_control` on the last message.
**Current code**: L0 history is appended via `_format_history_for_cache` (markdown strings) inside the system message block.
**Impact**: Same as Gap 2 — LLM sees markdown instead of native conversation turns.

#### Gap 9: No Item Removal from Cached Tiers on File Deletion
**Spec says**: When a file is deleted or unchecked, its entries are removed from their cached tier, marking that tier as broken (cache miss / ripple).
**Current code**: `_update_cache_stability` only examines items in the active set. Files that are deleted from the repo or unchecked from the picker leave stale entries in their cached tiers indefinitely. These tiers are never marked as broken, so the cascade doesn't trigger when it should.
**Impact**: Stale content wastes cache space. Tiers that should be invalidated remain "stable," preventing correct cascade behavior.

## Implementation Plan

### Phase 1: Broken Tier Guard and N Cap (Gaps 4, 5) — ✅ DONE

**Files**: `ac/context/stability_tracker.py`, `tests/test_stability_tracker.py`

The spec's critical rule: "only promote into broken tiers." A tier is broken when items enter it (changing its cache block content). The cascade propagates bottom-up: entering items break L3 → promotions from L3 break L2 → promotions from L2 break L1 → etc. If no items promote into a tier, it stays stable and the cascade stops.

#### 1a. Track broken tiers in `_process_tier_entries`

Add a `broken_tiers: set[str]` parameter. The set tracks which tiers have had their content change this cycle (and therefore whose cache block is invalidated). A tier is added to the set when:
- Items are demoted FROM it (content hash changed or explicit modification) — detected before cascade starts
- Items ENTER it during the cascade (new content added to the tier's block)
- Items LEAVE it via promotion (content removed from the tier's block)

```python
def _process_tier_entries(self, initial_entering_items, initial_tier,
                          tier_changes, get_tokens=None,
                          broken_tiers=None):
```

The caller (`update_after_response`) passes `broken_tiers` pre-populated with tiers that were invalidated by demotions. The cascade loop adds tiers as items enter/leave them.

Note: an empty tier that receives its first items IS marked broken (its content changed from nothing to something). This is harmless — the tier had no cached block to invalidate, and marking it broken allows the cascade to continue upward if needed.

Additionally, empty tiers (no items at all) are pre-populated in `broken_tiers` before the cascade starts. An empty tier has no cached content to protect, so promoting into it is always free:

```python
# Empty tiers are always available for promotion
for tier in TIER_PROMOTION_ORDER:
    if not any(1 for info in self._stability.values() if info.tier == tier):
        broken_tiers.add(tier)
```

The `broken_tiers` set grows during the cascade — each time items enter or leave a tier, that tier is added. This means the guard check for each tier uses the most up-to-date information about which tiers have been touched this cycle.

#### 1b. Guard promotions against stable destination tiers

In the cascade loop, after veterans get N++ (or are held back by threshold-aware logic), check whether the next tier is broken before allowing promotion:

```python
next_tier = self._get_next_tier(current_tier)

# Collect veterans that reached promotion threshold
items_to_promote = []
for veteran_item in veterans_with_npp:
    info = self._stability[veteran_item]
    if promotion_threshold is not None and info.n_value >= promotion_threshold:
        if next_tier and next_tier in broken_tiers:
            items_to_promote.append(veteran_item)
        else:
            # Destination is stable — cap N at threshold
            info.n_value = min(info.n_value, promotion_threshold)
```

When promotions DO happen:
- The destination tier is marked broken (items entering it)
- The source tier is marked broken (items leaving it) — this matters because losing content from a tier changes its cache block
- The promoted items become `entering_items` for the next iteration of the cascade loop

#### 1c. Cap N at promotion threshold when tier above is stable

When a veteran reaches the promotion threshold but cannot promote (tier above is stable), cap N at the threshold. This prevents artificial N inflation. When the tier above eventually breaks, the veteran promotes immediately at exactly the threshold value.

This is handled by the same guard in 1b — veterans that would promote but can't have their N capped.

#### 1d. Track demotions as tier invalidations

When a cached item is demoted to active (content changed), its former tier is now broken (its cache block content changed). Collect these in `update_after_response`:

```python
# Phase 1: detect demotions → build initial broken_tiers
broken_tiers = set()
for item in items:
    if item in self._stability:
        info = self._stability[item]
        if item in modified_set or info.content_hash != new_hash:
            if info.tier != 'active':
                broken_tiers.add(info.tier)
            # ... existing demotion logic
```

Pass `broken_tiers` to `_process_tier_entries`.

#### 1e. Run cascade even when nothing graduates from active

Currently `_process_tier_entries` is only called when `items_entering_l3` is non-empty. But the spec says the cascade should run whenever any tier is broken — e.g., if an item in L2 is demoted (breaking L2), veterans in L3 should be able to promote into L2 even if nothing left active this round.

After collecting `broken_tiers` from demotions, check whether any cached tier below the broken tier has veterans that could promote. The simplest approach: always call `_process_tier_entries` with `items_entering_l3` (which may be empty), and let the cascade logic handle it. The cascade loop already processes each tier bottom-up. With `broken_tiers` available, the loop can check whether veterans in L3 can promote into a broken L2 even if no items entered L3 this cycle.

To support this, the cascade loop needs a restructure. Instead of starting from an initial tier with entering items and following promotions upward, it should iterate through all tiers bottom-up **repeatedly** until no more promotions occur. A single bottom-up pass is insufficient because a promotion at a higher tier (e.g., L2→L1) breaks L2, which creates an opportunity for L3 veterans — but L3 was already processed in this pass.

Example: L1 is broken from a demotion. L2 has a veteran at threshold. L3 has a veteran at threshold.
- Pass 1: Process L3 — L2 is not broken, skip. Process L2 — L1 IS broken, veteran promotes into L1. This breaks L2.
- Pass 2: Process L3 — L2 IS now broken, veteran promotes into L2. Process L2 — nothing new. Done.

The loop converges in at most 4 iterations (one per tier level). In practice most cascades complete in 1-2 passes.

```python
def _process_tier_entries(self, entering_l3_items, tier_changes, 
                          get_tokens=None, broken_tiers=None):
    """Process tier entries with cascade, multi-pass bottom-up."""
    if broken_tiers is None:
        broken_tiers = set()
    
    # Pre-populate: empty tiers are always available
    for tier in TIER_PROMOTION_ORDER:
        if not any(1 for info in self._stability.values() if info.tier == tier):
            broken_tiers.add(tier)
    
    # Seed: items entering L3 from active graduation
    entering_items_for_tier = {
        'L3': list(entering_l3_items) if entering_l3_items else [],
        'L2': [], 'L1': [], 'L0': [],
    }
    
    # Multi-pass: repeat until no promotions occur
    any_promoted = True
    while any_promoted:
        any_promoted = False
        
        for current_tier in TIER_PROMOTION_ORDER:
            entering_items = entering_items_for_tier[current_tier]
            entering_items_for_tier[current_tier] = []  # Consume
            
            next_tier = self._get_next_tier(current_tier)
            
            # Skip if nothing entering AND tier above isn't broken
            if not entering_items and (not next_tier or next_tier not in broken_tiers):
                continue
            
            # ... process entering items and veterans ...
            # ... collect items_to_promote (guarded by next_tier in broken_tiers) ...
            # ... cap N at promotion_threshold when next_tier is stable ...
            
            if items_to_promote and next_tier:
                entering_items_for_tier[next_tier].extend(items_to_promote)
                broken_tiers.add(current_tier)  # Items left this tier
                any_promoted = True
```

This ensures that cascades propagate fully: a break at L1 eventually pulls veterans up from L3 through L2, even though L3 is processed before L2 in each pass.

#### 1f. Update tests — DONE

**Implementation notes:**

Key design decisions made during implementation:
- **Two-set tracking**: `broken_tiers` (tiers with content changes from demotions/entering/leaving) vs `promotable_tiers` (broken_tiers + empty tiers). Empty tiers are safe to promote INTO but don't trigger veteran N++ processing in other tiers.
- **`tiers_processed` set**: Prevents veterans from getting N++ multiple times across multi-pass iterations. Veterans are processed exactly once per cascade cycle.
- **`needs_veteran_processing` condition**: A tier's veterans are processed when (a) the tier itself is in broken_tiers (content changed), OR (b) the tier above is in broken_tiers (veterans could promote). This correctly handles demotion-triggered cascades.
- **Promotion guard uses `promotable_tiers`**: Veterans can promote into broken OR empty tiers. But N++ processing only triggers when the cascade actually touches the tier (via `broken_tiers`).
- **Updated `test_scenario_from_plan`**: Round 3 now expects C gets N++→4 (B's demotion from L3 breaks the tier, triggering veteran processing). This is correct per spec — the cascade reaches L3 because it's broken.

**Existing tests that still pass unchanged:**
- `test_cascade_promotion` → renamed to `test_cascade_promotion_into_empty_tiers` and `test_cascade_promotion_with_broken_tiers`: Tests split to cover both empty-tier and broken-tier cascade paths. ✅
- `test_entry_triggers_n_increment`: Items entering L3 trigger N++ for veterans. ✅
- `test_promotion_at_threshold`: Trigger enters L3, veteran promotes to L2. L2 was empty so the promotion just adds to it. ✅
- All threshold-aware tests: Same cascade logic, just with token gating. ✅

**New tests added (all passing):**
1. `test_no_promotion_into_stable_tier` ✅
2. `test_n_capped_at_promotion_threshold` ✅
3. `test_cascade_stops_at_stable_boundary` ✅
4. `test_demotion_breaks_tier_for_promotion` ✅
5. `test_promotion_into_empty_tier` ✅
6. `test_demotion_triggers_cascade_without_active_graduation` ✅
7. `test_cascade_propagates_downward_through_breaks` ✅
8. `test_cascade_with_threshold_respects_guard` ✅ (threshold-aware + guard interaction)

### Phase 2: Native History Pairs in Cached Tiers (Gaps 2, 8)

**Files**: `ac/llm/streaming.py`, `ac/llm/context_builder.py`

The spec requires all history messages to be native user/assistant pairs, never formatted markdown strings. The `cache_control` marker goes on the **last message** in each tier's sequence (whether that's history or the symbols/files "Ok." response).

#### 2a. Replace `_format_history_for_cache` with native pair builder

Delete `_format_history_for_cache`. Add:

```python
def _build_history_messages_for_tier(self, message_indices, is_last_in_tier=False):
    """Build native user/assistant message pairs for a cached tier.
    
    Args:
        message_indices: Indices into self.conversation_history
        is_last_in_tier: If True, put cache_control on the last message
        
    Returns:
        List of message dicts (native user/assistant pairs)
    """
```

Each history message is emitted as-is (`{"role": "user", "content": "..."}` or `{"role": "assistant", "content": "..."}`). If `is_last_in_tier` is True, the last message's content is wrapped in the `cache_control` format:
```python
{"role": "assistant", "content": [
    {"type": "text", "text": content, "cache_control": {"type": "ephemeral"}}
]}
```

#### 2b. Update L0 block construction

Current L0: single system message with cache_control containing everything (system + legend + L0 symbols + L0 files + L0 history as markdown).

New L0 assembly:
- **No L0 history**: System message with cache_control (unchanged)
- **With L0 history**: System message WITHOUT cache_control → L0 history native pairs → cache_control on last L0 history message

```
Case 1 (no L0 history):
  system message [cache_control] ← contains system + legend + L0 symbols + L0 files

Case 2 (with L0 history):  
  system message                  ← contains system + legend + L0 symbols + L0 files (NO cache_control)
  user: "Hi, I have a bug."
  assistant: "What is the error?"
  user: "It is a 404 error."
  assistant: [cache_control] "I see. Let's check the routing."
```

This uses 1 cache breakpoint for L0 in both cases.

#### 2c. Update `_build_tier_cache_block` to return history separately

Change the return value to include history messages as a separate list:

```python
def _build_tier_cache_block(self, tier, ..., history_tiers=None):
    """Build a cache block for a single tier.
    
    Returns:
        Dict with:
        - 'messages': symbols/files messages (user+assistant pair)
        - 'history_messages': native history pairs (may be empty)
        - 'symbol_tokens': token count for symbols
        Or None if tier is empty.
    """
```

The caller assembles: `messages` + `history_messages`, then places `cache_control` on the **last message** in the combined sequence.

#### 2d. Update `_build_streaming_messages` assembly

For each tier (L1, L2, L3):
1. Get `result` from `_build_tier_cache_block`
2. Get `history_msgs` from `_build_history_messages_for_tier`
3. If both exist: emit symbols/files pair → history pairs → cache_control on last history msg
4. If only symbols/files: emit pair with cache_control on "Ok." (current behavior)
5. If only history: emit history pairs with cache_control on last msg
6. Empty tier: skip

#### 2e. Token counting for history in tiers

The `tier_info` dict needs to count history tokens correctly. Each native message pair's tokens should be counted individually (not as formatted markdown). Update `_build_tier_cache_block` to report history token counts separately.

#### 2f. Cache breakpoint budget

Verify: max 4 cache breakpoints. Each non-empty tier uses exactly 1 breakpoint (on its last message). Empty tiers use 0. With L0 always present, that's 1-4 breakpoints total. This is unchanged from the current implementation — the only difference is WHERE the breakpoint sits (last message instead of always on "Ok.").

#### 2g. Update tests

Add to `tests/test_history_graduation.py` or a new test file:
1. Test that cached tier history uses native pairs (not markdown)
2. Test cache_control placement on last message in tier
3. Test L0 with and without history
4. Test that cache breakpoint count ≤ 4

### Phase 3: Reference Graph Clustering (Gaps 1, 7) — ✅ DONE

**Files**: `ac/symbol_index/references.py`, `ac/context/stability_tracker.py`, `ac/llm/context_builder.py`, `tests/test_stability_tracker.py`

The spec requires initialization from the bidirectional reference graph: mutual edges → connected components → greedy bin-packing. This replaces the simple percentile/fill approach.

#### 3a. Add bidirectional edge extraction to `ReferenceIndex`

```python
def get_bidirectional_edges(self) -> set[tuple[str, str]]:
    """Get pairs of files with mutual references (A→B and B→A).
    
    Returns:
        Set of (file_a, file_b) tuples where file_a < file_b (canonical order)
    """
    edges = set()
    for file_a, deps in self._file_deps.items():
        for file_b in deps:
            if file_a in self._file_deps.get(file_b, set()):
                # Mutual reference — canonical order for dedup
                edge = tuple(sorted([file_a, file_b]))
                edges.add(edge)
    return edges
```

This is a simple O(E) scan over all dependency edges. The canonical ordering (`sorted`) prevents duplicate edges.

#### 3b. Add connected components utility

Add as a module-level function in `references.py` (or `stability_tracker.py`):

```python
def find_connected_components(
    edges: set[tuple[str, str]],
    all_nodes: set[str] = None,
) -> list[set[str]]:
    """Find connected components using union-find.
    
    Args:
        edges: Set of (node_a, node_b) undirected edges
        all_nodes: Complete node set (to include isolated nodes).
                   If None, only nodes appearing in edges are included.
    
    Returns:
        List of sets, each a connected component. Isolated nodes
        are singleton sets.
    """
```

Union-find is simple and efficient. Include isolated nodes (files with no bidirectional edges) as singleton components so they participate in bin-packing.

#### 3c. Add `initialize_from_clusters` to `StabilityTracker`

```python
def initialize_from_clusters(
    self,
    clusters: list[set[str]],
    get_tokens: Callable[[str], int],
    target_tokens: int = 0,
    exclude_active: set[str] = None,
) -> dict[str, str]:
    """Initialize tiers by distributing clusters across L1/L2/L3.
    
    Uses greedy bin-packing: sort clusters by total tokens descending,
    assign each to the tier (L1, L2, L3) with the fewest tokens.
    Each cluster stays together in one tier.
    
    L0 is never assigned — must be earned through ripple promotion.
    
    If total content is insufficient to fill all three tiers above
    target_tokens, fill fewer tiers (L1 first, then L2, then L3).
    """
```

Algorithm:
1. Filter out active files from clusters
2. Remove empty clusters
3. Compute total tokens per cluster
4. Sort clusters by total tokens descending
5. Greedy assign: for each cluster, add to tier with min total tokens
6. After assignment, if any tier is below `target_tokens`, merge it into the next tier (prefer fewer, fuller tiers over many thin ones)
7. Assign N values: L1 → N=9, L2 → N=6, L3 → N=3

#### 3d. Update `_initialize_stability_from_refs` in `context_builder.py`

Change to use the reference index directly:

```python
def _initialize_stability_from_refs(self, stability, all_files, symbols_by_file,
                                     file_refs, active_context_files, file_paths,
                                     ref_index=None):
    """Initialize stability tracker from reference graph clustering."""
    if ref_index is not None:
        # New path: clustering from bidirectional reference graph
        edges = ref_index.get_bidirectional_edges()
        all_symbol_files = set(f"symbol:{f}" for f in symbols_by_file.keys())
        components = find_connected_components(edges, all_nodes=all_symbol_files)
        
        # Get token counts per item
        def get_tokens(item):
            # ... estimate tokens for symbol block
        
        tier_assignments = stability.initialize_from_clusters(
            clusters=components,
            get_tokens=get_tokens,
            target_tokens=stability.get_cache_target_tokens(),
            exclude_active=active_context_files,
        )
    else:
        # Fallback: old percentile-based initialization
        tier_assignments = stability.initialize_from_refs(...)
```

Pass `ref_index` from the call site in `_get_symbol_map_data`. The call chain is:

```
_get_symbol_map_data (context_builder.py)
  → si.build_references(all_files)     # builds ReferenceIndex
  → _initialize_stability_from_refs(... ref_index=si._reference_index)
```

The `ReferenceIndex` is accessible via `si._reference_index` after `build_references()` has been called (which happens earlier in `_get_symbol_map_data`). The current `_get_symbol_map_data` already accesses `si._reference_index` for `file_refs` and `file_imports`, so this is consistent with existing patterns.

#### 3e. Keep `initialize_from_refs` as fallback

Don't remove the existing percentile/threshold-based method. It serves as a fallback when reference data isn't available (e.g., first indexing hasn't completed).

#### 3f. Tests — DONE

**Implementation notes:**

- `get_bidirectional_edges()` added to `ReferenceIndex` — O(E) scan of `_file_deps`, canonical edge ordering via `sorted()`
- `find_connected_components()` added as module-level function in `stability_tracker.py` — union-find with path compression
- `initialize_from_clusters()` added to `StabilityTracker` — greedy bin-packing across L1/L2/L3, underfilled tier consolidation
- `_initialize_stability_from_refs()` in `context_builder.py` updated to try graph clustering first (when `ref_index` available), with percentile-based fallback
- Token estimation for symbol entries now uses `format_file_symbol_block()` for accuracy
- `ref_index` variable explicitly initialized to `None` before conditional assignment in `_get_symbol_map_data`

**TestStabilityTrackerClusterInit (all ✅):**
1. `test_clusters_stay_together` — cluster members land in same tier
2. `test_balanced_distribution` — three equal clusters → one per tier
3. `test_greedy_assigns_largest_first` — largest cluster assigned first
4. `test_isolated_files_distributed` — singletons round-robin across tiers
5. `test_l0_never_assigned` — L0 never in assignments
6. `test_exclude_active_files` — excluded items absent from assignments
7. `test_exclude_removes_from_cluster` — partial cluster exclusion works
8. `test_n_values_set_correctly` — L1=9, L2=6, L3=3
9. `test_skips_if_data_exists` — no-op when tracker has data
10. `test_empty_clusters` — empty input → empty output
11. `test_consolidate_underfilled_tiers` — underfilled tiers merge into fuller ones
12. `test_single_cluster_all_content` — single cluster → L1

**TestConnectedComponents (all ✅):**
1. `test_basic_two_components` — two separate pairs
2. `test_single_component` — chain merges into one
3. `test_isolated_nodes` — singletons from all_nodes
4. `test_empty_edges` — empty and singleton-only cases
5. `test_triangle` — triangle = one component
6. `test_chain_merges` — bridging edge merges two pairs
7. `test_many_isolated_with_one_pair` — 10 singletons + 1 pair

### Phase 4: Session-Scoped Persistence (Gap 6)

**Files**: `ac/context/stability_tracker.py`, `ac/context/manager.py`

The spec says: "There is no persistence — stability data is rebuilt fresh each session." Within a session, the tracker maintains in-memory state. The reference graph initialization (Phase 3) runs on the first request.

#### 4a. Clear stability data on `ContextManager` init

In `ContextManager.__init__`, after creating the `StabilityTracker`, call `clear()`:

```python
self.cache_stability = StabilityTracker(
    persistence_path=stability_path,
    thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
    cache_target_tokens=cache_target_tokens,
)
# Fresh start each session — tiers rebuild from reference graph
self.cache_stability.clear()
```

This ensures:
- Each session starts fresh (no stale L0 assignments from last session)
- The reference graph initialization (Phase 3) runs on first request
- Within-session `save()` calls still write state for crash resilience
- If the app crashes and restarts, it starts fresh again (conservative but predictable)

#### 4b. Simplify `StabilityTracker.__init__`

Since we clear on startup, the `load()` call in `__init__` becomes unnecessary. However, keeping it is harmless (the `clear()` in `ContextManager` runs immediately after). Leave `load()` in `__init__` for potential future use cases where callers want to restore state explicitly.

#### 4c. Alternative considered and rejected

Adding a `session_id` to persistence was considered. This would allow distinguishing "same session restart after crash" from "new session." However:
- The spec explicitly says "no persistence across sessions"
- Crash recovery is a minor benefit — the reference graph re-initialization takes <100ms
- The session_id approach adds complexity for marginal benefit
- The spec's rationale is sound: cross-session persistence causes stale tier assignments

#### 4d. Tests

1. `test_fresh_start_on_init`: Create a tracker, populate it, save. Create ContextManager (which creates a new tracker for the same path and clears it). Verify tracker is empty.
2. `test_first_request_initializes_from_refs`: After fresh start, first request should trigger `initialize_from_clusters` (or `initialize_from_refs` fallback).

### Phase 5: Item Removal from Cached Tiers (Gap 9)

**Files**: `ac/llm/streaming.py`, `ac/context/stability_tracker.py`

The spec says when a file is deleted or unchecked, its entries must be removed from their cached tiers, marking those tiers as broken. Currently `_update_cache_stability` only examines items in the active set — items that disappeared from the project entirely are never detected.

#### 5a. Detect stale items in `_update_cache_stability`

After building the current set of all trackable files (already available from `_get_all_trackable_files()`), compare against tracked items in the stability tracker. Items that are tracked but no longer exist in the repo should be removed:

```python
# Detect deleted files — items tracked but no longer in the repo
all_repo_files = set(self._get_all_trackable_files())
stale_items = []
for item in list(stability._stability.keys()):
    # Extract file path from item key
    if item.startswith("symbol:"):
        file_path = item[7:]
    elif item.startswith("history:"):
        continue  # History cleanup handled by compaction
    else:
        file_path = item
    
    if file_path not in all_repo_files:
        old_tier = stability.get_tier(item)
        if old_tier != 'active':
            broken_tiers.add(old_tier)  # Tier content changed
        stale_items.append(item)

for item in stale_items:
    del stability._stability[item]
```

This runs early in `_update_cache_stability`, before the cascade, so removed items' tiers are already in `broken_tiers` when the cascade executes.

#### 5b. Pass `broken_tiers` from removals into the cascade

The `broken_tiers` set from 5a feeds into Phase 1's `_process_tier_entries` call. Tiers that lost content from file deletion are treated identically to tiers that lost content from demotion — veterans below can promote into them.

#### 5c. Performance consideration

`_get_all_trackable_files()` is already called in `_get_symbol_map_data` which runs every request. The stale check is a set difference operation — O(N) where N is tracked items. This is negligible.

#### 5d. Tests — DONE

**Implementation notes:**

- Phase 0 (stale detection) runs before the existing graduation/cascade logic in `_update_cache_stability`
- Stale items are removed directly from `stability._stability` and `stability._last_active_items`
- Broken tiers from stale removal are passed via the new `broken_tiers` parameter on `update_after_response`
- History items (`history:*`) are excluded from stale detection — their lifecycle is managed by compaction
- Error handling wraps the entire stale detection block to prevent failures from blocking the rest of stability tracking
- Added `broken_tiers` parameter to `update_after_response` for external tier invalidation

**StabilityTracker tests (`test_stability_tracker.py`):**
1. `test_broken_tiers_from_stale_removal` ✅ — pre-broken tier triggers cascade
2. `test_broken_tiers_cascade_from_stale` ✅ — multi-pass cascade from pre-broken L1
3. `test_broken_tiers_combined_with_demotion` ✅ — stale + demotion broken sets merge
4. `test_broken_tiers_no_effect_when_no_eligible_veterans` ✅ — broken tier alone insufficient
5. `test_empty_broken_tiers_no_effect` ✅ — baseline sanity check

**Integration tests (`test_history_graduation.py`):**
1. `test_deleted_file_removed_from_tier` ✅ — file + symbol entry cleanup
2. `test_deletion_triggers_cascade` ✅ — end-to-end stale→cascade flow
3. `test_stale_active_items_cleaned` ✅ — _last_active_items cleanup

## Phases Summary and Implementation Order

Phases are ordered to minimize risk: stability_tracker.py changes first (pure logic, no message pipeline), then streaming.py changes last (most invasive).

| Order | Phase | Gaps | Risk | Effort | Description |
|-------|-------|------|------|--------|-------------|
| 1st | 1 | 4, 5 | Low | Small | ✅ DONE — Broken tier guard + N cap in stability_tracker.py |
| 2nd | 5 | 9 | Low | Small | ✅ DONE — Item removal from cached tiers |
| 3rd | 3 | 1, 7 | Medium | Medium | ✅ DONE — Reference graph clustering for initialization |
| 4th | 4 | 6 | Low | Small | Session-scoped persistence (depends on Phase 3) |
| 5th | 2 | 2, 8 | Medium | Medium | Native history pairs in cached tiers |

**Why this order:**

- **Phase 1 first**: Pure stability_tracker.py change, no risk to message pipeline. All other phases benefit from the broken tier guard being in place.
- **Phase 5 second**: Small addition to `_update_cache_stability` that feeds into Phase 1's broken_tiers set. Stale item removal marks tiers as broken, which the guard (Phase 1) then respects.
- **Phase 3 third**: References.py + stability_tracker.py only. No message pipeline changes. Provides proper re-initialization infrastructure needed by Phase 4.
- **Phase 4 fourth**: Clearing persistence on startup is only safe once Phase 3's clustering provides proper re-initialization. Without Phase 3, clearing on startup leaves an empty tracker with only the old percentile-based init — worse than loading persisted data.
- **Phase 2 last**: Most invasive change — restructures the entire message assembly pipeline in streaming.py. Interacts with cache_control placement, token counting, HUD display, and context breakdown API. Benefits from all other phases being stable and tested first.

## Testing Strategy

- **Phase 1**: Unit tests in `test_stability_tracker.py` — deterministic, no mocking needed
- **Phase 5**: Unit tests for stale item detection and cascade triggering
- **Phase 3**: Unit tests for graph algorithms, integration test with real symbol index
- **Phase 4**: Unit test verifying fresh start on init
- **Phase 2**: Unit tests verifying message structure, integration test with mock LLM

## Files Changed

| File | Phases | Changes |
|------|--------|---------|
| `ac/context/stability_tracker.py` | 1, 3, 4 | Broken tier guard, N cap, cluster init |
| `ac/llm/streaming.py` | 2, 5 | Native history pairs in cached tiers, stale item removal |
| `ac/llm/context_builder.py` | 3 | Cluster-based initialization |
| `ac/symbol_index/references.py` | 3 | Bidirectional edges, connected components |
| `ac/context/manager.py` | 4 | Clear stability on init |
| `tests/test_stability_tracker.py` | 1, 3, 4 | New tests for guard, cap, clustering, fresh start |
| `tests/test_history_graduation.py` | 2 | Tests for native history pair format |
| `tests/test_streaming.py` | 5 | Tests for stale item removal |
| `specs/cache_management.md` | — | No changes needed (spec is the source of truth) |

## Known Out-of-Scope Issues

These are pre-existing issues noted during spec analysis that are NOT addressed in this plan:

1. **Symbol entry handling on file uncheck**: The spec says when a file is unchecked from the picker, its symbol entry returns to active (N=0) to be re-included in the symbol map. The current code handles this indirectly — when a file leaves active context, its symbol entry is no longer excluded from the symbol map. But the symbol entry's stability data isn't explicitly reset. In practice this works because the symbol entry was never in the active items list (only files go in the active set, symbols are tracked via `symbol:` prefix). However, the entry's tier/N values from its cached position are preserved, which is correct — the symbol content didn't change, only the file's full content was removed.

## Spec Inconsistency Noted

The spec's "Threshold-Aware Promotion (Per-Tier Algorithm)" section describes walking the ordered veteran list "from the top (highest N first)" and holding back the first items to meet the token minimum. This would mean **high-N** veterans anchor the tier. However, the spec also states "Low-N veterans 'anchor' tiers by filling the cache threshold" and "low-N veterans anchor tiers, high-N veterans can promote."

The current code sorts veterans by N **ascending** (lowest first), so low-N veterans anchor and high-N veterans get N++ and can promote. This matches the design intent described throughout the rest of the spec. The algorithm's walk direction description appears to be an error in the spec — it should say "from the bottom (lowest N first)." The implementation follows the correct design intent and should NOT be changed. The spec should be updated to match.

## Risks and Mitigations

1. **Phase 1 (broken tier guard)**: The cascade test `test_cascade_promotion` still passes because each tier breaks from items entering it (trigger→L3→L2→L1→L0 cascade). The threshold-aware cascade tests similarly work because each promotion breaks the destination tier. The only behavior change: if a tier above is stable, veterans are blocked from promoting into it with N capped. New tests validate this explicitly. **Risk: Low** — the guard is additive (new constraint on existing logic), not a rewrite.

2. **Phase 5 (item removal)**: Calling `_get_all_trackable_files()` adds a set comparison each request. This is already called elsewhere in the request path, so the cost is a set difference — negligible. **Risk: Low**.

3. **Phase 3 (clustering)**: The union-find algorithm is well-understood. The main risk is that `ReferenceIndex.build_references()` must complete before clustering can run. Currently `_initialize_stability_from_refs` is called after `si.build_references(all_files)` in `_get_symbol_map_data`, so timing is correct. **Risk: Low** — clustering is a pure function of the reference graph.

4. **Phase 4 (session-scoped persistence)**: Clearing on init means a crash-restart loses stability data. With Phase 3's clustering in place, the reference graph re-initialization takes <100ms and produces a reasonable starting point, so the practical impact is minimal. **Risk: Low** — conservative approach, easily reversible if needed. Phase 3 must be implemented first.

5. **Phase 2 (native history pairs)**: Changes the message structure sent to the LLM. The key risk is cache_control placement — if a breakpoint ends up on a user message instead of assistant message, some providers may behave differently. Mitigation: always place cache_control on the last assistant message in a tier. If a tier's last history message is a user message, wrap a synthetic "Ok." assistant response with the cache_control. **Risk: Medium** — needs careful testing with actual LLM providers. Implemented last so all stability logic is settled.

6. **Cross-phase interaction**: Phases 1, 3, and 4 all modify `stability_tracker.py`. Phase 5 modifies `_update_cache_stability` in `streaming.py`. Phase 2 modifies the message assembly in `streaming.py`. **Mitigation**: Implement in order (1→5→3→4→2), run full test suite between phases. Phase 2 is last because it's the most invasive and touches the message pipeline that all other phases feed into.
