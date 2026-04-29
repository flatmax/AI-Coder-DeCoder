# Reference Graph

A unified view of cross-file references used by both the symbol index (code → code) and the document index (doc → doc, doc → code). The graph feeds cache tier initialization and navigation features.

## Purpose

- Quantify how files are connected — which depend on which, which are central, which are isolated
- Supply the stability tracker with initial tier assignments based on connectivity
- Power per-file reference annotations in the compact map outputs (incoming reference counts)

## Two Separate Implementations

- Code reference index — tracks symbol usage across code files
- Document reference index — tracks heading- and doc-level links
- Both expose the same protocol methods consumed by the stability tracker
- The stability tracker does not inspect internal node types; it operates on file-level connectivity

## Code Reference Index

### Inputs

- Per-file FileSymbols with call sites
- Identifier scan of non-builtin names across the AST

### Edge Construction

- Resolved call sites become edges — source file depends on target file
- Import statements contribute edges via import resolution
- Builtin and common-name identifiers are filtered out

### Queries

- References to a named symbol (all locations)
- Files referencing a given file
- Files a given file depends on
- Incoming reference count for a file
- Bidirectional edges — files that reference each other mutually
- Connected components — clusters of mutually-referencing files

## Document Reference Index

### Inputs

- Per-file DocOutline with links
- Each link carries: target path, target heading (optional), source heading, image flag

### Edge Construction

- Two-pass build — collect all links, then resolve target heading anchors
- Target heading anchors resolved via GitHub-style slugging (lowercase, spaces → hyphens, strip punctuation)
- Unresolved anchors fall back to document-level and may be flagged
- Image link resolution shortcut — targets already resolved to repo-relative paths by the extractor's path-extension scan skip re-resolution

### Edge Types

- Doc section → doc section (most valuable for concept tracing)
- Doc section → doc (no fragment)
- Doc → code (doc references a source file)
- Code → doc (not auto-extracted, could be inferred from comments)

### Incoming Reference Counting

- Each heading receives a count of sections in *other* documents that link to it
- Links to a document without a fragment increment the top-level heading's count
- Self-references (within the same document) are excluded
- Duplicate links from the same source section to the same target count as one
- Zero counts are omitted from formatter output

### Queries

- Same protocol as code reference index
- Connected components include code files as leaf nodes — they serve as clustering bridges between documents that reference the same source

## Shared Protocol

- `connected_components()` — set of file clusters
- `file_ref_count(path)` — incoming reference count

These two methods are all the stability tracker requires. Internal node types and edge shapes differ between indexes, but the protocol is uniform.

## Clustering for Tier Initialization

- The stability tracker calls `connected_components()` to seed cached tiers with connectivity-correlated files
- Orphan files (no mutual references) are distributed into the smallest tier via greedy bin-packing
- Without this, one-way references and isolated files would never register in the tracker at startup

## Builtin Identifier Exclusion

- Language-specific builtins and common generic names excluded from code references
- Prevents noise edges like every file that uses `print` or `len` appearing to reference every other file

## Invariants

- Adding a file with no references produces an isolated node — it is still visible to the tracker
- Removing a file removes all edges involving it
- Rebuild from scratch is deterministic — same inputs produce the same graph
- Connected components are disjoint and cover all referenced nodes