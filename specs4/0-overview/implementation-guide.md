# Implementation Guide

How to use specs4 and specs3 together when implementing AC⚡DC from scratch.

## Context: Why Two Suites Exist

AC⚡DC's specification is split across two peer directories:

- **`specs4/`** — behavioral contracts, invariants, module decomposition, data flow. Written at the level a capable reimplementer actually needs. Deliberately omits byte-level detail that a fresh implementation would legitimately handle differently.
- **`specs-reference/`** — implementation detail that specs4 deliberately leaves unspecified but a reimplementation must reproduce for interop. Byte-level formats, numeric constants, persistent storage schemas, RPC argument shapes, dependency quirks. Mirrors specs4's path structure; each twin file supplements its specs4 counterpart.

The reimplementation goal is equivalent user-visible behavior and interop compatibility, not line-by-line reproduction. Internal structures (module boundaries, class hierarchies, internal APIs, framework patterns) are the reimplementer's choice. External structures (wire formats, file formats, prompt text, numeric thresholds that affect observable behavior) are contracts because existing data, existing LLM behavior, and existing user configs depend on them.

## The Two-Suite Relationship

**specs4 is the primary reference.** Describes behavioral contracts, invariants, module decomposition, and data flow at a level suitable for clean-room reimplementation. A reimplementer designs from specs4, structures modules per specs4, and writes tests against specs4's invariants.

**specs-reference/ is the detail reference.** Byte-exact formats, numeric thresholds, storage schemas, dependency quirks. When specs4 leaves a format or threshold unspecified, consult the mirrored `specs-reference/` file (same path, same name). Twins exist only where specs4 needs supplementing — a missing twin means the specs4 spec is self-sufficient.

The running system's `src/ac_dc/config/*.md` files are authoritative for system prompt text. Duplicating prompt text into a twin would create drift risk, so the table below points directly at the config directory for that row.

## When to Use Which

### Use specs4 for:

- Architecture and module decomposition
- What components exist and how they relate
- Behavioral contracts (what must happen)
- Invariants (properties that must hold)
- Event flows and lifecycle descriptions
- Test design — invariants become test properties
- Design decisions where specs3 described an implementation-specific pattern

### Use `specs-reference/` for:

- **Byte-level formats** — the symbol map compact format, doc outline annotation syntax (`←N`, `→target#Section`, `~Nln`, content-type markers), edit block marker bytes (`🟧🟧🟧 EDIT`, `🟨🟨🟨 REPL`, `🟩🟩🟩 END`)
- **Numeric constants** — tier entry-N and promotion-N values, cache buffer multipliers, model-specific minimums, compaction thresholds, debounce intervals
- **Persistent storage schemas** — JSONL history record field names, docuvert provenance header format, cache sidecar JSON structure
- **Config file schemas** — exact field names, nesting, legacy format fallbacks
- **Dependency quirks** — tree-sitter TypeScript function name, Vite optimizeDeps exclusion, PyInstaller hidden imports, Monaco worker configuration paths
- **RPC wire formats** — exact argument shapes, return shapes, event payload structures

### Use `src/ac_dc/config/*.md` for:

- **System prompt text** — the actual LLM instruction strings. These files are the authoritative source; a twin would create drift risk.

## Conflict Resolution

**When specs4 and a specs-reference twin conflict, specs4 wins.** specs4 owns behavioral contracts. If a twin's detail describes behavior that specs4 contradicts, the twin is out of date and needs updating.

**When specs4 is silent on a byte-level or numeric detail, the specs-reference twin is authoritative.** Do not invent alternative wire formats, file formats, or thresholds that affect observable behavior. The values in `specs-reference/` are proven in production; changing them silently breaks compatibility with existing data, existing LLM behavior, or existing user configs.

**When neither specs4 nor the twin covers a case, the reimplementer chooses.** Class hierarchies, method names, module organization, framework patterns, and internal APIs are not contracts. A cleaner design is welcome.

**When a twin's detail seems wrong or overfit to historical implementation, raise it for discussion.** Some twin detail captures workarounds for bugs in libraries the reimplementation may not use, or compromises that a fresh implementation could improve on. Flagging "the twin says X but it looks like a workaround for something that doesn't exist in this rewrite" is more valuable than silent preservation.

