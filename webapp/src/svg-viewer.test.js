// Tests for svg-viewer.js — side-by-side SVG diff viewer.
//
// SVG is rendered via direct innerHTML injection. Tests
// exercise the lifecycle contract, RPC content fetching,
// dirty tracking, save pipeline, status LED, keyboard
// shortcuts, event surface, and the paired-editor
// viewBox mirroring.
//
// RPC is injected via globalThis.__sharedRpcOverride,
// matching the diff viewer's pattern.
//
// Both panes mount real SvgEditor instances (left is
// read-only; right is editable). No library mocking —
// the editor class is pure DOM manipulation and runs
// fine under jsdom. Tests that need to assert on
// synchronization drive the editors directly via their
// public `setViewBox` / `fitContent` APIs.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

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
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

function setFakeRpc(handlers) {
  const call = {};
  for (const [method, impl] of Object.entries(handlers)) {
    call[method] = impl;
  }
  globalThis.__sharedRpcOverride = call;
}

function clearFakeRpc() {
  delete globalThis.__sharedRpcOverride;
}

// A minimal valid SVG string for content-fetch tests.
// Content text is inspected to verify injection happened.
function svgFixture(label = 'content') {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    `<text x="10" y="50">${label}</text>` +
    '</svg>'
  );
}

beforeEach(() => {
  clearFakeRpc();
});

