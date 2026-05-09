import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountViewer, settle, setFakeRpc, monacoState, beforeEachSetup, fireKey } from './test-helpers.js';

beforeEach(beforeEachSetup);

// ---------------------------------------------------------------------------
// Status LED
// ---------------------------------------------------------------------------

describe('DiffViewer status LED', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'original'),
    });
  });

  it('shows clean when active file has no changes', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const led = el.shadowRoot.querySelector('.status-led');
    expect(led.classList.contains('clean')).toBe(true);
  });

  it('shows dirty after a content change', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    monacoState.editors[0]._simulateContentChange('edited');
    await settle(el);
    const led = el.shadowRoot.querySelector('.status-led');
    expect(led.classList.contains('dirty')).toBe(true);
  });

  it('shows new-file for files missing at HEAD', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (_p, ref) => {
        if (ref === 'HEAD') throw new Error('not in HEAD');
        return 'working';
      }),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'new.py' });
    await settle(el);
    const led = el.shadowRoot.querySelector('.status-led');
    expect(led.classList.contains('new-file')).toBe(true);
  });

  it('clicking dirty LED saves the file', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    monacoState.editors[0]._simulateContentChange('edited');
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
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    el.shadowRoot.querySelector('.status-led').click();
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

describe('DiffViewer keyboard shortcuts', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'x'),
    });
  });

  it('Ctrl+S saves active file', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    monacoState.editors[0]._simulateContentChange('edited');
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    fireKey(el, 's');
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('Ctrl+W does nothing (shortcut removed in single-file model)', async () => {
    // D18 removed Ctrl+W / Ctrl+PageUp / Ctrl+PageDown
    // because the single-file model has no tab concept.
    // Pin the removal with a regression test so a
    // future refactor can't reintroduce tab cycling by
    // accident.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    fireKey(el, 'w');
    await settle(el);
    expect(el.hasOpenFiles).toBe(true);
    expect(el._file.path).toBe('a.py');
  });

  it('Ctrl+PageDown / Ctrl+PageUp do nothing', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    fireKey(el, 'PageDown');
    fireKey(el, 'PageUp');
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
    expect(el._file.path).toBe('a.py');
  });

  it('keyboard shortcuts without Ctrl do not fire', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    // Plain S — not a save.
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

  it('keyboard shortcuts when focus is outside do not fire', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    // Fire on document body, not through the viewer's
    // composed path.
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
// Events bubble across shadow DOM
// ---------------------------------------------------------------------------

describe('DiffViewer events cross shadow DOM', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'x'),
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
      await el.openFile({ path: 'a.py' });
      await settle(el);
      expect(outerListener).toHaveBeenCalledOnce();
    } finally {
      document.body.removeEventListener(
        'active-file-changed',
        outerListener,
      );
    }
  });

  it('file-saved is composed', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    monacoState.editors[0]._simulateContentChange('edited');
    await settle(el);
    const outerListener = vi.fn();
    document.body.addEventListener('file-saved', outerListener);
    try {
      await el._saveFile('a.py');
      expect(outerListener).toHaveBeenCalledOnce();
    } finally {
      document.body.removeEventListener(
        'file-saved',
        outerListener,
      );
    }
  });
});