# Diff Viewer

## Overview

Side-by-side diff editor for file changes. Lives outside the dialog, filling the background viewport. Supports inline editing with save, and LSP features.

## Layout

Background layer (`position: fixed; inset: 0`), sibling of the dialog. Empty state shows AC⚡DC watermark. File tab bar appears when files are loaded.

## Editor Features

- Side-by-side: original (read-only) left, modified (editable) right
- Auto language detection from extension
- Dark theme, minimap disabled, auto-layout on resize

### Language Detection

Map of common extensions to language identifiers: `.js`→javascript, `.ts`→typescript, `.py`→python, `.json`→json, `.yaml`/`.yml`→yaml, `.html`→html, `.css`→css, `.md`→markdown, `.c`/`.h`→c, `.cpp`/`.hpp`→cpp, `.sh`/`.bash`→shell. Fallback: plaintext.

### Worker-Safe Languages

Languages with built-in Monaco worker services (JS, TS, JSON, CSS, SCSS, LESS, HTML) are created as `plaintext` to avoid `$loadForeignModule` crashes under Vite dev server. Backend LSP providers cover the important features.

### Monaco Shadow DOM Integration

Monaco must render inside a Lit shadow DOM. On editor creation:
1. `_injectMonacoStyles()` clones Monaco's stylesheet nodes into the shadow root
2. `_syncAllStyles()` keeps styles synchronized via a `MutationObserver` on `document.head`
3. The observer watches for added/removed `<style>` and `<link>` nodes and mirrors changes
4. Styles are cleaned up when the editor is disposed

## File Tabs

Tab bar with: file path, status badge (NEW/MOD), save button (💾) when dirty.

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
| Chat edit result | `navigate-file` with `searchText` → scroll to edit |
| Search match | `search-navigate` → `navigate-file` with `line` |
| Post-edit refresh | Direct call from app-shell |

### Scroll to Edit Anchor

When clicking an edit block's file path: open file, search for progressively shorter prefixes of the edit text, scroll to and highlight match (3-second highlight).

## File Loading

| Source | Mode |
|--------|------|
| Edit applied | HEAD vs working copy diff (editable) |
| Search result | Read-only, scroll to line |
| File picker | Read-only |
| LSP navigation | Add or replace file, scroll to position |
| Config edit | Config content with special path prefix |

### HEAD vs Working Copy

For applied edits: fetch committed version (HEAD) and working copy. If different: show as editable diff. If identical: fall back to read-only view.

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