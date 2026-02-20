/**
 * RPC mixin for child components.
 *
 * Provides rpcCall, rpcExtract, rpcConnected, and onRpcReady().
 * Uses SharedRpc singleton to access the jrpc-oo call proxy.
 *
 * Additional safe variants:
 * - rpcSafeExtract: catches errors, shows toast, returns null on failure
 * - rpcSafeCall: catches errors, shows toast, returns null on failure
 *
 * Usage:
 *   class MyComponent extends RpcMixin(LitElement) {
 *     onRpcReady() {
 *       // RPC available — fetch data, set up listeners
 *     }
 *     async _doSomething() {
 *       const data = await this.rpcExtract('LLMService.get_current_state');
 *     }
 *     async _doSafe() {
 *       const data = await this.rpcSafeExtract('LLMService.get_current_state');
 *       if (!data) return; // error already toasted
 *     }
 *   }
 */

import { SharedRpc } from './shared-rpc.js';

/**
 * Dispatch a global toast event.
 */
export function dispatchToast(message, type = 'error') {
  window.dispatchEvent(new CustomEvent('ac-toast', {
    detail: { message, type },
  }));
}

export const RpcMixin = (superClass) => class extends superClass {
  static properties = {
    ...super.properties,
    rpcConnected: { type: Boolean, state: true },
  };

  constructor() {
    super();
    this.rpcConnected = false;
    this._rpcCallProxy = null;
    this._onRpcAvailable = this._onRpcAvailable.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    SharedRpc.addListener(this._onRpcAvailable);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    SharedRpc.removeListener(this._onRpcAvailable);
  }

  _onRpcAvailable(call) {
    this._rpcCallProxy = call;
    this.rpcConnected = !!call;
    if (call) {
      this.onRpcReady();
    } else {
      this.onRpcDisconnected();
    }
  }

  /**
   * Override in subclass to react when RPC becomes available.
   */
  onRpcReady() {}

  /**
   * Override in subclass to react when RPC disconnects.
   */
  onRpcDisconnected() {}

  /**
   * Raw RPC call — returns the full jrpc-oo envelope.
   *
   * Uses bracket notation: this.call['ClassName.method_name'](...args)
   * Returns { "method_name": value }
   *
   * Falls back to SharedRpc.get() if local proxy hasn't arrived yet
   * (handles race where parent triggers call before child listener fires).
   */
  async rpcCall(method, ...args) {
    const call = this._rpcCallProxy || SharedRpc.get();
    if (!call) {
      throw new Error('RPC not connected');
    }
    return await call[method](...args);
  }

  /**
   * Unwrapping RPC call — extracts the value from the jrpc-oo envelope.
   *
   * jrpc-oo wraps returns as { "method_name": value }.
   * This extracts the single value automatically.
   */
  async rpcExtract(method, ...args) {
    const result = await this.rpcCall(method, ...args);
    if (result && typeof result === 'object') {
      const keys = Object.keys(result);
      if (keys.length === 1) return result[keys[0]];
    }
    return result;
  }

  /**
   * Safe unwrapping RPC call — catches errors and shows a toast.
   * Returns null on failure. Use for non-critical operations where
   * the caller doesn't need custom error handling.
   *
   * @param {string} method - RPC method name
   * @param {...any} args - Method arguments
   * @returns {any|null} Result value or null on error
   */
  async rpcSafeExtract(method, ...args) {
    try {
      return await this.rpcExtract(method, ...args);
    } catch (e) {
      const shortMethod = method.split('.').pop() || method;
      console.warn(`RPC ${method} failed:`, e);
      dispatchToast(`${shortMethod} failed: ${e.message || 'Connection error'}`, 'error');
      return null;
    }
  }

  /**
   * Safe raw RPC call — catches errors and shows a toast.
   * Returns null on failure.
   */
  async rpcSafeCall(method, ...args) {
    try {
      return await this.rpcCall(method, ...args);
    } catch (e) {
      const shortMethod = method.split('.').pop() || method;
      console.warn(`RPC ${method} failed:`, e);
      dispatchToast(`${shortMethod} failed: ${e.message || 'Connection error'}`, 'error');
      return null;
    }
  }

  /**
   * Dispatch a toast notification from any component.
   */
  showToast(message, type = '') {
    dispatchToast(message, type);
  }
};