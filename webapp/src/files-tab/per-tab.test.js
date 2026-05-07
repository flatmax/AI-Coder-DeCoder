// Tests for webapp/src/files-tab.js — per-tab selection
// structure, active-tab-changed handler, and agent-aware
// RPC routing slices. Extracted from files-tab.test.js.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SharedRpc } from '../rpc.js';
import '../files-tab.js';
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

  it('pushes both selection and exclusion on tab switch', async () => {
    // When the user switches tabs, the picker must see
    // the new tab's selection AND exclusion state in a
    // single coherent update. If only selection were
    // pushed, the picker's exclusion badges would
    // reflect a stale tab until the next exclusion
    // event fired.
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    // Seed main tab state.
    t._selectedFilesByTab.set('main', new Set(['main-sel.py']));
    t._excludedFilesByTab.set('main', new Set(['main-excl.py']));
    // Seed agent tab state.
    t._selectedFilesByTab.set('agent-0', new Set(['agent-sel.py']));
    t._excludedFilesByTab.set('agent-0', new Set(['agent-excl.py']));
    // Switch to agent.
    fireActiveTabChanged('agent-0');
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    expect(picker.selectedFiles.has('agent-sel.py')).toBe(true);
    expect(picker.selectedFiles.has('main-sel.py')).toBe(false);
    expect(picker.excludedFiles.has('agent-excl.py')).toBe(true);
    expect(picker.excludedFiles.has('main-excl.py')).toBe(false);
  });

  it('exclusion writes target the active tab only', async () => {
    // Switch to agent-0, apply an exclusion, verify the
    // agent's Map entry updates and main's stays empty.
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
      'LLMService.set_agent_excluded_index_files': vi
        .fn()
        .mockResolvedValue([]),
    });
    const t = mountTab();
    await settle(t);
    fireActiveTabChanged('agent-0');
    await settle(t);
    t._applyExclusion(new Set(['a.py']), false);
    expect(
      t._excludedFilesByTab.get('agent-0').has('a.py'),
    ).toBe(true);
    expect(t._excludedFilesByTab.get('main').size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Agent-aware selection routing (C2 per-tab backend dispatch)
// ---------------------------------------------------------------------------
//
// When an agent tab is active, _sendSelectionToServer must
// call LLMService.set_agent_selected_files(turn_id,
// agent_idx, files) instead of the main-only
// set_selected_files. parseAgentTabId from the chat panel
// splits the active tab ID into [turn_id, agent_idx]; the
// tab ID format {turn_id}/agent-{NN} is the load-bearing
// contract. Symmetric rule for exclusion: agent tabs hit
// set_agent_excluded_index_files, main hits
// set_excluded_index_files.

describe('FilesTab agent-aware RPC routing', () => {
  /**
   * Fire active-tab-changed to flip the orchestrator's
   * _activeTabId. Same helper shape the A4 block uses.
   */
  function fireActiveTabChanged(tabId, previousTabId = 'main') {
    window.dispatchEvent(
      new CustomEvent('active-tab-changed', {
        detail: { tabId, previousTabId },
      }),
    );
  }

  it('main tab calls set_selected_files', async () => {
    const setMain = vi.fn().mockResolvedValue([]);
    const setAgent = vi.fn().mockResolvedValue([]);
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.py', path: 'a.py', type: 'file', lines: 1 },
          ]),
        ),
      'LLMService.set_selected_files': setMain,
      'LLMService.set_agent_selected_files': setAgent,
    });
    const t = mountTab();
    await settle(t);
    // Main is active by default. Trigger a selection
    // change via the picker's event.
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    picker.dispatchEvent(
      new CustomEvent('selection-changed', {
        detail: { selectedFiles: ['a.py'] },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(setMain).toHaveBeenCalledOnce();
    expect(setMain.mock.calls[0][0]).toEqual(['a.py']);
    expect(setAgent).not.toHaveBeenCalled();
  });

  it('agent tab calls set_agent_selected_files with agent id and files', async () => {
    // Per specs4/5-webapp/agent-browser.md, agent
    // identity is flat — the tab id IS the agent id,
    // and the RPC takes (agent_id, files).
    const setMain = vi.fn().mockResolvedValue([]);
    const setAgent = vi.fn().mockResolvedValue([]);
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.py', path: 'a.py', type: 'file', lines: 1 },
          ]),
        ),
      'LLMService.set_selected_files': setMain,
      'LLMService.set_agent_selected_files': setAgent,
    });
    const t = mountTab();
    await settle(t);
    // Flip to an agent tab — id is the LLM-chosen
    // string passed verbatim to the backend.
    fireActiveTabChanged('frontend-trivial');
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    picker.dispatchEvent(
      new CustomEvent('selection-changed', {
        detail: { selectedFiles: ['a.py'] },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(setAgent).toHaveBeenCalledOnce();
    expect(setAgent.mock.calls[0][0]).toBe('frontend-trivial');
    expect(setAgent.mock.calls[0][1]).toEqual(['a.py']);
    expect(setMain).not.toHaveBeenCalled();
  });

  it('agent tab exclusion routes to set_agent_excluded_index_files', async () => {
    // Same flat-identity contract as selection — the
    // exclusion RPC takes (agent_id, files).
    const setMainExcl = vi.fn().mockResolvedValue([]);
    const setAgentExcl = vi.fn().mockResolvedValue([]);
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.py', path: 'a.py', type: 'file', lines: 1 },
          ]),
        ),
      'LLMService.set_excluded_index_files': setMainExcl,
      'LLMService.set_agent_excluded_index_files': setAgentExcl,
    });
    const t = mountTab();
    await settle(t);
    // Agent tabs share the orchestrator's L0; the
    // dialog is main-tab-only. Set pref to 'never'
    // so the exclusion-changed event applies straight
    // through to the agent RPC.
    t._l0ExcludePref = 'never';
    fireActiveTabChanged('backend-auth');
    await settle(t);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    picker.dispatchEvent(
      new CustomEvent('exclusion-changed', {
        detail: { excludedFiles: ['a.py'] },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(setAgentExcl).toHaveBeenCalledOnce();
    expect(setAgentExcl.mock.calls[0][0]).toBe('backend-auth');
    expect(setAgentExcl.mock.calls[0][1]).toEqual(['a.py']);
    expect(setMainExcl).not.toHaveBeenCalled();
  });

  it('main tab exclusion still calls set_excluded_index_files', async () => {
    const setMainExcl = vi.fn().mockResolvedValue([]);
    const setAgentExcl = vi.fn().mockResolvedValue([]);
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.py', path: 'a.py', type: 'file', lines: 1 },
          ]),
        ),
      'LLMService.set_excluded_index_files': setMainExcl,
      'LLMService.set_agent_excluded_index_files': setAgentExcl,
    });
    const t = mountTab();
    await settle(t);
    t._l0ExcludePref = 'never';
    // Stay on main.
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    picker.dispatchEvent(
      new CustomEvent('exclusion-changed', {
        detail: { excludedFiles: ['a.py'] },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(setMainExcl).toHaveBeenCalledOnce();
    expect(setAgentExcl).not.toHaveBeenCalled();
  });

  it('agent-not-found response emits warning toast', async () => {
    // C1c returns {error: "agent not found"} when the
    // tab was closed server-side between switch and
    // selection. Frontend surfaces this as a warning.
    const setAgent = vi.fn().mockResolvedValue({
      error: 'agent not found',
    });
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.py', path: 'a.py', type: 'file', lines: 1 },
          ]),
        ),
      'LLMService.set_agent_selected_files': setAgent,
    });
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      const t = mountTab();
      await settle(t);
      fireActiveTabChanged('turn_gone/agent-00');
      await settle(t);
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('selection-changed', {
          detail: { selectedFiles: ['a.py'] },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      const warnings = toastListener.mock.calls
        .map((c) => c[0].detail)
        .filter((d) => d.type === 'warning');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].message.toLowerCase()).toContain('agent');
    } finally {
      window.removeEventListener('ac-toast', toastListener);
    }
  });

  it('restricted error from agent RPC emits warning toast', async () => {
    const setAgent = vi.fn().mockResolvedValue({
      error: 'restricted',
      reason: 'Participants cannot change agent selection',
    });
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.py', path: 'a.py', type: 'file', lines: 1 },
          ]),
        ),
      'LLMService.set_agent_selected_files': setAgent,
    });
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      const t = mountTab();
      await settle(t);
      fireActiveTabChanged('turn_abc/agent-00');
      await settle(t);
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('selection-changed', {
          detail: { selectedFiles: ['a.py'] },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      const warnings = toastListener.mock.calls
        .map((c) => c[0].detail)
        .filter((d) => d.type === 'warning');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].message).toContain('Participants');
    } finally {
      window.removeEventListener('ac-toast', toastListener);
    }
  });

  it('main tab routes to main RPC, not agent RPC', async () => {
    // Under flat identity, any non-"main" non-empty
    // string is a valid agent id — there's no
    // "malformed" tab id to fall back from. The only
    // distinction is "main" → main RPCs vs. anything
    // else → agent RPCs. This test pins the main path
    // so a refactor that accidentally routes main
    // through the agent RPC fails here.
    const setMain = vi.fn().mockResolvedValue([]);
    const setAgent = vi.fn().mockResolvedValue([]);
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(
          fakeTreeResponse([
            { name: 'a.py', path: 'a.py', type: 'file', lines: 1 },
          ]),
        ),
      'LLMService.set_selected_files': setMain,
      'LLMService.set_agent_selected_files': setAgent,
    });
    const t = mountTab();
    await settle(t);
    // Active tab defaults to "main" — no need to
    // switch.
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    picker.dispatchEvent(
      new CustomEvent('selection-changed', {
        detail: { selectedFiles: ['a.py'] },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(setMain).toHaveBeenCalledOnce();
    expect(setAgent).not.toHaveBeenCalled();
  });
});