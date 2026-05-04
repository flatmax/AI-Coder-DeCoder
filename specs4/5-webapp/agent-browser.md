# Agent Browser

Agents surface as additional tabs in the existing chat panel. There is no separate browser view, no column strip, no dedicated UI protocol for agent interaction. Each agent is a chat conversation; the chat panel is already the right UI for a chat conversation; adding more tabs is the entire user-facing change.

The main LLM's own conversation — decomposition, agent-output review, iteration decisions, synthesis — lives in the main tab as normal assistant messages. Agents' conversations live in their own tabs. The user switches tabs to watch, read, or interact.

## Tab Strip

The chat panel gains a tab strip along its top edge:

- **Main** — always present. The user↔main-LLM conversation, unchanged from today's chat UX.
- **Agent 0, Agent 1, ... Agent N−1** — one tab per agent the main LLM spawned for the active turn. Appear when the turn's agent-spawn blocks are parsed. Persist until the user starts a new agentic turn in the main tab.

Tab labels carry the agent index plus a short summary derived from the spawn block's `task` field — "Agent 0: auth refactor", "Agent 1: logging format." When the tab strip exceeds the viewport width, the strip scrolls horizontally; a menu affordance lists all tabs by summary for direct access.

The currently-active tab is visually distinguished. Every input affordance on the chat panel (textarea, send button, snippet drawer, file picker bindings) targets the active tab's conversation.

## Tab Lifetime

Three events end a tab's life:

- **New agentic turn in the main tab.** The user sends a new message to the main LLM that triggers a fresh decomposition. The current turn's agent tabs fade out of the strip; their archives persist on disk. Accessible by scrolling the main chat back to the previous turn and interacting with it via the history browser (see [Historical Turns](#historical-turns) below).
- **Explicit close.** Each agent tab has a close affordance. Closing an agent tab discards its `ContextManager` from memory (freeing any cached symbol map data it held, plus its stability tracker state). The archive file stays on disk. Equivalent to killing that agent — a subsequent LLM call for that tab is not possible because the ContextManager is gone. The user can still read the archive via history browsing.
- **Server shutdown.** All in-memory state is lost regardless of tab type. Archives on disk survive; the next server startup can show them via history browsing.

An agent tab that finished streaming without being closed stays live indefinitely. The user can reply to it minutes, hours, or days later — as long as the session is alive and no new agentic turn has started. Provider caching benefits accrue because the same ContextManager + StabilityTracker drive every subsequent call.

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
- **Agent tabs** — identifier `{turn_id, agent_idx}` (typically stringified as `"{turn_id}/agent-{NN}"`). State scoped to that agent.

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

The main LLM's `streamComplete` event also carries `agent_blocks` as a fallback. The frontend's tab-creation path is idempotent — creating a tab for a `{turn_id, agent_idx}` pair that already exists is a no-op. This keeps older backends (that only surface agent blocks via `streamComplete`) working: tabs appear after all agents finish, which means child chunks and completion events are still dropped, but the final transcripts become visible via the archive (see [history.md](../3-llm/history.md#agent-turn-archive)).

Tab identity — the key in the chat panel's `_tabs` Map — is `{turn_id}/agent-{NN:02d}`, matching the backend's archive directory layout. Parsing the tab ID back into `[turn_id, agent_idx]` produces the exact tuple the backend's `agent_tag` RPC kwarg expects (see [close tab behaviour](#tab-lifetime)).

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
- The Main tab's identifier is always `"main"`. Agent tabs always have `{turn_id, agent_idx}` identifiers. No overlap, no confusion about which conversation is which.
- Streaming is routed by request ID. A chunk's destination tab is determined before the chunk is applied — switching tabs mid-stream never routes chunks to the wrong conversation.
- File picker selection is per-tab. Changing a tab's selection never affects another tab's ContextManager.
- Agent tabs persist until the next agentic turn or explicit close. Streaming-stopped is not the same as tab-closed.
- ContextManagers and StabilityTrackers are per-tab. Each tab benefits independently from provider caching across its successive LLM calls.
- The main LLM's synthesis is not auto-triggered. Users explicitly request it when they've heard enough from the agents.
- Historical tabs are read-only. Past turns' ContextManagers are not reconstructed; the archive is sufficient for reading but not for continuing the conversation.
- Turns without agents render exactly as today's chat. The tab strip still exists but contains only the Main tab.