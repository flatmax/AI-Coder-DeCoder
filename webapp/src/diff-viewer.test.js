// Tests for diff-viewer.js — Phase 3 groundwork stub.
//
// Pins the public API contract so Phase 3.1 (real Monaco
// implementation) can be swapped in without breaking app
// shell integration. The stub itself is minimal; these
// tests validate the open/close/active-file-changed
// lifecycle that must survive the full Monaco rewrite.

import { afterEach, describe, expect, it, vi } from 'vitest';

import './diff-viewer.js';

const _mounted = [];

function mountViewer() {
  const el = document.createElement('ac-diff-viewer');
  document.body.appendChild(el);
  _mounted.push(el);
  return el;
}

async function settle(el) {
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

afterEach(() => {
  while (_mounted.length) {
    const el = _mounted.pop();
    if (el.isConnected) el.remove();
  }
});

describe('DiffViewer initial state', () => {
  it('renders empty state with watermark when no files open', async () => {
    const el = mountViewer();
    await settle(el);
    const empty = el.shadowRoot.querySelector('.empty-state');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toMatch(/AC.*⚡.*DC/);
  });

  it('has no open files initially', async () => {
    const el = mountViewer();
    await settle(el);
    expect(el.hasOpenFiles).toBe(false);
    expect(el.getDirtyFiles()).toEqual([]);
  });
});

describe('DiffViewer openFile', () => {
  it('opens a file and fires active-file-changed', async () => {
    const el = mountViewer();
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.openFile({ path: 'src/main.py' });
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail).toEqual({
      path: 'src/main.py',
    });
    expect(el.hasOpenFiles).toBe(true);
  });

  it('renders the active file path in the stub content', async () => {
    const el = mountViewer();
    await settle(el);
    el.openFile({ path: 'src/foo.py' });
    await settle(el);
    const path = el.shadowRoot.querySelector('.stub-path');
    expect(path.textContent).toBe('src/foo.py');
  });

  it('same-file open is a no-op (no duplicate event)', async () => {
    // Clicking a mention for an already-open file
    // shouldn't fire active-file-changed again —
    // otherwise the app shell would re-toggle visibility
    // unnecessarily, and Phase 3.1's viewport-restore
    // logic would treat the second open as a tab switch.
    const el = mountViewer();
    await settle(el);
    el.openFile({ path: 'a.py' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.openFile({ path: 'a.py' });
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
  });

  it('opening a second file fires active-file-changed', async () => {
    const el = mountViewer();
    await settle(el);
    el.openFile({ path: 'a.py' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.openFile({ path: 'b.py' });
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.path).toBe('b.py');
  });

  it('re-opening an inactive file switches to it', async () => {
    // Open a, then b. a is now inactive. Re-opening a
    // should switch back without creating a duplicate.
    const el = mountViewer();
    await settle(el);
    el.openFile({ path: 'a.py' });
    await settle(el);
    el.openFile({ path: 'b.py' });
    await settle(el);
    expect(el._files).toHaveLength(2);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.openFile({ path: 'a.py' });
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.path).toBe('a.py');
    // Still only 2 entries — no duplicate.
    expect(el._files).toHaveLength(2);
  });

  it('ignores malformed openFile calls', async () => {
    // Defensive — a bogus navigate-file event shouldn't
    // crash or pollute state.
    const el = mountViewer();
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.openFile(null);
    el.openFile({});
    el.openFile({ path: '' });
    el.openFile({ path: 42 });
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
    expect(el.hasOpenFiles).toBe(false);
  });

  it('accepts (and ignores, for now) line and searchText', async () => {
    // Phase 3.1 will use these for scroll-to-line and
    // scroll-to-anchor. The stub accepts them so callers
    // can pass them without breaking, but doesn't do
    // anything with them yet.
    const el = mountViewer();
    await settle(el);
    el.openFile({
      path: 'a.py',
      line: 42,
      searchText: 'some anchor',
    });
    await settle(el);
    expect(el.hasOpenFiles).toBe(true);
  });
});

describe('DiffViewer closeFile', () => {
  it('closes the active file and clears active state', async () => {
    const el = mountViewer();
    await settle(el);
    el.openFile({ path: 'only.py' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.closeFile('only.py');
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.path).toBeNull();
    expect(el.hasOpenFiles).toBe(false);
  });

  it('closing the active file activates the next one', async () => {
    const el = mountViewer();
    await settle(el);
    el.openFile({ path: 'a.py' });
    el.openFile({ path: 'b.py' });
    await settle(el);
    // b is active (most recently opened).
    expect(el._activeIndex).toBe(1);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.closeFile('b.py');
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.path).toBe('a.py');
  });

  it('closing an inactive file does not change active', async () => {
    const el = mountViewer();
    await settle(el);
    el.openFile({ path: 'a.py' });
    el.openFile({ path: 'b.py' });
    await settle(el);
    // b is active; close a.
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.closeFile('a.py');
    await settle(el);
    // Event still fires so listeners know the file list
    // changed, but the active path is unchanged (still b).
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.path).toBe('b.py');
  });

  it('closing an unknown file is a no-op', async () => {
    const el = mountViewer();
    await settle(el);
    el.openFile({ path: 'a.py' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.closeFile('does-not-exist.py');
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('DiffViewer events bubble and cross shadow DOM', () => {
  it('active-file-changed is composed', async () => {
    // App shell listens via @active-file-changed on the
    // viewer element, so the event must cross the shadow
    // boundary.
    const el = mountViewer();
    await settle(el);
    const outerListener = vi.fn();
    document.body.addEventListener(
      'active-file-changed',
      outerListener,
    );
    try {
      el.openFile({ path: 'a.py' });
      await settle(el);
      expect(outerListener).toHaveBeenCalledOnce();
    } finally {
      document.body.removeEventListener(
        'active-file-changed',
        outerListener,
      );
    }
  });
});

describe('DiffViewer stub API', () => {
  it('refreshOpenFiles is a no-op that does not throw', async () => {
    const el = mountViewer();
    await settle(el);
    expect(() => el.refreshOpenFiles()).not.toThrow();
    // Also safe with files open.
    el.openFile({ path: 'a.py' });
    await settle(el);
    expect(() => el.refreshOpenFiles()).not.toThrow();
  });

  it('getDirtyFiles always returns empty array', async () => {
    // Phase 3.1 tracks dirty state per file; the stub
    // never has dirty files since it doesn't edit. Pin
    // the stub's behaviour so Phase 3.1's tests can
    // extend with the real dirty-tracking semantics.
    const el = mountViewer();
    await settle(el);
    expect(el.getDirtyFiles()).toEqual([]);
    el.openFile({ path: 'a.py' });
    await settle(el);
    expect(el.getDirtyFiles()).toEqual([]);
  });
});