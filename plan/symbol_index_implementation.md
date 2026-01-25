# Implementation Plan: Two-Format Symbol Index

## Overview

Create a tree-sitter based symbol indexer that produces two output formats:
1. **Compact Format** - For LLM context, replacing aider's repo map
2. **LSP Format** - For Monaco editor (full precision for hover, go-to-definition, etc.)

### Design Goals

- **Independent of aider** - No dependency on aider_integration for repo mapping
- **Hybrid format** - Compact symbols with optional cross-file references
- **Tiered detail** - Minimal by default, rich references on-demand
- **Drop-in replacement** - Can fully replace aider's RepoMap for AI context

---

## Phase 1: Core Tree-sitter Infrastructure

### 1.1 Create base symbol index module

New directory: `ac/symbol_index/`

Files:
- `__init__.py` - exports
- `parser.py` - tree-sitter parsing wrapper
- `symbol_index.py` - main SymbolIndex class
- `compact_format.py` - Format 1 (LLM context)
- `lsp_format.py` - Format 2 (Monaco)

### 1.2 Tree-sitter setup

- Add `tree-sitter` and language grammars to dependencies
- Support Python, JavaScript, TypeScript initially
- Lazy-load grammars per file extension

---

## Phase 2: Symbol Extraction

### 2.1 Define symbol types

```python
@dataclass
class Range:
    start_line: int
    start_col: int
    end_line: int
    end_col: int

@dataclass
class Parameter:
    name: str
    type_annotation: Optional[str] = None
    default_value: Optional[str] = None

@dataclass
class Symbol:
    name: str
    kind: str  # class, method, function, variable, import, property
    file_path: str
    range: Range  # start/end line+col
    selection_range: Range  # just the name
    parent: Optional[str] = None  # parent symbol name
    children: List[Symbol] = field(default_factory=list)
    parameters: List[Parameter] = field(default_factory=list)
    return_type: Optional[str] = None
    bases: List[str] = field(default_factory=list)  # for classes
    docstring: Optional[str] = None
```

### 2.2 Create language-specific extractors

- `extractors/base.py` - Base extractor interface
- `extractors/python.py` - Python AST queries
- `extractors/javascript.py` - JS/TS AST queries

Each extractor uses tree-sitter queries to find:
- Classes (with bases/inheritance)
- Functions/methods (with parameters, return types)
- Properties/variables
- Imports

---

## Phase 3: Compact Format (LLM Context)

### 3.1 Format specification - Basic

```
file.py:
│c ClassName(Base1,Base2):10
│  m method_name(arg1,arg2)->str:15
│  p property_name:20
│f function_name(x)->int:50
│i module1,module2.thing
```

Key features:
- Single-letter kind prefixes: `c`lass, `m`ethod, `f`unction, `v`ariable, `i`mport, `p`roperty
- Line numbers at end (colon-separated)
- Return types when present (abbreviated)
- Inheritance/mixins on class line
- Imports summarized on one line
- Indentation shows hierarchy
- Target: ~30-50 tokens per file

### 3.2 Format specification - With References (Hybrid)

```
file.py:
│c ClassName(Base1,Base2):10
│  m method_name(arg1,arg2)->str:15 ←other.py:45,main.py:12
│  m internal_method():30
│f function_name(x)->int:50 ←test_file.py:20
│i module1,module2.thing
│←refs: other.py,main.py,test_file.py
```

Additional features for hybrid mode:
- `←file:line` after symbol = incoming references (callers/users)
- `←refs:` at end = summary of all files that reference this file
- Only show references for "important" symbols (public API, frequently used)
- Target: ~50-80 tokens per file with references

### 3.3 Implement `to_compact()` method

```python
class SymbolIndex:
    def to_compact(
        self, 
        files: List[str] = None,
        include_references: bool = False,
        reference_depth: int = 1,  # 0=none, 1=summary, 2=full
    ) -> str:
        """Generate compact format suitable for LLM context."""
        ...
```

### 3.4 Reference tracking

New file: `ac/symbol_index/references.py`

