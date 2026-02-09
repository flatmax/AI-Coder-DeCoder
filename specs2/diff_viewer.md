# Diff Viewer

## Overview

A side-by-side diff editor for displaying file changes (original vs modified), supporting inline editing with save, and integrating with LSP features for navigation and completions.

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
