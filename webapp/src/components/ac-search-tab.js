/**
 * AcSearchTab — full-text search across the repository.
 * Stub — will be implemented in Phase 5 continued.
 */

import { LitElement, html, css } from 'lit';
import { RpcMixin } from '../utils/rpc-mixin.js';

export class AcSearchTab extends RpcMixin(LitElement) {
  static styles = css`
    :host {
      display: flex;
      flex: 1;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
    }
  `;

  render() {
    return html`<div>🔍 Search (coming soon)</div>`;
  }
}

customElements.define('ac-search-tab', AcSearchTab);