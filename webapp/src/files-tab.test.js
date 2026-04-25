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
import { flattenTreePaths } from './files-tab.js';

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

  it('plumbs git status data through to the picker', async () => {
    // Increment 1 of the file-picker completion plan — the
    // orchestrator builds statusData from the RPC response
    // and pushes it to the picker alongside the tree. Missing
    // fields in the response should produce empty Sets (not
    // crash or propagate undefined).
    const getTree = vi.fn().mockResolvedValue({
      tree: {
        name: 'repo',
        path: '',
        type: 'dir',
        lines: 0,
        children: [
          { name: 'a.md', path: 'a.md', type: 'file', lines: 5 },
          { name: 'b.md', path: 'b.md', type: 'file', lines: 200 },
        ],
      },
      modified: ['a.md'],
      staged: [],
      untracked: ['b.md'],
      deleted: [],
      diff_stats: { 'a.md': { added: 3, removed: 1 } },
    });
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    await picker.updateComplete;
    expect(picker.statusData).toBeTruthy();
    expect(picker.statusData.modified).toBeInstanceOf(Set);
    expect(picker.statusData.modified.has('a.md')).toBe(true);
    expect(picker.statusData.untracked.has('b.md')).toBe(true);
    expect(picker.statusData.diffStats).toBeInstanceOf(Map);
    expect(picker.statusData.diffStats.get('a.md')).toEqual({
      added: 3,
      removed: 1,
    });
    // Rendered output reflects the data: M badge on a.md,
    // U badge on b.md, diff stats only on a.md.
    const badges = picker.shadowRoot.querySelectorAll('.status-badge');
    expect(badges.length).toBe(2);
    const diffs = picker.shadowRoot.querySelectorAll('.diff-stats');
    expect(diffs.length).toBe(1);
  });

  it('tolerates missing status fields in the RPC response', async () => {
    // An older backend or partial response shouldn't crash
    // the picker. Missing array fields default to empty Sets;
    // missing diff_stats defaults to an empty object.
    const getTree = vi.fn().mockResolvedValue({
      tree: {
        name: 'repo',
        path: '',
        type: 'dir',
        lines: 0,
        children: [
          { name: 'a.md', path: 'a.md', type: 'file', lines: 5 },
        ],
      },
      // No modified / staged / untracked / deleted / diff_stats
    });
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    await picker.updateComplete;
    expect(picker.statusData.modified.size).toBe(0);
    expect(picker.statusData.staged.size).toBe(0);
    expect(picker.statusData.untracked.size).toBe(0);
    expect(picker.statusData.deleted.size).toBe(0);
    expect(picker.statusData.diffStats).toBeInstanceOf(Map);
    expect(picker.statusData.diffStats.size).toBe(0);
    // No badges should appear for clean files.
    expect(
      picker.shadowRoot.querySelectorAll('.status-badge').length,
    ).toBe(0);
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
// flattenTreePaths helper
// ---------------------------------------------------------------------------

describe('flattenTreePaths', () => {
  it('empty / null / undefined input returns empty array', () => {
    expect(flattenTreePaths(null)).toEqual([]);
    expect(flattenTreePaths(undefined)).toEqual([]);
    expect(flattenTreePaths({})).toEqual([]);
  });

  it('single file node produces single-element array', () => {
    const tree = {
      name: 'a.md',
      path: 'a.md',
      type: 'file',
      lines: 5,
    };
    expect(flattenTreePaths(tree)).toEqual(['a.md']);
  });

  it('empty root dir produces empty array', () => {
    const tree = {
      name: 'repo',
      path: '',
      type: 'dir',
      children: [],
    };
    expect(flattenTreePaths(tree)).toEqual([]);
  });

  it('flattens nested directories', () => {
    const tree = {
      name: 'repo',
      path: '',
      type: 'dir',
      children: [
        {
          name: 'src',
          path: 'src',
          type: 'dir',
          children: [
            {
              name: 'main.py',
              path: 'src/main.py',
              type: 'file',
              lines: 10,
            },
            {
              name: 'utils',
              path: 'src/utils',
              type: 'dir',
              children: [
                {
                  name: 'helpers.py',
                  path: 'src/utils/helpers.py',
                  type: 'file',
                  lines: 20,
                },
              ],
            },
          ],
        },
        {
          name: 'README.md',
          path: 'README.md',
          type: 'file',
          lines: 30,
        },
      ],
    };
    const result = flattenTreePaths(tree);
    expect(result).toEqual([
      'src/main.py',
      'src/utils/helpers.py',
      'README.md',
    ]);
  });

  it('skips nodes without a path', () => {
    // Defensive — a malformed tree with a file-type node
    // missing its path shouldn't produce an undefined
    // entry in the output.
    const tree = {
      type: 'dir',
      children: [
        { type: 'file', path: 'good.py' },
        { type: 'file' }, // no path
        { type: 'file', path: '' }, // empty path
      ],
    };
    expect(flattenTreePaths(tree)).toEqual(['good.py']);
  });

  it('skips nodes without a type', () => {
    const tree = {
      type: 'dir',
      children: [
        { path: 'good.py', type: 'file' },
        { path: 'no-type.py' }, // no type
      ],
    };
    expect(flattenTreePaths(tree)).toEqual(['good.py']);
  });

  it('tolerates non-array children', () => {
    const tree = {
      type: 'dir',
      children: 'not an array',
    };
    expect(flattenTreePaths(tree)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// repoFiles push to chat panel
// ---------------------------------------------------------------------------

describe('FilesTab repoFiles push', () => {
  it('pushes flat file list to chat panel on tree load', async () => {
    const getTree = vi.fn().mockResolvedValue(
      fakeTreeResponse([
        { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
        {
          name: 'src',
          path: 'src',
          type: 'dir',
          children: [
            {
              name: 'main.py',
              path: 'src/main.py',
              type: 'file',
              lines: 5,
            },
          ],
        },
      ]),
    );
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    // Flat list reached the chat panel via direct
    // assignment (not via Lit template propagation, which
    // would reset the chat panel's internal state).
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    expect(chat.repoFiles).toEqual(['a.md', 'src/main.py']);
  });

  it('empty tree produces empty repoFiles', async () => {
    const getTree = vi
      .fn()
      .mockResolvedValue(fakeTreeResponse([]));
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    expect(chat.repoFiles).toEqual([]);
  });

  it('updates repoFiles on tree reload', async () => {
    // After a commit, `files-modified` triggers reload.
    // The new file list should replace the old one.
    let callCount = 0;
    const getTree = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
          ]),
        );
      }
      return Promise.resolve(
        fakeTreeResponse([
          { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
          { name: 'b.md', path: 'b.md', type: 'file', lines: 2 },
        ]),
      );
    });
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    expect(chat.repoFiles).toEqual(['a.md']);
    pushEvent('files-modified', {});
    await settle(t);
    expect(chat.repoFiles).toEqual(['a.md', 'b.md']);
  });
});

// ---------------------------------------------------------------------------
// File mention click → toggle + navigate
// ---------------------------------------------------------------------------

describe('FilesTab file-mention-click handling', () => {
  async function setupWithFiles() {
    const getTree = vi.fn().mockResolvedValue(
      fakeTreeResponse([
        { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
        { name: 'b.md', path: 'b.md', type: 'file', lines: 2 },
      ]),
    );
    const setFiles = vi.fn().mockResolvedValue(['a.md']);
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      'LLMService.set_selected_files': setFiles,
    });
    const t = mountTab();
    await settle(t);
    return { t, setFiles };
  }

  it('adds file to selection on mention click', async () => {
    const { t, setFiles } = await setupWithFiles();
    // Simulate the chat panel dispatching the event.
    // The `@file-mention-click` binding in the files-tab
    // template routes it to the handler.
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    chat.dispatchEvent(
      new CustomEvent('file-mention-click', {
        detail: { path: 'a.md' },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(t._selectedFiles.has('a.md')).toBe(true);
    // Server notified with the new selection.
    expect(setFiles).toHaveBeenCalledOnce();
    expect(setFiles.mock.calls[0][0]).toEqual(['a.md']);
    // Picker's prop updated via direct assignment.
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.selectedFiles.has('a.md')).toBe(true);
  });

  it('removes file from selection when mention clicked while selected', async () => {
    // Toggle semantics — a mention click on a file
    // already in the selection removes it. Matches
    // specs4/5-webapp/file-picker.md's "File Mention
    // Selection" contract.
    const { t, setFiles } = await setupWithFiles();
    // Pre-select a.md via an initial click.
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    chat.dispatchEvent(
      new CustomEvent('file-mention-click', {
        detail: { path: 'a.md' },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(t._selectedFiles.has('a.md')).toBe(true);
    // Second click — should remove.
    chat.dispatchEvent(
      new CustomEvent('file-mention-click', {
        detail: { path: 'a.md' },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(t._selectedFiles.has('a.md')).toBe(false);
    // Server notified twice — once for add, once for
    // remove with empty list.
    expect(setFiles).toHaveBeenCalledTimes(2);
    expect(setFiles.mock.calls[1][0]).toEqual([]);
  });

  it('dispatches navigate-file on add', async () => {
    const { t } = await setupWithFiles();
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      const chat = t.shadowRoot.querySelector('ac-chat-panel');
      chat.dispatchEvent(
        new CustomEvent('file-mention-click', {
          detail: { path: 'a.md' },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].detail).toEqual({
        path: 'a.md',
      });
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });

  it('dispatches navigate-file on remove too', async () => {
    // Per spec — navigation is independent of selection
    // state. User clicked the mention; they want to see
    // the file. Both add and remove cases open it.
    const { t } = await setupWithFiles();
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    chat.dispatchEvent(
      new CustomEvent('file-mention-click', {
        detail: { path: 'a.md' },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      // Second click — removes from selection.
      chat.dispatchEvent(
        new CustomEvent('file-mention-click', {
          detail: { path: 'a.md' },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].detail).toEqual({
        path: 'a.md',
      });
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });

  it('ignores malformed events (no path)', async () => {
    const { t, setFiles } = await setupWithFiles();
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      const chat = t.shadowRoot.querySelector('ac-chat-panel');
      chat.dispatchEvent(
        new CustomEvent('file-mention-click', {
          detail: {},
          bubbles: true,
          composed: true,
        }),
      );
      chat.dispatchEvent(
        new CustomEvent('file-mention-click', {
          detail: null,
          bubbles: true,
          composed: true,
        }),
      );
      chat.dispatchEvent(
        new CustomEvent('file-mention-click', {
          detail: { path: '' },
          bubbles: true,
          composed: true,
        }),
      );
      chat.dispatchEvent(
        new CustomEvent('file-mention-click', {
          detail: { path: 42 },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(setFiles).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
      expect(t._selectedFiles.size).toBe(0);
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });

  it('handles multiple distinct mention clicks', async () => {
    const { t, setFiles } = await setupWithFiles();
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    chat.dispatchEvent(
      new CustomEvent('file-mention-click', {
        detail: { path: 'a.md' },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    chat.dispatchEvent(
      new CustomEvent('file-mention-click', {
        detail: { path: 'b.md' },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(t._selectedFiles.has('a.md')).toBe(true);
    expect(t._selectedFiles.has('b.md')).toBe(true);
    // Server saw both selections cumulatively.
    expect(setFiles).toHaveBeenCalledTimes(2);
    expect(setFiles.mock.calls[0][0]).toEqual(['a.md']);
    expect(setFiles.mock.calls[1][0]).toEqual(['a.md', 'b.md']);
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
// Status data plumbing
// ---------------------------------------------------------------------------

describe('FilesTab status data plumbing', () => {
  it('passes status arrays through to the picker as Sets', async () => {
    // The RPC returns path-arrays; the tab converts to
    // Sets so the picker's per-row lookup stays O(1).
    const getTree = vi.fn().mockResolvedValue({
      tree: {
        name: 'repo',
        path: '',
        type: 'dir',
        lines: 0,
        children: [
          { name: 'm.md', path: 'm.md', type: 'file', lines: 1 },
          { name: 's.md', path: 's.md', type: 'file', lines: 1 },
          { name: 'u.md', path: 'u.md', type: 'file', lines: 1 },
          { name: 'd.md', path: 'd.md', type: 'file', lines: 1 },
        ],
      },
      modified: ['m.md'],
      staged: ['s.md'],
      untracked: ['u.md'],
      deleted: ['d.md'],
      diff_stats: {},
    });
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.statusData).toBeDefined();
    expect(picker.statusData.modified).toBeInstanceOf(Set);
    expect(picker.statusData.modified.has('m.md')).toBe(true);
    expect(picker.statusData.staged.has('s.md')).toBe(true);
    expect(picker.statusData.untracked.has('u.md')).toBe(true);
    expect(picker.statusData.deleted.has('d.md')).toBe(true);
  });

  it('converts diff_stats object into a Map', async () => {
    const getTree = vi.fn().mockResolvedValue({
      tree: {
        name: 'repo',
        path: '',
        type: 'dir',
        lines: 0,
        children: [
          { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
        ],
      },
      modified: [],
      staged: [],
      untracked: [],
      deleted: [],
      diff_stats: {
        'a.md': { added: 7, removed: 2 },
      },
    });
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.statusData.diffStats).toBeInstanceOf(Map);
    const entry = picker.statusData.diffStats.get('a.md');
    expect(entry).toEqual({ added: 7, removed: 2 });
  });

  it('tolerates missing sibling fields in the RPC response', async () => {
    // A partial / older-server response shouldn't crash the
    // tab — every missing field degrades to an empty
    // collection.
    const getTree = vi.fn().mockResolvedValue({
      tree: {
        name: 'repo',
        path: '',
        type: 'dir',
        lines: 0,
        children: [],
      },
      // No modified/staged/untracked/deleted/diff_stats.
    });
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.statusData.modified.size).toBe(0);
    expect(picker.statusData.staged.size).toBe(0);
    expect(picker.statusData.untracked.size).toBe(0);
    expect(picker.statusData.deleted.size).toBe(0);
    expect(picker.statusData.diffStats.size).toBe(0);
  });

  it('tolerates malformed field types (non-arrays)', async () => {
    // Defensive — if the RPC returns something unexpected
    // (string instead of array, etc.), we fall back to
    // empty collections rather than throwing.
    const getTree = vi.fn().mockResolvedValue({
      tree: {
        name: 'repo',
        path: '',
        type: 'dir',
        lines: 0,
        children: [],
      },
      modified: 'not an array',
      staged: null,
      untracked: undefined,
      deleted: 42,
      diff_stats: 'not an object',
    });
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.statusData.modified.size).toBe(0);
    expect(picker.statusData.staged.size).toBe(0);
    expect(picker.statusData.untracked.size).toBe(0);
    expect(picker.statusData.deleted.size).toBe(0);
    expect(picker.statusData.diffStats.size).toBe(0);
  });

  it('refreshes status data on files-modified', async () => {
    // After a commit, the status arrays should reflect the
    // new working-tree state. Simulate two sequential
    // responses and verify the picker sees the second.
    let callCount = 0;
    const getTree = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve({
          tree: {
            name: 'repo',
            path: '',
            type: 'dir',
            lines: 0,
            children: [
              { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
            ],
          },
          modified: ['a.md'],
          staged: [],
          untracked: [],
          deleted: [],
          diff_stats: {},
        });
      }
      return Promise.resolve({
        tree: {
          name: 'repo',
          path: '',
          type: 'dir',
          lines: 0,
          children: [
            { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
          ],
        },
        // After commit: clean.
        modified: [],
        staged: [],
        untracked: [],
        deleted: [],
        diff_stats: {},
      });
    });
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.statusData.modified.has('a.md')).toBe(true);
    pushEvent('files-modified', {});
    await settle(t);
    expect(picker.statusData.modified.has('a.md')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Branch info plumbing
// ---------------------------------------------------------------------------

describe('FilesTab branch info plumbing', () => {
  it('fetches branch info alongside the file tree', async () => {
    const getTree = vi
      .fn()
      .mockResolvedValue(fakeTreeResponse([]));
    const getBranch = vi.fn().mockResolvedValue({
      branch: 'main',
      detached: false,
      sha: 'abc1234',
    });
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      'Repo.get_current_branch': getBranch,
    });
    const t = mountTab();
    await settle(t);
    expect(getBranch).toHaveBeenCalledOnce();
  });

  it('passes branch info through to the picker', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
      'Repo.get_current_branch': vi.fn().mockResolvedValue({
        branch: 'feature/x',
        detached: false,
        sha: 'deadbee',
      }),
    });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.branchInfo).toBeDefined();
    expect(picker.branchInfo.branch).toBe('feature/x');
    expect(picker.branchInfo.detached).toBe(false);
    expect(picker.branchInfo.sha).toBe('deadbee');
  });

  it('threads tree.name into branchInfo.repoName', async () => {
    // The picker's root-row render falls back to
    // branchInfo.repoName when the tree itself has no
    // name. fakeTreeResponse sets tree.name to "repo".
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
      'Repo.get_current_branch': vi
        .fn()
        .mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
    });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.branchInfo.repoName).toBe('repo');
  });

  it('detached HEAD response is reflected', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
      'Repo.get_current_branch': vi.fn().mockResolvedValue({
        branch: null,
        detached: true,
        sha: 'abc1234deadbeef',
      }),
    });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.branchInfo.detached).toBe(true);
    expect(picker.branchInfo.branch).toBeNull();
    expect(picker.branchInfo.sha).toBe('abc1234deadbeef');
  });

  it('branch fetch failure does not block tree render', async () => {
    // Defensive — if the branch RPC rejects but the tree
    // RPC succeeds, the tree still renders (minus the
    // branch pill). Matches specs4's "graceful
    // degradation" contract for optional metadata.
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            {
              name: 'a.md',
              path: 'a.md',
              type: 'file',
              lines: 1,
            },
          ]),
        ),
      'Repo.get_current_branch': vi
        .fn()
        .mockRejectedValue(new Error('branch fetch failed')),
    });
    const consoleSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    try {
      const t = mountTab();
      await settle(t);
      expect(t._treeLoaded).toBe(true);
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      // Branch info degrades to the default empty state.
      expect(picker.branchInfo.branch).toBeNull();
      expect(picker.branchInfo.detached).toBe(false);
      // But the tree rendered anyway.
      const rows = picker.shadowRoot.querySelectorAll(
        '.row.is-file',
      );
      expect(rows.length).toBe(1);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('tree fetch failure is fatal (no picker state update)', async () => {
    // Symmetric check — if the tree RPC fails, we bail
    // before updating either state. Branch info stays
    // at its defaults.
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockRejectedValue(new Error('tree boom')),
      'Repo.get_current_branch': vi.fn().mockResolvedValue({
        branch: 'main',
        detached: false,
        sha: null,
      }),
    });
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      const t = mountTab();
      await settle(t);
      expect(t._treeLoaded).toBe(false);
      // Branch info stayed at the initial empty state.
      expect(t._latestBranchInfo.branch).toBeNull();
    } finally {
      window.removeEventListener('ac-toast', toastListener);
      consoleSpy.mockRestore();
    }
  });

  it('refreshes branch info on files-modified', async () => {
    // A branch switch between commits should reflect in
    // the pill without a full page reload. Simulate two
    // sequential branch responses.
    let branchCallCount = 0;
    const getBranch = vi.fn().mockImplementation(() => {
      branchCallCount += 1;
      if (branchCallCount === 1) {
        return Promise.resolve({
          branch: 'main',
          detached: false,
          sha: null,
        });
      }
      return Promise.resolve({
        branch: 'feature/x',
        detached: false,
        sha: null,
      });
    });
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
      'Repo.get_current_branch': getBranch,
    });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.branchInfo.branch).toBe('main');
    pushEvent('files-modified', {});
    await settle(t);
    expect(picker.branchInfo.branch).toBe('feature/x');
  });

  it('tolerates malformed branch response', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
      'Repo.get_current_branch': vi
        .fn()
        .mockResolvedValue({
          // No branch, no sha, wrong detached type.
          detached: 'yes',
        }),
    });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.branchInfo.branch).toBeNull();
    expect(picker.branchInfo.detached).toBe(false);
    expect(picker.branchInfo.sha).toBeNull();
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