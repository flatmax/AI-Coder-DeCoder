# File Picker

Tree view of repository files with checkboxes, git status, and context menu. Left panel of the Files tab. Drives file selection (which files are in LLM context) and file navigation (which file is open in the viewer).
## Tree Rendering
### Root Node — Branch Badge
- Root row displays a checkbox, the repo name, and a compact pill showing the current git branch
- Branch name prefixed with a branch icon
- Normal branch — muted style
- Detached HEAD — orange-tinted style, short SHA instead of branch name
- Long branch names truncated with ellipsis, full name in tooltip
- Fetched via the current-branch RPC on every tree reload — stays current after commits, checkouts, and review entry/exit
- Root checkbox aggregates over every file in the repo — same semantics as a directory checkbox applied to the whole tree: regular click toggles select-all (un-excluding any excluded descendants), shift+click toggles exclude-all (deselecting any selected descendants). Checked / indeterminate / unchecked reflect aggregate selection; strikethrough + dimmed checkbox reflect all-excluded; `✕` badge reflects partial exclusion
### Directory Nodes
- Expandable toggle
- Checkbox selects/deselects all children
- Indeterminate state when partially selected
### File Nodes
- Checkbox for selection (three states — see below)
- Name click opens in the diff viewer (or SVG viewer for SVG files)
- Line count badge in neutral color (no size thresholds)
- Git status badge — modified, staged, untracked, deleted
- Diff stats for changed files (additions and deletions) — rendered in a reserved gutter to the left of the checkbox column so the checkbox column stays aligned across sibling rows regardless of whether a given row has diff stats
### Tooltip
- Every row displays a native browser tooltip on hover
- Format — full path and node name
- Root node falls back to repo name
## Sorting
Three sort modes selectable via buttons in the filter bar:
| Mode | Behavior |
|---|---|
| Name | Alphabetical by filename (default) |
| Mtime | Most recently modified first |
| Size | Largest line count first |
- Clicking the active sort button toggles ascending/descending
- Directories always sort alphabetically regardless of mode
- Sort mode and direction persisted to localStorage
## Filtering
- Text filter with fuzzy matching against the full path
- All characters in the query must appear in the path in order (not necessarily consecutive)
- Case-insensitive
- Directories auto-expand when filtered; a directory remains visible if any descendant matches
## @-Filter Bridge
- Typing an @-prefixed query in the chat input activates the file picker filter (see [chat.md](chat.md))
- Files tab receives filter-from-chat events and forwards them to the picker
## Keyboard Navigation
- Arrow keys move focus
- Space/Enter toggles selection
- Auto-scroll to focused item
## Git Status Badges
| State | Color | Badge |
|---|---|---|
| Clean | Grey | — |
| Modified | Amber | M |
| Staged | Green | S |
| Untracked | Green | U |
| Deleted | Red | D |
## Three-State Checkbox (Index Exclusion)
Files have three context states controlled via the picker checkbox:
| State | Checkbox | Visual | Context effect |
|---|---|---|---|
| Index-only (default) | Unchecked | Normal | File's index block is in context |
| Selected | Checked | Normal | Full file content in context (index block excluded — redundant) |
| Excluded | Unchecked | Strikethrough, dimmed, badge | No content, no index block, no tracker item |
### Interaction Model
- Regular click — toggles between index-only and selected
- Shift+click — toggles between index-only and excluded; suppresses native checkbox toggle via `preventDefault` to avoid visual glitch
- Shift+click on a selected file — excludes (removes from both selection and index)
- Regular click on an excluded file — un-excludes and selects
- Shift+click on a directory — toggles exclusion for all children
- Regular click to select directory children — un-excludes any excluded children
- Regular and shift+click on the root checkbox apply the same rules as a directory checkbox, but scoped to every file in the repository
### Visual Treatment
- Excluded files — strikethrough and muted opacity, reduced checkbox opacity, tooltip explaining shift+click to re-include. No badge — the strikethrough alone carries the signal.
- Directory rows reflect descendant exclusion state so the tree surfaces exclusion without requiring every folder to be expanded:
  - All descendant files excluded — strikethrough, muted opacity, reduced checkbox opacity, tooltip explaining shift+click to re-include all. No badge.
  - Some descendants excluded — `✕` badge at reduced opacity (no strikethrough), tooltip indicating partial exclusion. The badge is the distinguishing signal for this state alone, where strikethrough would be misleading.
  - None excluded — normal styling
