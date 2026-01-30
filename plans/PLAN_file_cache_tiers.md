# Plan: Tiered File Caching for LLM Context

## Overview

Implement a two-tier file caching system that automatically promotes stable reference files to cached context blocks, reducing API costs through better prompt caching utilization.

## Problem Statement

Currently, all files in context are sent uncached in every request. Files that are included for reference but rarely edited (e.g., base classes, interfaces, utility modules) could benefit from prompt caching, but we have no mechanism to identify and cache them.

## Goals

1. Automatically identify stable reference files based on edit patterns
2. Utilize all 4 Bedrock cache blocks efficiently
3. Minimize cache invalidation through smart tiering
4. Reduce token costs for repeated context

## Design

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

### File Tiers

| Tier | Description | Entry Criteria | Exit Criteria |
|------|-------------|----------------|---------------|
| Active | Files being worked on | Default for new files | N >= 3 (promote to L1) |
| L1 | Moderately stable | N >= 3 | N >= 10 (promote to L0) or edited (demote to Active) |
| L0 | Most stable | N >= 10 | Edited (demote to Active) |

Where `N` = consecutive assistant responses where file content hash unchanged.

### Stability Tracking

Track per file:
```python
@dataclass
class FileStabilityInfo:
    content_hash: str           # SHA256 of file content
    stable_count: int           # N - consecutive unchanged responses
    current_tier: Literal['active', 'L1', 'L0']
    tier_entry_response: int    # response number when entered current tier
```

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
stability_scores = [file.stable_count for file in cached_files if file.stable_count > 0]
l0_threshold = percentile(stability_scores, 75)  # top 25% go to L0
```

For now, use fixed thresholds: L1=3, L0=10.

## Implementation

### Phase 1: Stability Tracking

**New file: `ac/context/file_stability.py`**

```python
@dataclass
class FileStabilityInfo:
    content_hash: str
    stable_count: int
    current_tier: str
    tier_entry_response: int

class FileStabilityTracker:
    def __init__(self, repo_root: Path):
        self._stability: dict[str, FileStabilityInfo] = {}
        self._response_count: int = 0
        self._last_reorg_response: int = 0
        self._persistence_path: Path  # .aicoder/file_stability.json
    
    def compute_hash(self, content: str) -> str: ...
    
    def update_after_response(self, 
                              files_in_context: list[str],
                              files_modified: list[str],
                              get_content: Callable[[str], str]) -> None:
        """Called after each assistant response + edits applied."""
        ...
    
    def get_tier(self, file_path: str) -> str: ...
    
    def get_files_by_tier(self) -> dict[str, list[str]]:
        """Returns {'L0': [...], 'L1': [...], 'active': [...]}"""
        ...
    
    def should_reorganize(self) -> bool: ...
    
    def reorganize(self) -> None:
        """Recompute L0/L1 boundary based on current N distribution."""
        ...
    
    def save(self) -> None: ...
    def load(self) -> None: ...
```

**Changes to `ac/context/manager.py`:**
- Add `FileStabilityTracker` instance
- Expose methods for streaming to query tiers

### Phase 2: Message Building

**Changes to `ac/llm/streaming.py`:**

Modify `_build_streaming_messages()`:

1. Combine system prompt with first symbol map chunk
2. Split symbol map into 2 parts (not 5)
3. Query `FileStabilityTracker` for file tiers
4. Build L0 and L1 file bundles with `cache_control`
5. Include active files without caching

```python
def _build_streaming_messages(self, ...):
    messages = []
    
    # Block 1: System + Symbol Map Part 1
    system_and_map1 = system_text + "\n\n" + REPO_MAP_HEADER + symbol_map_part1
    messages.append({
        "role": "system",
        "content": [{"type": "text", "text": system_and_map1, "cache_control": {"type": "ephemeral"}}]
    })
    
    # Block 2: Symbol Map Part 2
    messages.append({
        "role": "user", 
        "content": [{"type": "text", "text": REPO_MAP_CONTINUATION + symbol_map_part2, "cache_control": {"type": "ephemeral"}}]
    })
    messages.append({"role": "assistant", "content": "Ok."})
    
    # Block 3: L0 Files (most stable)
    if l0_files:
        l0_content = self._format_files_for_cache(l0_files)
        messages.append({
            "role": "user",
            "content": [{"type": "text", "text": l0_content, "cache_control": {"type": "ephemeral"}}]
        })
        messages.append({"role": "assistant", "content": "Ok."})
    
    # Block 4: L1 Files (moderately stable)
    if l1_files:
        l1_content = self._format_files_for_cache(l1_files)
        messages.append({
            "role": "user",
            "content": [{"type": "text", "text": l1_content, "cache_control": {"type": "ephemeral"}}]
        })
        messages.append({"role": "assistant", "content": "Ok."})
    
    # Active files (uncached)
    if active_files:
        ...
```

### Phase 3: Post-Response Updates

**Changes to `ac/llm/streaming.py`:**

In `_stream_chat()`, after edits applied:

```python
# After apply_result = edit_parser.apply_edits(...)
if self._context_manager and hasattr(self._context_manager, 'stability_tracker'):
    self._context_manager.stability_tracker.update_after_response(
        files_in_context=file_paths or [],
        files_modified=apply_result.files_modified,
        get_content=lambda p: self.repo.get_file_content(p)
    )
```

### Phase 4: Persistence

Store stability data in `.aicoder/file_stability.json`:

```json
{
    "response_count": 47,
    "last_reorg_response": 40,
    "files": {
        "ac/llm/streaming.py": {
            "content_hash": "a1b2c3...",
            "stable_count": 0,
            "current_tier": "active",
            "tier_entry_response": 47
        },
        "ac/symbol_index/models.py": {
            "content_hash": "d4e5f6...",
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
| `ac/context/file_stability.py` | **New** - FileStabilityTracker class |
| `ac/context/__init__.py` | Export FileStabilityTracker |
| `ac/context/manager.py` | Add stability_tracker instance |
| `ac/llm/streaming.py` | Restructure message building, update after response |
| `ac/symbol_index/compact_format.py` | Add `to_compact_two_chunks()` or modify chunking |

## Testing Strategy

### Unit Tests (`tests/test_file_stability.py`)

1. Hash computation consistency
2. N counter increments on unchanged files
3. N counter resets on modified files
4. Tier promotion: Active→L1 at N=3
5. Tier promotion: L1→L0 at N=10
6. Tier demotion on edit
7. Reorganization trigger logic
8. Persistence save/load round-trip

### Integration Tests

1. Full streaming flow with stability tracking
2. Cache block structure verification
3. Multi-session persistence

## Metrics to Track

1. **Cache hit rate**: `cache_hit_tokens / total_prompt_tokens`
2. **Tier distribution**: Files in L0 vs L1 vs Active
3. **Reorganization frequency**: How often L0/L1 boundary shifts
4. **Token savings**: Estimated cost reduction from caching

## Rollout

1. **Phase 1**: Implement tracking, log metrics, no behavior change
2. **Phase 2**: Enable tiered caching behind feature flag
3. **Phase 3**: Default on after validating metrics

## Open Questions

1. Should stability persist across sessions? (Proposed: yes, via JSON file)
2. Token budget caps for L0/L1? (Proposed: not initially, monitor first)
3. Should file tree also be cached? (Proposed: no, changes too often)

## Future Enhancements

1. Statistical L0/L1 boundary based on N distribution
2. Predictive demotion (demote files likely to be edited based on patterns)
3. Provider-specific cache block limits (OpenAI vs Anthropic vs Bedrock)
4. Visualization of cache efficiency in context viewer
