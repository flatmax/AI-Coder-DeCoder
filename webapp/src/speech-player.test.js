// Tests for webapp/src/speech-player.js — the sentence-
// sequencing transport on top of the synthesis helper.
//
// jsdom has no Web Speech synthesis API. We install the
// same fake `window.speechSynthesis` + utterance ctor used
// by speech-synthesis.test.js, plus pause/resume spies,
// then drive the fake's onend/onerror callbacks to step the
// queue. The player calls into speech-synthesis.js (not
// mocked) so these are integration tests over both modules.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_RATE,
  MIN_RATE,
  SPEECH_STATE_EVENT,
  SpeechPlayer,
  splitIntoSentences,
} from './speech-player.js';

// ---------------------------------------------------------------------------
// Fake synthesis API
// ---------------------------------------------------------------------------

class FakeUtterance {
  constructor(text) {
    FakeUtterance.instances.push(this);
    this.text = text;
    this.lang = null;
    this.rate = null;
    this.pitch = null;
    this.onend = null;
    this.onerror = null;
  }
}
FakeUtterance.instances = [];

function makeFakeSynth() {
  return {
    speakCalls: [],
    cancelCalls: 0,
    pauseCalls: 0,
    resumeCalls: 0,
    speak(u) {
      this.speakCalls.push(u);
    },
    cancel() {
      this.cancelCalls += 1;
    },
    pause() {
      this.pauseCalls += 1;
    },
    resume() {
      this.resumeCalls += 1;
    },
  };
}

function installFakeSynth() {
  FakeUtterance.instances = [];
  window.speechSynthesis = makeFakeSynth();
  window.SpeechSynthesisUtterance = FakeUtterance;
  return window.speechSynthesis;
}

function uninstallFakeSynth() {
  delete window.speechSynthesis;
  delete window.SpeechSynthesisUtterance;
}

/** Latest utterance the player handed to the synth. */
function lastUtterance() {
  const arr = FakeUtterance.instances;
  return arr.length ? arr[arr.length - 1] : null;
}

afterEach(() => {
  uninstallFakeSynth();
});

// ---------------------------------------------------------------------------
// splitIntoSentences
// ---------------------------------------------------------------------------

