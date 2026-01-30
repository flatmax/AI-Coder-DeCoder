# Plan: Unified Cache System for LLM Context

## Overview

Unify the caching of system prompt, symbol map, and context files under a single stability-based system. All content flows through the same `StabilityTracker` mechanism, enabling consistent terminal output and preparing clean APIs for future UI work.

## Problem Statement

Currently we have two separate caching mechanisms:
1. **Symbol map chunks** - Split by token count, no stability tracking
2. **File cache tiers** - Stability-tracked with L0/L1/active tiers

This creates:
- Inconsistent terminal output (files show tier changes, symbol map doesn't)
- Messy data structures for the context breakdown API
- Poor foundation for building a unified cache UI

## Goals

1. Use `StabilityTracker` for symbol map file entries (not just context files)
2. Consistent 4-block cache structure based on stability
3. Unified terminal HUD showing all cache blocks
4. Clean `get_context_breakdown()` API for future UI

## Design

### Unified Cache Block Structure

```
Block 1 (L0): [system prompt] + [L0 symbol map entries]     (cached)
Block 2 (L1): [L1 symbol map entries] + [L0 files]          (cached)
Block 3 (L2): [active symbol map entries] + [L1 files]      (cached)
Block 4:      [active files] + [file tree] + [URLs] + [history] + [user msg] (uncached)
```

### Stability Tracking

**System Prompt:**
- Always L0 (static within session)
- No tracking needed - just include in Block 1

**Symbol Map Entries:**
- Track each file's symbol map entry individually
- Hash = hash of that file's compact symbol representation
- New files start greedily in L1
- Bubble to L0 after N unchanged responses
- Demote to active when file's symbols change

**Context Files:**
- Already tracked (existing implementation)
- No changes needed

### Two StabilityTracker Instances

```python
# In ContextManager.__init__
self.file_stability = StabilityTracker(
    persistence_path=repo_root / '.aicoder' / 'file_stability.json',
    l1_threshold=3,
    l0_threshold=10,
)

self.symbol_stability = StabilityTracker(
    persistence_path=repo_root / '.aicoder' / 'symbol_stability.json',
    l1_threshold=3,
    l0_threshold=10,
)
```

### Message Building Flow

```python
def _build_streaming_messages(self, ...):
    # 1. Get symbol map entries by tier
    symbol_tiers = self._get_symbol_tiers(file_paths)
    
    # 2. Get file tiers (existing)
    file_tiers = self._context_manager.file_stability.get_items_by_tier(file_paths)
    
    # 3. Build Block 1: System + L0 symbols
    block1 = system_prompt + format_symbol_entries(symbol_tiers['L0'])
    
    # 4. Build Block 2: L1 symbols + L0 files
    block2 = format_symbol_entries(symbol_tiers['L1']) + format_files(file_tiers['L0'])
    
    # 5. Build Block 3: Active symbols + L1 files
    block3 = format_symbol_entries(symbol_tiers['active']) + format_files(file_tiers['L1'])
    
    # 6. Build Block 4: Active files + rest (uncached)
    block4 = format_files(file_tiers['active']) + file_tree + urls + history + user_msg
```

### Terminal HUD

Current output:
```
╭─ Context ───────────────────────────────────────────╮
│ System:     4,521 tokens                            │
│ Symbol Map: 12,847 tokens (5 chunks)                │
│ Files:      8,234 tokens                            │
│   L0: 3 files (stable)                              │
│   L1: 2 files                                       │
│   Active: 1 file                                    │
╰─────────────────────────────────────────────────────╯
```

New unified output:
```
╭─ Cache Blocks ──────────────────────────────────────╮
│ Block 1 (L0):  8,421 tokens [cached]                │
│   └─ System prompt + 12 symbol entries              │
│ Block 2 (L1):  6,234 tokens [cached]                │
│   └─ 8 symbol entries + 3 files                     │
│ Block 3 (L2):  4,891 tokens [cached]                │
│   └─ 5 symbol entries + 2 files                     │
│ Block 4:       3,127 tokens                         │
│   └─ 1 file + tree + history                        │
├─────────────────────────────────────────────────────┤
│ Total: 22,673 tokens | Cache hit: 87%               │
╰─────────────────────────────────────────────────────╯
```

## Implementation

### Phase 1: Symbol Stability Tracking

**Changes to `ac/context/manager.py`:**
- Add `symbol_stability` StabilityTracker instance

**Changes to `ac/symbol_index/compact_format.py`:**
- Add function to get individual file's symbol block
- Add function to compute hash of file's symbols

**Changes to `ac/llm/streaming.py`:**
- After response, update symbol stability for files whose symbols changed

### Phase 2: Unified Message Building

**Changes to `ac/llm/streaming.py`:**
- Refactor `_build_streaming_messages()` to use tier-based block allocation
- Combine symbol entries and files based on tiers
- Respect 4-block limit for Bedrock caching

### Phase 3: Unified Terminal HUD

**Changes to `ac/llm/streaming.py`:**
- Refactor `_print_streaming_hud()` to show unified block view
- Show content breakdown within each block
- Display cache hit percentage

### Phase 4: Clean Context Breakdown API

**Changes to `ac/llm/llm.py`:**
- Update `get_context_breakdown()` to return unified block structure:

```python
{
    "blocks": [
        {
            "name": "L0 (Most Stable)",
            "tokens": 8421,
            "cached": True,
            "contents": [
                {"type": "system", "tokens": 2100},
                {"type": "symbols", "count": 12, "tokens": 6321}
            ]
        },
        # ... blocks 2-4
    ],
    "total_tokens": 22673,
    "cache_hit_rate": 0.87
}
```

## File Changes Summary

| File | Changes |
|------|---------|
| `ac/context/manager.py` | Add `symbol_stability` tracker |
| `ac/symbol_index/compact_format.py` | Per-file symbol block functions |
| `ac/llm/streaming.py` | Unified message building, HUD |
| `ac/llm/llm.py` | Clean `get_context_breakdown()` API |

## Testing Strategy

1. Symbol stability tracking (hash changes detected)
2. Block allocation respects tier boundaries
3. Terminal HUD renders correctly
4. Context breakdown API returns expected structure

## Future: UI Plan

Once this plan is complete, a separate UI plan will:
1. Create unified cache block visualization component
2. Show all 4 blocks with expandable content
3. Display tier badges and cache hit indicators
4. Replace current fragmented symbol map / files display
