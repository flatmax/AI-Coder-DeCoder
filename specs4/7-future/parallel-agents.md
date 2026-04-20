# Parallel Agents

**Status: Not for implementation.** Speculative design for a future parallel LLM execution architecture. Described here for design continuity; do not implement as part of the initial clean-room build.

AC⚡DC could execute multiple LLM agents in parallel to accelerate large tasks. A planner decomposes a user request into independent sub-tasks, each agent executes its sub-task, and an assessor reviews the combined result. The cycle repeats until the task is complete or the user intervenes.

## Core Principle: Anchor-Based Non-Overlapping Edits

The edit protocol uses exact text anchors (old text → new text), not line numbers. Two agents can safely edit the same file provided their anchors target non-overlapping text regions. The planner's job is to assign independent work units — classes, functions, documentation sections — not disjoint file sets.

For example, in a single file containing two unrelated classes, one agent can edit one class's methods while another edits the other. Their anchors will not overlap because they target different text regions.

If an agent's edit fails validation (anchor not found, or anchor became ambiguous because another agent modified nearby text), this is a detectable failure — not a corruption. It feeds into the assessment step.

## Execution Model

- User request received
- Planner LLM call (uses a dedicated planner system prompt) decomposes into N sub-tasks, each specifying work units (classes, functions, doc sections) to create or modify
- Each agent runs as a thread with its own context manager, shared read-only access to indexes and repo, and a focused sub-task
- Agents execute independently; no inter-agent communication during execution
- Edits applied to the working directory via the existing edit-block apply pipeline
- After all agents complete, assessment step
- Assessor LLM call (uses a dedicated assessor system prompt) reviews the combined result via forward diff
- Outcome — complete (present to user for review/commit) or needs replan (iterate)

## Planner

Uses a dedicated system prompt. Receives:

- User's request
- Symbol map (compact structural view of the codebase)
- Document index (in document mode)
- Selected file context

The LLM reads the symbol map and reference information to determine which work units are independent. No local graph algorithm required — the symbol map already exposes imports, call sites, and cross-references in a compact format that the LLM can reason about directly.

Planner output — a structured task list. Each task specifies:

- Natural language description of the sub-task
- Work units (classes, functions, doc sections) the agent should create or modify
- Read context — files/symbols the agent needs to see but not edit

Planner does not need to assign disjoint file sets. It assigns independent work units. The LLM identifies clusters of symbols with no cross-references, making them safe to edit in parallel.

## Agents

Each agent runs with:

- Own context manager (own conversation history, own file context)
- Shared read-only access to symbol index, reference index, repo
- Focused sub-task from the planner

Agents produce edit blocks applied via the existing apply pipeline.

### Per-File I/O Serialization

If two agents happen to write to the same file, the anchor-based edit protocol handles this naturally:

- Different text regions — both succeed
- Anchor fails (text not found or ambiguous) — edit is rejected with a diagnostic, recorded as a partial failure for the assessment step

One requirement — the physical read → find-anchor → replace → write cycle for a single file must be atomic. A per-file mutex in the apply pipeline ensures two threads never simultaneously write the same file. Lock held for microseconds; no impact on agent parallelism since agents generate edits concurrently, only the final disk write is serialized.

### Context Manager Independence

Each agent's context manager operates correctly while other agents concurrently modify the repo and symbol index:

- Own conversation state — no shared mutable conversation state
- Symbol map refresh — indexes are re-indexed for changed files between execution rounds, not during. Within a single round, all agents read a consistent snapshot
- File content reads — agents read at call time; if another agent has written to a file the current agent is reading, it sees the updated content. Acceptable because agents target independent work units; reading a co-modified file means seeing completed work from another agent, not a half-written state (the per-file mutex guarantees atomic writes)
- No shared cache tiers — each agent's stability tracker is independent during parallel execution

## Assessor

Uses a dedicated system prompt. Uses a **forward diff** (current state vs HEAD) — showing what was added and changed.

Why forward diff — the assessor's task is plan verification ("was the requested work produced?"), not change evaluation ("should this be reverted?"). A forward diff directly shows what each agent contributed, making it straightforward to check completeness against the plan.

After all agents complete, the assessor receives:

- Original user request and planner decomposition
- Forward diff showing all changes made by all agents
- Changed files in context (already in context by default)
- Symbol map and document indexes (if in document mode)

Assessor determines:

- **Complete** — all sub-tasks achieved; present to user for manual review and commit
- **Needs replan** — some tasks incomplete or semantically inconsistent; feed back to the planner for another iteration

