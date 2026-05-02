// URLChips — renders a strip of interactive chips representing
// URLs found in the chat input or previously fetched during the
// session. Hosted by the chat panel between the pending-images
// strip and the textarea.
//
// Four chip states per specs4/4-features/url-content.md:
//
//   - detected   — URL present in current input, not yet fetched.
//                  Button + type badge + dismiss.
//   - fetching   — fetch RPC in flight. Spinner, no interaction.
//   - fetched    — content available. Checkbox (include/exclude),
//                  clickable label (view content), remove.
//   - errored    — fetched with an error. Icon + message + remove.
//
// Lifecycle (owned by the chat panel, driven via public methods):
//
//   - updateDetected(detectedList) — called on debounced input
//     change. detectedList is the array returned by
//     LLMService.detect_urls (shape: [{url, type, display_name}]).
//     Merges with existing state: fetched chips are preserved
//     regardless of whether they still appear in the input;
//     detected chips that are no longer in detectedList get
//     dismissed.
//
//   - reset() — clears all state. Called on session-changed.
//
//   - clearDetected() — clears detected and fetching entries
//     only, preserving fetched. Called after send per spec
//     ("on send, clears detected/fetching, preserves fetched").
//
// Events dispatched (bubbles + composed):
//
//   - url-fetch-requested {url}   — user clicked the fetch button
//   - url-remove-requested {url}  — user clicked remove
//   - url-view-requested {url}    — user clicked the fetched
//                                   chip's label
//   - url-exclusion-changed {url, excluded} — user toggled the
//                                   include/exclude checkbox
//
// The chat panel handles these events — calling the appropriate
// RPC and updating state via the public methods listed above.
// Keeping the component dumb about RPC details mirrors how
// ac-file-picker and ac-input-history are structured.
//
// Exclusion state is kept per-URL on the component. A future
// increment will thread the exclusion set through to the
// backend's _stream_chat so excluded URLs don't contribute
// LLM context; today, exclusion is UX-only.

import { LitElement, css, html } from 'lit';

/**
 * Human-readable type badge per URLType. Matches the emoji +
 * label convention used in specs4 for URL chips.
 */
const _TYPE_BADGES = {
  github_repo: { icon: '📦', label: 'repo' },
  github_file: { icon: '📄', label: 'file' },
  github_issue: { icon: '🐛', label: 'issue' },
  github_pr: { icon: '🔀', label: 'PR' },
  documentation: { icon: '📚', label: 'docs' },
  generic: { icon: '🔗', label: 'link' },
};

export class URLChips extends LitElement {
  static properties = {
    /**
     * Internal chip state. Map<url, {url, type, displayName,
     * status, content?, excluded?, error?}>.
     *
     * Held as a reactive property so Lit re-renders when the
     * component mutates via setState calls below. Callers never
     * read this directly — the public API is updateDetected /
     * reset / clearDetected / markFetching / markFetched /
     * markErrored.
     */
    _chips: { type: Object, state: true },
  };

