# Agent Browser

Agents surface as additional tabs in the existing chat panel. There is no separate browser view, no column strip, no dedicated UI protocol for agent interaction. Each agent is a chat conversation; the chat panel is already the right UI for a chat conversation; adding more tabs is the entire user-facing change.

The main LLM's own conversation — decomposition, agent-output review, iteration decisions, synthesis — lives in the main tab as normal assistant messages. Agents' conversations live in their own tabs. The user switches tabs to watch, read, or interact.

## Tab Strip

The chat panel gains a tab strip along its top edge:

- **Main** — always present. The user↔main-LLM conversation, unchanged from today's chat UX.
- **Agent 0, Agent 1, ... Agent N−1** — one tab per agent the main LLM spawned for the active turn. Appear when the turn's agent-spawn blocks are parsed. Persist until the user starts a new agentic turn in the main tab.

Tab labels carry the agent index plus a short summary derived from the spawn block's `task` field — "Agent 0: auth refactor", "Agent 1: logging format." When the tab strip exceeds the viewport width, the strip scrolls horizontally; a menu affordance lists all tabs by summary for direct access.

The currently-active tab is visually distinguished. Every input affordance on the chat panel (textarea, send button, snippet drawer, file picker bindings) targets the active tab's conversation.

Each tab carries three inline affordances, all invisible by default and fading in on hover / active / focus:

- **📊 Context icon** — leftmost, before the label. Opens the Context overlay scoped to this tab's conversation. Always rendered (Main and every agent), since every conversation has its own breakdown to view. Clicking activates the tab AND switches the dialog to Context; clicking again on the already-active tab still re-opens Context, treating the icon as a "show me Context for this" gesture rather than a state toggle. Placed leftmost so it remains visible even when long agent labels truncate the right edge of the tab.
- **Streaming indicator** — small pulsing dot between the context icon and the label when the tab has an in-flight stream. Visible on every tab regardless of active state, so users see work happening on tabs they aren't currently viewing.
- **✕ Close icon** — rightmost, agent tabs only. Main is never closable. Closes the tab and frees the backend scope.

The 📊 icon dispatches a bubbling `request-dialog-tab` event with `{tab: 'context'}` which the app shell catches and routes through `_switchTab`. The Context tab listens independently for `active-tab-changed` — that's the channel that drives its rescope, so the icon click and a normal tab click produce identical Context content for that tab.

## Status LEDs

The main tab's header carries a compact row of status LEDs — one dot for the main conversation plus one per agent tab currently in the strip. The LEDs are a derived view of conversation state, giving the user ambient awareness without forcing them to scan tab labels.

The main-tab LED is always present (the row exists whenever the chat panel is mounted) and follows the same colour rules as agent LEDs. Its presence regardless of whether agents have spawned means the LED row is the canonical place to look for "which conversation is active right now" — clicking the main LED switches focus back to the main tab the same way an agent LED activates its tab.

Each LED has three states:

- **Flashing cyan** — the agent's stream is active. The agent's request ID is in the chat panel's active-agent-streams set; equivalently, `streamComplete` has not yet fired for this agent's current run.
- **Solid green** — the agent's last `streamComplete` arrived without an `error` field, and every `EditResult` in the result reports success. The agent finished its work cleanly.
- **Solid red** — at least one of: the agent's last `streamComplete` carried an `error` field, any `EditResult` has `status="failed"` (anchor not found, ambiguous, binary file, path traversal), or the agent threw during assimilation. The agent needs the user's attention.

LED lifetime tracks the agent tab's lifetime exactly. When `agentsSpawned` adds a tab, the corresponding LED appears in flashing cyan. When the user closes the tab (close affordance → backend `closeAgentContext`), the LED disappears with it. There is no separate acknowledgement gesture — closing the tab is the acknowledgement.

