// InputHistory — recall previously-sent messages via up-arrow.
//
// Layer 5 Phase 2d — session controls (part 3).
//
// Responsibilities:
//   - Record every sent message (via `addEntry(text)`)
//   - Cap at 100 entries; oldest discarded on overflow
//   - Dedup: re-sending an identical message moves the entry
//     to the end rather than creating a duplicate
//   - Show an overlay above the chat input on-demand with
//     substring filtering, keyboard navigation, and preview
//   - Host (chat panel) routes keydown events via
//     `handleKey(e)` while the overlay is open — this gives
//     the overlay keyboard priority over the textarea
//
// Host/guest contract (chat panel ↔ this component):
//   - `addEntry(text)` — called on every send to record input
//   - `show(currentInput)` — called on up-arrow at cursor 0;
//     saves currentInput for restore on Escape
//   - `handleKey(e)` — called from host's _onKeyDown when open;
//     returns true if handled
//   - `history-select` event — carries the selected text; host
//     replaces textarea content
//   - `history-cancel` event — carries the original input text;
//     host restores textarea content
//
// Per specs4/5-webapp/chat.md:
//   - Overlay displays items oldest-first (top) to newest
//     (bottom), matching how conversation scrolls
//   - Filter input is inside the overlay, NOT the main textarea
//   - Up/Down navigate the filtered list
//   - Enter selects; Escape cancels + restores original input
//   - Clicking an item selects it
//
// No persistence — recall state is in-memory only. Survives
// tab switches and dialog minimize/maximize (component stays
// mounted), but not page reload. The session-load path
// re-seeds history from the loaded session's user messages
// (chat panel calls `addEntry` for each), so up-arrow recall
// works correctly after reload + session restore.

import { LitElement, css, html } from 'lit';

/**
 * Cap on in-memory history. Small enough that the filter
 * scan is trivial (O(n) substring on ≤100 items every
 * keystroke is negligible); large enough that users rarely
 * hit the cap in a single session. Matches specs.
 */
const MAX_ENTRIES = 100;

/**
 * When the overlay opens with no filter query, how many of
 * the most-recent entries to show before scrolling. The rest
 * are reachable by scrolling; the visible slice is just the
 * initial window. Render list is capped by CSS max-height,
 * so this is more of a "don't render thousands of items"
 * safeguard than a visible-count limit.
 */
const _VISIBLE_BATCH = 20;

export class InputHistory extends LitElement {
  static properties = {
    /**
     * Whether the recall overlay is currently shown. Toggled
     * by `show()` and by internal escape/select handling.
     */
    _open: { type: Boolean, state: true },
    /**
     * Current filter query (typed into the overlay's own
     * input, NOT the main textarea).
     */
    _filter: { type: String, state: true },
    /**
     * Index into the filtered-entries array pointing at the
     * currently-focused item. -1 means no focus yet (fresh
     * open); otherwise in [0, filtered.length).
     */
    _focusedIndex: { type: Number, state: true },
  };

  static styles = css`
    :host {
      display: block;
      position: relative;
    }
    .overlay {
      position: absolute;
      bottom: 100%;
      left: 0;
      right: 0;
      margin-bottom: 2px;
      background: rgba(22, 27, 34, 0.98);
      border: 1px solid rgba(240, 246, 252, 0.2);
      border-radius: 6px;
      box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.4);
      display: flex;
      flex-direction: column;
      max-height: 50vh;
      overflow: hidden;
      z-index: 50;
    }
    .filter-input {
      flex-shrink: 0;
      padding: 0.4rem 0.6rem;
      background: rgba(13, 17, 23, 0.6);
      border: none;
      border-bottom: 1px solid rgba(240, 246, 252, 0.1);
      color: var(--text-primary, #c9d1d9);
      font-family: inherit;
      font-size: 0.8125rem;
    }
    .filter-input:focus {
      outline: none;
    }
    .entries {
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      max-height: 40vh;
    }
    .entry {
      flex: 0 0 auto;
      box-sizing: border-box;
      min-height: 1.75rem;
      padding: 0.35rem 0.6rem;
      cursor: pointer;
      font-size: 0.8125rem;
      line-height: 1.25;
      color: var(--text-primary, #c9d1d9);
      border-bottom: 1px solid rgba(240, 246, 252, 0.12);
      /* Single-line with ellipsis — multi-line entries collapse
       * to their first line so the list stays dense. The
       * filter input and focused-row preview make the full
       * content discoverable without consuming vertical space
       * in the list itself. Newlines become spaces via the
       * white-space rule. */
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .entry:last-child {
      border-bottom: none;
    }
    .entry:hover {
      background: rgba(240, 246, 252, 0.04);
    }
    .entry.focused {
      background: rgba(88, 166, 255, 0.12);
      border-left: 3px solid var(--accent-primary, #58a6ff);
      padding-left: calc(0.6rem - 3px);
    }
    .empty {
      padding: 0.75rem;
      color: var(--text-secondary, #8b949e);
      font-style: italic;
      text-align: center;
      font-size: 0.8125rem;
    }
    .hint {
      flex-shrink: 0;
      padding: 0.25rem 0.6rem;
      background: rgba(13, 17, 23, 0.4);
      border-top: 1px solid rgba(240, 246, 252, 0.05);
      color: var(--text-secondary, #8b949e);
      font-size: 0.6875rem;
      text-align: center;
    }
  `;

