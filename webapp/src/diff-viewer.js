// DiffViewer — Phase 3 groundwork stub.
//
// The real diff viewer (Monaco-based, side-by-side with
// syntax highlighting, LSP, markdown/TeX preview) lands in
// Phase 3.1. This stub establishes the public API and the
// visibility contract so app-shell routing can be wired and
// tested first.
//
// Public API (mirrors what Phase 3.1 will implement):
//   - openFile({path, line?, searchText?}) — open/switch to
//     a file. Line and searchText are for Phase 3.1 (scroll
//     to a specific line or edit anchor); stub accepts and
//     ignores.
//   - closeFile(path) — close a single file.
//   - refreshOpenFiles() — re-fetch all open files after
//     edits land.
//   - getDirtyFiles() — paths with unsaved changes. Stub
//     always returns [].
//
// Events:
//   - `active-file-changed` (bubbles, composed) — fired when
//     the active file changes (open new, switch, close last).
//     Detail: `{path}` (null when no files open). Phase 3
//     picker uses this for the active-file highlight. App
//     shell uses it to toggle viewer visibility.
//
// Empty state:
//   When no files are open, renders the AC⚡DC watermark.
//   Matches the SVG viewer's empty state so switching
//   between viewer layers while empty is visually stable.

import { LitElement, css, html } from 'lit';

export class DiffViewer extends LitElement {
  static properties = {
    /**
     * Array of open file entries. Kept as a reactive
     * property so the template can render file names and
     * the empty state reflects the current count. Each
     * entry is `{path, content?, line?}` — content and
     * line fields populate in Phase 3.1 when the viewer
     * actually fetches and displays content.
     */
    _files: { type: Array, state: true },
    /**
     * Index of the currently-active file in `_files`. -1
     * when no files are open. Setting this dispatches
     * `active-file-changed`.
     */
    _activeIndex: { type: Number, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--bg-primary, #0d1117);
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

    /* Phase 3 stub rendering — shows the currently-active
     * file path so integration tests can verify routing
     * works. Phase 3.1 replaces this with the Monaco
     * editor. */
    .stub-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      padding: 2rem;
      color: var(--text-secondary, #8b949e);
    }
    .stub-label {
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.6;
    }
    .stub-path {
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 1.125rem;
      color: var(--accent-primary, #58a6ff);
    }
    .stub-note {
      font-size: 0.8125rem;
      opacity: 0.5;
      font-style: italic;
      max-width: 30rem;
      text-align: center;
    }
  `;

  constructor() {
    super();
    this._files = [];
    this._activeIndex = -1;
  }

  // ---------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------

  /**
   * Open or switch to a file. If already open, switches to
   * its tab without re-fetching. Otherwise adds it to the
   * end of the files list and makes it active.
   *
   * @param {object} opts
   * @param {string} opts.path — repo-relative path
   * @param {number} [opts.line] — line to scroll to (Phase 3.1)
   * @param {string} [opts.searchText] — text to locate and
   *   highlight (Phase 3.1 scroll-to-edit anchor)
   */
  openFile(opts) {
    if (!opts || typeof opts.path !== 'string' || !opts.path) {
      return;
    }
    const { path } = opts;
    // Same-file suppression — already the active file, no
    // state change, no event.
    const existing = this._files.findIndex((f) => f.path === path);
    if (existing !== -1 && existing === this._activeIndex) {
      return;
    }
    if (existing !== -1) {
      // File open but not active — just switch.
      this._activeIndex = existing;
    } else {
      // New file — add and make active.
      this._files = [...this._files, { path }];
      this._activeIndex = this._files.length - 1;
    }
    this._dispatchActiveFileChanged();
  }

  /**
   * Close a file. If it was the active file, activates the
   * next file in the list (or clears active if the list is
   * now empty).
   */
  closeFile(path) {
    const idx = this._files.findIndex((f) => f.path === path);
    if (idx === -1) return;
    const wasActive = idx === this._activeIndex;
    const newFiles = [
      ...this._files.slice(0, idx),
      ...this._files.slice(idx + 1),
    ];
    this._files = newFiles;
    if (newFiles.length === 0) {
      this._activeIndex = -1;
    } else if (wasActive) {
      // Pick the next file, or the previous if we closed
      // the last one.
      this._activeIndex = Math.min(idx, newFiles.length - 1);
    } else if (idx < this._activeIndex) {
      // Closed a file before the active one — shift index
      // down to keep pointing at the same file.
      this._activeIndex -= 1;
    }
    this._dispatchActiveFileChanged();
  }

  /**
   * Re-fetch all open files. Used after edits land to
   * refresh content. Stub is a no-op; Phase 3.1 re-fetches
   * HEAD + working copy.
   */
  refreshOpenFiles() {
    // Intentional no-op for Phase 3 groundwork.
  }

  /**
   * Return paths of files with unsaved changes. Stub always
   * returns empty; Phase 3.1 tracks dirty state per file.
   */
  getDirtyFiles() {
    return [];
  }

  /**
   * Whether any files are currently open. App shell reads
   * this to decide which viewer layer to show.
   */
  get hasOpenFiles() {
    return this._files.length > 0;
  }

  // ---------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------

  _dispatchActiveFileChanged() {
    const activeFile =
      this._activeIndex >= 0 ? this._files[this._activeIndex] : null;
    this.dispatchEvent(
      new CustomEvent('active-file-changed', {
        detail: { path: activeFile ? activeFile.path : null },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  render() {
    if (this._files.length === 0 || this._activeIndex < 0) {
      return html`
        <div class="empty-state">
          <div class="watermark">
            <span>AC</span><span class="bolt">⚡</span><span>DC</span>
          </div>
        </div>
      `;
    }
    const active = this._files[this._activeIndex];
    return html`
      <div class="stub-content">
        <div class="stub-label">Diff viewer (stub)</div>
        <div class="stub-path">${active.path}</div>
        <div class="stub-note">
          Phase 3.1 replaces this with the Monaco editor.
        </div>
      </div>
    `;
  }
}

customElements.define('ac-diff-viewer', DiffViewer);