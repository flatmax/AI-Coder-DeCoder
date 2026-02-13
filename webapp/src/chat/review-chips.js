import { LitElement, html, css, nothing } from 'lit';
import { RpcMixin } from '../rpc-mixin.js';

/**
 * Review diff chips — shows active review state and per-file diff toggles.
 *
 * Events:
 *   review-end-requested
 *   navigate-file  { path }
 */
class ReviewChips extends RpcMixin(LitElement) {
  static properties = {
    /** Review state from LLM.get_review_state() */
    reviewState: { type: Object },
    /** Currently selected files (their diffs are included) */
    selectedFiles: { type: Object },
    /** Expanded (show all files) */
    _expanded: { type: Boolean, state: true },
  };

  static styles = css`
    :host { display: block; }

    .review-bar {
      padding: 6px 10px;
      border: 1px solid rgba(79, 195, 247, 0.3);
      border-radius: var(--radius-sm);
      background: rgba(79, 195, 247, 0.06);
      margin: 4px 8px;
      font-size: 12px;
    }

    .summary {
      display: flex; align-items: center; gap: 8px;
      color: var(--text-primary); margin-bottom: 6px;
    }
    .summary .icon { font-size: 14px; }
    .summary .info { flex: 1; font-size: 11px; color: var(--text-secondary); }

    .clear-btn {
      background: none; border: 1px solid var(--border-color);
      border-radius: var(--radius-sm); padding: 2px 8px;
      color: var(--text-muted); cursor: pointer; font-size: 11px;
    }
    .clear-btn:hover { color: var(--accent-error); border-color: var(--accent-error); }

    .chips {
      display: flex; flex-wrap: wrap; gap: 4px;
    }

    .chip {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 8px; border-radius: 12px;
      font-size: 11px; cursor: pointer;
      border: 1px solid var(--border-color);
      background: var(--bg-surface);
      color: var(--text-secondary);
      transition: all var(--transition-fast);
    }
    .chip:hover { border-color: var(--accent-primary); color: var(--text-primary); }
    .chip.included {
      background: rgba(79,195,247,0.12);
      border-color: var(--accent-primary);
      color: var(--text-primary);
    }
    .chip .status { font-size: 10px; }

    .expand-btn {
      background: none; border: none; color: var(--accent-primary);
      cursor: pointer; font-size: 11px; padding: 2px 4px;
    }
  `;

  constructor() {
    super();
    this.reviewState = null;
    this.selectedFiles = new Set();
    this._expanded = false;
  }

  _onFileClick(path) {
    this.dispatchEvent(new CustomEvent('navigate-file', {
      detail: { path }, bubbles: true, composed: true,
    }));
  }

  _endReview() {
    this.dispatchEvent(new CustomEvent('review-end-requested', {
      bubbles: true, composed: true,
    }));
  }

  render() {
    if (!this.reviewState?.active) return nothing;

    const state = this.reviewState;
    const stats = state.stats || {};
    const files = state.changed_files || [];
    const selectedSet = this.selectedFiles instanceof Set ? this.selectedFiles : new Set(this.selectedFiles || []);

    const visibleFiles = this._expanded ? files : files.slice(0, 8);
    const remaining = files.length - visibleFiles.length;

    return html`
      <div class="review-bar">
        <div class="summary">
          <span class="icon">📋</span>
          <span style="font-weight:600">Review: ${state.branch || '?'}</span>
          <span class="info">
            ${stats.commit_count || 0} commits · ${stats.files_changed || 0} files ·
            +${stats.additions || 0} -${stats.deletions || 0}
          </span>
          <button class="clear-btn" @click=${this._endReview}
            title="Exit review mode">Exit Review</button>
        </div>
        <div class="chips">
          ${visibleFiles.map(f => html`
            <span class="chip ${selectedSet.has(f.path) ? 'included' : ''}"
              @click=${() => this._onFileClick(f.path)}
              title="${f.path} (+${f.additions} -${f.deletions})">
              <span class="status">${selectedSet.has(f.path) ? '✓' : '○'}</span>
              📄 ${f.path.split('/').pop()}
            </span>
          `)}
          ${remaining > 0 ? html`
            <button class="expand-btn" @click=${() => { this._expanded = true; }}>
              +${remaining} more
            </button>
          ` : nothing}
        </div>
      </div>
    `;
  }
}

customElements.define('review-chips', ReviewChips);