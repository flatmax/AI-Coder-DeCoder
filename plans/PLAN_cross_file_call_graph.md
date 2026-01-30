# Plan: Cross-File Call Graph in Symbol Map

## Problem

The symbol map shows **incoming** references (`←refs`) but not **outgoing** calls. When planning changes, I can see "who calls X" but not "what does X call". This makes it hard to trace downstream impact without requesting multiple files.

## Current State

The infrastructure for call tracking already exists but isn't fully utilized:

1. **`CallSite` model** (`models.py`) has fields for resolution:
   ```python
   target_file: Optional[str] = None        # Resolved target file (if in-repo)
   target_symbol: Optional[str] = None      # Resolved symbol name
   ```

2. **Extractors** (`base.py`, `python.py`, `javascript.py`, `cpp.py`) already:
   - Build `_import_map` mapping names to modules (Python, JS)
   - Extract calls via `_extract_calls_with_context()` (all languages)
   - Populate `target_symbol` via `_resolve_call_target()` (Python, JS)
   - Define `BUILTINS_TO_SKIP` to filter noise (all languages)

3. **`SymbolIndex`** (`symbol_index.py`) already:
   - Resolves imports to file paths via `ImportResolver`
   - Stores results in `_file_imports` dict

4. **`compact_format.py`** has:
   - `include_calls` parameter (default `False`)
   - `_format_calls()` function that currently ignores `target_file`

**The gap:** `CallSite.target_file` is never populated. The module→file resolution happens in SymbolIndex, but CallSites are created earlier in extractors.

## Language Support Status

| Language   | Import Map | Call Extraction | Resolution |
|------------|------------|-----------------|------------|
| Python     | ✅ `_update_import_map()` | ✅ | ✅ via module path |
| JavaScript | ✅ `_update_import_map()` | ✅ | ✅ via module path |
| C++        | ❌ (no import map) | ✅ | ⚠️ name-based only |

C++ uses `#include` which doesn't create a name→module mapping like Python/JS imports. Resolution will fall back to matching call names against all indexed symbols.

## Proposed Solution

### Phase 1: Populate `target_file` on CallSites

After all files are indexed, SymbolIndex backfills `target_file` by resolving `target_symbol` to a file path. This happens in `_get_symbols_and_refs()` (not `index_file()`) because we need access to all indexed symbols for resolution.

**In `symbol_index.py`:**

```python
def _resolve_call_targets(self, file_path: str, symbols: List[Symbol], all_symbols: Dict[str, List[Symbol]] = None):
    """Backfill target_file on CallSites after import resolution.
    
    Args:
        file_path: Current file being processed
        symbols: Symbols from this file
        all_symbols: All indexed symbols (for name-based fallback)
    """
    for symbol in symbols:
        for call_site in symbol.call_sites:
            if call_site.target_file:
                continue  # Already resolved
                
            # Method 1: Resolve via target_symbol (Python/JS)
            if call_site.target_symbol:
                resolved = self._resolve_symbol_to_file(call_site.target_symbol)
                if resolved:
                    call_site.target_file = resolved
                    continue
            
            # Method 2: Search all indexed symbols by name (C++ fallback)
            if all_symbols:
                resolved = self._find_symbol_file(call_site.name, all_symbols, exclude_file=file_path)
                if resolved:
                    call_site.target_file = resolved
        
        # Recurse into children (methods)
        self._resolve_call_targets(file_path, symbol.children, all_symbols)

def _resolve_symbol_to_file(self, target_symbol: str) -> Optional[str]:
    """Resolve a dotted symbol path to a file path.
    
    e.g., "ac.url_handler.cache.URLCache" -> "ac/url_handler/cache.py"
    """
    parts = target_symbol.split('.')
    # Try progressively shorter prefixes as module path
    for i in range(len(parts), 0, -1):
        module = '.'.join(parts[:i])
        # Try Python resolution
        resolved = self._import_resolver.resolve_python_import(
            module=module,
            from_file='',
            is_relative=False,
            level=0,
        )
        if resolved:
            return resolved
    return None

def _find_symbol_file(self, name: str, all_symbols: Dict[str, List[Symbol]], exclude_file: str = None) -> Optional[str]:
    """Find which file defines a symbol by name (for C++ etc).
    
    Args:
        name: Symbol name to find
        all_symbols: Dict of file_path -> symbols
        exclude_file: Don't match symbols from this file
        
    Returns:
        File path if found, None otherwise
    """
    # Handle qualified names like "ClassName::method"
    search_name = name.split('::')[-1] if '::' in name else name
    search_name = search_name.split('.')[-1] if '.' in search_name else search_name
    
    for fpath, symbols in all_symbols.items():
        if fpath == exclude_file:
            continue
        for sym in symbols:
            if sym.name == search_name and sym.kind in ('function', 'method', 'class'):
                return fpath
            # Check children (methods)
            for child in sym.children:
                if child.name == search_name and child.kind in ('function', 'method'):
                    return fpath
    return None
```

### Phase 2: Format Cross-File Calls Only

Modify `_format_calls()` to filter and format cross-file calls.

**In `compact_format.py`:**

