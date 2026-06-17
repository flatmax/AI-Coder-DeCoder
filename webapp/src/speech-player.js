// SpeechPlayer — a sentence-sequencing engine on top of
// the raw speech-synthesis helper.
//
// Why this exists:
//
//   The Web Speech synthesis API speaks one string and
//   offers no transport controls beyond pause/resume — no
//   seek, and the speaking rate is frozen the moment an
//   utterance starts. It also has a long-standing Chrome
//   bug where utterances longer than ~15 seconds get cut
//   off mid-sentence.
//
//   This module works around all three by splitting the
//   message into sentences and speaking them one at a
//   time. That buys us:
//
//     - position: a sentence is the seek unit, so prev /
//       next / jump-to-sentence all become "re-speak from
//       sentence N".
//     - live speed: changing rate re-speaks the CURRENT
//       sentence at the new rate (the rest of the queue
//       picks it up for free), so the slider feels live
//       without fighting the frozen-rate limitation.
//     - no cutoff: short per-sentence utterances stay well
//       under Chrome's truncation threshold.
//
// State lives in a single module-level instance
// (`speechPlayer`) because `speechSynthesis` is itself a
// single window-level queue — only one thing speaks at a
// time across the whole app. Every state change emits a
// `speech-player-state` window event so the floating
// controls overlay and the chat panel's per-message
// 🔊/⏹ toggle can both stay in sync without holding a
// direct reference to the player.

import {
  cancelSpeech,
  isSpeechSynthesisSupported,
  pauseSpeech,
  resumeSpeech,
  speakText,
} from './speech-synthesis.js';

/** Window event fired on every player state transition. */
export const SPEECH_STATE_EVENT = 'speech-player-state';

/** Clamp bounds for the speaking rate slider. */
export const MIN_RATE = 0.5;
export const MAX_RATE = 1.5;

/**
 * Soft ceiling on sentence length (characters). Sentences
 * longer than this are sub-split at clause boundaries
 * (then, if still too long, at word boundaries) to stay
 * under Chrome's long-utterance truncation bug. Tuned
 * generously — most prose sentences fall well under it, so
 * sub-splitting is the exception, not the rule.
 */
const MAX_SEGMENT_CHARS = 240;

/**
 * Split text into speakable segments — roughly one
 * sentence each, with over-long sentences sub-split so no
 * single utterance risks the Chrome cutoff.
 *
 * Collapses runs of whitespace first so the spoken text
 * doesn't carry markdown's hard-wrapped newlines into the
 * sentence boundaries. Returns [] for empty input.
 *
 * Exported for unit testing.
 */
export function splitIntoSentences(text) {
  const normalized =
    typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (!normalized) return [];
  // Match a run of non-terminator chars followed by one or
  // more sentence terminators (and any trailing closing
  // quote/bracket), OR a trailing run with no terminator.
  const matches =
    normalized.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g) || [normalized];
  const out = [];
  for (const raw of matches) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (sentence.length <= MAX_SEGMENT_CHARS) {
      out.push(sentence);
    } else {
      out.push(..._subSplitLong(sentence));
    }
  }
  return out.length > 0 ? out : [normalized];
}

/**
 * Break a single over-long sentence into smaller chunks.
 * Prefers clause boundaries (comma / semicolon / colon /
 * dash); falls back to packing whole words up to the
 * length ceiling so we never split mid-word.
 */
function _subSplitLong(sentence) {
  // First pass: clause boundaries, keeping the delimiter.
  const clauses = sentence.match(/[^,;:—–]+[,;:—–]?\s*/g) || [sentence];
  const chunks = [];
  let buffer = '';
  const flush = () => {
    const trimmed = buffer.trim();
    if (trimmed) chunks.push(trimmed);
    buffer = '';
  };
  for (const clause of clauses) {
    if (clause.length > MAX_SEGMENT_CHARS) {
      // A single clause is still too long — pack words.
      flush();
      for (const word of clause.split(/\s+/)) {
        if (!word) continue;
        if ((buffer + ' ' + word).trim().length > MAX_SEGMENT_CHARS) {
          flush();
        }
        buffer = buffer ? `${buffer} ${word}` : word;
      }
      flush();
    } else if ((buffer + clause).length > MAX_SEGMENT_CHARS) {
      flush();
      buffer = clause;
    } else {
      buffer += clause;
    }
  }
  flush();
  return chunks.length > 0 ? chunks : [sentence];
}

function _clampRate(rate) {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return 1;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
}

/**
 * The sentence-sequencing transport. One instance is
 * exported as `speechPlayer`; the class is exported for
 * tests that want an isolated instance.
 */
export class SpeechPlayer {
  constructor() {
    // 'idle' | 'playing' | 'paused'
    this._status = 'idle';
    this._segments = [];
    this._index = 0;
    this._rate = 1;
    // Free-text label describing the source (e.g. the role
    // and a snippet) — shown in the controls header.
    this._label = '';
    // Opaque key identifying who owns this playback. The
    // chat panel passes the message index so its toggle can
    // light the right speaker button. Echoed back in every
    // state event.
    this._ownerKey = null;
    // Monotonic token stamped on each utterance. A late
    // onend/onerror callback (e.g. fired by cancel() on the
    // utterance we just replaced) only acts when its token
    // still matches — this filters stale callbacks so an
    // interrupted sentence can't advance the queue.
    this._token = 0;
    this._activeToken = 0;
    // True when pause() left a native utterance suspended
    // mid-sentence (so resume() should synth.resume() to
    // continue from the exact word). Cleared whenever the
    // queue position or rate changes while paused, so
    // resume() re-speaks the current sentence fresh instead.
    this._pausedMidUtterance = false;
  }

