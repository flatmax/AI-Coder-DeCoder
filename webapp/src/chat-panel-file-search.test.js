// Tests for file search mode in the chat panel.
//
// Kept in a separate test file from chat-panel.test.js
// because file search is a substantial feature (mode toggle,
// debounced RPC, overlay rendering, keyboard nav, scroll
// sync) and the tests would double the size of the main
// test file.
//
// Strategy mirrors chat-panel.test.js:
//   - Fake RPC proxy via SharedRpc
//   - Direct component mounting with tracked cleanup
//   - settle() helper for async state propagation
//   - Fake timers where debounce / timeouts matter

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { SharedRpc } from './rpc.js';
import './chat-panel.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _mounted = [];

function mountPanel(props = {}) {
  const p = document.createElement('ac-chat-panel');
  Object.assign(p, props);
  document.body.appendChild(p);
  _mounted.push(p);
  return p;
}

/** Install a fake RPC proxy matching jrpc-oo's envelope shape. */
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

/** Drain Lit updates and microtasks. */
async function settle(panel) {
  await panel.updateComplete;
  // Use setTimeout instead of requestAnimationFrame —
  // rAF in jsdom sometimes hangs after tests that
  // used fake timers, even after vi.useRealTimers()
  // restores. setTimeout(0) is more reliable for
  // draining microtasks.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await panel.updateComplete;
}

afterEach(() => {
  // Defensive — some tests flip to fake timers inside
  // try/finally blocks. If a test throws before the
  // finally runs, or if vitest's fake-timer machinery
  // leaves rAF in a weird state, subsequent tests'
  // settle() calls hang forever waiting for rAF
  // callbacks that never fire. Forcing real timers at
  // the start of every afterEach guarantees DOM
  // cleanup and the next test's mount happen under
  // native timing.
  vi.useRealTimers();
  while (_mounted.length) {
    const p = _mounted.pop();
    if (p.isConnected) p.remove();
  }
  SharedRpc.reset();
  try {
    localStorage.clear();
  } catch (_) {
    // noop in restricted environments
  }
});

// ---------------------------------------------------------------------------
// Mode toggle
// ---------------------------------------------------------------------------