describe('splitIntoSentences', () => {
  it('returns [] for empty / non-string input', () => {
    expect(splitIntoSentences('')).toEqual([]);
    expect(splitIntoSentences('   ')).toEqual([]);
    expect(splitIntoSentences(null)).toEqual([]);
    expect(splitIntoSentences(undefined)).toEqual([]);
  });

  it('splits on sentence terminators', () => {
    const out = splitIntoSentences('Hello there. How are you? Fine!');
    expect(out).toEqual(['Hello there.', 'How are you?', 'Fine!']);
  });

  it('keeps a trailing fragment with no terminator', () => {
    expect(splitIntoSentences('one. two')).toEqual(['one.', 'two']);
  });

  it('collapses internal whitespace and hard wraps', () => {
    const out = splitIntoSentences('a line\n\nwith   breaks');
    expect(out).toEqual(['a line with breaks']);
  });

  it('treats a terminator-free string as one segment', () => {
    expect(splitIntoSentences('just one phrase')).toEqual([
      'just one phrase',
    ]);
  });

  it('keeps closing quotes with their sentence', () => {
    const out = splitIntoSentences('He said "go." Then left.');
    expect(out[0]).toBe('He said "go."');
    expect(out[1]).toBe('Then left.');
  });

  it('sub-splits an over-long sentence at clause boundaries', () => {
    const clause = 'a'.repeat(120);
    const long = `${clause}, ${clause}, ${clause}.`;
    const out = splitIntoSentences(long);
    expect(out.length).toBeGreaterThan(1);
    // No segment exceeds the soft ceiling by much.
    for (const seg of out) {
      expect(seg.length).toBeLessThanOrEqual(240);
    }
  });

  it('packs words when a single clause is too long', () => {
    const word = 'word';
    const huge = Array.from({ length: 200 }, () => word).join(' ') + '.';
    const out = splitIntoSentences(huge);
    expect(out.length).toBeGreaterThan(1);
    // Words are never split mid-token.
    for (const seg of out) {
      expect(seg.split(/\s+/).every((w) => w === word || w === `${word}.`))
        .toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// SpeechPlayer transport
// ---------------------------------------------------------------------------

describe('SpeechPlayer', () => {
  let player;
  let synth;

  beforeEach(() => {
    synth = installFakeSynth();
    player = new SpeechPlayer();
  });

  it('starts idle', () => {
    expect(player.state.active).toBe(false);
    expect(player.state.status).toBe('idle');
    expect(player.state.total).toBe(0);
  });

  it('play() speaks the first sentence and reports state', () => {
    const ok = player.play('One. Two. Three.');
    expect(ok).toBe(true);
    expect(synth.speakCalls).toHaveLength(1);
    expect(lastUtterance().text).toBe('One.');
    expect(player.state.active).toBe(true);
    expect(player.state.status).toBe('playing');
    expect(player.state.index).toBe(0);
    expect(player.state.total).toBe(3);
  });

  it('play() returns false for empty text', () => {
    expect(player.play('   ')).toBe(false);
    expect(synth.speakCalls).toHaveLength(0);
    expect(player.state.active).toBe(false);
  });

  it('play() returns false when synthesis is unsupported', () => {
    uninstallFakeSynth();
    expect(player.play('hello')).toBe(false);
  });

  it('advances to the next sentence on natural end', () => {
    player.play('One. Two. Three.');
    expect(lastUtterance().text).toBe('One.');
    lastUtterance().onend();
    expect(lastUtterance().text).toBe('Two.');
    expect(player.state.index).toBe(1);
    lastUtterance().onend();
    expect(lastUtterance().text).toBe('Three.');
    expect(player.state.index).toBe(2);
  });

  it('stops after the final sentence ends', () => {
    player.play('Only one.');
    lastUtterance().onend();
    expect(player.state.active).toBe(false);
    expect(player.state.status).toBe('idle');
  });

  it('a stale onend (wrong token) does not advance', () => {
    player.play('One. Two. Three.');
    const first = lastUtterance();
    player.next(); // speaks "Two.", bumps the active token
    expect(player.state.index).toBe(1);
    // The first utterance's late callback must be ignored.
    first.onend();
    expect(player.state.index).toBe(1);
  });

  it('next() re-speaks at the new index while playing', () => {
    player.play('One. Two. Three.');
    player.next();
    expect(player.state.index).toBe(1);
    expect(lastUtterance().text).toBe('Two.');
  });

  it('next() past the end stops playback', () => {
    player.play('One. Two.');
    player.next(); // -> index 1 (last)
    player.next(); // past end -> stop
    expect(player.state.active).toBe(false);
  });

  it('prev() clamps at the start', () => {
    player.play('One. Two. Three.');
    player.prev();
    expect(player.state.index).toBe(0);
    expect(lastUtterance().text).toBe('One.');
  });

  it('seek() jumps to an absolute sentence', () => {
    player.play('One. Two. Three. Four.');
    player.seek(2);
    expect(player.state.index).toBe(2);
    expect(lastUtterance().text).toBe('Three.');
  });

  it('seek() clamps out-of-range indices', () => {
    player.play('One. Two.');
    player.seek(99);
    expect(player.state.index).toBe(1);
    player.seek(-5);
    expect(player.state.index).toBe(0);
  });

  it('pause() suspends and resume() continues mid-utterance', () => {
    player.play('One. Two.');
    player.pause();
    expect(player.state.status).toBe('paused');
    expect(synth.pauseCalls).toBe(1);
    const speakCountBefore = synth.speakCalls.length;
    player.resume();
    expect(player.state.status).toBe('playing');
    expect(synth.resumeCalls).toBe(1);
    // Mid-utterance resume continues, doesn't re-speak.
    expect(synth.speakCalls.length).toBe(speakCountBefore);
  });

  it('toggle() flips between play and pause', () => {
    player.play('One. Two.');
    player.toggle();
    expect(player.state.status).toBe('paused');
    player.toggle();
    expect(player.state.status).toBe('playing');
  });

  it('seeking while paused re-speaks fresh on resume', () => {
    player.play('One. Two. Three.');
    player.pause();
    player.seek(2);
    expect(player.state.index).toBe(2);
    const speakCountBefore = synth.speakCalls.length;
    player.resume();
    // Position changed while paused -> fresh speak, not resume.
    expect(synth.speakCalls.length).toBe(speakCountBefore + 1);
    expect(lastUtterance().text).toBe('Three.');
  });

  it('setRate() clamps and re-speaks the current sentence', () => {
    player.play('One. Two.');
    const before = synth.speakCalls.length;
    player.setRate(1.4);
    expect(player.state.rate).toBe(1.4);
    expect(synth.speakCalls.length).toBe(before + 1);
    expect(lastUtterance().rate).toBe(1.4);
    // Out-of-range clamps.
    player.setRate(99);
    expect(player.state.rate).toBe(MAX_RATE);
    player.setRate(0.01);
    expect(player.state.rate).toBe(MIN_RATE);
  });

  it('setRate() with no change is a no-op', () => {
    player.play('One. Two.', { rate: 1.5 });
    const before = synth.speakCalls.length;
    player.setRate(1.5);
    expect(synth.speakCalls.length).toBe(before);
  });

  it('applies the initial rate option', () => {
    player.play('One.', { rate: 1.4 });
    expect(lastUtterance().rate).toBe(1.4);
    expect(player.state.rate).toBe(1.4);
  });

  it('stop() cancels and returns to idle', () => {
    player.play('One. Two.');
    player.stop();
    expect(synth.cancelCalls).toBeGreaterThan(0);
    expect(player.state.active).toBe(false);
    expect(player.state.total).toBe(0);
  });

  it('an onerror stops playback', () => {
    player.play('One. Two.');
    lastUtterance().onerror({ error: 'synthesis-failed' });
    expect(player.state.active).toBe(false);
  });

  it('carries label and ownerKey into the state', () => {
    player.play('One.', { label: 'Assistant · #3', ownerKey: 3 });
    expect(player.state.label).toBe('Assistant · #3');
    expect(player.state.ownerKey).toBe(3);
  });

  it('emits a state event on every transition', () => {
    const events = [];
    const handler = (e) => events.push(e.detail);
    window.addEventListener(SPEECH_STATE_EVENT, handler);
    try {
      player.play('One. Two.');
      player.pause();
      player.resume();
      player.next();
      player.stop();
    } finally {
      window.removeEventListener(SPEECH_STATE_EVENT, handler);
    }
    expect(events.length).toBe(5);
    expect(events[0].status).toBe('playing');
    expect(events[1].status).toBe('paused');
    expect(events[events.length - 1].active).toBe(false);
  });

  it('transport methods are no-ops when idle', () => {
    expect(() => {
      player.pause();
      player.resume();
      player.next();
      player.prev();
      player.seek(2);
    }).not.toThrow();
    expect(synth.speakCalls).toHaveLength(0);
  });
});
