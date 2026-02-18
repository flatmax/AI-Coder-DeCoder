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

Monaco spawns dedicated web workers for certain languages (JS, TS, JSON, CSS, SCSS, LESS, HTML) to provide built-in language services. These workers may fail in certain build configurations. The `MonacoEnvironment.getWorker` function returns the real editor worker (needed for diff computation) but creates **no-op workers** for all language service requests. Backend LSP providers cover the features these workers would have provided (hover, completions, definitions).

### Monaco Shadow DOM Integration

Monaco must render inside a Lit shadow DOM. The component clones all `<style>` and `<link>` nodes from `document.head` into its shadow root on editor creation, and watches for dynamically added/removed stylesheets via a `MutationObserver`. Style injection runs once per component lifetime. The observer is disconnected when the component is removed from the DOM.

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
| Hover | Mouse hover | `LLMService.lsp_get_hover` |
| Definition | Ctrl+Click/F12 | `LLMService.lsp_get_definition` |
| References | Context menu | `LLMService.lsp_get_references` |
| Completions | Typing/Ctrl+Space | `LLMService.lsp_get_completions` |

Line and column numbers are passed as **1-indexed** values (matching Monaco's convention and the backend's symbol storage). No conversion is needed at the RPC boundary.

Cross-file definition: returns `{file, range}`, loads file if needed, scrolls to target.

## Markdown Preview

For `.md` and `.markdown` files, a **Preview** button appears in the top-right corner (next to the status LED). Toggling it switches from the standard side-by-side diff layout to a split editor+preview layout.

### Split Layout

| Pane | Content |
|------|---------|
| Left | Monaco editor (inline diff mode, word wrap enabled) |
| Right | Live-rendered Markdown preview |

When preview mode is active, the Monaco diff editor switches to **inline mode** (not side-by-side) so the editor fits in half the viewport. Word wrap is enabled for comfortable editing. The preview pane renders the modified editor's content using `renderMarkdownWithSourceMap()` from `webapp/src/utils/markdown.js`.

### Dual Marked Instances

The markdown utility module maintains two completely independent `Marked` instances:

| Instance | Export | Purpose | Custom Renderers |
|----------|--------|---------|-----------------|
| `markedChat` | `renderMarkdown()` | Chat message rendering | `code()` only — language label, copy button, syntax highlighting |
| `markedSourceMap` | `renderMarkdownWithSourceMap()` | Diff viewer preview | `code()` and `hr()` — with `data-source-line` attributes for scroll sync |

The two instances share no renderer state. This separation prevents preview-specific logic (source-line injection, walkTokens hooks) from affecting chat rendering, and keeps the chat renderer simple by using marked's defaults for all non-code block elements.

### Source-Line Attribute Injection

`renderMarkdownWithSourceMap()` injects `data-source-line` attributes into the HTML output for scroll synchronization. The approach uses a two-phase strategy:

**Phase 1 — Line map construction:** Before rendering, the raw markdown source is lexed to produce a `Map<tokenKey, lineNumber>`. Each token is keyed by `type:text_prefix` (e.g., `heading:Installation`, `paragraph:Some text`). The line number is determined by finding the token's `raw` text in the source and counting preceding newlines.

**Phase 2 — Attribute injection:** For `code` and `hr` blocks, the `markedSourceMap` renderer overrides inject `data-source-line` directly into the output HTML. For `heading`, `paragraph`, `blockquote`, `list`, and `table` elements, the renderer returns `false` (delegating to marked's defaults for correct inline token parsing, nested structure handling, etc.). A `walkTokens` hook collects source-line mappings for these elements into an ordered queue, and a `postprocess` hook injects `data-source-line` into the first matching opening tag that doesn't already have the attribute.

This design ensures that complex block elements (nested lists, task-list checkboxes, tables with alignment, blockquotes with nested content) render correctly using marked's own logic, while still carrying source-line metadata for scroll synchronization.

### Live Update

The preview updates on every keystroke — the editor's `onDidChangeModelContent` event triggers `_updatePreview()`, which re-renders the Markdown and triggers a Lit update.

### Bidirectional Scroll Sync

Editor and preview scroll positions are synchronized:

**Editor → Preview:** When the editor scrolls, the top visible line is computed from `scrollTop / lineHeight`. The preview pane's `data-source-line` anchors are scanned to find the element at or just before that line. Linear interpolation between adjacent anchors provides smooth sub-element scrolling.

**Preview → Editor:** When the preview pane scrolls, the reverse mapping finds which source line corresponds to the current scroll offset. The editor uses pixel-precise `setScrollTop((targetLine - 1) * lineHeight)` rather than `revealLine()` to avoid jumpy repositioning.

**Scroll lock:** A mutex mechanism prevents infinite feedback loops. When one side initiates a scroll, it sets `_scrollLock` to `'editor'` or `'preview'`. The other side's scroll handler checks the lock and skips if the other side owns it. The lock auto-releases after 120ms.

### Toggle Behavior

Toggling preview mode disposes and recreates the Monaco editor — switching between `renderSideBySide: true` (normal diff) and `renderSideBySide: false` (inline diff for preview). The editor container reference is updated after the Lit template re-renders, and the `ResizeObserver` is reattached.

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

### Editor Reuse

A single `DiffEditor` instance is created and reused for all files. Switching files disposes old models and creates new ones on the existing editor — this prevents memory leaks and avoids the cost of recreating the editor on every tab switch. The editor is only fully disposed when the last file is closed.

When switching files: dispose old original and modified models → create new models with correct language → set on editor → update read-only state. When no editor exists: create new `DiffEditor` with configuration, create models, attach content change listener for dirty tracking.

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