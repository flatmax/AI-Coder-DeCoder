# Diff Viewer

## Overview

Side-by-side diff editor for text file changes. Lives outside the dialog, filling the background viewport. Supports inline editing with save, and LSP features.

For `.svg` files, see [SVG Viewer](svg_viewer.md) — a dedicated side-by-side viewer with synchronized pan/zoom that replaces the Monaco editor for SVG content.

## Layout

Background layer (`position: fixed; inset: 0`), sibling of the dialog. Empty state shows AC⚡DC watermark.

### Status LED

Instead of a tab bar, a single floating status LED indicator appears in the top-right corner when a file is open:

| LED State | Color | Behavior |
|-----------|-------|----------|
| Clean | Green (steady glow) | File matches saved content |
| Dirty | Orange (pulsing) | Unsaved changes — click to save |
| New file | Cyan (steady glow) | File doesn't exist in HEAD |

The LED replaces a traditional tab bar — multiple files are tracked internally but switching between them is keyboard-only (Ctrl+PageUp/PageDown, Ctrl+W to close). The LED tooltip shows the current file path and save hint when dirty.

## Editor Features

- Side-by-side: original (read-only) left, modified (editable) right
- Auto language detection from extension
- Dark theme, minimap disabled, auto-layout on resize

### Language Detection

Map of common extensions to language identifiers: `.js`→javascript, `.ts`→typescript, `.py`→python, `.json`→json, `.yaml`/`.yml`→yaml, `.html`→html, `.css`→css, `.md`→markdown, `.c`/`.h`→c, `.cpp`/`.hpp`→cpp, `.sh`/`.bash`→shell. Fallback: plaintext.

### Worker-Safe Languages

Monaco spawns dedicated web workers for certain languages (JS, TS, JSON, CSS, SCSS, LESS, HTML) to provide built-in language services. Under the Vite dev server, these workers fail with `$loadForeignModule` errors because the worker module paths don't resolve correctly.

**Solution:** The `MonacoEnvironment.getWorker` function returns the real editor worker (needed for diff computation) but creates **no-op workers** for all language service requests. A no-op worker is a blob URL containing `self.onmessage = function() {}` — it accepts messages silently without crashing. Backend LSP providers cover the features these workers would have provided (hover, completions, definitions).

### Monaco Shadow DOM Integration

Monaco must render inside a Lit shadow DOM. On editor creation:
1. `_injectMonacoStyles()` clones all existing `<style>` and `<link>` nodes from `document.head` into the shadow root, marking each clone with `data-monaco-injected="true"`
2. A `MutationObserver` on `document.head` watches for `childList` changes:
   - **Added nodes**: `<style>` or `<link>` elements are cloned and appended to the shadow root
   - **Removed nodes**: The corresponding clone is found by matching `textContent` and removed
3. Style injection runs once per component lifetime (guarded by `_monacoStylesInjected` flag)
4. The observer is disconnected when the component is removed from the DOM

## File Management

Multiple files can be open simultaneously, tracked internally as an ordered list. There is no visible tab bar — navigation between open files uses keyboard shortcuts only (Ctrl+PageDown, Ctrl+PageUp, Ctrl+W). The status LED in the top-right reflects the active file's state.

## Saving

### Single File Save (Ctrl+S)

1. Compare editor content against `savedContent`
2. Update saved content, clear dirty state
3. Dispatch event: `{path, content, isConfig?, configType?}`
4. Parent routes to Repo write or Settings save

### Batch Save

Iterates all dirty files, updates each, dispatches batch event.

### Dirty Tracking
Per-file `savedContent` vs current. Global dirty set. State change events to parent.

## LSP Integration

Registered when editor and RPC are both ready:

| Feature | Trigger | RPC |
|---------|---------|-----|
| Hover | Mouse hover | `LLM.lsp_get_hover` |
| Definition | Ctrl+Click/F12 | `LLM.lsp_get_definition` |
| References | Context menu | `LLM.lsp_get_references` |
| Completions | Typing/Ctrl+Space | `LLM.lsp_get_completions` |

Cross-file definition: returns `{file, range}`, loads file if needed, scrolls to target.

## Event Routing

| Source | Event Path |
|--------|------------|
| File picker click | `file-clicked` → `navigate-file` → diff-viewer |
| Chat edit result (goto icon) | `navigate-file` with `searchText` → scroll to edit |
| Search match | `search-navigate` → `navigate-file` with `line` |
| Post-edit refresh | Direct call from app-shell |

### Scroll to Edit Anchor

When clicking an edit block's goto icon (↗): open file, search for progressively shorter prefixes of the edit text, scroll to and highlight match (3-second highlight).

## File Loading

| Source | Mode |
|--------|------|
| Edit applied | HEAD vs working copy diff (editable) |
| Search result | Editable, scroll to line |
| File picker | Editable |
| LSP navigation | Add or replace file, scroll to position |
| Config edit | Config content with special path prefix |
| Virtual content | Read-only, `virtual://` path prefix (e.g., URL content viewing) |

### Virtual Files

Files with a `virtual://` prefix are not fetched from the repository. Their content is passed directly via the `virtualContent` option and stored in an in-memory map (`_virtualContents`). Virtual files are always read-only with an empty original side. This is used for displaying fetched URL content in the diff viewer without creating actual files. On `closeFile`, the virtual content entry is removed from the map.

### HEAD vs Working Copy

Fetch committed version (HEAD) and working copy. Original (left) is always read-only. Modified (right) is always editable — the user can make changes and save with Ctrl+S regardless of whether the file has uncommitted changes.

Each RPC call (`get_file_content` with and without `'HEAD'`) is wrapped in its own try/catch. A failure in one (e.g., file doesn't exist in HEAD for new files) doesn't prevent the other from loading. The response is normalized to a string regardless of whether the RPC returns a string or `{content: string}` object.

### File Content Response Normalization

The diff viewer normalizes responses from `Repo.get_file_content` which may return either a plain string or an object with a `content` field. The normalization pattern `headResult?.content ?? headResult ?? ''` handles both formats. This is important because different RPC transports and error paths may return different shapes.

### Model Lifecycle

When switching between open files, the editor disposes old models before creating new ones. This explicit disposal prevents memory leaks that break Monaco's diff computation. The sequence is: read old model from editor → dispose original and modified models → create new models with correct language → set on editor.

### Editor Reuse

A single `DiffEditor` instance is created and reused for all files. Switching files replaces the models on the existing editor rather than destroying and recreating the editor. The editor is only disposed when the last file is closed (`_disposeEditor`). This avoids the cost of re-creating the Monaco editor on every tab switch.

The `_showEditor` method handles both cases:
- **Editor exists**: dispose old models, create new models with correct language, set on editor, update read-only state
- **No editor**: create new `DiffEditor` with configuration, create models, attach `onDidChangeModelContent` listener for dirty tracking

### Post-Edit Refresh

Only reloads already-open files. Re-fetch HEAD and working copy, update models in place, clear dirty state, maintain active tab.

## File Object Schema

```pseudo
DiffFile:
    path: string
    original: string
    modified: string
    is_new: boolean
    is_read_only: boolean?
    is_config: boolean?
    config_type: string?
    real_path: string?
```