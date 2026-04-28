// DiffViewer — Monaco-based side-by-side diff editor.
//
// Single-file, no-cache model. See D18 in IMPLEMENTATION_NOTES.md
// and specs4/5-webapp/diff-viewer.md.
//
// Exactly one file is displayed at a time. Every `openFile`
// call fetches HEAD and working-copy content fresh from the
// backend — no caching across switches. Clicking the same
// file in the picker refetches. Unsaved edits to the active
// file are discarded when any other file is opened,
// including the same-file case.
//
// This model deliberately trades per-file state (scroll
// position, unsaved buffers, dirty tracking across tabs)
// for predictability — the user's mental model is "every
// click = fresh content", so external edits (git pull,
// another tool writing) are always reflected, and review-
// mode transitions / discard-changes / commits don't leave
// stale content in the editor.
//
// What the viewer still owns:
//   - Single active-file slot (_file) OR a single virtual
//     comparison slot (_virtualComparison) — never both
//   - Single Monaco DiffEditor instance, reused across
//     opens. Models swapped on every openFile; editor
//     fully disposed only when returning to empty state
//   - Dirty tracking for the currently-displayed file
//     (compared against its freshly-fetched savedContent)
//   - Status LED, save pipeline, markdown/TeX preview,
//     LSP providers, markdown link provider
//   - Generation counter so fast successive openFile calls
//     don't let a stale fetch clobber a fresher one
//
// What was removed:
//   - _files[] array, _activeIndex, closeFile, saveAll,
//     getDirtyFiles (collapse to single-file operations)
//   - _viewportStates, _panelLabels, _texPreviewStates
//     maps (content-keyed persistence is gone)
//   - _openingPaths set (replaced by generation counter
//     semantics — a second call supersedes the first)
//   - Ctrl+PageUp, Ctrl+PageDown, Ctrl+W keyboard shortcuts
//   - Same-file suppression in openFile
//
// Governing spec: specs4/5-webapp/diff-viewer.md
//
// Architectural contracts pinned by this rewrite:
//
//   - **Worker configuration must install before editor
//     construction.** monaco-setup.js side-effect runs at
//     module load; importing it here before any
//     monaco-editor use ensures the global env is set up.
//
//   - **Editor reuse, not recreation.** A single DiffEditor
//     handles all openFile calls. Switching files disposes
//     old models and creates new ones on the existing
//     editor. Prevents memory leaks and avoids the ~300ms
//     cost of recreating the editor. The editor is only
//     fully disposed when the viewer returns to empty
//     state (no active file, no virtual comparison).
//
//   - **Model disposal order: setModel first, then dispose.**
//     Disposing a model while it's still attached to the
//     editor throws "TextModel got disposed before
//     DiffEditorWidget model got reset". Capture refs →
//     setModel to new pair → dispose old pair.
//
//   - **Generation counter for superseded fetches.** Every
//     openFile call bumps _openingGeneration and captures
//     the current value. When the async HEAD + working-copy
//     fetch resolves, the handler checks the counter; if
//     a later call has bumped it past the captured value,
//     the model-attach step is skipped. Prevents a slow
//     fetch from a stale click stomping fresher content.
//
//   - **Content-addressed virtual files.** virtual://
//     paths (from loadPanel) have no filesystem backing;
//     content is stored on _virtualComparison directly.
//     The content-fetch path short-circuits for them.
//
//   - **No viewport persistence across switches.** Moving
//     to a new file means starting at the top with cursor
//     at (1, 1). Users accepting the no-cache trade-off
//     also accept that the diff editor forgets where they
//     were scrolled in the previous file. Within a single
//     file, viewport is normal — scrolling and cursor
//     position work as expected.

import { LitElement, css, html } from 'lit';

// Import monaco-setup first — its module-level side
// effects (worker env, MATLAB registration) must run
// before any editor construction.
import { languageForPath, monaco } from './monaco-setup.js';
import {
  renderMarkdownWithSourceMap,
  resolveRelativePath,
} from './markdown-preview.js';
import {
  extractTexAnchors,
  injectSourceLines,
  renderTexMath,
} from './tex-preview.js';
import { installLspProviders } from './lsp-providers.js';
import { installMarkdownLinkProvider } from './markdown-link-provider.js';
import { SharedRpc } from './rpc.js';

// KaTeX CSS — imported as a raw string via Vite's ?raw
// loader. Injected into the shadow root (not document
// head) because Monaco's style-cloning loop only sees
// styles in document.head, and this one isn't. Without
// this, math in preview renders unstyled (fractions flat,
// superscripts inline).
//
// In environments where the ?raw import doesn't resolve
// to a string (vitest under some resolver configurations,
// or stripped-down bundles), we fall back to a minimal
// sentinel stylesheet. The injection mechanism still runs
// so test coverage and shadow-DOM integration work
// identically; math just renders unstyled in those
// environments, matching the no-CSS fallback the guard
// used to produce.
import _rawKatexCss from 'katex/dist/katex.min.css?raw';
const katexCssText =
  typeof _rawKatexCss === 'string' && _rawKatexCss
    ? _rawKatexCss
    : '/* ac-dc KaTeX CSS placeholder — raw import unavailable */';

/**
 * Virtual path prefix. Files with this prefix are
 * content-addressed (content passed via openFile's
 * virtualContent option) and are always read-only.
 */
const _VIRTUAL_PREFIX = 'virtual://';

/**
 * Escape HTML-significant characters. Used when building
 * TeX preview error messages so error text containing
 * `<`, `>`, `&` doesn't inject into the DOM.
 */
function _escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * How long to wait for Monaco's async diff computation
 * before giving up on viewport restoration. Identical
 * content never fires onDidUpdateDiff, so the timeout
 * prevents the restore from hanging forever. Matches
 * specs4's 2 second recommendation.
 */
const _DIFF_READY_TIMEOUT_MS = 2000;

/**
 * How long to show the scroll-to-edit highlight decoration
 * after a search-text match is found.
 */
const _HIGHLIGHT_DURATION_MS = 3000;

/**
 * Dataset marker for shadow-DOM-cloned styles. Lets us
 * find and remove prior clones without touching styles
 * from other shadow-DOM consumers.
 */
const _CLONED_STYLE_MARKER = 'acDcMonacoClone';

/**
 * Dataset marker for the KaTeX stylesheet injected into
 * the shadow root when preview mode activates. Separate
 * from the Monaco-clone marker so the style-sync loop
 * doesn't touch it.
 */
const _KATEX_CSS_MARKER = 'acDcKatexCss';

/**
 * How long the scroll-sync lock stays held after one
 * side initiates a scroll. During this window the other
 * side's scroll handler skips (prevents feedback loops).
 * Long enough to cover Monaco's smooth-scroll animation,
 * short enough that genuine user scrolling isn't
 * suppressed.
 */
const _SCROLL_LOCK_MS = 120;

export class DiffViewer extends LitElement {
  static properties = {
    /**
     * The single active file, or null when no file is
     * open. Shape: {path, original, modified, savedContent,
     * isNew, isVirtual, isReadOnly, isConfig, configType,
     * realPath?, texCompile?}.
     *
     * Mutually exclusive with _virtualComparison — exactly
     * one is non-null at any time, or both are null (empty
     * state).
     */
    _file: { type: Object, state: true },
    /**
     * Virtual comparison slot for loadPanel's ad-hoc
     * content view. Shape: {leftContent, leftLabel,
     * rightContent, rightLabel}. Both sides accumulate
     * across successive loadPanel calls; opening any
     * real file clears this slot.
     */
    _virtualComparison: { type: Object, state: true },
    /**
     * Monotonic counter bumped on every openFile /
     * loadPanel call. Async handlers capture the current
     * value at call start and check it before attaching
     * models; a handler whose captured value is behind
     * the current counter knows it was superseded and
     * skips its model-attach step.
     */
    _openingGeneration: { type: Number, state: true },
    /** Drives the status LED (clean / dirty / new). */
    _dirty: { type: Boolean, state: true },
    /**
     * Preview mode flag — when true AND the active file
     * is previewable (markdown or TeX), the layout
     * switches from side-by-side diff to split
     * editor+preview. Toggled via the Preview button in
     * the overlay.
     */
    _previewMode: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--bg-primary, #0d1117);
      position: relative;
    }

