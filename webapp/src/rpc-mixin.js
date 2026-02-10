/**
 * RPC Mixin — shared singleton for jrpc-oo call proxy.
 *
 * The root app shell sets the call proxy on connection.
 * Child components use this mixin to access RPC methods.
 *
 * Usage:
 *   class MyComponent extends RpcMixin(LitElement) {
 *     async onRpcReady() {
 *       const result = await this.rpcCall('Repo.get_file_tree');
 *     }
 *   }
 */

let _callProxy = null;
let _readyPromise = null;
let _readyResolve = null;
const _listeners = new Set();

// Create the initial ready promise
function _ensurePromise() {
  if (!_readyPromise) {
    _readyPromise = new Promise(resolve => { _readyResolve = resolve; });
  }
}
_ensurePromise();

export const SharedRpc = {
  /** Called by the root app shell when jrpc-oo connection is ready */
  set(callProxy) {
    _callProxy = callProxy;
    if (_readyResolve) {
      _readyResolve(callProxy);
      _readyResolve = null;
    }
    // Notify all mounted components
    for (const listener of _listeners) {
      try { listener.onRpcReady(); } catch (e) { console.error('onRpcReady error:', e); }
    }
  },

  /** Get the call proxy (may be null if not connected) */
  get call() { return _callProxy; },

  /** True if the connection is established */
  get connected() { return _callProxy !== null; },

  /** Wait for connection */
  get ready() {
    _ensurePromise();
    return _readyPromise;
  },

  /** Reset on disconnect */
  reset() {
    _callProxy = null;
    _readyPromise = new Promise(resolve => { _readyResolve = resolve; });
  },
};

/**
 * RPC Mixin for LitElement components.
 *
 * Provides:
 *   this.rpcCall(method, ...args) — raw call returning {MethodName: result}
 *   this.rpcExtract(method, ...args) — unwraps the envelope
 *   this.rpcConnected — boolean
 *   this.onRpcReady() — override to react to connection
 */
export const RpcMixin = (superClass) => class extends superClass {
  constructor() {
    super();
    this._rpcRegistered = false;
  }

  connectedCallback() {
    super.connectedCallback();
    _listeners.add(this);
    this._rpcRegistered = true;
    if (SharedRpc.connected) {
      // Already connected — schedule callback
      queueMicrotask(() => this.onRpcReady());
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    _listeners.delete(this);
    this._rpcRegistered = false;
  }

  get rpcConnected() {
    return SharedRpc.connected;
  }

  /**
   * Raw RPC call — returns the full envelope { MethodName: result }.
   */
  async rpcCall(method, ...args) {
    if (!SharedRpc.call) {
      await SharedRpc.ready;
    }
    return SharedRpc.call[method](...args);
  }

  /**
   * RPC call that unwraps the jrpc-oo response envelope.
   * jrpc-oo returns { 'MethodName': returnValue }, this extracts returnValue.
   */
  async rpcExtract(method, ...args) {
    const result = await this.rpcCall(method, ...args);
    if (result === null || result === undefined) return result;
    if (typeof result === 'object') {
      const keys = Object.keys(result);
      if (keys.length === 1) {
        return result[keys[0]];
      }
    }
    return result;
  }

  /**
   * Override in subclasses to react when RPC becomes available.
   */
  onRpcReady() {}
};
