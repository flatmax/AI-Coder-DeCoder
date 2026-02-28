/**
 * Shared RPC singleton — publishes the call proxy from the root component
 * so any child can access RPC without holding the WebSocket connection.
 */

const _listeners = new Set();
let _call = null;
let _collabRole = null;   // { role, is_localhost, client_id }

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
   * Notifies all listeners with null so components can react.
   */
  clear() {
    _call = null;
    for (const fn of _listeners) {
      try { fn(null); } catch (e) { console.error('SharedRpc listener error:', e); }
    }
  },

  /**
   * Set the collaboration role for this client.
   * Called after get_collab_role() RPC completes.
   */
  setCollabRole(role) {
    _collabRole = role;
    // Notify listeners about role change
    window.dispatchEvent(new CustomEvent('collab-role-changed', {
      detail: role,
    }));
  },

  /**
   * Get the current collaboration role.
   * Returns { role, is_localhost, client_id } or null.
   */
  getCollabRole() {
    return _collabRole;
  },

  /**
   * Whether the current client can perform mutating operations.
   * Returns true for localhost clients regardless of role.
   * Returns true when collab role is not yet known (single-user default).
   */
  canMutate() {
    if (!_collabRole) return true; // Not yet known — assume single-user
    return _collabRole.is_localhost === true;
  },
};