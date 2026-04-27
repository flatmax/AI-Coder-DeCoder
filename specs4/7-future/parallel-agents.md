# Parallel Agents

**Status: Not for implementation.** Speculative design for a future parallel LLM execution architecture. Described here for design continuity; do not implement as part of the initial clean-room build.

## Foundation Requirements

Several specs4 invariants exist specifically to make this future mode implementable without refactoring. A reimplementer building the initial single-agent system should verify these are preserved:

| Invariant | Spec | Purpose |
|---|---|---|
| Per-path write mutex in the repository layer | [repository.md](../1-foundation/repository.md#per-path-write-serialization) | Serializes concurrent writes to the same file; zero cost in single-agent operation |
| Apply pipeline is re-entrant | [edit-protocol.md](../3-llm/edit-protocol.md#concurrent-invocation) | Safe to invoke from N threads for different edit-block batches |
| Context manager instances are independent | [context-model.md](../3-llm/context-model.md#multiple-instances) | Multiple coexisting instances share no mutable state |
| Stability tracker is per-context-manager | [context-model.md](../3-llm/context-model.md#stability-tracker-attachment) | Trackers scope to their owning context manager, not to modes |
| Single-stream guard gates user-initiated requests only | [streaming.md](../3-llm/streaming.md#multiple-agent-streams-under-a-parent-request) | Internal agent streams coexist under a parent request ID |
| Request IDs are the multiplexing primitive | [streaming.md](../3-llm/streaming.md#chunk-delivery-semantics) | All server-push events route by exact request ID |
| Streaming state is keyed by request ID on the frontend | [chat.md](../5-webapp/chat.md#streaming-state-keyed-by-request-id) | Chat panel can render N concurrent streams |
| Agent conversations are archived per turn | [history.md](../3-llm/history.md#agent-turn-archive) | Per-agent files under `.ac-dc4/agents/{turn_id}/`; main LLM stays in main history |
| Re-indexing happens between rounds | [symbol-index.md](../2-indexing/symbol-index.md), [document-index.md](../2-indexing/document-index.md) | Indexes are read-only snapshots within a request's execution window |

None of these invariants cost anything in single-agent operation. Preserving them in the initial build means agent mode can be added later without refactoring the foundation layers.

AC⚡DC could execute multiple LLM agents in parallel to accelerate large tasks. The main LLM — the same instance that handles ordinary user turns — decomposes a user request into independent sub-tasks, spawns N agents to execute them in parallel, observes their results, decides whether to iterate (spawn different agents with revised scope) or synthesize, and produces the final assistant response. There is no separate "planner" or "assessor" role; decomposition, review, iteration decisions, and synthesis are all things the main LLM does within a single turn, using its normal conversation store.

## Turn ID Propagation

A user request in agent mode is one **turn** (see [history.md — Turns](../3-llm/history.md#turns)). The turn ID is generated at the top of the streaming pipeline and stored on the user message record in the main history store. It propagates to every agent ContextManager spawned under the turn:

- Main LLM ContextManager — the user-facing session's existing ContextManager, unchanged. It owns `history.jsonl` as always. The turn ID lives on the user message record and on any assistant messages written in this turn.
- Each agent ContextManager — constructed when the main LLM spawns agents. Receives the turn ID at construction and is configured with an archival sink pointing at `.ac-dc4/agents/{turn_id}/agent-NN.jsonl`. Appends every message to that file; never writes to the main history store.

The main LLM does NOT get a separate archival sink — its conversation IS the main history store. Decomposition narration, review commentary, iteration decisions, and synthesis all land in the assistant message's `content` field via normal streaming; a reader of the chat scrollback sees the whole turn unfold inline.

Re-iteration within a turn (main LLM spawns agents, reviews, spawns different agents with revised scope) appends to the existing per-agent files rather than creating new ones — `agent-NN.jsonl` accumulates all iterations of agent NN within that turn, with iteration boundaries implicit in the conversation flow. Agent numbering (`agent-00`, `agent-01`, ...) is stable across iterations within a turn: agent 0 in iteration 2 writes to the same file as agent 0 in iteration 1.

## Archival Contract

Agent conversations are persisted to the per-turn archive (see [history.md — Agent Turn Archive](../3-llm/history.md#agent-turn-archive)) for user-visible browsing, NOT for context reconstruction:

- Session restore reads only the main store; archives are load-on-demand
- Compaction only touches the main store; archive files are append-only, not subject to compaction
- Stability tracking is per-ContextManager; agent trackers are not persisted at all (they live in memory for the duration of the turn and are discarded)

The archive is the **audit trail** for agent execution, not the runtime state. When a turn completes, the only data that matters for subsequent turns is what landed in the main store (the final assistant response and any applied edits). The archive exists purely so users can inspect what each spawned agent did after the fact. The main LLM's own conversation for the turn is in the main store by design — it's an ordinary assistant message, visible in chat scrollback, preserved across session restore.

## Core Principle: Anchor-Based Non-Overlapping Edits

The edit protocol uses exact text anchors (old text → new text), not line numbers. Two agents can safely edit the same file provided their anchors target non-overlapping text regions. The main LLM's job when decomposing is to assign independent work units — classes, functions, documentation sections — not disjoint file sets.

For example, in a single file containing two unrelated classes, one agent can edit one class's methods while another edits the other. Their anchors will not overlap because they target different text regions.

If an agent's edit fails validation (anchor not found, or anchor became ambiguous because another agent modified nearby text), this is a detectable failure — not a corruption. It feeds into the review step.

## Execution Model

- User request arrives; the main LLM (the same ContextManager handling all user turns) begins streaming its response
- Main LLM decides whether the task benefits from parallel decomposition. This is a per-turn judgment based on the request, the symbol map, and any document index; there is no user-facing toggle
- If yes — main LLM emits a decomposition describing N sub-tasks, each specifying work units (classes, functions, doc sections) to create or modify, plus read context
- Main LLM spawns N agent ContextManagers, each with its own turn-scoped archival sink, a focused sub-task, and shared read-only access to indexes and repo
- Agents execute in parallel; no inter-agent communication
- Edits applied to the working directory via the existing edit-block apply pipeline (per-path mutex ensures atomic writes)
- Main LLM waits for all agents to complete, then continues streaming — reviews the combined forward diff, decides whether to iterate (spawn different agents) or synthesize
- On iterate — new decomposition, new agent ContextManagers, another round
- On synthesize — main LLM writes the final synthesis; the assistant message for this turn is complete; user sees the full reasoning and synthesis in chat scrollback

## Main LLM — Decomposition and Synthesis

The main LLM's system prompt (the normal user-facing prompt, extended for agent-mode turns) describes agent-spawning as a tool-like capability. When the main LLM judges a task worth parallelizing, it emits a structured decomposition:

- Natural-language description of each sub-task
- Work units (classes, functions, doc sections) each agent should create or modify
- Read context — files and symbols each agent needs to see but not edit

The decomposition becomes the agents' initial prompts. The LLM does not need to assign disjoint file sets — it assigns independent work units. Using the symbol map's imports, call sites, and cross-references, the LLM identifies clusters of symbols with no cross-references between them, making them safe to edit in parallel.

When all spawned agents have completed, the main LLM reviews the combined forward diff and decides:

- **Synthesize** — the work is complete and internally consistent. The main LLM writes the synthesis (what changed, why, what's left for the user to review), and the assistant message for the turn is complete.
- **Iterate** — some work is incomplete or produced a semantic conflict. The main LLM emits a revised decomposition, spawns fresh agent ContextManagers, and waits for the new round.
- **Abandon parallelism mid-turn** — rarely, the main LLM may decide the sub-tasks are smaller than anticipated and finish the work itself without another round of agents. This is just "stop spawning agents and continue streaming to the user."

There is no separate "review" LLM. The main LLM reviews its own plan's outcome using the same conversation it has been streaming throughout the turn. Users reading the chat see the decomposition, the review commentary ("Agent 2 produced the refactor we wanted; Agent 3 missed the callers — spawning a follow-up"), and the synthesis as one continuous assistant message.

## Agents

Each agent runs with:

- Own ContextManager (own conversation history, own file context, own stability tracker)
- Shared read-only access to symbol index, reference index, repo
- A focused sub-task from the main LLM's decomposition
- A turn-scoped archival sink appending to `.ac-dc4/agents/{turn_id}/agent-NN.jsonl`

Agents produce edit blocks applied via the existing apply pipeline.

### Per-File I/O Serialization

If two agents happen to write to the same file, the anchor-based edit protocol handles this naturally:

- Different text regions — both succeed
- Anchor fails (text not found or ambiguous) — edit is rejected with a diagnostic, recorded as a partial failure for the main LLM's review step

One requirement — the physical read → find-anchor → replace → write cycle for a single file must be atomic. A per-file mutex in the apply pipeline ensures two threads never simultaneously write the same file. Lock held for microseconds; no impact on agent parallelism since agents generate edits concurrently, only the final disk write is serialized.

### Context Manager Independence

Each agent's ContextManager operates correctly while other agents concurrently modify the repo and symbol index:

- Own conversation state — no shared mutable conversation state
- Symbol map refresh — indexes are re-indexed for changed files between execution rounds, not during. Within a single round, all agents read a consistent snapshot
- File content reads — agents read at call time; if another agent has written to a file the current agent is reading, it sees the updated content. Acceptable because agents target independent work units; reading a co-modified file means seeing completed work from another agent, not a half-written state (the per-file mutex guarantees atomic writes)
- No shared cache tiers — each agent's stability tracker is independent during parallel execution
- The main LLM's ContextManager is not an agent — it's the user-facing session ContextManager. It runs on the main event loop thread; agents run on worker threads. The main LLM observes agent completion, reviews diffs, and decides next steps via the same streaming path used for ordinary user turns

## Review Step — Handled by the Main LLM

After all spawned agents complete, the main LLM observes the combined forward diff (current state vs HEAD before the turn) and decides what to do next. This is NOT a separate LLM call with a dedicated prompt — it's the main LLM continuing its own conversation on the main event loop, with the agent output injected as observation into its context. The next chunks it streams are either a synthesis (turn complete) or a revised decomposition (iterate).

What the main LLM sees when agents complete:

- Forward diff of everything the agents changed
- Per-agent completion status and per-edit result flags (applied / failed / not-in-context)
- Changed files' current content (re-indexed since the agents ran)
- Symbol map and document index refreshed for changed files

What the main LLM decides:

- **Synthesize** — the work is complete; write the synthesis and end the turn
- **Iterate** — decompose again with revised scope; spawn fresh agents
- **Recover from mechanical failure** — some edits failed anchor-match (text moved because another agent edited nearby); reissue edits with updated anchors, possibly via a single follow-up agent rather than a full re-decomposition

The main LLM's review is informed by any test output the user chose to feed into the conversation. The system does not run tests automatically — the user drives test execution, and test results are an ordinary input to the main LLM's next prompt, just like any other user message in a normal session.

## System Prompt

A single system prompt governs the main LLM's behavior in agent mode — the same prompt that governs normal turns, extended with descriptions of the agent-spawning capability and the decomposition format. No separate planner or assessor prompt file exists.

The prompt instructs the main LLM to:

- Judge on a per-turn basis whether parallel decomposition is appropriate. Small or tightly-coupled tasks should be completed directly; large, independent-work-unit tasks benefit from agents
- When decomposing, use the symbol map and reference index to identify work units with no cross-references — those are safe to delegate in parallel
- Specify read context for each agent (files/symbols to see but not edit)
- After spawning agents, observe results via the injected forward diff and per-edit status
- Decide: synthesize, iterate, or recover from mechanical failure
- Produce a synthesis that is useful to the user — what changed, why, what requires manual follow-up

Config file convention — if the agent-spawning capability description needs to be a separate toggleable file (for users who want to strip it to save tokens in non-agent deployments), keep it as a suffix appended to the main system prompt, not as a standalone prompt file. The main LLM is one role; it has one voice.

## Transport: Single WebSocket

All agents share the existing single WebSocket connection. Each agent's stream chunks carry a request ID derived from the parent user-request turn ID; the browser already dispatches events by exact request ID. The main LLM's own stream uses the parent turn ID; agent streams use child IDs (e.g. `{turn_id}-agent-0`).

Bandwidth is not a constraint — N agents at a typical generation rate produce aggregate throughput well within WebSocket frame limits.

The existing per-animation-frame coalescing in the chat panel handles DOM update batching. The main LLM's output streams to the chat panel's primary message card; each agent's output streams to its column in the agent region (see [agent-browser.md](../5-webapp/agent-browser.md)), each with independent coalescing.

## No Git Branches or Worktrees

All agents operate on the current branch in the single working directory. No auto-commit — the user reviews all changes via the existing diff viewer and commits manually.

Git branches and worktrees are unnecessary because:

- Anchor-based edit protocol already prevents conflicting writes at the text level
- Edit failures are detectable (not silent corruption) and feed into the main LLM's review step
- User's existing manual review/commit workflow provides the final safety gate

## Semantic Conflict Detection

The hardest class of conflict is semantic — one agent changes a function's return type while another (independently, in parallel) writes code calling that function with the old return type. Both agents' edits succeed textually, but the combined result is broken.

Detection approaches, in order of reliability:

1. **Test execution** — user runs the project's test suite after the main LLM's synthesis; test failures feed back into the conversation on the next user turn, which may re-enter agent mode to fix
2. **Main LLM review of cross-boundary interfaces** — when reviewing agent output, the main LLM examines the forward diff specifically at call sites that cross agent boundaries (identified via the reference index in the symbol map)
3. **Type checking** — if the project has a type checker, the user runs it and feeds results back

The symbol map exposes which call sites cross the boundary between agents' work units, helping the main LLM focus its review on the highest-risk interfaces rather than the entire diff.

## Re-Indexing Between Rounds

Re-indexing happens through the existing mechanism — the symbol index and document index are refreshed for changed files as part of normal operation before each LLM call. No special parallel-agent re-indexing logic is needed. The main LLM's review step and any subsequent iteration automatically see an accurate, current symbol map because the standard pre-request refresh runs before each LLM call within the turn.

## When to Use Agent Mode

The main LLM decides per-turn whether to spawn agents. Typical cases:

- Large refactors touching many independent modules
- Multi-file feature implementations spanning disconnected components
- Bulk documentation updates across independent sections
- Codebase migrations (e.g., API version upgrades across many callers)

For typical single-file or tightly-coupled tasks, the main LLM completes the work itself without the overhead of decomposition. Users don't opt in or out — the decision is the main LLM's, based on the request shape and the codebase structure it sees via the symbol map.

## Invariants (Design Targets)

- Anchor-based edits prevent silent corruption when multiple agents touch the same file
- Per-file write mutex serializes the physical read-modify-write cycle without serializing agent work
- Edit failures are always detectable and never silent
- Each agent's ContextManager is fully independent — no shared mutable conversation state
- Re-indexing between agent rounds uses the same mtime-based cache as single-agent mode — no special logic
- User drives test execution — the system does not run tests automatically
- Git state is unchanged by parallel execution — no branches, worktrees, or auto-commits
- Final review and commit always happen via the existing manual workflow
- Every turn produces exactly one assistant message in the main history store, regardless of how many agents ran and how many iteration rounds occurred. The main LLM's decomposition narration, review commentary, and synthesis all land in the same assistant message's `content` field
- Agent archive files are append-only within a turn; re-iteration within the turn appends rather than overwrites
- Archive existence is optional for main-store correctness — an archive can be deleted at any time without invalidating chat playback or session restore
- There is no separate planner or assessor ContextManager. The main LLM IS the planner and the assessor, and its conversation lives in the main history store, not in the archive