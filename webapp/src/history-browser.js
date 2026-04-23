// HistoryBrowser — modal overlay for browsing past sessions.
//
// Layer 5 Phase 2d — session controls (part 2 of 2, after the
// new-session button).
//
// Responsibilities:
//
//   - List past sessions from LLMService.history_list_sessions,
//     newest-first, with preview + message count + timestamp
//   - Full-text search across all sessions via
//     LLMService.history_search, debounced to avoid flooding
//     the server while the user types
//   - Preview of a selected session's messages (simplified
//     rendering — role labels + raw content, no edit-block
//     segmentation or file-mention wrapping)
//   - Load action that calls LLMService.load_session_into_context,
//     which triggers the server's sessionChanged broadcast that
//     the chat panel's existing handler consumes
//   - Keyboard shortcuts: Escape closes (or clears search
//     first if the query is non-empty and the search input is
//     focused)
//   - Backdrop click closes, close button closes
//
// Scope cuts for this commit (explicit boundaries):
//
//   - Right-click context menu for ad-hoc panel loading —
//     needs diff viewer (Phase 3)
//   - Per-message hover action buttons (copy, paste-to-prompt)
//     — scope creep; basic load flow matters more
//   - Image thumbnails in preview — history store returns
//     reconstructed data URIs, but rendering needs thumbnail
//     styling, add in a follow-up
//
// Governing spec: specs4/5-webapp/chat.md "History Browser"
//
// Event contract:
//   - `close` (bubbles, composed) — dispatched when the user
//     closes the modal via any path. Parent (chat panel) toggles
//     the modal open-state off.
//   - `session-loaded` (bubbles, composed) — dispatched AFTER
//     the RPC call succeeds, carrying `{session_id}`. The server
//     also broadcasts sessionChanged to all clients; the chat
//     panel listens for that independently. The event is fired
//     locally so the parent can distinguish "user loaded from
//     history" (close the modal) from "another client changed
//     session" (just reflect the change). The broadcast path
//     alone would close the modal on every remote session switch.
//
// The server's sessionChanged broadcast includes the full
// message list; the chat panel's _onSessionChanged handler
// replaces `messages` wholesale. Nothing in this component
// needs to mutate the chat panel directly.

import { LitElement, css, html } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import { RpcMixin } from './rpc-mixin.js';
import { escapeHtml, renderMarkdown } from './markdown.js';

/**
 * Debounce delay for search queries. 300ms matches the
 * specs3/4-webapp/search_and_settings.md file-search value and
 * is short enough to feel responsive while coalescing bursts
 * of typing into a single RPC call.
 */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Format an ISO-8601 timestamp as a short relative-time string
 * for the session list. "12m ago", "3h ago", "2d ago". Falls
 * back to the raw string if parsing fails — defensive against
 * malformed data.
 */
