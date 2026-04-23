// Tests for webapp/src/history-browser.js — history browser
// modal component.
//
// Strategy mirrors chat-panel.test.js:
//   - Fake RPC proxy installed via SharedRpc
//   - Manual mount/unmount in afterEach
//   - settle() drains microtasks + rAF so Lit updates settle
//
// Coverage areas:
//   - Initial state (closed renders nothing)
//   - Opening loads sessions
//   - Session list rendering
//   - Session click loads messages
//   - Message preview rendering (user escaped, assistant markdown)
//   - Search input debounce + RPC call
//   - Search mode toggle
//   - Keyboard shortcuts (Escape closes, Escape in search clears first)
//   - Backdrop click closes
//   - Load button calls load_session_into_context
//   - session-loaded event fires on successful load
//   - Stale response handling (generation guards)

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { SharedRpc } from './rpc.js';
import './history-browser.js';
import {
  formatRelativeTime,
  SEARCH_DEBOUNCE_MS,
} from './history-browser.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _mounted = [];

function mountBrowser(props = {}) {
  const el = document.createElement('ac-history-browser');
  Object.assign(el, props);
  document.body.appendChild(el);
  _mounted.push(el);
  return el;
}

function publishFakeRpc(methods) {
  const proxy = {};
  for (const [name, impl] of Object.entries(methods)) {
    proxy[name] = async (...args) => {
      const value = await impl(...args);
      return { fake: value };
    };
  }
  SharedRpc.set(proxy);
  return proxy;
}