```python
def _format_calls(
    symbol: Symbol, 
    current_file: str = None, 
    aliases: Dict[str, str] = None,
    cross_file_only: bool = True,
) -> str:
    """Format calls, optionally filtering to cross-file only.
    
    Args:
        symbol: Symbol with call_sites
        current_file: Current file path (to filter out same-file calls)
        aliases: Path aliases for compression
        cross_file_only: If True, only show calls to other files
    
    Returns:
        String like "→@4/cache.py:get,@4/summarizer.py:summarize" or empty
    """
    if not symbol.call_sites:
        return ''
    
    aliases = aliases or {}
    calls = []
    seen = set()
    
    for site in symbol.call_sites:
        if cross_file_only:
            # Skip if no resolved target or same file
            if not site.target_file:
                continue
            if current_file and site.target_file == current_file:
                continue
            
            # Dedupe by file:symbol
            key = f"{site.target_file}:{site.name}"
            if key in seen:
                continue
            seen.add(key)
            
            # Format with alias
            aliased_path = _apply_path_alias(site.target_file, aliases)
            symbol_name = site.name.split('.')[-1]  # Just the function name
            calls.append(f"{aliased_path}:{symbol_name}")
        else:
            # Original behavior: show all calls by name
            if site.name in seen:
                continue
            seen.add(site.name)
            
            if site.is_conditional:
                calls.append(f"{site.name}?")
            else:
                calls.append(site.name)
    
    if not calls:
        return ''
    
    # Limit and format
    max_calls = 5
    if len(calls) <= max_calls:
        return '→' + ','.join(calls)
    else:
        return '→' + ','.join(calls[:max_calls]) + f",+{len(calls)-max_calls}"
```

### Phase 3: Add Parameter to Enable Cross-File Calls

**In `compact_format.py` - modify `to_compact()` and `_format_symbol()`:**

Add `include_cross_file_calls: bool = True` parameter that flows through to `_format_calls()`.

Keep existing `include_calls: bool = False` for showing all calls (debugging use).

**In `_format_file_block()` and `_format_symbol()`:**

Pass `current_file` so `_format_calls()` can filter same-file calls.

## Example Output

Before:
```
ac/url_handler/fetcher.py: ←3
i time,typing
i→ ac/url_handler/cache.py,ac/url_handler/config.py,...
c URLFetcher:15
  m fetch(url,use_cache,...)->URLResult:37
  m _add_summary(result,summary_type,context)->URLResult:233
```

After:
```
ac/url_handler/fetcher.py: ←3
i time,typing
i→ ac/url_handler/cache.py,ac/url_handler/config.py,...
c URLFetcher:15
  m fetch(...)->URLResult:37 →@4/cache.py:get,@4/summarizer.py:summarize
  m _add_summary(...)->URLResult:233 →@4/summarizer.py:summarize
```

## Token Cost Estimate

- Average method with cross-file calls: ~30-50 extra characters
- Many methods (internal helpers, simple accessors): 0 extra
- Path aliases reduce cost significantly (`@4/` vs `ac/url_handler/`)
- Estimate: **10-20% increase** in symbol map size
- Test files (already collapsed) won't grow

## Files to Modify

1. **`ac/symbol_index/symbol_index.py`**
   - Add `_resolve_call_targets()` method
   - Add `_resolve_symbol_to_file()` helper
   - Add `_find_symbol_file()` for name-based fallback (C++)
   - Call from `index_file()` after import resolution
   - Modify `_get_symbols_and_refs()` to pass symbols for resolution

2. **`ac/symbol_index/compact_format.py`**
   - Modify `_format_calls()` to accept `current_file`, `aliases`, `cross_file_only`
   - Add `include_cross_file_calls` parameter to `to_compact()`, `to_compact_chunked()`, `_format_file_block()`, `_format_symbol()`
   - Pass current file path through the formatting chain

3. **`ac/symbol_index/extractors/cpp.py`** (optional future enhancement)
   - Add `_update_import_map()` to track `#include` → file mappings
   - Would improve resolution accuracy for C++

## Testing

1. **Unit tests for `symbol_index.py`:**
   - `_resolve_symbol_to_file()` resolves known Python/JS imports
   - `_find_symbol_file()` finds C++ symbols by name
   - `_resolve_call_targets()` populates `target_file`

2. **Unit tests for `compact_format.py`:**
   - `_format_calls()` with `cross_file_only=True` filters same-file
   - `_format_calls()` with `cross_file_only=False` shows all
   - Path aliases applied correctly

3. **Integration test:**
   - Full symbol map includes `→` annotations
   - Cross-file calls shown, same-file excluded
   - Works for Python, JavaScript, C++ files

4. **Token cost verification:**
   - Generate symbol map before/after
   - Confirm increase < 25%

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Performance slowdown | Medium | Cache resolution results; only resolve on-demand |
| Too many calls shown | Medium | Cross-file filter + limit to 5 + skip builtins |
| Inaccurate C++ resolution | Low | Name-based fallback is best-effort; Python/JS are primary |
| Dynamic imports missed | Low | Accept false negatives for runtime imports |

## Implementation Order

1. Add `_resolve_symbol_to_file()` and `_find_symbol_file()` to `symbol_index.py`
2. Add `_resolve_call_targets()` and call from `_get_symbols_and_refs()` (after all files indexed)
3. Modify `_format_calls()` signature and logic
4. Add `include_cross_file_calls` parameter threading
5. Add tests
6. Enable by default and verify token cost

## Success Criteria

- [ ] Symbol map shows `→file:symbol` for cross-file calls
- [ ] Same-file calls excluded (visible in file context anyway)
- [ ] Works for Python, JavaScript (C++ best-effort)
- [ ] Token cost increase < 25%
- [ ] No performance regression on large repos
