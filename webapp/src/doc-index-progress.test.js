// Tests for DocIndexProgress overlay.
//
// Mirrors compaction-progress.test.js — fake timers for
// deterministic timing, no rAF / no settle() helper (per D15
// in IMPLEMENTATION_NOTES.md — fake timers break jsdom's rAF).

import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

import './doc-index-progress.js';

const _mounted = [];

function mountOverlay() {
  const el = document.createElement('ac-doc-index-progress');
  document.body.appendChild(el);
  _mounted.push(el);
  return el;
}

function fireProgressEvent(detail) {
  window.dispatchEvent(new CustomEvent('doc-index-progress', {
    detail,
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

describe('DocIndexProgress initial state', () => {
  it('renders nothing before any event fires', async () => {
    const el = mountOverlay();
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).toBeNull();
  });
});

describe('DocIndexProgress structural extraction stage', () => {
  it('appears on doc_index event', async () => {
    const el = mountOverlay();
    fireProgressEvent({
      stage: 'doc_index',
      message: 'Indexing 42 files',
      percent: 0,
    });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.textContent).toContain('Indexing 42 files');
  });

  it('shows spinner during active state', async () => {
    const el = mountOverlay();
    fireProgressEvent({ stage: 'doc_index', message: 'go', percent: 0 });
    await el.updateComplete;
    const spinner = el.shadowRoot.querySelector('.spinner');
    expect(spinner).not.toBeNull();
  });

  it('hides percent digit when percent is 0', async () => {
    const el = mountOverlay();
    fireProgressEvent({ stage: 'doc_index', message: 'x', percent: 0 });
    await el.updateComplete;
    const pct = el.shadowRoot.querySelector('.percent');
    expect(pct).toBeNull();
  });

  it('hides bar when percent is 0', async () => {
    const el = mountOverlay();
    fireProgressEvent({ stage: 'doc_index', message: 'x', percent: 0 });
    await el.updateComplete;
    const bar = el.shadowRoot.querySelector('.bar');
    expect(bar).toBeNull();
  });

  it('falls back to default label when message missing', async () => {
    const el = mountOverlay();
    fireProgressEvent({ stage: 'doc_index', percent: 0 });
    await el.updateComplete;
    const label = el.shadowRoot.querySelector('.label');
    expect(label.textContent).toContain('Indexing documentation');
  });
});

describe('DocIndexProgress enrichment stages', () => {
  it('queued event enters active state', async () => {
    const el = mountOverlay();
    fireProgressEvent({
      stage: 'doc_enrichment_queued',
      message: 'Enriching 10 documents',
      percent: 0,
    });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.textContent).toContain('Enriching 10 documents');
  });

  it('file_done events update percent and label', async () => {
    const el = mountOverlay();
    fireProgressEvent({
      stage: 'doc_enrichment_file_done',
      message: 'Enriched foo.md',
      percent: 33,
    });
    await el.updateComplete;
    const pct = el.shadowRoot.querySelector('.percent');
    expect(pct).not.toBeNull();
    expect(pct.textContent).toContain('33%');
    const label = el.shadowRoot.querySelector('.label');
    expect(label.textContent).toContain('Enriched foo.md');
  });

  it('bar fill width tracks percent', async () => {
    const el = mountOverlay();
    fireProgressEvent({
      stage: 'doc_enrichment_file_done',
      message: 'x',
      percent: 60,
    });
    await el.updateComplete;
    const fill = el.shadowRoot.querySelector('.bar-fill');
    expect(fill).not.toBeNull();
    expect(fill.style.width).toBe('60%');
  });

  it('percent clamps to [0, 100]', async () => {
    const el = mountOverlay();
    fireProgressEvent({
      stage: 'doc_enrichment_file_done',
      message: 'x',
      percent: 150,
    });
    await el.updateComplete;
    expect(el._percent).toBe(100);

    fireProgressEvent({
      stage: 'doc_enrichment_file_done',
      message: 'y',
      percent: -10,
    });
    await el.updateComplete;
    expect(el._percent).toBe(0);
  });

  it('complete event transitions to success state', async () => {
    const el = mountOverlay();
    fireProgressEvent({
      stage: 'doc_enrichment_complete',
      message: 'All done',
      percent: 100,
    });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay.classList.contains('success')).toBe(true);
    expect(overlay.textContent).toContain('All done');
  });

  it('complete uses default caption when message missing', async () => {
    const el = mountOverlay();
    fireProgressEvent({ stage: 'doc_enrichment_complete' });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay.textContent).toContain('Doc index ready');
  });

  it('shows checkmark glyph in success state', async () => {
    const el = mountOverlay();
    fireProgressEvent({ stage: 'doc_enrichment_complete' });
    await el.updateComplete;
    const glyph = el.shadowRoot.querySelector('.glyph');
    expect(glyph).not.toBeNull();
    expect(glyph.textContent.trim()).toBe('✓');
  });

  it('hides spinner in success state', async () => {
    const el = mountOverlay();
    fireProgressEvent({ stage: 'doc_enrichment_complete' });
    await el.updateComplete;
    const spinner = el.shadowRoot.querySelector('.spinner');
    expect(spinner).toBeNull();
  });

  it('hides bar in success state', async () => {
    const el = mountOverlay();
    fireProgressEvent({ stage: 'doc_enrichment_complete' });
    await el.updateComplete;
    const bar = el.shadowRoot.querySelector('.bar');
    expect(bar).toBeNull();
  });
});

