# Diff Viewer

Side-by-side diff editor for text file changes. Lives outside the dialog, filling the background viewport. Supports inline editing with save, and LSP features.

**Single-file, no-cache model.** Exactly one file is displayed at a time. Every `openFile` call fetches HEAD and working-copy content fresh from the backend — there is no caching of file content across switches. Unsaved edits to the currently-displayed file are discarded when any other file is opened, including when the same file is opened again (same-file click forces refetch). The diff editor is a transient window onto disk state, not a stateful workspace.

For SVG files, see [svg-viewer.md](svg-viewer.md) — a dedicated side-by-side viewer that replaces the Monaco editor for SVG content.
## Layout
- Background layer filling the viewport, sibling of the dialog
- Empty state shows a watermark (brand mark, low opacity)
- Floating overlay buttons in the top-right corner when a file is open — status LED, preview toggle (for markdown/tex), text-diff toggle (for SVG passthroughs)
## Status LED
Circular indicator showing the active file's state:
| State | Color | Behavior |
|---|---|---|
| Clean | Green (steady glow) | File matches saved content |
| Dirty | Orange (pulsing) | Unsaved changes — click to save |
| New file | Cyan (steady glow) | File doesn't exist in HEAD |
- Tooltip shows current file path and save hint when dirty
- At most one file displayed at a time; no tab bar and no per-file keyboard navigation. The [file navigation grid](file-navigation.md) provides history-based navigation across previously-visited files (next/previous tab, close)
## Editor Features
- Side-by-side — original (read-only) left, modified (editable) right
- Auto language detection from extension
- Dark theme, minimap disabled, auto-layout on resize
### Language Detection
- Map of common extensions to language identifiers (JavaScript, TypeScript, Python, JSON, YAML, HTML, CSS, Markdown, C, C++, shell, MATLAB, Java, Rust, Go, Ruby, PHP, SQL, INI/TOML)
- Fallback — plain text
### Monaco Worker Configuration
Hybrid worker setup:
- **Editor worker** — a real Worker from the Monaco package; required for diff computation, find widget, word-based autocomplete, and any editor-core service that dispatches to the `editorWorkerService` label. Without it, the diff editor renders and accepts edits, but `getLineChanges()` returns null forever — no red/green highlighting, no gutter markers, no overview-ruler ticks. The failure is silent.
- **All other workers** — stubbed with no-op worker-like objects covering the `postMessage`/`addEventListener`/`terminate` surface. Covers language-service workers (TypeScript, JSON, CSS, HTML). Backend LSP covers the features these workers would provide.

The configuration must be installed before any Monaco module imports that create editors. In practice this means the worker-environment install runs as a module-level side effect in the same file that imports Monaco, before any other module can get a reference to `monaco.editor`.

#### Worker Loading Pattern
The editor worker must be bundled by the build tool and returned as a real Worker instance. The pattern `new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), { type: 'module' })` — which appears in Monaco's own sample code — is unreliable under Vite's dep optimizer: the URL resolves at build time for bare specifiers but the resulting runtime fetch can return HTML or 404 after pre-bundling, Worker construction throws, the try/catch in the getter falls through to the stub, and diff output silently disappears. Syntax highlighting still works because Monarch tokenizers run on the main thread, which makes the failure hard to notice without devtools probing.

The reliable pattern under Vite is a dedicated worker-entry module imported with the `?worker` suffix:

```
// monaco-worker.js — thin worker entry
import 'monaco-editor/esm/vs/editor/editor.worker.js';

// monaco-setup.js — import compiles the entry as a Worker
import EditorWorker from './monaco-worker.js?worker';

self.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === 'editorWorkerService') return new EditorWorker();
    return /* no-op stub */;
  },
};
```

Reimplementations using non-Vite bundlers should follow that bundler's documented Web Worker pattern (webpack's `new Worker(new URL(...))` with `experiments.asyncWebAssembly`, esbuild's `--loader:.worker.js=file`, etc.) rather than the Monaco-sample pattern, for the same silent-failure reason.

