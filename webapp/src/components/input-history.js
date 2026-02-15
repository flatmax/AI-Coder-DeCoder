/**
 * Input History — up-arrow fuzzy search overlay for chat input history.
 *
 * Shows a filterable list of previous user inputs.
 * Most recent at bottom, oldest at top.
 * Up/Down arrows navigate, Enter selects, Escape closes.
 */

import { LitElement, html, css, nothing } from 'lit';
import { theme, scrollbarStyles } from '../styles/theme.js';

export class AcInputHistory extends LitElement {
  static properties = {
    /** Whether the overlay is visible */
    open: { type: Boolean, reflect: true },
    /** The filter/search text */
    _filter: { type: String, state: true },
    /** Index of highlighted item (from bottom, in filtered list) */
    _selectedIndex: { type: Number, state: true },
  };

  static styles = [theme, scrollbarStyles, css`
    :host {
      display: none;
      position: absolute;
      bottom: 100%;
      left: 0;
      right: 0;
      z-index: 50;
    }
    :host([open]) {
      display: block;
    }

    .overlay {
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      max-height: 300px;
      display: flex;
      flex-direction: column;
      margin-bottom: 4px;
      overflow: hidden;
    }

    .filter-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      border-bottom: 1px solid var(--border-primary);
    }

    .filter-input {
      flex: 1;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 0.8rem;
      padding: 4px 8px;
      outline: none;
    }
    .filter-input:focus {
      border-color: var(--accent-primary);
    }
    .filter-input::placeholder {
      color: var(--text-muted);
    }

    .filter-label {
      color: var(--text-muted);
      font-size: 0.75rem;
      flex-shrink: 0;
    }

    .items {
      overflow-y: auto;
      padding: 4px 0;
    }

    .item {
      padding: 6px 12px;
      font-size: 0.8rem;
      color: var(--text-secondary);
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.4;
    }
    .item:hover {
      background: var(--bg-tertiary);
    }
    .item.selected {
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border-left: 2px solid var(--accent-primary);
      padding-left: 10px;
    }

    .empty {
      padding: 12px;
      text-align: center;
      color: var(--text-muted);
      font-size: 0.8rem;
    }
  `];

  constructor() {
    super();
    this.open = false;
    this._filter = '';
    this._selectedIndex = 0;
    /** @type {string[]} Full history, oldest first */
    this._history = [];
    /** @type {string} Original input value when overlay opened */
    this._originalInput = '';
  }

  /**
   * Add an input to history (called on send).
   */
  addEntry(text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Remove duplicate if exists
    const idx = this._history.indexOf(trimmed);
    if (idx !== -1) {
      this._history.splice(idx, 1);
    }

    this._history.push(trimmed);

    // Cap at 100 entries
    if (this._history.length > 100) {
      this._history.shift();
    }
  }

  /**
   * Open the overlay with current input as context.
   */
  show(currentInput) {
    if (this._history.length === 0) return;
    this._originalInput = currentInput || '';
    this._filter = '';
    this._selectedIndex = 0; // 0 = most recent (bottom)
    this.open = true;

    this.updateComplete.then(() => {
      const input = this.shadowRoot?.querySelector('.filter-input');
      if (input) input.focus();
      this._scrollToSelected();
    });
  }

  /**
   * Close and restore original input.
   * Returns the original input text.
   */
  cancel() {
    this.open = false;
    return this._originalInput;
  }

  /**
   * Close and return the selected item.
   */
  select() {
    const filtered = this._getFiltered();
    if (filtered.length === 0) {
      this.open = false;
      return this._originalInput;
    }
    // selectedIndex 0 = bottom (most recent)
    const item = filtered[filtered.length - 1 - this._selectedIndex];
    this.open = false;
    return item || this._originalInput;
  }

  /**
   * Handle keyboard navigation. Returns true if handled.
   */
  handleKey(e) {
    if (!this.open) return false;

    const filtered = this._getFiltered();

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        this._selectedIndex = Math.min(this._selectedIndex + 1, filtered.length - 1);
        this._scrollToSelected();
        return true;

      case 'ArrowDown':
        e.preventDefault();
        this._selectedIndex = Math.max(this._selectedIndex - 1, 0);
        this._scrollToSelected();
        return true;

      case 'Enter':
        e.preventDefault();
        this._dispatchSelect(this.select());
        return true;

      case 'Escape':
        e.preventDefault();
        this._dispatchCancel(this.cancel());
        return true;

      default:
        return false;
    }
  }

  _getFiltered() {
    if (!this._filter) return this._history;
    const lower = this._filter.toLowerCase();
    return this._history.filter(h => h.toLowerCase().includes(lower));
  }

  _onFilterInput(e) {
    this._filter = e.target.value;
    this._selectedIndex = 0;
  }

  _onFilterKeyDown(e) {
    if (this.handleKey(e)) return;
  }

  _onItemClick(index) {
    // index is in display order (oldest first), convert
    const filtered = this._getFiltered();
    this._selectedIndex = filtered.length - 1 - index;
    this._dispatchSelect(this.select());
  }

  _scrollToSelected() {
    this.updateComplete.then(() => {
      const el = this.shadowRoot?.querySelector('.item.selected');
      if (el) el.scrollIntoView({ block: 'nearest' });
    });
  }

  _dispatchSelect(text) {
    this.dispatchEvent(new CustomEvent('history-select', {
      detail: { text }, bubbles: true, composed: true,
    }));
  }

  _dispatchCancel(text) {
    this.dispatchEvent(new CustomEvent('history-cancel', {
      detail: { text }, bubbles: true, composed: true,
    }));
  }

  render() {
    if (!this.open) return nothing;

    const filtered = this._getFiltered();

    return html`
      <div class="overlay">
        <div class="filter-row">
          <span class="filter-label">History</span>
          <input
            class="filter-input"
            type="text"
            placeholder="Filter..."
            aria-label="Filter input history"
            .value=${this._filter}
            @input=${this._onFilterInput}
            @keydown=${this._onFilterKeyDown}
          >
        </div>
        <div class="items" role="listbox" aria-label="Input history">
          ${filtered.length === 0 ? html`
            <div class="empty">${this._filter ? 'No matches' : 'No history'}</div>
          ` : filtered.map((item, i) => {
            // selectedIndex 0 = bottom = filtered.length - 1
            const isSelected = i === (filtered.length - 1 - this._selectedIndex);
            return html`
              <div
                class="item ${isSelected ? 'selected' : ''}"
                role="option"
                aria-selected="${isSelected}"
                @click=${() => this._onItemClick(i)}
                title="${item}"
              >${item}</div>
            `;
          })}
        </div>
      </div>
    `;
  }
}

customElements.define('ac-input-history', AcInputHistory);