# Plan: Tiered Stability Caching for LLM Context

## Overview

Implement a generic stability tracking system that automatically promotes stable content to cached context blocks, reducing API costs through better prompt caching utilization. The initial implementation targets file content caching, with the architecture designed for reuse with symbol map caching.

## Problem Statement

Currently, all files in context are sent uncached in every request. Files that are included for reference but rarely edited (e.g., base classes, interfaces, utility modules) could benefit from prompt caching, but we have no mechanism to identify and cache them.

## Goals

1. Create a **generic `StabilityTracker`** reusable for files, symbol maps, and other content
2. Automatically identify stable reference files based on edit patterns
3. Utilize all 4 Bedrock cache blocks efficiently
4. Minimize cache invalidation through smart tiering
5. Reduce token costs for repeated context

## Design

### Generic Stability Tracker

The core abstraction tracks stability of any hashable content:

```python
@dataclass
class StabilityInfo:
    content_hash: str           # SHA256 of content
    stable_count: int           # N - consecutive unchanged responses
    current_tier: str           # 'active', 'L1', 'L0'
    tier_entry_response: int    # response number when entered current tier

class StabilityTracker:
    """Generic stability tracker for any content type."""
    
    def __init__(self,
                 persistence_path: Path,
                 l1_threshold: int = 3,
                 l0_threshold: int = 10,
                 reorg_interval: int = 10,
                 reorg_drift_threshold: float = 0.2,
                 initial_tier: str = 'L1'):  # Greedy start
        ...
```

This can be instantiated for different use cases:
- **File content**: Track which files are stable in context
- **Symbol map files**: Track which files have stable symbols (future)
- **URL content**: Track which URLs have stable content (future)

### Cache Block Structure

```
Block 1: [system prompt + symbol map part 1] (cached)
Block 2: [symbol map part 2]                 (cached)  
Block 3: [files L0 - most stable]            (cached)
Block 4: [files L1 - moderately stable]      (cached)
         [active files]                      (uncached)
         [file tree]                         (uncached)
         [URLs]                              (uncached)
         [history]                           (uncached)
         [user message]                      (uncached)
```

### Tiers

| Tier | Description | Entry Criteria | Exit Criteria |
|------|-------------|----------------|---------------|
| Active | Content being modified | Hash changed | N >= L1 threshold (promote to L1) |
| L1 | Moderately stable | N >= L1 threshold (default: 3) | N >= L0 threshold (promote) or hash changed (demote) |
| L0 | Most stable | N >= L0 threshold (default: 10) | Hash changed (demote to Active) |

Where `N` = consecutive assistant responses where content hash unchanged.

### Greedy Initialization

On first encounter, content starts in **L1** (not Active):

```python
def _initialize_item(self, item: str, content_hash: str) -> StabilityInfo:
    """Greedily start new items in L1 for immediate cache benefits."""
    return StabilityInfo(
        content_hash=content_hash,
        stable_count=self.l1_threshold,  # Start at L1 threshold
        current_tier='L1',
        tier_entry_response=self._response_count
    )
```

**Rationale:**
- Immediate cache benefits from first request
- No cold-start delay waiting for N to accumulate
- Self-correcting: edited files demote naturally
- Optimistic assumption: most context files are reference files

### Tier Reorganization

To avoid constant cache invalidation, reorganization is rate-limited:

1. **Promotion** (Active→L1, L1→L0): Can happen every response
2. **Demotion** (edited file): Immediate, resets N=0, moves to Active
3. **L0/L1 boundary adjustment**: Only when:
   - At least 10 responses since last reorganization
   - More than 20% of files are in "wrong" tier based on current N values

### Statistical Boundary (Future Enhancement)

Once we have usage data, compute optimal L0/L1 boundary:
```python
stability_scores = [info.stable_count for info in tracker.values() if info.stable_count > 0]
l0_threshold = percentile(stability_scores, 75)  # top 25% go to L0
```

For now, use fixed thresholds: L1=3, L0=10.

## Implementation

### Phase 1: Generic Stability Tracker ✅ COMPLETE

**New file: `ac/context/stability_tracker.py`**

