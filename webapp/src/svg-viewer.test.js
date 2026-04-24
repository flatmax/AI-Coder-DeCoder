// Tests for svg-viewer.js — side-by-side SVG diff viewer.
//
// No real Monaco here (unlike the diff viewer); SVG is
// rendered via direct innerHTML injection. The tests
// exercise the lifecycle contract, RPC content fetching,
// dirty tracking, save pipeline, status LED, keyboard
// shortcuts, and event surface.
//
// RPC is injected via globalThis.__sharedRpcOverride,
// matching the diff viewer's pattern.

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

  it('same-file open is a no-op', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
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
    expect(leftSvg.getAttribute('viewBox')).toBe('0 0 1 1');
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
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    fireKey(el, 'w');
    await settle(el);
    expect(el.hasOpenFiles).toBe(false);
  });

  it('Ctrl+PageDown cycles to next file', async () => {
    const el = mountViewer();
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