// Tests for in-message search: rendering, query/counter,
// highlight, navigation, keyboard, toggles, persistence,
// scroll behaviour, plus the suppressNextPaste flag used
// by the middle-click flow.

import { describe, expect, it, vi } from 'vitest';

import {
  _SEARCH_IGNORE_CASE_KEY,
  _SEARCH_REGEX_KEY,
  _SEARCH_WHOLE_WORD_KEY,
  _saveSearchToggle,
} from '../chat-panel/index.js';
import {
  mountPanel,
  publishFakeRpc,
  settle,
} from './test-helpers.js';

// ---------------------------------------------------------------------------
// Search bar rendering
// ---------------------------------------------------------------------------

describe('ChatPanel message search — rendering', () => {
  it('renders search input in the action bar', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    expect(input).toBeTruthy();
    expect(input.placeholder).toMatch(/search/i);
  });

  it('renders three toggle buttons (Aa, .*, ab)', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const toggles = p.shadowRoot.querySelectorAll(
      '.search-toggle',
    );
    expect(toggles).toHaveLength(3);
    const labels = Array.from(toggles).map((t) =>
      t.textContent.trim(),
    );
    expect(labels).toEqual(['Aa', '.*', 'ab']);
  });

  it('renders nav buttons (prev / next)', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const navs = p.shadowRoot.querySelectorAll(
      '.search-nav-button',
    );
    expect(navs).toHaveLength(2);
  });

  it('nav buttons disabled when no query', async () => {
    publishFakeRpc({});
    const p = mountPanel({
      messages: [{ role: 'user', content: 'hi' }],
    });
    await settle(p);
    const navs = p.shadowRoot.querySelectorAll(
      '.search-nav-button',
    );
    expect(navs[0].disabled).toBe(true);
    expect(navs[1].disabled).toBe(true);
  });

  it('counter is hidden when no query', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const counter = p.shadowRoot.querySelector('.search-counter');
    expect(counter.textContent.trim()).toBe('');
  });

  it('renders data-msg-index on each message card', async () => {
    // Load-bearing for highlight targeting — the scroll
    // logic queries by attribute.
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'one' },
        { role: 'assistant', content: 'two' },
        { role: 'user', content: 'three' },
      ],
    });
    await settle(p);
    const cards = p.shadowRoot.querySelectorAll('.message-card');
    expect(cards).toHaveLength(3);
    expect(cards[0].getAttribute('data-msg-index')).toBe('0');
    expect(cards[1].getAttribute('data-msg-index')).toBe('1');
    expect(cards[2].getAttribute('data-msg-index')).toBe('2');
  });
});

// ---------------------------------------------------------------------------
// Query and counter
// ---------------------------------------------------------------------------

