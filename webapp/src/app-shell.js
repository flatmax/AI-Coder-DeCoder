/**
 * App Shell — root component.
 *
 * Extends JRPCClient for WebSocket transport.
 * Manages connection lifecycle, routes events, hosts dialog and diff viewer.
 */

import { html, css } from 'lit';
import { SharedRpc } from './shared-rpc.js';
import { theme } from './styles/theme.js';
import {JRPCClient} from '@flatmax/jrpc-oo/dist/bundle.js';

/**
 * Extract WebSocket port from URL query parameter ?port=N
 */
function getPortFromURL() {
  const params = new URLSearchParams(window.location.search);
  const port = params.get('port');
  return port ? parseInt(port, 10) : 18080;
}

class AcApp extends HTMLElement {
  constructor() {
    super();
    this._port = getPortFromURL();
    this._connected = false;
    this._state = null;
    this._reconnectAttempt = 0;
    this._reconnectTimer = null;
    this._jrpcClient = null;

    this.attachShadow({ mode: 'open' });
    this._render();
  }

  connectedCallback() {
    this._initConnection();
  }

  disconnectedCallback() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
    }
  }

  async _initConnection() {
    this._setupWebSocket();
  }

  _setupWebSocket() {
    const uri = `ws://localhost:${this._port}`;
    console.log(`AC⚡DC connecting to ${uri}`);

    // Create a minimal jrpc-oo integration
    // Since JRPCClient extends LitElement, we create a hidden instance
    // and proxy its connection to our app shell
    this._jrpcClient = document.createElement('div');

    // For now, use raw WebSocket until jrpc-oo browser package is resolved
    this._ws = new WebSocket(uri);

    this._ws.onopen = () => {
      console.log('WebSocket connected');
      this._connected = true;
      this._reconnectAttempt = 0;
      this._showStatus('Connected', false);

      // TODO: integrate jrpc-oo call proxy here
      // For now, dispatch connected event
      window.dispatchEvent(new CustomEvent('rpc-connected'));
    };

    this._ws.onclose = () => {
      console.log('WebSocket disconnected');
      this._connected = false;
      SharedRpc.clear();
      this._showStatus('Disconnected — reconnecting...', true);
      this._scheduleReconnect();
    };

    this._ws.onerror = (e) => {
      console.error('WebSocket error:', e);
    };

    this._ws.onmessage = (event) => {
      // Handle incoming JSON-RPC messages
      try {
        const msg = JSON.parse(event.data);
        this._handleMessage(msg);
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };
  }

  _handleMessage(msg) {
    // Route server-initiated calls
    if (msg.method) {
      switch (msg.method) {
        case 'streamChunk':
          window.dispatchEvent(new CustomEvent('stream-chunk', {
            detail: { requestId: msg.params?.[0], content: msg.params?.[1] },
          }));
          break;
        case 'streamComplete':
          window.dispatchEvent(new CustomEvent('stream-complete', {
            detail: msg.params?.[0] || msg.params,
          }));
          break;
        case 'compactionEvent':
          window.dispatchEvent(new CustomEvent('compaction-event', {
            detail: msg.params?.[0] || msg.params,
          }));
          break;
        case 'filesChanged':
          window.dispatchEvent(new CustomEvent('files-changed', {
            detail: { selectedFiles: msg.params?.[0] },
          }));
          break;
      }

      // Send acknowledgement
      if (msg.id !== undefined) {
        this._ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: true }));
      }
    }
  }

  _scheduleReconnect() {
    // Exponential backoff: 1s, 2s, 4s, 8s, max 15s
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempt), 15000);
    this._reconnectAttempt++;

    console.log(`Reconnecting in ${delay}ms (attempt ${this._reconnectAttempt})`);

    this._reconnectTimer = setTimeout(() => {
      this._setupWebSocket();
    }, delay);
  }

  _showStatus(message, isError) {
    const status = this.shadowRoot.querySelector('.status-bar');
    if (status) {
      status.textContent = message;
      status.className = `status-bar ${isError ? 'error' : 'ok'}`;
      if (!isError) {
        setTimeout(() => { status.className = 'status-bar hidden'; }, 2000);
      }
    }
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100vw;
          height: 100vh;
          overflow: hidden;
          --bg-primary: #0d1117;
          --bg-secondary: #161b22;
          --bg-tertiary: #21262d;
          --text-primary: #c9d1d9;
          --text-secondary: #8b949e;
          --text-muted: #484f58;
          --border-primary: #30363d;
          --accent-primary: #4fc3f7;
          --accent-green: #7ee787;
          --accent-red: #ffa198;
          --font-mono: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
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

        /* Dialog placeholder */
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
      </style>

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