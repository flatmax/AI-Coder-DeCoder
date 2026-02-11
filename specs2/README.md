# Application Specification Suite

## What This Is

A complete specification for an **AI-assisted code editing tool** that runs as a terminal application with a browser-based UI. The tool helps developers navigate codebases, chat with an LLM, and apply structured file edits — all with intelligent prompt caching to minimize LLM costs.

## Architecture at a Glance

```
┌─────────────────────────────────┐
│        Browser Webapp           │
│  (Web Components / SPA)        │
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

## Spec Index

| Spec | Description |
|------|-------------|
| [Communication Layer](communication_layer.md) | Bidirectional RPC between terminal and browser via jrpc-oo |
| [Repository Operations](repository_operations.md) | Git operations, file tree, search |
| [Symbol Index](symbol_index.md) | Code analysis, cross-file references, compact output |
| [LLM Context Engine](llm_context_engine.md) | Conversation management, token budgets, prompt assembly |
| [Cache Tiering System](cache_tiering.md) | Stability-based prompt cache optimization |
| [Edit Protocol](edit_protocol.md) | Structured file edit format, parsing, application |
| [Streaming Chat](streaming_chat.md) | Full request/response lifecycle |
| [History and Compaction](history_and_compaction.md) | Persistent history, topic detection, compaction |
| [URL Handling](url_handling.md) | URL detection, fetching, summarization, caching |
| [Configuration](configuration.md) | Config files, loading, hot-reload |
| [Prompt System](prompt_system.md) | System prompts, skill prompts, snippets |
| [Webapp Shell](webapp_shell.md) | Application shell, dialog, tabs, navigation |
| [Chat Interface](chat_interface.md) | Message rendering, streaming display, scrolling |
| [File Picker](file_picker.md) | Tree view, selection, git status |
| [Diff Viewer](diff_viewer.md) | Side-by-side editor, LSP features, save flow |
| [Cache and Context Viewers](cache_context_viewers.md) | Token budget and cache tier visualization |
| [Search Interface](search_interface.md) | Full-text search UI |
| [Settings Interface](settings_interface.md) | Config editing UI |
| [Speech to Text](speech_to_text.md) | Voice dictation via Web Speech API |
| [Build and Deployment](build_and_deployment.md) | Build pipeline, versioning, startup, README generation |

## Core Concepts

### Bidirectional RPC
The terminal app and browser communicate symmetrically over WebSocket using JSON-RPC 2.0 (via the jrpc-oo library). Either side can call methods on the other. The server exposes repository, LLM, and config services. The client exposes streaming callbacks and UI event handlers.

### Stability-Based Cache Tiering
LLM prompt content is organized into stability tiers (L0–L3 + active). Content that remains unchanged across requests promotes to higher tiers, which map to provider cache breakpoints. This dramatically reduces re-ingestion costs for large contexts.

### Structured Edit Blocks
The LLM proposes file changes using a deterministic edit block format with anchored context matching. An anchor (common prefix) uniquely locates the edit site; old/new line sections define the replacement. This is more reliable than raw diffs for LLM-generated code changes.

### Symbol Map
A compact, reference-annotated representation of the codebase structure. Generated via tree-sitter parsing, it gives the LLM a "map" of the repository without including full file contents — dramatically reducing token usage while maintaining navigability. The symbol map is persisted to `.ac-dc/symbol_map.txt` and rebuilt on startup and before each LLM request to ensure the AI always has current information.