```python
import hashlib
import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Callable, Literal

@dataclass
class StabilityInfo:
    content_hash: str
    stable_count: int
    current_tier: Literal['active', 'L1', 'L0']
    tier_entry_response: int

class StabilityTracker:
    """Generic stability tracker for any content type.
    
    Tracks content stability over time and assigns items to tiers
    based on how long they've remained unchanged. Designed for reuse
    across file caching, symbol map ordering, and other use cases.
    """
    
    def __init__(self,
                 persistence_path: Path,
                 l1_threshold: int = 3,
                 l0_threshold: int = 10,
                 reorg_interval: int = 10,
                 reorg_drift_threshold: float = 0.2,
                 initial_tier: str = 'L1'):
        self._persistence_path = persistence_path
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
    
    def update_after_response(self,
                              items: list[str],
                              get_content: Callable[[str], str],
                              modified: list[str] = None) -> dict[str, str]:
        """Update stability tracking after an assistant response.
        
        Args:
            items: All items currently in context
            get_content: Function to get content for an item
            modified: Items known to be modified (optimization)
        
        Returns:
            Dict mapping items to their new tiers
        """
        self._response_count += 1
        modified_set = set(modified or [])
        tier_changes = {}
        
        for item in items:
            content = get_content(item)
            new_hash = self.compute_hash(content)
            
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
        if self.should_reorganize():
            self.reorganize()
        
        self.save()
        return tier_changes
    
    def _initialize_item(self, item: str, content_hash: str) -> StabilityInfo:
        """Greedily initialize new items in L1."""
        initial_count = self._l1_threshold if self._initial_tier == 'L1' else 0
        return StabilityInfo(
            content_hash=content_hash,
            stable_count=initial_count,
            current_tier=self._initial_tier,
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
        """Get items grouped by tier.
        
        Args:
            items: Filter to these items only. If None, return all tracked items.
        
        Returns:
            Dict with keys 'L0', 'L1', 'active' mapping to item lists
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
    
    def should_reorganize(self) -> bool:
        """Check if L0/L1 boundary should be recomputed."""
        if self._response_count - self._last_reorg_response < self._reorg_interval:
            return False
        
        # Count misplaced items
        misplaced = 0
        total_cached = 0
        
        for item, info in self._stability.items():
            if info.current_tier in ('L0', 'L1'):
                total_cached += 1
                expected_tier = self._compute_tier(info.stable_count)
                if expected_tier != info.current_tier:
                    misplaced += 1
        
        if total_cached == 0:
            return False
        
        return (misplaced / total_cached) > self._reorg_drift_threshold
    
    def reorganize(self) -> None:
        """Recompute tiers based on current stability counts."""
        self._last_reorg_response = self._response_count
        
        for item, info in self._stability.items():
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
```

**Changes to `ac/context/__init__.py`:** ✅
- Export `StabilityTracker`, `StabilityInfo`

**Changes to `ac/context/manager.py`:** ✅
- Add `StabilityTracker` instance for file stability
- Expose methods for streaming to query tiers

### Phase 2: Message Building ✅ COMPLETE

**Changes to `ac/llm/streaming.py`:**

Modify `_build_streaming_messages()`:

1. Combine system prompt with first symbol map chunk
2. Split symbol map into 2 parts (not 5)
3. Query `StabilityTracker` for file tiers
4. Build L0 and L1 file bundles with `cache_control`
5. Include active files without caching

```python
# Constants for file cache headers
FILES_L0_HEADER = """# Reference Files (Stable)

These files are included for reference:

"""

FILES_L1_HEADER = """# Reference Files

These files are included for reference:

"""

FILES_ACTIVE_HEADER = """# Working Files

Here are the files:

"""

def _build_streaming_messages(self, ...):
    messages = []
    
    # Get file tiers from stability tracker
    file_tiers = {'L0': [], 'L1': [], 'active': []}
    if file_paths and self._context_manager:
        tracker = self._context_manager.file_stability
        file_tiers = tracker.get_items_by_tier(file_paths)
    
    # Block 1: System + Symbol Map Part 1
    symbol_map_chunks = self.get_context_map_chunked(
        chat_files=file_paths,
        include_references=True,
        num_chunks=2  # Only 2 chunks now
    )
    
    system_and_map1 = system_text
    if symbol_map_chunks:
        system_and_map1 += "\n\n" + REPO_MAP_HEADER + symbol_map_chunks[0]
    
    messages.append({
        "role": "system",
        "content": [{"type": "text", "text": system_and_map1, "cache_control": {"type": "ephemeral"}}]
    })
    
    # Block 2: Symbol Map Part 2
    if len(symbol_map_chunks) > 1:
        messages.append({
            "role": "user", 
            "content": [{"type": "text", "text": REPO_MAP_CONTINUATION + symbol_map_chunks[1], "cache_control": {"type": "ephemeral"}}]
        })
        messages.append({"role": "assistant", "content": "Ok."})
    
    # Block 3: L0 Files (most stable)
    if file_tiers['L0']:
        l0_content = self._format_files_for_cache(file_tiers['L0'], FILES_L0_HEADER)
        messages.append({
            "role": "user",
            "content": [{"type": "text", "text": l0_content, "cache_control": {"type": "ephemeral"}}]
        })
        messages.append({"role": "assistant", "content": "Ok."})
    
    # Block 4: L1 Files (moderately stable)
    if file_tiers['L1']:
        l1_content = self._format_files_for_cache(file_tiers['L1'], FILES_L1_HEADER)
        messages.append({
            "role": "user",
            "content": [{"type": "text", "text": l1_content, "cache_control": {"type": "ephemeral"}}]
        })
        messages.append({"role": "assistant", "content": "Ok."})
    
    # Active files (uncached)
    if file_tiers['active']:
        active_content = self._format_files_for_cache(file_tiers['active'], FILES_ACTIVE_HEADER)
        messages.append({"role": "user", "content": active_content})
        messages.append({"role": "assistant", "content": "Ok."})
    
    # ... rest of message building (file tree, URLs, history, user message)

def _format_files_for_cache(self, file_paths: list[str], header: str) -> str:
    """Format files for inclusion in a cache block."""
    parts = [header]
    for path in file_paths:
        content = self.repo.get_file_content(path, version='working')
        if isinstance(content, dict) and 'error' in content:
            continue
        parts.append(f"{path}\n```\n{content}\n```")
    return "\n\n".join(parts)
```

