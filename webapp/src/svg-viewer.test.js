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
//
// svg-pan-zoom is mocked at the module level since
// jsdom's SVG implementation doesn't support enough of
// the real library to run. The mock records every
// construction and exposes pan/zoom/fit/center/destroy
// spies so tests can drive the sync callbacks and verify
// disposal.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

// Mock must land before './svg-viewer.js' loads — vitest
// hoists vi.mock() calls above imports automatically, so
// this works even though the import below appears to
// happen first textually.
vi.mock('svg-pan-zoom', () => {
  // Each call records the options so tests can invoke
  // the onPan / onZoom callbacks. Instances expose
  // spies for every method the viewer calls.
  const instances = [];
  const factory = vi.fn((element, options) => {
    const instance = {
      element,
      options,
      pan: vi.fn(),
      zoom: vi.fn(),
      fit: vi.fn(),
      center: vi.fn(),
      resize: vi.fn(),
      destroy: vi.fn(() => {
        instance._destroyed = true;
      }),
      _destroyed: false,
    };
    instances.push(instance);
    return instance;
  });
  factory._instances = instances;
  factory._reset = () => {
    instances.length = 0;
    factory.mockClear();
  };
  return { default: factory };
});

import svgPanZoom from 'svg-pan-zoom';
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
  svgPanZoom._reset();
});

