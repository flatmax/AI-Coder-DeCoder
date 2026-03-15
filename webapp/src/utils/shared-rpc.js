/**
 * SharedRpc — singleton for distributing the jrpc-oo call proxy
 * to child components that don't hold the WebSocket connection.
 */

const _listeners = new Set();
let _call = null;

export const SharedRpc = {
  /** Publish the call proxy (called by app shell on connect). */
  set(call) {
    _call = call;
    for (const fn of _listeners) {
      try { fn(call); } catch (e) { console.error('SharedRpc listener error:', e); }
    }
  },

  /** Get the current call proxy (may be null). */
  get() {
    return _call;
  },

  /** Register a listener for when the proxy becomes available. */
  addListener(fn) {
    _listeners.add(fn);
    if (_call) {
      try { fn(_call); } catch (e) { console.error('SharedRpc listener error:', e); }
    }
  },

  /** Remove a listener. */
  removeListener(fn) {
    _listeners.delete(fn);
  },

  /** Clear the proxy (on disconnect). */
  clear() {
    _call = null;
  },
};