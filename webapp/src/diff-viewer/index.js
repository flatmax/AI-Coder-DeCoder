// DiffViewer — Monaco-based side-by-side diff editor.
//
// Single-file, no-cache model. See D18 in IMPLEMENTATION_NOTES.md
// and specs4/5-webapp/diff-viewer.md.
//
// Exactly one file is displayed at a time. Every `openFile`
// call fetches HEAD and working-copy content fresh from the
// backend — no caching across switches. Clicking the same
// file in the picker refetches.
//
// This file is the integration point for the diff-viewer
// modular split. All business logic lives in sibling
// modules (./editor.js, ./preview.js, ./fetch.js, etc.);
// the class here is the Lit element + property
// declarations + thin forwarders to module functions.
//
// Architectural contracts preserved across the split:
//
//   - **Worker configuration installs before editor
//     construction** — monaco-setup.js runs at module
//     load, imported transitively via ./editor.js.
//
//   - **Editor reuse, not recreation** — a single
//     DiffEditor handles all openFile calls; models swap
//     in place. Full disposal only when both slots
//     (file + virtual comparison) clear.
//
//   - **Model disposal order: setModel first, then
//     dispose**. Disposing a model while still attached
//     throws.
//
//   - **Generation counter for superseded fetches** —
//     `_openingGeneration` bumps on every openFile /
//     loadPanel; async handlers capture and check
//     before attaching models.
//
//   - **Content-addressed virtual files** — virtual://
//     paths short-circuit the disk-fetch path; content
//     lives on _file.modified directly.
//
//   - **No viewport persistence across switches** — every
//     openFile starts at (1, 1).

import { LitElement, html } from 'lit';

