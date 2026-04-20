# Document Index

**Status:** stub

A document-oriented analog to the symbol index. Extracts structural outlines from documentation files and feeds them through the same cache tiering system used for code. Supports markdown and SVG.

## Motivation

- Symbol index covers programming languages only; documentation files appear by path but produce no structural representation
- Many repositories are documentation-heavy (specs, READMEs, wikis, design docs)
- Structural awareness of document content significantly improves LLM navigation without loading full text

## Core Mapping

| Code concept | Document equivalent |
|---|---|
| Class / module | Document |
| Method / function | Heading |
| Imports | Links to other docs |
| Call sites | Cross-references between documents |
| Cross-type references | Doc → code links |

## Data Model

- DocHeading — text, level (1–6), keywords, start line, children, outgoing refs, incoming ref count, content types, section lines
- DocLink — target path, target heading (fragment), source heading, image flag
- DocSectionRef — target path, target heading (nullable for doc-level link)
- DocOutline — path, doc type, headings tree, links

## Module Structure

- Orchestrator with cache, formatter, keyword enricher, reference index, extractor registry
- Extractors registered by file extension
- Separation from symbol index is deliberate — different data model, no tree-sitter dependency, documentation cross-references work differently

## Compact Output Format

- Text block structurally similar to symbol map output
- Flows into the same cache tier system
- Annotations added — document type, keywords per heading, section-level cross-references, incoming reference counts, content-type hints, section sizes

### Annotations

- Document type tag after path (spec, guide, reference, decision, readme, notes, unknown)
- Keywords in parentheses after heading text
- Content type markers — table, code, formula — detected by regex during extraction
- Section size in lines, omitted below threshold
- Incoming reference count with arrow notation
- Outgoing section refs rendered as indented children with arrow notation
- Outgoing doc refs when link has no fragment
- Outgoing code refs for doc → code links

## Document Type Detection

- Heuristic, path- and heading-based
- Path keywords — spec, rfc, design, guide, tutorial, reference, api, decision, adr, notes, meeting
- Filename — README for readme type
- Heading-based fallback for ADR format (Status, Context, Decision) and numbered specs
- `unknown` is the default when no heuristic matches

## Line Numbers

- Raw per-heading line numbers are not in the compact output (mirrors the code context format)
- Start line is stored internally for section text slicing and size computation
- Section sizes are emitted — they convey budget information without the token cost of per-heading positions

## Markdown Extraction

- Line-by-line regex scanning, no external dependencies
- Headings detected, link extraction (inline and image references)
- Content-type detection — table separator rows, fenced code blocks, display/inline math

## SVG Extraction

- Stdlib XML parser
- Title → top-level heading, desc → level-2 heading
- Text and tspan content → leaf headings (visible labels)
- Groups with id/aria-label/inkscape:label → structural headings containing text children
- Anchor links → DocLink entries (excluding internal fragment links)
- Duplicate text labels deduplicated
- Non-visual elements skipped — defs, style, script, metadata

### SVG Indexing Policy

- SVG structural extraction is doc-mode only — in code mode, SVGs produce no outline
- Rationale — in code mode, SVGs are implementation artifacts; in doc mode, they are documentation (architecture diagrams, flowcharts)
- No keyword enrichment for SVG — text labels are already concise identifiers
- SVG files are skipped before the enrichment phase

## Image References

- Extracted as DocLink entries with image flag set
- Enables doc → SVG and doc → image cross-references in the reference graph
- Path-extension scan per line — matches paths ending in image extensions regardless of embedding syntax
- Matched paths validated against the repository file tree (unless validation disabled for single-file extraction)
- External URLs excluded by repo validation

## Indexing Lifecycle

### Triggers

- Server startup (background structural extraction, then enrichment)
- Switch to doc mode (re-index changed files)
- Every chat in doc mode (structure re-extraction, enrichment queued)
- LLM edits a doc file (explicit invalidation + re-extraction + enrichment queue)
- User edits in viewer (lazy detection via mtime on next structure pass)

### Mtime-Based Cache

- Files with unchanged mtime are not re-parsed
- Re-indexing after saves is effectively free for unchanged files

### Explicit Invalidation

- LLM edits trigger invalidation of both symbol and doc caches for all modified files
- Modified files get fresh unenriched outlines instantly
- Enrichment is queued for background processing

### Two-Phase Principle

- Structural extraction is synchronous and instant (< 5ms per file)
- Keyword enrichment is asynchronous and never blocks user-facing operations
- Mode switches are instant — unenriched outlines are available immediately
- Chat requests never wait for enrichment

## Disk Persistence

- Per-file JSON sidecar in the per-repo working directory
- Sidecar filename derived from path (slashes replaced)
- Sidecar content — path, mtime, content hash, keyword model name, serialized outline
- Sidecars survive server restart, avoiding expensive re-enrichment on every restart
- Corrupt sidecars silently removed on load
- Model change invalidates entries — stored model name is checked on cache lookup, mismatched entries treated as stale

## Structure-Only Cache Lookup

- A separate code path accepts any cached outline regardless of keyword model
- Used by mode switching and chat requests to avoid blocking on enrichment
- Files whose mtime has changed are re-parsed; enriched or unenriched outlines are reused as-is

## Progress Feedback

- Non-blocking header progress bar in the dialog header
- Shows current file and completion percentage during background enrichment
- Auto-dismisses when all pending files are enriched
- Driven by per-file progress events sent as compaction/progress callbacks
- No toast — toasts would obstruct the chat input area during multi-minute enrichment

## Graceful Degradation

- If the keyword library is unavailable, structural outlines still work fully
- Heading tree, cross-references, reference counting, cache tiering, and doc-mode system prompt all function without keywords
- A one-time warning toast informs the user on mode switch
- Header progress bar is suppressed when no enrichment is possible

## Integration with Cache Tiering

- Document outline blocks are tracked as `doc:{path}` items
- Same N-value tracking, tier graduation, and cascade as code symbols
- Documents change less frequently than code, so they tend to stabilize at higher tiers quickly

## Invariants

- A file's unchanged outline is never re-extracted
- SVG files never undergo keyword enrichment
- Keyword enrichment never blocks a mode switch or chat request
- The outline's content hash is stable for unchanged content
- Mode-appropriate dispatch — dispatch on key prefix, not on current mode