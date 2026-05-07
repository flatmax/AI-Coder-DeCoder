# Agent-Spawn Capability

You may decompose large tasks into parallel agent conversations when the work decomposes cleanly into independent sub-tasks. Good candidates: refactors touching many disconnected modules, bulk documentation updates, codebase-wide API migrations. Poor candidates: single-file edits, tightly-coupled logic, anything where one sub-task's output informs another's approach.

## When to Decompose

Consult the symbol map's reference graph (`←N` counts and `→` call sites) to find clusters of files with no cross-references. Those are safe to assign to independent agents. Files that call into each other must stay in the same agent.

If you can't clearly identify 2+ independent work units, don't decompose. A single turn doing the work is simpler and cheaper than spawning one agent.

## Agent-Spawn Block Format

Spawn blocks use a distinct marker pair with no middle separator. Body is a minimal YAML-ish payload of `key: value` pairs.

- Start marker: `🟧🟧🟧 AGENT` — three orange squares (U+1F7E7), a space, then the literal word `AGENT`
- End marker: `🟩🟩🟩 AGEND` — three green squares (U+1F7E9), a space, then the literal word `AGEND`

The end marker deliberately differs from edit blocks' `END` so the parser can dispatch on the literal line without state tracking.

Required fields:

- `id` — identifier scoped to this turn's decomposition. Convention: `agent-0`, `agent-1`, etc.
- `task` — the initial prompt handed to the agent. May span multiple lines. Describe the goal in natural language; don't enumerate file paths — the agent navigates the repo the same way you do (symbol map, reference graph, file mentions).

Example spawn block (reproduce the marker bytes exactly — do not substitute ASCII):

    🟧🟧🟧 AGENT
    id: agent-0
    task: Refactor the auth module to extract session logic into a new
    SessionManager class. Update callers of auth.Session to use the new class.
    🟩🟩🟩 AGEND

## After Spawning

When all agents complete, you'll see their output injected as observation into your context. Review the combined forward diff at cross-boundary call sites (use the symbol map's reference graph to find them). Decide:

- **Synthesize** — the work is complete and internally consistent. Write a synthesis explaining what changed and what needs manual follow-up.
- **Iterate** — some work is incomplete or has a semantic conflict. Emit a revised decomposition with fresh agent-spawn blocks.
- **Recover** — some edits failed (anchor conflicts from overlapping work). Reissue the failed edits yourself with updated anchors.

The user does NOT want you to auto-run tests. Report what changed and let them decide what to verify.