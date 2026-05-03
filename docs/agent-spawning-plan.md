# Parallel Agents — Spawning Plan

**Status:** not started. Prerequisite (`docs/parallel-agents-scope-refactor.md`) is complete; see IMPLEMENTATION_NOTES.md D24.

Governing spec: `specs4/7-future/parallel-agents.md` § Execution Model.
Decision log: IMPLEMENTATION_NOTES.md D20 (block format), D21 (chat-panel tabs), D22 (use existing streaming pipeline), D23 (agent-mode toggle), D24 (scope refactor).

## Goal

Wire the execution plane behind the `agents.enabled` toggle. When the toggle is on and the main LLM emits agent-spawn blocks, the backend spawns N parallel `_stream_chat` invocations — each with its own `ConversationScope` pointing at a per-agent `ContextManager`, `StabilityTracker`, and selection list — and threads their transcripts back into the main conversation for synthesis.

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

### Synthesis

After all agents complete, control returns to the parent `_stream_chat` call with the agent transcripts available via `history_store.get_turn_archive(turn_id)`. The main LLM needs to SEE those transcripts to synthesise.

Step 4 handles this by:

1. Fetching the archive via `get_turn_archive(turn_id)`.
2. Formatting the per-agent transcripts as a synthesis prompt — "Here is what each agent produced: [agent 0 transcript] [agent 1 transcript] ... Synthesise a response to the original user request."
3. Running a SECOND LLM call from the parent scope with that synthesis prompt as additional context. This call produces the user-visible assistant message for the turn.

The synthesis call goes through the existing `_run_completion_sync` → streamChunk → streamComplete path — the frontend sees streaming chunks arriving under the parent request ID throughout the whole turn (first the agent transcripts stream under child IDs, then the synthesis streams under the parent). Edit-apply from the synthesis step lands in the working tree as usual; edits from agent runs already landed during their own `_stream_chat` calls.

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

**Step 5 — Test hardening.** Add end-to-end tests covering: single-agent turn (happy path), two-agent turn with independent edits, agent emitting no edits (synthesis only), toggle-off turn (no spawning happens), malformed agent block (dropped before spawn), agent raising mid-stream (sibling agents complete, synthesis proceeds with available transcripts).

**Step 6 — Update D24 and add a completion note to IMPLEMENTATION_NOTES.md.** Mark agent execution as delivered. The frontend tab strip (D21) remains deferred; add a note pointing at that future work.

## Invariants

- When `agents.enabled` is false, `_stream_chat` behaves byte-identically to pre-spawning behaviour. Agent blocks parse but nothing dispatches on them.
- When `agents.enabled` is true but the LLM emits no agent blocks, `_stream_chat` behaves byte-identically. The dispatch branch is a no-op on empty input.
- Agent streams are gated by the per-path write mutex in the repo layer, so concurrent edits to the same file from two agents serialise correctly.
- Each agent's `ContextManager`, `StabilityTracker`, and archive file are independent — no shared mutable state across agents.
- The parent's scope (context, tracker, session_id, selected_files, archival_append) is never mutated by agent runs. Agent runs mutate their own scopes.
- Main-conversation-only state (`_review_active`, `_review_state`, `_committing`) stays on `self`. Agents never enter review, never commit.
- Child request IDs follow the `{parent}-agent-{NN}` shape so `_is_child_request` returns true and the single-stream guard allows them through.
- Synthesis is a parent-scope LLM call, not an agent call. Its output is the turn's user-visible assistant message; its edits land in the parent's file context.

## Progress log

(Update after each step lands.)

- **Step 1** — delivered. Adds `_maybe_dispatch_agents` on `LLMService` as a reachable no-op scaffold. Parses the final response a second time at the dispatch point (deferring dedup with `_build_completion_result`'s parse to Step 2), filters agent blocks to valid ones, and logs at INFO when the toggle is on. Gated on: toggle on, non-empty block list, not a child request, not cancelled, non-empty response. 11 new tests in `TestAgentDispatchScaffold` cover unit-level gating (toggle-off early return, empty input, valid/invalid mixes, all-invalid warning) plus end-to-end through `_stream_chat` (toggle-on dispatch fires, toggle-off skip, cancellation skip, child-request skip, no-blocks skip, multi-block fan-out). No runtime behaviour change when toggle is off — the branch never runs. When toggle is on and the LLM emits agent blocks, operators see INFO log lines showing what Step 2 will actually spawn.
- **Step 2** — not yet started.
- **Step 3** — not yet started.
- **Step 4** — not yet started.
- **Step 5** — not yet started.
- **Step 6** — not yet started.

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