  constructor() {
    super();
    // The full history list. Oldest at index 0, newest at
    // the end. An array (not a circular buffer) because
    // 100-entry caps make the shift-on-overflow cost
    // negligible and the indexed access is simpler.
    this._entries = [];
    // The input text that was in the textarea when the
    // overlay opened. Restored on Escape.
    this._savedInput = '';
    this._open = false;
    this._filter = '';
    this._focusedIndex = -1;
  }

  // ---------------------------------------------------------------
  // Host-facing API
  // ---------------------------------------------------------------

  /**
   * Record a sent message. Deduplicates by moving any existing
   * identical entry to the end. Caps the history at
   * MAX_ENTRIES, discarding the oldest.
   *
   * Empty / whitespace-only strings are ignored — they're
   * never useful to recall and would clutter the list.
   */
  addEntry(text) {
    if (typeof text !== 'string') return;
    const trimmed = text.trim();
    if (!trimmed) return;
    // Dedup — if this exact text is already in history,
    // remove the old entry and let the new one land at the
    // end. The "same text, different time" case is more
    // usefully represented as "most recent", not as two
    // identical list items.
    const existingIdx = this._entries.indexOf(text);
    if (existingIdx !== -1) {
      this._entries.splice(existingIdx, 1);
    }
    this._entries.push(text);
    // Cap — discard oldest. splice rather than shift for
    // consistency with the dedup path, though shift would
    // work too.
    while (this._entries.length > MAX_ENTRIES) {
      this._entries.shift();
    }
  }

  /**
   * Open the recall overlay. `currentInput` is the textarea
   * content at the moment of opening — saved so Escape can
   * restore it. The filter starts empty; up/down arrows
   * navigate from the newest (bottom) entry.
   *
   * Returns true if the overlay opened (history non-empty),
   * false otherwise. Host uses the return to decide whether
   * to actually intercept the up-arrow or let the default
   * cursor-motion happen.
   */
  show(currentInput) {
    if (this._entries.length === 0) return false;
    this._savedInput = typeof currentInput === 'string'
      ? currentInput
      : '';
    this._open = true;
    this._filter = '';
    // Focus the newest entry by default — up-arrow recall is
    // "what did I just type?" 90% of the time. The user can
    // arrow up further to reach older entries.
    const filtered = this._filteredEntries();
    this._focusedIndex = filtered.length - 1;
    // Focus the filter input after Lit renders. Typing in
    // the overlay goes through the filter input, not the
    // main textarea, so stealing focus is essential.
    this.updateComplete.then(() => {
      const input = this.shadowRoot?.querySelector('.filter-input');
      if (input) input.focus();
    });
    return true;
  }

