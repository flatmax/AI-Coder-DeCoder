import { LitElement, html, css } from 'lit';

/**
 * Speech-to-text toggle button using the Web Speech API.
 * Dispatches `transcript` events with recognized text.
 *
 * States:
 *   - inactive: not listening
 *   - listening: recognition active (orange pulse)
 *   - speaking: speech detected (green)
 */
class SpeechToText extends LitElement {
  static properties = {
    _state: { type: String, state: true }, // 'inactive' | 'listening' | 'speaking'
    _supported: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      display: inline-flex;
    }

    button {
      background: none;
      border: 1px solid var(--border-color, #444);
      border-radius: var(--radius-sm, 4px);
      padding: 4px 8px;
      cursor: pointer;
      font-size: 16px;
      color: var(--text-secondary, #aaa);
      transition: background 0.15s, color 0.15s, border-color 0.15s, box-shadow 0.15s;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    button:hover {
      background: var(--bg-surface, #2a2a2a);
      color: var(--text-primary, #eee);
    }

    button.listening {
      color: #f59e0b;
      border-color: #f59e0b;
      animation: pulse 1.5s ease-in-out infinite;
    }

    button.speaking {
      color: #22c55e;
      border-color: #22c55e;
      animation: none;
      box-shadow: 0 0 6px rgba(34, 197, 94, 0.4);
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    button:disabled {
      display: none;
    }
  `;

  constructor() {
    super();
    this._state = 'inactive';
    this._autoRestart = false;
    this._recognition = null;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this._supported = !!SpeechRecognition;

    if (this._supported) {
      this._recognition = new SpeechRecognition();
      this._recognition.continuous = false;
      this._recognition.interimResults = false;
      this._recognition.lang = navigator.language;

      this._recognition.onstart = () => {
        this._state = 'listening';
      };

      this._recognition.onspeechstart = () => {
        this._state = 'speaking';
      };

      this._recognition.onspeechend = () => {
        // Revert to listening while recognition finishes processing
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
        this._handleEnd();
      };

      this._recognition.onerror = (event) => {
        // 'no-speech' and 'aborted' are non-fatal during auto-restart
        if (this._autoRestart && (event.error === 'no-speech' || event.error === 'aborted')) {
          // Let onend handle the restart
          return;
        }
        console.warn('[SpeechToText] Recognition error:', event.error);
        this._autoRestart = false;
        this._state = 'inactive';
        this.dispatchEvent(new CustomEvent('recognition-error', {
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

  _handleEnd() {
    if (this._autoRestart) {
      // Auto-restart after a short delay for continuous dictation feel
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

customElements.define('speech-to-text', SpeechToText);