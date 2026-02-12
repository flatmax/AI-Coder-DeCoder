/**
 * URL Chips — detection display, fetch triggers, inclusion toggles.
 *
 * Shows detected URLs as chips below chat input. Supports fetch, exclude, remove.
 */

import { LitElement, html, css, nothing } from 'lit';
import { theme } from '../styles/theme.js';
import { RpcMixin } from '../rpc-mixin.js';

// URL type emoji badges
const TYPE_BADGES = {
  github_repo: '📦',
  github_file: '📄',
  github_issue: '🐛',
  github_pr: '🔀',
  documentation: '📚',
  generic: '🌐',
};

export class AcUrlChips extends RpcMixin(LitElement) {
  static properties = {
    /** Detected but not yet fetched URLs: [{url, url_type, display_name}] */
    _detected: { type: Array, state: true },
    /** Fetched URL content: [{url, url_type, title, error, ...}] */
    _fetched: { type: Array, state: true },
    /** URLs currently being fetched */
    _fetching: { type: Object, state: true },
    /** URLs excluded from context */
    _excluded: { type: Object, state: true },
  };

  static styles = [theme, css`
    :host {
      display: block;
    }

    .chips-container {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 6px 0;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 0.75rem;
      border: 1px solid var(--border-primary);
      background: var(--bg-tertiary);
      color: var(--text-secondary);
      max-width: 280px;
      line-height: 1.3;
    }

    .chip .badge {
      flex-shrink: 0;
      font-size: 0.8rem;
    }

    .chip .label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }

    .chip .chip-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.7rem;
      padding: 0 2px;
      cursor: pointer;
      flex-shrink: 0;
      line-height: 1;
    }
    .chip .chip-btn:hover {
      color: var(--text-primary);
    }

    /* Detected chip */
    .chip.detected {
      border-style: dashed;
    }

    .chip.detected .fetch-btn {
      color: var(--accent-primary);
      font-size: 0.8rem;
    }
    .chip.detected .fetch-btn:hover {
      opacity: 0.8;
    }

    /* Fetching chip */
    .chip.fetching {
      border-color: var(--accent-primary);
      opacity: 0.7;
    }

    .spinner {
      display: inline-block;
      width: 10px;
      height: 10px;
      border: 2px solid var(--border-primary);
      border-top-color: var(--accent-primary);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      flex-shrink: 0;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Fetched chip */
    .chip.fetched {
      border-color: var(--accent-green);
      background: rgba(126, 231, 135, 0.08);
    }

    .chip.fetched.excluded {
      border-color: var(--border-primary);
      background: var(--bg-tertiary);
      opacity: 0.6;
    }

    .chip.fetched.error {
      border-color: var(--accent-red);
      background: rgba(255, 161, 152, 0.08);
    }

    .chip .checkbox {
      width: 12px;
      height: 12px;
      cursor: pointer;
      flex-shrink: 0;
      accent-color: var(--accent-green);
    }

    .chip .label.clickable {
      cursor: pointer;
    }
    .chip .label.clickable:hover {
      color: var(--text-primary);
    }
  `];

  constructor() {
    super();
    this._detected = [];
    this._fetched = [];
    this._fetching = new Set();
    this._excluded = new Set();
    this._debounceTimer = null;
  }

  /**
   * Called by parent with current input text to detect URLs.
   */
  async detectUrls(text) {
    if (!text || !this.rpcConnected) {
      this._detected = [];
      return;
    }

    // Debounce
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(async () => {
      try {
        const urls = await this.rpcExtract('LLMService.detect_urls', text);
        if (!Array.isArray(urls)) {
          this._detected = [];
          return;
        }

        // Exclude already-fetched and currently-fetching URLs
        const fetchedUrls = new Set(this._fetched.map(f => f.url));
        const detected = urls.filter(u =>
          !fetchedUrls.has(u.url) && !this._fetching.has(u.url)
        );
        this._detected = detected;
      } catch (e) {
        console.error('URL detection failed:', e);
      }
    }, 300);
  }

  /**
   * Clear detected/fetching on send. Preserve fetched.
   */
  onSend() {
    this._detected = [];
    // fetching left to complete naturally
  }

  /**
   * Full reset.
   */
  clear() {
    this._detected = [];
    this._fetched = [];
    this._fetching = new Set();
    this._excluded = new Set();
  }

  /**
   * Get included (non-excluded, non-error) fetched URLs for context injection.
   */
  getIncludedUrls() {
    return this._fetched
      .filter(f => !f.error && !this._excluded.has(f.url))
      .map(f => f.url);
  }

  /**
   * Get excluded URLs.
   */
  getExcludedUrls() {
    return [...this._excluded];
  }

  // === Actions ===