describe('Search mode toggle', () => {
  it('defaults to message mode', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    expect(p._searchMode).toBe('message');
    // Mode button shows the message icon — message mode
    // is "switch to file search" so icon is 💬 by spec.
    const modeBtn = p.shadowRoot.querySelector(
      '.search-mode-toggle',
    );
    expect(modeBtn).toBeTruthy();
    expect(modeBtn.textContent.trim()).toBe('💬');
  });

  it('mode button click switches to file mode', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p.shadowRoot.querySelector('.search-mode-toggle').click();
    await settle(p);
    expect(p._searchMode).toBe('file');
    // Icon now shows 📁.
    const modeBtn = p.shadowRoot.querySelector(
      '.search-mode-toggle',
    );
    expect(modeBtn.textContent.trim()).toBe('📁');
    // Button has active class.
    expect(modeBtn.classList.contains('active')).toBe(true);
  });

  it('clicking again switches back to message mode', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const btn = p.shadowRoot.querySelector('.search-mode-toggle');
    btn.click();
    await settle(p);
    btn.click();
    await settle(p);
    expect(p._searchMode).toBe('message');
  });

  it('switching modes clears the query', async () => {
    // Mental-model hygiene — a message-search query
    // becoming a file-search query would produce
    // surprising results. Clear on switch.
    publishFakeRpc({});
    const p = mountPanel({
      messages: [{ role: 'user', content: 'hello world' }],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'hello';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    expect(p._searchQuery).toBe('hello');
    p.shadowRoot.querySelector('.search-mode-toggle').click();
    await settle(p);
    expect(p._searchQuery).toBe('');
  });

  it('placeholder changes with mode', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    expect(input.placeholder).toMatch(/messages/i);
    p.shadowRoot.querySelector('.search-mode-toggle').click();
    await settle(p);
    const inputAfter = p.shadowRoot.querySelector('.search-input');
    expect(inputAfter.placeholder).toMatch(/files/i);
  });

  it('session buttons hidden in file mode', async () => {
    // New session / History buttons don't apply during
    // file search — they'd clutter the action bar and
    // their semantics are wrong (new session doesn't
    // make sense mid-search).
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    // Before: session buttons visible.
    expect(
      p.shadowRoot.querySelector('.new-session-button'),
    ).toBeTruthy();
    expect(
      p.shadowRoot.querySelector('.history-button'),
    ).toBeTruthy();
    // Switch to file mode.
    p.shadowRoot.querySelector('.search-mode-toggle').click();
    await settle(p);
    // After: session buttons hidden.
    expect(
      p.shadowRoot.querySelector('.new-session-button'),
    ).toBeNull();
    expect(
      p.shadowRoot.querySelector('.history-button'),
    ).toBeNull();
  });

  it('dispatches file-search-changed on mode switch', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const listener = vi.fn();
    p.addEventListener('file-search-changed', listener);
    p.shadowRoot.querySelector('.search-mode-toggle').click();
    await settle(p);
    expect(listener).toHaveBeenCalled();
    // Enters file mode with empty results.
    const lastCall = listener.mock.calls[listener.mock.calls.length - 1];
    expect(lastCall[0].detail).toEqual({
      active: true,
      results: [],
    });
  });

  it('dispatches file-search-changed on exit with active=false', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    // Enter file mode.
    p.shadowRoot.querySelector('.search-mode-toggle').click();
    await settle(p);
    // Listen for exit event.
    const listener = vi.fn();
    p.addEventListener('file-search-changed', listener);
    // Exit.
    p.shadowRoot.querySelector('.search-mode-toggle').click();
    await settle(p);
    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls[0][0].detail.active).toBe(false);
  });

  it('switching modes resets search highlight cursor', async () => {
    // Message-mode highlights cleared on exit so they
    // don't linger if the user re-enters later.
    publishFakeRpc({});
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'match' },
        { role: 'user', content: 'match' },
      ],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'match';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    expect(p._searchCurrentIndex).toBe(0);
    p.shadowRoot.querySelector('.search-mode-toggle').click();
    await settle(p);
    expect(p._searchCurrentIndex).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Debounced RPC
// ---------------------------------------------------------------------------

