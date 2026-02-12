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

Files mentioned in assistant responses can be added to the selection via `file-mention-click` events (see [Chat Interface](chat_interface.md#file-mentions)). When clicked:
1. File added to selected files set
2. File picker checkbox state updated
3. Parent directory auto-expanded if collapsed
4. Chat input text accumulated with file list prompt (see Chat Interface — Input Text Accumulation)

## Middle-Click Path Insertion

Middle-click on any row inserts the path into chat input at cursor position (space-padded). Default paste/autoscroll suppressed.

## Active File Highlight

Row highlighted when file is open in diff viewer. The diff viewer dispatches `active-file-changed` with `{ path }` on tab switch/open/close. The app shell relays this to the dialog → files tab → file picker. The `.active-in-viewer` class applies a distinct background and left border accent, independent of selection state.

## Left Panel Resizer

A vertical resizer separates the file picker from the chat panel:
- Draggable handle with collapse button (◀/▶)
- Width constrained 150px–500px
- Width and collapsed state persisted to local storage

## Data Flow

1. On startup: load file tree from Repo via RPC
2. Tree populates with files, modified/staged/untracked arrays, diff stats
3. Selection changes fire events, captured by parent to update selected files
4. File tree refresh compares JSON against previous to avoid unnecessary re-renders; status arrays always update

## State Persistence

- Expanded directories: tracked in component state and propagated via events
- Panel width: local storage (default ~280px)
- Panel collapsed: local storage