import { html } from 'lit';
import { JRPCClient } from '@flatmax/jrpc-oo';
import { SharedRpc } from './rpc-mixin.js';
import './dialog/ac-dialog.js';

/**
 * Root application shell.
 * Extends JRPCClient (LitElement + WebSocket) from jrpc-oo.
 * Manages the RPC connection and hosts the main dialog.
 */
class AcApp extends JRPCClient {
  static properties = {
    connected: { type: Boolean, state: true },
    error: { type: String, state: true },
  };

  constructor() {
    super();
    this.connected = false;
    this.error = '';
    this.remoteTimeout = 60;

    // Extract WebSocket port from URL ?port=N
    const params = new URLSearchParams(window.location.search);
    const port = params.get('port') || '18080';
    this.serverURI = `ws://localhost:${port}`;
  }

  /**
   * Called by jrpc-oo when the WebSocket connection is established
   * and the remote method proxy (this.call) is populated.
   */
  setupDone() {
    console.log(`[ac-dc] Connected to ${this.serverURI}`);
    this.connected = true;
    this.error = '';

    // Publish the call proxy to all child components via the singleton
    SharedRpc.set(this.call);

    // Register client-side methods the server can call back
    this._registerCallbacks();

    // Load initial state
    this._loadInitialState();
  }

  /**
   * Called by jrpc-oo when connection fails or is lost.
   */
  setupSkip() {
    console.warn('[ac-dc] Connection failed or skipped');
    this.connected = false;
    this.error = 'Connection failed';
  }

  /**
   * Register methods the server can call on the client.
   * These handle streaming callbacks and events.
   */
  _registerCallbacks() {
    // Streaming callbacks — the server calls these during chat_streaming
    window.streamChunk = (requestId, content) => {
      this._dispatch('stream-chunk', { requestId, content });
      return true; // Acknowledge to server
    };

    window.streamComplete = (requestId, result) => {
      this._dispatch('stream-complete', { requestId, result });
      return true;
    };

    window.compactionEvent = (requestId, event) => {
      this._dispatch('compaction-event', { requestId, event });
      return true;
    };

    window.filesChanged = (selectedFiles) => {
      this._dispatch('files-changed', { selectedFiles });
      return true;
    };
  }

  async _loadInitialState() {
    try {
      const state = await this._extract('LLM.get_current_state');
      this._dispatch('state-loaded', state);
    } catch (e) {
      console.error('[ac-dc] Failed to load initial state:', e);
    }
  }

  /**
   * Helper to call and unwrap jrpc-oo response envelope.
   */
  async _extract(method, ...args) {
    const result = await this.call[method](...args);
    if (result && typeof result === 'object') {
      const keys = Object.keys(result);
      if (keys.length === 1) return result[keys[0]];
    }
    return result;
  }

  _dispatch(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
  }

  render() {
    return html`
      <ac-dialog .connected=${this.connected} .error=${this.error}></ac-dialog>
    `;
  }
}

customElements.define('ac-app', AcApp);
