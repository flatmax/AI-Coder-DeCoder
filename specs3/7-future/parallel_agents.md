# Parallel Agent Architecture

## Overview

AC⚡DC can execute multiple LLM agents in parallel to accelerate large tasks. A planner decomposes a user request into independent sub-tasks, each agent executes its sub-task, and an assessor reviews the combined result via git diff. The cycle repeats until the task is complete or the user intervenes.

## Core Principle: Anchor-Based Non-Overlapping Edits

The edit protocol uses exact text anchors (old text → new text), not line numbers. Two agents can safely edit the same file provided their anchors target non-overlapping text regions. The planner's job is to assign **independent work units** — classes, functions, documentation sections — not disjoint file sets.

For example, in a single file containing `class Parser` and `class Formatter`, Agent A can edit `class Parser` methods while Agent B edits `class Formatter` methods. Their anchors will not overlap because they target different text regions.

If an agent's edit fails validation (anchor not found, or anchor became ambiguous because another agent modified nearby text), this is a detectable failure — not a corruption. It feeds into the assessment step.

## Execution Model

```
User Request
     │
     ▼
Planner (1 LLM call)
  Input: user request + symbol map + connected components
  Output: N sub-tasks, each specifying work units
          (classes, functions, doc sections to create/modify)
     │
     ├──── Agent A (thread) ──→ edits applied to repo
     ├──── Agent B (thread) ──→ edits applied to repo
     └──── Agent C (thread) ──→ edits applied to repo
              │
              ▼  (all agents complete)
         git diff (working tree vs HEAD)
              │
              ▼
         Assessor (1 LLM call)
           Input: original plan + unified diff + symbol map
           Output: {complete, needs_fix, run_tests}
              │
              ├── complete → present to user for review/commit
              ├── needs_fix → feed back into planner → repeat
              └── run_tests → execute → feed results back → repeat
```

### Planner

A single LLM call that receives:
- The user's request.
- The symbol map (compact structural view of the codebase).
- Connected component data from the reference index (which file/symbol clusters are independent).

It outputs a structured task list. Each task specifies:
- A natural language description of the sub-task.
- The work units (classes, functions, doc sections) the agent should create or modify.
- Read context: which files/symbols the agent needs to see but not edit.

The planner does not need to assign disjoint file sets. It assigns independent work units. The reference index's connected component analysis informs this: symbols in different components have no cross-references by definition, making them safe to edit in parallel.

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

### Assessor

After all agents complete, the assessor receives:
- The original user request and planner decomposition.
- A `git diff HEAD` showing all changes made by all agents.
- The updated symbol map (re-indexed after edits).

The assessor determines:
- **Complete**: All sub-tasks achieved. Present to user for manual review and commit.
- **Needs fix**: Some edits failed or are incomplete. Generate corrective tasks and feed back to the planner for another iteration.
- **Run tests**: Changes look correct but need validation. Execute test suite, feed results (pass/fail with error output) back to the planner.

### Iteration

The flow is a control loop, not a pipeline:

```
plan → execute all agents → assess diff →
  ├── done (user reviews and commits manually)
  ├── replan (some tasks failed/incomplete) → execute again
  └── run tests → feed failures back → replan
```

Each iteration starts from ground truth: the actual state of files on disk as reported by `git diff`. No agent's potentially stale understanding of the codebase carries forward — the assessor sees what actually changed.

## Symbol Map as Planner Input

The planner needs to understand codebase structure to decompose tasks. The symbol map already provides this in a compact, LLM-readable format. The reference index adds:
- **Connected components**: clusters of files linked by imports/call-sites, disconnected from other clusters. Symbols in different components can be edited in parallel with zero risk of semantic conflict.
- **File reference counts**: how many other files depend on a given file. High-ref-count files are riskier to modify in parallel.

Example cluster format for the planner prompt:

```
# Independent clusters (no cross-references between clusters)
Cluster 1: parser.py, cache.py, tests/test_parser.py
Cluster 2: ui.js, theme.js, components/dialog.js  
Cluster 3: doc_convert.py, tests/test_doc_convert.py
```

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
1. **Test execution**: Run the project's test suite after the assessment step. Test failures feed back into the planner.
2. **LLM review of cross-boundary interfaces**: The assessor examines the diff specifically at call sites that cross agent boundaries (identified via the reference index).
3. **Type checking**: If the project has a type checker (mypy, tsc), run it after edits.

The reference index identifies exactly which call sites cross the boundary between agents' work units, allowing the assessor to focus its review on the highest-risk interfaces rather than reviewing the entire diff.

## Re-Indexing Between Iterations

After all agents in one iteration complete and before the assessor runs, the symbol index is re-indexed for changed files. Tree-sitter re-indexing of individual files takes milliseconds, so this is negligible overhead. The assessor and any subsequent planner iteration see an accurate, current symbol map.

## When to Use Agent Mode

Agent mode is an explicit opt-in for tasks that benefit from parallelism:
- Large refactors touching many independent modules.
- Multi-file feature implementations spanning disconnected components.
- Bulk documentation updates across independent sections.
- Codebase migrations (e.g., API version upgrades across many callers).

For typical single-file or tightly-coupled tasks, the existing single-agent mode is faster (no planning overhead) and simpler.