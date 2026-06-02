# Work Log

Active reimplementation work. This file holds in-flight plans, known bugs, deferred work, and process notes that don't yet belong in the historical archive at `specs4/impl-history/`.

When a plan completes and its audit trail stabilises, move it to [`plans-archive.md`](plans-archive.md). When a decision is settled, add it to [`decisions.md`](decisions.md).

## Build order

Per `specs4/0-overview/implementation-guide.md#build-order-suggestion`:

0. **Layer 0 — scaffolding** — package skeleton, CLI entry, build config, webapp shell, tests
1. **Layer 1 — foundation** — RPC transport (jrpc-oo), configuration, repository
2. **Layer 2 — indexing** — symbol index, doc index, reference graph, keyword enrichment
3. **Layer 3 — LLM engine** — context, history, cache tiering, prompt assembly, streaming, edits, modes
4. **Layer 4 — features** — URL content, images, review, collaboration, doc convert
5. **Layer 5 — webapp** — shell, chat, viewers, file picker, search, settings
6. **Layer 6 — deployment** — build, startup, packaging

Each layer depends only on layers below. Complete and test each layer before proceeding.

## Recently completed — preservation pass (2025-01)

Before deleting specs3 and the source tree, a preservation pass added byte-level / numeric-constant twins for the webapp specs and mirrored LLM prompt text into `specs-reference/3-llm/prompts/`.

### Twin files added

Seven new reference twins covering detail that would otherwise be lost when specs3 and the source tree are deleted:

- `specs-reference/5-webapp/svg-viewer.md` — SvgEditor constants, per-element drag dispatch, path parser, coordinate math, handle role identifiers, auto-generated ID filter regex, marquee visual feedback, copy-as-PNG pipeline, keyboard focus guard
- `specs-reference/5-webapp/chat.md` — Request ID format, finish-reason badges, compaction event stage routing, retry prompt templates, file mention accumulation, system event message templates, scroll constants, content-visibility thresholds, input history cap, image limits, edit block diff highlighting, post-response compaction timing, localStorage keys, cross-component paste suppression flag
- `specs-reference/5-webapp/file-picker.md` — localStorage keys, panel width constraints, context menu action IDs, inline input modes, shift+click vs regular click semantics, three-state checkbox cycle, deleted file exclusion cleanup
- `specs-reference/5-webapp/shell.md` — dialog dimensions, resize handle table, drag threshold, startup overlay timing, global keyboard shortcuts, synchronous selection capture rule, window resize throttling, repo-scoped localStorage keys for file/viewport restore
- `specs-reference/5-webapp/file-navigation.md` — spatial layout constants, animation timings, PLACEMENT_ORDER / REPLACEMENT_ORDER arrays, DIR_OFFSET table, node data model, event detail flags, file type color palette, Alt+Arrow capture-phase listener rule
- `specs-reference/5-webapp/viewers-hud.md` — Token HUD auto-hide timing, geometry, cache hit rate colors, budget bar thresholds, tier color palette, category colors, content group type icons, provider-cache-rate precedence, terminal HUD format, localStorage keys
- `specs-reference/3-llm/prompts.md` — index documenting contracts per prompt file; points at sibling files in `specs-reference/3-llm/prompts/` for content

### Prompt files as a synced mirror

Rather than embedding verbatim prompt text inside `prompts.md` (which would have required extensive four-backtick fence escaping for files containing edit-block markers, and would have created a drift risk on every prompt improvement), the prompts live as standalone sibling files:

```
specs-reference/3-llm/
  prompts.md              — index + contracts-per-file documentation
  prompts/
    system.md
    system_doc.md
    review.md
    commit.md
    compaction.md
    system_reminder.md
    snippets.json
    llm.json
    app.json
```

`scripts/sync_prompts.py` copies the nine files from `src/ac_dc/config/` into `specs-reference/3-llm/prompts/`, comparing bytes before writing so unchanged files are no-ops. Re-run after any prompt edit; commit both sides of the diff together. When the source tree is deleted, the mirror becomes authoritative.

The script itself avoids the edit-block self-reference problem by reading bytes off disk and writing them verbatim — it never constructs marker sequences in its own source code.

### Implementation guide updates

- `specs4/0-overview/implementation-guide.md` "Where specs4 Is Incomplete Without specs-reference" table updated: the prompt-text row now points at `specs-reference/3-llm/prompts/` (the directory) and mentions the sync script. The "Use specs-reference/3-llm/prompts.md for" heading was updated to reflect the index/mirror split.
- `specs-reference/README.md` "What Stays Outside" section updated: prompt text is no longer called out as "stays in the source tree." A new "Synced Mirror" section documents the `prompts/` directory as the special case.

### specs3 retirement

With prompts mirrored and the seven webapp reference twins in place, the [Where specs4 Is Incomplete Without specs-reference](../0-overview/implementation-guide.md) table has no remaining rows pointing into specs3. specs3 can be deleted with `git rm -r specs3/`.

### Other observations

- `specs4/1-foundation/jrpc-oo.md` was noted as a potential gap but left as-is per user request.
- No twin was created for several spec4 files judged self-sufficient during the pass: `specs4/2-indexing/reference-graph.md`, `specs4/2-indexing/keyword-enrichment.md`, `specs4/3-llm/modes.md`, `specs4/4-features/code-review.md`, `specs4/4-features/images.md`, `specs4/4-features/url-content.md`, `specs4/5-webapp/agent-browser.md`, `specs4/5-webapp/search.md`, `specs4/5-webapp/settings.md`, `specs4/5-webapp/speech.md`, `specs4/5-webapp/tex-preview.md`, `specs4/6-deployment/packaging.md`. If a byte-level detail turns out to be missing during reimplementation, grep the source tree (before deletion) or add an ad-hoc twin and update the implementation guide's table.
- Future missing twins follow the same mechanical rule: `specs4/{path}/{name}.md` ↔ `specs-reference/{path}/{name}.md`; add a row to the implementation guide's table; twin gets byte-level / numeric detail only, not behavior.

## Next tasks

Layers 0–4 complete. Layer 5 is substantially delivered — core interaction loop (chat + selection + viewing + editing + search + review) fully functional. Remaining Layer 5 work, in order of readiness:

