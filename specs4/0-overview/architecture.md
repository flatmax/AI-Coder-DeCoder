# Architecture

**Status:** stub

The big-picture view of AC⚡DC. A new reader should understand the complete system from this file alone, then dive into specific specs for detail.

## System Overview

- One-paragraph mission statement
- Top-level system diagram (browser ↔ WebSocket ↔ backend ↔ git/LLM/filesystem)
- Component responsibility table

## Process Model

- Single Python process hosts: static file server (bundled webapp), WebSocket server (JSON-RPC), all services
- Browser connects via WebSocket, receives webapp via HTTP
- Event loop + worker thread pool for CPU-bound work (parsing, LLM streaming)

## Component Map

### Backend

- Repo — git operations and file I/O
- LLMService — chat streaming, context assembly, URL handling, history
- Settings — config read/write/reload
- Collab — connection admission and client registry (optional)
- DocConvert — document format conversion (optional)
- SymbolIndex — tree-sitter parsing, reference graph, compact map
- DocIndex — markdown/SVG outlines, keyword enrichment
- ContextManager — file context, history, token budget
- StabilityTracker — cache tier state
- HistoryStore — append-only JSONL conversation persistence
- HistoryCompactor — history summarization via LLM

### Frontend

- AppShell — root component, WebSocket client, routing
- Dialog — draggable/resizable tab host
- Viewers — DiffViewer (Monaco), SvgViewer, FileNavigation grid
- Tabs — chat, context, settings, doc convert
- Token HUD — floating transient overlay

## Key Data Flows

- **Chat request flow**: user input → file validation → context assembly → LLM stream → edit application → stability update → optional compaction
- **Cache tiering flow**: active items → N-value tracking → graduation → cascade promotion → demotion on hash change
- **Mode switch flow**: toggle → swap prompt → swap index → rebuild tier content → preserve history
- **File selection sync flow**: browser toggle → RPC → server state → broadcast → all clients update
- **Collaboration flow**: new connection → admission request → approval → full participation

## Stability and Caching

- Why caching matters: cost reduction with large contexts
- Stability tier model (L0–L3 + active) — one sentence per tier
- How tiers map to provider cache breakpoints

## Code vs Document Mode

- Two primary modes, toggleable
- What changes (index, system prompt, snippets) vs what stays (file tree, history, edit protocol)
- Cross-reference mode as an overlay

## Cross-Cutting Concerns

- Path handling (everything relative to repo root, traversal blocked)
- Error surfaces (toasts, assistant message errors, system event messages)
- Localhost-only vs shared state (collaboration restrictions)
- Graceful degradation when optional dependencies are missing (KeyBERT, markitdown, PyMuPDF, LibreOffice, make4ht)

## Diagrams Index

- System overview (Mermaid)
- Chat request lifecycle (Mermaid sequence)
- Cache tier cascade (ASCII)
- Mode switch (Mermaid state)
- Connection admission (Mermaid sequence)
- File selection propagation (Mermaid sequence)