### Phase 3: Post-Response Updates ✅ COMPLETE

**Changes to `ac/llm/streaming.py`:**

In `_stream_chat()`, after edits applied:

```python
# After apply_result = edit_parser.apply_edits(...)
if self._context_manager and file_paths:
    tier_changes = self._context_manager.file_stability.update_after_response(
        items=file_paths,
        get_content=lambda p: self.repo.get_file_content(p),
        modified=apply_result.files_modified if apply_result else []
    )
    
    # Log tier changes for debugging
    if tier_changes:
        for file_path, new_tier in tier_changes.items():
            print(f"  📁 {file_path} → {new_tier}")
```

### Phase 4: Persistence

Stability data persists in `.aicoder/file_stability.json`:

```json
{
    "response_count": 47,
    "last_reorg_response": 40,
    "items": {
        "ac/llm/streaming.py": {
            "content_hash": "a1b2c3d4e5f6...",
            "stable_count": 0,
            "current_tier": "active",
            "tier_entry_response": 47
        },
        "ac/symbol_index/models.py": {
            "content_hash": "d4e5f6a1b2c3...",
            "stable_count": 15,
            "current_tier": "L0",
            "tier_entry_response": 32
        }
    }
}
```

## File Changes Summary

| File | Changes |
|------|---------|
| `ac/context/stability_tracker.py` | **New** - Generic `StabilityTracker` class |
| `ac/context/__init__.py` | Export `StabilityTracker`, `StabilityInfo` |
| `ac/context/manager.py` | Add `file_stability` tracker instance |
| `ac/llm/streaming.py` | Restructure message building, update after response |
| `ac/symbol_index/compact_format.py` | Modify `to_compact_chunked()` to support 2 chunks |

## Testing Strategy

### Unit Tests (`tests/test_stability_tracker.py`)

1. Hash computation consistency
2. Greedy initialization in L1
3. N counter increments on unchanged content
4. N counter resets on modified content
5. Tier promotion: Active→L1 at N=3
6. Tier promotion: L1→L0 at N=10
7. Tier demotion on content change
8. Reorganization trigger logic (10 responses, 20% drift)
9. Persistence save/load round-trip
10. Corrupted persistence file handling

### Integration Tests

1. Full streaming flow with stability tracking
2. Cache block structure verification
3. Multi-session persistence
4. File content changes detected correctly

## Metrics to Track

1. **Cache hit rate**: `cache_hit_tokens / total_prompt_tokens`
2. **Tier distribution**: Files in L0 vs L1 vs Active
3. **Reorganization frequency**: How often L0/L1 boundary shifts
4. **Token savings**: Estimated cost reduction from caching

## Rollout

1. **Phase 1**: Implement `StabilityTracker`, add to `ContextManager`, log metrics only
2. **Phase 2**: Enable tiered file caching in message building
3. **Phase 3**: Monitor metrics, adjust thresholds if needed

## Open Questions

1. Should stability persist across sessions? → **Yes**, via JSON file
2. Token budget caps for L0/L1? → **No**, monitor first
3. Should file tree also be cached? → **No**, changes too often

## Future: Symbol Map Integration

The `StabilityTracker` can be reused for symbol map file ordering:

```python
# In SymbolIndex.__init__
self.symbol_stability = StabilityTracker(
    persistence_path=repo_root / '.aicoder' / 'symbol_stability.json',
    l1_threshold=5,
    l0_threshold=15,
)

# In compact_format.py - order files by stability
def get_stable_file_order(self, file_paths: list[str]) -> list[str]:
    """Order files with most stable first for better cache hits."""
    by_tier = self.symbol_stability.get_items_by_tier(file_paths)
    return by_tier['L0'] + by_tier['L1'] + by_tier['active']
```

This ensures symbol map chunks have stable files at the start (cached prefix) and volatile files at the end (uncached suffix).

### Phase 5: Context Viewer UI

**Goal:** Show cache tier badges on files in the context viewer so users can see what's cached.

**Changes to `ac/llm/llm.py`:**
- Update `get_context_breakdown()` to include tier info for each file

**Changes to `webapp/src/context-viewer/ContextViewerTemplate.js`:**
- Add tier badges (🔒 L0, 📌 L1, ✏️ active) to file items in the expanded files section

```javascript
// Show tier badges on files
const tierBadge = {
    'L0': '🔒',  // Cached, most stable
    'L1': '📌',  // Cached, moderately stable  
    'active': '✏️'  // Uncached, being edited
}[item.tier] || '';

return html`<span>${tierBadge} ${item.path} (${formatTokens(item.tokens)})</span>`;
```
