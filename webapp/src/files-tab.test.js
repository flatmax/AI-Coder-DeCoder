// Tests for webapp/src/files-tab.js — FilesTab orchestrator.
//
// Scope: file tree loading, selection sync both directions,
// file-clicked → navigate-file, files-modified reload,
// error surfacing via ac-toast events.
//
// Strategy mirrors chat-panel.test.js — a fake RPC proxy
// installed via SharedRpc, window-event simulation for
// server-push, helpers for mount/settle.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SharedRpc } from './rpc.js';
import './files-tab.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _mounted = [];

function mountTab(props = {}) {
  const t = document.createElement('ac-files-tab');
  Object.assign(t, props);
  document.body.appendChild(t);
  _mounted.push(t);
  return t;
}

/** Install a fake RPC proxy matching jrpc-oo's single-key envelope. */
function publishFakeRpc(methods) {
  const proxy = {};
  for (const [name, impl] of Object.entries(methods)) {
    proxy[name] = async (...args) => {
      const value = await impl(...args);
      return { fake: value };
    };
  }
  SharedRpc.set(proxy);
  return proxy;
}

/**
 * Full settle — Lit update + microtasks + a couple of animation
 * frames. Needed because the files tab defers its onRpcReady call
 * through a microtask (RpcMixin contract), and the downstream RPC
 * response awaits resolve on the next microtask cycle.
 */
async function settle(tab) {
  await tab.updateComplete;
  // Drain queued microtasks — RpcMixin's onRpcReady fires
  // on the next microtask; the RPC promise resolves on
  // the one after that.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await tab.updateComplete;
  // Children (picker, chat) may have independent
  // updateComplete cycles — let them settle too.
  const picker = tab.shadowRoot?.querySelector('ac-file-picker');
  if (picker) await picker.updateComplete;
  const chat = tab.shadowRoot?.querySelector('ac-chat-panel');
  if (chat) await chat.updateComplete;
}

