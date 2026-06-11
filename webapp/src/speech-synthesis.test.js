// Tests for webapp/src/speech-synthesis.js — the
// text-to-speech helper module.
//
// jsdom has no Web Speech synthesis API. We install a
// fake `window.speechSynthesis` and a fake
// `window.SpeechSynthesisUtterance` constructor before
// each test so the helper sees a supported environment.
// The fakes record speak/cancel calls and expose the
// created utterances so tests can drive onend/onerror
// and assert on the spoken text.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cancelSpeech,
  isSpeechSynthesisSupported,
  speakText,
} from './speech-synthesis.js';

// ---------------------------------------------------------------------------
// Fake synthesis API
// ---------------------------------------------------------------------------

/**
 * Fake SpeechSynthesisUtterance — records the text and
 * exposes the assignable handler/voice fields the helper
 * sets. Instances accumulate so tests can grab the latest.
 */
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

/**
 * Fake speechSynthesis queue. Records speak/cancel calls
 * and remembers the last spoken utterance.
 */
function makeFakeSynth() {
  return {
    speakCalls: [],
    cancelCalls: 0,
    lastUtterance: null,
    throwOnSpeak: false,
    speak(utterance) {
      if (this.throwOnSpeak) throw new Error('autoplay blocked');
      this.speakCalls.push(utterance);
      this.lastUtterance = utterance;
    },
    cancel() {
      this.cancelCalls += 1;
    },
  };
}

function installFakeSynth() {
  FakeUtterance.instances = [];
  window.speechSynthesis = makeFakeSynth();
  window.SpeechSynthesisUtterance = FakeUtterance;
}

function uninstallFakeSynth() {
  delete window.speechSynthesis;
  delete window.SpeechSynthesisUtterance;
}

function latestUtterance() {
  if (FakeUtterance.instances.length === 0) return null;
  return FakeUtterance.instances[FakeUtterance.instances.length - 1];
}

afterEach(() => {
  uninstallFakeSynth();
});

// ---------------------------------------------------------------------------
// Support detection
// ---------------------------------------------------------------------------

describe('isSpeechSynthesisSupported', () => {
  it('false when speechSynthesis is absent', () => {
    uninstallFakeSynth();
    expect(isSpeechSynthesisSupported()).toBe(false);
  });

  it('false when only the queue exists (no utterance ctor)', () => {
    window.speechSynthesis = makeFakeSynth();
    delete window.SpeechSynthesisUtterance;
    expect(isSpeechSynthesisSupported()).toBe(false);
  });

  it('true when both queue and utterance ctor exist', () => {
    installFakeSynth();
    expect(isSpeechSynthesisSupported()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// speakText
// ---------------------------------------------------------------------------

describe('speakText', () => {
  beforeEach(() => {
    installFakeSynth();
  });

  it('speaks the given text', () => {
    speakText('hello world');
    expect(window.speechSynthesis.speakCalls).toHaveLength(1);
    expect(latestUtterance().text).toBe('hello world');
  });

  it('returns the created utterance', () => {
    const u = speakText('hi');
    expect(u).toBe(latestUtterance());
  });

  it('cancels any in-flight utterance before speaking', () => {
    speakText('first');
    expect(window.speechSynthesis.cancelCalls).toBe(1);
    speakText('second');
    // Each speak cancels the prior queue first.
    expect(window.speechSynthesis.cancelCalls).toBe(2);
    expect(latestUtterance().text).toBe('second');
  });

  it('trims whitespace from the text', () => {
    speakText('  padded  ');
    expect(latestUtterance().text).toBe('padded');
  });

  it('returns null and does not speak for empty text', () => {
    expect(speakText('')).toBeNull();
    expect(speakText('   ')).toBeNull();
    expect(window.speechSynthesis.speakCalls).toHaveLength(0);
  });

  it('returns null for non-string text', () => {
    expect(speakText(null)).toBeNull();
    expect(speakText(undefined)).toBeNull();
    expect(window.speechSynthesis.speakCalls).toHaveLength(0);
  });

  it('returns null when synthesis is unsupported', () => {
    uninstallFakeSynth();
    expect(speakText('hello')).toBeNull();
  });

  it('sets lang from navigator.language', () => {
    speakText('hi');
    expect(latestUtterance().lang).toBe(navigator.language);
  });

  it('applies rate and pitch options when given', () => {
    speakText('hi', { rate: 1.5, pitch: 0.8 });
    expect(latestUtterance().rate).toBe(1.5);
    expect(latestUtterance().pitch).toBe(0.8);
  });

  it('calls onend when the utterance finishes', () => {
    const onend = vi.fn();
    speakText('hi', { onend });
    expect(onend).not.toHaveBeenCalled();
    // Simulate the browser firing onend.
    latestUtterance().onend();
    expect(onend).toHaveBeenCalledOnce();
  });

  it('calls onerror when the utterance errors', () => {
    const onerror = vi.fn();
    speakText('hi', { onerror });
    const event = { error: 'synthesis-failed' };
    latestUtterance().onerror(event);
    expect(onerror).toHaveBeenCalledWith(event);
  });

  it('routes a synchronous speak() throw to onerror', () => {
    window.speechSynthesis.throwOnSpeak = true;
    const onerror = vi.fn();
    const result = speakText('hi', { onerror });
    expect(result).toBeNull();
    expect(onerror).toHaveBeenCalledOnce();
  });

  it('does not throw when onend/onerror are omitted', () => {
    speakText('hi');
    expect(() => latestUtterance().onend()).not.toThrow();
    expect(() => latestUtterance().onerror({})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// cancelSpeech
// ---------------------------------------------------------------------------

describe('cancelSpeech', () => {
  it('calls the native cancel', () => {
    installFakeSynth();
    cancelSpeech();
    expect(window.speechSynthesis.cancelCalls).toBe(1);
  });

  it('is a no-op when synthesis is unavailable', () => {
    uninstallFakeSynth();
    expect(() => cancelSpeech()).not.toThrow();
  });

  it('swallows a throwing native cancel', () => {
    window.speechSynthesis = {
      cancel() {
        throw new Error('bad state');
      },
    };
    window.SpeechSynthesisUtterance = FakeUtterance;
    expect(() => cancelSpeech()).not.toThrow();
  });
});
