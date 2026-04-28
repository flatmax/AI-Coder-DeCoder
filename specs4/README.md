# AC⚡DC Specification Suite (specs4)

**Status:** Active — target specification for a clean-room reimplementation of AC⚡DC.

## Companion Tree: `specs-reference/`

A companion directory at the repo top level holds implementation detail that specs4 deliberately leaves unspecified — byte-level formats, numeric constants, persistent storage schemas, RPC argument shapes, dependency quirks. The two trees mirror each other: when implementing from `specs4/{path}/{name}.md`, also load `specs-reference/{path}/{name}.md` if it exists. Missing twins mean the specs4 spec is self-sufficient. See `specs-reference/README.md` for the full convention.

## What AC⚡DC Is

An AI-assisted code editing tool that runs as a terminal application with a browser-based UI. It helps developers navigate codebases, chat with an LLM, and apply structured file edits — all with intelligent prompt caching to minimize LLM costs. The tool also supports documentation work (markdown, SVG) via a dedicated document mode.

## Architecture at a Glance

```
Browser (Lit SPA) ←─ WebSocket / JSON-RPC 2.0 ─→ Python backend (git + LLM + indexing)
```

The backend exposes a repository layer, an LLM context engine, configuration management, and optional collaboration and document conversion services. The browser hosts a draggable dialog (chat, context, settings) over a full-viewport diff/SVG viewer.

See [`0-overview/architecture.md`](0-overview/architecture.md) for the complete picture.

## Reading Order

Specs are numbered in dependency order — bottom-up. Each layer depends only on layers below it.

| Layer | Contents |
|-------|----------|
| **0 Overview** | Architecture, glossary — start here |
| **1 Foundation** | RPC transport, RPC inventory, configuration, repository |
| **2 Indexing** | Symbol index, document index, keyword enrichment, reference graph |
| **3 LLM** | Context, history, cache tiering, prompt assembly, streaming, edit protocol, modes |
| **4 Features** | URL content, images, code review, collaboration, document convert |
| **5 Webapp** | Shell, chat, viewers, file picker, search, settings, and specialized components |
| **6 Deployment** | Build, startup, packaging |
| **7 Future** | Speculative designs — **not for implementation** |

## Conventions

- **Behavioral contracts, not implementation details.** Specs describe what must happen and what invariants must hold, not specific method names or field shapes (except at module boundaries like RPC, config files, persistent storage).
- **Single source of truth.** Each concept has one authoritative spec; others reference it without re-deriving.
- **Terminology is defined once** in [`0-overview/glossary.md`](0-overview/glossary.md).
- **Test invariants are inline** at the end of each spec — properties that must hold, not specific test functions.

## Stub Status

This suite is under construction. Files marked **Status: stub** contain section outlines but not full content. Completed files omit the marker.