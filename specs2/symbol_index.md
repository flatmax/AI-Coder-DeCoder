# Symbol Index

## Overview

A tree-sitter based code analysis engine that extracts symbols (classes, functions, variables, imports) from source files. It produces two outputs:
1. **Compact text format** — for LLM context (the "repository map")
2. **LSP-compatible format** — for editor features (hover, go-to-definition, completions)

It also builds a cross-file reference graph used for cache tier initialization and navigation.

## Architecture

```
SymbolIndex (orchestrator)
    │
    ├── TreeSitterParser (singleton, multi-language)
    │       │
    │       └── Language Extractors (one per language)
    │             ├── Python
    │             ├── JavaScript/TypeScript
    │             └── C/C++
    │
    ├── SymbolCache (mtime-based per-file cache)
    │
    ├── ImportResolver (maps imports to repo file paths)
    │
    ├── ReferenceIndex (cross-file reference tracking)
    │
    └── Output Formatters
          ├── CompactFormat (LLM-optimized text)
          └── LSPFormat (editor JSON)
```

## Data Model

### Symbol

The core unit representing any code construct:

```pseudo
Symbol:
    name: string
    kind: "class" | "function" | "method" | "variable" | "import" | "property"
    file_path: string            // Relative to repo root
    range: {start_line, start_col, end_line, end_col}
    parameters: Parameter[]      // For functions/methods
    return_type: string?         // Type annotation
    bases: string[]              // Base classes
    children: Symbol[]           // Nested symbols (methods in a class)
    is_async: boolean
    call_sites: CallSite[]       // Calls to other functions with resolution info
    instance_vars: string[]      // For classes
```

### CallSite

A resolved function/method call:

```pseudo
CallSite:
    name: string             // Called function name
    line: integer
    is_conditional: boolean  // Inside if/try/except
    target_symbol: string?   // Dotted path (e.g., "repo.file_ops.write_file")
    target_file: string?     // Resolved target file path
```

### Import

```pseudo
Import:
    module: string         // Module path
    names: string[]        // Imported names
    alias: string?
    level: integer         // 0 = absolute, 1+ = relative
```

## Supported Languages

| Language | Extensions |
|----------|-----------|
| Python | `.py` |
| JavaScript | `.js`, `.mjs`, `.jsx` |
| TypeScript | `.ts`, `.tsx` |
| C/C++ | `.c`, `.cpp`, `.cc`, `.cxx`, `.h`, `.hpp`, `.hxx` |

### Grammar Acquisition

Tree-sitter grammars are obtained via individual `tree-sitter-{language}` pip packages (`tree-sitter-python`, `tree-sitter-javascript`, `tree-sitter-typescript`, `tree-sitter-c`, `tree-sitter-cpp`). Each provides a pre-compiled grammar as a Python extension module with a `language()` function. The parser also supports the legacy `tree-sitter-languages` bundle as a fallback for environments that use it.

The parser initialization tries three strategies in order:
1. **tree-sitter-languages global** — `get_parser("python")` smoke test
2. **tree-sitter-languages per-language** — lazy per-language `get_parser()` calls
3. **Plain tree-sitter + individual packages** — `tree_sitter_python.language()` etc., with parser API auto-detection (constructor vs `set_language`)

### Symbol Extraction Strategy

Symbol extraction uses **per-language AST walkers** built on tree-sitter's node API. Each language has a dedicated extractor class that walks the AST, matching node types to extract classes, functions, methods, variables, imports, and call sites.

#### Architecture

```
Base Extractor (generic AST walking)
    │
    ├── Per-language extractors (subclasses)
    │     ├── PythonExtractor
    │     ├── JavaScriptExtractor (also used for TypeScript)
    │     └── CExtractor (also used for C++)
    │
    └── Each extractor defines:
          ├── Node type sets (CLASS_NODE_TYPES, FUNCTION_NODE_TYPES, etc.)
          ├── Symbol extraction methods (_extract_class, _extract_function, etc.)
          ├── Parameter extraction
          ├── Return type extraction
          ├── Import parsing
          └── Call site collection
```

#### Per-Language Extractors

Each extractor subclass overrides the base to handle language-specific AST structures:

| Concern | Approach |
|---------|----------|
| Method vs function | Check if parent context is a class body |
| Async detection | Check for `async` child node or text prefix |
| Parameter details | Walk parameter node children for defaults, `*args`/`**kwargs`, type annotations |
| Instance variables | Match `self.x = ...` inside `__init__` (Python) |
| Import resolution | Language-specific parsing of import syntax |
| Properties | Decorator-based (`@property` in Python), getter/setter keywords (JS) |
| Inheritance | Parse superclass/heritage nodes |

#### Adding a New Language

1. Install the `tree-sitter-{language}` package
2. Create an extractor subclass defining node type sets and extraction methods
3. Add an entry to the language → extensions mapping in `LANGUAGE_MAP`
4. Register the extractor in `extractors/__init__.py`

## Indexing Pipeline

### Per-File