- The root row uses the same three visual states as directory rows, aggregated over the entire repository
- A directory with zero descendant files is treated as "none excluded"
- Checkbox tooltip adapts to exclusion state — prompts differ for default vs excluded files
### Context Menu
- File and directory context menus include include/exclude items as an alternative to shift+click
### Backend Coordination
- Excluded files set stored server-side via the excluded-files RPC, persisted in session state
- Removed from the stability tracker, excluded from map generation, skipped in active items, excluded from tier recomputation
## Context Menu
### File Items
- Stage, unstage, discard (confirm)
- Rename (inline input)
- Duplicate (inline input pre-filled with current path)
- Load in left panel, load in right panel — for ad-hoc comparison (see [diff-viewer.md](diff-viewer.md))
- Exclude from index / include in index
- Delete (confirm)
### Directory Items
- Stage all, unstage all
- Rename (inline input)
- New file (inline input)
- New directory (inline input) — creates a placeholder file inside since git does not track empty directories
- Exclude from index / include in index

### Root Items
Right-clicking the repo-name row opens a reduced menu scoped to operations that make sense at the repository level:
- New file (inline input) — creates at repo root
- New directory (inline input) — creates at repo root

Stage-all / unstage-all / rename / exclude-all are deliberately absent — the root is the repository itself, not a per-directory operand. Root-level new-file and new-directory use the same action IDs as the directory menu so the orchestrator routes through the same dispatcher.
### Inline Input Pattern
- Rename, new file, new directory operations render an inline text input at the correct indentation level (not a browser prompt)
- Input appears immediately below the target node (for rename) or as a child of the directory (for new file/dir)
- Enter submits, Escape or blur cancels
- Rename — input pre-filled with current name and auto-selected
- New directory — creates a placeholder file inside
- Auto-focus applied via lifecycle hook after render
### Load in Panel
- Load in left panel / load in right panel — fetch file content and dispatch an event that the diff viewer uses to load content into a panel for ad-hoc comparison
## Auto-Selection

- On first load, auto-select files appearing in the modified / staged / untracked / deleted lists
- Merge with any server-provided selection (e.g., after a browser refresh while server is still running) rather than replacing
- Auto-expand directories containing changed files
- A one-time guard ensures this runs exactly once per component lifetime — subsequent tree reloads (after commits, resets, review entry) do not re-trigger auto-selection

## File Mention Selection

- Files mentioned in assistant responses toggle selection via file-mention-click events (see [chat.md](chat.md))
- On add — file added to selected set, picker checkbox checked, parent directory auto-expanded, chat input text accumulated
- On remove — file removed from selected set, picker checkbox unchecked
- In both cases — file opened in diff viewer

## Auto-Add from Not-In-Context Edits

- When the LLM attempts to edit files not in active context, those files are automatically added to the selected list (see [edit-protocol.md](../3-llm/edit-protocol.md))
- Picker receives the updated selection via the standard broadcast and updates checkboxes
- Parent directories of auto-added files are auto-expanded

## Auto-Add from Created Files

- When the LLM successfully creates a new file via an edit block, the file is automatically added to the selected list (see [edit-protocol.md](../3-llm/edit-protocol.md))
- Picker receives the updated selection via the standard broadcast and updates checkboxes
- Parent directories of created files are auto-expanded
- Unlike not-in-context auto-adds, no retry prompt is generated in the chat input

## Middle-Click Path Insertion

- Middle-click on any row inserts the path into chat input at cursor position, space-padded before and after
- Browser's selection-buffer paste is suppressed via a one-shot flag on the chat panel (set by the path-insertion path, consumed by the paste handler)
- Cross-component flag pattern — the flag lives on the chat panel (which owns the textarea and paste event), not on the picker or a shared singleton
- Flag must be set before the textarea receives focus, or the browser may dispatch the paste before the handler sees the flag

## Active File Highlight

- Row highlighted when file is open in the viewer
- The viewer dispatches an active-file-changed event on tab switch, open, or close
- App shell relays to the dialog → files tab → picker
- Distinct background and left-border accent, independent of selection state

## Left Panel Resizer

- Vertical 4px splitter between the file picker and chat panel, widening to a ~20px affordance strip with a `▸` glyph when the picker is collapsed
- Drag to resize: width clamped to [180px, 50% of the host width]. Minimum prevents the picker from collapsing below readable size; maximum keeps the chat pane at least half the dialog
- Double-click to toggle collapsed state. Collapsed renders at a fixed ~24px affordance width regardless of the stored drag width; the stored width survives so expand restores the user's prior size
- Width persists to `ac-dc-picker-width` in localStorage; collapsed flag persists to `ac-dc-picker-collapsed`
- Malformed stored values fall back to a sensible default rather than rendering at a sub-readable size
- In collapsed mode the splitter is a click target for expand (via double-click); pointerdown does not start a drag since the origin width would be meaningless

