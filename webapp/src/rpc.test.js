// Tests for webapp/src/rpc.js — SharedRpc singleton + rpcExtract helper.
//
// Uses vitest with jsdom (the webapp's test environment; see
// webapp/vite.config.js). The SharedRpc instance is module-global so
// every test calls `SharedRpc.reset()` in beforeEach to guarantee a
// clean starting state — without this, event listeners registered in
// one test leak into the next.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RPC_DISCONNECTED_EVENT,
  RPC_READY_EVENT,
  SharedRpc,
  rpcExtract,
} from './rpc.js';

// ---------------------------------------------------------------------------
// rpcExtract — envelope unwrapping
// ---------------------------------------------------------------------------

describe('rpcExtract', () => {
  it('unwraps a single-key object to its inner value', () => {
    // jrpc-oo returns { uuid: result } in single-remote operation.
    // Components want the inner value, not the envelope.
    const envelope = { 'some-uuid': { tree: 'data', files: ['a.md'] } };
    expect(rpcExtract(envelope)).toEqual({
      tree: 'data',
      files: ['a.md'],
    });
  });

  it('returns the first value when multiple keys are present', () => {
    // Multi-remote broadcast (collab mode). Specs3 established the
    // "first key wins for read operations" convention — state is
    // identical across remotes for read ops, so picking any one is
    // fine. Callers that care inspect the envelope themselves via
    // rpcCall.
    const multi = { 'uuid-a': 'first', 'uuid-b': 'second' };
    expect(rpcExtract(multi)).toBe('first');
  });

  it('returns primitives unchanged', () => {
    // A method that genuinely returns a scalar shouldn't be
    // mutated by this helper.
    expect(rpcExtract('hello')).toBe('hello');
    expect(rpcExtract(42)).toBe(42);
    expect(rpcExtract(true)).toBe(true);
    expect(rpcExtract(false)).toBe(false);
  });

  it('returns null unchanged', () => {
    // null is a legitimate return value (e.g. "no current review").
    // The helper must not confuse it for "no envelope".
    expect(rpcExtract(null)).toBe(null);
  });

  it('returns undefined unchanged', () => {
    // Defensive — undefined shouldn't appear in jrpc-oo results,
    // but if it does we pass it through rather than crashing.
    expect(rpcExtract(undefined)).toBe(undefined);
  });

  it('returns arrays unchanged', () => {
    // Arrays are objects in JS and have numeric keys. Without the
    // Array.isArray guard we'd return arr[0], which would be a
    // subtle data-corruption bug. Pin it down with an explicit test.
    const arr = ['a', 'b', 'c'];
    expect(rpcExtract(arr)).toBe(arr);
  });

  it('returns empty objects unchanged', () => {
    // Zero keys → no value to unwrap. Return the object itself so
    // callers can distinguish "empty response" from "scalar false".
    const empty = {};
    expect(rpcExtract(empty)).toBe(empty);
  });

  it('preserves nested object identity on unwrap', () => {
    // The inner value should be returned by reference, not cloned.
    // This matters for large objects (file trees, symbol maps) —
    // cloning would be a hidden perf cost.
    const inner = { big: 'object' };
    const envelope = { uuid: inner };
    expect(rpcExtract(envelope)).toBe(inner);
  });
});

// ---------------------------------------------------------------------------
// SharedRpc — singleton + event dispatch
// ---------------------------------------------------------------------------

