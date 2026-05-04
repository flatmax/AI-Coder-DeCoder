# Agent Tab Strip — UX Implementation Plan

**Status:** not started. Prerequisite (D25 agent execution plane) is complete; see IMPLEMENTATION_NOTES.md D25.

Governing spec: `specs4/5-webapp/agent-browser.md`.
Decision log: D21 (chat-panel tabs), D25 (execution plane).

## Goal

Surface spawned agents as tabs in the chat panel. Each agent becomes a chat conversation the user can read, reply to, and close. Until this ships, agent conversations exist only as per-turn JSONL archives under `.ac-dc4/agents/{turn_id}/agent-NN.jsonl` and are invisible in the UI.

## Scope revisions from the governing spec

Three deliberate simplifications based on UX review:

1. **Tab strip lives inside the chat panel body, above the messages list** — not in the dialog's top-level header, and not above the Chat/Context/Settings tab row. Agent tabs are chat-specific; when the user switches to Context or Settings, the tab strip isn't rendered. Spec said "along its top edge" referring to the chat panel; this plan pins "top edge of the chat panel body" as the concrete location.

2. **Agent tabs persist until explicit close OR main-tab "New session."** Not "until the next agentic turn." If the user runs a new agentic turn while prior agent tabs are still open, the new agents are added as fresh tabs; old ones stay alongside. The user closes individual tabs as they become irrelevant, or clears all agents by clicking "New session" in the main tab. Matches the "stay until the user changes it" intuition more literally than the spec's original "next agentic turn" rule.

   **Design intent** — multi-agent work on the same codebase often returns to the same files across turns. A user orchestrating a refactor might spawn the same agents repeatedly as related work surfaces. Keeping their conversations alive lets the main LLM reference "continue the auth agent's work from earlier" rather than starting from scratch each time. The ContextManager is warm, the StabilityTracker has accumulated tier state, the agent's understanding of the subtree is recent — all of which the user paid for in the previous turn's token spend.

   **Open design question — cross-turn agent reuse.** The current identity `{turn_id, agent_idx}` makes every turn's agents distinct. A design where the main LLM could say "reuse the auth agent from turn X" or "spawn a new auth agent to continue the earlier work" would need a richer agent identity — probably a user- or LLM-assigned name that's stable across turns. Not in scope for the first UX pass; worth revisiting once users have run enough agent-mode turns to reveal the natural interaction patterns. For now, tabs from prior turns are live but their conversations are orthogonal to new turns' spawns.

3. **Historical turns are NOT surfaced via scroll affordance.** The spec describes a "View agents (N)" affordance beneath past turns in the main chat scrollback. Dropped from first UX — users who want to review past turns type a follow-up asking the main LLM to reference them, and the main LLM can load the archive via `get_turn_archive(turn_id)` on its own. Simpler scrollback, no per-turn UI chrome.

Two deferrals stand:

4. **Synthesis remains user-driven.** No "Synthesise now" button; no auto-fire. User types a follow-up in the main tab and the main LLM decides what to do with the agents' output. Matches D25's scope revision.

5. **Per-agent cost/token display: deferred to follow-on work.** See "Per-agent token HUD" under Follow-on work. First UX pass uses session totals only; the HUD extension lands later once the agent substrate is in place.

## Non-goals

- No shared-session multi-user collaboration in agent tabs. Collab mode participants see the same tabs as the host (via the existing per-request broadcast path), but the per-tab file picker selection state is host-authoritative.
- No deep-link URL routing to specific agents. `?turn=<id>` routing described in the spec is deferred.
- No disk usage monitoring or cleanup UI. Once archives start growing in practice we'll add the warning toast + Settings cleanup affordance; not needed for the first UX.
- No cross-turn agent reuse. Each agentic turn produces fresh agent tabs with identities `{turn_id, agent_idx}`. Reusing an earlier agent by name across turns — e.g. the main LLM referencing "the auth agent from an earlier turn" and continuing its conversation in-place — is a future design question. See the Open design question under scope revision 2.

