# File Picker

## Overview

A tree view of repository files with checkboxes for selection, git status indicators, and a context menu for git operations. Appears as the left panel of the Files tab.

## Tree Rendering

### Node Types

**Directories**: Expandable toggle (▸/▾). Clicking the directory name also toggles expand/collapse. Checkbox selects/deselects all contained files. Shows indeterminate state when partially selected.

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

## File Mention Selection

Files mentioned in assistant responses can be added to the selection via `file-mention-click` events (see [Chat Interface](chat_interface.md#file-mentions)). When a file mention is clicked:
1. The file is added to the selected files set
2. The file picker updates its checkbox state
3. The parent directory is auto-expanded if collapsed
4. The chat input text is updated with an accumulated file list prompt (see [Chat Interface — Input Text Accumulation](chat_interface.md#input-text-accumulation))

## Middle-Click Path Insertion

Middle-clicking (mouse button 1) on any file or directory row inserts its repository-relative path into the chat input textarea at the current cursor position. The default middle-click clipboard paste and autoscroll behaviors are suppressed.

- **Files**: inserts the full path including filename (e.g., `src/utils/helpers.js`)
- **Directories**: inserts the directory path (e.g., `src/utils`)
- Always prepends and appends a space around the inserted path
- Cursor is placed after the trailing space
- Textarea auto-resizes and receives focus
- Does **not** trigger clipboard paste — only inserts the path

This allows users to quickly reference paths in their messages to the LLM without manually typing them. Multiple middle-clicks accumulate space-separated paths.

### Event Flow

1. User middle-clicks a file or directory row in the tree
2. File picker suppresses the default auxclick/paste behavior
3. File picker dispatches `path-to-input` event with `{ path }`
4. Files tab receives event and inserts ` path ` (space-padded) into chat input textarea at cursor position

## Active File Highlight

When a file is open in the diff viewer, its row in the file picker is visually highlighted with a distinct background and left border accent. This gives the user a clear indication of which file they're currently viewing/editing.

- The diff viewer dispatches `active-file-changed` with `{ path }` whenever the active tab changes (tab switch, file open, tab close)
- The app shell relays this to the dialog, which passes it to the files tab and down to the file picker
- The file picker applies an `.active-in-viewer` class to the matching row
- The highlight is independent of selection (checkbox) state

## State Persistence

- **Expanded directories**: tracked and propagated via events
- **Panel width**: persisted to local storage (default ~280px)
- **Panel collapsed**: persisted to local storage

## Data Flow

1. On startup: load file tree from Repo via RPC
2. Tree populates with files, modified/staged/untracked arrays, diff stats
3. Selection changes fire events, captured by parent to update selected files
4. File tree refresh compares JSON against previous to avoid unnecessary re-renders; status arrays always update