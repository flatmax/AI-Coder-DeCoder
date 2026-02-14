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
- **Keyboard shortcuts** — Ctrl+S for save, Ctrl+Shift+F for global search; others added as needed

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
- [x] **History store** — JSONL persistence, session management, search, image persistence (`history_store.py`, `tests/test_history.py`)
- [x] **Topic detector** — LLM-based boundary detection with JSON parsing fallbacks (`topic_detector.py`)
- [x] **History compactor** — Truncation/summarization strategies with verbatim window (`history_compactor.py`)
- [x] **Compaction integration** — Post-response trigger in LLM service, stability re-registration, message persistence (`context.py`, `llm_service.py`)

### Phase 6: URL Handling ✅
- [x] **URL detector** — Pattern matching and type classification (`url_handler.py`)
- [x] **GitHub handler** — Shallow clone, README, symbol map generation (`url_handler.py`)
- [x] **Web handler** — Content extraction with fallback (`url_handler.py`)
- [x] **URL cache** — Filesystem TTL cache (`url_cache.py`)
- [x] **Summarizer** — Type-aware LLM summarization (`url_handler.py`)

### Phase 7: Webapp Foundation ✅
- [x] **Build setup** — Vite config, npm project, Lit dependency, jrpc-oo browser integration
- [x] **App shell** — Root component extending JRPCClient, WebSocket connection, dialog container
- [x] **Dialog component** — Dragging, resizing, minimizing, tab bar
- [x] **RPC mixin** — Shared singleton, convenience methods (extract, stateful call)
- [x] **Chat panel** — Message cards, markdown rendering, streaming display, scroll management
- [x] **Input handling** — Auto-resize textarea, Enter to send, image paste, snippet drawer
- [x] **jrpc-oo integration** — App shell extends JRPCClient, SharedRpc publishes call proxy on setupDone, RpcMixin for child components
- [x] **Input history** — Up-arrow fuzzy search overlay, history navigation
- [x] **URL chips** — Detection display, fetch triggers, inclusion toggles

### Phase 8: Webapp Features
- [x] **File picker** — Tree rendering, checkbox selection, git status badges, context menu
- [x] **File picker resize** — Draggable panel divider, collapse/expand, local storage persistence
- [x] **Streaming integration** — Chunk delivery, streamComplete, requestId correlation, streaming indicator
- [x] **Git action buttons** — Copy diff, commit with LLM message, reset with confirmation
- [x] **Search tab** — Full-text search with debounce, result grouping, keyboard navigation
- [x] **Context viewer** — Token budget bar, category breakdown, expandable details
- [x] **Cache viewer** — Tier blocks, stability bars, recent changes, fuzzy filter
- [x] **Settings panel** — Config type cards, edit/reload buttons, toast feedback
- [x] **History browser** — Modal overlay, session list, search, message preview, load into context
- [x] **File mentions** — Detect repo file paths in assistant responses, clickable links, summary chips, chat search, message actions, @-filter, input accumulation, toggle selection from mentions
- [x] **Diff viewer** — Monaco editor, side-by-side diff, language detection, dirty tracking, save flow
  - Monaco diff editor component with side-by-side view (original read-only, modified editable)
  - File tab bar with path, status badge (NEW/MOD), save button when dirty
  - Language detection from file extension
  - Per-file dirty tracking (savedContent vs current)
  - Single file save (Ctrl+S) and batch save
  - Monaco shadow DOM style injection (clone stylesheets, MutationObserver sync)
  - Worker-safe language handling (plaintext for built-in worker languages)
- [x] **Diff viewer layout** — Background placement, navigate-file routing, file-save handling, post-edit refresh
  - Background layer (position: fixed, inset: 0, z-index: 0) with AC⚡DC watermark
  - navigate-file event routing from file picker, search, chat edit blocks
  - HEAD vs working copy diff for applied edits
  - Post-edit refresh: only reload already-open files
  - Scroll-to-edit-anchor with progressive prefix search and 3s highlight
  - App shell wiring: route navigate-file, file-save events