## Architecture

### Frontend: per-tab state in `ChatPanel`

Current `ChatPanel` holds ~20 per-conversation fields directly on `this` (`messages`, `_input`, `_streaming`, `_streamingContent`, `_currentRequestId`, `_streams`, `_pendingImages`, `_pendingChunks`, `selectedFiles`, etc). All of these become per-tab.

New structure:

```
_tabs: Map<tabId, TabState>
_activeTabId: string ("main" or "{turn_id}/agent-{NN}")
```

`TabState` is an object with every field that was previously on `this`:

- `messages: Array` — the tab's conversation
- `input: string` — textarea draft
- `streaming: bool`
- `streamingContent: string`
- `currentRequestId: string | null`
- `lastRequestId: string | null`
- `streams: Map<requestId, {content, sticky}>`
- `pendingChunks: Map<requestId, string>`
- `selectedFiles: string[]`
- `pendingImages: string[]`
- `urlChipState: {...}` (snapshot of the URL chips component's internal state)
- `autoScroll: bool`
- `searchQuery: string`, search toggles, etc.
- `historyOpen: bool` — false for agent tabs; history browser only applies to main

Getters on `ChatPanel` expose the active tab's fields: `get messages()` returns `this._tabs.get(this._activeTabId).messages`. Setters write to the same slot. Template rendering reads from the active tab's state transparently. The existing `updated()` / `render()` code doesn't change — the state lookup changes under the hood.

**Main tab identifier is always `"main"`.** Agent tab identifiers follow `{turn_id}/agent-{NN}` exactly as emitted by the backend's `_spawn_agents_for_turn`. Load-bearing because streaming-chunk routing keys on request-ID prefix; the tab ID is derivable from any child request ID without extra state.

### Streaming routing — keyed by request ID

`_onStreamChunk(event)` currently filters to `event.detail.requestId === this._currentRequestId` and ignores everything else. After the refactor:

1. Extract the request ID from the event.
2. Determine which tab owns it:
   - If it matches any tab's `currentRequestId` exactly → that tab.
   - If it starts with `{parent}-agent-` where `{parent}` matches a tab's `currentRequestId` → the corresponding agent tab.
   - Otherwise → drop.
3. Apply the chunk to that tab's `streamingContent` via the existing rAF coalescing path, keyed by tab ID.

Inactive tabs accumulate streaming content in their `TabState.streamingContent` without rendering — when the user switches to the tab, the content appears immediately from the state lookup. No re-fetch.

Tab labels render a progress indicator (pulse dot or similar) when `tab.streaming === true`. Lets users see work happening on tabs they aren't looking at.

### File picker scope — per-tab selection

FilesTab currently holds `_selectedFiles` and pushes it to both the picker and the chat panel. After the refactor:

- FilesTab listens for an `active-tab-changed` event bubbling up from the chat panel.
- On tab change, FilesTab reloads the picker's checkbox state from the new active tab's `selectedFiles`.
- Picker checkbox toggles update the active tab's `selectedFiles`, not a global one.
- The backend's `set_selected_files` RPC is called only for the main tab. Agent tabs have their own `ContextManager.file_context` server-side; their selection is managed via `LLMService`'s per-scope path already. A new backend method `set_agent_selected_files(turn_id, agent_idx, files)` wires this up — see Backend changes below.

The picker's tree, expand state, and sort mode stay global (one tree in the repo — doesn't vary per tab). Git status badges, diff stats, line counts stay shared.

### Backend changes

Two small additions:

1. **`LLMService.close_agent_context(turn_id, agent_idx)`** — frees the agent's ContextManager + StabilityTracker from in-memory state. The archive file stays on disk. Idempotent — closing an already-closed or never-opened agent is a no-op that returns `{status: "ok"}`. Localhost-only. Implementation: look up the ContextManager in whatever registry `_spawn_agents_for_turn` leaves them in (today: none — they live only in the agent's `scope` until `_stream_chat` returns, then become garbage-collectable). This means we need to add a registry first. Small: `self._agent_contexts: dict[str, dict[int, ContextManager]]` keyed by `(turn_id, agent_idx)`, populated in `_build_agent_scope`, cleaned up here.

