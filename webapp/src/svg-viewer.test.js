// Tests for svg-viewer.js — Phase 3 groundwork stub.
//
// Identical public API contract to diff-viewer — app shell
// treats the two viewers uniformly, and Phase 3.2's real
// SVG viewer inherits the same surface. Tests mirror
// diff-viewer.test.js with the component type swapped.

import { afterEach, describe, expect, it, vi } from 'vitest';

import './svg-viewer.js';

const _mounted = [];

function mountViewer() {
  const el = document.createElement('ac-svg-viewer');
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

describe('SvgViewer initial state', () => {
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

describe('SvgViewer openFile', () => {
  it('opens a file and fires active-file-changed', async () => {
    const el = mountViewer();
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.openFile({ path: 'diagram.svg' });
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail).toEqual({
      path: 'diagram.svg',
    });
    expect(el.hasOpenFiles).toBe(true);
  });

  it('renders the active file path in the stub content', async () => {
    const el = mountViewer();
    await settle(el);
    el.openFile({ path: 'docs/flow.svg' });
    await settle(el);
    const path = el.shadowRoot.querySelector('.stub-path');
    expect(path.textContent).toBe('docs/flow.svg');
  });

  it('same-file open is a no-op', async () => {
    const el = mountViewer();
    await settle(el);
    el.openFile({ path: 'a.svg' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.openFile({ path: 'a.svg' });
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
  });

  it('opening a second file fires active-file-changed', async () => {
    const el = mountViewer();
    await settle(el);
    el.openFile({ path: 'a.svg' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.openFile({ path: 'b.svg' });
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.path).toBe('b.svg');
  });

  it('ignores malformed openFile calls', async () => {
    const el = mountViewer();
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.openFile(null);
    el.openFile({});
    el.openFile({ path: '' });
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
    expect(el.hasOpenFiles).toBe(false);
  });
});

describe('SvgViewer closeFile', () => {
  it('closes the active file and clears active state', async () => {
    const el = mountViewer();
    await settle(el);
    el.openFile({ path: 'only.svg' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.closeFile('only.svg');
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.path).toBeNull();
    expect(el.hasOpenFiles).toBe(false);
  });

  it('closing the active file activates the next one', async () => {
    const el = mountViewer();
    await settle(el);
    el.openFile({ path: 'a.svg' });
    el.openFile({ path: 'b.svg' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.closeFile('b.svg');
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.path).toBe('a.svg');
  });

  it('closing an unknown file is a no-op', async () => {
    const el = mountViewer();
    await settle(el);
    el.openFile({ path: 'a.svg' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.closeFile('does-not-exist.svg');
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('SvgViewer stub API', () => {
  it('refreshOpenFiles is a no-op that does not throw', async () => {
    const el = mountViewer();
    await settle(el);
    expect(() => el.refreshOpenFiles()).not.toThrow();
    el.openFile({ path: 'a.svg' });
    await settle(el);
    expect(() => el.refreshOpenFiles()).not.toThrow();
  });

  it('getDirtyFiles always returns empty array', async () => {
    const el = mountViewer();
    await settle(el);
    expect(el.getDirtyFiles()).toEqual([]);
  });
});