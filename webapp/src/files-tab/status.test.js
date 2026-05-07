// Tests for webapp/src/files-tab.js — status data slice.
// Covers: files-modified reload behaviour, status data
// plumbing (modified/staged/untracked/deleted + diff_stats),
// and branch info plumbing.

import { afterEach, describe, expect, it, vi } from 'vitest';

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