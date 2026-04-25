// Tests for CompactionProgress overlay.
//
// Uses vitest fake timers to drive the elapsed-seconds counter
// and the exit-chain timing deterministically. Per D15 in
// IMPLEMENTATION_NOTES.md, fake timers leave jsdom's rAF in a
// broken state for subsequent tests — this file stays all
// fake-timer, no rAF / no `settle()` helper, so the D15
// workaround isn't needed here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import './compaction-progress.js';

const _mounted = [];

function mountOverlay() {
  const el = document.createElement('ac-compaction-progress');
  document.body.appendChild(el);
  _mounted.push(el);
  return el;
}

function fireCompactionEvent(payload) {
  window.dispatchEvent(new CustomEvent('compaction-event', {
    detail: { requestId: 'r1', event: payload },
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  while (_mounted.length) {
    const el = _mounted.pop();
    if (el.parentNode) el.parentNode.removeChild(el);
  }
});

describe('CompactionProgress initial state', () => {
  it('renders nothing when no event has fired', async () => {
    const el = mountOverlay();
    await el.updateComplete;
    // Shadow root exists but the render method returns an
    // empty template when _state is 'hidden'.
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).toBeNull();
  });
});

describe('CompactionProgress active state', () => {
  it('appears on compacting event', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ stage: 'compacting' });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.textContent).toContain('Compacting history');
  });

  it('shows spinner during active state', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ stage: 'compacting' });
    await el.updateComplete;
    const spinner = el.shadowRoot.querySelector('.spinner');
    expect(spinner).not.toBeNull();
  });

  it('does not show elapsed seconds before first tick', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ stage: 'compacting' });
    await el.updateComplete;
    const elapsed = el.shadowRoot.querySelector('.elapsed');
    // Elapsed starts at 0 which suppresses rendering — first
    // tick at +1000ms makes it appear.
    expect(elapsed).toBeNull();
  });

  it('elapsed counter ticks once per second', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ stage: 'compacting' });
    await el.updateComplete;

    vi.advanceTimersByTime(1000);
    await el.updateComplete;
    let elapsed = el.shadowRoot.querySelector('.elapsed');
    expect(elapsed).not.toBeNull();
    expect(elapsed.textContent.trim()).toBe('1s');

    vi.advanceTimersByTime(1000);
    await el.updateComplete;
    elapsed = el.shadowRoot.querySelector('.elapsed');
    expect(elapsed.textContent.trim()).toBe('2s');

    vi.advanceTimersByTime(3000);
    await el.updateComplete;
    elapsed = el.shadowRoot.querySelector('.elapsed');
    expect(elapsed.textContent.trim()).toBe('5s');
  });

  it('ignores url_fetch events', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ stage: 'url_fetch', url: 'example.com' });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).toBeNull();
  });

  it('ignores url_ready events', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ stage: 'url_ready', url: 'example.com' });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).toBeNull();
  });

  it('ignores events with no stage field', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ url: 'example.com' });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).toBeNull();
  });

  it('ignores malformed detail', async () => {
    const el = mountOverlay();
    window.dispatchEvent(
      new CustomEvent('compaction-event', { detail: null }),
    );
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).toBeNull();
  });
});

describe('CompactionProgress success transition', () => {
  it('shows success caption with case label', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ stage: 'compacting' });
    await el.updateComplete;
    fireCompactionEvent({
      stage: 'compacted',
      case: 'summarize',
      messages: [],
    });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.classList.contains('success')).toBe(true);
    expect(overlay.textContent).toContain('Done');
    expect(overlay.textContent).toContain('summarised');
  });

  it('uses truncate label for truncate case', async () => {
    const el = mountOverlay();
    fireCompactionEvent({
      stage: 'compacted',
      case: 'truncate',
      messages: [],
    });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay.textContent).toContain('truncated at topic boundary');
  });

  it('falls back to generic label for unknown case', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ stage: 'compacted', case: 'unknown', messages: [] });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay.textContent).toContain('Done — complete');
  });

  it('shows checkmark glyph in success state', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ stage: 'compacted', case: 'truncate', messages: [] });
    await el.updateComplete;
    const glyph = el.shadowRoot.querySelector('.glyph');
    expect(glyph).not.toBeNull();
    expect(glyph.textContent.trim()).toBe('✓');
  });

  it('hides spinner in success state', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ stage: 'compacted', case: 'truncate', messages: [] });
    await el.updateComplete;
    const spinner = el.shadowRoot.querySelector('.spinner');
    expect(spinner).toBeNull();
  });

  it('begins fade after success display period', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ stage: 'compacted', case: 'truncate', messages: [] });
    await el.updateComplete;
    let overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay.classList.contains('fading')).toBe(false);

    // Success state displays for 800ms before fade starts.
    vi.advanceTimersByTime(800);
    await el.updateComplete;
    overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay.classList.contains('fading')).toBe(true);
  });

  it('hides after fade completes', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ stage: 'compacted', case: 'truncate', messages: [] });
    await el.updateComplete;

    // 800ms display + 400ms fade = 1200ms total.
    vi.advanceTimersByTime(1200);
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).toBeNull();
  });

  it('clears active tick when transitioning to success', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ stage: 'compacting' });
    await el.updateComplete;

    // Tick twice while active.
    vi.advanceTimersByTime(2000);
    await el.updateComplete;
    expect(el._elapsed).toBe(2);

    // Transition to success — tick interval cleared.
    fireCompactionEvent({ stage: 'compacted', case: 'truncate', messages: [] });
    await el.updateComplete;

    // Advance another full second — elapsed shouldn't tick.
    vi.advanceTimersByTime(1000);
    await el.updateComplete;
    expect(el._elapsed).toBe(2);
  });
});

