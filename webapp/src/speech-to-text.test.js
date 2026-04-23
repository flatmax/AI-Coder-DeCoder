// Tests for webapp/src/speech-to-text.js — SpeechToText
// component.
//
// jsdom has no built-in SpeechRecognition. We install a
// fake constructor on `window` before each test so the
// component's connectedCallback sees it. The fake
// records all method calls and exposes event-trigger
// hooks so tests can drive the recognition lifecycle
// deterministically.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import './speech-to-text.js';
import { _RESTART_DELAY_MS } from './speech-to-text.js';

// ---------------------------------------------------------------------------
// Fake SpeechRecognition
// ---------------------------------------------------------------------------

/**
 * Fake SpeechRecognition. Records construction, start,
 * and stop calls; exposes event-trigger methods so tests
 * can drive the lifecycle (onaudiostart, onresult,
 * onerror, onend, etc.).
 *
 * Instances are accumulated in `instances` (cleared by
 * installFakeRecognition) so tests can assert on the
 * newest instance without guessing which one is current.
 */
class FakeRecognition {
  constructor() {
    FakeRecognition.instances.push(this);
    this.continuous = null;
    this.interimResults = null;
    this.lang = null;
    this.onaudiostart = null;
    this.onspeechstart = null;
    this.onspeechend = null;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    this.started = false;
    this.stopped = false;
    this.throwOnStart = false;
  }
  start() {
    if (this.throwOnStart) {
      throw new Error('permission denied');
    }
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}
FakeRecognition.instances = [];

function installFakeRecognition() {
  FakeRecognition.instances = [];
  window.SpeechRecognition = FakeRecognition;
  // Clear webkit variant so we test the unprefixed
  // path; specific tests override for the webkit case.
  delete window.webkitSpeechRecognition;
}

function uninstallFakeRecognition() {
  delete window.SpeechRecognition;
  delete window.webkitSpeechRecognition;
}

function latestInstance() {
  if (FakeRecognition.instances.length === 0) return null;
  return FakeRecognition.instances[FakeRecognition.instances.length - 1];
}

// ---------------------------------------------------------------------------
// Mount helper
// ---------------------------------------------------------------------------

const _mounted = [];

function mountSpeech() {
  const el = document.createElement('ac-speech-to-text');
  document.body.appendChild(el);
  _mounted.push(el);
  return el;
}

async function settle(el) {
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

afterEach(() => {
  vi.useRealTimers();
  while (_mounted.length) {
    const el = _mounted.pop();
    if (el.isConnected) el.remove();
  }
  uninstallFakeRecognition();
});

// ---------------------------------------------------------------------------
// Browser support detection
// ---------------------------------------------------------------------------

describe('SpeechToText browser support', () => {
  it('hides when no SpeechRecognition is available', async () => {
    uninstallFakeRecognition();
    const el = mountSpeech();
    await settle(el);
    expect(el.hidden).toBe(true);
  });

  it('visible when SpeechRecognition is available', async () => {
    installFakeRecognition();
    const el = mountSpeech();
    await settle(el);
    expect(el.hidden).toBe(false);
  });

  it('visible when only webkitSpeechRecognition is available', async () => {
    // Safari path.
    window.webkitSpeechRecognition = FakeRecognition;
    delete window.SpeechRecognition;
    const el = mountSpeech();
    await settle(el);
    expect(el.hidden).toBe(false);
  });

  it('SpeechToText.isSupported reflects availability', async () => {
    uninstallFakeRecognition();
    const { SpeechToText } = await import('./speech-to-text.js');
    expect(SpeechToText.isSupported).toBe(false);
    installFakeRecognition();
    expect(SpeechToText.isSupported).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Toggle and recognition lifecycle
// ---------------------------------------------------------------------------

describe('SpeechToText toggle', () => {
  beforeEach(() => {
    installFakeRecognition();
  });

  it('starts inactive', async () => {
    const el = mountSpeech();
    await settle(el);
    expect(el.active).toBe(false);
    expect(el._state).toBe('inactive');
    expect(FakeRecognition.instances).toHaveLength(0);
  });

  it('clicking the button starts a recognition session', async () => {
    const el = mountSpeech();
    await settle(el);
    el.shadowRoot.querySelector('.toggle').click();
    await settle(el);
    expect(el.active).toBe(true);
    expect(FakeRecognition.instances).toHaveLength(1);
    const rec = latestInstance();
    expect(rec.started).toBe(true);
  });

  it('sets continuous=false and interimResults=false', async () => {
    const el = mountSpeech();
    await settle(el);
    el.toggle();
    await settle(el);
    const rec = latestInstance();
    expect(rec.continuous).toBe(false);
    expect(rec.interimResults).toBe(false);
  });

  it('sets lang from navigator.language', async () => {
    const el = mountSpeech();
    await settle(el);
    el.toggle();
    await settle(el);
    const rec = latestInstance();
    // jsdom's navigator.language is usually 'en-US'; we
    // just verify it's set to the same value.
    expect(rec.lang).toBe(navigator.language);
  });

  it('second click stops the session', async () => {
    const el = mountSpeech();
    await settle(el);
    const btn = el.shadowRoot.querySelector('.toggle');
    btn.click();
    await settle(el);
    expect(el.active).toBe(true);
    const rec = latestInstance();
    btn.click();
    await settle(el);
    expect(el.active).toBe(false);
    expect(rec.stopped).toBe(true);
  });

  it('programmatic toggle() works the same as click', async () => {
    const el = mountSpeech();
    await settle(el);
    el.toggle();
    await settle(el);
    expect(el.active).toBe(true);
    el.toggle();
    await settle(el);
    expect(el.active).toBe(false);
  });

  it('button shows active class while dictating', async () => {
    const el = mountSpeech();
    await settle(el);
    const btn = el.shadowRoot.querySelector('.toggle');
    expect(btn.classList.contains('active')).toBe(false);
    btn.click();
    await settle(el);
    const btnAfter = el.shadowRoot.querySelector('.toggle');
    expect(btnAfter.classList.contains('active')).toBe(true);
  });

  it('aria-pressed reflects active state', async () => {
    const el = mountSpeech();
    await settle(el);
    const btn = el.shadowRoot.querySelector('.toggle');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    btn.click();
    await settle(el);
    expect(
      el.shadowRoot.querySelector('.toggle').getAttribute('aria-pressed'),
    ).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// LED state transitions
// ---------------------------------------------------------------------------

describe('SpeechToText LED state', () => {
  beforeEach(() => {
    installFakeRecognition();
  });

  it('LED inactive before starting', async () => {
    const el = mountSpeech();
    await settle(el);
    const led = el.shadowRoot.querySelector('.led');
    expect(led.classList.contains('listening')).toBe(false);
    expect(led.classList.contains('speaking')).toBe(false);
  });

  it('LED transitions to listening on audio start', async () => {
    const el = mountSpeech();
    await settle(el);
    el.toggle();
    await settle(el);
    const rec = latestInstance();
    rec.onaudiostart();
    await settle(el);
    const led = el.shadowRoot.querySelector('.led');
    expect(led.classList.contains('listening')).toBe(true);
  });

  it('LED transitions to speaking on speech start', async () => {
    const el = mountSpeech();
    await settle(el);
    el.toggle();
    await settle(el);
    const rec = latestInstance();
    rec.onaudiostart();
    rec.onspeechstart();
    await settle(el);
    const led = el.shadowRoot.querySelector('.led');
    expect(led.classList.contains('speaking')).toBe(true);
    expect(led.classList.contains('listening')).toBe(false);
  });

  it('LED returns to listening when speech ends', async () => {
    const el = mountSpeech();
    await settle(el);
    el.toggle();
    await settle(el);
    const rec = latestInstance();
    rec.onspeechstart();
    await settle(el);
    rec.onspeechend();
    await settle(el);
    const led = el.shadowRoot.querySelector('.led');
    expect(led.classList.contains('listening')).toBe(true);
    expect(led.classList.contains('speaking')).toBe(false);
  });

  it('LED returns to inactive after stop', async () => {
    const el = mountSpeech();
    await settle(el);
    el.toggle();
    await settle(el);
    const rec = latestInstance();
    rec.onaudiostart();
    await settle(el);
    el.toggle(); // stop
    await settle(el);
    const led = el.shadowRoot.querySelector('.led');
    expect(led.classList.contains('listening')).toBe(false);
    expect(led.classList.contains('speaking')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Transcript event dispatch
// ---------------------------------------------------------------------------

describe('SpeechToText transcript events', () => {
  beforeEach(() => {
    installFakeRecognition();
  });

  function fireResult(rec, transcript, isFinal = true) {
    rec.onresult({
      results: [
        {
          isFinal,
          0: { transcript },
        },
      ],
    });
  }

  it('fires transcript event on final result', async () => {
    const el = mountSpeech();
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('transcript', listener);
    el.toggle();
    await settle(el);
    fireResult(latestInstance(), 'hello world');
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail).toEqual({
      text: 'hello world',
    });
  });

  it('transcript event bubbles and crosses shadow DOM', async () => {
    const el = mountSpeech();
    await settle(el);
    const docListener = vi.fn();
    document.body.addEventListener('transcript', docListener);
    try {
      el.toggle();
      await settle(el);
      fireResult(latestInstance(), 'ping');
      expect(docListener).toHaveBeenCalledOnce();
    } finally {
      document.body.removeEventListener('transcript', docListener);
    }
  });

  it('does not fire on non-final results', async () => {
    // Belt-and-braces — we set interimResults=false, but
    // some browsers ignore that or fire legacy events.
    // Skip them defensively.
    const el = mountSpeech();
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('transcript', listener);
    el.toggle();
    await settle(el);
    fireResult(latestInstance(), 'partial', false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('skips empty transcripts', async () => {
    const el = mountSpeech();
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('transcript', listener);
    el.toggle();
    await settle(el);
    fireResult(latestInstance(), '');
    expect(listener).not.toHaveBeenCalled();
  });

  it('handles malformed result events defensively', async () => {
    const el = mountSpeech();
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('transcript', listener);
    el.toggle();
    await settle(el);
    const rec = latestInstance();
    // Missing results array.
    expect(() => rec.onresult({})).not.toThrow();
    // Null result entries.
    expect(() =>
      rec.onresult({ results: [null, undefined] }),
    ).not.toThrow();
    // Malformed alternatives.
    expect(() =>
      rec.onresult({
        results: [{ isFinal: true, 0: null }],
      }),
    ).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it('fires multiple events for multiple final results', async () => {
    const el = mountSpeech();
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('transcript', listener);
    el.toggle();
    await settle(el);
    const rec = latestInstance();
    rec.onresult({
      results: [
        { isFinal: true, 0: { transcript: 'first' } },
        { isFinal: true, 0: { transcript: 'second' } },
      ],
    });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[0][0].detail.text).toBe('first');
    expect(listener.mock.calls[1][0].detail.text).toBe('second');
  });
});

// ---------------------------------------------------------------------------
// Auto-restart loop
// ---------------------------------------------------------------------------

describe('SpeechToText auto-restart', () => {
  beforeEach(() => {
    installFakeRecognition();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('restarts recognition after onend while active', async () => {
    const el = mountSpeech();
    await el.updateComplete;
    el.toggle();
    await el.updateComplete;
    expect(FakeRecognition.instances).toHaveLength(1);
    const first = latestInstance();
    // Simulate recognition cycle ending.
    first.onend();
    // Advance past the restart delay.
    await vi.advanceTimersByTimeAsync(_RESTART_DELAY_MS + 10);
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(latestInstance().started).toBe(true);
  });

  it('no-speech error does not stop the loop', async () => {
    const el = mountSpeech();
    await el.updateComplete;
    el.toggle();
    await el.updateComplete;
    const first = latestInstance();
    // Browser fires no-speech error when continuous=false
    // and user pauses too long. It's a cycle boundary,
    // not a real error.
    first.onerror({ error: 'no-speech' });
    first.onend();
    await vi.advanceTimersByTimeAsync(_RESTART_DELAY_MS + 10);
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(el.active).toBe(true);
  });

  it('aborted error does not stop the loop', async () => {
    // `aborted` fires when the restart itself races with
    // a stop call — harmless.
    const el = mountSpeech();
    await el.updateComplete;
    el.toggle();
    await el.updateComplete;
    const first = latestInstance();
    first.onerror({ error: 'aborted' });
    first.onend();
    await vi.advanceTimersByTimeAsync(_RESTART_DELAY_MS + 10);
    expect(FakeRecognition.instances).toHaveLength(2);
  });

  it('stopping cancels a pending restart', async () => {
    const el = mountSpeech();
    await el.updateComplete;
    el.toggle();
    await el.updateComplete;
    const first = latestInstance();
    first.onend(); // schedule restart
    // Toggle off before the restart delay elapses.
    el.toggle();
    await el.updateComplete;
    // Advance past when the restart would have fired.
    await vi.advanceTimersByTimeAsync(_RESTART_DELAY_MS + 100);
    // Only the first instance exists — restart never
    // fired.
    expect(FakeRecognition.instances).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('SpeechToText errors', () => {
  beforeEach(() => {
    installFakeRecognition();
  });

  it('real error stops session and fires recognition-error', async () => {
    const el = mountSpeech();
    await settle(el);
    const errorListener = vi.fn();
    el.addEventListener('recognition-error', errorListener);
    el.toggle();
    await settle(el);
    const rec = latestInstance();
    rec.onerror({ error: 'not-allowed' });
    await settle(el);
    expect(el.active).toBe(false);
    expect(el._state).toBe('inactive');
    expect(errorListener).toHaveBeenCalledOnce();
    expect(errorListener.mock.calls[0][0].detail).toEqual({
      error: 'not-allowed',
    });
  });

  it('error event bubbles and crosses shadow DOM', async () => {
    const el = mountSpeech();
    await settle(el);
    const docListener = vi.fn();
    document.body.addEventListener(
      'recognition-error',
      docListener,
    );
    try {
      el.toggle();
      await settle(el);
      latestInstance().onerror({ error: 'network' });
      await settle(el);
      expect(docListener).toHaveBeenCalledOnce();
    } finally {
      document.body.removeEventListener(
        'recognition-error',
        docListener,
      );
    }
  });

  it('synchronous start() failure is handled cleanly', async () => {
    // Some browsers throw from start() when permission
    // is denied synchronously. The component should
    // revert to inactive and dispatch an error event.
    const el = mountSpeech();
    await settle(el);
    const errorListener = vi.fn();
    el.addEventListener('recognition-error', errorListener);
    // Make the next constructed instance throw on
    // start.
    const origConstructor = window.SpeechRecognition;
    window.SpeechRecognition = class extends origConstructor {
      constructor() {
        super();
        this.throwOnStart = true;
      }
    };
    try {
      el.toggle();
      await settle(el);
      expect(el.active).toBe(false);
      expect(errorListener).toHaveBeenCalledOnce();
      expect(errorListener.mock.calls[0][0].detail.error).toContain(
        'permission',
      );
    } finally {
      window.SpeechRecognition = origConstructor;
    }
  });

  it('error missing the error field degrades to "unknown"', async () => {
    const el = mountSpeech();
    await settle(el);
    const errorListener = vi.fn();
    el.addEventListener('recognition-error', errorListener);
    el.toggle();
    await settle(el);
    latestInstance().onerror({});
    await settle(el);
    expect(errorListener.mock.calls[0][0].detail.error).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// Disconnect / cleanup
// ---------------------------------------------------------------------------

describe('SpeechToText cleanup', () => {
  beforeEach(() => {
    installFakeRecognition();
  });

  it('disconnect stops active session', async () => {
    const el = mountSpeech();
    await settle(el);
    el.toggle();
    await settle(el);
    const rec = latestInstance();
    expect(rec.started).toBe(true);
    expect(rec.stopped).toBe(false);
    el.remove();
    expect(rec.stopped).toBe(true);
  });

  it('disconnect with no active session is a no-op', async () => {
    const el = mountSpeech();
    await settle(el);
    // Don't start — just disconnect.
    expect(() => el.remove()).not.toThrow();
  });

  it('disconnect clears restart timer', async () => {
    vi.useFakeTimers();
    try {
      const el = mountSpeech();
      await el.updateComplete;
      el.toggle();
      await el.updateComplete;
      const first = latestInstance();
      first.onend(); // schedule restart
      el.remove();
      // Advance past restart delay — no new instance.
      await vi.advanceTimersByTimeAsync(_RESTART_DELAY_MS + 100);
      expect(FakeRecognition.instances).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('handlers cleared before stop so onend does not restart', async () => {
    const el = mountSpeech();
    await settle(el);
    el.toggle();
    await settle(el);
    const rec = latestInstance();
    el.remove();
    // Handlers should be null now.
    expect(rec.onend).toBeNull();
    expect(rec.onresult).toBeNull();
    expect(rec.onerror).toBeNull();
  });
});