2. **`LLMService.set_agent_selected_files(turn_id, agent_idx, files)`** — per-agent file selection, mirroring `set_selected_files` but targeting a specific agent's ContextManager. Writes to `scope.selected_files` where `scope` is looked up from the registry above. Localhost-only. The next user turn in that agent's tab picks up the new selection.

3. **Agent spawn payload in stream-complete result.** Today `_spawn_agents_for_turn` runs via `asyncio.gather` after parsing the main LLM's response. The completion result dict already carries `agent_blocks`, but the frontend needs the `turn_id` too so it can construct tab IDs. Add `turn_id` to the result dict. One-line change in `_build_completion_result`.

4. **Per-agent streaming continuation RPC.** When the user types a reply in an agent tab, the frontend sends `LLMService.chat_streaming(request_id, message, files, images, excluded_urls, turn_id=..., agent_idx=...)` — new keyword args route the call to the agent's ContextManager via the registry. Backward compatible: default None means main conversation, preserving the single-agent behaviour.

### Tab lifecycle

**Creation:** on `stream-complete` for a main-conversation turn, inspect `result.agent_blocks`. For each valid block, create a new agent tab via:

```
this._tabs.set(`${result.turn_id}/agent-${NN}`, newTabState({
  turn_id: result.turn_id,
  agent_idx: N,
  label: `Agent ${N}: ${shortenTask(block.task)}`,
  messages: [{role: 'user', content: block.task}],  // seed with task
  selectedFiles: [...main tab's selectedFiles],    // inherit snapshot
  // ... empty defaults for other fields
}))
```

The tab appears in the strip immediately. As the backend streams the agent's response (recognized by the child request ID prefix), chunks accumulate in the tab's state. The tab label pulses to show activity.

**Explicit close:** ✕ button on each agent tab (not on the Main tab). Click → dispatch `LLMService.close_agent_context(turn_id, agent_idx)`, then remove the tab from `_tabs`. If the user was viewing that tab, switch to Main.

**New session button:** clears all agent tabs. Backend's `new_session()` RPC is called; we follow up with `close_agent_context` for every open agent tab (or rely on backend session reset to purge the registry). Main tab's state is cleared by the existing `session-changed` handler.

**Server shutdown / disconnect:** all in-memory tabs are lost. On reconnect, `get_current_state` returns only the main-conversation state. Agent tabs don't reappear (their ContextManagers are gone). Archives survive on disk for later inspection via "review what the agents did" prompts to the main LLM.

### Input routing

The textarea's `_send()` reads from the active tab:

```
async _send() {
  const tab = this._tabs.get(this._activeTabId);
  // ...
  await this.rpcExtract(
    'LLMService.chat_streaming',
    requestId,
    text,
    tab.selectedFiles,
    images,
    excludedUrls,
    tab.agent_tag ?? null,  // {turn_id, agent_idx} for agent tabs, null for main
  );
}
```

Backend's `chat_streaming` accepts the optional agent_tag kwarg and routes to the agent's ContextManager.

### File picker "active file highlight"

Currently the picker highlights the file currently open in the viewer. With per-tab picker state, the question is: does the highlight follow the active tab, or follow the viewer regardless of tab?

Answer: follow the viewer. The viewer is shared across all tabs (one viewer background, same file open in it regardless of which agent tab is active). The highlight reflects what's in the viewer, not what's in the active tab's selection.

## Phased delivery

### Phase A — per-tab state refactor in `ChatPanel` (~5 commits)

Largest, most invasive. Each commit leaves the codebase passing tests.

**A1 — Add `_tabs` Map and `_activeTabId` with main tab only.** Every existing field on `ChatPanel` becomes a getter that reads from `this._tabs.get(this._activeTabId)`. No new tabs yet; the Map always contains one entry (`"main"`). This flips every piece of state through the indirection without changing behaviour. Lots of mechanical changes; tests continue to pass because the reads and writes produce identical results.

