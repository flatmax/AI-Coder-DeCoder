// CompactionProgress — floating overlay during history compaction.
//
// The compactor runs after an assistant response completes, and
// on a long history it can take 10-30 seconds to finish the
// blocking LLM-based topic-boundary detection call. During that
// window the UI would otherwise appear hung — the toast that
// ChatPanel emits is transient (3s) and doesn't convey progress.
//
// This component sits in the top-center of the viewport, shows
// a spinner with an elapsed-seconds counter that ticks once per
// second, and stays visible until the corresponding
// `compacted` / `compaction_error` event fires. On success it
// briefly shows "Done — {case}" and fades out; on error it shows
// the error message for 3s and fades out.
//
// Governing spec: IMPLEMENTATION_NOTES.md § "Compaction UI
// completion plan" § "Increment A — Progress overlay during
// compaction".
//
// Scope boundaries — what this component does NOT do:
//   - URL fetch events (`url_fetch` / `url_ready`) — those use
//     the same channel but belong to URL fetching. Filtered out.
//   - Toast dispatch — ChatPanel already emits its own transient
//     toasts. This is a parallel feedback channel, not a
//     replacement.
//   - Retry / cancel — the detector call is synchronous from
//     the backend's perspective. No user affordance.

import { LitElement, css, html } from 'lit';

/**
 * How long the "Done — {case}" success state stays visible
 * before fade-out begins. Long enough for the user to
 * register what happened, short enough to not linger.
 */
const _SUCCESS_DISPLAY_MS = 800;

/** CSS transition duration for fade-out. Matches the style rule. */
const _FADE_DURATION_MS = 400;

/**
 * Error display duration — longer than success so the user can
 * read the message. The overlay still fades after this.
 */
const _ERROR_DISPLAY_MS = 3000;

/**
 * Human-readable label for each compaction case.
 * Mirrors the toast phrasing in ChatPanel._onCompactionEvent so
 * the overlay and toast agree on what happened.
 */
const _CASE_LABELS = {
  truncate: 'truncated at topic boundary',
  summarize: 'summarised',
};

export class CompactionProgress extends LitElement {
  static properties = {
    /**
     * Visible state drives the render gate and the fade
     * animation. `active` = in progress; `success` = briefly
     * showing done; `error` = showing error; `hidden` = not
     * rendered at all.
     */
    _state: { type: String, state: true },
    /** Elapsed seconds since `compacting` fired. */
    _elapsed: { type: Number, state: true },
    /**
     * Completion caption — `"Done — summarised"` or
     * `"Compaction failed: {reason}"`. Only read when
     * `_state` is `success` or `error`.
     */
    _caption: { type: String, state: true },
    /** True while the fade-out CSS transition is running. */
    _fading: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      position: fixed;
      /* Anchored below the doc-index progress overlay (top: 1rem).
       * Doc-index work can run for minutes; keeping its slot at
       * the top makes it the primary indicator when both are
       * active. Compaction is brief and is OK displaced
       * slightly further down. */
      top: 4rem;
      left: 50%;
      transform: translateX(-50%);
      /* Above the dialog (z-index 10) but below the startup
       * overlay (1000) and toast layer (2000). Matches the
       * "transient foreground" band. */
      z-index: 500;
      pointer-events: none;
    }

    .overlay {
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
      background: rgba(22, 27, 34, 0.96);
      border: 1px solid rgba(240, 246, 252, 0.18);
      border-left: 3px solid var(--accent-primary, #58a6ff);
      border-radius: 6px;
      padding: 0.6rem 1rem;
      font-size: 0.875rem;
      color: var(--text-primary, #c9d1d9);
      backdrop-filter: blur(8px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
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

    /* Spinner — simple rotating border. Only visible during
     * the active state; success/error show a static glyph. */
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
      white-space: nowrap;
    }

    .elapsed {
      opacity: 0.6;
      font-variant-numeric: tabular-nums;
      margin-left: 0.25rem;
    }
  `;

  constructor() {
    super();
    this._state = 'hidden';
    this._elapsed = 0;
    this._caption = '';
    this._fading = false;
    // Interval handle for the elapsed-seconds counter. Cleared
    // on state transition and on disconnect.
    this._tickInterval = null;
    // Timeout handle for the "success display → fade → hide"
    // transition chain. Also cleared on disconnect so a
    // disconnect mid-chain doesn't leak the fade-then-hide
    // callbacks to a detached element.
    this._exitTimer = null;
    this._fadeTimer = null;
    // Bound so addEventListener / removeEventListener match.
    this._onCompactionEvent = this._onCompactionEvent.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(
      'compaction-event', this._onCompactionEvent,
    );
  }

  disconnectedCallback() {
    window.removeEventListener(
      'compaction-event', this._onCompactionEvent,
    );
    this._clearTimers();
    super.disconnectedCallback();
  }

  // ---------------------------------------------------------------
  // Event handling
  // ---------------------------------------------------------------

  /**
   * Route a `compaction-event` window event.
   *
   * Stages we care about:
   *   - `compacting` → enter active state, start ticking
   *   - `compacted` → enter success state for
   *     `_SUCCESS_DISPLAY_MS`, then fade → hide
   *   - `compaction_error` → enter error state for
   *     `_ERROR_DISPLAY_MS`, then fade → hide
   *
   * All other stages (notably `url_fetch`/`url_ready`) are
   * silently ignored — they share the channel but belong to
   * URL fetching, which has its own UI surface in ChatPanel.
   */
  _onCompactionEvent(event) {
    const detail = event.detail || {};
    const payload = detail.event;
    if (!payload || typeof payload !== 'object') return;
    const stage = payload.stage;
    if (!stage) return;

    switch (stage) {
      case 'compacting':
        this._enterActive();
        return;
      case 'compacted': {
        const caseName = payload.case;
        const label = _CASE_LABELS[caseName] || 'complete';
        this._enterSuccess(`Done — ${label}`);
        return;
      }
      case 'compaction_error': {
        const reason = payload.error || 'unknown error';
        this._enterError(`Compaction failed: ${reason}`);
        return;
      }
      default:
        // url_fetch / url_ready / anything else — not ours.
        return;
    }
  }

  // ---------------------------------------------------------------
  // State transitions
  // ---------------------------------------------------------------

  _enterActive() {
    this._clearTimers();
    this._state = 'active';
    this._elapsed = 0;
    this._caption = '';
    this._fading = false;
    // Tick once per second. The counter starts at 0 and
    // increments on each tick so the first visible value is
    // 1 after a second — matches how users intuitively read
    // stopwatch displays.
    this._tickInterval = setInterval(() => {
      this._elapsed = this._elapsed + 1;
    }, 1000);
  }

  _enterSuccess(caption) {
    this._clearTimers();
    this._state = 'success';
    this._caption = caption;
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
   * Start the display → fade → hidden chain. Two timers:
   *
   *   displayMs after entry → flip `_fading = true` (CSS
   *     transition kicks in, opacity 1 → 0 over
   *     _FADE_DURATION_MS).
   *   displayMs + _FADE_DURATION_MS → flip `_state = 'hidden'`
   *     so the element stops rendering and clears `_fading`
   *     for the next cycle.
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
    if (this._tickInterval != null) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }
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
        ${this._renderIcon()}
        ${this._renderLabel()}
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
    if (this._state === 'active') {
      return html`
        <span class="label">Compacting history…</span>
        ${this._elapsed > 0
          ? html`<span class="elapsed">${this._elapsed}s</span>`
          : ''}
      `;
    }
    return html`<span class="label">${this._caption}</span>`;
  }
}

customElements.define('ac-compaction-progress', CompactionProgress);