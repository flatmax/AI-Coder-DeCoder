// SpeechControls — a floating, draggable transport for the
// read-aloud feature.
//
// Renders nothing until speech starts. While the
// SpeechPlayer (speech-player.js) is active it shows a
// small panel with:
//
//   - prev / play-pause / next sentence buttons
//   - a speed slider (0.5×–1.5×) with a live readout
//   - a clickable sentence-progress bar (click to seek)
//   - a close button that stops playback
//
// It's a sibling overlay (mounted by the app shell, same
// as ac-cache-warmup-progress) rather than living inside
// the chat panel, so it floats above the whole app and
// survives tab switches. It holds no playback state of its
// own — it reflects the `speech-player-state` window event
// and drives the player through its imperative methods.
//
// Dragging: pointer events on the header move the panel.
// Position is remembered across the session in
// localStorage so it reappears where the user left it. The
// panel is clamped into the viewport on drag-end so it can
// never be dragged fully off-screen.

import { LitElement, css, html } from 'lit';

import {
  MAX_RATE,
  MIN_RATE,
  SPEECH_STATE_EVENT,
  speechPlayer,
} from './speech-player.js';

/** localStorage key for the remembered panel position. */
const _POS_KEY = 'ac-dc-speech-controls-pos';

/** Margin (px) kept between the panel and the viewport edge. */
const _EDGE_MARGIN = 8;

