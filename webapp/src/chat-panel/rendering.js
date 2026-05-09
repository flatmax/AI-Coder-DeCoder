// Render entry point + render helpers for the
// ChatPanel component.
//
// One exported function per visual region of the
// component, plus the top-level `render(panel)`
// that stitches them together. All functions take
// the chat-panel instance as their first argument
// — same convention as tabs.js / search.js /
// streaming.js / urls.js / input.js.
//
// The split is by visual region rather than by
// state contract, so reading the render code top-
// to-bottom mirrors what the user sees:
//
//   render → tab strip → messages wrapper
//                         → messages list
//                           → renderMessage (per card)
//                             → renderMessageToolbar
//                             → renderAssistantBody
//                             → renderEditSummary
//                             → renderFileSummary
//                             → renderMessageImages
//                             → renderFinishBadge
//                           → renderStreamingMessage
//                         → renderFileSearchOverlay
//                       → disconnected-note
//                       → input-area
//                         → action bar
//                         → renderSearchBar
//                         → renderSnippetDrawer
//                         → input-history
//                         → renderPendingImages
//                         → ac-url-chips
//                         → input row + send column
//                       → ac-history-browser
//                       → renderLightbox
//                       → renderUrlViewDialog
//
// Helpers like `collectMessageFiles` and
// `proseContainsPath` are kept here too because
// they only feed into renderFileSummary — moving
// them elsewhere would just create another
// import cycle. They're pure and tested via the
// component's own tests.

import { html } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import {
  matchSegmentsToResults,
  segmentResponse,
} from '../edit-blocks.js';
import { renderEditCard } from '../edit-block-render.js';
import { findFileMentions } from '../file-mentions.js';
import { renderMarkdown } from '../markdown.js';
import { renderLedRow } from './led-row.js';
import { renderTabStrip } from './tabs.js';
import { _EXPERIMENTAL_ENABLED, parseAgentTabId } from './helpers.js';
import {
  computeSearchMatches,
  onFileSearchNext,
  onFileSearchPrev,
  onFileSearchOverlayScroll,
  onSearchInput,
  onSearchKeyDown,
  onSearchNext,
  onSearchPrev,
  toggleSearchMode,
  toggleSearchOption,
  totalFileSearchMatches,
} from './search.js';
import {
  cancel,
  closeLightbox,
  insertSnippet,
  onAddAllFiles,
  onFileChipClick,
  onHistoryCancel,
  onHistorySelect,
  onInputChange,
  onInputKeyDown,
  onInputPaste,
  onLightboxKeyDown,
  onMessagesClick,
  onMessagesScroll,
  onNewSession,
  onOpenHistory,
  openLightbox,
  pasteMessageToPrompt,
  reattachImage,
  removePendingImage,
  send,
  toggleReasoning,
  toggleSnippetDrawer,
  copyMessageText,
} from './input.js';
import {
  closeUrlViewDialog,
  onUrlFetchRequested,
  onUrlRemoveRequested,
  onUrlViewKeyDown,
  onUrlViewRequested,
} from './urls.js';

// ---------------------------------------------------------------
// Top-level render
// ---------------------------------------------------------------

/**
 * Render the whole chat panel. Lit calls this on
 * every reactive-property change.
 *
 * Layout sketch:
 *
 *   ┌─ tab strip (hidden when only main exists) ─┐
 *   ├─ messages-wrapper ─────────────────────────┤
 *   │  messages list (or .messages-hidden)        │
 *   │  file-search overlay (when in file mode)   │
 *   ├─ disconnected-note (when RPC down) ────────┤
 *   ├─ input-area ───────────────────────────────┤
 *   │  action-bar                                 │
 *   │  search-bar                                 │
 *   │  snippet drawer (if open)                   │
 *   │  ac-input-history                           │
 *   │  pending images (if any)                    │
 *   │  ac-url-chips                               │
 *   │  input row (textarea + send column)         │
 *   ├─ ac-history-browser (modal) ────────────────┤
 *   ├─ lightbox (if open) ───────────────────────┤
 *   └─ URL view dialog (if open) ────────────────┘
 *
 * The two overlays at the end (lightbox + URL
 * view) live at component-root level so they can
 * cover the whole shadow root regardless of
 * scroll position inside the messages list.
 */
