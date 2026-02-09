# Symbol Index

## Overview

A tree-sitter based code analysis engine that extracts symbols (classes, functions, variables, imports) from source files and generates two output formats: a compact text format for LLM context, and an LSP-compatible format for the Monaco editor. It includes cross-file reference tracking, import resolution, and prefix-cache-optimized output ordering.

## Architecture

```
                    SymbolIndex
                   /     |      \
          TreeSitterParser  SymbolCache  ImportResolver
               |                              |
          Extractors                   resolve imports
         /    |    \                   to file paths
     Python  JS   C++
               |
          Symbol models
              |
     ┌────────┼────────┐
     v        v        v
CompactFormat  LSP     ReferenceIndex
 (for LLM)  (Monaco)  (cross-file refs)
```

### Components

| File | Role |
|------|------|
| `ac/symbol_index/symbol_index.py` | Main orchestrator — indexing, caching, output generation |
| `ac/symbol_index/models.py` | Data models: `Symbol`, `Import`, `CallSite`, `Range`, `Parameter` |
| `ac/symbol_index/parser.py` | Tree-sitter parser management (singleton, multi-language) |
| `ac/symbol_index/extractors/base.py` | `BaseExtractor` ABC — shared logic for all languages |
| `ac/symbol_index/extractors/python.py` | Python symbol extraction |
| `ac/symbol_index/extractors/javascript.py` | JavaScript/TypeScript extraction |
| `ac/symbol_index/extractors/cpp.py` | C/C++ extraction |
| `ac/symbol_index/extractors/__init__.py` | `get_extractor(language)` factory |
| `ac/symbol_index/compact_format.py` | LLM-optimized text format with reference annotations |
| `ac/symbol_index/lsp_format.py` | Monaco/LSP-compatible JSON format |
| `ac/symbol_index/references.py` | Cross-file reference index (who references what) |
| `ac/symbol_index/import_resolver.py` | Resolves Python/JS imports to repo file paths |
| `ac/symbol_index/cache.py` | mtime-based per-file symbol cache |
| `ac/symbol_index/extensions.py` | Supported file extensions and language mapping |

## Data Models

### Symbol

The core unit. Represents a class, function, method, variable, import, or property.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `str` | Symbol name |
| `kind` | `str` | One of: `class`, `function`, `method`, `variable`, `import`, `property` |
| `file_path` | `str` | Relative file path |
| `range` | `Range` | Start/end line and column |
| `parameters` | `list[Parameter]` | Function/method parameters |
| `return_type` | `str?` | Return type annotation |
| `bases` | `list[str]` | Base classes (for classes) |
| `children` | `list[Symbol]` | Nested symbols (methods in a class) |
| `docstring` | `str?` | Extracted docstring |
| `is_async` | `bool` | Whether async function/method |
| `calls` | `list[str]` | Simple call names (legacy) |
| `call_sites` | `list[CallSite]` | Rich call info with resolved targets |
| `instance_vars` | `list[str]` | Instance variables (for classes) |

### CallSite

Represents a function/method call with resolution info.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `str` | Called function name |
| `line` | `int` | Line number of call |
| `is_conditional` | `bool` | Called inside if/try/except |
| `target_symbol` | `str?` | Dotted path resolved from imports (e.g. `ac.repo.file_operations.write_file`) |
| `target_file` | `str?` | Resolved target file path |

### Import

| Field | Type | Description |
|-------|------|-------------|
| `module` | `str` | Module path |
| `names` | `list[str]` | Imported names |
| `alias` | `str?` | Import alias |
| `level` | `int` | Relative import level (0 = absolute) |

## Supported Languages

| Language | Extensions | Extractor |
|----------|-----------|-----------|
| Python | `.py` | `PythonExtractor` |
| JavaScript | `.js`, `.mjs`, `.jsx` | `JavaScriptExtractor` |
| TypeScript | `.ts`, `.tsx` | `JavaScriptExtractor` |
| C/C++ | `.c`, `.cpp`, `.cc`, `.cxx`, `.h`, `.hpp`, `.hxx` | `CppExtractor` |

## Indexing Pipeline

### Single File

1. **Parse**: Tree-sitter parses source into AST
2. **Extract**: Language-specific extractor walks AST, produces `Symbol` list
3. **Resolve imports**: `ImportResolver` maps import statements to repo file paths
4. **Cache**: Symbols cached by file path with mtime validation

### Multi-File

1. Index each file (cache-aware — skips unchanged files)
2. Resolve cross-file call targets: `CallSite.target_symbol` → `CallSite.target_file`
3. Optionally build reference index for incoming references

## Caching

### Symbol Cache (`SymbolCache`)

- Per-file mtime-based invalidation
- Stored in memory (not persisted to disk)
- `get(file_path)` returns `None` if file modified since last index
- `invalidate(file_path)` clears a single file
- `clear()` resets all cached data

### Import Resolution Cache

- `ImportResolver` caches module-to-file mappings
- `clear_cache()` resets when repo structure changes

## Reference Index

`ReferenceIndex` tracks where symbols are used across files.

### Build Process

1. Collect all known symbols from indexed files
2. For each file, parse and find all identifier nodes
3. Match identifiers against known symbol names (excluding self-references)
4. Record `Location(file_path, line, col)` for each match

