// Tests for files-tab directory-scoped context-menu actions
// (Increment 9 part 1) — stage-all, unstage-all, rename-dir,
// exclude-all, include-all, plus the @-filter bridge from
// chat to picker. Promoted to a top-level describe; the
// outer "context-menu action dispatch" wrapper from the
// original file is dropped here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mountTab,
  publishFakeRpc,
  settle,
  fakeTreeResponse,
  installCleanup,
} from './test-helpers.js';

import './index.js';

installCleanup();

describe('directory actions', () => {
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
      // Skip the L0 dialog — exercising the batch
      // RPC dispatch, not the prompt.
      t._l0ExcludePref = 'never';
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
      t._l0ExcludePref = 'never';
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