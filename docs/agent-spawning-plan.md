# Parallel Agents — Spawning Plan

**Status:** not started. Prerequisite (`docs/parallel-agents-scope-refactor.md`) is complete; see IMPLEMENTATION_NOTES.md D24.

Governing spec: `specs4/7-future/parallel-agents.md` § Execution Model.
Decision log: IMPLEMENTATION_NOTES.md D20 (block format), D21 (chat-panel tabs), D22 (use existing streaming pipeline), D23 (agent-mode toggle), D24 (scope refactor).

## Goal

Wire the execution plane behind the `agents.enabled` toggle. When the toggle is on and the main LLM emits agent-spawn blocks, the backend spawns N parallel `_stream_chat` invocations — each with its own `ConversationScope` pointing at a per-agent `ContextManager`, `StabilityTracker`, and selection list. After all agents complete, the backend mechanically assimilates their file changes into the parent's context and selection; there is no automatic synthesis LLM call. Review and iteration are user-driven on follow-up turns — see [parallel-agents.md § Review Step](../specs4/7-future/parallel-agents.md#review-step--user-driven).

The toggle-off path stays byte-identical to today: the agentic appendix is absent from the system prompt, the LLM never emits spawn blocks, and even if a malformed response somehow contained `🟧🟧🟧 AGENT` markers they'd parse as prose and never reach a dispatch path.

## Non-goals

- No chat-panel tab strip this commit sequence. The backend will produce archived per-agent conversations (the storage already exists via Slice 2); the frontend UI to browse them is D21's scope and lands separately.
- No chat-panel streaming indicators for child request IDs. The transport routes chunks by request ID already; the UI presentation of multiple concurrent streams is frontend work, deferred.
- No MCP integration (`specs4/7-future/mcp-integration.md`). The agent block's `extras` dict reserves space for `tools:` but no dispatch path consumes it.
- No decomposition of `llm_service.py` into multiple files. D24 defers this; doing it alongside agent spawning would conflate two refactors.

## Shape

Agent spawning is additive — no existing behaviour changes for single-agent turns. The dispatch happens in `_stream_chat` after the LLM response is fully received and parsed, before the completion result is built.

### Parser dispatch

`EditParser` already recognises `🟧🟧🟧 AGENT` / `🟩🟩🟩 AGEND` as reserved markers (D20 foundation) and accumulates parsed `AgentBlock` instances on the `ParseResult.agent_blocks` list. Today nothing reads that list. Step 1 adds a branch in `_stream_chat` that — when `config.agents_enabled` is true AND `parse_result.agent_blocks` is non-empty AND no other agents are already running this turn — invokes `_spawn_agents_for_turn(agent_blocks, parent_scope, parent_request_id, turn_id)`.

When the toggle is off, the branch is skipped and agent blocks parse as-usual into `parse_result.agent_blocks` but go unused. The `AgentBlock` dataclass already carries a `valid` flag for malformed blocks (missing `id` or `task`); invalid blocks are dropped before dispatch.

### Orchestration

`_spawn_agents_for_turn` is a new method on `LLMService`. Per agent block:

1. Construct an agent `ContextManager` via `agent_factory.build_agent_context_manager(turn_id, agent_idx, model_name=..., history_store=..., ...)`.
2. Construct a fresh `StabilityTracker` for the agent's conversation.
3. Build a per-agent `ConversationScope` — context from step 1, tracker from step 2, session_id equal to the parent's (so the archive's `session_id` field points back at the user-facing session), selected_files starting as a copy of the parent's selection, archival_append wrapped by `build_agent_context_manager` to target the per-agent JSONL.
4. Seed the agent's conversation with the `task` field as a user message — the agent's first turn is as if the user typed that task directly.
5. Compute a child request ID: `f"{parent_request_id}-agent-{agent_idx:02d}"`. The `_is_child_request` helper already recognises this shape and the single-stream guard already lets it through.
6. Fire `_stream_chat(child_request_id, agent.task, files=[], images=[], excluded_urls=[], scope=agent_scope)` as an `asyncio.ensure_future` task.

