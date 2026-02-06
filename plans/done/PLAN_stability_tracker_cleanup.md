# Plan: Stability Tracker & Related Cleanup

## Status: DONE ✅

## Goal
Simplify the stability tracker, reduce duplicated patterns, and remove dead code.
Small, safe changes that improve readability without changing behavior.

## What was done

### Phase 1: Clean up `stability_tracker.py` — ALREADY DONE (pre-existing)

Phases 1a and 1b were already completed in the working codebase:
- Legacy `__init__` parameters already removed
- `get_stable_count` already a deprecated alias for `get_n_value`
- `get_items_by_tier` already uses `get_n_value`

Only fix needed: updated `test_init_with_default_thresholds` to assert 4-tier
defaults (`{'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12}`) instead of old 2-tier values.

### Phase 2: Extract duplicated content-fetching pattern — DONE

**2a. Added `_get_file_content_safe` to `ContextBuilderMixin`**

Extracts repeated "get content, check for error dict" pattern. Used by:
- `_build_file_items` in `context_builder.py`
- `_initialize_stability_from_refs` in `context_builder.py`
- `_format_files_for_cache` in `streaming.py`
- `get_item_tokens` and `get_item_content` lambdas in `streaming.py`
- `get_token_report` file loading in `llm.py`

**2b. Added `_is_error_response` static method to `ContextBuilderMixin`**

Replaces `isinstance(x, dict) and 'error' in x` pattern.
Inherited by `streaming.py` and `llm.py` via mixin chain.
Used in `_stream_chat` file loading in `streaming.py`.

### Phase 3: Simplified `get_item_info` — DONE

Removed dead legacy fallback path that walked `_thresholds` dict.
Now uses `TIER_CONFIG` and `_get_next_tier` directly.

## Files Modified

| File | Change |
|------|--------|
| `ac/context/stability_tracker.py` | Phase 3: simplified `get_item_info` |
| `ac/llm/context_builder.py` | Phase 2: added helpers, updated `_build_file_items`, `_initialize_stability_from_refs` |
| `ac/llm/streaming.py` | Phase 2: updated `_format_files_for_cache`, `get_item_content`, `get_item_tokens`, `_stream_chat` |
| `ac/llm/llm.py` | Phase 2: updated `get_token_report` file loading |
| `tests/test_stability_tracker.py` | Fixed `test_init_with_default_thresholds` for 4-tier defaults |

## Testing

All 98 tests pass: `pytest tests/test_stability_tracker.py tests/test_context_manager.py -v`

## What's next

Larger refactors identified but out of scope for this plan:
- **Extract URL mixin**: Move `fetch_url`, `detect_urls`, etc. from `llm.py` into `UrlMixin`
- **Extract LSP mixin**: Move `lsp_get_hover`, `lsp_get_definition`, etc. into `LspMixin`
- **Break up `_build_streaming_messages`**: 200-line method doing too many things
- **Repo error handling**: Replace error dicts with exceptions (invasive, needs separate plan)
