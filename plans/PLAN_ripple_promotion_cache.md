# Plan: Ripple Promotion Cache Policy

## Overview

Replace the current stability tracking system with a "ripple promotion" policy where:
1. Files in Active context are not cached (N=0)
2. When a file becomes inactive, it moves to L3 with N=3 (entry threshold)
3. When an item **enters** a cache tier, all existing items in that tier get N++
4. When N reaches a tier's promotion threshold, the item promotes to the next tier
5. Promotions cascade: entering L2 triggers N++ in L2, which may cause more promotions to L1, etc.

## Current System

The current `StabilityTracker` in `ac/context/stability_tracker.py`:
- Tracks "stable_count" for each item
- Promotes based on consecutive rounds without changes
- Uses fixed thresholds (L2=5, L1=10, L0=20)
- All items age together each response

## Proposed System

### Core Concept

```
Active (N=0) → L3 (N=3) → L2 (N=6) → L1 (N=9) → L0 (N=12)
               ↑          ↑          ↑          ↑
               N++ for    N++ for    N++ for    N++ for
               existing   existing   existing   existing
               items      items      items      items
               when new   when new   when new   when new
               item       item       item       item
               enters     enters     enters     enters
```

### Key Behaviors

1. **File becomes inactive**: Moves from Active to L3 with N=3
2. **Item enters a cache tier**: All OTHER items already in that tier get N++
3. **Promotion**: When any item's N >= tier's promotion threshold, it promotes to the next tier
4. **Promotion cascades**: The promoted item entering the next tier triggers N++ there too
5. **File modified while cached**: Returns to Active with N=0
6. **File re-added to Active**: Returns to Active with N=0

### What Triggers N++ in a Tier?

**Only one thing**: An item entering that tier (either from Active→L3, or from promotion L3→L2, etc.)

When an item enters tier X:
1. All OTHER items currently in tier X get N++
2. Any item in tier X that now has N >= promotion_threshold promotes to tier X-1
3. Each promotion triggers step 1 in the destination tier (cascade)

The entering item keeps its entry N value (e.g., N=3 for L3, N=6 for L2).

### Example Scenario

```
Round 1: User adds files A, B, C to context
         Active: {A, B, C}
         (No cache activity)

Round 2: User only references A (B, C become inactive)
         B enters L3 with N=3, no existing items → no N++
         C enters L3 with N=3, B is there → B gets N++
         Active: {A}
         L3: {B(N=4), C(N=3)}

Round 3: User references A, model edits B
         B modified → returns to Active with N=0
         (B leaving L3 does NOT trigger N++ - only entries trigger)
         Active: {A, B}
         L3: {C(N=3)}

Round 4: User only references A (B becomes inactive again)
         B enters L3 with N=3, C is there → C gets N++
         Active: {A}
         L3: {B(N=3), C(N=4)}

Round 5: User references A, adds D (B inactive again)
         B enters L3: C gets N++ → C(N=5)
         D is new to Active, stays in Active
         Active: {A, D}
         L3: {B(N=3), C(N=5)}

Round 6: User only references A (D becomes inactive)
         D enters L3: B gets N++ → B(N=4), C gets N++ → C(N=6)
         C(N=6) >= 6 → C promotes to L2
         C enters L2: no existing items → no N++
         Active: {A}
         L3: {B(N=4), D(N=3)}
         L2: {C(N=6)}

Round 7: User only references A (nothing changes in Active)
         No items enter any cache tier → no N++ anywhere
         Active: {A}
         L3: {B(N=4), D(N=3)}
         L2: {C(N=6)}
```

### Cascade Example

```
Starting state:
  L3: {X(N=5), Y(N=5)}
  L2: {M(N=8), P(N=8)}
  L1: {Q(N=11)}

File F becomes inactive, enters L3:
  1. F enters L3 with N=3
  2. X gets N++ → X(N=6), Y gets N++ → Y(N=6)
  3. X(N=6) >= 6 → X promotes to L2
  4. Y(N=6) >= 6 → Y promotes to L2
  5. X enters L2: M gets N++ → M(N=9), P gets N++ → P(N=9)
  6. Y enters L2: M gets N++ → M(N=10), P gets N++ → P(N=10)
     (Note: X and Y don't increment each other, they entered together)
  7. M(N=10) >= 9 → M promotes to L1
  8. P(N=10) >= 9 → P promotes to L1
  9. M enters L1: Q gets N++ → Q(N=12)
  10. P enters L1: Q gets N++ → Q(N=13)
  11. Q(N=13) >= 12 → Q promotes to L0
  12. Q enters L0: no existing items → done

Final state:
  L3: {F(N=3)}
  L2: {X(N=6), Y(N=6)}
  L1: {M(N=10), P(N=10)}
  L0: {Q(N=13)}
```

### Configuration