  async _fetchUrl(url, urlType) {
    if (this._fetching.has(url)) return;

    // Move from detected to fetching
    this._detected = this._detected.filter(d => d.url !== url);
    this._fetching = new Set([...this._fetching, url]);
    this.requestUpdate();

    try {
      const result = await this.rpcExtract(
        'LLMService.fetch_url', url, true, true, null, null
      );

      this._fetching = new Set([...this._fetching].filter(u => u !== url));

      if (result) {
        // Add to fetched
        this._fetched = [...this._fetched, {
          url,
          url_type: result.url_type || urlType || 'generic',
          title: result.title || url,
          error: result.error || null,
          display_name: result.title || this._shortenUrl(url),
        }];
      }
    } catch (e) {
      console.error('URL fetch failed:', e);
      this._fetching = new Set([...this._fetching].filter(u => u !== url));
      this._fetched = [...this._fetched, {
        url,
        url_type: urlType || 'generic',
        title: url,
        error: e.message || 'Fetch failed',
        display_name: this._shortenUrl(url),
      }];
    }

    this._notifyChange();
  }

  _toggleExclude(url) {
    const next = new Set(this._excluded);
    if (next.has(url)) {
      next.delete(url);
    } else {
      next.add(url);
    }
    this._excluded = next;
    this._notifyChange();
  }

  _removeFetched(url) {
    this._fetched = this._fetched.filter(f => f.url !== url);
    const nextExcl = new Set(this._excluded);
    nextExcl.delete(url);
    this._excluded = nextExcl;

    // Invalidate cache
    if (this.rpcConnected) {
      this.rpcExtract('LLMService.invalidate_url_cache', url).catch(() => {});
    }

    this._notifyChange();
  }

  _dismissDetected(url) {
    this._detected = this._detected.filter(d => d.url !== url);
  }

  _viewContent(url) {
    this.dispatchEvent(new CustomEvent('view-url-content', {
      bubbles: true, composed: true,
      detail: { url },
    }));
  }

  _notifyChange() {
    this.dispatchEvent(new CustomEvent('url-chips-changed', {
      bubbles: true, composed: true,
    }));
  }

  _shortenUrl(url) {
    try {
      const u = new URL(url);
      let path = u.pathname.replace(/\/$/, '');
      if (path.length > 30) {
        path = '...' + path.slice(-27);
      }
      return u.hostname + path;
    } catch {
      return url.length > 40 ? url.slice(0, 37) + '...' : url;
    }
  }

  _getDisplayName(item) {
    return item.display_name || item.title || this._shortenUrl(item.url);
  }

  // === Rendering ===

  _renderDetectedChip(item) {
    const badge = TYPE_BADGES[item.url_type] || TYPE_BADGES.generic;
    return html`
      <span class="chip detected">
        <span class="badge">${badge}</span>
        <span class="label" title="${item.url}">${item.display_name || this._shortenUrl(item.url)}</span>
        <button class="chip-btn fetch-btn" @click=${() => this._fetchUrl(item.url, item.url_type)} title="Fetch">📥</button>
        <button class="chip-btn" @click=${() => this._dismissDetected(item.url)} title="Dismiss">×</button>
      </span>
    `;
  }

  _renderFetchingChip(url) {
    return html`
      <span class="chip fetching">
        <span class="spinner"></span>
        <span class="label" title="${url}">${this._shortenUrl(url)}</span>
      </span>
    `;
  }

  _renderFetchedChip(item) {
    const isExcluded = this._excluded.has(item.url);
    const isError = !!item.error;
    const badge = TYPE_BADGES[item.url_type] || TYPE_BADGES.generic;
    const classes = `chip fetched ${isExcluded ? 'excluded' : ''} ${isError ? 'error' : ''}`;

    return html`
      <span class="${classes}">
        ${!isError ? html`
          <input
            type="checkbox"
            class="checkbox"
            .checked=${!isExcluded}
            @change=${() => this._toggleExclude(item.url)}
            title="${isExcluded ? 'Include in context' : 'Exclude from context'}"
          >
        ` : html`<span class="badge">⚠️</span>`}
        <span
          class="label ${!isError ? 'clickable' : ''}"
          title="${item.error || item.url}"
          @click=${!isError ? () => this._viewContent(item.url) : nothing}
        >${this._getDisplayName(item)}</span>
        <button class="chip-btn" @click=${() => this._removeFetched(item.url)} title="Remove">×</button>
      </span>
    `;
  }

  render() {
    const hasContent = this._detected.length > 0 ||
                       this._fetching.size > 0 ||
                       this._fetched.length > 0;

    if (!hasContent) return nothing;

    return html`
      <div class="chips-container">
        ${this._fetched.map(item => this._renderFetchedChip(item))}
        ${[...this._fetching].map(url => this._renderFetchingChip(url))}
        ${this._detected.map(item => this._renderDetectedChip(item))}
      </div>
    `;
  }
}

customElements.define('ac-url-chips', AcUrlChips);