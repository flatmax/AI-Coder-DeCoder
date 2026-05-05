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
| `agentsSpawned` event fires BEFORE agent dispatch | [streaming.md](../3-llm/streaming.md) | Frontend creates tabs in time to claim child request IDs; without it, fast-completing agents' chunks are dropped |
| Streaming state is keyed by request ID on the frontend | [chat.md](../5-webapp/chat.md#streaming-state-keyed-by-request-id) | Chat panel can render N concurrent streams |
| Agent conversations are archived per turn | [history.md](../3-llm/history.md#agent-turn-archive) | Per-agent files under `.ac-dc4/agents/{turn_id}/`; main LLM stays in main history |
| Agent ContextManager factory exists | [context-model.md](../3-llm/context-model.md#agent-context-managers) | Constructs a ContextManager whose archival sink writes to the per-turn archive. Lifetime is session-scoped (cleared by `new_session`), NOT turn-scoped, so the agent registry persists across turns for id-based reuse |
| Re-indexing happens between rounds | [symbol-index.md](../2-indexing/symbol-index.md), [document-index.md](../2-indexing/document-index.md) | Indexes are read-only snapshots within a request's execution window |
| Assimilation refreshes full file content | [context-model.md](../3-llm/context-model.md) | Post-agent `file_context.add_file` re-reads from disk so the parent's next turn sees full post-edit content, not diffs |
| Edit parser tolerates unknown markers as prose | [edit-protocol.md](../3-llm/edit-protocol.md#agent-spawn-blocks-reserved-marker) | `🟧🟧🟧 AGENT` / `🟩🟩🟩 AGEND` lines are ignored by the current parser; future agent-spawn handling adds branches without breaking existing edit parsing |

None of these invariants cost anything in single-agent operation. Preserving them in the initial build means agent mode can be added later without refactoring the foundation layers.

The agent implementation itself reduces to: refactor `_stream_chat` so its ContextManager is a parameter rather than hardcoded to `self._context`, then invoke it N times in parallel with N agent ContextManagers. Each agent runs through the existing streaming pipeline — same edit parsing, same apply path, same persistence, same post-response work. No separate runner, no separate orchestrator, no separate applier.

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

## User-Visible Agent Browsing and Interaction

Agents surface as additional tabs in the existing chat panel — one "Main" tab plus one tab per spawned agent in the active turn (see [agent-browser.md](../5-webapp/agent-browser.md) for the UI spec). The tab strip IS the agent browser. Each agent tab is a full chat panel targeting that agent's `ContextManager`; interaction is identical to the main chat (type in the input box, hit send).

This means agents that need clarification, a file, or a decision just say so as normal assistant messages — no dedicated question protocol, no pause-resume state machine. The user answers by replying in that agent's tab, or by ticking a file in the (per-tab-scoped) picker, or by leaving the agent alone until they come back to it. Agents persist for the lifetime of the turn — their ContextManager and StabilityTracker stay warm in memory, so provider cache benefits accrue across interactions.

Agents from a previous agentic turn are reachable via the history browser: scrolling the main chat back to that turn surfaces a "View agents" affordance which loads read-only tabs from the archive. Archives stay on disk across server restarts; read-only tabs are fully browsable but their input boxes are disabled because the ContextManager is long gone.

### Frontend agent-block rendering

Agent-spawn blocks emitted in the orchestrator's assistant message render as cards in the main chat, symmetric to the existing edit-block cards. The mechanism mirrors edit-block rendering:

- The chat panel's response segmenter (`webapp/src/edit-blocks.js`) learns an `agent` segment type alongside the existing prose and edit segments. AGENT/AGEND markers in the response are detected and the body is parsed into `{id, task}`.
- A new module `webapp/src/agent-block-render.js`, symmetric to `edit-block-render.js`, takes an agent segment plus optional execution status (`pending` / `streaming` / `complete` / `error`) and returns the card HTML.
- The card displays:
  - The agent's `id` as a clickable chip, styled like edit-block file-path chips
  - The `task` body, rendered as markdown (collapsible if long)
  - A status badge reflecting the agent's child stream — pulled from the chat panel's per-request streaming state (keyed by `{parent_request_id}-agent-{idx}`)
- Clicking the id chip dispatches a custom event that the chat panel handles by switching to that agent's tab — the same code path `_onTabClick` already uses. The agent's tab is guaranteed to exist by the `agentsSpawned` event ordering invariant.

Status integration is the same per-request-id story streaming already uses. The card subscribes to its agent's stream state during the turn and updates as chunks arrive at the child request id; once the child completes, the card freezes at the final status. Across turns the card is static — clicking the id still routes to the agent's tab, where the user can read the full conversation.

This gives the orchestrator's narration a structured shape: when the user reads the orchestrator's response, they see the prose explanation, the agent cards (one per spawn block), and any edit cards from work the orchestrator did itself, all interleaved in source order. Clicking through agent cards navigates to the matching tab; clicking through edit cards opens the diff viewer. Both work the same way.

### Backend RPCs

The backend exposes one RPC to support historical browsing:

- `get_turn_archive(turn_id)` — returns the per-agent conversations for a single turn. Reads from `.ac-dc4/agents/{turn_id}/`. Returns an empty result when the directory does not exist (turn did not spawn agents, or archive was deleted).

No separate `list_turns` RPC is required. Turn metadata is already part of the main history store (every record carries `turn_id`), and the chat panel's existing history-load path returns the records in order. `get_turn_archive` is called lazily as the user scrolls the chat and surfaces historical agent tabs.

Archived conversations are NOT used during session restore. Session restore reads only `history.jsonl` and produces the same in-memory context as before — the user continues where they left off, seeing only their own conversation. Historical agent tabs are populated on demand via `get_turn_archive` when the user navigates to a previous turn, not eagerly at startup.

## Core Principle: Anchor-Based Non-Overlapping Edits

The edit protocol uses exact text anchors (old text → new text), not line numbers. Two agents can safely edit the same file provided their anchors target non-overlapping text regions. The main LLM's job when decomposing is to assign independent work units — classes, functions, documentation sections — not disjoint file sets.

For example, in a single file containing two unrelated classes, one agent can edit one class's methods while another edits the other. Their anchors will not overlap because they target different text regions.

If an agent's edit fails validation (anchor not found, or anchor became ambiguous because another agent modified nearby text), this is a detectable failure — not a corruption. It feeds into the review step.

## Execution Model

- User request arrives; the main LLM (the same ContextManager handling all user turns) begins streaming its response
- Main LLM decides whether the task benefits from parallel decomposition. This is a per-turn judgment based on the request, the symbol map, and any document index; gated by the `agents.enabled` config toggle — when the toggle is off the agentic appendix is absent from the system prompt and the LLM never emits spawn blocks
- If yes — main LLM emits a decomposition describing N sub-tasks, each specifying work units (classes, functions, doc sections) to create or modify, plus read context
- **Backend fires `agentsSpawned` immediately after the main LLM's response is parsed and BEFORE spawning agents.** Payload: `{turn_id, parent_request_id, agent_blocks: [{id, task, agent_idx}, ...]}`. The frontend's handler creates one tab per agent with its child request ID (`{parent_request_id}-agent-{NN:02d}`) pre-populated so `_findTabForRequest` can route subsequent chunks to the correct tab. Without this event fired BEFORE spawn, agents whose streams complete quickly (a common case for small tasks) would finish before the main `streamComplete` event arrives carrying `agent_blocks` — and every child chunk routed during that window would be silently dropped because no tab claimed the child request ID yet. Landing `agentsSpawned` first narrows the race to zero: tabs exist before any child chunk reaches the frontend
- Main LLM spawns N agent ContextManagers, each with its own turn-scoped archival sink, a focused sub-task, and shared read-only access to indexes and repo
- Agents execute in parallel; no inter-agent communication
- Edits applied to the working directory via the existing edit-block apply pipeline (per-path mutex ensures atomic writes)
- When all agents complete, the backend assimilates their work into the parent conversation: the union of agent-modified and agent-created files is loaded (or refreshed) into the parent's file context, added to the parent's selection, and broadcast via `filesChanged` and `filesModified` so the frontend picker reloads. No automatic second LLM call fires
- The main LLM's assistant message for the turn consists only of its initial response (which contains the spawn blocks as prose narrating what it delegated). The user reads that, inspects the working-tree changes via the picker and diff viewer, and drives review in a follow-up turn — "review what the agents did" is a one-click snippet in the chat panel's code-mode snippets (see [chat.md § Snippet Drawer](../5-webapp/chat.md#snippet-drawer))
- On the next user turn, the parent LLM sees the newly-assimilated files (as full post-edit content) in its context and can synthesise, iterate, or fix as the user directs. Full files rather than diffs means the parent reviews the way a human would — reading the code in its current state — rather than reasoning over a diff that loses context. A parent that wants to see what specifically changed can invoke `git diff` via shell-command detection, but the default review input is the current on-disk state. Iteration rounds (main LLM spawns a fresh decomposition after seeing the results) happen through the normal multi-turn flow, not as backend-driven recursion

## Main LLM — Decomposition

The main LLM's system prompt (the normal user-facing prompt, extended for agent-mode turns) describes agent-spawning as a tool-like capability. When the main LLM judges a task worth parallelizing, it emits one or more agent-spawn blocks, each declaring a sub-task.

### Agent-spawn block format

An agent block uses a distinct marker pair with no middle separator:

- Start: `🟧🟧🟧 AGENT` — three orange squares (U+1F7E7), space, literal `AGENT`
- End: `🟩🟩🟩 AGEND` — three green squares (U+1F7E9), space, literal `AGEND`

Rendered as an indented diagram to avoid nesting the literal markers inside a fenced code block:

    ORANGE-START    🟧🟧🟧 AGENT
    line 1          id: agent-0
    line 2          task: Refactor the auth module to extract session logic into
    line 3          a new SessionManager class. Update callers of auth.Session to
    line 4          use the new class.
    GREEN-END       🟩🟩🟩 AGEND

**Why the end marker differs from the edit-block end marker.** An edit block closes with `🟩🟩🟩 END`. If an agent block used the same end marker, a parser scanning line-by-line would have to track which start marker opened the current block to decide what the end marker closes — brittle under malformed input and forces frontend and backend parsers to stay in lockstep on state tracking. A distinct agent end marker lets each parser match on the literal line: `🟩🟩🟩 END` closes edits, `🟩🟩🟩 AGEND` closes agents, no state disambiguation needed. An LLM response that interleaves both block types, or a document quoting both in the same code fence, cannot cause one marker to accidentally terminate the other's block.

**Fields.** Body is a minimal YAML-ish payload of `key: value` pairs. Only two fields are defined:

- **`id`** — identifier the main LLM uses to reference this agent in subsequent review and synthesis. Scoped to the turn; unique within the turn's decomposition. Convention is `agent-N` (zero-indexed), but the parser accepts any string.
- **`task`** — the initial prompt handed to the agent. One logical instruction in natural language; may span multiple lines until the end marker. The task should describe the goal, not enumerate file paths — the agent discovers files the same way the user's chat session does (symbol map, reference index, file mentions via edit blocks).

Unknown keys are preserved in an `extras` dict for forward compatibility. When the spec gains a new field (e.g., sequencing dependencies, MCP server keys), old parser versions still surface the value rather than dropping it.

### Why not pre-declare files

The decomposition deliberately does NOT enumerate which files each agent should read or edit. Pre-declaring file sets is error-prone (the planner has to predict the agent's navigation before the agent has started), brittle to refactors (an agent discovering it needs one more file would violate the declaration), and wasteful of the planner's reasoning budget (the whole point of agents is to parallelize reasoning).

Agents inherit the same repo view the main LLM has:

- Symbol map with imports, call sites, and `←N` reference counts
- Document index (in doc mode or cross-reference mode)
- Reference graph for identifying independent work units
- File tree and edit protocol for navigation and modification

An agent that edits `src/auth.py` auto-adds it to its selection via the existing `files_auto_added` mechanism — same behaviour as a user's chat session today. The main LLM's job is decomposition, not file-level specification.

### Assigning independent work units

Using the symbol map's reference graph, the main LLM identifies clusters of symbols with no cross-references between them, making them safe to edit in parallel. The decomposition describes these clusters in the `task` string at whatever granularity is useful — "refactor the auth module", "update the logging format", "extract the paging helper". The agent reads the task, consults the symbol map, and navigates to the relevant files on its own.

When all spawned agents have completed, the main LLM reviews the combined forward diff and decides:

- **Synthesize** — the work is complete and internally consistent. The main LLM writes the synthesis (what changed, why, what's left for the user to review), and the assistant message for the turn is complete.
- **Iterate** — some work is incomplete or produced a semantic conflict. The main LLM emits a revised decomposition, spawns fresh agent ContextManagers, and waits for the new round.
- **Abandon parallelism mid-turn** — rarely, the main LLM may decide the sub-tasks are smaller than anticipated and finish the work itself without another round of agents. This is just "stop spawning agents and continue streaming to the user."

There is no separate "review" LLM. The main LLM reviews its own plan's outcome using the same conversation it has been streaming throughout the turn. Users reading the chat see the decomposition, the review commentary ("Agent 2 produced the refactor we wanted; Agent 3 missed the callers — spawning a follow-up"), and the synthesis as one continuous assistant message.

## Agents

Each agent runs with:

- Own ContextManager (own conversation history, own file context, own stability tracker)
- Shared read-only access to symbol index, reference index, repo
- The `task` string from the main LLM's spawn block as its initial user message
- A turn-scoped archival sink appending to `.ac-dc4/agents/{turn_id}/agent-NN.jsonl`

Agents start with an empty file context — same as a fresh user session. They navigate the repo via the symbol map, add files to their selection by emitting edit blocks (which trigger the existing `files_auto_added` path on not-in-context edits or `files_created` on creates), and produce modifications via the normal edit protocol. The apply pipeline treats an agent's edit blocks identically to a user's — per-path mutex, anchor matching, dry-run option, and result reporting all work unchanged.

No file-set restriction is enforced on agents. If agent-0's task is to refactor the auth module and it decides it needs to read `src/logging.py` too, it does — nothing in the protocol prevents this. The main LLM's review step (next section) is the semantic-conflict safety net, not a file-level pre-declaration.

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

## Review Step — User-Driven

There is no automatic synthesis LLM call after agents complete. The backend's post-agent work is purely mechanical: assimilate the union of agent-modified and agent-created files into the parent conversation's file context and selection, emit `filesChanged` and `filesModified` broadcasts so the picker reloads, and let the turn end with the main LLM's initial response as the turn's final assistant message.

The user drives review on the next turn. They see:

- The main LLM's initial response in the chat, including the spawn blocks as prose (they render as ordinary markdown — a future frontend pass per [agent-browser.md](../5-webapp/agent-browser.md) will render them as tabs)
- The files the agents touched, now visible in the picker with modified-file badges
- The diffs, visible in the diff viewer
- The newly-selected files in the parent's context on their next LLM call

On the next turn the user can:

- Ask the main LLM to review the agents' work ("review what the agents did" is a one-click snippet). Because the agent-modified files are now in the parent's context as full post-edit content, the main LLM sees each file the way a human reviewer would — reading the code in its current state rather than reasoning over a diff — and can judge completeness, flag inconsistencies, and suggest fixes.
- Ask for iteration ("the auth changes are good but the session handling needs another pass"). The main LLM may emit a fresh agent-spawn decomposition if the task still warrants parallelism, or finish the work itself.
- Ask for specific fixes ("agent 1's edit to `src/logging.py` introduced a bug; fix it"). The main LLM has the full post-change file content and can produce a normal edit block.
- Ignore the agents' output and continue with something else.

The system does not run tests automatically — the user drives test execution, and test results are an ordinary input to the main LLM's next prompt, just like any other user message in a normal session.

### Why not automatic synthesis

Earlier designs had the backend automatically fire a second LLM call after agents completed, feeding the transcripts into a synthesis prompt. Dropped because:

- The main LLM already SAW what it was going to delegate (it wrote the spawn blocks). Having it re-read transcripts to summarise its own plan's execution is redundant token spend.
- The interesting judgment — "is this complete, are the pieces consistent, what's left to do" — benefits from user context. The user knows which parts of the task they care about most, which tests they ran, which tradeoffs they'd accept. A synthesis LLM call without that context produces a plausible-sounding summary that might miss the point.
- Stopping after the initial response leaves a natural checkpoint. The user sees the file changes before any further LLM work, which means they can catch agents that went off the rails before spending more tokens on a synthesis of bad work.
- Frontend UX is simpler: one assistant message per turn, agent activity surfaced through file-picker state and (eventually) the agent tab strip, user follow-ups driven by the existing chat loop.

Future work may revisit this — e.g., an auto-synthesis setting for users who prefer it, or a heuristic-driven auto-review when all agents succeed cleanly with small diffs. For now, user-driven review is simpler and more correct.

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

The existing per-animation-frame coalescing in the chat panel handles DOM update batching. The main LLM's output streams to the Main tab's message list; each agent's output streams to its own tab in the chat panel's tab strip (see [agent-browser.md](../5-webapp/agent-browser.md)), each tab with independent coalescing.

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

For typical single-file or tightly-coupled tasks, the main LLM completes the work itself without the overhead of decomposition. When agent mode is enabled, the decision to decompose is the main LLM's, based on the request shape and the codebase structure it sees via the symbol map.

## Agent Reuse by ID

Agents are addressed by `id` in the spawn block. The backend's dispatch is a single rule:

- Look up the `id` in the live agent registry (`_agent_contexts`)
- **Hit** — route the new task into the existing agent. Its `ContextManager`, conversation, file context, and `StabilityTracker` are preserved; provider cache stays warm; the new task arrives as the next user message in that agent's existing conversation
- **Miss** — spawn a fresh agent with the given `id`

There is no separate `CONTINUE` block type. One block, fall-through semantics. The orchestrator picks reuse vs. fresh-spawn by picking the `id` — using a known id continues an existing agent, using a new id spawns one. The parser stays simple, the protocol stays small, and the LLM only has to remember "I name agents by id."

IDs are arbitrary non-empty strings chosen by the orchestrator. The system prompt's agentic appendix should encourage stable, descriptive ids ("frontend-chat", "streaming-pipeline") so the orchestrator can re-address the same agent by name across turns. The backend does not validate id shape beyond non-emptiness.

### Agent lifetime

Agents linger for the life of the session. Once spawned, an agent's `ContextManager`, `StabilityTracker`, and conversation persist across turns and remain available for re-dispatch by id. There is no idle timer, no explicit close block, and no garbage collection — agents stay on the sideline as part of the team until the session ends. This keeps the model simple: the user manages agent population implicitly by directing the orchestrator (asking it to spawn new agents, retask existing ones, or leave them alone).

`new_session` clears the agent registry, including each agent's chat history. This mirrors the behaviour of the main conversation: a fresh session wipes everything user-facing, including the agent-tab conversations browsable in the chat panel. Without this, agent chat history would persist across sessions while the main history was cleared, breaking the chat panel's tab-based browsing model.

### Per-agent state descriptor

For the main LLM to orchestrate agent reuse — decide which existing agent to retask vs. spawn a fresh one — it needs a minimal summary of each live agent at the top of every main-conversation turn. The summary lives in the main LLM's prompt (injected as a block in the active user message, not the system prompt — per-turn injection means the descriptor reflects current state without burning cacheable system-prompt tokens when state changes).

Each descriptor entry carries exactly two fields:

- **Identity** — `{turn_id}/agent-NN`, the address used in `🟧🟧🟧 CONTINUE` blocks
- **Files in context** — paths only, no content. The list of files the agent currently has loaded

That's it. The orchestrator picks an agent for a new task by matching the task's affected files against each agent's loaded paths — an agent already living in `webapp/src/` is a natural home for a frontend change; an agent with `src/ac_dc/llm/` open suits a streaming change. Path lists are factual and update automatically as agents work; they impose no commitment about what the agent is *for*, so retasking an agent into a completely different area is fine — its descriptor just shifts to the new paths on its next turn.

### Single-copy invariant — assembly-time injection

The descriptor must appear in the prompt sent to the LLM *exactly once per turn*, reflecting the current agent population. It must NOT be persisted to the main history store, because every persisted copy would shadow the previous one in the active context window — wasting tokens and giving the LLM N stale snapshots to disambiguate.

The mechanism is the same one the system reminder uses (see [prompt-assembly.md — System Reminder Injection](../3-llm/prompt-assembly.md#system-reminder-injection)): the descriptor is built at assembly time from the live agent registry and prepended to the outgoing user message *in transit*. The message recorded in `history.jsonl` is the user's plain text; the descriptor never lands on disk and never enters compaction's view.

Concrete contract:

- The orchestrator's `ContextManager` (or `LLMService` at assembly) reads the current `_agent_contexts` registry on every turn
- A descriptor block is constructed fresh from the live registry — closed agents drop out, new agents appear, file lists reflect each agent's current selection
- The block is injected into the user message during `assemble_tiered_messages`, alongside the system reminder
- The persisted user message (via `add_message` and the archival sink) is the user's raw text only

Consequences:

- The LLM sees exactly one descriptor per call: the one current at that turn's assembly time
- History playback (session restore, search, history-browser) shows clean user messages without descriptor noise
- An agent that closes between turn N and turn N+1 simply disappears from turn N+1's descriptor with no special invalidation step
- Compaction operates on the persisted history, which has no descriptors, so summarisation logic doesn't need to know about agent state
- The descriptor is cheap to rebuild (path lists from the registry); rebuilding per turn is preferable to caching it, because caching invites staleness bugs after agent state changes

### What's deliberately omitted

Earlier drafts included more fields that turned out to be redundant, unhelpful, or actively harmful to retasking:

- **Original task text** — task is turn-scoped; agent identity is not. Including the original brief implies the agent has a stable role, which discourages retasking. If the orchestrator wants to know what an agent did last, the per-turn archive is one RPC away.
- **Focus label / role description** — same problem amplified. A label like "frontend specialist" makes the orchestrator reluctant to send the agent to a backend task even when the agent's loaded files no longer match the label. Paths are the truth; labels lie as soon as the agent is retasked.
- **Last-turn summary** — useful for review, not for routing. The orchestrator routing on "which agent already has these files open" doesn't care what the agent finished last.
- **Cache warmth / last-active timestamp** — tracking liveness across turns adds maintenance cost (clock handling, restart semantics, what counts as "active") for a signal that doesn't change routing decisions. An agent either exists with files loaded or it doesn't; staleness is implicit in the path list (an agent with paths that have since been heavily edited will need to re-read them, but that's the apply pipeline's problem, not the descriptor's).
- **Turn count, status, finish reason, token usage** — turn-scoped review data, not routing data. Surface on demand if the orchestrator asks; not in the standing descriptor.
- **Fetched URLs** — treated as user-owned state. When URL lifecycle is in question, the main LLM raises it with the user rather than deciding silently.
- **Stability tier summary** — cache warmth isn't actionable without a mental model of the tier system, which the main LLM doesn't have.
- **Full conversation history** — expensive and unnecessary; archived already.
- **Per-agent session totals** — exposed via the token HUD rather than as LLM routing input.
- **Raw file content** — the main LLM's own context already has the relevant content via assimilation; the agent descriptor is metadata, not a content channel.

### Reference mechanism

The main LLM's agentic appendix learns a new block type alongside `🟧🟧🟧 AGENT`:

- `🟧🟧🟧 CONTINUE` — address an existing agent by ID and supply a continuation task
- `🟧🟧🟧 AGENT` — spawn a fresh one (existing semantics)

The spawn-block parser dispatches on the keyword, routing `CONTINUE` to the registered agent's `ContextManager` and `AGENT` to a fresh scope. Per the marker-bytes discipline in `specs4/3-llm/edit-protocol.md`, `CONTINUE` gets its own distinct end marker to avoid the parser-state-tracking brittleness described for AGEND — tentatively `🟩🟩🟩 CONEND`.

### User-confirmation for state changes

When the main LLM wants to clear an agent's state (drop URLs, close the agent, wipe file selection), it asks the user *first* rather than mutating directly. The user answers yes or no in the main chat; the backend acts on the confirmed answer. Keeps destructive state changes under the user's control — the main LLM can only read the descriptor, never mutate agent state unilaterally.

### Registry shape

`LLMService._agent_contexts[turn_id][agent_idx]` gains an `AgentDescriptor` field populated by the agent's streaming pipeline as it runs. The last-turn summary is produced by a small LLM call after each agent turn completes, paid for once and re-used across subsequent main-conversation turns until the agent's next reply invalidates it.

### Revisit trigger

This design should be revisited once enough real multi-agent turns have run to reveal natural patterns — whether the main LLM spontaneously reuses agents when told it can, or whether the descriptor block adds noise the main LLM mostly ignores. Premature implementation would lock in guesses; the current fresh-per-turn model costs nothing and preserves every implementation option.

## User Control — Agent Mode Toggle

Agent mode is an opt-in capability gated by a user setting. Users who prefer predictable single-LLM turns, users on constrained token budgets, or users working in repos too small to benefit from decomposition can disable agent mode entirely — the main LLM then handles every turn as a single call, regardless of request shape.

### Configuration

- Stored in `app.json` under `agents.enabled` (boolean). Default: `false`.
- Exposed through the Settings tab as a toggle card. The card's description names the trade-off clearly — "Allow the assistant to decompose complex requests into parallel agent conversations. Uses more tokens per turn but finishes large refactors faster."
- Settings-service whitelist covers the app-config field. Hot-reload picks up toggle changes without a server restart; the next user turn sees the new state.
- The agent-spawn capability is described in a separate bundled file, `system_agentic_appendix.md`. When `agents.enabled` is `true`, the config layer concatenates the appendix onto `system.md` during prompt assembly. When `false`, the appendix is never read and the LLM is never told about the capability — it cannot emit agent-spawn blocks regardless of task shape.
- The appendix is a managed file (treated like `system.md`, `review.md`, etc.) — bundled defaults ship with the app, users can edit their copy to customise the agent instructions, and the upgrade pass backs up customisations on version change.
- Assembly order: `system.md` → `system_agentic_appendix.md` (if enabled) → `system_extra.md`. User project-specific customisation in `system_extra.md` lands last so it can extend or override anything above.

### Frontend surface

- Settings tab includes an "Agentic coding" card alongside the other configuration cards.
- Card renders as a toggle with a short description and a "learn more" link pointing at this spec file.
- State change broadcasts `modeChanged` — the Settings service's reload path fires it so connected collaborators see the update.
- Non-localhost participants in collaboration mode see the card in read-only form: the toggle reflects the host's state but cannot be changed. Matches the existing settings-service restriction pattern.

### Runtime behaviour

- `LLMService` reads `config.agents_enabled` on each turn's prompt assembly. When false, the system prompt's agent-spawn description is omitted.
- The parser's AGENT/AGEND tolerance (per Foundation Requirements) stays active regardless — a disabled-agent-mode setup that somehow receives an agent block in its input (stale session, malformed config) still parses cleanly and ignores the block.
- Disabling agent mode mid-turn is not possible — the setting is read at prompt-assembly time and the turn proceeds to completion regardless of subsequent toggle flips. A user wanting to abort mid-turn uses the normal cancel mechanism.

## Invariants (Design Targets)

- Anchor-based edits prevent silent corruption when multiple agents touch the same file
- Per-file write mutex serializes the physical read-modify-write cycle without serializing agent work
- Edit failures are always detectable and never silent
- Each agent's ContextManager is fully independent — no shared mutable conversation state
- Re-indexing between agent rounds uses the same mtime-based cache as single-agent mode — no special logic
- User drives test execution — the system does not run tests automatically
- Git state is unchanged by parallel execution — no branches, worktrees, or auto-commits
- Final review and commit always happen via the existing manual workflow
- Every turn produces exactly one assistant message in the main history store, regardless of how many agents ran. The main LLM's decomposition narration (including the agent-spawn blocks as prose) IS that message; there is no automatic synthesis LLM call that would produce a second message. Review and iteration happen on subsequent user turns, each producing their own single assistant message per the normal chat flow
- Agent archive files are append-only within a turn; re-iteration within the turn appends rather than overwrites
- Archive existence is optional for main-store correctness — an archive can be deleted at any time without invalidating chat playback or session restore
- There is no separate planner or assessor ContextManager. The main LLM IS the planner; the user is the assessor (driving review on follow-up turns). Both the main LLM's conversation and any review/iteration turns live in the main history store, not in the archive