```python
TIER_CONFIG = {
    'L3': {'entry_n': 3, 'promotion_threshold': 6},
    'L2': {'entry_n': 6, 'promotion_threshold': 9},
    'L1': {'entry_n': 9, 'promotion_threshold': 12},
    'L0': {'entry_n': 12, 'promotion_threshold': None},  # Terminal tier
}
```

### Initialization State

**Fresh start (no persistence file):**

On first run, we use reference counts to distribute files across cache tiers:

1. Collect all trackable files and their `←refs` counts from the symbol index
2. Sort files by ref count (descending)
3. Split evenly into three groups:
   - Top third → L1 (N=9) - most referenced files
   - Middle third → L2 (N=6) - moderately referenced  
   - Bottom third → L3 (N=3) - least referenced / leaf files
4. L0 is empty initially - files must earn their way there through stability

```python
def compute_initial_tiers(files_with_refs: list[tuple[str, int]]) -> dict[str, tuple[str, int]]:
    """
    Returns {file_path: (tier, n_value)} for initial placement.
    
    files_with_refs: [(file_path, ref_count), ...] sorted by ref_count desc
    """
    total = len(files_with_refs)
    third = total // 3
    
    result = {}
    for i, (file_path, ref_count) in enumerate(files_with_refs):
        if i < third:
            result[file_path] = ('L1', 9)
        elif i < 2 * third:
            result[file_path] = ('L2', 6)
        else:
            result[file_path] = ('L3', 3)
    
    return result
```

**Note**: Files currently in Active context are not placed in cache tiers - they stay Active with N=0.

**Loading from persistence:**
- Each item's tier and N value are restored from the saved state
- Items not in the saved state use the heuristic above if refs data is available, otherwise default to L3 (N=3)

**Edge case - item in persistence but file deleted:**
- Remove from tracking on next update

