// RpcMixin — class mixin for LitElement components that need RPC access.
//
// Two things it solves:
//
// 1. Subscription plumbing. Every component that makes an RPC call
//    needs to subscribe to the SharedRpc singleton's ready/disconnect
//    events, check initial state, and update a reactive property so
//    templates can guard against not-yet-ready state. Writing this
//    per-component is tedious and error-prone; the mixin does it once.
//
// 2. First-call microtask deferral. When `rpc-ready` fires, multiple
//    components' event listeners dispatch synchronously in registration
//    order. If component A's listener immediately issues a call that
//    triggers a broadcast event (e.g. `set_selected_files` which the
//    server echoes as `filesChanged`), component B — registered later
//    in the same tick — might not have run yet, leaving B in an
//    inconsistent state (receives the broadcast before thinking it's
//    connected).
//
//    The mixin schedules each component's `onRpcReady` hook on the
//    next microtask via `queueMicrotask`. Every synchronous listener
//    gets to update state first; only then do the hooks fire.
//
// Usage:
//
//   import { LitElement, html } from 'lit';
//   import { RpcMixin } from './rpc-mixin.js';
//
//   class FilePicker extends RpcMixin(LitElement) {
//     async onRpcReady() {
//       // Called on the microtask following the proxy publication.
//       // Safe to issue calls here; all sibling components have
//       // already updated their connection state.
//       this.tree = await this.rpcExtract('Repo.get_file_tree');
//     }
//
//     render() {
//       if (!this.rpcConnected) return html`<p>connecting…</p>`;
//       // ... use this.tree ...
//     }
//   }

import { SharedRpc, rpcExtract } from './rpc.js';

/**
 * Class mixin that wires a LitElement into `SharedRpc`.
 *
 * The mixin pattern — a function that takes a class and returns a
 * subclass — keeps the plumbing out of component bodies while
 * preserving normal inheritance (a component can extend the mixin
 * result and still override any of its methods).
 *
 * @template {new (...args: any[]) => import('lit').LitElement} Base
 * @param {Base} BaseClass
 * @returns {Base}
 */