async function settle(el) {
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

afterEach(() => {
  while (_mounted.length) {
    const el = _mounted.pop();
    if (el.isConnected) el.remove();
  }
  SharedRpc.reset();
});

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------

describe('formatRelativeTime', () => {
  it('returns empty for falsy input', () => {
    expect(formatRelativeTime('')).toBe('');
    expect(formatRelativeTime(null)).toBe('');
    expect(formatRelativeTime(undefined)).toBe('');
  });

  it('returns "just now" for recent timestamps', () => {
    const iso = new Date(Date.now() - 30 * 1000).toISOString();
    expect(formatRelativeTime(iso)).toBe('just now');
  });

  it('returns minutes for < 1h old', () => {
    const iso = new Date(Date.now() - 12 * 60 * 1000).toISOString();
    expect(formatRelativeTime(iso)).toBe('12m ago');
  });

  it('returns hours for < 1d old', () => {
    const iso = new Date(
      Date.now() - 3 * 60 * 60 * 1000,
    ).toISOString();
    expect(formatRelativeTime(iso)).toBe('3h ago');
  });

  it('returns days for < 30d old', () => {
    const iso = new Date(
      Date.now() - 5 * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(formatRelativeTime(iso)).toBe('5d ago');
  });

  it('returns raw string for malformed input', () => {
    expect(formatRelativeTime('not-a-date')).toBe('not-a-date');
  });
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('HistoryBrowser initial state', () => {
  it('renders nothing when closed', async () => {
    const el = mountBrowser();
    await el.updateComplete;
    // Host display: none when not [open].
    expect(el.shadowRoot.querySelector('.backdrop')).toBeNull();
  });

  it('renders modal when open', async () => {
    publishFakeRpc({});
    const el = mountBrowser({ open: true });
    await settle(el);
    expect(el.shadowRoot.querySelector('.backdrop')).toBeTruthy();
    expect(el.shadowRoot.querySelector('.modal')).toBeTruthy();
  });

  it('reflects open as an attribute', async () => {
    const el = mountBrowser({ open: true });
    await el.updateComplete;
    expect(el.hasAttribute('open')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Session list loading
// ---------------------------------------------------------------------------

describe('HistoryBrowser session list', () => {
  it('loads sessions when opened', async () => {
    const listSessions = vi.fn().mockResolvedValue([
      {
        session_id: 's1',
        timestamp: new Date().toISOString(),
        message_count: 3,
        preview: 'First session',
        first_role: 'user',
      },
    ]);
    publishFakeRpc({ 'LLMService.history_list_sessions': listSessions });
    const el = mountBrowser({ open: true });
    await settle(el);
    expect(listSessions).toHaveBeenCalledOnce();
    const items = el.shadowRoot.querySelectorAll('.session-item');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain('First session');
  });

  it('shows empty state when no sessions', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi.fn().mockResolvedValue([]),
    });
    const el = mountBrowser({ open: true });
    await settle(el);
    expect(
      el.shadowRoot.querySelector('.empty-list').textContent,
    ).toContain('No sessions');
  });

  it('handles session list RPC error gracefully', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi
        .fn()
        .mockRejectedValue(new Error('db exploded')),
    });
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      const el = mountBrowser({ open: true });
      await settle(el);
      // Falls back to empty list.
      expect(
        el.shadowRoot.querySelector('.empty-list'),
      ).toBeTruthy();
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('does not load when RPC is not connected', async () => {
    // No publishFakeRpc — RPC not available.
    const el = mountBrowser({ open: true });
    await settle(el);
    // No crash; empty state or loading state shows.
    expect(el._sessions).toEqual([]);
  });

  it('reloads sessions on re-open', async () => {
    const listSessions = vi.fn().mockResolvedValue([]);
    publishFakeRpc({ 'LLMService.history_list_sessions': listSessions });
    const el = mountBrowser({ open: true });
    await settle(el);
    expect(listSessions).toHaveBeenCalledTimes(1);
    el.open = false;
    await settle(el);
    el.open = true;
    await settle(el);
    expect(listSessions).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Session selection and message preview
// ---------------------------------------------------------------------------

describe('HistoryBrowser session selection', () => {
  async function setupWithSessions() {
    const listSessions = vi.fn().mockResolvedValue([
      {
        session_id: 's1',
        timestamp: new Date().toISOString(),
        message_count: 2,
        preview: 'Session one',
        first_role: 'user',
      },
      {
        session_id: 's2',
        timestamp: new Date().toISOString(),
        message_count: 5,
        preview: 'Session two',
        first_role: 'user',
      },
    ]);
    const getSession = vi.fn().mockImplementation((sid) => {
      if (sid === 's1') {
        return Promise.resolve([
          { role: 'user', content: 'hello from s1' },
          { role: 'assistant', content: '**bold** reply' },
        ]);
      }
      return Promise.resolve([
        { role: 'user', content: 'from s2' },
      ]);
    });
    publishFakeRpc({
      'LLMService.history_list_sessions': listSessions,
      'LLMService.history_get_session': getSession,
    });
    const el = mountBrowser({ open: true });
    await settle(el);
    return { el, getSession };
  }

  it('loads messages on session click', async () => {
    const { el, getSession } = await setupWithSessions();
    const items = el.shadowRoot.querySelectorAll('.session-item');
    items[0].click();
    await settle(el);
    expect(getSession).toHaveBeenCalledWith('s1');
    const messages = el.shadowRoot.querySelectorAll('.preview-message');
    expect(messages.length).toBe(2);
  });

  it('marks selected session visually', async () => {
    const { el } = await setupWithSessions();
    const items = el.shadowRoot.querySelectorAll('.session-item');
    items[0].click();
    await settle(el);
    expect(items[0].classList.contains('selected')).toBe(true);
    expect(items[1].classList.contains('selected')).toBe(false);
  });

  it('clicking the same session twice does not re-fetch', async () => {
    const { el, getSession } = await setupWithSessions();
    const items = el.shadowRoot.querySelectorAll('.session-item');
    items[0].click();
    await settle(el);
    items[0].click();
    await settle(el);
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('renders user content escaped, assistant as markdown', async () => {
    const { el } = await setupWithSessions();
    el.shadowRoot.querySelector('.session-item').click();
    await settle(el);
    const messages = el.shadowRoot.querySelectorAll('.preview-message');
    // User message — no markdown rendering (no <strong>
    // even if content had **).
    expect(messages[0].classList.contains('role-user')).toBe(true);
    expect(messages[0].textContent).toContain('hello from s1');
    // Assistant message — markdown renders **bold** as <strong>.
    expect(messages[1].classList.contains('role-assistant')).toBe(true);
    expect(messages[1].querySelector('strong')).toBeTruthy();
  });

  it('shows system event styling for system_event messages', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi.fn().mockResolvedValue([
        {
          session_id: 's1',
          timestamp: new Date().toISOString(),
          message_count: 1,
          preview: 'session',
          first_role: 'user',
        },
      ]),
      'LLMService.history_get_session': vi.fn().mockResolvedValue([
        {
          role: 'user',
          content: '**Committed** abc1234',
          system_event: true,
        },
      ]),
    });
    const el = mountBrowser({ open: true });
    await settle(el);
    el.shadowRoot.querySelector('.session-item').click();
    await settle(el);
    const msg = el.shadowRoot.querySelector('.preview-message');
    expect(msg.classList.contains('role-system')).toBe(true);
    // System events render as markdown too, so bold appears.
    expect(msg.querySelector('strong')).toBeTruthy();
  });

  it('shows empty-preview placeholder before selection', async () => {
    const { el } = await setupWithSessions();
    expect(
      el.shadowRoot.querySelector('.preview-empty').textContent,
    ).toContain('Select a session');
  });

  it('shows empty-session placeholder for empty sessions', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi.fn().mockResolvedValue([
        {
          session_id: 's1',
          timestamp: new Date().toISOString(),
          message_count: 0,
          preview: '(empty)',
          first_role: 'user',
        },
      ]),
      'LLMService.history_get_session': vi.fn().mockResolvedValue([]),
    });
    const el = mountBrowser({ open: true });
    await settle(el);
    el.shadowRoot.querySelector('.session-item').click();
    await settle(el);
    expect(
      el.shadowRoot.querySelector('.preview-empty').textContent,
    ).toContain('Empty session');
  });

  it('discards stale message responses', async () => {
    // Rapid clicks between sessions — only the latest
    // response should win. Slower responses for earlier
    // clicks must not overwrite the newer selection.
    let resolvers = {};
    const getSession = vi.fn().mockImplementation((sid) => {
      return new Promise((resolve) => {
        resolvers[sid] = resolve;
      });
    });
    publishFakeRpc({
      'LLMService.history_list_sessions': vi.fn().mockResolvedValue([
        {
          session_id: 's1',
          timestamp: new Date().toISOString(),
          message_count: 1,
          preview: 'one',
          first_role: 'user',
        },
        {
          session_id: 's2',
          timestamp: new Date().toISOString(),
          message_count: 1,
          preview: 'two',
          first_role: 'user',
        },
      ]),
      'LLMService.history_get_session': getSession,
    });
    const el = mountBrowser({ open: true });
    await settle(el);
    const items = el.shadowRoot.querySelectorAll('.session-item');
    // Click s1, then s2 before s1's response arrives.
    items[0].click();
    await el.updateComplete;
    items[1].click();
    await el.updateComplete;
    // s2's response arrives first.
    resolvers.s2([
      { role: 'user', content: 'from s2' },
    ]);
    await settle(el);
    // Now s1's stale response arrives.
    resolvers.s1([
      { role: 'user', content: 'STALE from s1' },
      { role: 'assistant', content: 'stale reply' },
    ]);
    await settle(el);
    // Preview reflects s2, not the stale s1 response.
    const messages = el.shadowRoot.querySelectorAll('.preview-message');
    expect(messages.length).toBe(1);
    expect(messages[0].textContent).toContain('from s2');
  });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

describe('HistoryBrowser search', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces search RPC by SEARCH_DEBOUNCE_MS', async () => {
    const search = vi.fn().mockResolvedValue([]);
    publishFakeRpc({
      'LLMService.history_list_sessions': vi
        .fn()
        .mockResolvedValue([]),
      'LLMService.history_search': search,
    });
    const el = mountBrowser({ open: true });
    // Drain the initial load under fake timers.
    await el.updateComplete;
    await vi.runAllTimersAsync();
    await el.updateComplete;

    const input = el.shadowRoot.querySelector('.search-input');
    input.value = 'hello';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;
    // Before debounce elapses — no call yet.
    expect(search).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    await el.updateComplete;
    expect(search).not.toHaveBeenCalled();
    // At the boundary — call fires.
    vi.advanceTimersByTime(1);
    await vi.runAllTimersAsync();
    await el.updateComplete;
    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith('hello');
  });

  it('coalesces rapid typing into a single RPC call', async () => {
    const search = vi.fn().mockResolvedValue([]);
    publishFakeRpc({
      'LLMService.history_list_sessions': vi
        .fn()
        .mockResolvedValue([]),
      'LLMService.history_search': search,
    });
    const el = mountBrowser({ open: true });
    await el.updateComplete;
    await vi.runAllTimersAsync();
    await el.updateComplete;

    const input = el.shadowRoot.querySelector('.search-input');
    // Type several characters rapidly.
    for (const v of ['h', 'he', 'hel', 'hell', 'hello']) {
      input.value = v;
      input.dispatchEvent(new Event('input'));
      await el.updateComplete;
      vi.advanceTimersByTime(50); // less than debounce
    }
    // Now let the debounce fire.
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    await vi.runAllTimersAsync();
    await el.updateComplete;
    // Single RPC call with the final query.
    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith('hello');
  });

  it('empty query returns to session list mode', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi
        .fn()
        .mockResolvedValue([]),
      'LLMService.history_search': vi.fn().mockResolvedValue([]),
    });
    const el = mountBrowser({ open: true });
    await el.updateComplete;
    await vi.runAllTimersAsync();
    await el.updateComplete;

    const input = el.shadowRoot.querySelector('.search-input');
    // Type a query.
    input.value = 'x';
    input.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    await vi.runAllTimersAsync();
    await el.updateComplete;
    expect(el._searchMode).toBe(true);
    // Clear it.
    input.value = '';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;
    expect(el._searchMode).toBe(false);
  });

  it('whitespace-only query does not enter search mode', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi
        .fn()
        .mockResolvedValue([]),
      'LLMService.history_search': vi.fn().mockResolvedValue([]),
    });
    const el = mountBrowser({ open: true });
    await el.updateComplete;
    await vi.runAllTimersAsync();
    await el.updateComplete;

    const input = el.shadowRoot.querySelector('.search-input');
    input.value = '   ';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;
    expect(el._searchMode).toBe(false);
  });

  it('renders search hits', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi
        .fn()
        .mockResolvedValue([]),
      'LLMService.history_search': vi.fn().mockResolvedValue([
        {
          session_id: 's1',
          message_id: 'm1',
          role: 'user',
          content_preview: 'the matching content',
          timestamp: new Date().toISOString(),
        },
      ]),
    });
    const el = mountBrowser({ open: true });
    await el.updateComplete;
    await vi.runAllTimersAsync();
    await el.updateComplete;

    const input = el.shadowRoot.querySelector('.search-input');
    input.value = 'match';
    input.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    await vi.runAllTimersAsync();
    await el.updateComplete;
    const hits = el.shadowRoot.querySelectorAll('.search-hit');
    expect(hits.length).toBe(1);
    expect(hits[0].textContent).toContain('the matching content');
  });

  it('clicking a hit selects its session', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi
        .fn()
        .mockResolvedValue([]),
      'LLMService.history_search': vi.fn().mockResolvedValue([
        {
          session_id: 'target_session',
          message_id: 'm1',
          role: 'user',
          content_preview: 'hit',
          timestamp: new Date().toISOString(),
        },
      ]),
      'LLMService.history_get_session': vi.fn().mockResolvedValue([
        { role: 'user', content: 'target content' },
      ]),
    });
    const el = mountBrowser({ open: true });
    await el.updateComplete;
    await vi.runAllTimersAsync();
    await el.updateComplete;

    const input = el.shadowRoot.querySelector('.search-input');
    input.value = 'match';
    input.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    await vi.runAllTimersAsync();
    await el.updateComplete;
    el.shadowRoot.querySelector('.search-hit').click();
    await vi.runAllTimersAsync();
    await el.updateComplete;
    expect(el._selectedSessionId).toBe('target_session');
    // Search mode exits.
    expect(el._searchMode).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Close actions
