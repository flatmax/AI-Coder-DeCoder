# Parallel Agent Architecture

## Overview

AC⚡DC can execute multiple LLM agents in parallel to accelerate large tasks. A planner decomposes a user request into independent sub-tasks, each agent executes its sub-task, and an assessor reviews the combined result via reverse diff. The cycle repeats until the task is complete or the user intervenes.

## Core Principle: Anchor-Based Non-Overlapping Edits

The edit protocol uses exact text anchors (old text → new text), not line numbers. Two agents can safely edit the same file provided their anchors target non-overlapping text regions. The planner's job is to assign **independent work units** — classes, functions, documentation sections — not disjoint file sets.

For example, in a single file containing `class Parser` and `class Formatter`, Agent A can edit `class Parser` methods while Agent B edits `class Formatter` methods. Their anchors will not overlap because they target different text regions.

If an agent's edit fails validation (anchor not found, or anchor became ambiguous because another agent modified nearby text), this is a detectable failure — not a corruption. It feeds into the assessment step.

## Execution Model

```
User Request
     │
     ▼
Planner (1 LLM call — uses planner.md system prompt)
  Input: user request + symbol map + file context
  Output: N sub-tasks, each specifying work units
          (classes, functions, doc sections to create/modify)
     │
     ├──── Agent A (thread) ──→ edits applied to repo
     ├──── Agent B (thread) ──→ edits applied to repo
     └──── Agent C (thread) ──→ edits applied to repo
              │
              ▼  (all agents complete)
         Assess: reverse diff + changed files in context
              │
              ├── edit clashes / failures → re-execute failed tasks
              ▼
         Assessor (1 LLM call — uses assessor.md system prompt)
           Input: original plan + reverse diff + symbol map
           Output: {complete, needs_replan}
              │
              ├── complete → present to user for review/commit
              └── needs_replan → user runs tests (if needed)
                   → feed results back to planner → repeat
```

### Planner

The planner is the existing single-agent LLM approach with a dedicated system prompt (`config/planner.md`). It receives:
- The user's request.
- The symbol map (compact structural view of the codebase).
- The document index (in document mode).
- Selected file context.

The LLM reads the symbol map and reference information to determine which work units are independent. No local graph algorithm is required — the symbol map already exposes imports, call sites, and cross-references in a compact format that the LLM can reason about directly to make pragmatic decomposition decisions.

The planner outputs a structured task list. Each task specifies:
- A natural language description of the sub-task.
- The work units (classes, functions, doc sections) the agent should create or modify.
- Read context: which files/symbols the agent needs to see but not edit.

The planner does not need to assign disjoint file sets. It assigns independent work units. The LLM identifies clusters of symbols with no cross-references, making them safe to edit in parallel.

### Agents

Each agent runs as a thread with:
- Its own `ContextManager` (own conversation history, own file context).
- Shared read-only access to the symbol index, reference index, and repo.
- A focused sub-task from the planner.

Agents execute independently with no inter-agent communication during execution. Each agent produces edit blocks which are applied to the working directory via the existing `apply_edits_to_repo` function.

If two agents happen to write to the same file, the anchor-based edit protocol handles this naturally:
- If their anchors target different text regions, both succeed.
- If an anchor fails (text not found or ambiguous), the edit is rejected with a diagnostic. This is recorded as a partial failure for the assessment step.

The one requirement is **I/O serialisation**: the physical read → find-anchor → replace → write cycle for a single file must be atomic. A per-file mutex in `apply_edits_to_repo` ensures two threads never simultaneously write the same file. This lock is held for microseconds (string search + file write) and has no impact on agent parallelism — agents generate edits concurrently, only the final disk write is serialised.

#### ContextManager Independence

Each agent's `ContextManager` must operate correctly while other agents concurrently modify the repo and symbol index:
- **Own conversation state**: Each agent has its own history, token counts, and file context. No shared mutable conversation state.
- **Symbol map refresh**: The symbol index is re-indexed for changed files between execution rounds (not during). Within a single round, all agents read a consistent snapshot.
- **File content reads**: Agents read file content at call time. If another agent has written to a file the current agent is reading, it sees the updated content. This is acceptable — agents target independent work units, so reading a co-modified file means seeing completed work from another agent, not a half-written state (the per-file mutex guarantees atomic writes).
- **No shared cache tiers**: Each agent's stability tracker is independent. Cache tiering is per-agent for the duration of parallel execution.

### Assessor

The assessor is the existing single-agent LLM approach with a dedicated system prompt (`config/assessor.md`). It uses a **forward diff** (`git diff HEAD`) — showing what was added and changed relative to HEAD. Forward diffs are a better fit than the reverse diffs used in code review mode because the assessor's task is plan verification ("was the requested work produced?"), not change evaluation ("should this be reverted?"). A forward diff directly shows what each agent contributed, making it straightforward to check completeness against the plan.