describe('SharedRpc', () => {
  beforeEach(() => {
    // Every test starts from a clean state. Otherwise a test that
    // leaves the proxy set leaks into the next test's readiness
    // checks.
    SharedRpc.reset();
  });

  afterEach(() => {
    // Clean up any listeners tests added. Without this, listeners
    // accumulate across tests and can swallow events in flaky ways.
    SharedRpc.reset();
  });

  describe('initial state', () => {
    it('starts with no call proxy', () => {
      expect(SharedRpc.call).toBe(null);
    });

    it('reports not-ready initially', () => {
      expect(SharedRpc.isReady).toBe(false);
    });
  });

  describe('set(proxy) — publishing', () => {
    it('stores the proxy and flips isReady', () => {
      const fakeProxy = { 'Repo.get_file_tree': vi.fn() };
      SharedRpc.set(fakeProxy);
      expect(SharedRpc.call).toBe(fakeProxy);
      expect(SharedRpc.isReady).toBe(true);
    });

    it('fires rpc-ready with the proxy in detail', () => {
      // Components subscribe to this event to know when they can
      // start making calls. Detail carries the proxy so subscribers
      // can start using it immediately without a follow-up getter.
      const fakeProxy = { method: vi.fn() };
      const listener = vi.fn();
      SharedRpc.addEventListener(RPC_READY_EVENT, listener);
      SharedRpc.set(fakeProxy);
      expect(listener).toHaveBeenCalledOnce();
      const event = listener.mock.calls[0][0];
      expect(event.detail).toEqual({ call: fakeProxy });
    });

    it('is idempotent for the same proxy object', () => {
      // Publishing the same proxy twice shouldn't fire a second
      // event — subscribers would otherwise re-run their onRpcReady
      // hook and possibly double-fetch state.
      const fakeProxy = { method: vi.fn() };
      const listener = vi.fn();
      SharedRpc.addEventListener(RPC_READY_EVENT, listener);
      SharedRpc.set(fakeProxy);
      SharedRpc.set(fakeProxy);
      expect(listener).toHaveBeenCalledOnce();
    });

    it('fires rpc-ready again when a DIFFERENT proxy is set', () => {
      // Distinct from the idempotence case — a genuinely new proxy
      // (e.g. after reconnect) should re-notify subscribers.
      const proxy1 = { method: vi.fn() };
      const proxy2 = { method: vi.fn() };
      const listener = vi.fn();
      SharedRpc.addEventListener(RPC_READY_EVENT, listener);
      SharedRpc.set(proxy1);
      SharedRpc.set(proxy2);
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe('set(null) — disconnecting', () => {
    it('clears the proxy and flips isReady', () => {
      const fakeProxy = { method: vi.fn() };
      SharedRpc.set(fakeProxy);
      SharedRpc.set(null);
      expect(SharedRpc.call).toBe(null);
      expect(SharedRpc.isReady).toBe(false);
    });

    it('fires rpc-disconnected (no detail)', () => {
      const fakeProxy = { method: vi.fn() };
      SharedRpc.set(fakeProxy);
      const listener = vi.fn();
      SharedRpc.addEventListener(RPC_DISCONNECTED_EVENT, listener);
      SharedRpc.set(null);
      expect(listener).toHaveBeenCalledOnce();
    });

    it('is idempotent when already null', () => {
      // No proxy set → already null → set(null) should be a no-op.
      const listener = vi.fn();
      SharedRpc.addEventListener(RPC_DISCONNECTED_EVENT, listener);
      SharedRpc.set(null);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('event sequencing on reconnect', () => {
    it('fires ready → disconnected → ready across a connection cycle', () => {
      // This is the normal reconnect shape: connect (ready),
      // connection drops (disconnected), reconnect (ready again).
      // Listeners attached once should see all three events.
      const events = [];
      SharedRpc.addEventListener(RPC_READY_EVENT, () => events.push('ready'));
      SharedRpc.addEventListener(RPC_DISCONNECTED_EVENT, () =>
        events.push('disconnected'),
      );

      SharedRpc.set({ method: vi.fn() });
      SharedRpc.set(null);
      SharedRpc.set({ method: vi.fn() });

      expect(events).toEqual(['ready', 'disconnected', 'ready']);
    });
  });

  describe('reset()', () => {
    it('clears the proxy without firing events', () => {
      // reset() is a test hook. Production code uses set(null),
      // which DOES fire a disconnect event. reset() must not fire
      // one — a test fixture that wants to start from a clean
      // slate shouldn't trigger spurious disconnect handlers on
      // the previous test's listeners (which afterEach hasn't
      // removed yet).
      const listener = vi.fn();
      SharedRpc.addEventListener(RPC_DISCONNECTED_EVENT, listener);
      SharedRpc.set({ method: vi.fn() });
      SharedRpc.reset();
      expect(SharedRpc.call).toBe(null);
      expect(SharedRpc.isReady).toBe(false);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('event name constants', () => {
    it('exports matching event name strings', () => {
      // Test hook — callers can subscribe with either the exported
      // constant or a string literal. Pin the actual values so a
      // rename is a visible breaking change.
      expect(RPC_READY_EVENT).toBe('rpc-ready');
      expect(RPC_DISCONNECTED_EVENT).toBe('rpc-disconnected');
    });
  });
});