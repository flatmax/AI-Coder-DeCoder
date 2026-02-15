# Symbol Index

## Overview

A tree-sitter based code analysis engine that extracts symbols (classes, functions, variables, imports) from source files. It produces two outputs:
1. **Compact text format** — for LLM context (the "repository map" / "symbol map")
2. **LSP-compatible queries** — for editor features (hover, go-to-definition, completions)

It also builds a cross-file reference graph used for cache tier initialization and navigation.

## Architecture

```
SymbolIndex (orchestrator)
    ├── TreeSitterParser (singleton, multi-language)
    │   └── Language Extractors (per-language subclasses)
    │         ├── PythonExtractor
    │         ├── JavaScriptExtractor (also TypeScript)
    │         └── CExtractor (also C++)
    ├── SymbolCache (mtime-based per-file cache)
    ├── ImportResolver (maps imports to repo file paths)
    ├── ReferenceIndex (cross-file reference tracking)
    └── CompactFormatter (LLM-optimized text output)
```

## Data Model

### Symbol

```pseudo
Symbol:
    name: string
    kind: "class" | "function" | "method" | "variable" | "import" | "property"
    file_path: string
    range: {start_line, start_col, end_line, end_col}
    parameters: Parameter[]
    return_type: string?
    bases: string[]
    children: Symbol[]
    is_async: boolean
    call_sites: CallSite[]
    instance_vars: string[]
```

### CallSite

```pseudo
CallSite:
    name: string
    line: integer
    is_conditional: boolean
    target_symbol: string?
    target_file: string?
```

### Import

```pseudo
Import:
    module: string
    names: string[]
    alias: string?
    level: integer         // 0 = absolute, 1+ = relative
```

### FileSymbols

```pseudo
FileSymbols:
    file_path: string
    symbols: Symbol[]       // Top-level symbols
    imports: Import[]
    all_symbols_flat: list[Symbol]  // Property: flattened including nested children
```

## Supported Languages

| Language | Extensions |
|----------|-----------|
| Python | `.py` |
| JavaScript | `.js`, `.mjs`, `.jsx` |
| TypeScript | `.ts`, `.tsx` |
| C/C++ | `.c`, `.cpp`, `.cc`, `.cxx`, `.h`, `.hpp`, `.hxx` |

### Grammar Acquisition

Tree-sitter grammars via individual `tree-sitter-{language}` pip packages. The parser tries three strategies in order:
1. `tree-sitter-languages` global — smoke test
2. `tree-sitter-languages` per-language — lazy calls
3. Plain tree-sitter + individual packages — with parser API auto-detection

### Adding a New Language

1. Install the `tree-sitter-{language}` package
2. Create an extractor subclass defining node type sets and extraction methods
3. Add entry to `LANGUAGE_MAP` in `parser.py`
4. Register the extractor in `extractors/__init__.py`

### Per-Language Extractors

Each extractor subclass overrides the base to handle language-specific AST structures:

| Concern | Approach |
|---------|----------|
| Method vs function | Check if parent context is a class body |
| Async detection | Check for `async` child node or text prefix |
| Parameters | Walk parameter node children for defaults, types, `*args`/`**kwargs` |
| Instance variables | Match `self.x = ...` inside `__init__` (Python) |
| Properties | `@property` (Python), getter/setter keywords (JS) |
| Inheritance | Parse superclass/heritage nodes |

## Import Resolution

### Python
- Absolute: `import foo.bar` → `foo/bar.py` or `foo/bar/__init__.py`
- Relative: `from .models import X` → sibling file
- Level-aware: `from .. import X` resolves up N directories

### JavaScript/TypeScript
- Relative: `'./utils/rpc'` → direct resolution with extension probing
- Index files: `'./utils'` → `utils/index.{js,ts}`

### C/C++
- `#include "header.h"` → search in repo

## Reference Index

Tracks where symbols are used across files by scanning all identifier nodes and matching against known symbol names (excluding builtins/keywords).

### Queries

| Query | Returns |
|-------|---------|
| `references_to_symbol(name)` | All locations where used |
| `files_referencing(file)` | Set of dependent files |
| `file_dependencies(file)` | Set of files this file depends on |
| `file_ref_count(file)` | Incoming reference count |
| `bidirectional_edges()` | Mutually-dependent file pairs |
| `connected_components()` | Clusters of coupled files |

### Builtin Exclusion

Common identifiers excluded: `self`, `cls`, `None`, `True`, `False`, `print`, `len`, `str`, `int`, `this`, `super`, `new`, `function`, `const`, `let`, `var`, etc.

## Compact Format (Symbol Map)

Human-readable, token-efficient text format for the "repository map" sent to the LLM.

### Legend

```
# c=class m=method f=function af=async func am=async method
# v=var p=property i=import i→=local
# :N=line(s) ->T=returns ?=optional ←N=refs →=calls
# +N=more ″=ditto Nc/Nm=test summary
# @1/=some/frequent/path/ @2/=another/path/
```

### Syntax