- [x] **LSP integration** — Hover, definition, references, completions providers for Monaco
- [x] **Token HUD overlay** — Post-response floating overlay with cache stats, auto-hide
- [x] **Speech to text** — Auto-transcribe toggle using Web Speech API

### Phase 9: Polish (partial)
- [x] **Bedrock token usage** — Streaming usage capture for all providers
- [x] **Terminal HUD** — Cache blocks report, token usage, tier changes
- [x] **Server→browser callback wiring** — `AcApp.method` format for jrpc-oo class-prefixed calls, main event loop for async callbacks
- [x] **Brand watermark** — AC⚡DC branding displayed in diff viewer empty state (8rem, 18% opacity)
- [x] **Error handling** — WebSocket reconnection with exponential backoff (1s→2s→4s→8s→max 15s), reconnecting banner with attempt count, status bar (green on connect, red on disconnect), global toast system via `ac-toast` custom events, `rpcSafeExtract`/`rpcSafeCall` in RPC mixin for non-critical operations, `showToast()` helper on all RPC components, SharedRpc disconnect notification to listeners, `onRpcDisconnected()` hook in mixin
- [x] **Build pipeline** — Production bundling, versioned deployment, CI
- [x] **Hosted deployment** — GitHub Pages with version registry
- [x] **State persistence** — Local storage for UI preferences (dialog width/position/tab/minimized, HUD sections, cache/context expanded, review remotes, snippet drawer)
- [x] **Content-visibility optimization** — CSS containment for off-screen messages
- [x] **Duplicate streamChunk cleanup** — Only one streamChunk method in app-shell.js
- [x] **Git repo check** — When started outside a git repo, open a self-contained HTML page in the browser (shows AC⚡DC branding, repo path, and instructions), display terminal banner with `git init` and `cd <repo>` instructions, then exit
- [x] **Accessibility** — ARIA landmarks/roles on all components, Alt+1-5 tab switching, Alt+M minimize, focus trapping in modals/lightbox, Ctrl+S save in settings editor, aria-live regions for streaming/toasts/status, proper labeling on all interactive elements, keyboard-operable expandable sections, diff-viewer tab navigation, toast notifications with role=alert, URL chips with list semantics

### Phase 10: Code Review ✅
- [x] **Repo review methods** — `checkout_review_parent`, `setup_review_soft_reset`, `exit_review_mode`, `get_commit_graph`, `get_commit_log`, `get_commit_parent`, `is_clean`, `resolve_ref`, `get_review_changed_files`, `get_review_file_diff`
- [x] **Review mode state** — LLM service review state fields, `start_review`/`end_review`/`get_review_state`/`check_review_ready`, `symbol_map_before` capture, system prompt swap (`review.md` ↔ `system.md`)
- [x] **Review context assembly** — Review context block in prompt assembly (commits, pre-change symbol map, reverse diffs for selected files), `_build_review_context`, `set_review_context`/`clear_review_context` on ContextManager
- [x] **Git graph selector UI** — Floating draggable dialog with SVG commit graph, stable lane columns, frozen branch legend, lazy loading via scroll, commit click selection, branch disambiguation popover, clean tree check on open
- [x] **Git graph lane algorithm** — Client-side lane assignment from parent relationships, fork/merge edges with Bézier curves, lane dedup for shared tips, remote branch dashed lines
- [x] **Review banner** — File picker header showing branch, commit range, stats, exit button
- [x] **Review status bar** — Slim bar above chat input with diff inclusion count (`N/M diffs in context`), exit button, disabled commit button
- [x] **Review snippets** — Separate `review-snippets.json` config file, full replacement of snippet drawer when review active (not merged), `get_snippets()` checks `_review_active`
- [x] **Read-only edit mode** — Skip `apply_edits_to_repo` when `_review_active`, disable commit button in UI, edit blocks still rendered for reference