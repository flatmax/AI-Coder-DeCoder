// Tests for the SpeechControls floating transport.
//
// The component is a pure reflection of the
// `speech-player-state` window event — it holds no
// playback state of its own — so these tests drive it by
// dispatching synthetic state events rather than running a
// real player. Button clicks are checked against the
// shared speechPlayer's methods via spies.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import './speech-controls.js';
import { SPEECH_STATE_EVENT, speechPlayer } from './speech-player.js';

const _mounted = [];

function mountControls() {
  const el = document.createElement('ac-speech-controls');
  document.body.appendChild(el);
  _mounted.push(el);
  return el;
}

function fireState(detail) {
  window.dispatchEvent(
    new CustomEvent(SPEECH_STATE_EVENT, { detail }),
  );
}

const ACTIVE = {
  active: true,
  status: 'playing',
  index: 1,
  total: 4,
  rate: 1,
  label: 'Assistant · #2',
  ownerKey: 1,
};

beforeEach(() => {
  // Ensure a clean idle state — the player is a singleton
  // shared across the module graph.
  speechPlayer.stop();
});

afterEach(() => {
  vi.restoreAllMocks();
  while (_mounted.length) {
    const el = _mounted.pop();
    if (el.parentNode) el.parentNode.removeChild(el);
  }
  try {
    localStorage.removeItem('ac-dc-speech-controls-pos');
  } catch (_) {
    // ignore
  }
});

describe('SpeechControls visibility', () => {
  it('renders nothing while idle', async () => {
    const el = mountControls();
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.panel')).toBeNull();
  });

  it('appears when playback becomes active', async () => {
    const el = mountControls();
    fireState(ACTIVE);
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.panel')).not.toBeNull();
  });

  it('disappears again when playback ends', async () => {
    const el = mountControls();
    fireState(ACTIVE);
    await el.updateComplete;
    fireState({ ...ACTIVE, active: false, status: 'idle', total: 0 });
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.panel')).toBeNull();
  });
});

describe('SpeechControls display', () => {
  it('shows the label, counter, and rate readout', async () => {
    const el = mountControls();
    fireState(ACTIVE);
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.title').textContent).toContain(
      'Assistant · #2',
    );
    // 1-based counter: index 1 of 4 -> "2/4".
    expect(el.shadowRoot.querySelector('.counter').textContent).toContain(
      '2/4',
    );
    expect(el.shadowRoot.querySelector('.readout').textContent).toContain(
      '1.0×',
    );
  });

  it('shows a pause glyph while playing, play glyph while paused', async () => {
    const el = mountControls();
    fireState(ACTIVE);
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.play').textContent.trim()).toBe(
      '⏸',
    );
    fireState({ ...ACTIVE, status: 'paused' });
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.play').textContent.trim()).toBe(
      '▶',
    );
  });

  it('disables prev at the start and next at the end', async () => {
    const el = mountControls();
    fireState({ ...ACTIVE, index: 0 });
    await el.updateComplete;
    const [prev] = el.shadowRoot.querySelectorAll('.transport .tbtn');
    expect(prev.disabled).toBe(true);

    fireState({ ...ACTIVE, index: 3, total: 4 });
    await el.updateComplete;
    const btns = el.shadowRoot.querySelectorAll('.transport .tbtn');
    const next = btns[btns.length - 1];
    expect(next.disabled).toBe(true);
  });

  it('fills the progress bar proportionally', async () => {
    const el = mountControls();
    fireState({ ...ACTIVE, index: 1, total: 4 });
    await el.updateComplete;
    const fill = el.shadowRoot.querySelector('.progress-fill');
    // (1 + 1) / 4 = 50%.
    expect(fill.getAttribute('style')).toContain('width: 50%');
  });
});

describe('SpeechControls actions', () => {
  it('play button toggles the player', async () => {
    const spy = vi.spyOn(speechPlayer, 'toggle').mockImplementation(() => {});
    const el = mountControls();
    fireState(ACTIVE);
    await el.updateComplete;
    el.shadowRoot.querySelector('.play').click();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('prev / next call the player', async () => {
    const prevSpy = vi
      .spyOn(speechPlayer, 'prev')
      .mockImplementation(() => {});
    const nextSpy = vi
      .spyOn(speechPlayer, 'next')
      .mockImplementation(() => {});
    const el = mountControls();
    fireState(ACTIVE);
    await el.updateComplete;
    const btns = el.shadowRoot.querySelectorAll('.transport .tbtn');
    btns[0].click();
    btns[btns.length - 1].click();
    expect(prevSpy).toHaveBeenCalledOnce();
    expect(nextSpy).toHaveBeenCalledOnce();
  });

  it('close button stops the player', async () => {
    const spy = vi.spyOn(speechPlayer, 'stop');
    const el = mountControls();
    fireState(ACTIVE);
    await el.updateComplete;
    el.shadowRoot.querySelector('.close').click();
    expect(spy).toHaveBeenCalled();
  });

  it('the rate slider sets the player rate', async () => {
    const spy = vi
      .spyOn(speechPlayer, 'setRate')
      .mockImplementation(() => {});
    const el = mountControls();
    fireState(ACTIVE);
    await el.updateComplete;
    const slider = el.shadowRoot.querySelector('input[type="range"]');
    slider.value = '1.4';
    slider.dispatchEvent(new Event('input'));
    expect(spy).toHaveBeenCalledWith(1.4);
  });

  it('clicking the progress bar seeks', async () => {
    const spy = vi.spyOn(speechPlayer, 'seek').mockImplementation(() => {});
    const el = mountControls();
    fireState({ ...ACTIVE, total: 4 });
    await el.updateComplete;
    const bar = el.shadowRoot.querySelector('.progress');
    // getBoundingClientRect is unreliable in jsdom (zero
    // width), so the computed index may be 0 — we only
    // assert the handler fires with a numeric index.
    bar.dispatchEvent(
      new MouseEvent('click', { clientX: 10, bubbles: true }),
    );
    expect(spy).toHaveBeenCalledOnce();
    expect(typeof spy.mock.calls[0][0]).toBe('number');
  });
});

describe('SpeechControls dragging', () => {
  it('persists position to localStorage after a drag', async () => {
    const el = mountControls();
    fireState(ACTIVE);
    await el.updateComplete;
    const header = el.shadowRoot.querySelector('.header');
    // jsdom has no PointerEvent; pointer handlers only read
    // clientX/clientY/target, which MouseEvent provides.
    header.dispatchEvent(
      new MouseEvent('pointerdown', {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }),
    );
    window.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 150, clientY: 160 }),
    );
    window.dispatchEvent(new MouseEvent('pointerup', {}));
    await el.updateComplete;
    const saved = JSON.parse(
      localStorage.getItem('ac-dc-speech-controls-pos'),
    );
    expect(saved).toHaveProperty('x');
    expect(saved).toHaveProperty('y');
  });
});
