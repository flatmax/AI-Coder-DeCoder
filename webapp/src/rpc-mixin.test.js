// Tests for webapp/src/rpc-mixin.js — RpcMixin lifecycle and RPC helpers.
//
// Strategy: define a fake LitElement-shaped base class (a class with
// `connectedCallback`, `disconnectedCallback`, and `isConnected`) so
// we can test the mixin's behaviour without pulling in Lit's full
// update machinery. The mixin contract is purely in terms of those
// lifecycle methods plus property initialisation — it doesn't
// actually depend on Lit-specific features like reactive property
// propagation. Tests that rely on reactive updates would need a real
// LitElement + updateComplete cycle; we don't currently need that.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SharedRpc } from './rpc.js';
import { RpcMixin } from './rpc-mixin.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/**
 * Minimal LitElement-shaped base class.
 *
 * Provides just enough surface for RpcMixin to work:
 *   - `connectedCallback` / `disconnectedCallback` no-op supers
 *   - `isConnected` field the mixin consults before firing its
 *     microtask hook
 *   - No-op `requestUpdate` so a reactive-property assignment
 *     during tests doesn't crash (Lit's static properties metadata
 *     is read but never acted on)
 *
 * Tests drive the mount/unmount lifecycle manually by calling
 * `connectedCallback()` / `disconnectedCallback()` rather than
 * inserting into a real DOM — simpler, faster, no jsdom element
 * registration ceremony.
 */
class FakeLitBase {
  constructor() {
    this.isConnected = false;
  }
  connectedCallback() {
    this.isConnected = true;
  }
  disconnectedCallback() {
    this.isConnected = false;
  }
  requestUpdate() {
    // No-op — real Lit schedules a render; our tests don't care.
  }
}

/**
 * Instances created during the current test, so `afterEach` can
 * unmount them. Without this, components created by one test stay
 * subscribed to `SharedRpc`'s event listeners — the mixin
 * unsubscribes in `disconnectedCallback`, and tests rarely call
 * it explicitly. Leaked listeners react to subsequent tests'
 * `SharedRpc.set(...)` calls, which (when those leaked components
 * have throwing hooks) produces spurious `console.error` calls
 * that corrupt spy-based assertions.
 *
 * Populated by `makeMixedInstance`; drained by `afterEach`.
 */
const _createdInstances = [];

/**
 * Apply the mixin to the fake base and return a fresh instance.
 *
 * Each call returns a fresh class so hooks overridden in one test
 * (`instance.onRpcReady = vi.fn()`) don't leak into the next.
 *
 * The returned instance is registered in `_createdInstances` so
 * `afterEach` can unmount it.
 */
function makeMixedInstance() {
  class TestComponent extends RpcMixin(FakeLitBase) {}
  const instance = new TestComponent();
  _createdInstances.push(instance);
  return instance;
}

/**
 * Wait for all pending microtasks to flush.
 *
 * `queueMicrotask` schedules its callback for "after the current
 * script completes". Inside a test function, that means the
 * callback runs after we return to the test runner. Awaiting a
 * resolved promise is the standard idiom for letting queued
 * microtasks drain before we assert on their effects.
 *
 * Double-await covers the case where a scheduled microtask itself
 * queues another microtask — rare, but the mixin's hook is allowed
 * to be async, and an awaited promise inside the hook would push
 * work to the next microtask round.
 */
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

