# Simplification & Refactor Plan

## Overview

A series of targeted refactors to reduce duplication, eliminate unnecessary
indirection, and improve maintainability across the codebase. Changes are
ordered by priority (highest impact / lowest risk first).

---

## Phase 1: Consolidate Tier Constants (Small, High Impact)

### Problem
Tier configuration is defined in 3+ places that must be kept in sync manually:
- `ac/context/stability_tracker.py`: `TIER_CONFIG`, `TIER_PROMOTION_ORDER`
- `ac/llm/context_builder.py`: `TIER_THRESHOLDS`, `TIER_NAMES`, `TIER_ORDER`, `CACHE_TIERS`
- `webapp/src/utils/tierConfig.js`: `TIER_THRESHOLDS`, `TIER_NAMES` (JS side, keep as-is)

The values are identical (`TIER_CONFIG[tier]['entry_n']` == `TIER_THRESHOLDS[tier]`)
but if someone updates one file and not the other, behavior diverges silently.

### Changes
1. In `ac/context/stability_tracker.py`, add derived constants after `TIER_CONFIG`:
   ```python
   TIER_THRESHOLDS = {k: v['entry_n'] for k, v in TIER_CONFIG.items()}
   TIER_NAMES = {
       'L0': 'Most Stable', 'L1': 'Very Stable',
       'L2': 'Stable', 'L3': 'Moderately Stable', 'active': 'Active'
   }
   TIER_ORDER = ['L0', 'L1', 'L2', 'L3', 'active']
   CACHE_TIERS = ['L0', 'L1', 'L2', 'L3']
   ```

2. In `ac/llm/context_builder.py`, replace the 4 local constant definitions
   with imports and re-export them so downstream consumers are unaffected:
   ```python
   from ..context.stability_tracker import (
       TIER_THRESHOLDS, TIER_NAMES, TIER_ORDER, CACHE_TIERS
   )
   ```

3. `streaming.py` and `llm.py` already import from `context_builder` —
   no changes needed since the re-exports preserve the public API.

### Files Modified
- `ac/context/stability_tracker.py` (add 4 derived constants)
- `ac/llm/context_builder.py` (replace 4 local constants with imports)

### Tests
- Existing tests in `tests/test_stability_tracker.py` pass unchanged.
- Verify `from ac.llm.context_builder import TIER_THRESHOLDS` returns same values.
- Add one test: `assert TIER_THRESHOLDS == {k: v['entry_n'] for k, v in TIER_CONFIG.items()}`.

---

## Phase 2: Loop-ify `_build_streaming_messages` L1-L3 Blocks (Small, High Impact)

### Problem
`streaming.py` `_build_streaming_messages` has ~80 lines of near-identical code
for L1, L2, and L3 blocks. Each block does: check symbol content, check files,
combine, append message + "Ok." response, or increment empty_tiers.

### Changes
1. Extract helper method `_build_tier_cache_block(self, tier, symbol_map_content,
   symbol_files_by_tier, file_tiers, tier_info, file_header)` that:
   - Prepends `REPO_MAP_CONTINUATION` to symbol content if present (same for all tiers)
   - Appends files formatted with the tier-specific `file_header`
   - Builds the combined content string with `cache_control` wrapper
   - Updates `tier_info` for the tier (symbol count, file count, tokens)
   - Returns dict with `messages` list and `symbol_tokens` count, or `None` if empty

2. Replace the 3 repetitive blocks (L1, L2, L3) with a loop:
   ```python
   tier_file_headers = {'L1': FILES_L1_HEADER, 'L2': FILES_L2_HEADER, 'L3': FILES_L3_HEADER}
   for tier in ['L1', 'L2', 'L3']:
       result = self._build_tier_cache_block(
           tier, symbol_map_content, symbol_files_by_tier,
           file_tiers, tier_info, tier_file_headers[tier]
       )
       if result:
           messages.extend(result['messages'])
           context_map_tokens += result['symbol_tokens']
       else:
           tier_info['empty_tiers'] += 1
   ```

3. L0 block stays separate (it includes system prompt and legend — different structure).

