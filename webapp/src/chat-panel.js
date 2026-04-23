// ChatPanel — the primary interaction surface in the Files tab.
//
// Layer 5 Phase 2b — basic chat panel.
//
// Responsibilities in this sub-phase:
//   - Render a message list (user / assistant / system-event)
//   - Show a streaming assistant message as chunks arrive
//   - Auto-scroll on new content, unless the user scrolled up
//   - Provide a text input with Enter-to-send, Shift+Enter for newline
//   - Send user messages via LLMService.chat_streaming
//   - Cancel an active stream via LLMService.cancel_streaming
//   - Listen for server-push events on window (stream-chunk,
//     stream-complete, user-message, session-changed) which the
//     AppShell dispatches
//
// Deferred to later sub-phases (scope boundaries explicit so
// there's no confusion about what this commit does and doesn't do):
//
//   Phase 2c (Files tab orchestration):
//     - @-filter bridge to file picker
//     - Middle-click path insertion
//
//   Phase 2d (Chat advanced):
//     - Edit block rendering with diff highlighting
//     - File mentions in rendered assistant output
//     - Image paste / display / re-attach
//     - Session controls (new session, history browser)
//     - Snippet drawer
//     - Input history (up-arrow recall)
//     - Message action buttons (copy, re-paste)
//     - Retry prompts (not-in-context, ambiguous anchor)
//     - Compaction event routing
//
//   Phase 2e (Search + history browser):
//     - Message search overlay
//     - File search overlay
//     - History browser modal
//     - Speech-to-text toggle
//
// Governing spec: specs4/5-webapp/chat.md
//
// Architectural contracts this implementation preserves:
//
//   - **Streaming state keyed by request ID** (D10 /
//     specs4/0-overview/implementation-guide.md): `_streams` is
//     a Map<requestId, {content, sticky}>. Single-agent
//     operation has at most one entry; the Map shape is
//     load-bearing for future parallel-agent mode where N
//     concurrent streams coexist under a parent user request.
//     Don't flatten this to a singleton.
//
//   - **Chunks carry full accumulated content, not deltas**:
//     the chunk handler replaces the streaming content rather
//     than appending. Dropped or reordered chunks are harmless
//     because each carries a superset of prior content.
//
//   - **Chunks coalesced per animation frame**: `_pendingChunks`
//     holds the latest-seen content per request-id; the rAF
//     callback reads it, clears the pending marker, and
//     updates reactive state. Rapid-fire chunks (every few ms)
//     don't trigger Lit re-renders faster than 60Hz.

import { LitElement, css, html } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import { RpcMixin } from './rpc-mixin.js';
import { escapeHtml, renderMarkdown } from './markdown.js';

/**
 * Generate a request ID matching the specs3 format so the
 * backend's correlation logic works unchanged. Format:
 * `{epoch_ms}-{6-char-alnum}`. Epoch gives monotonic ordering;
 * random suffix breaks ties on the same-millisecond case.
 */
