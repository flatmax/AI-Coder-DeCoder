# Plan: Unified Cache System for LLM Context

## Overview

Unify the caching of system prompt, symbol map, and context files under a single stability-based system. All content flows through the same `StabilityTracker` mechanism with 5 tiers (L0-L4 + active), enabling consistent terminal output and preparing clean APIs for future UI work.

## Problem Statement

Currently we have two separate caching mechanisms:
1. **Symbol map chunks** - Split by token count, no stability tracking
2. **File cache tiers** - Stability-tracked with L0/L1/active tiers

This creates:
- Inconsistent terminal output (files show tier changes, symbol map doesn't)
- Messy data structures for the context breakdown API
- Poor foundation for building a unified cache UI

## Goals

1. Use single `StabilityTracker` for both symbol map entries AND context files
2. 5-tier system: L0 (static), L1-L4 (stability tracked), active (uncached)
3. Unified terminal HUD showing all cache blocks with promotion/demotion notifications
4. Clean `get_context_breakdown()` API for future UI

## Design

### Tier Structure

| Tier | Threshold | Contents | Cached |
|------|-----------|----------|--------|
| L0 | static | System prompt only | ✓ |
| L1 | 12+ responses unchanged | Most stable symbols + files | ✓ |
| L2 | 9+ responses unchanged | Stable symbols + files | ✓ |
| L3 | 6+ responses unchanged | Moderately stable symbols + files | ✓ |
| L4 | 3+ responses unchanged | Recently stable symbols + files | ✓ |
| active | <3 responses | New/changed symbols + files + history + user msg | ✗ |

### Initial Population (First Prompt)

On first prompt, distribute symbol map entries and context files greedily across L1-L3:
1. Calculate total tokens for all symbol map entries + context files
2. Target ~equal token count per tier (L1, L2, L3)
3. Populate starting with symbol map entries first, then files
4. L4 and active start empty (items bubble up from active as they stabilize)

```python
def _initial_greedy_population(self, items_with_tokens):
    """Distribute items across L1-L3 roughly evenly by token count."""
    total_tokens = sum(t for _, t in items_with_tokens)
    target_per_tier = total_tokens // 3
    
    tiers = {'L1': [], 'L2': [], 'L3': []}
    tier_tokens = {'L1': 0, 'L2': 0, 'L3': 0}
    
    for item, tokens in items_with_tokens:
        # Find tier with most room
        target_tier = min(['L1', 'L2', 'L3'], 
                          key=lambda t: tier_tokens[t])
        tiers[target_tier].append(item)
        tier_tokens[target_tier] += tokens
    
    return tiers
```

### Single StabilityTracker with 5 Tiers

```python
# In ContextManager.__init__
self.cache_stability = StabilityTracker(
    persistence_path=repo_root / '.aicoder' / 'cache_stability.json',
    thresholds={'L4': 3, 'L3': 6, 'L2': 9, 'L1': 12},
    initial_tier='L3',  # New items start in L3 (greedy)
)
```

### Cache Block Structure

```
Block 1 (L0): [system prompt]                                    (cached)
Block 2 (L1): [L1 symbol entries] + [L1 files]                   (cached)
Block 3 (L2): [L2 symbol entries] + [L2 files]                   (cached)
Block 4 (L3): [L3 symbol entries] + [L3 files]                   (cached)
Block 5 (L4): [L4 symbol entries] + [L4 files]                   (cached)
Block 6:      [active symbols] + [active files] + [tree] + [URLs] + [history] + [user msg] (uncached)
```

Note: Bedrock supports up to 4 cache points. We may need to combine some blocks:
- Option A: Combine L3+L4 into one cached block
- Option B: Only cache L1-L3, leave L4 uncached with active

### Terminal HUD

**Promotion/Demotion Notifications:**
```
📈 Promoted to L2: ac/llm/streaming.py, ac/context/manager.py
📉 Demoted to active: ac/edit_parser.py (content changed)
```

**Unified Cache Block Display (appended to existing HUD):**
```
╭─ Cache Blocks ──────────────────────────────────────╮
│ L0 (static):   2,100 tokens [cached]                │
│   └─ system prompt                                  │
│ L1 (12+):      6,321 tokens [cached]                │
│   └─ 8 symbols + 2 files                            │
│ L2 (9+):       4,892 tokens [cached]                │
│   └─ 12 symbols + 3 files                           │
│ L3 (6+):       3,456 tokens [cached]                │
│   └─ 6 symbols + 1 file                             │
│ L4 (3+):       2,891 tokens [cached]                │
│   └─ 4 symbols + 0 files                            │
│ active:        3,127 tokens                         │
│   └─ 2 symbols + 1 file + tree + history            │
├─────────────────────────────────────────────────────┤
│ Total: 22,787 tokens | Cache hit: 86%               │
╰─────────────────────────────────────────────────────╯
```

### Message Building Flow

```python
def _build_streaming_messages(self, ...):
    # 1. Get all items by tier from unified tracker
    tiers = self._context_manager.cache_stability.get_items_by_tier(
        symbol_items + file_items
    )
    
    # 2. Build blocks by tier
    blocks = []
    
    # Block 1: L0 (static)
    blocks.append({"content": system_prompt, "cache": True})
    
    # Blocks 2-5: L1-L4 (tracked, cached)
    for level in ['L1', 'L2', 'L3', 'L4']:
        symbol_content = format_symbol_entries(tiers[level]['symbols'])
        file_content = format_files(tiers[level]['files'])
        blocks.append({"content": symbol_content + file_content, "cache": True})
    
    # Block 6: active (uncached)
    active_content = (
        format_symbol_entries(tiers['active']['symbols']) +
        format_files(tiers['active']['files']) +
        file_tree + urls + history + user_msg
    )
    blocks.append({"content": active_content, "cache": False})
    
    return blocks
```

## Implementation

### Phase 1: Extend StabilityTracker for 5 Tiers

**Changes to `ac/context/stability_tracker.py`:**
- Add configurable thresholds dict: `{'L4': 3, 'L3': 6, 'L2': 9, 'L1': 12}`
- Update `_compute_tier()` to handle 5 tiers
- Add `initial_tier` parameter for greedy initial population
- Add promotion/demotion tracking for notifications

**Changes to `ac/context/manager.py`:**
- Replace separate `file_stability` with unified `cache_stability`
- Add method to get items by tier with type discrimination (symbol vs file)

### Phase 2: Per-File Symbol Map Entries

**Changes to `ac/symbol_index/compact_format.py`:**
- Add `get_file_symbol_block(file_path, symbols) -> str` - returns single file's symbol entry
- Add `compute_symbol_hash(file_path, symbols) -> str` - hash for stability tracking
- Add `format_symbol_entries_by_tier(symbols_by_file, tiers) -> dict` - group by tier

### Phase 3: Unified Message Building

**Changes to `ac/llm/streaming.py`:**
- Refactor `_build_streaming_messages()` to use tier-based block allocation
- Implement initial greedy population on first prompt
- Update stability tracker after each response
- Print promotion/demotion notifications

### Phase 4: Unified Terminal HUD

**Changes to `ac/llm/streaming.py`:**
- Add `_print_cache_blocks()` method
- Show tier breakdown with token counts
- Calculate and display cache hit percentage
- Append to existing HUD output

### Phase 5: Clean Context Breakdown API

**Changes to `ac/llm/llm.py`:**
- Update `get_context_breakdown()` to return unified block structure:

```python
{
    "blocks": [
        {
            "tier": "L0",
            "name": "Static",
            "tokens": 2100,
            "cached": True,
            "threshold": None,
            "contents": [
                {"type": "system", "tokens": 2100}
            ]
        },
        {
            "tier": "L1",
            "name": "Most Stable",
            "tokens": 6321,
            "cached": True,
            "threshold": 12,
            "contents": [
                {"type": "symbols", "count": 8, "tokens": 4200, "files": [...]},
                {"type": "files", "count": 2, "tokens": 2121, "files": [...]}
            ]
        },
        # ... L2, L3, L4, active
    ],
    "total_tokens": 22787,
    "cached_tokens": 19660,
    "cache_hit_rate": 0.86,
    "promotions": ["ac/llm/streaming.py"],
    "demotions": ["ac/edit_parser.py"]
}
```

## File Changes Summary

| File | Changes |
|------|---------|
| `ac/context/stability_tracker.py` | 5-tier support, configurable thresholds, promotion/demotion tracking |
| `ac/context/manager.py` | Single `cache_stability` tracker, tier query methods |
| `ac/symbol_index/compact_format.py` | Per-file symbol block functions, hash computation |
| `ac/llm/streaming.py` | Unified message building, greedy init, HUD |
| `ac/llm/llm.py` | Clean `get_context_breakdown()` API |

## Testing Strategy

### New Tests (`tests/test_stability_tracker.py`)

```python
class TestStabilityTracker5Tiers:
    def test_thresholds_configurable(self):
        """Verify custom thresholds are respected."""
        
    def test_initial_tier_assignment(self):
        """New items start at configured initial_tier."""
        
    def test_promotion_l4_to_l3(self):
        """Item promotes from L4 to L3 after 6 unchanged responses."""
        
    def test_promotion_l3_to_l2(self):
        """Item promotes from L3 to L2 after 9 unchanged responses."""
        
    def test_promotion_l2_to_l1(self):
        """Item promotes from L1 to L1 after 12 unchanged responses."""
        
    def test_demotion_on_change(self):
        """Changed item demotes to active."""
        
    def test_promotion_demotion_tracking(self):
        """Tracker reports which items were promoted/demoted."""


class TestGreedyInitialPopulation:
    def test_even_distribution_by_tokens(self):
        """Items distributed roughly evenly across L1-L3 by token count."""
        
    def test_symbol_map_entries_first(self):
        """Symbol map entries populated before files."""
        
    def test_empty_l4_and_active_initially(self):
        """L4 and active tiers start empty."""
```

### Modified Tests

**`tests/test_context_manager.py`:**
- Update tests to use new `cache_stability` tracker
- Add tests for unified tier queries

**`tests/test_symbol_index_order.py`:**
- Add tests for per-file symbol block generation
- Add tests for symbol hash computation

## Future: UI Plan

Once this plan is complete, a separate UI plan will:
1. Create unified cache block visualization component
2. Show all tiers with expandable content
3. Display promotion/demotion indicators
4. Show cache hit percentage
5. Replace current fragmented symbol map / files display
