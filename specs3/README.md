# Application Specification Suite

## What This Is

A complete specification for **AC⚡DC** — an AI-assisted code editing tool that runs as a terminal application with a browser-based UI. The tool helps developers navigate codebases, chat with an LLM, and apply structured file edits — all with intelligent prompt caching to minimize LLM costs.

## Architecture

```
┌─────────────────────────────────┐
│        Browser Webapp           │
│  (Web Components / Lit SPA)     │
│                                 │
│  ┌─────┐ ┌──────┐ ┌─────────┐ │
│  │Chat │ │Files │ │Diff Edit│ │
│  │Panel│ │Picker│ │Viewer   │ │
│  └──┬──┘ └──┬───┘ └────┬────┘ │
│     └────────┴──────────┘      │
│              │ WebSocket       │
│              │ (JSON-RPC 2.0)  │
└──────────────┼─────────────────┘
               │
┌──────────────┼─────────────────┐
│   Terminal Application         │
│              │                 │
│  ┌───────────┴──────────────┐  │
│  │    RPC Server (jrpc-oo)  │  │
│  └─┬──────────┬────────────┬┘  │
│    │          │            │   │
│  ┌─┴───┐ ┌───┴────┐ ┌────┴─┐ │
│  │Repo │ │LLM     │ │Config│ │
│  │Layer│ │Context │ │Mgmt  │ │
│  │(Git)│ │Engine  │ │      │ │
│  └─────┘ └────────┘ └──────┘ │
└────────────────────────────────┘
```

## Reading Order

The specs are organized into numbered layers. **Read bottom-up** — each layer depends only on layers below it.

### Layer 1: Foundation (no dependencies)

These specs are independent of each other. Start anywhere.

| Spec | Description |
|------|-------------|
| [Configuration](1-foundation/configuration.md) | Config files, loading, directory resolution, settings service |
| [Communication Layer](1-foundation/communication_layer.md) | Bidirectional RPC via jrpc-oo, WebSocket patterns, class registration |
| [Repository Operations](1-foundation/repository_operations.md) | Git operations, file tree, search, path handling |

### Layer 2: Code Analysis

Depends on: Repository (for file access)

| Spec | Description |
|------|-------------|
| [Symbol Index](2-code-analysis/symbol_index.md) | Tree-sitter parsing, extractors, compact format, reference graph, LSP |
| [Document Mode](2-code-analysis/document_mode.md) | Document index for markdown/SVG, cache tier integration, document mode toggle |

### Layer 3: LLM Engine (**read in order**)

Depends on: Symbol Index, Configuration. These five specs build on each other sequentially.

| Order | Spec | Description |
|-------|------|-------------|
| 1 | [Context and History](3-llm-engine/context_and_history.md) | Context manager, history store, compaction, token budgets |
| 2 | [Cache Tiering](3-llm-engine/cache_tiering.md) | Stability tracker, tiers, graduation, cascade, initialization |
| 3 | [Prompt Assembly](3-llm-engine/prompt_assembly.md) | Message array structure, headers, cache_control placement — **the single source of truth** |
| 4 | [Streaming Lifecycle](3-llm-engine/streaming_lifecycle.md) | Request flow, chunk delivery, cancellation, post-response processing |
| 5 | [Edit Protocol](3-llm-engine/edit_protocol.md) | Edit block format, parsing, validation, application |

### Layer 4: Features (independent of each other)

Each feature spec stands alone. Read as needed.

| Spec | Description |
|------|-------------|
| [URL Handling](4-features/url_handling.md) | Detection, fetching, summarization, caching (backend) |
| [Image Persistence](4-features/image_persistence.md) | Image storage, reconstruction, history integration |
| [Code Review](4-features/code_review.md) | Review mode via soft reset, symbol diff, review context |

### Layer 5: Webapp

Read after the backend layer each component visualizes. Frontend only — no backend logic.

| Spec | Description |
|------|-------------|
| [App Shell and Dialog](5-webapp/app_shell_and_dialog.md) | Root component, dialog, tabs, shortcuts, lifecycle |
| [Chat Interface](5-webapp/chat_interface.md) | Messages, streaming display, scrolling, input, file mentions |
| [File Picker](5-webapp/file_picker.md) | Tree view, selection, git status, context menu |
| [Diff Viewer](5-webapp/diff_viewer.md) | Monaco editor, tabs, save flow, LSP integration |
| [SVG Viewer](5-webapp/svg_viewer.md) | Side-by-side SVG diff with synchronized pan/zoom |
| [Viewers and HUD](5-webapp/viewers_and_hud.md) | Context viewer, cache viewer, token HUD |
| [Search and Settings](5-webapp/search_and_settings.md) | Search tab, settings tab |
| [URL Chips](5-webapp/url_chips.md) | URL detection display, fetch triggers, inclusion toggles |
| [Speech to Text](5-webapp/speech_to_text.md) | Web Speech API voice dictation |

### Layer 6: Deployment

| Spec | Description |
|------|-------------|
| [Build and Deployment](6-deployment/build_and_deployment.md) | Build pipeline, CI, versioning, startup sequence, CLI |

### Consolidated References

The [Communication Layer](1-foundation/communication_layer.md) spec contains:
- **RPC Method Inventory** — complete table of all RPC methods across all three service classes
- **File Selection Sync** — end-to-end browser↔server file selection flow
- **Server Initialization Pseudocode** — how services are constructed and registered

The [Prompt Assembly](3-llm-engine/prompt_assembly.md) spec contains:
- **Tiered Assembly Data Flow** — complete path from stability tracker → content gathering → message assembly

The [Streaming Lifecycle](3-llm-engine/streaming_lifecycle.md) spec contains:
- **streamComplete Result Schema** — typed schema for all result fields
- **Active Items Construction** — pseudocode for building the stability tracker input

## Core Concepts

### Bidirectional RPC
The terminal app and browser communicate symmetrically over WebSocket using JSON-RPC 2.0 (via jrpc-oo). Either side can call methods on the other. The server exposes repository, LLM, and config services. The client exposes streaming callbacks and UI event handlers.

### Stability-Based Cache Tiering
LLM prompt content is organized into stability tiers (L0–L3 + active). Content that remains unchanged across requests promotes to higher tiers, which map to provider cache breakpoints. This reduces re-ingestion costs for large contexts.

### Structured Edit Blocks
The LLM proposes file changes using a deterministic edit block format with anchored context matching. An anchor (common prefix) uniquely locates the edit site; old/new line sections define the replacement.

### Symbol Map
A compact, reference-annotated representation of the codebase structure. Generated via tree-sitter parsing, it gives the LLM a structural overview without including full file contents. Persisted to `.ac-dc/symbol_map.txt` and rebuilt before each LLM request.