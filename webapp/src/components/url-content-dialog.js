/**
 * URL Content Dialog — modal overlay showing fetched URL content.
 *
 * Displays README, symbol map, summary, and raw content in scrollable
 * sections with distinct visual treatment. Includes metadata bar and
 * a toggle for full content.
 */

import { LitElement, html, css, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { theme, scrollbarStyles } from '../styles/theme.js';
import { renderMarkdown } from '../utils/markdown.js';

export class AcUrlContentDialog extends LitElement {
  static properties = {
    _visible: { type: Boolean, state: true },
    _content: { type: Object, state: true },    // URLContent dict from server
    _showFull: { type: Boolean, state: true },
  };

  static styles = [theme, scrollbarStyles, css`
    :host {
      display: contents;
    }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .dialog {
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      width: min(90vw, 800px);
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-lg);
      overflow: hidden;
    }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-primary);
      background: var(--bg-tertiary);
      flex-shrink: 0;
    }

    .header h2 {
      margin: 0;
      font-size: 1rem;
      color: var(--text-primary);
      font-weight: 600;
    }

    .close-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 1.2rem;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      line-height: 1;
    }
    .close-btn:hover {
      color: var(--text-primary);
      background: var(--bg-secondary);
    }

    /* Metadata bar */
    .meta-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      padding: 8px 16px;
      background: rgba(79, 195, 247, 0.06);
      border-bottom: 1px solid var(--border-primary);
      font-size: 0.75rem;
      color: var(--text-secondary);
      flex-shrink: 0;
    }

    .meta-bar .meta-label {
      color: var(--text-muted);
      margin-right: 4px;
    }

    .meta-bar .meta-value {
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-size: 0.75rem;
    }

    .meta-bar a {
      color: var(--accent-primary);
      text-decoration: none;
    }
    .meta-bar a:hover {
      text-decoration: underline;
    }

    /* Scrollable body */
    .body {
      flex: 1;
      overflow-y: auto;
      min-height: 0;
    }

    /* Content sections */
    .section {
      padding: 0;
    }

    .section-label {
      display: block;
      padding: 6px 16px;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
      border-top: 1px solid var(--border-primary);
      position: sticky;
      top: 0;
      z-index: 1;
    }

    .section-content {
      padding: 12px 16px;
      font-size: 0.85rem;
      line-height: 1.6;
      color: var(--text-primary);
      max-height: 400px;
      overflow-y: auto;
    }

    .section-content.symbol-map {
      background: rgba(0, 0, 0, 0.2);
      font-family: var(--font-mono);
      font-size: 0.8rem;
      white-space: pre-wrap;
      word-break: break-all;
      line-height: 1.4;
    }

    .section-content.summary {
      background: rgba(79, 195, 247, 0.04);
    }

    /* Markdown inside sections */
    .section-content h1,
    .section-content h2,
    .section-content h3 {
      margin-top: 0.8em;
      margin-bottom: 0.4em;
    }
    .section-content h1 { font-size: 1.1rem; }
    .section-content h2 { font-size: 1rem; }
    .section-content h3 { font-size: 0.95rem; }

    .section-content pre {
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-sm);
      padding: 8px 12px;
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: 0.8rem;
    }

    .section-content code {
      font-family: var(--font-mono);
      font-size: 0.85em;
      background: var(--bg-primary);
      padding: 0.1em 0.3em;
      border-radius: 3px;
    }

    .section-content pre code {
      background: none;
      padding: 0;
    }

    .section-content a {
      color: var(--accent-primary);
      text-decoration: none;
    }
    .section-content a:hover {
      text-decoration: underline;
    }

    .section-content ul,
    .section-content ol {
      padding-left: 24px;
      margin: 6px 0;
    }

    .section-content blockquote {
      border-left: 3px solid var(--border-primary);
      margin: 8px 0;
      padding: 4px 12px;
      color: var(--text-secondary);
    }

    /* Footer with toggle button */
    .footer {
      padding: 8px 16px;
      border-top: 1px solid var(--border-primary);
      background: var(--bg-tertiary);
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }

    .footer-btn {
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      color: var(--text-secondary);
      font-size: 0.8rem;
      padding: 6px 16px;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .footer-btn:hover {
      color: var(--text-primary);
      border-color: var(--accent-primary);
    }

    /* Error state */
    .error-msg {
      padding: 24px 16px;
      color: var(--accent-red);
      font-size: 0.85rem;
      text-align: center;
    }

    /* Type badge */
    .type-badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 8px;
      font-size: 0.7rem;
      font-weight: 600;
    }
    .type-badge.github_repo { background: rgba(126, 231, 135, 0.15); color: var(--accent-green); }
    .type-badge.github_file { background: rgba(79, 195, 247, 0.15); color: var(--accent-primary); }
    .type-badge.github_issue { background: rgba(255, 180, 50, 0.15); color: #f0a030; }
    .type-badge.github_pr { background: rgba(192, 132, 252, 0.15); color: #c084fc; }
    .type-badge.documentation { background: rgba(79, 195, 247, 0.15); color: var(--accent-primary); }
    .type-badge.generic { background: rgba(160, 160, 160, 0.15); color: var(--text-muted); }
  `];

  constructor() {
    super();
    this._visible = false;
    this._content = null;
    this._showFull = false;
  }

  /**
   * Show the dialog with URL content data.
   * @param {object} content - URLContent dict from server (to_dict() format)
   */
  show(content) {
    this._content = content;
    this._showFull = false;
    this._visible = true;
    // Focus the dialog for keyboard handling
    this.updateComplete.then(() => {
      const overlay = this.shadowRoot?.querySelector('.overlay');
      if (overlay) overlay.focus();
    });
  }

  hide() {
    this._visible = false;
    this._content = null;
    this._showFull = false;
  }

  _onOverlayClick(e) {
    // Close when clicking backdrop (not dialog itself)
    if (e.target === e.currentTarget) {
      this.hide();
    }
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.hide();
    }
  }

  _toggleFull() {
    this._showFull = !this._showFull;
  }

  _formatDate(dateStr) {
    if (!dateStr) return 'Unknown';
    try {
      const d = new Date(dateStr);
      return d.toLocaleString();
    } catch {
      return dateStr;
    }
  }

  _renderSection(label, content, extraClass = '') {
    if (!content) return nothing;
    return html`
      <div class="section">
        <span class="section-label">${label}</span>
        <div class="section-content ${extraClass}">
          ${extraClass === 'symbol-map' ? content : unsafeHTML(renderMarkdown(content))}
        </div>
      </div>
    `;
  }

  render() {
    if (!this._visible || !this._content) return nothing;

    const c = this._content;
    const urlType = c.url_type || 'generic';
    const hasReadme = !!c.readme;
    const hasSummary = !!c.summary;
    const hasSymbolMap = !!c.symbol_map;
    const hasContent = !!c.content;
    const hasError = !!c.error;

    // Determine what to show as primary content
    const hasPrimary = hasSummary || hasReadme || hasContent;
    const hasSecondary = (this._showFull && hasContent && (hasSummary || hasReadme));

    return html`
      <div class="overlay"
           tabindex="-1"
           @click=${this._onOverlayClick}
           @keydown=${this._onKeyDown}>
        <div class="dialog" @click=${(e) => e.stopPropagation()}>

          <!-- Header -->
          <div class="header">
            <h2>URL Content</h2>
            <button class="close-btn" @click=${() => this.hide()} title="Close" aria-label="Close">✕</button>
          </div>

          <!-- Metadata bar -->
          <div class="meta-bar">
            <span>
              <span class="meta-label">URL:</span>
              <a href="${c.url}" target="_blank" rel="noopener">${c.url}</a>
            </span>
            <span>
              <span class="meta-label">Type:</span>
              <span class="type-badge ${urlType}">${urlType}</span>
            </span>
            <span>
              <span class="meta-label">Fetched:</span>
              <span class="meta-value">${this._formatDate(c.fetched_at)}</span>
            </span>
            ${c.title ? html`
              <span>
                <span class="meta-label">Title:</span>
                <span class="meta-value">${c.title}</span>
              </span>
            ` : nothing}
          </div>

          <!-- Body -->
          <div class="body">
            ${hasError ? html`
              <div class="error-msg">⚠️ ${c.error}</div>
            ` : nothing}

            ${hasSummary ? this._renderSection('Summary', c.summary, 'summary') : nothing}

            ${hasReadme ? this._renderSection('README', c.readme) : nothing}

            ${!hasSummary && !hasReadme && hasContent
              ? this._renderSection('Content', c.content)
              : nothing}

            ${hasSecondary ? this._renderSection('Full Content', c.content) : nothing}

            ${hasSymbolMap ? this._renderSection('Symbol Map', c.symbol_map, 'symbol-map') : nothing}
          </div>

          <!-- Footer -->
          <div class="footer">
            ${hasPrimary && hasContent && (hasSummary || hasReadme) ? html`
              <button class="footer-btn" @click=${this._toggleFull}>
                ${this._showFull ? 'Hide Details' : 'Show Full Content'}
              </button>
            ` : nothing}
          </div>

        </div>
      </div>
    `;
  }
}

customElements.define('ac-url-content-dialog', AcUrlContentDialog);