export function render(panel) {
  const fileMode = panel._searchMode === 'file';
  return html`
    ${renderTabStrip(panel)}
    ${renderLedRow(panel)}
    <div class="messages-wrapper">
      <div
        class="messages ${fileMode ? 'messages-hidden' : ''}"
        role="log"
        aria-live="polite"
        @scroll=${(e) => onMessagesScroll(panel, e)}
        @click=${(e) => onMessagesClick(panel, e)}
      >
        ${panel.messages.length === 0 && !panel._streaming
          ? html`<div class="empty-state">
              Start a conversation…
            </div>`
          : ''}
        ${panel.messages.map((msg, index) =>
          renderMessage(panel, msg, index),
        )}
        ${panel._streaming ? renderStreamingMessage(panel) : ''}
      </div>
      ${fileMode ? renderFileSearchOverlay(panel) : ''}
    </div>
    ${!panel.rpcConnected
      ? html`<div class="disconnected-note">
          Not connected to the server
        </div>`
      : ''}
    <div class="input-area">
      <div class="action-bar" role="toolbar">
        ${panel._activeTabId === 'main'
          ? html`<div class="mode-toggle" role="group" aria-label="Context mode">
              <div class="mode-segmented">
                <button
                  class="mode-btn ${panel._mode === 'code' ? 'active' : ''}"
                  ?disabled=${!panel.rpcConnected}
                  title="Code mode — symbol index feeds context"
                  aria-pressed=${panel._mode === 'code'}
                  @click=${() => panel._switchMode('code')}
                >💻</button>
                <button
                  class="mode-btn ${panel._mode === 'doc' ? 'active' : ''}"
                  ?disabled=${!panel.rpcConnected}
                  title="Document mode — doc index feeds context"
                  aria-pressed=${panel._mode === 'doc'}
                  @click=${() => panel._switchMode('doc')}
                >📄</button>
              </div>
              <button
                class="crossref-btn ${panel._crossRefEnabled ? 'active' : ''}"
                ?disabled=${!panel.rpcConnected}
                title=${panel._crossRefEnabled
                  ? 'Cross-reference ON — both indexes active (click to disable)'
                  : 'Cross-reference OFF — click to add the other index alongside'}
                aria-pressed=${panel._crossRefEnabled}
                @click=${() => panel._toggleCrossRef()}
              >🔀</button>
            </div>`
          : ''}
        <div class="action-group">
          ${_EXPERIMENTAL_ENABLED
            ? html`<button
                class="action-button reasoning-toggle ${panel
                  ._reasoningEnabled
                  ? 'active'
                  : ''}"
                @click=${() => toggleReasoning(panel)}
                aria-label=${panel._reasoningEnabled
                  ? 'Disable reasoning mode'
                  : 'Enable reasoning mode'}
                aria-pressed=${panel._reasoningEnabled}
                title=${panel._reasoningEnabled
                  ? 'Reasoning enabled — extra thinking tokens. Click to disable.'
                  : 'Reasoning disabled. Click to enable extended thinking for harder problems. (Experimental)'}
              >
                🧠
              </button>`
            : ''}
        </div>
        <div class="action-divider" aria-hidden="true"></div>
        ${renderSearchBar(panel)}
        ${panel._searchMode === 'file'
          ? ''
          : html`
              <div class="action-divider" aria-hidden="true"></div>
              <div class="action-group">
                <button
                  class="action-button new-session-button"
                  ?disabled=${!panel.rpcConnected || panel._streaming}
                  @click=${() => onNewSession(panel)}
                  aria-label="Start a new session"
                  title="New session (clears the conversation)"
                >
                  ✨
                </button>
                <button
                  class="action-button history-button"
                  ?disabled=${!panel.rpcConnected}
                  @click=${() => onOpenHistory(panel)}
                  aria-label="Open history browser"
                  title="Browse past sessions"
                >
                  📜
                </button>
              </div>
            `}
      </div>
      ${panel._snippetDrawerOpen
        ? renderSnippetDrawer(panel)
        : ''}
      <ac-input-history
        @history-select=${(e) => onHistorySelect(panel, e)}
        @history-cancel=${(e) => onHistoryCancel(panel, e)}
      ></ac-input-history>
      ${panel._pendingImages.length > 0
        ? renderPendingImages(panel)
        : ''}
      <ac-url-chips
        @url-fetch-requested=${(e) => onUrlFetchRequested(panel, e)}
        @url-remove-requested=${(e) => onUrlRemoveRequested(panel, e)}
        @url-view-requested=${(e) => onUrlViewRequested(panel, e)}
      ></ac-url-chips>
      <div class="input-row">
        <textarea
          class="input-textarea"
          placeholder=${(() => {
            const activeTab = panel._tabs.get(panel._activeTabId);
            if (activeTab?.readOnly) {
              return 'Historical archive — replies disabled';
            }
            return 'Send a message… (Enter to send, Shift+Enter for newline)';
          })()}
          .value=${panel._input}
          ?disabled=${!panel.rpcConnected ||
            panel._tabs.get(panel._activeTabId)?.readOnly}
          @input=${(e) => onInputChange(panel, e)}
          @keydown=${(e) => onInputKeyDown(panel, e)}
          @paste=${(e) => onInputPaste(panel, e)}
          aria-label="Message input"
        ></textarea>
        <div class="send-column">
          <div class="send-column-top">
            <button
              class="action-button snippet-drawer-button ${panel
                ._snippetDrawerOpen
                ? 'active'
                : ''}"
              @click=${() => toggleSnippetDrawer(panel)}
              aria-label=${panel._snippetDrawerOpen
                ? 'Close snippet drawer'
                : 'Open snippet drawer'}
              aria-expanded=${panel._snippetDrawerOpen}
              title="Quick-insert snippets"
            >
              ✂️
            </button>
            <ac-speech-to-text
              @transcript=${(e) => panel._onTranscript(e)}
              @recognition-error=${(e) => panel._onRecognitionError(e)}
            ></ac-speech-to-text>
          </div>
          ${panel._streaming
            ? html`<button
                class="send-button stop"
                @click=${() => cancel(panel)}
                aria-label="Stop streaming"
              >
                ⏹ Stop
              </button>`
            : html`<button
                class="send-button"
                ?disabled=${!panel.rpcConnected ||
                panel._tabs.get(panel._activeTabId)?.readOnly ||
                (!panel._input.trim() &&
                  panel._pendingImages.length === 0)}
                @click=${() => send(panel)}
                aria-label="Send message"
              >
                Send
              </button>`}
        </div>
      </div>
    </div>
    <ac-history-browser
      ?open=${panel._historyOpen}
      @close=${() => panel._onHistoryClose()}
      @session-loaded=${() => panel._onHistorySessionLoaded()}
    ></ac-history-browser>
    ${panel._lightboxImage ? renderLightbox(panel) : ''}
    ${panel._urlViewDialog ? renderUrlViewDialog(panel) : ''}
  `;
}

// ---------------------------------------------------------------
// URL view dialog
// ---------------------------------------------------------------

/**
 * Render the URL content viewer overlay. Shows
 * the URLContent payload's most useful fields —
 * title, body (summary preferred over readme over
 * content), and (for GitHub repos) a symbol map.
 *
 * Layout when a symbol map is present: tabbed,
 * with "Content" and "Symbol Map" tabs. Each tab
 * panel fills the dialog's available body height
 * and scrolls independently. Generic URLs (no
 * symbol map) skip the tab bar entirely.
 */