describe('DocIndexProgress error stage', () => {
  it('shows error caption from message', async () => {
    const el = mountOverlay();
    fireProgressEvent({
      stage: 'doc_index_error',
      message: 'Parse failed: bad markdown',
    });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay.classList.contains('error')).toBe(true);
    expect(overlay.textContent).toContain('Parse failed: bad markdown');
  });

  it('uses default caption when message missing', async () => {
    const el = mountOverlay();
    fireProgressEvent({ stage: 'doc_index_error' });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay.textContent).toContain('Doc index failed');
  });

  it('shows warning glyph in error state', async () => {
    const el = mountOverlay();
    fireProgressEvent({ stage: 'doc_index_error', message: 'x' });
    await el.updateComplete;
    const glyph = el.shadowRoot.querySelector('.glyph');
    expect(glyph.textContent.trim()).toBe('⚠');
  });
});

describe('DocIndexProgress exit timing', () => {
  it('success fades after 800ms display', async () => {
    const el = mountOverlay();
    fireProgressEvent({ stage: 'doc_enrichment_complete' });
    await el.updateComplete;
    let overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay.classList.contains('fading')).toBe(false);

    vi.advanceTimersByTime(800);
    await el.updateComplete;
    overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay.classList.contains('fading')).toBe(true);
  });

  it('success hides after 800ms + 400ms fade', async () => {
    const el = mountOverlay();
    fireProgressEvent({ stage: 'doc_enrichment_complete' });
    await el.updateComplete;

    vi.advanceTimersByTime(1200);
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).toBeNull();
  });

  it('error stays visible for 5 seconds', async () => {
    const el = mountOverlay();
    fireProgressEvent({ stage: 'doc_index_error', message: 'x' });
    await el.updateComplete;

    vi.advanceTimersByTime(4999);
    await el.updateComplete;
    let overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.classList.contains('fading')).toBe(false);

    vi.advanceTimersByTime(1);
    await el.updateComplete;
    overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay.classList.contains('fading')).toBe(true);
  });

  it('error hides after 5s + 400ms fade', async () => {
    const el = mountOverlay();
    fireProgressEvent({ stage: 'doc_index_error', message: 'x' });
    await el.updateComplete;

    vi.advanceTimersByTime(5400);
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).toBeNull();
  });
});

describe('DocIndexProgress event filtering', () => {
  it('ignores compaction events', async () => {
    const el = mountOverlay();
    // Fire a compaction-style event on the doc-index channel —
    // should be ignored because the stage isn't in our set.
    fireProgressEvent({ stage: 'compacting' });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).toBeNull();
  });

  it('ignores url_fetch events', async () => {
    const el = mountOverlay();
    fireProgressEvent({ stage: 'url_fetch', url: 'example.com' });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).toBeNull();
  });

  it('ignores events with no stage', async () => {
    const el = mountOverlay();
    fireProgressEvent({ message: 'something' });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).toBeNull();
  });

  it('ignores null detail', async () => {
    const el = mountOverlay();
    window.dispatchEvent(
      new CustomEvent('doc-index-progress', { detail: null }),
    );
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).toBeNull();
  });

  it('tolerates non-numeric percent', async () => {
    const el = mountOverlay();
    fireProgressEvent({
      stage: 'doc_enrichment_file_done',
      message: 'x',
      percent: 'bogus',
    });
    await el.updateComplete;
    // Falls back to 0 → no bar, no digit.
    expect(el._percent).toBe(0);
    const bar = el.shadowRoot.querySelector('.bar');
    expect(bar).toBeNull();
  });
});

