/**
 * AcContextTab — context budget viewer.
 * Stub — will be implemented in Phase 5 continued.
 */

import { LitElement, html, css } from 'lit';
import { RpcMixin } from '../utils/rpc-mixin.js';

export class AcContextTab extends RpcMixin(LitElement) {
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
    return html`<div>📊 Context Budget (coming soon)</div>`;
  }
}

customElements.define('ac-context-tab', AcContextTab);