### Queries

| Method | Returns | Description |
|--------|---------|-------------|
| `get_references_to_symbol(file, name)` | `list[Location]` | All locations referencing a symbol |
| `get_references_to_file(file)` | `dict[name, list[Location]]` | All refs to symbols in a file |
| `get_files_referencing(file)` | `set[str]` | Files that reference this file |
| `get_file_dependencies(file)` | `set[str]` | Files this file depends on |
| `get_bidirectional_edges()` | `set[tuple]` | Pairs of mutually dependent files |

### Filtering

Common builtins and keywords are excluded from matching: `self`, `cls`, `None`, `True`, `False`, `print`, `len`, `str`, `int`, `float`, `list`, `dict`, `set`, `return`, `if`, `else`, `for`, `while`, `try`, `except`, `import`, `from`, `class`, `def`, `async`, `await`, `this`, `super`, `new`, `function`, `const`, `let`, `var`.

## Import Resolution

`ImportResolver` maps import statements to actual files in the repo.

### Python Imports

- Absolute: `import ac.config` → `ac/config.py`
- Relative: `from .models import Symbol` → sibling `models.py`
- Handles `__init__.py` packages
- Level-aware: `from .. import foo` resolves up N directories

### JavaScript/TypeScript Imports

- Relative paths: `'./utils/rpc.js'` → direct path resolution
- Index files: `'./utils'` → `utils/index.js` or `utils/index.ts`
- Extension probing: tries `.js`, `.ts`, `.jsx`, `.tsx`, `.mjs`

## Output Formats

### Compact Format (for LLM Context)

Human-readable text optimized for LLM prefix caching. Used as the "repository map" in system prompts.

#### Legend

```
# c=class m=method f=function af=async func am=async method v=var p=property i=import i→=local
# :N=line(s) ->T=returns ?=optional ←N=refs →=calls +N=more ″=ditto Nc/Nm=test summary
# @1/=ac/llm/ @2/=webapp/src/
```

#### Example

```
ac/repo/file_operations.py: ←3
i os
c FileOperationsMixin:4 ←ac/repo/repo.py:7
  m get_file_content(file_path,version)->str:7 →ac/history/history_store.py:append
  m write_file(file_path,content):50
  m rename_file(old_path,new_path):65
←refs: ac/repo/repo.py,@1/llm.py,@1/streaming.py
```

#### Features

- **Path aliases**: Frequent directory prefixes get short aliases (`@1/`, `@2/`, etc.) computed automatically from reference frequency
- **Reference annotations**: `←file:line` shows where a symbol is referenced from
- **Cross-file calls**: `→file:function` shows what a function calls in other files
- **Ditto marks**: `″` replaces repeated reference lists
- **Test file collapsing**: Test files show only imports and summary counts (`# 5c/25m`)
- **File weight**: `←N` after file path shows number of files referencing it
- **File-level refs**: `←refs:` line lists files that reference this file

#### Stable File Ordering

Files maintain their position across regenerations to optimize LLM prefix caching:
- Files keep their order from previous session
- New files are appended at the bottom
- Removed files are filtered out
- Ensures cached prefix stays stable even when new files enter context

#### Chunked Output

`to_compact_chunked` splits the symbol map into chunks for APIs with cache block limits (e.g. Bedrock's 4-block limit):

| Mode | Behaviour |
|------|-----------|
| `num_chunks=N` | Splits into exactly N chunks, extras in later chunks |
| `min_chunk_tokens=N` | Token-threshold splitting (default 1024 for Anthropic) |
| `return_metadata=True` | Returns dicts with `content`, `files`, `tokens`, `cached` |

#### Per-File Blocks

`format_file_symbol_block` generates a single file's symbol block independently, used by the stability tracker to detect when a file's symbols have changed.

`compute_file_block_hash` produces a stable SHA256 hash of a file's symbol signatures for change detection.

### LSP Format (for Monaco)

JSON structure compatible with Monaco editor APIs.

| Function | Returns | Used by |
|----------|---------|---------|
| `to_lsp(symbols_by_file)` | Full LSP-compatible dict | Monaco document outline |
| `get_document_symbols(symbols)` | List of DocumentSymbol dicts | Document symbol provider |

## Integration Points

### LLM Context (via `ContextBuilderMixin`)

The symbol map is split across cache tiers (L0–L3) based on file stability:
- Stable files go in lower tiers (L0/L1) for better prefix caching
- Volatile files go in higher tiers (L2/L3)
- Files with full content in active context are excluded from the map

### LSP Features (via `SymbolProvider.js`)

Monaco providers call back to the Python server via JSON-RPC:

| Feature | RPC Method | Server Implementation |
|---------|------------|----------------------|
| Hover | `LiteLLM.lsp_get_hover` | `lsp_helpers.get_hover_info` |
| Definition | `LiteLLM.lsp_get_definition` | `lsp_helpers.find_symbol_definition` |
| References | `LiteLLM.lsp_get_references` | `references.get_references_to_symbol` |
| Completions | `LiteLLM.lsp_get_completions` | `lsp_helpers.get_completions` |

### Auto-Save

`LiteLLM._auto_save_symbol_map()` regenerates the symbol map at the start of each streaming request if the model supports prefix caching.
