# Architecture

The big-picture view of AC⚡DC. A new reader should understand the complete system from this file alone, then dive into specific specs for detail.

## System Overview

AC⚡DC is an AI-assisted code and documentation editor that runs as a local terminal process and presents its UI in the browser. A single Python process hosts all backend services; a Lit-based single-page webapp connects to it over a WebSocket. The user selects files to include in context, chats with an LLM (via litellm — any provider), and receives structured edit blocks the backend applies to disk after validation. The system's distinguishing property is stability-based prompt cache tiering: content that stays unchanged across requests migrates into cached blocks aligned with provider cache breakpoints, reducing per-request cost for large contexts.

```
┌────────────────────────────────────────────────────────────────┐
│                        Browser (Lit SPA)                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ Chat     │ │ Files    │ │ Context  │ │ Settings │           │
│  │ panel    │ │ tab      │ │ tab      │ │ tab      │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│  ┌────────────────────────────┐ ┌────────────────────┐          │
│  │ Diff viewer (Monaco)       │ │ SVG viewer         │          │
│  └────────────────────────────┘ └────────────────────┘          │
└───────────────────────────┬────────────────────────────────────┘
                            │ JSON-RPC 2.0 over WebSocket (jrpc-oo)
                            │ bidirectional — either side calls
┌───────────────────────────┴────────────────────────────────────┐
│                     Python backend (single process)             │
│                                                                 │
│  ┌───────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ ┌────────────┐ │
│  │ Repo  │ │ LLMSvc   │ │ Settings │ │ Collab │ │ DocConvert │ │
│  │ (git) │ │ (streams)│ │ (config) │ │ (admit)│ │ (markitdn) │ │
│  └───────┘ └──────────┘ └──────────┘ └────────┘ └────────────┘ │
│       │          │                                              │
│  ┌────┴──┐  ┌────┴─────────────┐ ┌──────────────────┐          │
│  │Symbol │  │ Context manager  │ │ Stability tracker│          │
│  │index  │  │ File context     │ │ L0–L3 + active   │          │
│  │Doc    │  │ History (JSONL)  │ │ Hash-based       │          │
│  │index  │  │ Compactor        │ │                  │          │
│  └───────┘  └──────────────────┘ └──────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
       │             │              │
   ┌───┴───┐    ┌────┴─────┐    ┌───┴────────┐
   │ git   │    │ LLM      │    │ filesystem │
   │ repo  │    │ provider │    │ .ac-dc4/   │
   └───────┘    └──────────┘    └────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|---|---|
| **Repo** | Git operations, file I/O, file tree, search, per-path write mutex |
| **LLMService** | Chat streaming, context assembly, URL handling, commit flow, mode switching, review mode |
| **Settings** | Config read/write/reload with whitelisted type set |
| **Collab** | Connection admission, client registry, role queries (optional, gated on `--collab`) |
| **DocConvert** | Document format conversion (docx, pdf, pptx, xlsx, etc. → markdown) |
| **Symbol index** | Tree-sitter parsing, cross-file reference graph, compact map for LLM |
| **Doc index** | Markdown + SVG outline extraction, keyword enrichment, doc reference graph |
| **Context manager** | Conversation history, file context, token budget, prompt assembly |
| **Stability tracker** | Per-item tier state (L0–L3 + active), promotion/demotion cascade |
| **History store** | Append-only JSONL persistence of conversations |
| **History compactor** | LLM-driven topic boundary detection and summarization |
| **App shell** | WebSocket client, server-push routing, dialog host, global shortcuts |
| **Dialog tabs** | Chat, Context, Settings, Doc Convert — tab-switched UI surfaces |
| **Viewers** | Monaco diff viewer (text), SVG viewer (vector graphics), file nav grid |
| **Token HUD** | Floating transient overlay with per-request token breakdown |

## Process Model

One Python process hosts everything:

- A built-in HTTP static file server serves the bundled webapp on one port (default 18999)
- A jrpc-oo WebSocket server handles all RPC on another port (default 18080)
- An asyncio event loop drives both servers and most coordination work
- Two `ThreadPoolExecutor` pools handle CPU-bound work — one for LLM streaming (long-running blocking calls into litellm), one for auxiliary tasks (commit message generation, topic detection, doc conversion, keyword enrichment)

The browser receives the webapp over HTTP, opens a WebSocket back to the server, and does all further communication over that single connection. Either side can call methods on the other — the backend pushes `streamChunk` / `streamComplete` / `compactionEvent` / broadcast events to the browser; the browser calls everything else (file reads, chat, settings, etc.).

Bind addresses default to `127.0.0.1` (loopback only). Passing `--collab` on the CLI binds to `0.0.0.0` and activates the admission-gated collaboration mode — remote clients can connect but the first client is always auto-admitted as host, and all subsequent clients require explicit admission by the host.

## Layered Dependency Model

The backend and frontend are organised in dependency layers. Each layer depends only on layers below it. Specs are numbered to match.

**Layer 1 — Foundation.** RPC transport (jrpc-oo over WebSocket), configuration (file locations, hot reload, managed vs user files), repository (git operations with per-path write mutex).

**Layer 2 — Indexing.** Symbol index (tree-sitter for Python/JS/TS/C/C++, compact map output), document index (markdown + SVG outline extraction), reference graphs (code → code, doc → doc, doc → code), keyword enrichment (optional KeyBERT for disambiguating similar headings).

**Layer 3 — LLM engine.** Context manager (file context + conversation history + URL context + review context), history persistence + compaction, stability tracker with L0–L3 tiering, prompt assembly with cache-control placement, streaming pipeline with edit block parsing and application, mode switching (code ↔ document), cross-reference overlay.

**Layer 4 — Features.** URL content fetching and summarization, image persistence (paste-to-chat, thumbnails, re-attach), code review mode (read-only via git soft reset), collaboration (admission flow, restriction policy, mode sync), document conversion backend.

**Layer 5 — Webapp.** App shell (WebSocket owner, dialog host, startup overlay), chat panel (streaming display, message rendering, input area), file picker (tree with git status), diff viewer (Monaco + markdown/TeX preview + LSP), SVG viewer (pan/zoom + visual editor), file navigation grid (spatial 2D with Alt+Arrow), context tab (budget + cache sub-views), settings tab, token HUD, doc convert tab.

**Layer 6 — Deployment.** Vite build for webapp, PyInstaller single-file binaries per platform, startup sequencing (fast phase + deferred heavy init), graceful shutdown, config directory upgrade on version change.

**Layer 7 — Future.** Speculative parallel-agent architecture and the specs-reference migration plan. Not for implementation.

Implementers working bottom-up complete and test each layer before starting the next. specs4/0-overview/implementation-guide.md describes the build order and which specs4 contracts must be preserved from day one to make the future parallel-agent mode possible without refactoring.

## Key Data Flows

### Chat Request

1. User types in the chat textarea and clicks Send
2. Browser generates a request ID, shows the user message optimistically, calls `LLMService.chat_streaming(requestId, message, files, images)`
3. Server returns `{status: "started"}` synchronously; the real work runs in a background task
4. Background task syncs file context (removes deselected files, loads newly selected ones), re-indexes changed files, detects and fetches any URLs in the prompt (up to 3 per message), persists the user message to history
5. Broadcasts `userMessage` to all connected clients (collaborators see it immediately)
6. Assembles the prompt — system message (with cache-control marker), L0–L3 cached tier blocks, uncached file tree + URL context + active files, then the current user message with system reminder appended
7. Calls `litellm.completion(stream=True)` in a worker thread; each chunk is pushed via `streamChunk` RPC
8. After the stream completes, parses edit blocks from the response, validates against file content (unique anchor match), applies approved edits via the repo's per-path mutex, stages modified files in git
9. Runs stability tracker update (hash each active item, promote / demote / graduate / cascade)
10. Checks history size against the compaction threshold; if over, runs topic boundary detection and summarization, replaces in-memory history with the compacted version
11. Sends `streamComplete` with the final result (response text, edit results, shell commands, token usage, finish reason)

### Cache Tiering Cascade

1. Each tracked item carries an `N` value — consecutive unchanged appearances in active context
2. New items enter at active with N=0; each request increments N by 1 if the content hash is unchanged
3. Items reaching the graduation threshold (default N≥3) move to L3 on the next cycle
4. In L3, items continue incrementing N; above the L3 promotion threshold they become eligible to move up to L2, then L1, then L0 (terminal)
5. Content hash mismatch demotes an item back to active with N=0
6. When a tier loses items (demotion, deselection, invalidation) it becomes "broken" and the cascade runs bottom-up: L3 veterans fill the L3 gap, L2 veterans fill L2, and so on
7. Threshold-aware anchoring: items in a tier that's below cache-target tokens can't promote out (would break caching); items past the anchor line promote normally
8. Post-cascade consolidation: any underfilled tier demotes its items one level down to avoid wasting a cache breakpoint

### Mode Switching (Code ↔ Document)

1. User clicks the mode toggle in the dialog header
2. Frontend calls `LLMService.switch_mode("doc")` (or "code")
3. Server resets cross-reference toggle to off
4. Re-extracts doc file structures (mtime-based — only changed files re-parsed, instant)
5. Queues changed files for background keyword enrichment
6. Preserves file selection across the switch
7. Swaps system prompt (main ↔ document-focused)
8. Swaps snippet set (code ↔ doc)
9. Switches to the mode-specific stability tracker (each mode has its own instance, state preserved)
10. Inserts a mode-switch system event message in conversation history
11. Broadcasts `modeChanged` to all clients

### File Selection Sync

1. User toggles a checkbox in the file picker
2. Picker dispatches `selection-changed` up through the files tab
3. Files tab calls `LLMService.set_selected_files(paths)`
4. Server updates its authoritative selected-files list
5. Server broadcasts `filesChanged` to all connected clients (including the originator)
6. Each client's files tab receives the broadcast and applies it via direct property assignment to the picker (bypassing Lit's reactive re-render, which would reset scroll and interaction state)

### Collaboration Admission

1. New WebSocket connects; server detects this is not the first connection
2. Server sends a raw `admission_pending` WebSocket message (pre-JRPC) to the connecting client; client shows a waiting screen
3. Server broadcasts `admissionRequest` to all admitted clients; a toast appears for every admitted user
4. Any admitted user clicks Admit or Deny; the RPC runs on the host's behalf
5. On admit, the server completes the JRPC handshake; the new client becomes a full participant
6. On deny, the server closes the WebSocket with code 1008
7. 120-second timeout — unanswered requests auto-deny; same-IP requests replace older pending requests before they expire

### Edit Block Application

1. LLM response is parsed for edit blocks (bracketed by orange / yellow / green emoji markers)
2. Each block has a file path, old text (the anchor), and new text (the replacement)
3. Parser handles streaming — partial blocks are held until the end marker arrives
4. For each complete block, the apply pipeline validates: file exists (except for create blocks), not binary, old text is found exactly once (unambiguous)
5. Unique match → write new content to disk; stage in git
6. Zero matches → failed with diagnostic; suggests retry with more context
7. Multiple matches → failed as ambiguous; auto-populates retry prompt
8. Files referenced by failed edits where the file isn't in active context → auto-added to selection for the next request
9. Sequential application within a batch — each edit sees the file state after prior edits in the same batch

## Stability and Caching

Large prompts are expensive. A session with a symbol map, several open files, and a long conversation history can easily reach tens of thousands of input tokens per request. Most provider APIs (notably Anthropic) support prompt caching — the client marks specific content blocks as cacheable, and subsequent requests within a short window pay a reduced rate for hits on that cached prefix.

AC⚡DC organises LLM content into five stability levels:

| Tier | Role | Entry N | Terminal? |
|---|---|---|---|
| **L0** | Most stable — system prompt, legend, highly-referenced files | 12 | Yes (no further promotion) |
| **L1** | Very stable — core project files referenced by many others | 9 | No |
| **L2** | Moderately stable — supporting files | 6 | No |
| **L3** | Entry tier for graduated content | 3 | No |
| **active** | Uncached — recently changed, newly selected, or current-turn content | 0 | N/A (source tier for graduation) |

Each cached tier maps to one `cache_control` marker in the assembled prompt. Anthropic allows up to 4 breakpoints per request, which is why there are four cached tiers. Content in L0 changes least often; content in L3 may churn more. As items stabilise over multiple requests, they migrate upward through the cascade; when content changes, they demote back to active and start over.

The tracker's job is to decide, before each request, which items belong in which tier. The goal is to minimise the total tokens sent to the provider uncached — by keeping as much stable content as possible within cached blocks the provider recognises from prior requests.

Per-model minimums vary (4096 tokens for Opus 4.5/4.6, 1024 for Sonnet) and an underfilled tier won't actually be cached by the provider. The tracker uses `cache_target_tokens = max(user_min, model_min) × buffer_multiplier` as the floor — tiers below target get their items demoted one level to consolidate rather than waste a breakpoint.

See [cache-tiering.md](../3-llm/cache-tiering.md) for the full algorithm.

## Code vs Document Mode

AC⚡DC supports two primary operating modes. The mode determines which index feeds the LLM's structural view of the repository, which system prompt is active, and which snippet set is available.

| | Code mode | Document mode |
|---|---|---|
| Primary index | Symbol index (tree-sitter) | Document index (markdown + SVG) |
| System prompt | `system.md` (coding focus) | `system_doc.md` (documentation focus) |
| Snippets | Code snippets | Doc snippets |
| Map header | Repository structure | Document structure |

What stays the same across modes: the file tree, file selection, conversation history, edit protocol, compaction, review, URL handling, and search. A mode switch preserves the user's selected files so a single working set carries across.

**Cross-reference mode** is an optional overlay on either primary mode. When enabled in code mode, document index file blocks are added alongside symbol index entries — the LLM sees both. When enabled in document mode, symbol index file blocks are added alongside doc entries. Both legends appear in L0 and the same tier can contain a mix of symbol-prefixed and doc-prefixed items. Cross-reference resets to off on every mode switch.

See [modes.md](../3-llm/modes.md) for the full switching protocol.

## Cross-Cutting Concerns

### Path Handling

All file paths are relative to the repository root. The path validator at the Repo layer rejects `..` traversal, symlinks that escape the repo, and absolute paths that resolve outside the repo. Every file operation on the server side goes through this validator. The frontend's file picker and viewers deal only with repo-relative paths as strings.

### Error Surfaces

Three places errors reach the user:

1. **Toasts** — transient notifications at the top-right of the viewport for brief, non-conversational feedback (save success, restricted-in-collab, clipboard copy confirmation). Auto-dismiss.
2. **Assistant message errors** — when the LLM call itself fails or is cancelled, the chat panel renders an error card inline with the conversation. Part of the message flow the user is already looking at.
3. **System event messages** — operational events the LLM should also see (commit, reset, mode switch, compaction) appear as pseudo-user messages with a distinct card style. Persisted in history and fed to the LLM on the next turn so it has the same view of the session the user does.

### Localhost-Only vs Shared State

All state is shared across connected clients by default — selected files, conversation history, streaming responses all broadcast to every admitted remote. But every mutating operation is guarded: non-localhost participants receive `{error: "restricted", reason: ...}` instead of the normal return value. Read operations (file content, symbol map, history browsing, search) work for everyone. The effect is a shared read-only view with write privileges reserved to the host machine.

Single-user mode (no `--collab` flag) attaches no `Collab` instance; the `_check_localhost_only()` helper short-circuits to "allowed" and every caller is treated as localhost.

### Graceful Degradation

Optional dependencies can be missing without breaking core functionality:

| Dependency | Provides | Without it |
|---|---|---|
| **KeyBERT + sentence-transformers** | Doc index keyword enrichment | Outlines render without `(kw1, kw2)` annotations; one-time toast on first doc-mode switch |
| **markitdown** | Document conversion (docx / pdf / xlsx / csv / rtf / odt / odp) | Doc Convert tab hidden |
| **PyMuPDF** (`fitz`) | PDF text extraction and SVG export | `.pdf` unavailable; pptx/odp fall back to python-pptx or markitdown |
| **LibreOffice** (`soffice` on PATH) | Primary pptx/odp → PDF pipeline | pptx falls back to python-pptx (per-slide SVG); odp falls back to markitdown |
| **python-pptx** | Pptx fallback when LibreOffice unavailable | Pptx conversion fails with install-hint error |
| **openpyxl** | Colour-aware xlsx conversion | Xlsx falls back to markitdown (no cell colour preservation) |
| **trafilatura** | Main-content extraction from web pages | URL fetches use regex-based HTML stripping (lower quality) |
| **make4ht** + LaTeX | TeX preview (.tex/.latex in diff viewer) | Preview button replaced with install-hint pane |
| **tree-sitter language grammars** | Per-language symbol extraction | That language produces no symbols; file still editable |

No optional dependency is a hard prerequisite for the core chat + edit loop.

### Per-Repo Working Directory

Each repository gets a `.ac-dc4/` directory at its root, auto-created on first run and added to the repo's `.gitignore`. Contents: `history.jsonl` (conversation history), `images/` (persisted chat images), `doc_cache/` (keyword-enriched outline cache sidecars), `tex_preview/` (transient TeX compilation workspace), `agents/` (future parallel-agent archive). Per-repo rather than per-user so history survives switching machines via the same repo, and can be audited alongside code.

## Further Reading

For the full specification suite, see [specs4/README.md](../README.md). For the mechanical rule relating specs4 to specs-reference, see [specs-reference/README.md](../../specs-reference/README.md). For the clean-room implementation order and architectural contracts that must be preserved from day one, see [implementation-guide.md](implementation-guide.md). The high-level architecture diagram is at [specs4/architecture.svg](../architecture.svg).