describe('RpcMixin', () => {
  beforeEach(() => {
    // Every test starts with SharedRpc in a clean state. Otherwise
    // a test that leaves the proxy published leaks into the next
    // test's connect logic.
    SharedRpc.reset();
  });

  afterEach(() => {
    // Unmount any components the test created via
    // `makeMixedInstance`. This removes their SharedRpc listeners
    // so the next test starts with a clean event subscriber set.
    // Order: unmount first, THEN reset, so any disconnect handlers
    // that try to read state see a consistent singleton.
    while (_createdInstances.length) {
      const instance = _createdInstances.pop();
      try {
        if (instance.isConnected) {
          instance.disconnectedCallback();
        }
      } catch {
        // Defensive — a broken disconnect handler must not
        // prevent us from unmounting the rest.
      }
    }
    SharedRpc.reset();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe('initial state', () => {
    it('sets rpcConnected to false before mount', () => {
      const instance = makeMixedInstance();
      expect(instance.rpcConnected).toBe(false);
    });

    it('declares rpcConnected as a reactive state property', () => {
      // The mixin adds `rpcConnected` to `static properties` so Lit
      // treats it as reactive. Verifies the merge with the base
      // class's properties (if any) happened correctly.
      class TestComponent extends RpcMixin(FakeLitBase) {}
      expect(TestComponent.properties).toBeDefined();
      expect(TestComponent.properties.rpcConnected).toEqual({
        type: Boolean,
        state: true,
      });
    });

    it('merges base class properties with rpcConnected', () => {
      // If the base class already has static properties, the mixin
      // must preserve them rather than replace. Tests the spread
      // merge in the `static properties` definition.
      class BaseWithProps extends FakeLitBase {
        static properties = {
          existingProp: { type: String },
        };
      }
      class TestComponent extends RpcMixin(BaseWithProps) {}
      expect(TestComponent.properties.existingProp).toEqual({
        type: String,
      });
      expect(TestComponent.properties.rpcConnected).toEqual({
        type: Boolean,
        state: true,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Subscription lifecycle
  // -------------------------------------------------------------------------

  describe('subscription lifecycle', () => {
    it('subscribes to rpc-ready on connectedCallback', async () => {
      const instance = makeMixedInstance();
      const hook = vi.fn();
      instance.onRpcReady = hook;

      instance.connectedCallback();

      // No events fired yet — no hook invocation.
      expect(hook).not.toHaveBeenCalled();

      // Publish the proxy; subscription should fire the hook on
      // the next microtask.
      SharedRpc.set({ method: vi.fn() });
      await flushMicrotasks();
      expect(hook).toHaveBeenCalledOnce();
    });

    it('subscribes to rpc-disconnected on connectedCallback', () => {
      const instance = makeMixedInstance();
      const hook = vi.fn();
      instance.onRpcDisconnected = hook;

      instance.connectedCallback();
      SharedRpc.set({ method: vi.fn() });
      SharedRpc.set(null);

      // Disconnect fires synchronously — no microtask needed.
      expect(hook).toHaveBeenCalledOnce();
    });

    it('unsubscribes on disconnectedCallback', async () => {
      const instance = makeMixedInstance();
      const hook = vi.fn();
      instance.onRpcReady = hook;

      instance.connectedCallback();
      instance.disconnectedCallback();

      // Publish AFTER unsubscribing — hook must NOT fire.
      SharedRpc.set({ method: vi.fn() });
      await flushMicrotasks();
      expect(hook).not.toHaveBeenCalled();
    });

    it('supports mount → unmount → remount cycles', async () => {
      // Regression guard — the mixin's subscription handlers are
      // bound once in the constructor. If connectedCallback used a
      // different binding each time, the remove in disconnect
      // wouldn't match and we'd leak listeners across cycles.
      const instance = makeMixedInstance();
      const hook = vi.fn();
      instance.onRpcReady = hook;

      // Cycle 1.
      instance.connectedCallback();
      SharedRpc.set({ method: vi.fn() });
      await flushMicrotasks();
      expect(hook).toHaveBeenCalledTimes(1);

      // Unmount.
      instance.disconnectedCallback();
      SharedRpc.set(null);

      // Cycle 2.
      instance.connectedCallback();
      SharedRpc.set({ method: vi.fn() });
      await flushMicrotasks();
      // Plus one — not two (no listener leak).
      expect(hook).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // Late-mount case
  // -------------------------------------------------------------------------

  describe('late-mount case', () => {
    it('fires onRpcReady when mounting after proxy is already published', async () => {
      // Common scenario: tab panel opened for the first time
      // mid-session. The component mounts AFTER the root has
      // already published the proxy. Without the initial-state
      // check in connectedCallback, the component would never
      // wake up.
      SharedRpc.set({ method: vi.fn() });

      const instance = makeMixedInstance();
      const hook = vi.fn();
      instance.onRpcReady = hook;

      instance.connectedCallback();
      await flushMicrotasks();

      expect(hook).toHaveBeenCalledOnce();
    });

    it('sets rpcConnected=true immediately on late mount', () => {
      // The flag must be true BEFORE the microtask fires so the
      // first render — which happens synchronously on mount in
      // real Lit — sees the correct state.
      SharedRpc.set({ method: vi.fn() });

      const instance = makeMixedInstance();
      instance.connectedCallback();

      // Assertion BEFORE flushing microtasks — the flag must
      // already be true.
      expect(instance.rpcConnected).toBe(true);
    });

    it('does not double-fire when _scheduleReadyHook is called twice in a tick', async () => {
      // Race case: if `rpc-ready` fires during connectedCallback
      // (between subscribe and initial-state check), both paths
      // schedule the hook. The idempotence guard must collapse
      // them into a single invocation.
      //
      // We can't easily trigger this exact timing, but we can
      // prove the guard exists by calling _scheduleReadyHook
      // twice synchronously and asserting the hook runs once.
      const instance = makeMixedInstance();
      const hook = vi.fn();
      instance.onRpcReady = hook;
      instance.connectedCallback();

      instance._scheduleReadyHook();
      instance._scheduleReadyHook();
      await flushMicrotasks();

      expect(hook).toHaveBeenCalledOnce();
    });

    it('schedules again after microtask has flushed', async () => {
      // The idempotence is per-microtask-cycle. Once the
      // microtask has fired, a later _scheduleReadyHook call
      // must schedule a fresh one — otherwise reconnect wouldn't
      // work (second rpc-ready event would be eaten).
      const instance = makeMixedInstance();
      const hook = vi.fn();
      instance.onRpcReady = hook;
      instance.connectedCallback();

      instance._scheduleReadyHook();
      await flushMicrotasks();
      expect(hook).toHaveBeenCalledTimes(1);

      instance._scheduleReadyHook();
      await flushMicrotasks();
      expect(hook).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // Microtask deferral
  // -------------------------------------------------------------------------

  describe('microtask deferral', () => {
    it('flips rpcConnected synchronously but defers onRpcReady', () => {
      // The whole point of the deferral: state flag flips
      // immediately (so templates render correctly) but the
      // subclass hook waits until all synchronous listeners
      // have run.
      const instance = makeMixedInstance();
      const hook = vi.fn();
      instance.onRpcReady = hook;
      instance.connectedCallback();

      SharedRpc.set({ method: vi.fn() });

      // Synchronous check: flag is true, hook hasn't run yet.
      expect(instance.rpcConnected).toBe(true);
      expect(hook).not.toHaveBeenCalled();
    });

    it('fires onRpcReady after all synchronous listeners have run', async () => {
      // Two components subscribe. When rpc-ready fires, both
      // event handlers run synchronously (flipping their
      // rpcConnected flags). The hooks then fire on the
      // microtask — by which time BOTH components are already
      // in the connected state.
      //
      // This is the core contract: if component A's hook issues
      // a call that triggers a broadcast event component B cares
      // about, B must already be marked connected when the
      // broadcast arrives.
      const a = makeMixedInstance();
      const b = makeMixedInstance();

      // Record what b.rpcConnected looked like at the moment
      // a's hook ran.
      let bConnectedWhenAHookRan;
      a.onRpcReady = () => {
        bConnectedWhenAHookRan = b.rpcConnected;
      };
      b.onRpcReady = vi.fn();

      a.connectedCallback();
      b.connectedCallback();

      SharedRpc.set({ method: vi.fn() });
      await flushMicrotasks();

      // b was already connected when a's hook ran.
      expect(bConnectedWhenAHookRan).toBe(true);
    });

    it('does not fire onRpcReady if component unmounts before microtask', async () => {
      // The microtask checks isConnected before invoking the
      // hook. A rapid mount → publish → unmount cycle within a
      // single tick should NOT fire the hook, because the
      // component is gone by the time the microtask runs.
      const instance = makeMixedInstance();
      const hook = vi.fn();
      instance.onRpcReady = hook;

      instance.connectedCallback();
      SharedRpc.set({ method: vi.fn() });
      // Unmount before the microtask fires.
      instance.disconnectedCallback();

      await flushMicrotasks();
      expect(hook).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Reconnect cycle
  // -------------------------------------------------------------------------

  describe('reconnect cycle', () => {
    it('fires onRpcReady again on reconnect', async () => {
      // After a disconnect + reconnect, the hook fires a second
      // time. Components that cached state during the first
      // connection need this signal to refetch.
      const instance = makeMixedInstance();
      const hook = vi.fn();
      instance.onRpcReady = hook;
      instance.connectedCallback();

      SharedRpc.set({ method: vi.fn() });
      await flushMicrotasks();
      expect(hook).toHaveBeenCalledTimes(1);

      SharedRpc.set(null);
      SharedRpc.set({ method: vi.fn() });
      await flushMicrotasks();
      expect(hook).toHaveBeenCalledTimes(2);
    });

    it('fires onRpcDisconnected between reconnect cycles', () => {
      // Full cycle: rpcConnected flips true → false → true, and
      // onRpcDisconnected fires exactly once for the single
      // disconnect in between.
      const instance = makeMixedInstance();
      const disconnectHook = vi.fn();
      instance.onRpcDisconnected = disconnectHook;
      instance.connectedCallback();

      SharedRpc.set({ method: vi.fn() });
      expect(instance.rpcConnected).toBe(true);

      SharedRpc.set(null);
      expect(instance.rpcConnected).toBe(false);
      expect(disconnectHook).toHaveBeenCalledTimes(1);

      SharedRpc.set({ method: vi.fn() });
      expect(instance.rpcConnected).toBe(true);
      // No second disconnect fired.
      expect(disconnectHook).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // rpcCall — raw envelope
  // -------------------------------------------------------------------------

  describe('rpcCall', () => {
    it('forwards the call to the proxy and returns the raw envelope', async () => {
      const envelope = { 'uuid-xyz': { tree: 'data' } };
      const method = vi.fn().mockResolvedValue(envelope);
      SharedRpc.set({ 'Repo.get_file_tree': method });

      const instance = makeMixedInstance();
      instance.connectedCallback();

      const result = await instance.rpcCall('Repo.get_file_tree');
      expect(method).toHaveBeenCalledOnce();
      // Envelope returned as-is — no unwrapping in rpcCall.
      expect(result).toEqual(envelope);
    });

    it('forwards positional arguments', async () => {
      const method = vi.fn().mockResolvedValue({});
      SharedRpc.set({ 'Repo.write_file': method });

      const instance = makeMixedInstance();
      instance.connectedCallback();

      await instance.rpcCall('Repo.write_file', 'a.md', 'hello');
      expect(method).toHaveBeenCalledWith('a.md', 'hello');
    });

    it('throws when no proxy is published', async () => {
      // The singleton is empty in beforeEach. A call without a
      // published proxy should throw with a clear message rather
      // than silently returning undefined or crashing on a null
      // dereference.
      const instance = makeMixedInstance();
      instance.connectedCallback();

      await expect(instance.rpcCall('Any.method')).rejects.toThrow(
        /no RPC proxy published/,
      );
    });

    it('throws when the method is not on the proxy', async () => {
      // Typo in a method name would otherwise hit `undefined(...)`
      // with a cryptic TypeError. The mixin checks first and
      // raises a readable error naming the method.
      SharedRpc.set({ 'Other.method': vi.fn() });

      const instance = makeMixedInstance();
      instance.connectedCallback();

      await expect(
        instance.rpcCall('Repo.does_not_exist'),
      ).rejects.toThrow(/method not found/);
    });

    it('propagates rejections from the remote call', async () => {
      // A genuine RPC error (remote method threw, timeout, etc.)
      // must surface to the caller — the mixin must not swallow.
      const remoteError = new Error('remote exploded');
      const method = vi.fn().mockRejectedValue(remoteError);
      SharedRpc.set({ 'Repo.boom': method });

      const instance = makeMixedInstance();
      instance.connectedCallback();

      await expect(instance.rpcCall('Repo.boom')).rejects.toBe(remoteError);
    });
  });

  // -------------------------------------------------------------------------
  // rpcExtract — envelope unwrapped
  // -------------------------------------------------------------------------

  describe('rpcExtract', () => {
    it('unwraps a single-key envelope', async () => {
      const inner = { tree: 'data', files: ['a.md'] };
      const method = vi.fn().mockResolvedValue({ 'uuid-xyz': inner });
      SharedRpc.set({ 'Repo.get_file_tree': method });

      const instance = makeMixedInstance();
      instance.connectedCallback();

      const result = await instance.rpcExtract('Repo.get_file_tree');
      // Inner value returned directly, envelope stripped.
      expect(result).toEqual(inner);
    });

    it('returns primitives unchanged', async () => {
      // A remote method that returns a scalar (wrapped in a
      // single-key envelope) should yield the scalar directly.
      const method = vi.fn().mockResolvedValue({ uuid: 42 });
      SharedRpc.set({ 'Repo.count': method });

      const instance = makeMixedInstance();
      instance.connectedCallback();

      const result = await instance.rpcExtract('Repo.count');
      expect(result).toBe(42);
    });

    it('forwards arguments like rpcCall', async () => {
      // Same argument-forwarding contract as rpcCall — since
      // rpcExtract is a thin wrapper, we just verify arguments
      // make it through.
      const method = vi.fn().mockResolvedValue({ uuid: null });
      SharedRpc.set({ 'Repo.write_file': method });

      const instance = makeMixedInstance();
      instance.connectedCallback();

      await instance.rpcExtract('Repo.write_file', 'a.md', 'hello');
      expect(method).toHaveBeenCalledWith('a.md', 'hello');
    });

    it('throws when no proxy is published', async () => {
      // Same failure mode as rpcCall — rpcExtract delegates, so
      // the error propagates verbatim.
      const instance = makeMixedInstance();
      instance.connectedCallback();

      await expect(instance.rpcExtract('Any.method')).rejects.toThrow(
        /no RPC proxy published/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Error handling in onRpcReady
  // -------------------------------------------------------------------------

  describe('onRpcReady error handling', () => {
    it('swallows exceptions so sibling components still wire up', async () => {
      // Two components subscribe. Component a's hook throws;
      // component b's hook must still fire. Without the
      // swallow-and-log in _scheduleReadyHook, a's thrown error
      // would propagate out of the microtask and b's hook
      // (queued later) might be skipped.
      const a = makeMixedInstance();
      const b = makeMixedInstance();

      a.onRpcReady = () => {
        throw new Error('a blew up');
      };
      const bHook = vi.fn();
      b.onRpcReady = bHook;

      a.connectedCallback();
      b.connectedCallback();

      // Silence the error log the mixin emits.
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      try {
        SharedRpc.set({ method: vi.fn() });
        await flushMicrotasks();
      } finally {
        consoleSpy.mockRestore();
      }

      expect(bHook).toHaveBeenCalledOnce();
    });

    it('logs thrown errors with the component class name', async () => {
      // The mixin logs `[RpcMixin] onRpcReady threw in <ClassName>:`
      // (two args: formatted message string + the error itself) to
      // help operators diagnose which component failed. Pin down
      // both the prefix and the class-name inclusion so a future
      // rename of the log format is a visible breaking change,
      // not a silent one.
      //
      // Install the console.error spy BEFORE the instance's
      // connectedCallback — otherwise `vi.spyOn` may not be able
      // to intercept calls that were queued on the microtask by
      // logic that ran before the spy was installed. Safer to
      // have the spy active for the entire lifecycle.
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      try {
        class NamedComponent extends RpcMixin(FakeLitBase) {}
        const instance = new NamedComponent();
        instance.onRpcReady = () => {
          throw new Error('boom');
        };
        instance.connectedCallback();

        SharedRpc.set({ method: vi.fn() });
        await flushMicrotasks();

        // Filter to calls from THIS test's component — previous
        // tests in the file left components subscribed to
        // SharedRpc (the mixin registers listeners on mount but
        // only removes them on unmount, and tests call
        // `connectedCallback()` without a matching
        // `disconnectedCallback()`). Those leaked components
        // react to our `SharedRpc.set(...)` too, and a couple of
        // earlier tests install throwing hooks — so the spy
        // records extra console.error calls that aren't about
        // NamedComponent. The filter keeps the assertion focused
        // on the contract we're testing: a throw in a mixed-in
        // component produces a log line naming that component.
        const ownCalls = consoleSpy.mock.calls.filter(
          ([msg]) =>
            typeof msg === 'string' && msg.includes('NamedComponent'),
        );
        expect(ownCalls).toHaveLength(1);
        const [message, err] = ownCalls[0];
        expect(message).toContain('[RpcMixin]');
        expect(message).toContain('NamedComponent');
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe('boom');
      } finally {
        consoleSpy.mockRestore();
      }
    });

    it('still clears the pending flag after a thrown hook', async () => {
      // Without this, a hook that throws once would permanently
      // block future schedule calls — the try/finally around
      // the hook invocation is what prevents that. Prove it by
      // firing a second ready cycle and asserting the hook runs.
      const instance = makeMixedInstance();
      const hook = vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('first call threw');
        })
        .mockImplementationOnce(() => {
          // Second call is a no-op (implicit undefined return).
        });
      instance.onRpcReady = hook;
      instance.connectedCallback();

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      try {
        SharedRpc.set({ method: vi.fn() });
        await flushMicrotasks();
        // Second cycle.
        SharedRpc.set(null);
        SharedRpc.set({ method: vi.fn() });
        await flushMicrotasks();
      } finally {
        consoleSpy.mockRestore();
      }

      expect(hook).toHaveBeenCalledTimes(2);
    });
  });
});