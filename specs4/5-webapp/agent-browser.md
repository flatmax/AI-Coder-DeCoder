# Agent Browser

**Status:** stub

There is no separate agent browser view. When the main LLM spawns agents to execute sub-tasks in parallel, each agent's conversation is archived and surfaced as a right-side region that fans out from the chat for the active turn. The default chat UX is unchanged for turns that did not spawn agents; agent turns simply surface an extra region when relevant.

The main LLM's own conversation — decomposition, agent-output review, iteration decisions, synthesis — is part of the assistant response shown in the chat. There is no separate column or card for it; it's just the assistant message. The agent region shows only what the spawned agents produced.

## Entry Points

- Automatic — when scrolling the chat lands on a turn with archive data, the agent region opens automatically (unless the user has explicitly closed it this session)
- Collapse tab — a right-edge tab labelled "🧠 Agents (N) ◀" toggles the agent region open or closed; state persists per session
- Direct link — a turn-scoped URL (shared with a colleague) scrolls chat to the referenced turn and auto-opens its agent region

## Layout

Two regions side by side:

- **Left — the chat panel.** Unchanged from the chat spec. Vertical list of user and assistant messages. Scrollable. The chat IS the main conversation; everything the main LLM said across its internal calls within a turn lands in the assistant message that turn produced.
- **Right — the agent region.** A horizontally scrollable strip of columns, one per agent the main LLM spawned for the active turn. Content reflects the turn currently active in the chat viewport. Open or closed per the user's per-session preference.

When no turn in the chat viewport spawned agents, the agent region is hidden entirely — not collapsed to a zero-width strip, just absent. It reappears when a turn with agents enters the viewport.

### Agent Region Layout

- One column per agent in the active turn
- Each column shows the agent's full conversation (raw markdown, scrollable)
- Column header — agent number, one-line sub-task summary from the agent's system prompt or the main LLM's spawn instructions, diff stats (+N / -N), status badge
- Independent vertical scroll per column
- Horizontal scroll within the agent region when total column width exceeds its viewport allocation

### Resizing

- A draggable splitter separates the chat from the agent region. Splitter position is tab-drag adjustable and persists to localStorage per repo
- Splitters between agent columns are also draggable
- When the agent region is closed, the splitter collapses and the chat expands to fill the available width

### Collapse Tab

- A small tab pinned to the right edge of the chat panel (or left edge of the agent region when open) toggles the agent region
- When open — tab reads "🧠 Agents (N) ◀", where N is the agent count for the active turn
- When closed — tab reads "🧠 Agents (N) ▶", visible whenever the active turn has archive data
- State persists per session — closing agents on one turn keeps them closed when the user scrolls to other turns; re-opening on any turn re-enables the region for the whole session
- If the active turn has no archive (non-agent turn), the tab is hidden entirely. The session-level open/closed preference is remembered silently; scrolling back to a turn with agents reopens (or stays closed) per that preference

## Active Turn Selection