describe('File search RPC debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('typing in file mode triggers debounced RPC call', async () => {
    const searchFn = vi
      .fn()
      .mockResolvedValue([{ file: 'a.py', matches: [] }]);
    publishFakeRpc({ 'Repo.search_files': searchFn });
    const p = mountPanel();
    await p.updateComplete;
    // Enter file mode.
    p._setSearchMode('file');
    await p.updateComplete;
    // Type a query.
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'hello';
    input.dispatchEvent(new Event('input'));
    await p.updateComplete;
    // Before debounce — no call yet.
    expect(searchFn).not.toHaveBeenCalled();
    // Advance past 300ms debounce.
    await vi.advanceTimersByTimeAsync(350);
    await p.updateComplete;
    expect(searchFn).toHaveBeenCalledTimes(1);
    expect(searchFn.mock.calls[0]).toEqual([
      'hello',
      false, // whole-word default
      false, // regex default
      true, // ignore-case default
      1, // context_lines
    ]);
  });

  it('rapid typing coalesces into one RPC call', async () => {
    const searchFn = vi.fn().mockResolvedValue([]);
    publishFakeRpc({ 'Repo.search_files': searchFn });
    const p = mountPanel();
    await p.updateComplete;
    p._setSearchMode('file');
    await p.updateComplete;
    const input = p.shadowRoot.querySelector('.search-input');
    // Type 5 characters with 100ms between each — less
    // than the 300ms debounce.
    for (const ch of ['a', 'ab', 'abc', 'abcd', 'abcde']) {
      input.value = ch;
      input.dispatchEvent(new Event('input'));
      await p.updateComplete;
      await vi.advanceTimersByTimeAsync(100);
    }
    // So far only 500ms elapsed but each keystroke reset
    // the timer — no call yet.
    expect(searchFn).not.toHaveBeenCalled();
    // Now wait for the full debounce from the last
    // keystroke.
    await vi.advanceTimersByTimeAsync(350);
    await p.updateComplete;
    expect(searchFn).toHaveBeenCalledTimes(1);
    // Only the final query made it through.
    expect(searchFn.mock.calls[0][0]).toBe('abcde');
  });

  it('empty query clears results immediately without RPC', async () => {
    const searchFn = vi.fn().mockResolvedValue([
      { file: 'a.py', matches: [{ line_num: 1, line: 'x' }] },
    ]);
    publishFakeRpc({ 'Repo.search_files': searchFn });
    const p = mountPanel();
    await p.updateComplete;
    p._setSearchMode('file');
    await p.updateComplete;
    const input = p.shadowRoot.querySelector('.search-input');
    // Type, wait, get results.
    input.value = 'foo';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(350);
    await p.updateComplete;
    expect(p._fileSearchResults).toHaveLength(1);
    // Clear.
    input.value = '';
    input.dispatchEvent(new Event('input'));
    await p.updateComplete;
    // Results cleared immediately, no RPC call for empty.
    expect(p._fileSearchResults).toEqual([]);
    expect(searchFn).toHaveBeenCalledTimes(1); // only the first
  });

  it('whitespace-only query is treated as empty', async () => {
    const searchFn = vi.fn().mockResolvedValue([]);
    publishFakeRpc({ 'Repo.search_files': searchFn });
    const p = mountPanel();
    await p.updateComplete;
    p._setSearchMode('file');
    await p.updateComplete;
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = '   \t  ';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(350);
    await p.updateComplete;
    // No RPC call — whitespace-only trimmed to empty.
    expect(searchFn).not.toHaveBeenCalled();
  });

  it('toggle change re-runs the search', async () => {
    const searchFn = vi.fn().mockResolvedValue([]);
    publishFakeRpc({ 'Repo.search_files': searchFn });
    const p = mountPanel();
    await p.updateComplete;
    p._setSearchMode('file');
    await p.updateComplete;
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'foo';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(350);
    await p.updateComplete;
    expect(searchFn).toHaveBeenCalledTimes(1);
    // Toggle regex on.
    const toggles = p.shadowRoot.querySelectorAll('.search-toggle');
    toggles[1].click(); // .*
    await vi.advanceTimersByTimeAsync(350);
    await p.updateComplete;
    expect(searchFn).toHaveBeenCalledTimes(2);
    // Second call had regex=true.
    expect(searchFn.mock.calls[1][2]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stale response guard
// ---------------------------------------------------------------------------

describe('File search stale response guard', () => {
  it('discards earlier response when later one lands first', async () => {
    // Race scenario: user types 'a' → RPC 1 fires slow.
    // User types 'ab' → RPC 2 fires fast, returns first.
    // RPC 1's response arrives later — must NOT overwrite
    // RPC 2's results.
    vi.useFakeTimers();
    try {
      let resolveFirst;
      let resolveSecond;
      const searchFn = vi.fn().mockImplementation((query) => {
        if (query === 'a') {
          return new Promise((r) => {
            resolveFirst = r;
          });
        }
        return new Promise((r) => {
          resolveSecond = r;
        });
      });
      publishFakeRpc({ 'Repo.search_files': searchFn });
      const p = mountPanel();
      await p.updateComplete;
      p._setSearchMode('file');
      await p.updateComplete;
      const input = p.shadowRoot.querySelector('.search-input');
      // First query.
      input.value = 'a';
      input.dispatchEvent(new Event('input'));
      await vi.advanceTimersByTimeAsync(350);
      await p.updateComplete;
      // Second query — cancels the debounce for 'a' but
      // 'a' already fired; now 'ab' fires too.
      input.value = 'ab';
      input.dispatchEvent(new Event('input'));
      await vi.advanceTimersByTimeAsync(350);
      await p.updateComplete;
      expect(searchFn).toHaveBeenCalledTimes(2);
      // Second resolves first.
      resolveSecond([
        { file: 'newer.py', matches: [{ line_num: 1, line: 'ab' }] },
      ]);
      await vi.advanceTimersByTimeAsync(10);
      await p.updateComplete;
      expect(p._fileSearchResults).toHaveLength(1);
      expect(p._fileSearchResults[0].file).toBe('newer.py');
      // First resolves LATER — should be dropped.
      resolveFirst([
        { file: 'stale.py', matches: [{ line_num: 1, line: 'a' }] },
      ]);
      await vi.advanceTimersByTimeAsync(10);
      await p.updateComplete;
      // Still shows the newer results.
      expect(p._fileSearchResults).toHaveLength(1);
      expect(p._fileSearchResults[0].file).toBe('newer.py');
    } finally {
      vi.useRealTimers();
    }
  });

  it('discards response when user exits file mode mid-flight', async () => {
    vi.useFakeTimers();
    try {
      let resolveRpc;
      const searchFn = vi.fn().mockImplementation(() => {
        return new Promise((r) => {
          resolveRpc = r;
        });
      });
      publishFakeRpc({ 'Repo.search_files': searchFn });
      const p = mountPanel();
      await p.updateComplete;
      p._setSearchMode('file');
      await p.updateComplete;
      const input = p.shadowRoot.querySelector('.search-input');
      input.value = 'foo';
      input.dispatchEvent(new Event('input'));
      await vi.advanceTimersByTimeAsync(350);
      await p.updateComplete;
      // User exits file mode mid-flight.
      p._setSearchMode('message');
      await p.updateComplete;
      // Response arrives late.
      resolveRpc([
        { file: 'late.py', matches: [{ line_num: 1, line: 'x' }] },
      ]);
      await vi.advanceTimersByTimeAsync(10);
      await p.updateComplete;
      // Results NOT applied — we're back in message mode.
      expect(p._fileSearchResults).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('RPC error clears state and emits toast', async () => {
    vi.useFakeTimers();
    try {
      const searchFn = vi
        .fn()
        .mockRejectedValue(new Error('grep failed'));
      publishFakeRpc({ 'Repo.search_files': searchFn });
      const toastListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      try {
        const p = mountPanel();
        await p.updateComplete;
        p._setSearchMode('file');
        await p.updateComplete;
        const input = p.shadowRoot.querySelector(
          '.search-input',
        );
        input.value = 'foo';
        input.dispatchEvent(new Event('input'));
        await vi.advanceTimersByTimeAsync(350);
        await p.updateComplete;
        // Let rejection propagate.
        await vi.runAllTimersAsync();
        await p.updateComplete;
        expect(p._fileSearchResults).toEqual([]);
        expect(p._fileSearchLoading).toBe(false);
        expect(toastListener).toHaveBeenCalled();
        const detail = toastListener.mock.calls.at(-1)[0].detail;
        expect(detail.type).toBe('error');
        expect(detail.message).toMatch(/grep failed/i);
      } finally {
        window.removeEventListener('ac-toast', toastListener);
        consoleSpy.mockRestore();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Overlay rendering
// ---------------------------------------------------------------------------

describe('File search overlay rendering', () => {
  it('renders nothing special before query entered', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._setSearchMode('file');
    await settle(p);
    const overlay = p.shadowRoot.querySelector(
      '.file-search-overlay',
    );
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toMatch(/type to search/i);
    // Messages are hidden.
    const messages = p.shadowRoot.querySelector('.messages');
    expect(messages.classList.contains('messages-hidden')).toBe(true);
  });

  it('renders results grouped by file', async () => {
    // Inject results directly to sidestep the debounce
    // path — the render logic is the focus here.
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._setSearchMode('file');
    p._searchQuery = 'foo';
    p._fileSearchResults = [
      {
        file: 'a.py',
        matches: [
          {
            line_num: 10,
            line: 'foo = 1',
            context_before: [],
            context_after: [],
          },
          {
            line_num: 20,
            line: 'foo = 2',
            context_before: [],
            context_after: [],
          },
        ],
      },
      {
        file: 'b.py',
        matches: [
          {
            line_num: 5,
            line: 'foo = 3',
            context_before: [],
            context_after: [],
          },
        ],
      },
    ];
    p._fileSearchFocusedIndex = 0;
    await settle(p);
    const sections = p.shadowRoot.querySelectorAll(
      '.file-search-section',
    );
    expect(sections).toHaveLength(2);
    // File paths in headers.
    const paths = Array.from(
      p.shadowRoot.querySelectorAll('.file-section-path'),
    ).map((el) => el.textContent.trim());
    expect(paths).toEqual(['a.py', 'b.py']);
    // Match counts in badges.
    const counts = Array.from(
      p.shadowRoot.querySelectorAll('.file-section-count'),
    ).map((el) => el.textContent.trim());
    expect(counts).toEqual(['2', '1']);
  });

  it('renders context lines before and after match', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._setSearchMode('file');
    p._searchQuery = 'target';
    p._fileSearchResults = [
      {
        file: 'a.py',
        matches: [
          {
            line_num: 10,
            line: 'target here',
            context_before: [{ line_num: 9, line: 'before' }],
            context_after: [{ line_num: 11, line: 'after' }],
          },
        ],
      },
    ];
    p._fileSearchFocusedIndex = 0;
    await settle(p);
    const rows = p.shadowRoot.querySelectorAll('.file-match-row');
    expect(rows).toHaveLength(3);
    // Context rows have the context class and aren't
    // clickable.
    const contextRows = p.shadowRoot.querySelectorAll(
      '.file-match-row.context',
    );
    expect(contextRows).toHaveLength(2);
    // Content order preserved.
    expect(rows[0].textContent).toContain('before');
    expect(rows[1].textContent).toContain('target here');
    expect(rows[2].textContent).toContain('after');
  });

  it('highlights focused match with .focused class', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._setSearchMode('file');
    p._searchQuery = 'foo';
    p._fileSearchResults = [
      {
        file: 'a.py',
        matches: [
          { line_num: 1, line: 'foo', context_before: [], context_after: [] },
          { line_num: 2, line: 'foo', context_before: [], context_after: [] },
        ],
      },
    ];
    p._fileSearchFocusedIndex = 1;
    await settle(p);
    const matchRows = p.shadowRoot.querySelectorAll(
      '.file-match-row:not(.context)',
    );
    expect(matchRows).toHaveLength(2);
    expect(matchRows[0].classList.contains('focused')).toBe(false);
    expect(matchRows[1].classList.contains('focused')).toBe(true);
  });

  it('shows "Searching…" while loading', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._setSearchMode('file');
    p._searchQuery = 'foo';
    p._fileSearchLoading = true;
    p._fileSearchResults = [];
    await settle(p);
    const overlay = p.shadowRoot.querySelector(
      '.file-search-overlay',
    );
    expect(overlay.textContent).toMatch(/searching/i);
  });

  it('shows "No results found" when query has no matches', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._setSearchMode('file');
    p._searchQuery = 'xyzzy';
    p._fileSearchLoading = false;
    p._fileSearchResults = [];
    await settle(p);
    const overlay = p.shadowRoot.querySelector(
      '.file-search-overlay',
    );
    expect(overlay.textContent).toMatch(/no results/i);
  });

  it('counter shows match count and file count', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._setSearchMode('file');
    p._searchQuery = 'foo';
    p._fileSearchResults = [
      {
        file: 'a.py',
        matches: [
          { line_num: 1, line: 'x', context_before: [], context_after: [] },
          { line_num: 2, line: 'x', context_before: [], context_after: [] },
        ],
      },
      {
        file: 'b.py',
        matches: [
          { line_num: 1, line: 'x', context_before: [], context_after: [] },
        ],
      },
    ];
    await settle(p);
    const counter = p.shadowRoot.querySelector('.search-counter');
    // 3 matches in 2 files.
    expect(counter.textContent).toMatch(/3.*2/);
  });
});

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

describe('File search keyboard navigation', () => {
  async function setupWithResults(panel) {
    panel._setSearchMode('file');
    panel._searchQuery = 'foo';
    panel._fileSearchResults = [
      {
        file: 'a.py',
        matches: [
          {
            line_num: 1,
            line: 'foo',
            context_before: [],
            context_after: [],
          },
          {
            line_num: 2,
            line: 'foo',
            context_before: [],
            context_after: [],
          },
        ],
      },
      {
        file: 'b.py',
        matches: [
          {
            line_num: 5,
            line: 'foo',
            context_before: [],
            context_after: [],
          },
        ],
      },
    ];
    panel._fileSearchFocusedIndex = 0;
    await settle(panel);
  }

  it('ArrowDown advances focus', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    await setupWithResults(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown' }),
    );
    await settle(p);
    expect(p._fileSearchFocusedIndex).toBe(1);
  });

  it('ArrowUp goes back', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    await setupWithResults(p);
    p._fileSearchFocusedIndex = 2; // start at end
    const input = p.shadowRoot.querySelector('.search-input');
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp' }),
    );
    await settle(p);
    expect(p._fileSearchFocusedIndex).toBe(1);
  });

  it('ArrowDown wraps at end', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    await setupWithResults(p);
    p._fileSearchFocusedIndex = 2; // last match
    const input = p.shadowRoot.querySelector('.search-input');
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown' }),
    );
    await settle(p);
    expect(p._fileSearchFocusedIndex).toBe(0);
  });

  it('ArrowUp wraps at start', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    await setupWithResults(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp' }),
    );
    await settle(p);
    expect(p._fileSearchFocusedIndex).toBe(2);
  });

  it('Enter dispatches navigate-file for focused match', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    await setupWithResults(p);
    p._fileSearchFocusedIndex = 2; // b.py:5
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      const input = p.shadowRoot.querySelector('.search-input');
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter' }),
      );
      await settle(p);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].detail).toEqual({
        path: 'b.py',
        line: 5,
      });
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });

  it('Shift+Enter navigates to previous match', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    await setupWithResults(p);
    p._fileSearchFocusedIndex = 1;
    const input = p.shadowRoot.querySelector('.search-input');
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
      }),
    );
    await settle(p);
    expect(p._fileSearchFocusedIndex).toBe(0);
  });

  it('Escape with query clears it', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    await setupWithResults(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape' }),
    );
    await settle(p);
    expect(p._searchQuery).toBe('');
    // Still in file mode.
    expect(p._searchMode).toBe('file');
    expect(p._fileSearchResults).toEqual([]);
  });

  it('Escape with empty query exits file mode', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._setSearchMode('file');
    await settle(p);
    expect(p._searchMode).toBe('file');
    const input = p.shadowRoot.querySelector('.search-input');
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape' }),
    );
    await settle(p);
    expect(p._searchMode).toBe('message');
  });
});