describe('CompactionProgress error transition', () => {
  it('shows error caption with reason', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ stage: 'compacting' });
    await el.updateComplete;
    fireCompactionEvent({
      stage: 'compaction_error',
      error: 'LLM timeout',
    });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.classList.contains('error')).toBe(true);
    expect(overlay.textContent).toContain('Compaction failed');
    expect(overlay.textContent).toContain('LLM timeout');
  });

  it('falls back to unknown error when reason missing', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ stage: 'compaction_error' });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay.textContent).toContain('unknown error');
  });

  it('shows warning glyph in error state', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ stage: 'compaction_error', error: 'x' });
    await el.updateComplete;
    const glyph = el.shadowRoot.querySelector('.glyph');
    expect(glyph).not.toBeNull();
    expect(glyph.textContent.trim()).toBe('⚠');
  });

  it('displays error for longer than success', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ stage: 'compaction_error', error: 'x' });
    await el.updateComplete;

    // Error stays visible for 3000ms before fading.
    vi.advanceTimersByTime(2999);
    await el.updateComplete;
    let overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.classList.contains('fading')).toBe(false);

    vi.advanceTimersByTime(1);
    await el.updateComplete;
    overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay.classList.contains('fading')).toBe(true);
  });

  it('hides after error display + fade', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ stage: 'compaction_error', error: 'x' });
    await el.updateComplete;

    // 3000ms display + 400ms fade = 3400ms total.
    vi.advanceTimersByTime(3400);
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).toBeNull();
  });
});

describe('CompactionProgress state sequencing', () => {
  it('handles back-to-back compactions', async () => {
    const el = mountOverlay();

    // First compaction: compacting → compacted → hidden.
    fireCompactionEvent({ stage: 'compacting' });
    await el.updateComplete;
    fireCompactionEvent({ stage: 'compacted', case: 'truncate', messages: [] });
    await el.updateComplete;
    vi.advanceTimersByTime(1200);
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.overlay')).toBeNull();

    // Second compaction immediately after: overlay must
    // reappear, not stay hidden from the prior fade.
    fireCompactionEvent({ stage: 'compacting' });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.textContent).toContain('Compacting');
  });

  it('new compacting event during fade-out restarts immediately', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ stage: 'compacted', case: 'truncate', messages: [] });
    await el.updateComplete;
    // Enter fade.
    vi.advanceTimersByTime(800);
    await el.updateComplete;
    expect(el._fading).toBe(true);

    // New compacting event interrupts the fade.
    fireCompactionEvent({ stage: 'compacting' });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.classList.contains('fading')).toBe(false);
    expect(overlay.textContent).toContain('Compacting');
  });

  it('error during active state transitions cleanly', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ stage: 'compacting' });
    await el.updateComplete;
    vi.advanceTimersByTime(5000);
    await el.updateComplete;
    expect(el._elapsed).toBe(5);

    fireCompactionEvent({ stage: 'compaction_error', error: 'oops' });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay.classList.contains('error')).toBe(true);
    expect(overlay.textContent).toContain('oops');
    // Active tick cleared.
    vi.advanceTimersByTime(1000);
    await el.updateComplete;
    expect(el._elapsed).toBe(5);
  });
});

describe('CompactionProgress cleanup', () => {
  it('removes event listener on disconnect', async () => {
    const el = mountOverlay();
    // Drive into active state.
    fireCompactionEvent({ stage: 'compacting' });
    await el.updateComplete;
    expect(el._state).toBe('active');

    el.parentNode.removeChild(el);
    _mounted.length = 0;  // prevent afterEach double-remove

    // Events fired after disconnect must not affect state.
    fireCompactionEvent({ stage: 'compacted', case: 'truncate', messages: [] });
    expect(el._state).toBe('active');
  });

  it('clears tick interval on disconnect', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ stage: 'compacting' });
    await el.updateComplete;

    el.parentNode.removeChild(el);
    _mounted.length = 0;

    // Advancing time after disconnect shouldn't trigger the
    // elapsed increment (the interval is cleared).
    const before = el._elapsed;
    vi.advanceTimersByTime(5000);
    expect(el._elapsed).toBe(before);
  });

  it('clears exit timer on disconnect', async () => {
    const el = mountOverlay();
    fireCompactionEvent({ stage: 'compacted', case: 'truncate', messages: [] });
    await el.updateComplete;
    expect(el._state).toBe('success');

    el.parentNode.removeChild(el);
    _mounted.length = 0;

    // Advance through the full exit chain. State shouldn't
    // transition because the timeouts are cleared.
    vi.advanceTimersByTime(1200);
    expect(el._state).toBe('success');
  });
});