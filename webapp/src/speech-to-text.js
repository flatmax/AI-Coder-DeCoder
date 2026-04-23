// SpeechToText — continuous voice dictation toggle.
//
// Layer 5 Phase 2e — speech input.
//
// Wraps the browser's Web Speech API in a LitElement.
// Toggling the button starts a recognition session; each
// final utterance fires a `transcript` CustomEvent that
// the host (chat panel) catches and inserts at the
// textarea's cursor position.
//
// Scope and behaviour per specs4/5-webapp/speech.md:
//
//   - Continuous flag on the recognition API is false.
//     The specs note this is intentional — native
//     continuous mode has inconsistent silence handling
//     across browsers. We use an auto-restart loop
//     instead: each utterance ends, we restart after a
//     short delay. Feels continuous from the user's side
//     but gives predictable utterance boundaries.
//   - Interim results disabled — we only fire events on
//     final transcripts. Reduces flicker in the textarea.
//   - LED reflects recognition state (inactive /
//     listening / speaking).
//   - Errors stop the session and revert to inactive.
//   - Unsupported browsers hide the button entirely.
//   - Disconnect stops the session cleanly to release
//     the microphone (no zombie mic access).
//
// Host integration — the chat panel imports this module
// (side-effect registers the custom element), renders
// `<ac-speech-to-text>` in the action bar, and listens
// for `transcript` events. The transcript handler
// inserts the text at the cursor position with
// auto-space separators. Error events surface via toast.

import { LitElement, css, html } from 'lit';

/**
 * Auto-restart delay after an utterance ends. Small
 * enough to feel continuous, large enough to avoid
 * tight-loop churn on utterance boundaries.
 */
const _RESTART_DELAY_MS = 150;

/**
 * Resolve the browser's SpeechRecognition constructor.
 * WebKit-prefixed variant covers Safari; unprefixed
 * covers everything else. Returns null when neither is
 * available (Firefox, older browsers, non-browser
 * environments like jsdom).
 */
function _getRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  return (
    window.SpeechRecognition ||
    window.webkitSpeechRecognition ||
    null
  );
}

export class SpeechToText extends LitElement {
  static properties = {
    /**
     * Current recognition state:
     *   - 'inactive' — not listening, button shows mic
     *   - 'listening' — audio-start fired, waiting for
     *     speech, pulsing accent
     *   - 'speaking' — speech-start fired, solid accent
     */
    _state: { type: String, state: true },
  };

  static styles = css`
    :host {
      display: inline-flex;
    }
    :host([hidden]) {
      display: none;
    }
    .toggle {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-secondary, #8b949e);
      padding: 0.25rem 0.5rem;
      font-size: 0.875rem;
      border-radius: 4px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      line-height: 1;
    }
    .toggle:hover {
      background: rgba(240, 246, 252, 0.06);
      color: var(--text-primary, #c9d1d9);
      border-color: rgba(240, 246, 252, 0.1);
    }
    .toggle.active {
      background: rgba(248, 81, 73, 0.1);
      border-color: rgba(248, 81, 73, 0.3);
      color: #f85149;
    }
    .led {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: rgba(240, 246, 252, 0.25);
      flex-shrink: 0;
      transition: background 120ms ease;
    }
    .led.listening {
      background: #d29922;
      animation: pulse 1.1s ease-in-out infinite;
    }
    .led.speaking {
      background: #7ee787;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.35; }
    }
    .label {
      font-size: 0.75rem;
    }
  `;

  constructor() {
    super();
    this._state = 'inactive';
    // The SpeechRecognition instance. Held across
    // restarts in continuous mode so session state
    // persists. Null when inactive.
    this._recognition = null;
    // Whether the user's toggle is ON. Separate from
    // `_state` — the recognition session can be in any
    // state while the toggle is ON (listening between
    // utterances, speaking during an utterance), but the
    // auto-restart loop only runs while the toggle is ON.
    this._active = false;
    // Handle for the restart timeout. Cleared on stop
    // so a pending restart doesn't fire after the user
    // toggles off.
    this._restartTimer = null;
  }

  // ---------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------

  connectedCallback() {
    super.connectedCallback();
    // Hide the host entirely when the browser doesn't
    // support speech recognition. Saves the chat panel
    // from rendering an action-bar button that can
    // never work.
    if (_getRecognitionCtor() === null) {
      this.hidden = true;
    }
  }

  disconnectedCallback() {
    // Ensure the mic is released even when the component
    // is removed mid-session (tab close, navigation,
    // test teardown).
    this._stopRecognition();
    super.disconnectedCallback();
  }

  // ---------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------

  /**
   * Whether speech recognition is supported in this
   * browser. Useful for tests and for future UI code
   * that wants to conditionally render fallback text.
   */
  static get isSupported() {
    return _getRecognitionCtor() !== null;
  }

  /**
   * Whether the dictation toggle is currently on.
   * Read-only from outside — use `toggle()` or the
   * button click to change state.
   */
  get active() {
    return this._active;
  }

