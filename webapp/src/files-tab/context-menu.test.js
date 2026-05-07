// Tests for files-tab context-menu integration —
// middle-click path insertion (Increment 10a) and the
// context-menu action dispatch surface (Increment 8b)
// covering stage/unstage/discard/delete/rename/duplicate/
// new-file/new-directory/exclude/include/load-in-panel.
// Directory-scoped actions live in dir-actions.test.js.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mountTab,
  publishFakeRpc,
  settle,
  pushEvent,
  fakeTreeResponse,
  installCleanup,
} from './test-helpers.js';

import './index.js';

installCleanup();

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
        // Skip the L0 dialog so exclusion applies
        // synchronously — this test exercises the
        // delete-clears-exclusion path, not the
        // prompt flow.
        t._l0ExcludePref = 'never';
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
      // Skip the L0 dialog — this test exercises
      // rename's path-migration, not the prompt.
      t._l0ExcludePref = 'never';
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
      // Skip the L0 dialog — this test exercises the
      // context-menu Exclude action's RPC dispatch,
      // not the prompt flow.
      t._l0ExcludePref = 'never';
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
      t._l0ExcludePref = 'never';
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
      t._l0ExcludePref = 'never';
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
});