**When you have a better approach than what a twin prescribes, propose it before implementing.** If during implementation you see a cleaner, simpler, or more robust approach to a section a twin prescribes — and specs4 hasn't explicitly raised that section to a behavioral contract — surface the alternative rather than silently deviating or silently following. Describe the twin's approach, the proposed alternative, and the tradeoffs. A short discussion before writing code is cheaper than refactoring after.

## Freedom the Reimplementer Has

specs4 describes behavior at an abstraction level that leaves internal design choices open. Legitimate changes:

- Module organization — restructure files, merge or split modules, pick better names
- Internal APIs — method signatures, class hierarchies, dependency injection patterns
- Framework choices — different async primitives, different data structure types
- Error handling — unified approach rather than case-by-case
- Code style — consistent naming, type hinting, docstring conventions
- Test structure — organize around specs4's invariants, not around any specific previous implementation's test layout
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

Some specs4 behavioral descriptions could be satisfied in multiple valid ways, but the `specs-reference/` twin specifies a sequencing or timing detail that subtle downstream behavior depends on. Example — specs4 says "compaction re-registers history items in the stability tracker." A twin (or a specs4 subsection) may specify a specific ordering (purge first, then re-add) that subtle cache-invalidation behavior depends on.

When in doubt, read the twin carefully — not just for formats, but for sequencing, timing, and ordering constraints that specs4 abstracts away.

## Where specs4 Is Incomplete Without specs-reference