```python
class ReferenceIndex:
    """Tracks cross-file symbol references."""
    
    def __init__(self, symbol_index: SymbolIndex):
        self.symbol_index = symbol_index
        self._refs: Dict[str, Dict[str, List[Location]]] = {}  # file -> symbol -> [locations]
    
    def build_references(self, file_paths: List[str]):
        """Build reference index for all files."""
        # For each file, find all identifier usages
        # Match against known symbols from other files
        ...
    
    def get_references_to(self, file_path: str, symbol_name: str) -> List[Location]:
        """Get all locations that reference a symbol."""
        ...
    
    def get_files_referencing(self, file_path: str) -> Set[str]:
        """Get all files that reference symbols in this file."""
        ...
```

### 3.5 Integration with LiteLLM (NOT aider)

Update `ac/llm/llm.py` to use symbol map as primary context:

```python
class LiteLLM:
    def get_context_map(
        self,
        chat_files: List[str] = None,
        include_references: bool = True
    ) -> str:
        """Get repository context map for LLM.
        
        Uses tree-sitter symbol index (not aider's RepoMap).
        """
        indexer = self._get_indexer()
        
        # Get all trackable files
        all_files = self._get_trackable_files()
        
        # Exclude chat files (they're included verbatim)
        map_files = [f for f in all_files if f not in (chat_files or [])]
        
        return indexer.get_symbol_map(
            file_paths=map_files,
            include_references=include_references
        )
```

---

## Phase 4: LSP Format (Monaco)

### 4.1 Format specification

```javascript
{
  "ac/llm/llm.py": {
    "symbols": [
      {
        "name": "LiteLLM",
        "kind": "class",
        "range": { "start": {"line": 5, "col": 0}, "end": {"line": 120, "col": 0} },
        "selectionRange": { "start": {"line": 5, "col": 6}, "end": {"line": 5, "col": 13} },
        "bases": ["ConfigMixin", "FileContextMixin"],
        "docstring": "LiteLLM wrapper for AI completions...",
        "children": [
          {
            "name": "clear_history",
            "kind": "method",
            "range": { "start": {"line": 42, "col": 4}, "end": {"line": 48, "col": 0} },
            "parameters": [{"name": "self"}],
            "returnType": null
          }
        ]
      }
    ],
    "imports": [
      { "module": "litellm", "names": ["completion"], "line": 1 },
      { "module": "os", "names": null, "line": 2 }
    ],
    "references": [
      { "name": "LiteLLM", "usages": [[78, 12], [95, 8]] }
    ]
  }
}
```

### 4.2 Implement `to_lsp()` method

```python
class SymbolIndex:
    def to_lsp(self, file: str) -> dict:
        """Generate LSP-compatible format for Monaco."""
        ...
```

### 4.3 Create JSON-RPC endpoints

New methods exposed via JSON-RPC:

```python
class SymbolIndex:
    def get_hover(self, file: str, line: int, col: int) -> dict:
        """Get hover information at position."""
        
    def get_definition(self, file: str, line: int, col: int) -> dict:
        """Get definition location for symbol at position."""
        
    def get_references(self, file: str, line: int, col: int) -> List[dict]:
        """Get all references to symbol at position."""
        
    def get_document_symbols(self, file: str) -> List[dict]:
        """Get all symbols in a file (for outline view)."""
        
    def get_workspace_symbols(self, query: str) -> List[dict]:
        """Search symbols across workspace."""
        
    def get_completions(self, file: str, line: int, col: int, prefix: str) -> List[dict]:
        """Get completion suggestions at position."""
```

---

## Phase 5: Webapp Integration

### 5.1 Create Monaco provider bridge

New files:
- `webapp/src/lsp/SymbolProvider.js` - Registers Monaco language providers
- `webapp/src/lsp/LspBridge.js` - JSON-RPC to Monaco adapter

```javascript
// SymbolProvider.js
export function registerSymbolProviders(jrpcClient) {
  monaco.languages.registerHoverProvider('python', {
    async provideHover(model, position) {
      const result = await jrpcClient.call['SymbolIndex.get_hover'](
        model.uri.path,
        position.lineNumber,
        position.column
      );
      return result ? { contents: [{ value: result.contents }] } : null;
    }
  });
  
  monaco.languages.registerDefinitionProvider('python', {
    async provideDefinition(model, position) {
      const result = await jrpcClient.call['SymbolIndex.get_definition'](
        model.uri.path,
        position.lineNumber,
        position.column
      );
      return result ? {
        uri: monaco.Uri.file(result.file),
        range: new monaco.Range(
          result.range.start.line,
          result.range.start.col,
          result.range.end.line,
          result.range.end.col
        )
      } : null;
    }
  });
  
  // ... similar for references, completions, etc.
}
```