export class SpeechControls extends LitElement {
  static properties = {
    /** Mirror of speechPlayer.state — drives the render. */
    _state: { type: Object, state: true },
    /** Current panel offset, {x, y} in px from top-left. */
    _pos: { type: Object, state: true },
    /** True while a header drag is in progress. */
    _dragging: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      position: fixed;
      top: 0;
      left: 0;
      z-index: 600;
      /* Positioned via transform from the _pos offset. */
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      width: 248px;
      background: rgba(22, 27, 34, 0.97);
      border: 1px solid rgba(240, 246, 252, 0.18);
      border-left: 3px solid var(--accent-primary, #58a6ff);
      border-radius: 6px;
      padding: 0.5rem 0.7rem 0.6rem;
      font-size: 0.8125rem;
      color: var(--text-primary, #c9d1d9);
      backdrop-filter: blur(8px);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
      user-select: none;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      cursor: grab;
      touch-action: none;
    }

    .header.dragging { cursor: grabbing; }

    .grip {
      letter-spacing: 1px;
      opacity: 0.5;
      flex-shrink: 0;
      line-height: 1;
    }

    .title {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      opacity: 0.85;
    }

    .close {
      background: none;
      border: none;
      color: inherit;
      cursor: pointer;
      font-size: 0.9rem;
      line-height: 1;
      padding: 2px 4px;
      border-radius: 4px;
      opacity: 0.7;
      flex-shrink: 0;
    }
    .close:hover { opacity: 1; background: rgba(240, 246, 252, 0.1); }

    .transport {
      display: flex;
      align-items: center;
      gap: 0.3rem;
    }

    .tbtn {
      background: rgba(240, 246, 252, 0.06);
      border: 1px solid rgba(240, 246, 252, 0.12);
      color: inherit;
      cursor: pointer;
      font-size: 0.95rem;
      line-height: 1;
      padding: 4px 8px;
      border-radius: 5px;
    }
    .tbtn:hover { background: rgba(240, 246, 252, 0.14); }
    .tbtn:disabled { opacity: 0.35; cursor: default; }

    .tbtn.play {
      flex-shrink: 0;
      min-width: 34px;
      border-color: var(--accent-primary, #58a6ff);
    }

    .counter {
      margin-left: auto;
      font-variant-numeric: tabular-nums;
      opacity: 0.7;
      font-size: 0.75rem;
      flex-shrink: 0;
    }

    .speed {
      display: flex;
      align-items: center;
      gap: 0.45rem;
    }

    .speed label {
      opacity: 0.7;
      flex-shrink: 0;
      font-size: 0.75rem;
    }

    .speed input[type='range'] {
      flex: 1;
      accent-color: var(--accent-primary, #58a6ff);
      cursor: pointer;
      min-width: 0;
    }

    .speed .readout {
      font-variant-numeric: tabular-nums;
      width: 2.6em;
      text-align: right;
      flex-shrink: 0;
      font-size: 0.75rem;
    }

    .progress {
      height: 6px;
      background: rgba(240, 246, 252, 0.12);
      border-radius: 3px;
      overflow: hidden;
      cursor: pointer;
    }

    .progress-fill {
      height: 100%;
      background: var(--accent-primary, #58a6ff);
      transition: width 120ms linear;
    }

    @media (prefers-reduced-motion: reduce) {
      .progress-fill { transition: none; }
    }
  `;

  constructor() {
    super();
    this._state = speechPlayer.state;
    this._pos = _loadPos();
    this._dragging = false;
    // Drag bookkeeping — pointer offset within the header
    // at grab time, so the panel tracks the cursor without
    // jumping.
    this._dragDX = 0;
    this._dragDY = 0;
    this._onPlayerState = this._onPlayerState.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(SPEECH_STATE_EVENT, this._onPlayerState);
    // Reflect whatever the player is doing right now (it may
    // already be active if this element mounts late).
    this._state = speechPlayer.state;
  }

  disconnectedCallback() {
    window.removeEventListener(SPEECH_STATE_EVENT, this._onPlayerState);
    this._teardownDragListeners();
    super.disconnectedCallback();
  }

  // -----------------------------------------------------------
  // Player state
  // -----------------------------------------------------------

  _onPlayerState(event) {
    this._state = event.detail || speechPlayer.state;
    // First activation with no saved position — drop the
    // panel in the bottom-right, above the cache-warmup
    // overlay's lane.
    if (this._state.active && !this._pos) {
      this._pos = _defaultPos();
    }
  }

  // -----------------------------------------------------------
  // Drag handling
  // -----------------------------------------------------------

  _onHeaderPointerDown(event) {
    // Ignore drags that start on the close button.
    if (event.target.closest('.close')) return;
    event.preventDefault();
    const rect = this.getBoundingClientRect();
    this._dragDX = event.clientX - rect.left;
    this._dragDY = event.clientY - rect.top;
    this._dragging = true;
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
  }

  _onPointerMove(event) {
    if (!this._dragging) return;
    this._pos = {
      x: event.clientX - this._dragDX,
      y: event.clientY - this._dragDY,
    };
  }

  _onPointerUp() {
    if (!this._dragging) return;
    this._dragging = false;
    this._teardownDragListeners();
    this._pos = _clampToViewport(this._pos, this.getBoundingClientRect());
    _savePos(this._pos);
  }

  _teardownDragListeners() {
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
  }

  // -----------------------------------------------------------
  // Control handlers
  // -----------------------------------------------------------

  _onSeekClick(event) {
    const total = this._state.total;
    if (!total) return;
    const bar = event.currentTarget;
    const rect = bar.getBoundingClientRect();
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    const index = Math.floor(Math.min(0.9999, Math.max(0, ratio)) * total);
    speechPlayer.seek(index);
  }

  _onRateInput(event) {
    speechPlayer.setRate(parseFloat(event.target.value));
  }

  // -----------------------------------------------------------
  // Render
  // -----------------------------------------------------------

  render() {
    const s = this._state;
    if (!s || !s.active) return html``;
    const pos = this._pos || _defaultPos();
    const playing = s.status === 'playing';
    const total = s.total || 0;
    const human = total > 0 ? s.index + 1 : 0;
    const fill = total > 0 ? ((s.index + 1) / total) * 100 : 0;
    const rate = s.rate || 1;
    return html`
      <div
        class="panel"
        style="transform: translate(${pos.x}px, ${pos.y}px);"
        role="group"
        aria-label="Read-aloud controls"
      >
        <div
          class="header ${this._dragging ? 'dragging' : ''}"
          @pointerdown=${(e) => this._onHeaderPointerDown(e)}
        >
          <span class="grip" aria-hidden="true">⠿</span>
          <span class="title">${s.label || 'Reading aloud'}</span>
          <button
            class="close"
            title="Stop reading"
            aria-label="Stop reading"
            @click=${() => speechPlayer.stop()}
          >
            ✕
          </button>
        </div>

        <div class="transport">
          <button
            class="tbtn"
            title="Previous sentence"
            aria-label="Previous sentence"
            ?disabled=${s.index <= 0}
            @click=${() => speechPlayer.prev()}
          >
            ⏮
          </button>
          <button
            class="tbtn play"
            title=${playing ? 'Pause' : 'Play'}
            aria-label=${playing ? 'Pause' : 'Play'}
            @click=${() => speechPlayer.toggle()}
          >
            ${playing ? '⏸' : '▶'}
          </button>
          <button
            class="tbtn"
            title="Next sentence"
            aria-label="Next sentence"
            ?disabled=${total > 0 && s.index >= total - 1}
            @click=${() => speechPlayer.next()}
          >
            ⏭
          </button>
          <span class="counter" aria-hidden="true">${human}/${total}</span>
        </div>

        <div class="speed">
          <label for="speech-rate">Speed</label>
          <input
            id="speech-rate"
            type="range"
            min=${MIN_RATE}
            max=${MAX_RATE}
            step="0.1"
            .value=${String(rate)}
            aria-label="Playback speed"
            @input=${(e) => this._onRateInput(e)}
          />
          <span class="readout">${rate.toFixed(1)}×</span>
        </div>

        <div
          class="progress"
          role="slider"
          aria-label="Sentence position"
          aria-valuemin="1"
          aria-valuemax=${total}
          aria-valuenow=${human}
          @click=${(e) => this._onSeekClick(e)}
        >
          <div class="progress-fill" style="width: ${fill}%;"></div>
        </div>
      </div>
    `;
  }
}

// ---------------------------------------------------------------
// Position persistence
// ---------------------------------------------------------------

/** Bottom-right default, above the cache-warmup lane. */
function _defaultPos() {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  const w = 248;
  return {
    x: Math.max(_EDGE_MARGIN, window.innerWidth - w - 16),
    y: Math.max(_EDGE_MARGIN, window.innerHeight - 180),
  };
}

function _loadPos() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(_POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number'
    ) {
      return parsed;
    }
  } catch (_) {
    // Corrupt entry — ignore and fall back to default.
  }
  return null;
}

function _savePos(pos) {
  if (typeof localStorage === 'undefined' || !pos) return;
  try {
    localStorage.setItem(_POS_KEY, JSON.stringify(pos));
  } catch (_) {
    // Storage full / unavailable — non-fatal.
  }
}

/**
 * Keep the panel within the viewport. `rect` is the
 * panel's measured box; we clamp its top-left so at least
 * the header stays reachable on every edge.
 */
function _clampToViewport(pos, rect) {
  if (typeof window === 'undefined' || !pos) return pos;
  const maxX = window.innerWidth - rect.width - _EDGE_MARGIN;
  const maxY = window.innerHeight - rect.height - _EDGE_MARGIN;
  return {
    x: Math.min(Math.max(_EDGE_MARGIN, pos.x), Math.max(_EDGE_MARGIN, maxX)),
    y: Math.min(Math.max(_EDGE_MARGIN, pos.y), Math.max(_EDGE_MARGIN, maxY)),
  };
}

customElements.define('ac-speech-controls', SpeechControls);