  static styles = css`
    :host {
      display: block;
    }
    :host([hidden]) {
      display: none;
    }
    .strip {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
      padding: 0.5rem 0;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background: rgba(13, 17, 23, 0.6);
      border: 1px solid rgba(240, 246, 252, 0.1);
      border-radius: 4px;
      padding: 0.25rem 0.5rem;
      font-size: 0.8125rem;
      max-width: 100%;
      overflow: hidden;
    }
    .chip.detected {
      border-color: rgba(88, 166, 255, 0.3);
    }
    .chip.fetching {
      border-color: rgba(88, 166, 255, 0.4);
      background: rgba(88, 166, 255, 0.08);
    }
    .chip.fetched {
      border-color: rgba(126, 231, 135, 0.35);
    }
    .chip.errored {
      border-color: rgba(248, 81, 73, 0.4);
      background: rgba(248, 81, 73, 0.06);
    }
    .chip-icon {
      flex-shrink: 0;
      font-size: 0.9375rem;
      line-height: 1;
      user-select: none;
    }
    .chip-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 20rem;
    }
    /* Fetched label is clickable — show underline on hover. */
    .chip.fetched .chip-label {
      cursor: pointer;
      color: var(--accent-primary, #58a6ff);
    }
    .chip.fetched .chip-label:hover {
      text-decoration: underline;
    }
    .chip.fetched.excluded .chip-label {
      opacity: 0.5;
      text-decoration: line-through;
    }
    .chip-checkbox {
      cursor: pointer;
      accent-color: var(--accent-primary, #58a6ff);
    }
    .chip-button {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-primary, #c9d1d9);
      padding: 0.1rem 0.35rem;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.75rem;
      line-height: 1;
      opacity: 0.7;
    }
    .chip-button:hover {
      opacity: 1;
      background: rgba(240, 246, 252, 0.08);
    }
    .chip-button.primary {
      background: rgba(88, 166, 255, 0.15);
      border-color: rgba(88, 166, 255, 0.35);
      color: var(--accent-primary, #58a6ff);
      opacity: 1;
    }
    .chip-button.primary:hover {
      background: rgba(88, 166, 255, 0.25);
    }
    .chip-spinner {
      width: 10px;
      height: 10px;
      border: 2px solid rgba(240, 246, 252, 0.15);
      border-top-color: var(--accent-primary, #58a6ff);
      border-radius: 50%;
      animation: chip-spin 0.8s linear infinite;
      flex-shrink: 0;
    }
    @keyframes chip-spin {
      to { transform: rotate(360deg); }
    }
    .chip-error-message {
      color: #f85149;
      font-size: 0.75rem;
      opacity: 0.8;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 14rem;
    }
  `;

  constructor() {
    super();
    // Map keyed by URL. Reactive so Lit picks up mutations
    // once we reassign via `this._chips = new Map(...)`.
    this._chips = new Map();
  }

  // ---------------------------------------------------------------
  // Public API — driven by the chat panel
  // ---------------------------------------------------------------

  /**
   * Merge detected URLs from a debounced input scan.
   *
   * `detected` is the shape returned by LLMService.detect_urls:
   * `[{url, type, display_name}, ...]`. For each entry:
   *
   *   - If the URL is already a fetched / fetching / errored
   *     chip, leave it alone. Detection is idempotent — the
   *     URL's state is already richer than "detected".
   *   - If the URL is already a detected chip, leave it alone.
   *   - Otherwise, add it as a new detected chip.
   *
   * Detected chips for URLs no longer in `detected` are dropped
   * — the user edited them out of the input and shouldn't see
   * a stale chip. Fetched / fetching / errored chips are
   * preserved regardless; they represent committed work.
   */
  updateDetected(detected) {
    if (!Array.isArray(detected)) return;
    const next = new Map(this._chips);
    const seenUrls = new Set();
    for (const entry of detected) {
      if (!entry || typeof entry.url !== 'string') continue;
      seenUrls.add(entry.url);
      const existing = next.get(entry.url);
      if (existing) {
        // Already tracked — any status. Preserve as-is so
        // fetched chips don't regress to "detected" on every
        // input keystroke.
        continue;
      }
      next.set(entry.url, {
        url: entry.url,
        type: entry.type || 'generic',
        displayName: entry.display_name || entry.url,
        status: 'detected',
        excluded: false,
      });
    }
    // Drop detected chips for URLs no longer in the input.
    // Fetched / fetching / errored chips survive — they
    // represent work the user already committed to.
    for (const [url, chip] of next) {
      if (chip.status === 'detected' && !seenUrls.has(url)) {
        next.delete(url);
      }
    }
    this._chips = next;
  }