export function renderUrlViewDialog(panel) {
  const { url, content } = panel._urlViewDialog;
  const title = content.title || url;
  const body =
    content.summary || content.readme || content.content || '';
  const hasSymbolMap = !!content.symbol_map;
  const activeTab = panel._urlViewTab || 'content';
  return html`
    <div
      class="lightbox-backdrop"
      tabindex="0"
      @click=${(e) => {
        if (e.target === e.currentTarget) {
          closeUrlViewDialog(panel);
        }
      }}
      @keydown=${(e) => onUrlViewKeyDown(panel, e)}
      aria-modal="true"
      role="dialog"
      aria-label="URL content viewer"
    >
      <div
        class="lightbox-content url-view-dialog"
        style="
          background: rgba(22, 27, 34, 0.98);
          border: 1px solid rgba(240, 246, 252, 0.15);
          border-radius: 8px;
          padding: 1.5rem;
          max-width: 60rem;
          width: 90vw;
          height: 80vh;
          max-height: 80vh;
          display: flex;
          flex-direction: column;
          color: var(--text-primary, #c9d1d9);
          text-align: left;
          overflow: hidden;
        "
      >
        <div style="
          display: flex;
          align-items: flex-start;
          gap: 1rem;
          margin-bottom: 1rem;
          flex-shrink: 0;
        ">
          <div style="flex: 1; min-width: 0;">
            <h3 style="
              margin: 0 0 0.25rem 0;
              font-size: 1.125rem;
              overflow: hidden;
              text-overflow: ellipsis;
            ">${title}</h3>
            <a
              href=${url}
              target="_blank"
              rel="noopener noreferrer"
              style="
                font-size: 0.8125rem;
                color: var(--accent-primary, #58a6ff);
                word-break: break-all;
              "
            >${url} ↗</a>
          </div>
          <button
            class="lightbox-button"
            @click=${() => closeUrlViewDialog(panel)}
            title="Close (Escape)"
          >✕ Close</button>
        </div>
        ${hasSymbolMap
          ? html`<div
              role="tablist"
              aria-label="URL content sections"
              style="
                display: flex;
                gap: 0.25rem;
                border-bottom: 1px solid rgba(240, 246, 252, 0.15);
                margin-bottom: 1rem;
                flex-shrink: 0;
              "
            >
              <button
                role="tab"
                aria-selected=${activeTab === 'content'}
                @click=${() => { panel._urlViewTab = 'content'; }}
                style=${urlTabStyle(activeTab === 'content')}
              >Content</button>
              <button
                role="tab"
                aria-selected=${activeTab === 'symbols'}
                @click=${() => { panel._urlViewTab = 'symbols'; }}
                style=${urlTabStyle(activeTab === 'symbols')}
              >Symbol Map</button>
            </div>`
          : ''}
        ${hasSymbolMap && activeTab === 'symbols'
          ? renderUrlViewSymbolsTab(content.symbol_map)
          : renderUrlViewContentTab(content, body)}
      </div>
    </div>
  `;
}

/**
 * Styling for a URL-view tab button. Inline
 * styles rather than a class because the dialog
 * body itself is inlined; keeping everything
 * inline keeps the component's CSS surface
 * small.
 */
function urlTabStyle(active) {
  const baseColor = active
    ? 'var(--accent-primary, #58a6ff)'
    : 'var(--text-secondary, #8b949e)';
  const border = active
    ? '2px solid var(--accent-primary, #58a6ff)'
    : '2px solid transparent';
  return `
    background: transparent;
    border: none;
    border-bottom: ${border};
    color: ${baseColor};
    padding: 0.5rem 1rem;
    font: inherit;
    font-weight: ${active ? '600' : '400'};
    cursor: pointer;
    margin-bottom: -1px;
  `;
}

