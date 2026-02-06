# Simplification & Refactor Plan

## Overview

A series of targeted refactors to reduce duplication, eliminate unnecessary
indirection, and improve maintainability across the codebase. Changes are
ordered by priority (highest impact / lowest risk first).

---

## Phase 1: Consolidate Tier Constants ✅ DONE

Derived constants (`TIER_THRESHOLDS`, `TIER_NAMES`, `TIER_ORDER`, `CACHE_TIERS`)
are defined once in `ac/context/stability_tracker.py` after `TIER_CONFIG`.
`ac/llm/context_builder.py` imports and re-exports them.
`streaming.py` and `llm.py` import from `context_builder` unchanged.

---

## Phase 2: Loop-ify `_build_streaming_messages` L1-L3 Blocks ✅ DONE

Extracted `_build_tier_cache_block` helper on `StreamingMixin` in `streaming.py`.
The 3 repetitive L1/L2/L3 blocks replaced with a 10-line loop.
L0 stays separate (system prompt + legend have different structure).

Note: `context_builder.py` has a separate `_build_tier_block` for the UI
visualization in `get_context_breakdown` — different purpose, not duplicated.

---

## Phase 3: Extract Stability Update from `_stream_chat` ✅ DONE

Extracted `_update_cache_stability(self, file_paths, files_modified)` method
on `StreamingMixin`. The ~100-line inline block in `_stream_chat` replaced
with a 2-line conditional call. No behavior change.

---

## Phase 4: Simplify Deprecated `summarize_history` ✅ DONE

Replaced 50+ line `summarize_history()` in `ChatMixin` with a thin 10-line
wrapper that delegates to `ContextManager.compact_history_if_needed_sync()`.
The old version made its own LLM call for summarization — now it uses
the compaction system. The `summary` field in the return value was dropped
(no callers depend on it).

---

## Phase 5: Move `_session_empty_tier_count` to Instance State ✅ DONE

Removed class-level `_session_empty_tier_count` from `StreamingMixin`.
Initialized as `self._session_empty_tier_count = 0` in `LiteLLM.__init__`.
Updated 3 references in `streaming.py` and 1 in `llm.py` to use `self.`
instead of `StreamingMixin.`. Each `LiteLLM` instance now has its own counter.

---

## Phase 6: Eliminate `Indexer` Wrapper ✅ DONE

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

### Changes (completed)
1. `save_compact_with_refs()` already existed on `SymbolIndex`.
2. `LiteLLM._get_symbol_index()` returns `SymbolIndex` directly.
3. All call sites in `llm.py`, `streaming.py`, and `context_builder.py`
   updated from `self._get_indexer()` to `self._get_symbol_index()`.
   Reach-through `indexer._get_symbol_index()` patterns eliminated.
4. `ac/indexer.py` reduced to a thin deprecation shim with `__getattr__`.
5. `ac/scripts/test_symbol_map.py` already used `SymbolIndex` directly.

### Files Modified
- `ac/llm/llm.py`
- `ac/llm/streaming.py`
- `ac/llm/context_builder.py`
- `ac/indexer.py` (reduced to deprecation shim)

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
Phase 1 ✅ → Phase 2 ✅ → Phase 3 ✅ → Phase 4 ✅ → Phase 5 ✅ → Phase 6 ✅ → Phase 7
                                                                                 ↑
                                                                               small
```

Each phase is independently deployable and testable. No phase depends on
a previous phase being complete, though doing them in order reduces merge
conflicts since Phases 2 and 3 both touch `streaming.py`.

## Testing Strategy

- Run full test suite after each phase: `pytest tests/`
- Phases 1-5 are pure refactors with no behavior change — all existing tests
  must pass without modification.

Key test files per remaining phase:
- **Phase 3**: `tests/test_context_manager.py`, `tests/test_llm_history.py`
- **Phase 4**: No existing tests call `summarize_history()` — add a minimal
  test that it emits `DeprecationWarning` and returns correct format
- **Phase 5**: Add a test that two `LiteLLM` instances have independent counters
- **Phase 6**: `tests/test_symbol_index_order.py` (uses `SymbolIndex` directly,
  should pass unchanged). Update any test importing from `ac.indexer`.
- **Phase 7**: No tests import `FileContextMixin` directly — it's only used
  via `LiteLLM` inheritance. Existing tests pass unchanged.
