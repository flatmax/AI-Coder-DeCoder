# File Picker

## Overview

A tree view of repository files with checkboxes for selection, git status indicators, and a context menu for git operations. Appears as the left panel of the Files tab.

## Tree Rendering

### Node Types

**Directories**: Expandable toggle (▸/▾). Checkbox selects/deselects all contained files. Shows indeterminate state when partially selected.

**Files**: Checkbox for selection. Name click opens in diff viewer. Shows:
- Line count with color coding (green < 130, orange 130–170, red > 170)
- Git status badge (M=modified, S=staged, U=untracked)
- Diff stats (+N -N) for modified/staged files

### Filtering

A text filter narrows visible nodes. Directories auto-expand when filtered. Matching checks path substring.

### Keyboard Navigation

- Arrow keys move focus through visible files
- Space/Enter toggles selection on focused file
- Focused file auto-scrolls into view

## Git Status Indicators

| State | Name Color | Badge |
|-------|-----------|-------|
| Clean | Grey | — |
| Modified | Amber | M |
| Staged | Green | S |
| Untracked | Green | U |

## Context Menu

Right-click opens a context menu with git operations.

### File Menu Items

| Condition | Item | Operation |
|-----------|------|-----------|
| Modified/untracked | Stage file | stage |
| Staged | Unstage file | unstage |
| Modified | Discard changes | discard (confirm) |
| Always | Rename/Move | rename (prompt) |
| Always | Delete file | delete (confirm) |

### Directory Menu Items

| Condition | Item | Operation |
|-----------|------|-----------|
| Has unstaged | Stage all in dir | stage-dir |
| Has staged | Unstage all | unstage |
| Always | Rename/Move | rename-dir (prompt) |
| Always | New file | create-file (prompt) |
| Always | New directory | create-dir (prompt) |

### Operation Flow

1. Close menu
2. Dangerous ops: show confirmation
3. Input-requiring ops: show prompt
4. Dispatch git-operation event with {operation, paths}
5. Handler calls appropriate Repo RPC method
6. Refresh file tree on success
7. Show error in chat on failure

## Auto-Selection

On first load, automatically select modified, staged, and untracked files. Auto-expand directories containing changed files.

## State Persistence

- **Expanded directories**: tracked and propagated via events
- **Panel width**: persisted to local storage (default ~280px)
- **Panel collapsed**: persisted to local storage

## Data Flow

1. On startup: load file tree from Repo via RPC
2. Tree populates with files, modified/staged/untracked arrays, diff stats
3. Selection changes fire events, captured by parent to update selected files
4. File tree refresh compares JSON against previous to avoid unnecessary re-renders; status arrays always update