function formatRelativeTime(iso) {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const deltaSec = Math.max(0, (Date.now() - then) / 1000);
  if (deltaSec < 60) return 'just now';
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr}h ago`;
  const deltaDay = Math.floor(deltaHr / 24);
  if (deltaDay < 30) return `${deltaDay}d ago`;
  // Older than a month — show the date only.
  try {
    return new Date(then).toLocaleDateString();
  } catch (_) {
    return iso;
  }
}

export class HistoryBrowser extends RpcMixin(LitElement) {
  static properties = {
    /**
     * Whether the modal is shown. Parent toggles this; the
     * component dispatches `close` but doesn't flip its own
     * prop (parent is the source of truth).
     */
    open: { type: Boolean, reflect: true },
    /** Session summaries from history_list_sessions. */
    _sessions: { type: Array, state: true },
    /** Loading state for the session list. */
    _loadingSessions: { type: Boolean, state: true },
    /** Currently selected session ID (left pane click). */
    _selectedSessionId: { type: String, state: true },
    /** Messages for the selected session (right pane). */
    _selectedMessages: { type: Array, state: true },
    /** Loading state for the selected session's messages. */
    _loadingMessages: { type: Boolean, state: true },
    /** Current search query (may be empty). */
    _searchQuery: { type: String, state: true },
    /** Whether search results mode is active. */
    _searchMode: { type: Boolean, state: true },
    /** Search hits from history_search. */
    _searchHits: { type: Array, state: true },
    /** True while the load-session RPC is in flight. */
    _loadingSession: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      display: none;
    }
    :host([open]) {
      display: block;
    }
    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .modal {
      background: var(--bg-primary, #0d1117);
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 8px;
      width: min(90vw, 900px);
      height: min(85vh, 700px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
    }
    .modal-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid rgba(240, 246, 252, 0.1);
      background: rgba(22, 27, 34, 0.6);
    }
    .modal-title {
      font-weight: 600;
      font-size: 0.9375rem;
      flex-shrink: 0;
    }
    .search-input {
      flex: 1;
      padding: 0.35rem 0.6rem;
      background: rgba(13, 17, 23, 0.9);
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 4px;
      color: var(--text-primary, #c9d1d9);
      font-family: inherit;
      font-size: 0.875rem;
    }
    .search-input:focus {
      outline: none;
      border-color: var(--accent-primary, #58a6ff);
    }
    .close-button {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-secondary, #8b949e);
      padding: 0.25rem 0.5rem;
      font-size: 1rem;
      line-height: 1;
      cursor: pointer;
      border-radius: 4px;
    }
    .close-button:hover {
      background: rgba(240, 246, 252, 0.08);
      color: var(--text-primary, #c9d1d9);
    }
    .modal-body {
      flex: 1;
      min-height: 0;
      display: flex;
    }
    .sessions-pane {
      flex: 0 0 300px;
      border-right: 1px solid rgba(240, 246, 252, 0.1);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }
    .session-item {
      padding: 0.6rem 0.75rem;
      cursor: pointer;
      border-bottom: 1px solid rgba(240, 246, 252, 0.05);
    }
    .session-item:hover {
      background: rgba(240, 246, 252, 0.04);
    }
    .session-item.selected {
      background: rgba(88, 166, 255, 0.1);
      border-left: 3px solid var(--accent-primary, #58a6ff);
      padding-left: calc(0.75rem - 3px);
    }
    .session-preview {
      font-size: 0.8125rem;
      color: var(--text-primary, #c9d1d9);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .session-meta {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.25rem;
      font-size: 0.7rem;
      color: var(--text-secondary, #8b949e);
    }
    .msg-count {
      background: rgba(240, 246, 252, 0.08);
      padding: 0.05rem 0.35rem;
      border-radius: 3px;
    }
    .empty-list {
      padding: 1rem;
      color: var(--text-secondary, #8b949e);
      font-style: italic;
      text-align: center;
    }
    .loading-note {
      padding: 1rem;
      color: var(--text-secondary, #8b949e);
      font-style: italic;
      text-align: center;
    }
    .preview-pane {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .preview-messages {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .preview-empty {
      margin: auto;
      color: var(--text-secondary, #8b949e);
      font-style: italic;
    }
    .preview-message {
      border-radius: 6px;
      padding: 0.5rem 0.75rem;
      font-size: 0.875rem;
    }
    .preview-message.role-user {
      background: rgba(88, 166, 255, 0.06);
      border: 1px solid rgba(88, 166, 255, 0.15);
    }
    .preview-message.role-assistant {
      background: rgba(240, 246, 252, 0.03);
      border: 1px solid rgba(240, 246, 252, 0.08);
    }
    .preview-message.role-system {
      background: rgba(240, 246, 252, 0.03);
      border: 1px dashed rgba(240, 246, 252, 0.15);
      color: var(--text-secondary, #8b949e);
      font-style: italic;
    }
    .preview-role-label {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.55;
      margin-bottom: 0.25rem;
    }
    .preview-body :first-child {
      margin-top: 0;
    }
    .preview-body :last-child {
      margin-bottom: 0;
    }
    .preview-body pre {
      background: rgba(13, 17, 23, 0.85);
      border-radius: 4px;
      padding: 0.5rem;
      overflow-x: auto;
      font-size: 0.8125rem;
    }
    .preview-footer {
      flex-shrink: 0;
      padding: 0.75rem 1rem;
      border-top: 1px solid rgba(240, 246, 252, 0.1);
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      background: rgba(22, 27, 34, 0.4);
    }
    .load-button {
      padding: 0.4rem 1rem;
      background: var(--accent-primary, #58a6ff);
      border: none;
      border-radius: 4px;
      color: #0d1117;
      font-weight: 600;
      cursor: pointer;
      font-size: 0.875rem;
    }
    .load-button:hover {
      filter: brightness(1.1);
    }
    .load-button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .search-hit {
      padding: 0.6rem 0.75rem;
      cursor: pointer;
      border-bottom: 1px solid rgba(240, 246, 252, 0.05);
    }
    .search-hit:hover {
      background: rgba(240, 246, 252, 0.04);
    }
    .search-hit .hit-role {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--accent-primary, #58a6ff);
      margin-bottom: 0.2rem;
    }
    .search-hit .hit-content {
      font-size: 0.8125rem;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
  `;

  constructor() {
    super();
    this.open = false;
    this._sessions = [];
    this._loadingSessions = false;
    this._selectedSessionId = null;
    this._selectedMessages = [];
    this._loadingMessages = false;
    this._searchQuery = '';
    this._searchMode = false;
    this._searchHits = [];
    this._loadingSession = false;

    // Debounce timer for search.
    this._searchDebounceTimer = null;
    // Generation counter to discard stale RPC responses
    // when the user types faster than the server responds.
    this._searchGeneration = 0;
    this._messagesGeneration = 0;

    this._onKeyDown = this._onKeyDown.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    // Listen on document so Escape works regardless of
    // which element has focus inside the modal.
    document.addEventListener('keydown', this._onKeyDown);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKeyDown);
    if (this._searchDebounceTimer != null) {
      clearTimeout(this._searchDebounceTimer);
      this._searchDebounceTimer = null;
    }
    super.disconnectedCallback();
  }

  updated(changedProps) {
    // When the modal opens, load the session list. When it
    // closes, reset transient state so the next open starts
    // fresh (don't carry over stale search, selection, etc.).
    if (changedProps.has('open')) {
      if (this.open) {
        // Defer the fetch to the next microtask so property
        // mutations inside `_loadSessions` (loading flag,
        // sessions array) happen OUTSIDE the update cycle.
        // Setting reactive state inside `updated` triggers
        // Lit's "change-in-update" warning and schedules a
        // redundant update. The microtask hop separates the
        // two phases cleanly.
        Promise.resolve().then(() => {
          // Re-check `open` — the user could have closed
          // the modal in the microsecond between update
          // and microtask. Without this guard we'd issue
          // an RPC for a modal the user already dismissed.
          if (this.open) this._loadSessions();
        });
      } else {
        // Modal closed — reset local state. Preserve the
        // list so a quick close/open doesn't re-fetch;
        // but clear search and selection. Defer to the
        // next microtask so property writes happen outside
        // the update cycle. The initial mount (open goes
        // from undefined → false) also lands here; all
        // five fields are already at their defaults so the
        // microtask is effectively a no-op, but deferring
        // means we never trigger the change-in-update
        // warning.
        Promise.resolve().then(() => {
          if (this.open) return;
          this._searchQuery = '';
          this._searchMode = false;
          this._searchHits = [];
          this._selectedSessionId = null;
          this._selectedMessages = [];
        });
      }
    }
  }

  // ---------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------

  async _loadSessions() {
    if (!this.rpcConnected) return;
    this._loadingSessions = true;
    try {
      const result = await this.rpcExtract(
        'LLMService.history_list_sessions',
      );
      this._sessions = Array.isArray(result) ? result : [];
    } catch (err) {
      // "Method not found" means the test fixture or a
      // stripped-down backend doesn't expose history. The
      // empty-state placeholder already communicates this
      // to the user; no error-level log needed. Any other
      // failure (network, server error) is worth
      // surfacing.
      const message = err?.message || '';
      if (!message.includes('method not found')) {
        console.error(
          '[history-browser] history_list_sessions failed',
          err,
        );
      }
      this._sessions = [];
    } finally {
      this._loadingSessions = false;
    }
  }

  async _loadSessionMessages(sessionId) {
    if (!this.rpcConnected || !sessionId) return;
    // Generation guard — if the user clicks a different
    // session before this response arrives, the stale
    // response must not overwrite the new selection.
    const gen = ++this._messagesGeneration;
    this._loadingMessages = true;
    try {
      const result = await this.rpcExtract(
        'LLMService.history_get_session',
        sessionId,
      );
      if (gen !== this._messagesGeneration) return;
      this._selectedMessages = Array.isArray(result) ? result : [];
    } catch (err) {
      console.error(
        '[history-browser] history_get_session failed',
        err,
      );
      if (gen === this._messagesGeneration) {
        this._selectedMessages = [];
      }
    } finally {
      if (gen === this._messagesGeneration) {
        this._loadingMessages = false;
      }
    }
  }

  async _runSearch(query) {
    const gen = ++this._searchGeneration;
    if (!this.rpcConnected) return;
    try {
      const result = await this.rpcExtract(
        'LLMService.history_search',
        query,
      );
      if (gen !== this._searchGeneration) return;
      this._searchHits = Array.isArray(result) ? result : [];
    } catch (err) {
      console.error(
        '[history-browser] history_search failed',
        err,
      );
      if (gen === this._searchGeneration) {
        this._searchHits = [];
      }
    }
  }

  // ---------------------------------------------------------------
  // User actions
  // ---------------------------------------------------------------

  _onBackdropClick(event) {
    // Only close if the click landed on the backdrop itself,
    // not on the modal. Bubbling clicks from inside the
    // modal shouldn't close it.
    if (event.target === event.currentTarget) {
      this._close();
    }
  }

  _onCloseClick() {
    this._close();
  }

  _close() {
    this.dispatchEvent(
      new CustomEvent('close', { bubbles: true, composed: true }),
    );
  }

  _onSearchInput(event) {
    const value = event.target.value;
    this._searchQuery = value;
    // Debounce — cancel any pending timer and start fresh.
    if (this._searchDebounceTimer != null) {
      clearTimeout(this._searchDebounceTimer);
      this._searchDebounceTimer = null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      // Empty query → exit search mode, show session list.
      this._searchMode = false;
      this._searchHits = [];
      // Bump the generation so any in-flight response gets
      // discarded.
      this._searchGeneration += 1;
      return;
    }
    this._searchMode = true;
    this._searchDebounceTimer = setTimeout(() => {
      this._searchDebounceTimer = null;
      this._runSearch(trimmed);
    }, SEARCH_DEBOUNCE_MS);
  }

  _onSearchKeyDown(event) {
    if (event.key === 'Escape') {
      // Two-step Escape: clear the query first, close only
      // if the query is already empty. Matches specs — gives
      // the user a single key to both clear and close.
      event.stopPropagation();
      if (this._searchQuery) {
        this._searchQuery = '';
        this._searchMode = false;
        this._searchHits = [];
        this._searchGeneration += 1;
        if (this._searchDebounceTimer != null) {
          clearTimeout(this._searchDebounceTimer);
          this._searchDebounceTimer = null;
        }
      } else {
        this._close();
      }
    }
  }

  _onKeyDown(event) {
    if (!this.open) return;
    if (event.key === 'Escape') {
      // Top-level Escape handler — closes if the search
      // input didn't already handle it. The search input's
      // handler calls stopPropagation when it's in play.
      this._close();
    }
  }

  _onSessionClick(sessionId) {
    if (this._selectedSessionId === sessionId) return;
    this._selectedSessionId = sessionId;
    this._selectedMessages = [];
    this._loadSessionMessages(sessionId);
  }

  _onSearchHitClick(sessionId) {
    // A search hit is a message in a session — clicking it
    // selects that session for preview. A future enhancement
    // could scroll to the specific message; for now we just
    // load the session.
    this._searchMode = false;
    this._searchQuery = '';
    this._onSessionClick(sessionId);
  }

  async _onLoadClick() {
    if (!this._selectedSessionId) return;
    if (!this.rpcConnected) return;
    if (this._loadingSession) return;
    this._loadingSession = true;
    try {
      await this.rpcExtract(
        'LLMService.load_session_into_context',
        this._selectedSessionId,
      );
      // Dispatch a local event so the parent can close the
      // modal. The server also broadcasts sessionChanged,
      // which the chat panel handles independently — that's
      // how the message list gets populated. This local
      // event is purely a "user-initiated load succeeded"
      // signal so the parent can distinguish from remote
      // session changes.
      this.dispatchEvent(
        new CustomEvent('session-loaded', {
          detail: { session_id: this._selectedSessionId },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      console.error(
        '[history-browser] load_session_into_context failed',
        err,
      );
    } finally {
      this._loadingSession = false;
    }
  }

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------

  render() {
    if (!this.open) return html``;
    return html`
      <div
        class="backdrop"
        @click=${this._onBackdropClick}
        role="presentation"
      >
        <div
          class="modal"
          role="dialog"
          aria-modal="true"
          aria-label="History browser"
        >
          <div class="modal-header">
            <div class="modal-title">History</div>
            <input
              type="text"
              class="search-input"
              placeholder="Search messages…"
              .value=${this._searchQuery}
              @input=${this._onSearchInput}
              @keydown=${this._onSearchKeyDown}
              aria-label="Search history"
            />
            <button
              class="close-button"
              @click=${this._onCloseClick}
              aria-label="Close history browser"
              title="Close (Escape)"
            >
              ✕
            </button>
          </div>
          <div class="modal-body">
            <div class="sessions-pane">
              ${this._searchMode
                ? this._renderSearchHits()
                : this._renderSessionList()}
            </div>
            <div class="preview-pane">
              <div class="preview-messages">
                ${this._renderPreview()}
              </div>
              <div class="preview-footer">
                <button
                  class="load-button"
                  ?disabled=${!this._selectedSessionId ||
                  this._loadingSession ||
                  !this.rpcConnected}
                  @click=${this._onLoadClick}
                >
                  ${this._loadingSession
                    ? 'Loading…'
                    : 'Load into context'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _renderSessionList() {
    if (this._loadingSessions) {
      return html`<div class="loading-note">Loading sessions…</div>`;
    }
    if (this._sessions.length === 0) {
      return html`<div class="empty-list">No sessions yet</div>`;
    }
    return this._sessions.map(
      (s) => html`
        <div
          class="session-item ${this._selectedSessionId === s.session_id
            ? 'selected'
            : ''}"
          @click=${() => this._onSessionClick(s.session_id)}
          role="button"
          aria-pressed=${this._selectedSessionId === s.session_id}
        >
          <div class="session-preview">
            ${s.preview || '(empty)'}
          </div>
          <div class="session-meta">
            <span>${formatRelativeTime(s.timestamp)}</span>
            <span class="msg-count">
              ${s.message_count} ${s.message_count === 1 ? 'msg' : 'msgs'}
            </span>
          </div>
        </div>
      `,
    );
  }

  _renderSearchHits() {
    if (this._searchHits.length === 0) {
      return html`<div class="empty-list">
        ${this._searchQuery.trim()
          ? 'No matches'
          : 'Type to search'}
      </div>`;
    }
    return this._searchHits.map((hit) => {
      // Hit shape from history_search: {session_id,
      // message_id, role, content_preview, timestamp}.
      const preview = hit.content_preview || hit.content || '';
      return html`
        <div
          class="search-hit"
          @click=${() => this._onSearchHitClick(hit.session_id)}
          role="button"
        >
          <div class="hit-role">
            ${hit.role || 'message'}
            · ${formatRelativeTime(hit.timestamp)}
          </div>
          <div class="hit-content">${preview}</div>
        </div>
      `;
    });
  }

  _renderPreview() {
    if (!this._selectedSessionId) {
      return html`<div class="preview-empty">
        Select a session to preview
      </div>`;
    }
    if (this._loadingMessages) {
      return html`<div class="preview-empty">Loading messages…</div>`;
    }
    if (this._selectedMessages.length === 0) {
      return html`<div class="preview-empty">Empty session</div>`;
    }
    return this._selectedMessages.map((msg) =>
      this._renderPreviewMessage(msg),
    );
  }

  _renderPreviewMessage(msg) {
    const roleClass = msg.system_event
      ? 'role-system'
      : `role-${msg.role || 'assistant'}`;
    const roleLabel = msg.system_event
      ? 'System'
      : msg.role === 'user'
        ? 'You'
        : msg.role === 'assistant'
          ? 'Assistant'
          : msg.role || 'Message';
    // User content rendered escaped verbatim; assistant and
    // system markdown-rendered (matches the main chat
    // panel's treatment).
    let body;
    if (msg.role === 'user' && !msg.system_event) {
      body = html`${unsafeHTML(escapeHtml(msg.content || ''))}`;
    } else {
      body = html`${unsafeHTML(renderMarkdown(msg.content || ''))}`;
    }
    return html`
      <div class="preview-message ${roleClass}">
        <div class="preview-role-label">${roleLabel}</div>
        <div class="preview-body">${body}</div>
      </div>
    `;
  }
}

customElements.define('ac-history-browser', HistoryBrowser);

// Exported for tests.
export { formatRelativeTime, SEARCH_DEBOUNCE_MS };