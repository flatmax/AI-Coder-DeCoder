# Diff Viewer

## Overview

A Monaco-based side-by-side diff editor embedded in the main application. It displays file diffs (original vs modified), supports inline editing with save, and integrates with LSP features for navigation, hover, and completions.

## Architecture

| Component | File | Role |
|-----------|------|------|
| `DiffViewer` | `webapp/src/diff-viewer/DiffViewer.js` | Main web component, lifecycle, events |
| `DiffEditorMixin` | `webapp/src/diff-viewer/DiffEditorMixin.js` | Editor creation, model management, save |
| `DiffViewerTemplate` | `webapp/src/diff-viewer/DiffViewerTemplate.js` | Lit template rendering |
| `DiffViewerStyles` | `webapp/src/diff-viewer/DiffViewerStyles.js` | CSS styles |
| `MonacoLoaderMixin` | `webapp/src/diff-viewer/MonacoLoaderMixin.js` | Lazy-loads Monaco from CDN/local |
| `SymbolProvider` | `webapp/src/lsp/SymbolProvider.js` | LSP hover, definition, references, completions |

`DiffViewer` extends a mixin chain: `DiffEditorMixin(MonacoLoaderMixin(JRPCClient))`. It has its own JRPC connection for LSP requests.

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `files` | `Array` | List of file objects to display |
| `selectedFile` | `String` | Currently active file path |
| `visible` | `Boolean` | Whether the viewer is shown |
| `isDirty` | `Boolean` | Whether any file has unsaved edits |
| `serverURI` | `String` | WebSocket URI for RPC connection |
| `viewingFile` | `String` | File being viewed (from file picker) |

### File Object Schema

```json
{
  "path": "src/app.py",
  "original": "original file content",
  "modified": "modified file content",
  "isNew": false,
  "isReadOnly": false,
  "isConfig": false,
  "configType": "litellm",
  "realPath": "/home/user/.config/ac/litellm.json"
}
```

| Field | Type | Presence | Description |
|-------|------|----------|-------------|
| `path` | string | always | Display path / identifier |
| `original` | string | always | Left-side content |
| `modified` | string | always | Right-side content (editable) |
| `isNew` | boolean | always | Whether the file is newly created |
| `isReadOnly` | boolean | optional | Prevent editing the modified side |
| `isConfig` | boolean | optional | Marks config files for special save handling |
| `configType` | string | optional | Config type key (e.g. `"litellm"`) |
| `realPath` | string | optional | Actual filesystem path for config files |

## Editor Features

### Monaco Diff Editor

- Side-by-side diff view (original read-only, modified editable)
- Automatic language detection from file extension
- Dark theme (`vs-dark`)
- Automatic layout on resize
- Minimap disabled

### Language Detection

Extension mapping:

| Extensions | Language |
|-----------|----------|
| `.js`, `.mjs`, `.jsx` | javascript |
| `.ts`, `.tsx` | typescript |
| `.py` | python |
| `.json` | json |
| `.html` | html |
| `.css` | css |
| `.md` | markdown |
| `.yaml`, `.yml` | yaml |
| `.sh` | shell |
| other | plaintext |

## File Tabs

When multiple files are loaded, a tab bar appears at the top:
- Each tab shows the file path and a status badge (`NEW` or `MOD`)
- Clicking a tab switches the diff view to that file
- A save button (💾) appears on the right, enabled when any file is dirty

## Saving

### Single File Save (Ctrl+S)

1. Compares current editor content against `savedContent`
2. Updates `savedContent` and clears dirty state for the file
3. Dispatches `file-save` event with `{ path, content, isConfig?, configType? }`
4. `AppShell` routes to `Repo.write_file` or `Settings.save_config_content`

### Save All Files

1. Iterates all dirty files
2. Updates saved content and clears dirty state
3. Dispatches `files-save` event with `{ files: [{ path, content, ... }] }`
4. `AppShell` saves each file via RPC

### Dirty Tracking

- Each file model tracks `savedContent` (the content at last save or load)
- A `Set<string>` of dirty file paths is maintained
- `isDirty` is true when any file has unsaved changes
- `isDirty-changed` event is dispatched on state change

## LSP Integration

LSP providers are registered once both the editor and RPC connection are ready.

| Feature | Trigger | RPC Method |
|---------|---------|------------|
| Hover | Mouse hover over symbol | `LiteLLM.lsp_get_hover` |
| Go to Definition | Ctrl+Click or F12 | `LiteLLM.lsp_get_definition` |
| References | Context menu | `LiteLLM.lsp_get_references` |
| Completions | Typing / Ctrl+Space | `LiteLLM.lsp_get_completions` |

### Go to Definition Navigation

1. User Ctrl+clicks or presses F12 on a symbol
2. RPC call returns `{ file, range }` with target location
3. If the target file is already open in the diff viewer, navigate directly
4. Otherwise, dispatch `request-file-load` event for `AppShell` to load it
5. Editor scrolls to target line and highlights it (1.5s fade-out)

### Cross-File Navigation

When navigating to a file not currently loaded:
1. `DiffViewer` dispatches `lsp-navigate-to-file` (window-level event)
2. `DiffViewer` catches it, checks if file is loaded
3. If not, dispatches `request-file-load` to `AppShell`
4. `AppShell` fetches file content and loads it as a read-only diff
5. After load, the viewer reveals the target position

## File Loading (via AppShell)

`AppShell` orchestrates how files get into the diff viewer:

| Source | Method | Mode |
|--------|--------|------|
| Edit applied | `handleEditsApplied` | Replaces all files with edit results |
| Search result | `handleSearchResultSelected` | Replaces with read-only file, scrolls to line |
| File picker view | `handleSearchFileSelected` | Replaces with read-only file |
| Navigate to edit | `handleNavigateToEdit` | Loads HEAD vs working copy diff, or read-only |
| LSP navigation | `handleRequestFileLoad` | Adds or replaces file, scrolls to position |
| Config edit | `handleConfigEditRequest` | Loads config content with special `[config]/` path prefix |

### HEAD vs Working Copy Diffs

For applied edits (`handleNavigateToEdit`):
1. Fetch committed version via `Repo.get_file_content(path, 'HEAD')`
2. Fetch working copy via `Repo.get_file_content(path)`
3. If they differ, show as editable diff
4. If identical (already committed), fall back to read-only view

### Post-Edit Refresh

When `files-edited` event fires (after edits are applied):
1. Check which edited files are currently open in the diff viewer
2. Re-fetch both HEAD and working copy for each
3. Update models in place via `refreshFileContent` (preserves editor state)

## Content Search

`_findLineByContent(searchText)` searches the modified editor's content line-by-line for a match. Used when navigating to edit blocks where only the context text is known rather than an exact line number.

## Events

### Dispatched by DiffViewer

| Event | Detail | Description |
|-------|--------|-------------|
| `file-save` | `{ path, content, isConfig?, configType? }` | Single file save |
| `files-save` | `{ files: [...] }` | Batch file save |
| `file-selected` | `{ path }` | Tab selection changed |
| `request-file-load` | `{ file, line?, column?, replace? }` | Request AppShell to load a file |
| `isDirty-changed` | `{ isDirty }` | Dirty state changed |

### Consumed by DiffViewer (via AppShell)

| Property/Event | Description |
|----------------|-------------|
| `.files` | Array of file objects set by AppShell |
| `.visible` | Visibility toggle |
| `.viewingFile` | Currently viewed file from file picker |
