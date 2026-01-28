# Plan: Symbol Map Cache Optimization via Stable Ordering

## Status: IMPLEMENTED

## Problem

Anthropic uses **prefix caching** - the conversation is cached from the start up to the first changed character. Currently, the symbol map is sorted alphabetically:

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

## Implementation

### New File: `.aicoder/symbol_map_order.json`

```json
{
  "order": [
    "ac/context/__init__.py",
    "ac/context/manager.py", 
    "ac/llm/llm.py"
  ]
}
```

### Changes

#### 1. `ac/symbol_index/symbol_index.py`

Add order persistence:

```python
ORDER_FILE = ".aicoder/symbol_map_order.json"

def _load_order(self) -> List[str]:
    """Load persisted file order."""
    path = self.repo_root / self.ORDER_FILE
    if path.exists():
        import json
        with open(path) as f:
            data = json.load(f)
            return data.get("order", [])
    return []

def _save_order(self, order: List[str]):
    """Save file order to disk."""
    import json
    path = self.repo_root / self.ORDER_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w') as f:
        json.dump({"order": order}, f, indent=2)

def get_ordered_files(self, available_files: List[str]) -> List[str]:
    """Get files in stable order for LLM context.
    
    Files maintain their position. New files are appended at bottom.
    """
    existing_order = self._load_order()
    available_set = set(available_files)
    
    # Keep existing order for files still available
    result = [f for f in existing_order if f in available_set]
    
    # Append new files at bottom
    for f in available_files:
        if f not in existing_order:
            result.append(f)
    
    # Save updated order
    self._save_order(result)
    
    return result
```

#### 2. `ac/symbol_index/compact_format.py`

Add optional `file_order` parameter to `to_compact()`:

```python
def to_compact(
    symbols_by_file: Dict[str, List[Symbol]],
    references: Optional[Dict[str, Dict[str, List]]] = None,
    file_refs: Optional[Dict[str, Set[str]]] = None,
    file_imports: Optional[Dict[str, Set[str]]] = None,
    include_instance_vars: bool = True,
    include_calls: bool = False,
    include_legend: bool = True,
    file_order: Optional[List[str]] = None,  # NEW
) -> str:
    # ...
    
    # Use provided order, or fall back to sorted
    if file_order:
        ordered_files = [f for f in file_order if f in symbols_by_file]
    else:
        ordered_files = sorted(symbols_by_file.keys())
    
    for file_path in ordered_files:
        # ... rest unchanged
```

#### 3. `ac/symbol_index/symbol_index.py:to_compact()`

Pass order to compact_format:

```python
def to_compact(
    self, 
    file_paths: List[str] = None,
    include_references: bool = False,
) -> str:
    # ... existing code to build symbols_by_file ...
    
    # Get stable order for available files
    file_order = self.get_ordered_files(list(symbols_by_file.keys()))
    
    return to_compact(
        symbols_by_file, 
        references=references, 
        file_refs=file_refs,
        file_imports=file_imports,
        file_order=file_order,  # NEW
    )
```

## Testing

1. Add file A to context → removed from symbol map
2. Send message → cache established
3. Remove file A from context → appears at bottom of map
4. Send message → prefix should be cached (check `cache_hit_tokens` in HUD)

## Risks

- Order file could grow stale with deleted files (mitigated: we filter by `available_files`)
- First-time generation still alphabetical (acceptable: establishes baseline)