specs4 alone is not sufficient for byte-exact reimplementation in the following areas. Consult `specs-reference/` (or the running system's config files, where indicated) for each:

| Area | specs-reference location |
|---|---|
| Symbol map compact format | `specs-reference/2-indexing/symbol-index.md` (legend, abbreviations, ditto marks, path aliases, test collapsing) |
| Doc outline annotation syntax | `specs-reference/2-indexing/document-index.md` (keyword parentheses, content-type markers, section size, ref counts, outgoing refs) |
| Edit block marker bytes | `specs-reference/3-llm/edit-protocol.md` |
| Cache tier numeric thresholds | `specs-reference/3-llm/cache-tiering.md` (entry-N, promotion-N, cache buffer multiplier) |
| Model-specific cache minimums | `specs-reference/3-llm/cache-tiering.md` (Claude family minimums — same twin as the tier thresholds) |
| Compaction defaults | `specs-reference/3-llm/history.md` (under "Compaction config defaults" — folded into the history schema twin alongside JSONL records, since both persist through the same store) |
| RPC method signatures | `specs-reference/1-foundation/rpc-inventory.md` (full RPC inventory with argument and return shapes) |
| Streaming event payload shapes | `specs-reference/3-llm/streaming.md` (streamChunk, streamComplete, compactionEvent) |
| JSONL history schema | `specs-reference/3-llm/history.md` |
| Docuvert provenance header | `specs-reference/4-features/doc-convert.md` |
| Config file schemas | `specs-reference/1-foundation/configuration.md` |
| Prompt assembly headers and cache-control | `specs-reference/3-llm/prompt-assembly.md` (header strings, cache-control placement, acknowledgement text, file content formatting) |
| Collaboration admission messages | `specs-reference/4-features/collaboration.md` (admission message types, 120s timeout, WebSocket close code 1008, share-info payload) |
| Startup progress stages | `specs-reference/6-deployment/startup.md` (stage name strings, reconnect backoff schedule, port probe range) |
| Context-model thresholds | `specs-reference/3-llm/context-model.md` (shedding 0.90, overhead 500 tokens, emergency 2× multiplier) |
| System prompt text | `src/ac_dc/config/*.md` (the running system's config files are authoritative) |
| Dependency quirks | `specs-reference/2-indexing/symbol-index.md` (tree-sitter TypeScript), `specs-reference/5-webapp/diff-viewer.md` (Monaco workers), `specs-reference/6-deployment/build.md` (Vite optimizeDeps, PyInstaller imports) |

## Architectural Changes from specs3

specs4 deliberately changes several architectural positions from specs3. These are **behavioral contracts** in specs4 — a reimplementer must preserve them even when specs3 describes an older pattern at the concrete level. When specs3 and specs4 disagree on any of the points below, specs4 wins.

Each change was made to enable a future parallel-agent mode (see [parallel-agents.md](../7-future/parallel-agents.md)) without refactoring the foundation. All changes are zero-cost in single-agent operation — they add an invariant the existing code path already happens to satisfy.

### Repository — Per-Path Write Mutex

- **specs3 position:** Writes are implicitly single-threaded; no mutex described
- **specs4 position:** The repository layer maintains an internal per-path mutex for write operations. Concurrent writes to different paths proceed in parallel; concurrent writes to the same path serialize
- **See:** [repository.md — Per-Path Write Serialization](../1-foundation/repository.md#per-path-write-serialization)

### Edit Pipeline — Re-Entrant

- **specs3 position:** Apply pipeline described as sequential; no statement about concurrent invocation
- **specs4 position:** The apply pipeline is safe to invoke concurrently for different edit-block batches. Per-file writes serialize via the repository's per-path mutex
- **See:** [edit-protocol.md — Concurrent Invocation](../3-llm/edit-protocol.md#concurrent-invocation)

### Context Manager — Multiple Instances Allowed

- **specs3 position:** The context manager is described as the singular state holder for an LLM session
- **specs4 position:** The context manager is not a singleton. Multiple instances may coexist under one LLM service; each owns its own history, file context, stability tracker, and prompt state
- **See:** [context-model.md — Multiple Instances](../3-llm/context-model.md#multiple-instances)

### Stability Tracker — Per-Context-Manager, Not Per-Mode

- **specs3 position:** "Two independent tracker instances — one for code mode, one for document mode"
- **specs4 position:** A tracker instance is owned by its context manager. Mode switching swaps between two trackers that the user-facing context manager points at. Additional context managers (e.g. parallel agents) each hold additional trackers. Tracker identity is scoped to the owning context manager, not to session-global mode state
- **See:** [cache-tiering.md — Tracker Instance Scope](../3-llm/cache-tiering.md#tracker-instance-scope), [context-model.md — Stability Tracker Attachment](../3-llm/context-model.md#stability-tracker-attachment)

### Single-Stream Guard — User-Initiated Only

- **specs3 position:** "Only one LLM streaming request may be active at a time"
- **specs4 position:** Only one **user-initiated** streaming request at a time. A user-initiated request may spawn additional internal streams (e.g. parallel agents) that share the parent's request ID as a prefix and are not blocked by the guard
- **See:** [streaming.md — Multiple Agent Streams Under a Parent Request](../3-llm/streaming.md#multiple-agent-streams-under-a-parent-request), [rpc-transport.md — Concurrency](../1-foundation/rpc-transport.md#concurrency)

### Chunk Routing — Keyed by Request ID

- **specs3 position:** Passive-stream adoption described as a singleton flag; the chat panel tracks one passive stream at a time
- **specs4 position:** Streaming state (content buffer, passive flag, streaming card) is keyed by request ID. Single-stream operation has at most one active key; multi-stream operation (parallel agents) produces N keyed states. Request IDs are the multiplexing primitive — the transport never assumes a singleton stream
- **See:** [chat.md — Streaming State Keyed by Request ID](../5-webapp/chat.md#streaming-state-keyed-by-request-id), [streaming.md — Chunk Delivery Semantics](../3-llm/streaming.md#chunk-delivery-semantics)

### Agent Conversations — Archived Separately

- **specs3 position:** No position (parallel agents described only as future work)
- **specs4 position:** In agent mode, the main LLM handles decomposition, agent-output review, iteration decisions, and synthesis — all within the same ContextManager that drives the user-facing chat. There is no separate planner or assessor role. Agents spawned in parallel by the main LLM each get their own ContextManager; their conversations are archived to `.ac-dc4/agents/{turn_id}/agent-NN.jsonl` so users can inspect what each agent did from the UI. The main LLM's own conversation is already in `history.jsonl` as the user message and the assistant response — no separate archive is needed. Agent conversations are never written to the main history, never counted toward compaction thresholds, and never used during session restore. Each record in the main history is tagged with a turn ID that correlates to any archive directory
- **See:** [history.md — Agent Turn Archive](../3-llm/history.md#agent-turn-archive), [history.md — Turns](../3-llm/history.md#turns), [parallel-agents.md — Turn ID Propagation](../7-future/parallel-agents.md#turn-id-propagation)

### Indexes — Read-Only Snapshots Within a Request

- **specs3 position:** Re-indexing timing described procedurally ("before each LLM call") without an explicit snapshot contract
- **specs4 position:** Re-indexing happens only at request boundaries. Within the execution window of a single request, indexes are treated as read-only snapshots — symbol map queries, per-file block lookups, and reference graph queries all return consistent data. Background keyword enrichment never mutates the snapshot mid-request
- **See:** [symbol-index.md — Snapshot Discipline](../2-indexing/symbol-index.md#snapshot-discipline), [document-index.md — Snapshot Discipline](../2-indexing/document-index.md#snapshot-discipline)

### HUD and Context Tab — Per-Context-Manager Dispatch

- **specs3 position:** Breakdown RPC implicitly reports on the single session context
- **specs4 position:** Breakdown RPC targets a specific context manager, defaulting to the user-facing one. Single-agent operation looks identical to specs3 because there's only one context manager. Multi-agent operation can report per-agent breakdowns without transport-level changes
- **See:** [viewers-hud.md — Per-Context-Manager Breakdown](../5-webapp/viewers-hud.md#per-context-manager-breakdown)

### SVG Viewer — Unified Bespoke Editor on Both Panels

- **specs3 position:** Two systems coexist — `svg-pan-zoom` library on the left pane (always) and on the right pane (pan mode), plus the bespoke `SvgEditor` on the right pane (select mode). Sync bridges between the library's transform-group model and the editor's viewBox model
- **specs4 position:** One bespoke editor class on both panes. Left pane constructed with a read-only flag that disables selection, handles, marquee, keyboard shortcuts, and double-click-to-edit — only pan and zoom remain active. Right pane is the full editable editor. No pan/zoom library involved. The two editors are sync-coupled by mirroring viewBox writes through `setViewBox` under a ping-pong mutex
- **Why:** Removes the viewport-group unwrap gymnastics needed to serialize clean SVG, removes the library/editor coordinate-math mismatch, removes the gesture conflict where library pan intercepts empty-space drag before the editor can start a marquee. "Pan mode" ceases to be a distinct mode — pan is a pointer gesture (middle-click, or plain drag on the read-only pane) that always works
- **See:** [svg-viewer.md — Interaction Modes, Synchronization, Invariants](../5-webapp/svg-viewer.md#interaction-modes)

### Summary Table

| Area | specs3 | specs4 |
|---|---|---|
| Repository writes | Implicit single-threaded | Per-path mutex |
| Edit apply pipeline | Sequential | Re-entrant, per-file serialization |
| Context manager | Singular | Multiple instances allowed |
| Stability tracker | Per-mode (two total) | Per-context-manager (N possible) |
| Single-stream guard | Any LLM request | User-initiated requests only |
| Chunk routing | Singleton passive flag | Keyed by request ID |
| Agent conversations | Unspecified | Per-agent files archived to `.ac-dc4/agents/{turn_id}/agent-NN.jsonl`; main LLM has no separate archive (its conversation lives in main history) |
| Index mutation | Procedural timing | Read-only snapshots within a request |
| HUD breakdown | Session-global | Per-context-manager |
| SVG viewer pan/zoom | `svg-pan-zoom` library + bespoke editor | Single bespoke editor on both panes; left in read-only mode |

**What this means for the reimplementer:** The specs3 descriptions are accurate for the previous implementation's behavior, but the specs4 contracts are stricter. Implement the specs4 invariants from the start. They cost nothing in single-agent operation and mean the foundation does not need to be refactored when agent mode is added. Conversely, if you follow specs3 literally on these points, you will later discover the foundation layers need reshaping to support agent mode — exactly the situation specs4's abstraction raise was meant to prevent.

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