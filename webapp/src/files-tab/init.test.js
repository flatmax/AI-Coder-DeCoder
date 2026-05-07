// Tests for webapp/src/files-tab.js — initial state and
// file-tree loading. Covers the RPC-ready handshake,
// status-data plumbing into the picker, and error toasts
// when get_file_tree rejects.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  mountTab,
  publishFakeRpc,
  settle,
  fakeTreeResponse,
  installCleanup,
} from './test-helpers.js';

installCleanup();

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