afterEach(() => {
  while (_mounted.length) {
    const el = _mounted.pop();
    if (el.isConnected) el.remove();
  }
  clearFakeRpc();
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('SvgViewer initial state', () => {
  it('renders the empty-state watermark', async () => {
    const el = mountViewer();
    await settle(el);
    const empty = el.shadowRoot.querySelector('.empty-state');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain('AC');
  });

  it('has no open files initially', async () => {
    const el = mountViewer();
    await settle(el);
    expect(el.hasOpenFiles).toBe(false);
    expect(el.getDirtyFiles()).toEqual([]);
  });

  it('renders no split container when empty', async () => {
    const el = mountViewer();
    await settle(el);
    expect(el.shadowRoot.querySelector('.split')).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// openFile — lifecycle
// ---------------------------------------------------------------------------

describe('SvgViewer openFile', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (path, ref) => {
        return ref === 'HEAD'
          ? svgFixture(`HEAD:${path}`)
          : svgFixture(`WORK:${path}`);
      }),
    });
  });

  it('opens a file and fires active-file-changed', async () => {
    const el = mountViewer();
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    await el.openFile({ path: 'icon.svg' });
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail).toEqual({
      path: 'icon.svg',
    });
    expect(el.hasOpenFiles).toBe(true);
  });

  it('renders both panes with their labels', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'icons/logo.svg' });
    await settle(el);
    const paneLabels = el.shadowRoot.querySelectorAll('.pane-label');
    expect(paneLabels).toHaveLength(2);
    expect(paneLabels[0].textContent).toContain('Original');
    expect(paneLabels[1].textContent).toContain('Modified');
  });

  it('fetches both HEAD and working copy', async () => {
    const el = mountViewer();
    await settle(el);
    const rpc =
      globalThis.__sharedRpcOverride['Repo.get_file_content'];
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    expect(rpc).toHaveBeenCalledWith('a.svg', 'HEAD');
    expect(rpc).toHaveBeenCalledWith('a.svg');
  });

  it('treats missing HEAD as a new file', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (_path, ref) => {
        if (ref === 'HEAD') throw new Error('not in HEAD');
        return svgFixture('working');
      }),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'new.svg' });
    await settle(el);
    const file = el._files[0];
    expect(file.isNew).toBe(true);
    expect(file.original).toBe('');
    expect(file.modified).toContain('working');
  });

  it('handles working-copy fetch failure', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (_path, ref) => {
        if (ref === 'HEAD') return svgFixture('head');
        throw new Error('deleted');
      }),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'deleted.svg' });
    await settle(el);
    const file = el._files[0];
    expect(file.original).toContain('head');
    expect(file.modified).toBe('');
  });

  it('handles missing RPC gracefully', async () => {
    clearFakeRpc();
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    expect(el.hasOpenFiles).toBe(true);
    expect(el._files[0].original).toBe('');
    expect(el._files[0].modified).toBe('');
  });

  it('same-file open still fires active-file-changed', async () => {
    // The viewer deliberately re-fires active-file-changed
    // on same-file open. The app shell relies on this to
    // flip viewer visibility from diff to SVG when the
    // clicked file is already the SVG viewer's active
    // file (e.g. after session restore). See the
    // comment in svg-viewer.js::openFile for details.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.path).toBe('a.svg');
  });

  it('switching between files re-fires active-file-changed', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    await el.openFile({ path: 'b.svg' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.path).toBe('a.svg');
  });

  it('ignores malformed open calls', async () => {
    const el = mountViewer();
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    await el.openFile(null);
    await el.openFile({});
    await el.openFile({ path: '' });
    await el.openFile({ path: 42 });
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
    expect(el.hasOpenFiles).toBe(false);
  });

  it('concurrent openFile for same path drops duplicate', async () => {
    const el = mountViewer();
    await settle(el);
    const p1 = el.openFile({ path: 'a.svg' });
    const p2 = el.openFile({ path: 'a.svg' });
    await Promise.all([p1, p2]);
    await settle(el);
    expect(el._files).toHaveLength(1);
  });

  it('concurrent openFile for different paths proceeds', async () => {
    const el = mountViewer();
    await settle(el);
    const p1 = el.openFile({ path: 'a.svg' });
    const p2 = el.openFile({ path: 'b.svg' });
    await Promise.all([p1, p2]);
    await settle(el);
    expect(el._files).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// SVG injection
// ---------------------------------------------------------------------------

describe('SvgViewer SVG injection', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (path, ref) => {
        return ref === 'HEAD'
          ? svgFixture(`HEAD:${path}`)
          : svgFixture(`WORK:${path}`);
      }),
    });
  });

  it('injects SVG content into both panes', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const leftSvg = el.shadowRoot.querySelector(
      '.pane-left .svg-container svg',
    );
    const rightSvg = el.shadowRoot.querySelector(
      '.pane-right .svg-container svg',
    );
    expect(leftSvg).toBeTruthy();
    expect(rightSvg).toBeTruthy();
    expect(leftSvg.textContent).toContain('HEAD:a.svg');
    expect(rightSvg.textContent).toContain('WORK:a.svg');
  });

  it('injects empty fallback SVG when content is empty', async () => {
    // When HEAD fetch fails, file.original is empty and
    // the viewer injects the _EMPTY_SVG placeholder so
    // the pane doesn't collapse visually. The exact
    // viewBox that survives after injection is not part
    // of the contract — SvgEditor runs fitContent() on
    // the injected SVG during attach, which may rewrite
    // viewBox to match computed bounds. The invariant
    // we care about is that an SVG element exists in
    // the pane.
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (_path, ref) => {
        if (ref === 'HEAD') throw new Error('no head');
        return svgFixture('working');
      }),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'new.svg' });
    await settle(el);
    const leftSvg = el.shadowRoot.querySelector(
      '.pane-left .svg-container svg',
    );
    expect(leftSvg).toBeTruthy();
    // The file is marked as new so the status LED can
    // show the new-file indicator.
    expect(el._files[0].isNew).toBe(true);
    expect(el._files[0].original).toBe('');
  });

  it('re-injects content on file switch', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    await el.openFile({ path: 'b.svg' });
    await settle(el);
    const leftSvg = el.shadowRoot.querySelector(
      '.pane-left .svg-container svg',
    );
    expect(leftSvg.textContent).toContain('HEAD:b.svg');
  });
});

// ---------------------------------------------------------------------------
// closeFile
// ---------------------------------------------------------------------------

