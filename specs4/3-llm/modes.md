# Modes

**Status:** stub

The mode system determines which index feeds the LLM context, which system prompt is active, and which snippets are shown. Two primary modes (code, document) toggle between code-oriented and documentation-oriented workflows. Cross-reference mode is an overlay that adds the other index alongside the primary.

## Primary Modes

| Aspect | Code mode | Document mode |
|---|---|---|
| Primary index | Symbol index | Document index |
| System prompt | Main coding prompt | Document-focused prompt |
| Snippets | Code snippets | Doc snippets |
| Map header | Repository structure | Document structure |

File tree, conversation history, edit protocol, compaction, review, URL handling, and search are unchanged between modes.

## What Changes

- Symbol map is removed (doc map takes its place)
- System prompt is swapped
- Snippets returned by the snippet RPC switch to the doc variant
- Tier assembly dispatches to the doc index for content blocks
- Stability tracker switches to the mode-specific instance
- Mode-switch system event message is added to history

## What Stays the Same

- File tree visible to the user (all files remain listed regardless of mode)
- File selection is preserved across mode switches
- Conversation history, compaction, session management
- URL fetching and context
- Edit protocol
- Search
- Review mode works identically in either primary mode

## Cross-Reference Mode

- Overlay toggle that adds the *other* index alongside the primary
- Code mode + cross-reference — doc index file blocks added as doc-prefixed items
- Document mode + cross-reference — symbol index file blocks added as symbol-prefixed items
- Both legends included in the L0 cache block
- Tier dispatch is prefix-based (not mode-based), so the same tier can contain a mix of symbol and doc items
- System prompt does not change — the user is still coding or still documenting
- Reset to off on every mode switch

## Cross-Reference Activation

- Separate initialization pass appends cross-reference items without disturbing primary index items
- Uses the same reference-graph initialization algorithm with the cross-reference index's graph
- Cross-ref items receive the standard entry-N for their assigned tier

## Cross-Reference Deactivation

- All cross-reference items are removed from the stability tracker
- Affected tiers marked broken
- No rebalancing cascade run — keep it simple
- A toast notifies the user

## Cross-Reference Readiness

- Toggle always available once initial startup completes
- In code mode: doc index's structural extraction completes within a few hundred milliseconds of the ready signal, before any user interaction is possible; keyword enrichment may still be in progress, but unenriched outlines are sufficient for cross-reference tier assembly
- In document mode: symbol index is always available (initialized at startup)

## Mode Switching Mechanics

- Reset cross-reference toggle to off (remove cross-ref items from tracker if active)
- Re-extract doc file structures (mtime-based — only changed files re-parsed, instant)
- Queue changed files for background enrichment
- Preserve file selection
- Swap system prompt
- Swap snippets — snippet RPC returns the mode-appropriate array
- Switch to the mode-specific stability tracker instance
- Update stability with current context
- Rebuild tier content from the target mode's index
- Insert mode-switch system event message in conversation history

## Instant Mode Switches

- Structural re-extraction (under a few milliseconds per changed file) produces unenriched outlines immediately usable for tier assembly
- If any files need keyword re-enrichment (e.g., edited while in the other mode), they are queued for background enrichment
- The mode switch does not wait for enrichment to complete
- The keyword model is eagerly pre-initialized during startup so the first mode switch never triggers a multi-second model load

## Index Lifecycle in the LLM Service

- Both symbol index and doc index are held simultaneously
- Symbol index built during startup
- Doc index built eagerly in background after startup completes — structural extraction first, then keyword enrichment asynchronously per file with progress reported
- Structural extraction completes before any user interaction is possible, so mode toggle and cross-reference toggle are available immediately after startup
- Once both indexes are built, mode switches are instant

## Dispatch Mechanism

- Tier content builder checks the current mode and dispatches to the appropriate index
- Both indexes expose the same two methods needed by tier assembly — full map and per-file block
- A shared interface is not needed — the dispatch is a simple conditional
- Formatter selection follows the same pattern

## File Discovery

- Doc index orchestrator scans repo for supported extensions
- Files matching gitignore patterns and the working directory excluded
- Consistent with code index discovery

## History Across Mode Switches

- Conversation history is preserved as-is
- Messages generated under one system prompt remain when switching to the other mode and vice versa
- Mode-switch system event message provides sufficient context for the LLM to reinterpret prior messages
- If compaction runs after a mode switch, the compaction prompt uses the current mode's prompt

## Mode Persistence

- Current mode stored in browser localStorage under a repo-scoped key
- On first connection after server restart, the client reads the saved preference and switches if it differs from the backend's default
- A legacy bare key is migrated to the repo-scoped key once
- Backend does not persist mode state — defaults to code mode on startup

## Stability Tracker Lifecycle

- Two independent tracker instances held — one for code mode, one for document mode
- Each tracks its own tier state, graduation history, and content hashes
- Mode switching activates the appropriate tracker; the inactive instance retains its state so switching back is instant
- Both trackers initialized lazily — the document tracker is created on first switch to document mode

## Mode Switch Race Prevention

- Mode-switch RPC is guarded by an in-flight flag on the client
- While the flag is set, mode-refresh checks skip both backend polling and saved-preference auto-switching
- Prevents a race where a post-switch event triggers a mode refresh that reads the stale preference and attempts to switch back

## Collaboration Mode Sync

- Mode-refresh syncs localStorage to the server's authoritative mode after every check
- Prevents non-localhost clients (who cannot initiate mode switches) from reading a stale preference and attempting to correct the mode back
- Auto-switch path is gated on the mutation-allowed flag — non-localhost clients skip it and passively follow the server's reported mode
- Cross-reference toggle changes are broadcast so all clients stay in sync

## Non-Localhost Behavior

- Non-localhost participants cannot initiate mode switches
- They passively follow the server's authoritative mode via mode-changed broadcasts
- UI affordances for switching are hidden or disabled on non-localhost clients

## Snippets Swapping

- Snippet RPC checks review-mode state first, then document-mode state, and returns the appropriate array
- Frontend does not distinguish between modes — it always calls the single snippet RPC and renders whatever is returned
- Two-location fallback applies to the unified snippets file — repo-local override first, then app config directory

## Invariants

- File selection is never lost on mode switch
- Cross-reference toggle always resets to off on mode switch
- Mode-switch system event is always recorded in conversation history
- Cross-reference items never persist in the tracker after cross-reference is disabled
- Non-localhost clients never attempt to initiate a mode switch
- The two stability tracker instances never share state