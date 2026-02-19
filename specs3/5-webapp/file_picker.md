# File Picker

## Overview

Tree view of repository files with checkboxes, git status, and context menu. Left panel of the Files tab.

## Tree Rendering

### Branch Badge

The root row (repo name) displays a **branch badge** — a compact pill showing the current git branch name with a `⎇` icon prefix. Fetched via `Repo.get_current_branch` during each `loadTree()` call, so it stays current after commits, checkouts, and review entry/exit.

| State | Display | Style |
|-------|---------|-------|
| Normal branch | `⎇ main` | Muted text, default border |
| Detached HEAD | `⎇ abc1234` (short SHA) | Orange text, orange-tinted border |

The badge truncates long branch names with ellipsis (max 140px) and shows a tooltip with the full branch name. When detached, the short SHA is resolved via `Repo.resolve_ref('HEAD')`.

**Directories**: Expandable toggle. Checkbox selects/deselects all children. Indeterminate when partially selected.

**Files**: Checkbox for selection. Name click opens in diff viewer. Shows:
- Line count (green < 130, orange 130–170, red > 170)
- Git status badge (M/S/U)
- Diff stats (+N -N)

### Filtering

Text filter narrows visible nodes by path substring. Directories auto-expand when filtered.

### @-Filter

`@text` in chat input activates the file picker filter. See [Chat Interface — @-Filter](chat_interface.md#-filter).

### Keyboard Navigation

Arrow keys move focus. Space/Enter toggles selection. Auto-scroll to focused item.

## Git Status

| State | Color | Badge |
|-------|-------|-------|
| Clean | Grey | — |
| Modified | Amber | M |
| Staged | Green | S |
| Untracked | Green | U |

## Context Menu

### File Items
Stage, unstage, discard (confirm), rename (prompt), delete (confirm).

### Directory Items
Stage all, unstage all, rename (prompt), new file (prompt), new directory (prompt).

### Operation Flow
1. Close menu → confirm/prompt if needed → execute RPC → refresh tree

### Inline Input for Rename / New File / New Directory

Rename, new file, and new directory operations render an **inline text input** in the tree at the correct indentation level (rather than a browser `prompt()` dialog):
- The input appears immediately below the target node (for rename) or as a child of the directory (for new file/dir)
- Enter submits, Escape or blur cancels
- For rename: input is pre-filled with the current name and auto-selected
- For new directory: creates a `.gitkeep` file inside the new directory (git does not track empty directories)
- Auto-focus is applied via `updated()` lifecycle — the component queries for `.inline-input` after each render

## Auto-Selection

On first load, auto-select modified/staged/untracked files. Auto-expand directories containing changed files.

A `_initialAutoSelect` guard ensures this runs exactly once per component lifetime — subsequent tree reloads (after commits, resets, review entry) do not re-trigger auto-selection. The auto-expansion walks each changed file's path segments and adds all ancestor directories to the expanded set.

## File Mention Selection

Files mentioned in assistant responses toggle selection via `file-mention-click` events (see [Chat Interface](chat_interface.md#file-mentions)). When clicked:
1. If not selected: file added to selected files set, picker checkbox checked, parent directory auto-expanded, chat input text accumulated
2. If already selected: file removed from selected files set, picker checkbox unchecked
3. In both cases: file opened in diff viewer

## Auto-Add from Not-In-Context Edits

When the LLM attempts to edit files that aren't in the active context, those files are automatically added to the selected files list (see [Edit Protocol — Not-In-Context Edit Handling](../3-llm-engine/edit_protocol.md#not-in-context-edit-handling)). The file picker receives the updated selection via the standard `filesChanged` broadcast and updates checkboxes accordingly. Parent directories of auto-added files are auto-expanded to make the new selections visible.

## Middle-Click Path Insertion

Middle-click on any row inserts the path into chat input at cursor position (space-padded before and after). The browser's selection-buffer paste is suppressed via a `_suppressNextPaste` flag on the chat panel — middle-click sets the flag, and the chat panel's paste handler checks and clears it, calling `preventDefault()` to block the selection-buffer paste that the browser would otherwise fire immediately after.

## Active File Highlight

Row highlighted when file is open in diff viewer. The diff viewer dispatches `active-file-changed` with `{ path }` on tab switch/open/close. The app shell relays this to the dialog → files tab → file picker. The `.active-in-viewer` class applies a distinct background and left border accent, independent of selection state.

## Left Panel Resizer

A vertical resizer separates the file picker from the chat panel:
- Draggable handle with collapse button (◀/▶)
- Width constrained 150px–500px
- Width and collapsed state persisted to local storage

## Review Mode Banner

When review mode is active, a banner displays at the top of the file picker showing the branch name, commit range, file/line stats, and an exit button. The banner is synchronized with review state from `get_review_state()`. See [Code Review — UI Components](../4-features/code_review.md#review-mode-banner).

The review selector (git graph) opens in a separate floating dialog — the file picker remains visible and usable underneath. See [Code Review — Git Graph Selector](../4-features/code_review.md#git-graph-selector).

## Data Flow

1. On startup: load file tree from Repo via RPC
2. Tree populates with files, modified/staged/untracked arrays, diff stats
3. Selection changes fire events, captured by parent to update selected files
4. File tree refresh compares JSON against previous to avoid unnecessary re-renders; status arrays always update

## Files Tab Orchestration

The `ac-files-tab` component (parent of both file picker and chat panel) serves as the coordination hub for all file-related state:

| Responsibility | Mechanism |
|---------------|-----------|
| Selection sync | Receives `selection-changed` from picker, updates server and chat panel directly |
| File mentions | Receives `file-mention-click` from chat, toggles selection, updates picker and chat panel |
| Message preservation | Calls `_syncMessagesFromChat()` before selection updates to prevent stale message overwrites |
| Review lifecycle | Clears selection on review entry, refreshes tree, updates chat panel's review state |
| Filter bridge | Forwards `filter-from-chat` events (from @-filter) to the picker's `setFilter()` |
| Path insertion | Routes `insert-path` from picker middle-click to chat textarea |
| File tree refresh | Forwards `files-modified` from chat to picker's `loadTree()` and re-dispatches on window |

### Direct Update Pattern (Architectural)

When selection changes, the files tab updates both the picker's `selectedFiles` property and the chat panel's `selectedFiles` property **directly** (followed by `requestUpdate()`), rather than relying on Lit's top-down reactive propagation through its own re-render.

**Why this is necessary:** Lit's reactive data flow means changing a property on the parent (`ac-files-tab`) triggers a full re-render of its template, which would re-assign child component properties. For the chat panel, this resets scroll position and disrupts streaming state. For the file picker, it collapses interaction state (context menus, inline inputs, focus).

**The pattern (used consistently across all selection-changing operations):**
1. Call `_syncMessagesFromChat()` — read `chatPanel.messages` back into the files tab's own `_messages` property, preventing stale data from overwriting the chat panel's current state on any future re-render
2. Update `this._selectedFiles` on the files tab (its own state record)
3. Directly set `chatPanel.selectedFiles = newFiles` + `chatPanel.requestUpdate()`
4. Directly set `picker.selectedFiles = new Set(newFiles)` + `picker.requestUpdate()`
5. Notify server via `rpcCall('LLMService.set_selected_files', newFiles)`

**Where it's used:** `_onSelectionChanged`, `_onFileMentionClick`, `_onFilesChanged`, `_onReviewStarted`, `_onStateLoaded`

Without `_syncMessagesFromChat()`, the following failure occurs: user sends a message → chat panel updates its `messages` array → user clicks a file mention → files tab re-renders → chat panel receives the files tab's stale `_messages` prop → latest messages are lost.

### Review Entry Flow

When a review starts (via `review-started` event from the review selector):
1. Set `_reviewState` to active with review details
2. Clear `_selectedFiles` to empty (review starts with no files selected)
3. Reset picker's `selectedFiles` to empty `Set`
4. Refresh picker's file tree (now shows staged changes from soft reset)
5. Update chat panel's `selectedFiles` and `reviewState`

## State Persistence

- Expanded directories: tracked in component state and propagated via events
- Panel width: local storage (default ~280px)
- Panel collapsed: local storage
- Branch name: fetched live on each `loadTree()` (not persisted)