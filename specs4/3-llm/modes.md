# Modes

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
- Items are distributed across L0, L1, L2, and L3 — never landing in the ACTIVE tier
- Clustering via connected components bin-packs items into L1/L2/L3 by component size
- Post-measurement L0 backfill promotes the most-referenced cross-reference files into L0 until its token total meets the cache-target overshoot threshold
- Primary-index items already resident in L0 are never evicted — only L1/L2/L3 candidates are considered for the backfill promotion
- Cross-ref items receive the standard entry-N for their assigned tier
- Items already tracked (e.g., from a prior enable that left state behind, or a primary-index item under the same key) are never overwritten

## Cross-Reference Deactivation

- All cross-reference items are removed from the stability tracker
- Affected tiers marked broken
- No rebalancing cascade run — keep it simple
- A toast notifies the user

## Cross-Reference Readiness

Two distinct readiness phases — structure-ready (minimum for cross-reference to produce content) and enriched-ready (keyword enrichment complete, outlines carry disambiguating annotations):

- **Structure ready** — doc index's structural extraction complete, reference graph built. Exposed as `doc_index_ready` on the mode-state RPC. Cross-reference toggle gates on this flag — enabling before structure is ready returns an error. Typically completes within a second or two after the startup ready signal for any reasonable repo size
- **Enriched ready** — keyword enrichment complete for all outlines. Exposed as `doc_index_enriched`. When structure is ready but enrichment is still running, cross-reference works with unenriched outlines; as enrichment completes, affected outlines re-hash (keywords contribute to the signature) and the tracker demotes them once. They re-stabilize at their tiers over the next few requests

Symmetric in doc mode — symbol index is always available (initialized synchronously at startup, matching the code-mode baseline), so cross-reference in doc mode never waits on a readiness gate.

UI toggle state:

- Disabled until `doc_index_ready`
- Enabled and functional once structure is ready, regardless of enrichment state
- No visual distinction between "enabled with enrichment pending" and "enabled with enrichment complete" — the distinction is invisible to the user beyond the keyword annotations appearing in outlines

## Mode Switching Mechanics

- Reset cross-reference toggle to off (remove cross-ref items from tracker if active)
- Re-extract doc file structures (mtime-based — only changed files re-parsed, instant)
- Queue changed files for background enrichment
- Preserve file selection
- Swap system prompt
- Swap snippets — snippet RPC returns the mode-appropriate array
- Switch to the mode-specific stability tracker instance
- Initialize the target tracker if it hasn't been initialized yet (first switch into a mode seeds tier assignments from that mode's reference graph; subsequent switches preserve the existing state)
- Update stability with current context
- Rebuild tier content from the target mode's index
- Insert mode-switch system event message in conversation history

## Instant Mode Switches

- mtime-based cache makes unchanged files free; only edited files re-parse (under a few milliseconds each)
- Structural extraction produces unenriched outlines immediately usable for tier assembly
- If any files need keyword re-enrichment (edited while in the other mode), they are queued for background enrichment
- The mode switch does not wait for enrichment to complete — the target mode's cached state, enriched or not, is used immediately
- The keyword model is eagerly pre-initialized during startup so the first mode switch never triggers a multi-second model load

## Index Lifecycle in the LLM Service

- Both symbol index and doc index are held simultaneously
- Symbol index built during startup (synchronous phase 1 plus deferred phase 2)
- Doc index built in the background after startup completes — structural extraction first (fast, bounded by file count), then keyword enrichment asynchronously per file with progress reported
- Mode toggle always available; cross-reference toggle gates on `doc_index_ready` (structural extraction complete) so the user never tries to enable cross-reference against an empty doc index
- Once both indexes have completed structural extraction, mode switches are instant and cross-reference works
- Keyword enrichment continues in the background after structure-ready; completions re-hash affected outlines and the tracker handles the demote-and-re-stabilize cycle naturally

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
- Both trackers are constructed and initialized lazily — the document tracker is created AND seeded from the doc index on first switch to document mode; the code tracker likewise if the session starts in doc mode
- Initialization is per-tracker — a tracker whose init ran once preserves its tier state across mode-switch round-trips and does not re-initialize

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