Across turns within a session, an agent tab persists if the user does not close it (per [Tab Lifetime](#tab-lifetime)). Its LED reflects the *latest* event for that agent: a green LED from turn 1 returns to flashing cyan when the orchestrator re-uses the same agent ID in turn 3, then resolves to green or red based on the new turn's outcome. A red LED from a previous turn stays red until either the agent re-runs (state updates to whatever the new run produces) or the tab is closed.

### Click and hover

- Clicking a LED switches the active tab to that agent's tab — the same effect as clicking the tab itself, but the LED row is more compact and lives where the user's eyes already are when chatting in main. The tab strip also scrolls to reveal that tab's button if it was offscreen, so the LED row works as a navigation primitive even when many agents have pushed the active tab beyond the visible scroll window. Already-visible tabs do not jiggle — the scroll is a no-op when the target button is already on-screen.
- Hovering a LED shows a tooltip with the agent's mode and current-state reason:
  - Cyan: `<agent-id> (<mode>): running`
  - Green: `<agent-id> (<mode>): completed (N edits applied)`
  - Red: `<agent-id> (<mode>): <diagnostic>` — the failure reason from the failed `EditResult`, the streaming `error` field, or `assimilation failed` for sibling exceptions

`<mode>` is one of `code`, `doc`, `code+xref`, `doc+xref` — matching the orchestrator's per-agent state descriptor (see [parallel-agents.md — Per-agent state descriptor](../7-future/parallel-agents.md#per-agent-state-descriptor)). The tooltip is what turns a red LED from "something is wrong, go look" into "here is what is wrong, decide whether to click." It is essential for red but useful in all states.

### Layout

The LED strip sits below the chat panel's input textarea, above the compaction-capacity bar. Dots are centered horizontally, sized to be unobtrusive (small enough that 8-10 fit on one line without wrapping; the strip wraps to a second line if necessary). No background, no border — the strip floats over the input area's surface so it costs no extra vertical real estate compared to a separate container.

The strip is always visible while the chat panel is mounted — at minimum it carries the main-tab LED. With no agent tabs, the strip shows exactly one dot reflecting main-tab state. Dots reorder as agent tabs spawn and close; tab insertion order is preserved (main first, then agents in spawn order).

## Tab Lifetime

Four events end a tab's life:

- **New agentic turn in the main tab.** The user sends a new message to the main LLM that triggers a fresh decomposition. The current turn's agent tabs fade out of the strip; their archives persist on disk. Accessible by scrolling the main chat back to the previous turn and interacting with it via the history browser (see [Historical Turns](#historical-turns) below).
- **Explicit close.** Each agent tab has a close affordance. Closing an agent tab discards its `ContextManager` from memory (freeing any cached symbol map data it held, plus its stability tracker state). The archive file stays on disk. Equivalent to killing that agent — a subsequent LLM call for that tab is not possible because the ContextManager is gone. The user can still read the archive via history browsing.
- **`new_session` on the main tab.** Clicking the new-session button (or invoking the corresponding RPC) closes every live agent in addition to clearing main's history. The backend frees each agent's ContextManager, stability tracker, and file context, then broadcasts `agentClosed {agent_id}` per agent before broadcasting `sessionChanged`. The frontend's `agent-closed` window-event handler routes each id through the same close path explicit-close uses — the tab disappears, per-tab UI state frees, and the archive stays on disk. From the user's perspective, "new session" is a single gesture that resets main and dismisses the entire agent team. Archives remain browsable via history.

  This is asymmetric with main's own `new_session` behavior: main's `ContextManager` survives (only its history clears), while agents' ContextManagers are torn down entirely. The asymmetry reflects the asymmetry of intent — main is the user's primary conversation surface and persists for the application's lifetime; agents are turn-scoped collaborators the user spun up for a specific decomposition. A user starting a new session is most often signalling "I'm done with what these agents were helping me with"; preserving the team would force a follow-up close gesture per agent.
- **Server shutdown.** All in-memory state is lost regardless of tab type. Archives on disk survive; the next server startup can show them via history browsing.

An agent tab that finished streaming without being closed stays live indefinitely. The user can reply to it minutes, hours, or days later — as long as the session is alive, no new agentic turn has started, and `new_session` has not been clicked. Provider caching benefits accrue because the same ContextManager + StabilityTracker drive every subsequent call.

### Refresh and Reconnect

A browser refresh or WebSocket reconnect destroys and rebuilds the chat panel without ending the backend session. The backend's `_agent_contexts` registry is in-memory, scoped to the server process, and unaffected by frontend reload. Per [parallel-agents.md § Agent lifetime](../7-future/parallel-agents.md#agent-lifetime), live agents are part of the team until application exit; refresh is not application exit.

The chat panel rehydrates live tabs at the same moment it loads main-conversation history:

- On `onRpcReady` (initial connect or post-reconnect), the panel calls `list_live_agents()` (see [parallel-agents.md § Backend RPCs](../7-future/parallel-agents.md#backend-rpcs)). The response carries one entry per registered agent: `{id, mode, cross_reference_enabled, model, turn_id, agent_idx}`.
- For each entry, the panel creates a writable tab keyed by the agent's `id` — the same key that would be used had the tab been created by an `agentsSpawned` event during the spawn turn. Tab creation is idempotent, so a subsequent `agentsSpawned` for the same id is a no-op.
- For each tab, the panel calls `get_agent_history(agent_id)` to populate the message list. This returns the agent's full reconstructed conversation from its `ContextManager` — for session-reconstructed agents, this is the concatenation across every turn the agent participated in, not just the latest one. The live `ContextManager` is the source of truth for conversation content from this point forward; new messages append normally.
- Tabs are **writable**, not read-only. The distinction from historical tabs (see [Historical Turns](#historical-turns)) is that live tabs target a `ContextManager` that is still alive on the backend. The user can reply, grant files via the picker while the tab is active, or close the tab to kill the agent — the same affordances available before refresh.

What is genuinely lost across refresh:

- Per-tab input draft (textarea content)
- Per-tab scroll position within the message list
- In-flight streaming buffer for any stream active at refresh time — backend continues streaming to the now-disconnected websocket; on reconnect, the partial response is recoverable only via the archive once `streamComplete` lands. The reconstructed tab opens at the bottom of the archive's last persisted message; the in-flight tail is not replayed
- LED state computed from the most recent `streamComplete` event — recomputed from archive content on rehydration: green if the last persisted assistant message has no error metadata and every persisted edit succeeded, red otherwise. Cyan (active stream) is never recovered across refresh because the frontend cannot subscribe mid-stream

What is preserved:

- Agent identity (`id`)
- Agent mode and cross-reference flag
- Agent's full conversation as persisted to the archive
- Agent's file context, file selection, stability tracker, and provider-cache warmth (all backend-resident)
- The agent's tab badge if it had multiple iterations within the same turn (computed from archive content)

If `list_live_agents()` returns an empty list (no agents currently registered), the chat panel renders only the Main tab. This is indistinguishable from a fresh session that has never spawned agents.

### Session Load

Loading a previous session via the history browser is a distinct rehydration trigger from refresh / reconnect. Refresh / reconnect rehydrates against the *current* backend session — agents already in `_agent_contexts` materialise as tabs. Session load *changes* the backend's notion of which session is current, then reconstructs the agents that participated in that session as new live scopes.

The backend RPC `load_session_into_context(session_id)` does this work end-to-end (see [history.md § Session-Load Reconstruction](../3-llm/history.md#session-load-reconstruction)). Briefly:

1. Main's history clears and reloads from `history.jsonl` filtered to the target session.
2. The backend walks the loaded records for `agent_blocks` entries and groups them by agent id (latest record per id wins on retask).
3. For each surviving id, the backend reads every relevant turn's archive, concatenates the messages chronologically, replays mode-change system events to arrive at the agent's final mode, builds a fresh `ContextManager` + `StabilityTracker`, and registers in `_agent_contexts`.
4. `sessionChanged` fires first (the chat panel resets to the new session's main history). `agentsRehydrated` fires next, carrying only the just-reconstructed agent ids — agents already alive from the pre-load session are not re-broadcast.
5. The frontend's `agents-rehydrated` handler calls `rehydrateLiveAgents(panel)` — the same path used after `onRpcReady` for refresh / reconnect. Tab creation is idempotent; existing tabs short-circuit.

From the user's perspective, loading an old session restores not just the conversation but the team that was helping with it. Reconstructed agents are fully writable — the user can reply in their tabs, the orchestrator can retask them by id, the LED row reflects their state. Provider cache starts cold (the saved tracker's tier assignments aren't persisted; rebuilding from scratch is the only option), but everything else works.

What does NOT survive session load:

- Per-agent file selection (selections are ephemeral; even refresh today loses them)
- Per-agent excluded-files state (same)
- Provider-cache warmth (the rebuilt tracker has no tier placements)
- Frontend per-tab UI state (input draft, scroll position) — same loss as refresh

### Backend RPCs

The chat panel consumes a small RPC surface for agent-related work:

- `list_live_agents()` — one entry per registered agent: `{id, mode, cross_reference_enabled, model, turn_id, agent_idx}`. Called on `onRpcReady` for rehydration. Empty list when no agents are registered.
- `get_agent_history(agent_id)` — full reconstructed conversation for a live agent, by reading from its ContextManager. Used to populate live tabs after refresh, reconnect, or session load. Returns the concatenation across every turn the agent participated in (which matters for session-reconstructed agents that span multiple turns). Empty list for unknown ids.
- `get_turn_archive(turn_id)` — per-agent conversations for a single past turn, read from `.ac-dc4/agents/{turn_id}/`. Used for historical-tab population when scrolling the main chat back. Empty list when the directory doesn't exist.
- `close_agent_context(agent_id)` — frees the agent's ContextManager, tracker, and file_context. Idempotent on unknown / already-closed ids. Localhost-only. Archive on disk survives.
- `set_agent_selected_files(agent_id, files)` — per-agent file selection. Localhost-only. Filters non-existent paths against the repo. No `filesChanged` broadcast (per-tab state isn't shared across clients).
- `set_agent_excluded_index_files(agent_id, files)` — per-agent index-exclusion list. Localhost-only. Drops matching `symbol:` / `doc:` / `file:` entries from the agent's tracker.
- `switch_agent_mode(agent_id, mode)` — change an agent's mode (one of `code`, `doc`, `code+xref`, `doc+xref`). Localhost-only. Rejected mid-stream with `{error: "agent stream active"}`. Rebuilds the agent's StabilityTracker (every tier prefix invalidated by the new prompt + index combination), writes a mode-change system event to the archive (so session-load reconstruction can replay it), and broadcasts `agentModeChanged`.
- `set_agent_cross_reference(agent_id, enabled)` — toggle cross-reference for an agent without changing primary mode. Same shape as `switch_agent_mode`: mid-stream rejection, tracker rebuild, archive event, broadcast.

Server-push events the chat panel listens for:

- `agentsSpawned {turn_id, parent_request_id, agent_blocks}` — fired immediately after the orchestrator's response is parsed and BEFORE child streams dispatch. Frontend creates tabs with their child request IDs pre-populated so chunks route correctly. See [streaming.md § Agents Spawned Event](../3-llm/streaming.md#agents-spawned-event) for the ordering invariant.
- `agentsRehydrated {agent_ids}` — fired after `sessionChanged` on session load. Frontend re-runs `rehydrateLiveAgents` to materialise tabs for the just-reconstructed agents.
- `agentClosed {agent_id}` — fired one per agent when `new_session` runs (before `sessionChanged`), or as a confirmation when the user closes an agent tab and the backend frees the scope. Frontend removes the tab and frees per-tab state.
- `agentModeChanged {agent_id, mode, cross_reference_enabled}` — fired after a successful `switch_agent_mode` or `set_agent_cross_reference`. Frontend updates `_tabModes` and re-renders the toggle.

## Interaction

Agents are conversational. If an agent needs something from the user, it emits a normal assistant message saying so — "I need to see `src/auth.py` to understand the current token flow" — and stops streaming. From the protocol's perspective this is indistinguishable from an agent that finished its work. The user sees the message in that agent's tab and decides what to do:

- **Reply with text.** Type in the input box (now targeting the active tab), send. The reply becomes a user message in the agent's conversation. The agent's next LLM call sees the full conversation including the reply and resumes work.
- **Grant a file.** Tick the box in the file picker while the agent's tab is active. The picker's selection state is scoped to the active tab — the agent's ContextManager picks up the newly-selected file. A short follow-up ("Now continue") or even just send the current input triggers the agent's next turn with the file in context.
- **Leave the agent alone.** Either because the user is handling questions from other agents first, or because they're going to come back to this one later. The tab sits with its last assistant message displayed, no active streaming. No resource pressure, no timeout.
- **Close the tab.** Equivalent to killing the agent. Its partial work (any edits already applied to the working tree) remains on disk. The archive is preserved. The main LLM's synthesis step will see the agent's final message and can decide how to handle the incomplete subtree.

This is the whole interaction surface. No dedicated question blocks, no pause-resume state machine, no file-grant confirmation cards, no reply routing RPCs. The chat panel's existing affordances (paste-to-prompt, copy message, file mentions, snippet drawer, URL chips, input history) all work identically for agents because the same panel component renders each tab's conversation.

## Per-Tab State

The chat panel keeps a per-tab state slot for each open conversation, keyed by a tab identifier:

- **Main tab** — identifier `"main"`. State carried by existing ChatPanel properties.
- **Agent tabs** — identifier is the agent's LLM-chosen id from its `🟧🟧🟧 AGENT` block (e.g., `"frontend-trivial"`). The same id is the registry key in the backend's `_agent_contexts` and the value passed as `agent_tag` on RPC calls. Identity is flat — no compound `{turn_id, agent_idx}` shape, no parsing required.

Per-tab state includes:

- Active request ID, if a stream is in progress
- Accumulated streaming content (for the live-rendering path)
- Message list rendered from the tab's conversation
- Selection set (the subset of repo files checked for this conversation)
- URL chip state (which URLs are detected/fetched/excluded for this conversation)
- Input textarea draft (user typing in agent 0's box doesn't get lost when switching to agent 1)
- Scroll position within the message list

Switching tabs swaps the visible state without discarding any tab's values. The StabilityTracker, ContextManager, and archive file live on the backend; frontend tab state is the UI reflection.

## Streaming Routing

Every streaming chunk from the backend carries its originating request ID. Request IDs are already the routing primitive (see [streaming.md](../3-llm/streaming.md#chunk-delivery-semantics)). Agent child requests use IDs of the form `{parent_request_id}-agent-{NN}` (zero-padded to two digits). The chat panel's tab registry maps each known request ID to the tab that owns it; incoming chunks update that tab's streaming content even when the tab is not currently active.

A user watching agent 1's tab sees agent 0's streaming happening in the strip (the tab label pulses or carries a progress indicator). Switching to agent 0's tab surfaces its current stream position immediately — no re-fetch, no loading state.

### Tab Creation Ordering

Agent tabs must exist in the chat panel's tab registry before any child stream chunks arrive for them. Otherwise `_findTabForRequest` (the routing layer) sees a child request ID with no matching tab and silently drops the chunk. Because agents often finish quickly, the entire agent's stream can complete in this dropped state, leaving the tab populated with nothing.

The backend solves this by firing an `agentsSpawned` event immediately after the main LLM's response is parsed and BEFORE dispatching agent streams. The event carries `{turn_id, parent_request_id, agent_blocks: [{id, task, agent_idx}, ...]}` — everything the frontend needs to create tabs with pre-populated child request IDs. The spawn step awaits nothing between emitting `agentsSpawned` and starting the first agent stream, so by the time the frontend's event handler creates the tabs, the race window has closed to zero.

The main LLM's `streamComplete` event also carries `agent_blocks` as a fallback. The frontend's tab-creation path is idempotent — creating a tab for an agent id that already exists is a no-op. This keeps older backends (that only surface agent blocks via `streamComplete`) working: tabs appear after all agents finish, which means child chunks and completion events are still dropped, but the final transcripts become visible via the archive (see [history.md](../3-llm/history.md#agent-turn-archive)).

**Idempotency under the dual-event design.** Modern backends emit BOTH events for every agentic turn — `agentsSpawned` eagerly, and `streamComplete` for the orchestrator carrying `agent_blocks` as a redundant payload. The frontend's tab-creation entry point is therefore invoked twice per turn with the same `parent_request_id`. The retask path (used when an agent id already has a live tab from a prior turn) MUST distinguish "user typed a new turn that retasks this agent" from "this is the same turn's fallback duplicate" — without that, the fallback append would duplicate the user prompt in the agent tab AND re-arm `streaming = true` / `currentRequestId = childId` after the agent's stream has already completed and cleared them, leaving the cursor stuck on a stream that produces no more chunks.

The frontend memoises on `parent_request_id`: the first invocation for a given parent request runs (creating fresh tabs and appending retask prompts to existing tabs); subsequent invocations with the same parent request id are no-ops. Turn boundaries are distinguished by parent request id (turn 1's parent ≠ turn 2's parent), so retask in turn 2 still appends correctly while the duplicate fallback inside turn 2 no-ops. The memo is session-scoped — `new_session` doesn't clear it, but parent request ids carry an epoch prefix that doesn't collide across sessions in practice.

**Mode fallback on retask.** Inline agent-spawn cards in the orchestrator's response body show a mode pill (`code` / `doc` / `code+xref` / `doc+xref`) read from the parsed AGENT block's `mode:` field. On retask, the orchestrator commonly omits the `mode:` field — mode is preserved from the existing agent's scope server-side, not re-specified — so the parsed segment has an empty mode and a naive renderer would drop the pill. The card renderer falls back to `panel._tabModes.get(id)` when the segment's mode is empty, recovering the resolved mode the `agentsSpawned` broadcast already populated. Same source the tab strip tooltip uses, so the inline card's pill and the tab's tooltip stay consistent across spawn and retask. Fresh-spawn blocks always carry an explicit `mode:` field (resolved by the backend before broadcast) so they hit the segment-level path; only retask blocks rely on the fallback.

Tab identity — the key in the chat panel's `_tabs` Map — is the agent's LLM-chosen id from its `🟧🟧🟧 AGENT` block. The id is the same string the backend's `_agent_contexts` registry is keyed by, so `parseAgentTabId(tabId)` returns the id directly with no parsing. The padded numeric index in child request IDs (`{parent}-agent-NN`) and archive file names (`{turn_id}/agent-NN.jsonl`) is a routing/storage detail — it does not feed back into tab identity, and the frontend never reconstructs identity from it.

Tab identity — the key in the chat panel's `_tabs` Map — is the agent's LLM-chosen id from its `🟧🟧🟧 AGENT` block. The id is the same string the backend's `_agent_contexts` registry is keyed by, so `parseAgentTabId(tabId)` returns the id directly with no parsing. The padded numeric index in child request IDs (`{parent}-agent-NN`) and archive file names (`{turn_id}/agent-NN.jsonl`) is a routing/storage detail — it does not feed back into tab identity, and the frontend never reconstructs identity from it.

## File Picker Scope

The file picker is a singleton UI component (one tree, one set of expanded-directory states) but its selection-set binding is per-tab. Switching tabs reloads the picker's checkbox state from the active tab's selection. Ticking a file updates only the active tab's selection.

This means:

- Main tab and agent tabs can each have different files selected.
- A user granting a file to agent 2 doesn't affect the main LLM's context on the next turn.
- Visual cues in the picker (diff stats, git status, line-count badges) remain shared — they're properties of the file on disk, not the selection.

Excluded-files state is also per-tab. The three-state checkbox applies to the active tab's conversation.

## Main LLM's View of Agents

The main LLM's synthesis step (see [parallel-agents.md](../7-future/parallel-agents.md#execution-model)) reads each agent's archived conversation at synthesis time. It sees:

- Everything the agent said (including any unresolved questions)
- Everything the user said in reply (if anything)
- Everything the agent did (edit blocks, file creations)
- Whether the agent finished, was closed, or left a dangling question

The main LLM writes synthesis based on that picture. An agent whose last message is an unanswered question — and whose tab wasn't closed — is "the user didn't get around to it." The main LLM says so in its synthesis and either proceeds with partial work or suggests revisiting in a follow-up turn.

Synthesis does not auto-fire. The user triggers it explicitly via a "Synthesise now" affordance in the main tab's action bar, or implicitly by sending the main LLM a follow-up message (which the main LLM's system prompt tells it to treat as "the user has heard enough; wrap up this turn and respond"). Leaving a turn in limbo — agents still alive, synthesis not triggered — is a valid, cheap state because no LLM calls are running.

## Historical Turns

Once a new agentic turn starts, the previous turn's agent tabs leave the strip. Their archives remain on disk (`.ac-dc4/agents/{turn_id}/agent-NN.jsonl`) and are readable via the history browser:

- Scrolling the main chat back to a previous turn surfaces a "View agents (N)" affordance beneath that turn's assistant message.
- Clicking it populates the tab strip with read-only tabs for that turn's agents, loaded from the archive.
- Read-only means the input box is disabled. Users can read the full conversation, see edits that were applied, but can't send new messages — the ContextManager is gone, the session's long over.
- Leaving the historical turn (scrolling away, clicking a newer turn) removes the read-only tabs.

This replaces the horizontal-scroll agent-region UI from earlier designs. All agent-conversation viewing, past and present, happens in the same tab strip.

## Raw Markdown Rendering

All tab content — active streams, completed agents, historical archives — renders through the same markdown pipeline as the main chat:

- Syntax highlighting for fenced code blocks
- Math rendering (KaTeX)
- File mention links navigate to the diff viewer
- Edit blocks render as status cards (for active agents, failures can be retried; for historical/read-only tabs, cards are purely informational)

The chat panel's message-level toolbars (copy message text, paste-to-prompt) work identically across tabs.

## Re-Iteration Within a Turn

When the main LLM spawns agents, reviews their output, and decides to spawn agents again with different scope, each agent's archive file accumulates both rounds of work. In the tab strip this surfaces as:

- The same tab (same `{turn_id, agent_idx}` identifier) accumulates multiple "iteration segments" within its conversation.
- An iteration divider message — "─── Iteration 2 ───" — separates segments visually.
- The tab label gains a badge like "3 iterations" so users see the agent was re-spawned.

The main LLM's reasoning across iterations stays in the main tab's assistant message, where the user reads it as part of the normal turn flow.

## Empty States

- **No turns in session yet** — main tab only, no agent tabs. Standard chat.
- **A turn that spawned no agents** — main tab only. Agent tabs appear only when an agent-spawn block parses.
- **Archive missing** — historical view of a turn whose archive was deleted shows a "Archive unavailable for this turn" placeholder in place of the tabs.

## Disk Usage Warning

Per [history.md](../3-llm/history.md#disk-usage-monitoring), once `.ac-dc4/agents/` crosses 1 GB cumulative the user sees a one-shot warning toast and a dialog header banner pointing at the cleanup affordance in Settings. The Settings tab lists archives by turn with per-turn delete buttons. Deleting an archive removes its directory; historical-view tabs for that turn then surface the "archive unavailable" empty state.

## Deep Linking

A URL parameter `?turn=<turn_id>` scrolls the main chat to that turn and triggers the historical-view tab population for it. Missing or deleted turn IDs scroll to the most recent turn and show a transient toast.

## Invariants

- The chat panel is one component. Multiple tabs are additional per-tab state slots, not duplicated components.
- Tab switching is pure UI — no backend notification, no tracker invalidation, no cache eviction.
- Tab enumeration is NOT pure UI. The set of live tabs at any moment is a function of the backend's `_agent_contexts` registry, populated via `agentsSpawned` events during spawn turns and via `list_live_agents()` on `onRpcReady` after refresh or reconnect. The frontend never invents tabs and never persists tabs across refresh — it always asks the backend.
- The Main tab's identifier is always `"main"`. Agent tab identifiers are the agent's LLM-chosen id directly. No overlap (the literal `"main"` is reserved), no parsing required to recover identity from the tab id.
- Streaming is routed by request ID. A chunk's destination tab is determined before the chunk is applied — switching tabs mid-stream never routes chunks to the wrong conversation.
- File picker selection is per-tab. Changing a tab's selection never affects another tab's ContextManager.
- Agent tabs persist until the next agentic turn or explicit close. Streaming-stopped is not the same as tab-closed.
- ContextManagers and StabilityTrackers are per-tab. Each tab benefits independently from provider caching across its successive LLM calls.
- The main LLM's synthesis is not auto-triggered. Users explicitly request it when they've heard enough from the agents.
- Historical tabs are read-only. Past turns' ContextManagers are not reconstructed; the archive is sufficient for reading but not for continuing the conversation.
- Turns without agents render exactly as today's chat. The tab strip still exists but contains only the Main tab.
- The LED row in the main tab header is a derived view of conversation tab state. It always carries one LED for the main tab plus one per live agent tab. Closing an agent tab removes its LED; the main-tab LED is permanent for the chat panel's lifetime.
- LED state is a pure function of the most recent `streamComplete` event for the agent plus `streamChunk` activity. No separate state machine, no acknowledgement gesture beyond closing the tab, no auto-fade or "seen" state.
- Clicking a LED activates its tab and scrolls the tab strip to make that tab's button visible. The activation primitive is shared with clicking the tab directly; the auto-scroll is specific to the LED entry point because users reaching for a LED have no guarantee the tab itself is visible.