  /**
   * Toggle dictation on or off. Exposed publicly so a
   * host can drive it programmatically (e.g. from a
   * keyboard shortcut) without simulating a click.
   */
  toggle() {
    if (this._active) {
      this._stopDictation();
    } else {
      this._startDictation();
    }
  }

  // ---------------------------------------------------------------
  // Recognition lifecycle
  // ---------------------------------------------------------------

  _startDictation() {
    const Ctor = _getRecognitionCtor();
    if (!Ctor) return;
    if (this._active) return;
    this._active = true;
    this._state = 'listening';
    this._startRecognition();
  }

  _stopDictation() {
    this._active = false;
    this._state = 'inactive';
    if (this._restartTimer != null) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    this._stopRecognition();
  }

  _startRecognition() {
    const Ctor = _getRecognitionCtor();
    if (!Ctor) return;
    // A new instance each cycle. Some browsers behave
    // oddly when a stopped recognition is restarted; a
    // fresh instance is simpler and the overhead is
    // negligible (these objects are light wrappers over
    // the native API).
    const rec = new Ctor();
    // continuous=false — see module docstring. The
    // auto-restart loop below gives us continuous feel
    // with predictable utterance boundaries.
    rec.continuous = false;
    rec.interimResults = false;
    // Use the browser's configured locale. Users in
    // non-English locales get the right recognition
    // model automatically.
    if (typeof navigator !== 'undefined' && navigator.language) {
      rec.lang = navigator.language;
    }
    rec.onaudiostart = () => {
      // Audio capture started but no speech detected yet.
      if (this._active) this._state = 'listening';
    };
    rec.onspeechstart = () => {
      if (this._active) this._state = 'speaking';
    };
    rec.onspeechend = () => {
      // Speech segment ended; recognition will fire
      // onresult and then onend.
      if (this._active) this._state = 'listening';
    };
    rec.onresult = (event) => {
      // Walk results array; only fire events for final
      // transcripts (interimResults=false means most
      // entries are final, but we check defensively).
      if (!event.results) return;
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result || !result.isFinal) continue;
        const transcript =
          result[0] && typeof result[0].transcript === 'string'
            ? result[0].transcript
            : '';
        if (!transcript) continue;
        this.dispatchEvent(
          new CustomEvent('transcript', {
            detail: { text: transcript },
            bubbles: true,
            composed: true,
          }),
        );
      }
    };
    rec.onerror = (event) => {
      // `no-speech` errors fire when continuous=false and
      // the user pauses too long — not actually an error,
      // just a cycle boundary. Let the auto-restart handle
      // it without notifying the user.
      const code = event && event.error ? event.error : '';
      if (code === 'no-speech' || code === 'aborted') {
        // Auto-restart will run via onend.
        return;
      }
      // Real error — stop and notify.
      this._active = false;
      this._state = 'inactive';
      this.dispatchEvent(
        new CustomEvent('recognition-error', {
          detail: { error: code || 'unknown' },
          bubbles: true,
          composed: true,
        }),
      );
    };
    rec.onend = () => {
      // Recognition cycle ended. If the user's toggle is
      // still on, schedule a restart. If toggled off, or
      // if an error killed the session, stop cleanly.
      this._recognition = null;
      if (!this._active) {
        this._state = 'inactive';
        return;
      }
      this._restartTimer = setTimeout(() => {
        this._restartTimer = null;
        if (this._active) this._startRecognition();
      }, _RESTART_DELAY_MS);
    };
    this._recognition = rec;
    try {
      rec.start();
    } catch (err) {
      // start() throws if called on an already-started
      // instance (shouldn't happen given our lifecycle)
      // or in some browsers when the mic permission is
      // denied synchronously.
      this._active = false;
      this._state = 'inactive';
      this._recognition = null;
      this.dispatchEvent(
        new CustomEvent('recognition-error', {
          detail: { error: err?.message || 'start failed' },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  _stopRecognition() {
    if (this._restartTimer != null) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    const rec = this._recognition;
    this._recognition = null;
    if (!rec) return;
    try {
      // Clear handlers before stop() so onend doesn't
      // trigger a restart after the user toggled off.
      rec.onaudiostart = null;
      rec.onspeechstart = null;
      rec.onspeechend = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.stop();
    } catch (_) {
      // stop() can throw if the session already ended;
      // harmless.
    }
  }

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------

  render() {
    const title = this._active
      ? 'Stop dictation'
      : 'Start voice dictation';
    return html`
      <button
        class="toggle ${this._active ? 'active' : ''}"
        @click=${this.toggle}
        aria-pressed=${this._active}
        aria-label=${title}
        title=${title}
      >
        <span
          class="led ${this._state === 'listening'
            ? 'listening'
            : this._state === 'speaking'
              ? 'speaking'
              : ''}"
          aria-hidden="true"
        ></span>
        🎤
      </button>
    `;
  }
}

customElements.define('ac-speech-to-text', SpeechToText);

// Exported for tests.
export { _RESTART_DELAY_MS, _getRecognitionCtor };