describe('ChatPanel message search — query and counter', () => {
  it('typing updates the counter', async () => {
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'find this text' },
        { role: 'assistant', content: 'not a match' },
        { role: 'user', content: 'find that too' },
      ],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'find';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    const counter = p.shadowRoot.querySelector('.search-counter');
    expect(counter.textContent.trim()).toBe('1/2');
  });

  it('counter shows 0/0 when no matches', async () => {
    const p = mountPanel({
      messages: [{ role: 'user', content: 'hello' }],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'nope';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    const counter = p.shadowRoot.querySelector('.search-counter');
    expect(counter.textContent.trim()).toBe('0/0');
    expect(counter.classList.contains('no-match')).toBe(true);
  });

  it('empty query returns nav buttons to disabled', async () => {
    const p = mountPanel({
      messages: [{ role: 'user', content: 'hello' }],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'hello';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    let navs = p.shadowRoot.querySelectorAll('.search-nav-button');
    expect(navs[0].disabled).toBe(false);
    input.value = '';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    navs = p.shadowRoot.querySelectorAll('.search-nav-button');
    expect(navs[0].disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Highlight
// ---------------------------------------------------------------------------

describe('ChatPanel message search — highlight', () => {
  it('highlights the first match when query is entered', async () => {
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'apple' },
        { role: 'assistant', content: 'banana' },
        { role: 'user', content: 'apple again' },
      ],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'apple';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    const cards = p.shadowRoot.querySelectorAll('.message-card');
    expect(cards[0].classList.contains('search-highlight')).toBe(true);
    expect(cards[1].classList.contains('search-highlight')).toBe(false);
    expect(cards[2].classList.contains('search-highlight')).toBe(false);
  });

  it('no highlight when query has no matches', async () => {
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'world' },
      ],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'nope';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    const highlights = p.shadowRoot.querySelectorAll(
      '.message-card.search-highlight',
    );
    expect(highlights).toHaveLength(0);
  });

  it('no highlight on empty query', async () => {
    const p = mountPanel({
      messages: [{ role: 'user', content: 'hello' }],
    });
    await settle(p);
    const highlights = p.shadowRoot.querySelectorAll(
      '.message-card.search-highlight',
    );
    expect(highlights).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe('ChatPanel message search — navigation', () => {
  async function setup() {
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'target' },
        { role: 'assistant', content: 'not me' },
        { role: 'user', content: 'target two' },
        { role: 'assistant', content: 'filler' },
        { role: 'user', content: 'target three' },
      ],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'target';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    return p;
  }

  it('next button advances current match', async () => {
    const p = await setup();
    let cards = p.shadowRoot.querySelectorAll('.message-card');
    expect(cards[0].classList.contains('search-highlight')).toBe(true);
    const navs = p.shadowRoot.querySelectorAll(
      '.search-nav-button',
    );
    navs[1].click();
    await settle(p);
    cards = p.shadowRoot.querySelectorAll('.message-card');
    expect(cards[0].classList.contains('search-highlight')).toBe(false);
    expect(cards[2].classList.contains('search-highlight')).toBe(true);
  });

  it('prev button goes backward', async () => {
    const p = await setup();
    const navs = p.shadowRoot.querySelectorAll(
      '.search-nav-button',
    );
    navs[1].click();
    navs[1].click();
    await settle(p);
    let cards = p.shadowRoot.querySelectorAll('.message-card');
    expect(cards[4].classList.contains('search-highlight')).toBe(true);
    navs[0].click();
    await settle(p);
    cards = p.shadowRoot.querySelectorAll('.message-card');
    expect(cards[4].classList.contains('search-highlight')).toBe(false);
    expect(cards[2].classList.contains('search-highlight')).toBe(true);
  });

  it('next wraps at the end', async () => {
    const p = await setup();
    const navs = p.shadowRoot.querySelectorAll(
      '.search-nav-button',
    );
    navs[1].click();
    navs[1].click();
    navs[1].click();
    await settle(p);
    const cards = p.shadowRoot.querySelectorAll('.message-card');
    expect(cards[0].classList.contains('search-highlight')).toBe(true);
  });

  it('prev wraps at the start', async () => {
    const p = await setup();
    const navs = p.shadowRoot.querySelectorAll(
      '.search-nav-button',
    );
    navs[0].click();
    await settle(p);
    const cards = p.shadowRoot.querySelectorAll('.message-card');
    expect(cards[4].classList.contains('search-highlight')).toBe(true);
  });

  it('counter tracks navigation position', async () => {
    const p = await setup();
    const counter = p.shadowRoot.querySelector('.search-counter');
    expect(counter.textContent.trim()).toBe('1/3');
    const navs = p.shadowRoot.querySelectorAll(
      '.search-nav-button',
    );
    navs[1].click();
    await settle(p);
    expect(counter.textContent.trim()).toBe('2/3');
    navs[1].click();
    await settle(p);
    expect(counter.textContent.trim()).toBe('3/3');
  });
});

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

describe('ChatPanel message search — keyboard', () => {
  it('Enter in search input advances to next match', async () => {
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'target' },
        { role: 'user', content: 'target' },
      ],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'target';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
      }),
    );
    await settle(p);
    const cards = p.shadowRoot.querySelectorAll('.message-card');
    expect(cards[1].classList.contains('search-highlight')).toBe(true);
  });

  it('Shift+Enter goes to previous match', async () => {
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'target' },
        { role: 'user', content: 'target' },
      ],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'target';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
        bubbles: true,
      }),
    );
    await settle(p);
    const cards = p.shadowRoot.querySelectorAll('.message-card');
    expect(cards[1].classList.contains('search-highlight')).toBe(true);
  });

  it('Enter does not send a chat message', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel({
      messages: [{ role: 'user', content: 'target' }],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'target';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
      }),
    );
    await settle(p);
    expect(started).not.toHaveBeenCalled();
  });

  it('Escape clears the query', async () => {
    const p = mountPanel({
      messages: [{ role: 'user', content: 'x' }],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'x';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    expect(p._searchQuery).toBe('x');
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      }),
    );
    await settle(p);
    expect(p._searchQuery).toBe('');
  });

  it('Escape blurs the input', async () => {
    const p = mountPanel({
      messages: [{ role: 'user', content: 'x' }],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.focus();
    expect(p.shadowRoot.activeElement).toBe(input);
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      }),
    );
    await settle(p);
    expect(p.shadowRoot.activeElement).not.toBe(input);
  });
});