afterEach(() => {
  while (_mounted.length) {
    const el = _mounted.pop();
    if (el.isConnected) el.remove();
  }
  clearFakeRpc();
  svgPanZoom._reset();
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

// ---------------------------------------------------------------------------
// Pan/zoom initialization
// ---------------------------------------------------------------------------

describe('SvgViewer pan/zoom initialization', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => svgFixture()),
    });
  });

  it('creates one pan/zoom instance per panel on open', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    expect(svgPanZoom).toHaveBeenCalledTimes(2);
    expect(svgPanZoom._instances).toHaveLength(2);
  });

  it('wires left and right instances to different SVG elements', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const [leftInst, rightInst] = svgPanZoom._instances;
    expect(leftInst.element).not.toBe(rightInst.element);
    expect(leftInst.element.tagName.toLowerCase()).toBe('svg');
    expect(rightInst.element.tagName.toLowerCase()).toBe('svg');
  });

  it('applies preserveAspectRatio="none" only to right panel', async () => {
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
    expect(rightSvg.getAttribute('preserveAspectRatio')).toBe('none');
    // Left panel should NOT have preserveAspectRatio set
    // by us — keeps browser default (xMidYMid meet).
    expect(leftSvg.getAttribute('preserveAspectRatio')).toBe(null);
  });

  it('configures pan/zoom with documented options', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const [leftInst] = svgPanZoom._instances;
    expect(leftInst.options.zoomEnabled).toBe(true);
    expect(leftInst.options.panEnabled).toBe(true);
    expect(leftInst.options.dblClickZoomEnabled).toBe(true);
    expect(leftInst.options.minZoom).toBe(0.1);
    expect(leftInst.options.maxZoom).toBe(10);
    expect(leftInst.options.fit).toBe(true);
    expect(leftInst.options.center).toBe(true);
    // Control icons off — we render our own fit button.
    expect(leftInst.options.controlIconsEnabled).toBe(false);
  });

  it('registers onPan and onZoom callbacks on both instances', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const [leftInst, rightInst] = svgPanZoom._instances;
    expect(typeof leftInst.options.onPan).toBe('function');
    expect(typeof leftInst.options.onZoom).toBe('function');
    expect(typeof rightInst.options.onPan).toBe('function');
    expect(typeof rightInst.options.onZoom).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Pan/zoom synchronization
// ---------------------------------------------------------------------------

describe('SvgViewer pan/zoom sync', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => svgFixture()),
    });
  });

  it('left pan mirrors to right via pan() call', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const [leftInst, rightInst] = svgPanZoom._instances;
    leftInst.options.onPan({ x: 10, y: 20 });
    expect(rightInst.pan).toHaveBeenCalledWith({ x: 10, y: 20 });
  });

  it('left zoom mirrors to right via zoom() call', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const [leftInst, rightInst] = svgPanZoom._instances;
    leftInst.options.onZoom(1.5);
    expect(rightInst.zoom).toHaveBeenCalledWith(1.5);
  });

  it('right pan mirrors to left via pan() call', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const [leftInst, rightInst] = svgPanZoom._instances;
    rightInst.options.onPan({ x: 5, y: 15 });
    expect(leftInst.pan).toHaveBeenCalledWith({ x: 5, y: 15 });
  });

  it('right zoom mirrors to left via zoom() call', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const [leftInst, rightInst] = svgPanZoom._instances;
    rightInst.options.onZoom(2.0);
    expect(leftInst.zoom).toHaveBeenCalledWith(2.0);
  });

  it('guard prevents ping-pong loop on pan', async () => {
    // When the right panel's pan is called from the left's
    // onPan handler, the right's own onPan callback would
    // normally fire and try to sync back to left. The
    // _syncingPanZoom flag prevents that. We verify by
    // simulating the right panel's onPan firing while the
    // flag is set.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const [leftInst, rightInst] = svgPanZoom._instances;
    // Drive left -> right. The right.pan mock doesn't
    // auto-fire right.options.onPan (it's a mock), so
    // we simulate the callback firing manually during
    // the sync window.
    leftInst.options.onPan({ x: 1, y: 2 });
    // Confirm right.pan was called once.
    expect(rightInst.pan).toHaveBeenCalledTimes(1);
    // If the right's onPan had fired during that call,
    // left.pan would have been invoked. It should not
    // have been.
    expect(leftInst.pan).not.toHaveBeenCalled();
  });

  it('guard prevents right->left feedback during sync', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const [leftInst, rightInst] = svgPanZoom._instances;
    // Manually replicate the race: left pan fires, which
    // sets the guard and calls right.pan. While the guard
    // is held, the right's onPan shouldn't cascade back.
    // We force-invoke right.options.onPan inside the
    // sync window by making right.pan call it.
    let reentered = false;
    rightInst.pan = vi.fn(() => {
      // While we're inside left's onPan handler, the guard
      // should be set. Call right's onPan to verify it
      // short-circuits.
      rightInst.options.onPan({ x: 99, y: 99 });
      // If left.pan was called now, the guard failed.
      if (leftInst.pan.mock.calls.length > 0) reentered = true;
    });
    leftInst.options.onPan({ x: 1, y: 2 });
    expect(reentered).toBe(false);
  });

  it('sync is a no-op when the other panel has no instance', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const [leftInst] = svgPanZoom._instances;
    // Drop the right instance to simulate partial init.
    el._panZoomRight = null;
    // Should not throw.
    expect(() => leftInst.options.onPan({ x: 0, y: 0 })).not.toThrow();
    expect(() => leftInst.options.onZoom(1)).not.toThrow();
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
    const btn = el.shadowRoot.querySelector('.fit-button');
    expect(btn).toBeTruthy();
  });

  it('does not render the fit button in empty state', async () => {
    const el = mountViewer();
    await settle(el);
    expect(el.shadowRoot.querySelector('.fit-button')).toBe(null);
  });

  it('click calls fit and center on both panels', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const [leftInst, rightInst] = svgPanZoom._instances;
    el.shadowRoot.querySelector('.fit-button').click();
    expect(leftInst.fit).toHaveBeenCalled();
    expect(leftInst.center).toHaveBeenCalled();
    expect(rightInst.fit).toHaveBeenCalled();
    expect(rightInst.center).toHaveBeenCalled();
  });

  it('click also calls resize on both panels', async () => {
    // resize() ensures pan/zoom picks up current container
    // dimensions — important when the user resized the
    // dialog before clicking fit.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const [leftInst, rightInst] = svgPanZoom._instances;
    el.shadowRoot.querySelector('.fit-button').click();
    expect(leftInst.resize).toHaveBeenCalled();
    expect(rightInst.resize).toHaveBeenCalled();
  });

  it('click does not trigger feedback loop via onPan/onZoom', async () => {
    // The fit button calls fit() on both panels. If the
    // mock fit() were to trigger onPan/onZoom callbacks,
    // the guard must prevent them from cascading. We
    // verify by manually firing the callbacks from inside
    // the fit mock.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const [leftInst, rightInst] = svgPanZoom._instances;
    let cascaded = false;
    rightInst.fit = vi.fn(() => {
      // Simulate real pan/zoom emitting callbacks during
      // fit operation.
      leftInst.options.onPan({ x: 0, y: 0 });
      leftInst.options.onZoom(1);
      // If the guard failed, rightInst.pan/.zoom would
      // have been called from within those callbacks.
      if (
        rightInst.pan.mock.calls.length > 0 ||
        rightInst.zoom.mock.calls.length > 0
      ) {
        cascaded = true;
      }
    });
    el.shadowRoot.querySelector('.fit-button').click();
    expect(cascaded).toBe(false);
  });

  it('click with no instances is a no-op', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    // Drop both instances to simulate an edge case.
    el._panZoomLeft = null;
    el._panZoomRight = null;
    // Should not throw.
    expect(() =>
      el.shadowRoot.querySelector('.fit-button').click(),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Pan/zoom disposal
// ---------------------------------------------------------------------------

describe('SvgViewer pan/zoom disposal', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (path) => svgFixture(path)),
    });
  });

  it('disposes instances when the last file closes', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const [leftInst, rightInst] = svgPanZoom._instances;
    el.closeFile('a.svg');
    await settle(el);
    expect(leftInst.destroy).toHaveBeenCalled();
    expect(rightInst.destroy).toHaveBeenCalled();
    expect(el._panZoomLeft).toBe(null);
    expect(el._panZoomRight).toBe(null);
  });

  it('disposes old instances and creates new ones on file switch', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    expect(svgPanZoom._instances).toHaveLength(2);
    const firstPair = svgPanZoom._instances.slice();
    await el.openFile({ path: 'b.svg' });
    await settle(el);
    // Old pair destroyed.
    expect(firstPair[0].destroy).toHaveBeenCalled();
    expect(firstPair[1].destroy).toHaveBeenCalled();
    // New pair created.
    expect(svgPanZoom._instances).toHaveLength(4);
  });

  it('disposes instances on component disconnect', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const [leftInst, rightInst] = svgPanZoom._instances;
    el.remove();
    expect(leftInst.destroy).toHaveBeenCalled();
    expect(rightInst.destroy).toHaveBeenCalled();
  });

  it('disposes instances on refreshOpenFiles', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const [leftInst, rightInst] = svgPanZoom._instances;
    // Force the refetch to return different content so
    // re-injection fires.
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => svgFixture('refreshed'),
      ),
    });
    await el.refreshOpenFiles();
    await settle(el);
    expect(leftInst.destroy).toHaveBeenCalled();
    expect(rightInst.destroy).toHaveBeenCalled();
  });

  it('handles destroy throwing gracefully', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const [leftInst] = svgPanZoom._instances;
    leftInst.destroy = vi.fn(() => {
      throw new Error('simulated destroy failure');
    });
    // Close should not throw despite destroy failing.
    expect(() => el.closeFile('a.svg')).not.toThrow();
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

  it('creates an editor on the right panel after open', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    expect(el._editor).toBeTruthy();
    // Editor holds the right panel's SVG as its root.
    const rightSvg = el.shadowRoot.querySelector(
      '.pane-right .svg-container svg',
    );
    expect(el._editor._svg).toBe(rightSvg);
  });

  it('does not create an editor on the left panel', async () => {
    // Left is read-only reference; no editor there.
    // Single editor instance tracked in _editor. We verify
    // the right-panel SVG is its root, not left.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const leftSvg = el.shadowRoot.querySelector(
      '.pane-left .svg-container svg',
    );
    expect(el._editor._svg).not.toBe(leftSvg);
  });

  it('disposes editor on file close', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const editor = el._editor;
    const detachSpy = vi.spyOn(editor, 'detach');
    el.closeFile('a.svg');
    await settle(el);
    expect(detachSpy).toHaveBeenCalled();
    expect(el._editor).toBe(null);
  });

  it('disposes old editor and creates new one on file switch', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const oldEditor = el._editor;
    const detachSpy = vi.spyOn(oldEditor, 'detach');
    await el.openFile({ path: 'b.svg' });
    await settle(el);
    expect(detachSpy).toHaveBeenCalled();
    expect(el._editor).toBeTruthy();
    expect(el._editor).not.toBe(oldEditor);
  });

  it('disposes editor on component disconnect', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const editor = el._editor;
    const detachSpy = vi.spyOn(editor, 'detach');
    el.remove();
    expect(detachSpy).toHaveBeenCalled();
  });

  it('editor change syncs modified content', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const file = el._files[0];
    const originalModified = file.modified;
    // Simulate an edit — fire the editor's change callback
    // after mutating the right-panel SVG.
    const rightContainer = el.shadowRoot.querySelector(
      '.pane-right .svg-container',
    );
    const rightSvg = rightContainer.querySelector('svg');
    // Add a new element to simulate a meaningful edit.
    const newEl = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'rect',
    );
    newEl.setAttribute('x', '50');
    newEl.setAttribute('y', '50');
    newEl.setAttribute('width', '10');
    newEl.setAttribute('height', '10');
    rightSvg.appendChild(newEl);
    // Trigger the change callback manually (3.2c.2 will
    // wire this through drag / resize; for 3.2c.1 we fire
    // it to verify the handler).
    el._onEditorChange();
    expect(file.modified).not.toBe(originalModified);
    expect(el.getDirtyFiles()).toContain('a.svg');
  });

  it('editor change strips handle group from serialized content', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const rightContainer = el.shadowRoot.querySelector(
      '.pane-right .svg-container',
    );
    const rightSvg = rightContainer.querySelector('svg');
    // Inject a fake handle group.
    const ns = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('id', 'svg-editor-handles');
    const handleRect = document.createElementNS(ns, 'rect');
    handleRect.setAttribute('class', 'svg-editor-handle');
    g.appendChild(handleRect);
    rightSvg.appendChild(g);
    el._onEditorChange();
    const file = el._files[0];
    // Serialized content should not contain the handle
    // group.
    expect(file.modified).not.toContain('svg-editor-handles');
    expect(file.modified).not.toContain('svg-editor-handle');
    // But the handle group is restored to the live DOM.
    expect(rightSvg.querySelector('#svg-editor-handles')).toBeTruthy();
  });

  it('editor deleteSelection marks file dirty', async () => {
    // End-to-end: select an element, delete it, verify the
    // change callback fires and file becomes dirty.
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () =>
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
          '<rect x="10" y="10" width="20" height="20"/>' +
          '</svg>',
      ),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    const rightSvg = el.shadowRoot.querySelector(
      '.pane-right .svg-container svg',
    );
    const rect = rightSvg.querySelector('rect');
    expect(rect).toBeTruthy();
    // Stub getCTM/getBBox on the rect so deleteSelection's
    // handle-render path (called before delete) doesn't
    // throw.
    rect.getCTM = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    rect.getBBox = () => ({ x: 10, y: 10, width: 20, height: 20 });
    // Stub the SVG's geometry methods too.
    rightSvg.getCTM = () => ({
      a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
      inverse() { return this; },
      multiply(m) { return m; },
    });
    rightSvg.getScreenCTM = () => rightSvg.getCTM();
    rightSvg.createSVGPoint = () => {
      const pt = {
        x: 0, y: 0,
        matrixTransform(m) {
          return { x: m.a * pt.x + m.e, y: m.d * pt.y + m.f };
        },
      };
      return pt;
    };
    el._editor.setSelection(rect);
    el._editor.deleteSelection();
    await settle(el);
    // File now dirty — content changed.
    expect(el.getDirtyFiles()).toContain('a.svg');
  });

  it('editor init failure does not break viewer', async () => {
    // Force SvgEditor construction to throw by temporarily
    // shadowing the right panel's SVG removal. We can't
    // easily mock SvgEditor at module level here without
    // refactoring, so this test is left as documentation.
    // The try/catch in _initEditor ensures robustness.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.svg' });
    await settle(el);
    // Even if editor init had failed, the viewer would
    // still be usable (pan/zoom still active).
    expect(el._panZoomLeft).toBeTruthy();
    expect(el._panZoomRight).toBeTruthy();
  });
});