// Tests for the per-tab state Map and reactive accessors
// installed by `installReactiveAccessors`. These pin the
// Map-based storage contract directly — the Map exists,
// holds exactly one `"main"` entry after construction,
// `_activeTabId` defaults to `"main"`, and every migrated
// field round-trips through its getter to the active tab's
// state object.

import { describe, expect, it, vi } from 'vitest';

import { mountPanel, settle, seedTab } from './test-helpers.js';

// ---------------------------------------------------------------------------
// Per-tab state structure (D21 Phase A1)
// ---------------------------------------------------------------------------

describe('ChatPanel per-tab state — structure', () => {
  it('constructs with exactly one "main" tab', async () => {
    const p = mountPanel();
    await settle(p);
    expect(p._tabs).toBeInstanceOf(Map);
    expect(p._tabs.size).toBe(1);
    expect(p._tabs.has('main')).toBe(true);
  });

  it('_activeTabId defaults to "main"', async () => {
    const p = mountPanel();
    await settle(p);
    expect(p._activeTabId).toBe('main');
  });

  it('main tab state has every migrated field', async () => {
    // Pin the field list so a future refactor that drops
    // a field from _makeTabState fails here rather than
    // silently breaking reads in production.
    const p = mountPanel();
    await settle(p);
    const tab = p._tabs.get('main');
    // Conversation
    expect(tab.messages).toEqual([]);
    expect(tab.input).toBe('');
    expect(tab.pendingImages).toEqual([]);
    // Streaming
    expect(tab.streaming).toBe(false);
    expect(tab.streamingContent).toBe('');
    expect(tab.currentRequestId).toBeNull();
    expect(tab.lastRequestId).toBeNull();
    expect(tab.streams).toBeInstanceOf(Map);
    expect(tab.pendingChunks).toBeInstanceOf(Map);
    // Selection
    expect(tab.selectedFiles).toEqual([]);
    // Search
    expect(tab.searchQuery).toBe('');
    expect(typeof tab.searchIgnoreCase).toBe('boolean');
    expect(typeof tab.searchRegex).toBe('boolean');
    expect(typeof tab.searchWholeWord).toBe('boolean');
    expect(tab.searchCurrentIndex).toBe(-1);
    expect(tab.searchMode).toBe('message');
    expect(tab.fileSearchResults).toEqual([]);
    expect(tab.fileSearchLoading).toBe(false);
    expect(tab.fileSearchFocusedIndex).toBe(-1);
    expect(tab.fileSearchGeneration).toBe(0);
    expect(tab.fileSearchDebounceTimer).toBeNull();
    expect(tab.fileSearchScrollPaused).toBe(false);
    // UI
    expect(tab.historyOpen).toBe(false);
    expect(typeof tab.snippetDrawerOpen).toBe('boolean');
    expect(tab.lightboxImage).toBeNull();
    expect(tab.urlViewDialog).toBeNull();
    expect(tab.urlViewTab).toBe('content');
    expect(tab.snippets).toEqual([]);
    // URL chip detection
    expect(tab.urlDetectDebounceTimer).toBeNull();
    expect(tab.urlDetectGeneration).toBe(0);
    // Misc
    expect(tab.autoScroll).toBe(true);
    expect(tab.suppressNextPaste).toBe(false);
    expect(tab.activeMention).toBeNull();
  });

  it('getter round-trips through active tab state', async () => {
    // Pin that reads go through the tab state, not a
    // shadow field on `this`. Mutate the Map directly;
    // the getter should reflect the change.
    const p = mountPanel();
    await settle(p);
    const tab = p._tabs.get('main');
    tab.messages = [{ role: 'user', content: 'direct' }];
    expect(p.messages).toEqual([
      { role: 'user', content: 'direct' },
    ]);
  });

  it('setter writes to active tab state', async () => {
    // Pin that writes land in the Map, not a shadow
    // field. Set via the public property; the Map
    // should reflect the change.
    const p = mountPanel();
    await settle(p);
    p.messages = [{ role: 'user', content: 'via setter' }];
    const tab = p._tabs.get('main');
    expect(tab.messages).toEqual([
      { role: 'user', content: 'via setter' },
    ]);
  });

  it('setter triggers Lit re-render', async () => {
    // requestUpdate is the contract — without it, Lit's
    // dirty-check doesn't fire and the template stays
    // stale. Spy on the panel's requestUpdate to
    // verify the setter invokes it.
    const p = mountPanel();
    await settle(p);
    const spy = vi.spyOn(p, 'requestUpdate');
    p._input = 'new value';
    expect(spy).toHaveBeenCalled();
    // First arg is the property name; second is the old
    // value. Matches Lit's reactive-property signature.
    expect(spy.mock.calls[0][0]).toBe('_input');
  });

  it('non-reactive fields do not trigger re-render', async () => {
    // Streams, pendingChunks, autoScroll, etc. are
    // per-tab but non-reactive — Lit shouldn't re-render
    // on their mutation. Pinned so a future setter
    // refactor that accidentally adds requestUpdate
    // calls to these paths fails here.
    const p = mountPanel();
    await settle(p);
    const spy = vi.spyOn(p, 'requestUpdate');
    p._streams = new Map();
    p._pendingChunks = new Map();
    p._autoScroll = false;
    p._currentRequestId = 'fake-id';
    p._lastRequestId = 'another-id';
    expect(spy).not.toHaveBeenCalled();
  });

  it('per-tab state is distinct from component fields', async () => {
    // Make sure we didn't accidentally leave a shadow
    // instance field next to the getter. If a shadow
    // field existed, the getter would still work but
    // hasOwnProperty would find the name on the
    // instance. With the Map-backed approach, only the
    // Map itself is on the instance; the reactive
    // names live on the prototype as accessor
    // descriptors.
    const p = mountPanel();
    await settle(p);
    // `messages` is a reactive accessor — should live
    // on the prototype, not the instance.
    expect(
      Object.prototype.hasOwnProperty.call(p, 'messages'),
    ).toBe(false);
    // But `_tabs` is a plain field on the instance.
    expect(
      Object.prototype.hasOwnProperty.call(p, '_tabs'),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Active-tab-changed event plumbing (D21 Phase A3)
// ---------------------------------------------------------------------------

describe('ChatPanel active-tab-changed event', () => {
  it('_activeTabId defaults to "main"', async () => {
    const p = mountPanel();
    await settle(p);
    expect(p._activeTabId).toBe('main');
  });

  it('setting to same value is a no-op (no event)', async () => {
    // Spam the setter with the current value — no
    // events, no re-renders. Keeps the channel quiet
    // for sibling components that might otherwise
    // do expensive sync work on every dispatch.
    const p = mountPanel();
    await settle(p);
    const listener = vi.fn();
    p.addEventListener('active-tab-changed', listener);
    try {
      p._activeTabId = 'main';
      p._activeTabId = 'main';
      p._activeTabId = 'main';
      await settle(p);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      p.removeEventListener('active-tab-changed', listener);
    }
  });

  it('setting to a different value fires the event', async () => {
    // Single-tab operation doesn't normally hit this
    // path, but the reactive plumbing works — we can
    // seed a second tab, flip to it, and observe the
    // dispatch. Phase C's spawning path will assign
    // real agent tab IDs; the plumbing is identical.
    const p = mountPanel();
    await settle(p);
    seedTab(p, 'some-other-tab');
    const listener = vi.fn();
    p.addEventListener('active-tab-changed', listener);
    try {
      p._activeTabId = 'some-other-tab';
      await settle(p);
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      p.removeEventListener('active-tab-changed', listener);
    }
  });

  it('event detail carries tabId and previousTabId', async () => {
    const p = mountPanel();
    await settle(p);
    seedTab(p, 'new-tab');
    const listener = vi.fn();
    p.addEventListener('active-tab-changed', listener);
    try {
      p._activeTabId = 'new-tab';
      await settle(p);
      const detail = listener.mock.calls[0][0].detail;
      expect(detail).toEqual({
        tabId: 'new-tab',
        previousTabId: 'main',
      });
    } finally {
      p.removeEventListener('active-tab-changed', listener);
    }
  });

  it('successive changes fire once each with correct previous', async () => {
    // Chain of transitions — each event's previousTabId
    // is the previous current, each event's tabId is
    // the new current.
    const p = mountPanel();
    await settle(p);
    seedTab(p, 'a');
    seedTab(p, 'b');
    const listener = vi.fn();
    p.addEventListener('active-tab-changed', listener);
    try {
      p._activeTabId = 'a';
      p._activeTabId = 'b';
      p._activeTabId = 'main';
      await settle(p);
      expect(listener).toHaveBeenCalledTimes(3);
      expect(listener.mock.calls[0][0].detail).toEqual({
        tabId: 'a',
        previousTabId: 'main',
      });
      expect(listener.mock.calls[1][0].detail).toEqual({
        tabId: 'b',
        previousTabId: 'a',
      });
      expect(listener.mock.calls[2][0].detail).toEqual({
        tabId: 'main',
        previousTabId: 'b',
      });
    } finally {
      p.removeEventListener('active-tab-changed', listener);
    }
  });

  it('event bubbles out of the shadow DOM (composed)', async () => {
    // The files-tab orchestrator listens at its own
    // level; the event must cross the shadow boundary.
    const p = mountPanel();
    await settle(p);
    seedTab(p, 'agent-0');
    const outerListener = vi.fn();
    document.body.addEventListener(
      'active-tab-changed',
      outerListener,
    );
    try {
      p._activeTabId = 'agent-0';
      await settle(p);
      expect(outerListener).toHaveBeenCalledOnce();
    } finally {
      document.body.removeEventListener(
        'active-tab-changed',
        outerListener,
      );
    }
  });

  it('triggers a Lit re-render on change', async () => {
    // _activeTabId flipping means the template's
    // getter reads (messages, _input, etc.) will
    // return different tab state. requestUpdate must
    // fire so the template re-renders.
    const p = mountPanel();
    await settle(p);
    seedTab(p, 'x');
    const spy = vi.spyOn(p, 'requestUpdate');
    p._activeTabId = 'x';
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toBe('_activeTabId');
    expect(spy.mock.calls[0][1]).toBe('main');
  });

  it('same-value write does not call requestUpdate', async () => {
    const p = mountPanel();
    await settle(p);
    const spy = vi.spyOn(p, 'requestUpdate');
    p._activeTabId = 'main';
    expect(spy).not.toHaveBeenCalled();
  });

  it('getter reflects the new value after setter', async () => {
    const p = mountPanel();
    await settle(p);
    seedTab(p, 'agent-0');
    expect(p._activeTabId).toBe('main');
    p._activeTabId = 'agent-0';
    expect(p._activeTabId).toBe('agent-0');
  });
});