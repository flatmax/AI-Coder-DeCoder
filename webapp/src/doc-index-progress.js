// DocIndexProgress — floating overlay during doc-index work.
//
// Two phases that share the same overlay slot:
//
// 1. Structural extraction — builds doc outlines from markdown
//    and SVG files. Fast (< 1 second for reasonable repos) but
//    worth showing so the user knows doc mode / cross-reference
//    isn't yet available.
//
// 2. Keyword enrichment — runs KeyBERT on each outline. Slow
//    (can take minutes on large repos). Per-file progress
//    events drive a determinate progress bar.
//
// The component mirrors CompactionProgress's state machine
// (hidden / active / success / error) and fade timing, but
// adds a percent-driven progress bar for the enrichment phase.
//
// Event channel: window event `doc-index-progress` with
// detail `{ stage, message, percent }`. The app shell
// intercepts doc-index-related `startupProgress` events and
// re-dispatches them under this channel. This keeps the
// component agnostic to the underlying RPC plumbing — it only
// sees the filtered subset of events it cares about.
//
// Governing plan: IMPLEMENTATION_NOTES.md § "Keyword enrichment
// UX completion plan" § "Step 2a — Frontend progress overlay".
//
// Scope boundaries — what this component does NOT do:
//   - Toast dispatch. The "unavailable" state is communicated
//     via the shell's toast system (Step 2b), not here.
//     Availability failures surface as an error state with a
//     hint message; a separate toast handles the install
//     guidance.
//   - Cancel / retry. The backend's enrichment loop can't be
//     cancelled from the frontend — no user affordance.
//   - Startup overlay dismissal. The shell's existing
//     startupProgress handler dismisses the overlay on the
//     `ready` stage; doc-index stages are filtered OUT of the
//     startup-overlay path entirely.

import { LitElement, css, html } from 'lit';

/**
 * How long the "Done" success state stays visible before
 * fade-out begins. Matches compaction-progress for visual
 * consistency.
 */
const _SUCCESS_DISPLAY_MS = 800;

/** CSS transition duration for fade-out. Matches the style rule. */
const _FADE_DURATION_MS = 400;

/**
 * Error display duration — longer than success so the user
 * can read the message. The overlay still fades after this.
 */
const _ERROR_DISPLAY_MS = 5000;

/**
 * Stages we care about. All other stages on the channel (if
 * any) are silently ignored. Kept as a set for O(1) lookup
 * rather than a cascade of string comparisons.
 */
const _OUR_STAGES = new Set([
  'doc_index',
  'doc_index_error',
  'doc_enrichment_queued',
  'doc_enrichment_file_done',
  'doc_enrichment_complete',
]);

export class DocIndexProgress extends LitElement {
  static properties = {
    /**
     * Visible state. `hidden` suppresses render entirely;
     * `active` shows spinner + progress; `success` and
     * `error` show a completion caption before fading out.
     */
    _state: { type: String, state: true },
    /** Human-readable message from the current event. */
    _message: { type: String, state: true },
    /** 0–100 integer for the determinate progress bar. */
    _percent: { type: Number, state: true },
    /** Completion caption — set on success or error entry. */
    _caption: { type: String, state: true },
    /** True while the fade-out CSS transition is running. */
    _fading: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      /* Inline element inside the dialog. Sits above the
       * thin compaction-capacity bar at the dialog bottom.
       * No fixed positioning — the overlay flows with the
       * dialog layout and hides cleanly when _state is
       * 'hidden' (render returns an empty template). */
      display: block;
      flex-shrink: 0;
    }