#### Monaco Module Entry
Import Monaco from the **full editor entry** (`monaco-editor/esm/vs/editor/editor.main.js`), not the **API-only entry** (`monaco-editor/esm/vs/editor/editor.api.js`). The API entry exposes the programmatic surface (`createDiffEditor`, `languages.register`, etc.) but does not pull in Monaco's contribution modules — find widget, hover, folding, bracket matching, diff decoration renderer, word highlighter. Symptoms when the API entry is used by mistake:
- `Ctrl+F` throws `Error: command 'actions.find' not found` because the find controller never registered its action.
- Diff editing runs the diff algorithm correctly (the worker produces line changes) but the visible highlighting and gutter markers rely on contribution-layer rendering code that isn't loaded, so changes render invisibly.

The cost of the full entry is that all built-in languages are bundled. Mitigate via the build tool's chunk-splitting if bundle size matters; the worker entry is a separate chunk regardless.

#### Diagnostic Probe
When diff highlighting does not appear, the following in devtools distinguishes the four failure modes:

```
const v = /* walk shadow roots to find <ac-diff-viewer> */;
const e = v._editor;
console.log('line changes:', e.getLineChanges());
console.log('modified len:', e.getModifiedEditor().getValue().length);
console.log('original len:', e.getOriginalEditor().getValue().length);
const sr = v.shadowRoot;
console.log('has .mtk:', [...sr.querySelectorAll('style')].some(s => s.textContent.includes('.mtk')));
console.log('has line-insert:', [...sr.querySelectorAll('style')].some(s => s.textContent.includes('line-insert')));
```