1. **UI polish work plan** — delivered. All four commits shipped (viewer relayout on dialog/window resize, Alt+1..4 / Alt+M shortcuts, file picker left-panel resizer, specs4 docs catch-up for dialog chrome). See [`plans-archive.md`](plans-archive.md#ui-polish-work-plan--complete).
2. **Doc Convert tab — commit 6** — delivered. Scope identified post-Commit 5: clickable output paths in the summary view's progress rows. Before Commit 6, users finishing a conversion had to close the summary, switch to the Files tab, navigate to the output file, and click it — four clicks for the core post-conversion task ("review the diff"). Commit 6 upgrades successful progress rows' output-path text to a button element that dispatches `navigate-file` so the app shell routes to the diff viewer directly. Failed and skipped rows keep plain-text detail since there's no output to navigate to. Closes out the post-conversion workflow specs4/4-features/doc-convert.md describes end-to-end. The Doc Convert frontend is feature-complete.
3. **Agent-mode UI plan** — Increment A delivered (see D30 in [`decisions.md`](decisions.md) and the dedicated plan section below). Increments B–E (live tabs, refresh rehydration, per-turn historical view, cross-turn view) are queued; B+C+D form the next coherent push when agent-mode UI work begins.
4. **Collaboration UI — on pause.** Backend collab (Layer 4.4/4.5) is fully in place; the frontend surface (admission flow pending screen, admission toast, participant UI restrictions, connected-users indicator, collab popover with share link) is deliberately deferred. Revisit when someone actually wants to run a multi-client session; building the UI on spec without a real testing workflow would accumulate staleness.

**Layer 6 (build & deployment) — on pause.** PyInstaller packaging, release workflow, Vite → webapp-dist bundling, and version baking are all deferred. The system needs more hardening at the application layer first — sharper edges in the existing features, deeper test coverage on the paths users actually exercise, and any latent correctness bugs surfaced in day-to-day use — before packaging cost becomes worth paying. Revisit after a hardening pass decides what's actually ready to ship. Related deferrals that land with Layer 6: the webapp-dist bundling rule (D7 in [`decisions.md`](decisions.md)), the version-baking mechanism described in `specs4/6-deployment/build.md § Version Baking`, and the GitHub Actions release matrix described in `specs-reference/6-deployment/build.md § PyInstaller command — release build`.

## Agent-mode UI plan

The agent-mode foundation has shipped piecewise across Layers 3–5: edit-protocol marker tolerance (D20), `_stream_chat` ConversationScope refactor (D24), execution plane (D25), and now `agent_blocks` persistence (D30). What remains is the user-facing UI surface that consumes this infrastructure.

Five increments, sequenced by value-vs-effort. Each is a standalone deliverable; together they realise the chat-panel-as-agent-browser model specs4/5-webapp/agent-browser.md describes.

A separate plan — "Agents as first-class persistent entities" — sits below this one. It picks up where the UI plan ends, addressing the architectural gap that agent state currently doesn't survive session-reset or session-reload the way main's state does.

### ~~Increment A — `agent_blocks` persistence (no UI)~~ — delivered

Backend-only foundation. Persists the per-turn `{id, agent_idx}` mapping on every orchestrator-spawned assistant record so future cross-turn reconstruction views can recover an agent's full session transcript without scanning archive contents. Zero user-visible change. Pure forward-compatibility — every agent-mode turn from this point forward is reconstructable.

Delivered via `HistoryStore.append_message` accepting `agent_blocks`, `_stream_chat` parsing the response a second time at persistence-write time and threading the summary through `archival_append`. See D30 in [`decisions.md`](decisions.md) for the full rationale and `specs4/3-llm/history.md` § Cross-Turn Agent Reconstruction for the contract.

### ~~Increment B — Live agent tabs (current turn)~~ — already delivered (audit recovery, post-A)

Plan-status correction. When the agent-mode UI plan was first written, this increment was tagged "biggest piece, not started." A subsequent audit of the actual webapp source — prompted by the question of whether to start Increment B — revealed the work was substantially complete already, shipped piecemeal across earlier sessions before the plan was written.

What the audit found in `webapp/src/chat-panel/` and `webapp/src/files-tab/`:

- **Tab strip rendering** — `renderTabStrip()` in `tabs.js` produces the strip with active-class, streaming indicators, close buttons, mode-aware tooltips, and an overflow menu for many tabs. Hidden when only the main tab exists; appears the moment a second tab materialises.
- **Per-tab state** — `_tabs: Map<id, state>` on the chat panel, with `makeTabState()` factory and `installReactiveAccessors` (in `state.js`) installing prototype getters/setters that forward every reactive property to the active tab's slot. `noAccessor: true` in `properties.js` opts out of Lit's default accessor installation.
- **Tab activation** — click handler in `tabs.js`, Alt+` cycling via `onChatTabShortcut`, LED-row click via `led-row.js`'s `scrollTabIntoView`. The setter on `_activeTabId` snapshots / restores per-tab URL chip state across the singleton `ac-url-chips` element so chip state per tab survives switching.
- **`agentsSpawned` event** — handler in `streaming.js` (`onAgentsSpawned`) calls `spawnAgentTabs` in `tabs.js`, creating tabs SYNCHRONOUSLY before child stream chunks arrive (the spec's tab-creation-ordering invariant — without this, fast-completing agents' chunks are dropped because no tab claims the child request ID yet).
- **Streaming routing** — `findTabForRequest` in `tabs.js` matches by exact ID first, then by parent-prefix (`{parent}-agent-NN`). Both `onStreamChunk` and `onStreamComplete` route through this. Pending-chunk coalescing per animation frame is per-tab.
- **`agent_tag` routing** — `send()` in `input.js` reads the active tab id, passes it through `parseAgentTabId` (`null` for main, the id otherwise), and threads the result as `chat_streaming`'s `agent_tag` argument. Stale-agent error response (`{error: "agent not found"}`) closes the tab locally and toasts the user.
- **LED row** — `led-row.js`'s `renderLedRow()` produces one dot for main plus one per agent tab. State is cyan (streaming) / green (clean) / red (error) per `getLedState()`; tooltip via `formatLedTooltip()` carries id + mode + outcome ("running" / "completed (N edits applied)" / "<failure reason>"). Click activates the tab and scrolls the strip into view.
- **File picker per-tab scope** — `_selectedFilesByTab` and `_excludedFilesByTab` Maps in `files-tab/index.js`; `active-tab-changed` listener swaps picker state to the new tab; `applySelection` and `applyExclusion` route to `LLMService.set_selected_files` for main / `set_agent_selected_files(agent_id, files)` for agent tabs (mirror for exclusion).
- **Close affordance** — `onTabClose` in `tabs.js` removes the tab from `_tabs` and `_tabLabels`, switches to main if the closed tab was active, fires the `close-tab` event, and calls `LLMService.close_agent_context(agent_id)` fire-and-forget.

Test coverage in `webapp/src/chat-panel/tabs.test.js` (~1100 lines), `streaming.test.js` (~1300 lines), `state.test.js`, `led-row.test.js`, and `webapp/src/files-tab/per-tab.test.js` pins every contract item above. Hundreds of test cases.

Why this section says "already delivered" rather than just striking it through: the level of detail above is the audit trail. A future session reading the plan should not re-do the audit to confirm — the catalog of what was found, where it lives, and how tests pin it is the documentation that prevents wasted re-implementation work. The lesson for the plan-writing process is to read the source before writing scope statements; symbol maps showed the existence of `spawnAgentTabs`, `parseAgentTabId`, `_makeTabState`, `installReactiveAccessors`, `findTabForRequest`, and `renderTabStrip` but the original plan still labelled the whole increment "not started." The audit corrected that.

### ~~Increment C — Tab rehydration on refresh / reconnect~~ — already delivered (audit recovery, post-A)

Same audit, same finding: implemented and tested. `rehydrateLiveAgents` lives in `webapp/src/chat-panel/events.js`; it's called from `onRpcReady` after the proxy publishes. The function calls `LLMService.list_live_agents()` (returns one entry per registered agent), passes the entries to `rehydrateAgentTabs` in `tabs.js` to materialise writable tabs, then loads conversation content per turn via `get_turn_archive(turn_id)` filtered to each agent's `agent_idx`. Per-tab LED outcome is recomputed from archive content via `computeOutcomeFromArchive()` (last assistant record's edit_results determine clean/error; cyan can't be recovered because the frontend can't subscribe mid-stream).

Tab IDs use the agent's LLM-chosen string id (per D26 flat identity); `deriveAgentTabLabelFromEntry` produces the user-facing label, recognising positional ids (`agent-NN`) and rendering them as `Agent NN` for visual consistency with spawn-time labels while preserving descriptive ids (`frontend-chat`) verbatim. Rehydration is idempotent — agents already in `_tabs` (e.g. from an earlier `agentsSpawned` in the same connection) are skipped.

The handler is fire-and-forget on errors: a failed `list_live_agents` call logs at console-error level (skipping the routine "method not found" case for stripped-down test fixtures) but never surfaces a toast — running on every connect, transient failures shouldn't punish the user with a notification on every reload.

### ~~Increment D — Per-turn historical view~~ — delivered

Implements agent-browser.md § "Historical Turns". Three commits:

- **Commit 1 (`7774c18`)** — field threading. `turn_id` and `agent_blocks` ride through stream-complete, session-changed, state-loaded, and compaction-event mutation paths. Without this, persisted-then-reloaded messages lost the metadata the renderer needs.
- **Commit 2 (`d3b203f`)** — view-agents affordance. Assistant messages from previous agentic turns render a "View agents (N)" button below the body. Visibility gated on partial-overlap (at least one agent no longer live in the tab strip), so the active turn — whose agents are already reachable via the strip — doesn't grow a duplicate button.
- **Commit 3 (`65b82da`)** — load handler. Click fetches the archive via `get_turn_archive(turn_id)`, creates read-only tabs with `historical:{turn_id}/{agent_id}` ids, marks them `readOnly: true`, disables the input on those tabs, and switches to the first new tab. Idempotent re-clicks clear prior historical tabs so the strip doesn't accumulate.

Deferred:
- **Scroll-away cleanup.** Spec says historical tabs should disappear when the user scrolls away from their parent message. Currently the user closes them explicitly via the existing tab close button or by triggering another View Agents click (which clears the strip first). Not critical to D's value; revisit if the manual-close UX produces complaints.

### ~~Increment D.5 — Inline agent-spawn card rendering~~ — delivered

Closes a gap that D and the original A–E plan both missed: when the orchestrator emits a `🟧🟧🟧 AGENT … 🟩🟩🟩 AGEND` block in its assistant response, the chat panel now renders it as a card inline in the message body — symmetric to edit-block cards. Before this, the markers fell through the segmenter as plain `text` segments and rendered as preformatted prose, which read as visual garbage in the orchestrator's output.

Three files, one new module, no backend changes:

- **`webapp/src/edit-blocks.js`** — `segmentResponse` learned a `reading-agent` state and emits `agent` / `agent-pending` segments alongside the existing `text` / `edit` / `edit-pending` types. Body parsed into `{id, task, mode}` via a new `_parseAgentBody` helper that uses a field-name allowlist (`id` / `task` / `mode`) so multi-line task bodies containing `Requirements:` / `Notes:` / `Examples:` headings don't truncate. Mirrors the backend `EditParser`'s allowlist contract from `specs-reference/3-llm/edit-protocol.md`.

- **`webapp/src/agent-block-render.js`** (new) — pure rendering helpers symmetric to `edit-block-render.js`. Exports `renderAgentCard(segment, status)` plus piecewise helpers (`renderAgentId`, `renderModePill`, `renderTaskBody`, `renderStatusBadge`, `resolveDisplayStatus`) and the `STATUS_META` table for tests. Status enum is `pending` / `streaming` / `complete` / `error` per `specs4/7-future/parallel-agents.md` § Frontend agent-block rendering. Long task bodies (more than ~6 lines or 600 chars) wrap in `<details>` so the card doesn't dominate the message.

- **`webapp/src/chat-panel/rendering.js`** — `renderAssistantBody` dispatches `agent` / `agent-pending` segments to `renderAgentCard`. Wraps the unsafeHTML output in a Lit `<div class="agent-block-wrapper">` with a delegated click handler `_onAgentCardClick` that reads `data-agent-id` off the chip and flips `panel._activeTabId` directly when a tab with that id exists. No round-trip through `events.js` — same in-file pattern the file summary chips use.

- **`webapp/src/chat-panel/styles.js`** — agent-card styling. Magenta accent (`rgba(210, 168, 255, ...)`) distinct from the edit-block blue so users can tell at a glance whether a card is "the LLM proposes a file edit" or "the LLM spawned a worker agent". Status-badge variants for the four statuses with a `agent-pulse` keyframe for the streaming state. Long-task `<details>` styling.

Status binding reads per-tab streaming state via the same Map the LED row uses: tab id == agent id under D26's flat-identity contract, so `_resolveAgentStatus` is a direct `panel._tabs.get(id)` lookup with no parsing. `tab.streaming` → `streaming`; `tab.lastEditOutcome.status === 'clean'` → `complete`; `tab.lastEditOutcome.status === 'error'` → `error`; tab present but no completion yet → `pending`; tab missing entirely (historical message whose agent has been closed) → `pending`. Card status reflects state at render time; live updates piggyback on the message card's existing re-render triggers (chunk arrivals, completion events) — no separate subscription.

What this delivery does NOT cover:

- **Tests for the new behaviour.** `agent-block-render.test.js` and the new `reading-agent` cases in `edit-blocks.test.js` should land as a follow-up.
- **Status-update push.** A historical-but-still-live agent's card may show stale status until the parent message re-renders for some other reason. A `requestUpdate` on `agentsSpawned` and on each agent's `streamComplete` would fix this; deferred until a real case appears where the staleness is visible.

### Increment E — Cross-turn agent history view

Implements the feature D30's `agent_blocks` persistence enables. UI affordance: a control on a live agent's tab (e.g., "show full history across all turns") that walks the main store, finds turns where that agent's `id` appears in `agent_blocks`, and presents a unified view. Or equivalently: a "filter by agent id" view in the history browser.

Scope:
- Backend RPC `get_agent_history(agent_id)` that scans `history.jsonl` for assistant records with non-empty `agent_blocks` containing the matching id, then for each match calls `get_turn_archive(turn_id)` filtered to that turn's `agent_idx`. Returns the concatenated record list in turn order (chronological by user-message timestamp).
- Frontend affordance — exact UX TBD based on B-D usage. Could be a button on the agent tab, a filter in the history browser, or both.

Highest-spec, lowest-volume use case. Defer until B-D are in real use; once you've used the per-turn view for a few weeks, you'll know exactly what cross-turn affordance is missing — and `agent_blocks` will already be in the JSONL waiting.

### Delivery order

Increments A, B, and C delivered. (B and C were marked "not started" in the original plan but a post-A audit found both already shipped — see their respective delivery-note sections.) D is the next concrete piece of work; it depends on B's tab construction infrastructure (which is in place). E follows once D has shipped and seen real use. Each remaining increment gets its own delivery-note section here when it lands.

## Agents as first-class persistent entities

The agent-mode UI plan above (A–E) makes agents *visible* in the chat panel — tabs, LEDs, archives, historical views. This plan addresses the orthogonal architectural gap: agents currently aren't *persistent* the way main's session is. Three concrete symptoms today:

1. **Clicking "new session" doesn't reset agents.** The button is rendered on every tab including agents but only ever resets main. Confusing UX. Bug surfaced 2025-01.
2. **Reloading an old session restores main's history but no agents.** Agent archives sit on disk untouched. Even though `agent_blocks` (per D30) records which agents participated in each turn, no code path uses that to reconstruct agents.
3. **Mid-session per-agent mode changes are not supported.** The spec (system_agentic_appendix.md) explicitly says mode is fixed for the life of an agent. To change mode, the user must close the agent and respawn under a new id. This was a deliberate trade for simplicity — but it means a code-mode agent can't be promoted to code+xref to consult docs without losing its conversation history.

The architectural shift: treat agents the way we treat main. Their mode can change. Their state persists across session-reset and session-reload. Reconstructing an agent from disk produces a live, writable ContextManager — same as main's session-reload behaviour.

Five increments, ordered cheap-to-architectural so each commit ships a working improvement and the system stays internally consistent at every step. Each commit lands with tests; spec updates land with the commits that change behaviour.

### ~~Increment 1 — Hide tab-scoped buttons that don't apply to agents~~ — delivered

Pure UI fix, no backend, no spec change. The chat panel's action bar renders new-session, history-browser, mode toggle, cross-reference toggle, and snippet drawer on every tab. Several of those don't make sense on agent tabs.

Audit of what was already gated and what wasn't, conducted on the live source:

- **Mode toggle (code/doc segmented)** — already gated on `panel._activeTabId === 'main'` from earlier work. ✓ no change needed.
- **Cross-reference toggle** — already gated on `panel._activeTabId === 'main'`. ✓ no change needed.
- **New-session button (✨)** — was ungated. Calls `onNewSession` which clears main's session id and history. Wrong on agent tabs. Now gated.
- **History button (📜)** — was ungated. Opens the history-browser modal which loads sessions over main's context. Wrong on agent tabs. Now gated.
- **Reasoning toggle (🧠)** — deliberately left alone. Per-call setting that applies to whichever tab is sending; agents can benefit from reasoning too. The experimental flag still gates whether it renders at all.
- **Snippet drawer button (✂️)** — deliberately left alone. Snippets are per-mode and useful on every conversation type.
- **Search bar** — deliberately left alone. Works on every tab (message search within the active tab; file search globally).

Implementation: extended the existing `panel._searchMode === 'file' || ...` gate around the new-session/history `action-group` to also include `panel._activeTabId !== 'main'`. Both buttons sit inside the same div and route through the same divider, so a single compound condition gates the whole group cleanly.

Test coverage in `webapp/src/chat-panel/action-bar.test.js` (16 tests across six describe blocks): main-tab visibility for all four button groups, agent-tab hiding of the four hide-target buttons, search-bar and snippet-drawer survival on agents, read-only historical-tab hiding (inherits the same rules since the tab id isn't `'main'`), file-search mode preserving its pre-existing hide, compound gate behavior (file-search + agent both true), tab-switching reactivity in both directions, reasoning-toggle symmetric-rendering invariant (if it renders on main, it renders on agents — pins the deliberate non-gate).

Why Increment 1 *first*: the audit-then-action sequence reveals that the spec gap was narrower than the original plan implied. Half the controls the plan called out were already correctly gated. The remaining gap was a single render expression covering two adjacent buttons. The 30-second user-visible benefit (no more "I clicked new-session and nothing happened") is realised via a one-line gate change plus tests pinning the contract.

### ~~Increment 2 — `new_session` closes all live agents~~ — delivered

Backend-only change with broadcast-driven frontend visibility. Reverses the D24/D25 "agents survive new_session" policy after audit revealed the resulting UX bug: the new-session button was rendered on every tab including agents but only ever reset main, leaving users on agent tabs clicking and seeing nothing happen. Increment 1 hid the button on agent tabs (palliative); Increment 2 fixes the underlying policy.

Implementation in `src/ac_dc/llm/_rpc_state.py:new_session`:

1. Clear `_active_agent_streams` first — signals any in-flight agent task to stop on its next chunk check, before its scope vanishes underneath it.
2. Snapshot the agent ids, then `_agent_contexts.clear()` to free `ContextManager` + `StabilityTracker` + `file_context` per agent.
3. Broadcast `agentClosed {agent_id}` for each snapshot id BEFORE `sessionChanged`. Order matters: `sessionChanged` triggers the chat panel to reload main's empty history, so agent tabs need to be gone first to avoid the "live tab with empty history" flash.
4. Per-turn archive files on disk survive — closing frees memory; transcripts stay readable via `get_turn_archive` for any turn the agent participated in.

Tests in `tests/test_llm_service/test_sessions.py § TestNewSessionClosesAgents` cover empty-registry no-op, single/multi-agent close, agentClosed payload shape (`{agent_id: str}` — pinned so future additions trip the test rather than silently break the frontend handler), broadcast ordering, in-flight stream cancellation, post-close agent-not-found behaviour, and archive-file preservation. The existing `test_new_session_preserves_agent_scopes` in `test_agent_lifecycle.py` was updated to `test_new_session_closes_all_live_agents` reflecting the new contract.

Spec updates deferred — `specs4/5-webapp/agent-browser.md § Tab Lifetime` and `specs4/7-future/parallel-agents.md § Agent lifetime` both currently document the old "agents survive" policy and need updating. Filing as a follow-up doc-mode pass since the behavioural test suite is now the authoritative specification.

Frontend impact — none required for Increment 2 itself. The chat panel needs an `agentClosed` event handler that calls `_onTabClose(detail.agent_id)` to remove the tab and free per-tab state. Without that handler, agent tabs persist on the frontend after `new_session` until the user closes them manually (the backend has freed the scope, so any RPC routed to those tabs returns `{error: "agent not found"}` — which the existing stale-tag handling in `chat-panel/streaming.js` already converts to a tab-close + toast). The frontend behaviour is therefore correct-but-unpolished without the handler; landing the handler is part of the next webapp commit.

### Increment 3 — Persist per-agent state on disk

Forward-compatible foundation for Increments 4 and 5. Doesn't change runtime behaviour today; lays the bytes that future reconstruction reads.

Two sub-changes:

#### ~~3a — Extend `agent_blocks` with initial state~~ — delivered

The orchestrator's assistant record now persists per-agent state alongside identity. Extends D30's `{id, agent_idx}` shape with three optional fields:

- `mode` — one of `code` / `doc` / `code+xref` / `doc+xref`. Captured at write time so reconstruction (Increment 5) installs the right system prompt when rebuilding the agent's ContextManager.
- `cross_reference_enabled` — bool. Redundant with the mode string's `+xref` suffix but stored explicitly so reconstruction reads one field rather than parsing the mode. Future per-agent xref toggle (Increment 4) writes this directly.
- `model` — provider-qualified id like `anthropic/claude-sonnet-4-5`. Today every agent inherits the orchestrator's model; field is forward-compat for a future per-agent override and ensures reconstruction routes an agent's continuation to the same provider it spawned against.

Implementation in two places:

1. **`HistoryStore.append_message`** (`src/ac_dc/history_store.py`) — `agent_blocks` filter extended to accept and round-trip the three new fields. Defensive validation: unknown mode strings dropped (so a future write-side mode value can't corrupt records the read-side doesn't recognise), strict bool check on cross-ref (rejects 0/1 ints), empty-string model dropped. Required `id` and `agent_idx` contract unchanged — optional fields don't promote malformed entries to valid.

2. **`stream_chat`** (`src/ac_dc/llm/_streaming.py`) — persistence-write site builds the per-block summary with mode resolution mirroring the `agentsSpawned` broadcast path (existing agents on retask keep their current mode; fresh spawns resolve via `_resolve_agent_mode` against the orchestrator's scope). Model read from `service._config.model` rather than from the agent's ContextManager since fresh-spawn scopes don't exist yet at this persistence point. Defensive: a config read failure must not block persistence — reconstruction tolerates a missing model field.

Tests: `TestAgentBlocksOptionalFields` in `test_history_store.py` pins the persistence contract (round-trip, partial fields, all four valid modes, defensive filtering for unknown/non-bool/non-string values, backwards-compat with pre-3a bare `{id, agent_idx}` shape). `TestAgentBlocksPersistence` in `test_agent_spawn.py` extended with four end-to-end tests through `_stream_chat`: explicit + inherited mode persist correctly, cross-ref flag both values round-trip, model field carries the orchestrator's config value, retasked agent persists the existing agent's mode (not the orchestrator's drifted mode).

Backwards-compat: D30 records (bare `{id, agent_idx}`) load correctly; reconstruction tolerates absent fields by falling back to current orchestrator state. Records with the new fields load on systems that don't yet read them — JSON dict round-trips ignore unknown keys.

#### 3b — Write per-agent mode-change events to the archive

Lands with Increment 4. When per-agent mode toggles ship, each toggle writes a system-event message to the agent's `.ac-dc4/agents/{turn_id}/agent-NN.jsonl` archive marking the transition. Reconstruction replays these events to arrive at the agent's final mode rather than relying solely on the spawn-time mode in `agent_blocks`.

Scope:
- `HistoryStore` — new `append_agent_system_event(turn_id, agent_idx, event_type, payload)` helper for mode-change events.
- Tests pinning the on-disk shape.

No frontend change. No reconstruction yet — just the data.

### Increment 4 — Per-agent mode toggle

The user-visible feature: the mode toggle on an agent tab actually changes that agent's mode.

Split into two parts. 4a (backend) lands first; 4b (frontend) follows.

#### ~~4a — Backend: per-agent mode RPCs~~ — delivered

Two new RPCs in `_rpc_state.py`:

- **`LLMService.switch_agent_mode(agent_id, mode)`** — accepts the four combined mode strings (`code` / `doc` / `code+xref` / `doc+xref`) and flattens them into the agent's ContextManager's two axes. Validates the id, the mode shape, and the mid-stream guard (rejects when `agent_id in _active_agent_streams`). On a real change: applies the mode and cross-ref flags, rebuilds the agent's `StabilityTracker` (every tier prefix invalidated by the new prompt + index combination), writes a mode-change system event to the agent's archive via `scope.archival_append`, broadcasts `agentModeChanged`. No-op short-circuit when the new state matches the current state — saves a needless tracker rebuild and skips the event/broadcast.

- **`LLMService.set_agent_cross_reference(agent_id, enabled)`** — same shape, axis-isolated. Critical contract: toggling cross-ref MUST NOT touch the primary mode. Pinned by `test_disables_xref_preserving_mode` which exercises a `doc+xref → doc` transition and asserts `Mode.DOC` survives.

Helper functions in the same module: `_parse_agent_mode_string` (wire string → `(Mode, bool)`), `_format_agent_mode` (the inverse, used for archive event content), `_rebuild_agent_tracker` (replace `scope.tracker` with a fresh `StabilityTracker` and re-attach via `scope.context.set_stability_tracker`).

Archive system events follow the format `"Mode changed: {old} → {new}."` for both RPCs — reconstruction (Increment 5) can parse one format. Sink failures are logged at WARNING and swallowed; the in-memory mode change is authoritative.

Both RPCs are localhost-only, matching the rest of the agent-keyed surface. `LLMService` exposes thin delegators (`switch_agent_mode`, `set_agent_cross_reference`).

The orchestrator's prompt-time descriptor (per `specs4/7-future/parallel-agents.md` § Per-agent state descriptor) already reads each agent's mode from its live ContextManager via `build_agent_descriptor`, so a successful switch is visible to main on its very next turn without any further wiring. The "verify" item from the original 4a scope is satisfied by inspection of `_agents.py:build_agent_descriptor` which calls `cm.mode` and `cm.cross_reference_enabled` — both now fresh after a switch.

Tests: `TestSwitchAgentMode` (12 tests) and `TestSetAgentCrossReference` (12 tests) in `test_agent_lifecycle.py` cover happy paths for every transition, no-op short-circuits, unknown-agent errors, malformed-mode errors (string and non-string), mid-stream rejection, tracker rebuild side-effect, ContextManager attachment update, archive event persistence with content matching the format above, broadcast payload shape (`{agent_id, mode, cross_reference_enabled}`), no-broadcast on no-op. Companion `*LocalhostOnly` classes pin the restriction gate.

What 4a does NOT deliver: per-agent mode-change events being interleaved with normal agent conversation in the archive. The archive write happens via `archival_append` which targets the agent's `agent-NN.jsonl` file directly — so the sequence is correct and chronological, but the agent's NEXT turn's records (when the user replies) come AFTER the mode-change event, not woven in. This matches the design — system events are operational records, not conversational turns.

What 4a sets up for 4b: the RPC surface is stable, the broadcast event name (`agentModeChanged`) is fixed, and the frontend can route a single click to `switch_agent_mode` for combined transitions OR to `set_agent_cross_reference` for the overlay-only toggle. Same pattern as the main-tab segmented + overlay UI.

#### ~~4b — Frontend: render mode toggle on agent tabs and route to per-agent RPCs~~ — delivered

Reverse of Increment 1's hide for the mode toggle group. The mode toggle now appears on every tab (main, agent, historical); the new-session and history buttons stay main-only because their semantics don't translate (see Increment 1 for the original gate).

Implementation:

- **`webapp/src/chat-panel/rendering.js`** — Extracted the existing inline toggle JSX into a new `renderModeToggle(panel)` helper. The helper resolves state via `_resolveActiveTabMode(panel)` which reads from `_mode` / `_crossRefEnabled` for main and from `_tabModes.get(activeTabId)` for agents. The combined mode strings (`code` / `doc` / `code+xref` / `doc+xref`) parse cleanly with `endsWith('+xref')` + `replace('+xref', '')`. Disabled rules baked into the helper:
  - RPC disconnected → every tab disabled
  - Main + non-localhost → disabled (collab participants can't switch host's mode)
  - Agent + streaming → disabled (matches backend's mid-stream rejection in `LLMService.switch_agent_mode`)
  - Historical (read-only) tab → disabled (the ContextManager no longer exists)
  - Tooltips adapt: agent + streaming shows "Wait for the agent to finish before switching mode" rather than a generic mode description.

- **`webapp/src/chat-panel/events.js`** — Split `switchMode` and `toggleCrossRef` into main / agent dispatchers. The exported entry points (`switchMode(panel, mode)` and `toggleCrossRef(panel)`) are still called from the rendered template; they now branch on `panel._activeTabId === 'main'` and route to `_switchMainMode` / `_switchAgentMode` (or the cross-ref equivalents). Agent dispatchers compute the combined mode string from `_tabModes` (preserving xref state across primary-axis switches) and call `LLMService.switch_agent_mode` / `LLMService.set_agent_cross_reference`. New `onAgentModeChanged(panel, event)` handler updates `_tabModes` and `requestUpdate()`s on the `agent-mode-changed` window event. Wired in `bindEventHandlers` / `attachEventListeners` / `detachEventListeners`.

- **`webapp/src/app-shell/index.js`** — New `agentModeChanged(data)` server-push method. The backend's `LLMService.switch_agent_mode` and `set_agent_cross_reference` broadcast `agentModeChanged` per Increment 4a; the AppShell translates it to a window-level `agent-mode-changed` event so the chat panel's listener fires.

- **`webapp/src/chat-panel/action-bar.test.js`** — Updated Increment 1's hide assertions for the mode toggle. The "on agent tab" describe block now asserts the mode toggle and cross-reference toggle are PRESENT (was: hidden). The historical-tab block now asserts the toggle renders but every button is `disabled`. New-session, history, and search-bar tests are unchanged — those gates are still correct.

What 4b deliberately does NOT deliver:

- **Optimistic UI updates.** Click → RPC → broadcast → re-render is the full loop. The user sees the new state on the broadcast, not on the click. Matches main's pattern. Without optimistic updates, a failing RPC (mid-stream rejection, restricted caller, network error) leaves the toggle in its actual state rather than briefly showing the user-attempted state then snapping back.

- **Spec updates.** `specs4/5-webapp/agent-browser.md` should document the per-agent toggle; `src/ac_dc/config/system_agentic_appendix.md` should relax the "mode is fixed for the life of the agent" claim. Filed as a follow-up doc-mode pass — the behavioural test suite is now the authoritative spec for the mid-session mode-change behaviour.

What the user can now do (the scenario from the original 4b plan):

1. Spawn an agent in `code` mode (orchestrator's current mode at spawn time).
2. Switch to the agent's tab. Click 🔀 (cross-ref toggle).
3. Backend's `LLMService.set_agent_cross_reference` rebuilds the agent's tracker, archives the change, broadcasts `agentModeChanged`.
4. Frontend updates `_tabModes` for that agent → re-renders the toggle in the active state → tab strip tooltip updates to `<id> (code+xref)`.
5. Reply to the agent. The next LLM call assembles the agent's prompt with both indexes active.

The orchestrator's prompt-time descriptor reads each agent's mode from the agent's live ContextManager (per Increment 4a's verification), so main sees the new mode in its context on its next turn — no additional plumbing needed.

After 4b lands, Increment 5 (reconstruct agents on session-load) is the remaining piece. Increments 1–4 between them ship the full per-agent persistent-entity surface for the live session; Increment 5 makes that surface survive session restore.

### ~~Increment 5 — Reconstruct agents on session-load~~ — delivered

Three commits across one session: backend reconstruction skeleton with spawn-time baseline (`2284b5b`), archive replay of mode-change events (`312828b`), and `agentsRehydrated` broadcast wiring through to the chat panel's tab-materialisation path (`5ebc844`).

The capstone. Loading an old session now restores not just main's history but every agent that participated — as live, writable scopes reachable via the agent-keyed RPC surface, with their final modes intact (mid-session toggles replayed from archive events) and their full conversation history pre-populated. Reconstructed agents are indistinguishable from agents that have been continuously alive since their first spawn turn — the user can reply, the orchestrator can retask them, the LED row reflects their state. Provider cache starts cold (the rebuilt StabilityTracker has no tier assignments) but everything else works.

Specs landed alongside the implementation: `specs4/3-llm/history.md § Session-Load Reconstruction` (the full nine-step algorithm with replay-from-archive as authoritative source) and `specs4/7-future/parallel-agents.md § Agent lifetime` (paragraph noting session-load as a reconstruction event symmetric with refresh / reconnect).

Replay strategy is **(b)** per spec: walk every `system_event: true` record in the agent's concatenated archive looking for `"Mode changed: {old} → {new}."` content, parse the trailing target, update running state. The spawn-time `agent_blocks` entry serves as the replay's starting baseline only — a mid-session toggle from `code` to `doc+xref` reconstructs as `doc+xref`, not as `code`. Strategy (a) (use spawn-time mode without replay) was rejected because it would silently lose every retask toggle on session reload.

Per-commit delivery record:

**Commit 1 — Reconstruction skeleton with spawn-time baseline only** (`2284b5b`).

`reconstruct_agent_scope` in `src/ac_dc/llm/_agents.py` constructs a ContextManager via the existing `build_agent_context_manager` factory, pre-populates history from concatenated archive content, attaches a fresh StabilityTracker, and registers the scope in `service._agent_contexts[agent_id]`. `_reconstruct_agents_from_session` in `src/ac_dc/llm/_rpc_history.py` walks the session's full records (NOT the context-load shape, which strips `agent_blocks`), groups by agent id keeping the latest record per id (retask wins), concatenates archive content across every turn the id appeared in, and resolves mode from the latest spawn entry. Wired into `load_session_into_context` between the history-set step and the `sessionChanged` broadcast; idempotent against partial registration.

After Commit 1, agents reappeared in `_agent_contexts` after session-load with their conversation history but with the spawn-time mode rather than the post-toggle mode — known-wrong intermediate state per replay strategy.

**Commit 2 — Replay mode-change events on top of spawn-time baseline** (`312828b`).

`_replay_mode_events` in `src/ac_dc/llm/_agents.py` walks `archive_messages` for `system_event: true` records whose content matches the strict format `"Mode changed: {old} → {new}."` produced by `switch_agent_mode` and `set_agent_cross_reference`. Each valid event advances running `(Mode, cross_ref)` state to the parsed target; malformed events skip without raising. `reconstruct_agent_scope` now calls the replay before constructing the ContextManager, so the scope's mode is the post-replay result, not the spawn-time baseline.

The strict format (prefix + arrow + terminating period) is deliberate. A loose match like `"Mode changed: code → doc"` (no terminator) would tolerate writer-side regressions silently — pinning the exact format means a future change to the writer surfaces as a quietly-lost replay rather than continuing to "work" with subtly wrong state.

**Commit 3 — `agentsRehydrated` broadcast + frontend wiring + integration test** (`5ebc844`).

`load_session_into_context` captures `pre_existing_ids = set(_agent_contexts.keys())` before reconstruction, then broadcasts `agentsRehydrated` with the diff against the post-reconstruction registry — only the just-reconstructed ids appear in the payload, not the full registry. Pre-existing agents (from the current session, before the load) stay live but don't re-trigger frontend tab creation. Fired AFTER `sessionChanged` so the chat panel's session-changed handler (which clears messages + streaming state) runs first; reverse order would briefly render the new agent tabs against the old session's main-tab content.

Frontend wiring: `agentsRehydrated` server-push method in `webapp/src/app-shell/index.js` re-dispatches as a window-level `agents-rehydrated` event. `onAgentsRehydrated` in `webapp/src/chat-panel/events.js` calls the existing `rehydrateLiveAgents(panel)` — same path Increment C uses on `onRpcReady` after a browser refresh. The frontend doesn't need to filter by id; `rehydrateLiveAgents` itself queries `list_live_agents()` and creates tabs idempotently.

Integration test `test_full_round_trip_two_service_instances` runs the end-to-end loop: service A spawns an agent (registering the scope, persisting the spawn record with `agent_blocks`, seeding the agent's first user message via `scope.context.add_message`), toggles its mode (writing the mode-change archive event), then a fresh service B with the same history store (simulating a server restart) loads the session and reconstructs. Asserts the agent is in `service_b._agent_contexts`, mode is the post-replay value (Mode.DOC), conversation history contains both the initial task and the mode-change event, and `agentsRehydrated` fired on service B with the agent's id.

What this delivery does NOT cover:
- Per-agent selected-files / excluded-files reconstruction — deferred (always ephemeral, even refresh loses them today).
- Reconstructing a session whose agents' archive files were partially deleted — remaining content reconstructs normally; deleted turns contribute nothing. Replay walks whatever archive content exists.
- Cross-session agent migration — sessions remain isolation boundaries.
- Frontend test for the `agents-rehydrated` → tab materialisation path. Backend behaviour is authoritative and covered by integration tests; the frontend handler is a one-line forwarder to the already-tested `rehydrateLiveAgents` path. Filed for a future commit if the manual UX exposes a regression.

### Delivery order

Increments 1 → 2 → 3 → 4 → 5. Each is a standalone commit (or small commit cluster). The chain dependency:

- 1 unblocks visible UI work without committing to a backend strategy.
- 2 fixes the immediate confusion you reported. Independent of 3+.
- 3 lays bytes for 4 and 5. Doesn't change runtime behaviour, so it can ship without coordinated frontend work.
- 4 needs 3a (initial mode persistence) and 3b (mode-change archive events) to be useful long-term. Without 3, mode changes work in-memory but vanish on reset. We could ship 4 without 3 but it'd be a half-feature.
- 5 needs 3 fully, plus the rebuilt-tracker logic. The reconstruction code is the most novel part of the plan.

Each increment gets its own delivery-note section here when it lands. Strike-through and commit hash, same convention as the agent-mode UI plan.

### What this plan does NOT cover

- **Per-agent selected-files / excluded-files persistence.** Currently lost on every refresh. Worth fixing eventually; not blocking the core "agents as first-class" shift. Separate small commit when needed.
- **Per-agent model selection.** Could a user run agent-0 against Claude Opus and agent-1 against GPT-4? `agent_blocks` extension in 3a includes the model field for forward-compat, but no UI ships in this plan. Separate feature when desired.
- **Cross-session agent migration.** Could the user pull an agent from session A into session B as a new conversation? No — sessions are isolation boundaries. Mixing agents across them isn't part of the model.
- **Agent-to-agent communication.** Agents converse with the user (via their tab) and with the main LLM (via assimilation). Not with each other. Out of scope here, out of scope in `parallel-agents.md`.

## Known bugs — per-tab state

### ~~Agent tab shows duplicated user prompt + stuck cursor after agent completes~~ — fixed

**Symptom.** When the orchestrator spawned agents, the agent's tab showed the user prompt twice — once before the streamed response, once after — and the streaming cursor remained visible indefinitely even though the backend log confirmed `finish_reason='stop'` had fired. After hard browser reload (which loads from archive via `get_agent_history`), the persisted state showed exactly one user prompt + one assistant response per agent, confirming the duplicates were frontend-only.

In two-turn agent sessions the bug compounded:

```
- user prompt 1
- agent response 1
- user prompt 1 (duplicate)
- user prompt 2
- agent response 2
- user prompt 2 (duplicate)
```

Hard reload shrunk this to four items (the persisted truth).

**Root cause.** `spawnAgentTabs` was invoked twice per agentic turn:

1. Eagerly from `onAgentsSpawned` when the backend's `agentsSpawned` broadcast arrived (BEFORE child streams dispatched, so tabs could claim child request IDs in time to route chunks).
2. As a fallback inside main's `onStreamComplete` handler when `result.agent_blocks` was non-empty (intended for older backends that only surface agent blocks via `streamComplete`).

Modern backends emit BOTH events for every agentic turn. The second call hit the retask branch (added in the earlier per-tab streaming routing fix) for every tab — because the tabs already existed from call 1 — and the retask branch appended the user task to `existing.messages` and re-set `existing.currentRequestId = childId`, `existing.streaming = true`. By the time the fallback fired, the agent's child stream had already completed and cleared those flags, so the re-arm produced a cursor that would never advance.

**Fix.** Memoise on `parent_request_id` inside `spawnAgentTabs`. The first invocation for a given parent request runs the create/retask logic; subsequent invocations with the same parent request id no-op. Turn boundaries are distinguished by parent request id (each turn has its own), so retask in turn 2 still appends correctly while the duplicate fallback inside turn 2 no-ops. The memo set is session-scoped — `new_session` doesn't clear it, but parent request ids carry an epoch prefix and don't collide across sessions in practice.

**Why memoise rather than remove the fallback.** The fallback path's stated purpose (older-backend support) is preserved — for a backend that emits only `streamComplete` and not `agentsSpawned`, the first invocation IS the fallback, and it runs normally because no prior call recorded the parent request id. The memo only suppresses redundant work, not necessary work.

**Spec updates.** `specs4/5-webapp/agent-browser.md` § Tab Creation Ordering gained a new "Idempotency under the dual-event design" paragraph documenting the dual-call architecture and the memoise-on-parent-request-id contract. See D32 in [`decisions.md`](decisions.md) for the deeper architectural rationale.

### URL fetch result lands in wrong tab when user switches tabs mid-fetch

**Symptom.** A URL fetch is initiated from agent tab A (user clicks "Fetch" on a chip). While the RPC is in flight (GitHub repo clone + symbol map generation can take 10+ seconds), the user switches to agent tab B. When the fetch resolves, `chipsEl.markFetched(url, result)` runs against whichever tab's chip state is currently installed on the singleton `ac-url-chips` element — which is B, not A. The user sees a chip for a URL they never fetched on B, and A's own chip stays in `fetching` state indefinitely.

**Root cause.** Per-tab URL chip state (D23 Commit 4) is swapped in/out of the singleton `ac-url-chips` element on tab switch via `_snapshotUrlChipsForTab` / `_restoreUrlChipsForTab`. The fetch RPC closure in `_onUrlFetchRequested` captures the `chipsEl` reference, not the tab ID — so when the promise resolves, the mutation lands on whichever tab is currently showing.

**Fix shape (when this becomes a real pain point).** Capture the originating tab ID at fetch-initiation time, look up that tab's state slot when the promise resolves, and mutate the state slot directly (rather than via the singleton element). If the originating tab is still active, also mutate the live element. If it's inactive, the snapshot carries the updated state and restoration on next tab switch surfaces it. Same pattern for `markErrored`.

**Why deferred.** The bug only fires when the user actively switches tabs during a multi-second fetch — rare outside of GitHub repo clones. The common case (stay on the tab while URL fetches complete) works correctly. Fixing it requires threading the tab ID through three async paths (`markFetching`, `markFetched`/`markErrored`, and the chat-panel-level view-content dialog's fallback fetch) and adding a per-tab chip-mutation helper that operates on snapshots rather than the live element.

**Grep for `TODO(url-fetch-cross-tab)` in `chat-panel.js` when attacking this.**

## Deferred cleanup

Temporary scaffolding installed to keep a test/output path quiet, with the fix scheduled for a specific future phase. Grep `TODO(phase-` across the tree to find markers.

- **`webapp/src/app-shell.test.js` — `describe('setupDone')` console.error silence.** The `beforeEach`/`afterEach` pair in the setupDone describe block installs a `vi.spyOn(console, 'error').mockImplementation(() => {})` to swallow errors from the files-tab's `onRpcReady` handler when it tries `Repo.get_file_tree` on a fake proxy that doesn't implement it. The errors are genuine — the files-tab genuinely can't fetch the tree — but they're out of scope for app-shell tests which focus on shell-level wire-up, not files-tab RPC behavior. **Remove when:** Phase 2d expands these shell tests (or adds a separate integration test class) that publishes a richer fake proxy including `Repo.get_file_tree`, at which point the files-tab's RPC call succeeds and the console.error goes away naturally. The TODO comment in the test file references `TODO(phase-2d)` so it shows up in that phase's grep sweep.

## Resumption protocol

If a response drops mid-layer, the next response begins by:

1. Reading the files currently in context (not relying on memory of what was delivered).
2. Identifying the last known good state — the latest complete file, the latest test that passed.
3. Continuing from there with one file per response when length is tight.

Do not rewrite files that are already complete. Do not quote large sections of previously-delivered content verbatim to "re-establish context" — the context window already carries the file state.

## Layer-transition checklist

Before declaring a layer complete:

- All test files in the layer pass locally (`uv run pytest tests/test_<module>.py` per module).
- `uv run pytest` passes overall — no regression in prior layers.
- `uv run ruff check src tests` has no errors (warnings OK in early layers).
- The work log marks the layer complete and opens the next layer's checklist (this file when active; archived plans / decisions when stable).
- Any deviation from specs4 is recorded as a decision (D-N) in [`decisions.md`](decisions.md).