4. Note: `REPO_MAP_CONTINUATION` is the same for all tiers (symbol header),
   while `FILES_L1_HEADER` / `FILES_L2_HEADER` / `FILES_L3_HEADER` differ per tier
   (they label the tier for the LLM). Both are passed into the helper.

### Files Modified
- `ac/llm/streaming.py`

### Tests
- Existing streaming tests should pass unchanged.
- Manual verification: run a chat and confirm the HUD output shows the same
  tier distribution as before the refactor.

---

## Phase 3: Extract Stability Update from `_stream_chat` (Medium)

### Problem
`_stream_chat` is ~200 lines. Lines ~280-380 handle stability tracking after
a response: collecting active items, defining `get_item_content` and
`get_item_tokens` closures, calling `update_after_response`, and logging
promotions/demotions. This is a self-contained concern.

### Changes
1. Extract `_update_cache_stability(self, file_paths, files_modified)` method
   on `StreamingMixin` that:
   - Collects active items (file_paths + symbol entries)
   - Defines `get_item_content` and `get_item_tokens` closures
   - Calls `stability.update_after_response(...)`
   - Logs promotions/demotions
   - Returns `(promotions, demotions)` for inclusion in result

2. Replace the ~100-line block in `_stream_chat` with:
   ```python
   if self._context_manager and self._context_manager.cache_stability:
       self._update_cache_stability(file_paths, files_modified)
   ```

### Files Modified
- `ac/llm/streaming.py`

### Tests
- Existing tests pass unchanged.
- The new method can be unit-tested independently with mock stability tracker.

---

## Phase 4: Simplify Deprecated `summarize_history` (Small)

### Problem
`ChatMixin.summarize_history()` is 50+ lines, marked deprecated, and duplicates
logic now handled by `ContextManager.compact_history_if_needed_sync()`.
No callers remain — the streaming path uses compaction directly.

### Changes
1. Replace the method body with a thin wrapper that delegates to compaction:
   ```python
   def summarize_history(self):
       """Deprecated: Use ContextManager.compact_history_if_needed_sync()."""
       import warnings
       warnings.warn(
           "summarize_history() is deprecated. Use compact_history_if_needed_sync().",
           DeprecationWarning, stacklevel=2
       )
       if not self._context_manager:
           return {"status": "not_needed", "message": "No context manager"}
       result = self._context_manager.compact_history_if_needed_sync()
       if result and result.case != "none":
           return {"status": "summarized", "token_budget": self._context_manager.get_token_budget()}
       return {"status": "not_needed", "message": "History size is within limits"}
   ```

2. The old version returned a `summary` field with the raw summary text.
   No current callers depend on this — the method is not called from the
   streaming path, frontend, or tests. Safe to drop.

### Files Modified
- `ac/llm/chat.py`

### Tests
- Verify deprecation warning is emitted when called.
- Verify it returns `{"status": "not_needed", ...}` when history is small.

---

## Phase 5: Move `_session_empty_tier_count` to Instance State (Small)

### Problem
`StreamingMixin._session_empty_tier_count` is a class-level variable mutated
during streaming. This means all instances share the counter, which is
surprising and breaks test isolation.

### Changes
1. Remove the class-level `_session_empty_tier_count = 0` from `StreamingMixin`.
2. Initialize `self._session_empty_tier_count = 0` in `LiteLLM.__init__`.
3. Update references in `_build_streaming_messages` and `_print_cache_blocks`
   to use `self._session_empty_tier_count` instead of `StreamingMixin._session_empty_tier_count`.
4. Update `get_context_breakdown` in `llm.py` similarly.

### Files Modified
- `ac/llm/streaming.py`
- `ac/llm/llm.py`

### Tests
- Verify two separate `LiteLLM` instances have independent counters.
- Existing tests pass unchanged.

---

## Phase 6: Eliminate `Indexer` Wrapper (Medium)

### Problem
`ac/indexer.py` is a thin pass-through to `SymbolIndex`. Every method is
`self._get_symbol_index().method(...)`. Then `LiteLLM._get_indexer()` wraps
that. So calls go: `LiteLLM → Indexer → SymbolIndex`. Additionally,
`streaming.py` already reaches through the wrapper with
`indexer._get_symbol_index()` in several places — a sign the wrapper isn't
pulling its weight.