1. **Check cache** — skip if file mtime unchanged since last index
2. **Parse** — tree-sitter produces AST
3. **Run queries** — execute language-specific `.scm` queries against AST, collect captures
4. **Map captures** — convert captured nodes to Symbol objects using capture name → kind mapping
5. **Post-process** — apply per-language refinements (method detection, parameters, async, instance vars)
6. **Resolve imports** — map import statements to repo file paths
7. **Store in cache** — keyed by file path

### Multi-File

1. Index each file (cache-aware)
2. Resolve cross-file call targets: `CallSite.target_symbol` → `CallSite.target_file`
3. Optionally build reference index

## Import Resolution

### Python

- Absolute: `import foo.bar` → `foo/bar.py` or `foo/bar/__init__.py`
- Relative: `from .models import X` → sibling file
- Level-aware: `from .. import X` resolves up N directories

### JavaScript/TypeScript

- Relative paths: `'./utils/rpc'` → direct resolution
- Index files: `'./utils'` → `utils/index.{js,ts}`
- Extension probing: tries multiple extensions

## Reference Index

Tracks where symbols are used across files. Built by scanning all identifier nodes in parsed files and matching them against known symbol names (excluding self-references and common builtins/keywords).

### Queries

| Query | Returns |
|-------|---------|
| References to a symbol | All locations where it's used |
| References to a file | All external references to symbols defined in it |
| Files referencing a file | Set of dependent files |
| File dependencies | Set of files this file depends on |
| Bidirectional edges | Pairs of mutually dependent files |

### Builtin/Keyword Exclusion

Common identifiers that would produce noise are excluded: `self`, `cls`, `None`, `True`, `False`, `print`, `len`, `str`, `int`, `return`, `if`, `for`, `this`, `super`, `new`, `function`, `const`, `let`, `var`, etc.

## Compact Format (LLM Output)

Human-readable, token-efficient text format for repository maps. This is the "symbol map" referenced throughout the system — it gives the LLM a structural overview of the codebase without full file contents.

### Legend

Generated once at the top of the symbol map:

```
# c=class m=method f=function af=async func am=async method
# v=var p=property i=import i→=local
# :N=line(s) ->T=returns ?=optional ←N=refs →=calls
# +N=more ″=ditto Nc/Nm=test summary
# @1/=some/frequent/path/ @2/=another/path/
```

### Syntax Reference

#### File Header

```
path/to/file.py: ←5
```

Relative path from repo root, colon, then `←N` showing how many other files reference this one (higher = more central).

#### Imports

```
i json,os,typing                    # stdlib/external imports
i→ other/module.py,another.py      # local (in-repo) imports — dependency edges
```

#### Symbol Lines

General form: `<prefix> <name>(<params>)-><return_type>:<line> <annotations>`

| Prefix | Kind |
|--------|------|
| `c` | class |
| `m` | method |
| `f` | function |
| `af` | async function |
| `am` | async method |
| `v` | variable/constant |
| `p` | property |

Parameters: shown in parentheses, `self`/`this` omitted for methods. Optional params use `?`:

```
m fetch(url,timeout?)->Response:10
```

Return types after `->`. Optional returns use `?`:

```
f parse(text)->?Result:30
```

#### Nesting via Indentation

Two-space indent = child of the symbol above:

```
c MyClass:10
  v class_var
  m __init__(name):15
  m process(data):25
```

#### Inheritance

Base classes in parentheses after class name:

```
c ChildClass(ParentA,ParentB):10
```

#### Annotations

| Annotation | Meaning | Example |
|------------|---------|---------|
| `←N` | Referenced by N locations (count) | `←5` |
| `←file:line` | Referenced at specific location | `←consumer.py:20` |
| `+N` | N more references not shown | `+3` |
| `→name` | Calls this function/method | `→process,validate` |
| `″` | Ditto — same references as line above | `←″` |

#### Path Aliases

Frequent directory prefixes are aliased to save tokens:

```
# @1/=some/very/long/path/to/module/
@1/file.py: ←3
i→ @2/helper.py
```

Aliases are computed from reference frequency — most-referenced prefixes get the shortest aliases.

#### Test File Collapsing

Test files are collapsed to a summary:

```
tests/test_parser.py:
# 5c/25m fixtures:setup_db,temp_dir
```

Meaning: 5 classes, 25 methods, with named fixtures. Full symbol detail omitted.

### Complete Example

```
# c=class m=method f=function af=async func am=async method v=var p=property i=import i→=local
# :N=line(s) ->T=returns ?=optional ←N=refs →=calls +N=more ″=ditto Nc/Nm=test summary
# @1/=app/services/

app/models.py: ←8
i dataclasses,typing
c User:10 ←@1/auth.py:5,@1/api.py:20,app/cli.py:3,+2
  v name
  v email
  m __init__(name,email):15
  m validate()->bool:20 →_check_email ←@1/auth.py:45
  m _check_email()->bool:30
c Session:40 ←@1/auth.py:8,@1/api.py:25
  v user
  v token
  v expires_at
  m __init__(user,token,ttl):45
  m is_valid()->bool:55 ←@1/auth.py:60,@1/api.py:30
  p expired:62

@1/auth.py: ←3
i hashlib,datetime
i→ app/models.py,@1/token_store.py
f authenticate(username,password)->?Session:10 →User.validate,create_session ←app/cli.py:15,@1/api.py:50
f create_session(user)->Session:30 →TokenStore.save ←″
c TokenStore:50 ←@1/auth.py:30
  v _store
  m __init__():55
  m save(token,session):60
  m get(token)->?Session:70

@1/api.py: ←2
i flask
i→ app/models.py,@1/auth.py
af handle_login(request)->Response:10 →authenticate
af get_profile(request)->Response:25 →Session.is_valid

tests/test_auth.py:
# 3c/12m fixtures:mock_store,test_user
```

