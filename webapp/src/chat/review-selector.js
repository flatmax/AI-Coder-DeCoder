import { LitElement, html, css, nothing } from 'lit';
import { RpcMixin } from '../rpc-mixin.js';

/**
 * Review selector — branch dropdown, commit search, and start review.
 *
 * Events:
 *   review-started  { result }
 *   review-closed
 */
class ReviewSelector extends RpcMixin(LitElement) {
  static properties = {
    open: { type: Boolean },
    _branches: { type: Array, state: true },
    _selectedBranch: { type: String, state: true },
    _commits: { type: Array, state: true },
    _commitQuery: { type: String, state: true },
    _selectedCommit: { type: Object, state: true },
    _mergeBaseTarget: { type: String, state: true },
    _loading: { type: Boolean, state: true },
    _error: { type: String, state: true },
    _phase: { type: String, state: true },
  };

  static styles = css`
    :host { display: block; }

    .backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 300;
      display: flex; align-items: center; justify-content: center;
    }

    .panel {
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      width: 480px; max-height: 80vh;
      display: flex; flex-direction: column;
      overflow: hidden;
    }

    .header {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color);
      display: flex; align-items: center; justify-content: space-between;
    }
    .header h3 { margin: 0; font-size: 14px; color: var(--text-primary); }
    .close-btn {
      background: none; border: none; color: var(--text-muted);
      cursor: pointer; font-size: 16px; padding: 4px;
    }
    .close-btn:hover { color: var(--text-primary); }

    .body { padding: 12px 16px; overflow-y: auto; flex: 1; }

    label {
      display: block; font-size: 11px; color: var(--text-secondary);
      margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;
    }

    select, input[type="text"] {
      width: 100%; padding: 6px 10px;
      background: var(--bg-primary); border: 1px solid var(--border-color);
      border-radius: var(--radius-sm); color: var(--text-primary);
      font-size: 13px; outline: none; box-sizing: border-box;
      font-family: var(--font-sans);
    }
    select:focus, input:focus { border-color: var(--accent-primary); }

    .section { margin-bottom: 14px; }

    .merge-base-row {
      display: flex; align-items: center; gap: 8px; margin-top: 8px;
    }
    .merge-base-row select { width: auto; flex: 1; }
    .merge-base-btn {
      padding: 5px 12px; border: 1px solid var(--border-color);
      border-radius: var(--radius-sm); background: var(--bg-surface);
      color: var(--text-primary); cursor: pointer; font-size: 12px;
      white-space: nowrap;
    }
    .merge-base-btn:hover { background: var(--bg-elevated); }

    .commit-list {
      max-height: 240px; overflow-y: auto;
      border: 1px solid var(--border-color); border-radius: var(--radius-sm);
      margin-top: 6px;
    }

    .commit-item {
      padding: 8px 10px; cursor: pointer;
      border-bottom: 1px solid var(--border-color);
      transition: background var(--transition-fast);
    }
    .commit-item:last-child { border-bottom: none; }
    .commit-item:hover { background: var(--bg-surface); }
    .commit-item.selected { background: rgba(79,195,247,0.15); border-left: 3px solid var(--accent-primary); }

    .commit-sha {
      font-family: var(--font-mono); font-size: 12px;
      color: var(--accent-primary); margin-right: 8px;
    }
    .commit-msg { font-size: 12px; color: var(--text-primary); }
    .commit-meta { font-size: 10px; color: var(--text-muted); margin-top: 2px; }

    .footer {
      padding: 10px 16px; border-top: 1px solid var(--border-color);
      display: flex; justify-content: space-between; align-items: center;
    }

    .start-btn {
      padding: 6px 18px; border: none; border-radius: var(--radius-sm);
      background: var(--accent-primary); color: var(--bg-primary);
      cursor: pointer; font-size: 13px; font-weight: 600;
    }
    .start-btn:hover { opacity: 0.9; }
    .start-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .error { color: var(--accent-error); font-size: 12px; margin-top: 6px; }

    .progress-list { list-style: none; padding: 0; margin: 12px 0; }
    .progress-list li {
      padding: 4px 0; font-size: 12px; color: var(--text-secondary);
      display: flex; align-items: center; gap: 8px;
    }
    .progress-list li .icon { width: 16px; text-align: center; }

    .empty-msg {
      padding: 16px; text-align: center;
      color: var(--text-muted); font-size: 12px;
    }
  `;

  constructor() {
    super();
    this.open = false;
    this._branches = [];
    this._selectedBranch = '';
    this._commits = [];
    this._commitQuery = '';
    this._selectedCommit = null;
    this._mergeBaseTarget = 'main';
    this._loading = false;
    this._error = '';
    this._phase = 'select'; // 'select' | 'starting' | 'progress'
  }

  updated(changed) {
    if (changed.has('open') && this.open) {
      this._phase = 'select';
      this._error = '';
      this._selectedCommit = null;
      this._loadBranches();
    }
  }

  async _loadBranches() {
    try {
      const result = await this.rpcExtract('Repo.list_branches');
      if (result?.branches) {
        this._branches = result.branches;
        this._selectedBranch = result.current || '';
        // Default merge base target: pick a sensible branch that exists
        const otherBranches = result.branches
          .map(b => b.name)
          .filter(n => n !== this._selectedBranch);
        // Prefer 'main' or 'master', fall back to first other branch
        this._mergeBaseTarget =
          otherBranches.includes('main') ? 'main'
          : otherBranches.includes('master') ? 'master'
          : otherBranches[0] || '';
        this._loadCommits();
      }
    } catch (e) {
      this._error = 'Failed to load branches: ' + e;
    }
  }