// ---------------------------------------------------------------------------
// Toggles
// ---------------------------------------------------------------------------

describe('ChatPanel message search — toggles', () => {
  it('ignore-case toggle flips search sensitivity', async () => {
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'Apple' },
        { role: 'user', content: 'apple' },
      ],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'apple';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    let counter = p.shadowRoot.querySelector('.search-counter');
    expect(counter.textContent.trim()).toBe('1/2');
    const toggles = p.shadowRoot.querySelectorAll(
      '.search-toggle',
    );
    toggles[0].click();
    await settle(p);
    counter = p.shadowRoot.querySelector('.search-counter');
    expect(counter.textContent.trim()).toBe('1/1');
  });

  it('regex toggle enables pattern matching', async () => {
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'order 123' },
        { role: 'user', content: 'order 456' },
        { role: 'user', content: 'plain text' },
      ],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = '\\d+';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    let counter = p.shadowRoot.querySelector('.search-counter');
    expect(counter.textContent.trim()).toBe('0/0');
    const toggles = p.shadowRoot.querySelectorAll(
      '.search-toggle',
    );
    toggles[1].click();
    await settle(p);
    counter = p.shadowRoot.querySelector('.search-counter');
    expect(counter.textContent.trim()).toBe('1/2');
  });

  it('whole-word toggle excludes substring matches', async () => {
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'the cat sat' },
        { role: 'user', content: 'catalog here' },
      ],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'cat';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    let counter = p.shadowRoot.querySelector('.search-counter');
    expect(counter.textContent.trim()).toBe('1/2');
    const toggles = p.shadowRoot.querySelectorAll(
      '.search-toggle',
    );
    toggles[2].click();
    await settle(p);
    counter = p.shadowRoot.querySelector('.search-counter');
    expect(counter.textContent.trim()).toBe('1/1');
  });

  it('toggle state shown as active class when on', async () => {
    const p = mountPanel();
    await settle(p);
    const toggles = p.shadowRoot.querySelectorAll(
      '.search-toggle',
    );
    expect(toggles[0].classList.contains('active')).toBe(true);
    expect(toggles[1].classList.contains('active')).toBe(false);
    expect(toggles[2].classList.contains('active')).toBe(false);
    toggles[1].click();
    await settle(p);
    expect(toggles[1].classList.contains('active')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe('ChatPanel message search — persistence', () => {
  it('loads toggle state from localStorage', async () => {
    _saveSearchToggle(_SEARCH_IGNORE_CASE_KEY, false);
    _saveSearchToggle(_SEARCH_REGEX_KEY, true);
    _saveSearchToggle(_SEARCH_WHOLE_WORD_KEY, true);
    const p = mountPanel();
    await settle(p);
    expect(p._searchIgnoreCase).toBe(false);
    expect(p._searchRegex).toBe(true);
    expect(p._searchWholeWord).toBe(true);
  });

  it('saves toggle state on change', async () => {
    const p = mountPanel();
    await settle(p);
    const toggles = p.shadowRoot.querySelectorAll(
      '.search-toggle',
    );
    toggles[1].click();
    await settle(p);
    // Read directly via key to avoid coupling to a load helper.
    expect(localStorage.getItem(_SEARCH_REGEX_KEY)).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// Multimodal content
// ---------------------------------------------------------------------------

describe('ChatPanel message search — multimodal content', () => {
  it('searches text blocks of multimodal messages', async () => {
    const p = mountPanel({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'see this screenshot' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,X' },
            },
          ],
        },
      ],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'screenshot';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    const cards = p.shadowRoot.querySelectorAll('.message-card');
    expect(cards[0].classList.contains('search-highlight')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scroll behaviour
// ---------------------------------------------------------------------------

describe('ChatPanel message search — scroll behaviour', () => {
  it('calls scrollIntoView when current match changes', async () => {
    // Element.scrollIntoView is a no-op in jsdom, so spy
    // on the prototype to verify the call.
    const spy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    try {
      const p = mountPanel({
        messages: [
          { role: 'user', content: 'target' },
          { role: 'assistant', content: 'x' },
          { role: 'user', content: 'target' },
        ],
      });
      await settle(p);
      const input = p.shadowRoot.querySelector('.search-input');
      input.value = 'target';
      input.dispatchEvent(new Event('input'));
      await settle(p);
      await new Promise((r) => setTimeout(r, 20));
      expect(spy).toHaveBeenCalled();
      const args = spy.mock.calls[0][0];
      expect(args.block).toBe('center');
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('does not crash when match index is out of range', async () => {
    const p = mountPanel({
      messages: [{ role: 'user', content: 'target' }],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'target';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    p._searchCurrentIndex = 999;
    expect(() => p._scrollToCurrentMatch()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Paste suppression (used by middle-click flow)
// ---------------------------------------------------------------------------

describe('ChatPanel paste suppression', () => {
  function pasteEvent(items = []) {
    const ev = new Event('paste', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(ev, 'clipboardData', {
      value: { items },
      writable: false,
    });
    return ev;
  }

  it('_suppressNextPaste defaults to false', async () => {
    const p = mountPanel();
    await settle(p);
    expect(p._suppressNextPaste).toBe(false);
  });

  it('swallows the next paste when flag is set', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._suppressNextPaste = true;
    const ta = p.shadowRoot.querySelector('.input-textarea');
    const ev = pasteEvent([
      { kind: 'string', type: 'text/plain' },
    ]);
    const preventSpy = vi.spyOn(ev, 'preventDefault');
    ta.dispatchEvent(ev);
    await settle(p);
    expect(preventSpy).toHaveBeenCalled();
  });

  it('clears the flag after one paste', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._suppressNextPaste = true;
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.dispatchEvent(pasteEvent());
    await settle(p);
    expect(p._suppressNextPaste).toBe(false);
  });

  it('subsequent paste is not suppressed', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._suppressNextPaste = true;
    const ta = p.shadowRoot.querySelector('.input-textarea');
    const ev1 = pasteEvent([
      { kind: 'string', type: 'text/plain' },
    ]);
    const prevent1 = vi.spyOn(ev1, 'preventDefault');
    ta.dispatchEvent(ev1);
    await settle(p);
    expect(prevent1).toHaveBeenCalled();
    const ev2 = pasteEvent([
      { kind: 'string', type: 'text/plain' },
    ]);
    const prevent2 = vi.spyOn(ev2, 'preventDefault');
    ta.dispatchEvent(ev2);
    await settle(p);
    expect(prevent2).not.toHaveBeenCalled();
  });

  it('flag does not prevent text paste when not set', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    expect(p._suppressNextPaste).toBe(false);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    const ev = pasteEvent([
      { kind: 'string', type: 'text/plain' },
    ]);
    const preventSpy = vi.spyOn(ev, 'preventDefault');
    ta.dispatchEvent(ev);
    await settle(p);
    expect(preventSpy).not.toHaveBeenCalled();
  });

  it('flag is not a reactive property (no re-render on flip)', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const updateSpy = vi.spyOn(p, 'requestUpdate');
    p._suppressNextPaste = true;
    p._suppressNextPaste = false;
    p._suppressNextPaste = true;
    expect(updateSpy).not.toHaveBeenCalled();
  });
});