### 5.2 Integrate with DiffViewer/Editor

- Call `registerSymbolProviders()` when Monaco is ready
- Wire up hover, go-to-definition, autocomplete
- Add keyboard shortcuts (F12 for go-to-definition, etc.)

---

## Phase 6: Caching & Performance

### 6.1 File-level caching ✅ (Implemented)

```python
class SymbolCache:
    def __init__(self):
        self._cache: Dict[str, CacheEntry] = {}
    
    def get(self, file_path: str) -> Optional[List[Symbol]]:
        entry = self._cache.get(file_path)
        if entry and entry.mtime == os.path.getmtime(file_path):
            return entry.symbols
        return None
    
    def set(self, file_path: str, symbols: List[Symbol]):
        self._cache[file_path] = CacheEntry(
            symbols=symbols,
            mtime=os.path.getmtime(file_path)
        )
```

### 6.2 Reference caching

```python
class ReferenceCache:
    """Cache for cross-file references."""
    
    def __init__(self):
        self._refs: Dict[str, ReferenceEntry] = {}
        self._file_mtimes: Dict[str, float] = {}
    
    def is_valid(self, file_paths: List[str]) -> bool:
        """Check if cached references are still valid."""
        for path in file_paths:
            if self._file_mtimes.get(path) != os.path.getmtime(path):
                return False
        return True
    
    def invalidate_file(self, file_path: str):
        """Invalidate references involving this file."""
        # Remove refs TO this file
        # Remove refs FROM this file
        ...
```

### 6.3 Incremental updates

- Re-parse only changed files
- Invalidate reference cache when files change
- Background reference indexing (async)

---

## File Structure

```
ac/
├── indexer.py              # High-level Indexer class (no aider dependency)
└── symbol_index/
    ├── __init__.py
    ├── parser.py           # Tree-sitter wrapper
    ├── symbol_index.py     # Main SymbolIndex class
    ├── models.py           # Symbol, Range, Parameter, Location dataclasses
    ├── cache.py            # File-level caching
    ├── compact_format.py   # to_compact() implementation
    ├── lsp_format.py       # to_lsp() implementation
    ├── references.py       # Cross-file reference tracking (NEW)
    └── extractors/
        ├── __init__.py
        ├── base.py         # Base extractor interface
        ├── python.py       # Python extractor
        └── javascript.py   # JS/TS extractor

webapp/src/
└── lsp/
    ├── SymbolProvider.js   # Monaco provider registration
    └── LspBridge.js        # JSON-RPC to Monaco adapter
```

---

## Dependencies to Add

Add to `pyproject.toml` or `requirements.txt`:

```
tree-sitter>=0.21.0
tree-sitter-python>=0.21.0
tree-sitter-javascript>=0.21.0
tree-sitter-typescript>=0.21.0
```

---

## Implementation Order

| Step | Phase | Description | Status |
|------|-------|-------------|--------|
| 1 | 1.1 | Create module structure | ✅ Done |
| 2 | 1.2 | Tree-sitter setup + Python grammar | ✅ Done |
| 3 | 2.1 | Define data models (Symbol, Range, Parameter) | ✅ Done |
| 4 | 2.2 | Python extractor (classes, functions, methods, imports) | ✅ Done |
| 5 | 2.2+ | JavaScript/TypeScript extractors | ✅ Done |
| 6 | 3.1 | Basic compact format | ✅ Done |
| 7 | 6.1 | File-level caching (SymbolCache) | ✅ Done |
| 8 | 4.1-4.2 | LSP format implementation | ✅ Done |
| 9 | 3.4 | Reference tracking (ReferenceIndex, Location) | ✅ Done |
| 10 | 3.2 | Hybrid compact format with refs | ✅ Done |
| 11 | 3.5 | LiteLLM integration (get_context_map) | ✅ Done |
| 12 | 2.3 | Instance variables extraction | ✅ Done |
| 13 | 2.4 | Function call extraction | ✅ Done |
| 14 | 4.3 | JSON-RPC endpoints for Monaco | ✅ Done |
| 15 | 5.1 | Monaco provider bridge (SymbolProvider.js) | ✅ Done |
| 16 | 5.2 | DiffViewer integration | ✅ Done |

**Completed: 100%**
**Full implementation complete. Testing and refinement may be needed.**

---

## Current Architecture