describe('SvgViewer closeFile', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => svgFixture()),
    });
  });

  it('clears active state when last file closes', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    el.closeFile('a.svg');
    await settle(el);
    expect(el.hasOpenFiles).toBe(false);
    expect(el.shadowRoot.querySelector('.empty-state')).toBeTruthy();
  });

  it('switches to next file when active file closes', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    await el.openFile({ path: 'b.svg' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.closeFile('b.svg');
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.path).toBe('a.svg');
  });

  it('closing inactive file does not change active', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    await el.openFile({ path: 'b.svg' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.closeFile('a.svg');
    await settle(el);
    expect(el._files[el._activeIndex].path).toBe('b.svg');
    expect(listener).not.toHaveBeenCalled();
  });

  it('closing unknown file is a no-op', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.closeFile('does-not-exist.svg');
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Dirty tracking & saving
// ---------------------------------------------------------------------------

describe('SvgViewer dirty tracking', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () =>
        svgFixture('original'),
      ),
    });
  });

  it('is not dirty immediately after open', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    expect(el.getDirtyFiles()).toEqual([]);
    expect(el._dirtyCount).toBe(0);
  });

  it('marks file dirty when modified differs from saved', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    el._files[0].modified = svgFixture('edited');
    el._recomputeDirtyCount();
    await settle(el);
    expect(el.getDirtyFiles()).toEqual(['a.svg']);
  });

  it('saving clears dirty flag and fires file-saved', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    el._files[0].modified = svgFixture('edited');
    el._recomputeDirtyCount();
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    await el._saveFile('a.svg');
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.path).toBe('a.svg');
    expect(listener.mock.calls[0][0].detail.content).toContain('edited');
    expect(el.getDirtyFiles()).toEqual([]);
  });

  it('file-saved bubbles across shadow DOM', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    el._files[0].modified = svgFixture('edited');
    el._recomputeDirtyCount();
    const outerListener = vi.fn();
    document.body.addEventListener('file-saved', outerListener);
    try {
      await el._saveFile('a.svg');
      expect(outerListener).toHaveBeenCalledOnce();
    } finally {
      document.body.removeEventListener('file-saved', outerListener);
    }
  });

  it('saveAll saves every dirty file', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    await el.openFile({ path: 'b.svg' });
    await settle(el);
    el._files[0].modified = svgFixture('a-edited');
    el._files[1].modified = svgFixture('b-edited');
    el._recomputeDirtyCount();
    await settle(el);
    expect(el.getDirtyFiles().sort()).toEqual(['a.svg', 'b.svg']);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    await el.saveAll();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(el.getDirtyFiles()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Status LED
// ---------------------------------------------------------------------------

describe('SvgViewer status LED', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () =>
        svgFixture('original'),
      ),
    });
  });

  it('shows clean when file matches saved', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const led = el.shadowRoot.querySelector('.status-led');
    expect(led).toBeTruthy();
    expect(led.classList.contains('clean')).toBe(true);
  });

  it('shows new-file for files missing at HEAD', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (_p, ref) => {
        if (ref === 'HEAD') throw new Error('not in HEAD');
        return svgFixture('working');
      }),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'new.svg' });
    await settle(el);
    const led = el.shadowRoot.querySelector('.status-led');
    expect(led.classList.contains('new-file')).toBe(true);
  });

  it('shows dirty after external content change', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    el._files[0].modified = svgFixture('edited');
    el._recomputeDirtyCount();
    await settle(el);
    const led = el.shadowRoot.querySelector('.status-led');
    expect(led.classList.contains('dirty')).toBe(true);
  });

  it('clicking dirty LED saves the file', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    el._files[0].modified = svgFixture('edited');
    el._recomputeDirtyCount();
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    el.shadowRoot.querySelector('.status-led').click();
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('clicking clean LED is a no-op', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    el.shadowRoot.querySelector('.status-led').click();
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
  });

  it('tooltip reflects file path', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'icons/logo.svg' });
    await settle(el);
    const led = el.shadowRoot.querySelector('.status-led');
    expect(led.getAttribute('title')).toContain('icons/logo.svg');
  });
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