// ---------------------------------------------------------------------------
// Match click and header click
// ---------------------------------------------------------------------------

describe('File search match clicks', () => {
  it('clicking a match row dispatches navigate-file with line', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._setSearchMode('file');
    p._searchQuery = 'foo';
    p._fileSearchResults = [
      {
        file: 'a.py',
        matches: [
          {
            line_num: 42,
            line: 'foo',
            context_before: [],
            context_after: [],
          },
        ],
      },
    ];
    p._fileSearchFocusedIndex = 0;
    await settle(p);
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      const matchRow = p.shadowRoot.querySelector(
        '.file-match-row:not(.context)',
      );
      matchRow.click();
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].detail).toEqual({
        path: 'a.py',
        line: 42,
      });
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });

  it('clicking a section header dispatches navigate-file without line', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._setSearchMode('file');
    p._searchQuery = 'foo';
    p._fileSearchResults = [
      {
        file: 'a.py',
        matches: [
          {
            line_num: 10,
            line: 'foo',
            context_before: [],
            context_after: [],
          },
        ],
      },
    ];
    p._fileSearchFocusedIndex = 0;
    await settle(p);
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      const header = p.shadowRoot.querySelector(
        '.file-section-header',
      );
      header.click();
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].detail).toEqual({
        path: 'a.py',
      });
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });
});