**Edge case - item in persistence with tier but not in current context:**
- Keep in tracking (it's cached), will be used if file is referenced again

## Implementation

### Phase 1: Update StabilityTracker Model

**File: `ac/context/stability_tracker.py`**

1. Replace `StabilityInfo.stable_count` with `StabilityInfo.n_value`
2. Add `StabilityInfo.tier` to track current tier explicitly
3. Update `__init__` with new tier configuration
4. Remove `_compute_tier()` - tier is now explicit, stored in StabilityInfo

### Phase 2: Implement Ripple Logic

**File: `ac/context/stability_tracker.py`**

1. New method `_process_entry(item, tier)`:
   - Increment N for all OTHER items currently in that tier
   - Collect items that should promote (N >= threshold)
   - Return list of items to promote

2. New method `_process_promotions(items_to_promote, from_tier)`:
   - Move each item to next tier with appropriate N
   - Call `_process_entry` for each, collecting more promotions
   - Recursively process until no more promotions

3. Update `update_after_response()`:
   - Identify items moving from Active → L3 (became inactive)
   - Identify items being demoted (modified while cached) → return to Active
   - For each item entering L3, call `_process_entry` and handle cascades
   - Record promotions/demotions for reporting

### Phase 3: Update Callers

**Files affected:**
- `ac/llm/streaming.py` - Uses `get_items_by_tier()`
- `ac/llm/llm.py` - Uses `get_items_by_tier()`, `get_tier()`
- `ac/context/manager.py` - Creates StabilityTracker

These should work with minimal changes since the interface (`get_items_by_tier`, `get_tier`) remains the same.

### Phase 4: Update Tests

**File: `tests/test_stability_tracker.py`**

Rewrite tests to validate:
1. Initial entry to L3 with correct N=3
2. N++ propagation to existing items when new item enters
3. Promotion thresholds trigger correctly
4. Demotion resets to Active with N=0
5. Cascading promotions work correctly
6. Persistence save/load preserves tier and N values
7. Multiple items entering same tier in one round

## API Changes

### StabilityInfo (dataclass)

```python
@dataclass
class StabilityInfo:
    tier: str           # 'active', 'L3', 'L2', 'L1', 'L0'
    n_value: int        # Current N value
    content_hash: str   # For detecting modifications
```

### StabilityTracker Methods

```python
class StabilityTracker:
    def update_after_response(
        self, 
        items: list[str],           # Items in current Active context
        get_content: Callable,      # Get content for hashing
        modified: set[str] | None   # Files modified this round
    ) -> dict[str, str]:            # Returns tier changes {item: new_tier}
    
    def get_tier(self, item: str) -> str
    def get_n_value(self, item: str) -> int  # Renamed from get_stable_count
    def get_items_by_tier(self, items: list[str]) -> dict[str, list[str]]
```

## Edge Cases

1. **Multiple items enter L3 same round**: Process them sequentially - first one doesn't trigger N++ (no existing), second triggers N++ for first, etc.
2. **Bulk cascade**: Many promotions at once - process all promotions from one tier before moving to next tier
3. **Empty tier**: If tier is empty, new item enters with entry_n, no N++ occurs
4. **Item re-enters Active**: If a cached item is explicitly added back to Active context, reset to N=0
5. **Rapid churn**: File bounces Active↔L3 repeatedly - each entry to L3 triggers N++ for stable items there

## Testing Strategy

1. **Unit tests**: Individual tier transitions, N increments
2. **Scenario tests**: Multi-round scenarios like the examples above
3. **Cascade tests**: Verify cascade behavior with pre-populated tiers
4. **Persistence tests**: Save/load round-trip preserves state
5. **Property tests**: Invariants like "N never decreases except on demotion to Active"

## Rollout

1. ✅ Implement with comprehensive tests (DONE - 29 tests passing)
2. Add logging to track tier movements during real usage
3. Monitor cache hit rates in production
4. Tune thresholds if needed (entry_n and promotion_threshold values)

## Implementation Status

### Completed
- ✅ Phase 1: Updated StabilityInfo model with `n_value` and explicit `tier`
- ✅ Phase 2: Implemented ripple promotion logic in `_process_tier_entries()`
- ✅ Phase 3: Public API unchanged, callers (streaming.py, llm.py) compatible
- ✅ Phase 4: All tests updated and passing

### Remaining (Optional Enhancements)
- [ ] Initialize tiers from `←refs` counts on first run (currently items start active→L3)
- [ ] Add detailed logging for tier movements in production
- [ ] Monitor and tune thresholds based on cache hit rates

## Success Metrics

- Cache hit rate maintained or improved
- More predictable promotion behavior (activity-driven, not time-driven)
- Frequently-used-together files promote together (they enter L3 together, age together)
- Less "stale" items in high tiers (items only promote when there's actual activity)

## Implementation

### Phase 1: Update StabilityTracker Model

**File: `ac/context/stability_tracker.py`**

1. Replace `StabilityInfo.stable_count` with `StabilityInfo.n_value`
2. Add `StabilityInfo.tier` to track current tier explicitly
3. Update `__init__` with new tier configuration
4. Remove `_compute_tier()` - tier is now explicit

### Phase 2: Implement Ripple Logic

**File: `ac/context/stability_tracker.py`**

1. New method `_record_tier_activity(tier)`:
   - Increment N for all items in that tier
   - Check for promotions, recursively record activity in destination tier

2. Update `update_after_response()`:
   - Identify items moving from Active → L3
   - Identify items being demoted (modified while cached)
   - Record activity in affected tiers
   - Process promotions

### Phase 3: Update Callers

**Files affected:**
- `ac/llm/streaming.py` - Uses `get_items_by_tier()`
- `ac/llm/llm.py` - Uses `get_items_by_tier()`, `get_tier()`
- `ac/context/manager.py` - Creates StabilityTracker

These should work with minimal changes since the interface (`get_items_by_tier`, `get_tier`) remains the same.

### Phase 4: Update Tests

**File: `tests/test_stability_tracker.py`**

Rewrite tests to validate:
1. Initial entry to L3 with correct N
2. N++ propagation within tiers
3. Promotion thresholds
4. Demotion resets to Active
5. Cascading promotions (activity in L3 → promotion to L2 → activity in L2 → ...)

## API Changes

### StabilityInfo (dataclass)

```python
@dataclass
class StabilityInfo:
    tier: str           # 'active', 'L3', 'L2', 'L1', 'L0'
    n_value: int        # Current N value
    content_hash: str   # For detecting modifications
```

### StabilityTracker Methods

```python
class StabilityTracker:
    def update_after_response(
        self, 
        items: list[str],           # Items in current context
        get_content: Callable,      # Get content for hashing
        modified: set[str] | None   # Files modified this round
    ) -> dict[str, str]:            # Returns tier changes
    
    def get_tier(self, item: str) -> str
    def get_n_value(self, item: str) -> int  # Renamed from get_stable_count
    def get_items_by_tier(self, items: list[str]) -> dict[str, list[str]]
```

## Edge Cases

1. **Bulk file addition**: Many files enter L3 at once, all get N=3, tier doesn't age itself
2. **Rapid churn**: File bounces Active↔L3, causes L3 to age quickly
3. **Empty tier activity**: If a tier becomes empty, no N++ occurs (no items to increment)
4. **Cascade prevention**: Promotion activity should not infinitely cascade (use a "processing" flag)

## Testing Strategy

1. **Unit tests**: Individual tier transitions, N increments
2. **Integration tests**: Full scenarios with multiple rounds
3. **Property tests**: Invariants like "N never decreases except on demotion"

## Rollout

1. Implement behind feature flag initially
2. Add logging to compare old vs new tier assignments
3. Validate cache hit rates don't regress
4. Remove old system once validated

## Success Metrics

- Cache hit rate maintained or improved
- More predictable promotion behavior
- Frequently-used-together files stay in same tier longer