  /** Snapshot of public state for event consumers. */
  get state() {
    return {
      active: this._status !== 'idle',
      status: this._status,
      index: this._index,
      total: this._segments.length,
      rate: this._rate,
      label: this._label,
      ownerKey: this._ownerKey,
    };
  }

  get rate() {
    return this._rate;
  }

  /**
   * Begin reading `text` aloud from the first sentence.
   * Replaces any current playback (single global queue).
   *
   * Options:
   *   - rate:     initial speaking rate (clamped)
   *   - label:    descriptive header text for the controls
   *   - ownerKey: opaque id echoed in state events
   */
  play(text, { rate, label, ownerKey } = {}) {
    if (!isSpeechSynthesisSupported()) return false;
    const segments = splitIntoSentences(text);
    if (segments.length === 0) return false;
    if (typeof rate === 'number') this._rate = _clampRate(rate);
    this._segments = segments;
    this._index = 0;
    this._label = typeof label === 'string' ? label : '';
    this._ownerKey = ownerKey ?? null;
    this._status = 'playing';
    this._speakCurrent();
    this._emit();
    return true;
  }

  /** Play/pause toggle. No-op when idle. */
  toggle() {
    if (this._status === 'playing') this.pause();
    else if (this._status === 'paused') this.resume();
  }

  /** Suspend the current sentence, keeping the position. */
  pause() {
    if (this._status !== 'playing') return;
    pauseSpeech();
    this._pausedMidUtterance = true;
    this._status = 'paused';
    this._emit();
  }

  /** Resume from where pause() left off. */
  resume() {
    if (this._status !== 'paused') return;
    this._status = 'playing';
    if (this._pausedMidUtterance) {
      // A native utterance is still suspended — continue it
      // from the exact word rather than restarting.
      resumeSpeech();
    } else {
      // Position or rate moved while paused; speak fresh.
      this._speakCurrent();
    }
    this._emit();
  }

  /** Jump to the next sentence; stops past the end. */
  next() {
    if (this._status === 'idle') return;
    if (this._index >= this._segments.length - 1) {
      this.stop();
      return;
    }
    this._goTo(this._index + 1);
  }

  /** Jump to the previous sentence (clamped at the start). */
  prev() {
    if (this._status === 'idle') return;
    this._goTo(Math.max(0, this._index - 1));
  }

  /** Jump to an absolute sentence index. */
  seek(index) {
    if (this._status === 'idle') return;
    const target = Math.min(
      this._segments.length - 1,
      Math.max(0, Math.floor(index)),
    );
    this._goTo(target);
  }

  /**
   * Change the speaking rate. Takes effect immediately:
   * while playing, the current sentence re-speaks at the
   * new rate (the remaining queue inherits it); while
   * paused, it applies when playback resumes.
   */
  setRate(rate) {
    const next = _clampRate(rate);
    if (next === this._rate) return;
    this._rate = next;
    if (this._status === 'playing') {
      this._speakCurrent();
    } else if (this._status === 'paused') {
      // Can't change a suspended utterance's rate — force a
      // fresh speak on resume.
      this._pausedMidUtterance = false;
    }
    this._emit();
  }

  /** Stop playback entirely and return to idle. */
  stop() {
    cancelSpeech();
    // Bump the token so any late callback from the cancelled
    // utterance is ignored.
    this._token += 1;
    this._activeToken = this._token;
    this._status = 'idle';
    this._segments = [];
    this._index = 0;
    this._label = '';
    this._ownerKey = null;
    this._pausedMidUtterance = false;
    this._emit();
  }

  // -----------------------------------------------------------
  // Internals
  // -----------------------------------------------------------

  /**
   * Move to `index` and reconcile playback: re-speak when
   * playing, stay parked (but mark "speak fresh on resume")
   * when paused.
   */
  _goTo(index) {
    this._index = index;
    if (this._status === 'playing') {
      this._speakCurrent();
    } else {
      // Paused — drop the suspended utterance so resume()
      // speaks from the new position.
      cancelSpeech();
      this._token += 1;
      this._activeToken = this._token;
      this._pausedMidUtterance = false;
    }
    this._emit();
  }

  /** Speak the sentence at the current index. */
  _speakCurrent() {
    const segment = this._segments[this._index];
    if (typeof segment !== 'string' || !segment) {
      this.stop();
      return;
    }
    const token = ++this._token;
    this._activeToken = token;
    this._pausedMidUtterance = false;
    speakText(segment, {
      rate: this._rate,
      onend: () => this._onSegmentEnd(token),
      onerror: () => this._onSegmentError(token),
    });
  }

  /** Natural end of a sentence — advance or finish. */
  _onSegmentEnd(token) {
    if (token !== this._activeToken) return;
    if (this._status !== 'playing') return;
    if (this._index < this._segments.length - 1) {
      this._index += 1;
      this._speakCurrent();
      this._emit();
    } else {
      this.stop();
    }
  }

  /** A sentence failed to speak — give up cleanly. */
  _onSegmentError(token) {
    if (token !== this._activeToken) return;
    this.stop();
  }

  /** Broadcast the current state to window listeners. */
  _emit() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent(SPEECH_STATE_EVENT, { detail: this.state }),
    );
  }
}

/** Shared singleton — mirrors the single synthesis queue. */
export const speechPlayer = new SpeechPlayer();