- The active turn is determined by scroll position in the chat panel
- Specifically — whichever turn (user message + its assistant response) has the most vertical coverage in the chat viewport
- When the active turn changes, the agent region fetches and renders the new turn's archive
- Agent column scroll positions reset on active-turn change (stale scroll into new content is worse than fresh-top)
- Turns without archives silently leave the agent region empty (or hide it, if the user's preference was open-by-default and no turn currently in view has agents)

## Lazy Loading

- Turn metadata (turn_id, agent count, status) is already part of the main chat history — no separate fetch is required
- The agent archive for a turn is fetched via `get_turn_archive` only when that turn becomes active (or enters the pre-fetch window)
- **Pre-fetch window** — the active turn plus one turn above and one below have their archives loaded. Turns further away drop their archive data from memory to keep the frontend working set bounded
- Pre-fetch direction follows scroll momentum — scrolling up pre-fetches older turns; scrolling down pre-fetches newer ones
- If the user scrolls quickly across many turns, intermediate archive loads are cancelled — only the turn the user settles on gets fully loaded

## Variable Agent Count

Turns can spawn different agent counts (2 agents vs 8). The agent region renders only as many columns as the active turn actually used:

- Turn A spawned 3 agents → 3 columns
- User scrolls to turn B which spawned 7 agents → region updates to 7 columns
- Column widths are preserved across transitions via the persisted splitter positions; new columns appear at their default width

Agent numbering (`agent-00`, `agent-01`, ...) is stable within a turn but does not carry meaning across turns — "agent 0" in turn A is unrelated to "agent 0" in turn B.

Horizontal scroll within the agent region handles turns with many agents — if the total width of all columns exceeds the region's viewport width, the user scrolls horizontally within the region without affecting chat scroll.

## Turns Without Agents

- Turns in which the main LLM did not spawn agents have no archive directory
- Their chat messages render normally (user message + assistant response) — no decoration indicates the absence of agent data
- The collapse tab is hidden while such a turn is active
- Scrolling from a no-agents turn to a with-agents turn seamlessly brings the tab back (per the user's session open/closed preference)

## Raw Markdown Rendering

All archived content — planner decomposition, per-agent conversations — renders as raw markdown using the same pipeline as the chat panel:

- Syntax highlighting for fenced code blocks
- Math rendering (KaTeX)
- File mention links navigate to the diff viewer
- No edit affordance — archives are read-only
- Turn-level toolbars (copy, paste-to-prompt) are NOT rendered for archive content — the chat's assistant message already exposes those for the user-facing synthesis

## Re-Iteration Within a Turn

When the main LLM spawns agents, reviews their output, and decides to spawn agents again with different scope, each agent's file accumulates both rounds of work. The agent region handles this by:

- Showing iteration dividers within each column — "─── Iteration 2 ───" inline separators — wherever an agent's file contains a re-spawn boundary
- All iterations are scrollable within their column; earlier iterations remain above, later iterations below
- An iteration summary badge in the column header — "3 iterations" — so users see at a glance that the agent was re-spawned

The main LLM's own reasoning across iterations is in the assistant message in chat, where the user reads it naturally as part of the response. The agent region only shows what each agent said and did.

## Empty States

- No turns in session yet — agent region hidden entirely; collapse tab hidden
- No turns that spawned agents yet in session — same as above; region only appears when the user scrolls to or produces a turn with an archive directory
- Archive directory expected but missing (user cleanup, file corruption) — region shows a single "Archive unavailable for this turn" message. Chat behavior is unaffected. In practice this only happens when a user manually deletes a directory; the system never creates and then drops an archive mid-turn

## Deep Linking

- URL parameter `?turn=<turn_id>` scrolls the chat to the referenced turn and auto-opens the agent region
- If the turn is outside the currently-loaded chat range, the chat's existing history pagination loads additional messages until the target turn is found
- Missing turn_id (corrupt link, deleted archive) scrolls to the most recent turn and shows a transient toast: "Turn {id} not found"

## Disk Usage Warning

- Since there is no dedicated agent browser view, the 1 GB disk usage warning is surfaced through the dialog header banner and a dismissible toast (see [history.md](../3-llm/history.md#disk-usage-monitoring))
- A Settings tab cleanup affordance lists archives by age with per-turn delete controls
- Deleting an archive removes its directory; turns whose archive was deleted show the "Archive unavailable for this turn" empty state next time they become active

## Invariants

- The agent region never mutates history — read-only end-to-end
- The active-turn selection is deterministic — same chat scroll position produces the same active turn and the same agent region contents
- Agent columns always reflect the active turn; no lag or stale state across turn transitions
- Pre-fetch window bounds memory — a session with hundreds of with-agents turns does not load every archive into memory
- Splitter positions and session open/closed preference persist via localStorage
- Turns without agents never show the agent region or the collapse tab — they look identical to today's chat
- Deleting an archive directory on disk is always safe; subsequent active-turn transitions to that turn show the "archive unavailable" state without corrupting chat playback
- The main LLM's own reasoning (decomposition, review, synthesis) is in the assistant message in chat, never in the agent region — the agent region shows only agent conversations