    .empty-state {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: none;
    }
    .watermark {
      font-size: 8rem;
      opacity: 0.18;
      letter-spacing: -0.05em;
    }
    .watermark .bolt {
      color: var(--accent-primary, #58a6ff);
    }

    .editor-container {
      flex: 1;
      min-height: 0;
      width: 100%;
      position: relative;
    }

    /* Status LED — floating overlay in the top-right
     * corner. Click to save when dirty. */
    .status-led {
      position: absolute;
      top: 12px;
      right: 16px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      cursor: pointer;
      z-index: 10;
      transition: transform 120ms ease, box-shadow 120ms ease;
    }
    .status-led:hover {
      transform: scale(1.4);
    }
    .status-led.clean {
      background: #7ee787;
      box-shadow: 0 0 6px rgba(126, 231, 135, 0.6);
      cursor: default;
    }
    .status-led.new-file {
      background: var(--accent-primary, #58a6ff);
      box-shadow: 0 0 6px rgba(88, 166, 255, 0.6);
      cursor: default;
    }
    .status-led.dirty {
      background: #d29922;
      box-shadow: 0 0 8px rgba(210, 153, 34, 0.7);
      animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.55; }
    }

    /* Floating panel labels for loadPanel comparisons. */
    .panel-label {
      position: absolute;
      top: 12px;
      padding: 0.2rem 0.55rem;
      font-size: 0.75rem;
      font-family: 'SFMono-Regular', Consolas, monospace;
      background: rgba(22, 27, 34, 0.78);
      color: var(--text-secondary, #8b949e);
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 3px;
      backdrop-filter: blur(4px);
      z-index: 5;
      pointer-events: none;
      transition: opacity 120ms ease;
    }
    .panel-label.left {
      right: calc(50% + 8px);
    }
    .panel-label.right {
      right: 120px;
    }

    /* Preview button — floats near the status LED in
     * normal mode, moves to the preview pane's top-right
     * in split mode so the user can exit preview from
     * the panel they're reading. */
    .preview-button {
      position: absolute;
      top: 8px;
      right: 46px;
      z-index: 10;
      padding: 0.25rem 0.6rem;
      font-size: 0.75rem;
      font-family: inherit;
      background: rgba(22, 27, 34, 0.88);
      color: var(--text-primary, #c9d1d9);
      border: 1px solid rgba(240, 246, 252, 0.2);
      border-radius: 4px;
      cursor: pointer;
      backdrop-filter: blur(4px);
    }
    .preview-button:hover {
      background: rgba(240, 246, 252, 0.12);
      border-color: rgba(240, 246, 252, 0.35);
    }
    .preview-button-split {
      right: 46px;
    }

    /* Split layout for preview mode. Editor on the left,
     * preview on the right, equal width. */
    .split-root {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: row;
      width: 100%;
      position: relative;
    }
    .editor-pane {
      flex: 1 1 50%;
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
      border-right: 1px solid rgba(240, 246, 252, 0.1);
    }
    .editor-pane .editor-container {
      flex: 1;
      min-height: 0;
    }
    .preview-pane {
      flex: 1 1 50%;
      min-width: 0;
      min-height: 0;
      overflow-y: auto;
      padding: 1rem 1.5rem;
      color: var(--text-primary, #c9d1d9);
      font-size: 0.9375rem;
      line-height: 1.55;
    }
    .preview-pane h1,
    .preview-pane h2,
    .preview-pane h3,
    .preview-pane h4,
    .preview-pane h5,
    .preview-pane h6 {
      margin-top: 1.5rem;
      margin-bottom: 0.5rem;
      font-weight: 600;
    }
    .preview-pane p {
      margin: 0.75rem 0;
    }
    .preview-pane code {
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 0.875em;
      background: rgba(13, 17, 23, 0.6);
      border-radius: 3px;
      padding: 0.1rem 0.35rem;
    }
    .preview-pane pre {
      background: rgba(13, 17, 23, 0.9);
      border: 1px solid rgba(240, 246, 252, 0.1);
      border-radius: 6px;
      padding: 0.75rem;
      overflow-x: auto;
      margin: 0.75rem 0;
    }
    .preview-pane pre code {
      background: transparent;
      padding: 0;
    }
    .preview-pane blockquote {
      border-left: 3px solid rgba(240, 246, 252, 0.2);
      padding-left: 0.75rem;
      margin: 0.75rem 0;
      color: var(--text-secondary, #8b949e);
    }
    .preview-pane table {
      border-collapse: collapse;
      margin: 0.75rem 0;
    }
    .preview-pane th,
    .preview-pane td {
      border: 1px solid rgba(240, 246, 252, 0.15);
      padding: 0.35rem 0.6rem;
    }

    /* TeX preview states — placeholder, loading, error,
     * install-hint. The actual compiled output
     * (make4ht-generated HTML with section headings,
     * paragraphs, etc.) flows through the same
     * .preview-pane rules as markdown. */
    .preview-pane .tex-preview-placeholder,
    .preview-pane .tex-preview-loading {
      padding: 2rem;
      text-align: center;
      color: var(--text-secondary, #8b949e);
      font-style: italic;
    }
    .preview-pane .tex-preview-loading {
      opacity: 0.7;
    }
    .preview-pane .tex-preview-error {
      padding: 1rem;
      background: rgba(248, 81, 73, 0.1);
      border: 1px solid rgba(248, 81, 73, 0.3);
      border-radius: 6px;
      color: #f85149;
      margin: 1rem 0;
    }
    .preview-pane .tex-preview-error strong {
      display: block;
      margin-bottom: 0.5rem;
    }
    .preview-pane .tex-preview-install-hint {
      padding: 1rem;
      background: rgba(88, 166, 255, 0.08);
      border: 1px solid rgba(88, 166, 255, 0.25);
      border-radius: 6px;
      margin: 1rem 0;
    }
    .preview-pane .tex-preview-install-hint strong {
      display: block;
      margin-bottom: 0.5rem;
      color: var(--accent-primary, #58a6ff);
    }
    .preview-pane .tex-preview-log {
      margin: 0.75rem 0;
      padding: 0.5rem 0.75rem;
      background: rgba(13, 17, 23, 0.6);
      border: 1px solid rgba(240, 246, 252, 0.1);
      border-radius: 4px;
      font-size: 0.8125rem;
    }
    .preview-pane .tex-preview-log summary {
      cursor: pointer;
      color: var(--text-secondary, #8b949e);
    }
    .preview-pane .tex-preview-log pre {
      margin: 0.5rem 0 0 0;
      font-size: 0.8125rem;
      max-height: 200px;
    }
    /* make4ht class-name hooks — section heading sizes
     * roughly match the markdown h1/h2/h3 treatment. */
    .preview-pane .sectionHead {
      font-size: 1.5rem;
      font-weight: 600;
      margin: 1.5rem 0 0.5rem;
    }
    .preview-pane .subsectionHead {
      font-size: 1.25rem;
      font-weight: 600;
      margin: 1.25rem 0 0.5rem;
    }
    .preview-pane .subsubsectionHead {
      font-size: 1.125rem;
      font-weight: 600;
      margin: 1rem 0 0.4rem;
    }
    /* make4ht font-size classes — rough approximations
     * to Computer Modern variants. make4ht emits these
     * class names directly; mapping them here keeps the
     * rendered output visually coherent. */
    .preview-pane .cmr-17 { font-size: 1.5rem; }
    .preview-pane .cmr-12 { font-size: 1.125rem; }
    .preview-pane .cmbx-12,
    .preview-pane .cmbx-10 { font-weight: 600; }
    .preview-pane .cmti-10,
    .preview-pane .cmti-12 { font-style: italic; }
    .preview-pane .cmtt-10,
    .preview-pane .cmtt-12 {
      font-family: 'SFMono-Regular', Consolas, monospace;
    }

    /* Highlight decoration for scroll-to-edit anchor
     * matches. Applied via Monaco's deltaDecorations API
     * — the class here just defines the visual. */
    :host ::ng-deep .highlight-decoration,
    :host .highlight-decoration {
      background: rgba(79, 195, 247, 0.18);
      border-left: 2px solid var(--accent-primary, #58a6ff);
    }
  `;

  constructor() {
    super();
    // Single-file / virtual-comparison slots — mutually
    // exclusive. _file holds a real open file; 
    // _virtualComparison holds loadPanel content.
    this._file = null;
    this._virtualComparison = null;
    this._openingGeneration = 0;
    this._dirty = false;
    this._previewMode = false;

    // Monaco editor instance. Created on first openFile
    // or loadPanel; disposed when both slots clear.
    this._editor = null;
    // Element reference for the editor host div, read
    // from the shadow root after Lit renders.
    this._editorContainer = null;
    // Preview pane element — the right side of the split
    // layout in preview mode. Populated after Lit renders
    // the split template. Preview HTML is written to this
    // element's innerHTML directly (not via Lit) so every
    // keystroke doesn't re-render the whole component.
    this._previewPane = null;
    // Availability tristate — null = not yet checked,
    // true = make4ht installed, false = missing. Probed
    // lazily on first .tex file interaction with
    // preview. Lives on the component (not the file)
    // because make4ht availability is process-level.
    this._texPreviewAvailable = null;
    // Generation counter for compile RPC calls — bumped
    // on each compile start; stale responses check it
    // before writing state so fast typing + slow server
    // doesn't clobber fresher results. Distinct from
    // _openingGeneration (which guards file-switch
    // fetches).
    this._texCompileGeneration = 0;
    // Current highlight decorations (cleared on next
    // highlight or on file switch).
    this._highlightDecorations = [];
    this._highlightTimer = null;
    // Content-change listener disposable. Attached per
    // editor instance lifetime.
    this._contentChangeDisposable = null;
    // Editor scroll listener disposable — only attached
    // in preview mode so we don't pay for scroll events
    // on every file, only previewable files under
    // preview mode.
    this._editorScrollDisposable = null;
    // Scroll-sync lock. 'editor' or 'preview' identifies
    // which side initiated the scroll; the other side's
    // handler skips until the lock clears. null = free.
    this._scrollLock = null;
    this._scrollLockTimer = null;
    // Preview pane scroll listener, bound for add/remove
    // symmetry.
    this._onPreviewScroll = this._onPreviewScroll.bind(this);
    // MutationObserver for shadow-DOM style sync after
    // editor creation.
    this._styleObserver = null;
    // Whether we've patched the code-editor-service's
    // openCodeEditor method. Component-level flag (not
    // per-editor) to avoid chaining override closures
    // across editor recreations — specs4 calls this out
    // explicitly.
    this._editorServicePatched = false;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onContentChange = this._onContentChange.bind(this);
    this._onHeadMutation = this._onHeadMutation.bind(this);
    this._onEditorScroll = this._onEditorScroll.bind(this);
    this._onPreviewClick = this._onPreviewClick.bind(this);
    // Image-resolution generation counter. Bumped on
    // every _updatePreview call so in-flight fetches from
    // a previous render can detect they're stale and skip
    // DOM writes. Without this, rapid keystrokes produce
    // a race where a slow fetch from render N overwrites
    // the DOM populated by render N+1.
    this._imageResolveGeneration = 0;
  }

  // ---------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------

  connectedCallback() {
    super.connectedCallback();
    // Keyboard shortcuts on document so they work
    // regardless of which element has focus inside the
    // editor (Monaco captures most key events itself, but
    // Ctrl+S / Ctrl+W / Ctrl+PageDown we route ourselves).
    document.addEventListener('keydown', this._onKeyDown);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKeyDown);
    this._disposeStyleObserver();
    this._disposeEditor();
    if (this._highlightTimer) {
      clearTimeout(this._highlightTimer);
      this._highlightTimer = null;
    }
    super.disconnectedCallback();
  }

  updated(changedProps) {
    super.updated?.(changedProps);
    // When a slot goes non-empty, the editor container
    // appears in the DOM; wire it up.
    const hasContent = this._file !== null || this._virtualComparison !== null;
    if (hasContent && !this._editorContainer) {
      this._editorContainer =
        this.shadowRoot?.querySelector('.editor-container') || null;
    }
    // When both slots clear, drop the container ref so
    // the next open re-resolves it.
    if (!hasContent && this._editorContainer) {
      this._editorContainer = null;
    }
  }

  // ---------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------

  /**
   * Open a file, discarding any previous active file or
   * virtual comparison. Every call fetches HEAD and
   * working-copy content fresh — no caching, no same-file
   * suppression. Clicking the same file twice refetches.
   *
   * Options:
   *   path        — repo-relative or virtual:// path
   *   line        — optional, scroll to this line after open
   *   searchText  — optional, scroll to and highlight this text
   *   virtualContent — for virtual:// paths, the content
   *                    to display (always read-only)
   *
   * Unsaved edits to the previously-active file are
   * discarded. Concurrent calls supersede: the generation
   * counter ensures only the latest call's fetch attaches
   * its models.
   */
  async openFile(opts) {
    if (!opts || typeof opts.path !== 'string' || !opts.path) {
      return;
    }
    const { path, virtualContent } = opts;
    // Bump the generation counter; capture our value.
    // Async fetches that resolve after the counter has
    // advanced skip their model-attach step.
    this._openingGeneration += 1;
    const myGeneration = this._openingGeneration;

    // Clear the virtual comparison slot — opening a real
    // file replaces whatever ad-hoc content was shown.
    this._virtualComparison = null;

    let newFile;
    if (path.startsWith(_VIRTUAL_PREFIX)) {
      // Virtual file — content passed explicitly. Always
      // read-only. No filesystem backing.
      newFile = {
        path,
        original: '',
        modified: virtualContent || '',
        savedContent: virtualContent || '',
        isNew: false,
        isVirtual: true,
        isReadOnly: true,
      };
    } else {
      const fetched = await this._fetchFileContent(path);
      // Generation check: if a later openFile bumped past
      // our captured value, our fetch is stale. Abandon.
      if (myGeneration !== this._openingGeneration) return;
      if (!fetched) return;
      newFile = {
        path,
        original: fetched.original,
        modified: fetched.modified,
        savedContent: fetched.modified,
        isNew: fetched.isNew,
        isVirtual: false,
      };
    }

    this._file = newFile;
    // Preview mode persists across switches only when the
    // new file is previewable. Otherwise the split layout
    // falls back to side-by-side diff.
    if (this._previewMode && !this._isPreviewableFile(newFile)) {
      this._previewMode = false;
      this._previewPane = null;
      this._disposeEditor();
      this._editorContainer = null;
    }
    this._showEditor();
    this._dispatchActiveFileChanged();
    this._recomputeDirty();

    // Apply line/search after content is in place.
    if (opts.line != null) this._scrollToLine(opts.line);
    if (opts.searchText) this._scrollToSearchText(opts.searchText);

    // If preview stayed on (the new file is previewable),
    // refresh the pane content for the newly-loaded file.
    if (this._previewMode && this._isPreviewableFile(newFile)) {
      this.updateComplete.then(() => {
        this._updatePreview(newFile.modified);
        if (this._isTexFile(newFile)) {
          this._compileTex(newFile);
        }
      });
    }
  }

  /**
   * Refetch the active file's content and rebuild the
   * model pair. Unsaved edits are discarded (same policy
   * as cross-file switches — the no-cache contract is
   * the whole point).
   *
   * No-op when no real file is active, or when the
   * virtual comparison slot holds content (virtual
   * content has no disk backing to refresh from).
   *
   * Callers: stream-complete after LLM edits,
   * commitResult after a commit, files-reverted after
   * discard-changes, review-mode transitions.
   */
  async refreshActiveFile() {
    if (this._file === null || this._file.isVirtual) return;
    if (this._virtualComparison !== null) return;
    const path = this._file.path;
    // Bump generation so any concurrent openFile supersedes
    // us, not the other way around.
    this._openingGeneration += 1;
    const myGeneration = this._openingGeneration;
    const fetched = await this._fetchFileContent(path);
    if (myGeneration !== this._openingGeneration) return;
    if (!fetched) return;
    this._file = {
      path,
      original: fetched.original,
      modified: fetched.modified,
      savedContent: fetched.modified,
      isNew: fetched.isNew,
      isVirtual: false,
    };
    this._showEditor();
    this._recomputeDirty();
  }

  /**
   * Backwards-compatible alias. App shell callers
   * (stream-complete, commitResult, files-reverted)
   * still invoke refreshOpenFiles; the single-file
   * rewrite collapses the plural to a single file.
   */
  async refreshOpenFiles() {
    await this.refreshActiveFile();
  }

  /**
   * Force Monaco to recompute its layout against the
   * current container size. Called by the app shell on
   * window resize and during dialog resize drags.
   *
   * Monaco caches its layout internally — when the
   * container resizes (dialog gets narrower, window
   * dimensions change), the editor's scrollbars,
   * minimap position, and word-wrap measurements stay
   * at stale dimensions until the next focus / click.
   * `editor.layout()` is the public API Monaco exposes
   * for explicit re-measurement.
   *
   * No-op when the editor hasn't been constructed yet
   * (empty state, or before the first openFile).
   * Swallows layout errors — a detached DOM node can
   * throw from inside Monaco, but we'd rather silently
   * drop the call than let a resize storm crash the
   * shell's RAF loop.
   */
  relayout() {
    if (!this._editor) return;
    try {
      this._editor.layout();
    } catch (err) {
      // Detached DOM during rapid unmount / remount
      // can make Monaco throw. Not fatal.
      console.debug('[diff-viewer] relayout failed', err);
    }
  }

  /**
   * Close the active file and return to empty state.
   * Called by the app-shell's SVG-toggle handler when
   * swapping viewers for a file; no keyboard shortcut
   * path in the single-file model.
   *
   * The `path` argument exists for backwards compatibility
   * with the old multi-file closeFile(path); it's
   * validated against the active file and ignored if it
   * doesn't match.
   */
  closeFile(path) {
    if (path && this._file !== null && this._file.path !== path) {
      return;
    }
    this._file = null;
    this._virtualComparison = null;
    this._disposeEditor();
    this._recomputeDirty();
    this._previewMode = false;
    this._previewPane = null;
    this._dispatchActiveFileChanged();
  }

  /** Single-element array when the active file is dirty, else empty. */
  getDirtyFiles() {
    if (this._file !== null && this._isDirty(this._file)) {
      return [this._file.path];
    }
    return [];
  }

  /** Save the active file if dirty. Single-file semantics. */
  async saveAll() {
    if (this._file !== null && this._isDirty(this._file)) {
      await this._saveFile(this._file.path);
    }
  }

  /**
   * Load arbitrary text content into one panel of the
   * virtual-comparison slot. Two successive loadPanel
   * calls accumulate across the slot's left and right
   * sides — this is the history-browser "Load in Left /
   * Right Panel" workflow.
   *
   * Opening a real file (via openFile) clears the
   * virtual-comparison slot. The two slots are mutually
   * exclusive.
   */
  async loadPanel(content, panel, label) {
    if (panel !== 'left' && panel !== 'right') return;
    const text = typeof content === 'string' ? content : '';
    // Bump generation so a concurrent openFile can't
    // stomp our loadPanel mid-setup.
    this._openingGeneration += 1;

    // If no virtual comparison is active yet, initialize
    // with empty opposite side and clear any real file.
    if (this._virtualComparison === null) {
      this._file = null;
      this._virtualComparison = {
        leftContent: panel === 'left' ? text : '',
        leftLabel: panel === 'left' ? label || '' : '',
        rightContent: panel === 'right' ? text : '',
        rightLabel: panel === 'right' ? label || '' : '',
      };
    } else {
      // Update only the specified panel; the other side's
      // content and label are preserved. This is the
      // accumulation pattern.
      const current = this._virtualComparison;
      this._virtualComparison = {
        leftContent:
          panel === 'left' ? text : current.leftContent,
        leftLabel:
          panel === 'left' ? label || '' : current.leftLabel,
        rightContent:
          panel === 'right' ? text : current.rightContent,
        rightLabel:
          panel === 'right' ? label || '' : current.rightLabel,
      };
    }
    this._showEditor();
    this._recomputeDirty();
    this._dispatchActiveFileChanged();
  }

  /** Whether any content is displayed (real file or virtual comparison). */
  get hasOpenFiles() {
    return this._file !== null || this._virtualComparison !== null;
  }

  // ---------------------------------------------------------------
  // Internals — file loading
  // ---------------------------------------------------------------

  /**
   * Fetch HEAD and working copy content via Repo RPCs.
   * Returns {original, modified, isNew} or null if both
   * fetches fail. Each call is wrapped in its own try/
   * catch so a missing HEAD (new file) doesn't prevent
   * the working copy from loading.
   */
  async _fetchFileContent(path) {
    // Virtual paths short-circuit — their content lives
    // on _virtualComparison / _file directly, no disk
    // fetch ever happens. openFile handles the virtual
    // branch inline and never calls this method for a
    // virtual path; this guard is defensive.
    if (path.startsWith(_VIRTUAL_PREFIX)) {
      return { original: '', modified: '', isNew: false };
    }
    // Defer to our RPC helper if the app shell has
    // published SharedRpc. DiffViewer is host-agnostic —
    // we read SharedRpc directly rather than extending
    // RpcMixin, because the viewer lives outside the
    // dialog and is constructed before the shell's
    // microtask-deferred hooks run in test scenarios.
    const call = this._getRpcCall();
    if (!call) {
      return { original: '', modified: '', isNew: false };
    }
    let original = '';
    let modified = '';
    let isNew = false;
    try {
      const headResult = await call['Repo.get_file_content'](
        path,
        'HEAD',
      );
      original = this._extractRpcContent(headResult);
    } catch (_) {
      // File missing at HEAD — new file.
      isNew = true;
    }
    try {
      const workingResult = await call['Repo.get_file_content'](path);
      modified = this._extractRpcContent(workingResult);
    } catch (_) {
      // Working copy missing — deleted file or transient
      // error. Leave modified empty.
    }
    return { original, modified, isNew };
  }

  /**
   * Extract content from a Repo.get_file_content RPC
   * response. The RPC may return a plain string or an
   * object with a `content` field; handle both.
   */
  _extractRpcContent(result) {
    if (typeof result === 'string') return result;
    if (
      result &&
      typeof result === 'object' &&
      typeof result.content === 'string'
    ) {
      return result.content;
    }
    // jrpc-oo envelope — single key wrapping the response.
    if (result && typeof result === 'object') {
      const keys = Object.keys(result);
      if (keys.length === 1) {
        return this._extractRpcContent(result[keys[0]]);
      }
    }
    return '';
  }

  /**
   * Look up the SharedRpc call proxy. Returns null when
   * the proxy isn't published (pre-connection, or in
   * tests that don't bother with RPC). An optional
   * `__sharedRpcOverride` on globalThis lets tests
   * inject a proxy without touching the singleton.
   */
  _getRpcCall() {
    try {
      const shared = globalThis.__sharedRpcOverride;
      if (shared) return shared;
    } catch (_) {}
    try {
      return SharedRpc.call || null;
    } catch (_) {
      return null;
    }
  }

  // ---------------------------------------------------------------
  // Internals — editor lifecycle
  // ---------------------------------------------------------------

  _showEditor() {
    // Nothing to show in empty state. Dispose runs via
    // closeFile / openFile's clear paths, not here.
    if (this._file === null && this._virtualComparison === null) {
      return;
    }
    // Wait for Lit to commit the template so the editor
    // container div exists.
    const build = () => {
      // Bail if the component was disconnected between
      // scheduling and this frame. Prevents infinite rAF
      // chains when a rapid mount/unmount happens.
      if (!this.isConnected) return;
      const container =
        this.shadowRoot?.querySelector('.editor-container');
      if (!container) {
        // Template hasn't settled — retry next frame.
        requestAnimationFrame(build);
        return;
      }
      this._editorContainer = container;
      this._syncAllStyles();
      this._ensureStyleObserver();
      if (!this._editor) {
        this._createEditor();
      } else {
        this._swapModel();
      }
      this._setReadOnlyForCurrent();
    };
    this.updateComplete.then(build);
  }

  _createEditor() {
    if (!this._editorContainer) return;
    const content = this._currentContent();
    if (!content) return;
    // Install LSP providers on first editor construction.
    // Idempotent across re-creations and across viewer
    // remounts (guard lives on the monaco namespace).
    // The callbacks close over `this` but read current
    // state per-invocation, so file switches and
    // reconnects are picked up automatically. For the
    // virtual-comparison case there's no path to feed
    // to LSP; the providers return empty results.
    installLspProviders(
      monaco,
      () => this._file?.path || '',
      () => this._getRpcCall(),
    );
    // Markdown link provider — makes [text](relative)
    // links Ctrl+clickable inside the editor. The
    // onNavigate callback resolves the path against the
    // current file's directory and dispatches
    // navigate-file on the WINDOW (not this element) so
    // the app shell's full navigation pipeline runs —
    // grid registration, collab broadcast, last-open
    // persistence. Same event channel the picker uses
    // for its file clicks.
    installMarkdownLinkProvider(
      monaco,
      () => this._file?.path || '',
      (relPath) => {
        if (this._file === null) return;
        const resolved = resolveRelativePath(this._file.path, relPath);
        if (!resolved) return;
        window.dispatchEvent(
          new CustomEvent('navigate-file', {
            detail: { path: resolved },
            bubbles: false,
          }),
        );
      },
    );
    try {
      this._editor = monaco.editor.createDiffEditor(
        this._editorContainer,
        {
          theme: 'vs-dark',
          minimap: { enabled: false },
          automaticLayout: true,
          // Side-by-side for normal diff; inline when the
          // preview pane takes the right half of the
          // viewport.
          renderSideBySide: !this._previewMode,
          originalEditable: false,
          readOnly: false,
          scrollBeyondLastLine: false,
        },
      );
      const lang = content.language;
      const original = monaco.editor.createModel(
        content.original || '',
        lang,
      );
      const modified = monaco.editor.createModel(
        content.modified || '',
        lang,
      );
      this._editor.setModel({ original, modified });
      this._setReadOnlyForCurrent();
      this._attachContentChangeListener();
      this._patchCodeEditorService();
    } catch (err) {
      console.error('[diff-viewer] editor creation failed', err);
    }
  }

  _swapModel() {
    if (!this._editor) return;
    const content = this._currentContent();
    if (!content) return;
    try {
      const oldModels = this._editor.getModel();
      const newOriginal = monaco.editor.createModel(
        content.original || '',
        content.language,
      );
      const newModified = monaco.editor.createModel(
        content.modified || '',
        content.language,
      );
      // Disposal order: setModel detaches old, then
      // dispose old. Disposing before setModel throws.
      this._editor.setModel({
        original: newOriginal,
        modified: newModified,
      });
      if (oldModels) {
        try { oldModels.original?.dispose(); } catch (_) {}
        try { oldModels.modified?.dispose(); } catch (_) {}
      }
      // Read-only state goes AFTER setModel — inline diff
      // mode can reset it otherwise.
      this._setReadOnlyForCurrent();
      this._attachContentChangeListener();
    } catch (err) {
      console.error('[diff-viewer] model swap failed', err);
    }
  }

  /**
   * Return the current content pair + language for
   * Monaco model construction. Dispatches by which slot
   * is active.
   *
   * Shape: {original, modified, language, readOnly}.
   * Returns null when both slots are empty.
   */
  _currentContent() {
    if (this._file !== null) {
      return {
        original: this._file.original || '',
        modified: this._file.modified || '',
        language: languageForPath(this._file.path),
        readOnly: !!(this._file.isVirtual || this._file.isReadOnly),
      };
    }
    if (this._virtualComparison !== null) {
      return {
        original: this._virtualComparison.leftContent || '',
        modified: this._virtualComparison.rightContent || '',
        // Virtual comparisons are always plain text —
        // no path to derive language from.
        language: 'plaintext',
        readOnly: true,
      };
    }
    return null;
  }

  _setReadOnlyForCurrent() {
    if (!this._editor) return;
    const modifiedEditor = this._getModifiedEditor();
    if (!modifiedEditor) return;
    const content = this._currentContent();
    const readOnly = !!content?.readOnly;
    try {
      modifiedEditor.updateOptions({ readOnly });
    } catch (_) {
      // Older Monaco versions — harmless.
    }
  }

  _getModifiedEditor() {
    if (!this._editor) return null;
    try {
      return this._editor.getModifiedEditor?.() || null;
    } catch (_) {
      return null;
    }
  }

  _attachContentChangeListener() {
    // Dispose any prior listener (we re-attach on every
    // model swap since each model has its own event
    // stream).
    if (this._contentChangeDisposable) {
      try {
        this._contentChangeDisposable.dispose();
      } catch (_) {}
      this._contentChangeDisposable = null;
    }
    const modifiedEditor = this._getModifiedEditor();
    if (!modifiedEditor) return;
    try {
      this._contentChangeDisposable =
        modifiedEditor.onDidChangeModelContent(
          this._onContentChange,
        );
    } catch (_) {
      // Monaco mock without onDidChangeModelContent —
      // harmless in tests that don't exercise dirty
      // tracking.
    }
    // Scroll listener — only useful in preview mode,
    // only attached when preview is active. Otherwise
    // we'd pay for scroll events on every file.
    this._refreshEditorScrollListener();
  }

  /**
   * Attach the editor-scroll listener when preview is on;
   * detach when off. Called from _attachContentChangeListener
   * (new editor / model swap) and from _togglePreview
   * (entering / leaving preview without a swap).
   */
  _refreshEditorScrollListener() {
    if (this._editorScrollDisposable) {
      try {
        this._editorScrollDisposable.dispose();
      } catch (_) {}
      this._editorScrollDisposable = null;
    }
    if (!this._previewMode) return;
    const modifiedEditor = this._getModifiedEditor();
    if (!modifiedEditor) return;
    try {
      this._editorScrollDisposable =
        modifiedEditor.onDidScrollChange?.(
          this._onEditorScroll,
        ) || null;
    } catch (_) {
      // Mock without onDidScrollChange — scroll sync
      // silently unavailable in that environment.
    }
  }

  // ---------------------------------------------------------------
  // Internals — preview mode (markdown)
  // ---------------------------------------------------------------

  /**
   * Toggle preview mode. Re-renders the template (which
   * adds or removes the preview pane div), then rebuilds
   * the Monaco editor because `renderSideBySide` is a
   * construction-time option — can't be changed on an
   * existing editor, the editor must be recreated.
   */
  _togglePreview() {
    if (this._file === null) return;
    const file = this._file;
    if (!this._isPreviewableFile(file)) return;
    // Detach any preview-pane scroll listener attached
    // to the OLD pane element before Lit replaces the
    // DOM. The old pane is about to be discarded; the
    // listener would leak otherwise.
    this._detachPreviewScrollListener();
    this._previewMode = !this._previewMode;
    // Preview pane reference will be re-acquired after
    // the next render commits. Drop it now so stale
    // references don't leak.
    this._previewPane = null;
    // Disposing the editor forces a fresh createDiffEditor
    // call with the new renderSideBySide option. The Lit
    // render committing `_previewMode` also moves the
    // editor container div to its new location in the
    // split layout.
    this._disposeEditor();
    this._editorContainer = null;
    // Schedule a rebuild after Lit commits the new
    // template. _showEditor handles container lookup + rAF
    // retries; we just need to trigger it once the DOM
    // reflects the new layout.
    this.updateComplete.then(() => {
      this._showEditor();
      // If entering preview, populate the pane with
      // current content and wire up scroll sync.
      // Leaving preview — no-op, the pane is gone.
      if (this._previewMode) {
        this._updatePreview(file.modified);
        this._attachPreviewScrollListener();
        // For TeX, entering preview also kicks off the
        // first compile. Markdown renders synchronously
        // in _updatePreview; TeX needs the async RPC.
        if (this._isTexFile(file)) {
          this._compileTex(file);
        }
      }
    });
  }

  /**
   * Render content into the preview pane. Dispatches by
   * file type — markdown renders live from the current
   * editor content; TeX renders from the cached compile
   * state (`_texPreviewStates`) which is updated by
   * `_compileTex` on preview entry and on save.
   *
   * For TeX files without any compile state yet, shows
   * a "Save to preview" placeholder. The availability
   * check + first compile run on preview entry via
   * `_compileTex`; this method just reflects state.
   */
  _updatePreview(content) {
    // Re-acquire the pane reference if Lit just
    // committed a new template (entering preview mode).
    if (!this._previewPane) {
      this._previewPane =
        this.shadowRoot?.querySelector('.preview-pane') || null;
    }
    if (!this._previewPane) return;
    if (this._file === null) return;
    if (this._isTexFile(this._file)) {
      this._renderTexPreviewFromState();
      return;
    }
    // Markdown path — render live from content.
    try {
      const html = renderMarkdownWithSourceMap(content || '');
      this._previewPane.innerHTML = html;
    } catch (err) {
      // Should never fire — renderMarkdownWithSourceMap
      // catches internally and degrades to escaped text.
      // Defensive log in case something else throws.
      console.error('[diff-viewer] preview render failed', err);
    }
    // Bump generation and resolve relative image refs.
    // Image resolution is async (RPC fetches) and
    // fire-and-forget; the generation check inside the
    // resolver discards stale DOM writes from earlier
    // renders.
    this._imageResolveGeneration += 1;
    this._resolvePreviewImages(this._imageResolveGeneration);
  }

  /**
   * Write the TeX preview pane's content from the
   * cached state. Four possible states:
   *   - loading — show spinner/"Compiling…" message
   *   - error + installHint — installation instructions
   *   - error without hint — error message + log
   *   - html — the compiled output
   *   - absent — "Save to preview" placeholder
   */
  /**
   * Write the TeX preview pane's content from the
   * active file's compile state. State lives on the
   * file object itself (`_file.texCompile`) in the
   * single-file model — no separate map.
   */
  _renderTexPreviewFromState() {
    if (!this._previewPane) {
      this._previewPane =
        this.shadowRoot?.querySelector('.preview-pane') || null;
    }
    if (!this._previewPane) return;
    if (this._file === null) return;
    const state = this._file.texCompile;
    if (!state) {
      this._previewPane.innerHTML =
        '<div class="tex-preview-placeholder">' +
        'Save the file to compile and preview.</div>';
      return;
    }
    if (state.loading) {
      this._previewPane.innerHTML =
        '<div class="tex-preview-loading">Compiling…</div>';
      return;
    }
    if (state.error) {
      this._previewPane.innerHTML = this._renderTexError(state);
      return;
    }
    if (state.html) {
      this._previewPane.innerHTML = state.html;
      return;
    }
    this._previewPane.innerHTML =
      '<div class="tex-preview-placeholder">' +
      'No preview available.</div>';
  }

  /**
   * Build the error HTML for a failed TeX compilation.
   * Install-hint case gets a distinct style since it's
   * the "you need to install something" path rather
   * than a code-level compile error.
   */
  _renderTexError(state) {
    const parts = [];
    if (state.installHint) {
      parts.push(
        '<div class="tex-preview-install-hint">',
        '<strong>TeX preview requires make4ht.</strong>',
        '<p>' + _escapeHtml(state.installHint) + '</p>',
        '</div>',
      );
    } else {
      parts.push(
        '<div class="tex-preview-error">',
        '<strong>Compilation failed.</strong>',
        '<p>' + _escapeHtml(state.error || 'Unknown error') + '</p>',
        '</div>',
      );
    }
    if (state.log) {
      parts.push(
        '<details class="tex-preview-log">',
        '<summary>Compilation log</summary>',
        '<pre>' + _escapeHtml(state.log) + '</pre>',
        '</details>',
      );
    }
    return parts.join('');
  }

  /**
   * Compile the active TeX file via `Repo.compile_tex_preview`
   * and update the preview pane. Runs the availability
   * probe on first call if not cached.
   *
   * Uses a generation counter to discard stale results —
   * if the user saves quickly twice, only the latest
   * compile's output lands in the pane.
   */
  async _compileTex(file) {
    if (!this._isTexFile(file)) return;
    const path = file.path;
    const gen = ++this._texCompileGeneration;
    // Helper: write compile state onto the active file
    // IF it's still the one we started compiling for.
    // Rapid file switches bump _openingGeneration; if
    // this._file changes out from under us we skip the
    // state write (nothing to write to — file is gone).
    const setState = (state) => {
      if (this._file === null || this._file.path !== path) return;
      this._file = { ...this._file, texCompile: state };
      this._renderTexPreviewIfActive(path);
    };
    // Show loading state immediately so the pane isn't
    // blank during the async probe + compile.
    setState({ loading: true });
    // Run availability probe once per session. Cached
    // outcome applies to every subsequent .tex file.
    const call = this._getRpcCall();
    if (!call) {
      if (gen !== this._texCompileGeneration) return;
      setState({ error: 'RPC unavailable' });
      return;
    }
    if (this._texPreviewAvailable === null) {
      try {
        const result = await call['Repo.is_tex_preview_available']();
        const unwrapped = this._unwrapRpc(result);
        if (unwrapped &&
            typeof unwrapped === 'object' &&
            unwrapped.available === false) {
          this._texPreviewAvailable = false;
          if (gen !== this._texCompileGeneration) return;
          setState({
            error: 'make4ht not installed',
            installHint:
              unwrapped.install_hint ||
              'Install TeX Live or MiKTeX to enable TeX preview.',
          });
          return;
        }
        this._texPreviewAvailable = true;
      } catch (err) {
        // Probe failed — treat as unavailable.
        this._texPreviewAvailable = false;
        if (gen !== this._texCompileGeneration) return;
        setState({
          error: 'Availability check failed',
          installHint:
            'Ensure make4ht is installed and on PATH.',
        });
        return;
      }
    }
    if (this._texPreviewAvailable === false) {
      if (gen !== this._texCompileGeneration) return;
      setState({
        error: 'make4ht not installed',
        installHint:
          'Install TeX Live or MiKTeX to enable TeX preview.',
      });
      return;
    }
    // Run the compile.
    let result;
    try {
      result = await call['Repo.compile_tex_preview'](
        file.modified || '',
        path,
      );
    } catch (err) {
      if (gen !== this._texCompileGeneration) return;
      setState({ error: err?.message || 'Compilation RPC failed' });
      return;
    }
    if (gen !== this._texCompileGeneration) return;
    const unwrapped = this._unwrapRpc(result);
    if (unwrapped && unwrapped.error) {
      setState({
        error: unwrapped.error,
        log: unwrapped.log,
        installHint: unwrapped.install_hint,
      });
    } else if (unwrapped && typeof unwrapped.html === 'string') {
      // Full pipeline: math → source-line annotation.
      const mathed = renderTexMath(unwrapped.html);
      const anchors = extractTexAnchors(file.modified || '');
      const totalLines = (file.modified || '').split('\n').length;
      const annotated = injectSourceLines(
        mathed,
        anchors,
        totalLines,
      );
      setState({ html: annotated });
    } else {
      setState({ error: 'Malformed compile response' });
    }
  }

  /**
   * Refresh the preview pane if the given path is the
   * currently-active file AND preview mode is on.
   * Avoids writing to the pane for a file that isn't
   * showing.
   */
  _renderTexPreviewIfActive(path) {
    if (!this._previewMode) return;
    if (this._file === null) return;
    if (this._file.path !== path) return;
    this._renderTexPreviewFromState();
  }

  /**
   * Unwrap a jrpc-oo envelope. jrpc-oo returns responses
   * wrapped as `{uuid: payload}` — a single key whose
   * value is the real payload. But in tests that inject
   * a direct-call fake proxy, the RPC function returns
   * the payload directly (no wrapping). We distinguish
   * by inspecting the inner value's shape: if the single
   * key's value is itself an object, treat it as an
   * envelope and unwrap. Otherwise the outer object IS
   * the payload (e.g. `{available: true}` or `{html: "..."}`
   * are payloads, not envelopes).
   *
   * This heuristic works because real envelope keys are
   * UUIDs (opaque strings) wrapping structured dicts,
   * never wrapping primitives.
   */
  _unwrapRpc(result) {
    if (!result || typeof result !== 'object') return result;
    if (Array.isArray(result)) return result;
    const keys = Object.keys(result);
    if (keys.length !== 1) return result;
    const inner = result[keys[0]];
    // Unwrap only if the inner value is a non-array
    // object — that's the jrpc-oo envelope shape.
    // Primitive or array inner → the outer object was
    // the payload (e.g. `{html: "..."}` or `{available:
    // true}`), return as-is.
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      return inner;
    }
    return result;
  }

  /**
   * Wire up bidirectional scroll sync. The preview pane
   * emits scroll events we bind directly; the editor
   * side is wired in _refreshEditorScrollListener. Safe
   * to call when preview mode is off — it'll be a no-op
   * because the pane won't exist yet.
   */
  _attachPreviewScrollListener() {
    if (!this._previewPane) {
      this._previewPane =
        this.shadowRoot?.querySelector('.preview-pane') || null;
    }
    if (!this._previewPane) return;
    this._previewPane.addEventListener(
      'scroll',
      this._onPreviewScroll,
      { passive: true },
    );
    // Relative-link click interception — same lifecycle
    // as scroll sync (only relevant in preview mode).
    this._previewPane.addEventListener(
      'click',
      this._onPreviewClick,
    );
    // Scroll listener on the editor side too — scope this
    // attach to preview mode since the listener is only
    // meaningful here.
    this._refreshEditorScrollListener();
  }

  _detachPreviewScrollListener() {
    if (this._previewPane) {
      try {
        this._previewPane.removeEventListener(
          'scroll',
          this._onPreviewScroll,
        );
      } catch (_) {}
      try {
        this._previewPane.removeEventListener(
          'click',
          this._onPreviewClick,
        );
      } catch (_) {}
    }
  }

  /**
   * Acquire the scroll lock for `side` ('editor' or
   * 'preview') and auto-release after a short window.
   * During the lock the other side's scroll handler
   * skips, preventing feedback loops.
   */
  _acquireScrollLock(side) {
    this._scrollLock = side;
    if (this._scrollLockTimer) {
      clearTimeout(this._scrollLockTimer);
    }
    this._scrollLockTimer = setTimeout(() => {
      this._scrollLock = null;
      this._scrollLockTimer = null;
    }, _SCROLL_LOCK_MS);
  }

  /**
   * Collect scroll anchors from the preview pane — one
   * per block element carrying data-source-line. Returns
   * a deduped, monotonically-increasing list of
   * {line, offsetTop} pairs ready for binary search.
   *
   * Dedup — first element per source line wins. Some
   * nested block elements emit the same source-line
   * attribute; keeping the first is both cheapest and
   * visually correct (outermost block).
   *
   * Monotonicity — sort by offsetTop ascending and drop
   * any anchor whose offsetTop is less than the running
   * maximum. Nested containers can have inner children
   * with earlier offsetTop than an already-seen outer
   * block; including them would make the binary search
   * jumpy.
   */
  _collectPreviewAnchors() {
    if (!this._previewPane) return [];
    const raw = this._previewPane.querySelectorAll(
      '[data-source-line]',
    );
    const seen = new Set();
    const entries = [];
    for (const el of raw) {
      const line = parseInt(el.dataset.sourceLine, 10);
      if (!Number.isFinite(line)) continue;
      if (seen.has(line)) continue;
      seen.add(line);
      entries.push({ line, offsetTop: el.offsetTop });
    }
    entries.sort((a, b) => a.offsetTop - b.offsetTop);
    let lastTop = -Infinity;
    return entries.filter((e) => {
      if (e.offsetTop < lastTop) return false;
      lastTop = e.offsetTop;
      return true;
    });
  }

  /**
   * Editor scrolled — map the top visible line to an
   * anchor in the preview pane and scroll the preview to
   * match. Skips when the lock is held by the other side.
   */
  _onEditorScroll() {
    if (this._scrollLock === 'preview') return;
    if (!this._previewMode || !this._previewPane) return;
    const modifiedEditor = this._getModifiedEditor();
    if (!modifiedEditor) return;
    let topLine;
    try {
      const scrollTop = modifiedEditor.getScrollTop?.() ?? 0;
      const lineHeight = this._getLineHeight(modifiedEditor);
      topLine = Math.floor(scrollTop / lineHeight) + 1;
    } catch (_) {
      return;
    }
    const anchors = this._collectPreviewAnchors();
    if (anchors.length === 0) return;
    const targetTop = this._mapLineToOffsetTop(anchors, topLine);
    if (targetTop == null) return;
    this._acquireScrollLock('editor');
    this._previewPane.scrollTop = targetTop;
  }

  /**
   * Preview scrolled — find the anchor at/just before
   * the current scrollTop and scroll the editor to that
   * source line. Skips when the lock is held by the
   * editor side.
   */
  _onPreviewScroll() {
    if (this._scrollLock === 'editor') return;
    if (!this._previewMode || !this._previewPane) return;
    const modifiedEditor = this._getModifiedEditor();
    if (!modifiedEditor) return;
    const scrollTop = this._previewPane.scrollTop;
    const anchors = this._collectPreviewAnchors();
    if (anchors.length === 0) return;
    const targetLine = this._mapOffsetTopToLine(anchors, scrollTop);
    if (targetLine == null) return;
    this._acquireScrollLock('preview');
    try {
      const lineHeight = this._getLineHeight(modifiedEditor);
      const targetScroll = (targetLine - 1) * lineHeight;
      modifiedEditor.setScrollTop?.(targetScroll);
    } catch (_) {}
  }

  /**
   * Binary-search anchors by source line. Returns the
   * interpolated offsetTop between the matched anchor
   * and the next one. Past the last anchor, falls back
   * to proportional mapping so reaching the editor
   * bottom scrolls the preview to its bottom too.
   */
  _mapLineToOffsetTop(anchors, line) {
    if (anchors.length === 0) return null;
    // Below the first anchor — return its position.
    if (line <= anchors[0].line) return anchors[0].offsetTop;
    // Past the last — proportional fallback against
    // remaining preview scroll range.
    const last = anchors[anchors.length - 1];
    if (line >= last.line) {
      if (!this._previewPane) return last.offsetTop;
      const total = this._previewPane.scrollHeight -
        this._previewPane.clientHeight;
      const maxEditorLines = this._getEditorLineCount();
      if (!maxEditorLines || line >= maxEditorLines) {
        return total;
      }
      const frac = (line - last.line) /
        (maxEditorLines - last.line);
      return last.offsetTop +
        frac * (total - last.offsetTop);
    }
    // Interpolate between the two anchors straddling
    // `line`.
    let lo = 0;
    let hi = anchors.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (anchors[mid].line <= line) lo = mid;
      else hi = mid;
    }
    const a = anchors[lo];
    const b = anchors[hi];
    if (a.line === b.line) return a.offsetTop;
    const t = (line - a.line) / (b.line - a.line);
    return a.offsetTop + t * (b.offsetTop - a.offsetTop);
  }

  /**
   * Inverse of _mapLineToOffsetTop — find the source
   * line corresponding to a preview scroll position.
   */
  _mapOffsetTopToLine(anchors, offsetTop) {
    if (anchors.length === 0) return null;
    if (offsetTop <= anchors[0].offsetTop) return anchors[0].line;
    const last = anchors[anchors.length - 1];
    if (offsetTop >= last.offsetTop) {
      if (!this._previewPane) return last.line;
      const total = this._previewPane.scrollHeight -
        this._previewPane.clientHeight;
      const maxEditorLines = this._getEditorLineCount();
      if (!maxEditorLines || total <= last.offsetTop) {
        return last.line;
      }
      const frac = (offsetTop - last.offsetTop) /
        (total - last.offsetTop);
      return Math.round(
        last.line + frac * (maxEditorLines - last.line),
      );
    }
    let lo = 0;
    let hi = anchors.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (anchors[mid].offsetTop <= offsetTop) lo = mid;
      else hi = mid;
    }
    const a = anchors[lo];
    const b = anchors[hi];
    if (a.offsetTop === b.offsetTop) return a.line;
    const t = (offsetTop - a.offsetTop) /
      (b.offsetTop - a.offsetTop);
    return Math.round(a.line + t * (b.line - a.line));
  }

  _getLineHeight(modifiedEditor) {
    try {
      const opts = modifiedEditor.getOption?.(
        monaco.editor.EditorOption?.lineHeight,
      );
      if (typeof opts === 'number' && opts > 0) return opts;
    } catch (_) {}
    // Reasonable default — matches Monaco's dark theme.
    return 19;
  }

  _getEditorLineCount() {
    const modifiedEditor = this._getModifiedEditor();
    if (!modifiedEditor) return 0;
    try {
      const model = modifiedEditor.getModel?.();
      return model?.getLineCount?.() || 0;
    } catch (_) {
      return 0;
    }
  }

  /**
   * Resolve relative image refs in the rendered preview.
   * Runs as a post-processing step after _updatePreview;
   * the `generation` argument lets us discard stale
   * fetches when a newer render has already landed.
   *
   * Resolution rules (spec-mandated):
   *   - Skip absolute URLs (http, https, data, blob)
   *   - Decode percent-encoded characters (undoes
   *     encodeImagePaths that renderMarkdownWithSourceMap
   *     applied for marked compatibility)
   *   - Resolve relative path against the current file's
   *     directory
   *   - SVG files fetched as text via Repo.get_file_content
   *     and injected as data:image/svg+xml;charset=utf-8,…
   *   - Other images fetched via Repo.get_file_base64
   *     which already returns a data URI
   *   - Failed loads degrade gracefully: alt text
   *     indicates the problem, image dimmed via opacity
   */
  async _resolvePreviewImages(generation) {
    if (this._file === null) return;
    if (!this._previewPane) return;
    const file = this._file;
    const imgs = this._previewPane.querySelectorAll('img');
    if (imgs.length === 0) return;
    const call = this._getRpcCall();
    if (!call) return;
    // Resolve in parallel; each promise settles
    // independently so one failure doesn't block other
    // images.
    const tasks = [];
    for (const img of imgs) {
      const src = img.getAttribute('src') || '';
      if (!src) continue;
      if (this._isAbsoluteUrl(src)) continue;
      tasks.push(this._resolveOneImage(img, src, file, call, generation));
    }
    // No need to await Promise.all — fire-and-forget is
    // correct here, each task updates its own img when
    // ready.
    Promise.all(tasks).catch(() => {
      // Individual failures already handled inside
      // _resolveOneImage; this catch is purely defensive
      // in case the gather itself throws.
    });
  }

  async _resolveOneImage(img, src, file, call, generation) {
    let relPath;
    try {
      // Decode percent-encoding first — the preview
      // renderer encoded spaces as %20 for marked
      // compatibility, but Repo RPCs want the literal
      // filesystem path.
      relPath = decodeURIComponent(src);
    } catch (_) {
      relPath = src;
    }
    const resolved = resolveRelativePath(file.path, relPath);
    if (!resolved || this._isAbsoluteUrl(resolved)) return;
    const isSvg = resolved.toLowerCase().endsWith('.svg');
    try {
      let dataUri;
      if (isSvg) {
        const result = await call['Repo.get_file_content'](resolved);
        const text = this._extractRpcContent(result);
        if (!text) {
          this._markImageMissing(img, resolved, generation);
          return;
        }
        dataUri =
          'data:image/svg+xml;charset=utf-8,' +
          encodeURIComponent(text);
      } else {
        const result = await call['Repo.get_file_base64'](resolved);
        dataUri = this._extractBase64Uri(result);
        if (!dataUri) {
          this._markImageMissing(img, resolved, generation);
          return;
        }
      }
      if (generation !== this._imageResolveGeneration) return;
      img.setAttribute('src', dataUri);
    } catch (err) {
      this._markImageFailed(img, resolved, err, generation);
    }
  }

  /**
   * Extract the data URI from a Repo.get_file_base64
   * response. Handles the same three shapes as
   * _extractRpcContent — plain string, object with a
   * `data_uri` field, or jrpc-oo single-key envelope.
   */
  _extractBase64Uri(result) {
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object') {
      if (typeof result.data_uri === 'string') return result.data_uri;
      if (typeof result.content === 'string') return result.content;
      const keys = Object.keys(result);
      if (keys.length === 1) {
        return this._extractBase64Uri(result[keys[0]]);
      }
    }
    return '';
  }

  _isAbsoluteUrl(url) {
    if (typeof url !== 'string') return false;
    return (
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      url.startsWith('http://') ||
      url.startsWith('https://')
    );
  }

  _markImageMissing(img, path, generation) {
    if (generation !== this._imageResolveGeneration) return;
    img.setAttribute('alt', `[Image not found: ${path}]`);
    img.style.opacity = '0.4';
  }

  _markImageFailed(img, path, err, generation) {
    if (generation !== this._imageResolveGeneration) return;
    const message = err?.message || 'unknown error';
    img.setAttribute(
      'alt',
      `[Failed to load: ${path} — ${message}]`,
    );
    img.style.opacity = '0.4';
  }

  /**
   * Intercept clicks on relative <a href> elements in
   * the preview pane. Absolute URLs (http, https, mailto,
   * file, etc.) and fragment-only refs pass through to
   * the browser's default behavior. Relative paths
   * resolve against the current file's directory and
   * dispatch navigate-file events for the app shell to
   * route.
   */
  _onPreviewClick(event) {
    const anchor = event.target?.closest?.('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href) return;
    if (this._isAbsoluteUrl(href)) return;
    if (href.startsWith('#')) return;
    // Absolute-path refs starting with / fall through to
    // the browser; the repo has no concept of root-anchored
    // links.
    if (href.startsWith('/')) return;
    // mailto:, tel:, etc. — anything with a scheme prefix.
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return;
    if (this._file === null) return;
    let relPath;
    try {
      relPath = decodeURIComponent(href);
    } catch (_) {
      relPath = href;
    }
    // Strip fragment — navigate-file carries just the path.
    const hashIdx = relPath.indexOf('#');
    const pathPart =
      hashIdx >= 0 ? relPath.slice(0, hashIdx) : relPath;
    const resolved = resolveRelativePath(this._file.path, pathPart);
    if (!resolved || this._isAbsoluteUrl(resolved)) return;
    event.preventDefault();
    // Dispatch on window (not this element) so the app
    // shell's navigation pipeline runs — same rationale
    // as the Monaco cross-file-nav patch above.
    window.dispatchEvent(
      new CustomEvent('navigate-file', {
        detail: { path: resolved },
        bubbles: false,
      }),
    );
  }

  /**
   * Whether the active file is an SVG — the "🎨 Visual"
   * button is rendered only for these.
   */
  _isSvgFile(file) {
    if (!file || typeof file.path !== 'string') return false;
    return file.path.toLowerCase().endsWith('.svg');
  }

  /**
   * Dispatch toggle-svg-mode to switch from the text diff
   * editor to the visual SVG viewer.
   */
  _switchToVisualSvg() {
    if (this._file === null) return;
    const file = this._file;
    // Read live content from the editor.
    const modifiedEditor = this._getModifiedEditor();
    let content = file.modified;
    try {
      content = modifiedEditor?.getValue?.() ?? file.modified;
    } catch (_) {}
    this.dispatchEvent(
      new CustomEvent('toggle-svg-mode', {
        detail: {
          path: file.path,
          target: 'visual',
          modified: content,
          savedContent: file.savedContent,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _onContentChange() {
    // Only real files fire content-change that we care
    // about. Virtual comparisons are read-only; Monaco
    // enforces it but defensive guard here too.
    if (this._file === null) return;
    if (this._file.isVirtual || this._file.isReadOnly) return;
    const modifiedEditor = this._getModifiedEditor();
    if (!modifiedEditor) return;
    try {
      const value = modifiedEditor.getValue();
      this._file = { ...this._file, modified: value };
    } catch (_) {
      // Model disposed between events and handler — skip.
      return;
    }
    this._recomputeDirty();
    // Live preview — when preview mode is on, re-render
    // on every keystroke. Markdown uses renderMarkdownWith
    // SourceMap which is pure string work, cheap enough
    // per-key. TeX preview deliberately does NOT live-
    // update — make4ht compilation is subprocess-bound and
    // too expensive for keystroke frequency. TeX preview
    // refreshes on save via _saveFile.
    if (this._previewMode && this._isMarkdownFile(this._file)) {
      this._updatePreview(this._file.modified);
    }
  }

  _patchCodeEditorService() {
    if (this._editorServicePatched) return;
    const modifiedEditor = this._getModifiedEditor();
    if (!modifiedEditor) return;
    const svc = modifiedEditor._codeEditorService;
    if (!svc || typeof svc.openCodeEditor !== 'function') return;
    this._editorServicePatched = true;
    svc.openCodeEditor = async (input, source, _sideBySide) => {
      // Monaco's contract: return the editor that will
      // display the target. In the single-file no-cache
      // model we swap the viewer's file in place via the
      // app shell's navigate-file pipeline, then return
      // the same `source` editor — once the swap's async
      // chain settles, Monaco's follow-up selection /
      // reveal apply to the new model in this same
      // editor widget. Calling the original openCodeEditor
      // here (the standalone build's fallback) throws
      // because its returned opener has no openCodeEditor
      // method — Monaco's _openReference would then call
      // .openCodeEditor on undefined and crash.
      try {
        const uri = input?.resource;
        if (uri) {
          let path = uri.path || '';
          if (path.startsWith('/')) path = path.slice(1);
          const line =
            input.options?.selection?.startLineNumber;
          if (path) {
            window.dispatchEvent(
              new CustomEvent('navigate-file', {
                detail: { path, line },
                bubbles: false,
              }),
            );
          }
        }
      } catch (err) {
        console.warn('[diff-viewer] cross-file nav failed', err);
      }
      return source || null;
    };
  }

  _disposeEditor() {
    // Dispose order: editor first (releases model
    // references), then models.
    if (this._contentChangeDisposable) {
      try {
        this._contentChangeDisposable.dispose();
      } catch (_) {}
      this._contentChangeDisposable = null;
    }
    if (this._editorScrollDisposable) {
      try {
        this._editorScrollDisposable.dispose();
      } catch (_) {}
      this._editorScrollDisposable = null;
    }
    this._detachPreviewScrollListener();
    if (this._scrollLockTimer) {
      clearTimeout(this._scrollLockTimer);
      this._scrollLockTimer = null;
    }
    this._scrollLock = null;
    if (this._editor) {
      const models = this._editor.getModel?.();
      try {
        this._editor.dispose();
      } catch (_) {}
      this._editor = null;
      if (models) {
        try { models.original?.dispose(); } catch (_) {}
        try { models.modified?.dispose(); } catch (_) {}
      }
    }
    this._editorServicePatched = false;
  }

  // ---------------------------------------------------------------
  // Internals — shadow DOM style sync
  // ---------------------------------------------------------------

  /**
   * Clone all document.head styles into the shadow root.
   * Runs every editor creation; removes prior clones
   * first so the count doesn't grow across re-creations.
   */
  _syncAllStyles() {
    if (!this.shadowRoot) return;
    // Remove prior clones.
    const prior = this.shadowRoot.querySelectorAll(
      `[data-${_CLONED_STYLE_MARKER.replace(
        /([A-Z])/g,
        '-$1',
      ).toLowerCase()}]`,
    );
    for (const el of prior) el.remove();
    // Clone current head styles + linked stylesheets.
    const heads = document.head.querySelectorAll('style, link');
    for (const el of heads) {
      if (el.tagName === 'LINK') {
        const rel = (el.getAttribute('rel') || '').toLowerCase();
        if (rel !== 'stylesheet') continue;
      }
      const clone = el.cloneNode(true);
      clone.dataset[_CLONED_STYLE_MARKER] = 'true';
      this.shadowRoot.appendChild(clone);
    }
    this._ensureKatexCss();
  }

  /**
   * Inject the KaTeX stylesheet into the shadow root if
   * not already present. Idempotent — only one copy ever
   * lives in the shadow root regardless of how many
   * times _syncAllStyles runs. Content falls back to a
   * placeholder when the ?raw import didn't resolve (see
   * module-level import); the mechanism still runs so
   * tests can verify the injection path.
   */
  _ensureKatexCss() {
    if (!this.shadowRoot) return;
    // Convert camelCase marker to kebab-case for the
    // attribute selector.
    const attrName = _KATEX_CSS_MARKER.replace(
      /([A-Z])/g,
      '-$1',
    ).toLowerCase();
    const existing = this.shadowRoot.querySelector(
      `[data-${attrName}]`,
    );
    if (existing) return;
    const style = document.createElement('style');
    style.dataset[_KATEX_CSS_MARKER] = 'true';
    style.textContent = katexCssText;
    this.shadowRoot.appendChild(style);
  }

  _ensureStyleObserver() {
    if (this._styleObserver) return;
    if (typeof MutationObserver === 'undefined') return;
    try {
      this._styleObserver = new MutationObserver(
        this._onHeadMutation,
      );
      this._styleObserver.observe(document.head, {
        childList: true,
      });
    } catch (_) {
      // No MutationObserver — full re-sync on every
      // editor creation is the fallback.
    }
  }

  _disposeStyleObserver() {
    if (this._styleObserver) {
      try {
        this._styleObserver.disconnect();
      } catch (_) {}
      this._styleObserver = null;
    }
  }

  _onHeadMutation(mutations) {
    if (!this.shadowRoot) return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (
          node.nodeType === 1 &&
          (node.tagName === 'STYLE' || node.tagName === 'LINK')
        ) {
          if (node.tagName === 'LINK') {
            const rel = (
              node.getAttribute('rel') || ''
            ).toLowerCase();
            if (rel !== 'stylesheet') continue;
          }
          const clone = node.cloneNode(true);
          clone.dataset[_CLONED_STYLE_MARKER] = 'true';
          this.shadowRoot.appendChild(clone);
        }
      }
      for (const node of m.removedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName !== 'STYLE' && node.tagName !== 'LINK') {
          continue;
        }
        // Find clones matching by textContent (styles)
        // or href (links) and remove them.
        const clones = this.shadowRoot.querySelectorAll(
          `[data-${_CLONED_STYLE_MARKER.replace(
            /([A-Z])/g,
            '-$1',
          ).toLowerCase()}]`,
        );
        for (const c of clones) {
          if (
            (node.tagName === 'STYLE' &&
              c.textContent === node.textContent) ||
            (node.tagName === 'LINK' &&
              c.getAttribute('href') === node.getAttribute('href'))
          ) {
            c.remove();
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------
  // Internals — diff-ready waiter
  // ---------------------------------------------------------------
  //
  // Per-file viewport state is not preserved in the
  // no-cache model — every openFile starts fresh at
  // (1, 1) with scrollTop 0. Users who accept the
  // no-cache trade-off also accept losing the viewport
  // on file switch. The wait-for-diff-ready helper is
  // still needed for scroll-to-line and
  // scroll-to-search-text, which run after the diff
  // computation has produced its layout.

  /**
   * Resolve after Monaco's diff computation settles.
   * Registers a one-shot onDidUpdateDiff listener with a
   * fallback timeout for identical-content files (which
   * never fire the event). specs4 calls this out
   * explicitly.
   *
   * In the single-file rewrite, openFile calls
   * _showEditor which creates the editor asynchronously
   * via updateComplete.then — so when openFile follows
   * up with _scrollToSearchText or _scrollToLine, the
   * editor may not exist yet. We poll across animation
   * frames up to a 500ms ceiling waiting for it to
   * appear, THEN attach the diff-ready listener. If the
   * ceiling is reached without an editor, resolve so
   * callers degrade gracefully (the scroll just won't
   * happen — same as the pre-rewrite "no open file"
   * path).
   */
  _waitForDiffReady() {
    return new Promise((resolve) => {
      const maxWaitMs = 500;
      const startedAt = performance.now();
      const waitForEditor = () => {
        if (this._editor) {
          attachDiffReadyListener();
          return;
        }
        if (performance.now() - startedAt >= maxWaitMs) {
          resolve();
          return;
        }
        requestAnimationFrame(waitForEditor);
      };
      const attachDiffReadyListener = () => {
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          requestAnimationFrame(resolve);
        };
        try {
          const disposable = this._editor.onDidUpdateDiff?.(() => {
            try { disposable?.dispose(); } catch (_) {}
            settle();
          });
          if (!disposable) {
            // Mock editor without the event — fall
            // through to timeout.
          }
        } catch (_) {
          // Same fallback.
        }
        setTimeout(settle, _DIFF_READY_TIMEOUT_MS);
      };
      waitForEditor();
    });
  }

  _scrollToLine(line) {
    this._waitForDiffReady().then(() => {
      const modifiedEditor = this._getModifiedEditor();
      if (!modifiedEditor) return;
      try {
        modifiedEditor.revealLineInCenter?.(line);
        modifiedEditor.setPosition?.({ lineNumber: line, column: 1 });
      } catch (_) {}
    });
  }

  _scrollToSearchText(text) {
    if (!text) return;
    this._waitForDiffReady().then(() => {
      const modifiedEditor = this._getModifiedEditor();
      if (!modifiedEditor) return;
      const model = modifiedEditor.getModel?.();
      if (!model) return;
      // Try progressively shorter prefixes to handle
      // whitespace drift between anchor text and file
      // content.
      const candidates = this._searchCandidates(text);
      for (const candidate of candidates) {
        try {
          const matches = model.findMatches?.(
            candidate,
            true, // searchOnlyEditableRange
            false, // isRegex
            false, // matchCase
            null, // wordSeparators
            false, // captureMatches
          );
          if (matches && matches.length > 0) {
            const range = matches[0].range;
            modifiedEditor.revealRangeInCenter?.(range);
            this._applyHighlight(modifiedEditor, range);
            return;
          }
        } catch (_) {
          // Mock findMatches — skip.
        }
      }
    });
  }

  _searchCandidates(text) {
    const lines = text.split('\n').filter((l) => l.trim());
    if (lines.length === 0) return [text];
    // Try full text, then first two lines, then first
    // line only — progressively shorter prefixes match
    // even when trailing lines drifted.
    const candidates = [text];
    if (lines.length > 2) candidates.push(lines.slice(0, 2).join('\n'));
    if (lines.length > 1) candidates.push(lines[0]);
    return candidates;
  }

  _applyHighlight(editor, range) {
    try {
      if (this._highlightTimer) {
        clearTimeout(this._highlightTimer);
        this._highlightTimer = null;
      }
      this._highlightDecorations =
        editor.deltaDecorations?.(
          this._highlightDecorations,
          [
            {
              range,
              options: {
                isWholeLine: true,
                className: 'highlight-decoration',
                overviewRuler: {
                  color: '#4fc3f7',
                  position: monaco.editor.OverviewRulerLane?.Full ?? 7,
                },
              },
            },
          ],
        ) || [];
      this._highlightTimer = setTimeout(() => {
        this._highlightTimer = null;
        try {
          this._highlightDecorations = editor.deltaDecorations?.(
            this._highlightDecorations,
            [],
          ) || [];
        } catch (_) {}
      }, _HIGHLIGHT_DURATION_MS);
    } catch (_) {}
  }

  // ---------------------------------------------------------------
  // Internals — dirty tracking & saving
  // ---------------------------------------------------------------

  _isDirty(file) {
    if (!file) return false;
    if (file.isVirtual || file.isReadOnly) return false;
    return file.modified !== file.savedContent;
  }

  /**
   * Whether the active file is markdown — the Preview
   * button is rendered only for these. Case-insensitive
   * extension match to catch `.MD`.
   */
  _isMarkdownFile(file) {
    if (!file || typeof file.path !== 'string') return false;
    const lower = file.path.toLowerCase();
    return lower.endsWith('.md') || lower.endsWith('.markdown');
  }

  /**
   * Whether the active file is TeX — shows Preview
   * button, uses the compile-on-save pipeline via
   * make4ht rather than live keystroke rendering.
   */
  _isTexFile(file) {
    if (!file || typeof file.path !== 'string') return false;
    const lower = file.path.toLowerCase();
    return lower.endsWith('.tex') || lower.endsWith('.latex');
  }

  /**
   * Whether the active file supports preview at all
   * (markdown OR TeX). Used to decide whether to render
   * the Preview button; specific type-dispatch happens
   * in `_updatePreview` and `_onContentChange`.
   */
  _isPreviewableFile(file) {
    return this._isMarkdownFile(file) || this._isTexFile(file);
  }

  /**
   * Recompute _dirty from the active file. Single-file
   * semantics — no counting, just a boolean.
   */
  _recomputeDirty() {
    this._dirty = this._file !== null && this._isDirty(this._file);
  }

  /**
   * Save the active file. The path argument exists for
   * signature compatibility with callers that still
   * pass it (status-LED click, Ctrl+S); it's validated
   * against the active file and ignored if it doesn't
   * match.
   */
  async _saveFile(path) {
    if (this._file === null) return;
    if (path && this._file.path !== path) return;
    if (this._file.isVirtual || this._file.isReadOnly) return;
    // Read live content from editor.
    let content = this._file.modified;
    const modifiedEditor = this._getModifiedEditor();
    try {
      content = modifiedEditor?.getValue?.() ?? this._file.modified;
    } catch (_) {}
    this._file = {
      ...this._file,
      modified: content,
      savedContent: content,
    };
    this._recomputeDirty();
    // Dispatch file-saved — parent routes to Repo write
    // or Settings save depending on the file's flags.
    this.dispatchEvent(
      new CustomEvent('file-saved', {
        detail: {
          path: this._file.path,
          content,
          isConfig: !!this._file.isConfig,
          configType: this._file.configType,
        },
        bubbles: true,
        composed: true,
      }),
    );
    // TeX preview recompiles on save. Markdown preview
    // already updated on each keystroke via
    // _onContentChange; TeX was holding its last
    // compiled output until now.
    if (this._previewMode && this._isTexFile(this._file)) {
      this._compileTex(this._file);
    }
  }

  // ---------------------------------------------------------------
  // Internals — status LED / panel labels
  // ---------------------------------------------------------------

  _statusLedClass() {
    if (this._file === null) return '';
    if (this._isDirty(this._file)) return 'dirty';
    if (this._file.isNew) return 'new-file';
    return 'clean';
  }

  _statusLedTitle() {
    if (this._file === null) return '';
    const klass = this._statusLedClass();
    if (klass === 'dirty') {
      return `${this._file.path} — unsaved (click to save)`;
    }
    if (klass === 'new-file') {
      return `${this._file.path} — new file`;
    }
    return this._file.path;
  }

  _onStatusLedClick() {
    if (this._file === null) return;
    if (this._isDirty(this._file)) {
      this._saveFile(this._file.path);
    }
  }

  /**
   * Panel labels come from the virtual-comparison slot
   * when it's active; real files never show panel
   * labels (their context is obvious from the file
   * path).
   */
  _currentPanelLabels() {
    if (this._virtualComparison === null) return {};
    return {
      left: this._virtualComparison.leftLabel || '',
      right: this._virtualComparison.rightLabel || '',
    };
  }

  // ---------------------------------------------------------------
  // Internals — keyboard shortcuts
  // ---------------------------------------------------------------

  _onKeyDown(event) {
    if (!this.isConnected) return;
    // Ctrl+F and Ctrl+S only apply when there's content
    // to act on. The no-cache model has no concept of
    // cycling between open files, so Ctrl+W/PageUp/
    // PageDown are gone (see D18).
    if (this._file === null && this._virtualComparison === null) {
      return;
    }
    const ctrl = event.ctrlKey || event.metaKey;
    if (!ctrl) return;
    // Ctrl+F — find in file. Forward to Monaco's built-in
    // find widget rather than letting the browser's
    // page-find hijack it. The keystroke only applies
    // inside the viewer; outside, the browser find still
    // works normally.
    if (event.key === 'f' || event.key === 'F') {
      if (this._eventTargetInsideUs(event)) {
        event.preventDefault();
        this._triggerFindWidget();
      }
      return;
    }
    // Ctrl+S — save active file.
    if (event.key === 's' || event.key === 'S') {
      if (
        this._activeInEditorRoot(event.target) ||
        this._eventTargetInsideUs(event)
      ) {
        event.preventDefault();
        if (this._file !== null) this._saveFile(this._file.path);
      }
      return;
    }
  }

  _activeInEditorRoot(target) {
    // Monaco's textarea lives inside our shadow root; the
    // event target from a keydown inside Monaco is the
    // composed path's first shadow-crossing element.
    return this._eventTargetInsideUs({ target });
  }

  _eventTargetInsideUs(event) {
    const path = event.composedPath ? event.composedPath() : [];
    return path.includes(this);
  }

  /**
   * Open Monaco's find widget in the modified (right)
   * editor. The find widget is a built-in Monaco
   * contribution; triggering it via the 'actions.find'
   * command is the public API.
   *
   * Must focus the editor first so the widget is wired
   * to the right editor instance. Without focus, Monaco
   * opens the widget but it doesn't catch subsequent
   * keystrokes.
   */
  _triggerFindWidget() {
    const modifiedEditor = this._getModifiedEditor();
    if (!modifiedEditor) return;
    try {
      modifiedEditor.focus?.();
      modifiedEditor.trigger?.('keyboard', 'actions.find', null);
    } catch (err) {
      console.debug('[diff-viewer] find widget trigger failed', err);
    }
  }

  _dispatchActiveFileChanged() {
    // For virtual comparisons, path is null — the viewer
    // is showing ad-hoc content, not a file. Matches the
    // single-file slot's null-when-empty convention.
    const path = this._file !== null ? this._file.path : null;
    this.dispatchEvent(
      new CustomEvent('active-file-changed', {
        detail: { path },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  render() {
    // Empty state — no real file, no virtual comparison.
    if (this._file === null && this._virtualComparison === null) {
      return html`
        <div class="empty-state">
          <div class="watermark">
            <span>AC</span><span class="bolt">⚡</span><span>DC</span>
          </div>
        </div>
      `;
    }
    const ledClass = this._statusLedClass();
    const labels = this._currentPanelLabels();
    // Preview button and status LED only meaningful
    // when a real file is active. Virtual comparisons
    // have no file path, no preview path, no save target.
    const showPreviewButton =
      this._file !== null && this._isPreviewableFile(this._file);
    const showStatusLed = this._file !== null;
    if (this._previewMode && showPreviewButton) {
      return html`
        <div class="split-root">
          <div class="editor-pane">
            <div class="editor-container" role="region"
              aria-label="Diff editor"></div>
          </div>
          <div
            class="preview-pane"
            role="region"
            aria-label="Markdown preview"
          ></div>
          <button
            class="preview-button preview-button-split"
            @click=${this._togglePreview}
            title="Exit preview"
            aria-label="Exit preview"
          >✕ Preview</button>
          ${showStatusLed
            ? html`<div
                class="status-led ${ledClass}"
                title=${this._statusLedTitle()}
                aria-label=${this._statusLedTitle()}
                @click=${this._onStatusLedClick}
              ></div>`
            : ''}
        </div>
      `;
    }
    return html`
      <div class="editor-container" role="region"
        aria-label="Diff editor"></div>
      ${labels.left
        ? html`<div class="panel-label left">${labels.left}</div>`
        : ''}
      ${labels.right
        ? html`<div class="panel-label right">${labels.right}</div>`
        : ''}
      ${showPreviewButton
        ? html`<button
            class="preview-button"
            @click=${this._togglePreview}
            title="Toggle markdown preview"
            aria-label="Toggle markdown preview"
          >👁 Preview</button>`
        : ''}
      ${this._file !== null && this._isSvgFile(this._file)
        ? html`<button
            class="preview-button"
            style="right: ${showPreviewButton ? '110px' : '46px'}"
            @click=${this._switchToVisualSvg}
            title="Switch to visual SVG editor"
            aria-label="Switch to visual SVG editor"
          >🎨 Visual</button>`
        : ''}
      ${showStatusLed
        ? html`<div
            class="status-led ${ledClass}"
            title=${this._statusLedTitle()}
            aria-label=${this._statusLedTitle()}
            @click=${this._onStatusLedClick}
          ></div>`
        : ''}
    `;
  }
}

customElements.define('ac-diff-viewer', DiffViewer);