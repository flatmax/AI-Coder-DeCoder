# Implementation TODO

> **Implementation Status**: Phase 1 in progress — Foundation layer

## Implementation Notes

### jrpc-oo Integration
At build time, provide the jrpc-oo summary and symbol table in implementation context. The library's class-based API means service classes (Repo, LLM, Settings) define the RPC interface directly — public methods become remotely callable. No separate API layer to implement.

### Deferred Decisions
The following are explicitly deferred to implementation time:
- **Error/loading UI states** — spinners, skeletons, reconnection indicators, toast system
- **CSS/styling** — design tokens, color system, spacing conventions, responsive behavior
- **Accessibility** — ARIA roles, focus management (can be added incrementally)
- **Keyboard shortcuts** — Ctrl+S for save; others added as needed

### Tree-Sitter Queries
Bundle community `tags.scm` files from tree-sitter grammar repos (Python, JS/TS, C). These are well-tested and cover 80%+ of needs. Implementation effort is in per-language post-processing, not the queries.

## Testing Approach

### Unit Tests (Algorithmic Cores)
- **Cache tiering**: N-value progression, ripple promotion, threshold-aware anchoring, demotion/removal. Simulate multi-request sequences and assert tier assignments.
- **Edit block parsing**: State machine extraction from streamed text. Anchor matching against file content. Conflict detection (ambiguous anchors, missing context).
- **Token counting**: Model-aware counting, fallback estimation, budget calculations.
- **Import resolution**: Python absolute/relative, JS/TS with extension probing, edge cases (missing files, circular imports).
- **Topic boundary parsing**: JSON extraction with fallback (fenced output, malformed JSON). Compaction case selection logic.
- **URL detection/classification**: Pattern matching, type classification, display name generation.

### Integration Tests
- **RPC round-trip**: Send message → receive chunks → verify streamComplete with edit results.
- **Edit application**: Parse block from LLM-like text → apply to file → verify result.
- **Git operations**: Stage, commit, reset, diff against a test repository.
- **Symbol index**: Index a known repo, verify symbol extraction, cross-file references, compact output stability.

### Test Repository
A small repo checked into the project with known structure:
- Multiple languages (Python, JS/TS, C)
- Known cross-file references for reference index testing
- Files with deliberate edit targets for edit block testing
- Git history for diff/staging tests

### No UI Tests
Web component UIs change too fast for automated tests to be cost-effective. Manual testing is sufficient for the frontend.

## Build Order

Recommended implementation sequence, with dependencies noted:

### Phase 1: Foundation
- [ ] **RPC server** — jrpc-oo WebSocket server with class registration
- [ ] **Repository layer** — Git operations, file tree, search (wrapping git)
- [ ] **Configuration** — Config loading, directory resolution, settings service
- [ ] **Startup** — CLI parsing, port scanning, browser launch

### Phase 2: Code Analysis
- [ ] **Tree-sitter parser** — Multi-language parsing singleton
- [ ] **Language extractors** — Python, JavaScript/TypeScript, C/C++
- [ ] **Symbol cache** — mtime-based per-file caching
- [ ] **Import resolver** — Python and JS import → file path mapping
- [ ] **Reference index** — Cross-file reference tracking
- [ ] **Compact formatter** — LLM-optimized text output with aliases and annotations
- [ ] **LSP formatter** — Editor-compatible JSON output

### Phase 3: LLM Integration
- [ ] **Token counter** — Model-aware counting with fallback
- [ ] **Context manager** — History, file context, token budgets
- [ ] **Prompt loader** — System prompt assembly from files
- [ ] **Edit parser** — State machine for edit block extraction and application
- [ ] **Streaming handler** — Background task, chunk delivery, completion
- [ ] **Commit message generation** — Non-streaming LLM call

### Phase 4: Cache System
- [ ] **Stability tracker** — N-value tracking, tier assignment
- [ ] **Tier promotion algorithm** — Ripple cascade, threshold-aware promotion
- [ ] **Reference graph clustering** — Bidirectional edge analysis, bin-packing
- [ ] **Context builder** — Tiered message assembly with cache control markers
- [ ] **Stability update** — Post-response item tracking, graduation, demotion

### Phase 5: History Management
- [ ] **History store** — JSONL persistence, session management, search
- [ ] **Topic detector** — LLM-based boundary detection
- [ ] **History compactor** — Truncation/summarization strategies
- [ ] **Compaction integration** — Post-response trigger, stability re-registration

### Phase 6: URL Handling
- [ ] **URL detector** — Pattern matching and type classification
- [ ] **GitHub handler** — Shallow clone, README, symbol map generation
- [ ] **Web handler** — Content extraction with fallback
- [ ] **URL cache** — Filesystem TTL cache
- [ ] **Summarizer** — Type-aware LLM summarization

### Phase 7: Webapp Foundation
- [ ] **App shell** — Root component, dialog, tabs, lazy loading
- [ ] **RPC mixin** — Shared singleton, convenience methods
- [ ] **Chat panel** — Message cards, streaming display, scroll management
- [ ] **Input handling** — Textarea, history navigation, fuzzy search, snippets
- [ ] **URL chips** — Detection display, fetch triggers, inclusion toggles

### Phase 8: Webapp Features
- [ ] **File picker** — Tree rendering, selection, git status, context menu
- [ ] **Diff viewer** — Side-by-side editor, language detection, save flow
- [ ] **LSP integration** — Hover, definition, references, completions
- [ ] **Search tab** — Full-text search with results navigation
- [ ] **Context viewer** — Token budget breakdown
- [ ] **Cache viewer** — Tier visualization, stability bars, recent changes
- [ ] **Settings panel** — Config editing, reload
- [ ] **History browser** — Session list, search, load

### Phase 9: Polish
- [ ] **Build pipeline** — Bundling, versioned deployment, CI
- [ ] **Terminal HUD** — Cache blocks report, token usage, tier changes
- [ ] **Error handling** — Graceful degradation throughout
- [ ] **State persistence** — Local storage for UI preferences