function pushEvent(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/** A minimal tree payload matching what Repo.get_file_tree returns. */
function fakeTreeResponse(children = []) {
  return {
    tree: {
      name: 'repo',
      path: '',
      type: 'dir',
      lines: 0,
      children,
    },
    modified: [],
    staged: [],
    untracked: [],
    deleted: [],
    diff_stats: {},
  };
}

afterEach(() => {
  while (_mounted.length) {
    const t = _mounted.pop();
    if (t.isConnected) t.remove();
  }
  SharedRpc.reset();
});

// ---------------------------------------------------------------------------
// Initial state + tree loading
// ---------------------------------------------------------------------------

describe('FilesTab initial state', () => {
  it('renders picker and chat children', async () => {
    const t = mountTab();
    await t.updateComplete;
    expect(t.shadowRoot.querySelector('ac-file-picker')).toBeTruthy();
    expect(t.shadowRoot.querySelector('ac-chat-panel')).toBeTruthy();
  });

  it('does not call get_file_tree until RPC is ready', async () => {
    // No SharedRpc.set — RPC not published.
    const t = mountTab();
    await settle(t);
    expect(t._treeLoaded).toBe(false);
  });

  it('loads file tree on RPC ready', async () => {
    const getTree = vi
      .fn()
      .mockResolvedValue(
        fakeTreeResponse([
          {
            name: 'a.md',
            path: 'a.md',
            type: 'file',
            lines: 5,
          },
        ]),
      );
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    expect(getTree).toHaveBeenCalledOnce();
    expect(t._treeLoaded).toBe(true);
    // Picker received the tree via direct assignment.
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    await picker.updateComplete;
    const rows = picker.shadowRoot.querySelectorAll('.row.is-file');
    expect(rows.length).toBe(1);
  });

  it('shows a toast if get_file_tree rejects', async () => {
    const getTree = vi
      .fn()
      .mockRejectedValue(new Error('repo exploded'));
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    // Silence the console.error that the tab emits.
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      const t = mountTab();
      await settle(t);
      expect(toastListener).toHaveBeenCalled();
      const detail = toastListener.mock.calls[0][0].detail;
      expect(detail.type).toBe('error');
      expect(detail.message).toContain('repo exploded');
    } finally {
      window.removeEventListener('ac-toast', toastListener);
      consoleSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Selection sync: picker → server
// ---------------------------------------------------------------------------

describe('FilesTab selection sync — picker → server', () => {
  it('calls set_selected_files when picker emits selection-changed', async () => {
    const getTree = vi
      .fn()
      .mockResolvedValue(
        fakeTreeResponse([
          { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
        ]),
      );
    const setFiles = vi.fn().mockResolvedValue(['a.md']);
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      'LLMService.set_selected_files': setFiles,
    });
    const t = mountTab();
    await settle(t);

    // User clicks the file's checkbox.
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    picker.shadowRoot
      .querySelector('.row.is-file .checkbox')
      .click();
    await settle(t);

    expect(setFiles).toHaveBeenCalledOnce();
    expect(setFiles.mock.calls[0][0]).toEqual(['a.md']);
  });

  it('updates picker and internal state on user selection', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
          ]),
        ),
      'LLMService.set_selected_files': vi
        .fn()
        .mockResolvedValue(['a.md']),
    });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    picker.shadowRoot
      .querySelector('.row.is-file .checkbox')
      .click();
    await settle(t);
    // Authoritative state reflects the change.
    expect(t._selectedFiles.has('a.md')).toBe(true);
    // Picker's prop was updated directly.
    expect(picker.selectedFiles.has('a.md')).toBe(true);
  });

  it('surfaces restricted error as a warning toast', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
          ]),
        ),
      'LLMService.set_selected_files': vi.fn().mockResolvedValue({
        error: 'restricted',
        reason: 'Participants cannot change selection',
      }),
    });
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      const t = mountTab();
      await settle(t);
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.shadowRoot
        .querySelector('.row.is-file .checkbox')
        .click();
      await settle(t);
      const detail = toastListener.mock.calls.at(-1)[0].detail;
      expect(detail.type).toBe('warning');
      expect(detail.message).toContain('Participants');
    } finally {
      window.removeEventListener('ac-toast', toastListener);
    }
  });

  it('shows error toast when set_selected_files rejects', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
          ]),
        ),
      'LLMService.set_selected_files': vi
        .fn()
        .mockRejectedValue(new Error('network boom')),
    });
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      const t = mountTab();
      await settle(t);
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.shadowRoot
        .querySelector('.row.is-file .checkbox')
        .click();
      await settle(t);
      const detail = toastListener.mock.calls.at(-1)[0].detail;
      expect(detail.type).toBe('error');
      expect(detail.message).toContain('network boom');
    } finally {
      window.removeEventListener('ac-toast', toastListener);
      consoleSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Selection sync: server → picker
// ---------------------------------------------------------------------------

describe('FilesTab selection sync — server → picker', () => {
  it('applies files-changed broadcast to picker', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
            { name: 'b.md', path: 'b.md', type: 'file', lines: 1 },
          ]),
        ),
    });
    const t = mountTab();
    await settle(t);
    pushEvent('files-changed', { selectedFiles: ['a.md', 'b.md'] });
    await settle(t);
    expect(t._selectedFiles.has('a.md')).toBe(true);
    expect(t._selectedFiles.has('b.md')).toBe(true);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.selectedFiles.has('a.md')).toBe(true);
    expect(picker.selectedFiles.has('b.md')).toBe(true);
  });

  it('does not re-send server broadcast back to server', async () => {
    const setFiles = vi.fn().mockResolvedValue([]);
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
      'LLMService.set_selected_files': setFiles,
    });
    const t = mountTab();
    await settle(t);
    // Broadcast from server.
    pushEvent('files-changed', { selectedFiles: ['x.md'] });
    await settle(t);
    // No echo back to the server — would be an infinite loop.
    expect(setFiles).not.toHaveBeenCalled();
  });

  it('ignores broadcasts with the same set (no redundant work)', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    pushEvent('files-changed', { selectedFiles: ['a.md'] });
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    const firstSet = picker.selectedFiles;
    // Same paths, new array — the set-equality check should
    // short-circuit and not reassign.
    pushEvent('files-changed', { selectedFiles: ['a.md'] });
    await settle(t);
    // Picker.selectedFiles reference unchanged (no reassign).
    expect(picker.selectedFiles).toBe(firstSet);
  });

  it('ignores malformed broadcast payloads', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    // Defensive — a malformed event shouldn't crash the tab.
    pushEvent('files-changed', { selectedFiles: null });
    pushEvent('files-changed', { selectedFiles: 'not an array' });
    pushEvent('files-changed', {});
    pushEvent('files-changed', null);
    await settle(t);
    expect(t._selectedFiles.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// File click → navigate-file
// ---------------------------------------------------------------------------

describe('FilesTab file click → navigate-file', () => {
  it('dispatches navigate-file with the clicked path', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
          ]),
        ),
    });
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      const t = mountTab();
      await settle(t);
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      // Click the name span (not the checkbox).
      picker.shadowRoot.querySelector('.row.is-file .name').click();
      await settle(t);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].detail).toEqual({
        path: 'a.md',
      });
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });

  it('does not dispatch navigate-file on checkbox click', async () => {
    // The picker's own logic distinguishes these (checkbox
    // clicks emit selection-changed but not file-clicked),
    // but we verify the integration end-to-end.
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
          ]),
        ),
      'LLMService.set_selected_files': vi
        .fn()
        .mockResolvedValue(['a.md']),
    });
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      const t = mountTab();
      await settle(t);
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.shadowRoot
        .querySelector('.row.is-file .checkbox')
        .click();
      await settle(t);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });

  it('ignores malformed file-clicked events', async () => {
    const t = mountTab();
    await t.updateComplete;
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      // Simulate a malformed event directly on the tab.
      t.dispatchEvent(
        new CustomEvent('file-clicked', {
          detail: {},
          bubbles: true,
        }),
      );
      t.dispatchEvent(
        new CustomEvent('file-clicked', {
          detail: null,
          bubbles: true,
        }),
      );
      await t.updateComplete;
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });
});