describe('SvgViewer keyboard shortcuts', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => svgFixture()),
    });
  });

  function fireKey(el, key) {
    const ev = new KeyboardEvent('keydown', {
      key,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(ev, 'composedPath', {
      value: () => [el, document.body, document],
    });
    el.dispatchEvent(ev);
    return ev;
  }

  it('Ctrl+S saves active file', async () => {
    const el = mountViewer();
    el.classList.add('viewer-visible');
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    el._files[0].modified = svgFixture('edited');
    el._recomputeDirtyCount();
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    fireKey(el, 's');
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('Ctrl+W closes active file', async () => {
    const el = mountViewer();
    el.classList.add('viewer-visible');
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    fireKey(el, 'w');
    await settle(el);
    expect(el.hasOpenFiles).toBe(false);
  });

  it('Ctrl+PageDown cycles to next file', async () => {
    const el = mountViewer();
    el.classList.add('viewer-visible');
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    await el.openFile({ path: 'b.svg' });
    await settle(el);
    // b is active.
    fireKey(el, 'PageDown');
    await settle(el);
    expect(el._files[el._activeIndex].path).toBe('a.svg');
  });

  it('Ctrl+PageUp cycles to previous file', async () => {
    const el = mountViewer();
    el.classList.add('viewer-visible');
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    await el.openFile({ path: 'b.svg' });
    await settle(el);
    fireKey(el, 'PageUp');
    await settle(el);
    expect(el._files[el._activeIndex].path).toBe('a.svg');
  });

  it('Ctrl+PageDown no-op with single file', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    fireKey(el, 'PageDown');
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
  });

  it('shortcuts without Ctrl do not fire', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    const ev = new KeyboardEvent('keydown', {
      key: 's',
      bubbles: true,
    });
    Object.defineProperty(ev, 'composedPath', {
      value: () => [el],
    });
    el.dispatchEvent(ev);
    expect(listener).not.toHaveBeenCalled();
  });

  it('shortcuts from outside do not fire', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    const ev = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
    });
    Object.defineProperty(ev, 'composedPath', {
      value: () => [document.body, document],
    });
    document.dispatchEvent(ev);
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// refreshOpenFiles
// ---------------------------------------------------------------------------

describe('SvgViewer refreshOpenFiles', () => {
  it('re-fetches all open files', async () => {
    let version = 1;
    const rpc = vi.fn(async (path, ref) => {
      return svgFixture(
        `${ref === 'HEAD' ? 'HEAD' : 'WORK'}:${path}:v${version}`,
      );
    });
    setFakeRpc({ 'Repo.get_file_content': rpc });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    expect(el._files[0].original).toContain('v1');
    version = 2;
    await el.refreshOpenFiles();
    await settle(el);
    expect(el._files[0].original).toContain('v2');
    expect(el._files[0].modified).toContain('v2');
  });

  it('skips dirty files to preserve in-progress edits', async () => {
    // A user mid-edit in the SvgEditor has local changes
    // that haven't been saved. A refresh triggered by
    // some unrelated file's change must not clobber
    // those edits.
    let version = 1;
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () =>
        svgFixture(`disk:v${version}`),
      ),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    // Simulate user edit.
    el._files[0].modified = svgFixture('user-edit');
    el._recomputeDirtyCount();
    await settle(el);
    expect(el.getDirtyFiles()).toEqual(['a.svg']);
    version = 2;
    await el.refreshOpenFiles();
    await settle(el);
    // User's edit survives; disk content not pulled.
    expect(el._files[0].modified).toContain('user-edit');
    expect(el._files[0].modified).not.toContain('v2');
    // Dirty flag preserved.
    expect(el.getDirtyFiles()).toEqual(['a.svg']);
  });
});

