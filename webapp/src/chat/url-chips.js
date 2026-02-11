import { LitElement, html, css, nothing } from 'lit';
import { RpcMixin } from '../rpc-mixin.js';

/**
 * URL chips — shows detected and fetched URLs below chat input.
 *
 * Detected chips: type badge, display name, fetch button, dismiss button.
 * Fetched chips: include/exclude checkbox, clickable label, remove button.
 */
class UrlChips extends RpcMixin(LitElement) {
  static properties = {
    /** Detected but not yet fetched URLs: [{url, url_type, display_name, github_info?}] */
    detected: { type: Array },
    /** Fetched URL results: [{url, url_type, title, error?, display_name?}] */
    fetched: { type: Array },
    /** Set of excluded URL strings */
    excluded: { type: Object },
    /** Set of URLs currently being fetched */
    _fetching: { type: Object, state: true },
  };

  static styles = css`
    :host {
      display: block;
    }

    .chips-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 6px 12px;
      border-top: 1px solid var(--border-color);
      background: var(--bg-secondary);
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 12px;
      line-height: 1.4;
      border: 1px solid var(--border-color);
      background: var(--bg-surface);
      color: var(--text-secondary);
      max-width: 320px;
    }

    .chip.fetched {
      border-color: var(--accent-success);
      background: rgba(102, 187, 106, 0.08);
    }

    .chip.fetched.excluded {
      border-color: var(--border-color);
      background: var(--bg-surface);
      opacity: 0.6;
    }

    .chip.fetched.error {
      border-color: var(--accent-error);
      background: rgba(239, 83, 80, 0.08);
    }

    .chip.fetching {
      border-color: var(--accent-warning);
      background: rgba(255, 167, 38, 0.08);
    }

    .type-badge {
      font-size: 11px;
      flex-shrink: 0;
    }

    .chip-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }

    .chip-label.clickable {
      cursor: pointer;
    }
    .chip-label.clickable:hover {
      color: var(--accent-primary);
      text-decoration: underline;
    }

    .chip-btn {
      background: none;
      border: none;
      padding: 0 2px;
      cursor: pointer;
      font-size: 12px;
      color: var(--text-muted);
      flex-shrink: 0;
      line-height: 1;
    }
    .chip-btn:hover {
      color: var(--text-primary);
    }

    .chip-checkbox {
      width: 13px;
      height: 13px;
      flex-shrink: 0;
      cursor: pointer;
      accent-color: var(--accent-success);
    }

    .spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid var(--border-color);
      border-top-color: var(--accent-warning);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      flex-shrink: 0;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;

  // Type badge emojis
  static TYPE_ICONS = {
    github_repo: '📦',
    github_file: '📄',
    github_issue: '🐛',
    github_pr: '🔀',
    documentation: '📖',
    generic: '🔗',
  };

  constructor() {
    super();
    this.detected = [];
    this.fetched = [];
    this.excluded = new Set();
    this._fetching = new Set();
  }

  // ── Actions ──

  async _fetchUrl(url) {
    if (this._fetching.has(url)) return;

    this._fetching = new Set([...this._fetching, url]);

    try {
      const result = await this.rpcExtract('LLM.fetch_url', url, true, true, '');
      // Remove from detected, add to fetched
      this.dispatchEvent(new CustomEvent('url-fetched', {
        detail: { url, result },
        bubbles: true, composed: true,
      }));
    } catch (e) {
      console.error('URL fetch failed:', e);
      this.dispatchEvent(new CustomEvent('url-fetched', {
        detail: { url, result: { url, error: String(e) } },
        bubbles: true, composed: true,
      }));
    } finally {
      const next = new Set(this._fetching);
      next.delete(url);
      this._fetching = next;
    }
  }

  _dismiss(url) {
    this.dispatchEvent(new CustomEvent('url-dismissed', {
      detail: { url },
      bubbles: true, composed: true,
    }));
  }

  _remove(url) {
    this.dispatchEvent(new CustomEvent('url-removed', {
      detail: { url },
      bubbles: true, composed: true,
    }));
  }

  _toggleExclude(url) {
    this.dispatchEvent(new CustomEvent('url-toggle-exclude', {
      detail: { url },
      bubbles: true, composed: true,
    }));
  }

  _viewContent(url) {
    this.dispatchEvent(new CustomEvent('url-view-content', {
      detail: { url },
      bubbles: true, composed: true,
    }));
  }

  // ── Render ──

  render() {
    const hasDetected = this.detected.length > 0;
    const hasFetched = this.fetched.length > 0;
    const hasFetching = this._fetching.size > 0;

    if (!hasDetected && !hasFetched && !hasFetching) return nothing;

    return html`
      <div class="chips-row" role="list" aria-label="URL references">
        ${this.fetched.map(f => this._renderFetchedChip(f))}
        ${this.detected.map(d => this._renderDetectedChip(d))}
      </div>
    `;
  }

  _renderDetectedChip(info) {
    const isFetching = this._fetching.has(info.url);
    const icon = UrlChips.TYPE_ICONS[info.url_type] || '🔗';

    return html`
      <span class="chip ${isFetching ? 'fetching' : ''}" role="listitem">
        <span class="type-badge" aria-hidden="true">${icon}</span>
        <span class="chip-label">${info.display_name || info.url}</span>
        ${isFetching
          ? html`<span class="spinner" aria-label="Fetching"></span>`
          : html`<button class="chip-btn" title="Fetch" aria-label="Fetch ${info.display_name || info.url}" @click=${() => this._fetchUrl(info.url)}>📥</button>`
        }
        <button class="chip-btn" title="Dismiss" aria-label="Dismiss ${info.display_name || info.url}" @click=${() => this._dismiss(info.url)}>×</button>
      </span>
    `;
  }

  _renderFetchedChip(info) {
    const isExcluded = this.excluded.has(info.url);
    const hasError = !!info.error;
    const icon = UrlChips.TYPE_ICONS[info.url_type] || '🔗';

    return html`
      <span class="chip fetched ${isExcluded ? 'excluded' : ''} ${hasError ? 'error' : ''}" role="listitem">
        ${!hasError ? html`
          <input type="checkbox"
            class="chip-checkbox"
            .checked=${!isExcluded}
            @change=${() => this._toggleExclude(info.url)}
            title=${isExcluded ? 'Include in context' : 'Exclude from context'}
            aria-label="${isExcluded ? 'Include' : 'Exclude'} ${info.title || info.display_name || info.url} ${isExcluded ? 'in' : 'from'} context"
          >
        ` : nothing}
        <span class="type-badge" aria-hidden="true">${hasError ? '⚠️' : icon}</span>
        <span class="chip-label clickable"
          role="button"
          title=${info.url}
          @click=${() => this._viewContent(info.url)}>
          ${info.title || info.display_name || info.url}
        </span>
        <button class="chip-btn" title="Remove" aria-label="Remove ${info.title || info.display_name || info.url}" @click=${() => this._remove(info.url)}>×</button>
      </span>
    `;
  }
}

customElements.define('url-chips', UrlChips);