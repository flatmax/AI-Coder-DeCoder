# Diff Viewer

## Overview

Side-by-side diff editor for text file changes. Lives outside the dialog, filling the background viewport. Supports inline editing with save, and LSP features.

For `.svg` files, see [SVG Viewer](svg_viewer.md) — a dedicated side-by-side viewer with synchronized pan/zoom that replaces the Monaco editor for SVG content.

## Layout

Background layer (`position: fixed; inset: 0`), sibling of the dialog. Empty state shows AC⚡DC watermark.

### Floating Overlay Buttons

When a file is open, floating overlay buttons appear in the top-right corner:

- **Status LED** — a 10px circular indicator (see below)
- **Preview button** — for `.md`/`.markdown` files, toggles Markdown preview mode (see [Markdown Preview](#markdown-preview))
- **Visual button** — for `.svg` files, a "🎨 Visual" button that dispatches `toggle-svg-mode` to switch to the SVG viewer's visual editor. The SVG viewer has the reciprocal "`</>`" button — see [SVG Viewer — SVG ↔ Text Diff Mode Toggle](svg_viewer.md#svg--text-diff-mode-toggle)

### Status LED

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

Map of common extensions to language identifiers: `.js`→javascript, `.ts`→typescript, `.py`→python, `.json`→json, `.yaml`/`.yml`→yaml, `.html`→html, `.css`→css, `.md`→markdown, `.c`/`.h`→c, `.cpp`/`.hpp`→cpp, `.sh`/`.bash`→shell, `.m`→matlab, `.java`→java, `.rs`→rust, `.go`→go, `.rb`→ruby, `.php`→php, `.sql`→sql, `.toml`/`.ini`/`.cfg`→ini. Fallback: plaintext.

### MATLAB Syntax Highlighting

MATLAB (`.m`) files use a custom Monarch tokenizer registered at module load time (before any editor instance is created) via `monaco.languages.register({ id: 'matlab' })` and `monaco.languages.setMonarchTokensProvider('matlab', {...})`. Since Monaco has no built-in MATLAB language, this registration must happen eagerly. The tokenizer handles:

- **Keywords**: `break`, `case`, `catch`, `classdef`, `continue`, `else`, `elseif`, `end`, `for`, `function`, `if`, `methods`, `properties`, `return`, `switch`, `try`, `while`, `parfor`, `spmd`, etc.
- **Builtins**: `abs`, `zeros`, `ones`, `eye`, `disp`, `fprintf`, `plot`, `figure`, `size`, `length`, `find`, `sort`, `struct`, `cell`, etc. (approximately 80 entries)
- **Comments**: Line comments (`%...`) and block comments (`%{...%}`)
- **Strings**: Single-quoted (`'...'`) and double-quoted (`"..."`)
- **Numbers**: Integer, float, scientific notation, complex (`i`/`j` suffix)
- **Operators**: Arithmetic (`+`, `-`, `*`, `/`, `^`), element-wise (`.^`, `.*`, `./`), comparison (`==`, `~=`, `>=`), logical (`&`, `|`, `&&`, `||`)
- **Transpose**: The `'` operator after identifiers/brackets is tokenized as an operator (not a string delimiter)

The tokenizer is registered via `monaco.languages.register()` and `monaco.languages.setMonarchTokensProvider()` at module load time, before any editor is created.

### Worker-Safe Languages

Monaco spawns dedicated web workers for certain languages (JS, TS, JSON, CSS, SCSS, LESS, HTML) to provide built-in language services. These workers may fail in certain build configurations. The `MonacoEnvironment.getWorker` function returns the real editor worker (needed for diff computation) but creates **no-op workers** for all language service requests. Backend LSP providers cover the features these workers would have provided (hover, completions, definitions).

### Floating Panel Labels

Two floating labels appear over the diff panels when contextual information is available:

| Label | Position | Content |
|-------|----------|---------|
| Left | `right: calc(50% + 8px)` | Source label (e.g., custom label from `loadPanel`) |
| Right | `right: 120px` | Source label (e.g., custom label from `loadPanel`) |

Labels are semi-transparent with backdrop blur (`rgba(22, 27, 34, 0.78)`) and become more opaque on hover. In inline diff mode (preview), the left label is hidden. Labels are only shown for `loadPanel` comparisons — normal file diffs (same file, HEAD vs working) show no labels since the context is obvious from the file path.

### Monaco Shadow DOM Integration

Monaco must render inside a Lit shadow DOM. Style injection has two phases:

1. **Full re-sync** (`_syncAllStyles`): On every editor creation, all previously-cloned styles are removed and all current `<style>`/`<link>` nodes from `document.head` are re-cloned into the shadow root. This ensures Monaco's dynamically-added styles (created during editor construction) are captured. This runs every time `_showEditor` is called.

2. **Incremental observation** (`MutationObserver`): Set up once per component lifetime, watches `document.head` for dynamically added/removed stylesheets after initial editor creation. Added nodes are cloned in; removed nodes have their corresponding clones found and removed by matching `textContent`.

The re-sync approach (remove all + re-clone) prevents duplicate style accumulation when switching between files causes editor recreation. The observer is disconnected when the component is removed from the DOM.

## File Management

Multiple files can be open simultaneously, tracked internally as an ordered list. There is no visible tab bar — navigation between open files uses keyboard shortcuts only (Ctrl+PageDown, Ctrl+PageUp, Ctrl+W). The status LED in the top-right reflects the active file's state.

### Same-File Suppression

When `openFile` is called for a file that is already the active file, the editor is not rebuilt — `_showEditor()` is skipped entirely. This avoids recreating Monaco models (which resets scroll position and cancels internal Delayers). If the file is open but not active, the tab is switched and the viewport is restored from the per-file viewport state map.

### Adjacent Same-File Reuse

When `openFile` is called and an adjacent neighbor in the file navigation grid already references the target path, navigation reuses that neighbor rather than creating a new node. See [File Navigation — Adjacent Same-File Reuse](file_navigation.md#adjacent-same-file-reuse).

## Saving

### Single File Save (Ctrl+S)

1. Compare editor content against `savedContent`
2. Update saved content, clear dirty state
3. Dispatch event: `{path, content, isConfig?, configType?}`
4. Parent routes to Repo write or Settings save

### Batch Save (`saveAll`)

Public method that iterates all dirty files and saves each one. For each file, if it is the currently active file the content is read from the editor; otherwise the last-known `modified` content is used. Each file goes through the same save pipeline as single-file save (update `savedContent`, clear dirty state, dispatch event).

### Dirty Tracking
Per-file `savedContent` vs current. Global dirty set. State change events to parent.

## Load Panel (Ad-Hoc Comparison)

The `loadPanel(content, panel, label)` method loads arbitrary text content into the left or right panel of the diff viewer, enabling ad-hoc comparison of content from different sources (e.g., history messages, file content loaded via context menu).

**Behavior:**

- If no file is open, creates a virtual comparison file at `virtual://compare`
- If a `virtual://compare` file already exists, updates only the specified panel — the other side's content is preserved so both sides accumulate independently
- If a real file is open, updates the specified panel's Monaco model directly (creates a new model, sets it on the editor, disposes the old model)
- The `label` parameter sets a floating panel label (see [Floating Panel Labels](#floating-panel-labels)) — only `loadPanel` comparisons show labels; normal file diffs do not
- After loading, the file's dirty state is cleared (the loaded content becomes the new baseline)

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

### Cross-File Navigation via Code Editor Service

When the user Ctrl+clicks a symbol whose definition is in another file, Monaco's `ICodeEditorService.openCodeEditor` is called internally to open the target. The diff viewer patches this service method (once per component lifetime, guarded by `_editorServicePatched`) to intercept cross-file navigation:

1. Extract the target file path from `input.resource.path` (strip leading slashes)
2. Extract the target line from `input.options.selection.startLineNumber`
3. Call `this.openFile({ path, line })` to open the target in the tab system
4. Return the current editor instance to satisfy Monaco's API contract

This enables seamless Go-to-Definition across files without Monaco trying to create a new standalone editor instance.

### Markdown Link Navigation

For `.md` files, markdown links (`[text](relative-path)`) are Ctrl+clickable in the Monaco editor. This is implemented via:

1. **LinkProvider** — registered for the `markdown` language, matches `[text](relative-path)` patterns (skipping absolute URLs and `#` anchors) and maps them to a custom `ac-navigate:///` URI scheme
2. **LinkOpener** — intercepts `ac-navigate:` URIs and dispatches a `navigate-markdown-link` event
3. **Event handler** — resolves the relative path against the current file's directory and dispatches `navigate-file` to open the target

The preview pane also intercepts clicks on `<a>` elements with relative `href` attributes, resolving them the same way. Absolute URLs (`http://`, `https://`, `mailto:`) are left to the browser's default handling.

## Markdown Preview

For `.md` and `.markdown` files, a **Preview** button appears in the top-right corner (next to the status LED). Toggling it switches from the standard side-by-side diff layout to a split editor+preview layout. In preview mode, the Preview button moves to the top-right of the **preview pane** (right panel) so the user can exit preview from the same panel they're reading. The button uses `position: sticky` to remain visible while scrolling.

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

The two instances share no renderer state. This separation prevents preview-specific logic (source-line injection, walkTokens hooks) from affecting chat rendering, and keeps the chat renderer simple by using marked's defaults for all non-code block elements. Both instances register a shared KaTeX math extension for `$$...$$` (display) and `$...$` (inline) math rendering.

Both instances share a common pre-processing step: `_encodeImagePaths()` encodes spaces in image paths as `%20` before passing text to `marked`, since `marked` cannot parse `![alt](path with spaces)`.

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

**Editor scroll listener management:** The editor scroll listener (`onDidScrollChange`) is attached only to the **modified editor** (not both editors) to avoid double-firing scroll events in inline diff mode. The listener disposable (`_editorScrollDisposable`) is tracked and explicitly disposed before creating a new one on each `_showEditor` call, and also in `_disposeEditor`. The listener is only created when preview mode is active.

### Relative Path Resolution

A `_resolveRelativePath(relativePath)` helper resolves a relative path against the current file's directory. It splits the current file's path at the last `/` to get the directory, joins the relative path, and normalizes the result via `_normalizePath()` (which resolves `.` and `..` segments by walking the path parts array). This helper is used by:

- **Markdown link navigation** — both the Monaco LinkProvider (`navigate-markdown-link` event) and the preview pane click handler resolve link targets this way
- **Preview image resolution** — relative image `src` attributes are resolved before RPC fetch

### Image Rendering

Markdown images with relative `src` paths are resolved against the current file's directory and fetched from the repository via RPC. After each preview render, `_resolvePreviewImages()` post-processes `<img>` tags:

- **Skip** `data:`, `blob:`, `http://`, `https://` URLs — these pass through unchanged
- **Decode** percent-encoded characters in `src` attributes (e.g. `%20` → space) back to real filesystem characters before building the repo path. This is necessary because `_encodeImagePaths()` in the markdown utility encodes spaces for `marked` compatibility
- **Resolve** relative paths (including `../` and `./`) against the markdown file's directory using `_normalizePath()`
- **SVG files** are fetched as text via `Repo.get_file_content` and injected as `data:image/svg+xml;charset=utf-8,` URIs with URL-encoded content
- **Binary images** (PNG, JPG, GIF, WebP, BMP, ICO) are fetched via `Repo.get_file_base64` which returns a ready-to-use `data:{mime};base64,{content}` URI
- **Failed loads** degrade gracefully — the `alt` text is updated to show the error and the image is dimmed (`opacity: 0.4`)

Images are styled with `max-width: 100%` to fit within the preview pane.

#### Space Encoding in Image Paths

The `marked` markdown library does not parse `![alt](path with spaces)` — unencoded spaces break the link parser. The markdown utility pre-processes text through `_encodeImagePaths()` which replaces spaces with `%20` in image URL portions before `marked` processes the markdown. This function is applied in both `renderMarkdown()` (chat) and `renderMarkdownWithSourceMap()` (diff viewer preview). Already-encoded URLs and absolute `http(s)://` URLs are left unchanged.

### Toggle Behavior

Toggling preview mode disposes and recreates the Monaco editor — switching between `renderSideBySide: true` (normal diff) and `renderSideBySide: false` (inline diff for preview). After disposal, the component waits for `updateComplete` (Lit re-render), then updates the editor container reference (`_editorContainer`) from the new DOM structure (`.editor-pane` in preview mode, `.editor-container` in normal mode). The `ResizeObserver` is disconnected and reattached to the new container. Finally `_showEditor()` rebuilds the editor in the new layout.

## Event Routing

| Source | Event Path |
|--------|------------|
| File picker click | `file-clicked` → `navigate-file` → diff-viewer |
| Chat edit result (goto icon) | `navigate-file` with `searchText` → scroll to edit |
| Search match | `search-navigate` → `navigate-file` with `line` |
| Post-edit refresh | Direct call from app-shell |

### Scroll to Edit Anchor

When clicking an edit block's goto icon (↗): open file, search for progressively shorter prefixes of the edit text, scroll to and highlight match (3-second highlight).

### Diff Computation Readiness

Monaco's diff editor computes diffs asynchronously after models are set. Any scroll positioning (viewport restore, search-text scroll, line scroll) must wait for the diff computation to finish — scrolling before the diff result arrives is overwritten by Monaco's layout pass. The viewer provides a `_waitForDiffReady()` helper that:

1. Registers a one-shot `onDidUpdateDiff` listener on the diff editor
2. Resolves the returned Promise when the listener fires (with an extra `requestAnimationFrame` for layout settlement)
3. Has a 2-second safety timeout — if the diff computation never fires (e.g., identical content), the Promise resolves anyway

This is used by `openFile` (after initial content load), `_restorePerFileViewport`, and search-text scrolling.

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

Files with a `virtual://` prefix are not fetched from the repository. Their content is passed directly via the `virtualContent` option and stored in an in-memory map (`_virtualContents`). Virtual files are always read-only with an empty original side. On `closeFile`, the virtual content entry is removed from the map.

Virtual files are used in two ways:
- **URL content viewing** — fetched URL content displayed without creating actual files
- **Ad-hoc comparison** — `loadPanel()` creates `virtual://compare` entries for comparing arbitrary content. When loading into a panel of an existing `virtual://compare` file, the other side's content is preserved so both sides accumulate independently

### HEAD vs Working Copy

Fetch committed version (HEAD) and working copy. Original (left) is always read-only. Modified (right) is always editable — the user can make changes and save with Ctrl+S regardless of whether the file has uncommitted changes.

Each RPC call (`get_file_content` with and without `'HEAD'`) is wrapped in its own try/catch. A failure in one (e.g., file doesn't exist in HEAD for new files) doesn't prevent the other from loading. The response is normalized to a string regardless of whether the RPC returns a string or `{content: string}` object.

### File Content Response Normalization

The diff viewer normalizes responses from `Repo.get_file_content` which may return either a plain string or an object with a `content` field. The normalization pattern `headResult?.content ?? headResult ?? ''` handles both formats. This is important because different RPC transports and error paths may return different shapes.

### Editor Reuse

A single `DiffEditor` instance is created and reused for all files. Switching files disposes old models and creates new ones on the existing editor — this prevents memory leaks and avoids the cost of recreating the editor on every tab switch. The editor is only fully disposed when the last file is closed.

**Model disposal ordering:** When switching files on an existing editor, the old models must be disposed AFTER `setModel()` detaches them. Disposing while still attached causes "TextModel got disposed before DiffEditorWidget model got reset". The sequence is:

1. Capture reference to old model pair (`editor.getModel()`)
2. Update editor options (side-by-side mode, read-only state)
3. Create new original and modified models with the correct language
4. Call `editor.setModel({ original: newOrig, modified: newMod })` — this detaches the old models
5. Dispose the old original and modified models
6. Set read-only state on the modified editor (must come after `setModel` so inline diff mode doesn't override it)

**Editor disposal ordering:** When the editor itself is disposed (last file closed), the diff editor is disposed FIRST, then the text models afterward. This ensures the editor releases its references before the models are destroyed.

When no editor exists: create new `DiffEditor` with configuration, create models, attach content change listener for dirty tracking and preview update.

### Per-File Viewport State

The diff viewer maintains a transient `Map<path, ViewportState>` that stores each file's scroll position and cursor location. The viewport state (`scrollTop`, `scrollLeft`, `lineNumber`, `column`) is captured before switching away from a file (via `openFile`, Ctrl+PageDown/PageUp, or file-nav Alt+Arrow) and restored after switching back. Restoration waits for the diff editor's async diff computation to finish — scrolling before the diff result arrives would be overwritten by Monaco's layout pass. The map is not persisted; on page reload all saved viewports are lost. Entries are removed when a file is closed.

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