### Key Properties

- **Path aliases** — Frequent directory prefixes get short aliases (`@1/`, `@2/`), computed from reference frequency
- **Reference annotations** — `←file:line` shows incoming references with location
- **Cross-file calls** — `→file:function` shows outgoing calls
- **Ditto marks** — `″` replaces repeated reference lists to save tokens
- **Test file collapsing** — Test files show only imports and summary counts
- **File weight** — `←N` on file headers shows how central the file is
- **Stable ordering** — Files maintain position across regenerations for cache stability
- **Inherited methods** — only appear in the parent class definition; consumers must check bases

### File Tree Format

The file tree (used in the prompt) is a **flat sorted list**, not an indented tree:

```
# File Tree (236 files)

.gitignore
README.md
src/main.py
src/utils/helpers.py
tests/test_main.py
```

One file per line, sorted alphabetically. Generated by flattening the nested tree structure from `get_file_tree()`. Line counts are not included by default.

### Chunked Output

The symbol map can be split into chunks for cache tier distribution:

| Mode | Behavior |
|------|----------|
| By count | Split into exactly N chunks |
| By token threshold | Split when accumulated tokens exceed threshold |
| With metadata | Return chunk info (content, files, tokens, cached status) |

### Per-File Block

Individual file symbol blocks can be generated independently, used by the stability tracker to detect when a file's symbols have changed. A stable hash of a file's symbol signatures enables change detection.

## LSP Format (Editor Output)

JSON structure compatible with editor APIs for:
- Document outline / symbol tree
- Hover information
- Go-to-definition
- Find references
- Completions

### LSP Query Interface

RPC methods bridge the diff viewer editor to the symbol index. All take a file path, line, and column as primary input.

| RPC Method | Query Logic | Returns |
|------------|------------|---------|
| `LLM.lsp_get_hover` | Find symbol at position → format signature, parameters, return type, docstring | Markdown string (empty if no symbol found) |
| `LLM.lsp_get_definition` | Find symbol at position → if call site, resolve via `target_file`/`target_symbol`; if import, resolve via import resolver | `{file, range}` or null |
| `LLM.lsp_get_references` | Find symbol at position → query reference index for all usage sites across files | `[{file, range}]` |
| `LLM.lsp_get_completions` | Get symbols in scope filtered by prefix at cursor | `[{label, kind, detail}]` |

#### Symbol at Position

Binary search through the file's sorted symbol list by line/column range. For nested symbols (methods inside classes), return the most specific (deepest) match. If the cursor is on a call site within a function body, match against the function's `call_sites` list.

#### Definition Resolution

1. If cursor is on a **call site**: use `CallSite.target_file` and `CallSite.target_symbol` to locate the definition
2. If cursor is on an **import name**: use the import resolver to find the source file, then locate the named symbol within it
3. If cursor is on a **local symbol**: return its own definition range (same file)

#### Completion Scope

Symbols available for completion at a given position:
1. **File-local symbols** — all top-level symbols in the current file
2. **Imported symbols** — names brought in by import statements
3. **Class members** — if inside a class body, include `self`/`this` members
4. **Star imports** — all exported symbols from star-imported modules

Filter by prefix match against the text before the cursor. Return sorted by relevance (exact prefix first, then alphabetical).

## Caching

### Symbol Cache

- In-memory, per-file, mtime-based invalidation
- Single-file invalidation for targeted rebuilds

### Persistence

The symbol map is saved to `{repo_root}/.ac-dc/symbol_map.txt`. It is:
- **Completely rebuilt and overwritten on startup**
- **Rebuilt before each new message** to the LLM, so the AI always sees the most recent codebase structure
- **Rebuilt when files change** due to edits (user or AI-applied)

This means the `.ac-dc/` directory always contains a current symbol map. The rebuild-before-send approach ensures the LLM context is never stale, though it may briefly affect LSP query responsiveness during rebuild (expected to be negligible for typical repo sizes).

### Import Resolution Cache

- Module-to-file mappings cached until repo structure changes
- Cleared when new files are detected

## Integration Points

### LLM Context Engine

The symbol map is split across cache tiers based on file stability. Files with full content in active context are excluded from the symbol map (the LLM already has the actual code).

### Editor Features

LSP-style queries are served via RPC to the browser's code editor for hover, navigation, and completion features.

### Cache Tier Initialization

The reference index's bidirectional edges drive the initial clustering of files into cache tiers (see Cache Tiering spec).
