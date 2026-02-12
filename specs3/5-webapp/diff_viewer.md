# Diff Viewer

## Overview

Side-by-side diff editor for file changes. Lives outside the dialog, filling the background viewport. Supports inline editing with save, and LSP features.

## Layout

Background layer (`position: fixed; inset: 0`), sibling of the dialog. Empty state shows AC⚡DC watermark. File tab bar appears when files are loaded.

## Editor Features

- Side-by-side: original (read-only) left, modified (editable) right
- Auto language detection from extension
- Dark theme, minimap disabled, auto-layout on resize

### Worker-Safe Languages

Languages with built-in Monaco worker services (JS, TS, JSON, CSS, HTML) are created as `plaintext` to avoid `$loadForeignModule` crashes under Vite dev server. Backend LSP providers cover the important features.

## File Tabs

Tab bar with: file path, status badge (NEW/MOD), save button (💾) when dirty.

## Saving

### Ctrl+S
Compare editor content against saved, update, dispatch event. Parent routes to Repo or Settings save.

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
| Edit applied | HEAD vs working copy diff |
| Search result | Read-only, scroll to line |
| File picker | Read-only |
| Config edit | Config content with special path prefix |

### Post-Edit Refresh

Only reloads already-open files. Re-fetch HEAD and working copy, update models in place, clear dirty state, maintain active tab.