  /**
   * Clear all detected / fetching chips, preserve fetched /
   * errored. Called by the chat panel after send so the strip
   * visually resets but the user's fetched content remains
   * available.
   */
  clearDetected() {
    const next = new Map();
    for (const [url, chip] of this._chips) {
      if (chip.status === 'fetched' || chip.status === 'errored') {
        next.set(url, chip);
      }
    }
    this._chips = next;
  }

  /** Clear everything. Called on session-changed. */
  reset() {
    this._chips = new Map();
  }

  /**
   * Mark a detected chip as in-flight. Called by the chat
   * panel when it dispatches the fetch_url RPC.
   */
  markFetching(url) {
    const chip = this._chips.get(url);
    if (!chip) return;
    const next = new Map(this._chips);
    next.set(url, { ...chip, status: 'fetching' });
    this._chips = next;
  }

  /**
   * Mark a chip as successfully fetched. `content` is the
   * URLContent dict from the RPC.
   *
   * Shape-permissive — the backend's URLContent to_dict
   * payload includes fields we don't display (github_info,
   * fetched_at, etc.). We store the whole thing so the
   * view-content dialog can surface whatever's useful.
   */
  markFetched(url, content) {
    const chip = this._chips.get(url);
    if (!chip) return;
    const next = new Map(this._chips);
    next.set(url, {
      ...chip,
      status: 'fetched',
      content: content || null,
    });
    this._chips = next;
  }

  /**
   * Mark a chip as errored. `message` is a human-readable
   * error string from the fetch.
   */
  markErrored(url, message) {
    const chip = this._chips.get(url);
    if (!chip) return;
    const next = new Map(this._chips);
    next.set(url, {
      ...chip,
      status: 'errored',
      error: message || 'Fetch failed',
    });
    this._chips = next;
  }

  /**
   * Remove a chip entirely. Called after the chat panel's
   * remove-url RPC succeeds.
   */
  remove(url) {
    if (!this._chips.has(url)) return;
    const next = new Map(this._chips);
    next.delete(url);
    this._chips = next;
  }

  /**
   * Return the list of non-excluded fetched URLs. The chat
   * panel reads this on send to know which URL content is
   * "active" — today this is informational only; a future
   * increment will thread it through to the streaming
   * handler as an explicit exclusion set.
   */
  getActiveFetchedUrls() {
    const out = [];
    for (const chip of this._chips.values()) {
      if (chip.status === 'fetched' && !chip.excluded) {
        out.push(chip.url);
      }
    }
    return out;
  }

  /** True when no chips are visible. */
  get isEmpty() {
    return this._chips.size === 0;
  }

  // ---------------------------------------------------------------
  // Event dispatchers
  // ---------------------------------------------------------------

  _onFetchClick(url) {
    this.dispatchEvent(new CustomEvent('url-fetch-requested', {
      detail: { url },
      bubbles: true,
      composed: true,
    }));
  }

  _onRemoveClick(url) {
    this.dispatchEvent(new CustomEvent('url-remove-requested', {
      detail: { url },
      bubbles: true,
      composed: true,
    }));
  }

  _onViewClick(url) {
    this.dispatchEvent(new CustomEvent('url-view-requested', {
      detail: { url },
      bubbles: true,
      composed: true,
    }));
  }

