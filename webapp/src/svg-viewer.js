// SvgViewer — Phase 3 groundwork stub.
//
// The real SVG viewer (side-by-side SVG diff with
// synchronized pan/zoom via svg-pan-zoom, visual element
// editor, presentation mode) lands in Phase 3.2. This stub
// establishes the public API and visibility contract
// matching the diff viewer's shape.
//
// Routing: app-shell routes `.svg` files here; everything
// else goes to the diff viewer. Both viewers share the
// same empty-state watermark so transitions between them
// (or between empty and populated) are visually stable.

import { LitElement, css, html } from 'lit';

export class SvgViewer extends LitElement {
  static properties = {
    _files: { type: Array, state: true },
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

  openFile(opts) {
    if (!opts || typeof opts.path !== 'string' || !opts.path) {
      return;
    }
    const { path } = opts;
    const existing = this._files.findIndex((f) => f.path === path);
    if (existing !== -1 && existing === this._activeIndex) {
      return;
    }
    if (existing !== -1) {
      this._activeIndex = existing;
    } else {
      this._files = [...this._files, { path }];
      this._activeIndex = this._files.length - 1;
    }
    this._dispatchActiveFileChanged();
  }

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
      this._activeIndex = Math.min(idx, newFiles.length - 1);
    } else if (idx < this._activeIndex) {
      this._activeIndex -= 1;
    }
    this._dispatchActiveFileChanged();
  }

  refreshOpenFiles() {
    // Intentional no-op for Phase 3 groundwork.
  }

  getDirtyFiles() {
    return [];
  }

  get hasOpenFiles() {
    return this._files.length > 0;
  }

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
        <div class="stub-label">SVG viewer (stub)</div>
        <div class="stub-path">${active.path}</div>
        <div class="stub-note">
          Phase 3.2 replaces this with side-by-side SVG diff
          with synchronized pan/zoom.
        </div>
      </div>
    `;
  }
}

customElements.define('ac-svg-viewer', SvgViewer);