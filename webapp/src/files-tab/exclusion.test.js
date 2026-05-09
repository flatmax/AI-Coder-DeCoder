// Tests for webapp/src/files-tab.js — exclusion slice.
// Covers: exclusion sync (picker ↔ server) and the
// L0-exclude confirmation dialog with localStorage-backed
// preference.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

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
    // Pre-set the L0 pref to 'never' so the dialog is
    // skipped — this test covers the RPC call shape, not
    // the prompt flow. The dedicated L0 prompt block
    // tests dialog-driven dispatch separately.
    t._l0ExcludePref = 'never';
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
    // Second arg is the invalidate_l0 flag — false
    // when pref is 'never'. (rpcExtract forwards
    // positional args verbatim, so the spy receives
    // [files, invalidateL0].)
    expect(setExcluded.mock.calls[0][1]).toBe(false);
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
    t._l0ExcludePref = 'never';
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
    t._l0ExcludePref = 'never';
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
      t._l0ExcludePref = 'never';
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
      t._l0ExcludePref = 'never';
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
    t._l0ExcludePref = 'never';
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
// L0-exclude confirmation dialog (Commit 3)
// ---------------------------------------------------------------------------

describe('FilesTab L0-exclude prompt', () => {
  /** Dispatch an exclusion-changed event from the picker. */
  function fireExclusionChanged(tab, paths) {
    const picker = tab.shadowRoot.querySelector('ac-file-picker');
    picker.dispatchEvent(
      new CustomEvent('exclusion-changed', {
        detail: { excludedFiles: paths },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Find the dialog DOM element (null when closed). */
  function findDialog(tab) {
    return tab.shadowRoot.querySelector('.l0-dialog');
  }

  async function setupTab() {
    const setExcluded = vi.fn().mockResolvedValue([]);
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
            { name: 'b.md', path: 'b.md', type: 'file', lines: 1 },
          ]),
        ),
      'LLMService.set_excluded_index_files': setExcluded,
    });
    const t = mountTab();
    await settle(t);
    return { t, setExcluded };
  }

  beforeEach(() => {
    try {
      localStorage.removeItem('ac-dc-l0-exclude-pref');
    } catch (_) {}
  });

  afterEach(() => {
    try {
      localStorage.removeItem('ac-dc-l0-exclude-pref');
    } catch (_) {}
  });

  it('default pref is "ask" — dialog opens on first exclusion', async () => {
    const { t } = await setupTab();
    expect(t._l0ExcludePref).toBe('ask');
    fireExclusionChanged(t, ['a.md']);
    await settle(t);
    expect(findDialog(t)).toBeTruthy();
  });

  it('dialog body names a single file by path', async () => {
    const { t } = await setupTab();
    fireExclusionChanged(t, ['a.md']);
    await settle(t);
    const body = t.shadowRoot.querySelector('.l0-dialog-body');
    expect(body.textContent).toContain('a.md');
  });

  it('dialog body shows file count for multi-file batch', async () => {
    const { t } = await setupTab();
    fireExclusionChanged(t, ['a.md', 'b.md']);
    await settle(t);
    const body = t.shadowRoot.querySelector('.l0-dialog-body');
    expect(body.textContent).toContain('2 files');
  });

  it('Apply now invalidates L0 and closes the dialog', async () => {
    const { t, setExcluded } = await setupTab();
    fireExclusionChanged(t, ['a.md']);
    await settle(t);
    t.shadowRoot
      .querySelector('.l0-dialog-btn.primary')
      .click();
    await settle(t);
    expect(findDialog(t)).toBeNull();
    expect(setExcluded).toHaveBeenCalledOnce();
    expect(setExcluded.mock.calls[0][0]).toEqual(['a.md']);
    expect(setExcluded.mock.calls[0][1]).toBe(true);
    expect(t._excludedFiles.has('a.md')).toBe(true);
  });

  it('Defer applies without invalidating L0', async () => {
    const { t, setExcluded } = await setupTab();
    fireExclusionChanged(t, ['a.md']);
    await settle(t);
    t.shadowRoot
      .querySelector('.l0-dialog-btn.secondary')
      .click();
    await settle(t);
    expect(findDialog(t)).toBeNull();
    expect(setExcluded).toHaveBeenCalledOnce();
    expect(setExcluded.mock.calls[0][1]).toBe(false);
    expect(t._excludedFiles.has('a.md')).toBe(true);
  });

  it('Cancel discards the exclusion entirely', async () => {
    const { t, setExcluded } = await setupTab();
    fireExclusionChanged(t, ['a.md']);
    await settle(t);
    t.shadowRoot
      .querySelector('.l0-dialog-btn.cancel')
      .click();
    await settle(t);
    expect(findDialog(t)).toBeNull();
    // No RPC fired — exclusion was abandoned.
    expect(setExcluded).not.toHaveBeenCalled();
    expect(t._excludedFiles.has('a.md')).toBe(false);
  });

  it('Cancel re-pushes exclusion state to the picker', async () => {
    // Defends against the optimistic-render case: the
    // picker's shift+click handler updated its local
    // checkbox visual; cancel must reconcile the
    // visual back to the unchanged authoritative state.
    const { t } = await setupTab();
    fireExclusionChanged(t, ['a.md']);
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    // Simulate the picker's optimistic state — its
    // checkbox visual would show 'a.md' as excluded.
    picker.excludedFiles = new Set(['a.md']);
    t.shadowRoot
      .querySelector('.l0-dialog-btn.cancel')
      .click();
    await settle(t);
    // Picker's prop reconciled to the unchanged
    // authoritative state.
    expect(picker.excludedFiles.has('a.md')).toBe(false);
  });

  it('Backdrop click cancels the dialog', async () => {
    const { t, setExcluded } = await setupTab();
    fireExclusionChanged(t, ['a.md']);
    await settle(t);
    const backdrop = t.shadowRoot.querySelector(
      '.l0-dialog-backdrop',
    );
    backdrop.click();
    await settle(t);
    expect(findDialog(t)).toBeNull();
    expect(setExcluded).not.toHaveBeenCalled();
  });

  it('Click inside the dialog does not cancel', async () => {
    const { t } = await setupTab();
    fireExclusionChanged(t, ['a.md']);
    await settle(t);
    // Click the title — should NOT close.
    t.shadowRoot.querySelector('.l0-dialog-title').click();
    await settle(t);
    expect(findDialog(t)).toBeTruthy();
  });

  it('Escape key cancels the dialog', async () => {
    const { t, setExcluded } = await setupTab();
    fireExclusionChanged(t, ['a.md']);
    await settle(t);
    const backdrop = t.shadowRoot.querySelector(
      '.l0-dialog-backdrop',
    );
    backdrop.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle(t);
    expect(findDialog(t)).toBeNull();
    expect(setExcluded).not.toHaveBeenCalled();
  });

  it('"Don\'t ask again" + Apply now stores "always"', async () => {
    const { t } = await setupTab();
    fireExclusionChanged(t, ['a.md']);
    await settle(t);
    const cb = t.shadowRoot.querySelector(
      '.l0-dialog input[data-l0-remember]',
    );
    cb.checked = true;
    t.shadowRoot
      .querySelector('.l0-dialog-btn.primary')
      .click();
    await settle(t);
    expect(t._l0ExcludePref).toBe('always');
    expect(localStorage.getItem('ac-dc-l0-exclude-pref')).toBe(
      'always',
    );
  });

  it('"Don\'t ask again" + Defer stores "never"', async () => {
    const { t } = await setupTab();
    fireExclusionChanged(t, ['a.md']);
    await settle(t);
    const cb = t.shadowRoot.querySelector(
      '.l0-dialog input[data-l0-remember]',
    );
    cb.checked = true;
    t.shadowRoot
      .querySelector('.l0-dialog-btn.secondary')
      .click();
    await settle(t);
    expect(t._l0ExcludePref).toBe('never');
    expect(localStorage.getItem('ac-dc-l0-exclude-pref')).toBe(
      'never',
    );
  });

  it('"Don\'t ask again" + Cancel does NOT persist a preference', async () => {
    const { t } = await setupTab();
    fireExclusionChanged(t, ['a.md']);
    await settle(t);
    const cb = t.shadowRoot.querySelector(
      '.l0-dialog input[data-l0-remember]',
    );
    cb.checked = true;
    t.shadowRoot
      .querySelector('.l0-dialog-btn.cancel')
      .click();
    await settle(t);
    expect(t._l0ExcludePref).toBe('ask');
    expect(localStorage.getItem('ac-dc-l0-exclude-pref')).toBeNull();
  });

  it('pref="always" skips the dialog and invalidates L0', async () => {
    const { t, setExcluded } = await setupTab();
    t._l0ExcludePref = 'always';
    fireExclusionChanged(t, ['a.md']);
    await settle(t);
    expect(findDialog(t)).toBeNull();
    expect(setExcluded.mock.calls[0][1]).toBe(true);
  });

  it('pref="never" skips the dialog and defers L0', async () => {
    const { t, setExcluded } = await setupTab();
    t._l0ExcludePref = 'never';
    fireExclusionChanged(t, ['a.md']);
    await settle(t);
    expect(findDialog(t)).toBeNull();
    expect(setExcluded.mock.calls[0][1]).toBe(false);
  });

  it('hydrates pref from localStorage on construction', async () => {
    // Set the preference BEFORE mounting so the
    // constructor reads it.
    localStorage.setItem('ac-dc-l0-exclude-pref', 'always');
    const { t } = await setupTab();
    expect(t._l0ExcludePref).toBe('always');
  });

  it('falls back to "ask" for malformed pref values', async () => {
    localStorage.setItem('ac-dc-l0-exclude-pref', 'bogus');
    const { t } = await setupTab();
    expect(t._l0ExcludePref).toBe('ask');
  });

  it('inclusion path skips the dialog regardless of pref', async () => {
    // Exclude a.md first (with pref=never to skip the
    // first dialog), then dispatch an exclusion-changed
    // event whose set is SMALLER (the user un-excluded
    // a.md). The diff is a removal — no dialog.
    const { t, setExcluded } = await setupTab();
    t._l0ExcludePref = 'never';
    fireExclusionChanged(t, ['a.md']);
    await settle(t);
    expect(t._excludedFiles.has('a.md')).toBe(true);
    setExcluded.mockClear();
    // Now flip the pref to 'ask' so we can verify the
    // inclusion path does NOT open the dialog.
    t._l0ExcludePref = 'ask';
    fireExclusionChanged(t, []);
    await settle(t);
    expect(findDialog(t)).toBeNull();
    expect(setExcluded).toHaveBeenCalledOnce();
    // Pure removal — invalidate flag is false.
    expect(setExcluded.mock.calls[0][1]).toBe(false);
    expect(t._excludedFiles.has('a.md')).toBe(false);
  });

  it('include action via context menu always invalidates L0', async () => {
    // _dispatchInclude is the context-menu Include
    // path. Always invalidates regardless of pref.
    const { t, setExcluded } = await setupTab();
    t._excludedFiles = new Set(['a.md']);
    t._l0ExcludePref = 'ask';
    t._dispatchInclude('a.md');
    await settle(t);
    expect(findDialog(t)).toBeNull();
    expect(setExcluded).toHaveBeenCalledOnce();
    expect(setExcluded.mock.calls[0][1]).toBe(true);
  });

  it('exclude-all from directory menu opens the dialog', async () => {
    const { t } = await setupTab();
    t._l0ExcludePref = 'ask';
    t._dispatchExcludeAll('');  // empty path = repo root
    await settle(t);
    expect(findDialog(t)).toBeTruthy();
    const body = t.shadowRoot.querySelector('.l0-dialog-body');
    // Two files were added → dialog body says "2 files".
    expect(body.textContent).toContain('2 files');
  });

  it('include-all always invalidates L0', async () => {
    const { t, setExcluded } = await setupTab();
    t._excludedFiles = new Set(['a.md', 'b.md']);
    t._l0ExcludePref = 'ask';
    t._dispatchIncludeAll('');
    await settle(t);
    expect(findDialog(t)).toBeNull();
    expect(setExcluded).toHaveBeenCalledOnce();
    expect(setExcluded.mock.calls[0][1]).toBe(true);
  });

  it('resetL0ExcludePref clears the stored value', async () => {
    localStorage.setItem('ac-dc-l0-exclude-pref', 'always');
    const { t } = await setupTab();
    expect(t._l0ExcludePref).toBe('always');
    t.resetL0ExcludePref();
    expect(t._l0ExcludePref).toBe('ask');
    expect(
      localStorage.getItem('ac-dc-l0-exclude-pref'),
    ).toBeNull();
  });

  it('agent tab does not pass invalidate_l0 to RPC', async () => {
    // Per the agent-tab carve-out: agent ContextManagers
    // share the orchestrator's L0, so the agent RPC
    // doesn't accept the flag. We pre-set pref=always
    // to skip the dialog, then verify the agent RPC was
    // called with just the path list (no third arg).
    const setAgent = vi.fn().mockResolvedValue([]);
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
          ]),
        ),
      'LLMService.set_agent_excluded_index_files': setAgent,
    });
    const t = mountTab();
    await settle(t);
    t._l0ExcludePref = 'always';
    // Switch to an agent tab — set _activeTabId
    // directly to skip the active-tab-changed event
    // dance.
    t._activeTabId = 'agent-frontend';
    if (!t._excludedFilesByTab.has('agent-frontend')) {
      t._excludedFilesByTab.set('agent-frontend', new Set());
    }
    fireExclusionChanged(t, ['a.md']);
    await settle(t);
    expect(setAgent).toHaveBeenCalledOnce();
    expect(setAgent.mock.calls[0][0]).toBe('agent-frontend');
    expect(setAgent.mock.calls[0][1]).toEqual(['a.md']);
    // Agent RPC has only 2 args.
    expect(setAgent.mock.calls[0].length).toBe(2);
  });
});