```
ac/
├── indexer.py                    # High-level Indexer class (facade)
│   └── Methods: save_symbol_map, get_symbol_map, index_file, index_files,
│                get_document_symbols, get_lsp_data, save_symbol_map_with_refs,
│                build_references, get_references_to_symbol, get_files_referencing
│
└── symbol_index/
    ├── __init__.py               # Exports: SymbolIndex, Symbol, Range, Parameter, etc.
    ├── parser.py                 # TreeSitterParser (Python, JS, TS support)
    ├── models.py                 # Symbol, Range, Parameter dataclasses
    ├── symbol_index.py           # Main SymbolIndex class
    ├── cache.py                  # SymbolCache (file mtime-based)
    ├── compact_format.py         # to_compact() - LLM context format
    ├── lsp_format.py             # to_lsp(), get_document_symbols()
    ├── references.py             # ReferenceIndex, Location, Reference
    └── extractors/
        ├── __init__.py           # get_extractor() factory
        ├── base.py               # BaseExtractor ABC
        ├── python.py             # PythonExtractor (instance_vars, calls)
        └── javascript.py         # JavaScriptExtractor (instance_vars, calls)

ac/llm/llm.py integration:
├── _get_indexer()                # Lazy Indexer instantiation
├── save_symbol_map()             # Save compact format to file
├── get_symbol_map()              # Get compact format string
├── get_document_symbols()        # LSP document symbols
├── get_lsp_symbols()             # Full LSP format
├── save_symbol_map_with_refs()   # Compact format with references
├── get_context_map()             # Main API for LLM context (replaces aider RepoMap)
├── get_references_to_symbol()    # Find symbol usages
└── get_files_referencing()       # Find files that reference a file
```

---

## Success Metrics

1. **Token count**: Compact format should use ≤ 120% tokens of current repo map
2. **Coverage**: Extract 95%+ of classes, functions, methods in Python files
3. **Latency**: Hover/definition responses < 100ms (cached), < 500ms (cold parse)
4. **Accuracy**: Go-to-definition works correctly for 90%+ of symbols
5. **Independence**: Can fully replace aider's RepoMap without regression

---

## Aider Removal Plan

Once symbol index with references is complete:

1. **Phase A**: Add feature flag to choose between aider RepoMap and symbol index ✅ Done
2. **Phase B**: Default to symbol index, keep aider as fallback ✅ Done
3. **Phase C**: Remove aider RepoMap dependency entirely 🔲 Planned
4. **Phase D**: Remove unused aider_integration modules 🔲 Planned

Dependencies to eventually remove:
- `AiderContextManager.repo_map` (RepoMap instance)
- `AiderContextManager.get_repo_map()` method
- `AiderContextManager.save_repo_map()` method

Keep (still useful from aider):
- Edit parsing/applying (search/replace blocks)
- Git integration helpers

---

## Next Steps: Monaco Integration

### 4.3 JSON-RPC Endpoints (Priority)

Expose these methods via JSON-RPC server:

```python
# In ac/llm/llm.py or new ac/lsp_server.py
class LspMixin:
    def lsp_get_hover(self, file: str, line: int, col: int) -> dict:
        """Get hover information at position."""
        
    def lsp_get_definition(self, file: str, line: int, col: int) -> dict:
        """Get definition location for symbol at position."""
        
    def lsp_get_references(self, file: str, line: int, col: int) -> list:
        """Get all references to symbol at position."""
        
    def lsp_get_document_symbols(self, file: str) -> list:
        """Get all symbols in a file (for outline view)."""
        
    def lsp_get_completions(self, file: str, line: int, col: int, prefix: str) -> list:
        """Get completion suggestions at position."""
```

### 5.1 Monaco Provider Bridge

Create `webapp/src/lsp/SymbolProvider.js`:
- Register hover provider
- Register definition provider  
- Register references provider
- Register document symbol provider
- Wire up to JSON-RPC client

### 5.2 DiffViewer Integration

Update `webapp/src/diff-viewer/DiffViewer.js`:
- Call `registerSymbolProviders()` when Monaco ready
- Add F12 keyboard shortcut for go-to-definition
- Show hover tooltips with docstrings

---

## Future Enhancements

- Additional language support (Rust, Go, Java, etc.)
- Semantic highlighting data
- Call hierarchy (who calls this function?)
- Type inference for untyped code
- Rename refactoring support
- Code actions (quick fixes)