After all agents complete, the assessor receives:
- The original user request and planner decomposition.
- A forward diff showing all changes made by all agents.
- Changed files in context (these are in context by default, as with normal operation).
- The symbol map (already present in context) and document indexes (if in document mode).

The assessor determines:
- **Complete**: All sub-tasks achieved. Present to user for manual review and commit.
- **Needs replan**: Some tasks are incomplete or semantically inconsistent. Feed back to the planner for another iteration.

### Iteration Loop

The iteration loop has two levels — a fast inner loop for mechanical failures and an outer loop for semantic issues:

```
plan → execute all agents →
  ├── edit clashes / anchor failures? → re-execute failed tasks (inner loop)
  ▼
assess reverse diff →
  ├── complete → present to user for review/commit
  └── needs_replan →
       ├── user runs tests, gathers results (if needed)
       └── feed results + assessment back to planner → repeat (outer loop)
```

**Inner loop (re-execute):** After all agents complete, if any edits failed due to anchor clashes or ambiguity, re-execute only the failed tasks. The re-executed agents see the current file state (with successful edits from other agents already applied). This loop handles mechanical edit conflicts without LLM re-planning overhead.

**Outer loop (replan):** The assessor reviews the reverse diff and determines whether the combined result is semantically correct. If not, the user may optionally run tests and gather results. The assessment and any test output feed back to the planner for a new decomposition. Each outer iteration starts from ground truth: the actual state of files on disk.

The user drives test execution — the system does not automatically run tests. This keeps the user in control and avoids assumptions about test infrastructure.

## Planner System Prompt (`config/planner.md`)

The planner uses a dedicated system prompt that instructs the LLM to:
- Read the symbol map to identify independent work units.
- Decompose the user request into N sub-tasks with explicit work unit assignments.
- Specify read context for each agent (files to see but not edit).
- Output a structured format (parseable task list).

This is a new config file alongside the existing `system.md`, `review.md`, etc. It follows the same config directory conventions (user-editable, version-aware upgrade).

## Assessor System Prompt (`config/assessor.md`)

The assessor uses a dedicated system prompt that instructs the LLM to:
- Read the forward diff to see what each agent produced.
- Compare the changes against the original plan.
- Identify semantic conflicts, missing implementations, or broken interfaces.
- Output a structured verdict: complete or needs_replan with specific issues.

This mirrors the existing `review.md` pattern — the assessor is essentially a review-mode LLM call with a different focus (plan completion rather than code quality).

## Transport: Single WebSocket

All agents share the existing single WebSocket connection. Each agent's stream chunks carry a `request_id` for demultiplexing. The browser already dispatches events by request ID.

Bandwidth is not a constraint: N agents at ~50 tokens/sec each produce ~1KB/s aggregate throughput. WebSocket frame limits (configurable, typically 1–16MB) are irrelevant for streaming text chunks of a few hundred bytes.

The existing `requestAnimationFrame` coalescing in the chat panel handles DOM update batching. For multiple concurrent streams, the frontend would render N output areas (or a consolidated view with agent labels), each with independent coalescing.

## No Git Branches or Worktrees

All agents operate on the current branch in the single working directory. There is no auto-commit — the user reviews all changes via the existing diff viewer and commits manually, exactly as in single-agent mode.

Git branches and worktrees are unnecessary because:
- The anchor-based edit protocol already prevents conflicting writes at the text level.
- Edit failures are detectable (not silent corruption) and feed into the assessment loop.
- The user's existing manual review/commit workflow provides the final safety gate.

## Semantic Conflict Detection

The hardest class of conflict is semantic: Agent A changes a function's return type while Agent B (independently, in parallel) writes code calling that function with the old return type. Both agents' edits succeed textually, but the combined result is broken.

Detection approaches, in order of reliability:
1. **Test execution**: The user runs the project's test suite after the assessment step. Test failures feed back into the planner.
2. **LLM review of cross-boundary interfaces**: The assessor examines the reverse diff specifically at call sites that cross agent boundaries (identified via the reference index in the symbol map).
3. **Type checking**: If the project has a type checker (mypy, tsc), the user runs it after edits and feeds results back.

The symbol map exposes which call sites cross the boundary between agents' work units, allowing the assessor to focus its review on the highest-risk interfaces rather than reviewing the entire diff.

## Re-Indexing Between Iterations

Re-indexing happens through the existing mechanism — the symbol index and document index are refreshed for changed files as part of normal operation before each LLM call. No special parallel-agent re-indexing logic is needed. The assessor and any subsequent planner iteration automatically see an accurate, current symbol map because the standard pre-request refresh runs before their LLM calls.

## When to Use Agent Mode

Agent mode is an explicit opt-in for tasks that benefit from parallelism:
- Large refactors touching many independent modules.
- Multi-file feature implementations spanning disconnected components.
- Bulk documentation updates across independent sections.
- Codebase migrations (e.g., API version upgrades across many callers).

For typical single-file or tightly-coupled tasks, the existing single-agent mode is faster (no planning overhead) and simpler.