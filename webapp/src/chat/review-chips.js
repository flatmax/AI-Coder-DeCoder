import { LitElement, html, css, nothing } from 'lit';
import { RpcMixin } from '../rpc-mixin.js';

/**
 * Review status bar — shows active review summary and exit button.
 *
 * File selection for review diffs uses the standard file picker +
 * file mention flow. Selected files automatically get their reverse
 * diffs included in the review context sent to the LLM.
 *
 * Events:
 *   review-end-requested
 */
class ReviewChips extends RpcMixin(LitElement) {
  static properties = {
    /** Review state from LLM.get_review_state() */
    reviewState: { type: Object },
    /** Currently selected files (for the count display) */
    selectedFiles: { type: Object },
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
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .icon { font-size: 14px; }

    .branch {
      font-weight: 600;
      color: var(--text-primary);
    }

    .stats {
      font-size: 11px;
      color: var(--text-secondary);
      flex: 1;
    }

    .diff-count {
      font-size: 11px;
      color: var(--accent-primary);
      white-space: nowrap;
    }

    .exit-btn {
      background: none;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 2px 8px;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 11px;
      white-space: nowrap;
      transition: color var(--transition-fast), border-color var(--transition-fast);
    }
    .exit-btn:hover {
      color: var(--accent-error);
      border-color: var(--accent-error);
    }
  `;

  constructor() {
    super();
    this.reviewState = null;
    this.selectedFiles = new Set();
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
    const changedFiles = state.changed_files || [];
    const selectedSet = this.selectedFiles instanceof Set
      ? this.selectedFiles
      : new Set(Array.isArray(this.selectedFiles) ? this.selectedFiles : []);

    // Count how many changed files are currently selected (will have diffs included)
    const changedPaths = new Set(changedFiles.map(f => f.path));
    const selectedForReview = [...selectedSet].filter(f => changedPaths.has(f)).length;

    return html`
      <div class="review-bar">
        <span class="icon">📋</span>
        <span class="branch">${state.branch || '?'}</span>
        <span class="stats">
          ${stats.commit_count || 0} commits ·
          ${stats.files_changed || 0} files changed ·
          +${stats.additions || 0} −${stats.deletions || 0}
        </span>
        ${selectedForReview > 0 ? html`
          <span class="diff-count"
            title="Selected files that are part of this review will have their reverse diffs included in context">
            ${selectedForReview}/${changedFiles.length} diffs in context
          </span>
        ` : html`
          <span class="diff-count" style="color: var(--text-muted)"
            title="Select changed files in the picker to include their reverse diffs in context">
            Select files to include diffs
          </span>
        `}
        <button class="exit-btn" @click=${this._endReview}
          title="Exit review mode and restore branch">Exit Review</button>
      </div>
    `;
  }
}

customElements.define('review-chips', ReviewChips);