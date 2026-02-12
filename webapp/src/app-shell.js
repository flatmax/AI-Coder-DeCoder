/**
 * App Shell — root component.
 *
 * Extends JRPCClient for WebSocket transport.
 * Manages connection lifecycle, routes events, hosts dialog and diff viewer.
 */

import { html, css } from 'lit';
import { SharedRpc } from './shared-rpc.js';
import { theme } from './styles/theme.js';
import { JRPCClient } from '@flatmax/jrpc-oo/dist/bundle.js';

// Import child components so custom elements are registered
import './components/ac-dialog.js';

/**
 * Extract WebSocket port from URL query parameter ?port=N
 */
function getPortFromURL() {
  const params = new URLSearchParams(window.location.search);
  const port = params.get('port');
  return port ? parseInt(port, 10) : 18080;
}

class AcApp extends JRPCClient {
  static styles = [theme, css`
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
    }

    .viewport {
      position: relative;
      width: 100%;
      height: 100%;
    }

    /* Diff viewer background — watermark for now */
    .diff-background {
      position: fixed;
      inset: 0;
      z-index: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--bg-primary);
    }

    .watermark {
      font-size: 8rem;
      opacity: 0.18;
      user-select: none;
      position: absolute;
      left: 75%;
      transform: translateX(-50%);
    }

    /* Dialog container */
    .dialog-container {
      position: fixed;
      top: 0;
      left: 0;
      width: 50%;
      min-width: 400px;
      height: 100%;
      z-index: 100;
    }

    /* Status bar */
    .status-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      z-index: 10001;
      transition: opacity 0.3s;
    }
    .status-bar.ok { background: var(--accent-green); }
    .status-bar.error { background: var(--accent-red); }
    .status-bar.hidden { opacity: 0; pointer-events: none; }

    /* Reconnecting banner */
    .reconnect-banner {
      position: fixed;
      top: 8px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 0.85rem;
      color: var(--text-secondary);
      z-index: 10001;
      display: none;
    }
    .reconnect-banner.visible { display: block; }
  `];

  constructor() {
    super();
    this._port = getPortFromURL();
    this._reconnectAttempt = 0;

    // Set jrpc-oo connection properties
    this.serverURI = `ws://localhost:${this._port}`;
    this.remoteTimeout = 60;
  }

  connectedCallback() {
    super.connectedCallback();
    console.log(`AC⚡DC connecting to ${this.serverURI}`);

    // Register methods the server can call on us
    this.addClass(this, 'AcApp');
  }

  // === jrpc-oo lifecycle callbacks ===

  remoteIsUp() {
    console.log('WebSocket connected — remote is up');
    this._reconnectAttempt = 0;
  }

  setupDone() {
    console.log('jrpc-oo setup done — call proxy ready');

    // Publish the call proxy so all child components get RPC access
    SharedRpc.set(this.call);

    // Fetch initial state
    this._loadInitialState();
  }

  setupSkip() {
    console.warn('jrpc-oo setup skipped — connection failed');
  }

  remoteDisconnected() {
    console.log('WebSocket disconnected');
    SharedRpc.clear();

    // Notify children
    window.dispatchEvent(new CustomEvent('rpc-disconnected'));
  }

  // === Methods the server can call (registered via addClass) ===

  streamChunk(requestId, content) {
    window.dispatchEvent(new CustomEvent('stream-chunk', {
      detail: { requestId, content },
    }));
    return true;
  }

  streamComplete(requestId, result) {
    window.dispatchEvent(new CustomEvent('stream-complete', {
      detail: { requestId, result },
    }));
    return true;
  }

  compactionEvent(requestId, event) {
    window.dispatchEvent(new CustomEvent('compaction-event', {
      detail: { requestId, event },
    }));
    return true;
  }

  filesChanged(selectedFiles) {
    window.dispatchEvent(new CustomEvent('files-changed', {
      detail: { selectedFiles },
    }));
    return true;
  }

  // === Initial state ===

  async _loadInitialState() {
    try {
      const raw = await this.call['LLMService.get_current_state']();
      // Unwrap jrpc-oo envelope
      const state = this._extract(raw);
      console.log('Initial state loaded:', state);

      window.dispatchEvent(new CustomEvent('state-loaded', { detail: state }));
    } catch (e) {
      console.error('Failed to load initial state:', e);
    }
  }

  /**
   * Unwrap jrpc-oo response envelope { "method_name": value } → value
   */
  _extract(result) {
    if (result && typeof result === 'object') {
      const keys = Object.keys(result);
      if (keys.length === 1) return result[keys[0]];
    }
    return result;
  }

  render() {
    return html`
      <div class="viewport">
        <div class="diff-background">
          <div class="watermark">AC⚡DC</div>
        </div>

        <div class="dialog-container">
          <ac-dialog></ac-dialog>
        </div>
      </div>

      <div class="status-bar hidden"></div>
      <div class="reconnect-banner">Reconnecting...</div>
    `;
  }
}

customElements.define('ac-app', AcApp);