// ---------------------------------------------------------------------------

describe('HistoryBrowser close actions', () => {
  it('close button dispatches close event', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi
        .fn()
        .mockResolvedValue([]),
    });
    const el = mountBrowser({ open: true });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('close', listener);
    el.shadowRoot.querySelector('.close-button').click();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('backdrop click dispatches close event', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi
        .fn()
        .mockResolvedValue([]),
    });
    const el = mountBrowser({ open: true });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('close', listener);
    const backdrop = el.shadowRoot.querySelector('.backdrop');
    // Simulate a click on the backdrop itself (target ===
    // currentTarget).
    backdrop.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        composed: true,
      }),
    );
    expect(listener).toHaveBeenCalledOnce();
  });

  it('clicking inside the modal does not close it', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi
        .fn()
        .mockResolvedValue([]),
    });
    const el = mountBrowser({ open: true });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('close', listener);
    el.shadowRoot.querySelector('.modal').click();
    expect(listener).not.toHaveBeenCalled();
  });

  it('Escape key dispatches close event', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi
        .fn()
        .mockResolvedValue([]),
    });
    const el = mountBrowser({ open: true });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('close', listener);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape' }),
    );
    expect(listener).toHaveBeenCalled();
  });

  it('Escape in search input clears query first', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi
        .fn()
        .mockResolvedValue([]),
      'LLMService.history_search': vi.fn().mockResolvedValue([]),
    });
    const el = mountBrowser({ open: true });
    await settle(el);
    const input = el.shadowRoot.querySelector('.search-input');
    input.value = 'hello';
    input.dispatchEvent(new Event('input'));
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('close', listener);
    // Escape from the input.
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      }),
    );
    await el.updateComplete;
    // Query cleared; modal stays open.
    expect(el._searchQuery).toBe('');
    expect(listener).not.toHaveBeenCalled();
  });

  it('Escape in search input with empty query closes modal', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi
        .fn()
        .mockResolvedValue([]),
    });
    const el = mountBrowser({ open: true });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('close', listener);
    const input = el.shadowRoot.querySelector('.search-input');
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      }),
    );
    expect(listener).toHaveBeenCalledOnce();
  });

  it('does not react to Escape when closed', async () => {
    const el = mountBrowser({ open: false });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('close', listener);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape' }),
    );
    expect(listener).not.toHaveBeenCalled();
  });

  it('removes document listener on disconnect', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi
        .fn()
        .mockResolvedValue([]),
    });
    const el = mountBrowser({ open: true });
    await settle(el);
    el.remove();
    // Listener removed — no throws, no ghost events.
    expect(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape' }),
      );
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Load action
// ---------------------------------------------------------------------------

