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
import {
  matchSegmentsToResults,
  segmentResponse,
} from './edit-blocks.js';
import { renderEditCard } from './edit-block-render.js';
import { findFileMentions } from './file-mentions.js';
import { escapeHtml, renderMarkdown } from './markdown.js';
import './history-browser.js';

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
    /**
     * Flat list of repo-relative file paths. The files-tab
     * orchestrator pushes this down via direct assignment
     * when the file tree loads (matching the selectedFiles
     * pattern from Phase 2c). Assistant messages are
     * post-processed to wrap matching substrings in
     * clickable `.file-mention` spans; see
     * `_renderAssistantBody`.
     *
     * Empty array (default) disables mention detection
     * entirely — `findFileMentions` short-circuits on empty
     * lists so the cost is nil until the files-tab wires
     * up.
     */
    repoFiles: { type: Array },
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
    /**
     * Whether the history browser modal is open. Toggled by
     * the "History" button and by the modal's close/load
     * events.
     */
    _historyOpen: { type: Boolean, state: true },
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
    .action-bar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
      min-height: 1.75rem;
    }
    .action-bar .spacer {
      flex: 1;
    }
    .action-bar .action-divider {
      width: 1px;
      height: 1.25rem;
      background: rgba(240, 246, 252, 0.15);
      flex-shrink: 0;
    }
    .action-group {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    .action-button {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-secondary, #8b949e);
      padding: 0.25rem 0.5rem;
      font-size: 0.8125rem;
      border-radius: 4px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
    }
    .action-button:hover {
      background: rgba(240, 246, 252, 0.06);
      color: var(--text-primary, #c9d1d9);
      border-color: rgba(240, 246, 252, 0.1);
    }
    .action-button:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }
    .action-button:disabled:hover {
      background: transparent;
      border-color: transparent;
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

    /* Edit blocks — visual cards for edits proposed by the
     * assistant. Minimal styling here; Phase 2d adds the
     * character-level diff highlighting. */
    .assistant-body {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .edit-block-card {
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 6px;
      background: rgba(13, 17, 23, 0.4);
      overflow: hidden;
      font-size: 0.875rem;
    }
    .edit-block-card.edit-status-applied {
      border-color: rgba(126, 231, 135, 0.4);
    }
    .edit-block-card.edit-status-failed {
      border-color: rgba(248, 81, 73, 0.45);
    }
    .edit-block-card.edit-status-skipped,
    .edit-block-card.edit-status-not-in-context {
      border-color: rgba(210, 153, 34, 0.4);
    }
    .edit-block-card.edit-status-pending,
    .edit-block-card.edit-status-new {
      border-color: rgba(88, 166, 255, 0.35);
    }
    .edit-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.4rem 0.75rem;
      background: rgba(22, 27, 34, 0.7);
      border-bottom: 1px solid rgba(240, 246, 252, 0.08);
    }
    .edit-file-path {
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 0.8125rem;
      color: var(--accent-primary, #58a6ff);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .edit-status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      flex-shrink: 0;
      font-size: 0.75rem;
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
      background: rgba(13, 17, 23, 0.6);
    }
    .edit-status-icon {
      font-size: 0.875rem;
    }
    .edit-status-applied {
      color: #7ee787;
    }
    .edit-status-failed {
      color: #f85149;
    }
    .edit-status-skipped,
    .edit-status-not-in-context {
      color: #d29922;
    }
    .edit-status-pending,
    .edit-status-new {
      color: var(--accent-primary, #58a6ff);
    }
    .edit-status-unknown {
      color: var(--text-secondary, #8b949e);
    }
    .edit-body {
      display: flex;
      flex-direction: column;
    }
    .edit-pane {
      border-bottom: 1px solid rgba(240, 246, 252, 0.05);
    }
    .edit-pane:last-child {
      border-bottom: none;
    }
    .edit-pane-label {
      padding: 0.25rem 0.75rem;
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      color: var(--text-secondary, #8b949e);
      background: rgba(22, 27, 34, 0.4);
    }
    .edit-pane-old .edit-pane-label {
      color: #f85149;
    }
    .edit-pane-new .edit-pane-label {
      color: #7ee787;
    }
    .edit-pane-content {
      margin: 0;
      padding: 0.5rem 0.75rem;
      background: transparent;
      border: none;
      border-radius: 0;
      overflow-x: auto;
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 0.8125rem;
      line-height: 1.45;
      color: var(--text-primary, #c9d1d9);
    }
    .edit-error-message {
      padding: 0.4rem 0.75rem;
      background: rgba(248, 81, 73, 0.08);
      color: #f85149;
      font-size: 0.8125rem;
      border-top: 1px solid rgba(248, 81, 73, 0.15);
    }

    /* File mentions — clickable path references inside
     * assistant prose. Styled to look like a link without
     * actually being one (no underline by default to keep
     * prose readable; underline on hover for affordance). */
    .file-mention {
      color: var(--accent-primary, #58a6ff);
      cursor: pointer;
      border-radius: 3px;
      padding: 0 0.15rem;
      transition: background 120ms ease;
    }
    .file-mention:hover {
      background: rgba(88, 166, 255, 0.12);
      text-decoration: underline;
    }
  `;

  constructor() {
    super();
    this.messages = [];
    this.repoFiles = [];
    this._input = '';
    this._streaming = false;
    this._streamingContent = '';
    this._historyOpen = false;

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
    this._onMessagesClick = this._onMessagesClick.bind(this);
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
    // Attach edit_results so the renderer can pair each edit
    // segment with its backend result (applied / failed /
    // skipped / not_in_context) via matchSegmentsToResults.
    if (requestId === this._currentRequestId) {
      const finalContent =
        result?.response ?? this._streamingContent ?? '';
      const error = result?.error;
      const editResults = Array.isArray(result?.edit_results)
        ? result.edit_results
        : undefined;
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
              editResults,
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

  /**
   * Start a new session. The server generates a new
   * session ID, clears history, and broadcasts
   * `sessionChanged` with an empty messages array. Our
   * `_onSessionChanged` handler then resets the message
   * list and streaming state — so this method is
   * responsibility-light: call the RPC, trust the
   * broadcast to clean up.
   *
   * Disabled during streaming to avoid racing against
   * an in-flight stream. The spec-level contract says
   * starting a new session "cancels any in-flight
   * stream from the caller's perspective", but we
   * prefer to gate at the UI layer rather than
   * abandoning a stream mid-flight. User cancels
   * explicitly via the Stop button first, then starts
   * a new session.
   */
  async _onNewSession() {
    if (this._streaming) return;
    if (!this.rpcConnected) return;
    try {
      await this.rpcExtract('LLMService.new_session');
      // The server's `sessionChanged` broadcast is what
      // actually clears our message list. No local
      // state to update here.
    } catch (err) {
      console.error('[chat] new_session failed', err);
    }
  }

  /**
   * Open the history browser modal. Disabled while
   * streaming for the same reason as new-session — a
   * mid-stream session switch would leave the in-flight
   * stream orphaned. Unlike new-session, the modal itself
   * is harmless to open; the gate is on the "load" action
   * inside the modal, which the user reaches intentionally.
   * But we gate the opening too so the button state is
   * consistent with new-session and there's no
   * inconsistency if the user tries to load while streaming.
   */
  _onOpenHistory() {
    if (this._streaming) return;
    this._historyOpen = true;
  }

  /**
   * Close event from the history browser. Just toggles our
   * open state off; the modal handles its own cleanup.
   */
  _onHistoryClose() {
    this._historyOpen = false;
  }

  /**
   * Load-session event from the history browser. The server
   * broadcasts `sessionChanged` independently (handled by
   * `_onSessionChanged`), so this handler's only job is to
   * close the modal — the message list is replaced via the
   * broadcast path. Treating the local event as
   * "user-initiated load succeeded" lets us distinguish it
   * from a remote session change (where we wouldn't want
   * to close anything).
   */
  _onHistorySessionLoaded() {
    this._historyOpen = false;
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

  /**
   * Single click listener on the messages container —
   * event delegation for file mention clicks. Dispatches
   * `file-mention-click` with `{path}` detail when a
   * `.file-mention` element is clicked. The event bubbles
   * up through the shadow DOM boundary (composed: true)
   * so the files-tab orchestrator can listen at its level
   * and toggle file selection.
   *
   * Delegation pattern rather than per-span handlers so
   * lit-html's template diffing doesn't need to track
   * handler attachment per span — the wrapped HTML comes
   * from `unsafeHTML` and doesn't participate in Lit's
   * event binding anyway.
   */
  _onMessagesClick(event) {
    const target = event.target;
    if (!target || !target.classList) return;
    if (!target.classList.contains('file-mention')) return;
    const path = target.getAttribute('data-file');
    if (!path) return;
    event.preventDefault();
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('file-mention-click', {
        detail: { path },
        bubbles: true,
        composed: true,
      }),
    );
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
        @click=${this._onMessagesClick}
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
        <div class="action-bar" role="toolbar">
          <div class="spacer"></div>
          <div class="action-divider" aria-hidden="true"></div>
          <div class="action-group">
            <button
              class="action-button new-session-button"
              ?disabled=${!this.rpcConnected || this._streaming}
              @click=${this._onNewSession}
              aria-label="Start a new session"
              title="New session (clears the conversation)"
            >
              ✨ New session
            </button>
            <button
              class="action-button history-button"
              ?disabled=${!this.rpcConnected || this._streaming}
              @click=${this._onOpenHistory}
              aria-label="Open history browser"
              title="Browse past sessions"
            >
              📜 History
            </button>
          </div>
        </div>
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
      <ac-history-browser
        ?open=${this._historyOpen}
        @close=${this._onHistoryClose}
        @session-loaded=${this._onHistorySessionLoaded}
      ></ac-history-browser>
    `;
  }

  _renderMessage(msg) {
    const roleClass = msg.system_event ? 'role-system' : `role-${msg.role}`;
    const roleLabel = msg.system_event
      ? 'System'
      : msg.role === 'user'
        ? 'You'
        : 'Assistant';
    // User and system-event content is rendered as-is — users
    // typed what they typed (escaped verbatim), system events
    // come through markdown so the `**Committed** …` pattern
    // renders correctly. Assistant content goes through the
    // edit-block segmenter so edit blocks become visual cards
    // instead of raw prose.
    let bodyHtml;
    if (msg.role === 'user' && !msg.system_event) {
      bodyHtml = html`
        <div class="md-content">${unsafeHTML(escapeHtml(msg.content))}</div>
      `;
    } else if (msg.role === 'assistant') {
      bodyHtml = this._renderAssistantBody(
        msg.content,
        msg.editResults,
        false,
      );
    } else {
      bodyHtml = html`
        <div class="md-content">
          ${unsafeHTML(renderMarkdown(msg.content))}
        </div>
      `;
    }
    return html`
      <div class="message-card ${roleClass}">
        <div class="role-label">${roleLabel}</div>
        ${bodyHtml}
      </div>
    `;
  }

  /**
   * Render assistant message body as a mix of prose segments
   * (through markdown) and edit-block segments (through the
   * renderer). The parser handles code-fence stripping around
   * edit blocks; prose segments are passed to marked as-is.
   *
   * Accepts an optional `editResults` array from the backend's
   * stream-complete payload. The parser emits segments in
   * source order; `matchSegmentsToResults` pairs them to
   * backend results using the per-file index counter pattern
   * (nth block for file X → nth result for file X).
   *
   * File mention detection runs on prose segments ONLY when
   * `isStreaming` is false. Mid-stream content grows chunk
   * by chunk; running mention detection on partial prose
   * could wrap a path just as the LLM is about to extend it
   * into a different word (`src/foo.py` becomes
   * `src/foo.pyc` mid-stream). Keeping streaming renders
   * mention-free avoids flicker and keeps the rAF hot path
   * fast. Per specs4/5-webapp/chat.md — "On final render
   * only".
   *
   * @param {string} content — assistant message text
   * @param {Array<object> | undefined} editResults — from
   *   stream-complete.result.edit_results, undefined while
   *   streaming or for error messages
   * @param {boolean} isStreaming — true when rendering the
   *   in-flight streaming card, false for settled messages
   * @returns {import('lit').TemplateResult}
   */
  _renderAssistantBody(content, editResults, isStreaming) {
    const segments = segmentResponse(content || '');
    if (segments.length === 0) {
      // Empty content — nothing to render. Happens briefly
      // between stream start and first chunk.
      return html`<div class="md-content"></div>`;
    }
    const matched = matchSegmentsToResults(
      segments,
      Array.isArray(editResults) ? editResults : [],
    );
    // Render each segment as its own DOM block. Edit cards
    // and prose alternate; keeping them as siblings (rather
    // than joining into one HTML string) lets Lit's diffing
    // reconcile efficiently on chunk updates.
    const wrapMentions =
      !isStreaming &&
      Array.isArray(this.repoFiles) &&
      this.repoFiles.length > 0;
    const parts = segments.map((seg, i) => {
      if (seg.type === 'text') {
        // Markdown-render prose. Empty text segments (can
        // happen around fences) produce no visible output
        // but occupy a DOM slot so Lit's keyed diff stays
        // stable.
        let html_ = renderMarkdown(seg.content);
        if (wrapMentions) {
          html_ = findFileMentions(html_, this.repoFiles);
        }
        return html`
          <div class="md-content">${unsafeHTML(html_)}</div>
        `;
      }
      // edit and edit-pending both go through renderEditCard.
      // Pending segments resolve to the 'pending' status
      // badge; completed segments use their matched result.
      const cardHtml = renderEditCard(seg, matched[i] || null);
      return html`${unsafeHTML(cardHtml)}`;
    });
    return html`<div class="assistant-body">${parts}</div>`;
  }

  _renderStreamingMessage() {
    // The streaming card uses the assistant role styling with
    // an accent-coloured border to distinguish it from settled
    // messages. Content goes through the same segmenter as
    // final messages so pending edit blocks show up as cards
    // mid-stream. The blinking cursor sits after the body so
    // it's visible regardless of whether the last segment is
    // prose or an edit block in progress.
    //
    // editResults is undefined — the backend hasn't sent
    // stream-complete yet, so every edit segment renders in
    // its pending/in-flight state (pending status for
    // incomplete blocks, `new` for create blocks with empty
    // oldText, `pending` for modify blocks awaiting results).
    return html`
      <div class="message-card role-assistant streaming">
        <div class="role-label">Assistant</div>
        ${this._renderAssistantBody(
          this._streamingContent,
          undefined,
          true,
        )}
        <span class="cursor"></span>
      </div>
    `;
  }
}

customElements.define('ac-chat-panel', ChatPanel);

export { generateRequestId };