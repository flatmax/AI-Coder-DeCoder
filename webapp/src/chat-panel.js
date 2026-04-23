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
import {
  MAX_IMAGES_PER_MESSAGE,
  MAX_IMAGE_BYTES,
  estimateDataUriBytes,
  extractImagesFromClipboard,
  normalizeMessageContent,
} from './image-utils.js';
import { findMessageMatches } from './message-search.js';
import './history-browser.js';
import './input-history.js';

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
 * Build a retry prompt for ambiguous-anchor edit failures.
 *
 * An ambiguous anchor means the LLM's old-text block matched
 * multiple locations in the target file. The fix is to add
 * more surrounding context so the match is unique. The prompt
 * names each affected file with its error message so the LLM
 * can see what it tried and why it failed.
 *
 * Returns null when there are no ambiguous failures in the
 * results — caller treats null as "no prompt needed" and
 * skips to the next case.
 *
 * @param {Array} editResults — from stream-complete result
 * @returns {string | null}
 */
function buildAmbiguousRetryPrompt(editResults) {
  const ambiguous = editResults.filter(
    (r) => r && r.error_type === 'ambiguous_anchor',
  );
  if (ambiguous.length === 0) return null;
  const lines = [
    'Some edits failed because the old text matched multiple',
    'locations in the file. Please retry with more surrounding',
    'context lines to make the match unique:',
    '',
  ];
  for (const r of ambiguous) {
    const file = r.file || '(unknown file)';
    const msg = r.message || 'Ambiguous match';
    lines.push(`- ${file}: ${msg}`);
  }
  return lines.join('\n');
}

/**
 * Build a retry prompt for anchor-not-found failures on files
 * that ARE currently in the active context.
 *
 * When a file is selected, its full content is in the LLM's
 * context. If the LLM's old-text block still fails to match,
 * the most likely cause is that the LLM didn't read the file
 * content carefully — maybe it was summarising from memory
 * rather than copying. The prompt explicitly reminds the LLM
 * the file is available and asks it to re-read before
 * retrying.
 *
 * Only fires for files in `selectedFiles` — failures on
 * not-in-context files are handled by the not-in-context
 * prompt path, which supersedes this one.
 *
 * Returns null when no in-context anchor-not-found failures
 * exist.
 *
 * @param {Array} editResults — from stream-complete result
 * @param {Array<string>} selectedFiles — active file selection
 * @returns {string | null}
 */
function buildInContextMismatchRetryPrompt(
  editResults,
  selectedFiles,
) {
  const selectedSet = new Set(selectedFiles);
  const mismatches = editResults.filter(
    (r) =>
      r &&
      r.error_type === 'anchor_not_found' &&
      selectedSet.has(r.file),
  );
  if (mismatches.length === 0) return null;
  const lines = [
    'The following edit(s) failed because the old text didn\'t',
    'match the actual file content. The file(s) are already in',
    'your context — please re-read them carefully and retry',
    'with the correct text:',
    '',
  ];
  for (const r of mismatches) {
    const file = r.file || '(unknown file)';
    const msg = r.message || 'Old text not found';
    lines.push(`- ${file}: ${msg}`);
  }
  return lines.join('\n');
}

/**
 * Build a retry prompt for not-in-context auto-adds.
 *
 * When the LLM proposes edits for files that aren't in the
 * current selection, the backend marks them NOT_IN_CONTEXT
 * (without attempting) and auto-adds them to the selection
 * so the next turn has their content. The prompt tells the
 * LLM the files are now available and asks it to retry.
 *
 * Single-file and multi-file wording differ slightly for
 * grammatical naturalness ("The file X has been added" vs
 * "The files X, Y have been added").
 *
 * Returns null when `filesAutoAdded` is empty.
 *
 * @param {Array<string>} filesAutoAdded — from stream-complete
 * @returns {string | null}
 */
function buildNotInContextRetryPrompt(filesAutoAdded) {
  if (!Array.isArray(filesAutoAdded) || filesAutoAdded.length === 0) {
    return null;
  }
  const files = filesAutoAdded.filter(
    (f) => typeof f === 'string' && f,
  );
  if (files.length === 0) return null;
  const isSingle = files.length === 1;
  const subject = isSingle
    ? `The file ${files[0]}`
    : `The files ${files.join(', ')}`;
  const verb = isSingle ? 'has' : 'have';
  const target = isSingle ? 'the edit' : 'the edits';
  return (
    `${subject} ${verb} been added to context. ` +
    `Please retry ${target} for: ${files.join(', ')}`
  );
}

/** localStorage key for the snippet drawer's open/closed state. */
const _DRAWER_STORAGE_KEY = 'ac-dc-snippet-drawer';

/**
 * Read the snippet drawer's persisted open state. Defaults to
 * closed. Catches any localStorage access errors (private
 * browsing, SecurityError on cross-origin iframes) so the chat
 * panel still works when persistence isn't available.
 */
function _loadDrawerOpen() {
  try {
    return localStorage.getItem(_DRAWER_STORAGE_KEY) === 'true';
  } catch (_) {
    return false;
  }
}

/** Write the snippet drawer's open state to localStorage. */
function _saveDrawerOpen(open) {
  try {
    localStorage.setItem(_DRAWER_STORAGE_KEY, open ? 'true' : 'false');
  } catch (_) {
    // Best-effort — failure is silent. The in-memory state
    // wins for the current session either way.
  }
}

/**
 * localStorage keys for each search toggle. Three separate
 * keys (rather than one JSON blob) match specs3's keying so
 * users migrating from a previous install see the same
 * persisted state. The values are string `'true'`/`'false'`
 * for consistency with the drawer key.
 */
const _SEARCH_IGNORE_CASE_KEY = 'ac-dc-search-ignore-case';
const _SEARCH_REGEX_KEY = 'ac-dc-search-regex';
const _SEARCH_WHOLE_WORD_KEY = 'ac-dc-search-whole-word';

/**
 * Load a boolean search toggle from localStorage with a
 * specific default. Shares the defensive try/catch pattern
 * used for the drawer state — private browsing mode or
 * cross-origin iframes can throw on access.
 */
function _loadSearchToggle(key, defaultValue) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return defaultValue;
  } catch (_) {
    return defaultValue;
  }
}

