// Tests for webapp/src/input-history.js — InputHistory
// component (up-arrow recall overlay).
//
// Mostly unit-level: addEntry / show / handleKey are
// exercised directly. A few integration-level tests cover
// rendering and click-to-select through the shadow DOM.

import { afterEach, describe, expect, it, vi } from 'vitest';

import './input-history.js';
import { MAX_ENTRIES } from './input-history.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _mounted = [];

function mountHistory() {
  const h = document.createElement('ac-input-history');
  document.body.appendChild(h);
  _mounted.push(h);
  return h;
}

async function settle(el) {
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

afterEach(() => {
  while (_mounted.length) {
    const h = _mounted.pop();
    if (h.isConnected) h.remove();
  }
});

// ---------------------------------------------------------------------------
// addEntry — recording
// ---------------------------------------------------------------------------

describe('InputHistory.addEntry', () => {
  it('records a single entry', () => {
    const h = mountHistory();
    h.addEntry('hello');
    expect(h._entries).toEqual(['hello']);
  });

  it('appends multiple entries in order', () => {
    const h = mountHistory();
    h.addEntry('first');
    h.addEntry('second');
    h.addEntry('third');
    expect(h._entries).toEqual(['first', 'second', 'third']);
  });

  it('ignores empty strings', () => {
    const h = mountHistory();
    h.addEntry('');
    h.addEntry('   ');
    h.addEntry('\n\t');
    expect(h._entries).toEqual([]);
  });

  it('ignores non-string input', () => {
    // Defensive — the chat panel always passes strings,
    // but the component shouldn't crash if a caller
    // misuses it.
    const h = mountHistory();
    h.addEntry(null);
    h.addEntry(undefined);
    h.addEntry(42);
    h.addEntry({});
    expect(h._entries).toEqual([]);
  });

  it('moves duplicates to end rather than doubling', () => {
    const h = mountHistory();
    h.addEntry('first');
    h.addEntry('second');
    h.addEntry('first');
    // Dedup: 'first' appears once, and it's at the end.
    expect(h._entries).toEqual(['second', 'first']);
  });

  it('caps at MAX_ENTRIES, discarding oldest', () => {
    const h = mountHistory();
    for (let i = 0; i < MAX_ENTRIES + 10; i += 1) {
      h.addEntry(`entry ${i}`);
    }
    expect(h._entries.length).toBe(MAX_ENTRIES);
    // Oldest 10 discarded.
    expect(h._entries[0]).toBe('entry 10');
    expect(h._entries[MAX_ENTRIES - 1]).toBe(
      `entry ${MAX_ENTRIES + 9}`,
    );
  });
});

// ---------------------------------------------------------------------------
// show / hide — overlay state
// ---------------------------------------------------------------------------

describe('InputHistory.show / hide', () => {
  it('show returns false when history is empty', () => {
    const h = mountHistory();
    expect(h.show('')).toBe(false);
    expect(h._open).toBe(false);
  });

  it('show returns true and opens when history non-empty', () => {
    const h = mountHistory();
    h.addEntry('hi');
    expect(h.show('')).toBe(true);
    expect(h._open).toBe(true);
    expect(h.isOpen).toBe(true);
  });

  it('saves current input for restoration on cancel', async () => {
    const h = mountHistory();
    h.addEntry('hi');
    h.show('typed so far');
    const listener = vi.fn();
    h.addEventListener('history-cancel', listener);
    h.hide();
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.text).toBe('typed so far');
  });

  it('defaults focus to the newest entry', () => {
    const h = mountHistory();
    h.addEntry('a');
    h.addEntry('b');
    h.addEntry('c');
    h.show('');
    expect(h._focusedIndex).toBe(2);
  });

  it('hide dispatches history-cancel with saved text', async () => {
    const h = mountHistory();
    h.addEntry('hi');
    h.show('original input');
    const listener = vi.fn();
    h.addEventListener('history-cancel', listener);
    h.hide();
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.text).toBe('original input');
  });

  it('hide is a no-op when already closed', () => {
    const h = mountHistory();
    const listener = vi.fn();
    h.addEventListener('history-cancel', listener);
    h.hide();
    expect(listener).not.toHaveBeenCalled();
  });

  it('shows overlay in DOM when open', async () => {
    const h = mountHistory();
    h.addEntry('hi');
    h.show('');
    await settle(h);
    expect(h.shadowRoot.querySelector('.overlay')).toBeTruthy();
    expect(h.shadowRoot.querySelector('.filter-input')).toBeTruthy();
  });

  it('hides overlay from DOM when closed', async () => {
    const h = mountHistory();
    await settle(h);
    expect(h.shadowRoot.querySelector('.overlay')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleKey — navigation
// ---------------------------------------------------------------------------

describe('InputHistory.handleKey', () => {
  it('returns false when closed', () => {
    const h = mountHistory();
    h.addEntry('hi');
    const ev = new KeyboardEvent('keydown', { key: 'Enter' });
    expect(h.handleKey(ev)).toBe(false);
  });

  it('Escape closes and dispatches cancel', () => {
    const h = mountHistory();
    h.addEntry('hi');
    h.show('saved');
    const listener = vi.fn();
    h.addEventListener('history-cancel', listener);
    const ev = new KeyboardEvent('keydown', { key: 'Escape' });
    expect(h.handleKey(ev)).toBe(true);
    expect(h._open).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('Enter dispatches history-select with focused entry', () => {
    const h = mountHistory();
    h.addEntry('a');
    h.addEntry('b');
    h.addEntry('c');
    h.show('');
    // Focus defaults to the newest entry (c).
    const listener = vi.fn();
    h.addEventListener('history-select', listener);
    const ev = new KeyboardEvent('keydown', { key: 'Enter' });
    expect(h.handleKey(ev)).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.text).toBe('c');
    expect(h._open).toBe(false);
  });

  it('ArrowUp moves focus up', () => {
    const h = mountHistory();
    h.addEntry('a');
    h.addEntry('b');
    h.addEntry('c');
    h.show('');
    // Start at index 2 (newest).
    expect(h._focusedIndex).toBe(2);
    h.handleKey(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(h._focusedIndex).toBe(1);
    h.handleKey(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(h._focusedIndex).toBe(0);
  });

  it('ArrowUp clamps at 0', () => {
    const h = mountHistory();
    h.addEntry('a');
    h.addEntry('b');
    h.show('');
    h.handleKey(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(h._focusedIndex).toBe(0);
    // Can't go past the start.
    h.handleKey(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(h._focusedIndex).toBe(0);
  });

  it('ArrowDown moves focus down', () => {
    const h = mountHistory();
    h.addEntry('a');
    h.addEntry('b');
    h.addEntry('c');
    h.show('');
    h.handleKey(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    h.handleKey(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(h._focusedIndex).toBe(0);
    h.handleKey(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(h._focusedIndex).toBe(1);
  });

  it('ArrowDown clamps at last index', () => {
    const h = mountHistory();
    h.addEntry('a');
    h.addEntry('b');
    h.show('');
    expect(h._focusedIndex).toBe(1);
    h.handleKey(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(h._focusedIndex).toBe(1);
  });

  it('returns false for non-navigation keys', () => {
    const h = mountHistory();
    h.addEntry('hi');
    h.show('');
    // Letters, numbers, etc. fall through so the filter
    // input handles them.
    for (const key of ['a', 'Z', '0', ' ', 'Backspace']) {
      expect(
        h.handleKey(new KeyboardEvent('keydown', { key })),
      ).toBe(false);
    }
  });

  it('calls preventDefault on handled keys', () => {
    const h = mountHistory();
    h.addEntry('hi');
    h.show('');
    const ev = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      cancelable: true,
    });
    const preventSpy = vi.spyOn(ev, 'preventDefault');
    h.handleKey(ev);
    expect(preventSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

describe('InputHistory filter', () => {
  it('filter narrows entries by substring', async () => {
    const h = mountHistory();
    h.addEntry('please check files');
    h.addEntry('explain the bug');
    h.addEntry('check the tests');
    h.show('');
    await settle(h);
    const input = h.shadowRoot.querySelector('.filter-input');
    input.value = 'check';
    input.dispatchEvent(new Event('input'));
    await settle(h);
    const entries = h.shadowRoot.querySelectorAll('.entry');
    expect(entries.length).toBe(2);
    expect(entries[0].textContent.trim()).toBe('please check files');
    expect(entries[1].textContent.trim()).toBe('check the tests');
  });

  it('filter is case-insensitive', async () => {
    const h = mountHistory();
    h.addEntry('Check This');
    h.show('');
    await settle(h);
    const input = h.shadowRoot.querySelector('.filter-input');
    input.value = 'check';
    input.dispatchEvent(new Event('input'));
    await settle(h);
    expect(h.shadowRoot.querySelectorAll('.entry').length).toBe(1);
  });

  it('shows empty placeholder when filter matches nothing', async () => {
    const h = mountHistory();
    h.addEntry('hello');
    h.show('');
    await settle(h);
    const input = h.shadowRoot.querySelector('.filter-input');
    input.value = 'xyzzy';
    input.dispatchEvent(new Event('input'));
    await settle(h);
    expect(h.shadowRoot.querySelector('.empty')).toBeTruthy();
    expect(h.shadowRoot.querySelectorAll('.entry').length).toBe(0);
  });

  it('filter change refocuses the newest matching entry', async () => {
    const h = mountHistory();
    h.addEntry('alpha one');
    h.addEntry('beta two');
    h.addEntry('alpha three');
    h.show('');
    await settle(h);
    // Focus starts at index 2 (newest).
    h.handleKey(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(h._focusedIndex).toBe(1);
    // Filter — focus resets to newest match.
    const input = h.shadowRoot.querySelector('.filter-input');
    input.value = 'alpha';
    input.dispatchEvent(new Event('input'));
    await settle(h);
    // Filtered list is ['alpha one', 'alpha three'];
    // focus lands on index 1 (newest match).
    expect(h._focusedIndex).toBe(1);
  });

  it('empty filter shows all entries', async () => {
    const h = mountHistory();
    h.addEntry('a');
    h.addEntry('b');
    h.show('');
    await settle(h);
    const input = h.shadowRoot.querySelector('.filter-input');
    input.value = 'a';
    input.dispatchEvent(new Event('input'));
    await settle(h);
    input.value = '';
    input.dispatchEvent(new Event('input'));
    await settle(h);
    expect(h.shadowRoot.querySelectorAll('.entry').length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Selection events
// ---------------------------------------------------------------------------

describe('InputHistory selection', () => {
  it('history-select bubbles across shadow DOM', () => {
    const h = mountHistory();
    h.addEntry('hello');
    h.show('');
    const outerListener = vi.fn();
    document.body.addEventListener('history-select', outerListener);
    try {
      h.handleKey(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(outerListener).toHaveBeenCalledOnce();
    } finally {
      document.body.removeEventListener(
        'history-select',
        outerListener,
      );
    }
  });

  it('click on an entry selects it', async () => {
    const h = mountHistory();
    h.addEntry('first');
    h.addEntry('second');
    h.show('');
    await settle(h);
    const listener = vi.fn();
    h.addEventListener('history-select', listener);
    const entries = h.shadowRoot.querySelectorAll('.entry');
    entries[0].click();
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.text).toBe('first');
  });

  it('clears state after select', () => {
    const h = mountHistory();
    h.addEntry('hi');
    h.show('saved');
    h.handleKey(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(h._open).toBe(false);
    expect(h._filter).toBe('');
    expect(h._focusedIndex).toBe(-1);
    expect(h._savedInput).toBe('');
  });

  it('selecting from filtered list picks the focused match', async () => {
    const h = mountHistory();
    h.addEntry('alpha');
    h.addEntry('beta');
    h.addEntry('alpha two');
    h.show('');
    await settle(h);
    const input = h.shadowRoot.querySelector('.filter-input');
    input.value = 'alpha';
    input.dispatchEvent(new Event('input'));
    await settle(h);
    // _focusedIndex is 1 in filtered list ('alpha two').
    const listener = vi.fn();
    h.addEventListener('history-select', listener);
    h.handleKey(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(listener.mock.calls[0][0].detail.text).toBe('alpha two');
  });

  it('selecting with no focused index defaults to last entry', () => {
    // Defensive — if focus somehow got desynced, Enter
    // should still pick a sensible entry rather than crash.
    const h = mountHistory();
    h.addEntry('a');
    h.addEntry('b');
    h.show('');
    h._focusedIndex = -1;
    const listener = vi.fn();
    h.addEventListener('history-select', listener);
    h.handleKey(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(listener.mock.calls[0][0].detail.text).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// Render contract
// ---------------------------------------------------------------------------

describe('InputHistory rendering', () => {
  it('renders one entry per history item', async () => {
    const h = mountHistory();
    h.addEntry('one');
    h.addEntry('two');
    h.addEntry('three');
    h.show('');
    await settle(h);
    const entries = h.shadowRoot.querySelectorAll('.entry');
    expect(entries.length).toBe(3);
    expect(entries[0].textContent.trim()).toBe('one');
    expect(entries[2].textContent.trim()).toBe('three');
  });

  it('marks the focused entry with focused class', async () => {
    const h = mountHistory();
    h.addEntry('a');
    h.addEntry('b');
    h.show('');
    await settle(h);
    // Default focus: last entry.
    const entries = h.shadowRoot.querySelectorAll('.entry');
    expect(entries[1].classList.contains('focused')).toBe(true);
    expect(entries[0].classList.contains('focused')).toBe(false);
  });

  it('renders filter input with focus on open', async () => {
    const h = mountHistory();
    h.addEntry('hi');
    h.show('');
    await settle(h);
    const input = h.shadowRoot.querySelector('.filter-input');
    // Focus is async — show()'s updateComplete.then
    // has resolved by settle() time.
    expect(h.shadowRoot.activeElement).toBe(input);
  });

  it('renders hint text', async () => {
    const h = mountHistory();
    h.addEntry('hi');
    h.show('');
    await settle(h);
    const hint = h.shadowRoot.querySelector('.hint');
    expect(hint).toBeTruthy();
    expect(hint.textContent).toMatch(/navigate.*select.*cancel/i);
  });
});