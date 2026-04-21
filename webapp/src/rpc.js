// SharedRpc — singleton holder for the jrpc-oo call proxy.
//
// Layer 5 gives us exactly one root component (AppShell) owning
// exactly one WebSocket connection. Rather than passing a reference
// through the DOM tree or component properties, the root publishes
// the call proxy to this singleton; child components subscribe via
// RpcMixin. This mirrors the pattern documented in
// specs4/1-foundation/rpc-transport.md#rpc-distribution-to-child-components
// (from the specs3 detail reference — the specs4 stub defers the
// exact mechanism to us; this is our implementation choice).
//
// The singleton is deliberately simple — an EventTarget with two
// methods and two state fields. No framework magic, no reactive
// bindings, nothing that can't be tested with a plain object.
//
// Test hook — `reset()` wipes state between test cases. Not part of
// the production contract; production code never calls it.

/**
 * Events dispatched by the shared RPC singleton.
 *
 * - `rpc-ready`   — fired when `set(call)` is called with a proxy.
 *                   Detail: `{call}`.
 * - `rpc-disconnected` — fired when `set(null)` is called.
 *                   No detail.
 *
 * Components using `RpcMixin` subscribe to these via the mixin;
 * most callers never need to listen directly.
 */
const EVENT_READY = 'rpc-ready';
const EVENT_DISCONNECTED = 'rpc-disconnected';

/**
 * Unwrap a jrpc-oo broadcast result.
 *
 * The `call` proxy (returned by `this.call['Cls.method'](args)` on the
 * JRPCClient) resolves to an object keyed by remote UUID:
 *
 *   { 'uuid-of-server-1': <actual result> }
 *
 * In single-remote operation (the common case — one browser, one
 * backend) there is always exactly one key. Components want the
 * inner value, not the envelope. `rpcExtract` pulls out the first
 * value of a single-key object.
 *
 * If the result has multiple keys (multi-remote broadcast — rare in
 * practice since read operations return identical state across
 * remotes), we still return the first value. This is the convention
 * specs3's RpcMixin used and Layer 4's collaboration code depends on:
 * "first key wins for read operations". Callers that care about
 * per-remote results use `rpcCall` instead and inspect the envelope
 * themselves.
 *
 * If the result isn't a plain object (scalar, array, null), or has
 * zero keys, it's returned unchanged — the unwrap is a no-op. This
 * keeps the helper total: it never corrupts a method that genuinely
 * returns `null` or a primitive.
 *
 * @param {*} result — a resolved jrpc-oo response
 * @returns {*} — the unwrapped value, or `result` itself if no
 *   single-key shape was detected
 */
export function rpcExtract(result) {
  if (result === null || typeof result !== 'object') {
    return result;
  }
  // Arrays have a numeric key set; treat them as scalars — never
  // unwrap. (The proxy never returns an array envelope in practice,
  // but a method that genuinely returns an array shouldn't be
  // mutated by this helper either.)
  if (Array.isArray(result)) {
    return result;
  }
  const keys = Object.keys(result);
  if (keys.length === 0) {
    return result;
  }
  // Single key: unwrap. Multi-key: return the first value
  // (specs3/3-llm-engine/streaming_lifecycle.md "first key wins"
  // convention). Either way the access shape is the same.
  return result[keys[0]];
}

/**
 * Singleton holder for the jrpc-oo `call` proxy.
 *
 * Lifecycle:
 *
 *   1. Page loads; SharedRpc exists but is empty (`.call === null`).
 *   2. Root component opens WebSocket, waits for `setupDone`.
 *   3. Root calls `SharedRpc.set(this.call)`. State flips to ready;
 *      `rpc-ready` fires; subscribers kick into life.
 *   4. WebSocket disconnects. Root calls `SharedRpc.set(null)`.
 *      State flips to not-ready; `rpc-disconnected` fires.
 *   5. Reconnect. Root calls `SharedRpc.set(newCall)`. New
 *      `rpc-ready` fires — the *same* shared instance, so components
 *      re-subscribe by virtue of still having their listener attached.
 *
 * Built on EventTarget so subscription semantics match the rest of
 * the browser platform (`addEventListener` / `removeEventListener` /
 * `CustomEvent`). No third-party event emitter library.
 */
class SharedRpcClass extends EventTarget {
  constructor() {
    super();
    /** @type {object | null} */
    this._call = null;
  }

  /**
   * Is a live call proxy currently published?
   * @returns {boolean}
   */
  get isReady() {
    return this._call !== null;
  }

  /**
   * Return the current call proxy, or `null` if none is published.
   *
   * Callers that tolerate a null proxy (e.g. lazy-rendered panels
   * that check readiness before issuing a call) can use this
   * directly. Callers that need a guaranteed proxy should either
   * check `isReady` first or subscribe to `rpc-ready` via
   * `RpcMixin`.
   */
  get call() {
    return this._call;
  }

  /**
   * Publish (or clear) the call proxy.
   *
   * - `set(proxy)` where `proxy` is a truthy object → flips to
   *   ready, fires `rpc-ready` with `{detail: {call: proxy}}`.
   * - `set(null)` → flips to not-ready, fires `rpc-disconnected`.
   *
   * If the new state matches the current state (same proxy object,
   * or both already null), nothing is fired — idempotent.
   *
   * @param {object | null} proxy
   */
  set(proxy) {
    if (proxy === this._call) {
      return;
    }
    if (proxy) {
      this._call = proxy;
      this.dispatchEvent(
        new CustomEvent(EVENT_READY, { detail: { call: proxy } }),
      );
    } else {
      this._call = null;
      this.dispatchEvent(new CustomEvent(EVENT_DISCONNECTED));
    }
  }

  /**
   * Test hook — reset state without firing events.
   *
   * Production code never calls this. Tests use it between cases
   * to ensure the singleton starts each test from a clean state,
   * since all modules importing `SharedRpc` see the same instance.
   */
  reset() {
    this._call = null;
  }
}

/**
 * The singleton instance. Import this, don't construct a new one —
 * the whole point is that every component in the webapp shares
 * this exact object.
 */
export const SharedRpc = new SharedRpcClass();

// Event name constants exposed for test ergonomics. The names are
// stable (they're the DOM event type strings) so callers can
// subscribe with string literals too.
export const RPC_READY_EVENT = EVENT_READY;
export const RPC_DISCONNECTED_EVENT = EVENT_DISCONNECTED;