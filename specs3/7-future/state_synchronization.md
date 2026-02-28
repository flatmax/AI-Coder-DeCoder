# State Synchronization — Next-Generation Architecture

## Overview

This specification describes the target architecture for a future major version. The core principle: **Python is the single source of truth**. Every state mutation that affects shared state must round-trip through the server, which broadcasts the authoritative result to all connected remotes.

The current codebase already follows this pattern in several key areas. This spec formalizes the principle and identifies where a future version should extend it universally.

## What Already Works

The existing architecture is heavily Python-authoritative. These flows already round-trip correctly:

| Action | Flow |
|---|---|
| File selection | Webapp → `set_selected_files` RPC → Python stores → broadcasts `filesChanged` to all |
| Chat streaming | Python streams → pushes `streamChunk`/`streamComplete` to all clients |
| User messages | Webapp → RPC → Python → broadcasts `userMessage` to all |
| Mode switch | Webapp → RPC → Python → broadcasts `modeChanged` to all |
| Commit | Webapp → RPC → Python drives git → broadcasts `commitResult` to all |
| Session change | Webapp → RPC → Python → broadcasts `sessionChanged` to all |
| Compaction | Python runs compaction → broadcasts `compactionEvent` to all |
| Client admission | Python manages queue → broadcasts `admissionRequest`/`admissionResult` |
| Role changes | Python assigns → broadcasts `roleChanged` |

The mechanism is jrpc-oo's bidirectional WebSocket calling combined with `Collab._broadcast_event`. Python can call methods on any or all connected remotes at any time.

## The Round-Trip Rule

> If an action changes state that another client should see, the webapp MUST call an RPC method on Python. Python validates, applies the mutation to its authoritative state, and broadcasts the result to ALL connected clients — including the originator.

The originator sees its own change arrive via the broadcast, identical to every other client. This eliminates divergence where the originator applied a local change that the server rejected or transformed.

### The Locality Exception

Pure UI preferences that have no shared meaning are exempt from the round-trip rule:

- Window position, size, docking state
- Tree node expand/collapse
- Tab selection
- Search input and highlights
- Input history
- Scroll position within files
- Snippet drawer open/close
- Theme preferences
- `localStorage` persistence

These remain per-browser and never touch the server.

### The Hybrid Case

Some state has both a shared component and a local rendering concern. For example:

- **Which file is open** — shared (collaborators can follow along)
- **Scroll position within that file** — local (each user reads at their own pace)

The shared part round-trips through Python. The local part stays in the browser.

## Server-Side State Authority

Python already owns all shared state. This section formalizes the authoritative locations:

### LLMService

| State | Location |
|---|---|
| Selected files | `FileContext._files` |
| Conversation history | `ContextManager._history` |
| Active mode (code/doc) | `ContextManager._mode` |
| Stability tiers | `StabilityTracker._items` |
| Review state | `LLMService._review_*` fields |
| URL fetch state | `URLService._fetched` |
| Cross-reference toggle | `LLMService._cross_ref_enabled` |
| Compaction status | `ContextManager` + `HistoryCompactor` |

### Repo

| State | Location |
|---|---|
| File tree | `Repo.get_file_tree()` (derived from git) |
| Staged files | Git index (via `Repo.stage_files`) |
| Current branch | `Repo.get_current_branch()` |

### Collab

| State | Location |
|---|---|
| Connected clients | `Collab._clients` |
| Admission queue | `Collab._pending` |
| Roles | Per-client in `_clients` dict |

## Areas for Future Extension

The following areas currently work but do not broadcast state changes to other clients. A future version should add broadcast events for these:

### URL Chip State

When URLs are fetched, excluded, included, or removed, only the acting client sees the change. A `urlStateChanged` broadcast would keep all clients' chip displays in sync.

### Git Staging State

After `stage_files`, `unstage_files`, or `discard_changes`, the file picker refreshes locally but other clients don't learn about the staging change until their next tree reload. A `stagingChanged` broadcast would close this gap.

### Review Mode Transitions

Review entry and exit broadcast mode changes, but the detailed review state (selected review files, diff counts) is not pushed to other clients. A `reviewStateChanged` broadcast would let collaborators see review progress.

### Branch Changes

After checkout or review mode git operations, other clients don't learn the branch changed. A `branchChanged` broadcast would keep branch badges accurate everywhere.

## Reference Implementation

The file selection flow in the current codebase is the canonical example of the round-trip rule done correctly:

1. `ac-files-tab.js` catches the selection change event
2. Calls `rpcCall('set_selected_files', newSelection)` — does NOT update local state
3. Python's `LLMService.set_selected_files` stores the new selection
4. Python calls `_broadcast_event('filesChanged', selectedFiles)` on all remotes
5. `app-shell.js` receives the `filesChanged` callback, dispatches a DOM event
6. `file-picker.js` re-renders checkboxes from the authoritative state

Every client — including the one that initiated the change — receives the same broadcast and renders from the same data.

## Key Invariant

> At any point in time, if two clients query the same piece of shared state, they MUST receive the same answer. The only acceptable source for that answer is Python.

## Optimistic Updates (Deferred)

For low-latency interactions, strict round-trip may feel sluggish. An optimistic update pattern (apply locally with a pending marker, reconcile on broadcast receipt, roll back on error) could be introduced where measured latency warrants it. This adds complexity and is explicitly deferred until the round-trip rule has been applied universally and latency has been measured in real multi-client scenarios.

## Relationship to Existing Specs

| Spec | Relationship |
|---|---|
| [Communication Layer](../1-foundation/communication_layer.md) | Defines the RPC and streaming infrastructure this builds on |
| [Collaboration](../4-features/collaboration.md) | Defines client admission, roles, and the `Collab` service |
| [Streaming Lifecycle](../3-llm-engine/streaming_lifecycle.md) | Already follows the round-trip rule for all LLM interactions |
| [Chat Interface](../5-webapp/chat_interface.md) | Already follows the rule for message sending and file mentions |
| [File Picker](../5-webapp/file_picker.md) | File selection sync is the reference implementation |