## Iteration Loop

Two levels — fast inner loop for mechanical failures and outer loop for semantic issues.

### Inner Loop (Re-Execute)

- After all agents complete, if any edits failed due to anchor clashes or ambiguity, re-execute only the failed tasks
- Re-executed agents see the current file state (with successful edits from other agents already applied)
- Handles mechanical edit conflicts without LLM re-planning overhead

### Outer Loop (Replan)

- Assessor reviews the forward diff and determines whether the combined result is semantically correct
- If not, user may optionally run tests and gather results
- Assessment and any test output feed back to the planner for a new decomposition
- Each outer iteration starts from ground truth — the actual state of files on disk

User drives test execution — the system does not automatically run tests. Keeps the user in control and avoids assumptions about test infrastructure.

## Planner System Prompt

Dedicated config file alongside the existing system prompts. Instructs the LLM to:

- Read the symbol map to identify independent work units
- Decompose the user request into N sub-tasks with explicit work unit assignments
- Specify read context for each agent (files to see but not edit)
- Output a structured format (parseable task list)

Follows the same config directory conventions — user-editable, version-aware upgrade.

## Assessor System Prompt

Dedicated config file. Instructs the LLM to:

- Read the forward diff to see what each agent produced
- Compare changes against the original plan
- Identify semantic conflicts, missing implementations, or broken interfaces
- Output a structured verdict — complete or needs-replan with specific issues

Mirrors the existing review prompt pattern — the assessor is essentially a review-mode LLM call with a different focus (plan completion rather than code quality).

## Transport: Single WebSocket

All agents share the existing single WebSocket connection. Each agent's stream chunks carry a request ID for demultiplexing. The browser already dispatches events by request ID.

Bandwidth is not a constraint — N agents at a typical generation rate produce aggregate throughput well within WebSocket frame limits.

The existing per-animation-frame coalescing in the chat panel handles DOM update batching. For multiple concurrent streams, the frontend would render N output areas (or a consolidated view with agent labels), each with independent coalescing.

## No Git Branches or Worktrees

All agents operate on the current branch in the single working directory. No auto-commit — the user reviews all changes via the existing diff viewer and commits manually.

Git branches and worktrees are unnecessary because:

- Anchor-based edit protocol already prevents conflicting writes at the text level
- Edit failures are detectable (not silent corruption) and feed into the assessment loop
- User's existing manual review/commit workflow provides the final safety gate

## Semantic Conflict Detection

The hardest class of conflict is semantic — one agent changes a function's return type while another (independently, in parallel) writes code calling that function with the old return type. Both agents' edits succeed textually, but the combined result is broken.

Detection approaches, in order of reliability:

1. **Test execution** — user runs the project's test suite after the assessment step; test failures feed back into the planner
2. **LLM review of cross-boundary interfaces** — assessor examines the forward diff specifically at call sites that cross agent boundaries (identified via the reference index in the symbol map)
3. **Type checking** — if the project has a type checker, the user runs it after edits and feeds results back

The symbol map exposes which call sites cross the boundary between agents' work units, allowing the assessor to focus its review on the highest-risk interfaces rather than reviewing the entire diff.

## Re-Indexing Between Iterations

Re-indexing happens through the existing mechanism — the symbol index and document index are refreshed for changed files as part of normal operation before each LLM call. No special parallel-agent re-indexing logic needed. The assessor and any subsequent planner iteration automatically see an accurate, current symbol map because the standard pre-request refresh runs before their LLM calls.

## When to Use Agent Mode

Explicit opt-in for tasks that benefit from parallelism:

- Large refactors touching many independent modules
- Multi-file feature implementations spanning disconnected components
- Bulk documentation updates across independent sections
- Codebase migrations (e.g., API version upgrades across many callers)

For typical single-file or tightly-coupled tasks, the existing single-agent mode is faster (no planning overhead) and simpler.

## Invariants (Design Targets)

- Anchor-based edits prevent silent corruption when multiple agents touch the same file
- Per-file write mutex serializes the physical read-modify-write cycle without serializing agent work
- Edit failures are always detectable and never silent
- Each agent's context manager is fully independent — no shared mutable conversation state
- Re-indexing between iterations uses the same mtime-based cache as single-agent mode — no special logic
- User drives test execution — the system does not run tests automatically
- Git state is unchanged by parallel execution — no branches, worktrees, or auto-commits
- Final review and commit always happen via the existing single-agent manual workflow