// ---------------------------------------------------------------------------
// files-modified → reload
// ---------------------------------------------------------------------------

describe('FilesTab files-modified reload', () => {
  it('re-fetches the file tree on files-modified', async () => {
    const getTree = vi
      .fn()
      .mockResolvedValue(fakeTreeResponse([]));
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    expect(getTree).toHaveBeenCalledTimes(1);
    pushEvent('files-modified', {});
    await settle(t);
    expect(getTree).toHaveBeenCalledTimes(2);
  });

  it('handles reload errors gracefully (no unhandled rejection)', async () => {
    let callCount = 0;
    const getTree = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) return Promise.resolve(fakeTreeResponse([]));
      return Promise.reject(new Error('reload failed'));
    });
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      const t = mountTab();
      await settle(t);
      pushEvent('files-modified', {});
      await settle(t);
      // The reload rejected — a toast surfaces the error.
      const errorToasts = toastListener.mock.calls
        .map((call) => call[0].detail)
        .filter((d) => d.type === 'error');
      expect(errorToasts.length).toBeGreaterThan(0);
      expect(errorToasts[0].message).toContain('reload failed');
    } finally {
      window.removeEventListener('ac-toast', toastListener);
      consoleSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

describe('FilesTab cleanup', () => {
  it('removes window listeners on disconnect', async () => {
    const getTree = vi
      .fn()
      .mockResolvedValue(fakeTreeResponse([]));
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    expect(getTree).toHaveBeenCalledTimes(1);
    t.remove();
    // After disconnect, files-modified events must not
    // trigger a reload.
    pushEvent('files-modified', {});
    await new Promise((r) => setTimeout(r, 10));
    expect(getTree).toHaveBeenCalledTimes(1);
  });
});