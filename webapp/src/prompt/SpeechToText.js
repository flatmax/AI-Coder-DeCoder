/**
 * SpeechToText component for voice input
 * Based on the original from aider/gui_speech_to_text.js
 */
import { LitElement, html, css } from 'lit';

export class SpeechToText extends LitElement {
  static properties = {
    isListening: { type: Boolean, state: true },
    autoTranscribe: { type: Boolean, state: true },
    isSupported: { type: Boolean, state: true },
    ledStatus: { type: String, state: true } // 'inactive', 'listening', 'speaking'
  };

  constructor() {
    super();
    this.isListening = false;
    this.autoTranscribe = false;
    this.isSupported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
    this.ledStatus = 'inactive';
    this.recognition = null;
    this._initSpeechRecognition();
  }

  static styles = css`
    :host {
      display: inline-flex;
    }

    .mic-btn {
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 4px;
      padding: 8px 12px;
      cursor: pointer;
      font-size: 16px;
      transition: all 0.2s ease;
    }

    .mic-btn:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .mic-btn.listening {
      background: rgba(255, 152, 0, 0.3);
      border-color: #ff9800;
      animation: pulse 1.5s infinite;
    }

    .mic-btn.speaking {
      background: rgba(76, 175, 80, 0.3);
      border-color: #4caf50;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }

    .mic-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    if (!this.isSupported) return;
    if (!this.recognition) {
      this._initSpeechRecognition();
    }
  }

  disconnectedCallback() {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {
        // Ignore errors when stopping
      }
    }
    super.disconnectedCallback();
  }

  _initSpeechRecognition() {
    if (!this.isSupported) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();
    
    // Configure recognition
    this.recognition.continuous = false;
    this.recognition.interimResults = false;
    this.recognition.lang = navigator.language || 'en-US';
    
    // Set up event handlers
    this.recognition.onstart = this._handleStart.bind(this);
    this.recognition.onresult = this._handleResult.bind(this);
    this.recognition.onerror = this._handleError.bind(this);
    this.recognition.onend = this._handleEnd.bind(this);
    this.recognition.onspeechstart = this._handleSpeechStart.bind(this);
    this.recognition.onspeechend = this._handleSpeechEnd.bind(this);
  }

  _handleStart() {
    this.isListening = true;
    this.ledStatus = 'listening';
    this.dispatchEvent(new CustomEvent('recording-started', {
      bubbles: true,
      composed: true
    }));
  }

  _handleSpeechStart() {
    this.ledStatus = 'speaking';
  }

  _handleSpeechEnd() {
    if (this.autoTranscribe && this.isListening) {
      this.ledStatus = 'listening';
    }
  }

  _handleResult(event) {
    if (event.results.length > 0) {
      const transcript = event.results[event.resultIndex][0].transcript;
      
      // Dispatch event with transcript
      this.dispatchEvent(new CustomEvent('transcript', {
        detail: { text: transcript },
        bubbles: true,
        composed: true
      }));
      
      // If not auto-transcribing, stop listening
      if (!this.autoTranscribe) {
        this.stopListening();
      }
    }
  }

  _handleError(event) {
    console.error('Speech recognition error:', event.error);
    this.stopListening();
    
    this.dispatchEvent(new CustomEvent('recognition-error', {
      detail: { error: event.error },
      bubbles: true,
      composed: true
    }));
  }

  _handleEnd() {
    // If auto-transcribe is enabled and we were listening, restart
    if (this.autoTranscribe && this.isListening) {
      setTimeout(() => {
        try {
          this.recognition.start();
        } catch (e) {
          console.error('Error restarting recognition:', e);
          this.isListening = false;
          this.ledStatus = 'inactive';
        }
      }, 100);
    } else {
      this.isListening = false;
      this.ledStatus = 'inactive';
    }
  }

  startListening() {
    if (!this.isSupported || this.isListening) {
      return;
    }
    
    try {
      this.recognition.start();
    } catch (e) {
      console.error('Error starting recognition:', e);
    }
  }

  stopListening() {
    if (!this.isSupported || !this.isListening) {
      return;
    }
    
    try {
      this.recognition.stop();
    } catch (e) {
      console.error('Error stopping recognition:', e);
      // Force status update even if error
      this.isListening = false;
      this.ledStatus = 'inactive';
    }
  }

  _toggleListening() {
    if (this.isListening) {
      this.stopListening();
    } else {
      this.startListening();
    }
  }

  _toggleAutoTranscribe() {
    this.autoTranscribe = !this.autoTranscribe;
    
    if (this.autoTranscribe) {
      this.startListening();
    } else {
      this.stopListening();
    }
  }

  render() {
    if (!this.isSupported) {
      return html``;
    }

    const btnClass = this.ledStatus === 'speaking' ? 'speaking' : 
                     this.isListening ? 'listening' : '';

    return html`
      <button 
        class="mic-btn ${btnClass}"
        @click=${this._toggleAutoTranscribe}
        title=${this.autoTranscribe ? 'Stop auto-transcribe' : 'Enable auto-transcribe (continuous listening)'}
      >🎤</button>
    `;
  }
}

customElements.define('speech-to-text', SpeechToText);
