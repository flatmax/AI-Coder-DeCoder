# Implementation Guide

How to use specs4 and specs3 together when implementing AC⚡DC from scratch.

## Context: Why Two Suites Exist

specs3 was written alongside an earlier implementation of AC⚡DC produced by a less capable AI coding assistant. It captures that implementation in exhaustive detail — method names, field shapes, sequencing quirks, workarounds for framework bugs — because the earlier assistant needed prescriptive guidance to produce working code.

specs4 is the deliberate abstraction raise: the same application's behavior described at the level a capable reimplementer actually needs. It exists because the original detail-level specs had accumulated incidental implementation choices that a fresh reimplementation would legitimately make differently.

The reimplementation is a clean-room rewrite. The goal is equivalent user-visible behavior and interop compatibility, not line-by-line reproduction. specs3's structural choices (module boundaries, class hierarchies, internal APIs, specific framework patterns) should be treated as one valid solution among several — not as a contract.

What *is* a contract: the parts of specs3 that cross module boundaries visible to users, the LLM, git, or other AC⚡DC instances. Wire formats, file formats, prompt text, numeric thresholds that affect observable behavior. These are proven-in-production interop details; don't re-derive them.

## The Two-Suite Relationship

**specs4 is the primary reference.** It describes behavioral contracts, invariants, module decomposition, and data flow at a level suitable for clean-room reimplementation. A reimplementer designs from specs4, structures modules per specs4, and writes tests against specs4's invariants.

**specs3 is the detail reference.** It describes the previous implementation at a concrete level — byte-exact formats, numeric thresholds, prompt text, and dependency quirks. When specs4 leaves a format or threshold unspecified, specs3 provides the authoritative value for interop. When specs3 prescribes an internal structure that specs4 is silent on, the reimplementer is free to choose differently.

## When to Use Which

### Use specs4 for:

- Architecture and module decomposition
- What components exist and how they relate
- Behavioral contracts (what must happen)
- Invariants (properties that must hold)
- Event flows and lifecycle descriptions
- Test design — invariants become test properties
- Design decisions where specs3 described an implementation-specific pattern

### Use specs3 for:

- **Byte-level formats** — the symbol map compact format, doc outline annotation syntax (`←N`, `→target#Section`, `~Nln`, content-type markers), edit block marker bytes (`««« EDIT`, `═══════ REPL`, `»»» EDIT END`)
- **Numeric constants** — tier entry-N and promotion-N values, cache buffer multipliers, model-specific minimums, compaction thresholds, debounce intervals
- **Persistent storage schemas** — JSONL history record field names, docuvert provenance header format, cache sidecar JSON structure
- **Config file schemas** — exact field names, nesting, legacy format fallbacks
- **System prompts** — the actual prompt text (LLM instruction contracts)
- **Dependency quirks** — tree-sitter TypeScript function name, Vite optimizeDeps exclusion, PyInstaller hidden imports, Monaco worker configuration paths
- **RPC wire formats** — exact argument shapes, return shapes, event payload structures

## Conflict Resolution

**When specs3 and specs4 conflict, specs4 wins.** specs4 is the deliberate abstraction; conflicts mean specs4 made a behavioral choice that supersedes the previous implementation.

**When specs4 is silent and specs3 has an interop detail, specs3 wins.** Do not invent alternative wire formats, file formats, numeric thresholds that affect observable behavior, or prompt text. The existing values are proven in production and changing them silently breaks compatibility.

**When specs4 is silent and specs3 prescribes an internal structure, the reimplementer chooses.** Class hierarchies, method names, module organization, framework patterns, and internal APIs in specs3 are one valid solution. A cleaner design is welcome.

**When specs3's detail seems wrong, raise it for discussion.** specs3 captures the previous implementation's choices, including its workarounds and compromises. Some of those are genuine bugs or over-engineering that a fresh implementation should improve on. Flagging "specs3 says X but it looks like a bug or a workaround for something that doesn't exist in this rewrite" is more valuable than silent preservation.

**When you have a better approach than what specs3 prescribes, propose it before implementing.** If during implementation you see a cleaner, simpler, or more robust approach to a section specs3 prescribes — and specs4 hasn't explicitly raised that section to a behavioral contract — surface the alternative to the guide rather than either silently deviating or silently following specs3. Describe the specs3 approach, the proposed alternative, and the tradeoffs. A short discussion before writing code is cheaper than refactoring after. This applies especially to internal structures, framework patterns, and workarounds whose original motivation may not carry over to the rewrite.

