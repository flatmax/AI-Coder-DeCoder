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
| L0 | static OR 12+ | System prompt + legend + most stable symbols + files + tree | ✓ |
| L1 | 9+ responses unchanged | Very stable symbols + files | ✓ |
| L2 | 6+ responses unchanged | Stable symbols + files | ✓ |
| L3 | 3+ responses unchanged | Moderately stable symbols + files | ✓ |
| active | <3 responses | Active files + URLs + history + user msg | ✗ |

Note: Bedrock supports exactly 4 cache points, so we have L0-L3 (4 cached tiers) + active (uncached).

**Important:** 
- When a file is in the active context (full content included), its symbol map entry is excluded from all tiers - the full file content replaces it.
- System prompt and legend are always in L0 (static content).
- File tree is stability-tracked like other items - starts in L3, can promote to L0.

### Initial Population (First Prompt)

On first prompt, distribute symbol map entries and context files greedily across L1-L3:
1. Calculate total tokens for all symbol map entries + context files
2. Target ~equal token count per tier (L1, L2, L3)
3. Populate greedily, assigning items to tier with most room
4. Set `stable_count` to tier threshold (L1=9, L2=6, L3=3) so items can promote naturally
5. Active starts empty (items enter active only when modified)

```python
def _initial_greedy_population(self, items_with_tokens):
    """Distribute items across L1-L3 roughly evenly by token count.
    
    Items are assigned stable_count matching their tier threshold,
    so they can promote naturally from there.
    """
    total_tokens = sum(t for _, t in items_with_tokens)
    target_per_tier = total_tokens // 3
    
    tiers = {'L1': [], 'L2': [], 'L3': []}
    tier_tokens = {'L1': 0, 'L2': 0, 'L3': 0}
    tier_thresholds = {'L1': 9, 'L2': 6, 'L3': 3}
    
    for item, tokens in items_with_tokens:
        # Find tier with most room
        target_tier = min(['L1', 'L2', 'L3'], 
                          key=lambda t: tier_tokens[t])
        tiers[target_tier].append(item)
        tier_tokens[target_tier] += tokens
    
    # Return with initial stable counts set to tier thresholds
    return {
        tier: [(item, tier_thresholds[tier]) for item in items]
        for tier, items in tiers.items()
    }
```

### Single StabilityTracker with 4 Tiers

```python
# In ContextManager.__init__
self.cache_stability = StabilityTracker(
    persistence_path=repo_root / '.aicoder' / 'cache_stability.json',
    thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
    initial_tier='L3',  # Fallback for items added after initial population
)
```

### Symbol Map Structure: Legend + Per-File Blocks

The symbol map is split into two parts for caching:

1. **Legend (L0 static)**: Path aliases and syntax guide - small, never changes
2. **Per-file blocks**: Each file's symbols tracked independently

### Section Headers

Each block uses clear section headers to delineate content types:

```
# L0 Block (cached)
[system prompt]

# Repository Structure
# c=class m=method f=function ...
# @1/=ac/symbol_index/extractors/ @2/=webapp/src/context-viewer/ ...

ac/context/token_counter.py: ←5
  c TokenCounter:10 ...

ac/repo/repo.py: ←2
  c Repo:11 ...

# Working Files (L0)
ac/dc.py
```python
import argparse
...
```

# L1 Block (cached)
# Repository Structure (continued)
ac/edit_parser.py: ←3
  c EditParser:54 ...

# Working Files (L1)
ac/llm/chat.py
```python
...
```
```

**Header conventions:**
- `# Repository Structure` - Legend + L0 symbol blocks (first occurrence, always in L0)
- `# Repository Structure (continued)` - Symbol blocks in L1-L3 (omitted if tier has no symbols)
- `# Working Files (L0/L1/L2/L3/active)` - Full file content sections (omitted if tier has no files)
- `# File Tree` - Repository file listing (appears in whichever tier tree currently belongs to)

This allows fine-grained caching - if one file changes, only its symbol block demotes to active.

**Legend Stability:** The legend (path aliases) is computed once at session start and remains fixed. If significant reference patterns change and new aliases would be beneficial, the user can restart the session. This keeps the implementation simple and avoids cache invalidation complexity.

### File Tree Tracking

The file tree is stability-tracked like symbol entries and files:
- Starts in L3 on first prompt
- Promotes through tiers as it remains unchanged
- Demotes to active when files are added/removed/renamed
- Hash computed from tree structure

### Demotion and Re-entry

When a file is modified:
1. Its `stable_count` resets to 0
2. It moves to "active" tier (full file content replaces symbol entry)
3. After 3 unchanged responses → promotes to L3
4. Continues promoting: L3 → L2 (6) → L1 (9) → L0 (12)

### Cache Block Structure