function _saveSearchToggle(key, value) {
  try {
    localStorage.setItem(key, value ? 'true' : 'false');
  } catch (_) {
    // Best-effort — in-memory state is authoritative for
    // the session.
  }
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
    /**
     * Whether the snippet drawer is expanded. Persisted to
     * localStorage under `ac-dc-snippet-drawer` — the drawer
     * state survives browser refreshes.
     */
    _snippetDrawerOpen: { type: Boolean, state: true },
    /**
     * Snippets loaded from LLMService.get_snippets. Each is
     * `{icon, tooltip, message}`. Empty until RPC ready or on
     * fetch error. Reloaded on mode / review state changes
     * since the server returns mode-aware snippets.
     */
    _snippets: { type: Array, state: true },
    /**
     * Images currently attached to the composition, as
     * data URIs. Accumulated from pastes and re-attaches;
     * cleared when the message is sent. Capped at
     * MAX_IMAGES_PER_MESSAGE; over-limit adds produce a
     * warning toast and are ignored.
     */
    _pendingImages: { type: Array, state: true },
    /**
     * When non-null, the lightbox is open showing this data
     * URI. Set by clicking a message thumbnail or a pending
     * preview; cleared by Escape or backdrop click.
     */
    _lightboxImage: { type: String, state: true },
    /** Current search query text. Empty = no active search. */
    _searchQuery: { type: String, state: true },
    /** Ignore-case search toggle. Persisted to localStorage. */
    _searchIgnoreCase: { type: Boolean, state: true },
    /** Regex search toggle. Persisted to localStorage. */
    _searchRegex: { type: Boolean, state: true },
    /** Whole-word search toggle. Persisted to localStorage. */
    _searchWholeWord: { type: Boolean, state: true },
    /**
     * Index into the matches array of the currently-highlighted
     * match. -1 when no matches or no active search. Wraps
     * on Enter/Shift+Enter navigation.
     */
    _searchCurrentIndex: { type: Number, state: true },
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
    /* Search highlight — current match gets an accent border
     * and subtle glow. Applied via the 'search-highlight'
     * class when a message's data-msg-index matches the
     * _searchCurrentIndex state. Transparent default border
     * on every card makes the transition smooth (no layout
     * shift when the highlight comes and goes). */
    .message-card {
      transition: border-color 120ms ease,
        box-shadow 120ms ease;
    }
    .message-card.search-highlight {
      border-color: var(--accent-primary, #58a6ff);
      box-shadow: 0 0 0 1px var(--accent-primary, #58a6ff),
        0 0 12px rgba(79, 195, 247, 0.15);
    }

    .role-label {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.6;
      margin-bottom: 0.375rem;
    }

    /* Message action toolbars — hover-only copy and paste
     * buttons, at top-right and bottom-right of each card.
     * Both ends because long messages might be partially
     * scrolled off either side of the viewport; having a
     * toolbar at each end saves the user from scrolling to
     * reach actions.
     *
     * position:relative on the card + absolute on the
     * toolbars keeps them anchored regardless of card
     * content height. Hover-only via opacity transition —
     * the buttons don't steal space or draw attention
     * during normal reading, and are discoverable via
     * mouseover. */
    .message-card {
      position: relative;
    }
    .message-toolbar {
      position: absolute;
      right: 0.5rem;
      display: flex;
      gap: 0.25rem;
      opacity: 0;
      transition: opacity 120ms ease;
      /* Buttons should be above the card's text content
       * so they're clickable when visible. */
      z-index: 1;
    }
    .message-toolbar.top {
      top: 0.4rem;
    }
    .message-toolbar.bottom {
      bottom: 0.4rem;
    }
    .message-card:hover .message-toolbar {
      opacity: 1;
    }
    .message-action-button {
      background: rgba(13, 17, 23, 0.85);
      border: 1px solid rgba(240, 246, 252, 0.2);
      color: var(--text-primary, #c9d1d9);
      padding: 0.15rem 0.4rem;
      font-size: 0.75rem;
      border-radius: 3px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
      line-height: 1;
    }
    .message-action-button:hover {
      background: rgba(240, 246, 252, 0.1);
      border-color: rgba(240, 246, 252, 0.4);
    }
    .message-action-button:active {
      transform: translateY(1px);
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
    .action-button.active {
      background: rgba(88, 166, 255, 0.12);
      color: var(--accent-primary, #58a6ff);
      border-color: rgba(88, 166, 255, 0.3);
    }
    /* Search bar — sits inside the action bar between the
     * snippet-drawer toggle and the session buttons. Flex-1
     * to take the middle space. Inline toggles live inside
     * the input's border so the whole search area visually
     * groups as one element. */
    .search-bar {
      display: flex;
      flex: 1;
      align-items: center;
      gap: 0.25rem;
      min-width: 0;
    }
    .search-input-wrapper {
      display: flex;
      flex: 1;
      align-items: center;
      min-width: 0;
      background: rgba(13, 17, 23, 0.8);
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 4px;
      overflow: hidden;
    }
    .search-input-wrapper:focus-within {
      border-color: var(--accent-primary, #58a6ff);
    }
    .search-input {
      flex: 1;
      min-width: 0;
      padding: 0.3rem 0.5rem;
      background: transparent;
      border: none;
      color: var(--text-primary, #c9d1d9);
      font-family: inherit;
      font-size: 0.8125rem;
    }
    .search-input:focus {
      outline: none;
    }
    .search-toggle {
      background: transparent;
      border: none;
      color: var(--text-secondary, #8b949e);
      padding: 0.25rem 0.4rem;
      font-size: 0.7rem;
      font-family: 'SFMono-Regular', Consolas, monospace;
      cursor: pointer;
      border-radius: 2px;
      line-height: 1;
    }
    .search-toggle:hover {
      background: rgba(240, 246, 252, 0.08);
      color: var(--text-primary, #c9d1d9);
    }
    .search-toggle.active {
      background: rgba(88, 166, 255, 0.2);
      color: var(--accent-primary, #58a6ff);
    }
    .search-counter {
      font-size: 0.75rem;
      color: var(--text-secondary, #8b949e);
      font-variant-numeric: tabular-nums;
      padding: 0 0.5rem;
      white-space: nowrap;
    }
    .search-counter.no-match {
      color: #f85149;
    }
    .search-nav {
      display: flex;
      align-items: center;
      gap: 0.1rem;
    }
    .search-nav-button {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-secondary, #8b949e);
      padding: 0.2rem 0.4rem;
      font-size: 0.75rem;
      border-radius: 3px;
      cursor: pointer;
      line-height: 1;
    }
    .search-nav-button:hover {
      background: rgba(240, 246, 252, 0.08);
      color: var(--text-primary, #c9d1d9);
    }
    .search-nav-button:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }
    .snippet-drawer {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
      padding: 0.5rem 0;
      margin-bottom: 0.5rem;
      border-top: 1px solid rgba(240, 246, 252, 0.08);
      border-bottom: 1px solid rgba(240, 246, 252, 0.08);
    }
    .snippet-empty {
      padding: 0.25rem 0.5rem;
      color: var(--text-secondary, #8b949e);
      font-style: italic;
      font-size: 0.8125rem;
    }
    .snippet-button {
      background: rgba(13, 17, 23, 0.6);
      border: 1px solid rgba(240, 246, 252, 0.1);
      color: var(--text-primary, #c9d1d9);
      padding: 0.3rem 0.6rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.8125rem;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .snippet-button:hover {
      background: rgba(240, 246, 252, 0.06);
      border-color: rgba(240, 246, 252, 0.2);
    }
    .snippet-icon {
      font-size: 0.9375rem;
    }
    .snippet-label {
      color: var(--text-secondary, #8b949e);
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

    /* Pending images strip below the textarea, shown while
     * composing. Thumbnails with a remove button overlay. */
    .pending-images {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      padding: 0.5rem 0;
    }
    .pending-image-wrapper {
      position: relative;
      width: 64px;
      height: 64px;
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid rgba(240, 246, 252, 0.15);
    }
    .pending-image {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      cursor: pointer;
    }
    .pending-image-remove {
      position: absolute;
      top: 2px;
      right: 2px;
      width: 18px;
      height: 18px;
      padding: 0;
      background: rgba(13, 17, 23, 0.85);
      border: 1px solid rgba(240, 246, 252, 0.3);
      border-radius: 50%;
      color: var(--text-primary, #c9d1d9);
      font-size: 0.75rem;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .pending-image-remove:hover {
      background: rgba(248, 81, 73, 0.9);
      border-color: rgba(248, 81, 73, 1);
    }

    /* Image thumbnails inside user message cards. Same
     * shape as pending images but with a re-attach button
     * (📎) instead of remove. */
    .message-images {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }
    .message-image-wrapper {
      position: relative;
      width: 80px;
      height: 80px;
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid rgba(240, 246, 252, 0.15);
    }
    .message-image {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      cursor: pointer;
    }
    .message-image-reattach {
      position: absolute;
      top: 2px;
      right: 2px;
      width: 20px;
      height: 20px;
      padding: 0;
      background: rgba(13, 17, 23, 0.85);
      border: 1px solid rgba(240, 246, 252, 0.3);
      border-radius: 3px;
      color: var(--text-primary, #c9d1d9);
      font-size: 0.7rem;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 120ms ease;
    }
    .message-image-wrapper:hover .message-image-reattach {
      opacity: 1;
    }
    .message-image-reattach:hover {
      background: rgba(88, 166, 255, 0.9);
      border-color: var(--accent-primary, #58a6ff);
      color: #fff;
    }

    /* Lightbox overlay — full-screen with centered content.
     * z-index above the dialog so it doesn't disappear
     * behind the chat panel. */
    .lightbox-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.85);
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      outline: none;
    }
    .lightbox-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
      max-width: 100%;
      max-height: 100%;
    }
    .lightbox-image {
      max-width: 100%;
      max-height: calc(100vh - 8rem);
      border-radius: 4px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
    }
    .lightbox-actions {
      display: flex;
      gap: 0.75rem;
    }
    .lightbox-button {
      padding: 0.5rem 1rem;
      background: rgba(22, 27, 34, 0.9);
      border: 1px solid rgba(240, 246, 252, 0.2);
      color: var(--text-primary, #c9d1d9);
      font-family: inherit;
      font-size: 0.875rem;
      border-radius: 4px;
      cursor: pointer;
    }
    .lightbox-button:hover {
      background: rgba(240, 246, 252, 0.08);
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
    // Read drawer state eagerly — avoids a closed→open flicker
    // on mount when the user had it open previously.
    this._snippetDrawerOpen = _loadDrawerOpen();
    this._snippets = [];
    this._pendingImages = [];
    this._lightboxImage = null;
    // Search state — query empty by default, toggles loaded
    // from localStorage. Ignore-case defaults true (most
    // users expect case-insensitive), regex and whole-word
    // default false.
    this._searchQuery = '';
    this._searchIgnoreCase = _loadSearchToggle(
      _SEARCH_IGNORE_CASE_KEY,
      true,
    );
    this._searchRegex = _loadSearchToggle(
      _SEARCH_REGEX_KEY,
      false,
    );
    this._searchWholeWord = _loadSearchToggle(
      _SEARCH_WHOLE_WORD_KEY,
      false,
    );
    this._searchCurrentIndex = -1;

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
    // The most recently completed request ID. Compaction events
    // arrive asynchronously AFTER stream-complete, by which time
    // `_currentRequestId` is already null. The compaction-event
    // handler accepts events for either `_currentRequestId` (in
    // the rare case compaction starts before stream-complete is
    // fully processed) or `_lastRequestId` (the common case).
    // Set inside `_onStreamComplete` for our own requests only;
    // collaborator streams don't update this.
    this._lastRequestId = null;

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
    this._onCompactionEvent = this._onCompactionEvent.bind(this);
    this._onMessagesScroll = this._onMessagesScroll.bind(this);
    this._onMessagesClick = this._onMessagesClick.bind(this);
    this._onModeOrReviewChanged = this._onModeOrReviewChanged.bind(this);
    this._onLightboxKeyDown = this._onLightboxKeyDown.bind(this);
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
    window.addEventListener(
      'compaction-event',
      this._onCompactionEvent,
    );
    window.addEventListener('mode-changed', this._onModeOrReviewChanged);
    window.addEventListener(
      'review-started',
      this._onModeOrReviewChanged,
    );
    window.addEventListener(
      'review-ended',
      this._onModeOrReviewChanged,
    );
  }

  disconnectedCallback() {
    window.removeEventListener('stream-chunk', this._onStreamChunk);
    window.removeEventListener('stream-complete', this._onStreamComplete);
    window.removeEventListener('user-message', this._onUserMessage);
    window.removeEventListener('session-changed', this._onSessionChanged);
    window.removeEventListener(
      'compaction-event',
      this._onCompactionEvent,
    );
    window.removeEventListener(
      'mode-changed',
      this._onModeOrReviewChanged,
    );
    window.removeEventListener(
      'review-started',
      this._onModeOrReviewChanged,
    );
    window.removeEventListener(
      'review-ended',
      this._onModeOrReviewChanged,
    );
    if (this._rafHandle != null) {
      cancelAnimationFrame(this._rafHandle);
      this._rafHandle = null;
    }
    super.disconnectedCallback();
  }

  onRpcReady() {
    // Fetch snippets once the proxy is published. RpcMixin
    // defers this hook to the next microtask so every
    // sibling component has received the proxy before any
    // of them issues requests — we're safe to call straight
    // away.
    this._loadSnippets();
  }

  updated(changedProps) {
    // Scroll to bottom on each state update — but only if the
    // user hasn't scrolled up. The passive scroll listener
    // manages `_autoScroll`.
    if (this._autoScroll) {
      this._scrollToBottom();
    }
    // Focus the lightbox backdrop when it opens so Escape
    // works without the user having to click first. Using
    // `changedProps.has('_lightboxImage')` checks the
    // transition, not the current value, so we don't
    // re-focus on every render while the lightbox is open.
    if (
      changedProps.has('_lightboxImage') &&
      this._lightboxImage &&
      !changedProps.get('_lightboxImage')
    ) {
      this.updateComplete.then(() => {
        const backdrop =
          this.shadowRoot?.querySelector('.lightbox-backdrop');
        if (backdrop) backdrop.focus();
      });
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
    let wasOwnRequest = false;
    if (requestId === this._currentRequestId) {
      wasOwnRequest = true;
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
      // Remember the completed request ID so post-completion
      // events (compaction, URL fetches whose callbacks arrived
      // late) can still be routed to this conversation. Kept
      // as a separate field so it outlives the current-request
      // reset above. Overwritten by each new stream-complete
      // we own.
      this._lastRequestId = requestId;
    }

    this._streams.delete(requestId);

    // After finalising, check whether the response warrants
    // a retry prompt. Only fires for our own requests —
    // passive streams from collaborators don't get retry
    // prompts in our textarea. If a prompt IS populated,
    // the textarea is focused so the user can review and
    // send immediately.
    if (wasOwnRequest && result && !result.error) {
      this._maybePopulateRetryPrompt(result);
    }
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
    //
    // Multimodal messages (images) arrive as an array of
    // `{type: 'text'/'image_url', ...}` blocks; normalize to
    // `{content: <string>, images: [<data uri>]}` so render
    // code has one shape to handle. The msg.images field
    // passed in may also be a preexisting array (when the
    // server sends it directly); prefer that.
    this.messages = msgs.map((m) => {
      const normalized = normalizeMessageContent(m);
      const images = Array.isArray(m.images)
        ? m.images
        : normalized.images;
      return {
        role: m.role,
        content: normalized.content,
        ...(images.length > 0 ? { images } : {}),
        ...(m.system_event ? { system_event: true } : {}),
      };
    });
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
    // Seed input history from the loaded session's user
    // messages. A new session (empty messages) is a no-op;
    // a loaded session populates recall with prior prompts.
    this._seedInputHistory(msgs);
  }

  /**
   * Handle a compaction / progress event from the server.
   *
   * These events arrive on the same channel as stream-chunk /
   * stream-complete but carry a `stage` field in their payload
   * identifying what's happening. The stages we care about:
   *
   *   - `url_fetch` — URL fetch started mid-stream. Show a
   *     transient toast with the display name so the user
   *     knows the delay is network-bound, not hung.
   *   - `url_ready` — URL fetch completed. Brief success
   *     toast.
   *   - `compacting` — history compaction starting. Toast so
   *     the user knows their older history is being
   *     summarised.
   *   - `compacted` — compaction done. Replace the message
   *     list with the compacted messages the event carries;
   *     success toast referencing the case (truncate /
   *     summarize / none). The new list is authoritative —
   *     everything before the compacted boundary is gone
   *     from the client's view.
   *   - `compaction_error` — compaction failed. Error toast;
   *     messages unchanged. The backend's history is intact
   *     too — this is a best-effort optimisation.
   *
   * Request ID filtering: compaction runs AFTER
   * stream-complete has fired, so `_currentRequestId` is
   * already null by the time compaction events arrive. We
   * also accept events matching `_lastRequestId` (the most
   * recently completed request) per specs3. Events for
   * unknown request IDs are silently dropped — a late event
   * from a cancelled or forgotten request shouldn't
   * interfere with the current conversation.
   *
   * Doc enrichment stages (`doc_enrichment_*`) are ignored
   * here. Per specs4/5-webapp/shell.md they drive a header
   * progress bar, not a chat-panel toast. The spec is
   * explicit: "Not rendered as toast — header progress bar
   * handles these."
   */
  _onCompactionEvent(event) {
    const { requestId, event: payload } = event.detail || {};
    if (!payload || typeof payload !== 'object') return;
    const stage = payload.stage;
    if (!stage) return;
    // Request ID filter — accept current and most-recent,
    // drop anything else. Missing requestId is accepted
    // too (some progress events may not carry one).
    if (
      requestId &&
      requestId !== this._currentRequestId &&
      requestId !== this._lastRequestId
    ) {
      return;
    }
    switch (stage) {
      case 'url_fetch': {
        // `url` is the display name — "github.com/owner/repo",
        // "example.com/docs/foo", etc. Falls back to a
        // generic label if the backend didn't include one.
        const label = payload.url || 'URL';
        this._emitToast(`Fetching ${label}…`, 'info');
        return;
      }
      case 'url_ready': {
        const label = payload.url || 'URL';
        this._emitToast(`Fetched ${label}`, 'success');
        return;
      }
      case 'compacting': {
        this._emitToast('Compacting history…', 'info');
        return;
      }
      case 'compacted': {
        // Replace the message list with the compacted form.
        // The backend's `case` field tells us what kind of
        // compaction happened — truncate (dropped old
        // messages), summarize (synthesised a summary for
        // pre-window messages), or none (trigger tripped
        // but nothing needed changing).
        const newMessages = Array.isArray(payload.messages)
          ? payload.messages
          : null;
        if (newMessages) {
          this.messages = newMessages.map((m) => {
            const normalized = normalizeMessageContent(m);
            const images = Array.isArray(m.images)
              ? m.images
              : normalized.images;
            return {
              role: m.role,
              content: normalized.content,
              ...(images.length > 0 ? { images } : {}),
              ...(m.system_event ? { system_event: true } : {}),
            };
          });
        }
        const caseName = payload.case;
        const toastMsg =
          caseName === 'truncate'
            ? 'History truncated at topic boundary'
            : caseName === 'summarize'
              ? 'History summarised'
              : 'History compaction complete';
        this._emitToast(toastMsg, 'success');
        return;
      }
      case 'compaction_error': {
        // The error field is the backend's error string.
        // Preserve it verbatim in the toast — debugging
        // compaction requires knowing what went wrong.
        const detail = payload.error || 'unknown error';
        this._emitToast(`Compaction failed: ${detail}`, 'error');
        return;
      }
      default:
        // Unknown stage — silent drop. Doc enrichment
        // stages fall through here (by design) and any
        // future backend stage we haven't learned about
        // is harmless to ignore.
        return;
    }
  }

  _onModeOrReviewChanged() {
    // Mode or review state changed — snippets are mode-aware
    // (code / doc / review), so refetch. The fetch is
    // idempotent and cheap; a stray event that doesn't
    // actually change the mode just re-sets the same list.
    this._loadSnippets();
  }

  /**
   * Seed the input-history component with user messages
   * from a just-loaded session. Called from
   * `_onSessionChanged` after messages are replaced so
   * up-arrow recall works for messages from the loaded
   * conversation, not just messages typed since mount.
   *
   * Handles multimodal messages — when `content` is an
   * array of `{type: 'text', text: ...}` / `{type:
   * 'image_url', ...}` blocks (backend shape for
   * image-bearing user messages), concatenates the text
   * blocks and ignores the rest. A future Phase 2d commit
   * will add image-paste support; for now images are just
   * stripped during recall since they can't round-trip
   * through a plain textarea anyway.
   */
  _seedInputHistory(msgs) {
    const history = this.shadowRoot?.querySelector(
      'ac-input-history',
    );
    if (!history) {
      // Component isn't mounted yet. Defer until it is —
      // happens on first render after `_onSessionChanged`
      // fires before `updated()`. Adding entries is cheap,
      // so we can safely retry once Lit commits.
      this.updateComplete.then(() => {
        const h = this.shadowRoot?.querySelector('ac-input-history');
        if (h) this._seedIntoHistory(h, msgs);
      });
      return;
    }
    this._seedIntoHistory(history, msgs);
  }

  _seedIntoHistory(historyEl, msgs) {
    for (const m of msgs) {
      if (m.role !== 'user' || m.system_event) continue;
      let text;
      if (typeof m.content === 'string') {
        text = m.content;
      } else if (Array.isArray(m.content)) {
        // Multimodal — extract text blocks and join with
        // newlines. Non-text blocks (images) are dropped —
        // they'll come back via re-attach in a later
        // Phase 2d commit.
        text = m.content
          .filter((b) => b && b.type === 'text' && b.text)
          .map((b) => b.text)
          .join('\n');
      } else {
        continue;
      }
      if (text && text.trim()) {
        historyEl.addEntry(text);
      }
    }
  }

  /**
   * Fetch snippets from the server. Fire-and-forget; errors
   * leave the snippet list unchanged (preserving any
   * previously-loaded snippets) and log to console. The
   * drawer renders a placeholder when the list is empty, so
   * pre-load state and post-error state look the same from
   * the user's perspective.
   */
  async _loadSnippets() {
    if (!this.rpcConnected) return;
    try {
      const snippets = await this.rpcExtract(
        'LLMService.get_snippets',
      );
      this._snippets = Array.isArray(snippets) ? snippets : [];
    } catch (err) {
      // Distinguish "method not on proxy" (expected when
      // the backend is a stripped-down test fixture or an
      // older server that doesn't expose snippets) from a
      // real failure (network, server error). Only the
      // latter is worth surfacing — the former is an
      // expected degraded-mode condition, not an error.
      // The drawer will show its empty-state placeholder
      // so the UI communicates the situation without a
      // console log.
      const message = err?.message || '';
      if (!message.includes('method not found')) {
        console.error('[chat] get_snippets failed', err);
      }
      // Preserve whatever snippets we had — an in-flight
      // refresh failing shouldn't wipe a list that was
      // successfully loaded earlier.
    }
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
    // Either text or at least one image must be present.
    // An image-only message is valid ("look at this") —
    // the LLM receives it as a user message with just the
    // image content.
    if (!text && this._pendingImages.length === 0) return;
    if (this._streaming) return;
    if (!this.rpcConnected) return;

    const requestId = generateRequestId();
    this._currentRequestId = requestId;
    this._streams.set(requestId, { content: '', sticky: true });

    // Snapshot pending images BEFORE we clear the array.
    // The optimistic message shows them; the RPC receives
    // them; the send state clears them regardless of
    // success. Deliberate symmetry: even if the RPC
    // rejects, the user doesn't want their images
    // reappearing in the pending strip (the error message
    // tells them what happened).
    const images = this._pendingImages.slice();

    // Record this message in input history before we clear
    // the textarea — up-arrow recall wants the full text,
    // not the empty string we're about to replace it with.
    // Only text goes into recall; images don't round-trip
    // through a plain textarea.
    if (text) {
      const history = this.shadowRoot?.querySelector(
        'ac-input-history',
      );
      if (history) history.addEntry(text);
    }

    // Add the user message optimistically. The server will
    // broadcast `userMessage` shortly; our handler detects the
    // in-flight request and skips the echo. Images are
    // attached to the optimistic message so they render
    // immediately in the card.
    const optimistic = {
      role: 'user',
      content: text,
      ...(images.length > 0 ? { images } : {}),
    };
    this.messages = [...this.messages, optimistic];
    this._input = '';
    this._pendingImages = [];
    this._streaming = true;
    this._streamingContent = '';
    this._autoScroll = true;
    // Auto-close the snippet drawer on send — users don't
    // want it consuming vertical space during streaming,
    // and the act of sending is a natural "I'm done
    // composing" signal. Persist so it stays closed on
    // reload.
    if (this._snippetDrawerOpen) {
      this._snippetDrawerOpen = false;
      _saveDrawerOpen(false);
    }

    try {
      await this.rpcExtract(
        'LLMService.chat_streaming',
        requestId,
        text,
        // Passed positionally as the 4th arg to match the
        // backend's `chat_streaming(request_id, message,
        // files=None, images=None)` signature. Phase 2c's
        // selected-files list lives on this component
        // as `selectedFiles` (set by the files-tab
        // orchestrator); passing it through keeps the
        // backend aware of the current context.
        Array.isArray(this.selectedFiles)
          ? this.selectedFiles
          : [],
        images,
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
  // Retry prompts
  // ---------------------------------------------------------------

  /**
   * After a stream completes, inspect the result for
   * conditions that warrant a retry prompt in the textarea.
   * The prompt is populated but NOT sent — user reviews and
   * decides.
   *
   * Three cases, in priority order (later cases win if
   * multiple apply):
   *
   *   1. In-context mismatch — edits with anchor_not_found
   *      on files that ARE in the current selection. LLM
   *      has stale content; ask it to re-read and retry.
   *   2. Ambiguous anchor — edits with ambiguous_anchor
   *      error. Specific LLM mistake (not enough context
   *      for a unique match); ask it to add more.
   *   3. Not-in-context — files_auto_added is non-empty.
   *      Those edits weren't attempted at all; the auto-add
   *      made the files available for the next turn.
   *
   * The ordering matches specs3/edit_protocol.md —
   * not-in-context runs last so it overwrites earlier
   * prompts. This is acceptable per spec: "Note: may
   * overwrite an earlier ambiguous-anchor prompt if both
   * are present in the same response."
   *
   * If the user has already typed something in the textarea,
   * we skip the population — don't clobber their typing.
   */
  _maybePopulateRetryPrompt(result) {
    if (!result || typeof result !== 'object') return;
    // User typed between stream end and this callback — leave
    // their input alone. Tiny window but the courtesy matters.
    if (this._input.trim() !== '') return;

    const editResults = Array.isArray(result.edit_results)
      ? result.edit_results
      : [];
    const filesAutoAdded = Array.isArray(result.files_auto_added)
      ? result.files_auto_added
      : [];

    // Build each prompt independently; the last non-null
    // wins. We could early-return after the highest-priority
    // one, but building them is cheap and the explicit order
    // makes the precedence rule obvious at read time.
    const selectedFiles = Array.isArray(this.selectedFiles)
      ? this.selectedFiles
      : [];
    let prompt = null;
    const mismatch = buildInContextMismatchRetryPrompt(
      editResults,
      selectedFiles,
    );
    if (mismatch) prompt = mismatch;
    const ambiguous = buildAmbiguousRetryPrompt(editResults);
    if (ambiguous) prompt = ambiguous;
    const notInContext = buildNotInContextRetryPrompt(
      filesAutoAdded,
    );
    if (notInContext) prompt = notInContext;

    if (!prompt) return;
    this._input = prompt;
    // Focus and size the textarea on the next tick so Lit
    // has committed the value. Same pattern as
    // _onHistorySelect.
    this.updateComplete.then(() => {
      const ta = this.shadowRoot?.querySelector('.input-textarea');
      if (!ta) return;
      ta.focus();
      // Move cursor to end so the user can continue typing
      // (e.g. to add context) without having to click or
      // arrow over first.
      ta.setSelectionRange(prompt.length, prompt.length);
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 192)}px`;
    });
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

  /**
   * Toggle the snippet drawer open/closed. Persists the new
   * state to localStorage so the drawer re-opens on the next
   * mount if the user left it open. Doesn't require
   * rpc-connected — the drawer can be opened to an empty
   * state and will populate once RPC comes up.
   */
  _toggleSnippetDrawer() {
    this._snippetDrawerOpen = !this._snippetDrawerOpen;
    _saveDrawerOpen(this._snippetDrawerOpen);
  }

  /**
   * Insert a snippet's message into the textarea at the
   * current cursor position. If the textarea has a selection,
   * the selection is replaced. Focuses the textarea after
   * insertion so the user can continue typing directly.
   *
   * Accepts the whole snippet object (not just the message
   * string) so the caller is the event handler — less
   * template-level inline arrow functions, fewer allocations
   * during render.
   */
  _insertSnippet(snippet) {
    const message =
      snippet && typeof snippet.message === 'string'
        ? snippet.message
        : '';
    if (!message) return;
    const ta = this.shadowRoot?.querySelector('.input-textarea');
    if (!ta) {
      // Defensive — the textarea should always exist when
      // a snippet button is visible. Fall back to plain
      // append so the click isn't lost.
      this._input = `${this._input}${message}`;
      return;
    }
    // Compute the new value and cursor position from the
    // CURRENT textarea state (not `this._input`). If the
    // user has been typing fast, `this._input` might lag
    // by one input event; reading directly from the
    // textarea is authoritative.
    const before = ta.value.slice(0, ta.selectionStart);
    const after = ta.value.slice(ta.selectionEnd);
    const next = `${before}${message}${after}`;
    this._input = next;
    // Set the textarea value directly so the selection can
    // be positioned right after the inserted text. Lit will
    // also reflect `.value=${this._input}` on the next
    // render; doing it here first keeps the cursor state
    // accurate without waiting for updateComplete.
    ta.value = next;
    const cursor = before.length + message.length;
    ta.setSelectionRange(cursor, cursor);
    ta.focus();
    // Fire an input event so the auto-resize logic runs.
    // Without this, inserting a multi-line snippet doesn't
    // grow the textarea until the next keystroke.
    ta.dispatchEvent(new Event('input', { bubbles: true }));
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

  /**
   * Handle paste events on the textarea. If the clipboard
   * contains image items, consume them and add to the
   * pending list. Text pastes fall through to the textarea's
   * native behaviour — don't preventDefault unless we
   * actually captured at least one image.
   *
   * Size and count limits are enforced in `_addPendingImage`,
   * which is the single code path shared with re-attach.
   */
  async _onInputPaste(event) {
    const cb = event.clipboardData;
    if (!cb) return;
    const images = await extractImagesFromClipboard(cb);
    if (images.length === 0) return;
    // Consume the paste event so the browser doesn't
    // additionally try to paste a `[object Object]` string
    // representation of the image into the textarea.
    event.preventDefault();
    for (const dataUri of images) {
      this._addPendingImage(dataUri);
    }
  }

  /**
   * Add a data URI to the pending images list. Shared
   * between paste and re-attach paths. Enforces:
   *   - MAX_IMAGES_PER_MESSAGE — over the cap, emit a
   *     warning toast and drop the image
   *   - MAX_IMAGE_BYTES — oversized images rejected with
   *     a toast
   *   - Dedup by exact data URI — identical paste twice
   *     is probably accidental, so silently drop the
   *     second
   *
   * Returns true if the image was added, false if
   * rejected (for caller-facing feedback, though current
   * callers don't use the return).
   */
  _addPendingImage(dataUri) {
    if (typeof dataUri !== 'string' || !dataUri) return false;
    // Already attached? Silently skip — common case is
    // the user pasting the same screenshot twice.
    if (this._pendingImages.includes(dataUri)) return false;
    // At the cap? Warn and drop.
    if (this._pendingImages.length >= MAX_IMAGES_PER_MESSAGE) {
      this._emitToast(
        `Maximum ${MAX_IMAGES_PER_MESSAGE} images per message`,
        'warning',
      );
      return false;
    }
    // Over size? Warn and drop.
    const bytes = estimateDataUriBytes(dataUri);
    if (bytes > MAX_IMAGE_BYTES) {
      const mb = Math.round(MAX_IMAGE_BYTES / (1024 * 1024));
      this._emitToast(
        `Image exceeds ${mb} MiB limit`,
        'warning',
      );
      return false;
    }
    this._pendingImages = [...this._pendingImages, dataUri];
    return true;
  }

  /**
   * Remove a pending image by index. Called by the
   * thumbnail strip's per-image X button.
   */
  _removePendingImage(index) {
    if (index < 0 || index >= this._pendingImages.length) return;
    this._pendingImages = [
      ...this._pendingImages.slice(0, index),
      ...this._pendingImages.slice(index + 1),
    ];
  }

  /**
   * Re-attach an image from a past message to the current
   * composition. Goes through the same `_addPendingImage`
   * path so limit checks and dedup apply uniformly.
   * Emits a confirmation toast on success since the
   * visual feedback (image appears in thumbnail strip
   * below textarea) may not be visible if the user is
   * scrolled up in the message list. If the image was
   * already attached, gives neutral feedback so the
   * click doesn't feel ignored; the over-limit case
   * already emitted its own warning toast from inside
   * `_addPendingImage`.
   */
  _reattachImage(dataUri) {
    const wasAlreadyAttached = this._pendingImages.includes(dataUri);
    if (this._addPendingImage(dataUri)) {
      this._emitToast('Image attached', 'success');
    } else if (wasAlreadyAttached) {
      this._emitToast('Image already attached', 'info');
    }
  }

  _emitToast(message, type = 'info') {
    window.dispatchEvent(
      new CustomEvent('ac-toast', {
        detail: { message, type },
        bubbles: false,
      }),
    );
  }

  /**
   * Extract raw text from a message for copy / paste
   * actions. Handles both string and multimodal-array
   * content shapes — the backend sends multimodal arrays
   * for session-reloaded messages that had images, plain
   * strings for everything else.
   *
   * Images are dropped — this is a text action. The
   * message card's image thumbnails have their own
   * re-attach / lightbox affordances.
   *
   * @param {object} msg — message dict
   * @returns {string}
   */
  _extractMessageText(msg) {
    if (!msg) return '';
    const raw = msg.content;
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) {
      // normalizeMessageContent does this work already,
      // but it also builds an images array we don't need.
      // Inline the text extraction for a smaller hot path.
      const parts = [];
      for (const block of raw) {
        if (
          block &&
          block.type === 'text' &&
          typeof block.text === 'string'
        ) {
          parts.push(block.text);
        }
      }
      return parts.join('\n');
    }
    return '';
  }

  /**
   * Copy the message's raw text to the clipboard. Emits a
   * toast on success so the user gets confirmation (the
   * clipboard write is silent otherwise). Falls back to a
   * warning toast if the Clipboard API rejects — happens
   * in insecure contexts (file://), older browsers, or
   * when permission is denied.
   */
  async _copyMessageText(msg) {
    const text = this._extractMessageText(msg);
    if (!text) {
      // Nothing to copy — probably an image-only message.
      // Silent rather than emitting a noisy warning; the
      // UX is "the button did nothing meaningful" and the
      // user will see their clipboard wasn't changed.
      return;
    }
    try {
      if (
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(text);
        this._emitToast('Copied to clipboard', 'success');
      } else {
        // No Clipboard API — surface the limitation
        // rather than silently failing.
        this._emitToast('Clipboard not available', 'warning');
      }
    } catch (err) {
      // Permission denied / insecure context / etc. Don't
      // spam the console for an expected failure mode —
      // the toast tells the user what happened.
      this._emitToast(
        `Copy failed: ${err?.message || 'permission denied'}`,
        'warning',
      );
    }
  }

  /**
   * Insert the message's raw text into the chat input at
   * the current cursor position. Replaces any selection.
   * Focuses the textarea after insertion so the user can
   * continue typing.
   *
   * Follows the same pattern as _insertSnippet — reads
   * cursor state from the textarea directly (not from
   * this._input) so rapid typing doesn't produce a stale
   * cursor position.
   */
  _pasteMessageToPrompt(msg) {
    const text = this._extractMessageText(msg);
    if (!text) return;
    const ta = this.shadowRoot?.querySelector('.input-textarea');
    if (!ta) {
      // Defensive — textarea should always exist. Fall
      // back to plain append so the click isn't lost.
      this._input = `${this._input}${text}`;
      return;
    }
    // Insert at cursor. If the textarea has a selection,
    // it's replaced. Using ta.value (not this._input) as
    // the source so we reflect the textarea's actual
    // current state.
    const before = ta.value.slice(0, ta.selectionStart);
    const after = ta.value.slice(ta.selectionEnd);
    const next = `${before}${text}${after}`;
    this._input = next;
    // Set the textarea value directly so selection can
    // be positioned right after the inserted text. Lit
    // will reflect `.value=${this._input}` on the next
    // render; doing it here first keeps cursor state
    // accurate without waiting for updateComplete.
    ta.value = next;
    const cursor = before.length + text.length;
    ta.setSelectionRange(cursor, cursor);
    ta.focus();
    // Fire an input event so the auto-resize logic runs.
    // Without this, inserting a multi-line message
    // doesn't grow the textarea until the next keystroke.
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  _openLightbox(dataUri) {
    this._lightboxImage = dataUri;
  }

  _closeLightbox() {
    this._lightboxImage = null;
  }

  _onLightboxKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this._closeLightbox();
    }
  }

  /**
   * Compute current search matches — delegates to the pure
   * `findMessageMatches` helper with the current toggle state.
   * Called from render and from navigation handlers.
   *
   * Returns an array of message indices. Stable between
   * re-renders for the same query + messages + toggle state.
   */
  _computeSearchMatches() {
    return findMessageMatches(this.messages, this._searchQuery, {
      ignoreCase: this._searchIgnoreCase,
      regex: this._searchRegex,
      wholeWord: this._searchWholeWord,
    });
  }

  /**
   * Handle typing in the search input. Updates the query
   * state; match computation happens in render. Resets the
   * current-match cursor to 0 so the first match is always
   * the initial highlight, regardless of where the cursor
   * was before the query changed.
   *
   * Scrolls the first match into view on each keystroke —
   * gives the user immediate visual confirmation without
   * waiting for them to hit Enter.
   */
  _onSearchInput(event) {
    this._searchQuery = event.target.value;
    this._searchCurrentIndex = 0;
    // Defer the scroll until Lit has rendered — the new
    // match might be a message that wasn't previously
    // highlighted, and the DOM needs to reflect the class
    // change before scrollIntoView can target the right
    // element.
    this.updateComplete.then(() => {
      this._scrollToCurrentMatch();
    });
  }

  /**
   * Toggle one of the three search options. Persists the new
   * value to localStorage so it survives page reloads.
   * `which` is a static string so the switch is cheap and
   * the method signature stays narrow.
   */
  _toggleSearchOption(which) {
    switch (which) {
      case 'ignoreCase':
        this._searchIgnoreCase = !this._searchIgnoreCase;
        _saveSearchToggle(
          _SEARCH_IGNORE_CASE_KEY,
          this._searchIgnoreCase,
        );
        break;
      case 'regex':
        this._searchRegex = !this._searchRegex;
        _saveSearchToggle(_SEARCH_REGEX_KEY, this._searchRegex);
        break;
      case 'wholeWord':
        this._searchWholeWord = !this._searchWholeWord;
        _saveSearchToggle(
          _SEARCH_WHOLE_WORD_KEY,
          this._searchWholeWord,
        );
        break;
      default:
        return;
    }
    // Toggle change alters which messages match — reset
    // the cursor and re-scroll so the user sees the first
    // match under the new settings.
    this._searchCurrentIndex = 0;
    this.updateComplete.then(() => {
      this._scrollToCurrentMatch();
    });
  }

  /**
   * Handle keydown in the search input. Enter navigates to
   * the next match (wrapping at the end); Shift+Enter to
   * the previous. Escape clears the query and blurs the
   * input so the user can resume typing in the textarea.
   *
   * Letter keys fall through to the input's default
   * behaviour — the `_onSearchInput` handler catches the
   * subsequent `input` event.
   */
  _onSearchKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) {
        this._onSearchPrev();
      } else {
        this._onSearchNext();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this._searchQuery = '';
      this._searchCurrentIndex = -1;
      // Blur so the user's next keystroke goes to the
      // main textarea.
      event.target.blur();
      return;
    }
  }

  _onSearchNext() {
    const matches = this._computeSearchMatches();
    if (matches.length === 0) return;
    // Wrap around at end.
    this._searchCurrentIndex =
      (Math.max(0, this._searchCurrentIndex) + 1) %
      matches.length;
    this.updateComplete.then(() => {
      this._scrollToCurrentMatch();
    });
  }

  _onSearchPrev() {
    const matches = this._computeSearchMatches();
    if (matches.length === 0) return;
    // Wrap around at start — `(-1 + total) % total`
    // handles the wrap without a conditional.
    const base = Math.max(0, this._searchCurrentIndex);
    this._searchCurrentIndex =
      (base - 1 + matches.length) % matches.length;
    this.updateComplete.then(() => {
      this._scrollToCurrentMatch();
    });
  }

  /**
   * Scroll the currently-highlighted match into view.
   * Noop when there's no current match or the message card
   * is missing (streaming card isn't indexed, shouldn't be
   * the current match anyway).
   *
   * The `scrollIntoView` availability check is defensive —
   * jsdom doesn't implement it on Element, so tests that
   * don't stub it would produce unhandled promise rejections
   * from the `updateComplete.then` callers. Older browser
   * contexts could similarly lack it. Checking once per call
   * costs nothing and avoids scattering test-infrastructure
   * coupling through unrelated tests.
   */
  _scrollToCurrentMatch() {
    const matches = this._computeSearchMatches();
    if (matches.length === 0) return;
    const idx = Math.max(0, this._searchCurrentIndex);
    if (idx >= matches.length) return;
    const msgIndex = matches[idx];
    const card = this.shadowRoot?.querySelector(
      `.message-card[data-msg-index="${msgIndex}"]`,
    );
    if (!card) return;
    if (typeof card.scrollIntoView !== 'function') return;
    card.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    });
  }

  _onInputKeyDown(event) {
    // If the input-history overlay is open, it gets first
    // refusal on navigation keys (arrows, Enter, Escape).
    // Letters and numbers fall through so the filter input
    // captures them naturally via its own listener.
    const history = this.shadowRoot?.querySelector(
      'ac-input-history',
    );
    if (history && history.isOpen) {
      if (history.handleKey(event)) return;
    }
    // Up-arrow at cursor position 0 opens the recall
    // overlay. Elsewhere in the textarea it's a normal
    // cursor move (don't intercept — the user might be
    // editing a multi-line message).
    if (
      event.key === 'ArrowUp' &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.target.selectionStart === 0 &&
      event.target.selectionEnd === 0
    ) {
      if (history && history.show(this._input)) {
        event.preventDefault();
        return;
      }
    }
    // Enter sends; Shift+Enter inserts a newline. The
    // composition guard prevents premature send during IME
    // input (e.g. Japanese/Chinese input methods).
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this._send();
    }
  }

  /**
   * Handle `history-select` from the input-history
   * component. The event carries the selected text; we
   * replace the textarea content and focus it so the user
   * can edit before sending (or just hit Enter to send
   * as-is).
   */
  _onHistorySelect(event) {
    const text = event.detail?.text ?? '';
    this._input = text;
    // Focus and move cursor to end on the next tick so
    // Lit has committed the value. updateComplete ensures
    // the reassignment reflected into the textarea DOM.
    this.updateComplete.then(() => {
      const ta = this.shadowRoot?.querySelector('.input-textarea');
      if (ta) {
        ta.focus();
        ta.setSelectionRange(text.length, text.length);
        // Auto-resize to fit the recalled content.
        ta.style.height = 'auto';
        ta.style.height = `${Math.min(ta.scrollHeight, 192)}px`;
      }
    });
  }

  /**
   * Handle `history-cancel` from the input-history
   * component. The detail carries the saved original input;
   * we restore it verbatim so Escape feels like an undo.
   */
  _onHistoryCancel(event) {
    const text = event.detail?.text ?? '';
    this._input = text;
    // Focus the textarea so the user can resume typing.
    this.updateComplete.then(() => {
      const ta = this.shadowRoot?.querySelector('.input-textarea');
      if (ta) {
        ta.focus();
        ta.setSelectionRange(text.length, text.length);
      }
    });
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
        ${this.messages.map((msg, index) =>
          this._renderMessage(msg, index),
        )}
        ${this._streaming ? this._renderStreamingMessage() : ''}
      </div>
      ${!this.rpcConnected
        ? html`<div class="disconnected-note">
            Not connected to the server
          </div>`
        : ''}
      <div class="input-area">
        <div class="action-bar" role="toolbar">
          <div class="action-group">
            <button
              class="action-button snippet-drawer-button ${this
                ._snippetDrawerOpen
                ? 'active'
                : ''}"
              @click=${this._toggleSnippetDrawer}
              aria-label=${this._snippetDrawerOpen
                ? 'Close snippet drawer'
                : 'Open snippet drawer'}
              aria-expanded=${this._snippetDrawerOpen}
              title="Quick-insert snippets"
            >
              ✂️ Snippets
            </button>
          </div>
          <div class="action-divider" aria-hidden="true"></div>
          ${this._renderSearchBar()}
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
        ${this._snippetDrawerOpen
          ? this._renderSnippetDrawer()
          : ''}
        <ac-input-history
          @history-select=${this._onHistorySelect}
          @history-cancel=${this._onHistoryCancel}
        ></ac-input-history>
        ${this._pendingImages.length > 0
          ? this._renderPendingImages()
          : ''}
        <div class="input-row">
          <textarea
            class="input-textarea"
            placeholder="Send a message… (Enter to send, Shift+Enter for newline)"
            .value=${this._input}
            ?disabled=${!this.rpcConnected || this._streaming}
            @input=${this._onInputChange}
            @keydown=${this._onInputKeyDown}
            @paste=${this._onInputPaste}
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
                (!this._input.trim() &&
                  this._pendingImages.length === 0)}
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
      ${this._lightboxImage
        ? this._renderLightbox()
        : ''}
    `;
  }

  _renderPendingImages() {
    return html`
      <div class="pending-images" role="list"
        aria-label="Attached images">
        ${this._pendingImages.map(
          (dataUri, i) => html`
            <div class="pending-image-wrapper" role="listitem">
              <img
                class="pending-image"
                src=${dataUri}
                alt=""
                @click=${() => this._openLightbox(dataUri)}
                title="Click to view, × to remove"
              />
              <button
                class="pending-image-remove"
                @click=${() => this._removePendingImage(i)}
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

  _renderLightbox() {
    // Inline overlay rather than a separate component —
    // simple enough that the extra file would be overkill.
    // Focus the backdrop so Escape works without the user
    // having to click first.
    return html`
      <div
        class="lightbox-backdrop"
        tabindex="0"
        @click=${(e) => {
          // Close on backdrop click but not on clicks
          // inside the content. Check target === currentTarget
          // so the content's own click doesn't bubble up
          // and dismiss.
          if (e.target === e.currentTarget) this._closeLightbox();
        }}
        @keydown=${this._onLightboxKeyDown}
        aria-modal="true"
        role="dialog"
      >
        <div class="lightbox-content">
          <img
            class="lightbox-image"
            src=${this._lightboxImage}
            alt=""
          />
          <div class="lightbox-actions">
            <button
              class="lightbox-button"
              @click=${() => {
                this._reattachImage(this._lightboxImage);
                this._closeLightbox();
              }}
              title="Re-attach this image to your message"
            >
              📎 Re-attach
            </button>
            <button
              class="lightbox-button"
              @click=${this._closeLightbox}
              title="Close (Escape)"
            >
              ✕ Close
            </button>
          </div>
        </div>
      </div>
    `;
  }

  _renderMessage(msg, index) {
    const roleClass = msg.system_event ? 'role-system' : `role-${msg.role}`;
    const roleLabel = msg.system_event
      ? 'System'
      : msg.role === 'user'
        ? 'You'
        : 'Assistant';
    // Compute whether this message is the current search
    // match. Matches are resolved by index lookup to avoid
    // per-card regex re-evaluation on every render.
    const matches = this._computeSearchMatches();
    const currentMatchIdx =
      matches.length > 0
        ? matches[Math.max(0, this._searchCurrentIndex) % matches.length]
        : -1;
    const isHighlighted =
      this._searchQuery.trim() !== '' &&
      index === currentMatchIdx;
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
    const images = Array.isArray(msg.images) ? msg.images : [];
    const toolbar = this._renderMessageToolbar(msg);
    const highlightClass = isHighlighted ? ' search-highlight' : '';
    return html`
      <div
        class="message-card ${roleClass}${highlightClass}"
        data-msg-index=${index}
      >
        <div class="message-toolbar top">${toolbar}</div>
        <div class="role-label">${roleLabel}</div>
        ${bodyHtml}
        ${images.length > 0
          ? this._renderMessageImages(images)
          : ''}
        <div class="message-toolbar bottom">${toolbar}</div>
      </div>
    `;
  }

  /**
   * Render the action toolbar for a message — copy raw text
   * and paste raw text into the chat input. Shared renderer
   * used at both top-right and bottom-right of each message
   * card. Returns a Lit template with two buttons, both
   * calling methods that operate on the message's extracted
   * text content.
   *
   * Returns the same toolbar fragment for both placements —
   * Lit deduplicates the underlying event bindings, so
   * rendering twice is cheap and the two toolbars behave
   * identically.
   */
  _renderMessageToolbar(msg) {
    return html`
      <button
        class="message-action-button"
        title="Copy raw text"
        aria-label="Copy message text to clipboard"
        @click=${(e) => {
          // Prevent click-through to the card / mention
          // handler. The delegated mention click listener
          // on .messages only fires for .file-mention
          // elements, but stopPropagation is cheap
          // insurance against future additions.
          e.stopPropagation();
          this._copyMessageText(msg);
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
          this._pasteMessageToPrompt(msg);
        }}
      >
        ↩
      </button>
    `;
  }

  _renderMessageImages(images) {
    return html`
      <div class="message-images" role="list">
        ${images.map(
          (dataUri) => html`
            <div class="message-image-wrapper" role="listitem">
              <img
                class="message-image"
                src=${dataUri}
                alt=""
                @click=${() => this._openLightbox(dataUri)}
                title="Click to view"
              />
              <button
                class="message-image-reattach"
                @click=${(e) => {
                  // Don't also open the lightbox from the
                  // click-through on the image itself.
                  e.stopPropagation();
                  this._reattachImage(dataUri);
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

  _renderSearchBar() {
    // Compute matches and counter state at render time so
    // they always reflect the current query + toggles +
    // messages. Cheap — substring over a few hundred
    // messages is microseconds.
    const matches = this._computeSearchMatches();
    const hasQuery = this._searchQuery.trim().length > 0;
    const total = matches.length;
    const current =
      total === 0
        ? 0
        : Math.min(
            Math.max(0, this._searchCurrentIndex) + 1,
            total,
          );
    const counterText = hasQuery
      ? `${current}/${total}`
      : '';
    const noMatch = hasQuery && total === 0;
    return html`
      <div class="search-bar" role="search">
        <div class="search-input-wrapper">
          <input
            type="text"
            class="search-input"
            placeholder="Search messages…"
            .value=${this._searchQuery}
            @input=${this._onSearchInput}
            @keydown=${this._onSearchKeyDown}
            aria-label="Search messages"
          />
          <button
            class="search-toggle ${this._searchIgnoreCase
              ? 'active'
              : ''}"
            @click=${() =>
              this._toggleSearchOption('ignoreCase')}
            aria-pressed=${this._searchIgnoreCase}
            title="Ignore case"
          >
            Aa
          </button>
          <button
            class="search-toggle ${this._searchRegex
              ? 'active'
              : ''}"
            @click=${() => this._toggleSearchOption('regex')}
            aria-pressed=${this._searchRegex}
            title="Regex"
          >
            .*
          </button>
          <button
            class="search-toggle ${this._searchWholeWord
              ? 'active'
              : ''}"
            @click=${() =>
              this._toggleSearchOption('wholeWord')}
            aria-pressed=${this._searchWholeWord}
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
            ?disabled=${total === 0}
            @click=${this._onSearchPrev}
            aria-label="Previous match"
            title="Previous (Shift+Enter)"
          >
            ▲
          </button>
          <button
            class="search-nav-button"
            ?disabled=${total === 0}
            @click=${this._onSearchNext}
            aria-label="Next match"
            title="Next (Enter)"
          >
            ▼
          </button>
        </div>
      </div>
    `;
  }

  _renderSnippetDrawer() {
    // Empty list (pre-load, post-error, or genuinely no
    // snippets configured) shows a placeholder rather than
    // an empty box. Opening the drawer is a deliberate
    // action so showing nothing would be confusing.
    if (this._snippets.length === 0) {
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
        ${this._snippets.map(
          (snippet) => html`
            <button
              class="snippet-button"
              title=${snippet.tooltip || snippet.message || ''}
              aria-label=${snippet.tooltip ||
              `Insert snippet: ${snippet.message || ''}`}
              @click=${() => this._insertSnippet(snippet)}
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

export {
  generateRequestId,
  _loadDrawerOpen,
  _saveDrawerOpen,
  _DRAWER_STORAGE_KEY,
  _SEARCH_IGNORE_CASE_KEY,
  _SEARCH_REGEX_KEY,
  _SEARCH_WHOLE_WORD_KEY,
  _loadSearchToggle,
  _saveSearchToggle,
  buildAmbiguousRetryPrompt,
  buildInContextMismatchRetryPrompt,
  buildNotInContextRetryPrompt,
};