function generateRequestId() {
  const epoch = Date.now();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${epoch}-${suffix}`;
}

/**
 * How close to the bottom counts as "still at the bottom". Scroll
 * events fire with sub-pixel offsets during smooth scrolling, so
 * a tolerance of a few pixels avoids flicker between engaged and
 * disengaged states.
 */
const AUTO_SCROLL_TOLERANCE_PX = 40;

/**
 * How far the user must scroll UP from the bottom to disengage
 * auto-scroll. Looser than the re-engage threshold so a user
 * nudging the scrollbar slightly doesn't accidentally turn off
 * streaming follow. Re-engagement happens when they scroll back
 * to within AUTO_SCROLL_TOLERANCE_PX of the bottom.
 */
const AUTO_SCROLL_DISENGAGE_PX = 100;

export class ChatPanel extends RpcMixin(LitElement) {
  static properties = {
    /**
     * Messages as `{role, content, system_event?}` dicts.
     * Replaced wholesale on session load; appended during
     * normal conversation. Always a new array on change so
     * Lit's default identity check triggers re-render.
     */
    messages: { type: Array },
    /** Current textarea content. Cleared on send. */
    _input: { type: String, state: true },
    /**
     * True while a user-initiated stream is in flight. Drives
     * the Send/Stop toggle and disables the input.
     */
    _streaming: { type: Boolean, state: true },
    /**
     * Rendered content of the active streaming assistant
     * message. Updated per animation frame, not per chunk, so
     * Lit re-render rate is capped at ~60Hz.
     */
    _streamingContent: { type: String, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: var(--bg-primary, #0d1117);
      color: var(--text-primary, #c9d1d9);
      font-size: 0.9375rem;
      line-height: 1.5;
    }

    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .empty-state {
      margin: auto;
      opacity: 0.5;
      font-style: italic;
      text-align: center;
    }

    .message-card {
      border-radius: 8px;
      padding: 0.75rem 1rem;
      max-width: 100%;
      overflow-wrap: break-word;
      word-wrap: break-word;
    }
    .message-card.role-user {
      background: rgba(88, 166, 255, 0.08);
      border: 1px solid rgba(88, 166, 255, 0.2);
    }
    .message-card.role-assistant {
      background: rgba(240, 246, 252, 0.03);
      border: 1px solid rgba(240, 246, 252, 0.1);
    }
    .message-card.role-system {
      background: rgba(240, 246, 252, 0.03);
      border: 1px dashed rgba(240, 246, 252, 0.2);
      color: var(--text-secondary, #8b949e);
      font-style: italic;
    }
    .message-card.streaming {
      border-color: var(--accent-primary, #58a6ff);
    }

    .role-label {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.6;
      margin-bottom: 0.375rem;
    }

    /* Markdown-rendered content inherits the message card's
     * styling but tightens up paragraphs and adds a subtle
     * background on code blocks. */
    .md-content :first-child {
      margin-top: 0;
    }
    .md-content :last-child {
      margin-bottom: 0;
    }
    .md-content p {
      margin: 0.5rem 0;
    }
    .md-content pre {
      background: rgba(13, 17, 23, 0.9);
      border: 1px solid rgba(240, 246, 252, 0.1);
      border-radius: 6px;
      padding: 0.75rem;
      overflow-x: auto;
      margin: 0.75rem 0;
    }
    .md-content code {
      background: rgba(13, 17, 23, 0.6);
      border-radius: 3px;
      padding: 0.1rem 0.35rem;
      font-size: 0.875em;
    }
    .md-content pre code {
      background: transparent;
      padding: 0;
      font-size: 0.875em;
    }
    .md-content h1,
    .md-content h2,
    .md-content h3 {
      margin: 1rem 0 0.5rem;
      line-height: 1.3;
    }
    .md-content table {
      border-collapse: collapse;
      margin: 0.75rem 0;
    }
    .md-content th,
    .md-content td {
      border: 1px solid rgba(240, 246, 252, 0.15);
      padding: 0.35rem 0.6rem;
    }

    .cursor {
      display: inline-block;
      width: 0.5em;
      height: 1em;
      background: var(--accent-primary, #58a6ff);
      vertical-align: text-bottom;
      margin-left: 2px;
      animation: blink 1s steps(2) infinite;
    }
    @keyframes blink {
      to {
        opacity: 0;
      }
    }

    /* Input area at the bottom. */
    .input-area {
      flex-shrink: 0;
      border-top: 1px solid rgba(240, 246, 252, 0.1);
      padding: 0.75rem 1rem;
      background: rgba(13, 17, 23, 0.6);
    }
    .input-row {
      display: flex;
      gap: 0.5rem;
      align-items: flex-end;
    }
    .input-textarea {
      flex: 1;
      min-height: 2.25rem;
      max-height: 12rem;
      resize: none;
      padding: 0.5rem 0.75rem;
      background: rgba(13, 17, 23, 0.8);
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 6px;
      color: var(--text-primary, #c9d1d9);
      font-family: inherit;
      font-size: inherit;
      line-height: 1.4;
    }
    .input-textarea:focus {
      outline: none;
      border-color: var(--accent-primary, #58a6ff);
    }
    .input-textarea:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .send-button {
      flex-shrink: 0;
      min-width: 4rem;
      padding: 0.5rem 1rem;
      background: var(--accent-primary, #58a6ff);
      border: none;
      border-radius: 6px;
      color: #0d1117;
      font-weight: 600;
      cursor: pointer;
    }
    .send-button:hover {
      filter: brightness(1.1);
    }
    .send-button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .send-button.stop {
      background: #f85149;
      color: #fff;
    }

    /* Disconnected banner — shown when RPC isn't ready so users
     * understand why the Send button is inert. */
    .disconnected-note {
      padding: 0.5rem 1rem;
      background: rgba(248, 81, 73, 0.1);
      color: #f85149;
      font-size: 0.8125rem;
      border-top: 1px solid rgba(248, 81, 73, 0.25);
    }
  `;

  constructor() {
    super();
    this.messages = [];
    this._input = '';
    this._streaming = false;
    this._streamingContent = '';

    // Per-request streaming state. Map<requestId, {content,
    // sticky}> where sticky is true when scroll is engaged. We
    // keep this as a Map even though single-agent operation
    // has at most one entry at a time — parallel-agent mode
    // (D10) produces N concurrent streams under a parent ID,
    // and the transport layer routes chunks to the right state
    // slot via the request ID.
    this._streams = new Map();
    // Which request ID is "ours" — the most recent user-initiated
    // send. Chunks for other request IDs (e.g. from a
    // collaborator's prompt) are ignored in Phase 2b; Phase 2d
    // will adopt them as passive streams.
    this._currentRequestId = null;

    // rAF coalescing state — `_pendingChunks` is
    // Map<requestId, content>. The rAF callback reads and
    // clears entries, and updates `_streamingContent` from the
    // pending content for `_currentRequestId`.
    this._pendingChunks = new Map();
    this._rafHandle = null;

    // Auto-scroll state. Engaged by default; disengaged when
    // the user scrolls up during streaming.
    this._autoScroll = true;

    // Bound handlers so add/remove match and we can clean up.
    this._onStreamChunk = this._onStreamChunk.bind(this);
    this._onStreamComplete = this._onStreamComplete.bind(this);
    this._onUserMessage = this._onUserMessage.bind(this);
    this._onSessionChanged = this._onSessionChanged.bind(this);
    this._onMessagesScroll = this._onMessagesScroll.bind(this);
  }

  // ---------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('stream-chunk', this._onStreamChunk);
    window.addEventListener('stream-complete', this._onStreamComplete);
    window.addEventListener('user-message', this._onUserMessage);
    window.addEventListener('session-changed', this._onSessionChanged);
  }

  disconnectedCallback() {
    window.removeEventListener('stream-chunk', this._onStreamChunk);
    window.removeEventListener('stream-complete', this._onStreamComplete);
    window.removeEventListener('user-message', this._onUserMessage);
    window.removeEventListener('session-changed', this._onSessionChanged);
    if (this._rafHandle != null) {
      cancelAnimationFrame(this._rafHandle);
      this._rafHandle = null;
    }
    super.disconnectedCallback();
  }

  updated(changedProps) {
    // Scroll to bottom on each state update — but only if the
    // user hasn't scrolled up. The passive scroll listener
    // manages `_autoScroll`.
    if (this._autoScroll) {
      this._scrollToBottom();
    }
  }

  // ---------------------------------------------------------------
  // Server-push event handlers
  // ---------------------------------------------------------------

  _onStreamChunk(event) {
    const { requestId, content } = event.detail || {};
    if (!requestId) return;
    // Store the latest content for this request. Full-content
    // semantics means we overwrite, not append — each chunk
    // carries a superset of prior content. Dropped chunks are
    // harmless.
    this._pendingChunks.set(requestId, content ?? '');
    this._scheduleFlush();
  }

  _onStreamComplete(event) {
    const { requestId, result } = event.detail || {};
    if (!requestId) return;

    // Flush any pending chunk synchronously so the final
    // content is reflected before we move it into messages.
    const pending = this._pendingChunks.get(requestId);
    if (pending !== undefined) {
      this._pendingChunks.delete(requestId);
      if (requestId === this._currentRequestId) {
        this._streamingContent = pending;
      }
    }

    // Move the streaming content into the message list as a
    // finalised assistant message. Error responses surface as
    // a dedicated error message rather than assistant content.
    if (requestId === this._currentRequestId) {
      const finalContent =
        result?.response ?? this._streamingContent ?? '';
      const error = result?.error;
      this.messages = [
        ...this.messages,
        error
          ? {
              role: 'assistant',
              content: `**Error:** ${error}`,
            }
          : {
              role: 'assistant',
              content: finalContent,
            },
      ];
      this._streaming = false;
      this._streamingContent = '';
      this._currentRequestId = null;
    }

    this._streams.delete(requestId);
  }

  _onUserMessage(event) {
    // The server broadcasts user messages to all clients. If
    // we are the sender, we've already added it optimistically
    // in `_send`, so we ignore the echo. If we're a
    // collaborator, we add it here so the message appears
    // before the streaming response arrives.
    //
    // Detection — if a user-initiated request is in flight,
    // we're the sender; skip. Otherwise we're a passive
    // observer and should add the message.
    if (this._currentRequestId) return;
    const data = event.detail || {};
    const content = data.content ?? '';
    if (!content) return;
    this.messages = [
      ...this.messages,
      { role: 'user', content },
    ];
  }

  _onSessionChanged(event) {
    // Session load or new-session — replace the message list
    // wholesale. The event carries the messages array; we
    // default to empty for new sessions.
    const data = event.detail || {};
    const msgs = Array.isArray(data.messages) ? data.messages : [];
    // Normalise to our internal shape — messages from the
    // backend carry extra metadata we ignore in Phase 2b
    // (files, edit_results, etc.). Phase 2d renders those.
    this.messages = msgs.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.system_event ? { system_event: true } : {}),
    }));
    // Reset transient state — a session switch cancels any
    // in-flight stream from the caller's perspective (the
    // backend's stream may still be running but we're no
    // longer interested).
    this._streaming = false;
    this._streamingContent = '';
    this._currentRequestId = null;
    this._streams.clear();
    this._pendingChunks.clear();
    this._autoScroll = true;
  }

  // ---------------------------------------------------------------
  // rAF coalescing
  // ---------------------------------------------------------------

  _scheduleFlush() {
    if (this._rafHandle != null) return;
    this._rafHandle = requestAnimationFrame(() => {
      this._rafHandle = null;
      // Drain the latest pending content for our current
      // request. Other request IDs (parallel agents, collab
      // broadcasts) are held until they're needed — Phase 2b
      // doesn't render them.
      const pending = this._pendingChunks.get(this._currentRequestId);
      if (pending !== undefined) {
        this._pendingChunks.delete(this._currentRequestId);
        this._streamingContent = pending;
      }
    });
  }

  // ---------------------------------------------------------------
  // Send + cancel
  // ---------------------------------------------------------------

  async _send() {
    const text = this._input.trim();
    if (!text) return;
    if (this._streaming) return;
    if (!this.rpcConnected) return;

    const requestId = generateRequestId();
    this._currentRequestId = requestId;
    this._streams.set(requestId, { content: '', sticky: true });

    // Add the user message optimistically. The server will
    // broadcast `userMessage` shortly; our handler detects the
    // in-flight request and skips the echo.
    this.messages = [
      ...this.messages,
      { role: 'user', content: text },
    ];
    this._input = '';
    this._streaming = true;
    this._streamingContent = '';
    this._autoScroll = true;

    try {
      await this.rpcExtract(
        'LLMService.chat_streaming',
        requestId,
        text,
      );
      // Response is {status: "started"}. Chunks and completion
      // arrive via server-push events; nothing more to do here.
    } catch (err) {
      console.error('[chat] chat_streaming failed', err);
      this.messages = [
        ...this.messages,
        {
          role: 'assistant',
          content: `**Error:** ${err?.message || String(err)}`,
        },
      ];
      this._streaming = false;
      this._currentRequestId = null;
      this._streams.delete(requestId);
    }
  }

  async _cancel() {
    if (!this._streaming || !this._currentRequestId) return;
    if (!this.rpcConnected) return;
    try {
      await this.rpcExtract(
        'LLMService.cancel_streaming',
        this._currentRequestId,
      );
      // Response arrives as streamComplete with
      // cancelled=true; handled uniformly in _onStreamComplete.
    } catch (err) {
      console.warn('[chat] cancel_streaming failed', err);
      // Fall back to local cleanup — the server may have
      // already finished, so the cancel call is best-effort.
      this._streaming = false;
      this._streamingContent = '';
      this._currentRequestId = null;
      this._streams.clear();
    }
  }

  // ---------------------------------------------------------------
  // Input handling
  // ---------------------------------------------------------------

  _onInputChange(event) {
    this._input = event.target.value;
    // Auto-resize the textarea. Reset height first so shrinking
    // works when the user deletes content; then measure and
    // clamp to CSS max.
    const ta = event.target;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 192)}px`;
  }

  _onInputKeyDown(event) {
    // Enter sends; Shift+Enter inserts a newline. The
    // composition guard prevents premature send during IME
    // input (e.g. Japanese/Chinese input methods).
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this._send();
    }
  }

  // ---------------------------------------------------------------
  // Scroll handling
  // ---------------------------------------------------------------

  _onMessagesScroll(event) {
    const el = event.currentTarget;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom > AUTO_SCROLL_DISENGAGE_PX) {
      this._autoScroll = false;
    } else if (distanceFromBottom <= AUTO_SCROLL_TOLERANCE_PX) {
      this._autoScroll = true;
    }
  }

  _scrollToBottom() {
    // Double rAF — wait for Lit's DOM commit, then one more
    // frame for browser layout to settle before measuring
    // scrollHeight. Without this, the first chunk of a stream
    // sometimes scrolls to stale dimensions.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = this.shadowRoot?.querySelector(
          '.messages',
        );
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
    });
  }

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------

  render() {
    return html`
      <div
        class="messages"
        role="log"
        aria-live="polite"
        @scroll=${this._onMessagesScroll}
      >
        ${this.messages.length === 0 && !this._streaming
          ? html`<div class="empty-state">
              Start a conversation…
            </div>`
          : ''}
        ${this.messages.map((msg) => this._renderMessage(msg))}
        ${this._streaming ? this._renderStreamingMessage() : ''}
      </div>
      ${!this.rpcConnected
        ? html`<div class="disconnected-note">
            Not connected to the server
          </div>`
        : ''}
      <div class="input-area">
        <div class="input-row">
          <textarea
            class="input-textarea"
            placeholder="Send a message… (Enter to send, Shift+Enter for newline)"
            .value=${this._input}
            ?disabled=${!this.rpcConnected || this._streaming}
            @input=${this._onInputChange}
            @keydown=${this._onInputKeyDown}
            aria-label="Message input"
          ></textarea>
          ${this._streaming
            ? html`<button
                class="send-button stop"
                @click=${this._cancel}
                aria-label="Stop streaming"
              >
                ⏹ Stop
              </button>`
            : html`<button
                class="send-button"
                ?disabled=${!this.rpcConnected ||
                !this._input.trim()}
                @click=${this._send}
                aria-label="Send message"
              >
                Send
              </button>`}
        </div>
      </div>
    `;
  }

  _renderMessage(msg) {
    const roleClass = msg.system_event ? 'role-system' : `role-${msg.role}`;
    const roleLabel = msg.system_event
      ? 'System'
      : msg.role === 'user'
        ? 'You'
        : 'Assistant';
    // User content is rendered verbatim (escaped) — the user
    // typed what they typed, we don't re-interpret it as
    // markdown. Assistant and system messages are
    // markdown-rendered.
    const contentHtml =
      msg.role === 'user' && !msg.system_event
        ? escapeHtml(msg.content)
        : renderMarkdown(msg.content);
    return html`
      <div class="message-card ${roleClass}">
        <div class="role-label">${roleLabel}</div>
        <div class="md-content">${unsafeHTML(contentHtml)}</div>
      </div>
    `;
  }

  _renderStreamingMessage() {
    // The streaming card uses the assistant role styling with
    // an accent-coloured border to distinguish it from settled
    // messages. The blinking cursor makes it obvious the
    // response is still arriving.
    return html`
      <div class="message-card role-assistant streaming">
        <div class="role-label">Assistant</div>
        <div class="md-content">
          ${unsafeHTML(renderMarkdown(this._streamingContent))}
          <span class="cursor"></span>
        </div>
      </div>
    `;
  }
}

customElements.define('ac-chat-panel', ChatPanel);

export { generateRequestId };