  async _loadCommits() {
    if (!this._selectedBranch) return;
    try {
      const result = await this.rpcExtract(
        'Repo.search_commits', this._commitQuery, this._selectedBranch, 50
      );
      this._commits = Array.isArray(result) ? result : [];
    } catch (e) {
      this._commits = [];
    }
  }

  _onBranchChange(e) {
    this._selectedBranch = e.target.value;
    this._selectedCommit = null;
    this._loadCommits();
  }

  _onCommitSearch(e) {
    this._commitQuery = e.target.value;
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this._loadCommits(), 300);
  }

  _selectCommit(commit) {
    this._selectedCommit = commit;
  }

  async _useMergeBase() {
    this._error = '';
    try {
      const result = await this.rpcExtract(
        'Repo.get_merge_base', this._mergeBaseTarget, this._selectedBranch
      );
      if (result?.error) {
        this._error = result.error;
        return;
      }
      // Find the commit after the merge base
      const commits = await this.rpcExtract(
        'Repo.get_commit_log', result.sha, this._selectedBranch, 200
      );
      if (Array.isArray(commits) && commits.length > 0) {
        // The last commit in the log is the first after merge base
        this._selectedCommit = commits[commits.length - 1];
        this._error = '';
      } else {
        this._error = `No commits found between merge base (${result.short_sha || result.sha?.substring(0, 8)}) and ${this._selectedBranch}`;
      }
    } catch (e) {
      this._error = 'Merge base detection failed: ' + e;
    }
  }

  async _startReview() {
    if (!this._selectedCommit || !this._selectedBranch) return;
    this._phase = 'progress';
    this._loading = true;
    this._error = '';
    try {
      const result = await this.rpcExtract(
        'LLM.start_review', this._selectedBranch, this._selectedCommit.sha
      );
      this._loading = false;
      if (result?.error) {
        this._error = result.error;
        this._phase = 'select';
        return;
      }
      this.dispatchEvent(new CustomEvent('review-started', {
        detail: { result }, bubbles: true, composed: true,
      }));
    } catch (e) {
      this._loading = false;
      this._error = 'Failed to start review: ' + e;
      this._phase = 'select';
    }
  }

  _close() {
    this.dispatchEvent(new CustomEvent('review-closed', {
      bubbles: true, composed: true,
    }));
  }

  _onBackdropClick(e) {
    if (e.target === e.currentTarget) this._close();
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') this._close();
  }

  render() {
    if (!this.open) return nothing;
    return html`
      <div class="backdrop" @click=${this._onBackdropClick} @keydown=${this._onKeyDown}>
        <div class="panel">
          <div class="header">
            <h3>📋 Start Code Review</h3>
            <button class="close-btn" @click=${this._close} aria-label="Close">✕</button>
          </div>

          <div class="body">
            ${this._phase === 'progress' ? this._renderProgress() : this._renderSelect()}
            ${this._error ? html`<div class="error">${this._error}</div>` : nothing}
          </div>

          ${this._phase === 'select' ? html`
            <div class="footer">
              <span style="font-size:11px;color:var(--text-muted)">
                ${this._selectedCommit
                  ? `Selected: ${this._selectedCommit.short_sha} ${this._selectedCommit.message?.substring(0, 40)}`
                  : 'Select a commit to begin review'}
              </span>
              <button class="start-btn" @click=${this._startReview}
                ?disabled=${!this._selectedCommit || this._loading}>
                ${this._loading ? 'Starting...' : 'Start Review'}
              </button>
            </div>
          ` : nothing}
        </div>
      </div>
    `;
  }

  _renderSelect() {
    return html`
      <div class="section">
        <label>Branch</label>
        <select @change=${this._onBranchChange} .value=${this._selectedBranch}>
          ${this._branches.map(b => html`
            <option value=${b.name} ?selected=${b.name === this._selectedBranch}>
              ${b.name} ${b.is_current ? '(current)' : ''}
            </option>
          `)}
        </select>
      </div>

      <div class="section">
        <label>Select first commit to review</label>
        <input type="text" placeholder="Search by message, SHA, or author..."
          .value=${this._commitQuery}
          @input=${this._onCommitSearch}>

        <div class="merge-base-row">
          <span style="font-size:11px;color:var(--text-muted)">Since divergence from:</span>
          <select .value=${this._mergeBaseTarget}
            @change=${(e) => { this._mergeBaseTarget = e.target.value; }}>
            ${this._branches.filter(b => b.name !== this._selectedBranch).map(b => html`
              <option value=${b.name}>${b.name}</option>
            `)}
          </select>
          <button class="merge-base-btn" @click=${this._useMergeBase}>Use merge base</button>
        </div>
      </div>

      <div class="commit-list">
        ${this._commits.length === 0
          ? html`<div class="empty-msg">No commits found</div>`
          : this._commits.map(c => html`
            <div class="commit-item ${this._selectedCommit?.sha === c.sha ? 'selected' : ''}"
              @click=${() => this._selectCommit(c)}>
              <div>
                <span class="commit-sha">${c.short_sha}</span>
                <span class="commit-msg">${c.message}</span>
              </div>
              <div class="commit-meta">${c.author} · ${c.date?.split('T')[0] || ''}</div>
            </div>
          `)
        }
      </div>
    `;
  }

  _renderProgress() {
    return html`
      <div style="text-align:center; padding: 16px 0">
        <div style="font-size:16px; margin-bottom:12px">Entering review mode...</div>
        <ul class="progress-list">
          <li><span class="icon">✓</span> Verified clean working tree</li>
          <li><span class="icon">${this._loading ? '⟳' : '✓'}</span> Building symbol maps & setting up review</li>
        </ul>
      </div>
    `;
  }
}

customElements.define('review-selector', ReviewSelector);