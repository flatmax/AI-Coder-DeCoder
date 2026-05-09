// Tests for files-tab selection sync — picker ↔ server flow.
// Covers: outbound selection RPC, first-load auto-select
// (modified/staged/untracked/deleted union, single-shot flag,
// ancestor expansion), and inbound files-changed broadcasts.

import { describe, expect, it, vi } from 'vitest';

import {
  mountTab,
  publishFakeRpc,
  settle,
  pushEvent,
  fakeTreeResponse,
  installCleanup,
} from './test-helpers.js';

installCleanup();

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
    //
    // b.md is untracked (not modified) so the user is
    // free to deselect it — modified-file pinning
    // (added in a later increment) would otherwise
    // revert the deselect and mask the test's real
    // intent.
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
        modified: ['a.md'],
        staged: [],
        untracked: ['b.md'],
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