function renderUrlViewContentTab(content, body) {
  return html`
    <div style="
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    ">
      ${content.summary_type
        ? html`<div style="
            font-size: 0.75rem;
            color: var(--text-secondary, #8b949e);
            margin-bottom: 0.5rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            flex-shrink: 0;
          ">Summary (${content.summary_type})</div>`
        : ''}
      <pre style="
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
        max-width: 100%;
        box-sizing: border-box;
        font-family: inherit;
        font-size: 0.875rem;
        line-height: 1.5;
        margin: 0;
        padding: 0;
        background: transparent;
        border: none;
      ">${body || '(no content)'}</pre>
    </div>
  `;
}

function renderUrlViewSymbolsTab(symbolMap) {
  return html`
    <div style="
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    ">
      <pre style="
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
        max-width: 100%;
        box-sizing: border-box;
        font-family: 'SFMono-Regular', Consolas, monospace;
        font-size: 0.8125rem;
        line-height: 1.4;
        background: rgba(13, 17, 23, 0.6);
        border: 1px solid rgba(240, 246, 252, 0.1);
        border-radius: 4px;
        padding: 0.75rem;
        margin: 0;
      ">${symbolMap}</pre>
    </div>
  `;
}

// ---------------------------------------------------------------
// Pending images + lightbox
// ---------------------------------------------------------------

export function renderPendingImages(panel) {
  return html`
    <div class="pending-images" role="list"
      aria-label="Attached images">
      ${panel._pendingImages.map(
        (dataUri, i) => html`
          <div class="pending-image-wrapper" role="listitem">
            <img
              class="pending-image"
              src=${dataUri}
              alt=""
              @click=${() => openLightbox(panel, dataUri)}
              title="Click to view, × to remove"
            />
            <button
              class="pending-image-remove"
              @click=${() => removePendingImage(panel, i)}
              aria-label="Remove image"
              title="Remove image"
            >
              ×
            </button>
          </div>
        `,
      )}
    </div>
  `;
}

export function renderLightbox(panel) {
  // Inline overlay rather than a separate
  // component — simple enough that the extra
  // file would be overkill. Focus the backdrop so
  // Escape works without the user having to click
  // first.
  return html`
    <div
      class="lightbox-backdrop"
      tabindex="0"
      @click=${(e) => {
        // Close on backdrop click but not on
        // clicks inside the content. Check target
        // === currentTarget so the content's own
        // click doesn't bubble up and dismiss.
        if (e.target === e.currentTarget) closeLightbox(panel);
      }}
      @keydown=${(e) => onLightboxKeyDown(panel, e)}
      aria-modal="true"
      role="dialog"
    >
      <div class="lightbox-content">
        <img
          class="lightbox-image"
          src=${panel._lightboxImage}
          alt=""
        />
        <div class="lightbox-actions">
          <button
            class="lightbox-button"
            @click=${() => {
              reattachImage(panel, panel._lightboxImage);
              closeLightbox(panel);
            }}
            title="Re-attach this image to your message"
          >
            📎 Re-attach
          </button>
          <button
            class="lightbox-button"
            @click=${() => closeLightbox(panel)}
            title="Close (Escape)"
          >
            ✕ Close
          </button>
        </div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------
// Message rendering
// ---------------------------------------------------------------

/**
 * Render a single message card. Dispatches by
 * role — user / assistant / system-event — and
 * pulls in the right body renderer for each.
 *
 * Search highlight applies via a class on the
 * outer card; the renderer that drives the
 * highlight is computeSearchMatches in search.js,
 * which walks the messages array each render
 * pass.
 */
export function renderMessage(panel, msg, index) {
  const roleClass = msg.system_event
    ? 'role-system'
    : `role-${msg.role}`;
  const roleLabel = msg.system_event
    ? 'System'
    : msg.role === 'user'
      ? 'You'
      : 'Assistant';
  // Compute whether this message is the current
  // search match. Matches are resolved by index
  // lookup to avoid per-card regex re-evaluation
  // on every render.
  const matches = computeSearchMatches(panel);
  const currentMatchIdx =
    matches.length > 0
      ? matches[Math.max(0, panel._searchCurrentIndex) % matches.length]
      : -1;
  const isHighlighted =
    panel._searchQuery.trim() !== '' &&
    index === currentMatchIdx;
  // User content and system-event content both
  // go through the markdown renderer so lists,
  // paragraphs, code fences, etc. render as
  // intended. The markdown renderer handles
  // escaping internally, so this path is safe
  // against HTML injection. Assistant content
  // goes through the edit-block segmenter so
  // edit blocks become visual cards instead of
  // raw prose.
  let bodyHtml;
  if (msg.role === 'user' && !msg.system_event) {
    bodyHtml = html`
      <div class="md-content">
        ${unsafeHTML(renderMarkdown(msg.content))}
      </div>
    `;
  } else if (msg.role === 'assistant') {
    bodyHtml = renderAssistantBody(
      panel,
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
  const images = Array.isArray(msg.images) ? msg.images : [];
  const toolbar = renderMessageToolbar(panel, msg);
  const highlightClass = isHighlighted ? ' search-highlight' : '';
  // Split finish-reason placement by severity. Natural
  // completions (stop / end_turn) are positive
  // confirmation that the stream ended cleanly — they
  // belong at the end of the response, where the eye
  // lands when finished reading. Error/warning badges
  // (truncation, content_filter, tool_calls) stay next
  // to the role label at the top so users notice them
  // before reading.
  const isNaturalFinish =
    msg.role === 'assistant' &&
    !msg.system_event &&
    (msg.finishReason === 'stop' || msg.finishReason === 'end_turn');
  const topFinishBadge =
    msg.finishReason && !isNaturalFinish
      ? renderFinishBadge(msg.finishReason)
      : '';
  const bottomFinishBadge = isNaturalFinish
    ? renderFinishBadge(msg.finishReason)
    : '';
  // File summary section — settled assistant
  // messages only. The streaming card uses
  // renderStreamingMessage which doesn't call
  // this path.
  const fileSummary =
    msg.role === 'assistant' && !msg.system_event
      ? renderFileSummary(panel, collectMessageFiles(panel, msg))
      : '';
  // Edit summary banner — settled assistant
  // messages with edit results. Rendered BEFORE
  // the file summary so the order in the card is:
  // body, edits, files.
  const editSummary =
    msg.role === 'assistant' && !msg.system_event
      ? renderEditSummary(panel, msg)
      : '';
  // View-agents affordance for historical
  // agentic turns. Per Increment D and
  // specs4/5-webapp/agent-browser.md § Historical
  // Turns — only renders when the message is from
  // a previous turn (agent ids no longer in the
  // live tab strip). The active turn's agents
  // are already reachable via the tab strip
  // itself, so a duplicate affordance would be
  // noise.
  const viewAgents =
    msg.role === 'assistant' && !msg.system_event
      ? renderViewAgentsAffordance(panel, msg)
      : '';
  const finishFooterClass = bottomFinishBadge
    ? ' has-finish-footer'
    : '';
  return html`
    <div
      class="message-card ${roleClass}${highlightClass}${finishFooterClass}"
      data-msg-index=${index}
    >
      <div class="message-toolbar top">${toolbar}</div>
      <div class="role-label">${roleLabel}${topFinishBadge}</div>
      ${bodyHtml}
      ${images.length > 0
        ? renderMessageImages(panel, images)
        : ''}
      ${editSummary}
      ${fileSummary}
      ${viewAgents}
      ${bottomFinishBadge
        ? html`<div class="finish-reason-footer">${bottomFinishBadge}</div>`
        : ''}
      <div class="message-toolbar bottom">${toolbar}</div>
    </div>
  `;
}

/**
 * Render the finish-reason badge for a message.
 *
 * Severity rules (matches
 * specs-reference/5-webapp/chat.md §
 * Finish-reason badge labels):
 *
 *   - `stop` / `end_turn` → muted green ✓ badge
 *   - `length` / `content_filter` → red badge
 *   - `tool_calls` / `function_call` → amber
 *   - anything else → amber, with the raw reason
 *     surfaced verbatim so unexpected provider
 *     values stay diagnosable
 */
export function renderFinishBadge(reason) {
  let icon = '⚠️';
  let label = reason;
  let severity = '';
  switch (reason) {
    case 'stop':
      icon = '✓';
      label = 'stopped';
      severity = 'severity-natural';
      break;
    case 'end_turn':
      icon = '✓';
      label = 'end of turn';
      severity = 'severity-natural';
      break;
    case 'length':
      icon = '✂️';
      label = 'truncated (max_tokens)';
      severity = 'severity-error';
      break;
    case 'content_filter':
      icon = '🚫';
      label = 'content filter';
      severity = 'severity-error';
      break;
    case 'tool_calls':
      icon = '🔧';
      label = 'tool call requested';
      break;
    case 'function_call':
      icon = '🔧';
      label = 'function call requested';
      break;
    default:
      icon = '⚠️';
      label = reason;
      break;
  }
  const classes = severity
    ? `finish-reason-badge ${severity}`
    : 'finish-reason-badge';
  return html`<span
    class=${classes}
    title="LLM finish reason: ${reason}"
  >${icon} ${label}</span>`;
}

/**
 * Render the action toolbar for a message — copy
 * raw text and paste raw text into the chat
 * input. Used at both top-right and bottom-right
 * of each message card.
 *
 * Returns the same fragment for both placements
 * — Lit deduplicates the underlying event
 * bindings.
 */
export function renderMessageToolbar(panel, msg) {
  return html`
    <button
      class="message-action-button"
      title="Copy raw text"
      aria-label="Copy message text to clipboard"
      @click=${(e) => {
        // Prevent click-through to the card /
        // mention handler.
        e.stopPropagation();
        copyMessageText(panel, msg);
      }}
    >
      📋
    </button>
    <button
      class="message-action-button"
      title="Paste into input"
      aria-label="Insert message text into chat input"
      @click=${(e) => {
        e.stopPropagation();
        pasteMessageToPrompt(panel, msg);
      }}
    >
      ↩
    </button>
  `;
}

/**
 * Render the edit summary banner for an
 * assistant message. Appears at the end of the
 * message (after all edit cards) when the
 * response contained at least one edit.
 *
 * Per specs-reference/5-webapp/chat.md §Edit
 * Summary:
 *
 *   - Aggregate counts as color-coded stat badges
 *   - Individual failure listing when failures
 *     are present
 *   - Note about a populated retry prompt when
 *     applicable
 *
 * Returns empty when there are no edit results,
 * or when results array is all zero counts.
 */
export function renderEditSummary(panel, msg) {
  if (!msg || msg.role !== 'assistant') return '';
  const results = Array.isArray(msg.editResults)
    ? msg.editResults
    : [];
  if (results.length === 0) return '';

  // Aggregate by status. Count `applied` and
  // `already_applied` separately so the badge
  // text matches what the user actually got
  // (idempotent re-applies shouldn't look like
  // fresh writes).
  let applied = 0;
  let alreadyApplied = 0;
  let failed = 0;
  let skipped = 0;
  let notInContext = 0;
  const failures = [];
  for (const r of results) {
    if (!r) continue;
    const status = r.status;
    if (status === 'applied') applied += 1;
    else if (status === 'already_applied') alreadyApplied += 1;
    else if (status === 'failed') {
      failed += 1;
      failures.push(r);
    } else if (status === 'skipped') {
      skipped += 1;
      failures.push(r);
    } else if (status === 'not_in_context') {
      notInContext += 1;
      failures.push(r);
    }
  }

  // Detect whether a retry prompt was populated.
  // We don't track this as state; re-derive from
  // the same conditions the builder uses.
  const selected = new Set(
    Array.isArray(panel.selectedFiles) ? panel.selectedFiles : [],
  );
  const hasAmbiguous = results.some(
    (r) => r && r.error_type === 'ambiguous_anchor',
  );
  const hasInContextMismatch = results.some((r) => {
    if (!r || r.error_type !== 'anchor_not_found') return false;
    const path = r.file_path || r.file;
    return typeof path === 'string' && selected.has(path);
  });
  const hasNotInContext = notInContext > 0;
  const retryPromptPopulated =
    hasAmbiguous || hasInContextMismatch || hasNotInContext;

  const stats = [];
  if (applied > 0) {
    stats.push(html`
      <span class="edit-summary-stat applied">
        ✅ ${applied} applied
      </span>
    `);
  }
  if (alreadyApplied > 0) {
    stats.push(html`
      <span class="edit-summary-stat applied">
        ✅ ${alreadyApplied} already applied
      </span>
    `);
  }
  if (failed > 0) {
    stats.push(html`
      <span class="edit-summary-stat failed">
        ❌ ${failed} failed
      </span>
    `);
  }
  if (skipped > 0) {
    stats.push(html`
      <span class="edit-summary-stat skipped">
        ⚠️ ${skipped} skipped
      </span>
    `);
  }
  if (notInContext > 0) {
    stats.push(html`
      <span class="edit-summary-stat not-in-context">
        ⚠️ ${notInContext} not in context
      </span>
    `);
  }
  if (stats.length === 0) return '';

  return html`
    <div class="edit-summary" role="status">
      <div class="edit-summary-header">
        <span class="edit-summary-title">Edits:</span>
        ${stats}
      </div>
      ${failures.length > 0
        ? html`
            <div class="edit-summary-failures">
              ${failures.map((r) => {
                const path = r.file_path || r.file || '(unknown)';
                const errorType =
                  typeof r.error_type === 'string' ? r.error_type : '';
                const message =
                  typeof r.message === 'string' ? r.message : '';
                return html`
                  <div class="edit-summary-failure">
                    <span
                      class="edit-summary-failure-path"
                      @click=${() => {
                        window.dispatchEvent(
                          new CustomEvent('navigate-file', {
                            detail: { path },
                            bubbles: false,
                          }),
                        );
                      }}
                      title="Open ${path}"
                    >${path}</span>
                    ${errorType
                      ? html`<span
                          class="edit-summary-failure-type"
                        >${errorType}</span>`
                      : ''}
                    ${message
                      ? html`<span
                          class="edit-summary-failure-message"
                        >${message}</span>`
                      : ''}
                  </div>
                `;
              })}
            </div>
          `
        : ''}
      ${retryPromptPopulated
        ? html`
            <div class="edit-summary-retry-note">
              A retry prompt has been prepared in the input
              below.
            </div>
          `
        : ''}
    </div>
  `;
}

export function renderMessageImages(panel, images) {
  return html`
    <div class="message-images" role="list">
      ${images.map(
        (dataUri) => html`
          <div class="message-image-wrapper" role="listitem">
            <img
              class="message-image"
              src=${dataUri}
              alt=""
              @click=${() => openLightbox(panel, dataUri)}
              title="Click to view"
            />
            <button
              class="message-image-reattach"
              @click=${(e) => {
                // Don't also open the lightbox
                // from the click-through on the
                // image itself.
                e.stopPropagation();
                reattachImage(panel, dataUri);
              }}
              aria-label="Re-attach image to your message"
              title="Re-attach to composition"
            >
              📎
            </button>
          </div>
        `,
      )}
    </div>
  `;
}

/**
 * Render assistant message body as a mix of
 * prose segments (through markdown) and edit-
 * block segments (through the renderer). The
 * parser handles code-fence stripping around
 * edit blocks; prose segments are passed to
 * marked as-is.
 *
 * `editResults` from the backend's stream-
 * complete payload pairs each edit segment with
 * its applied/failed/skipped/not_in_context
 * result via matchSegmentsToResults.
 *
 * File mention detection runs on prose segments
 * ONLY when `isStreaming` is false. Mid-stream
 * content grows chunk by chunk; running mention
 * detection on partial prose could wrap a path
 * just as the LLM is about to extend it into a
 * different word (`src/foo.py` becomes
 * `src/foo.pyc` mid-stream).
 */
export function renderAssistantBody(panel, content, editResults, isStreaming) {
  const segments = segmentResponse(content || '');
  if (segments.length === 0) {
    return html`<div class="md-content"></div>`;
  }
  const matched = matchSegmentsToResults(
    segments,
    Array.isArray(editResults) ? editResults : [],
  );
  const wrapMentions =
    !isStreaming &&
    Array.isArray(panel.repoFiles) &&
    panel.repoFiles.length > 0;
  const parts = segments.map((seg, i) => {
    if (seg.type === 'text') {
      let html_ = renderMarkdown(seg.content);
      if (wrapMentions) {
        html_ = findFileMentions(html_, panel.repoFiles);
      }
      return html`
        <div class="md-content">${unsafeHTML(html_)}</div>
      `;
    }
    // edit and edit-pending both go through
    // renderEditCard. Pending segments resolve
    // to the 'pending' status badge; completed
    // segments use their matched result.
    const cardHtml = renderEditCard(seg, matched[i] || null);
    return html`${unsafeHTML(cardHtml)}`;
  });
  return html`<div class="assistant-body">${parts}</div>`;
}

/**
 * Render the streaming card. Uses the assistant-
 * role styling with an accent border to
 * distinguish it from settled messages. Content
 * goes through the same segmenter as final
 * messages so pending edit blocks show up as
 * cards mid-stream. Blinking cursor sits after
 * the body so it's visible regardless of whether
 * the last segment is prose or an edit block in
 * progress.
 *
 * editResults is undefined — the backend hasn't
 * sent stream-complete yet, so every edit
 * segment renders in its pending/in-flight
 * state.
 */
export function renderStreamingMessage(panel) {
  return html`
    <div class="message-card role-assistant streaming">
      <div class="role-label">Assistant</div>
      ${renderAssistantBody(
        panel,
        panel._streamingContent,
        undefined,
        true,
      )}
      <span class="cursor"></span>
    </div>
  `;
}

// ---------------------------------------------------------------
// Search bar
// ---------------------------------------------------------------

/**
 * Render the search bar — input box with mode
 * toggle, three search-option toggles
 * (ignoreCase, regex, wholeWord), match counter,
 * navigation arrows, and (in main tab only) the
 * mode + cross-ref toggle group at the right.
 *
 * Counter and nav handlers are mode-dependent:
 * file mode shows "N in F files" + uses the
 * file-search nav handlers; message mode shows
 * "current/total" + uses the message-search nav
 * handlers.
 */
export function renderSearchBar(panel) {
  const fileMode = panel._searchMode === 'file';
  const hasQuery = panel._searchQuery.trim().length > 0;
  let counterText = '';
  let noMatch = false;
  let navTotal = 0;
  if (fileMode) {
    const matchCount = totalFileSearchMatches(panel);
    const fileCount = panel._fileSearchResults.length;
    navTotal = matchCount;
    if (panel._fileSearchLoading) {
      counterText = 'Searching…';
    } else if (hasQuery) {
      counterText =
        matchCount === 0
          ? '0 results'
          : `${matchCount} in ${fileCount}`;
      noMatch = matchCount === 0;
    }
  } else {
    const matches = computeSearchMatches(panel);
    const total = matches.length;
    navTotal = total;
    if (hasQuery) {
      const current =
        total === 0
          ? 0
          : Math.min(
              Math.max(0, panel._searchCurrentIndex) + 1,
              total,
            );
      counterText = `${current}/${total}`;
      noMatch = total === 0;
    }
  }
  const placeholder = fileMode
    ? 'Search files…'
    : 'Search messages…';
  const ariaLabel = fileMode
    ? 'Search repository files'
    : 'Search messages';
  const onPrev = fileMode
    ? () => onFileSearchPrev(panel)
    : () => onSearchPrev(panel);
  const onNext = fileMode
    ? () => onFileSearchNext(panel)
    : () => onSearchNext(panel);
  return html`
    <div class="search-bar" role="search">
      <button
        class="action-button search-mode-toggle ${fileMode
          ? 'active'
          : ''}"
        @click=${() => toggleSearchMode(panel)}
        aria-label=${fileMode
          ? 'Switch to message search'
          : 'Switch to file search'}
        title=${fileMode
          ? 'File search — click to switch to messages'
          : 'Message search — click to switch to files'}
      >
        ${fileMode ? '📁' : '💬'}
      </button>
      <div class="search-input-wrapper">
        <input
          type="text"
          class="search-input"
          placeholder=${placeholder}
          .value=${panel._searchQuery}
          @input=${(e) => onSearchInput(panel, e)}
          @keydown=${(e) => onSearchKeyDown(panel, e)}
          aria-label=${ariaLabel}
        />
        <button
          class="search-toggle ${panel._searchIgnoreCase
            ? 'active'
            : ''}"
          @click=${() => toggleSearchOption(panel, 'ignoreCase')}
          aria-pressed=${panel._searchIgnoreCase}
          title="Ignore case"
        >
          Aa
        </button>
        <button
          class="search-toggle ${panel._searchRegex
            ? 'active'
            : ''}"
          @click=${() => toggleSearchOption(panel, 'regex')}
          aria-pressed=${panel._searchRegex}
          title="Regex"
        >
          .*
        </button>
        <button
          class="search-toggle ${panel._searchWholeWord
            ? 'active'
            : ''}"
          @click=${() => toggleSearchOption(panel, 'wholeWord')}
          aria-pressed=${panel._searchWholeWord}
          title="Whole word"
        >
          ab
        </button>
      </div>
      <span
        class="search-counter ${noMatch ? 'no-match' : ''}"
        aria-live="polite"
      >
        ${counterText}
      </span>
      <div class="search-nav" aria-label="Match navigation">
        <button
          class="search-nav-button"
          ?disabled=${navTotal === 0}
          @click=${onPrev}
          aria-label="Previous match"
          title="Previous (Shift+Enter)"
        >
          ▲
        </button>
        <button
          class="search-nav-button"
          ?disabled=${navTotal === 0}
          @click=${onNext}
          aria-label="Next match"
          title="Next (Enter / ↓)"
        >
          ▼
        </button>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------
// Snippet drawer
// ---------------------------------------------------------------

export function renderSnippetDrawer(panel) {
  // Empty list (pre-load, post-error, or
  // genuinely no snippets configured) shows a
  // placeholder rather than an empty box. Opening
  // the drawer is a deliberate action so showing
  // nothing would be confusing.
  if (panel._snippets.length === 0) {
    return html`
      <div class="snippet-drawer" role="region"
        aria-label="Snippet drawer">
        <div class="snippet-empty">No snippets available</div>
      </div>
    `;
  }
  return html`
    <div
      class="snippet-drawer"
      role="region"
      aria-label="Snippet drawer"
    >
      ${panel._snippets.map(
        (snippet) => html`
          <button
            class="snippet-button"
            title=${snippet.tooltip || snippet.message || ''}
            aria-label=${snippet.tooltip ||
            `Insert snippet: ${snippet.message || ''}`}
            @click=${() => insertSnippet(panel, snippet)}
          >
            <span class="snippet-icon">${snippet.icon || '✂'}</span>
            ${snippet.tooltip
              ? html`<span class="snippet-label"
                  >${snippet.tooltip}</span
                >`
              : ''}
          </button>
        `,
      )}
    </div>
  `;
}

// ---------------------------------------------------------------
// File search overlay
// ---------------------------------------------------------------

export function renderFileSearchOverlay(panel) {
  if (!panel._searchQuery.trim()) {
    return html`
      <div class="file-search-overlay">
        <div class="file-search-empty">
          Type to search across files
        </div>
      </div>
    `;
  }
  if (panel._fileSearchLoading && panel._fileSearchResults.length === 0) {
    return html`
      <div class="file-search-overlay">
        <div class="file-search-empty">Searching…</div>
      </div>
    `;
  }
  if (panel._fileSearchResults.length === 0) {
    return html`
      <div class="file-search-overlay">
        <div class="file-search-empty">No results found</div>
      </div>
    `;
  }
  // Walk results, maintaining a running flat-
  // index so each match row carries its position
  // in the overall navigation sequence. The
  // focused row gets `.focused` class and a
  // `data-file-match-flat` attribute so scroll-
  // sync can target it.
  let flatIndex = 0;
  const sections = [];
  for (let fi = 0; fi < panel._fileSearchResults.length; fi += 1) {
    const entry = panel._fileSearchResults[fi];
    const matches = Array.isArray(entry?.matches) ? entry.matches : [];
    const matchRows = matches.map((match) => {
      const thisFlat = flatIndex++;
      return renderFileSearchMatch(
        panel,
        entry.file,
        match,
        thisFlat,
      );
    });
    sections.push(html`
      <div
        class="file-search-section"
        data-file-section=${entry.file}
      >
        <div
          class="file-section-header"
          @click=${() => onFileSearchHeaderClick(entry.file)}
          title="Open ${entry.file}"
        >
          <span class="file-section-path">${entry.file}</span>
          <span class="file-section-count">
            ${matches.length}
          </span>
        </div>
        ${matchRows}
      </div>
    `);
  }
  return html`
    <div
      class="file-search-overlay"
      @scroll=${(e) => onFileSearchOverlayScroll(panel, e)}
    >
      ${sections}
    </div>
  `;
}

/**
 * Render a single match row — context lines
 * before, the match line itself, context lines
 * after. Context rows are not clickable and not
 * focusable; only the match line navigates.
 */
function renderFileSearchMatch(panel, filePath, match, flatIndex) {
  if (!match) return '';
  const isFocused = flatIndex === panel._fileSearchFocusedIndex;
  const before = Array.isArray(match.context_before)
    ? match.context_before
    : [];
  const after = Array.isArray(match.context_after)
    ? match.context_after
    : [];
  return html`
    ${before.map(
      (ctx) => html`
        <div class="file-match-row context">
          <span class="file-match-linenum">
            ${ctx.line_num ?? ''}
          </span>
          <span class="file-match-text">${ctx.line ?? ''}</span>
        </div>
      `,
    )}
    <div
      class="file-match-row ${isFocused ? 'focused' : ''}"
      data-file-match-flat=${flatIndex}
      @click=${() => onFileSearchMatchClick(filePath, match)}
    >
      <span class="file-match-linenum">
        ${match.line_num ?? ''}
      </span>
      <span class="file-match-text">
        ${renderHighlightedMatchLine(panel, match.line ?? '')}
      </span>
    </div>
    ${after.map(
      (ctx) => html`
        <div class="file-match-row context">
          <span class="file-match-linenum">
            ${ctx.line_num ?? ''}
          </span>
          <span class="file-match-text">${ctx.line ?? ''}</span>
        </div>
      `,
    )}
  `;
}

/**
 * Highlight occurrences of the search query
 * within a match line. Regex / whole-word /
 * ignore-case toggles are respected. Falls back
 * to the plain line when the pattern can't be
 * built (invalid regex).
 */
function renderHighlightedMatchLine(panel, line) {
  if (!line) return '';
  const query = panel._searchQuery;
  if (!query.trim()) return line;
  let pattern;
  try {
    let source = panel._searchRegex
      ? query
      : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (panel._searchWholeWord) {
      source = `\\b(?:${source})\\b`;
    }
    const flags = panel._searchIgnoreCase ? 'gi' : 'g';
    pattern = new RegExp(source, flags);
  } catch (_) {
    return line;
  }
  const parts = [];
  let cursor = 0;
  let m;
  pattern.lastIndex = 0;
  while ((m = pattern.exec(line)) !== null) {
    if (m.index > cursor) {
      parts.push(line.slice(cursor, m.index));
    }
    parts.push(
      html`<span class="file-match-highlight"
        >${m[0]}</span
      >`,
    );
    cursor = m.index + m[0].length;
    // Guard against zero-width matches —
    // infinite loop prevention.
    if (m[0].length === 0) {
      pattern.lastIndex += 1;
    }
  }
  if (cursor < line.length) {
    parts.push(line.slice(cursor));
  }
  return parts;
}

function onFileSearchMatchClick(filePath, match) {
  window.dispatchEvent(
    new CustomEvent('navigate-file', {
      detail: { path: filePath, line: match?.line_num },
      bubbles: false,
    }),
  );
}

function onFileSearchHeaderClick(filePath) {
  window.dispatchEvent(
    new CustomEvent('navigate-file', {
      detail: { path: filePath },
      bubbles: false,
    }),
  );
}

// ---------------------------------------------------------------
// File summary section
// ---------------------------------------------------------------

/**
 * Collect every file path referenced by an
 * assistant message — both edit-block headers
 * and inline prose mentions. Returns
 * `[{path, inContext}]` deduplicated in
 * first-seen order, with `inContext` reflecting
 * whether the path is currently in
 * `selectedFiles`.
 *
 * Edit blocks always contribute their
 * `filePath` — the LLM unambiguously named the
 * file as an edit target, so it belongs in the
 * summary regardless of whether the file exists
 * in `repoFiles`.
 *
 * Prose mentions are harvested only when
 * `repoFiles` is non-empty, using the same
 * longest-first substring matching as
 * `findFileMentions`.
 */
export function collectMessageFiles(panel, msg) {
  if (!msg || msg.role !== 'assistant') return [];
  const content =
    typeof msg.content === 'string' ? msg.content : '';
  const selected = new Set(
    Array.isArray(panel.selectedFiles) ? panel.selectedFiles : [],
  );
  const seen = new Set();
  const out = [];

  // Edit block file paths.
  if (content) {
    const segments = segmentResponse(content);
    for (const seg of segments) {
      if (
        (seg.type === 'edit' || seg.type === 'edit-pending') &&
        typeof seg.filePath === 'string' &&
        seg.filePath &&
        !seen.has(seg.filePath)
      ) {
        seen.add(seg.filePath);
        out.push({
          path: seg.filePath,
          inContext: selected.has(seg.filePath),
        });
      }
    }
  }

  // Inline prose mentions.
  if (
    content &&
    Array.isArray(panel.repoFiles) &&
    panel.repoFiles.length > 0
  ) {
    const candidates = panel.repoFiles.filter(
      (p) => typeof p === 'string' && p && content.includes(p),
    );
    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        if (b.length !== a.length) return b.length - a.length;
        return a.localeCompare(b);
      });
      for (const path of candidates) {
        if (seen.has(path)) continue;
        if (proseContainsPath(content, path)) {
          seen.add(path);
          out.push({
            path,
            inContext: selected.has(path),
          });
        }
      }
    }
  }

  return out;
}

/**
 * Check whether `path` appears in `content` as a
 * real mention — same boundary rules as the HTML
 * mention matcher. Skips anything inside ```
 * fences. Inline code (single backticks) isn't
 * excluded — per spec, matches inside inline
 * code are wrapped normally.
 */
function proseContainsPath(content, path) {
  let inFence = false;
  const lines = content.split('\n');
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (lineContainsPath(line, path)) return true;
  }
  return false;
}

/**
 * Boundary-aware substring check for a single
 * line. Path characters (letters, digits,
 * underscore, hyphen, slash) never terminate a
 * match; dot is a boundary only at the trailing
 * edge; everything else (whitespace,
 * punctuation) is a boundary on both sides.
 */
function lineContainsPath(line, path) {
  let from = 0;
  while (from <= line.length - path.length) {
    const idx = line.indexOf(path, from);
    if (idx === -1) return false;
    const endIdx = idx + path.length;
    const before = idx > 0 ? line[idx - 1] : '';
    const after = endIdx < line.length ? line[endIdx] : '';
    if (
      isMentionBoundary(before, 'before') &&
      isMentionBoundary(after, 'after')
    ) {
      return true;
    }
    from = idx + 1;
  }
  return false;
}

function isMentionBoundary(ch, position) {
  if (ch === '') return true;
  if (/[A-Za-z0-9_\-/]/.test(ch)) return false;
  if (ch === '.') return position === 'after';
  return true;
}

/**
 * Render the file summary section for an
 * assistant message. Emits nothing when the file
 * list is empty.
 *
 * Layout:
 *
 *   📁 Files Referenced       [+ Add All (N)]
 *   [✓ path/to/in.py]  [+ path/to/out.py]
 *
 * Chips show ✓ for in-context (muted style) and
 * + for not-in-context (accent style). Clicking
 * a chip dispatches `file-chip-click` with
 * `{path, navigate: false}`. The "Add All"
 * button is shown only when ≥2 files are not
 * currently in context.
 */
export function renderFileSummary(panel, files) {
  if (!Array.isArray(files) || files.length === 0) return '';
  const notInContext = files.filter((f) => !f.inContext);
  const showAddAll = notInContext.length >= 2;
  return html`
    <div class="file-summary-section" role="group"
      aria-label="Files referenced by this message">
      <div class="file-summary-header">
        <span class="file-summary-title">
          📁 Files Referenced
        </span>
        ${showAddAll
          ? html`<button
              class="file-summary-add-all"
              @click=${(e) => {
                e.stopPropagation();
                onAddAllFiles(panel, notInContext);
              }}
              title="Add all unselected files to context"
              aria-label="Add all ${notInContext.length} unselected files to context"
            >
              + Add All (${notInContext.length})
            </button>`
          : ''}
      </div>
      <div class="file-summary-chips">
        ${files.map(
          (file) => html`
            <button
              class="file-chip ${file.inContext
                ? 'in-context'
                : 'not-in-context'}"
              @click=${(e) => {
                e.stopPropagation();
                onFileChipClick(panel, file.path);
              }}
              title=${file.inContext
                ? `${file.path} — in context (click to remove)`
                : `${file.path} — click to add to context`}
              aria-label=${file.inContext
                ? `Remove ${file.path} from context`
                : `Add ${file.path} to context`}
            >
              <span class="file-chip-mark" aria-hidden="true">
                ${file.inContext ? '✓' : '+'}
              </span>
              <span class="file-chip-path">${file.path}</span>
            </button>
          `,
        )}
      </div>
    </div>
  `;
}

/**
 * Render the "View agents (N)" affordance for
 * historical agentic turns.
 *
 * Per spec specs4/5-webapp/agent-browser.md §
 * Historical Turns — once a new agentic turn
 * starts in the main tab, the previous turn's
 * agent tabs leave the strip but their archives
 * remain on disk. Scrolling back surfaces this
 * affordance below the assistant message that
 * spawned them; clicking it populates read-only
 * tabs from the archive (commit 3 wires the
 * handler).
 *
 * Visibility rules — returns empty when:
 *
 *   - Message lacks turn_id (pre-Increment-A
 *     records, non-agentic turns)
 *   - Message lacks agent_blocks (non-agentic
 *     turns)
 *   - agent_blocks is non-array or empty
 *     (defensive — backend filters these out
 *     before persistence per spec, but a stale
 *     in-memory record might slip through)
 *   - Every agent in agent_blocks is currently
 *     live in the tab strip (the active turn —
 *     duplicating the strip's own affordances
 *     would be noise)
 *
 * The "currently live" check uses
 * parseAgentTabId-style matching: each block's
 * id is checked against panel._tabs directly,
 * since tab IDs equal agent IDs under the
 * flat-identity contract.
 *
 * Click dispatches `view-agents-requested` with
 * `{turn_id, agent_blocks}` for commit 3 to
 * handle. The bubbling event lets a future
 * handler outside the chat panel intercept too,
 * but commit 3 will install the handler at the
 * panel level since that's where the tab strip
 * lives.
 */
export function renderViewAgentsAffordance(panel, msg) {
  if (!msg || msg.role !== 'assistant') return '';
  const turnId = msg.turn_id;
  if (typeof turnId !== 'string' || !turnId) return '';
  const agentBlocks = msg.agent_blocks;
  if (!Array.isArray(agentBlocks) || agentBlocks.length === 0) {
    return '';
  }
  // Skip when every spawned agent is still live —
  // the active-turn case. Reading the live tab
  // map directly because parseAgentTabId would
  // just return the same id; tab id IS agent id.
  const liveTabs = panel._tabs;
  let allLive = true;
  for (const block of agentBlocks) {
    const id = block?.id;
    if (typeof id !== 'string' || !id) {
      allLive = false;
      break;
    }
    if (!liveTabs.has(id)) {
      allLive = false;
      break;
    }
  }
  if (allLive) return '';
  const count = agentBlocks.length;
  const label = count === 1
    ? 'View agent (1)'
    : `View agents (${count})`;
  return html`
    <div class="view-agents-affordance">
      <button
        class="view-agents-button"
        @click=${(e) => {
          e.stopPropagation();
          panel.dispatchEvent(
            new CustomEvent('view-agents-requested', {
              detail: { turn_id: turnId, agent_blocks: agentBlocks },
              bubbles: true,
              composed: true,
            }),
          );
        }}
        aria-label=${label}
        title=${`Open archived tabs from this turn (turn ${turnId})`}
      >
        🤖 ${label}
      </button>
    </div>
  `;
}