// Importing editor.js transitively imports monaco-setup.js,
// whose module-level side effects (worker env, MATLAB
// registration) must run before any editor construction.
import {
  currentContent,
  disposeEditor,
  getModifiedEditor,
  isDirty,
  isMarkdownFile,
  isPreviewableFile,
  isSvgFile,
  isTexFile,
  onContentChange,
  recomputeDirty,
  saveFile,
  showEditor,
  switchToVisualSvg,
} from './editor.js';
import {
  _VIRTUAL_PREFIX,
} from './constants.js';
import { DIFF_VIEWER_STYLES } from './styles.js';
import {
  copyPreviewAsHtml,
  exportPreviewAsHtml,
} from './export.js';
import {
  fetchFileContent,
} from './fetch.js';
import {
  attachPreviewScrollListener,
  compileTex,
  detachPreviewScrollListener,
  onPreviewClick,
  togglePreview,
  updatePreview,
} from './preview.js';
import {
  onEditorScroll,
  onPreviewScroll,
} from './scroll-sync.js';
import {
  disposeStyleObserver,
  onHeadMutation,
} from './shadow-styles.js';
import {
  scrollToLine,
  scrollToSearchText,
} from './diff-ready.js';
import {
  currentPanelLabels,
  dispatchActiveFileChanged,
  onKeyDown,
  onStatusLedClick,
  statusLedClass,
  statusLedTitle,
} from './keyboard-and-led.js';

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
    /**
     * Whether the export-actions dropdown is open.
     * Surfaces only when preview mode is active and the
     * file is markdown. Dismissed by outside-click,
     * Escape, or selecting an action.
     */
    _exportMenuOpen: { type: Boolean, state: true },
  };

  static styles = DIFF_VIEWER_STYLES;

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
    this._exportMenuOpen = false;

    // Monaco editor instance. Created on first openFile
    // or loadPanel; disposed when both slots clear.
    this._editor = null;
    this._editorContainer = null;
    // Preview pane element — populated after Lit renders
    // the split template. Preview HTML is written to its
    // innerHTML directly (not via Lit) so every keystroke
    // doesn't re-render the whole component.
    this._previewPane = null;
    // Availability tristate for TeX preview — null = not
    // yet checked, true = make4ht installed, false =
    // missing. Probed lazily on first .tex preview entry.
    this._texPreviewAvailable = null;
    // Generation counter for compile RPC calls.
    this._texCompileGeneration = 0;
    // Current highlight decorations (cleared on next
    // highlight or on file switch).
    this._highlightDecorations = [];
    this._highlightTimer = null;
    // Listener disposables.
    this._contentChangeDisposable = null;
    this._editorScrollDisposable = null;
    // Scroll-sync lock. 'editor' or 'preview' identifies
    // which side initiated the scroll; the other side's
    // handler skips until the lock clears.
    this._scrollLock = null;
    this._scrollLockTimer = null;
    // MutationObserver for shadow-DOM style sync.
    this._styleObserver = null;
    // Whether we've patched the code-editor-service's
    // openCodeEditor method.
    this._editorServicePatched = false;
    // Image-resolution generation counter.
    this._imageResolveGeneration = 0;

    // Bound handlers — same binding for add/remove.
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onContentChange = this._onContentChange.bind(this);
    this._onHeadMutation = this._onHeadMutation.bind(this);
    this._onEditorScroll = this._onEditorScroll.bind(this);
    this._onPreviewScroll = this._onPreviewScroll.bind(this);
    this._onPreviewClick = this._onPreviewClick.bind(this);
    this._onExportMenuDocumentClick =
      this._onExportMenuDocumentClick.bind(this);
  }

  // ---------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this._onKeyDown);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKeyDown);
    disposeStyleObserver(this);
    disposeEditor(this);
    if (this._highlightTimer) {
      clearTimeout(this._highlightTimer);
      this._highlightTimer = null;
    }
    super.disconnectedCallback();
  }

  updated(changedProps) {
    super.updated?.(changedProps);
    const hasContent = this._file !== null || this._virtualComparison !== null;
    if (hasContent && !this._editorContainer) {
      this._editorContainer =
        this.shadowRoot?.querySelector('.editor-container') || null;
    }
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
   * working-copy content fresh.
   */
  async openFile(opts) {
    if (!opts || typeof opts.path !== 'string' || !opts.path) {
      return;
    }
    const { path, virtualContent } = opts;
    this._openingGeneration += 1;
    const myGeneration = this._openingGeneration;

    this._virtualComparison = null;

    let newFile;
    if (path.startsWith(_VIRTUAL_PREFIX)) {
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
      const fetched = await fetchFileContent(path);
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
    if (this._previewMode && !isPreviewableFile(newFile)) {
      this._previewMode = false;
      this._previewPane = null;
      disposeEditor(this);
      this._editorContainer = null;
    }
    this._showEditor();
    this._dispatchActiveFileChanged();
    this._recomputeDirty();

    if (opts.line != null) this._scrollToLine(opts.line);
    if (opts.searchText) this._scrollToSearchText(opts.searchText);

    if (this._previewMode && isPreviewableFile(newFile)) {
      this.updateComplete.then(() => {
        this._updatePreview(newFile.modified);
        if (isTexFile(newFile)) {
          this._compileTex(newFile);
        }
      });
    }
  }

  /**
   * Refetch the active file's content. Unsaved edits
   * are discarded (same policy as cross-file switches).
   */
  async refreshActiveFile() {
    if (this._file === null || this._file.isVirtual) return;
    if (this._virtualComparison !== null) return;
    const path = this._file.path;
    // Capture preview state before the refetch so we can
    // re-render the preview and restore the user's scroll
    // position once the new on-disk content lands. Without
    // this, an external edit (LLM write, commit, revert)
    // refreshes the editor buffer but leaves the preview
    // pane showing the stale render.
    const wasPreviewOpen = this.isPreviewOpen();
    const previewScrollTop = wasPreviewOpen
      ? this.getPreviewScrollTop()
      : 0;
    this._openingGeneration += 1;
    const myGeneration = this._openingGeneration;
    const fetched = await fetchFileContent(path);
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

    // Re-render the preview from the freshly-fetched content
    // when preview mode is active and the file is still
    // previewable. _showEditor only rebuilds the Monaco
    // editor; the preview pane is written directly (not via
    // Lit) so it has to be refreshed explicitly.
    if (
      wasPreviewOpen &&
      this._file !== null &&
      isPreviewableFile(this._file)
    ) {
      this.updateComplete.then(() => {
        if (isTexFile(this._file)) {
          // TeX re-compiles from the new source; its own
          // async path repaints the pane on completion.
          this._compileTex(this._file);
        } else {
          this._updatePreview(this._file.modified);
        }
        if (previewScrollTop > 0) {
          this.restorePreviewScrollTop(previewScrollTop);
        }
      });
    }
  }

  async refreshOpenFiles() {
    await this.refreshActiveFile();
  }

  /**
   * Force Monaco to recompute layout. Called by the app
   * shell on window resize and during dialog resize
   * drags. No-op when no editor exists.
   */
  relayout() {
    if (!this._editor) return;
    try {
      this._editor.layout();
    } catch (err) {
      console.debug('[diff-viewer] relayout failed', err);
    }
  }

  closeFile(path) {
    if (path && this._file !== null && this._file.path !== path) {
      return;
    }
    this._file = null;
    this._virtualComparison = null;
    disposeEditor(this);
    this._recomputeDirty();
    this._previewMode = false;
    this._previewPane = null;
    this._dispatchActiveFileChanged();
  }

  getDirtyFiles() {
    if (this._file !== null && isDirty(this._file)) {
      return [this._file.path];
    }
    return [];
  }

  async saveAll() {
    if (this._file !== null && isDirty(this._file)) {
      await this._saveFile(this._file.path);
    }
  }

  async loadPanel(content, panel, label) {
    if (panel !== 'left' && panel !== 'right') return;
    const text = typeof content === 'string' ? content : '';
    this._openingGeneration += 1;

    if (this._virtualComparison === null) {
      this._file = null;
      this._virtualComparison = {
        leftContent: panel === 'left' ? text : '',
        leftLabel: panel === 'left' ? label || '' : '',
        rightContent: panel === 'right' ? text : '',
        rightLabel: panel === 'right' ? label || '' : '',
      };
    } else {
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

  get hasOpenFiles() {
    return this._file !== null || this._virtualComparison !== null;
  }

  // ---------------------------------------------------------------
  // Public API — preview state (for shell-driven restore)
  // ---------------------------------------------------------------

  isPreviewOpen() {
    if (this._file === null) return false;
    if (!isPreviewableFile(this._file)) return false;
    return !!this._previewMode;
  }

  getPreviewScrollTop() {
    if (!this._previewMode) return 0;
    try {
      const pane =
        this._previewPane ||
        this.shadowRoot?.querySelector('.preview-pane');
      if (!pane) return 0;
      return pane.scrollTop || 0;
    } catch (_) {
      return 0;
    }
  }

  setPreviewMode(open) {
    if (this._file === null) return;
    if (!isPreviewableFile(this._file)) return;
    const target = !!open;
    if (target === this._previewMode) return;
    this._togglePreview();
  }

  restorePreviewScrollTop(scrollTop) {
    if (!this._previewMode) return;
    const px = Number(scrollTop) || 0;
    if (px <= 0) return;
    requestAnimationFrame(() => {
      const pane =
        this._previewPane ||
        this.shadowRoot?.querySelector('.preview-pane');
      if (!pane) return;
      try {
        // Acquire scroll lock in the 'preview' slot so
        // the sync handler doesn't immediately mirror
        // this scroll back to the editor.
        this._scrollLock = 'preview';
        if (this._scrollLockTimer) clearTimeout(this._scrollLockTimer);
        this._scrollLockTimer = setTimeout(() => {
          this._scrollLock = null;
          this._scrollLockTimer = null;
        }, 120);
        pane.scrollTop = px;
      } catch (_) {}
    });
  }

  // ---------------------------------------------------------------
  // Forwarders to module functions
  // ---------------------------------------------------------------
  //
  // Module functions take `host` as their first argument.
  // Methods here are thin wrappers so existing call sites
  // (and tests using `this._foo(...)` patterns) keep
  // working. The pattern matches chat-panel/index.js and
  // files-tab/index.js.

  _showEditor() { showEditor(this); }
  _getModifiedEditor() { return getModifiedEditor(this); }
  _detachPreviewScrollListener() { detachPreviewScrollListener(this); }
  _recomputeDirty() { recomputeDirty(this); }
  _onContentChange() { onContentChange(this); }
  _onEditorScroll() { onEditorScroll(this); }
  _onPreviewScroll() { onPreviewScroll(this); }
  _onPreviewClick(event) { onPreviewClick(this, event); }
  _onHeadMutation(mutations) { onHeadMutation(this, mutations); }
  _onKeyDown(event) { onKeyDown(this, event); }
  _togglePreview() { togglePreview(this); }
  _updatePreview(content) { updatePreview(this, content); }
  _compileTex(file) { return compileTex(this, file); }
  _scrollToLine(line) { scrollToLine(this, line); }
  _scrollToSearchText(text) { scrollToSearchText(this, text); }
  _dispatchActiveFileChanged() { dispatchActiveFileChanged(this); }
  async _saveFile(path) { return saveFile(this, path); }
  _switchToVisualSvg() { switchToVisualSvg(this); }
  _onStatusLedClick() { onStatusLedClick(this); }

  // Test surface — some tests call these directly via
  // private-method names, so keep them as forwarders too.
  _isDirty(file) { return isDirty(file); }
  _isMarkdownFile(file) { return isMarkdownFile(file); }
  _isTexFile(file) { return isTexFile(file); }
  _isPreviewableFile(file) { return isPreviewableFile(file); }
  _isSvgFile(file) { return isSvgFile(file); }
  _statusLedClass() { return statusLedClass(this); }
  _statusLedTitle() { return statusLedTitle(this); }
  _currentPanelLabels() { return currentPanelLabels(this); }
  _currentContent() { return currentContent(this); }

  // ---------------------------------------------------------------
  // Export menu
  // ---------------------------------------------------------------

  /**
   * Toggle the export-actions dropdown. Called by the
   * "⋯" affordance next to the Preview button.
   */
  _toggleExportMenu() {
    if (this._exportMenuOpen) {
      this._closeExportMenu();
    } else {
      this._openExportMenu();
    }
  }

  _openExportMenu() {
    this._exportMenuOpen = true;
    // Capture-phase listener so an outside click closes
    // the menu before any other handler reacts to it.
    document.addEventListener(
      'mousedown',
      this._onExportMenuDocumentClick,
      true,
    );
  }

  _closeExportMenu() {
    this._exportMenuOpen = false;
    document.removeEventListener(
      'mousedown',
      this._onExportMenuDocumentClick,
      true,
    );
  }

  _onExportMenuDocumentClick(event) {
    // composedPath includes shadow-DOM ancestors, so we
    // can detect clicks inside our own menu.
    const path = event.composedPath?.() || [];
    if (path.includes(this)) {
      // Click was inside the diff viewer — let the
      // menu's own click handlers decide whether to
      // close. Outside clicks dismiss.
      return;
    }
    this._closeExportMenu();
  }

  async _onExportPreviewAsHtml() {
    this._closeExportMenu();
    const result = await exportPreviewAsHtml(this);
    if (!result.ok) {
      this.dispatchEvent(
        new CustomEvent('show-toast', {
          detail: {
            message: `Export failed: ${result.error || 'unknown'}`,
            type: 'error',
          },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }
    let message = `Exported ${result.filename}`;
    if (result.unresolvedImages?.length) {
      const n = result.unresolvedImages.length;
      message += ` (${n} unresolved image${n === 1 ? '' : 's'})`;
    }
    this.dispatchEvent(
      new CustomEvent('show-toast', {
        detail: { message, type: 'success' },
        bubbles: true,
        composed: true,
      }),
    );
  }

  async _onCopyPreviewAsHtml() {
    this._closeExportMenu();
    const result = await copyPreviewAsHtml(this);
    if (!result.ok) {
      this.dispatchEvent(
        new CustomEvent('show-toast', {
          detail: {
            message: `Copy failed: ${result.error || 'unknown'}`,
            type: 'error',
          },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }
    const richNote = result.mode === 'rich' ? '' : ' (plain text)';
    this.dispatchEvent(
      new CustomEvent('show-toast', {
        detail: {
          message: `Copied preview as HTML${richNote}`,
          type: 'success',
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  render() {
    if (this._file === null && this._virtualComparison === null) {
      return html`
        <div class="empty-state">
          <div class="watermark">
            <span>AC</span><span class="bolt">⚡</span><span>DC</span>
          </div>
        </div>
      `;
    }
    const ledClass = statusLedClass(this);
    const labels = currentPanelLabels(this);
    const showPreviewButton =
      this._file !== null && isPreviewableFile(this._file);
    const showStatusLed = this._file !== null;
    if (this._previewMode && showPreviewButton) {
      const showExportMenu =
        this._file !== null && isMarkdownFile(this._file);
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
          ${showExportMenu
            ? html`<div class="preview-button-group
                preview-button-group-split">
                <button
                  class="preview-button preview-button-main"
                  @click=${this._togglePreview}
                  title="Exit preview"
                  aria-label="Exit preview"
                >📝</button>
                <button
                  class="preview-button preview-button-chevron"
                  @click=${this._toggleExportMenu}
                  title="More preview actions"
                  aria-label="More preview actions"
                  aria-haspopup="menu"
                  aria-expanded=${this._exportMenuOpen}
                >▾</button>
              </div>`
            : html`<button
                class="preview-button preview-button-split"
                @click=${this._togglePreview}
                title="Exit preview"
                aria-label="Exit preview"
              >📝</button>`}
          ${showExportMenu && this._exportMenuOpen
            ? html`<div class="export-menu export-menu-split"
                role="menu">
                <button
                  class="export-menu-item"
                  role="menuitem"
                  @click=${this._onExportPreviewAsHtml}
                >Export as HTML…</button>
                <button
                  class="export-menu-item"
                  role="menuitem"
                  @click=${this._onCopyPreviewAsHtml}
                >Copy as HTML</button>
              </div>`
            : ''}
          ${showStatusLed
            ? html`<div
                class="status-led ${ledClass}"
                title=${statusLedTitle(this)}
                aria-label=${statusLedTitle(this)}
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
      ${this._file !== null && isSvgFile(this._file)
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
            title=${statusLedTitle(this)}
            aria-label=${statusLedTitle(this)}
            @click=${this._onStatusLedClick}
          ></div>`
        : ''}
    `;
  }
}

customElements.define('ac-diff-viewer', DiffViewer);