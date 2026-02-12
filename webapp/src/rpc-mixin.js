/**
 * RPC mixin for child components.
 *
 * Provides rpcCall, rpcExtract, rpcConnected, and onRpcReady().
 * Uses SharedRpc singleton to access the jrpc-oo call proxy.
 *
 * Usage:
 *   class MyComponent extends RpcMixin(LitElement) {
 *     onRpcReady() {
 *       // RPC available — fetch data, set up listeners
 *     }
 *     async _doSomething() {
 *       const data = await this.rpcExtract('LLMService.get_current_state');
 *     }
 *   }
 */

import { SharedRpc } from './shared-rpc.js';

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
    }
  }

  /**
   * Override in subclass to react when RPC becomes available.
   */
  onRpcReady() {}

  /**
   * Raw RPC call — returns the full jrpc-oo envelope.
   *
   * Uses bracket notation: this.call['ClassName.method_name'](...args)
   * Returns { "method_name": value }
   */
  async rpcCall(method, ...args) {
    if (!this._rpcCallProxy) {
      throw new Error('RPC not connected');
    }
    return await this._rpcCallProxy[method](...args);
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
};