## Freedom the Reimplementer Has

specs4's abstraction raise exists so the reimpl can make better design choices at the module level. Legitimate changes:

- Module organization — restructure files, merge or split modules, pick better names
- Internal APIs — method signatures, class hierarchies, dependency injection patterns
- Framework choices — different async primitives, different data structure types
- Error handling — unified approach rather than case-by-case
- Code style — consistent naming, type hinting, docstring conventions
- Test structure — organize around specs4's invariants rather than mirroring specs3's test sections
- Performance optimizations — specs4 invariants don't prescribe specific caching strategies beyond what correctness requires

## Freedom the Reimplementer Does Not Have

Changes that cross a module boundary visible to users, the LLM, git, or other AC⚡DC instances are fixed by interop:

- Anything in the persistent storage format (JSONL schema, docuvert headers, `.bundled_version` marker, cache sidecar JSON)
- The LLM-facing formats (symbol map, doc outline, edit blocks, cache-control placement)
- The RPC surface that the webapp expects
- The config file schemas that users edit
- The system prompt text that instructs the LLM

Changing any of these silently breaks compatibility with existing data, existing LLM behavior, or existing user configs.

## Subtle Cases

Some specs4 behavioral descriptions could be satisfied in multiple valid ways, but specs3 has a specific way that subtle downstream behavior depends on. Example — specs4 says "compaction re-registers history items in the stability tracker." specs3 may specify a specific ordering (purge first, then re-add) that subtle cache-invalidation behavior depends on.

When in doubt, read specs3 carefully — not just for formats, but for sequencing, timing, and ordering constraints that specs4 abstracts away.

## Where specs4 Is Incomplete Without specs3

specs4 alone is not sufficient for byte-exact reimplementation in the following areas. Consult specs3 for each:

| Area | specs3 location |
|---|---|
| Symbol map compact format | `specs3/2-code-analysis/symbol_index.md` (legend, abbreviations, ditto marks, path aliases, test collapsing) |
| Doc outline annotation syntax | `specs3/2-code-analysis/document_mode.md` (keyword parentheses, content-type markers, section size, ref counts, outgoing refs) |
| Edit block marker bytes | `specs3/3-llm-engine/edit_protocol.md` |
| Cache tier numeric thresholds | `specs3/3-llm-engine/cache_tiering.md` (entry-N, promotion-N, cache buffer multiplier) |
| Model-specific cache minimums | `specs3/1-foundation/configuration.md` (Claude family minimums) |
| Compaction defaults | `specs3/3-llm-engine/context_and_history.md` |
| RPC method signatures | `specs3/1-foundation/communication_layer.md` (full RPC inventory with argument and return shapes) |
| Streaming event payload shapes | `specs3/3-llm-engine/streaming_lifecycle.md` (streamChunk, streamComplete, compactionEvent) |
| JSONL history schema | `specs3/3-llm-engine/context_and_history.md` |
| Docuvert provenance header | `specs3/4-features/doc_convert.md` |
| Config file schemas | `specs3/1-foundation/configuration.md` |
| System prompt text | `src/ac_dc/config/*.md` (the running system's config files are authoritative) |
| Dependency quirks | `specs3/2-code-analysis/symbol_index.md` (tree-sitter TypeScript), `specs3/5-webapp/diff_viewer.md` (Monaco workers), `specs3/6-deployment/build_and_deployment.md` (Vite optimizeDeps, PyInstaller imports) |

## Build Order Suggestion

Bottom-up, matching specs4's layer numbering:

1. **Foundation** — RPC transport, configuration, repository (git operations, file I/O)
2. **Indexing** — symbol index, document index, reference graph, keyword enrichment
3. **LLM** — context manager, history, cache tiering, prompt assembly, streaming, edit protocol, modes
4. **Features** — URL content, images, code review, collaboration, document convert
5. **Webapp** — shell, chat, viewers, file picker, search, settings, specialized components
6. **Deployment** — build, startup, packaging

Each layer depends only on layers below. Complete and test each layer before proceeding.

## Testing Strategy

- Each spec4 file ends with an invariants section; treat these as test property sources
- Unit tests verify component-level invariants (e.g., "stability tracker purge removes all history entries")
- Integration tests verify cross-layer invariants (e.g., "after compaction, the next prompt assembly excludes purged history tiers")
- End-to-end tests verify user-facing contracts (e.g., "file selection change broadcasts to all connected clients")

specs3's test sections list specific test cases that can be mined for coverage ideas, but organize test files around specs4's module structure, not specs3's.