- `line changes: null` → editor worker not running. Check the worker loading pattern and network tab for a failed worker fetch.
- `line changes: []` → models have identical content. Check model creation.
- `line changes: [...]` non-empty but `has line-insert: false` → diff-decoration CSS not in document.head. Check that the full `editor.main.js` entry is imported and that `editor.main.css` is imported as a side effect.
- `line changes: [...]` non-empty and `has line-insert: true` → shadow-DOM style sync problem; see [Monaco Shadow DOM Integration](#monaco-shadow-dom-integration).
### MATLAB Syntax Highlighting
- Custom tokenizer registered at module load time (before any editor instance is created)
- Monaco has no built-in MATLAB language; registration must happen eagerly
- Handles keywords, common builtins, line and block comments, strings, numbers, operators, transpose operator
- Critical timing — registration must run as top-level statements in the module that imports Monaco, not inside a component lifecycle hook or editor creation path. If registration happens after any editor creation call, existing editor instances will not apply the tokenizer to MATLAB files
### Floating Panel Labels
Two floating labels appear over the diff panels when contextual information is available (e.g., loadPanel comparisons):
- Left label — over the left panel
- Right label — over the right panel
- Semi-transparent with backdrop blur, more opaque on hover
- Hidden in inline diff mode (preview)
- Not shown for normal file diffs (context is obvious from file path)
### Monaco Shadow DOM Integration
Monaco must render inside a component shadow DOM. Style injection has two phases:
- **Full re-sync** — on every editor creation, all previously-cloned styles are removed and all current styles from document head are re-cloned into the shadow root. This captures Monaco's dynamically-added styles (created during construction)
- **Incremental observation** — a mutation observer set up once per component lifetime watches document head for dynamically added/removed stylesheets after initial editor creation
Why the full re-sync is needed — Monaco adds styles synchronously during editor construction, before the constructor returns. A pure observer-based approach would miss these initial styles because observers fire asynchronously. The full re-sync after editor construction catches every style that was just added.
### Deduplication Marker
- Every cloned style/link carries a dataset marker so the re-sync can find and remove all prior clones without touching styles added by other shadow DOM consumers
- The observer's removal path matches removed head styles to their shadow clones by text content
### KaTeX CSS — Separate Injection
- KaTeX stylesheet used by the TeX preview is imported as a raw string and injected separately into the shadow root
- Not present in document head — raw-import pattern bypasses the normal style-cloning loop
- Without this, KaTeX math in TeX preview renders as unstyled broken fragments
## File Management
Exactly one file is displayed at a time. The viewer holds a single active file object plus a single virtual-comparison slot (see [Load Panel](#load-panel-ad-hoc-comparison)). Opening any file replaces whatever was previously displayed.

### No Caching Across Switches
Every `openFile` call fetches HEAD and working-copy content fresh — both panels rebuild from the returned strings. There is no `_files[]` array, no per-file content cache, no per-file viewport memory, no dirty-buffer preservation. Consequences:
- **Switching away from an unsaved file discards those edits.** The new file's fetch rebuilds the Monaco model pair; the outgoing model's buffer is disposed.
- **Clicking the same file again refetches.** This is a feature, not a bug — the user can force-refresh at any time by clicking the picker entry.
- **External changes (git pull, another tool writing to disk) are reflected on the next click.** No filesystem watcher is needed for consistency; user action drives refresh.
- **Review mode transitions, discard-changes, commits, and LLM edits all require either a refetch of the active file or acceptance that the next click will pick up the new state.** Triggers that affect the currently-displayed file (review enter/exit, discard-changes on the active path, commit) should dispatch `files-reverted` or equivalent so the viewer refetches without waiting for a user click.

### Concurrent openFile
- `openFile` is async (it fetches content) and can be invoked multiple times before the first completes
- A second call for any path (same or different) cancels the first logically — the first's model-attach is skipped if the active path has changed by the time its fetch resolves
- Rapid sequences (e.g., held Alt+Arrow through the file navigation grid) coalesce to a single fetch for the final target; see [file-navigation.md](file-navigation.md) for the debounce contract
## Saving
### Single File Save
- Compare editor content against saved content
- Update saved content, clear dirty state
- Dispatch event with path, content, and config flags
- Parent routes to repo write or settings save
### Batch Save
- Iterates all dirty files and saves each one
- For the currently active file, content is read live from the editor
- For other files, last-known modified content stored on the file object is used
- Each file goes through the same save pipeline as single-file save
### Dirty Tracking
- Per-file saved content compared against current
- Global dirty set
- State change events propagated to parent
## Load Panel (Ad-Hoc Comparison)
Loads arbitrary text content into the left or right panel for ad-hoc comparison of content from different sources (e.g., history messages, file content via context menu).

The viewer maintains a dedicated virtual-comparison slot separate from the single active-file slot. The virtual slot holds `{leftContent, leftLabel, rightContent, rightLabel}` — the two sides accumulate across successive `loadPanel` calls.

- **First `loadPanel` call**: activates the virtual slot, populates the specified side, leaves the other side empty. The diff editor swaps from displaying the active file (if any) to displaying the virtual pair.
- **Subsequent `loadPanel` calls**: update only the specified side of the virtual slot. The other side is preserved, so the accumulation pattern "load A in left, then B in right" produces a side-by-side diff between A and B.
- **Opening a real file via `openFile`** clears the virtual slot. The virtual comparison is replaced by the real file's HEAD-vs-working diff.
- **Label parameter** sets a floating panel label (see [Floating Panel Labels](#floating-panel-labels))
- **Virtual comparisons are read-only** — there is no save path. The dirty LED does not apply. Closing the comparison requires opening any real file.
## LSP Integration
Registered when editor and RPC are both ready:
| Feature | Trigger | Backend |
|---|---|---|
| Hover | Mouse hover | LSP hover RPC |
| Definition | Ctrl+Click / F12 | LSP definition RPC |
| References | Context menu | LSP references RPC |
| Completions | Typing / Ctrl+Space | LSP completions RPC |
Line and column numbers passed as 1-indexed values (Monaco's convention and the backend's symbol storage). No conversion needed at the RPC boundary.
Cross-file definition — returns file and range, loads file if needed, scrolls to target.
### Cross-File Navigation via Code Editor Service
- Monaco's code editor service method is patched (once per component lifetime, guarded by a flag) to intercept cross-file navigation
- Extract target path and line from the input
- Call openFile to open the target in the tab system
- Return the current editor to satisfy Monaco's API contract
Flag placement rule — the patched-flag lives on the **component instance**, not on the editor instance or the service object. Monaco may reuse the same service across editor recreations; an editor-level flag would repatch, and each re-patch would wrap the already-patched method, creating a chain of override closures that eventually overflow the call stack.
### Markdown Link Navigation
For markdown files, markdown links to repo-relative paths are Ctrl+clickable in the editor via:
- A link provider registered for markdown, matching link patterns and mapping them to a custom URI scheme
- A link opener intercepting the custom scheme and dispatching a navigate event
- Event handler resolving the relative path against the current file's directory and dispatching the standard navigate-file
The preview pane also intercepts clicks on relative-href anchor tags, resolving the same way. Absolute URLs are left to the browser's default handling.
## Markdown Preview
For markdown files, a Preview button appears in the top-right. Toggling switches from the side-by-side diff layout to a split editor+preview layout. In preview mode, the Preview button moves to the top-right of the preview pane so the user can exit preview from the panel they're reading.
### Split Layout
- Left — editor (inline diff mode, word wrap enabled)
- Right — live-rendered markdown preview
- Editor switches to inline diff (not side-by-side) so it fits in half the viewport
- Preview pane renders the modified editor's content via the source-map-aware markdown utility
### Dual Marked Instances
- Chat rendering and diff-viewer preview use completely independent marked instances
- Diff-viewer instance has custom renderers for source-line attribute injection (scroll sync)
- Chat instance has simpler code-only override
- Separation prevents preview-specific logic from affecting chat rendering
### Source-Line Attribute Injection
Renderer injects source-line attributes into output HTML for scroll synchronization:
- **Phase 1 — line map construction** — raw markdown source is lexed to produce a map of token keys to line numbers
- **Phase 2 — attribute injection** — code and hr blocks inject attributes directly; headings, paragraphs, blockquotes, lists, and tables use a walk-tokens hook to collect mappings and a post-process hook to inject attributes into the first matching opening tag
This design ensures complex block elements render correctly using marked's own logic while still carrying source-line metadata.
### Live Update
- Preview updates on every keystroke
- Editor's content-change event triggers preview update
### Bidirectional Scroll Sync
- **Editor → preview** — editor scroll top-line computed; preview anchors collected, deduplicated, filtered for monotonicity; binary search finds the anchor at or just before the top line; linear interpolation between adjacent anchors
- **Preview → editor** — anchor at or just before scroll position is found; reverse mapping computes source line; editor uses pixel-precise scroll (not reveal-line) to avoid jumps
- **Scroll lock mutex** — when one side initiates a scroll, it sets a lock indicating which side owns the scroll; other side's handler skips while the lock is held; auto-releases after a short delay
### Relative Path Resolution
- Helper resolves a relative path against the current file's directory
- Splits current file's path at last separator to get the directory
- Joins relative path, normalizes (resolves `.` and `..` segments)
- Used by markdown link navigation and preview image resolution
### Image Rendering
Markdown images with relative sources are resolved against the current file's directory and fetched from the repository:
- Skip data, blob, HTTP, HTTPS URLs — pass through unchanged
- Decode percent-encoded characters back to real filesystem characters
- Resolve relative paths (including parent-directory segments) against the markdown file's directory
- SVG files fetched as text and injected as data URIs with URL-encoded content
- Binary images fetched via base64 RPC which returns ready-to-use data URIs
- Failed loads degrade gracefully — alt text indicates missing/failed, image dimmed
Image resolution runs as a post-processing step after the preview renders.
### Space Encoding in Image Paths
- The markdown library does not parse image references with unencoded spaces
- Markdown utility pre-processes text to replace spaces with percent-encoded form in image URL portions before parsing
- Applied in both chat and diff-viewer renderers
- Already-encoded URLs and absolute URLs left unchanged
### Toggle Behavior
- Toggling preview mode disposes and recreates the editor — switches between side-by-side diff and inline diff
- After disposal, waits for re-render, updates editor container reference from the new DOM structure, reattaches resize observer, rebuilds the editor in the new layout
## TeX Preview
For TeX files, the same Preview button activates a live TeX preview via make4ht compilation on the server and KaTeX rendering on the client. See [tex-preview.md](tex-preview.md) for the full specification.
## Event Routing
| Source | Event path |
|---|---|
| File picker click | file-clicked → navigate-file → diff viewer |
| Chat edit result (goto icon) | navigate-file with search text → scroll to edit |
| Search match | search-navigate → navigate-file with line |
| Post-edit refresh | Direct call from app shell |
### Scroll to Edit Anchor
- When clicking an edit block's goto icon, open file and search for progressively shorter prefixes of the edit text
- Scroll to and highlight match for a few seconds
- Highlight applied via decorations API with whole-line highlighting and overview ruler marker
- Previous highlight timer cleared before applying a new highlight
### Diff Computation Readiness
- Monaco's diff editor computes diffs asynchronously after models are set
- Any scroll positioning must wait for the diff computation to finish — scrolling before the result arrives is overwritten by Monaco's layout pass
- A wait-for-diff-ready helper registers a one-shot listener and resolves when it fires (with an extra animation frame for layout settlement)
- Has a safety timeout — if diff computation never fires (identical content), the promise resolves anyway
- Used by openFile, viewport restore, and search-text scrolling
## File Loading
| Source | Mode |
|---|---|
| Edit applied | HEAD vs working copy diff (editable) |
| Search result | Editable, scroll to line |
| File picker | Editable |
| LSP navigation | Add or replace file, scroll to position |
| Config edit | Config content with special path prefix |
| Virtual content | Read-only, special virtual path prefix (e.g., URL content viewing, loadPanel comparisons) |
### Virtual Files
- Files with a virtual path prefix are not fetched from the repository
- Content passed directly via an option and stored in an in-memory map
- Always read-only; empty original side for single-panel virtual files
- On close, the virtual content entry is removed from the map
- Content fetcher short-circuits for virtual paths — returns the stored content without RPC
Used for:
- URL content viewing — fetched URL content displayed without creating actual files
- Ad-hoc comparison — loadPanel creates virtual comparison entries for arbitrary content
- When loading into a panel of an existing virtual comparison file, the other side's content is preserved so both sides accumulate independently
### HEAD vs Working Copy
- Fetch committed version and working copy via repo RPCs, each wrapped in its own error handler (one failure does not prevent the other from loading)
- Original (left) always read-only
- Modified (right) always editable — user can make changes and save regardless of whether the file has uncommitted changes
- Response normalization — the content RPC may return a plain string or an object with a content field; handler accepts both shapes
### Editor Reuse
- Single diff editor instance created on first `openFile`, reused across subsequent opens
- Every open disposes the old model pair and creates a new one on the existing editor
- Editor fully disposed only when the viewer's empty state is restored (all files cleared, including virtual slot)

### Model Disposal Ordering
- Old models must be disposed AFTER `setModel` detaches them
- Disposing while still attached causes "model disposed before widget model was reset" errors
- Sequence — capture reference to old model pair, update editor options, create new models, set new models on editor, dispose old models, set read-only state on the modified editor (must come after set-model so inline diff mode doesn't override it)

### Editor Disposal Ordering
- When the viewer returns to empty state, the diff editor is disposed first, then the text models
- Editor releases its references before the models are destroyed

### Active-File Refresh
- `refreshActiveFile()` re-fetches HEAD and working copy for the currently-displayed file and rebuilds the model pair
- Dirty state is cleared (any unsaved edits are discarded — same policy as cross-file switches)
- Virtual comparisons are unaffected by refresh (no backing disk state to refetch)
- Callers: `stream-complete` after LLM edits, `commitResult` after a commit, `files-reverted` after discard-changes, review-mode transitions
## File Navigation Grid Integration
- The grid (see [file-navigation.md](file-navigation.md)) is pure navigation history. It tracks which files the user has visited; it does not correspond to open tabs or persistent viewer state
- Alt+Arrow keys traverse the grid spatially. Each arrow dispatches a `navigate-file` event after a debounce interval, so rapid arrow sequences coalesce into a single fetch for the final target
- Navigation events from the grid carry a flag indicating they originated from the grid itself (so the app shell does not re-register them as new grid nodes)

## File Object Schema
The single active file is tracked with:
- Path
- Original content (HEAD)
- Modified content (working copy, then edited buffer)
- Saved content (for dirty-flag computation)
- New-file flag (for files that don't exist in HEAD)
- Read-only flag (virtual, config read-only)
- Config flags — whether this is a config file, and its config type
- Real path (distinguishes virtual paths from actual repo paths)

The virtual-comparison slot is tracked separately with:
- Left content, left label
- Right content, right label

At most one of the two slots is active at any time; opening a real file clears the virtual slot and vice versa.

## Invariants
- Editor configuration installation precedes any editor construction — worker setup and MATLAB tokenizer registration must happen at module load time
- Component-level patch flag for cross-file navigation prevents override-closure chains regardless of how many times the editor is recreated
- The full shadow-DOM style re-sync catches all styles Monaco adds during construction; pure observer-based approaches would miss them
- Model disposal always happens after set-model has detached the old models
- Virtual comparisons never trigger repository content fetches
- Every `openFile` call refetches content — there is no same-file suppression. Clicking the same file discards any unsaved edits and reloads from disk.
- Cross-file Monaco Go-to-Definition dispatches `navigate-file` on the window; it never calls the viewer's `openFile` directly, so the app shell's full pipeline (grid registration, collab broadcast, last-open persistence, viewer switch) always runs
- Scroll-lock mutex in markdown preview prevents infinite feedback loops between editor and preview scrolling
- Preview image resolution runs as a post-processing step; never blocks initial render
specs4/5-webapp/tex-preview.md
↗
⏳ pending
# TeX Preview
**Status:** stub
Live TeX preview activated via the Preview button on TeX and LaTeX files in the diff viewer. Source is compiled with `make4ht` on the server and rendered in the browser with KaTeX for math. Uses anchor-based scroll synchronization that works reliably even when KaTeX rendering destroys the original text layout.
## Compilation Pipeline
1. Diff viewer sends the current editor content and file path to the compile-tex RPC
2. Server prepends a non-stop-mode directive before the document class (so the TeX engine never pauses for user input on errors) and writes the content to a temp TeX file
3. Server runs `make4ht` with mathjax option, suppressed stdin (prevents hangs if TeX prompts for input), and a generous timeout
4. Resulting HTML body is extracted, assets (images, CSS) inlined as data URIs
5. Server strips make4ht alt-text fallbacks
6. Client renders math delimiters with KaTeX
7. Client strips any remaining alt-text duplicates using sentinel comments as anchors
## make4ht Configuration
- Custom config file generated per compilation to force mathjax-compatible output
- Tells TeX4ht to emit raw LaTeX math delimiters instead of converting equations to SVG/PNG
- Browser-side KaTeX handles the actual math display
## Math Rendering
Three-phase processing of make4ht HTML:
### Phase 1: Strip Alt-Text Elements
- Remove mathjax-preview spans and similar elements that make4ht emits as plain-text fallbacks alongside delimited math
### Phase 2: Render Delimiters
Process math delimiters in priority order, appending a sentinel HTML comment after each rendered output:
- Display equation environments (equation, align, gather, multline, eqnarray) → KaTeX display math
- Display bracket delimiters → KaTeX display math
- Double-dollar delimiters → KaTeX display math
- Display paren delimiters → KaTeX inline math
- Single-dollar delimiters → KaTeX inline math
### Phase 3: Strip Orphan Alt-Text
- Using the sentinel comments as reliable anchors, strip all bare text nodes between a sentinel and the next HTML tag
- These are always make4ht plain-text duplicates
- Sentinels then removed
- Avoids fragile regex matching through KaTeX's complex output HTML
### Entity and Command Handling
- Helper reverses HTML entity escaping that make4ht applies inside math regions before passing to KaTeX
- Strips unsupported commands (label, tag, nonumber, notag)
## Save-Triggered Compilation
- TeX compilation is expensive (spawns subprocess)
- Unlike markdown preview which updates on every keystroke, TeX preview only recompiles when the file is saved
- Keystrokes do not trigger recompilation — preview holds its last-compiled output until the next save
## Scroll Synchronization
Two-pass anchor-and-interpolation strategy to inject source-line attributes into the make4ht HTML.
### Phase 1: Structural Anchor Extraction
TeX source is scanned for structural commands, each mapped to its 1-based line number:
| Command pattern | Anchor kind |
|---|---|
| Section, subsection, etc. | Heading (with text for verification) |
| Environment start | Environment start |
| Environment end | Skipped, not matched to elements |
| List items | List item |
| Algorithmic pseudo-code commands | Algorithmic |
| Caption command | Caption |
| Make-title command | Title block |
### Element Matching
- Anchors matched against HTML elements by structural role and document order
- Headings match heading tags or heading-classed divisions
- List items and algorithmic commands match list items, paragraphs, or divisions sequentially
- Environment starts match container elements (divisions, tables, lists, preformatted blocks)
- Each anchor searches a small lookahead window to tolerate make4ht wrapper elements
### Phase 2: Interpolation
- All block-level elements in the HTML collected in document order
- Elements that received an anchor in Phase 1 keep their exact line number
- First and last elements assigned boundary values if unanchored
- Remaining unmatched elements assigned linearly-interpolated line numbers between their nearest anchored neighbors
### Phase 3: Attribute Injection
- Source-line attributes spliced into the HTML string back-to-front (earlier insertions don't shift later offsets)
### Sync Mechanics
- Every block element gets a source-line attribute; scroll sync is continuous with no dead zones
- No text comparison involved — works even when KaTeX destroys original text
- Bidirectional scroll sync same as markdown preview (editor → preview and preview → editor with scroll lock)
- See [diff-viewer.md](diff-viewer.md#bidirectional-scroll-sync) for the sync mechanism
## Asset Resolution
Server-side helper converts relative paths in make4ht output to inline data URIs:
- Image source attributes on image tags → base64 data URIs
- URL references in inline CSS → base64 data URIs
- Linked stylesheets → inlined style blocks
Working directory for make4ht set to the file's parent directory so that input, include, and includegraphics resolve relative paths correctly.
## Availability Check
- Before enabling TeX preview, the diff viewer calls a tex-preview-availability RPC to check if make4ht is installed
- If not installed, preview pane displays installation instructions instead of an error
## Temp Directory Lifecycle
- Each compilation creates a temp directory under the per-repo working directory (already gitignored)
- Previous compilation's temp dir cleaned up at the start of the next compilation
- At most one temp dir alive at a time (generated images can be served during the preview session)
- Using the per-repo working directory instead of system temp avoids cross-repo collisions and ensures cleanup is scoped to the repository
- On server startup, the entire tex-preview subdirectory is removed — handles orphans from crashed or killed previous runs
## Working Directory Isolation
- make4ht runs with working directory set to the temp directory, not the file's parent
- Critical because make4ht and TeX write numerous intermediate files (aux, dvi, 4ct, 4tc, log, etc.) to the current working directory — the output flag only controls the final HTML location
- Without this, every preview compilation would litter the repository with TeX build
