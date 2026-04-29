# Symbol Index

A tree-sitter based code analysis engine. Extracts classes, functions, variables, and imports from source files to produce a compact textual symbol map for LLM context and to support editor features (hover, go-to-definition, completions).

## Architecture

- Orchestrator coordinates parser, per-language extractors, cache, import resolver, reference graph, and formatter
- Two formatter outputs: context (no line numbers, for LLM) and LSP (with line numbers, for editor)
- Singleton tree-sitter parser with multi-language support
- Per-file mtime-based cache

## Data Model

- Symbol — name, kind, file path, range, parameters, return type, bases, children, async flag, call sites, instance variables
- Call site — name, line, conditional flag, resolved target symbol and file
- Import — module, names, alias, level (0 absolute, 1+ relative), line
- FileSymbols — file path, top-level symbols, imports, flattened all-symbols list

## Supported Languages

- Python
- JavaScript (also covers `.jsx` and `.mjs`)
- TypeScript (also covers `.tsx`)
- C / C++
- MATLAB / Octave

## Grammar Acquisition

- Tree-sitter grammars come from per-language pip packages
- Each language is loaded lazily on first use
- Missing grammar packages cause that language to be silently unavailable
- The TypeScript package exposes grammars under a different function name than other languages — loader must probe for both

## Regex-Based Extractors

- A language may declare its extractor does not require a parse tree
- MATLAB uses this mechanism (no maintained tree-sitter grammar)
- Regex extractors produce the same FileSymbols output as tree-sitter extractors

## Per-Language Extraction Concerns

- Method vs function distinction (parent context)
- Async detection (keyword or node marker)
- Parameters — defaults, types, varargs
- Instance variables from constructor body
- Properties via decorators or keywords
- Inheritance via heritage nodes

## MATLAB Extractor Specifics

- Recognizes `classdef` with inheritance, functions with output args, imports, top-level variables
- Function body analysis extracts call sites and local/read variables
- Large builtin exclusion list filters common MATLAB functions from call site and variable detection
- `end` nesting is tracked for block scoping
- Functions inside `classdef` become methods

## Import Resolution

- Python — absolute paths, package `__init__.py`, relative paths with level-aware parent traversal
- JavaScript/TypeScript — relative resolution with extension probing, `index.*` fallback for directories
- C/C++ — `#include` search across repo

## Reference Index

- Tracks cross-file symbol usage by scanning identifier nodes
- Builtin identifiers (language keywords, common names) are excluded
- Queries: references to symbol, files referencing a file, dependencies of a file, reference count, bidirectional edges, connected components

## Compact Format — Symbol Map

- Human-readable, token-efficient
- Two variants: context (no line numbers) and LSP (with line numbers)
- Legend header establishes abbreviations: class, method, function, async variants, variable, property, import, return type, optional, refs, calls, more, ditto, test summary, path aliases
- File entries show path, incoming reference count, imports, top-level symbols with children nested by indent
- Path aliases — frequent prefixes get short aliases computed from reference frequency
- Ditto marks — repeated reference lists are collapsed
- Test file collapsing — test files show only summary counts (classes, methods, fixtures)
- Stable ordering — files maintain position across regenerations for cache stability
- Instance variables listed as indented nested entries under their class

## Chunked Output

- Symbol map can be split into chunks for cache tier distribution

## Per-File Blocks

- Individual file symbol blocks can be generated independently
- Stable signature hash enables change detection for the stability tracker

## Indexing Pipeline

- Per-file — check cache, parse, extract, post-process (method detection, params, async, instance vars), resolve imports, store in cache
- Multi-file — index each file cache-aware, remove stale entries from memory and cache, resolve cross-file call targets, build reference index

## Stale Entry Cleanup

- Files in the in-memory index but not in the current file list are removed from memory and invalidated in the cache
- This handles files deleted from disk or removed from git tracking between requests
- Must run before the stability tracker builds its active-items list, or deleted files will re-enter the tracker

## Snapshot Discipline

Re-indexing happens only at request boundaries — specifically, at the start of each streaming request before prompt assembly. Within the execution window of a single request, the index is treated as a **read-only snapshot**: symbol map queries, per-file block lookups, and reference graph queries all return consistent data.

This matters for future parallel-agent mode (see [parallel-agents.md](../7-future/parallel-agents.md)) — multiple agents executing within one user request share the same snapshot. Agents never see mid-execution re-indexing. Re-indexing between iterations (planner → agents → assessor → next planner) uses the standard request-boundary mechanism; no special parallel-agent logic is needed.

The index is not thread-safe for concurrent writes. Only one re-indexing pass runs at a time, and it runs on the event loop thread (or in an executor with a barrier). Concurrent reads from multiple threads within the execution window are safe because the index is not being mutated during that window.

## LSP Queries

- Hover — symbol signature, parameters, return type
- Definition — file and range via call site or import resolution
- References — list of file and range pairs
- Completions — label, kind, detail, filtered by prefix

## Symbol at Position

- Search through symbols by line/column range
- For nested symbols, return the deepest match
- If on a call site, match against the function's call sites list
- If on an import statement, match by line and resolve via import resolver

## Definition Resolution

- Call site — use resolved target file and symbol
- Import statement — resolve via import resolver, return synthetic call site pointing at target file
- Local symbol — return its own definition range

## Caching

- Per-file in-memory cache, mtime-based invalidation
- Symbol map snapshot written to per-repo working directory after each LLM response (not before the request)
- Import resolution cache cleared when new files are detected

## Indexing Exclusions

- Hidden directories
- Common build/dependency directories (node_modules, `__pycache__`, venvs, dist, build, .git)
- The application's own working directory

## Invariants

- A file's mtime-unchanged entry is never re-parsed
- Stale entries are removed from both memory and cache on each full index pass
- The signature hash is deterministic — identical symbol structure produces identical hash
- The symbol map output for unchanged files is byte-stable across regenerations