```
Block 1 (L0): [system prompt] + [# Repository Structure + legend + L0 symbols] + [# Working Files (L0) + files] + [# File Tree if L0] (cached)
Block 2 (L1): [# Repository Structure (continued) + L1 symbols] + [# Working Files (L1) + files] + [# File Tree if L1]                (cached)
Block 3 (L2): [# Repository Structure (continued) + L2 symbols] + [# Working Files (L2) + files] + [# File Tree if L2]                (cached)
Block 4 (L3): [# Repository Structure (continued) + L3 symbols] + [# Working Files (L3) + files] + [# File Tree if L3]                (cached)
Block 5:      [# Working Files (active) + files] + [# File Tree if active] + [URLs] + [history] + [user msg]                          (uncached)
```

**Notes:**
- Symbol map entries for files in active context are excluded - the full file content replaces them.
- Empty tiers are skipped (no empty cache blocks sent to LLM).
- Empty tier occurrences are tracked per session for later analysis/UI reporting.
- L0 always includes system prompt + "# Repository Structure" header + legend, even if no L0 symbols yet.
- Active tier never has symbol entries - only full file content.
- File tree is stability-tracked and appears in whichever tier it currently belongs to.

### Terminal HUD

**Promotion/Demotion Notifications:**
```
📈 Promoted to L2: ac/llm/streaming.py, ac/context/manager.py
📉 Demoted to active: ac/edit_parser.py (content changed)
```

**Unified Cache Block Display (appended to existing HUD):**
```
╭─ Cache Blocks ──────────────────────────────────────╮
│ L0 (12+):      8,421 tokens [cached]                │
│   └─ system + legend + 12 symbols + 2 files + tree  │
│ L1 (9+):       6,321 tokens [cached]                │
│   └─ 8 symbols + 2 files                            │
│ L2 (6+):       4,892 tokens [cached]                │
│   └─ 12 symbols + 3 files                           │
│ L3 (3+):       3,456 tokens [cached]                │
│   └─ 6 symbols + 1 file                             │
│ active:        3,127 tokens                         │
│   └─ 1 file + history                               │
├─────────────────────────────────────────────────────┤
│ Total: 26,217 tokens | Cache hit: 88%               │
│ Empty tiers skipped: 0 (session total: 2)           │
╰─────────────────────────────────────────────────────╯
```

### Message Building Flow

```python
def _build_streaming_messages(self, ...):
    # 1. Get all items by tier from unified tracker
    # Exclude symbol entries for files that are in active context
    active_file_paths = set(active_context_files)
    symbol_items_filtered = [s for s in symbol_items if s.path not in active_file_paths]
    
    tiers = self._context_manager.cache_stability.get_items_by_tier(
        symbol_items_filtered + file_items + [file_tree_item]
    )
    
    # 2. Track empty tiers for analysis
    empty_tier_count = 0
    
    # 3. Build blocks by tier
    blocks = []
    
    # Block 1: L0 (static + most stable) - always includes system prompt + legend
    l0_content = system_prompt
    l0_content += "# Repository Structure\n"
    l0_content += legend  # Always include legend in L0
    if tiers['L0']['symbols']:
        l0_content += format_symbol_entries(tiers['L0']['symbols'])
    if tiers['L0']['files']:
        l0_content += "# Working Files (L0)\n"
        l0_content += format_files(tiers['L0']['files'])
    if tiers['L0'].get('tree'):
        l0_content += "# File Tree\n"
        l0_content += file_tree
    blocks.append({"content": l0_content, "cache": True})
    
    # Blocks 2-4: L1-L3 (tracked, cached) - skip if empty
    for level in ['L1', 'L2', 'L3']:
        tier_data = tiers[level]
        if not tier_data['symbols'] and not tier_data['files'] and not tier_data.get('tree'):
            empty_tier_count += 1
            continue  # Skip empty tiers
        
        content = ""
        if tier_data['symbols']:
            content += "# Repository Structure (continued)\n"
            content += format_symbol_entries(tier_data['symbols'])
        if tier_data['files']:
            content += f"# Working Files ({level})\n"
            content += format_files(tier_data['files'])
        if tier_data.get('tree'):
            content += "# File Tree\n"
            content += file_tree
        blocks.append({"content": content, "cache": True})
    
    # Block 5: active (uncached)
    # Note: active tier never has symbol entries - only full file content
    active_content = ""
    if tiers['active']['files']:
        active_content += "# Working Files (active)\n"
        active_content += format_files(tiers['active']['files'])
    if tiers['active'].get('tree'):
        active_content += "# File Tree\n"
        active_content += file_tree
    active_content += urls + history + user_msg
    blocks.append({"content": active_content, "cache": False})
    
    # Track empty tier stats
    self._session_empty_tier_count += empty_tier_count
    
    return blocks
```