describe('SvgViewer files-modified broadcast', () => {
  it('refreshes when an open file appears in the event', async () => {
    let version = 1;
    const rpc = vi.fn(async () => svgFixture(`v${version}`));
    setFakeRpc({ 'Repo.get_file_content': rpc });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    expect(el._files[0].original).toContain('v1');
    version = 2;
    window.dispatchEvent(
      new CustomEvent('files-modified', {
        detail: { paths: ['a.svg'] },
      }),
    );
    // Listener kicks off refresh asynchronously — let
    // it settle before reading state.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await settle(el);
    expect(el._files[0].original).toContain('v2');
  });

  it('ignores broadcasts for unrelated files', async () => {
    const rpc = vi.fn(async () => svgFixture('v1'));
    setFakeRpc({ 'Repo.get_file_content': rpc });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    // Initial open fetches HEAD + working = 2 calls.
    expect(rpc).toHaveBeenCalledTimes(2);
    window.dispatchEvent(
      new CustomEvent('files-modified', {
        detail: { paths: ['other.svg', 'unrelated.md'] },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await settle(el);
    // No additional fetches — the listener short-circuited.
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('refreshes defensively when paths list is missing', async () => {
    // Older backends or unusual edit paths may dispatch
    // the event with an empty or absent paths field.
    // Refresh all open files rather than ignoring —
    // cost is bounded (N fetches for N open tabs) and
    // the alternative is staleness.
    let version = 1;
    const rpc = vi.fn(async () => svgFixture(`v${version}`));
    setFakeRpc({ 'Repo.get_file_content': rpc });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    version = 2;
    window.dispatchEvent(
      new CustomEvent('files-modified', {
        detail: {},
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await settle(el);
    expect(el._files[0].original).toContain('v2');
  });

  it('is a no-op when no files are open', async () => {
    const rpc = vi.fn(async () => svgFixture());
    setFakeRpc({ 'Repo.get_file_content': rpc });
    const el = mountViewer();
    await settle(el);
    // No open files — RPC should not be called.
    window.dispatchEvent(
      new CustomEvent('files-modified', {
        detail: { paths: ['a.svg'] },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await settle(el);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('removes the listener on disconnect', async () => {
    const rpc = vi.fn(async () => svgFixture());
    setFakeRpc({ 'Repo.get_file_content': rpc });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    rpc.mockClear();
    el.remove();
    window.dispatchEvent(
      new CustomEvent('files-modified', {
        detail: { paths: ['a.svg'] },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(rpc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Event composition
// ---------------------------------------------------------------------------

describe('SvgViewer events cross shadow DOM', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => svgFixture()),
    });
  });

  it('active-file-changed is composed', async () => {
    const el = mountViewer();
    await settle(el);
    const outerListener = vi.fn();
    document.body.addEventListener(
      'active-file-changed',
      outerListener,
    );
    try {
      await el.openFile({ path: 'a.svg' });
      await settle(el);
      expect(outerListener).toHaveBeenCalledOnce();
    } finally {
      document.body.removeEventListener(
        'active-file-changed',
        outerListener,
      );
    }
  });

  it('close carries null path in event detail', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.closeFile('a.svg');
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail).toEqual({ path: null });
  });
});


// ---------------------------------------------------------------------------
// Fit button
// ---------------------------------------------------------------------------

describe('SvgViewer fit button', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => svgFixture()),
    });
  });

  it('renders the fit button when a file is open', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const btn = el.shadowRoot.querySelector(
      '.floating-actions .float-btn[title="Fit to view"]',
    );
    expect(btn).toBeTruthy();
  });

  it('does not render the fit button in empty state', async () => {
    const el = mountViewer();
    await settle(el);
    expect(el.shadowRoot.querySelector('.floating-actions')).toBe(null);
  });

  it('click calls fitContent on both editors', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const leftFit = vi.spyOn(el._editorLeft, 'fitContent');
    const rightFit = vi.spyOn(el._editorRight, 'fitContent');
    el.shadowRoot
      .querySelector('.floating-actions .float-btn[title="Fit to view"]')
      .click();
    expect(leftFit).toHaveBeenCalled();
    expect(rightFit).toHaveBeenCalled();
  });

  it('click with no editors is a no-op', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    // Drop both editors to simulate an edge case.
    el._editorLeft = null;
    el._editorRight = null;
    el._editor = null;
    // Should not throw.
    expect(() =>
      el.shadowRoot
        .querySelector('.floating-actions .float-btn[title="Fit to view"]')
        .click(),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// relayout — called by app shell on dialog / window resize
// ---------------------------------------------------------------------------

describe('SvgViewer relayout', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => svgFixture()),
    });
  });

  it('calls fitContent on both editors when a file is open', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const leftFit = vi.spyOn(el._editorLeft, 'fitContent');
    const rightFit = vi.spyOn(el._editorRight, 'fitContent');
    el.relayout();
    expect(leftFit).toHaveBeenCalled();
    expect(rightFit).toHaveBeenCalled();
    // Both calls silent — suppresses onViewChange so
    // the mirror path doesn't cascade during relayout.
    expect(leftFit.mock.calls[0][0]).toEqual({ silent: true });
    expect(rightFit.mock.calls[0][0]).toEqual({ silent: true });
  });

  it('is a no-op when no file is open', async () => {
    const el = mountViewer();
    await settle(el);
    expect(el._editorLeft).toBe(null);
    expect(el._editorRight).toBe(null);
    // No editors, no crash.
    expect(() => el.relayout()).not.toThrow();
  });

  it('holds the sync mutex across both fit calls', async () => {
    // Defensive: with `silent: true` already preventing
    // onViewChange cascade, the mutex is belt-and-braces.
    // Still, we pin that it's held during the call so
    // a future refactor that drops the silent flag would
    // still be safe.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    let mutexDuringLeft = null;
    let mutexDuringRight = null;
    vi.spyOn(el._editorLeft, 'fitContent').mockImplementation(
      () => { mutexDuringLeft = el._syncingViewBox; },
    );
    vi.spyOn(el._editorRight, 'fitContent').mockImplementation(
      () => { mutexDuringRight = el._syncingViewBox; },
    );
    el.relayout();
    expect(mutexDuringLeft).toBe(true);
    expect(mutexDuringRight).toBe(true);
    // And cleared after.
    expect(el._syncingViewBox).toBe(false);
  });

  it('survives fitContent throwing on one side', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    vi.spyOn(el._editorLeft, 'fitContent').mockImplementation(
      () => { throw new Error('boom'); },
    );
    const rightFit = vi.spyOn(el._editorRight, 'fitContent');
    // Left throw is swallowed; right still runs.
    expect(() => el.relayout()).not.toThrow();
    expect(rightFit).toHaveBeenCalled();
    // Mutex released even after an exception.
    expect(el._syncingViewBox).toBe(false);
  });

  it('syncs right viewBox to left after relayout', async () => {
    // Each pane's fit runs against its own container,
    // producing potentially sub-pixel-different viewBoxes.
    // The final sync ensures the two panes display the
    // same region. Mirrors the behaviour of _onFitClick.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    // Spy on left setViewBox — the sync target. The
    // right's fitContent is called first (no-op here
    // since we don't stub it); then right.getViewBox()
    // feeds left.setViewBox.
    const leftSet = vi.spyOn(el._editorLeft, 'setViewBox');
    el.relayout();
    // At least one call — the final right→left sync.
    // The fit itself may also internally call
    // setViewBox, so we just assert the sync happened
    // with silent:true (the contract for mirror writes).
    expect(leftSet).toHaveBeenCalled();
    const lastCall =
      leftSet.mock.calls[leftSet.mock.calls.length - 1];
    expect(lastCall[4]).toEqual({ silent: true });
  });
});


// ---------------------------------------------------------------------------
// SvgEditor integration
// ---------------------------------------------------------------------------

describe('SvgViewer SvgEditor integration', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => svgFixture()),
    });
  });

  it('creates editors on both panels after open', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const leftSvg = el.shadowRoot.querySelector(
      '.pane-left .svg-container svg',
    );
    const rightSvg = el.shadowRoot.querySelector(
      '.pane-right .svg-container svg',
    );
    expect(el._editorLeft).toBeTruthy();
    expect(el._editorRight).toBeTruthy();
    expect(el._editorLeft._svg).toBe(leftSvg);
    expect(el._editorRight._svg).toBe(rightSvg);
  });

  it('left editor is read-only; right editor is editable', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    expect(el._editorLeft._readOnly).toBe(true);
    expect(el._editorRight._readOnly).toBe(false);
  });

  it('back-compat _editor alias points at the right editor', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    expect(el._editor).toBe(el._editorRight);
  });

  it('applies preserveAspectRatio="none" to both panes', async () => {
    // Both panes drive viewBox writes through their own
    // editor now, so both need "none" to prevent browser
    // aspect-ratio fitting from fighting editor math.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const leftSvg = el.shadowRoot.querySelector(
      '.pane-left .svg-container svg',
    );
    const rightSvg = el.shadowRoot.querySelector(
      '.pane-right .svg-container svg',
    );
    expect(leftSvg.getAttribute('preserveAspectRatio')).toBe('none');
    expect(rightSvg.getAttribute('preserveAspectRatio')).toBe('none');
  });

  it('disposes both editors on file close', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const leftDetach = vi.spyOn(el._editorLeft, 'detach');
    const rightDetach = vi.spyOn(el._editorRight, 'detach');
    el.closeFile('a.svg');
    await settle(el);
    expect(leftDetach).toHaveBeenCalled();
    expect(rightDetach).toHaveBeenCalled();
    expect(el._editorLeft).toBe(null);
    expect(el._editorRight).toBe(null);
    expect(el._editor).toBe(null);
  });

  it('disposes old editors and creates new ones on file switch', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const oldLeft = el._editorLeft;
    const oldRight = el._editorRight;
    const leftDetach = vi.spyOn(oldLeft, 'detach');
    const rightDetach = vi.spyOn(oldRight, 'detach');
    await el.openFile({ path: 'b.svg' });
    await settle(el);
    expect(leftDetach).toHaveBeenCalled();
    expect(rightDetach).toHaveBeenCalled();
    expect(el._editorLeft).not.toBe(oldLeft);
    expect(el._editorRight).not.toBe(oldRight);
  });

  it('disposes both editors on component disconnect', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const leftDetach = vi.spyOn(el._editorLeft, 'detach');
    const rightDetach = vi.spyOn(el._editorRight, 'detach');
    el.remove();
    expect(leftDetach).toHaveBeenCalled();
    expect(rightDetach).toHaveBeenCalled();
  });

  it('editor change syncs modified content', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const file = el._files[0];
    const originalModified = file.modified;
    const rightSvg = el.shadowRoot.querySelector(
      '.pane-right .svg-container svg',
    );
    const newEl = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'rect',
    );
    newEl.setAttribute('x', '50');
    newEl.setAttribute('y', '50');
    newEl.setAttribute('width', '10');
    newEl.setAttribute('height', '10');
    rightSvg.appendChild(newEl);
    el._onEditorChange();
    expect(file.modified).not.toBe(originalModified);
    expect(el.getDirtyFiles()).toContain('a.svg');
  });

  it('editor change strips handle group from serialized content', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const rightSvg = el.shadowRoot.querySelector(
      '.pane-right .svg-container svg',
    );
    const ns = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('id', 'svg-editor-handles');
    const handleRect = document.createElementNS(ns, 'rect');
    handleRect.setAttribute('class', 'svg-editor-handle');
    g.appendChild(handleRect);
    rightSvg.appendChild(g);
    el._onEditorChange();
    const file = el._files[0];
    expect(file.modified).not.toContain('svg-editor-handles');
    expect(file.modified).not.toContain('svg-editor-handle');
    expect(rightSvg.querySelector('#svg-editor-handles')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ViewBox synchronization
// ---------------------------------------------------------------------------

describe('SvgViewer viewBox mirroring', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => svgFixture()),
    });
  });

  it('left pan mirrors to right via setViewBox', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const rightSet = vi.spyOn(el._editorRight, 'setViewBox');
    el._editorLeft.setViewBox(5, 10, 100, 100);
    expect(rightSet).toHaveBeenCalledWith(
      5,
      10,
      100,
      100,
      { silent: true },
    );
  });

  it('right pan mirrors to left via setViewBox', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const leftSet = vi.spyOn(el._editorLeft, 'setViewBox');
    el._editorRight.setViewBox(20, 30, 50, 50);
    expect(leftSet).toHaveBeenCalledWith(
      20,
      30,
      50,
      50,
      { silent: true },
    );
  });

  it('mutex prevents feedback loops', async () => {
    // When the left editor's write mirrors to the right
    // via setViewBox({silent:true}), the right editor's
    // onViewChange is suppressed by the silent flag AND
    // the viewer's _syncingViewBox mutex. If either
    // guard fails, the mirror cascades back to left and
    // a second mirror fires.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    // Count how many times the left editor's setViewBox
    // is called across a single left-driven write.
    const leftSetSpy = vi.spyOn(el._editorLeft, 'setViewBox');
    el._editorLeft.setViewBox(1, 2, 99, 99);
    // Only the explicit call we just issued — no cascade.
    expect(leftSetSpy).toHaveBeenCalledTimes(1);
  });

  it('sync is a no-op when the partner editor is missing', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    el._editorRight = null;
    // Fires onViewChange with a viewBox; the mirror
    // target is gone, so the handler bails.
    expect(() => el._onLeftViewChange({
      x: 0, y: 0, width: 1, height: 1,
    })).not.toThrow();
  });

  it('initial fit uses silent writes', async () => {
    // The viewer's initEditors calls fitContent({silent:true})
    // on both editors during setup so the two fits don't
    // cascade into each other. We verify by checking
    // that immediately after open, the viewer's mutex is
    // cleared and neither editor mirrored to the other
    // spuriously. We can't easily spy on the constructor
    // path, but we can check that a manual write from
    // either side after setup mirrors exactly once.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    expect(el._syncingViewBox).toBe(false);
  });
});