describe('DocIndexProgress state sequencing', () => {
  it('structural → enrichment → complete lifecycle', async () => {
    const el = mountOverlay();

    // Phase 1: structural extraction.
    fireProgressEvent({
      stage: 'doc_index',
      message: 'Indexing 50 files',
      percent: 0,
    });
    await el.updateComplete;
    expect(el._state).toBe('active');
    let label = el.shadowRoot.querySelector('.label');
    expect(label.textContent).toContain('Indexing 50 files');

    // Phase 2: enrichment begins.
    fireProgressEvent({
      stage: 'doc_enrichment_queued',
      message: 'Enriching 50 documents',
      percent: 0,
    });
    await el.updateComplete;
    label = el.shadowRoot.querySelector('.label');
    expect(label.textContent).toContain('Enriching');

    // Phase 3: per-file progress.
    fireProgressEvent({
      stage: 'doc_enrichment_file_done',
      message: 'Enriched a.md',
      percent: 25,
    });
    await el.updateComplete;
    const pct = el.shadowRoot.querySelector('.percent');
    expect(pct.textContent).toContain('25%');

    // Phase 4: completion.
    fireProgressEvent({ stage: 'doc_enrichment_complete' });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay.classList.contains('success')).toBe(true);

    // Phase 5: fade-out clears the overlay.
    vi.advanceTimersByTime(1200);
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.overlay')).toBeNull();
  });

  it('new event during fade restarts active state', async () => {
    const el = mountOverlay();
    fireProgressEvent({ stage: 'doc_enrichment_complete' });
    await el.updateComplete;
    vi.advanceTimersByTime(800);
    await el.updateComplete;
    expect(el._fading).toBe(true);

    // A new doc_index event (unusual but possible if the user
    // triggers a rebuild) interrupts the fade.
    fireProgressEvent({
      stage: 'doc_index',
      message: 'Reindexing',
      percent: 0,
    });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.classList.contains('fading')).toBe(false);
    expect(overlay.classList.contains('success')).toBe(false);
    expect(overlay.textContent).toContain('Reindexing');
  });

  it('error during enrichment transitions cleanly', async () => {
    const el = mountOverlay();
    fireProgressEvent({
      stage: 'doc_enrichment_file_done',
      message: 'Enriched foo.md',
      percent: 42,
    });
    await el.updateComplete;
    expect(el._state).toBe('active');

    fireProgressEvent({
      stage: 'doc_index_error',
      message: 'Model crashed',
    });
    await el.updateComplete;
    const overlay = el.shadowRoot.querySelector('.overlay');
    expect(overlay.classList.contains('error')).toBe(true);
    expect(overlay.textContent).toContain('Model crashed');
  });
});

describe('DocIndexProgress cleanup', () => {
  it('removes event listener on disconnect', async () => {
    const el = mountOverlay();
    fireProgressEvent({ stage: 'doc_index', message: 'x', percent: 0 });
    await el.updateComplete;
    expect(el._state).toBe('active');

    el.parentNode.removeChild(el);
    _mounted.length = 0;

    // After disconnect, further events don't change state.
    fireProgressEvent({ stage: 'doc_enrichment_complete' });
    expect(el._state).toBe('active');
  });

  it('clears exit timer on disconnect', async () => {
    const el = mountOverlay();
    fireProgressEvent({ stage: 'doc_enrichment_complete' });
    await el.updateComplete;
    expect(el._state).toBe('success');

    el.parentNode.removeChild(el);
    _mounted.length = 0;

    // Advance through the fade chain — no state transition
    // because timers are cleared.
    vi.advanceTimersByTime(1200);
    expect(el._state).toBe('success');
  });
});