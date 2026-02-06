/**
 * Singleton shared RPC call object.
 *
 * PromptView owns the JRPCClient WebSocket connection and publishes
 * its `call` object here once connected.  Other components use
 * RpcMixin (which reads from this singleton) instead of having
 * `rpcCall` prop-drilled through templates.
 */
let _sharedCall = null;
let _waiters = [];

/**
 * Publish the shared RPC call object.
 * Resolves any components waiting via waitForRpc().
 * @param {object} call - The JRPC call object from PromptView
 */
export function setSharedRpcCall(call) {
  _sharedCall = call;
  for (const resolve of _waiters) resolve(call);
  _waiters = [];
}

/**
 * Get the shared RPC call object (may be null if not yet connected).
 * @returns {object|null}
 */
export function getSharedRpcCall() {
  return _sharedCall;
}

/**
 * Wait for the shared RPC call object to become available.
 * Returns immediately if already set.
 * @returns {Promise<object>}
 */
export function waitForRpc() {
  if (_sharedCall) return Promise.resolve(_sharedCall);
  return new Promise(resolve => _waiters.push(resolve));
}