export const RpcMixin = (BaseClass) =>
  class RpcMixinHost extends BaseClass {
    static properties = {
      ...(BaseClass.properties ?? {}),
      /**
       * True once a call proxy is published to SharedRpc. Flips
       * back to false on disconnect, true again on reconnect.
       * Use in `render()` to gate UI that depends on the backend.
       */
      rpcConnected: { type: Boolean, state: true },
    };

    constructor() {
      super();
      /** @type {boolean} */
      this.rpcConnected = false;
      // Bound so add/removeEventListener find the same reference.
      this._onRpcReadyEvent = this._onRpcReadyEvent.bind(this);
      this._onRpcDisconnectedEvent =
        this._onRpcDisconnectedEvent.bind(this);
    }

    connectedCallback() {
      super.connectedCallback();
      // Subscribe first, THEN check initial state. If we checked
      // state first, a ready event firing between the check and
      // the subscription would be lost. Subscribing first means
      // at worst we get a duplicate (once via the subscription,
      // once via the initial check), which is handled by
      // `_scheduleReadyHook`'s idempotence guard.
      SharedRpc.addEventListener('rpc-ready', this._onRpcReadyEvent);
      SharedRpc.addEventListener(
        'rpc-disconnected',
        this._onRpcDisconnectedEvent,
      );
      // Component may mount AFTER the root has already published the
      // proxy. Common case: a tab panel opened for the first time
      // mid-session. Schedule the ready hook ourselves so such a
      // component wakes up correctly. Also reflect the initial
      // state into `rpcConnected` — templates rendering on first
      // mount need the correct value before any events fire.
      if (SharedRpc.isReady) {
        this.rpcConnected = true;
        this._scheduleReadyHook();
      }
    }

    disconnectedCallback() {
      SharedRpc.removeEventListener('rpc-ready', this._onRpcReadyEvent);
      SharedRpc.removeEventListener(
        'rpc-disconnected',
        this._onRpcDisconnectedEvent,
      );
      super.disconnectedCallback();
    }

    /**
     * Handler for the `rpc-ready` event on the singleton.
     *
     * Flips `rpcConnected` true synchronously so any template
     * update reflects the new state, then schedules `onRpcReady`
     * on the next microtask so all sibling listeners get to
     * update their own state before any component issues a call.
     *
     * @private
     */
    _onRpcReadyEvent() {
      this.rpcConnected = true;
      this._scheduleReadyHook();
    }

    /**
     * Handler for the `rpc-disconnected` event on the singleton.
     *
     * @private
     */
    _onRpcDisconnectedEvent() {
      this.rpcConnected = false;
      this.onRpcDisconnected();
    }

    /**
     * Schedule `onRpcReady` on the next microtask.
     *
     * Idempotent per tick — if this is called twice before the
     * microtask fires (e.g. initial-state check races with an
     * event arriving), only one hook invocation happens. Without
     * this guard, a component could double-fetch on startup.
     *
     * @private
     */
    _scheduleReadyHook() {
      if (this._rpcReadyHookPending) {
        return;
      }
      this._rpcReadyHookPending = true;
      queueMicrotask(() => {
        this._rpcReadyHookPending = false;
        // Component may have been removed from the DOM before the
        // microtask ran — check before invoking. Avoids calls on
        // torn-down components during rapid mount/unmount cycles
        // (e.g. tests that mount, unmount, re-mount quickly).
        if (!this.isConnected) {
          return;
        }
        try {
          this.onRpcReady();
        } catch (err) {
          // Swallow-and-log so a broken hook in one component
          // doesn't prevent sibling components from wiring up.
          // The hook's job is to fetch initial state; a
          // network-layer failure there is the caller's problem
          // to surface (toast, retry, etc.), not a mixin
          // responsibility.
          console.error(
            `[RpcMixin] onRpcReady threw in ${this.constructor.name}:`,
            err,
          );
        }
      });
    }

    /**
     * Lifecycle hook — called on the microtask after the proxy
     * becomes available. Override in subclasses to fetch initial
     * state.
     *
     * Called:
     *   - Once when the component mounts if the proxy was already
     *     published (late-mount case)
     *   - Every time the proxy is published or re-published
     *     (connect, reconnect)
     *
     * Subclasses should tolerate multiple invocations — a
     * reconnect after a disconnect will fire it again, and the
     * hook should cope with existing state (e.g. refetch tree
     * rather than assert tree is undefined).
     *
     * May be async. Exceptions are logged but not propagated so
     * one component's hook failure doesn't break siblings.
     */
    onRpcReady() {
      // Default is a no-op. Subclasses override as needed.
    }

    /**
     * Lifecycle hook — called when the proxy is cleared.
     *
     * Override to clear cached state or disable UI that requires
     * the backend. Unlike `onRpcReady`, this fires synchronously
     * (no microtask deferral) because disconnect handling is
     * usually about tearing down rather than spinning up, and
     * tests / UI want to see the state flip immediately.
     */
    onRpcDisconnected() {
      // Default is a no-op. Subclasses override as needed.
    }

    /**
     * Raw RPC call — returns the full jrpc-oo envelope.
     *
     * Use when the caller cares about multi-remote responses
     * (Layer 4 collab). The envelope is `{uuid: result, ...}`;
     * in single-remote operation it has exactly one key.
     *
     * @param {string} method — `ClassName.method_name` string
     * @param {...any} args — positional arguments forwarded to the
     *   remote method
     * @returns {Promise<any>} — resolves with the full envelope
     * @throws {Error} when no proxy is published
     */
    async rpcCall(method, ...args) {
      const call = SharedRpc.call;
      if (!call) {
        throw new Error(
          `rpcCall('${method}') failed: no RPC proxy published`,
        );
      }
      const fn = call[method];
      if (typeof fn !== 'function') {
        throw new Error(
          `rpcCall('${method}') failed: method not found on proxy`,
        );
      }
      return await fn(...args);
    }

    /**
     * RPC call with envelope unwrapped.
     *
     * The common case — single-remote operation where every call
     * returns a one-key envelope and the caller wants the inner
     * value. Delegates to `rpcExtract` from rpc.js.
     *
     * @param {string} method — `ClassName.method_name` string
     * @param {...any} args — positional arguments
     * @returns {Promise<any>} — resolves with the unwrapped value
     * @throws {Error} when no proxy is published
     */
    async rpcExtract(method, ...args) {
      const envelope = await this.rpcCall(method, ...args);
      return rpcExtract(envelope);
    }
  };