## Implementation

### Phase 1: Extend StabilityTracker for 4 Tiers

**Changes to `ac/context/stability_tracker.py`:**
- Add configurable thresholds dict: `{'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}`
- Update `_compute_tier()` to handle 4 tiers (L0 now includes most stable items)
- Add `initial_tier` parameter for greedy initial population
- Add promotion/demotion tracking for notifications

**Changes to `ac/context/manager.py`:**
- Replace separate `file_stability` with unified `cache_stability`
- Add method to get items by tier with type discrimination (symbol vs file)

### Phase 2: Per-File Symbol Map Entries

**Changes to `ac/symbol_index/compact_format.py`:**
- Add `format_legend(aliases) -> str` - returns legend/header block (goes in L0)
- Add `format_file_symbol_block(file_path, symbols, aliases) -> str` - returns single file's symbol entry
- Add `compute_file_block_hash(file_path, symbols) -> str` - hash for stability tracking
- Add `format_symbol_blocks_by_tier(symbols_by_file, tiers, aliases) -> dict[str, str]` - format blocks grouped by tier

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
            "name": "Most Stable",
            "tokens": 8421,
            "cached": True,
            "threshold": 12,
            "contents": [
                {"type": "system", "tokens": 1800},
                {"type": "legend", "tokens": 300},
                {"type": "symbols", "count": 12, "tokens": 4200, "files": [...]},
                {"type": "files", "count": 2, "tokens": 2121, "files": [...]},
                {"type": "tree", "tokens": 500}
            ]
        },
        {
            "tier": "L1",
            "name": "Very Stable",
            "tokens": 6321,
            "cached": True,
            "threshold": 9,
            "contents": [
                {"type": "symbols", "count": 8, "tokens": 4200, "files": [...]},
                {"type": "files", "count": 2, "tokens": 2121, "files": [...]}
            ]
        },
        # ... L2, L3, active (active has no symbol entries)
    ],
    "total_tokens": 26217,
    "cached_tokens": 23090,
    "cache_hit_rate": 0.88,
    "promotions": ["ac/llm/streaming.py"],
    "demotions": ["ac/edit_parser.py"],
    "empty_tiers_this_request": 0,
    "empty_tiers_session_total": 2
}
```

## File Changes Summary

| File | Changes |
|------|---------|
| `ac/context/stability_tracker.py` | 4-tier support, configurable thresholds, promotion/demotion tracking |
| `ac/context/manager.py` | Single `cache_stability` tracker, tier query methods |
| `ac/symbol_index/compact_format.py` | Legend extraction, per-file symbol block functions, hash computation |
| `ac/llm/streaming.py` | Unified message building, greedy init, HUD |
| `ac/llm/llm.py` | Clean `get_context_breakdown()` API |

## Testing Strategy

### New Tests (`tests/test_stability_tracker.py`)

```python
class TestStabilityTracker4Tiers:
    def test_thresholds_configurable(self):
        """Verify custom thresholds are respected."""
        
    def test_initial_tier_assignment(self):
        """New items start at configured initial_tier."""
        
    def test_promotion_l3_to_l2(self):
        """Item promotes from L3 to L2 after 6 unchanged responses."""
        
    def test_promotion_l2_to_l1(self):
        """Item promotes from L2 to L1 after 9 unchanged responses."""
        
    def test_promotion_l1_to_l0(self):
        """Item promotes from L1 to L0 after 12 unchanged responses."""
        
    def test_demotion_on_change(self):
        """Changed item demotes to active."""
        
    def test_promotion_demotion_tracking(self):
        """Tracker reports which items were promoted/demoted."""
        
    def test_active_files_exclude_symbol_entries(self):
        """Symbol map entries excluded for files in active context."""


class TestGreedyInitialPopulation:
    def test_even_distribution_by_tokens(self):
        """Items distributed roughly evenly across L1-L3 by token count."""
        
    def test_symbol_map_entries_first(self):
        """Symbol map entries populated before files."""
        
    def test_active_starts_empty_initially(self):
        """Active tier starts empty on first prompt."""
```

### Modified Tests

**`tests/test_context_manager.py`:**
- Update tests to use new `cache_stability` tracker
- Add tests for unified tier queries

**`tests/test_symbol_index_order.py`:**
- Add tests for legend extraction
- Add tests for per-file symbol block generation  
- Add tests for symbol hash computation
- Add tests for block formatting by tier

## Future: UI Plan

Once this plan is complete, a separate UI plan will:
1. Create unified cache block visualization component
2. Show all tiers with expandable content
3. Display promotion/demotion indicators
4. Show cache hit percentage
5. Replace current fragmented symbol map / files display
