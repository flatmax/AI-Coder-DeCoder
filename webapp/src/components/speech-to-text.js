/**
 * Speech-to-text toggle button using the Web Speech API.
 * Continuous auto-transcribe mode: starts recognition, auto-restarts on
 * utterance end, dispatches `transcript` events with { text }.
 *
 * States:
 *   - inactive: not listening
 *   - listening: recognition active (orange pulse)
 *   - speaking: speech detected (green)
 */

import { LitElement, html, css } from 'lit';
import { theme } from '../styles/theme.js';

// Resolve the browser's SpeechRecognition constructor (Chromium prefixed)
const SpeechRecognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

export class AcSpeechToText extends LitElement {
  static properties = {
    _state: { type: String, state: true },   // 'inactive' | 'listening' | 'speaking'
    _supported: { type: Boolean, state: true },
  };

  static styles = [theme, css`
    :host {
      display: inline-flex;
      align-items: center;
    }

    button {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 1rem;
      width: 36px;
      height: 36px;
      border-radius: var(--radius-md);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      transition: color 0.15s, background 0.15s;
      flex-shrink: 0;
    }

    button:hover {
      background: var(--bg-tertiary);
      color: var(--text-primary);
    }

    /* Listening — orange pulsing */
    button.listening {
      color: var(--accent-orange);
      animation: pulse 1.5s ease-in-out infinite;
    }

    /* Speaking — green solid with glow */
    button.speaking {
      color: var(--accent-green);
      animation: none;
      box-shadow: 0 0 8px rgba(126, 231, 135, 0.5);
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  `];

  constructor() {
    super();
    this._state = 'inactive';
    this._autoRestart = false;
    this._recognition = null;

    this._supported = !!SpeechRecognition;

    if (this._supported) {
      this._recognition = new SpeechRecognition();
      this._recognition.continuous = false;
      this._recognition.interimResults = false;
      this._recognition.lang = navigator.language || 'en-US';

      this._recognition.onstart = () => {
        this._state = 'listening';
      };

      this._recognition.onspeechstart = () => {
        this._state = 'speaking';
      };

      this._recognition.onspeechend = () => {
        if (this._state === 'speaking') {
          this._state = 'listening';
        }
      };

      this._recognition.onresult = (event) => {
        const last = event.results[event.results.length - 1];
        if (last.isFinal) {
          const text = last[0].transcript.trim();
          if (text) {
            this.dispatchEvent(new CustomEvent('transcript', {
              detail: { text },
              bubbles: true,
              composed: true,
            }));
          }
        }
      };

      this._recognition.onend = () => {
        if (this._autoRestart) {
          setTimeout(() => {
            if (this._autoRestart) {
              try {
                this._recognition.start();
              } catch (e) {
                console.warn('[SpeechToText] Auto-restart failed:', e);
                this._autoRestart = false;
                this._state = 'inactive';
              }
            }
          }, 100);
        } else {
          this._state = 'inactive';
        }
      };

      this._recognition.onerror = (event) => {
        // 'no-speech' and 'aborted' are non-fatal during auto-restart
        if (this._autoRestart && (event.error === 'no-speech' || event.error === 'aborted')) {
          return; // onend will handle restart
        }

        console.warn('[SpeechToText] Recognition error:', event.error);
        this._autoRestart = false;
        this._state = 'inactive';

        this.dispatchEvent(new CustomEvent('speech-error', {
          detail: { error: event.error },
          bubbles: true,
          composed: true,
        }));
      };
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._autoRestart = false;
    if (this._recognition) {
      try { this._recognition.stop(); } catch (_) { /* ignore */ }
    }
    this._state = 'inactive';
  }

  _toggle() {
    if (!this._recognition) return;

    if (this._autoRestart || this._state !== 'inactive') {
      // Turn OFF
      this._autoRestart = false;
      try { this._recognition.stop(); } catch (_) { /* ignore */ }
      this._state = 'inactive';
    } else {
      // Turn ON
      this._autoRestart = true;
      try {
        this._recognition.start();
      } catch (e) {
        console.warn('[SpeechToText] Failed to start:', e);
        this._autoRestart = false;
        this._state = 'inactive';
      }
    }
  }

  render() {
    if (!this._supported) return html``;

    return html`
      <button
        class=${this._state}
        @click=${this._toggle}
        title=${this._state === 'inactive' ? 'Start voice dictation' : 'Stop voice dictation'}
        aria-label=${this._state === 'inactive' ? 'Start voice dictation' : 'Stop voice dictation'}
        aria-pressed=${this._state !== 'inactive'}
      >🎤</button>
    `;
  }
}

customElements.define('ac-speech-to-text', AcSpeechToText);