**A2 — Streaming routing keyed by tab ID.** `_onStreamChunk` and `_onStreamComplete` look up the owning tab by request ID prefix. With only the main tab present, this is equivalent to the old exact-match filter. The refactor lays groundwork; no observable change.

**A3 — `active-tab-changed` event plumbing.** New reactive property `_activeTabId`; setter dispatches `active-tab-changed` with `{tabId, previousTabId}`. Template binds to the active tab's state via getters. Still only one tab; still no observable change.

**A4 — Extract FilesTab's selection to per-tab.** FilesTab listens for `active-tab-changed`, stores per-tab `_selectedFilesByTab: Map<tabId, Set>`, reloads picker state on tab change. For the main tab only, behaviour is byte-identical.

**A5 — Pin the refactor with tests.** New `TestPerTabState` class in `chat-panel.test.js`: every existing streaming/selection/image/URL-chip test runs with the one-tab state structure. Failures here surface any missed field migrations.

### Phase B — tab strip UI (~3 commits)

Only after A5 lands and tests are green.

**B1 — Tab strip component inside chat panel body.** New element at the top of the chat panel body, above the messages list. Renders one button per entry in `_tabs` — Main only, since A didn't add agent tabs. Button click switches `_activeTabId`. CSS: horizontal flex row, active tab highlighted, compact enough not to dominate vertical space.

**B2 — Overflow scrolling + menu.** When the tab count exceeds viewport width, horizontal scroll. Overflow menu (three-dots) lists all tabs by label for direct access. Matters for users with many agents.

**B3 — Close button on agent tabs (but no agent tabs yet).** Button renders conditionally based on tab type. Wired to a `close-tab` event dispatched from the tab strip; `ChatPanel` handles it by calling `LLMService.close_agent_context` and removing the tab from the Map. Main tab never shows the close button.

### Phase C — agent tab spawning (~3 commits)

Requires Phase B's UI and the backend changes.

**C.0 — Tab label derivation helper** — delivered `1cf20f5`. Pure
`deriveAgentTabLabel(agentIdx, task)` function in `chat-panel.js`, with
29 tests pinning the label format. Independent of C1 and C2 — no
backend dependency — so it could land ahead of either. When C2's spawn
path writes to `_tabLabels`, the label shape is already locked in.

**C1 — Backend: `close_agent_context` RPC, agent registry, `set_agent_selected_files` RPC, `turn_id` in completion result, `agent_tag` kwarg on `chat_streaming`.** Tests: agent registry populated on spawn, cleared on close, per-agent selection stored correctly, `chat_streaming` routes to the agent's ContextManager when `agent_tag` is present.

**C2 — Frontend: agent tab lifecycle.** On `stream-complete` for a main turn with agent blocks, create agent tabs. Labels derive from the task text via `deriveAgentTabLabel` (C.0). Each agent tab's initial message is the task; subsequent assistant chunks populate as the backend streams. User typing in an agent tab's input routes to `chat_streaming` with `agent_tag`. Close button calls `close_agent_context` and removes the tab.

Tests: spawn produces N tabs, streaming chunks route to the right tab, switching tabs preserves scroll/draft state, closing a tab removes it and frees backend state.

### Phase D — polish (~2 commits)

**D1 — Streaming indicator on tab labels.** Pulse dot or subtle animation when a non-active tab is streaming. Lets users see work happening on tabs they aren't looking at.

**D2 — Keyboard shortcut for tab switching.** Alt+1 / Alt+2 / … / Alt+0 switch between tabs when the chat panel is active. Alt+1 is always Main; Alt+2..9 are the first 8 agent tabs in order. Alt+0 is the last tab. Matches the dialog tab shortcuts' convention.

## Invariants

