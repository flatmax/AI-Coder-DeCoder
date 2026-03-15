/**
 * RpcMixin — gives any LitElement access to the shared RPC proxy.
 *
 * Provides:
 *   this.rpcCall(method, ...args)    — raw call returning full envelope
 *   this.rpcExtract(method, ...args) — unwraps the envelope automatically
 *   this.rpcConnected                — boolean
 *   this.onRpcReady()                — override callback
 *   this.showToast(msg, type)        — dispatch global toast event
 */

import { SharedRpc } from './shared-rpc.js';

export const RpcMixin = (superClass) => class extends superClass {
  constructor() {
    super();
    this._rpcCall = null;
    this._rpcListener = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._rpcListener = (call) => {
      this._rpcCall = call;
      this.requestUpdate();
      // Defer to next microtask so all siblings have received the proxy
      Promise.resolve().then(() => {
        if (this._rpcCall) this.onRpcReady();
      });
    };
    SharedRpc.addListener(this._rpcListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._rpcListener) {
      SharedRpc.removeListener(this._rpcListener);
      this._rpcListener = null;
    }
    this._rpcCall = null;
  }

  get rpcConnected() {
    return this._rpcCall != null;
  }

  /** Override in subclasses to run logic when RPC becomes available. */
  onRpcReady() {}

  /** Raw call returning the full jrpc-oo envelope. */
  async rpcCall(method, ...args) {
    if (!this._rpcCall) throw new Error('RPC not connected');
    return this._rpcCall[method](...args);
  }

  /**
   * Call and auto-unwrap the jrpc-oo response envelope.
   *
   * jrpc-oo's `call` proxy broadcasts to all remotes and returns
   * { remote_uuid: return_value }. From the browser there is one
   * remote (the server), so we extract the single value. The server's
   * return value is itself sometimes wrapped as { method_name: value }
   * by the jrpc-oo protocol — we unwrap that second layer too.
   */
  async rpcExtract(method, ...args) {
    const raw = await this.rpcCall(method, ...args);
    return this._unwrap(raw);
  }

  /** Unwrap nested jrpc-oo envelopes: {uuid: {method: value}} → value */
  _unwrap(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const keys = Object.keys(raw);
      if (keys.length === 1) {
        const inner = raw[keys[0]];
        // Check for a second layer of wrapping
        if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
          const innerKeys = Object.keys(inner);
          if (innerKeys.length === 1) return inner[innerKeys[0]];
        }
        return inner;
      }
    }
    return raw;
  }

  /** Dispatch a global toast event. */
  showToast(message, type = 'info') {
    window.dispatchEvent(new CustomEvent('ac-toast', {
      detail: { message, type },
    }));
  }
};