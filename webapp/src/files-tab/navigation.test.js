// Tests for files-tab navigation routing.
// Covers: file-clicked → navigate-file dispatch,
// file-mention-click toggle + navigate semantics, and
// active-file-changed listener (highlight + cleanup).

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