describe('HistoryBrowser load action', () => {
  it('load button is disabled until a session is selected', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi
        .fn()
        .mockResolvedValue([]),
    });
    const el = mountBrowser({ open: true });
    await settle(el);
    const btn = el.shadowRoot.querySelector('.load-button');
    expect(btn.disabled).toBe(true);
  });

  it('load button enables after selection', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi.fn().mockResolvedValue([
        {
          session_id: 's1',
          timestamp: new Date().toISOString(),
          message_count: 1,
          preview: 'one',
          first_role: 'user',
        },
      ]),
      'LLMService.history_get_session': vi
        .fn()
        .mockResolvedValue([]),
    });
    const el = mountBrowser({ open: true });
    await settle(el);
    el.shadowRoot.querySelector('.session-item').click();
    await settle(el);
    const btn = el.shadowRoot.querySelector('.load-button');
    expect(btn.disabled).toBe(false);
  });

  it('calls load_session_into_context on click', async () => {
    const load = vi.fn().mockResolvedValue({
      session_id: 's1',
      messages: [],
    });
    publishFakeRpc({
      'LLMService.history_list_sessions': vi.fn().mockResolvedValue([
        {
          session_id: 's1',
          timestamp: new Date().toISOString(),
          message_count: 1,
          preview: 'one',
          first_role: 'user',
        },
      ]),
      'LLMService.history_get_session': vi
        .fn()
        .mockResolvedValue([]),
      'LLMService.load_session_into_context': load,
    });
    const el = mountBrowser({ open: true });
    await settle(el);
    el.shadowRoot.querySelector('.session-item').click();
    await settle(el);
    el.shadowRoot.querySelector('.load-button').click();
    await settle(el);
    expect(load).toHaveBeenCalledWith('s1');
  });

  it('dispatches session-loaded event on success', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi.fn().mockResolvedValue([
        {
          session_id: 's1',
          timestamp: new Date().toISOString(),
          message_count: 1,
          preview: 'one',
          first_role: 'user',
        },
      ]),
      'LLMService.history_get_session': vi
        .fn()
        .mockResolvedValue([]),
      'LLMService.load_session_into_context': vi
        .fn()
        .mockResolvedValue({ session_id: 's1' }),
    });
    const el = mountBrowser({ open: true });
    await settle(el);
    el.shadowRoot.querySelector('.session-item').click();
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('session-loaded', listener);
    el.shadowRoot.querySelector('.load-button').click();
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail).toEqual({
      session_id: 's1',
    });
  });

  it('does not dispatch session-loaded on RPC error', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi.fn().mockResolvedValue([
        {
          session_id: 's1',
          timestamp: new Date().toISOString(),
          message_count: 1,
          preview: 'one',
          first_role: 'user',
        },
      ]),
      'LLMService.history_get_session': vi
        .fn()
        .mockResolvedValue([]),
      'LLMService.load_session_into_context': vi
        .fn()
        .mockRejectedValue(new Error('load failed')),
    });
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      const el = mountBrowser({ open: true });
      await settle(el);
      el.shadowRoot.querySelector('.session-item').click();
      await settle(el);
      const listener = vi.fn();
      el.addEventListener('session-loaded', listener);
      el.shadowRoot.querySelector('.load-button').click();
      await settle(el);
      expect(listener).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('load button shows Loading during RPC', async () => {
    let resolver;
    const load = vi.fn().mockImplementation(() => {
      return new Promise((r) => {
        resolver = r;
      });
    });
    publishFakeRpc({
      'LLMService.history_list_sessions': vi.fn().mockResolvedValue([
        {
          session_id: 's1',
          timestamp: new Date().toISOString(),
          message_count: 1,
          preview: 'one',
          first_role: 'user',
        },
      ]),
      'LLMService.history_get_session': vi
        .fn()
        .mockResolvedValue([]),
      'LLMService.load_session_into_context': load,
    });
    const el = mountBrowser({ open: true });
    await settle(el);
    el.shadowRoot.querySelector('.session-item').click();
    await settle(el);
    el.shadowRoot.querySelector('.load-button').click();
    await el.updateComplete;
    const btn = el.shadowRoot.querySelector('.load-button');
    expect(btn.textContent).toContain('Loading');
    expect(btn.disabled).toBe(true);
    // Resolve to clean up.
    resolver({ session_id: 's1' });
    await settle(el);
  });

  it('ignores duplicate load clicks', async () => {
    const load = vi.fn().mockImplementation(() => {
      return new Promise((r) => setTimeout(() => r({}), 50));
    });
    publishFakeRpc({
      'LLMService.history_list_sessions': vi.fn().mockResolvedValue([
        {
          session_id: 's1',
          timestamp: new Date().toISOString(),
          message_count: 1,
          preview: 'one',
          first_role: 'user',
        },
      ]),
      'LLMService.history_get_session': vi
        .fn()
        .mockResolvedValue([]),
      'LLMService.load_session_into_context': load,
    });
    const el = mountBrowser({ open: true });
    await settle(el);
    el.shadowRoot.querySelector('.session-item').click();
    await settle(el);
    const btn = el.shadowRoot.querySelector('.load-button');
    btn.click();
    btn.click();
    btn.click();
    await settle(el);
    await new Promise((r) => setTimeout(r, 100));
    expect(load).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// State reset on close
// ---------------------------------------------------------------------------

describe('HistoryBrowser close state reset', () => {
  it('clears search state when closed', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi
        .fn()
        .mockResolvedValue([]),
      'LLMService.history_search': vi.fn().mockResolvedValue([]),
    });
    const el = mountBrowser({ open: true });
    await settle(el);
    // Put into search mode manually (skip the debounce
    // machinery for directness).
    el._searchQuery = 'hello';
    el._searchMode = true;
    el._searchHits = [{ session_id: 's1', content_preview: 'x' }];
    el.open = false;
    await settle(el);
    expect(el._searchQuery).toBe('');
    expect(el._searchMode).toBe(false);
    expect(el._searchHits).toEqual([]);
  });

  it('clears selection when closed', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi.fn().mockResolvedValue([
        {
          session_id: 's1',
          timestamp: new Date().toISOString(),
          message_count: 1,
          preview: 'one',
          first_role: 'user',
        },
      ]),
      'LLMService.history_get_session': vi
        .fn()
        .mockResolvedValue([{ role: 'user', content: 'x' }]),
    });
    const el = mountBrowser({ open: true });
    await settle(el);
    el.shadowRoot.querySelector('.session-item').click();
    await settle(el);
    expect(el._selectedSessionId).toBe('s1');
    el.open = false;
    await settle(el);
    expect(el._selectedSessionId).toBeNull();
    expect(el._selectedMessages).toEqual([]);
  });
});