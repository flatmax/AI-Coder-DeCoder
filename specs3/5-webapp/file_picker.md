# File Picker

## Overview

Tree view of repository files with checkboxes, git status, and context menu. Left panel of the Files tab.

## Tree Rendering

**Directories**: Expandable toggle. Checkbox selects/deselects all children. Indeterminate when partially selected.

**Files**: Checkbox for selection. Name click opens in diff viewer. Shows:
- Line count (green < 130, orange 130–170, red > 170)
- Git status badge (M/S/U)
- Diff stats (+N -N)

### Filtering

Text filter narrows visible nodes by path substring. Directories auto-expand when filtered.

### @-Filter

`@text` in chat input activates the file picker filter. See [Chat Interface — @-Filter](chat_interface.md#-filter).

### Clear Selection

☐ button beside filter input. Deselects all files.

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

## Auto-Selection

On first load, auto-select modified/staged/untracked files. Auto-expand directories containing changed files.

## File Mention Selection

Files mentioned in assistant responses toggle selection via `file-mention-click` events (see [Chat Interface](chat_interface.md#file-mentions)). When clicked:
1. If not selected: file added to selected files set, picker checkbox checked, parent directory auto-expanded, chat input text accumulated
2. If already selected: file removed from selected files set, picker checkbox unchecked
3. In both cases: file opened in diff viewer

## Middle-Click Path Insertion

Middle-click on any row inserts the path into chat input at cursor position (space-padded before and after). The browser's selection-buffer paste is suppressed via a flag on the chat panel to prevent duplicate content.

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

## State Persistence

- Expanded directories: tracked in component state and propagated via events
- Panel width: local storage (default ~280px)
- Panel collapsed: local storage