  /**
   * Close the overlay without selecting. Restores the saved
   * input via `history-cancel`. Public so the host can
   * dismiss from the outside (e.g. on input blur, though
   * currently we don't wire that).
   */
  hide() {
    if (!this._open) return;
    this._open = false;
    this._filter = '';
    this._focusedIndex = -1;
    const saved = this._savedInput;
    this._savedInput = '';
    this.dispatchEvent(
      new CustomEvent('history-cancel', {
        detail: { text: saved },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Route a keydown event from the host. Only navigation
   * keys are handled; other keys (letters, numbers) fall
   * through so the filter input receives them naturally.
   *
   * Returns true if the key was consumed — host should then
   * suppress default behaviour (stopPropagation /
   * preventDefault). False means the host can proceed.
   *
   * Called from the chat panel's textarea keydown handler
   * AND from this component's own filter-input handler, so
   * the same logic applies regardless of where focus is.
   */
  handleKey(event) {
    if (!this._open) return false;
    const filtered = this._filteredEntries();
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.hide();
        return true;
      case 'Enter':
        event.preventDefault();
        this._selectFocused(filtered);
        return true;
      case 'ArrowUp':
        event.preventDefault();
        this._moveFocus(-1, filtered);
        return true;
      case 'ArrowDown':
        event.preventDefault();
        this._moveFocus(1, filtered);
        return true;
      default:
        return false;
    }
  }

  /**
   * Returns whether the overlay is currently open — the host
   * reads this to decide whether to delegate keys via
   * `handleKey`.
   */
  get isOpen() {
    return this._open;
  }

  // ---------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------

  _filteredEntries() {
    if (!this._filter) return this._entries;
    const needle = this._filter.toLowerCase();
    return this._entries.filter((e) =>
      e.toLowerCase().includes(needle),
    );
  }

  _moveFocus(delta, filtered) {
    if (filtered.length === 0) {
      this._focusedIndex = -1;
      return;
    }
    let next = this._focusedIndex + delta;
    // Clamp at both ends rather than wrap — wrapping from
    // top to bottom (or vice versa) with up-arrow can
    // disorient users reading through the list.
    if (next < 0) next = 0;
    if (next >= filtered.length) next = filtered.length - 1;
    this._focusedIndex = next;
    // Scroll the focused entry into view if it's off-screen.
    this.updateComplete.then(() => {
      const el = this.shadowRoot?.querySelector('.entry.focused');
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  _selectFocused(filtered) {
    if (filtered.length === 0) return;
    const idx =
      this._focusedIndex >= 0 && this._focusedIndex < filtered.length
        ? this._focusedIndex
        : filtered.length - 1;
    const text = filtered[idx];
    this._open = false;
    this._filter = '';
    this._focusedIndex = -1;
    this._savedInput = '';
    this.dispatchEvent(
      new CustomEvent('history-select', {
        detail: { text },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _onFilterInput(event) {
    this._filter = event.target.value;
    // After filtering, re-focus the last (newest) entry in
    // the filtered list. Preserves the "newest is focused"
    // invariant: if the user types to narrow, they want the
    // most recent match, not the first one.
    const filtered = this._filteredEntries();
    this._focusedIndex =
      filtered.length > 0 ? filtered.length - 1 : -1;
  }

  _onFilterKeyDown(event) {
    // Delegate nav keys to handleKey so the behaviour matches
    // whatever the host routes in. Only navigation keys are
    // consumed; letters / numbers fall through to edit the
    // filter naturally.
    this.handleKey(event);
  }

  _onEntryClick(entryIdx, filtered) {
    this._focusedIndex = entryIdx;
    this._selectFocused(filtered);
  }

  render() {
    if (!this._open) return html``;
    const filtered = this._filteredEntries();
    // Always render the filter input even when there's no
    // result — gives the user a way to clear the filter.
    // Items render oldest-first (top) to newest (bottom)
    // per spec; the filter's natural array order already
    // matches that since _entries stores oldest-at-0.
    //
    // Optimization: if the full entry list is huge (hit the
    // cap) and the filter is empty, show only the trailing
    // _VISIBLE_BATCH entries. User can filter to find older
    // items if needed.
    const visibleEntries =
      this._filter || filtered.length <= _VISIBLE_BATCH
        ? filtered
        : filtered.slice(filtered.length - _VISIBLE_BATCH);
    const visibleOffset = filtered.length - visibleEntries.length;
    return html`
      <div class="overlay" role="listbox">
        <input
          type="text"
          class="filter-input"
          placeholder="Filter history… (Up/Down to navigate, Enter to select, Escape to cancel)"
          .value=${this._filter}
          @input=${this._onFilterInput}
          @keydown=${this._onFilterKeyDown}
          aria-label="Filter history"
        />
        ${filtered.length === 0
          ? html`<div class="empty">
              ${this._filter
                ? 'No matching history'
                : 'History is empty'}
            </div>`
          : html`<div class="entries">
              ${visibleEntries.map((text, i) => {
                const realIdx = visibleOffset + i;
                const isFocused = realIdx === this._focusedIndex;
                return html`
                  <div
                    class="entry ${isFocused ? 'focused' : ''}"
                    role="option"
                    aria-selected=${isFocused}
                    title=${text}
                    @click=${() => this._onEntryClick(realIdx, filtered)}
                  >
                    ${text}
                  </div>
                `;
              })}
            </div>`}
        <div class="hint">
          ↑↓ navigate · Enter select · Esc cancel
        </div>
      </div>
    `;
  }
}

customElements.define('ac-input-history', InputHistory);

// Test-only exports.
export { MAX_ENTRIES };