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

/**
 * Install a fake RPC proxy matching jrpc-oo's single-key
 * envelope. Stubs `Repo.get_current_branch` by default so
 * every mount doesn't emit a "method not found" warning;
 * callers can override by passing an explicit entry in
 * `methods`. Branch-specific tests override; everyone
 * else gets a valid default ('main', not detached).
 */
function publishFakeRpc(methods) {
  const merged = {
    'Repo.get_current_branch': () => ({
      branch: 'main',
      detached: false,
      sha: null,
    }),
    ...methods,
  };
  const proxy = {};
  for (const [name, impl] of Object.entries(merged)) {
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
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      // Increment 4 runs an auto-select during first load
      // that calls set_selected_files when any files are
      // changed. Stub it so the test stays focused on
      // status-data plumbing.
      'LLMService.set_selected_files': vi
        .fn()
        .mockResolvedValue([]),
    });
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
// First-load auto-selection (Increment 4)
// ---------------------------------------------------------------------------

describe('FilesTab first-load auto-select', () => {
  it('auto-selects modified files on first load', async () => {
    // User opens the app with an existing working copy
    // that has pending changes — the picker auto-ticks
    // them so the next LLM request sees the in-progress
    // work.
    const getTree = vi.fn().mockResolvedValue({
      tree: {
        name: 'repo',
        path: '',
        type: 'dir',
        lines: 0,
        children: [
          { name: 'a.md', path: 'a.md', type: 'file', lines: 5 },
          { name: 'b.md', path: 'b.md', type: 'file', lines: 3 },
        ],
      },
      modified: ['a.md'],
      staged: [],
      untracked: [],
      deleted: [],
      diff_stats: {},
    });
    const setFiles = vi.fn().mockResolvedValue(['a.md']);
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      'LLMService.set_selected_files': setFiles,
    });
    const t = mountTab();
    await settle(t);
    expect(t._selectedFiles.has('a.md')).toBe(true);
    expect(t._selectedFiles.has('b.md')).toBe(false);
    // Server notified with the initial selection — a
    // collab session receives the same state the host
    // is starting with.
    expect(setFiles).toHaveBeenCalledOnce();
    expect(setFiles.mock.calls[0][0]).toEqual(['a.md']);
  });

  it('unions all four change categories', async () => {
    // Modified, staged, untracked, and deleted are all
    // treated as "work in progress" for auto-select
    // purposes — the user likely wants to see the
    // whole working-tree state in their LLM context.
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
          { name: 'clean.md', path: 'clean.md', type: 'file', lines: 1 },
        ],
      },
      modified: ['m.md'],
      staged: ['s.md'],
      untracked: ['u.md'],
      deleted: ['d.md'],
      diff_stats: {},
    });
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      'LLMService.set_selected_files': vi.fn().mockResolvedValue([]),
    });
    const t = mountTab();
    await settle(t);
    expect(t._selectedFiles.has('m.md')).toBe(true);
    expect(t._selectedFiles.has('s.md')).toBe(true);
    expect(t._selectedFiles.has('u.md')).toBe(true);
    expect(t._selectedFiles.has('d.md')).toBe(true);
    // Clean files are NOT auto-selected — only changed.
    expect(t._selectedFiles.has('clean.md')).toBe(false);
  });

  it('skips server notification when no files are changed', async () => {
    // Clean working tree → no auto-select union, no
    // _applySelection call, no server round-trip. Keeps
    // the startup of a clean repo completely silent.
    const getTree = vi
      .fn()
      .mockResolvedValue(fakeTreeResponse([]));
    const setFiles = vi.fn().mockResolvedValue([]);
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      'LLMService.set_selected_files': setFiles,
    });
    const t = mountTab();
    await settle(t);
    expect(t._selectedFiles.size).toBe(0);
    expect(setFiles).not.toHaveBeenCalled();
  });

  it('unions with existing selection (does not replace)', async () => {
    // A collab host's selection broadcast or a prior
    // session's state may arrive before our first tree
    // load. Auto-select must union with what's there
    // rather than overwriting it.
    let treeResolve;
    const treePromise = new Promise((r) => {
      treeResolve = r;
    });
    const getTree = vi.fn().mockReturnValue(treePromise);
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      'LLMService.set_selected_files': vi
        .fn()
        .mockResolvedValue([]),
    });
    const t = mountTab();
    // Before the tree load resolves, simulate a
    // files-changed broadcast that seeds selection.
    pushEvent('files-changed', { selectedFiles: ['prior.md'] });
    await settle(t);
    expect(t._selectedFiles.has('prior.md')).toBe(true);
    // Now resolve the tree load.
    treeResolve({
      tree: {
        name: 'repo',
        path: '',
        type: 'dir',
        lines: 0,
        children: [
          { name: 'prior.md', path: 'prior.md', type: 'file', lines: 1 },
          { name: 'new.md', path: 'new.md', type: 'file', lines: 1 },
        ],
      },
      modified: ['new.md'],
      staged: [],
      untracked: [],
      deleted: [],
      diff_stats: {},
    });
    await settle(t);
    // Union — both prior.md AND new.md.
    expect(t._selectedFiles.has('prior.md')).toBe(true);
    expect(t._selectedFiles.has('new.md')).toBe(true);
  });

  it('skips server notify when union equals existing selection', async () => {
    // If a prior broadcast already selected the same
    // files that auto-select would add, the set-equality
    // short-circuit inside _applySelection prevents a
    // redundant server RPC.
    let treeResolve;
    const treePromise = new Promise((r) => {
      treeResolve = r;
    });
    const getTree = vi.fn().mockReturnValue(treePromise);
    const setFiles = vi.fn().mockResolvedValue([]);
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      'LLMService.set_selected_files': setFiles,
    });
    const t = mountTab();
    pushEvent('files-changed', { selectedFiles: ['m.md'] });
    await settle(t);
    treeResolve({
      tree: {
        name: 'repo',
        path: '',
        type: 'dir',
        lines: 0,
        children: [
          { name: 'm.md', path: 'm.md', type: 'file', lines: 1 },
        ],
      },
      modified: ['m.md'],
      staged: [],
      untracked: [],
      deleted: [],
      diff_stats: {},
    });
    await settle(t);
    // Union produced {'m.md'} — equal to the existing
    // selection. _applySelection short-circuits, no
    // server RPC fires.
    expect(setFiles).not.toHaveBeenCalled();
  });

  it('runs exactly once per component lifetime', async () => {
    // The second tree load (from files-modified, e.g.
    // after commit) must not re-select files. A user
    // who deliberately deselected something during the
    // session would see it pop back in otherwise —
    // exactly the "can't get rid of this" frustration
    // the flag prevents.
    let callCount = 0;
    const getTree = vi.fn().mockImplementation(() => {
      callCount += 1;
      return Promise.resolve({
        tree: {
          name: 'repo',
          path: '',
          type: 'dir',
          lines: 0,
          children: [
            { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
            { name: 'b.md', path: 'b.md', type: 'file', lines: 1 },
          ],
        },
        modified: ['a.md', 'b.md'],
        staged: [],
        untracked: [],
        deleted: [],
        diff_stats: {},
      });
    });
    const setFiles = vi.fn().mockResolvedValue([]);
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      'LLMService.set_selected_files': setFiles,
    });
    const t = mountTab();
    await settle(t);
    expect(t._selectedFiles.has('a.md')).toBe(true);
    expect(t._selectedFiles.has('b.md')).toBe(true);
    // User deselects b.md manually.
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    const bCheckbox = Array.from(
      picker.shadowRoot.querySelectorAll('.row.is-file'),
    ).find((row) => row.textContent.includes('b.md'))
      .querySelector('.checkbox');
    bCheckbox.click();
    await settle(t);
    expect(t._selectedFiles.has('b.md')).toBe(false);
    // Simulate a reload (e.g., commit triggers
    // files-modified). The second load must NOT re-auto-
    // select b.md — the flag is already flipped.
    pushEvent('files-modified', {});
    await settle(t);
    expect(callCount).toBe(2);
    expect(t._selectedFiles.has('a.md')).toBe(true);
    // b.md stays deselected — the flag prevented re-run.
    expect(t._selectedFiles.has('b.md')).toBe(false);
  });

  it('flag flips synchronously before the auto-select runs', async () => {
    // Defensive — a re-entrant _loadFileTree call
    // during the auto-select step (impossible today but
    // cheap to protect against) must not double-fire.
    // We verify by checking the flag state after mount
    // completion — always false, regardless of what
    // happens during the call.
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
      'LLMService.set_selected_files': vi
        .fn()
        .mockResolvedValue([]),
    });
    const t = mountTab();
    await settle(t);
    expect(t._initialAutoSelect).toBe(false);
  });

  it('expands ancestor directories of auto-selected files', async () => {
    // A user opening the app with pending changes
    // wants to SEE the changed files in the tree, not
    // have them hidden inside collapsed dirs. Ancestor
    // dirs expand automatically so the auto-selected
    // checkboxes are visible.
    const getTree = vi.fn().mockResolvedValue({
      tree: {
        name: 'repo',
        path: '',
        type: 'dir',
        lines: 0,
        children: [
          {
            name: 'src',
            path: 'src',
            type: 'dir',
            lines: 0,
            children: [
              {
                name: 'inner',
                path: 'src/inner',
                type: 'dir',
                lines: 0,
                children: [
                  {
                    name: 'deep.md',
                    path: 'src/inner/deep.md',
                    type: 'file',
                    lines: 1,
                  },
                ],
              },
            ],
          },
        ],
      },
      modified: ['src/inner/deep.md'],
      staged: [],
      untracked: [],
      deleted: [],
      diff_stats: {},
    });
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      'LLMService.set_selected_files': vi
        .fn()
        .mockResolvedValue([]),
    });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    // Both ancestors expanded.
    expect(picker._expanded.has('src')).toBe(true);
    expect(picker._expanded.has('src/inner')).toBe(true);
    // The file itself is NOT in the expanded set (it's
    // a file, not a directory).
    expect(picker._expanded.has('src/inner/deep.md')).toBe(false);
  });

  it('expands ancestors for every auto-selected file', async () => {
    // Two files in different subtrees — both paths'
    // ancestors get expanded.
    const getTree = vi.fn().mockResolvedValue({
      tree: {
        name: 'repo',
        path: '',
        type: 'dir',
        lines: 0,
        children: [
          {
            name: 'src',
            path: 'src',
            type: 'dir',
            lines: 0,
            children: [
              {
                name: 'a.md',
                path: 'src/a.md',
                type: 'file',
                lines: 1,
              },
            ],
          },
          {
            name: 'tests',
            path: 'tests',
            type: 'dir',
            lines: 0,
            children: [
              {
                name: 'b.md',
                path: 'tests/b.md',
                type: 'file',
                lines: 1,
              },
            ],
          },
        ],
      },
      modified: ['src/a.md'],
      untracked: ['tests/b.md'],
      staged: [],
      deleted: [],
      diff_stats: {},
    });
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      'LLMService.set_selected_files': vi
        .fn()
        .mockResolvedValue([]),
    });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker._expanded.has('src')).toBe(true);
    expect(picker._expanded.has('tests')).toBe(true);
  });

  it('top-level file auto-selection does not expand anything', async () => {
    // A file at repo root has no ancestor dirs to
    // expand (other than root itself, which isn't a
    // collapsible node). The expanded set stays empty.
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
      modified: ['a.md'],
      staged: [],
      untracked: [],
      deleted: [],
      diff_stats: {},
    });
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      'LLMService.set_selected_files': vi
        .fn()
        .mockResolvedValue([]),
    });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker._expanded.size).toBe(0);
    // But the file is still auto-selected.
    expect(t._selectedFiles.has('a.md')).toBe(true);
  });

  it('preserves user-expanded directories on auto-select', async () => {
    // The expansion set is a UNION with any prior user
    // action. Shouldn't happen in practice (picker is
    // empty before first load), but the contract is
    // clear: we add, never replace.
    const getTree = vi.fn().mockResolvedValue({
      tree: {
        name: 'repo',
        path: '',
        type: 'dir',
        lines: 0,
        children: [
          {
            name: 'src',
            path: 'src',
            type: 'dir',
            lines: 0,
            children: [
              { name: 'a.md', path: 'src/a.md', type: 'file', lines: 1 },
            ],
          },
          {
            name: 'docs',
            path: 'docs',
            type: 'dir',
            lines: 0,
            children: [
              { name: 'b.md', path: 'docs/b.md', type: 'file', lines: 1 },
            ],
          },
        ],
      },
      modified: ['src/a.md'],
      staged: [],
      untracked: [],
      deleted: [],
      diff_stats: {},
    });
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      'LLMService.set_selected_files': vi
        .fn()
        .mockResolvedValue([]),
    });
    const t = mountTab();
    await t.updateComplete;
    // Pre-seed picker expansion (simulating an
    // impossible-in-practice race, just to pin the
    // union contract).
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    picker._expanded = new Set(['docs']);
    await settle(t);
    // After auto-select, both docs (user) and src
    // (auto-select) are expanded.
    expect(picker._expanded.has('docs')).toBe(true);
    expect(picker._expanded.has('src')).toBe(true);
  });

  it('skipped entirely when tree load fails', async () => {
    // Error path — tree RPC rejects, toast fires, no
    // auto-select runs. The flag stays true so a
    // subsequent successful reload can still do the
    // initial selection.
    const getTree = vi
      .fn()
      .mockRejectedValue(new Error('load failed'));
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      const t = mountTab();
      await settle(t);
      // Flag UNTOUCHED — the auto-select code is
      // downstream of the failed await and never ran.
      expect(t._initialAutoSelect).toBe(true);
      expect(t._selectedFiles.size).toBe(0);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('runs on the next successful load after initial failure', async () => {
    // The flag stays true across failed loads; a
    // successful reload triggered by files-modified
    // picks up the auto-select.
    let callCount = 0;
    const getTree = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.reject(new Error('transient'));
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
        modified: ['a.md'],
        staged: [],
        untracked: [],
        deleted: [],
        diff_stats: {},
      });
    });
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      'LLMService.set_selected_files': vi
        .fn()
        .mockResolvedValue([]),
    });
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      const t = mountTab();
      await settle(t);
      // First load failed → flag still true.
      expect(t._initialAutoSelect).toBe(true);
      // Trigger reload.
      pushEvent('files-modified', {});
      await settle(t);
      // Second load succeeded → auto-select ran.
      expect(t._initialAutoSelect).toBe(false);
      expect(t._selectedFiles.has('a.md')).toBe(true);
    } finally {
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

// ---------------------------------------------------------------------------
// Middle-click path insertion integration (Increment 10a)
// ---------------------------------------------------------------------------

describe('FilesTab middle-click path insertion', () => {
  /**
   * Dispatch an `insert-path` event from the picker
   * child to simulate the middle-click flow. The
   * picker's actual auxclick handler is tested in
   * file-picker.test.js; here we only exercise the
   * orchestrator's response to the event.
   */
  function firePickerInsertPath(tab, path) {
    const picker = tab.shadowRoot.querySelector('ac-file-picker');
    picker.dispatchEvent(
      new CustomEvent('insert-path', {
        detail: { path },
        bubbles: true,
        composed: true,
      }),
    );
  }

  async function setupTab() {
    const getTree = vi
      .fn()
      .mockResolvedValue(
        fakeTreeResponse([
          { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
        ]),
      );
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    return t;
  }

  it('inserts path into empty textarea', async () => {
    const t = await setupTab();
    firePickerInsertPath(t, 'src/foo.py');
    await settle(t);
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    expect(chat._input).toBe('src/foo.py');
  });

  it('inserts path at cursor position in non-empty textarea', async () => {
    const t = await setupTab();
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    const ta = chat.shadowRoot.querySelector('.input-textarea');
    ta.value = 'before  after';
    ta.dispatchEvent(new Event('input'));
    await settle(t);
    ta.setSelectionRange(7, 7); // between "before " and " after"
    firePickerInsertPath(t, 'INSERTED');
    await settle(t);
    // Spacing rule: prefix space skipped because char
    // before cursor is already whitespace; suffix space
    // skipped because char after cursor is already
    // whitespace. Result: "before INSERTED after".
    expect(chat._input).toBe('before INSERTED after');
  });

  it('adds prefix space when preceded by non-whitespace', async () => {
    const t = await setupTab();
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    const ta = chat.shadowRoot.querySelector('.input-textarea');
    ta.value = 'word';
    ta.dispatchEvent(new Event('input'));
    await settle(t);
    ta.setSelectionRange(4, 4); // end of "word"
    firePickerInsertPath(t, 'path.py');
    await settle(t);
    expect(chat._input).toBe('word path.py');
  });

  it('adds suffix space when followed by non-whitespace', async () => {
    const t = await setupTab();
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    const ta = chat.shadowRoot.querySelector('.input-textarea');
    ta.value = 'trailing';
    ta.dispatchEvent(new Event('input'));
    await settle(t);
    ta.setSelectionRange(0, 0); // start, before "trailing"
    firePickerInsertPath(t, 'path.py');
    await settle(t);
    expect(chat._input).toBe('path.py trailing');
  });

  it('adds both spaces when jammed between non-whitespace', async () => {
    const t = await setupTab();
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    const ta = chat.shadowRoot.querySelector('.input-textarea');
    ta.value = 'ab';
    ta.dispatchEvent(new Event('input'));
    await settle(t);
    ta.setSelectionRange(1, 1); // between "a" and "b"
    firePickerInsertPath(t, 'P');
    await settle(t);
    expect(chat._input).toBe('a P b');
  });

  it('replaces selection when one exists', async () => {
    const t = await setupTab();
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    const ta = chat.shadowRoot.querySelector('.input-textarea');
    ta.value = 'keep OLD keep';
    ta.dispatchEvent(new Event('input'));
    await settle(t);
    ta.setSelectionRange(5, 8); // "OLD"
    firePickerInsertPath(t, 'NEW');
    await settle(t);
    // Selection boundaries (space before, space after)
    // — no extra padding needed.
    expect(chat._input).toBe('keep NEW keep');
  });

  it('positions cursor at end of inserted text', async () => {
    const t = await setupTab();
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    const ta = chat.shadowRoot.querySelector('.input-textarea');
    ta.value = '';
    ta.dispatchEvent(new Event('input'));
    await settle(t);
    ta.setSelectionRange(0, 0);
    firePickerInsertPath(t, 'path.py');
    await settle(t);
    // Inserted "path.py" into empty textarea at pos 0 —
    // no padding needed, cursor ends at 7.
    expect(ta.selectionStart).toBe(7);
    expect(ta.selectionEnd).toBe(7);
  });

  it('sets _suppressNextPaste flag before focus', async () => {
    // Load-bearing ordering — on Linux, focus() triggers
    // the selection-buffer auto-paste. If the flag is
    // set AFTER focus, the paste fires before we've
    // raised the suppression. The test pins the order
    // by spying on the textarea's focus method and
    // checking the flag is already true when it's
    // called.
    const t = await setupTab();
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    const ta = chat.shadowRoot.querySelector('.input-textarea');
    let flagAtFocus = null;
    const originalFocus = ta.focus.bind(ta);
    ta.focus = vi.fn(() => {
      flagAtFocus = chat._suppressNextPaste;
      originalFocus();
    });
    firePickerInsertPath(t, 'path.py');
    await settle(t);
    expect(ta.focus).toHaveBeenCalledOnce();
    // Flag was TRUE at the moment focus fired.
    expect(flagAtFocus).toBe(true);
  });

  it('focuses the textarea after insertion', async () => {
    const t = await setupTab();
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    const ta = chat.shadowRoot.querySelector('.input-textarea');
    firePickerInsertPath(t, 'path.py');
    await settle(t);
    expect(chat.shadowRoot.activeElement).toBe(ta);
  });

  it('ignores malformed events without a path', async () => {
    const t = await setupTab();
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    const originalInput = chat._input;
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    // Null detail.
    picker.dispatchEvent(
      new CustomEvent('insert-path', {
        detail: null,
        bubbles: true,
        composed: true,
      }),
    );
    // Missing path field.
    picker.dispatchEvent(
      new CustomEvent('insert-path', {
        detail: {},
        bubbles: true,
        composed: true,
      }),
    );
    // Empty string path.
    picker.dispatchEvent(
      new CustomEvent('insert-path', {
        detail: { path: '' },
        bubbles: true,
        composed: true,
      }),
    );
    // Non-string path.
    picker.dispatchEvent(
      new CustomEvent('insert-path', {
        detail: { path: 42 },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(chat._input).toBe(originalInput);
    expect(chat._suppressNextPaste).toBe(false);
  });

  it('dispatches input event so auto-resize runs', async () => {
    // The chat panel's _onInputChange runs on native
    // input events and handles textarea auto-resize.
    // Without firing an input event, a multi-line
    // path would be inserted but the textarea height
    // wouldn't adjust.
    const t = await setupTab();
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    const ta = chat.shadowRoot.querySelector('.input-textarea');
    const inputSpy = vi.fn();
    ta.addEventListener('input', inputSpy);
    firePickerInsertPath(t, 'path.py');
    await settle(t);
    expect(inputSpy).toHaveBeenCalled();
  });

  it('accumulates multiple insertions', async () => {
    // User middle-clicks several files in sequence —
    // each one appends with proper padding to whatever
    // was there before.
    const t = await setupTab();
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    firePickerInsertPath(t, 'a.py');
    await settle(t);
    firePickerInsertPath(t, 'b.py');
    await settle(t);
    firePickerInsertPath(t, 'c.py');
    await settle(t);
    // Each insertion lands at the cursor, which is now
    // at the end of the previously-inserted path.
    // Trailing whitespace from the prior insertion would
    // suppress the new prefix space; here there's no
    // trailing whitespace, so spaces are added.
    expect(chat._input).toBe('a.py b.py c.py');
  });

  it('preserves directory paths verbatim', async () => {
    // Directories are legitimate insertion targets.
    const t = await setupTab();
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    firePickerInsertPath(t, 'src/utils');
    await settle(t);
    expect(chat._input).toBe('src/utils');
  });
});

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
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      // Auto-select from Increment 4 notifies the server
      // when any files are changed. Stub it so the test
      // stays focused on status-array conversion.
      'LLMService.set_selected_files': vi
        .fn()
        .mockResolvedValue([]),
    });
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
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      // Auto-select from Increment 4 notifies the server
      // when the first load has changed files. Stub it
      // to keep this test focused on status refresh.
      'LLMService.set_selected_files': vi
        .fn()
        .mockResolvedValue([]),
    });
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
// Exclusion sync (Increment 5)
// ---------------------------------------------------------------------------

describe('FilesTab exclusion sync', () => {
  it('pushes excludedFiles to picker on every tree load', async () => {
    // Initial empty excludedFiles still reaches the picker,
    // so `Set.has()` during render works without guards.
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
          ]),
        ),
    });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.excludedFiles).toBeInstanceOf(Set);
    expect(picker.excludedFiles.size).toBe(0);
  });

  it('calls set_excluded_index_files when picker dispatches exclusion-changed', async () => {
    const setExcluded = vi.fn().mockResolvedValue(['a.md']);
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
          ]),
        ),
      'LLMService.set_excluded_index_files': setExcluded,
    });
    const t = mountTab();
    await settle(t);
    // Simulate the picker dispatching the event (same path
    // the real shift+click flow uses).
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    picker.dispatchEvent(
      new CustomEvent('exclusion-changed', {
        detail: { excludedFiles: ['a.md'] },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(setExcluded).toHaveBeenCalledOnce();
    expect(setExcluded.mock.calls[0][0]).toEqual(['a.md']);
  });

  it('updates internal state and picker prop on exclusion change', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
          ]),
        ),
      'LLMService.set_excluded_index_files': vi
        .fn()
        .mockResolvedValue(['a.md']),
    });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    picker.dispatchEvent(
      new CustomEvent('exclusion-changed', {
        detail: { excludedFiles: ['a.md'] },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(t._excludedFiles.has('a.md')).toBe(true);
    expect(picker.excludedFiles.has('a.md')).toBe(true);
  });

  it('short-circuits redundant exclusion updates', async () => {
    // Re-dispatching the same excluded set should not
    // trigger another server RPC. Mirrors the selection
    // short-circuit and protects against future broadcast
    // loopback when collab-side excluded-state broadcast
    // lands.
    const setExcluded = vi.fn().mockResolvedValue(['a.md']);
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
          ]),
        ),
      'LLMService.set_excluded_index_files': setExcluded,
    });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    picker.dispatchEvent(
      new CustomEvent('exclusion-changed', {
        detail: { excludedFiles: ['a.md'] },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(setExcluded).toHaveBeenCalledTimes(1);
    // Same set again → no-op.
    picker.dispatchEvent(
      new CustomEvent('exclusion-changed', {
        detail: { excludedFiles: ['a.md'] },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(setExcluded).toHaveBeenCalledTimes(1);
  });

  it('surfaces restricted error as warning toast', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
          ]),
        ),
      'LLMService.set_excluded_index_files': vi
        .fn()
        .mockResolvedValue({
          error: 'restricted',
          reason: 'Participants cannot change exclusion',
        }),
    });
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      const t = mountTab();
      await settle(t);
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('exclusion-changed', {
          detail: { excludedFiles: ['a.md'] },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      const detail = toastListener.mock.calls.at(-1)[0].detail;
      expect(detail.type).toBe('warning');
      expect(detail.message).toContain('Participants');
    } finally {
      window.removeEventListener('ac-toast', toastListener);
    }
  });

  it('surfaces RPC rejection as error toast', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
          ]),
        ),
      'LLMService.set_excluded_index_files': vi
        .fn()
        .mockRejectedValue(new Error('exclusion boom')),
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
      picker.dispatchEvent(
        new CustomEvent('exclusion-changed', {
          detail: { excludedFiles: ['a.md'] },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      const detail = toastListener.mock.calls.at(-1)[0].detail;
      expect(detail.type).toBe('error');
      expect(detail.message).toContain('exclusion boom');
    } finally {
      window.removeEventListener('ac-toast', toastListener);
      consoleSpy.mockRestore();
    }
  });

  it('ignores malformed exclusion-changed payloads', async () => {
    const setExcluded = vi.fn().mockResolvedValue([]);
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
      'LLMService.set_excluded_index_files': setExcluded,
    });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    // Defensive — malformed events shouldn't reach the
    // RPC or mutate state.
    picker.dispatchEvent(
      new CustomEvent('exclusion-changed', {
        detail: { excludedFiles: null },
        bubbles: true,
        composed: true,
      }),
    );
    picker.dispatchEvent(
      new CustomEvent('exclusion-changed', {
        detail: { excludedFiles: 'not an array' },
        bubbles: true,
        composed: true,
      }),
    );
    picker.dispatchEvent(
      new CustomEvent('exclusion-changed', {
        detail: null,
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(setExcluded).not.toHaveBeenCalled();
    expect(t._excludedFiles.size).toBe(0);
  });

  it('tree reload preserves exclusion state', async () => {
    // After a commit (files-modified), the tree reloads
    // but exclusion state shouldn't be wiped. The
    // _pushChildProps path must assign excludedFiles
    // alongside the new tree.
    let callCount = 0;
    const getTree = vi.fn().mockImplementation(() => {
      callCount += 1;
      return Promise.resolve(
        fakeTreeResponse([
          { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
        ]),
      );
    });
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      'LLMService.set_excluded_index_files': vi
        .fn()
        .mockResolvedValue(['a.md']),
    });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    // Exclude a.md.
    picker.dispatchEvent(
      new CustomEvent('exclusion-changed', {
        detail: { excludedFiles: ['a.md'] },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(picker.excludedFiles.has('a.md')).toBe(true);
    // Reload tree.
    pushEvent('files-modified', {});
    await settle(t);
    expect(callCount).toBe(2);
    // Exclusion state survived.
    expect(picker.excludedFiles.has('a.md')).toBe(true);
    expect(t._excludedFiles.has('a.md')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Active-file highlight (Increment 6)
// ---------------------------------------------------------------------------

describe('FilesTab active-file handling', () => {
  it('pushes activePath to picker when active-file-changed fires', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
          ]),
        ),
    });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    // Default — no active file yet.
    expect(picker.activePath).toBeNull();
    // Fire the viewer's event at the window level (same
    // path the real bubbling event reaches).
    window.dispatchEvent(
      new CustomEvent('active-file-changed', {
        detail: { path: 'a.md' },
      }),
    );
    await settle(t);
    expect(t._activePath).toBe('a.md');
    expect(picker.activePath).toBe('a.md');
  });

  it('updates picker when activePath changes between files', async () => {
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
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    window.dispatchEvent(
      new CustomEvent('active-file-changed', {
        detail: { path: 'a.md' },
      }),
    );
    await settle(t);
    expect(picker.activePath).toBe('a.md');
    window.dispatchEvent(
      new CustomEvent('active-file-changed', {
        detail: { path: 'b.md' },
      }),
    );
    await settle(t);
    expect(picker.activePath).toBe('b.md');
  });

  it('clears activePath when viewer closes all files', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
          ]),
        ),
    });
    const t = mountTab();
    await settle(t);
    // Open a file.
    window.dispatchEvent(
      new CustomEvent('active-file-changed', {
        detail: { path: 'a.md' },
      }),
    );
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.activePath).toBe('a.md');
    // Close it — viewer sends null.
    window.dispatchEvent(
      new CustomEvent('active-file-changed', {
        detail: { path: null },
      }),
    );
    await settle(t);
    expect(t._activePath).toBeNull();
    expect(picker.activePath).toBeNull();
  });

  it('ignores duplicate active-file events (short-circuit)', async () => {
    // Re-dispatching the same active path shouldn't cause
    // extra picker re-renders. Mirrors the selection /
    // exclusion short-circuit.
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
          ]),
        ),
    });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    const requestUpdateSpy = vi.spyOn(picker, 'requestUpdate');
    window.dispatchEvent(
      new CustomEvent('active-file-changed', {
        detail: { path: 'a.md' },
      }),
    );
    await settle(t);
    const firstCallCount = requestUpdateSpy.mock.calls.length;
    // Same path again — no new requestUpdate.
    window.dispatchEvent(
      new CustomEvent('active-file-changed', {
        detail: { path: 'a.md' },
      }),
    );
    await settle(t);
    expect(requestUpdateSpy.mock.calls.length).toBe(firstCallCount);
  });

  it('tolerates missing detail (defensive)', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    // No detail at all.
    window.dispatchEvent(new CustomEvent('active-file-changed'));
    // Detail without path.
    window.dispatchEvent(
      new CustomEvent('active-file-changed', { detail: {} }),
    );
    // Path is not a string.
    window.dispatchEvent(
      new CustomEvent('active-file-changed', {
        detail: { path: 42 },
      }),
    );
    await settle(t);
    // No crashes, state stays null.
    expect(t._activePath).toBeNull();
  });

  it('activePath survives tree reload', async () => {
    // Same principle as exclusion state — viewer-active
    // file shouldn't be cleared by a files-modified
    // reload.
    let callCount = 0;
    const getTree = vi.fn().mockImplementation(() => {
      callCount += 1;
      return Promise.resolve(
        fakeTreeResponse([
          { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
        ]),
      );
    });
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    window.dispatchEvent(
      new CustomEvent('active-file-changed', {
        detail: { path: 'a.md' },
      }),
    );
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.activePath).toBe('a.md');
    // Reload.
    pushEvent('files-modified', {});
    await settle(t);
    expect(callCount).toBe(2);
    expect(picker.activePath).toBe('a.md');
    expect(t._activePath).toBe('a.md');
  });

  it('removes window listener on disconnect', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    t.remove();
    // After disconnect, active-file-changed events must
    // not reach the (now detached) handler. No easy way
    // to assert absence directly, so we just dispatch
    // and verify nothing throws.
    expect(() => {
      window.dispatchEvent(
        new CustomEvent('active-file-changed', {
          detail: { path: 'a.md' },
        }),
      );
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Review state (Increment 11)
// ---------------------------------------------------------------------------

describe('FilesTab review state', () => {
  /**
   * Build a valid reviewState dict matching what the
   * backend's `start_review` emits in the
   * `review-started` window event detail.
   */
  function reviewStateFixture(overrides = {}) {
    return {
      active: true,
      branch: 'feature-auth',
      base_commit: 'abc1234',
      branch_tip: 'def5678',
      original_branch: 'main',
      commits: [
        {
          sha: 'def5678',
          short_sha: 'def5678',
          message: 'third',
          author: 'matt',
          date: '2024-01-03',
        },
      ],
      changed_files: [
        { path: 'a.md', additions: 10, deletions: 5, status: 'M' },
      ],
      stats: {
        commit_count: 1,
        files_changed: 1,
        additions: 10,
        deletions: 5,
      },
      ...overrides,
    };
  }

  async function setupTab() {
    const getTree = vi.fn().mockResolvedValue(
      fakeTreeResponse([
        { name: 'a.md', path: 'a.md', type: 'file', lines: 5 },
      ]),
    );
    const endReview = vi.fn().mockResolvedValue({
      status: 'ended',
    });
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      'LLMService.set_selected_files': vi
        .fn()
        .mockResolvedValue([]),
      'LLMService.end_review': endReview,
    });
    const t = mountTab();
    await settle(t);
    return { t, getTree, endReview };
  }

  it('reviewState starts as null', async () => {
    const { t } = await setupTab();
    expect(t._reviewState).toBeNull();
  });

  it('picker reviewState prop is null initially', async () => {
    const { t } = await setupTab();
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.reviewState).toBeNull();
  });

  it('review-started event populates _reviewState', async () => {
    const { t } = await setupTab();
    const fixture = reviewStateFixture();
    pushEvent('review-started', fixture);
    await settle(t);
    expect(t._reviewState).toEqual(fixture);
  });

  it('review-started pushes state to picker', async () => {
    const { t } = await setupTab();
    pushEvent('review-started', reviewStateFixture());
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.reviewState).toBeTruthy();
    expect(picker.reviewState.active).toBe(true);
    expect(picker.reviewState.branch).toBe('feature-auth');
  });

  it('review-started clears selection locally', async () => {
    // Defense-in-depth — server has already cleared,
    // but we mirror it without waiting for the
    // `filesChanged` broadcast so the UI stays
    // consistent immediately.
    const { t } = await setupTab();
    // Seed selection first.
    pushEvent('files-changed', { selectedFiles: ['a.md'] });
    await settle(t);
    expect(t._selectedFiles.has('a.md')).toBe(true);
    pushEvent('review-started', reviewStateFixture());
    await settle(t);
    expect(t._selectedFiles.size).toBe(0);
  });

  it('review-started clears picker selection', async () => {
    const { t } = await setupTab();
    pushEvent('files-changed', { selectedFiles: ['a.md'] });
    await settle(t);
    pushEvent('review-started', reviewStateFixture());
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.selectedFiles.size).toBe(0);
  });

  it('review-started refreshes the file tree', async () => {
    // Soft-reset on the server side changes staging
    // state; the picker should pick this up via a
    // fresh `get_file_tree` call.
    const { t, getTree } = await setupTab();
    const initialCalls = getTree.mock.calls.length;
    pushEvent('review-started', reviewStateFixture());
    await settle(t);
    expect(getTree.mock.calls.length).toBe(initialCalls + 1);
  });

  it('review-ended clears _reviewState', async () => {
    const { t } = await setupTab();
    pushEvent('review-started', reviewStateFixture());
    await settle(t);
    expect(t._reviewState).toBeTruthy();
    pushEvent('review-ended', {});
    await settle(t);
    expect(t._reviewState).toBeNull();
  });

  it('review-ended clears picker reviewState', async () => {
    const { t } = await setupTab();
    pushEvent('review-started', reviewStateFixture());
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.reviewState).toBeTruthy();
    pushEvent('review-ended', {});
    await settle(t);
    expect(picker.reviewState).toBeNull();
  });

  it('review-ended does NOT clear selection', async () => {
    // Different from review-started — exit leaves
    // selection alone so the user can continue
    // with the files they had in context. The
    // server's end_review likewise doesn't touch
    // _selected_files.
    const { t } = await setupTab();
    pushEvent('review-started', reviewStateFixture());
    await settle(t);
    pushEvent('files-changed', { selectedFiles: ['a.md'] });
    await settle(t);
    expect(t._selectedFiles.has('a.md')).toBe(true);
    pushEvent('review-ended', {});
    await settle(t);
    // Selection preserved.
    expect(t._selectedFiles.has('a.md')).toBe(true);
  });

  it('review-ended refreshes the file tree', async () => {
    const { t, getTree } = await setupTab();
    pushEvent('review-started', reviewStateFixture());
    await settle(t);
    const mid = getTree.mock.calls.length;
    pushEvent('review-ended', {});
    await settle(t);
    expect(getTree.mock.calls.length).toBe(mid + 1);
  });

  it('exit-review from picker calls LLMService.end_review', async () => {
    const { t, endReview } = await setupTab();
    pushEvent('review-started', reviewStateFixture());
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    picker.dispatchEvent(
      new CustomEvent('exit-review', {
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(endReview).toHaveBeenCalledOnce();
  });

  it('exit-review does not optimistically clear state', async () => {
    // If the server rejects (restricted), the banner
    // should stay visible. The `reviewEnded`
    // broadcast is what ends review from the UI's
    // perspective — exit-review just asks the
    // server.
    const { t } = await setupTab();
    pushEvent('review-started', reviewStateFixture());
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    picker.dispatchEvent(
      new CustomEvent('exit-review', {
        bubbles: true,
        composed: true,
      }),
    );
    // Immediately after dispatch, before the RPC
    // resolves — state still present.
    expect(t._reviewState).toBeTruthy();
  });

  it('exit-review surfaces restricted error as warning', async () => {
    const getTree = vi.fn().mockResolvedValue(
      fakeTreeResponse([
        { name: 'a.md', path: 'a.md', type: 'file', lines: 5 },
      ]),
    );
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      'LLMService.set_selected_files': vi
        .fn()
        .mockResolvedValue([]),
      'LLMService.end_review': vi.fn().mockResolvedValue({
        error: 'restricted',
        reason: 'Participants cannot end review',
      }),
    });
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      const t = mountTab();
      await settle(t);
      pushEvent('review-started', reviewStateFixture());
      await settle(t);
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('exit-review', {
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      const warnings = toastListener.mock.calls
        .map((call) => call[0].detail)
        .filter((d) => d.type === 'warning');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.at(-1).message).toContain('Participants');
      // State still present — restricted means the
      // server did nothing.
      expect(t._reviewState).toBeTruthy();
    } finally {
      window.removeEventListener('ac-toast', toastListener);
    }
  });

  it('exit-review surfaces partial status as warning', async () => {
    // Server couldn't reattach the original branch
    // but did clear review state. The user is in an
    // unusual git state; warn them.
    const getTree = vi.fn().mockResolvedValue(
      fakeTreeResponse([]),
    );
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      'LLMService.set_selected_files': vi
        .fn()
        .mockResolvedValue([]),
      'LLMService.end_review': vi.fn().mockResolvedValue({
        status: 'partial',
        error: 'could not reattach original branch',
      }),
    });
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      const t = mountTab();
      await settle(t);
      pushEvent('review-started', reviewStateFixture());
      await settle(t);
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('exit-review', {
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      const warnings = toastListener.mock.calls
        .map((call) => call[0].detail)
        .filter((d) => d.type === 'warning');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.at(-1).message).toContain('reattach');
    } finally {
      window.removeEventListener('ac-toast', toastListener);
    }
  });

  it('exit-review surfaces RPC rejection as error toast', async () => {
    const getTree = vi.fn().mockResolvedValue(
      fakeTreeResponse([]),
    );
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      'LLMService.set_selected_files': vi
        .fn()
        .mockResolvedValue([]),
      'LLMService.end_review': vi
        .fn()
        .mockRejectedValue(new Error('end_review boom')),
    });
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      const t = mountTab();
      await settle(t);
      pushEvent('review-started', reviewStateFixture());
      await settle(t);
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('exit-review', {
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      const errors = toastListener.mock.calls
        .map((call) => call[0].detail)
        .filter((d) => d.type === 'error');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.at(-1).message).toContain('end_review boom');
    } finally {
      window.removeEventListener('ac-toast', toastListener);
      consoleSpy.mockRestore();
    }
  });

  it('tree reload during review pushes reviewState again', async () => {
    // When files-modified fires mid-review, the
    // file tree reloads. The reviewState prop must
    // be re-pushed in _pushChildProps so the
    // picker's banner doesn't disappear.
    const { t } = await setupTab();
    pushEvent('review-started', reviewStateFixture());
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.reviewState).toBeTruthy();
    // Simulate a reload.
    pushEvent('files-modified', {});
    await settle(t);
    // Banner survives.
    expect(picker.reviewState).toBeTruthy();
    expect(picker.reviewState.branch).toBe('feature-auth');
  });

  it('removes review listeners on disconnect', async () => {
    const { t } = await setupTab();
    t.remove();
    // After disconnect, review-started should not
    // mutate state. Since the tab is unmounted we
    // can't inspect _reviewState directly, but we
    // verify no crash on dispatch.
    expect(() => {
      pushEvent('review-started', reviewStateFixture());
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Per-tab selection structure (D21 Phase A4)
// ---------------------------------------------------------------------------

// These tests pin the Map-based storage contract directly —
// the Map exists with exactly one `"main"` entry on
// construction, `_activeTabId` defaults to `"main"`, and
// `_selectedFiles` reads/writes route through the Map
// without disturbing existing single-tab behaviour. The
// `active-tab-changed` handler is wired to update
// `_activeTabId` and push the new tab's selection to the
// picker. Single-tab operation (Phase A scope) never
// actually switches tabs, but the plumbing is pinned so
// Phase C's spawn path doesn't re-touch this component.

describe('FilesTab per-tab selection — structure', () => {
  it('constructs with a Map containing only "main"', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    expect(t._selectedFilesByTab).toBeInstanceOf(Map);
    expect(t._selectedFilesByTab.size).toBe(1);
    expect(t._selectedFilesByTab.has('main')).toBe(true);
  });

  it('_activeTabId defaults to "main"', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    expect(t._activeTabId).toBe('main');
  });

  it('main tab entry starts as an empty Set', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    const mainSet = t._selectedFilesByTab.get('main');
    expect(mainSet).toBeInstanceOf(Set);
    expect(mainSet.size).toBe(0);
  });

  it('_selectedFiles getter reads from the active tab slot', async () => {
    // Mutate the Map directly; the getter reflects the
    // change. Pins that reads go through the Map, not a
    // shadow field on `this`.
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    const mainSet = t._selectedFilesByTab.get('main');
    mainSet.add('direct.md');
    expect(t._selectedFiles.has('direct.md')).toBe(true);
  });

  it('_selectedFiles setter writes to the active tab slot', async () => {
    // Assign via the setter; the Map entry reflects
    // the new Set.
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    t._selectedFiles = new Set(['via-setter.md']);
    const mainSet = t._selectedFilesByTab.get('main');
    expect(mainSet.has('via-setter.md')).toBe(true);
  });

  it('_selectedFiles setter wraps non-Set inputs defensively', async () => {
    // `_applySelection` always passes Set instances, but
    // the setter accepts iterables too (paranoia against
    // a future refactor that passes an array by
    // accident).
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    t._selectedFiles = ['from-array.md'];
    const mainSet = t._selectedFilesByTab.get('main');
    expect(mainSet).toBeInstanceOf(Set);
    expect(mainSet.has('from-array.md')).toBe(true);
  });

  it('getter lazy-creates missing tab entries', async () => {
    // Defensive — if `_activeTabId` is flipped to a
    // key that has no Map entry (shouldn't happen in
    // production but worth pinning), the getter
    // creates an empty Set on demand rather than
    // returning undefined.
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    t._activeTabId = 'some-orphan-tab';
    expect(t._selectedFilesByTab.has('some-orphan-tab')).toBe(false);
    const fresh = t._selectedFiles;
    expect(fresh).toBeInstanceOf(Set);
    expect(fresh.size).toBe(0);
    // And the Map now has the entry.
    expect(t._selectedFilesByTab.has('some-orphan-tab')).toBe(true);
  });

  it('main-tab behaviour unchanged — _applySelection round-trips', async () => {
    // Sanity check that the per-tab refactor didn't
    // break the existing selection flow. Assign via
    // `_applySelection`, read back via getter, verify
    // the Map entry matches.
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
    t._applySelection(new Set(['a.md']), /* notifyServer */ false);
    expect(t._selectedFiles.has('a.md')).toBe(true);
    const mainSet = t._selectedFilesByTab.get('main');
    expect(mainSet.has('a.md')).toBe(true);
  });
});

describe('FilesTab active-tab-changed handler', () => {
  /**
   * Dispatch an `active-tab-changed` event on the
   * window with the given detail. The chat panel is
   * the usual originator in production (via its
   * `_activeTabId` setter), but for A4 tests we fire
   * directly on `window` since the chat panel never
   * actually switches tabs in Phase A.
   */
  function fireActiveTabChanged(tabId, previousTabId = 'main') {
    window.dispatchEvent(
      new CustomEvent('active-tab-changed', {
        detail: { tabId, previousTabId },
      }),
    );
  }

  it('updates _activeTabId on event', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    expect(t._activeTabId).toBe('main');
    fireActiveTabChanged('agent-0');
    await settle(t);
    expect(t._activeTabId).toBe('agent-0');
  });

  it('creates Map entry for new tab on first switch', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    expect(t._selectedFilesByTab.has('agent-0')).toBe(false);
    fireActiveTabChanged('agent-0');
    await settle(t);
    expect(t._selectedFilesByTab.has('agent-0')).toBe(true);
    expect(t._selectedFilesByTab.get('agent-0')).toBeInstanceOf(Set);
    expect(t._selectedFilesByTab.get('agent-0').size).toBe(0);
  });

  it('pushes new tab selection to picker', async () => {
    // Seed an agent tab with a pre-existing selection
    // (simulating Phase C spawning behaviour), then
    // switch to it. The picker's `selectedFiles` prop
    // should reflect the new tab's set.
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    t._selectedFilesByTab.set('agent-0', new Set(['agent-file.py']));
    fireActiveTabChanged('agent-0');
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.selectedFiles.has('agent-file.py')).toBe(true);
    // And the main tab's file (from any prior state)
    // shouldn't leak through.
    expect(picker.selectedFiles.size).toBe(1);
  });

  it('switching back restores previous tab selection', async () => {
    // Simulate a round-trip: main has one selection,
    // switch to agent-0 (empty), switch back to main.
    // The picker should show main's selection again.
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    // Seed main tab's selection.
    t._selectedFilesByTab.get('main').add('main-file.md');
    // Switch to agent-0.
    fireActiveTabChanged('agent-0');
    await settle(t);
    let picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.selectedFiles.size).toBe(0);
    // Switch back to main.
    fireActiveTabChanged('main', 'agent-0');
    await settle(t);
    picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.selectedFiles.has('main-file.md')).toBe(true);
  });

  it('selection writes target the active tab only', async () => {
    // Switch to agent-0, then apply a selection. The
    // Map entry for agent-0 updates; main's stays
    // empty.
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
      'LLMService.set_selected_files': vi
        .fn()
        .mockResolvedValue([]),
    });
    const t = mountTab();
    await settle(t);
    fireActiveTabChanged('agent-0');
    await settle(t);
    t._applySelection(new Set(['a.md']), /* notifyServer */ false);
    // Agent-0's Map entry has the file.
    expect(t._selectedFilesByTab.get('agent-0').has('a.md')).toBe(true);
    // Main's Map entry stays empty.
    expect(t._selectedFilesByTab.get('main').size).toBe(0);
  });

  it('no-op when event tabId matches current', async () => {
    // Spam the event with the current tab ID — should
    // not touch the picker (spy on requestUpdate).
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    const spy = vi.spyOn(picker, 'requestUpdate');
    fireActiveTabChanged('main', 'main');
    fireActiveTabChanged('main', 'main');
    await settle(t);
    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores malformed events (missing tabId)', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    // Various malformed shapes — none of them should
    // flip _activeTabId away from 'main'.
    window.dispatchEvent(new CustomEvent('active-tab-changed'));
    window.dispatchEvent(
      new CustomEvent('active-tab-changed', { detail: {} }),
    );
    window.dispatchEvent(
      new CustomEvent('active-tab-changed', {
        detail: { tabId: 42 },
      }),
    );
    window.dispatchEvent(
      new CustomEvent('active-tab-changed', {
        detail: { tabId: '' },
      }),
    );
    window.dispatchEvent(
      new CustomEvent('active-tab-changed', { detail: null }),
    );
    await settle(t);
    expect(t._activeTabId).toBe('main');
  });

  it('removes listener on disconnect', async () => {
    // After unmount, the event must not crash or
    // update state. _activeTabId should stay frozen.
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    t.remove();
    expect(() => {
      fireActiveTabChanged('agent-0');
    }).not.toThrow();
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

// ---------------------------------------------------------------------------
// Left-panel resizer (Commit C)
// ---------------------------------------------------------------------------
//
// specs4/5-webapp/file-picker.md § Left Panel Resizer pins the
// draggable handle, the min/max constraints, and the
// double-click-to-collapse interaction. Width and collapsed
// state persist to localStorage.

describe('FilesTab left-panel resizer', () => {
  /**
   * Fire a pointer event on the splitter with the given
   * clientX. The handler reads event.clientX and
   * event.button directly; jsdom doesn't need a real
   * pointer capture target.
   */
  function firePointerDown(tab, clientX) {
    const splitter = tab.shadowRoot.querySelector('.splitter');
    const ev = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX,
    });
    splitter.dispatchEvent(ev);
    return ev;
  }

  function fireDocPointerMove(clientX) {
    const ev = new MouseEvent('pointermove', {
      bubbles: true,
      clientX,
    });
    document.dispatchEvent(ev);
    return ev;
  }

  function fireDocPointerUp() {
    const ev = new MouseEvent('pointerup', { bubbles: true });
    document.dispatchEvent(ev);
    return ev;
  }

  /**
   * Stub the tab's host getBoundingClientRect so the
   * 50%-of-host clamp has a predictable ceiling in
   * jsdom (which otherwise returns zeros).
   */
  function stubHostWidth(tab, width) {
    tab.getBoundingClientRect = () => ({
      width,
      height: 600,
      top: 0,
      left: 0,
      right: width,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON() {},
    });
  }

  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('renders splitter between picker and chat panes', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    const splitter = t.shadowRoot.querySelector('.splitter');
    expect(splitter).toBeTruthy();
    // Splitter is a sibling of .picker-pane and
    // .chat-pane, sitting between them in the flex
    // layout.
    const children = Array.from(t.shadowRoot.children).filter(
      (el) =>
        el.classList.contains('picker-pane') ||
        el.classList.contains('splitter') ||
        el.classList.contains('chat-pane'),
    );
    expect(children[0].classList.contains('picker-pane')).toBe(true);
    expect(children[1].classList.contains('splitter')).toBe(true);
    expect(children[2].classList.contains('chat-pane')).toBe(true);
  });

  it('picker-pane has default width on first mount', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    const pane = t.shadowRoot.querySelector('.picker-pane');
    expect(pane.style.width).toBe('280px');
  });

  it('drag updates picker width live and commits on pointerup', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    stubHostWidth(t, 1000);
    firePointerDown(t, 300);
    // Drag to x=400 → width 280 + 100 = 380.
    fireDocPointerMove(400);
    const pane = t.shadowRoot.querySelector('.picker-pane');
    // Mid-drag the inline style mutates directly.
    expect(pane.style.width).toBe('380px');
    fireDocPointerUp();
    // After commit, reactive property reflects the new
    // width.
    expect(t._pickerWidthPx).toBe(380);
  });

  it('drag persists width to localStorage', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    stubHostWidth(t, 1000);
    firePointerDown(t, 300);
    fireDocPointerMove(400);
    fireDocPointerUp();
    expect(localStorage.getItem('ac-dc-picker-width')).toBe('380');
  });

  it('drag below minimum clamps to 180px', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    stubHostWidth(t, 1000);
    firePointerDown(t, 300);
    // Drag way left — would produce a negative width.
    fireDocPointerMove(0);
    fireDocPointerUp();
    expect(t._pickerWidthPx).toBe(180);
  });

  it('drag above 50% of host clamps to half', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    stubHostWidth(t, 1000);
    firePointerDown(t, 300);
    // Drag far right — would push past half the host.
    fireDocPointerMove(2000);
    fireDocPointerUp();
    // Half of 1000 = 500.
    expect(t._pickerWidthPx).toBe(500);
  });

  it('non-primary button pointerdown does not start drag', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    stubHostWidth(t, 1000);
    const splitter = t.shadowRoot.querySelector('.splitter');
    splitter.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        button: 2, // right-click
        clientX: 300,
      }),
    );
    // No drag state captured.
    expect(t._splitterDrag).toBeNull();
    // Pointermove should be a no-op because the handler
    // bails on null drag state.
    fireDocPointerMove(500);
    const pane = t.shadowRoot.querySelector('.picker-pane');
    // Width unchanged (inline style empty, default width
    // applied via initial render).
    expect(pane.style.width).toBe('280px');
  });

  it('double-click toggles collapsed state', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    expect(t._pickerCollapsed).toBe(false);
    const splitter = t.shadowRoot.querySelector('.splitter');
    splitter.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
    );
    await t.updateComplete;
    expect(t._pickerCollapsed).toBe(true);
    // Second double-click expands again.
    const splitter2 = t.shadowRoot.querySelector('.splitter');
    splitter2.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
    );
    await t.updateComplete;
    expect(t._pickerCollapsed).toBe(false);
  });

  it('collapsed state persists to localStorage', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    const splitter = t.shadowRoot.querySelector('.splitter');
    splitter.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
    );
    await t.updateComplete;
    expect(localStorage.getItem('ac-dc-picker-collapsed')).toBe('true');
  });

  it('collapsed render uses affordance width, not stored width', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    // Set an explicit stored width so we can tell the
    // collapsed render isn't using it.
    t._pickerWidthPx = 450;
    await t.updateComplete;
    const splitter = t.shadowRoot.querySelector('.splitter');
    splitter.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
    );
    await t.updateComplete;
    const pane = t.shadowRoot.querySelector('.picker-pane');
    // Collapsed width is the 24px affordance, not the
    // stored 450.
    expect(pane.style.width).toBe('24px');
    // But the stored width survives.
    expect(t._pickerWidthPx).toBe(450);
  });

  it('expand restores previously-stored width', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    t._pickerWidthPx = 360;
    await t.updateComplete;
    const splitter = t.shadowRoot.querySelector('.splitter');
    // Collapse.
    splitter.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
    );
    await t.updateComplete;
    // Re-query the splitter after collapse — the template
    // may have swapped nodes.
    const splitter2 = t.shadowRoot.querySelector('.splitter');
    // Expand.
    splitter2.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
    );
    await t.updateComplete;
    const pane = t.shadowRoot.querySelector('.picker-pane');
    expect(pane.style.width).toBe('360px');
  });

  it('pointerdown in collapsed mode does not start drag', async () => {
    // In collapsed mode the splitter is a click target
    // for expand (via dblclick), not a drag handle.
    // Single-clicks with a pointerdown must not attempt
    // a drag — the originWidth would be meaningless.
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    t._pickerCollapsed = true;
    await t.updateComplete;
    firePointerDown(t, 100);
    expect(t._splitterDrag).toBeNull();
  });

  it('loads width from localStorage on mount', async () => {
    localStorage.setItem('ac-dc-picker-width', '420');
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    expect(t._pickerWidthPx).toBe(420);
    const pane = t.shadowRoot.querySelector('.picker-pane');
    expect(pane.style.width).toBe('420px');
  });

  it('loads collapsed state from localStorage on mount', async () => {
    localStorage.setItem('ac-dc-picker-collapsed', 'true');
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    expect(t._pickerCollapsed).toBe(true);
    const pane = t.shadowRoot.querySelector('.picker-pane');
    expect(pane.style.width).toBe('24px');
  });

  it('malformed stored width falls back to default', async () => {
    localStorage.setItem('ac-dc-picker-width', 'garbage');
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    expect(t._pickerWidthPx).toBe(280);
  });

  it('below-minimum stored width falls back to default', async () => {
    // A stored value below the current minimum (which
    // could happen if we raise the minimum in a future
    // commit) should fall through to the default rather
    // than render at a sub-readable size.
    localStorage.setItem('ac-dc-picker-width', '50');
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    expect(t._pickerWidthPx).toBe(280);
  });

  it('malformed collapsed value defaults to false', async () => {
    localStorage.setItem('ac-dc-picker-collapsed', 'maybe');
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    expect(t._pickerCollapsed).toBe(false);
  });

  it('disconnect during drag releases document listeners', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    stubHostWidth(t, 1000);
    firePointerDown(t, 300);
    expect(t._splitterDrag).not.toBeNull();
    t.remove();
    // After disconnect, pointermove on document must
    // not throw (stale handler trying to mutate a
    // detached shadow root).
    expect(() => fireDocPointerMove(500)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Context-menu action dispatch (Increment 8b)
// ---------------------------------------------------------------------------

describe('FilesTab context-menu action dispatch', () => {
  /**
   * Fire a `context-menu-action` event from the picker
   * child with the given detail. Uses the picker as the
   * source so the bubbles-through-shadow-DOM path
   * matches production.
   */
  function fireContextAction(tab, detail) {
    const picker = tab.shadowRoot.querySelector('ac-file-picker');
    picker.dispatchEvent(
      new CustomEvent('context-menu-action', {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Stub `window.confirm` for the duration of a test.
   * Returns a restore function to call in teardown.
   */
  function stubConfirm(result) {
    const original = window.confirm;
    window.confirm = vi.fn().mockReturnValue(result);
    return () => {
      window.confirm = original;
    };
  }

  async function setupTabWithFile(path = 'a.md') {
    const getTree = vi
      .fn()
      .mockResolvedValue(
        fakeTreeResponse([
          { name: path, path, type: 'file', lines: 5 },
        ]),
      );
    const stage = vi.fn().mockResolvedValue({});
    const unstage = vi.fn().mockResolvedValue({});
    const discard = vi.fn().mockResolvedValue({});
    const deleteFile = vi.fn().mockResolvedValue({});
    publishFakeRpc({
      'Repo.get_file_tree': getTree,
      // Stub the branch RPC too — every _loadFileTree call
      // fires both in parallel. Without this stub the test
      // output gets cluttered with "[files-tab]
      // get_current_branch failed" warnings even though
      // the code path handles them gracefully.
      'Repo.get_current_branch': vi.fn().mockResolvedValue({
        branch: 'main',
        detached: false,
        sha: null,
      }),
      'Repo.stage_files': stage,
      'Repo.unstage_files': unstage,
      'Repo.discard_changes': discard,
      'Repo.delete_file': deleteFile,
    });
    const t = mountTab();
    await settle(t);
    return { t, getTree, stage, unstage, discard, deleteFile };
  }

  // -------------------------------------------------------
  // Stage
  // -------------------------------------------------------

  describe('stage action', () => {
    it('calls Repo.stage_files with the path wrapped in an array', async () => {
      const { t, stage } = await setupTabWithFile('src/a.md');
      fireContextAction(t, {
        action: 'stage',
        type: 'file',
        path: 'src/a.md',
        name: 'a.md',
        isExcluded: false,
      });
      await settle(t);
      expect(stage).toHaveBeenCalledOnce();
      // Repo.stage_files accepts an array; single-path
      // wrap keeps the wire format consistent with
      // multi-path staging.
      expect(stage.mock.calls[0][0]).toEqual(['src/a.md']);
    });

    it('reloads the file tree after staging', async () => {
      const { t, stage, getTree } = await setupTabWithFile();
      const initialCalls = getTree.mock.calls.length;
      fireContextAction(t, {
        action: 'stage',
        type: 'file',
        path: 'a.md',
        name: 'a.md',
        isExcluded: false,
      });
      await settle(t);
      expect(stage).toHaveBeenCalledOnce();
      // Exactly one reload (status badges update).
      expect(getTree.mock.calls.length).toBe(initialCalls + 1);
    });

    it('shows a success toast', async () => {
      const toastListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      try {
        const { t } = await setupTabWithFile();
        fireContextAction(t, {
          action: 'stage',
          type: 'file',
          path: 'a.md',
          name: 'a.md',
          isExcluded: false,
        });
        await settle(t);
        const successToasts = toastListener.mock.calls
          .map((call) => call[0].detail)
          .filter((d) => d.type === 'success');
        expect(successToasts.length).toBeGreaterThan(0);
        expect(successToasts[0].message).toContain('a.md');
      } finally {
        window.removeEventListener('ac-toast', toastListener);
      }
    });

    it('surfaces restricted error as warning toast', async () => {
      publishFakeRpc({
        'Repo.get_file_tree': vi
          .fn()
          .mockResolvedValue(
            fakeTreeResponse([
              { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
            ]),
          ),
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.stage_files': vi.fn().mockResolvedValue({
          error: 'restricted',
          reason: 'Participants cannot stage files',
        }),
      });
      const toastListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      try {
        const t = mountTab();
        await settle(t);
        fireContextAction(t, {
          action: 'stage',
          type: 'file',
          path: 'a.md',
          name: 'a.md',
          isExcluded: false,
        });
        await settle(t);
        const warningToasts = toastListener.mock.calls
          .map((call) => call[0].detail)
          .filter((d) => d.type === 'warning');
        expect(warningToasts.length).toBeGreaterThan(0);
        expect(warningToasts[0].message).toContain('Participants');
      } finally {
        window.removeEventListener('ac-toast', toastListener);
      }
    });

    it('surfaces RPC rejection as error toast', async () => {
      publishFakeRpc({
        'Repo.get_file_tree': vi
          .fn()
          .mockResolvedValue(
            fakeTreeResponse([
              { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
            ]),
          ),
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.stage_files': vi
          .fn()
          .mockRejectedValue(new Error('stage boom')),
      });
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const toastListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      try {
        const t = mountTab();
        await settle(t);
        fireContextAction(t, {
          action: 'stage',
          type: 'file',
          path: 'a.md',
          name: 'a.md',
          isExcluded: false,
        });
        await settle(t);
        const errorToasts = toastListener.mock.calls
          .map((call) => call[0].detail)
          .filter((d) => d.type === 'error');
        expect(errorToasts.length).toBeGreaterThan(0);
        expect(errorToasts.at(-1).message).toContain('stage boom');
      } finally {
        window.removeEventListener('ac-toast', toastListener);
        consoleSpy.mockRestore();
      }
    });
  });

  // -------------------------------------------------------
  // Unstage — symmetric to stage, fewer tests
  // -------------------------------------------------------

  describe('unstage action', () => {
    it('calls Repo.unstage_files with the path wrapped', async () => {
      const { t, unstage } = await setupTabWithFile();
      fireContextAction(t, {
        action: 'unstage',
        type: 'file',
        path: 'a.md',
        name: 'a.md',
        isExcluded: false,
      });
      await settle(t);
      expect(unstage).toHaveBeenCalledOnce();
      expect(unstage.mock.calls[0][0]).toEqual(['a.md']);
    });

    it('reloads the file tree', async () => {
      const { t, getTree } = await setupTabWithFile();
      const initialCalls = getTree.mock.calls.length;
      fireContextAction(t, {
        action: 'unstage',
        type: 'file',
        path: 'a.md',
        name: 'a.md',
        isExcluded: false,
      });
      await settle(t);
      expect(getTree.mock.calls.length).toBe(initialCalls + 1);
    });
  });

  // -------------------------------------------------------
  // Discard — destructive, requires confirmation
  // -------------------------------------------------------

  describe('discard action', () => {
    it('prompts for confirmation before calling RPC', async () => {
      const restore = stubConfirm(true);
      try {
        const { t, discard } = await setupTabWithFile();
        fireContextAction(t, {
          action: 'discard',
          type: 'file',
          path: 'a.md',
          name: 'a.md',
          isExcluded: false,
        });
        await settle(t);
        expect(window.confirm).toHaveBeenCalledOnce();
        expect(window.confirm.mock.calls[0][0]).toContain('a.md');
        expect(discard).toHaveBeenCalledOnce();
      } finally {
        restore();
      }
    });

    it('does not call RPC when user cancels', async () => {
      const restore = stubConfirm(false);
      try {
        const { t, discard, getTree } = await setupTabWithFile();
        const initialCalls = getTree.mock.calls.length;
        fireContextAction(t, {
          action: 'discard',
          type: 'file',
          path: 'a.md',
          name: 'a.md',
          isExcluded: false,
        });
        await settle(t);
        expect(discard).not.toHaveBeenCalled();
        // No tree reload either — cancel is a full no-op.
        expect(getTree.mock.calls.length).toBe(initialCalls);
      } finally {
        restore();
      }
    });

    it('calls Repo.discard_changes with the path wrapped', async () => {
      const restore = stubConfirm(true);
      try {
        const { t, discard } = await setupTabWithFile();
        fireContextAction(t, {
          action: 'discard',
          type: 'file',
          path: 'src/b.md',
          name: 'b.md',
          isExcluded: false,
        });
        await settle(t);
        expect(discard.mock.calls[0][0]).toEqual(['src/b.md']);
      } finally {
        restore();
      }
    });

    it('reloads the file tree after discard succeeds', async () => {
      const restore = stubConfirm(true);
      try {
        const { t, getTree } = await setupTabWithFile();
        const initialCalls = getTree.mock.calls.length;
        fireContextAction(t, {
          action: 'discard',
          type: 'file',
          path: 'a.md',
          name: 'a.md',
          isExcluded: false,
        });
        await settle(t);
        expect(getTree.mock.calls.length).toBe(initialCalls + 1);
      } finally {
        restore();
      }
    });

    it('shows error toast on RPC rejection', async () => {
      const restore = stubConfirm(true);
      try {
        publishFakeRpc({
          'Repo.get_file_tree': vi
            .fn()
            .mockResolvedValue(
              fakeTreeResponse([
                { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
              ]),
            ),
          'Repo.get_current_branch': vi.fn().mockResolvedValue({
            branch: 'main',
            detached: false,
            sha: null,
          }),
          'Repo.discard_changes': vi
            .fn()
            .mockRejectedValue(new Error('discard boom')),
        });
        const consoleSpy = vi
          .spyOn(console, 'error')
          .mockImplementation(() => {});
        const toastListener = vi.fn();
        window.addEventListener('ac-toast', toastListener);
        try {
          const t = mountTab();
          await settle(t);
          fireContextAction(t, {
            action: 'discard',
            type: 'file',
            path: 'a.md',
            name: 'a.md',
            isExcluded: false,
          });
          await settle(t);
          const errorToasts = toastListener.mock.calls
            .map((call) => call[0].detail)
            .filter((d) => d.type === 'error');
          expect(errorToasts.length).toBeGreaterThan(0);
        } finally {
          window.removeEventListener('ac-toast', toastListener);
          consoleSpy.mockRestore();
        }
      } finally {
        restore();
      }
    });
  });

  // -------------------------------------------------------
  // Delete — destructive, requires confirmation
  // -------------------------------------------------------

  describe('delete action', () => {
    it('prompts for confirmation before calling RPC', async () => {
      const restore = stubConfirm(true);
      try {
        const { t, deleteFile } = await setupTabWithFile();
        fireContextAction(t, {
          action: 'delete',
          type: 'file',
          path: 'a.md',
          name: 'a.md',
          isExcluded: false,
        });
        await settle(t);
        expect(window.confirm).toHaveBeenCalledOnce();
        expect(window.confirm.mock.calls[0][0]).toContain('a.md');
        expect(deleteFile).toHaveBeenCalledOnce();
      } finally {
        restore();
      }
    });

    it('does not call RPC when user cancels', async () => {
      const restore = stubConfirm(false);
      try {
        const { t, deleteFile } = await setupTabWithFile();
        fireContextAction(t, {
          action: 'delete',
          type: 'file',
          path: 'a.md',
          name: 'a.md',
          isExcluded: false,
        });
        await settle(t);
        expect(deleteFile).not.toHaveBeenCalled();
      } finally {
        restore();
      }
    });

    it('calls Repo.delete_file with the raw path (not wrapped)', async () => {
      // delete_file takes a single path, not an array —
      // unlike stage/unstage/discard which accept arrays.
      const restore = stubConfirm(true);
      try {
        const { t, deleteFile } = await setupTabWithFile();
        fireContextAction(t, {
          action: 'delete',
          type: 'file',
          path: 'src/a.md',
          name: 'a.md',
          isExcluded: false,
        });
        await settle(t);
        expect(deleteFile.mock.calls[0][0]).toBe('src/a.md');
      } finally {
        restore();
      }
    });

    it('reloads the file tree after delete succeeds', async () => {
      const restore = stubConfirm(true);
      try {
        const { t, getTree } = await setupTabWithFile();
        const initialCalls = getTree.mock.calls.length;
        fireContextAction(t, {
          action: 'delete',
          type: 'file',
          path: 'a.md',
          name: 'a.md',
          isExcluded: false,
        });
        await settle(t);
        expect(getTree.mock.calls.length).toBe(initialCalls + 1);
      } finally {
        restore();
      }
    });

    it('clears exclusion for the deleted path if it was excluded', async () => {
      // Files disappearing from the tree also disappear
      // from exclusion state; without this the excluded
      // set would carry a dead reference forever.
      const restore = stubConfirm(true);
      try {
        publishFakeRpc({
          'Repo.get_file_tree': vi
            .fn()
            .mockResolvedValue(
              fakeTreeResponse([
                { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
              ]),
            ),
          'Repo.get_current_branch': vi.fn().mockResolvedValue({
            branch: 'main',
            detached: false,
            sha: null,
          }),
          'Repo.delete_file': vi.fn().mockResolvedValue({}),
          'LLMService.set_excluded_index_files': vi
            .fn()
            .mockResolvedValue([]),
        });
        const t = mountTab();
        await settle(t);
        // Exclude the file first (picker event path).
        const picker = t.shadowRoot.querySelector('ac-file-picker');
        picker.dispatchEvent(
          new CustomEvent('exclusion-changed', {
            detail: { excludedFiles: ['a.md'] },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(t);
        expect(t._excludedFiles.has('a.md')).toBe(true);
        // Now delete.
        fireContextAction(t, {
          action: 'delete',
          type: 'file',
          path: 'a.md',
          name: 'a.md',
          isExcluded: true,
        });
        await settle(t);
        expect(t._excludedFiles.has('a.md')).toBe(false);
      } finally {
        restore();
      }
    });
  });

  // -------------------------------------------------------
  // Routing edge cases
  // -------------------------------------------------------

  describe('dispatch edge cases', () => {
    it('ignores malformed event detail', async () => {
      const { t, stage } = await setupTabWithFile();
      // Missing everything.
      fireContextAction(t, undefined);
      await settle(t);
      // Missing action.
      fireContextAction(t, { type: 'file', path: 'a.md' });
      await settle(t);
      // Non-string action.
      fireContextAction(t, { action: 42, type: 'file', path: 'a.md' });
      await settle(t);
      // Missing path.
      fireContextAction(t, { action: 'stage', type: 'file' });
      await settle(t);
      // Empty path.
      fireContextAction(t, {
        action: 'stage',
        type: 'file',
        path: '',
      });
      await settle(t);
      expect(stage).not.toHaveBeenCalled();
    });

    it('ignores non-file types (directory menu reserved for later)', async () => {
      const { t, stage } = await setupTabWithFile();
      fireContextAction(t, {
        action: 'stage',
        type: 'dir',
        path: 'src',
        name: 'src',
      });
      await settle(t);
      expect(stage).not.toHaveBeenCalled();
    });

    it('unknown actions are silently dropped', async () => {
      const { t, stage, unstage, discard, deleteFile } =
        await setupTabWithFile();
      // 8c wired rename/duplicate; 8d wired
      // include/exclude/load-left/load-right. Only
      // truly unknown actions remain in this test —
      // defensive against a future refactor that
      // adds a new menu item without wiring it.
      for (const action of ['bogus', 'stage-all', 'future-thing']) {
        fireContextAction(t, {
          action,
          type: 'file',
          path: 'a.md',
          name: 'a.md',
          isExcluded: false,
        });
      }
      await settle(t);
      // None of the implemented RPCs fired.
      expect(stage).not.toHaveBeenCalled();
      expect(unstage).not.toHaveBeenCalled();
      expect(discard).not.toHaveBeenCalled();
      expect(deleteFile).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------
  // Rename (8c)
  // -------------------------------------------------------

  describe('rename action', () => {
    /**
     * Build a files-tab with stubbed RPCs covering the
     * rename pipeline: file tree load, branch info, and
     * rename_file. Returns the tab plus the rename stub
     * so tests can assert call shapes directly.
     */
    async function setupRenameTab() {
      const getTree = vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 5 },
          ]),
        );
      const rename = vi.fn().mockResolvedValue({});
      publishFakeRpc({
        'Repo.get_file_tree': getTree,
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.rename_file': rename,
      });
      const t = mountTab();
      await settle(t);
      return { t, getTree, rename };
    }

    it('context-menu action calls beginRename on the picker', async () => {
      const { t } = await setupRenameTab();
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      const spy = vi.spyOn(picker, 'beginRename');
      const picker2 = t.shadowRoot.querySelector('ac-file-picker');
      picker2.dispatchEvent(
        new CustomEvent('context-menu-action', {
          detail: {
            action: 'rename',
            type: 'file',
            path: 'a.md',
            name: 'a.md',
            isExcluded: false,
          },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0]).toBe('a.md');
    });

    it('rename-committed dispatches Repo.rename_file with the rebuilt target path', async () => {
      // Picker sends just the new filename; the tab
      // rebuilds the full path by preserving the
      // source's parent directory. A file in src/
      // renamed to b.md produces src/b.md.
      const getTree = vi.fn().mockResolvedValue(
        fakeTreeResponse([
          {
            name: 'src',
            path: 'src',
            type: 'dir',
            children: [
              {
                name: 'a.md',
                path: 'src/a.md',
                type: 'file',
                lines: 5,
              },
            ],
          },
        ]),
      );
      const rename = vi.fn().mockResolvedValue({});
      publishFakeRpc({
        'Repo.get_file_tree': getTree,
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.rename_file': rename,
      });
      const t = mountTab();
      await settle(t);
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('rename-committed', {
          detail: {
            sourcePath: 'src/a.md',
            targetName: 'b.md',
          },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(rename).toHaveBeenCalledOnce();
      expect(rename.mock.calls[0][0]).toBe('src/a.md');
      expect(rename.mock.calls[0][1]).toBe('src/b.md');
    });

    it('top-level file rename produces a top-level target', async () => {
      const { t, rename } = await setupRenameTab();
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('rename-committed', {
          detail: {
            sourcePath: 'a.md',
            targetName: 'b.md',
          },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(rename.mock.calls[0][0]).toBe('a.md');
      expect(rename.mock.calls[0][1]).toBe('b.md');
    });

    it('reloads the file tree after rename succeeds', async () => {
      const { t, rename, getTree } = await setupRenameTab();
      const initialCalls = getTree.mock.calls.length;
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('rename-committed', {
          detail: {
            sourcePath: 'a.md',
            targetName: 'b.md',
          },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(rename).toHaveBeenCalledOnce();
      expect(getTree.mock.calls.length).toBe(initialCalls + 1);
    });

    it('shows a success toast after rename', async () => {
      const toastListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      try {
        const { t } = await setupRenameTab();
        const picker = t.shadowRoot.querySelector('ac-file-picker');
        picker.dispatchEvent(
          new CustomEvent('rename-committed', {
            detail: {
              sourcePath: 'a.md',
              targetName: 'b.md',
            },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(t);
        const successToasts = toastListener.mock.calls
          .map((call) => call[0].detail)
          .filter((d) => d.type === 'success');
        expect(successToasts.length).toBeGreaterThan(0);
        expect(successToasts.at(-1).message).toContain('b.md');
      } finally {
        window.removeEventListener('ac-toast', toastListener);
      }
    });

    it('rejects target names containing path separators', async () => {
      // Users who want to move a file across
      // directories should use duplicate (or a future
      // explicit move). Letting rename accept a path
      // would interact poorly with git's rename-
      // detection heuristics.
      const { t, rename } = await setupRenameTab();
      const toastListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      try {
        const picker = t.shadowRoot.querySelector('ac-file-picker');
        picker.dispatchEvent(
          new CustomEvent('rename-committed', {
            detail: {
              sourcePath: 'a.md',
              targetName: 'src/b.md',
            },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(t);
        expect(rename).not.toHaveBeenCalled();
        const warnings = toastListener.mock.calls
          .map((call) => call[0].detail)
          .filter((d) => d.type === 'warning');
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings.at(-1).message.toLowerCase()).toContain(
          'separator',
        );
      } finally {
        window.removeEventListener('ac-toast', toastListener);
      }
    });

    it('ignores malformed rename-committed events', async () => {
      const { t, rename } = await setupRenameTab();
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      // Missing sourcePath.
      picker.dispatchEvent(
        new CustomEvent('rename-committed', {
          detail: { targetName: 'b.md' },
          bubbles: true,
          composed: true,
        }),
      );
      // Missing targetName.
      picker.dispatchEvent(
        new CustomEvent('rename-committed', {
          detail: { sourcePath: 'a.md' },
          bubbles: true,
          composed: true,
        }),
      );
      // Empty sourcePath.
      picker.dispatchEvent(
        new CustomEvent('rename-committed', {
          detail: { sourcePath: '', targetName: 'b.md' },
          bubbles: true,
          composed: true,
        }),
      );
      // Empty targetName.
      picker.dispatchEvent(
        new CustomEvent('rename-committed', {
          detail: { sourcePath: 'a.md', targetName: '' },
          bubbles: true,
          composed: true,
        }),
      );
      // Null detail.
      picker.dispatchEvent(
        new CustomEvent('rename-committed', {
          detail: null,
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(rename).not.toHaveBeenCalled();
    });

    it('surfaces restricted error as warning toast', async () => {
      publishFakeRpc({
        'Repo.get_file_tree': vi
          .fn()
          .mockResolvedValue(
            fakeTreeResponse([
              { name: 'a.md', path: 'a.md', type: 'file', lines: 5 },
            ]),
          ),
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.rename_file': vi.fn().mockResolvedValue({
          error: 'restricted',
          reason: 'Participants cannot rename files',
        }),
      });
      const toastListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      try {
        const t = mountTab();
        await settle(t);
        const picker = t.shadowRoot.querySelector('ac-file-picker');
        picker.dispatchEvent(
          new CustomEvent('rename-committed', {
            detail: {
              sourcePath: 'a.md',
              targetName: 'b.md',
            },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(t);
        const warnings = toastListener.mock.calls
          .map((call) => call[0].detail)
          .filter((d) => d.type === 'warning');
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings.at(-1).message).toContain('Participants');
      } finally {
        window.removeEventListener('ac-toast', toastListener);
      }
    });

    it('surfaces RPC rejection as error toast', async () => {
      publishFakeRpc({
        'Repo.get_file_tree': vi
          .fn()
          .mockResolvedValue(
            fakeTreeResponse([
              { name: 'a.md', path: 'a.md', type: 'file', lines: 5 },
            ]),
          ),
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.rename_file': vi
          .fn()
          .mockRejectedValue(new Error('rename boom')),
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
        picker.dispatchEvent(
          new CustomEvent('rename-committed', {
            detail: {
              sourcePath: 'a.md',
              targetName: 'b.md',
            },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(t);
        const errors = toastListener.mock.calls
          .map((call) => call[0].detail)
          .filter((d) => d.type === 'error');
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.at(-1).message).toContain('rename boom');
      } finally {
        window.removeEventListener('ac-toast', toastListener);
        consoleSpy.mockRestore();
      }
    });

    it('migrates selection to the new path after rename', async () => {
      // A selected file that gets renamed should stay
      // selected under its new name — the LLM request
      // that just finished referred to it, and the
      // next request probably should too. Server gets
      // a set_selected_files call with the migrated
      // set.
      const setFiles = vi.fn().mockResolvedValue(['b.md']);
      publishFakeRpc({
        'Repo.get_file_tree': vi
          .fn()
          .mockResolvedValue(
            fakeTreeResponse([
              { name: 'a.md', path: 'a.md', type: 'file', lines: 5 },
            ]),
          ),
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.rename_file': vi.fn().mockResolvedValue({}),
        'LLMService.set_selected_files': setFiles,
      });
      const t = mountTab();
      await settle(t);
      // Seed selection via a server broadcast so the
      // first-load auto-select is already done.
      pushEvent('files-changed', { selectedFiles: ['a.md'] });
      await settle(t);
      expect(t._selectedFiles.has('a.md')).toBe(true);
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('rename-committed', {
          detail: {
            sourcePath: 'a.md',
            targetName: 'b.md',
          },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(t._selectedFiles.has('a.md')).toBe(false);
      expect(t._selectedFiles.has('b.md')).toBe(true);
      // Server notified of the migration.
      const lastCall = setFiles.mock.calls.at(-1);
      expect(lastCall[0]).toContain('b.md');
      expect(lastCall[0]).not.toContain('a.md');
    });

    it('migrates exclusion to the new path after rename', async () => {
      publishFakeRpc({
        'Repo.get_file_tree': vi
          .fn()
          .mockResolvedValue(
            fakeTreeResponse([
              { name: 'a.md', path: 'a.md', type: 'file', lines: 5 },
            ]),
          ),
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.rename_file': vi.fn().mockResolvedValue({}),
        'LLMService.set_excluded_index_files': vi
          .fn()
          .mockResolvedValue([]),
      });
      const t = mountTab();
      await settle(t);
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      // Exclude a.md.
      picker.dispatchEvent(
        new CustomEvent('exclusion-changed', {
          detail: { excludedFiles: ['a.md'] },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(t._excludedFiles.has('a.md')).toBe(true);
      picker.dispatchEvent(
        new CustomEvent('rename-committed', {
          detail: {
            sourcePath: 'a.md',
            targetName: 'b.md',
          },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(t._excludedFiles.has('a.md')).toBe(false);
      expect(t._excludedFiles.has('b.md')).toBe(true);
    });

    it('same-name commit is a no-op', async () => {
      // Picker's _commitInlineInput already short-
      // circuits on unchanged names, so this case
      // shouldn't reach the tab in practice. But
      // defensive against a future refactor that
      // loosens the picker's check.
      const { t, rename } = await setupRenameTab();
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('rename-committed', {
          detail: {
            sourcePath: 'a.md',
            targetName: 'a.md',
          },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(rename).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------
  // Duplicate (8c)
  // -------------------------------------------------------

  describe('duplicate action', () => {
    /**
     * Build a files-tab with stubbed RPCs covering the
     * duplicate pipeline: tree load, branch info,
     * get_file_content, create_file.
     */
    async function setupDuplicateTab({
      sourceContent = 'hello world',
    } = {}) {
      const getTree = vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 5 },
          ]),
        );
      const getContent = vi
        .fn()
        .mockResolvedValue(sourceContent);
      const createFile = vi.fn().mockResolvedValue({});
      publishFakeRpc({
        'Repo.get_file_tree': getTree,
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.get_file_content': getContent,
        'Repo.create_file': createFile,
      });
      const t = mountTab();
      await settle(t);
      return { t, getTree, getContent, createFile };
    }

    it('context-menu action calls beginDuplicate on the picker', async () => {
      const { t } = await setupDuplicateTab();
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      const spy = vi.spyOn(picker, 'beginDuplicate');
      picker.dispatchEvent(
        new CustomEvent('context-menu-action', {
          detail: {
            action: 'duplicate',
            type: 'file',
            path: 'a.md',
            name: 'a.md',
            isExcluded: false,
          },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0]).toBe('a.md');
    });

    it('duplicate-committed reads source then creates target with content', async () => {
      const { t, getContent, createFile } =
        await setupDuplicateTab({ sourceContent: 'source body' });
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('duplicate-committed', {
          detail: {
            sourcePath: 'a.md',
            targetName: 'a-copy.md',
          },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(getContent).toHaveBeenCalledOnce();
      expect(getContent.mock.calls[0][0]).toBe('a.md');
      expect(createFile).toHaveBeenCalledOnce();
      expect(createFile.mock.calls[0][0]).toBe('a-copy.md');
      expect(createFile.mock.calls[0][1]).toBe('source body');
    });

    it('duplicate target can be in a different directory', async () => {
      // The picker's input for duplicate pre-fills
      // with the full source path, so the user can
      // edit either the filename OR the directory.
      // Crosss-directory duplicates are the whole
      // point of distinguishing duplicate from rename.
      const { t, createFile } = await setupDuplicateTab();
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('duplicate-committed', {
          detail: {
            sourcePath: 'a.md',
            targetName: 'archive/a.md',
          },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(createFile.mock.calls[0][0]).toBe('archive/a.md');
    });

    it('reloads the file tree after duplicate succeeds', async () => {
      const { t, createFile, getTree } = await setupDuplicateTab();
      const initialCalls = getTree.mock.calls.length;
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('duplicate-committed', {
          detail: {
            sourcePath: 'a.md',
            targetName: 'b.md',
          },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(createFile).toHaveBeenCalledOnce();
      expect(getTree.mock.calls.length).toBe(initialCalls + 1);
    });

    it('shows a success toast with the target path', async () => {
      const toastListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      try {
        const { t } = await setupDuplicateTab();
        const picker = t.shadowRoot.querySelector('ac-file-picker');
        picker.dispatchEvent(
          new CustomEvent('duplicate-committed', {
            detail: {
              sourcePath: 'a.md',
              targetName: 'b.md',
            },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(t);
        const successes = toastListener.mock.calls
          .map((call) => call[0].detail)
          .filter((d) => d.type === 'success');
        expect(successes.length).toBeGreaterThan(0);
        expect(successes.at(-1).message).toContain('b.md');
      } finally {
        window.removeEventListener('ac-toast', toastListener);
      }
    });

    it('same-path commit is a no-op', async () => {
      const { t, getContent, createFile } = await setupDuplicateTab();
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('duplicate-committed', {
          detail: {
            sourcePath: 'a.md',
            targetName: 'a.md',
          },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(getContent).not.toHaveBeenCalled();
      expect(createFile).not.toHaveBeenCalled();
    });

    it('ignores malformed duplicate-committed events', async () => {
      const { t, getContent, createFile } = await setupDuplicateTab();
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('duplicate-committed', {
          detail: { targetName: 'b.md' },
          bubbles: true,
          composed: true,
        }),
      );
      picker.dispatchEvent(
        new CustomEvent('duplicate-committed', {
          detail: { sourcePath: 'a.md' },
          bubbles: true,
          composed: true,
        }),
      );
      picker.dispatchEvent(
        new CustomEvent('duplicate-committed', {
          detail: { sourcePath: '', targetName: 'b.md' },
          bubbles: true,
          composed: true,
        }),
      );
      picker.dispatchEvent(
        new CustomEvent('duplicate-committed', {
          detail: null,
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(getContent).not.toHaveBeenCalled();
      expect(createFile).not.toHaveBeenCalled();
    });

    it('read-source failure aborts without attempting create', async () => {
      publishFakeRpc({
        'Repo.get_file_tree': vi
          .fn()
          .mockResolvedValue(
            fakeTreeResponse([
              { name: 'a.md', path: 'a.md', type: 'file', lines: 5 },
            ]),
          ),
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.get_file_content': vi
          .fn()
          .mockRejectedValue(new Error('binary file')),
        'Repo.create_file': vi.fn().mockResolvedValue({}),
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
        picker.dispatchEvent(
          new CustomEvent('duplicate-committed', {
            detail: {
              sourcePath: 'a.md',
              targetName: 'b.md',
            },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(t);
        const errors = toastListener.mock.calls
          .map((call) => call[0].detail)
          .filter((d) => d.type === 'error');
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.at(-1).message).toContain('binary file');
      } finally {
        window.removeEventListener('ac-toast', toastListener);
        consoleSpy.mockRestore();
      }
    });

    it('create-file failure surfaces as error toast', async () => {
      publishFakeRpc({
        'Repo.get_file_tree': vi
          .fn()
          .mockResolvedValue(
            fakeTreeResponse([
              { name: 'a.md', path: 'a.md', type: 'file', lines: 5 },
            ]),
          ),
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.get_file_content': vi.fn().mockResolvedValue('body'),
        'Repo.create_file': vi
          .fn()
          .mockRejectedValue(new Error('already exists')),
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
        picker.dispatchEvent(
          new CustomEvent('duplicate-committed', {
            detail: {
              sourcePath: 'a.md',
              targetName: 'b.md',
            },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(t);
        const errors = toastListener.mock.calls
          .map((call) => call[0].detail)
          .filter((d) => d.type === 'error');
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.at(-1).message).toContain('already exists');
      } finally {
        window.removeEventListener('ac-toast', toastListener);
        consoleSpy.mockRestore();
      }
    });

    it('surfaces restricted error as warning toast', async () => {
      publishFakeRpc({
        'Repo.get_file_tree': vi
          .fn()
          .mockResolvedValue(
            fakeTreeResponse([
              { name: 'a.md', path: 'a.md', type: 'file', lines: 5 },
            ]),
          ),
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.get_file_content': vi.fn().mockResolvedValue('body'),
        'Repo.create_file': vi.fn().mockResolvedValue({
          error: 'restricted',
          reason: 'Participants cannot create files',
        }),
      });
      const toastListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      try {
        const t = mountTab();
        await settle(t);
        const picker = t.shadowRoot.querySelector('ac-file-picker');
        picker.dispatchEvent(
          new CustomEvent('duplicate-committed', {
            detail: {
              sourcePath: 'a.md',
              targetName: 'b.md',
            },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(t);
        const warnings = toastListener.mock.calls
          .map((call) => call[0].detail)
          .filter((d) => d.type === 'warning');
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings.at(-1).message).toContain('Participants');
      } finally {
        window.removeEventListener('ac-toast', toastListener);
      }
    });

    it('handles non-string content from get_file_content', async () => {
      // Defensive — if a future backend change made
      // get_file_content return something odd (object,
      // null, etc.), we bail with a clear error toast
      // rather than dispatching garbage to create_file.
      publishFakeRpc({
        'Repo.get_file_tree': vi
          .fn()
          .mockResolvedValue(
            fakeTreeResponse([
              { name: 'a.md', path: 'a.md', type: 'file', lines: 5 },
            ]),
          ),
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.get_file_content': vi
          .fn()
          .mockResolvedValue({ not: 'a string' }),
        'Repo.create_file': vi.fn().mockResolvedValue({}),
      });
      const toastListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      try {
        const t = mountTab();
        await settle(t);
        const picker = t.shadowRoot.querySelector('ac-file-picker');
        picker.dispatchEvent(
          new CustomEvent('duplicate-committed', {
            detail: {
              sourcePath: 'a.md',
              targetName: 'b.md',
            },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(t);
        const errors = toastListener.mock.calls
          .map((call) => call[0].detail)
          .filter((d) => d.type === 'error');
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.at(-1).message.toLowerCase()).toContain(
          'unexpected',
        );
      } finally {
        window.removeEventListener('ac-toast', toastListener);
      }
    });
  });

  // -------------------------------------------------------
  // Include / Exclude (8d)
  // -------------------------------------------------------

  describe('new-file action', () => {
    async function setupNewFileTab() {
      const getTree = vi.fn().mockResolvedValue(
        fakeTreeResponse([
          {
            name: 'src',
            path: 'src',
            type: 'dir',
            children: [],
          },
        ]),
      );
      const createFile = vi.fn().mockResolvedValue({});
      publishFakeRpc({
        'Repo.get_file_tree': getTree,
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.create_file': createFile,
      });
      const t = mountTab();
      await settle(t);
      return { t, getTree, createFile };
    }

    it('new-file-committed creates the file with empty content', async () => {
      const { t, createFile } = await setupNewFileTab();
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('new-file-committed', {
          detail: { parentPath: 'src', name: 'README.md' },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(createFile).toHaveBeenCalledOnce();
      expect(createFile.mock.calls[0][0]).toBe('src/README.md');
      expect(createFile.mock.calls[0][1]).toBe('');
    });

    it('creates at repo root when parentPath is empty', async () => {
      // parentPath is the empty string for the root
      // directory — join should produce a bare name,
      // not a leading slash.
      const { t, createFile } = await setupNewFileTab();
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('new-file-committed', {
          detail: { parentPath: '', name: 'a.md' },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(createFile.mock.calls[0][0]).toBe('a.md');
    });

    it('reloads the file tree after creation', async () => {
      const { t, getTree } = await setupNewFileTab();
      const initial = getTree.mock.calls.length;
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('new-file-committed', {
          detail: { parentPath: 'src', name: 'a.md' },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(getTree.mock.calls.length).toBe(initial + 1);
    });

    it('shows a success toast with the target path', async () => {
      const toastListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      try {
        const { t } = await setupNewFileTab();
        const picker = t.shadowRoot.querySelector('ac-file-picker');
        picker.dispatchEvent(
          new CustomEvent('new-file-committed', {
            detail: { parentPath: 'src', name: 'a.md' },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(t);
        const successes = toastListener.mock.calls
          .map((call) => call[0].detail)
          .filter((d) => d.type === 'success');
        expect(successes.length).toBeGreaterThan(0);
        expect(successes.at(-1).message).toContain('src/a.md');
      } finally {
        window.removeEventListener('ac-toast', toastListener);
      }
    });

    it('rejects names with path separators', async () => {
      // Matches the rename-committed rule — nested
      // paths must be created step-by-step.
      const { t, createFile } = await setupNewFileTab();
      const toastListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      try {
        const picker = t.shadowRoot.querySelector('ac-file-picker');
        picker.dispatchEvent(
          new CustomEvent('new-file-committed', {
            detail: { parentPath: 'src', name: 'foo/bar.md' },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(t);
        expect(createFile).not.toHaveBeenCalled();
        const warnings = toastListener.mock.calls
          .map((call) => call[0].detail)
          .filter((d) => d.type === 'warning');
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings.at(-1).message.toLowerCase()).toContain(
          'separator',
        );
      } finally {
        window.removeEventListener('ac-toast', toastListener);
      }
    });

    it('ignores malformed new-file-committed events', async () => {
      const { t, createFile } = await setupNewFileTab();
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      // Missing parentPath.
      picker.dispatchEvent(
        new CustomEvent('new-file-committed', {
          detail: { name: 'a.md' },
          bubbles: true,
          composed: true,
        }),
      );
      // Missing name.
      picker.dispatchEvent(
        new CustomEvent('new-file-committed', {
          detail: { parentPath: 'src' },
          bubbles: true,
          composed: true,
        }),
      );
      // Empty name.
      picker.dispatchEvent(
        new CustomEvent('new-file-committed', {
          detail: { parentPath: 'src', name: '' },
          bubbles: true,
          composed: true,
        }),
      );
      // Null detail.
      picker.dispatchEvent(
        new CustomEvent('new-file-committed', {
          detail: null,
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(createFile).not.toHaveBeenCalled();
    });

    it('surfaces RPC rejection as error toast', async () => {
      publishFakeRpc({
        'Repo.get_file_tree': vi
          .fn()
          .mockResolvedValue(fakeTreeResponse([])),
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.create_file': vi
          .fn()
          .mockRejectedValue(new Error('already exists')),
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
        picker.dispatchEvent(
          new CustomEvent('new-file-committed', {
            detail: { parentPath: '', name: 'a.md' },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(t);
        const errors = toastListener.mock.calls
          .map((call) => call[0].detail)
          .filter((d) => d.type === 'error');
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.at(-1).message).toContain('already exists');
      } finally {
        window.removeEventListener('ac-toast', toastListener);
        consoleSpy.mockRestore();
      }
    });

    it('surfaces restricted error as warning toast', async () => {
      publishFakeRpc({
        'Repo.get_file_tree': vi
          .fn()
          .mockResolvedValue(fakeTreeResponse([])),
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.create_file': vi.fn().mockResolvedValue({
          error: 'restricted',
          reason: 'Participants cannot create files',
        }),
      });
      const toastListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      try {
        const t = mountTab();
        await settle(t);
        const picker = t.shadowRoot.querySelector('ac-file-picker');
        picker.dispatchEvent(
          new CustomEvent('new-file-committed', {
            detail: { parentPath: '', name: 'a.md' },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(t);
        const warnings = toastListener.mock.calls
          .map((call) => call[0].detail)
          .filter((d) => d.type === 'warning');
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings.at(-1).message).toContain('Participants');
      } finally {
        window.removeEventListener('ac-toast', toastListener);
      }
    });
  });

  describe('new-directory action', () => {
    async function setupNewDirTab() {
      const getTree = vi.fn().mockResolvedValue(
        fakeTreeResponse([
          {
            name: 'src',
            path: 'src',
            type: 'dir',
            children: [],
          },
        ]),
      );
      const createFile = vi.fn().mockResolvedValue({});
      publishFakeRpc({
        'Repo.get_file_tree': getTree,
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.create_file': createFile,
      });
      const t = mountTab();
      await settle(t);
      return { t, getTree, createFile };
    }

    it('new-directory-committed creates .gitkeep inside the new dir', async () => {
      // The load-bearing test for Part 2 — empty dirs
      // aren't tracked by git, so we create a
      // placeholder file inside. The path is
      // `{parentPath}/{name}/.gitkeep` and the
      // content is empty.
      const { t, createFile } = await setupNewDirTab();
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('new-directory-committed', {
          detail: { parentPath: 'src', name: 'utils' },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(createFile).toHaveBeenCalledOnce();
      expect(createFile.mock.calls[0][0]).toBe(
        'src/utils/.gitkeep',
      );
      expect(createFile.mock.calls[0][1]).toBe('');
    });

    it('creates at repo root when parentPath is empty', async () => {
      const { t, createFile } = await setupNewDirTab();
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('new-directory-committed', {
          detail: { parentPath: '', name: 'toplevel' },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(createFile.mock.calls[0][0]).toBe(
        'toplevel/.gitkeep',
      );
    });

    it('reloads the file tree after creation', async () => {
      const { t, getTree } = await setupNewDirTab();
      const initial = getTree.mock.calls.length;
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('new-directory-committed', {
          detail: { parentPath: 'src', name: 'utils' },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(getTree.mock.calls.length).toBe(initial + 1);
    });

    it('success toast names the directory, not the .gitkeep path', async () => {
      // Users created a directory; they shouldn't
      // see "Created src/utils/.gitkeep" — that
      // leaks our implementation choice. Toast
      // should name the directory.
      const toastListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      try {
        const { t } = await setupNewDirTab();
        const picker = t.shadowRoot.querySelector('ac-file-picker');
        picker.dispatchEvent(
          new CustomEvent('new-directory-committed', {
            detail: { parentPath: 'src', name: 'utils' },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(t);
        const successes = toastListener.mock.calls
          .map((call) => call[0].detail)
          .filter((d) => d.type === 'success');
        expect(successes.length).toBeGreaterThan(0);
        const message = successes.at(-1).message;
        expect(message).toContain('src/utils');
        // The .gitkeep implementation detail should
        // NOT leak into user-facing messaging.
        expect(message).not.toContain('.gitkeep');
      } finally {
        window.removeEventListener('ac-toast', toastListener);
      }
    });

    it('rejects names with path separators', async () => {
      const { t, createFile } = await setupNewDirTab();
      const toastListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      try {
        const picker = t.shadowRoot.querySelector('ac-file-picker');
        picker.dispatchEvent(
          new CustomEvent('new-directory-committed', {
            detail: {
              parentPath: 'src',
              name: 'nested/inner',
            },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(t);
        expect(createFile).not.toHaveBeenCalled();
        const warnings = toastListener.mock.calls
          .map((call) => call[0].detail)
          .filter((d) => d.type === 'warning');
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings.at(-1).message.toLowerCase()).toContain(
          'separator',
        );
      } finally {
        window.removeEventListener('ac-toast', toastListener);
      }
    });

    it('ignores malformed new-directory-committed events', async () => {
      const { t, createFile } = await setupNewDirTab();
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('new-directory-committed', {
          detail: { name: 'utils' },
          bubbles: true,
          composed: true,
        }),
      );
      picker.dispatchEvent(
        new CustomEvent('new-directory-committed', {
          detail: { parentPath: 'src' },
          bubbles: true,
          composed: true,
        }),
      );
      picker.dispatchEvent(
        new CustomEvent('new-directory-committed', {
          detail: { parentPath: 'src', name: '' },
          bubbles: true,
          composed: true,
        }),
      );
      picker.dispatchEvent(
        new CustomEvent('new-directory-committed', {
          detail: null,
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(createFile).not.toHaveBeenCalled();
    });

    it('surfaces RPC rejection as error toast', async () => {
      publishFakeRpc({
        'Repo.get_file_tree': vi
          .fn()
          .mockResolvedValue(fakeTreeResponse([])),
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.create_file': vi
          .fn()
          .mockRejectedValue(new Error('permission denied')),
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
        picker.dispatchEvent(
          new CustomEvent('new-directory-committed', {
            detail: { parentPath: '', name: 'utils' },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(t);
        const errors = toastListener.mock.calls
          .map((call) => call[0].detail)
          .filter((d) => d.type === 'error');
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.at(-1).message).toContain(
          'permission denied',
        );
      } finally {
        window.removeEventListener('ac-toast', toastListener);
        consoleSpy.mockRestore();
      }
    });

    it('surfaces restricted error as warning toast', async () => {
      publishFakeRpc({
        'Repo.get_file_tree': vi
          .fn()
          .mockResolvedValue(fakeTreeResponse([])),
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.create_file': vi.fn().mockResolvedValue({
          error: 'restricted',
          reason: 'Participants cannot create directories',
        }),
      });
      const toastListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      try {
        const t = mountTab();
        await settle(t);
        const picker = t.shadowRoot.querySelector('ac-file-picker');
        picker.dispatchEvent(
          new CustomEvent('new-directory-committed', {
            detail: { parentPath: '', name: 'utils' },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(t);
        const warnings = toastListener.mock.calls
          .map((call) => call[0].detail)
          .filter((d) => d.type === 'warning');
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings.at(-1).message).toContain('Participants');
      } finally {
        window.removeEventListener('ac-toast', toastListener);
      }
    });
  });

  describe('exclude action', () => {
    async function setupExcludeTab({ excludedFiles = [] } = {}) {
      const getTree = vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 5 },
          ]),
        );
      const setExcluded = vi.fn().mockResolvedValue([]);
      const setSelected = vi.fn().mockResolvedValue([]);
      publishFakeRpc({
        'Repo.get_file_tree': getTree,
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'LLMService.set_excluded_index_files': setExcluded,
        'LLMService.set_selected_files': setSelected,
      });
      const t = mountTab();
      await settle(t);
      // Seed initial exclusion state via a broadcast so
      // we don't need to toggle via the picker.
      if (excludedFiles.length > 0) {
        for (const path of excludedFiles) {
          t._excludedFiles.add(path);
        }
      }
      return { t, setExcluded, setSelected };
    }

    it('adds the file to the excluded set', async () => {
      const { t, setExcluded } = await setupExcludeTab();
      fireContextAction(t, {
        action: 'exclude',
        type: 'file',
        path: 'a.md',
        name: 'a.md',
        isExcluded: false,
      });
      await settle(t);
      expect(t._excludedFiles.has('a.md')).toBe(true);
      expect(setExcluded).toHaveBeenCalledOnce();
      expect(setExcluded.mock.calls[0][0]).toEqual(['a.md']);
    });

    it('no-op when file is already excluded', async () => {
      const { t, setExcluded } = await setupExcludeTab({
        excludedFiles: ['a.md'],
      });
      fireContextAction(t, {
        action: 'exclude',
        type: 'file',
        path: 'a.md',
        name: 'a.md',
        isExcluded: true,
      });
      await settle(t);
      // No server round-trip for an idempotent call.
      expect(setExcluded).not.toHaveBeenCalled();
    });

    it('deselects the file when excluding a selected file', async () => {
      // Exclusion and selection are mutually
      // exclusive — excluding a selected file
      // deselects it in the same operation.
      const { t, setExcluded, setSelected } =
        await setupExcludeTab();
      // Seed selection.
      t._selectedFiles.add('a.md');
      fireContextAction(t, {
        action: 'exclude',
        type: 'file',
        path: 'a.md',
        name: 'a.md',
        isExcluded: false,
      });
      await settle(t);
      expect(t._excludedFiles.has('a.md')).toBe(true);
      expect(t._selectedFiles.has('a.md')).toBe(false);
      // Server notified of both changes.
      expect(setExcluded).toHaveBeenCalledOnce();
      expect(setSelected).toHaveBeenCalledOnce();
      expect(setSelected.mock.calls[0][0]).toEqual([]);
    });

    it('propagates the new exclusion to the picker', async () => {
      const { t } = await setupExcludeTab();
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      fireContextAction(t, {
        action: 'exclude',
        type: 'file',
        path: 'a.md',
        name: 'a.md',
        isExcluded: false,
      });
      await settle(t);
      expect(picker.excludedFiles.has('a.md')).toBe(true);
    });
  });

  describe('include action', () => {
    async function setupIncludeTab({ excludedFiles = ['a.md'] } = {}) {
      const getTree = vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 5 },
          ]),
        );
      const setExcluded = vi.fn().mockResolvedValue([]);
      publishFakeRpc({
        'Repo.get_file_tree': getTree,
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'LLMService.set_excluded_index_files': setExcluded,
      });
      const t = mountTab();
      await settle(t);
      for (const path of excludedFiles) {
        t._excludedFiles.add(path);
      }
      return { t, setExcluded };
    }

    it('removes the file from the excluded set', async () => {
      const { t, setExcluded } = await setupIncludeTab();
      fireContextAction(t, {
        action: 'include',
        type: 'file',
        path: 'a.md',
        name: 'a.md',
        isExcluded: true,
      });
      await settle(t);
      expect(t._excludedFiles.has('a.md')).toBe(false);
      expect(setExcluded).toHaveBeenCalledOnce();
      expect(setExcluded.mock.calls[0][0]).toEqual([]);
    });

    it('does NOT add to the selected set (returns to index-only)', async () => {
      // Per spec — "Include in index" returns the file
      // to the default index-only state, not to
      // selected. Users who want to select it can tick
      // the checkbox after. Matches the shift+click-
      // from-excluded behaviour in the picker.
      const { t } = await setupIncludeTab();
      fireContextAction(t, {
        action: 'include',
        type: 'file',
        path: 'a.md',
        name: 'a.md',
        isExcluded: true,
      });
      await settle(t);
      expect(t._selectedFiles.has('a.md')).toBe(false);
    });

    it('no-op when file is not currently excluded', async () => {
      const { t, setExcluded } = await setupIncludeTab({
        excludedFiles: [],
      });
      fireContextAction(t, {
        action: 'include',
        type: 'file',
        path: 'a.md',
        name: 'a.md',
        isExcluded: false,
      });
      await settle(t);
      expect(setExcluded).not.toHaveBeenCalled();
    });

    it('propagates the updated exclusion to the picker', async () => {
      const { t } = await setupIncludeTab();
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      // Seed picker's view of exclusion to match.
      picker.excludedFiles = new Set(['a.md']);
      fireContextAction(t, {
        action: 'include',
        type: 'file',
        path: 'a.md',
        name: 'a.md',
        isExcluded: true,
      });
      await settle(t);
      expect(picker.excludedFiles.has('a.md')).toBe(false);
    });
  });

  // -------------------------------------------------------
  // Load in panel (8d)
  // -------------------------------------------------------

  describe('load-in-panel actions', () => {
    async function setupLoadPanelTab({
      content = 'file contents',
    } = {}) {
      const getTree = vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 5 },
          ]),
        );
      const getContent = vi.fn().mockResolvedValue(content);
      publishFakeRpc({
        'Repo.get_file_tree': getTree,
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.get_file_content': getContent,
      });
      const t = mountTab();
      await settle(t);
      return { t, getContent };
    }

    it('load-left dispatches load-diff-panel with panel=left', async () => {
      const { t } = await setupLoadPanelTab({
        content: 'left-side body',
      });
      const listener = vi.fn();
      window.addEventListener('load-diff-panel', listener);
      try {
        fireContextAction(t, {
          action: 'load-left',
          type: 'file',
          path: 'a.md',
          name: 'a.md',
          isExcluded: false,
        });
        await settle(t);
        expect(listener).toHaveBeenCalledOnce();
        const detail = listener.mock.calls[0][0].detail;
        expect(detail.panel).toBe('left');
        expect(detail.content).toBe('left-side body');
        expect(detail.label).toBe('a.md');
      } finally {
        window.removeEventListener('load-diff-panel', listener);
      }
    });

    it('load-right dispatches load-diff-panel with panel=right', async () => {
      const { t } = await setupLoadPanelTab();
      const listener = vi.fn();
      window.addEventListener('load-diff-panel', listener);
      try {
        fireContextAction(t, {
          action: 'load-right',
          type: 'file',
          path: 'a.md',
          name: 'a.md',
          isExcluded: false,
        });
        await settle(t);
        expect(listener).toHaveBeenCalledOnce();
        expect(listener.mock.calls[0][0].detail.panel).toBe('right');
      } finally {
        window.removeEventListener('load-diff-panel', listener);
      }
    });

    it('fetches the file content before dispatching', async () => {
      const { t, getContent } = await setupLoadPanelTab();
      fireContextAction(t, {
        action: 'load-left',
        type: 'file',
        path: 'src/deep/a.md',
        name: 'a.md',
        isExcluded: false,
      });
      await settle(t);
      expect(getContent).toHaveBeenCalledOnce();
      expect(getContent.mock.calls[0][0]).toBe('src/deep/a.md');
    });

    it('uses the basename as the label', async () => {
      // Nested paths still produce a compact label so
      // the diff viewer's floating panel chip stays
      // readable.
      const getTree = vi.fn().mockResolvedValue(
        fakeTreeResponse([
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
      publishFakeRpc({
        'Repo.get_file_tree': getTree,
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.get_file_content': vi.fn().mockResolvedValue('body'),
      });
      const listener = vi.fn();
      window.addEventListener('load-diff-panel', listener);
      try {
        const t = mountTab();
        await settle(t);
        fireContextAction(t, {
          action: 'load-right',
          type: 'file',
          path: 'src/main.py',
          name: 'main.py',
          isExcluded: false,
        });
        await settle(t);
        expect(listener.mock.calls[0][0].detail.label).toBe('main.py');
      } finally {
        window.removeEventListener('load-diff-panel', listener);
      }
    });

    it('surfaces RPC failure as error toast', async () => {
      publishFakeRpc({
        'Repo.get_file_tree': vi
          .fn()
          .mockResolvedValue(
            fakeTreeResponse([
              { name: 'a.md', path: 'a.md', type: 'file', lines: 5 },
            ]),
          ),
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.get_file_content': vi
          .fn()
          .mockRejectedValue(new Error('binary file')),
      });
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const toastListener = vi.fn();
      const panelListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      window.addEventListener('load-diff-panel', panelListener);
      try {
        const t = mountTab();
        await settle(t);
        fireContextAction(t, {
          action: 'load-left',
          type: 'file',
          path: 'a.md',
          name: 'a.md',
          isExcluded: false,
        });
        await settle(t);
        const errors = toastListener.mock.calls
          .map((call) => call[0].detail)
          .filter((d) => d.type === 'error');
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.at(-1).message).toContain('binary file');
        // load-diff-panel never fired — the fetch
        // failed before we had content to dispatch.
        expect(panelListener).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener('ac-toast', toastListener);
        window.removeEventListener('load-diff-panel', panelListener);
        consoleSpy.mockRestore();
      }
    });

    it('handles non-string content defensively', async () => {
      publishFakeRpc({
        'Repo.get_file_tree': vi
          .fn()
          .mockResolvedValue(
            fakeTreeResponse([
              { name: 'a.md', path: 'a.md', type: 'file', lines: 5 },
            ]),
          ),
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.get_file_content': vi
          .fn()
          .mockResolvedValue({ weird: 'shape' }),
      });
      const toastListener = vi.fn();
      const panelListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      window.addEventListener('load-diff-panel', panelListener);
      try {
        const t = mountTab();
        await settle(t);
        fireContextAction(t, {
          action: 'load-left',
          type: 'file',
          path: 'a.md',
          name: 'a.md',
          isExcluded: false,
        });
        await settle(t);
        const errors = toastListener.mock.calls
          .map((call) => call[0].detail)
          .filter((d) => d.type === 'error');
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.at(-1).message.toLowerCase()).toContain(
          'unexpected',
        );
        expect(panelListener).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener('ac-toast', toastListener);
        window.removeEventListener('load-diff-panel', panelListener);
      }
    });

    it('rejects invalid panel values silently', async () => {
      // _dispatchLoadInPanel validates the panel arg
      // before doing anything. The switch in
      // _onContextMenuAction only passes 'left' /
      // 'right', but a direct call with a bad value
      // (or a future refactor) shouldn't fire.
      const { t, getContent } = await setupLoadPanelTab();
      const listener = vi.fn();
      window.addEventListener('load-diff-panel', listener);
      try {
        // Call the internal dispatcher directly since
        // the context-menu action catalog doesn't have
        // a way to produce an invalid panel value
        // through normal means.
        t._dispatchLoadInPanel('a.md', 'middle');
        await settle(t);
        expect(getContent).not.toHaveBeenCalled();
        expect(listener).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener('load-diff-panel', listener);
      }
    });
  });

  // -------------------------------------------------------
  // Directory actions (Increment 9 part 1)
  // -------------------------------------------------------

  describe('directory actions', () => {
    /**
     * Build a files-tab containing a src/ dir with
     * two file descendants, plus all the RPCs a dir
     * action might need.
     */
    async function setupDirTab({
      selectedFiles = [],
      excludedFiles = [],
    } = {}) {
      const getTree = vi.fn().mockResolvedValue({
        tree: {
          name: 'repo',
          path: '',
          type: 'dir',
          lines: 0,
          children: [
            {
              name: 'src',
              path: 'src',
              type: 'dir',
              lines: 0,
              children: [
                {
                  name: 'a.md',
                  path: 'src/a.md',
                  type: 'file',
                  lines: 5,
                },
                {
                  name: 'b.md',
                  path: 'src/b.md',
                  type: 'file',
                  lines: 3,
                },
              ],
            },
            {
              name: 'top.md',
              path: 'top.md',
              type: 'file',
              lines: 1,
            },
          ],
        },
        modified: [],
        staged: [],
        untracked: [],
        deleted: [],
        diff_stats: {},
      });
      const stage = vi.fn().mockResolvedValue({});
      const unstage = vi.fn().mockResolvedValue({});
      const renameDir = vi.fn().mockResolvedValue({});
      const setExcluded = vi.fn().mockResolvedValue([]);
      const setSelected = vi.fn().mockResolvedValue([]);
      publishFakeRpc({
        'Repo.get_file_tree': getTree,
        'Repo.get_current_branch': vi.fn().mockResolvedValue({
          branch: 'main',
          detached: false,
          sha: null,
        }),
        'Repo.stage_files': stage,
        'Repo.unstage_files': unstage,
        'Repo.rename_directory': renameDir,
        'LLMService.set_excluded_index_files': setExcluded,
        'LLMService.set_selected_files': setSelected,
      });
      const t = mountTab();
      await settle(t);
      for (const path of selectedFiles) {
        t._selectedFiles.add(path);
      }
      for (const path of excludedFiles) {
        t._excludedFiles.add(path);
      }
      return {
        t,
        getTree,
        stage,
        unstage,
        renameDir,
        setExcluded,
        setSelected,
      };
    }

    /**
     * Fire a `context-menu-action` event from the
     * picker carrying a dir-type detail.
     */
    function fireDirAction(tab, detail) {
      const picker = tab.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('context-menu-action', {
          detail: { type: 'dir', ...detail },
          bubbles: true,
          composed: true,
        }),
      );
    }

    // -----------------------------------------------------
    // stage-all
    // -----------------------------------------------------

    describe('stage-all action', () => {
      it('stages every descendant file in a single RPC', async () => {
        const { t, stage } = await setupDirTab();
        fireDirAction(t, {
          action: 'stage-all',
          path: 'src',
          name: 'src',
        });
        await settle(t);
        expect(stage).toHaveBeenCalledOnce();
        const paths = stage.mock.calls[0][0];
        expect(paths).toContain('src/a.md');
        expect(paths).toContain('src/b.md');
        // Not top.md — it's outside src/.
        expect(paths).not.toContain('top.md');
      });

      it('reloads the file tree after staging', async () => {
        const { t, getTree } = await setupDirTab();
        const initialCalls = getTree.mock.calls.length;
        fireDirAction(t, {
          action: 'stage-all',
          path: 'src',
          name: 'src',
        });
        await settle(t);
        expect(getTree.mock.calls.length).toBe(initialCalls + 1);
      });

      it('shows a success toast with count and dir name', async () => {
        const toastListener = vi.fn();
        window.addEventListener('ac-toast', toastListener);
        try {
          const { t } = await setupDirTab();
          fireDirAction(t, {
            action: 'stage-all',
            path: 'src',
            name: 'src',
          });
          await settle(t);
          const successes = toastListener.mock.calls
            .map((call) => call[0].detail)
            .filter((d) => d.type === 'success');
          expect(successes.length).toBeGreaterThan(0);
          expect(successes.at(-1).message).toContain('2');
          expect(successes.at(-1).message).toContain('src');
        } finally {
          window.removeEventListener('ac-toast', toastListener);
        }
      });

      it('empty directory is a no-op (no RPC, no toast)', async () => {
        // Create a tab whose tree has an empty dir so
        // we can verify the short-circuit cleanly.
        const getTree = vi.fn().mockResolvedValue({
          tree: {
            name: 'repo',
            path: '',
            type: 'dir',
            lines: 0,
            children: [
              {
                name: 'empty',
                path: 'empty',
                type: 'dir',
                children: [],
              },
            ],
          },
          modified: [],
          staged: [],
          untracked: [],
          deleted: [],
          diff_stats: {},
        });
        const stage = vi.fn().mockResolvedValue({});
        publishFakeRpc({
          'Repo.get_file_tree': getTree,
          'Repo.get_current_branch': vi.fn().mockResolvedValue({
            branch: 'main',
            detached: false,
            sha: null,
          }),
          'Repo.stage_files': stage,
        });
        const t = mountTab();
        await settle(t);
        fireDirAction(t, {
          action: 'stage-all',
          path: 'empty',
          name: 'empty',
        });
        await settle(t);
        expect(stage).not.toHaveBeenCalled();
      });

      // ---------------------------------------------------
      // @-filter bridge (Increment 10b)
      // ---------------------------------------------------
      //
      // Nested inside the context-menu dispatch describe
      // because the test file's outermost `describe` blocks
      // each cover a broad scope — bridging to this feature
      // via a sibling `describe('@-filter bridge', ...)`
      // wouldn't fit the file's existing structure. The
      // bridge is its own conceptual unit but physically
      // lives alongside the other files-tab event handlers.

      describe('@-filter bridge', () => {
        /**
         * Fire a `filter-from-chat` event from the chat
         * panel child. Uses the chat panel as source so
         * the bubbles-through-shadow-DOM path matches
         * production.
         */
        function fireFilterFromChat(tab, detail) {
          const chat = tab.shadowRoot.querySelector('ac-chat-panel');
          chat.dispatchEvent(
            new CustomEvent('filter-from-chat', {
              detail,
              bubbles: true,
              composed: true,
            }),
          );
        }

        async function setupBridgeTab() {
          publishFakeRpc({
            'Repo.get_file_tree': vi.fn().mockResolvedValue(
              fakeTreeResponse([
                { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
                { name: 'bar.md', path: 'bar.md', type: 'file', lines: 1 },
                { name: 'baz.md', path: 'baz.md', type: 'file', lines: 1 },
              ]),
            ),
          });
          const t = mountTab();
          await settle(t);
          return t;
        }

        it('forwards a non-empty query to picker.setFilter', async () => {
          const t = await setupBridgeTab();
          const picker = t.shadowRoot.querySelector('ac-file-picker');
          const spy = vi.spyOn(picker, 'setFilter');
          fireFilterFromChat(t, { query: 'bar' });
          await settle(t);
          expect(spy).toHaveBeenCalledOnce();
          expect(spy.mock.calls[0][0]).toBe('bar');
        });

        it('empty string clears the filter', async () => {
          const t = await setupBridgeTab();
          const picker = t.shadowRoot.querySelector('ac-file-picker');
          const spy = vi.spyOn(picker, 'setFilter');
          fireFilterFromChat(t, { query: 'bar' });
          await settle(t);
          fireFilterFromChat(t, { query: '' });
          await settle(t);
          expect(spy).toHaveBeenCalledTimes(2);
          expect(spy.mock.calls[1][0]).toBe('');
        });

        it('filter changes propagate visually to the picker', async () => {
          const t = await setupBridgeTab();
          const picker = t.shadowRoot.querySelector('ac-file-picker');
          // Use a query that matches multiple files by
          // subsequence to pin the filter's actual behaviour.
          // `ba` matches both bar.md (b,a...) and baz.md
          // (b,a...) — fuzzyMatch requires chars in order,
          // not contiguous. Doesn't match a.md (no 'b').
          fireFilterFromChat(t, { query: 'ba' });
          await settle(t);
          const rows = picker.shadowRoot.querySelectorAll('.row.is-file');
          const names = Array.from(rows).map((r) => r.textContent);
          expect(names.some((n) => n.includes('bar.md'))).toBe(true);
          expect(names.some((n) => n.includes('baz.md'))).toBe(true);
          expect(names.some((n) => n.includes('a.md'))).toBe(false);
        });

        it('non-string query is silently dropped', async () => {
          const t = await setupBridgeTab();
          const picker = t.shadowRoot.querySelector('ac-file-picker');
          const spy = vi.spyOn(picker, 'setFilter');
          fireFilterFromChat(t, { query: 42 });
          fireFilterFromChat(t, { query: null });
          fireFilterFromChat(t, { query: { nested: 'obj' } });
          fireFilterFromChat(t, { query: ['array'] });
          await settle(t);
          expect(spy).not.toHaveBeenCalled();
        });

        it('missing detail is silently dropped', async () => {
          const t = await setupBridgeTab();
          const picker = t.shadowRoot.querySelector('ac-file-picker');
          const spy = vi.spyOn(picker, 'setFilter');
          const chat = t.shadowRoot.querySelector('ac-chat-panel');
          chat.dispatchEvent(
            new CustomEvent('filter-from-chat', {
              bubbles: true,
              composed: true,
            }),
          );
          await settle(t);
          expect(spy).not.toHaveBeenCalled();
        });

        it('detail without query field is silently dropped', async () => {
          const t = await setupBridgeTab();
          const picker = t.shadowRoot.querySelector('ac-file-picker');
          const spy = vi.spyOn(picker, 'setFilter');
          fireFilterFromChat(t, {});
          fireFilterFromChat(t, { other: 'field' });
          await settle(t);
          expect(spy).not.toHaveBeenCalled();
        });

        it('no crash when picker is not mounted', async () => {
          const t = await setupBridgeTab();
          const originalPicker = t._picker.bind(t);
          t._picker = () => null;
          try {
            expect(() => {
              fireFilterFromChat(t, { query: 'bar' });
            }).not.toThrow();
          } finally {
            t._picker = originalPicker;
          }
        });

        it('event bubbles across the shadow boundary (from textarea)', async () => {
          const t = await setupBridgeTab();
          const picker = t.shadowRoot.querySelector('ac-file-picker');
          const spy = vi.spyOn(picker, 'setFilter');
          const chat = t.shadowRoot.querySelector('ac-chat-panel');
          const textarea = chat.shadowRoot.querySelector('.input-textarea');
          textarea.dispatchEvent(
            new CustomEvent('filter-from-chat', {
              detail: { query: 'bar' },
              bubbles: true,
              composed: true,
            }),
          );
          await settle(t);
          expect(spy).toHaveBeenCalledOnce();
          expect(spy.mock.calls[0][0]).toBe('bar');
        });

        it('repeated identical queries forward (no bridge dedup)', async () => {
          const t = await setupBridgeTab();
          const picker = t.shadowRoot.querySelector('ac-file-picker');
          const spy = vi.spyOn(picker, 'setFilter');
          fireFilterFromChat(t, { query: 'bar' });
          fireFilterFromChat(t, { query: 'bar' });
          fireFilterFromChat(t, { query: 'bar' });
          await settle(t);
          expect(spy).toHaveBeenCalledTimes(3);
        });
      });

      it('surfaces restricted error as warning toast', async () => {
        publishFakeRpc({
          'Repo.get_file_tree': vi.fn().mockResolvedValue({
            tree: {
              name: 'repo',
              path: '',
              type: 'dir',
              lines: 0,
              children: [
                {
                  name: 'src',
                  path: 'src',
                  type: 'dir',
                  children: [
                    {
                      name: 'a.md',
                      path: 'src/a.md',
                      type: 'file',
                      lines: 1,
                    },
                  ],
                },
              ],
            },
            modified: [],
            staged: [],
            untracked: [],
            deleted: [],
            diff_stats: {},
          }),
          'Repo.get_current_branch': vi.fn().mockResolvedValue({
            branch: 'main',
            detached: false,
            sha: null,
          }),
          'Repo.stage_files': vi.fn().mockResolvedValue({
            error: 'restricted',
            reason: 'Participants cannot stage files',
          }),
        });
        const toastListener = vi.fn();
        window.addEventListener('ac-toast', toastListener);
        try {
          const t = mountTab();
          await settle(t);
          fireDirAction(t, {
            action: 'stage-all',
            path: 'src',
            name: 'src',
          });
          await settle(t);
          const warnings = toastListener.mock.calls
            .map((call) => call[0].detail)
            .filter((d) => d.type === 'warning');
          expect(warnings.length).toBeGreaterThan(0);
        } finally {
          window.removeEventListener('ac-toast', toastListener);
        }
      });

      it('recursively collects files from nested subdirs', async () => {
        const getTree = vi.fn().mockResolvedValue({
          tree: {
            name: 'repo',
            path: '',
            type: 'dir',
            lines: 0,
            children: [
              {
                name: 'src',
                path: 'src',
                type: 'dir',
                children: [
                  {
                    name: 'inner',
                    path: 'src/inner',
                    type: 'dir',
                    children: [
                      {
                        name: 'deep.md',
                        path: 'src/inner/deep.md',
                        type: 'file',
                        lines: 1,
                      },
                    ],
                  },
                  {
                    name: 'shallow.md',
                    path: 'src/shallow.md',
                    type: 'file',
                    lines: 1,
                  },
                ],
              },
            ],
          },
          modified: [],
          staged: [],
          untracked: [],
          deleted: [],
          diff_stats: {},
        });
        const stage = vi.fn().mockResolvedValue({});
        publishFakeRpc({
          'Repo.get_file_tree': getTree,
          'Repo.get_current_branch': vi.fn().mockResolvedValue({
            branch: 'main',
            detached: false,
            sha: null,
          }),
          'Repo.stage_files': stage,
        });
        const t = mountTab();
        await settle(t);
        fireDirAction(t, {
          action: 'stage-all',
          path: 'src',
          name: 'src',
        });
        await settle(t);
        const paths = stage.mock.calls[0][0];
        expect(paths).toContain('src/inner/deep.md');
        expect(paths).toContain('src/shallow.md');
        expect(paths).toHaveLength(2);
      });
    });

    // -----------------------------------------------------
    // unstage-all
    // -----------------------------------------------------

    describe('unstage-all action', () => {
      it('unstages every descendant in a single RPC', async () => {
        const { t, unstage } = await setupDirTab();
        fireDirAction(t, {
          action: 'unstage-all',
          path: 'src',
          name: 'src',
        });
        await settle(t);
        expect(unstage).toHaveBeenCalledOnce();
        expect(unstage.mock.calls[0][0]).toContain('src/a.md');
      });

      it('reloads tree after unstaging', async () => {
        const { t, getTree } = await setupDirTab();
        const initial = getTree.mock.calls.length;
        fireDirAction(t, {
          action: 'unstage-all',
          path: 'src',
          name: 'src',
        });
        await settle(t);
        expect(getTree.mock.calls.length).toBe(initial + 1);
      });
    });

    // -----------------------------------------------------
    // rename-dir
    // -----------------------------------------------------

    describe('rename-dir action', () => {
      it('calls beginRename on the picker', async () => {
        const { t } = await setupDirTab();
        const picker = t.shadowRoot.querySelector('ac-file-picker');
        const spy = vi.spyOn(picker, 'beginRename');
        fireDirAction(t, {
          action: 'rename-dir',
          path: 'src',
          name: 'src',
        });
        await settle(t);
        expect(spy).toHaveBeenCalledOnce();
        expect(spy.mock.calls[0][0]).toBe('src');
      });

      it('rename-committed on a dir path routes to rename_directory', async () => {
        // The commit handler inspects the tree to
        // decide which RPC to call. Dir paths go to
        // rename_directory; file paths go to
        // rename_file. The picker's beginRename
        // doesn't carry that discriminator.
        const { t, renameDir } = await setupDirTab();
        const picker = t.shadowRoot.querySelector('ac-file-picker');
        picker.dispatchEvent(
          new CustomEvent('rename-committed', {
            detail: {
              sourcePath: 'src',
              targetName: 'lib',
            },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(t);
        expect(renameDir).toHaveBeenCalledOnce();
        expect(renameDir.mock.calls[0][0]).toBe('src');
        expect(renameDir.mock.calls[0][1]).toBe('lib');
      });

      it('file rename still routes to rename_file', async () => {
        // Regression check — the new dir-detection
        // logic must not misroute file renames.
        const { t } = await setupDirTab();
        const picker = t.shadowRoot.querySelector('ac-file-picker');
        const call = vi.fn().mockResolvedValue({});
        // Re-publish with a rename_file spy that's
        // identifiable in this test.
        publishFakeRpc({
          'Repo.get_file_tree': vi
            .fn()
            .mockResolvedValue(fakeTreeResponse([])),
          'Repo.get_current_branch': vi.fn().mockResolvedValue({
            branch: 'main',
            detached: false,
            sha: null,
          }),
          'Repo.rename_file': call,
          'Repo.rename_directory': vi
            .fn()
            .mockResolvedValue({}),
        });
        // The tab we built in setupDirTab is still
        // mounted, but its rpcCall has been swapped.
        // Dispatch via the picker child.
        picker.dispatchEvent(
          new CustomEvent('rename-committed', {
            detail: {
              sourcePath: 'top.md',
              targetName: 'renamed.md',
            },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(t);
        expect(call).toHaveBeenCalledOnce();
      });

      it('migrates subtree selection on dir rename', async () => {
        const { t } = await setupDirTab({
          selectedFiles: ['src/a.md', 'top.md'],
        });
        const picker = t.shadowRoot.querySelector('ac-file-picker');
        picker.dispatchEvent(
          new CustomEvent('rename-committed', {
            detail: {
              sourcePath: 'src',
              targetName: 'lib',
            },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(t);
        // src/a.md → lib/a.md (migrated).
        expect(t._selectedFiles.has('src/a.md')).toBe(false);
        expect(t._selectedFiles.has('lib/a.md')).toBe(true);
        // top.md untouched (not under src/).
        expect(t._selectedFiles.has('top.md')).toBe(true);
      });

      it('migrates subtree exclusion on dir rename', async () => {
        const { t } = await setupDirTab({
          excludedFiles: ['src/a.md', 'src/b.md'],
        });
        const picker = t.shadowRoot.querySelector('ac-file-picker');
        picker.dispatchEvent(
          new CustomEvent('rename-committed', {
            detail: {
              sourcePath: 'src',
              targetName: 'lib',
            },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(t);
        expect(t._excludedFiles.has('src/a.md')).toBe(false);
        expect(t._excludedFiles.has('src/b.md')).toBe(false);
        expect(t._excludedFiles.has('lib/a.md')).toBe(true);
        expect(t._excludedFiles.has('lib/b.md')).toBe(true);
      });

      it('rejects target with path separators', async () => {
        const { t, renameDir } = await setupDirTab();
        const toastListener = vi.fn();
        window.addEventListener('ac-toast', toastListener);
        try {
          const picker = t.shadowRoot.querySelector('ac-file-picker');
          picker.dispatchEvent(
            new CustomEvent('rename-committed', {
              detail: {
                sourcePath: 'src',
                targetName: 'nested/lib',
              },
              bubbles: true,
              composed: true,
            }),
          );
          await settle(t);
          expect(renameDir).not.toHaveBeenCalled();
        } finally {
          window.removeEventListener('ac-toast', toastListener);
        }
      });
    });

    // -----------------------------------------------------
    // exclude-all
    // -----------------------------------------------------

    describe('exclude-all action', () => {
      it('adds every descendant to the excluded set', async () => {
        const { t, setExcluded } = await setupDirTab();
        fireDirAction(t, {
          action: 'exclude-all',
          path: 'src',
          name: 'src',
        });
        await settle(t);
        expect(t._excludedFiles.has('src/a.md')).toBe(true);
        expect(t._excludedFiles.has('src/b.md')).toBe(true);
        expect(t._excludedFiles.has('top.md')).toBe(false);
        expect(setExcluded).toHaveBeenCalledOnce();
      });

      it('deselects descendants when excluding them', async () => {
        // Mutual exclusion rule — a file can't be
        // both selected and excluded.
        const { t, setSelected } = await setupDirTab({
          selectedFiles: ['src/a.md', 'top.md'],
        });
        fireDirAction(t, {
          action: 'exclude-all',
          path: 'src',
          name: 'src',
        });
        await settle(t);
        expect(t._selectedFiles.has('src/a.md')).toBe(false);
        // top.md stays selected — it's not a
        // descendant.
        expect(t._selectedFiles.has('top.md')).toBe(true);
        // Server told about the deselection.
        expect(setSelected).toHaveBeenCalled();
      });

      it('empty dir is a no-op', async () => {
        // Builds its own tab because the shared
        // helper doesn't have an empty dir.
        const getTree = vi.fn().mockResolvedValue({
          tree: {
            name: 'repo',
            path: '',
            type: 'dir',
            lines: 0,
            children: [
              {
                name: 'empty',
                path: 'empty',
                type: 'dir',
                children: [],
              },
            ],
          },
          modified: [],
          staged: [],
          untracked: [],
          deleted: [],
          diff_stats: {},
        });
        const setExcluded = vi.fn().mockResolvedValue([]);
        publishFakeRpc({
          'Repo.get_file_tree': getTree,
          'Repo.get_current_branch': vi.fn().mockResolvedValue({
            branch: 'main',
            detached: false,
            sha: null,
          }),
          'LLMService.set_excluded_index_files': setExcluded,
        });
        const t = mountTab();
        await settle(t);
        fireDirAction(t, {
          action: 'exclude-all',
          path: 'empty',
          name: 'empty',
        });
        await settle(t);
        expect(setExcluded).not.toHaveBeenCalled();
      });
    });

    // -----------------------------------------------------
    // include-all
    // -----------------------------------------------------

    describe('include-all action', () => {
      it('removes every descendant from the excluded set', async () => {
        const { t, setExcluded } = await setupDirTab({
          excludedFiles: ['src/a.md', 'src/b.md'],
        });
        fireDirAction(t, {
          action: 'include-all',
          path: 'src',
          name: 'src',
        });
        await settle(t);
        expect(t._excludedFiles.has('src/a.md')).toBe(false);
        expect(t._excludedFiles.has('src/b.md')).toBe(false);
        expect(setExcluded).toHaveBeenCalledOnce();
      });

      it('does NOT auto-select the descendants', async () => {
        // Same rule as the file-level include action —
        // returns to index-only, not to selected.
        const { t, setSelected } = await setupDirTab({
          excludedFiles: ['src/a.md'],
        });
        fireDirAction(t, {
          action: 'include-all',
          path: 'src',
          name: 'src',
        });
        await settle(t);
        expect(t._selectedFiles.has('src/a.md')).toBe(false);
        expect(setSelected).not.toHaveBeenCalled();
      });

      it('partially-excluded dir includes only the excluded files', async () => {
        // `src/a.md` excluded, `src/b.md` not. Include-
        // all removes only a.md from the excluded set;
        // b.md was never there.
        const { t } = await setupDirTab({
          excludedFiles: ['src/a.md'],
        });
        fireDirAction(t, {
          action: 'include-all',
          path: 'src',
          name: 'src',
        });
        await settle(t);
        expect(t._excludedFiles.size).toBe(0);
      });
    });

    // -----------------------------------------------------
    // Unknown actions
    // -----------------------------------------------------

    describe('unknown dir actions', () => {
      it('silently drops unknown actions', async () => {
        const { t, stage, unstage, renameDir, setExcluded } =
          await setupDirTab();
        fireDirAction(t, {
          action: 'bogus',
          path: 'src',
          name: 'src',
        });
        await settle(t);
        expect(stage).not.toHaveBeenCalled();
        expect(unstage).not.toHaveBeenCalled();
        expect(renameDir).not.toHaveBeenCalled();
        expect(setExcluded).not.toHaveBeenCalled();
      });

      it('new-file and new-directory route to picker inline-input (no RPC yet)', async () => {
        // Part 2 of Increment 9 wires these actions to
        // the picker's `beginCreateFile` /
        // `beginCreateDirectory` methods, which open an
        // inline input. The RPC doesn't fire here; it
        // fires on the commit event (tested in the
        // new-file-committed / new-directory-committed
        // describe blocks). This test just pins that
        // the dir actions routed correctly without
        // falling through to the catch-all default
        // branch OR firing staging RPCs.
        const { t, stage } = await setupDirTab();
        fireDirAction(t, {
          action: 'new-file',
          path: 'src',
          name: 'src',
        });
        fireDirAction(t, {
          action: 'new-directory',
          path: 'src',
          name: 'src',
        });
        await settle(t);
        expect(stage).not.toHaveBeenCalled();
        // Picker's inline-input state reflects the
        // most recent routing call. The second
        // fireDirAction (new-directory) wins because
        // `beginCreateDirectory` was called after
        // `beginCreateFile`, and the two states are
        // mutually exclusive.
        const picker = t.shadowRoot.querySelector('ac-file-picker');
        expect(picker._creating).toEqual({
          mode: 'new-directory',
          parentPath: 'src',
        });
      });
    });
  });
});