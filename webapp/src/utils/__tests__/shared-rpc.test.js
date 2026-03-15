/**
 * Tests for SharedRpc singleton.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SharedRpc } from '../shared-rpc.js';

beforeEach(() => {
  SharedRpc.clear();
});

describe('SharedRpc', () => {
  it('starts with null', () => {
    expect(SharedRpc.get()).toBeNull();
  });

  it('set and get round-trip', () => {
    const proxy = { fake: true };
    SharedRpc.set(proxy);
    expect(SharedRpc.get()).toBe(proxy);
  });

  it('notifies listeners on set', () => {
    const listener = vi.fn();
    SharedRpc.addListener(listener);
    const proxy = { fake: true };
    SharedRpc.set(proxy);
    expect(listener).toHaveBeenCalledWith(proxy);
    SharedRpc.removeListener(listener);
  });

  it('calls listener immediately if proxy already set', () => {
    const proxy = { fake: true };
    SharedRpc.set(proxy);
    const listener = vi.fn();
    SharedRpc.addListener(listener);
    expect(listener).toHaveBeenCalledWith(proxy);
    SharedRpc.removeListener(listener);
  });

  it('does not call listener after removal', () => {
    const listener = vi.fn();
    SharedRpc.addListener(listener);
    // Called once immediately (proxy is null from beforeEach, so not called)
    SharedRpc.removeListener(listener);
    SharedRpc.set({ fake: true });
    // Should not have been called for the set()
    expect(listener).not.toHaveBeenCalled();
  });

  it('clear resets to null', () => {
    SharedRpc.set({ fake: true });
    SharedRpc.clear();
    expect(SharedRpc.get()).toBeNull();
  });

  it('handles listener errors gracefully', () => {
    const badListener = vi.fn(() => { throw new Error('boom'); });
    const goodListener = vi.fn();
    SharedRpc.addListener(badListener);
    SharedRpc.addListener(goodListener);
    // Should not throw
    SharedRpc.set({ fake: true });
    expect(badListener).toHaveBeenCalled();
    expect(goodListener).toHaveBeenCalled();
    SharedRpc.removeListener(badListener);
    SharedRpc.removeListener(goodListener);
  });
});