| Element | Example |
|---------|---------|
| File header | `path/to/file.py: ←5` (←N = incoming refs) |
| External imports | `i json,os,typing` |
| Local imports | `i→ other/module.py,another.py` |
| Class | `c MyClass(Base):10` |
| Method | `m fetch(url,timeout?)->Response:10` |
| Variable | `v CONFIG:15 ←3` |
| Nesting | Two-space indent = child |
| References | `←file:line` or `←N` (count) |
| Calls | `→process,validate` |
| Ditto | `″` = same references as line above |
| Path aliases | `@1/file.py` = aliased prefix |
| Test files | `# 5c/25m fixtures:setup_db` (collapsed) |

### Example

```
app/models.py: ←8
i dataclasses,typing
c User:10 ←@1/auth.py:5,@1/api.py:20,+2
  v name
  v email
  m __init__(name,email):15
  m validate()->bool:20 →_check_email
c Session:40 ←@1/auth.py:8
  m is_valid()->bool:55

@1/auth.py: ←3
i→ app/models.py
f authenticate(username,password)->?Session:10 →User.validate

tests/test_auth.py:
# 3c/12m fixtures:mock_store,test_user
```

### Key Properties

- **Path aliases** — frequent prefixes get short aliases, computed from reference frequency
- **Ditto marks** — `″` replaces repeated reference lists
- **Test collapsing** — test files show only summary counts
- **Stable ordering** — files maintain position across regenerations for cache stability
- **Inherited methods** — only in the parent class; consumers check bases

### Chunked Output

The symbol map can be split into chunks for cache tier distribution.

### Per-File Blocks

Individual file symbol blocks can be generated independently. A stable hash of a file's symbol signatures enables change detection for the stability tracker.

## Indexing Pipeline

### Per-File
1. Check cache — skip if mtime unchanged
2. Parse — tree-sitter produces AST
3. Extract — language-specific extractor walks AST, collects symbols
4. Post-process — method detection, parameters, async, instance vars
5. Resolve imports — map import statements to repo file paths
6. Store in cache

### Multi-File
1. Index each file (cache-aware)
2. Resolve cross-file call targets
3. Build reference index

## LSP Queries

| RPC Method | Description |
|------------|-------------|
| `LLM.lsp_get_hover(path, line, col)` | Symbol signature, parameters, return type |
| `LLM.lsp_get_definition(path, line, col)` | `{file, range}` via call site or import resolution |
| `LLM.lsp_get_references(path, line, col)` | `[{file, range}]` from reference index |
| `LLM.lsp_get_completions(path, line, col)` | `[{label, kind, detail}]` filtered by prefix |

### Symbol at Position

Binary search through sorted symbols by line/column range. For nested symbols, return the deepest match. If the cursor is on a call site within a function body, match against the function's `call_sites` list.

### Definition Resolution

1. If cursor is on a **call site**: use `CallSite.target_file` and `target_symbol` to locate definition
2. If cursor is on an **import name**: use import resolver to find source file, then locate named symbol
3. If cursor is on a **local symbol**: return its own definition range

### Completion Scope

1. File-local symbols
2. Imported symbols
3. Class members (if inside a class body)
4. Star imports

## Caching

- **Symbol cache** — in-memory, per-file, mtime-based invalidation
- **Symbol map persistence** — saved to `{repo_root}/.ac-dc/symbol_map.txt`, rebuilt on startup and before each LLM request
- **Import resolution cache** — cleared when new files are detected

## Testing

### Python Extractor
- Classes extracted with inheritance (bases list)
- Methods extracted as children of class; property detected via @property
- Async methods detected; parameters extracted (self omitted); return types captured
- Instance variables from self.x assignments in __init__
- Imports: absolute and relative with level; names list
- Top-level variables (private excluded), functions, and call sites

### JavaScript Extractor
- Class with inheritance (extends); methods including getter (property kind)
- Async method detected; top-level function and const variable
- Imports from multiple modules

### C Extractor
- Struct extracted as class; functions with parameters
- #include extracted as imports

### Symbol Cache
- Put/get by path and mtime; stale mtime returns None
- Invalidate removes entry
- Content hash: deterministic and distinct
- cached_files returns set of stored paths

### Import Resolver
- Python: absolute, package (__init__.py), relative (level 1 and 2), not-found returns None
- JavaScript: relative path, index file resolution, external module returns None
- C: #include header file resolution

### Reference Index
- Build from FileSymbols with call sites; query references to symbol
- Bidirectional edges detected; connected components grouped
- file_ref_count returns incoming reference count

### Compact Formatter
- Output includes file path, class/method/function with line numbers
- Legend header present; imports formatted; instance variables listed
- exclude_files omits specified files; test files collapsed to summary (Nc/Nm)
- Chunks split evenly with correct total file count
- Async prefix (af/am); path aliases generated for repeated prefixes

### Integration
- Index repo extracts symbols from multiple files
- Symbol map output contains expected class/function names
- Exclude active files from symbol map
- Single file reindex after modification picks up new symbols
- Hover info returns symbol name; completions filtered by prefix
- Signature hash: stable across repeated calls, 16-char length