    .overlay {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      background: rgba(22, 27, 34, 0.96);
      border-top: 1px solid rgba(240, 246, 252, 0.1);
      border-left: 3px solid var(--accent-primary, #58a6ff);
      padding: 0.5rem 1rem;
      font-size: 0.8125rem;
      color: var(--text-primary, #c9d1d9);
      opacity: 1;
      transition: opacity 400ms ease-out;
    }

    .overlay.fading {
      opacity: 0;
    }

    .overlay.success {
      border-left-color: #7ee787;
    }

    .overlay.error {
      border-left-color: #f85149;
    }

    .row {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }

    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(240, 246, 252, 0.2);
      border-top-color: var(--accent-primary, #58a6ff);
      border-radius: 50%;
      animation: spin 800ms linear infinite;
      flex-shrink: 0;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .glyph {
      font-size: 1rem;
      line-height: 1;
      flex-shrink: 0;
    }

    .label {
      flex: 1;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .percent {
      opacity: 0.6;
      font-variant-numeric: tabular-nums;
      flex-shrink: 0;
    }

    /* Determinate progress bar — only shown in active state
     * when percent > 0. The fill transitions smoothly between
     * values so the bar doesn't jump jarringly on each
     * per-file event. */
    .bar {
      height: 3px;
      background: rgba(240, 246, 252, 0.08);
      border-radius: 2px;
      overflow: hidden;
    }

    .bar-fill {
      height: 100%;
      background: var(--accent-primary, #58a6ff);
      transition: width 300ms ease-out;
    }

    .hint {
      font-size: 0.75rem;
      opacity: 0.7;
    }
  `;

  constructor() {
    super();
    this._state = 'hidden';
    this._message = '';
    this._percent = 0;
    this._caption = '';
    this._fading = false;
    // Timeout handles for the success/error → fade → hidden
    // chain. Cleared on state transition and disconnect.
    this._exitTimer = null;
    this._fadeTimer = null;
    this._onProgressEvent = this._onProgressEvent.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(
      'doc-index-progress', this._onProgressEvent,
    );
  }

  disconnectedCallback() {
    window.removeEventListener(
      'doc-index-progress', this._onProgressEvent,
    );
    this._clearTimers();
    super.disconnectedCallback();
  }

  // ---------------------------------------------------------------
  // Event handling
  // ---------------------------------------------------------------

  /**
   * Route a `doc-index-progress` window event.
   *
   * Stages are routed per the plan:
   *   - `doc_index` — structural extraction active
   *   - `doc_index_error` → error state
   *   - `doc_enrichment_queued` — enrichment begins
   *   - `doc_enrichment_file_done` — per-file progress
   *   - `doc_enrichment_complete` → success state
   */
  _onProgressEvent(event) {
    const detail = event.detail || {};
    const stage = detail.stage;
    if (!stage || !_OUR_STAGES.has(stage)) return;

    const message = typeof detail.message === 'string'
      ? detail.message
      : '';
    const percent = typeof detail.percent === 'number'
      ? Math.max(0, Math.min(100, detail.percent))
      : 0;

    switch (stage) {
      case 'doc_index':
      case 'doc_enrichment_queued':
      case 'doc_enrichment_file_done':
        this._enterActive(message, percent);
        return;
      case 'doc_enrichment_complete':
        this._enterSuccess(message || 'Doc index ready');
        return;
      case 'doc_index_error':
        this._enterError(
          message || 'Doc index failed',
        );
        return;
      default:
        return;
    }
  }

  // ---------------------------------------------------------------
  // State transitions
  // ---------------------------------------------------------------

  _enterActive(message, percent) {
    this._clearTimers();
    this._state = 'active';
    this._message = message;
    this._percent = percent;
    this._caption = '';
    this._fading = false;
  }

  _enterSuccess(caption) {
    this._clearTimers();
    this._state = 'success';
    this._caption = caption;
    this._percent = 100;
    this._fading = false;
    this._scheduleExit(_SUCCESS_DISPLAY_MS);
  }

  _enterError(caption) {
    this._clearTimers();
    this._state = 'error';
    this._caption = caption;
    this._fading = false;
    this._scheduleExit(_ERROR_DISPLAY_MS);
  }

  /**
   * Start the display → fade → hidden chain.
   *
   * displayMs after entry → flip `_fading = true` (CSS
   *   transition kicks in, opacity 1 → 0).
   * displayMs + _FADE_DURATION_MS → flip `_state = 'hidden'`
   *   so the element stops rendering.
   */
  _scheduleExit(displayMs) {
    this._exitTimer = setTimeout(() => {
      this._exitTimer = null;
      this._fading = true;
      this._fadeTimer = setTimeout(() => {
        this._fadeTimer = null;
        this._state = 'hidden';
        this._fading = false;
      }, _FADE_DURATION_MS);
    }, displayMs);
  }

  _clearTimers() {
    if (this._exitTimer != null) {
      clearTimeout(this._exitTimer);
      this._exitTimer = null;
    }
    if (this._fadeTimer != null) {
      clearTimeout(this._fadeTimer);
      this._fadeTimer = null;
    }
  }

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------

  render() {
    if (this._state === 'hidden') return html``;
    const classes = [
      'overlay',
      this._state === 'success' ? 'success' : '',
      this._state === 'error' ? 'error' : '',
      this._fading ? 'fading' : '',
    ].filter(Boolean).join(' ');
    return html`
      <div class=${classes} role="status" aria-live="polite">
        <div class="row">
          ${this._renderIcon()}
          ${this._renderLabel()}
          ${this._renderPercent()}
        </div>
        ${this._renderBar()}
      </div>
    `;
  }

  _renderIcon() {
    if (this._state === 'active') {
      return html`<div class="spinner" aria-hidden="true"></div>`;
    }
    if (this._state === 'success') {
      return html`<span class="glyph" aria-hidden="true">✓</span>`;
    }
    // error
    return html`<span class="glyph" aria-hidden="true">⚠</span>`;
  }

  _renderLabel() {
    const text = this._state === 'active'
      ? (this._message || 'Indexing documentation…')
      : this._caption;
    return html`<span class="label">${text}</span>`;
  }

  _renderPercent() {
    // Only show the number during active state when the
    // event carried a meaningful percent. 0% means "just
    // started" — not worth showing as a digit.
    if (this._state !== 'active') return '';
    if (this._percent <= 0) return '';
    return html`<span class="percent">${this._percent}%</span>`;
  }

  _renderBar() {
    // Bar visible during active state only, and only when
    // percent is meaningful. Success / error frames skip the
    // bar since the content has collapsed to a single line.
    if (this._state !== 'active') return '';
    if (this._percent <= 0) return '';
    return html`
      <div class="bar">
        <div class="bar-fill" style="width: ${this._percent}%"></div>
      </div>
    `;
  }
}

customElements.define('ac-doc-index-progress', DocIndexProgress);