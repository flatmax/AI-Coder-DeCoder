/**
 * AcSettingsTab — configuration editing and hot-reload.
 * Stub — will be implemented in Phase 5 continued.
 */

import { LitElement, html, css } from 'lit';
import { RpcMixin } from '../utils/rpc-mixin.js';

export class AcSettingsTab extends RpcMixin(LitElement) {
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
    return html`<div>⚙️ Settings (coming soon)</div>`;
  }
}

customElements.define('ac-settings-tab', AcSettingsTab);