## Review Mode Banner

- When review mode is active, a banner at the top of the picker shows branch name, commit range, file/line stats, exit button
- Synchronized with review state from the review-state RPC
- See [code-review.md](../4-features/code-review.md)

## File Search Integration

When file search is active in the chat panel, the files tab swaps the picker tree to a pruned view containing only matching files.

- Search change event — triggers pruned tree build (from results) or full tree restore
- Search scroll event — syncs picker highlight to match panel scroll position

### Tree Swap

- Files tab builds a pruned tree from search results (splitting paths into nested directories, setting line count to match count)
- Calls the picker's set-tree method
- On exit, expanded state is restored before the full tree reload, so the user's previous expand/collapse state returns
- Focus state is cleared on exit

### Expand State Preservation

- Set-tree lazily snapshots the current expanded set on the first call (repeated search refinements do not re-snapshot)
- Restore method replaces the expanded set with the saved snapshot before the full tree reload
- Full tree reload does not reset the expanded set, so the restored state is used for rendering

### Picker Click Intercept

- During file search, file-clicked events from the picker are intercepted
- Instead of navigating to the diff viewer, the files tab calls the chat panel's scroll-to-file method to scroll the match overlay to the target file section

### Scroll Highlight Sync

- When the match overlay scrolls, the files tab receives search-scroll events and updates the picker's focused path, expands ancestor directories, and scrolls the picker to show the highlighted file row
- A brief pause flag prevents feedback loops between the two scroll directions

## Files Tab Orchestration

The files tab (parent of both picker and chat panel) coordinates all file-related state.

### Responsibilities

- Selection sync — receives selection-changed from picker, updates server and chat panel directly
- Exclusion sync — receives exclusion-changed from picker, forwards to server
- File mentions — receives file-mention-click from chat, toggles selection, updates picker and chat panel
- Message preservation — syncs messages from chat before selection updates to prevent stale message overwrites
- Review lifecycle — clears selection on review entry, refreshes tree, updates chat panel's review state
- Filter bridge — forwards filter-from-chat events to the picker's set-filter method
- Path insertion — routes insert-path from picker middle-click to chat textarea
- File tree refresh — forwards files-modified from chat to picker's load-tree method and re-dispatches on window

### Direct Update Pattern (Architectural)

When selection changes, the files tab updates both the picker's selected-files property and the chat panel's selected-files property directly, rather than relying on framework top-down reactive propagation.

Why this is necessary — framework reactive data flow means changing a property on the parent triggers a full re-render of its template, which would re-assign child component properties. For the chat panel, this resets scroll position and disrupts streaming state. For the file picker, it collapses interaction state (context menus, inline inputs, focus).

The pattern (used consistently across all selection-changing operations):

1. Sync messages from chat back into the files tab's own state — prevents stale data from overwriting the chat panel's current state on any future re-render
2. Update the files tab's own selected-files state
3. Directly set the chat panel's selected-files + request update
4. Directly set the picker's selected-files + request update
5. Notify server via the selected-files RPC

Where it's used — selection-changed handler, file-mention-click handler, files-changed handler, review-started handler, state-loaded handler, exclusion-changed handler.

Without the message sync step, the following failure occurs: user sends message → chat panel updates its messages array → user clicks file mention → files tab re-renders → chat panel receives the files tab's stale messages prop → latest messages are lost.

### Review Entry Flow

When a review starts (via review-started event from the review selector):

1. Set review state to active with review details
2. Clear selected files to empty (review starts with no files selected)
3. Reset picker's selected files to empty set
4. Refresh picker's file tree (now shows staged changes from soft reset)
5. Update chat panel's selected files and review state

## State Persistence

- Expanded directories — tracked in component state, propagated via events
- Panel width — localStorage
- Panel collapsed state — localStorage
- Branch name — fetched live on each tree reload, not persisted

## Invariants

- Three-state checkbox always reflects server-side state after any toggle
- File selection never persists across server restart (only across browser reloads when server is running)
- Auto-selection runs exactly once per component lifetime
- Middle-click path insertion always suppresses the subsequent browser selection-buffer paste
- Review entry clears selection on both server and frontend — defense in depth
- Direct-update pattern for selection changes never triggers a parent re-render that would reset child scroll or interaction state
- File search exit restores the previous expanded state of the full tree