// Tests for webapp/src/url-chips.js — URLChips component.
//
// Strategy:
//
//   - Mount the component directly (no chat panel shell
//     needed — it's dumb about RPC and parent state).
//   - Drive state via the public methods (updateDetected,
//     markFetching, etc.) rather than reaching into
//     _chips directly. The exception is a handful of
//     tests that verify the Map's internal shape is
//     what the chat panel's _onUrlViewRequested path
//     reads from (chip?.content).
//   - Assert on rendered DOM (chips visible, buttons
//     present, labels correct) and on dispatched events.
//   - Use double-rAF settle since Lit batches updates.

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import './url-chips.js';

const _mounted = [];

function mountChips() {
  const el = document.createElement('ac-url-chips');
  document.body.appendChild(el);
  _mounted.push(el);
  return el;
}

async function settle(el) {
  await el.updateComplete;
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
  await el.updateComplete;
}

afterEach(() => {
  while (_mounted.length) {
    const el = _mounted.pop();
    if (el.isConnected) el.remove();
  }
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('URLChips initial state', () => {
  it('starts hidden with no chips', async () => {
    const el = mountChips();
    await settle(el);
    expect(el.isEmpty).toBe(true);
    // Host element reflects the hidden attribute so the
    // parent's flex layout doesn't reserve empty gap
    // space.
    expect(el.hasAttribute('hidden')).toBe(true);
    // No strip rendered.
    expect(el.shadowRoot.querySelector('.strip')).toBeNull();
  });

  it('initial _chips Map is empty', () => {
    const el = mountChips();
    expect(el._chips).toBeInstanceOf(Map);
    expect(el._chips.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// updateDetected
// ---------------------------------------------------------------------------

describe('URLChips updateDetected', () => {
  it('adds new detected chips and becomes visible', async () => {
    const el = mountChips();
    el.updateDetected([
      { url: 'https://example.com', type: 'generic', display_name: 'example.com' },
    ]);
    await settle(el);
    expect(el.isEmpty).toBe(false);
    expect(el.hasAttribute('hidden')).toBe(false);
    const chips = el.shadowRoot.querySelectorAll('.chip.detected');
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('example.com');
  });

  it('uses url as displayName fallback when display_name absent', async () => {
    const el = mountChips();
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    await settle(el);
    expect(el._chips.get('https://a.com').displayName).toBe(
      'https://a.com',
    );
  });

  it('defaults type to generic when missing', async () => {
    const el = mountChips();
    el.updateDetected([{ url: 'https://a.com' }]);
    await settle(el);
    expect(el._chips.get('https://a.com').type).toBe('generic');
  });

  it('preserves fetched chips across updateDetected calls', async () => {
    const el = mountChips();
    el.updateDetected([
      { url: 'https://a.com', type: 'generic', display_name: 'a' },
    ]);
    el.markFetching('https://a.com');
    el.markFetched('https://a.com', { content: 'body' });
    await settle(el);
    // Now a subsequent detection pass that doesn't
    // include the URL — the fetched chip survives.
    el.updateDetected([]);
    await settle(el);
    const chip = el._chips.get('https://a.com');
    expect(chip).toBeDefined();
    expect(chip.status).toBe('fetched');
  });

  it('prunes detected chips whose URL is no longer in input', async () => {
    const el = mountChips();
    el.updateDetected([
      { url: 'https://a.com', type: 'generic' },
      { url: 'https://b.com', type: 'generic' },
    ]);
    await settle(el);
    expect(el._chips.size).toBe(2);
    // User edits — only one URL remains.
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    await settle(el);
    expect(el._chips.size).toBe(1);
    expect(el._chips.has('https://a.com')).toBe(true);
    expect(el._chips.has('https://b.com')).toBe(false);
  });

  it('does not regress a fetched chip to detected', async () => {
    // Pin: detection is idempotent when richer state
    // already exists. If the user types a URL, fetches
    // it, then keeps the URL in the input, the chip
    // stays in fetched state rather than re-appearing as
    // detected.
    const el = mountChips();
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    el.markFetching('https://a.com');
    el.markFetched('https://a.com', { content: 'body' });
    await settle(el);
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    await settle(el);
    expect(el._chips.get('https://a.com').status).toBe('fetched');
  });

  it('ignores non-array input', async () => {
    const el = mountChips();
    el.updateDetected(null);
    el.updateDetected(undefined);
    el.updateDetected('not an array');
    await settle(el);
    expect(el.isEmpty).toBe(true);
  });

  it('skips entries with non-string url', async () => {
    const el = mountChips();
    el.updateDetected([
      { type: 'generic' }, // no url
      { url: 42 }, // non-string url
      { url: 'https://valid.com', type: 'generic' },
    ]);
    await settle(el);
    expect(el._chips.size).toBe(1);
    expect(el._chips.has('https://valid.com')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

describe('URLChips state transitions', () => {
  it('markFetching flips detected → fetching', async () => {
    const el = mountChips();
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    el.markFetching('https://a.com');
    await settle(el);
    expect(el._chips.get('https://a.com').status).toBe('fetching');
    expect(el.shadowRoot.querySelector('.chip.fetching')).toBeTruthy();
    expect(el.shadowRoot.querySelector('.chip-spinner')).toBeTruthy();
  });

  it('markFetched stores content and renders fetched chip', async () => {
    const el = mountChips();
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    el.markFetching('https://a.com');
    const content = {
      title: 'Example',
      content: 'body text',
      fetched_at: '2025-01-01T00:00:00Z',
    };
    el.markFetched('https://a.com', content);
    await settle(el);
    const chip = el._chips.get('https://a.com');
    expect(chip.status).toBe('fetched');
    expect(chip.content).toEqual(content);
    expect(el.shadowRoot.querySelector('.chip.fetched')).toBeTruthy();
    expect(el.shadowRoot.querySelector('.chip-checkbox')).toBeTruthy();
  });

  it('markErrored sets error message and renders errored chip', async () => {
    const el = mountChips();
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    el.markFetching('https://a.com');
    el.markErrored('https://a.com', 'HTTP 500');
    await settle(el);
    const chip = el._chips.get('https://a.com');
    expect(chip.status).toBe('errored');
    expect(chip.error).toBe('HTTP 500');
    expect(el.shadowRoot.querySelector('.chip.errored')).toBeTruthy();
    expect(
      el.shadowRoot.querySelector('.chip-error-message').textContent,
    ).toContain('HTTP 500');
  });

  it('markErrored defaults to "Fetch failed" when no message', async () => {
    const el = mountChips();
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    el.markErrored('https://a.com', null);
    await settle(el);
    expect(el._chips.get('https://a.com').error).toBe('Fetch failed');
  });

  it('mark methods are no-ops for unknown URL', async () => {
    const el = mountChips();
    el.markFetching('https://unknown.com');
    el.markFetched('https://unknown.com', {});
    el.markErrored('https://unknown.com', 'err');
    await settle(el);
    expect(el.isEmpty).toBe(true);
  });

  it('remove drops the chip', async () => {
    const el = mountChips();
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    el.remove('https://a.com');
    await settle(el);
    expect(el.isEmpty).toBe(true);
  });

  it('remove is no-op for unknown URL', async () => {
    const el = mountChips();
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    el.remove('https://other.com');
    await settle(el);
    expect(el._chips.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// clearDetected and reset
// ---------------------------------------------------------------------------

describe('URLChips clearDetected', () => {
  it('keeps fetched chips, drops detected and fetching', async () => {
    const el = mountChips();
    el.updateDetected([
      { url: 'https://a.com', type: 'generic' },
      { url: 'https://b.com', type: 'generic' },
      { url: 'https://c.com', type: 'generic' },
    ]);
    el.markFetching('https://b.com');
    el.markFetched('https://c.com', { content: 'body' });
    await settle(el);
    expect(el._chips.size).toBe(3);
    el.clearDetected();
    await settle(el);
    // Only the fetched chip survives.
    expect(el._chips.size).toBe(1);
    expect(el._chips.has('https://c.com')).toBe(true);
  });

  it('keeps errored chips', async () => {
    const el = mountChips();
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    el.markErrored('https://a.com', 'failed');
    await settle(el);
    el.clearDetected();
    await settle(el);
    expect(el._chips.size).toBe(1);
    expect(el._chips.get('https://a.com').status).toBe('errored');
  });
});

describe('URLChips reset', () => {
  it('clears everything regardless of state', async () => {
    const el = mountChips();
    el.updateDetected([
      { url: 'https://a.com', type: 'generic' },
      { url: 'https://b.com', type: 'generic' },
    ]);
    el.markFetched('https://a.com', { content: 'body' });
    el.markErrored('https://b.com', 'err');
    await settle(el);
    el.reset();
    await settle(el);
    expect(el.isEmpty).toBe(true);
    expect(el.hasAttribute('hidden')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getActiveFetchedUrls
// ---------------------------------------------------------------------------

describe('URLChips getActiveFetchedUrls', () => {
  it('returns only non-excluded fetched URLs', async () => {
    const el = mountChips();
    el.updateDetected([
      { url: 'https://a.com', type: 'generic' },
      { url: 'https://b.com', type: 'generic' },
      { url: 'https://c.com', type: 'generic' },
      { url: 'https://d.com', type: 'generic' },
    ]);
    el.markFetched('https://a.com', { content: 'a' });
    el.markFetched('https://b.com', { content: 'b' });
    el.markErrored('https://c.com', 'err');
    // d stays detected — not fetched.
    // Exclude b.
    el._onExclusionToggle('https://b.com', true);
    await settle(el);
    const active = el.getActiveFetchedUrls();
    expect(active).toEqual(['https://a.com']);
  });

  it('returns empty array when nothing is fetched', async () => {
    const el = mountChips();
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    await settle(el);
    expect(el.getActiveFetchedUrls()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Event dispatching
// ---------------------------------------------------------------------------

describe('URLChips event dispatching', () => {
  it('detected chip fetch button dispatches url-fetch-requested', async () => {
    const el = mountChips();
    const listener = vi.fn();
    el.addEventListener('url-fetch-requested', listener);
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    await settle(el);
    const fetchBtn = el.shadowRoot.querySelector('.chip-button.primary');
    expect(fetchBtn).toBeTruthy();
    fetchBtn.click();
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail).toEqual({
      url: 'https://a.com',
    });
  });

  it('detected chip dismiss dispatches url-remove-requested', async () => {
    const el = mountChips();
    const listener = vi.fn();
    el.addEventListener('url-remove-requested', listener);
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    await settle(el);
    // The dismiss button is the second chip-button (the first
    // is the primary "Fetch" button).
    const buttons = el.shadowRoot.querySelectorAll('.chip-button');
    const dismissBtn = Array.from(buttons).find(
      (b) => b.getAttribute('aria-label')?.startsWith('Dismiss'),
    );
    expect(dismissBtn).toBeTruthy();
    dismissBtn.click();
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail).toEqual({
      url: 'https://a.com',
    });
  });

  it('fetched chip label click dispatches url-view-requested', async () => {
    const el = mountChips();
    const listener = vi.fn();
    el.addEventListener('url-view-requested', listener);
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    el.markFetched('https://a.com', { content: 'body' });
    await settle(el);
    const label = el.shadowRoot.querySelector('.chip.fetched .chip-label');
    expect(label).toBeTruthy();
    label.click();
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail).toEqual({
      url: 'https://a.com',
    });
  });

  it('fetched chip label responds to Enter and Space keys', async () => {
    const el = mountChips();
    const listener = vi.fn();
    el.addEventListener('url-view-requested', listener);
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    el.markFetched('https://a.com', { content: 'body' });
    await settle(el);
    const label = el.shadowRoot.querySelector('.chip.fetched .chip-label');
    label.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect(listener).toHaveBeenCalledTimes(1);
    label.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true }),
    );
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('fetched chip remove button dispatches url-remove-requested', async () => {
    const el = mountChips();
    const listener = vi.fn();
    el.addEventListener('url-remove-requested', listener);
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    el.markFetched('https://a.com', { content: 'body' });
    await settle(el);
    const removeBtn = el.shadowRoot.querySelector(
      '.chip.fetched .chip-button',
    );
    expect(removeBtn).toBeTruthy();
    removeBtn.click();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('errored chip dismiss dispatches url-remove-requested', async () => {
    const el = mountChips();
    const listener = vi.fn();
    el.addEventListener('url-remove-requested', listener);
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    el.markErrored('https://a.com', 'HTTP 500');
    await settle(el);
    const dismissBtn = el.shadowRoot.querySelector(
      '.chip.errored .chip-button',
    );
    dismissBtn.click();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('exclusion checkbox toggle dispatches url-exclusion-changed', async () => {
    const el = mountChips();
    const listener = vi.fn();
    el.addEventListener('url-exclusion-changed', listener);
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    el.markFetched('https://a.com', { content: 'body' });
    await settle(el);
    const checkbox = el.shadowRoot.querySelector('.chip-checkbox');
    // Default state — checked (meaning "include in context"). Click
    // to uncheck.
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail).toEqual({
      url: 'https://a.com',
      excluded: true,
    });
    // Local state updated too.
    expect(el._chips.get('https://a.com').excluded).toBe(true);
  });

  it('all dispatched events bubble and compose across shadow', async () => {
    const el = mountChips();
    const outer = vi.fn();
    document.body.addEventListener('url-fetch-requested', outer);
    document.body.addEventListener('url-remove-requested', outer);
    document.body.addEventListener('url-view-requested', outer);
    document.body.addEventListener('url-exclusion-changed', outer);
    try {
      el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
      await settle(el);
      el.shadowRoot
        .querySelector('.chip-button.primary')
        .click();
      expect(outer).toHaveBeenCalledTimes(1);
    } finally {
      document.body.removeEventListener('url-fetch-requested', outer);
      document.body.removeEventListener('url-remove-requested', outer);
      document.body.removeEventListener('url-view-requested', outer);
      document.body.removeEventListener(
        'url-exclusion-changed',
        outer,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Rendering details
// ---------------------------------------------------------------------------

describe('URLChips rendering', () => {
  it('renders type-appropriate badge icons', async () => {
    const el = mountChips();
    el.updateDetected([
      { url: 'https://github.com/a/b', type: 'github_repo' },
      { url: 'https://github.com/a/b/blob/main/f.py', type: 'github_file' },
      { url: 'https://docs.example.com', type: 'documentation' },
      { url: 'https://example.com', type: 'generic' },
    ]);
    await settle(el);
    const chips = el.shadowRoot.querySelectorAll('.chip');
    expect(chips).toHaveLength(4);
    // Check that each chip has a badge icon span — we don't pin
    // the specific emoji since they might evolve, but every chip
    // must have an icon.
    chips.forEach((chip) => {
      expect(chip.querySelector('.chip-icon')).toBeTruthy();
    });
  });

  it('unknown type falls back to generic badge', async () => {
    const el = mountChips();
    el.updateDetected([
      { url: 'https://a.com', type: 'some_future_type' },
    ]);
    await settle(el);
    const chip = el.shadowRoot.querySelector('.chip');
    expect(chip).toBeTruthy();
    // Generic badge emoji is 🔗. Not asserting on exact emoji
    // to avoid over-specification; just check it renders.
    expect(chip.querySelector('.chip-icon')).toBeTruthy();
  });

  it('excluded fetched chip applies excluded class', async () => {
    const el = mountChips();
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    el.markFetched('https://a.com', { content: 'body' });
    el._onExclusionToggle('https://a.com', true);
    await settle(el);
    const chip = el.shadowRoot.querySelector('.chip.fetched');
    expect(chip.classList.contains('excluded')).toBe(true);
  });

  it('fetched chip checkbox reflects inverse of excluded', async () => {
    const el = mountChips();
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    el.markFetched('https://a.com', { content: 'body' });
    await settle(el);
    // Default — not excluded, so checkbox is checked.
    let cb = el.shadowRoot.querySelector('.chip-checkbox');
    expect(cb.checked).toBe(true);
    el._onExclusionToggle('https://a.com', true);
    await settle(el);
    cb = el.shadowRoot.querySelector('.chip-checkbox');
    expect(cb.checked).toBe(false);
  });

  it('fetching chip has no interactive buttons', async () => {
    // Per spec — fetching is a transient state, no clicks
    // expected. Spinner visible, no fetch/dismiss buttons.
    const el = mountChips();
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    el.markFetching('https://a.com');
    await settle(el);
    const chip = el.shadowRoot.querySelector('.chip.fetching');
    const buttons = chip.querySelectorAll('.chip-button');
    expect(buttons).toHaveLength(0);
    expect(chip.querySelector('.chip-spinner')).toBeTruthy();
  });

  it('errored chip shows both error message and dismiss', async () => {
    const el = mountChips();
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    el.markErrored('https://a.com', 'HTTP 500');
    await settle(el);
    const chip = el.shadowRoot.querySelector('.chip.errored');
    expect(chip.querySelector('.chip-error-message')).toBeTruthy();
    expect(chip.querySelector('.chip-button')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// isEmpty getter
// ---------------------------------------------------------------------------

describe('URLChips isEmpty', () => {
  it('reflects Map size', async () => {
    const el = mountChips();
    expect(el.isEmpty).toBe(true);
    el.updateDetected([{ url: 'https://a.com', type: 'generic' }]);
    await settle(el);
    expect(el.isEmpty).toBe(false);
    el.remove('https://a.com');
    await settle(el);
    expect(el.isEmpty).toBe(true);
  });
});