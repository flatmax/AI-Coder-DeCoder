# Diff Viewer

## Overview

A side-by-side diff editor for displaying file changes (original vs modified), supporting inline editing with save, and integrating with LSP features for navigation and completions.

## Layout

The diff viewer lives **outside the dialog**, occupying the background space of the full browser window. When files are open, it fills the area not covered by the dialog — typically the right half of the screen. When no files are open, the empty state displays the **AC⚡DC** brand watermark — a large, semi-transparent text mark positioned at 75% from the left edge and vertically centered.

```
┌─────────────────────────────────────────────────────────┐
│ Browser viewport                                         │
│                                                          │
│ ┌── Dialog (left) ──┐ ┌── Diff Viewer (right) ────────┐ │
│ │ [file picker]      │ │                               │ │
│ │ [chat / tabs]      │ │  [tab bar with open files]    │ │
│ │                    │ │  [original]  │  [modified]    │ │
│ │                    │ │              │                │ │
│ │                    │ │              │                │ │
│ │ [input area]       │ │                               │ │
│ └────────────────────┘ └───────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Placement

- The diff viewer is a **sibling of the dialog** in the app shell, not a child of the dialog or files tab
- It fills the full viewport behind the dialog (`position: fixed; inset: 0`)
- The dialog floats on top; users resize/move the dialog to reveal more of the diff viewer
- When no files are open, the background is empty (dark)

### Interaction with Dialog

- Clicking a file name in the file picker opens it in the diff viewer (background)
- Clicking an edit result file path in chat opens it in the diff viewer
- Search result navigation opens files in the diff viewer
- The dialog stays visible and interactive at all times — no mode switching
- Users drag the dialog's right edge to give more or less space to the diff viewer

### Visibility

- The diff viewer is always present but shows an empty state when no files are open
- The empty state displays the "AC⚡DC" brand watermark (8rem, 18% opacity, positioned at 75% horizontal / 50% vertical) as a subtle background identity mark
- File tab bar and editor are visible whenever files are loaded
- No "back to chat" toggle needed — both are always accessible

## Editor Features

### Diff Display
- Side-by-side view: original (read-only) on left, modified (editable) on right
- Automatic language detection from file extension
- Dark theme
- Minimap disabled
- Automatic layout on resize

### Language Detection

Map of common extensions to language identifiers:
- Script languages: javascript, typescript, python
- Data formats: json, yaml, html, css, markdown
- Shell scripts, C/C++, etc.
- Fallback: plaintext

## File Tabs

When multiple files are loaded, a tab bar shows:
- File path and status badge (NEW or MOD)
- Click to switch diff view
- Save button (💾) enabled when any file is dirty

## Saving

### Single File Save (Ctrl+S)

1. Compare editor content against `savedContent`
2. Update saved content, clear dirty state
3. Dispatch event: `{path, content, isConfig?, configType?}`
4. Parent routes to Repo write or Settings save

### Batch Save

Iterates all dirty files, updates each, dispatches batch event.

### Dirty Tracking

- Per-file: track `savedContent` vs current editor content
- Global set of dirty file paths
- `isDirty` true when any file has unsaved changes
- State change events dispatched to parent

## LSP Integration

LSP providers registered when both editor and RPC connection are ready.

| Feature | Trigger | RPC Method |
|---------|---------|------------|
| Hover | Mouse hover | `LLM.lsp_get_hover` |
| Definition | Ctrl+Click / F12 | `LLM.lsp_get_definition` |
| References | Context menu | `LLM.lsp_get_references` |
| Completions | Typing / Ctrl+Space | `LLM.lsp_get_completions` |

### Cross-File Navigation

1. Go-to-definition returns `{file, range}`
2. If file already open: navigate directly
3. If not: dispatch event to load file from parent
4. Scroll to target line with temporary highlight

## Event Flow

File navigation events originate from multiple sources and are routed through the app shell to the diff viewer:

| Source | Event | Route |
|--------|-------|-------|
| File picker (name click) | `file-clicked` → `navigate-file` | files-tab → app-shell → diff-viewer |
| Chat edit result (path click) | `navigate-file` | chat-panel → app-shell → diff-viewer |
| Search result (match click) | `search-navigate` → `navigate-file` | search-tab → ac-dialog → app-shell → diff-viewer |
| Edit applied (post-stream) | Direct call | files-tab → app-shell → diff-viewer |
| Config edit | Direct call | settings-tab → app-shell → diff-viewer |

The app shell owns the diff viewer instance and exposes methods for child components to open files in it.

## File Loading Sources

| Source | Mode |
|--------|------|
| Edit applied | Replace all files with edit results |
| Search result | Read-only file, scroll to line |
| File picker view | Read-only file |
| Navigate to edit | HEAD vs working copy diff (or read-only) |
| LSP navigation | Add or replace file, scroll to position |
| Config edit | Config content with special path prefix |

### HEAD vs Working Copy

For applied edits:
1. Fetch committed version (HEAD)
2. Fetch working copy
3. If different: show as editable diff
4. If identical: fall back to read-only view

### Post-Edit Refresh

When edits are applied to files currently open:
1. Re-fetch HEAD and working copy for each
2. Update editor models in place (preserves editor state)

## File Object Schema

```pseudo
DiffFile:
    path: string           // Display path
    original: string       // Left-side content
    modified: string       // Right-side content (editable)
    is_new: boolean
    is_read_only: boolean?
    is_config: boolean?    // Config file for special save
    config_type: string?   // Config type key
    real_path: string?     // Actual path for config files
```