// ---------------------------------------------------------------------------
// Auto-exit on send
// ---------------------------------------------------------------------------

describe('Auto-exit on send', () => {
  it('sending a message exits file search mode', async () => {
    const started = vi
      .fn()
      .mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    p._setSearchMode('file');
    await settle(p);
    expect(p._searchMode).toBe('file');
    // Send a message.
    p._input = 'hello';
    await p._send();
    await settle(p);
    expect(p._searchMode).toBe('message');
    // And the chat_streaming RPC was called — the send
    // went through, it just also switched modes.
    expect(started).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

describe('activateFileSearch', () => {
  it('switches to file mode and focuses input', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p.activateFileSearch();
    await settle(p);
    expect(p._searchMode).toBe('file');
    // The async focus happens after updateComplete.
    await p.updateComplete;
    const input = p.shadowRoot.querySelector('.search-input');
    // jsdom allows setting focus but doesn't track it
    // perfectly; check via the shadowRoot.activeElement.
    expect(p.shadowRoot.activeElement).toBe(input);
  });

  it('prefills the query when provided', async () => {
    vi.useFakeTimers();
    try {
      const searchFn = vi.fn().mockResolvedValue([]);
      publishFakeRpc({ 'Repo.search_files': searchFn });
      const p = mountPanel();
      await p.updateComplete;
      p.activateFileSearch('selected text');
      await p.updateComplete;
      expect(p._searchQuery).toBe('selected text');
      // Kicks off a debounced RPC.
      await vi.advanceTimersByTimeAsync(350);
      await p.updateComplete;
      expect(searchFn).toHaveBeenCalledOnce();
      expect(searchFn.mock.calls[0][0]).toBe('selected text');
    } finally {
      vi.useRealTimers();
    }
  });

  it('trims whitespace from prefill', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p.activateFileSearch('  padded  ');
    await settle(p);
    expect(p._searchQuery).toBe('padded');
  });

  it('empty prefill just switches mode without query', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p.activateFileSearch('');
    await settle(p);
    expect(p._searchMode).toBe('file');
    expect(p._searchQuery).toBe('');
  });

  it('is a no-op when already in file mode', async () => {
    // Shell may call activateFileSearch while already in
    // file mode (user hits Ctrl+Shift+F twice). Should
    // preserve existing query.
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._setSearchMode('file');
    p._searchQuery = 'existing';
    await settle(p);
    // Empty prefill — shouldn't clobber.
    p.activateFileSearch('');
    await settle(p);
    expect(p._searchQuery).toBe('existing');
  });
});

describe('scrollFileSearchToFile', () => {
  it('updates focused index to first match of target file', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._setSearchMode('file');
    p._searchQuery = 'foo';
    p._fileSearchResults = [
      {
        file: 'a.py',
        matches: [
          {
            line_num: 1,
            line: 'x',
            context_before: [],
            context_after: [],
          },
          {
            line_num: 2,
            line: 'x',
            context_before: [],
            context_after: [],
          },
        ],
      },
      {
        file: 'b.py',
        matches: [
          {
            line_num: 5,
            line: 'x',
            context_before: [],
            context_after: [],
          },
        ],
      },
    ];
    p._fileSearchFocusedIndex = 0;
    await settle(p);
    p.scrollFileSearchToFile('b.py');
    await settle(p);
    // b.py is the 3rd match flat-index (a.py has 2 matches).
    expect(p._fileSearchFocusedIndex).toBe(2);
  });

  it('is a no-op when not in file search mode', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p.scrollFileSearchToFile('a.py');
    await settle(p);
    // State unchanged.
    expect(p._fileSearchFocusedIndex).toBe(-1);
  });

  it('is a no-op for unknown file path', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._setSearchMode('file');
    p._searchQuery = 'foo';
    p._fileSearchResults = [
      {
        file: 'a.py',
        matches: [
          {
            line_num: 1,
            line: 'x',
            context_before: [],
            context_after: [],
          },
        ],
      },
    ];
    p._fileSearchFocusedIndex = 0;
    await settle(p);
    p.scrollFileSearchToFile('nonexistent.py');
    await settle(p);
    // Focus unchanged.
    expect(p._fileSearchFocusedIndex).toBe(0);
  });

  it('sets scroll-paused flag for feedback-loop prevention', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._setSearchMode('file');
    p._searchQuery = 'foo';
    p._fileSearchResults = [
      {
        file: 'a.py',
        matches: [
          {
            line_num: 1,
            line: 'x',
            context_before: [],
            context_after: [],
          },
        ],
      },
    ];
    await settle(p);
    expect(p._fileSearchScrollPaused).toBe(false);
    p.scrollFileSearchToFile('a.py');
    await p.updateComplete;
    // Flag set immediately (before the setTimeout clears it).
    expect(p._fileSearchScrollPaused).toBe(true);
  });
});