  _onExclusionToggle(url, excluded) {
    // Local mutation so the checkbox responds immediately;
    // also bubble an event so the chat panel can react (e.g.
    // for future context-integration).
    const chip = this._chips.get(url);
    if (!chip) return;
    const next = new Map(this._chips);
    next.set(url, { ...chip, excluded });
    this._chips = next;
    this.dispatchEvent(new CustomEvent('url-exclusion-changed', {
      detail: { url, excluded },
      bubbles: true,
      composed: true,
    }));
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  render() {
    if (this._chips.size === 0) {
      // Hidden via :host([hidden]) so the parent's layout
      // doesn't reserve the strip's gap when empty.
      this.setAttribute('hidden', '');
      return html``;
    }
    this.removeAttribute('hidden');
    const chips = Array.from(this._chips.values());
    return html`
      <div class="strip" role="list"
        aria-label="URLs detected in message">
        ${chips.map((chip) => this._renderChip(chip))}
      </div>
    `;
  }

  _renderChip(chip) {
    switch (chip.status) {
      case 'detected':
        return this._renderDetected(chip);
      case 'fetching':
        return this._renderFetching(chip);
      case 'fetched':
        return this._renderFetched(chip);
      case 'errored':
        return this._renderErrored(chip);
      default:
        return '';
    }
  }

  _renderDetected(chip) {
    const badge = _TYPE_BADGES[chip.type] || _TYPE_BADGES.generic;
    return html`
      <div class="chip detected" role="listitem"
        title="Click 'Fetch' to retrieve ${chip.url}">
        <span class="chip-icon" aria-hidden="true">
          ${badge.icon}
        </span>
        <span class="chip-label">${chip.displayName}</span>
        <button
          class="chip-button primary"
          @click=${() => this._onFetchClick(chip.url)}
          aria-label="Fetch ${chip.url}"
          title="Fetch URL content"
        >Fetch</button>
        <button
          class="chip-button"
          @click=${() => this._onRemoveClick(chip.url)}
          aria-label="Dismiss ${chip.url}"
          title="Dismiss"
        >✕</button>
      </div>
    `;
  }

  _renderFetching(chip) {
    const badge = _TYPE_BADGES[chip.type] || _TYPE_BADGES.generic;
    return html`
      <div class="chip fetching" role="listitem"
        title="Fetching ${chip.url}…">
        <span class="chip-icon" aria-hidden="true">
          ${badge.icon}
        </span>
        <span class="chip-label">${chip.displayName}</span>
        <span class="chip-spinner" aria-label="Fetching"></span>
      </div>
    `;
  }

  _renderFetched(chip) {
    const badge = _TYPE_BADGES[chip.type] || _TYPE_BADGES.generic;
    const excludedClass = chip.excluded ? ' excluded' : '';
    const tooltip = chip.excluded
      ? `${chip.url} — excluded from context`
      : `${chip.url} — click to view content`;
    return html`
      <div class="chip fetched${excludedClass}" role="listitem"
        title=${tooltip}>
        <input
          type="checkbox"
          class="chip-checkbox"
          .checked=${!chip.excluded}
          @change=${(e) =>
            this._onExclusionToggle(chip.url, !e.target.checked)}
          aria-label=${chip.excluded
            ? `Include ${chip.url} in context`
            : `Exclude ${chip.url} from context`}
          title=${chip.excluded
            ? 'Include in LLM context'
            : 'Exclude from LLM context'}
        />
        <span class="chip-icon" aria-hidden="true">
          ${badge.icon}
        </span>
        <span
          class="chip-label"
          @click=${() => this._onViewClick(chip.url)}
          role="button"
          tabindex="0"
          @keydown=${(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              this._onViewClick(chip.url);
            }
          }}
        >${chip.displayName}</span>
        <button
          class="chip-button"
          @click=${() => this._onRemoveClick(chip.url)}
          aria-label="Remove ${chip.url}"
          title="Remove from fetched"
        >✕</button>
      </div>
    `;
  }

  _renderErrored(chip) {
    const badge = _TYPE_BADGES[chip.type] || _TYPE_BADGES.generic;
    return html`
      <div class="chip errored" role="listitem"
        title="${chip.url} — ${chip.error}">
        <span class="chip-icon" aria-hidden="true">
          ${badge.icon}
        </span>
        <span class="chip-label">${chip.displayName}</span>
        <span class="chip-error-message">${chip.error}</span>
        <button
          class="chip-button"
          @click=${() => this._onRemoveClick(chip.url)}
          aria-label="Dismiss ${chip.url}"
          title="Dismiss"
        >✕</button>
      </div>
    `;
  }
}

customElements.define('ac-url-chips', URLChips);