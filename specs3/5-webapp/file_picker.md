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

On first load, auto-select modified/staged/untracked files. Auto-expand containing directories.

## Middle-Click Path Insertion

Middle-click on any row inserts the path into chat input at cursor position (space-padded). Default paste/autoscroll suppressed.

## Active File Highlight

Row highlighted when file is open in diff viewer. `.active-in-viewer` class with accent border.

## State Persistence

- Panel width: local storage (default ~280px)
- Panel collapsed: local storage