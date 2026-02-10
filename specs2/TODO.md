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

### Tree-Sitter Integration
Individual `tree-sitter-{language}` packages provide grammars. Per-language extractor classes walk the AST using tree-sitter's node API. The parser supports multiple API versions and falls back to `tree-sitter-languages` if individual packages are unavailable.

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

### Phase 1: Foundation ✅
- [x] **RPC server** — jrpc-oo WebSocket server with class registration (`main.py`)
- [x] **Repository layer** — Git operations, file tree, search wrapping git (`repo.py`, `tests/test_repo.py`)
- [x] **Configuration** — Config loading, directory resolution, settings service (`config.py`, `settings.py`, `tests/test_config.py`)
- [x] **Startup** — CLI parsing, port scanning, browser launch (`main.py`)
- [x] **Edit parser** — State machine extraction, anchor matching, application (`edit_parser.py`, `tests/test_edit_parser.py`)
- [x] **Token counter** — Model-aware counting with fallback (`token_counter.py`)
- [x] **LLM service stub** — Session state, selected files, RPC interface (`llm_service.py`)

### Phase 2: Code Analysis ✅
- [x] **Tree-sitter parser** — Multi-language parsing singleton (`symbol_index/parser.py`)
- [x] **Language extractors** — Python, JavaScript/TypeScript, C/C++ (`symbol_index/extractors/`)
- [x] **Symbol cache** — mtime-based per-file caching (`symbol_index/cache.py`)
- [x] **Import resolver** — Python, JS/TS, and C import → file path mapping (`symbol_index/import_resolver.py`)
- [x] **Reference index** — Cross-file reference tracking, bidirectional edges, connected components (`symbol_index/reference_index.py`)
- [x] **Compact formatter** — LLM-optimized text output with aliases, annotations, test collapsing, chunks (`symbol_index/compact_format.py`)
- [x] **LSP queries** — Hover, definition, references, completions via symbol index (`symbol_index/index.py`, `llm_service.py`)

### Phase 3: LLM Integration ✅
- [x] **Token counter** — Model-aware counting with fallback (done in Phase 1)
- [x] **Context manager** — History, file context, token budgets (`context.py`, `tests/test_context.py`)
- [x] **Prompt loader** — System prompt assembly from files (done in Phase 1 via `config.py`)
- [x] **Edit parser** — State machine for edit block extraction and application (done in Phase 1)
- [x] **Streaming handler** — Background task, chunk delivery, completion (`llm_service.py`, `tests/test_llm_service.py`)
- [x] **Commit message generation** — Non-streaming LLM call (`llm_service.py`)

### Phase 4: Cache System ✅
- [x] **Stability tracker** — N-value tracking, tier assignment, content hashing per item (`stability_tracker.py`, `tests/test_stability_tracker.py`)
- [x] **Tier promotion algorithm** — Ripple cascade, threshold-aware anchoring, N-cap when tier above stable
- [x] **Reference graph clustering** — Bidirectional edge analysis, greedy bin-packing into L1/L2/L3
- [x] **Context builder** — Tiered message assembly with `cache_control` markers, L0 system message construction (`context_builder.py`, `tests/test_context_builder.py`)
- [x] **Stability update** — Post-response: stale removal, active item processing, graduation, cascade, change logging
- [x] **Context integration** — Tiered message assembly in ContextManager, active items building, stability initialization

### Phase 5: History Management ✅
- [x] **History store** — JSONL persistence, session management, search (`history_store.py`, `tests/test_history.py`)
- [x] **Topic detector** — LLM-based boundary detection with JSON parsing fallbacks (`topic_detector.py`)
- [x] **History compactor** — Truncation/summarization strategies with verbatim window (`history_compactor.py`)
- [x] **Compaction integration** — Post-response trigger in LLM service, stability re-registration, message persistence (`context.py`, `llm_service.py`)

### Phase 6: URL Handling ✅
- [x] **URL detector** — Pattern matching and type classification (`url_handler.py`)
- [x] **GitHub handler** — Shallow clone, README, symbol map generation (`url_handler.py`)
- [x] **Web handler** — Content extraction with fallback (`url_handler.py`)
- [x] **URL cache** — Filesystem TTL cache (`url_cache.py`)
- [x] **Summarizer** — Type-aware LLM summarization (`url_handler.py`)

### Phase 7: Webapp Foundation *(in progress)*
- [x] **Build setup** — Vite config, npm project, Lit dependency, jrpc-oo browser integration
- [x] **App shell** — Root component extending JRPCClient, WebSocket connection, dialog container
- [x] **Dialog component** — Dragging, resizing, minimizing, tab bar
- [x] **RPC mixin** — Shared singleton, convenience methods (extract, stateful call)
- [x] **Chat panel** — Message cards, markdown rendering, streaming display, scroll management
- [x] **Input handling** — Auto-resize textarea, Enter to send, image paste, snippet drawer
- [x] **Input history** — Up-arrow fuzzy search overlay, history navigation
- [x] **URL chips** — Detection display, fetch triggers, inclusion toggles

### Phase 8: Webapp Features
- [ ] **File picker** — Tree rendering, checkbox selection, git status badges, context menu
- [ ] **File picker resize** — Draggable panel divider, collapse/expand, local storage persistence
- [ ] **Diff viewer** — Monaco editor, side-by-side diff, language detection, dirty tracking, save flow
- [ ] **LSP integration** — Hover, definition, references, completions providers for Monaco
- [ ] **Search tab** — Full-text search with debounce, result grouping, keyboard navigation
- [ ] **Context viewer** — Token budget bar, category breakdown, expandable details
- [ ] **Cache viewer** — Tier blocks, stability bars, recent changes, fuzzy filter
- [ ] **Settings panel** — Config type cards, edit/reload buttons, toast feedback
- [ ] **History browser** — Modal overlay, session list, search, message preview, load into context
- [ ] **Git action buttons** — Copy diff, commit with LLM message, reset with confirmation
- [ ] **Token HUD overlay** — Post-response floating overlay with cache stats, auto-hide

### Phase 9: Polish
- [ ] **Build pipeline** — Production bundling, versioned deployment, CI
- [ ] **Hosted deployment** — GitHub Pages with version registry, root redirect
- [ ] **Terminal HUD** — Cache blocks report, token usage, tier changes
- [ ] **Error handling** — Graceful degradation, reconnection indicator, toast system
- [ ] **State persistence** — Local storage for UI preferences (panel width, collapsed state, search options)
- [ ] **Content-visibility optimization** — CSS containment for off-screen messages
- [ ] **Accessibility** — ARIA roles, focus management, keyboard shortcuts
