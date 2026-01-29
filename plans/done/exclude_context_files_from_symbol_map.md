# Plan: Symbol Map Cache Optimization via Stable Ordering

## Status: IMPLEMENTED ✅

## Problem

Anthropic and AWS Bedrock use **prefix caching** - the conversation is cached from the start up to the first changed character. Originally, the symbol map was sorted alphabetically:

```python
# compact_format.py line 67
for file_path in sorted(symbols_by_file.keys()):
```

When a file is removed from context (user deselects it), it gets re-inserted into the symbol map **alphabetically**, which can change the prefix and invalidate the cache for everything after it.

## Goal

Maintain a **stable order** for symbol map entries. When a file returns to the symbol map (removed from full context), append it to the **bottom** instead of its alphabetical position. This preserves the cached prefix.

### Example

```
Before (file_context.py in full context, excluded from map):
1. ac/context/__init__.py    ← cached
2. ac/context/manager.py     ← cached  
3. ac/llm/llm.py             ← cached

After (file_context.py removed from context, returns to map):
1. ac/context/__init__.py    ← still cached ✓
2. ac/context/manager.py     ← still cached ✓
3. ac/llm/llm.py             ← still cached ✓
4. ac/context/file_context.py ← NEW (appended at bottom)
```

Everything above stays cached because the prefix is identical.

## Architecture Note

- **LSP/Editor** uses in-memory `SymbolCache` via `to_lsp()` and `get_document_symbols()` - NOT the disk file
- **LLM context** uses `to_compact()` which writes to `.aicoder/symbol_map.txt`
- These are independent - we only need to change ordering for LLM context generation

## Implementation Summary

### 1. Order Persistence (`.aicoder/symbol_map_order.json`)

**File:** `ac/symbol_index/symbol_index.py`

Added methods to persist and load file ordering:
- `_load_order()` - Loads order from JSON file, with caching
- `_save_order(order)` - Saves order to JSON file
- `get_ordered_files(available_files)` - Returns files in stable order, appending new files at bottom

### 2. Compact Format with Ordering

**File:** `ac/symbol_index/compact_format.py`

Added `file_order` parameter to both:
- `to_compact()` - Single symbol map generation
- `to_compact_chunked()` - Chunked generation for cache optimization

When `file_order` is provided, files appear in that order instead of alphabetically sorted.

### 3. Chunked Symbol Map for Better Caching

**File:** `ac/symbol_index/symbol_index.py`

Added `to_compact_chunked()` method that splits the symbol map into multiple chunks:
- Supports `min_chunk_tokens` for automatic splitting by size
- Supports `num_chunks` for explicit N-way splitting
- Supports `return_metadata=True` to include file lists and cache status per chunk
- Stable files appear in earlier chunks (cacheable), volatile files in later chunks

### 4. Streaming Integration

**File:** `ac/llm/streaming.py`

Updated `_build_streaming_messages()` to use chunked symbol maps:
- Splits into 5 chunks by default
- First 3 chunks get `cache_control: {"type": "ephemeral"}` (Bedrock limit: 4 blocks total, 1 for system prompt)
- Last 2 chunks are uncached (contain newest/most volatile files)
- Prints diagnostic showing chunk sizes and cache status

### 5. LLM Context Breakdown API

**File:** `ac/llm/llm.py`

Updated `get_context_breakdown()` to include chunk metadata:
- Returns chunk info with `index`, `tokens`, `cached`, and `files` list
- Powers the frontend visualization

### 6. Frontend: Context Viewer

**File:** `webapp/src/context-viewer/ContextViewerTemplate.js`

Enhanced Symbol Map section to show cache chunks:
- Visual distinction between cached (🔒 green) and uncached (📝 yellow) chunks
- Shows file count per chunk
- Expandable to see files in each chunk
- Header explaining Bedrock's 4-block cache limit

**File:** `webapp/src/context-viewer/ContextViewerStyles.js`

Added styles for chunk visualization:
- `.symbol-map-chunks` container
- `.chunk-row.cached` / `.chunk-row.uncached` with color coding
- `.chunk-files` for expandable file lists
- `.chunk-icon`, `.chunk-label`, `.chunk-tokens`, `.chunk-status` for layout

### 7. Terminal HUD

**File:** `ac/llm/streaming.py` (`_print_streaming_hud`)

Enhanced HUD output to show:
- Chunk count and sizes during symbol map loading
- Cache hit/write tokens from API response
- Estimated cache percentage of system+symbol map

Example output:
```
📦 Symbol map: 5 chunks
  🔒 Chunk 0: 12,345 chars, ~3,086 tokens, 450 lines, 15 files
  🔒 Chunk 1: 11,234 chars, ~2,808 tokens, 380 lines, 12 files
  🔒 Chunk 2: 10,567 chars, ~2,641 tokens, 320 lines, 10 files
  📝 Chunk 3: 9,876 chars, ~2,469 tokens, 290 lines, 8 files
  📝 Chunk 4: 5,432 chars, ~1,358 tokens, 150 lines, 5 files

──────────────────────────────────────────────────
📊 anthropic/claude-sonnet-4-20250514
──────────────────────────────────────────────────
  System:          1,234
  Symbol Map:      12,362
  Files:           3,456
  History:         789
──────────────────────────────────────────────────
  Total:           17,841 / 200,000
  Last request:    18,000 in, 1,234 out
  Cache:           hit: 13,500, write: 0, ~98% of sys+map
```

### 8. Frontend Token HUD

**File:** `webapp/src/prompt/PromptViewTemplate.js`

The `renderHud()` function displays token usage including:
- Context breakdown (system, symbol map, files, history)
- Current request tokens (prompt, response)
- Cache hit tokens when available
- Session totals

## Testing Results

1. ✅ Files maintain stable order across sessions
2. ✅ New files appear at bottom of symbol map
3. ✅ Chunks show correct cache status in UI
4. ✅ Cache hits reported in HUD after first request
5. ✅ ~98% cache hit rate observed for stable codebases

## Files Changed

- `ac/symbol_index/symbol_index.py` - Order persistence, chunked generation
- `ac/symbol_index/compact_format.py` - `file_order` parameter, `to_compact_chunked()`
- `ac/llm/llm.py` - `get_context_map_chunked()`, enhanced `get_context_breakdown()`
- `ac/llm/streaming.py` - Chunked symbol map in messages, enhanced HUD
- `webapp/src/context-viewer/ContextViewerTemplate.js` - Chunk visualization
- `webapp/src/context-viewer/ContextViewerStyles.js` - Chunk styling
- `tests/test_symbol_index_order.py` - Comprehensive tests for ordering and chunking