`SymbolIndex` already has `save_compact()` which handles writing to disk.
The only value `Indexer` adds is:
- `_ensure_output_dir()` — trivial, already handled by `save_compact`
- `get_symbol_map_with_refs()` — just builds references + calls `to_compact`
  + writes to file. A convenience function, not a class.

### Changes
1. `SymbolIndex` already has `save_compact()`. Add a `save_compact_with_refs()`
   method that combines `build_references` + `to_compact(include_references=True)`
   + write. This absorbs `Indexer.get_symbol_map_with_refs()`.

2. In `LiteLLM`, replace `self._get_indexer()` with `self._get_symbol_index()`
   that returns a `SymbolIndex` directly:
   ```python
   def _get_symbol_index(self):
       if self._symbol_index is None:
           from ac.symbol_index import SymbolIndex
           repo_root = self.repo.get_repo_root() if self.repo else None
           self._symbol_index = SymbolIndex(str(repo_root))
       return self._symbol_index
   ```

3. Update all call sites in `llm.py` and `streaming.py` from
   `self._get_indexer()` to `self._get_symbol_index()`. Remove the
   `indexer._get_symbol_index()` reach-through pattern in `streaming.py`.

4. Reduce `ac/indexer.py` to a thin deprecation shim that imports from
   `SymbolIndex`, or remove entirely. Update `ac/scripts/test_symbol_map.py`
   if it uses `Indexer` directly.

### Files Modified
- `ac/llm/llm.py`
- `ac/llm/streaming.py`
- `ac/symbol_index/symbol_index.py` (add `save_compact_with_refs`)
- `ac/indexer.py` (deprecate or remove)
- `ac/scripts/test_symbol_map.py` (update if it uses Indexer)

### Tests
- `tests/test_symbol_index_order.py` should still pass.
- Verify `save_symbol_map` still writes to `.aicoder/symbol_map.txt`.

---

## Phase 7: Inline `FileContextMixin` (Small)

### Problem
`FileContextMixin` in `ac/llm/file_context.py` has only 2 methods:
`load_files_as_context` and `list_files_in_context`. Both are simple
`self.repo` wrappers. Having a separate mixin file for 2 methods adds
indirection without benefit.

### Changes
1. Move both methods directly into `LiteLLM` class body in `llm.py`.
2. Remove `FileContextMixin` from the inheritance list.
3. Delete `ac/llm/file_context.py`.

### Files Modified
- `ac/llm/llm.py`
- `ac/llm/file_context.py` (delete)

### Tests
- Any test calling `load_files_as_context` or `list_files_in_context`
  should pass unchanged.

---

## Implementation Order

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7
  ↑           ↑         ↑         ↑         ↑         ↑         ↑
 small      small     medium    small     small     medium    small
```

Each phase is independently deployable and testable. No phase depends on
a previous phase being complete, though doing them in order reduces merge
conflicts since Phases 2 and 3 both touch `streaming.py`.

## Testing Strategy

- Run full test suite after each phase: `pytest tests/`
- Phases 1-5 are pure refactors with no behavior change — all existing tests
  must pass without modification.

Key test files per phase:
- **Phase 1**: `tests/test_stability_tracker.py` (tier constants), plus verify
  `from ac.llm.context_builder import TIER_THRESHOLDS` still works
- **Phase 2**: `tests/test_context_manager.py`, `tests/test_llm_history.py`
  (streaming message building is exercised indirectly)
- **Phase 3**: Same as Phase 2 (stability update is part of stream flow)
- **Phase 4**: No existing tests call `summarize_history()` — add a minimal
  test that it emits `DeprecationWarning` and returns correct format
- **Phase 5**: Add a test that two `LiteLLM` instances have independent counters
- **Phase 6**: `tests/test_symbol_index_order.py` (uses `SymbolIndex` directly,
  should pass unchanged). Update any test importing from `ac.indexer`.
- **Phase 7**: No tests import `FileContextMixin` directly — it's only used
  via `LiteLLM` inheritance. Existing tests pass unchanged.