- `"main"` tab is always present and cannot be closed.
- Tab IDs are stable across tab additions/removals. The main tab is always `"main"`; agent tabs are always `{turn_id}/agent-{NN}`.
- Per-tab state includes the streaming state. A stream that's active when the user switches away continues updating the tab's state; switching back shows the current content immediately.
- The file picker's tree, expand state, and sort mode are global (one per repo). Selection is per-tab. Visual highlights (git status, diff stats) are file-level, not tab-level.
- The viewer is shared. Switching agent tabs doesn't change what's open in the viewer.
- Closing an agent tab frees its ContextManager + StabilityTracker on the backend. The archive file stays on disk.
- The main LLM's synthesis is not auto-triggered. Users explicitly request review on follow-up turns.

## Progress log

(Update after each phase lands.)

- **Phase A — delivered.** Reading the current code confirms A1–A5 all
  shipped prior to C.0:
  - **A1** — `_tabs: Map<tabId, TabState>` + `_activeTabId` with per-tab
    getters/setters on every reactive property. Main-only operation
    preserves byte-identical behaviour via the single-entry Map.
    Visible in `chat-panel.js` constructor, `_makeTabState()`, and the
    long reactive-accessor block.
  - **A2** — Streaming routed by request ID via `_findTabForRequest()`.
    Exact match on `currentRequestId` first, then `{parent}-` prefix
    match for the future agent-spawn case. `_onStreamChunk` and
    `_onStreamComplete` both dispatch to the owning tab's state;
    inactive-tab accumulation is silent (no `requestUpdate` when the
    chunk isn't for the active tab).
  - **A3** — `active-tab-changed` event plumbing. Setter on
    `_activeTabId` dispatches `CustomEvent` with `{tabId,
    previousTabId}`, bubbles + composed so sibling components see it.
  - **A4** — FilesTab per-tab selection. `selectedFiles` getter on
    chat-panel forwards per-tab; files-tab's `_onActiveTabChanged`
    method responds to the event by swapping its own state.
  - **A5** — Existing streaming/selection/image/URL-chip tests in
    `chat-panel.test.js` and `files-tab.test.js` continue to pass
    against the per-tab state structure, which is the regression
    guard the plan called for.
- **Phase B — delivered.** Tab strip UI present and functional:
  - **B1** — `_renderTabStrip()` emits a horizontal button row above the
    messages list, rendered only when `_tabs.size > 1`. Active tab
    gets `.active` class + accent styling. CSS in the static
    `styles` block (`.tab-strip`, `.tab-strip-tab`).
  - **B2** — Overflow scrolling + three-dots menu. `.tab-strip-scroll`
    is the horizontally-scrollable flex row; `.tab-strip-overflow`
    button is pinned at the right, always visible when the strip
    is visible. Clicking opens `_renderOverflowMenu()` — a dropdown
    listing every tab by label. Outside-click and Escape dismissal
    via capture-phase document listeners (`_onOverflowOutsideClick`,
    `_onOverflowKeyDown`). Listeners attached only while menu is
    open to keep the document event loop clean.
  - **B3** — Close button on agent tabs. `.tab-close` element rendered
    conditionally (main tab never shows one). Own click handler with
    `stopPropagation()` so clicking ✕ doesn't flip to the tab being
    closed. `_onTabClose(tabId)` deletes from `_tabs` and
    `_tabLabels`, switches to Main if the closed tab was active, and
    dispatches `close-tab` event. Event is the hook Phase C's
    backend integration will listen on (calling
    `LLMService.close_agent_context`).
- **Phase C — in progress.**
  - **C.0 — `deriveAgentTabLabel` helper** — delivered `1cf20f5`. Pure
    function exported from `webapp/src/chat-panel.js` that derives
    `Agent NN` / `Agent NN: {first line of task}` labels with length-
    capped truncation. 29 tests in
    `webapp/src/chat-panel-agent-labels.test.js` pin every rule (bare
    prefix cases, task text inclusion, truncation, index coercion,
    regression scenarios). Unblocks C2's spawn path — when the spawn
    handler lands, it populates `_tabLabels` by calling this helper,
    and the label format is already pinned.
  - **C1 — not started.** Backend agent registry, `close_agent_context`
    RPC, `set_agent_selected_files` RPC, `turn_id` in completion
    result, `agent_tag` kwarg on `chat_streaming`.
  - **C2 — not started.** Frontend spawn path on `stream-complete`:
    inspect `result.agent_blocks`, create tabs via the existing
    `_tabs`/`_tabLabels` infrastructure, route agent-tab textareas
    to `chat_streaming` with `agent_tag`, wire close button to
    `close_agent_context`.
- **Phase D — not started.**

### Progress log correction — Phases A and B

An earlier iteration of this log marked Phases A and B as "not
started" when in fact they had already shipped. Reading the current
code in `chat-panel.js`, `files-tab.js`, and the test files confirmed
the infrastructure was in place — per-tab `_tabs` Map, tab strip
rendering, overflow menu, close buttons, `active-tab-changed`
plumbing, request-ID routing — before C.0 landed. C.0 was the first
step of Phase C, not a standalone item before Phases A/B.

The log above now reflects the real state. Future resumptions should
trust the code over the log when they disagree; the code is
authoritative.

## If we get cut off

Check the progress log above. The last completed phase is the last one marked "delivered `<hash>`". Pick up from the first "not started". Read the current state of `webapp/src/chat-panel.js`, `webapp/src/files-tab.js`, and `src/ac_dc/llm_service.py` fresh — don't reconstruct from memory.

Key files to reorient on:

- `webapp/src/chat-panel.js` — the per-tab state refactor's main target
- `webapp/src/files-tab.js` — the orchestrator that pushes selection to the picker and chat panel
- `webapp/src/app-shell.js` — streaming event dispatch (no changes expected, but worth checking that the existing request-ID routing stays correct)
- `src/ac_dc/llm_service.py` — `_spawn_agents_for_turn`, `_build_agent_scope`, `chat_streaming`
- `src/ac_dc/agent_factory.py` — `build_agent_context_manager` (no changes expected)
- `specs4/5-webapp/agent-browser.md` — governing spec
- `IMPLEMENTATION_NOTES.md` D21 and D25 — decision log

The phases are additive: each leaves the codebase working. If mid-phase is uncertain, revert to the previous phase's last-known-good commit and re-do the partial phase.

## Follow-on work (not in this plan)

- **Historical turn browsing.** Not needed for first UX (users ask the main LLM to reference past turns). When real usage shows people want to scroll back through past agents' conversations directly, revisit and add the scroll-affordance design from the spec.
- **Cross-turn agent reuse.** Give agents a stable identity across turns so the main LLM can reference and continue an earlier agent's work. Needs a name scheme (LLM-assigned? user-assigned? derived from task text?), an RPC to continue an existing agent (distinct from spawning a fresh one), and chat-panel UI that surfaces "reuse existing" vs "spawn new" as options when an agent with a matching identity exists. Biggest unknown — whether the main LLM's system prompt should actively encourage reuse or treat it as an optimisation it discovers on its own.

  **Continuity requires agent visibility.** For the main LLM to orchestrate agents — decide which to reuse, which to spawn fresh, which to retire — it needs a minimal summary of each live agent's state at the top of every main-conversation turn. The summary lives in the main LLM's prompt (injected as a block in the active user message), so the main LLM reasons over it natively.

  **Per-agent state descriptor** — the block shows one entry per live agent, each carrying only what the main LLM can't infer from its own context:

  - Identity — `{turn_id}/agent-NN` plus a human-readable label
  - Last-turn summary — one or two sentences describing the agent's most recent output. The main LLM's primary signal for "what did this agent actually do." Enables "continue from where agent 0 left off" without reading the full transcript
  - Turn count — rough measure of conversation depth
  - Status — idle, streaming, or closed (archive-only)

  **What's deliberately omitted and why.** Earlier drafts of this design included more fields that turned out to be redundant or unhelpful:

  - *Original task text* — the main LLM cares whether the task *landed*, not what was originally asked. If the task succeeded, the main LLM reads the files modified (already in its own context via assimilation) and judges. If it partially failed, the last-turn summary plus the file diffs convey what's broken. The original brief is already in the agent's history and the assistant-message narration of the turn that spawned it.
  - *Open files (agent's selected_files list)* — the main LLM already has the post-change file content in its own context. Knowing which files the agent happens to have selected is only useful for routing decisions the main LLM isn't well-placed to make; agent reuse decisions are better informed by what the agent *did* than by what it has open.
  - *Fetched URLs* — treated as user-owned state, not routing input for the main LLM. When a URL's ongoing relevance is in question, the main LLM raises it *with the user* — "agent 0 has URLs X, Y, Z loaded; should I keep them for the next round or clear them?" — rather than deciding silently. Keeps the user in control of URL lifecycle across agent turns.
  - *Stability tier summary* — cache warmth isn't actionable without a mental model of the tier system, which the main LLM doesn't have. If a decision needs cache state, the main LLM can request it explicitly via a future RPC.
  - *Full conversation history* — expensive and 90% redundant with the last-turn summary.
  - *Per-agent session totals* — exposed via the token HUD (see Follow-on work: per-agent token HUD) rather than as LLM routing input.
  - *Raw file content* — the main LLM's own context already has the relevant content via assimilation.

  **Injection point** — at the top of every main-conversation turn, the backend assembles the descriptors into an "Active Agents" block and injects it in the active user message. Per-turn injection means the block reflects current state each turn; cache invalidation happens naturally. Goes in the user message (not system prompt) so every turn sees the fresh state without burning cacheable system-prompt tokens when state changes.

  **Registry shape** — `LLMService._agent_contexts[turn_id][agent_idx]` gains an `AgentDescriptor` field populated by the agent's streaming pipeline as it runs. The last-turn summary is produced by a small LLM call after each agent turn completes, paid for once and re-used across subsequent main-conversation turns until the agent's next reply invalidates it.

  **Reference mechanism** — the main LLM's agentic appendix learns two new block types: `🟧🟧🟧 CONTINUE` (address an existing agent by ID) vs `🟧🟧🟧 AGENT` (spawn a fresh one, existing semantics). The spawn-block parser dispatches accordingly, routing `CONTINUE` to the registered agent's ContextManager and `AGENT` to a fresh scope.

  **User-confirmation prompts for state changes.** When the main LLM wants to clear an agent's state (drop URLs, close the agent, wipe file selection), it asks the user *first* rather than mutating directly. The user answers yes or no in the main chat; the backend acts on the confirmed answer. Keeps destructive state changes under the user's control — the main LLM can only read the descriptor, never mutate agent state unilaterally.

  Worth revisiting after enough real multi-agent turns to see the natural patterns — whether the main LLM spontaneously reuses agents when told it can, or whether the descriptor block adds noise the main LLM mostly ignores.
- **Synthesis affordance.** A "Synthesise now" button or similar shortcut for the common follow-up "review what the agents did." The snippet in `src/ac_dc/config/snippets.json` covers this today; a dedicated button would be a UX improvement.
- **Per-agent token HUD.** The existing token HUD shows aggregate session totals. Extend it to per-agent sections, one collapsible block per live agent, showing that agent's cumulative token spend and per-turn cost. Users who only care about the aggregate collapse the agent sections; users debugging "why did that last turn cost $2" expand them and see per-agent breakdowns. Plays well with the descriptor work above: the HUD shows cost (user concern), the descriptor shows state (LLM routing concern) — keeps the two roles separate.
- **Disk usage monitoring.** Archive cleanup in Settings, warning toast when `.ac-dc4/agents/` crosses a threshold. Not urgent until archives actually grow in practice.
- **Deep linking.** URL parameter `?turn=<turn_id>` to scroll to a specific turn + populate read-only agent tabs. Requires the historical-scroll affordance to land first.
- **Multi-user collab in agent tabs.** Host and participants see the same agents, but per-tab selection state is host-authoritative. Requires backend broadcast changes — deferred until collab mode has a real testing workflow.