After scheduling all N tasks, `_spawn_agents_for_turn` awaits `asyncio.gather(*tasks, return_exceptions=True)`. Each agent runs through the full streaming pipeline independently — same edit parsing, same apply path (against the shared repo, serialised by the per-path mutex), same persistence (to the per-agent archive), same post-response stability update (against the agent's own tracker).

### Post-agent assimilation (no synthesis LLM call)

After all agents complete, control returns to the parent `_stream_chat` call. The backend does NOT run a second LLM call to synthesise the agents' output. Per the decision in [parallel-agents.md § Review Step](../specs4/7-future/parallel-agents.md#review-step--user-driven), synthesis is user-driven on the next turn — the backend only assimilates changes mechanically so the parent's next LLM call has the post-change file state in its context.

Step 4 handles assimilation by:

1. Reading `history_store.get_turn_archive(turn_id)` to collect the union of `files_modified` and `files_created` across every agent's assistant messages.
2. For each path in the union:
   - If it's not already in `parent_scope.selected_files`, append it.
   - Refresh its content in `parent_scope.context.file_context` — load for newly-added files, re-read for already-present files. Agent edits landed on disk during their own `_stream_chat` runs; the parent's cached content is stale until this refresh.
3. Broadcast `filesChanged` with the updated parent selection so connected clients' pickers reflect the new selection state.
4. Broadcast `filesModified` with the union of agent-modified paths so pickers reload their tree (git-status badges, line counts).

The parent's initial response text is the turn's final assistant message — there's no concatenation, no second-round streaming. The user sees the main LLM's decomposition narration, then sees the file-picker update with modified-file badges as the broadcasts arrive, then (when they're ready) types a follow-up like "review what the agents did" to drive review on the next turn.

Implementation surface:

- New private method `_assimilate_agent_changes(parent_scope, turn_id)` on `LLMService`.
- Called from `_stream_chat` after `_spawn_agents_for_turn` returns and before the completion result is built.
- The `filesModified` broadcast path already exists (each agent's own `_stream_chat` fires it when their edits land); the parent-level broadcast here is belt-and-braces to catch any post-gather race where an earlier broadcast might have been missed by a just-reconnected client.
- No new event types. No frontend changes.

Chat-panel snippet support: add one snippet to `src/ac_dc/config/snippets.json` under the `code` array — icon 🤖, tooltip "Review agent work", message "Review what the agents did and tell me whether the work is complete." Users click it into their textarea on the follow-up turn. Pure backend-side change; the frontend's existing snippet renderer picks it up automatically.

### What the user sees (backend-observable today)

- Main LLM receives a system prompt with the agentic appendix (when `agents.enabled` is true).
- Main LLM emits agent-spawn blocks in its response.
- Agent conversations fan out in parallel, each persisting to `.ac-dc4/agents/{turn_id}/agent-NN.jsonl`.
- Main LLM receives the transcripts and writes a synthesis.
- User sees: main LLM's initial response (including the spawn blocks as prose), then — after a delay while agents run — the synthesis.

The frontend tab strip (D21) is NOT part of this plan. Until it lands, agent transcripts exist only in the archive files and can be inspected via `get_turn_archive` RPC or direct filesystem access.

## Commit sequence

Each step is a small, reviewable diff that leaves the codebase working and tests passing. If we hit something unexpected at step N, we can stop and rethink without having torn everything apart.

**Step 1 — Parser dispatch scaffold (no execution).** Add a no-op dispatch branch in `_stream_chat` that detects agent blocks and logs them when the toggle is on. Does NOT actually spawn anything — just verifies the condition is reachable, the `AgentBlock` shape is what we expect, and the toggle gates correctly. Add tests: toggle-off path ignores blocks, toggle-on path logs exactly the parsed blocks, invalid blocks are filtered out before the log.

**Step 2 — `_spawn_agents_for_turn` skeleton.** Implement the method with per-agent scope construction and child request ID derivation, but stub the `_stream_chat` call with a synchronous no-op that returns an empty result. Wire it into the dispatch branch. Verify: per-agent `ContextManager` instances are built, per-agent archives are created on disk, parent scope's selection list is copied (not shared), guard state is unchanged after all agents "complete".

**Step 3 — Real agent streaming.** Replace the stub with an actual `_stream_chat(..., scope=agent_scope)` call. Use `asyncio.gather(*tasks, return_exceptions=True)` to run them in parallel. Agents run through the full pipeline — including edit-apply to the shared repo, serialised by the existing per-path write mutex. Tests: two agents editing different files both apply; two agents' transcripts end up in separate archive files; an agent raising an exception doesn't kill sibling agents.

**Step 4 — Synthesis step.** After all agents complete, fetch transcripts via `get_turn_archive(turn_id)`, format them into a synthesis prompt, run a second LLM call under the parent request ID. The second call goes through `_run_completion_sync` + streaming callbacks + edit-apply + persistence. The parent scope's `_stream_chat` invocation continues with the synthesis result as its final response text.

**Step 5 — Test hardening.** Add end-to-end tests covering: single-agent turn (happy path — one agent, one file modified, parent's context picks it up), two-agent turn with independent edits (both files land in parent's selection, `filesChanged` + `filesModified` fire with the union), agent emitting no edits (assimilation is a no-op, no spurious broadcasts), agent creating a new file (both `files_created` and `files_modified` paths assimilate correctly), toggle-off turn (no spawning, no assimilation), malformed agent block (dropped before spawn), agent raising mid-stream (sibling agents complete, assimilation proceeds with whatever survived, exception doesn't corrupt parent state), user's follow-up turn after agent run (parent LLM sees the new files in its context and can reason about them).

**Step 6 — Update D24 and add a completion note to IMPLEMENTATION_NOTES.md.** Mark agent execution as delivered. Call out the two deliberate deferrals: (1) the frontend tab strip (D21) — agent conversations exist only in the archive JSONL files until that lands; (2) automatic synthesis — replaced by user-driven review, see parallel-agents.md § Review Step and the `🤖 Review agent work` snippet in snippets.json.

## Invariants

- When `agents.enabled` is false, `_stream_chat` behaves byte-identically to pre-spawning behaviour. Agent blocks parse but nothing dispatches on them.
- When `agents.enabled` is true but the LLM emits no agent blocks, `_stream_chat` behaves byte-identically. The dispatch branch is a no-op on empty input.
- Agent streams are gated by the per-path write mutex in the repo layer, so concurrent edits to the same file from two agents serialise correctly.
- Each agent's `ContextManager`, `StabilityTracker`, and archive file are independent — no shared mutable state across agents.
- The parent's scope (context, tracker, session_id, selected_files, archival_append) is never mutated by agent runs. Agent runs mutate their own scopes.
- Main-conversation-only state (`_review_active`, `_review_state`, `_committing`) stays on `self`. Agents never enter review, never commit.
- Child request IDs follow the `{parent}-agent-{NN}` shape so `_is_child_request` returns true and the single-stream guard allows them through.
- No automatic synthesis LLM call runs after agents complete. The parent's initial response (containing the spawn blocks as prose) IS the turn's final assistant message. Assimilation of agent changes into the parent's context and selection is a mechanical post-agent step, not an LLM call. Review and iteration happen on subsequent user turns driven by the user (typically via the `🤖 Review agent work` snippet in code-mode snippets).

## Progress log

(Update after each step lands.)

- **Step 1** — delivered. Adds `_maybe_dispatch_agents` on `LLMService` as a reachable no-op scaffold. Parses the final response a second time at the dispatch point (deferring dedup with `_build_completion_result`'s parse to Step 2), filters agent blocks to valid ones, and logs at INFO when the toggle is on. Gated on: toggle on, non-empty block list, not a child request, not cancelled, non-empty response. 11 new tests in `TestAgentDispatchScaffold` cover unit-level gating (toggle-off early return, empty input, valid/invalid mixes, all-invalid warning) plus end-to-end through `_stream_chat` (toggle-on dispatch fires, toggle-off skip, cancellation skip, child-request skip, no-blocks skip, multi-block fan-out). No runtime behaviour change when toggle is off — the branch never runs. When toggle is on and the LLM emits agent blocks, operators see INFO log lines showing what Step 2 will actually spawn.
- **Step 2** — delivered. Splits the log-only scaffold into two methods: `_filter_dispatchable_agents` applies the toggle/non-empty/valid gates and logs the filter result; `_spawn_agents_for_turn` constructs per-agent `ConversationScope` instances via `agent_factory.build_agent_context_manager` plus a fresh `StabilityTracker`, derives child request IDs as `{parent}-agent-{NN:02d}`, and fans out N tasks via `asyncio.gather(return_exceptions=True)`. A new `_agent_stream_impl` attribute on `LLMService` holds the callable invoked per agent — in Step 2 it's `_stream_chat_stub` (a no-op logger matching `_stream_chat`'s signature); Step 3 flips it to `_stream_chat` for real streaming. 12 new tests in `TestAgentSpawn` cover empty-input no-op, per-agent ContextManager/StabilityTracker/session_id/selected_files wiring, parent-scope non-mutation through spawn, guard-state preservation, archive directory lazy creation, sibling-exception isolation via `gather(return_exceptions=True)`, and the no-history-store error path. `TestAgentDispatchScaffold`'s end-to-end tests updated to assert the recording stub was invoked (not just log lines) — proving the spawn path fires end-to-end. No new RPC surface; the stub pattern means Step 3 is a one-line change (`_agent_stream_impl = self._stream_chat`) plus whatever hardening tests pin the real streaming path.
- **Step 3** — delivered. Flips `_agent_stream_impl` from the stub to `_stream_chat`. Each spawned agent now runs through the full pipeline: LLM call, edit parse, edit apply (serialised by `Repo._get_write_lock` per-path mutex), persistence to per-agent archive, post-response stability update. Adds `_FakeLiteLLM.queue_streaming_chunks` / `queue_streaming_error` — a FIFO of per-call directives so N parallel agents each receive their planned output regardless of scheduling order. New `TestAgentExecutionEndToEnd` class with 4 integration tests: two-agent archives written correctly, one-agent edit path (exercises the not-in-context auto-add branch in the agent's apply), sibling-exception isolation via queued LiteLLM raise, and `filesChanged` broadcast suppression on child streams (prevents agent selection from stomping the user's picker until D21's tab UI routes per-tab selection). Adds one regression test in `TestAgentSpawn` pinning that `_agent_stream_impl == _stream_chat` by default so a future accidental re-alias to the stub fails loudly. Concurrency review confirmed: `_stream_executor` pool (4 workers) handles typical 2-8 agent fan-outs; `_main_loop` already captured in `chat_streaming` before the first spawn; `_active_user_request` guard already passes child IDs through via `_is_child_request`; per-request accumulator slots are keyed by ID so agents don't collide; `_post_response` operates on `scope.tracker` (per-agent). Stub remains in the codebase for tests that want a trivial no-op impl; production paths never reach it.
- **Step 4** — not yet started. **Scope revised** (see Edit 7 in the planning session that preceded this log entry): originally a synthesis LLM call; now a mechanical `_assimilate_agent_changes(parent_scope, turn_id)` that reads `history_store.get_turn_archive(turn_id)`, unions `files_modified` + `files_created` across agents, appends new paths to `parent_scope.selected_files`, refreshes content in `parent_scope.context.file_context`, and fires `filesChanged` + `filesModified` broadcasts. No second LLM call. Also adds one snippet to `src/ac_dc/config/snippets.json` (🤖 "Review agent work") so users can one-click the follow-up review prompt. See `specs4/7-future/parallel-agents.md` § Review Step — User-Driven.
- **Step 5** — not yet started. **Scope revised**: tests now cover assimilation behaviour (union of modified+created lands in parent's selection and file context, no-edit agents produce no broadcasts, new-file agents assimilate via both `files_created` and `files_modified` paths, sibling-exception isolation during assimilation, follow-up turn sees assimilated files in parent context) rather than synthesis-call behaviour.
- **Step 6** — not yet started. **Scope revised**: completion note calls out two deliberate deferrals (frontend tab strip D21, and automatic synthesis — replaced by user-driven review).

## If we get cut off

Check the progress log above. The last completed step is the last one marked "delivered `<hash>`". Pick up from the first "not yet started". Read the relevant sections of `src/ac_dc/llm_service.py`, `src/ac_dc/edit_protocol.py`, and `src/ac_dc/agent_factory.py` fresh — don't reconstruct from memory.

Key files to reorient on:
- `src/ac_dc/llm_service.py` — `_stream_chat`, `_is_child_request`, `_request_accumulators`, `_default_scope`, `ConversationScope`
- `src/ac_dc/agent_factory.py` — `build_agent_context_manager`
- `src/ac_dc/edit_protocol.py` — `EditParser`, `AgentBlock`, `ParseResult.agent_blocks`
- `src/ac_dc/history_store.py` — `get_turn_archive`, `append_agent_message`
- `tests/test_llm_service.py` — `TestIsChildRequest`, `TestChildRequestGuard`, `TestRequestAccumulator`, `TestGetTurnArchiveRPC`, `TestTurnIdPropagation`, `TestConversationScopeDefault` — all foundation work is pinned by existing tests

The refactor is additive: at each step, the previous state still works. If mid-step is uncertain, revert to the previous step's last-known-good point (or run the test suite to verify where you are) and re-do the partial step.

## Follow-on work (not in this plan)

- Frontend tab strip (D21) — surfaces per-agent conversations in the chat panel as additional tabs with per-tab request ID routing, per-tab selection state, and per-tab input.
- Parser dispatch on agent blocks in the frontend markdown renderer — today the chat panel renders agent blocks as prose alongside edit blocks; the tab strip work will add proper rendering.
- `llm_service.py` decomposition (D24 candidate carve-outs) — once agent spawning lands and the module grows further, splitting the streaming pipeline, the RPC surface, and the stability-tier glue into separate modules becomes more attractive.
- MCP integration (`specs4/7-future/mcp-integration.md`) — the `AgentBlock.extras` dict reserves space for a `tools:` field; wiring MCP dispatch would let agents invoke external tools via the same block format.