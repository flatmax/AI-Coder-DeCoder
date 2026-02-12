/**
 * Shared RPC singleton — publishes the call proxy from the root component
 * so any child can access RPC without holding the WebSocket connection.
 */

const _listeners = new Set();
let _call = null;

export const SharedRpc = {
  /**
   * Set the call proxy (called by app-shell on connection).
   */
  set(call) {
    _call = call;
    for (const fn of _listeners) {
      try { fn(call); } catch (e) { console.error('SharedRpc listener error:', e); }
    }
  },

  /**
   * Get the current call proxy (may be null if not connected).
   */
  get() {
    return _call;
  },

  /**
   * Register a listener for when the call proxy becomes available.
   * If already available, calls immediately.
   */
  addListener(fn) {
    _listeners.add(fn);
    if (_call) {
      try { fn(_call); } catch (e) { console.error('SharedRpc listener error:', e); }
    }
  },

  /**
   * Remove a listener.
   */
  removeListener(fn) {
    _listeners.delete(fn);
  },

  /**
   * Clear the call proxy (on disconnect).
   */
  clear() {
    _call = null;
  },
};