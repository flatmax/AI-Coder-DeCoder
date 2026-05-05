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
import './speech-to-text.js';
import './url-chips.js';

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

/** Maximum visible width of an agent tab label, in chars. */
const _AGENT_LABEL_MAX_LENGTH = 40;

/**
 * Parse an agent tab ID into the ``[turn_id, agent_idx]``
 * shape the backend's C1c ``agent_tag`` kwarg expects.
 *
 * Tab IDs for agents follow the format
 * ``{turn_id}/agent-{NN}`` where NN is a zero-padded
 * integer. The main tab uses the literal string
 * ``"main"`` — returns null for that case and for any
 * malformed input so the caller knows to skip the tag
 * argument entirely (untagged call = main conversation).
 *
 * Shape validation is defensive because tab IDs come
 * from the ``_tabs`` Map keys, which are set by the
 * spawn path. A future refactor that changes the
 * format would fail here loudly rather than silently
 * routing to the wrong agent.
 *
 * @param {string} tabId — the tab's identifier
 * @returns {[string, number] | null}
 */
function parseAgentTabId(tabId) {
  if (typeof tabId !== 'string' || !tabId) return null;
  if (tabId === 'main') return null;
  // Split on the last slash so turn IDs containing
  // slashes (unlikely but defensive) don't break
  // parsing.
  const slashIdx = tabId.lastIndexOf('/');
  if (slashIdx <= 0) return null;
  const turnId = tabId.slice(0, slashIdx);
  const agentPart = tabId.slice(slashIdx + 1);
  // Must be "agent-NN" where NN is non-negative int.
  const match = /^agent-(\d+)$/.exec(agentPart);
  if (!match) return null;
  const agentIdx = parseInt(match[1], 10);
  if (!Number.isFinite(agentIdx) || agentIdx < 0) return null;
  return [turnId, agentIdx];
}

/**
 * Derive a tab-strip label for a spawned agent.
 *
 * Format: `Agent NN` for empty / whitespace tasks, or
 * `Agent NN: {first line of task}` for a populated task
 * — truncated to `_AGENT_LABEL_MAX_LENGTH` chars with a
 * trailing `…` when the task text doesn't fit.
 *
 * The `Agent NN` prefix is zero-padded to two digits so
 * tabs sort naturally in the strip (agent-02 before
 * agent-10) and match the backend's `{turn_id}/agent-NN`
 * archive path convention from D25. Large indexes
 * (100+) outgrow the padding but still render; the
 * numeric width just isn't fixed beyond two digits.
 *
 * Task handling:
 *   - Non-string / null / undefined → `Agent NN`
 *   - Empty or whitespace-only → `Agent NN`
 *   - Multi-line → first non-blank line only. Tab labels
 *     are single-line; later lines are context the user
 *     will read in the agent's own conversation view.
 *   - Long first line → truncated to fit the cap; the
 *     `…` counts toward the total length so the label
 *     never exceeds `_AGENT_LABEL_MAX_LENGTH`.
 *
 * Index handling:
 *   - Non-integer or negative → coerced via
 *     `Math.max(0, Math.floor(idx))`. NaN coerces to 0.
 *     Defensive; the backend always sends a non-negative
 *     integer, but a malformed spawn payload shouldn't
 *     produce an ugly label like `Agent NaN`.
 *
 * @param {number} agentIdx — zero-based agent index
 * @param {string | undefined | null} task — the agent's
 *   task text from the spawn block
 * @returns {string} — tab label, suitable for the
 *   `_tabLabels` Map
 */
function deriveAgentTabLabel(agentIdx, task) {
  // Coerce the index. Integer, non-negative, padded to
  // two digits for strip sort order.
  let idx = Number(agentIdx);
  if (!Number.isFinite(idx)) idx = 0;
  idx = Math.max(0, Math.floor(idx));
  const paddedIdx = String(idx).padStart(2, '0');
  const prefix = `Agent ${paddedIdx}`;

  // Task handling — non-string / empty → bare prefix.
  if (typeof task !== 'string') return prefix;
  const firstLine = task
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return prefix;

  const full = `${prefix}: ${firstLine}`;
  if (full.length <= _AGENT_LABEL_MAX_LENGTH) return full;

  // Truncate, reserving one char for the ellipsis.
  // `prefix: ` is never itself long enough to overflow
  // (prefix is at most ~9 chars for 2-digit indexes; the
  // cap is 40), so there's always room for at least a
  // few task chars plus the ellipsis.
  const keep = _AGENT_LABEL_MAX_LENGTH - 1;
  return `${full.slice(0, keep)}…`;
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
    // Backend key is `file_path`; fall back to `file` so
    // older test fixtures still work.
    const file = r.file_path || r.file || '(unknown file)';
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
  const mismatches = editResults.filter((r) => {
    if (!r || r.error_type !== 'anchor_not_found') return false;
    const path = r.file_path || r.file;
    return typeof path === 'string' && selectedSet.has(path);
  });
  if (mismatches.length === 0) return null;
  const lines = [
    'The following edit(s) failed because the old text didn\'t',
    'match the actual file content. The file(s) are already in',
    'your context — please re-read them carefully and retry',
    'with the correct text:',
    '',
  ];
  for (const r of mismatches) {
    const file = r.file_path || r.file || '(unknown file)';
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
    // Per-tab reactive properties — every field marked
    // `noAccessor: true` has a custom getter/setter on the
    // class body that forwards to the active tab's state
    // (D21 per-tab refactor). Lit honours `noAccessor` by
    // skipping its descriptor installation and relying on
    // our setter to call requestUpdate.
    //
    // Non-per-tab reactive properties (`repoFiles`,
    // `reviewActive`) use the normal Lit accessor path.

    /**
     * Which tab is currently visible (D21 A3). Setter
     * dispatches `active-tab-changed` on change so
     * sibling components (files-tab picker, tab strip
     * UI) can re-sync their per-tab state. Single-tab
     * operation keeps this fixed at `"main"`; the
     * reactive plumbing is wired now so Phase C's
     * spawn path doesn't re-touch the switching
     * logic.
     */
    _activeTabId: { type: String, state: true, noAccessor: true },

    /**
     * Whether the tab strip's overflow menu is open
     * (D21 Phase B2). The menu is a dropdown anchored
     * to the three-dots button at the right edge of
     * the strip; it lists every tab by label for
     * direct-jump navigation. Non-per-tab because
     * it's a UI-level dropdown, not a conversation-
     * level concern — every tab sees the same menu.
     * Closed by default; toggled by button click or
     * menu-item click; dismissed by outside-click or
     * Escape.
     */
    _tabStripOverflowOpen: { type: Boolean, state: true },

    /**
     * Messages as `{role, content, system_event?}` dicts.
     * Replaced wholesale on session load; appended during
     * normal conversation. Always a new array on change so
     * Lit's default identity check triggers re-render.
     */
    messages: { type: Array, noAccessor: true },
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
     *
     * Not per-tab — repo-level state, global across tabs.
     */
    repoFiles: { type: Array },
    /** Current textarea content. Cleared on send. */
    _input: { type: String, state: true, noAccessor: true },
    /**
     * True while a user-initiated stream is in flight. Drives
     * the Send/Stop toggle and disables the input.
     */
    _streaming: { type: Boolean, state: true, noAccessor: true },
    /**
     * Rendered content of the active streaming assistant
     * message. Updated per animation frame, not per chunk, so
     * Lit re-render rate is capped at ~60Hz.
     */
    _streamingContent: {
      type: String,
      state: true,
      noAccessor: true,
    },
    /**
     * Whether the history browser modal is open. Toggled by
     * the "History" button and by the modal's close/load
     * events.
     */
    _historyOpen: {
      type: Boolean,
      state: true,
      noAccessor: true,
    },
    /**
     * Whether the snippet drawer is expanded. Persisted to
     * localStorage under `ac-dc-snippet-drawer` — the drawer
     * state survives browser refreshes.
     */
    _snippetDrawerOpen: {
      type: Boolean,
      state: true,
      noAccessor: true,
    },
    /**
     * Snippets loaded from LLMService.get_snippets. Each is
     * `{icon, tooltip, message}`. Empty until RPC ready or on
     * fetch error. Reloaded on mode / review state changes
     * since the server returns mode-aware snippets.
     */
    _snippets: { type: Array, state: true, noAccessor: true },
    /**
     * Images currently attached to the composition, as
     * data URIs. Accumulated from pastes and re-attaches;
     * cleared when the message is sent. Capped at
     * MAX_IMAGES_PER_MESSAGE; over-limit adds produce a
     * warning toast and are ignored.
     */
    _pendingImages: {
      type: Array,
      state: true,
      noAccessor: true,
    },
    /**
     * When non-null, the lightbox is open showing this data
     * URI. Set by clicking a message thumbnail or a pending
     * preview; cleared by Escape or backdrop click.
     */
    _lightboxImage: {
      type: String,
      state: true,
      noAccessor: true,
    },
    /** Current search query text. Empty = no active search. */
    _searchQuery: { type: String, state: true, noAccessor: true },
    /** Ignore-case search toggle. Persisted to localStorage. */
    _searchIgnoreCase: {
      type: Boolean,
      state: true,
      noAccessor: true,
    },
    /** Regex search toggle. Persisted to localStorage. */
    _searchRegex: {
      type: Boolean,
      state: true,
      noAccessor: true,
    },
    /** Whole-word search toggle. Persisted to localStorage. */
    _searchWholeWord: {
      type: Boolean,
      state: true,
      noAccessor: true,
    },
    /**
     * Index into the matches array of the currently-highlighted
     * match. -1 when no matches or no active search. Wraps
     * on Enter/Shift+Enter navigation.
     */
    _searchCurrentIndex: {
      type: Number,
      state: true,
      noAccessor: true,
    },
    /**
     * Search mode — 'message' (default) searches chat
     * messages; 'file' searches repository content via the
     * Repo.search_files RPC. Toggled via the mode button in
     * the action bar and by the activateFileSearch() public
     * method (called from Ctrl+Shift+F at the shell level).
     */
    _searchMode: { type: String, state: true, noAccessor: true },
    /**
     * Flat list of file search results, shape from the RPC:
     * [{file, matches: [{line_num, line, context_before,
     * context_after}]}]. Empty until the first debounced RPC
     * call completes.
     */
    _fileSearchResults: {
      type: Array,
      state: true,
      noAccessor: true,
    },
    /** True while a file-search RPC call is in flight. */
    _fileSearchLoading: {
      type: Boolean,
      state: true,
      noAccessor: true,
    },
    /**
     * Flat index into the results' matches — each file's
     * matches contribute N slots, enumerated top-to-bottom.
     * A value of 0 means the first match of the first file.
     * -1 means no focus (empty results).
     */
    _fileSearchFocusedIndex: {
      type: Number,
      state: true,
      noAccessor: true,
    },
    /**
     * True while a commit_all background task is in flight.
     * Drives the commit button's spinner state and disables
     * both commit and reset until the completion event fires.
     * Cleared by the `commit-result` window event handler.
     *
     * Not per-tab — commits are main-conversation-only.
     */
    _committing: { type: Boolean, state: true },
    /**
     * True when review mode is active. Pushed down from the
     * files-tab orchestrator when the server's review state
     * is populated. Disables the commit button — review is
     * read-only per specs4/4-features/code-review.md § Read-Only
     * Mode. Reset is NOT disabled in review mode; a user may
     * legitimately want to discard review-mode modifications.
     *
     * Defaults to false so component works standalone before
     * the files-tab wires up the push.
     *
     * Not per-tab — review is main-conversation-only.
     */
    reviewActive: { type: Boolean },
    /**
     * URL content dialog state. When non-null, the content
     * viewer overlay is open showing the URL's fetched
     * content. Set by the `url-view-requested` handler,
     * cleared by Escape or backdrop click.
     */
    _urlViewDialog: {
      type: Object,
      state: true,
      noAccessor: true,
    },
    /**
     * Active tab within the URL view dialog. `'content'`
     * shows title + body (summary/readme/content); `'symbols'`
     * shows the symbol map. Only relevant when the fetched
     * URL is a GitHub repo with a symbol map — generic URLs
     * hide the tab bar since there's only one panel to show.
     */
    _urlViewTab: { type: String, state: true, noAccessor: true },
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

    /* Tab strip — D21 Phase B1 + B2. Renders above the
     * messages area when multiple tabs exist. Hidden
     * entirely in single-tab operation (the common
     * case) so it doesn't consume vertical space
     * users will never benefit from. Appears the
     * moment a second tab spawns.
     *
     * B2 adds horizontal overflow scrolling for when
     * many agent tabs exceed the viewport width. The
     * outer .tab-strip is a positioning context; the
     * inner .tab-strip-scroll is the scrollable row
     * of buttons, and .tab-strip-overflow is pinned
     * at the right as an always-available direct-jump
     * affordance. */
    .tab-strip {
      flex-shrink: 0;
      display: flex;
      align-items: stretch;
      background: rgba(22, 27, 34, 0.6);
      border-bottom: 1px solid rgba(240, 246, 252, 0.1);
      position: relative;
    }
    .tab-strip-scroll {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 0.125rem;
      padding: 0.25rem 0.5rem;
      overflow-x: auto;
      overflow-y: hidden;
      /* Thin scrollbar — macOS and most Linux themes
       * auto-hide scrollbars; Firefox and Windows show
       * them. A 4px track keeps the strip compact
       * regardless of platform default. */
      scrollbar-width: thin;
    }
    .tab-strip-scroll::-webkit-scrollbar {
      height: 4px;
    }
    .tab-strip-scroll::-webkit-scrollbar-thumb {
      background: rgba(240, 246, 252, 0.15);
      border-radius: 2px;
    }
    .tab-strip-scroll::-webkit-scrollbar-track {
      background: transparent;
    }
    .tab-strip-tab {
      flex-shrink: 0;
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-secondary, #8b949e);
      padding: 0.3rem 0.75rem;
      border-radius: 4px 4px 0 0;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.8125rem;
      white-space: nowrap;
      max-width: 16rem;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: background 120ms ease, color 120ms ease;
    }
    .tab-strip-tab:hover {
      background: rgba(240, 246, 252, 0.06);
      color: var(--text-primary, #c9d1d9);
    }
    .tab-strip-tab.active {
      background: rgba(88, 166, 255, 0.12);
      color: var(--accent-primary, #58a6ff);
      border-color: rgba(88, 166, 255, 0.3);
      border-bottom-color: rgba(22, 27, 34, 0.6);
    }

    /* Streaming pulse indicator (D21 Phase D1). Small
     * animated dot that appears on tab labels when the
     * tab has an in-flight stream. Visible on ALL
     * tabs regardless of active state — the point is
     * to let users see work happening on tabs they
     * aren't currently looking at. Positioned inline
     * with the label text; the tab button's existing
     * layout accommodates it without re-flow because
     * the dot has fixed width. */
    .tab-streaming-indicator {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent-primary, #58a6ff);
      margin-right: 0.35rem;
      vertical-align: middle;
      animation: tab-pulse 1.5s ease-in-out infinite;
    }
    @keyframes tab-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.7); }
    }

    /* Close button on agent tabs (D21 Phase B3). Small
     * ✕ glyph inline with the label, visible only on
     * hover / focus to avoid visual noise when many
     * tabs are present. Nested inside the tab button
     * so it shares the tab's layout, but uses its own
     * click handler with stopPropagation so clicking
     * the ✕ doesn't also flip activeTabId to the tab
     * we're about to close. Main tab never renders
     * this button. */
    .tab-close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
      margin-left: 0.4rem;
      border: none;
      background: transparent;
      color: inherit;
      opacity: 0;
      cursor: pointer;
      border-radius: 3px;
      font-size: 0.85rem;
      line-height: 1;
      padding: 0;
      transition: opacity 100ms ease, background 100ms ease;
    }
    .tab-strip-tab:hover .tab-close,
    .tab-strip-tab.active .tab-close,
    .tab-close:focus-visible {
      opacity: 0.7;
    }
    .tab-close:hover {
      opacity: 1 !important;
      background: rgba(240, 246, 252, 0.15);
    }

    /* Overflow menu — three-dots button at the right
     * edge, always visible when the strip is visible
     * (at least 2 tabs). Clicking opens a dropdown
     * listing every tab by label for direct jumping.
     *
     * The button is outside the scroll region so it
     * stays pinned regardless of scroll position —
     * users with 15 agent tabs can always find the
     * jump menu without scrolling to the end. */
    .tab-strip-overflow {
      flex-shrink: 0;
      background: transparent;
      border: none;
      border-left: 1px solid rgba(240, 246, 252, 0.08);
      color: var(--text-secondary, #8b949e);
      padding: 0 0.6rem;
      cursor: pointer;
      font-size: 1rem;
      line-height: 1;
      transition: background 120ms ease, color 120ms ease;
    }
    .tab-strip-overflow:hover {
      background: rgba(240, 246, 252, 0.06);
      color: var(--text-primary, #c9d1d9);
    }
    .tab-strip-overflow[aria-expanded="true"] {
      background: rgba(240, 246, 252, 0.08);
      color: var(--text-primary, #c9d1d9);
    }
    .tab-strip-overflow-menu {
      position: absolute;
      top: 100%;
      right: 0.25rem;
      z-index: 20;
      background: var(--bg-primary, #0d1117);
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 6px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      padding: 0.25rem;
      min-width: 12rem;
      max-width: 20rem;
      max-height: 24rem;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
    }
    .tab-strip-overflow-item {
      display: block;
      width: 100%;
      text-align: left;
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-primary, #c9d1d9);
      padding: 0.35rem 0.6rem;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.8125rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tab-strip-overflow-item:hover {
      background: rgba(240, 246, 252, 0.08);
    }
    .tab-strip-overflow-item.active {
      background: rgba(88, 166, 255, 0.12);
      color: var(--accent-primary, #58a6ff);
    }

    .messages-wrapper {
      flex: 1;
      min-height: 0;
      position: relative;
      display: flex;
      flex-direction: column;
    }
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .messages.messages-hidden {
      display: none;
    }
    /* File search overlay — fills the wrapper, scroll
     * independent of messages. Messages stay in DOM so
     * state (scroll position, streaming cards) survives
     * across mode toggles. */
    .file-search-overlay {
      position: absolute;
      inset: 0;
      background: var(--bg-primary, #0d1117);
      overflow-y: auto;
      padding: 0.5rem 0;
    }
    .file-search-empty {
      padding: 2rem;
      text-align: center;
      color: var(--text-secondary, #8b949e);
      font-style: italic;
    }
    .file-search-section {
      border-bottom: 1px solid rgba(240, 246, 252, 0.06);
    }
    .file-search-section:last-child {
      border-bottom: none;
    }
    .file-section-header {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 0.4rem 1rem;
      background: rgba(22, 27, 34, 0.95);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      cursor: pointer;
      border-bottom: 1px solid rgba(240, 246, 252, 0.08);
    }
    .file-section-header:hover {
      background: rgba(240, 246, 252, 0.04);
    }
    .file-section-path {
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 0.8125rem;
      color: var(--accent-primary, #58a6ff);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }
    .file-section-count {
      font-size: 0.75rem;
      color: var(--text-secondary, #8b949e);
      background: rgba(13, 17, 23, 0.6);
      padding: 0.05rem 0.4rem;
      border-radius: 3px;
    }
    .file-match-row {
      display: flex;
      gap: 0.75rem;
      padding: 0.2rem 1rem 0.2rem 2rem;
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 0.8125rem;
      cursor: pointer;
      line-height: 1.4;
    }
    .file-match-row:hover {
      background: rgba(240, 246, 252, 0.04);
    }
    .file-match-row.focused {
      background: rgba(88, 166, 255, 0.12);
      border-left: 3px solid var(--accent-primary, #58a6ff);
      padding-left: calc(2rem - 3px);
    }
    .file-match-row.context {
      color: var(--text-secondary, #8b949e);
      opacity: 0.7;
      cursor: default;
    }
    .file-match-row.context:hover {
      background: transparent;
    }
    .file-match-linenum {
      color: var(--text-secondary, #8b949e);
      text-align: right;
      width: 3.5rem;
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
      user-select: none;
    }
    .file-match-text {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: pre;
    }
    .file-match-highlight {
      background: rgba(210, 153, 34, 0.25);
      border-radius: 2px;
      padding: 0 2px;
      margin: 0 -2px;
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
    .finish-reason-badge {
      display: inline-block;
      margin-left: 0.5rem;
      padding: 0.05rem 0.4rem;
      font-size: 0.7rem;
      font-weight: 500;
      text-transform: none;
      letter-spacing: normal;
      border-radius: 3px;
      /* Default (amber) — used for uncategorised non-natural
       * stops. Specific reasons override via the modifier
       * classes below. */
      background: rgba(210, 153, 34, 0.15);
      color: #d29922;
      border: 1px solid rgba(210, 153, 34, 0.3);
      opacity: 1;
    }
    /* Red variants for the two most disruptive stop reasons —
     * truncation (hit max_tokens) and content-filter blocks.
     * Specs3 §Finish Reason calls these out as "red badge +
     * error toast"; the amber default is for everything else
     * non-natural (tool_calls, function_call, unknown).
     * Override both background and border so the pill
     * visually pops against the amber variant. */
    .finish-reason-badge.severity-error {
      background: rgba(248, 81, 73, 0.15);
      color: #f85149;
      border-color: rgba(248, 81, 73, 0.4);
    }
    /* Muted green variant for natural completions (stop,
     * end_turn). Per specs-reference/5-webapp/chat.md §
     * Finish-reason badge labels — natural reasons produce
     * a visible-but-quiet badge so users get positive
     * confirmation the stream ended cleanly, without the
     * badge dominating the role label on every successful
     * turn. Reduced opacity keeps the pill readable but
     * visually secondary to the role label text. */
    .finish-reason-badge.severity-natural {
      background: rgba(126, 231, 135, 0.1);
      color: #7ee787;
      border-color: rgba(126, 231, 135, 0.25);
      opacity: 0.6;
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
    /* Code block chrome — floating copy button at top-right,
     * small language pill. Positioned absolute within the
     * pre element so they float over content rather than
     * pushing it. Button hidden by default (opacity 0) and
     * fades in on hover — avoids streaming flicker when
     * markdown re-renders mid-chunk. */
    .md-content pre.code-block {
      position: relative;
    }
    .md-content pre.code-block .code-lang {
      position: absolute;
      top: 0.35rem;
      right: 2.5rem;
      font-size: 0.6875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary, #8b949e);
      opacity: 0.5;
      font-family: inherit;
      pointer-events: none;
      user-select: none;
    }
    .md-content pre.code-block .code-copy-btn {
      position: absolute;
      top: 0.3rem;
      right: 0.3rem;
      width: 26px;
      height: 26px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(22, 27, 34, 0.85);
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 4px;
      color: var(--text-secondary, #8b949e);
      cursor: pointer;
      opacity: 0;
      transition: opacity 120ms ease, color 120ms ease,
        background 120ms ease, border-color 120ms ease;
    }
    .md-content pre.code-block:hover .code-copy-btn,
    .md-content pre.code-block .code-copy-btn:focus-visible {
      opacity: 1;
    }
    .md-content pre.code-block .code-copy-btn:hover {
      color: var(--text-primary, #c9d1d9);
      background: rgba(240, 246, 252, 0.1);
      border-color: rgba(240, 246, 252, 0.3);
    }
    .md-content pre.code-block .code-copy-btn.copied {
      color: #7ee787;
      border-color: rgba(126, 231, 135, 0.4);
      opacity: 1;
    }
    .md-content pre.code-block .code-copy-icon {
      display: block;
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
      cursor: pointer;
      padding: 0.1rem 0.25rem;
      margin: -0.1rem -0.25rem;
      border-radius: 3px;
      transition: background 120ms ease;
    }
    .edit-file-path:hover {
      background: rgba(88, 166, 255, 0.12);
      text-decoration: underline;
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
    /* Unified-diff line styling inside an edit card. Each
     * line renders as a span.diff-line with a TYPE modifier
     * (context/add/remove), a non-selectable prefix column
     * carrying the +/-/space glyph, and a text column.
     * Line-level background colours echo GitHub / GitLab
     * diff conventions — green for add, red for remove,
     * transparent for context — so a reader can scan
     * vertically without parsing the prefix glyphs. */
    .diff-line {
      display: block;
      white-space: pre;
      padding: 0 0.25rem;
      margin: 0 -0.25rem;
      border-left: 2px solid transparent;
    }
    .diff-line.context {
      color: var(--text-primary, #c9d1d9);
    }
    .diff-line.add {
      background: rgba(126, 231, 135, 0.12);
      border-left-color: rgba(126, 231, 135, 0.5);
      color: #a6e3af;
    }
    .diff-line.remove {
      background: rgba(248, 81, 73, 0.12);
      border-left-color: rgba(248, 81, 73, 0.5);
      color: #ff9b93;
    }
    /* Prefix column — single-char glyph with fixed width
     * so text aligns vertically regardless of content. */
    .diff-prefix {
      display: inline-block;
      width: 1em;
      user-select: none;
      opacity: 0.55;
      margin-right: 0.25rem;
    }
    .diff-text {
      display: inline;
    }
    /* Word-level highlight within an already-coloured
     * line. Paired remove/add runs pick up a
     * span.diff-change around the specific words that
     * changed — a saturated background on top of the
     * line-level colour draws the eye to the actual
     * edit without hiding the surrounding context. */
    .diff-change {
      border-radius: 2px;
      padding: 0 1px;
    }
    .diff-line.add .diff-change {
      background: rgba(126, 231, 135, 0.35);
      color: #fff;
    }
    .diff-line.remove .diff-change {
      background: rgba(248, 81, 73, 0.35);
      color: #fff;
    }
    .edit-error-message {
      padding: 0.4rem 0.75rem;
      background: rgba(248, 81, 73, 0.08);
      color: #f85149;
      font-size: 0.8125rem;
      border-top: 1px solid rgba(248, 81, 73, 0.15);
    }

    /* Edit summary banner — rendered at the end of an
     * assistant message (after all edit cards) when the
     * response contained at least one edit. Shows aggregate
     * counts as color-coded stat badges; lists individual
     * failures; notes when a retry prompt was populated.
     * Per specs4/5-webapp/chat.md §Edit Summary Banner. */
    .edit-summary {
      margin-top: 0.75rem;
      padding: 0.5rem 0.75rem;
      background: rgba(22, 27, 34, 0.6);
      border: 1px solid rgba(240, 246, 252, 0.1);
      border-radius: 6px;
      font-size: 0.8125rem;
    }
    .edit-summary-header {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.4rem;
    }
    .edit-summary-title {
      font-weight: 600;
      color: var(--text-secondary, #8b949e);
      margin-right: 0.25rem;
    }
    .edit-summary-stat {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
      font-size: 0.75rem;
      font-weight: 500;
    }
    .edit-summary-stat.applied {
      background: rgba(126, 231, 135, 0.12);
      color: #7ee787;
      border: 1px solid rgba(126, 231, 135, 0.3);
    }
    .edit-summary-stat.failed {
      background: rgba(248, 81, 73, 0.12);
      color: #f85149;
      border: 1px solid rgba(248, 81, 73, 0.3);
    }
    .edit-summary-stat.skipped,
    .edit-summary-stat.not-in-context {
      background: rgba(210, 153, 34, 0.12);
      color: #d29922;
      border: 1px solid rgba(210, 153, 34, 0.3);
    }
    .edit-summary-failures {
      margin-top: 0.5rem;
      padding-top: 0.4rem;
      border-top: 1px solid rgba(240, 246, 252, 0.08);
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .edit-summary-failure {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.4rem;
      font-size: 0.8125rem;
    }
    .edit-summary-failure-path {
      font-family: 'SFMono-Regular', Consolas, monospace;
      color: var(--accent-primary, #58a6ff);
      cursor: pointer;
    }
    .edit-summary-failure-path:hover {
      text-decoration: underline;
    }
    .edit-summary-failure-type {
      font-size: 0.7rem;
      padding: 0.05rem 0.35rem;
      background: rgba(248, 81, 73, 0.15);
      color: #f85149;
      border-radius: 3px;
      text-transform: lowercase;
    }
    .edit-summary-failure-message {
      color: var(--text-secondary, #8b949e);
      flex: 1 1 100%;
      padding-left: 0.5rem;
    }
    .edit-summary-retry-note {
      margin-top: 0.5rem;
      padding-top: 0.4rem;
      border-top: 1px solid rgba(240, 246, 252, 0.08);
      font-size: 0.8125rem;
      color: var(--text-secondary, #8b949e);
      font-style: italic;
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

    /* File summary section — renders below the assistant
     * message body, shows every file the message referenced
     * (via edit blocks or inline mentions) as a chip. The
     * chips are deliberately NOT styled as links — they're
     * buttons that toggle selection, not navigation. */
    .file-summary-section {
      margin-top: 0.75rem;
      padding-top: 0.5rem;
      border-top: 1px solid rgba(240, 246, 252, 0.08);
    }
    .file-summary-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 0.4rem;
    }
    .file-summary-title {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary, #8b949e);
    }
    .file-summary-add-all {
      background: rgba(88, 166, 255, 0.1);
      border: 1px solid rgba(88, 166, 255, 0.3);
      color: var(--accent-primary, #58a6ff);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.75rem;
      font-family: inherit;
      font-weight: 500;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .file-summary-add-all:hover {
      background: rgba(88, 166, 255, 0.2);
      border-color: rgba(88, 166, 255, 0.5);
    }
    .file-summary-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }
    .file-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      background: rgba(13, 17, 23, 0.6);
      border: 1px solid rgba(240, 246, 252, 0.1);
      color: var(--text-primary, #c9d1d9);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.8125rem;
      font-family: 'SFMono-Regular', Consolas, monospace;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .file-chip:hover {
      background: rgba(240, 246, 252, 0.06);
      border-color: rgba(240, 246, 252, 0.25);
    }
    /* In-context files — muted presentation. They're
     * already selected; no call-to-action needed. */
    .file-chip.in-context {
      color: var(--text-secondary, #8b949e);
      border-color: rgba(126, 231, 135, 0.25);
    }
    .file-chip.in-context:hover {
      color: var(--text-primary, #c9d1d9);
      border-color: rgba(126, 231, 135, 0.4);
    }
    .file-chip.in-context .file-chip-mark {
      color: #7ee787;
    }
    /* Not-in-context files — accent presentation. This
     * is the action chip; clicking adds the file to
     * context. */
    .file-chip.not-in-context {
      border-color: rgba(88, 166, 255, 0.3);
    }
    .file-chip.not-in-context:hover {
      background: rgba(88, 166, 255, 0.1);
      border-color: rgba(88, 166, 255, 0.5);
    }
    .file-chip.not-in-context .file-chip-mark {
      color: var(--accent-primary, #58a6ff);
      font-weight: 600;
    }
    .file-chip-mark {
      font-size: 0.875rem;
      line-height: 1;
    }
    .file-chip-path {
      /* Truncate very long paths. Full path is in the
       * tooltip. */
      max-width: 24rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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
    // ---------------------------------------------------------
    // Per-tab state (D21 — agent tab strip foundation)
    // ---------------------------------------------------------
    //
    // Every field that used to live on `this` directly and
    // changes per-conversation now lives inside a tab state
    // object, keyed by tab ID. Single-agent operation has
    // exactly one entry, `"main"`. Future parallel-agent
    // spawning will add one entry per agent under the same
    // Map.
    //
    // Lit reactive properties (`messages`, `_input`, etc.)
    // are exposed via getters/setters defined on the class
    // prototype; reads forward to the active tab's state,
    // writes mutate the tab's state and call
    // `this.requestUpdate(name, oldValue)` so Lit's dirty-
    // check machinery observes the change.
    //
    // Non-reactive per-tab fields (`_streams`,
    // `_pendingChunks`, `_autoScroll`, etc.) don't go through
    // the Lit re-render path — they're still on the tab
    // state object but the getters don't call requestUpdate.
    //
    // See `_makeTabState` below for the field list.
    //
    // `_activeTabIdValue` is the backing storage for the
    // `_activeTabId` getter/setter defined on the
    // prototype. The setter dispatches
    // `active-tab-changed` on change (D21 A3); using a
    // backing field avoids infinite recursion in the
    // setter while preserving the Lit reactive-property
    // contract via `noAccessor: true`.
    this._activeTabIdValue = 'main';
    this._tabs = new Map();
    this._tabs.set('main', this._makeTabState());

    // Human-readable labels for the tab strip (D21
    // Phase B1). Keyed by tab ID, stored separately
    // from `_tabs` so agent tabs can have descriptive
    // labels derived from their task text without
    // renaming their state-storage key. Main's label is
    // fixed; agent labels will be set by Phase C's
    // spawn path.
    this._tabLabels = new Map();
    this._tabLabels.set('main', 'Main');

    // Overflow menu open state (D21 Phase B2). The
    // three-dots button in the strip opens a dropdown
    // listing every tab by label; clicking an item
    // jumps directly to that tab. The menu is a
    // reactive property (declared in `static
    // properties` above) rather than a per-tab field
    // because it's a UI-level dropdown — all tabs see
    // the same menu. Closed by default.
    this._tabStripOverflowOpen = false;

    // ---------------------------------------------------------
    // Cross-tab / component-scoped state (unchanged)
    // ---------------------------------------------------------
    // These fields aren't per-conversation — they're global
    // to the chat panel (main-only concerns, handler bindings,
    // files-tab pushes).

    // Commit state. `_committing` flips true on click, false
    // when the `commit-result` window event fires. Review
    // state defaults false and is driven by the parent
    // component via property push. Both are main-conversation
    // concerns — agents never commit, agents never enter
    // review mode.
    this._committing = false;
    this.reviewActive = false;

    // Repo files list — pushed by files-tab for file mention
    // detection. Global to the chat panel because the repo is
    // the same across all conversations.
    this.repoFiles = [];

    // rAF handle for chunk coalescing. One rAF active at a
    // time across all tabs — we pick the right tab's pending
    // chunk from `_activeTabId` when the rAF fires.
    this._rafHandle = null;

    // Bound handlers so add/remove match and we can clean up.
    this._onStreamChunk = this._onStreamChunk.bind(this);
    this._onStreamComplete = this._onStreamComplete.bind(this);
    this._onUserMessage = this._onUserMessage.bind(this);
    this._onSessionChanged = this._onSessionChanged.bind(this);
    this._onAgentsSpawned = this._onAgentsSpawned.bind(this);
    this._onStateLoaded = this._onStateLoaded.bind(this);
    this._onCompactionEvent = this._onCompactionEvent.bind(this);
    this._onMessagesScroll = this._onMessagesScroll.bind(this);
    this._onMessagesClick = this._onMessagesClick.bind(this);
    this._onModeOrReviewChanged = this._onModeOrReviewChanged.bind(this);
    this._onLightboxKeyDown = this._onLightboxKeyDown.bind(this);
    this._onCommitResult = this._onCommitResult.bind(this);

    // Overflow menu dismissal — bound so add/remove on
    // document scope find the same reference. The
    // listeners are attached only while the menu is
    // open and removed on close to avoid polluting
    // the document event loop when the menu is idle.
    this._onOverflowOutsideClick =
      this._onOverflowOutsideClick.bind(this);
    this._onOverflowKeyDown =
      this._onOverflowKeyDown.bind(this);
    // D2 — document-level chat-tab shortcut handler.
    // Bound so the listener survives add/remove cycles
    // (connectedCallback / disconnectedCallback).
    this._onChatTabShortcut = this._onChatTabShortcut.bind(this);
  }

  // ---------------------------------------------------------------
  // Per-tab state factory
  // ---------------------------------------------------------------

  /**
   * Build a fresh tab state object.
   *
   * Every field that a conversation owns lives in here. The
   * main tab gets one of these at construction time; future
   * agent spawning will add tab states keyed by `{turn_id}/
   * agent-NN` identifiers.
   *
   * Field groupings (informational — the flat object is
   * what the code uses):
   *
   *   Conversation — messages, input, pendingImages
   *   Streaming    — streaming, streamingContent,
   *                  currentRequestId, lastRequestId,
   *                  streams, pendingChunks
   *   Selection    — selectedFiles
   *   Search       — searchQuery, searchIgnoreCase,
   *                  searchRegex, searchWholeWord,
   *                  searchCurrentIndex, searchMode,
   *                  fileSearchResults, fileSearchLoading,
   *                  fileSearchFocusedIndex,
   *                  fileSearchGeneration,
   *                  fileSearchDebounceTimer,
   *                  fileSearchScrollPaused
   *   UI           — historyOpen, snippetDrawerOpen,
   *                  lightboxImage, urlViewDialog,
   *                  urlViewTab, snippets
   *   URL chips    — urlDetectDebounceTimer,
   *                  urlDetectGeneration
   *   Misc         — autoScroll, suppressNextPaste,
   *                  activeMention
   */
  _makeTabState() {
    return {
      // Conversation
      messages: [],
      input: '',
      pendingImages: [],
      // Streaming
      streaming: false,
      streamingContent: '',
      currentRequestId: null,
      lastRequestId: null,
      streams: new Map(),
      pendingChunks: new Map(),
      // Selection (pushed by files-tab for the main tab;
      // agents will get their own per-tab selection in a
      // later phase)
      selectedFiles: [],
      // Search — toggle defaults loaded from localStorage
      // so the user's last chosen search mode survives
      // reload.
      searchQuery: '',
      searchIgnoreCase: _loadSearchToggle(
        _SEARCH_IGNORE_CASE_KEY,
        true,
      ),
      searchRegex: _loadSearchToggle(_SEARCH_REGEX_KEY, false),
      searchWholeWord: _loadSearchToggle(
        _SEARCH_WHOLE_WORD_KEY,
        false,
      ),
      searchCurrentIndex: -1,
      searchMode: 'message',
      fileSearchResults: [],
      fileSearchLoading: false,
      fileSearchFocusedIndex: -1,
      fileSearchGeneration: 0,
      fileSearchDebounceTimer: null,
      fileSearchScrollPaused: false,
      // UI
      historyOpen: false,
      snippetDrawerOpen: _loadDrawerOpen(),
      lightboxImage: null,
      urlViewDialog: null,
      urlViewTab: 'content',
      snippets: [],
      // URL chip detection
      urlDetectDebounceTimer: null,
      urlDetectGeneration: 0,
      // URL chip state snapshot. Map<url, chipState>
      // mirroring the shape ac-url-chips holds
      // internally. The singleton ac-url-chips element
      // in the DOM always shows the currently-active
      // tab's state; on tab switch we snapshot the
      // leaving tab's `_chips` into this slot and
      // restore the entering tab's snapshot. Per
      // specs4/5-webapp/agent-browser.md § Per-Tab
      // State: "URL chip state (which URLs are
      // detected/fetched/excluded for this
      // conversation)" is per-tab.
      urlChips: null,
      // Misc non-reactive flags / state
      autoScroll: true,
      suppressNextPaste: false,
      activeMention: null,
    };
  }

  // ---------------------------------------------------------------
  // Reactive property accessors (D21 per-tab forwarding)
  // ---------------------------------------------------------------

  // Every reactive property declared in `static properties`
  // is re-exposed here as a getter/setter pair that forwards
  // to the active tab's state. The setters call
  // `requestUpdate(name, oldValue)` so Lit's internal dirty-
  // check machinery fires re-renders on mutation — same
  // behaviour as native reactive properties, just with the
  // storage indirected through the Map.
  //
  // Non-reactive per-tab fields (streams, pendingChunks,
  // autoScroll, etc.) get simple getters/setters without
  // requestUpdate calls; see the block below the reactive
  // accessors.

  // `_activeTabId` is special — it's the KEY into `_tabs`,
  // not a per-tab field itself. The getter reads a scalar
  // backing field on `this`; the setter dispatches
  // `active-tab-changed` on real transitions so sibling
  // components can re-sync per-tab state. Same-value
  // writes are no-ops to keep the event channel quiet.
  get _activeTabId() {
    return this._activeTabIdValue;
  }
  set _activeTabId(value) {
    const oldValue = this._activeTabIdValue;
    if (oldValue === value) return;
    // Snapshot the leaving tab's URL chip state before
    // flipping. The singleton ac-url-chips element
    // currently shows oldValue's chips; once we flip,
    // its `_chips` Map will belong to the new tab. If
    // we don't snapshot first, the leaving tab's state
    // is lost.
    //
    // Query via shadowRoot directly so this works even
    // on the very first switch before any Lit render
    // has bound the element. When the element doesn't
    // exist yet (fresh mount, pre-first-render), the
    // snapshot is skipped and the default `null` slot
    // carries through — matches the "never activated
    // URL chips yet" case naturally.
    this._snapshotUrlChipsForTab(oldValue);
    this._activeTabIdValue = value;
    this.requestUpdate('_activeTabId', oldValue);
    // Restore the entering tab's URL chip state. Runs
    // after the property flip so the chip component
    // (if it re-renders based on reactive state) sees
    // the new tab's data, not a half-swapped mix. See
    // _restoreUrlChipsForTab for why this defers via
    // updateComplete.
    this._restoreUrlChipsForTab(value);
    // Notify listeners of the transition. bubbles+composed
    // so the event crosses the shadow DOM boundary —
    // files-tab and the future tab strip component listen
    // at their own levels.
    this.dispatchEvent(
      new CustomEvent('active-tab-changed', {
        detail: {
          tabId: value,
          previousTabId: oldValue,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Copy the ac-url-chips element's current _chips Map
   * into the leaving tab's state slot. Runs synchronously
   * before _activeTabIdValue flips so the Map read still
   * reflects the departing tab.
   *
   * Defensive against early calls — before any render the
   * element doesn't exist in shadowRoot, in which case
   * there's nothing to snapshot.
   *
   * Stores a shallow copy (new Map wrapping the existing
   * entries) so subsequent mutations to the element's
   * live Map don't retroactively alter the snapshot. The
   * chip-state values are themselves objects; we don't
   * deep-clone them because chip-state mutation goes
   * through _chips = new Map(...) reassignment in the
   * component, not in-place edits of existing entries.
   */
  _snapshotUrlChipsForTab(tabId) {
    if (typeof tabId !== 'string' || !tabId) return;
    const tab = this._tabs.get(tabId);
    if (!tab) return;
    const chipsEl = this.shadowRoot?.querySelector('ac-url-chips');
    if (!chipsEl || !chipsEl._chips) return;
    tab.urlChips = new Map(chipsEl._chips);
  }

  /**
   * Install the entering tab's URL chip snapshot into the
   * ac-url-chips element. Defers through updateComplete
   * so the setter's requestUpdate cycle finishes first —
   * reading shadowRoot synchronously after a property
   * flip can return a stale reference in some edge cases
   * (re-entrant render during setter).
   *
   * An entering tab with no snapshot (freshly spawned
   * agent, or main tab in a new session) gets a fresh
   * empty Map. The chip component's render path handles
   * empty Maps by hiding the strip entirely, so agents
   * without URL activity show no strip — correct.
   */
  _restoreUrlChipsForTab(tabId) {
    this.updateComplete.then(() => {
      const chipsEl =
        this.shadowRoot?.querySelector('ac-url-chips');
      if (!chipsEl) return;
      const tab = this._tabs.get(tabId);
      if (!tab) return;
      // Reassign rather than mutate in place so Lit's
      // reactive property observer fires and re-renders.
      chipsEl._chips = tab.urlChips
        ? new Map(tab.urlChips)
        : new Map();
    });
  }

  get messages() {
    return this._tabs.get(this._activeTabId).messages;
  }
  set messages(value) {
    const tab = this._tabs.get(this._activeTabId);
    const oldValue = tab.messages;
    tab.messages = value;
    this.requestUpdate('messages', oldValue);
  }

  get _input() {
    return this._tabs.get(this._activeTabId).input;
  }
  set _input(value) {
    const tab = this._tabs.get(this._activeTabId);
    const oldValue = tab.input;
    tab.input = value;
    this.requestUpdate('_input', oldValue);
  }

  get _streaming() {
    return this._tabs.get(this._activeTabId).streaming;
  }
  set _streaming(value) {
    const tab = this._tabs.get(this._activeTabId);
    const oldValue = tab.streaming;
    tab.streaming = value;
    this.requestUpdate('_streaming', oldValue);
  }

  get _streamingContent() {
    return this._tabs.get(this._activeTabId).streamingContent;
  }
  set _streamingContent(value) {
    const tab = this._tabs.get(this._activeTabId);
    const oldValue = tab.streamingContent;
    tab.streamingContent = value;
    this.requestUpdate('_streamingContent', oldValue);
  }

  get _historyOpen() {
    return this._tabs.get(this._activeTabId).historyOpen;
  }
  set _historyOpen(value) {
    const tab = this._tabs.get(this._activeTabId);
    const oldValue = tab.historyOpen;
    tab.historyOpen = value;
    this.requestUpdate('_historyOpen', oldValue);
  }

  get _snippetDrawerOpen() {
    return this._tabs.get(this._activeTabId).snippetDrawerOpen;
  }
  set _snippetDrawerOpen(value) {
    const tab = this._tabs.get(this._activeTabId);
    const oldValue = tab.snippetDrawerOpen;
    tab.snippetDrawerOpen = value;
    this.requestUpdate('_snippetDrawerOpen', oldValue);
  }

  get _snippets() {
    return this._tabs.get(this._activeTabId).snippets;
  }
  set _snippets(value) {
    const tab = this._tabs.get(this._activeTabId);
    const oldValue = tab.snippets;
    tab.snippets = value;
    this.requestUpdate('_snippets', oldValue);
  }

  get _pendingImages() {
    return this._tabs.get(this._activeTabId).pendingImages;
  }
  set _pendingImages(value) {
    const tab = this._tabs.get(this._activeTabId);
    const oldValue = tab.pendingImages;
    tab.pendingImages = value;
    this.requestUpdate('_pendingImages', oldValue);
  }

  get _lightboxImage() {
    return this._tabs.get(this._activeTabId).lightboxImage;
  }
  set _lightboxImage(value) {
    const tab = this._tabs.get(this._activeTabId);
    const oldValue = tab.lightboxImage;
    tab.lightboxImage = value;
    this.requestUpdate('_lightboxImage', oldValue);
  }

  get _searchQuery() {
    return this._tabs.get(this._activeTabId).searchQuery;
  }
  set _searchQuery(value) {
    const tab = this._tabs.get(this._activeTabId);
    const oldValue = tab.searchQuery;
    tab.searchQuery = value;
    this.requestUpdate('_searchQuery', oldValue);
  }

  get _searchIgnoreCase() {
    return this._tabs.get(this._activeTabId).searchIgnoreCase;
  }
  set _searchIgnoreCase(value) {
    const tab = this._tabs.get(this._activeTabId);
    const oldValue = tab.searchIgnoreCase;
    tab.searchIgnoreCase = value;
    this.requestUpdate('_searchIgnoreCase', oldValue);
  }

  get _searchRegex() {
    return this._tabs.get(this._activeTabId).searchRegex;
  }
  set _searchRegex(value) {
    const tab = this._tabs.get(this._activeTabId);
    const oldValue = tab.searchRegex;
    tab.searchRegex = value;
    this.requestUpdate('_searchRegex', oldValue);
  }

  get _searchWholeWord() {
    return this._tabs.get(this._activeTabId).searchWholeWord;
  }
  set _searchWholeWord(value) {
    const tab = this._tabs.get(this._activeTabId);
    const oldValue = tab.searchWholeWord;
    tab.searchWholeWord = value;
    this.requestUpdate('_searchWholeWord', oldValue);
  }

  get _searchCurrentIndex() {
    return this._tabs.get(this._activeTabId).searchCurrentIndex;
  }
  set _searchCurrentIndex(value) {
    const tab = this._tabs.get(this._activeTabId);
    const oldValue = tab.searchCurrentIndex;
    tab.searchCurrentIndex = value;
    this.requestUpdate('_searchCurrentIndex', oldValue);
  }

  get _searchMode() {
    return this._tabs.get(this._activeTabId).searchMode;
  }
  set _searchMode(value) {
    const tab = this._tabs.get(this._activeTabId);
    const oldValue = tab.searchMode;
    tab.searchMode = value;
    this.requestUpdate('_searchMode', oldValue);
  }

  get _fileSearchResults() {
    return this._tabs.get(this._activeTabId).fileSearchResults;
  }
  set _fileSearchResults(value) {
    const tab = this._tabs.get(this._activeTabId);
    const oldValue = tab.fileSearchResults;
    tab.fileSearchResults = value;
    this.requestUpdate('_fileSearchResults', oldValue);
  }

  get _fileSearchLoading() {
    return this._tabs.get(this._activeTabId).fileSearchLoading;
  }
  set _fileSearchLoading(value) {
    const tab = this._tabs.get(this._activeTabId);
    const oldValue = tab.fileSearchLoading;
    tab.fileSearchLoading = value;
    this.requestUpdate('_fileSearchLoading', oldValue);
  }

  get _fileSearchFocusedIndex() {
    return this._tabs.get(this._activeTabId).fileSearchFocusedIndex;
  }
  set _fileSearchFocusedIndex(value) {
    const tab = this._tabs.get(this._activeTabId);
    const oldValue = tab.fileSearchFocusedIndex;
    tab.fileSearchFocusedIndex = value;
    this.requestUpdate('_fileSearchFocusedIndex', oldValue);
  }

  get _urlViewDialog() {
    return this._tabs.get(this._activeTabId).urlViewDialog;
  }
  set _urlViewDialog(value) {
    const tab = this._tabs.get(this._activeTabId);
    const oldValue = tab.urlViewDialog;
    tab.urlViewDialog = value;
    this.requestUpdate('_urlViewDialog', oldValue);
  }

  get _urlViewTab() {
    return this._tabs.get(this._activeTabId).urlViewTab;
  }
  set _urlViewTab(value) {
    const tab = this._tabs.get(this._activeTabId);
    const oldValue = tab.urlViewTab;
    tab.urlViewTab = value;
    this.requestUpdate('_urlViewTab', oldValue);
  }

  // ---------------------------------------------------------------
  // Non-reactive per-tab accessors
  // ---------------------------------------------------------------
  //
  // These fields back code paths that should NOT trigger a
  // Lit re-render on mutation — streaming internals
  // (`_streams`, `_pendingChunks`), event-handler scoped
  // flags (`_suppressNextPaste`, `_activeMention`), and
  // transient timer handles. They need tab-scoped storage
  // but no `requestUpdate` call.

  get _streams() {
    return this._tabs.get(this._activeTabId).streams;
  }
  set _streams(value) {
    this._tabs.get(this._activeTabId).streams = value;
  }

  get _currentRequestId() {
    return this._tabs.get(this._activeTabId).currentRequestId;
  }
  set _currentRequestId(value) {
    this._tabs.get(this._activeTabId).currentRequestId = value;
  }

  get _lastRequestId() {
    return this._tabs.get(this._activeTabId).lastRequestId;
  }
  set _lastRequestId(value) {
    this._tabs.get(this._activeTabId).lastRequestId = value;
  }

  get _pendingChunks() {
    return this._tabs.get(this._activeTabId).pendingChunks;
  }
  set _pendingChunks(value) {
    this._tabs.get(this._activeTabId).pendingChunks = value;
  }

  get _autoScroll() {
    return this._tabs.get(this._activeTabId).autoScroll;
  }
  set _autoScroll(value) {
    this._tabs.get(this._activeTabId).autoScroll = value;
  }

  get _suppressNextPaste() {
    return this._tabs.get(this._activeTabId).suppressNextPaste;
  }
  set _suppressNextPaste(value) {
    this._tabs.get(this._activeTabId).suppressNextPaste = value;
  }

  get _activeMention() {
    return this._tabs.get(this._activeTabId).activeMention;
  }
  set _activeMention(value) {
    this._tabs.get(this._activeTabId).activeMention = value;
  }

  get _fileSearchGeneration() {
    return this._tabs.get(this._activeTabId).fileSearchGeneration;
  }
  set _fileSearchGeneration(value) {
    this._tabs.get(this._activeTabId).fileSearchGeneration = value;
  }

  get _fileSearchDebounceTimer() {
    return this._tabs.get(this._activeTabId).fileSearchDebounceTimer;
  }
  set _fileSearchDebounceTimer(value) {
    this._tabs.get(this._activeTabId).fileSearchDebounceTimer = value;
  }

  get _fileSearchScrollPaused() {
    return this._tabs.get(this._activeTabId).fileSearchScrollPaused;
  }
  set _fileSearchScrollPaused(value) {
    this._tabs.get(this._activeTabId).fileSearchScrollPaused = value;
  }

  get _urlDetectDebounceTimer() {
    return this._tabs.get(this._activeTabId).urlDetectDebounceTimer;
  }
  set _urlDetectDebounceTimer(value) {
    this._tabs.get(this._activeTabId).urlDetectDebounceTimer = value;
  }

  get _urlDetectGeneration() {
    return this._tabs.get(this._activeTabId).urlDetectGeneration;
  }
  set _urlDetectGeneration(value) {
    this._tabs.get(this._activeTabId).urlDetectGeneration = value;
  }

  // `selectedFiles` is declared in `static properties` via
  // the files-tab orchestrator's direct-update path. It's
  // per-tab because agents will get their own selection
  // later. The getter/setter pair handles the reactive-
  // property contract so files-tab's requestUpdate pattern
  // keeps working.
  get selectedFiles() {
    return this._tabs.get(this._activeTabId).selectedFiles;
  }
  set selectedFiles(value) {
    const tab = this._tabs.get(this._activeTabId);
    const oldValue = tab.selectedFiles;
    tab.selectedFiles = value;
    this.requestUpdate('selectedFiles', oldValue);
  }

  // ---------------------------------------------------------------
  // Request-ID → tab routing (D21 A2)
  // ---------------------------------------------------------------

  /**
   * Find which tab owns `requestId`, or null.
   *
   * Matching rules:
   *
   *   1. Exact match against any tab's
   *      `currentRequestId` — the tab that initiated the
   *      request is the primary owner.
   *   2. Prefix match against `{parentId}-` — future
   *      parallel-agent mode spawns N child streams under
   *      a parent turn; each child's request ID is
   *      `{parent}-agent-NN`. The chat panel's tab
   *      strip (when it lands in Phase B/C) will carry
   *      one tab per agent, each with its own request ID,
   *      so this prefix match is dead in practice — but
   *      keeping it wired in now means Phase C's spawn
   *      path doesn't have to re-touch streaming
   *      routing.
   *
   * Returns the tab ID (`"main"` or `{turn_id}/agent-NN`)
   * or null when no tab claims the request.
   *
   * Collaboration broadcasts (a remote user's stream
   * reaching our panel) also return null — passive
   * stream adoption is a separate feature (see the
   * "passive stream" notes in the class docstring) and
   * will hook in here when it lands.
   */
  _findTabForRequest(requestId) {
    if (!requestId) return null;
    // Fast path — exact match against the active tab.
    // Skips the Map iteration in the common case.
    const active = this._tabs.get(this._activeTabId);
    if (active && active.currentRequestId === requestId) {
      return this._activeTabId;
    }
    // General scan. Two passes so exact matches on any
    // tab win over prefix matches — a request ID that
    // exactly equals one tab's ID shouldn't be treated
    // as a child of another tab whose ID happens to be
    // a prefix.
    for (const [tabId, tab] of this._tabs) {
      if (tab.currentRequestId === requestId) {
        return tabId;
      }
    }
    for (const [tabId, tab] of this._tabs) {
      const parentId = tab.currentRequestId;
      if (parentId && requestId.startsWith(`${parentId}-`)) {
        return tabId;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------
  // Tab strip rendering (D21 Phase B1)
  // ---------------------------------------------------------------

  /**
   * Handle a tab button click. Flips `_activeTabId`,
   * which fires the `active-tab-changed` event (see A3)
   * so the files-tab picker swaps its selection state
   * to match the newly-active tab.
   *
   * Same-tab clicks are no-ops because the setter
   * short-circuits on equal values.
   */
  _onTabClick(tabId) {
    if (typeof tabId !== 'string' || !tabId) return;
    this._activeTabId = tabId;
  }

  /**
   * Toggle the overflow menu open/closed (D21 Phase
   * B2). Attaches capture-phase document listeners
   * for outside-click and Escape dismissal when
   * opening; detaches them when closing. Capture
   * phase matters because the menu's own button
   * clicks are inside the shadow root, and the
   * outside-click check walks `composedPath()` to
   * distinguish inside vs outside.
   */
  _toggleOverflowMenu() {
    if (this._tabStripOverflowOpen) {
      this._closeOverflowMenu();
    } else {
      this._openOverflowMenu();
    }
  }

  _openOverflowMenu() {
    if (this._tabStripOverflowOpen) return;
    this._tabStripOverflowOpen = true;
    // Capture-phase so we see the event before any
    // child handler stops propagation. Without
    // capture, a click inside the menu's own
    // shadow-rooted children could mask the
    // outside-click check.
    document.addEventListener(
      'click',
      this._onOverflowOutsideClick,
      true,
    );
    document.addEventListener(
      'keydown',
      this._onOverflowKeyDown,
      true,
    );
  }

  _closeOverflowMenu() {
    if (!this._tabStripOverflowOpen) return;
    this._tabStripOverflowOpen = false;
    document.removeEventListener(
      'click',
      this._onOverflowOutsideClick,
      true,
    );
    document.removeEventListener(
      'keydown',
      this._onOverflowKeyDown,
      true,
    );
  }

  /**
   * Document-level click listener (capture phase)
   * installed while the overflow menu is open. Walks
   * `composedPath()` to see if the click originated
   * inside the menu or its toggle button — if yes,
   * let it through (the item's own click handler
   * will jump tabs and close). Otherwise close the
   * menu. Matches the pattern used by the picker's
   * context menu and the file picker's branch menu.
   */
  _onOverflowOutsideClick(event) {
    const path = event.composedPath ? event.composedPath() : [];
    const hit = path.some(
      (el) =>
        el instanceof Element &&
        (el.classList?.contains('tab-strip-overflow') ||
          el.classList?.contains('tab-strip-overflow-menu')),
    );
    if (!hit) this._closeOverflowMenu();
  }

  /**
   * Document-level keydown listener (capture phase)
   * installed while the overflow menu is open.
   * Escape closes the menu and stops propagation so
   * the textarea's own Escape handler doesn't also
   * fire (it clears input text, which would be a
   * surprise when the user just wanted to dismiss
   * the menu).
   */
  _onOverflowKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this._closeOverflowMenu();
    }
  }

  /**
   * Handle an overflow menu item click — jumps to
   * the target tab and closes the menu. Same
   * tab-switch path as `_onTabClick` (setter flips
   * `_activeTabId`, which fires `active-tab-changed`
   * for sibling components).
   */
  _onOverflowItemClick(tabId) {
    this._closeOverflowMenu();
    this._onTabClick(tabId);
  }

  /**
   * D2 — document-level keyboard handler for chat-tab
   * cycling. Alt+` moves to the next tab; Alt+Shift+`
   * moves to the previous. Wraps at both ends.
   *
   * Gated on:
   *   - `event.altKey` without Ctrl/Meta (Ctrl+Alt+`
   *     is a window-manager binding on some Linux
   *     distros; Cmd+Alt+` is used by macOS app
   *     switchers)
   *   - `event.key === '\`'` — backtick is the trigger
   *     character. event.code would be 'Backquote'
   *     but the char form is more robust across
   *     layouts where backtick appears on a different
   *     physical key
   *   - `_tabs.size > 1` — single-tab mode has nothing
   *     to cycle through, so we don't intercept the
   *     keystroke and it passes through to any other
   *     listeners (currently none, but defensive)
   *
   * preventDefault fires on every handled press so
   * browser chrome doesn't interpret the key (some
   * browsers bind Alt+` to "focus the next window").
   *
   * Does NOT fire on the Alt+1..9 number row — those
   * belong to app-shell's dialog-tab shortcuts. The
   * conflict with the original agent-browser spec
   * (which asked for Alt+1..0) is documented in the
   * connectedCallback comment.
   */
  _onChatTabShortcut(event) {
    if (!event.altKey) return;
    if (event.ctrlKey || event.metaKey) return;
    if (event.key !== '`') return;
    // Only active when multiple tabs exist. Avoids
    // eating the keystroke when there's nowhere to
    // cycle to.
    if (this._tabs.size <= 1) return;
    event.preventDefault();
    const tabIds = Array.from(this._tabs.keys());
    const currentIdx = tabIds.indexOf(this._activeTabId);
    if (currentIdx < 0) return;
    const delta = event.shiftKey ? -1 : 1;
    // Modular arithmetic with positive modulo — JavaScript's
    // `%` operator returns negative values for negative
    // dividends, so we add the length before taking the
    // modulo to force a positive result.
    const nextIdx =
      (currentIdx + delta + tabIds.length) % tabIds.length;
    this._activeTabId = tabIds[nextIdx];
  }


  /**
   * Close a tab (D21 Phase B3). Removes the tab from
   * `_tabs` and `_tabLabels`; if the closed tab was
   * active, switches to Main. Main tab can never be
   * closed (the button isn't rendered for it) but a
   * defensive guard here makes the intent explicit and
   * protects against a future programmatic call that
   * bypasses the UI.
   *
   * Dispatches `close-tab` with `{tabId}` so Phase C's
   * backend integration can hook in: when
   * `LLMService.close_agent_context` lands, wiring it
   * becomes a handler on this event rather than
   * modifying the close flow here. Letting the event
   * fire even when nothing listens costs nothing and
   * keeps the event surface stable for when it does.
   */
  _onTabClose(tabId) {
    if (typeof tabId !== 'string' || !tabId) return;
    if (tabId === 'main') return;
    if (!this._tabs.has(tabId)) return;
    const wasActive = this._activeTabId === tabId;
    this._tabs.delete(tabId);
    this._tabLabels.delete(tabId);
    // Switch to Main first (if the closed tab was
    // active) so the active-tab-changed event fires
    // with a valid target. Otherwise the render below
    // would still see _activeTabId pointing at the
    // deleted tab, and every per-tab getter would
    // lazy-create a fresh empty state at the stale key,
    // reviving the tab we just closed.
    if (wasActive) {
      this._activeTabId = 'main';
    }
    // Force a re-render so the strip reflects the
    // deletion — _tabs mutations don't trigger Lit's
    // dirty-check on their own.
    this.requestUpdate();

    this.dispatchEvent(
      new CustomEvent('close-tab', {
        detail: { tabId },
        bubbles: true,
        composed: true,
      }),
    );

    // C2c — fire the backend RPC to free the scope's
    // ContextManager + tracker + file_context. The
    // archive file on disk is preserved per C1b's
    // contract. Agent-mode-only: the tab ID parses
    // into (turn_id, agent_idx); main tab's "close"
    // path is blocked by the early-return guard above,
    // so we won't reach this branch for main.
    //
    // Fire-and-forget — the local state is already
    // mutated (optimistic close), and the RPC is
    // idempotent per C1b. A failure here means the
    // backend scope lingers until session end or
    // explicit cleanup; the user-visible tab is gone
    // regardless. Surfacing an error toast would be
    // confusing ("I closed the tab — why am I seeing
    // an error?") and the frontend has no recovery
    // action anyway.
    //
    // Restricted-caller errors for non-localhost
    // participants DO surface as a toast because
    // they're actionable: the user can ask the host
    // to close the tab for them. The rpcConnected
    // gate short-circuits when no RPC is available
    // (tests, pre-connect).
    const agentTag = parseAgentTabId(tabId);
    if (agentTag && this.rpcConnected) {
      const [turnId, agentIdx] = agentTag;
      this.rpcExtract(
        'LLMService.close_agent_context',
        turnId,
        agentIdx,
      ).then((result) => {
        // Restricted caller — surface as warning.
        // C1b's non-localhost path returns the
        // standard {error: "restricted", reason:
        // ...} shape.
        if (
          result
          && typeof result === 'object'
          && result.error === 'restricted'
        ) {
          this._emitToast(
            result.reason || 'Restricted operation',
            'warning',
          );
        }
      }).catch((err) => {
        // Network failure, RPC rejection, or similar.
        // Log at debug — the tab is already gone
        // locally, so toasting would misrepresent
        // the state. Operators debugging "why did
        // the scope leak" can find the log entry.
        console.debug(
          '[chat] close_agent_context failed',
          err,
        );
      });
    }
  }

  /**
   * Render the tab strip. Returns an empty template
   * when only the main tab exists — the strip consumes
   * vertical space, and users running single-agent
   * operation (the common case) shouldn't pay that
   * cost. The strip appears the moment a second tab
   * materialises (Phase C's spawn path).
   *
   * Label source — `this._tabLabels` Map, keyed by tab
   * ID. Missing labels fall back to the tab ID itself
   * so a stale Map (future bug) produces visible but
   * ugly output rather than empty buttons.
   *
   * B2 layout: the outer `.tab-strip` is a flex row
   * containing a scrollable `.tab-strip-scroll` with
   * the tab buttons and a pinned `.tab-strip-overflow`
   * button that toggles a direct-jump dropdown. The
   * overflow button is always present when the strip
   * is visible (≥2 tabs) rather than gated on a
   * "tabs exceed width" measurement — measuring overflow
   * reliably in jsdom is fragile, and users with many
   * agents benefit from direct access regardless of
   * whether the strip is currently overflowing.
   */
  _renderTabStrip() {
    // Hide in single-tab operation. The `_tabs` Map
    // always has 'main'; any additional entry means
    // we've got agent tabs.
    if (this._tabs.size <= 1) {
      return '';
    }
    // Iteration order of a Map is insertion order, so
    // 'main' comes first (constructor) and agent tabs
    // follow in spawn order. That matches the natural
    // left-to-right reading order for the strip.
    const tabs = Array.from(this._tabs.keys());
    return html`
      <div class="tab-strip">
        <div class="tab-strip-scroll" role="tablist">
          ${tabs.map((tabId) => {
            const label = this._tabLabels.get(tabId) || tabId;
            const active = tabId === this._activeTabId;
            const closable = tabId !== 'main';
            // Streaming indicator (D1) — read the tab's
            // own streaming flag directly from the Map
            // rather than through the active-tab
            // getters. Shown regardless of active state
            // so users see work happening on tabs they
            // aren't currently looking at.
            const tab = this._tabs.get(tabId);
            const streaming = !!(tab && tab.streaming);
            return html`
              <button
                class="tab-strip-tab ${active ? 'active' : ''}"
                role="tab"
                aria-selected=${active}
                aria-busy=${streaming}
                data-tab-id=${tabId}
                @click=${() => this._onTabClick(tabId)}
                title=${label}
              >${streaming
                ? html`<span
                    class="tab-streaming-indicator"
                    aria-hidden="true"
                  ></span>`
                : ''}${label}${closable
                ? html`<span
                    class="tab-close"
                    role="button"
                    tabindex="0"
                    aria-label="Close ${label}"
                    title="Close tab"
                    @click=${(e) => {
                      e.stopPropagation();
                      this._onTabClose(tabId);
                    }}
                    @keydown=${(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        this._onTabClose(tabId);
                      }
                    }}
                  >✕</span>`
                : ''}</button>
            `;
          })}
        </div>
        <button
          class="tab-strip-overflow"
          aria-label="Tab list"
          aria-haspopup="menu"
          aria-expanded=${this._tabStripOverflowOpen}
          title="Jump to tab"
          @click=${this._toggleOverflowMenu}
        >⋯</button>
        ${this._tabStripOverflowOpen
          ? this._renderOverflowMenu(tabs)
          : ''}
      </div>
    `;
  }

  /**
   * Render the overflow dropdown menu contents. One
   * item per tab, labelled the same way as the strip
   * button (so users see the same text they'd see
   * without scrolling). Clicking jumps directly.
   */
  _renderOverflowMenu(tabs) {
    return html`
      <div class="tab-strip-overflow-menu" role="menu">
        ${tabs.map((tabId) => {
          const label = this._tabLabels.get(tabId) || tabId;
          const active = tabId === this._activeTabId;
          const tab = this._tabs.get(tabId);
          const streaming = !!(tab && tab.streaming);
          return html`
            <button
              class="tab-strip-overflow-item ${active ? 'active' : ''}"
              role="menuitem"
              data-tab-id=${tabId}
              title=${label}
              aria-busy=${streaming}
              @click=${() => this._onOverflowItemClick(tabId)}
            >${streaming
              ? html`<span
                  class="tab-streaming-indicator"
                  aria-hidden="true"
                ></span>`
              : ''}${label}</button>
          `;
        })}
      </div>
    `;
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
    window.addEventListener('agents-spawned', this._onAgentsSpawned);
    // D2 — chat-tab keyboard shortcuts. Alt+` cycles to the
    // next tab, Alt+Shift+` to the previous. Installed at
    // the document level (bubble phase) so the shortcut
    // works regardless of focus location within the chat
    // panel, but does NOT intercept typing in the textarea
    // — backtick is a normal character and the chat panel
    // itself doesn't consume it. Alt+` is not claimed by
    // the app shell's shortcuts (those own Alt+1..4 and
    // Alt+M).
    //
    // The Alt+1..0 variant suggested in the original
    // agent-browser spec was rejected because app-shell
    // already owns Alt+1..4 for dialog tab switching;
    // changing that is out of scope for D2. Backtick
    // cycling matches the Ctrl+Tab convention used by
    // browsers and IDEs for tab navigation.
    document.addEventListener('keydown', this._onChatTabShortcut);
    // `state-loaded` fires once on connect carrying the
    // full backend state snapshot (from get_current_state).
    // Distinct from `session-changed`, which fires when the
    // active session is explicitly replaced via new_session
    // or load_session_into_context. On startup the backend
    // silently auto-restores the most recent prior session;
    // without this listener the chat panel would show an
    // empty message list even though the backend already
    // has the prior conversation in its context.
    window.addEventListener('state-loaded', this._onStateLoaded);
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
    window.addEventListener('commit-result', this._onCommitResult);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onChatTabShortcut);
    window.removeEventListener('stream-chunk', this._onStreamChunk);
    window.removeEventListener('stream-complete', this._onStreamComplete);
    window.removeEventListener('user-message', this._onUserMessage);
    window.removeEventListener('session-changed', this._onSessionChanged);
    window.removeEventListener('agents-spawned', this._onAgentsSpawned);
    window.removeEventListener('state-loaded', this._onStateLoaded);
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
    window.removeEventListener('commit-result', this._onCommitResult);
    // If the overflow menu was open at unmount, release
    // the document listeners so they don't keep a stale
    // handler alive. Closing via the setter would be
    // cleaner but also touches reactive state on an
    // already-tearing-down component.
    document.removeEventListener(
      'click',
      this._onOverflowOutsideClick,
      true,
    );
    document.removeEventListener(
      'keydown',
      this._onOverflowKeyDown,
      true,
    );
    if (this._rafHandle != null) {
      cancelAnimationFrame(this._rafHandle);
      this._rafHandle = null;
    }
    if (this._fileSearchDebounceTimer != null) {
      clearTimeout(this._fileSearchDebounceTimer);
      this._fileSearchDebounceTimer = null;
    }
    if (this._urlDetectDebounceTimer != null) {
      clearTimeout(this._urlDetectDebounceTimer);
      this._urlDetectDebounceTimer = null;
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
    // Route to the tab that owns this request (D21 A2).
    // Drops unknown request IDs — collaboration broadcasts
    // from other clients don't belong to any of our tabs
    // yet (passive stream adoption is future work).
    const ownerTabId = this._findTabForRequest(requestId);
    if (!ownerTabId) return;
    const ownerTab = this._tabs.get(ownerTabId);
    if (!ownerTab) return;
    // Full-content semantics — overwrite the pending slot,
    // don't append. Each chunk carries a superset of prior
    // content; dropped chunks are harmless.
    const normalizedContent = content ?? '';
    ownerTab.pendingChunks.set(requestId, normalizedContent);
    // Apply synchronously in addition to scheduling the
    // rAF coalesce. The rAF path caps re-render rate at
    // ~60Hz for rapid chunks; the sync path is insurance
    // against rAF starvation (tab backgrounded, chat panel
    // briefly display:none, etc.). Both paths read from
    // the same pendingChunks entry so the rAF either finds
    // it drained (no-op) or re-applies the same value
    // (harmless).
    //
    // Only fire the sync render for chunks matching the
    // tab's CURRENT request — the tab may be between
    // streams and the pending slot should still queue
    // for the rAF, but the `streaming` + `streamingContent`
    // fields are for the currently-active stream only.
    if (
      requestId === ownerTab.currentRequestId
      && ownerTab.streaming
    ) {
      // Writing through the tab object directly. We use
      // requestUpdate only when the OWNER tab is the
      // ACTIVE tab — writing to an inactive tab's state
      // shouldn't force a re-render of the currently
      // visible tab's template.
      ownerTab.streamingContent = normalizedContent;
      if (ownerTabId === this._activeTabId) {
        this.requestUpdate('_streamingContent');
      }
    }
    this._scheduleFlush();
  }

  _onAgentsSpawned(event) {
    // Fired by the backend right after the main LLM's
    // response is parsed and before child agent streams
    // begin. Creates agent tabs immediately so chunks
    // for the child request IDs route to their tabs as
    // they arrive, rather than being dropped while the
    // main stream is still finalizing.
    //
    // Payload: {turn_id, parent_request_id, agent_blocks}
    // where agent_blocks is [{id, task, agent_idx}, ...].
    const detail = event.detail || {};
    const { turn_id, parent_request_id, agent_blocks } = detail;
    if (typeof turn_id !== 'string' || !turn_id) return;
    if (typeof parent_request_id !== 'string') return;
    if (!Array.isArray(agent_blocks)) return;
    if (agent_blocks.length === 0) return;
    this._spawnAgentTabs(turn_id, agent_blocks, parent_request_id);
  }

  _onStreamComplete(event) {
    const { requestId, result } = event.detail || {};
    if (!requestId) return;
    // Route to the owning tab (D21 A2). Unknown request
    // IDs — collab broadcasts from other clients whose
    // streams don't match any tab — are silently dropped.
    const ownerTabId = this._findTabForRequest(requestId);
    if (!ownerTabId) return;
    const ownerTab = this._tabs.get(ownerTabId);
    if (!ownerTab) return;
    const ownerIsActive = ownerTabId === this._activeTabId;

    // Flush any pending chunk synchronously so the final
    // content is reflected before we move it into
    // messages. Operates on the owning tab's
    // pendingChunks.
    const pending = ownerTab.pendingChunks.get(requestId);
    if (pending !== undefined) {
      ownerTab.pendingChunks.delete(requestId);
      if (requestId === ownerTab.currentRequestId) {
        ownerTab.streamingContent = pending;
        if (ownerIsActive) {
          this.requestUpdate('_streamingContent');
        }
      }
    }

    // Move the streaming content into the owning tab's
    // message list as a finalised assistant message. Error
    // responses surface as a dedicated error message rather
    // than assistant content. Attach edit_results so the
    // renderer can pair each edit segment with its backend
    // result (applied / failed / skipped / not_in_context)
    // via matchSegmentsToResults.
    let wasOwnRequest = false;
    if (requestId === ownerTab.currentRequestId) {
      wasOwnRequest = true;
      const finalContent =
        result?.response ?? ownerTab.streamingContent ?? '';
      const error = result?.error;
      const errorInfo = result?.error_info;
      const editResults = Array.isArray(result?.edit_results)
        ? result.edit_results
        : undefined;
      const finishReason = result?.finish_reason || '';
      // Compose the assistant-card error body. When the
      // backend classified the failure (error_info present),
      // prefix the message with a human-readable error-type
      // label so the card is informative even before the
      // user sees the toast. Provider/model metadata appears
      // in a secondary line so "why did this fail" is
      // answerable at a glance. Unclassified errors
      // (error_info absent — e.g., the pre-completion path
      // raised before _run_completion_sync got a chance to
      // stash typed info) fall through to the plain
      // "**Error:** ..." format.
      const errorBody = error
        ? this._formatErrorBody(error, errorInfo)
        : null;
      // Append to the owning tab's messages. requestUpdate
      // fires only when the owner is active — inactive tabs
      // accumulate silently and render when the user
      // switches.
      ownerTab.messages = [
        ...ownerTab.messages,
        error
          ? {
              role: 'assistant',
              content: errorBody,
            }
          : {
              role: 'assistant',
              content: finalContent,
              editResults,
              // Per specs-reference/5-webapp/chat.md §
              // Finish-reason badge labels — every finish
              // reason (including natural `stop` and
              // `end_turn`) produces a badge. Natural
              // reasons render muted; abnormal reasons
              // render in amber/red. We pass the raw
              // reason through to `_renderFinishBadge`
              // which picks the severity. The toast path
              // stays filtered (natural reasons are
              // silent there — see the switch in
              // `_maybeShowFinishReasonToast`).
              ...(finishReason ? { finishReason } : {}),
            },
      ];
      if (ownerIsActive) {
        this.requestUpdate('messages');
      }
      // Surface the classified error as a toast with a
      // type-specific message. Unclassified errors fall
      // through to the generic path inside the toast
      // helper. Toasts are global UI — fire regardless of
      // whether the owning tab is active, so the user sees
      // failures for background agent streams too.
      if (error) {
        this._emitTypedErrorToast(errorInfo, error);
      }
      // Surface non-natural stops as a toast in addition to
      // the in-message badge. The badge is easy to miss if
      // the user has scrolled elsewhere; the toast catches
      // attention even when the assistant card is out of
      // view. Cancelled streams and errors are already
      // surfaced through their own channels (the `[stopped]`
      // marker, the error toast above) — skip the finish-
      // reason toast so we don't double up.
      if (!error && finishReason) {
        this._maybeShowFinishReasonToast(finishReason);
      }
      // Reset streaming state on the owning tab.
      ownerTab.streaming = false;
      ownerTab.streamingContent = '';
      ownerTab.currentRequestId = null;
      if (ownerIsActive) {
        this.requestUpdate('_streaming');
      } else {
        // Inactive tab — the active tab's reactive
        // state didn't change, but the tab strip
        // (which reads per-tab `streaming` directly
        // from the Map) needs to re-render so the
        // streaming indicator on this tab's button
        // disappears. Request a plain update with no
        // property name — Lit re-evaluates the whole
        // template which picks up the indicator
        // change.
        this.requestUpdate();
      }
      // Remember the completed request ID so post-completion
      // events (compaction, URL fetches whose callbacks arrived
      // late) can still be routed to this conversation. Kept
      // as a separate field so it outlives the current-request
      // reset above. Overwritten by each new stream-complete
      // the tab owns.
      ownerTab.lastRequestId = requestId;

      // C2a — spawn agent tabs for each valid agent block the
      // backend surfaced in this turn. The backend's
      // _build_completion_result populates result.agent_blocks
      // with {id, task, agent_idx} entries (empty array for
      // turns without agent blocks). Each spawned tab's state
      // is seeded with the task as the initial user message
      // so when the user switches to it they see why it
      // exists.
      //
      // Only fires for MAIN-tab completions — agent tabs
      // themselves can't spawn child agents (tree depth is
      // 1 per specs4/7-future/parallel-agents.md § Execution
      // Model), and the backend's _is_child_request gate
      // already prevents their responses from producing
      // actual spawns. Filter here too so a stale agent
      // response carrying agent blocks doesn't produce
      // ghost tabs on the frontend.
      //
      // Error and cancelled completions still carry
      // agent_blocks (the backend's result builder populates
      // the field regardless of the apply gate), but we
      // skip spawn on those paths — the backend doesn't
      // actually fan out agents for cancelled/errored
      // turns, so opening tabs would be misleading.
      if (
        ownerTabId === 'main'
        && !result.error
        && !result.cancelled
        && typeof result.turn_id === 'string'
        && Array.isArray(result.agent_blocks)
        && result.agent_blocks.length > 0
      ) {
        this._spawnAgentTabs(
          result.turn_id,
          result.agent_blocks,
          requestId,
        );
      }
    }

    ownerTab.streams.delete(requestId);

    // After finalising, check whether the response warrants
    // a retry prompt. Only fires for our own requests —
    // passive streams from collaborators don't get retry
    // prompts in our textarea. If a prompt IS populated,
    // the textarea is focused so the user can review and
    // send immediately.
    //
    // _maybePopulateRetryPrompt writes through the active-
    // tab accessors (`this._input`, etc.). In single-tab
    // operation (A2 scope) the owning tab IS the active
    // tab, so the behaviour is identical. A future commit
    // when multiple tabs exist will thread the tab ID
    // through so retry prompts land in the owning tab's
    // input regardless of which tab is currently active.
    if (wasOwnRequest && ownerIsActive && result && !result.error) {
      this._maybePopulateRetryPrompt(result);
    }
  }

  /**
   * C2a — create agent tab state for each valid block.
   *
   * Called from ``_onStreamComplete`` when the main-tab
   * result carries ``turn_id`` + one or more agent blocks.
   * Creates a ``_tabs`` entry and a ``_tabLabels`` entry
   * per block. Does NOT switch to any of the new tabs —
   * the user's focus stays on the main tab where the
   * assistant message (including the spawn blocks rendered
   * as prose) has just landed. They can click into any
   * agent tab via the strip or the overflow menu.
   *
   * Tab ID shape: ``{turn_id}/agent-{NN:02d}`` — matches the
   * backend's archive directory convention and the child
   * request ID format. Parsing the tab ID back into
   * ``[turn_id, agent_idx]`` produces the exact tuple the
   * backend's ``agent_tag`` kwarg expects (C1c) and the
   * exact ``(turn_id, agent_idx)`` pair
   * ``close_agent_context`` takes (C1b).
   *
   * Label derivation: :func:`deriveAgentTabLabel` produces
   * ``Agent {NN}`` for tasks without text and ``Agent {NN}:
   * {first line}`` otherwise, truncated to fit the strip.
   * Pre-C.0 code treated this as an ad-hoc string
   * concatenation; pinning it to the helper means future
   * label shape changes land in one place.
   *
   * Tab state seeding: the agent's initial user message is
   * the task text. Users switching to an agent tab should
   * see what the main LLM asked it to do without having to
   * scroll through the archive — the task IS the prompt.
   * The selection list starts as a copy of the main tab's
   * selection so the agent inherits context per the
   * parallel-agents spec's "selected_files is a deep copy
   * of the parent's" invariant. Backend already deep-copies
   * server-side; the frontend copy here is the per-tab
   * picker state. Subsequent user actions in the agent tab
   * drive both (server via
   * :meth:`LLMService.set_agent_selected_files`, client via
   * picker state swap on tab activation).
   *
   * Idempotent: if a tab for the same ``{turn_id, agent_idx}``
   * already exists (duplicate stream-complete for the same
   * turn — defensive, shouldn't happen in practice), the
   * existing tab is preserved. Creating fresh state would
   * wipe any messages the user had already seen in that
   * tab.
   *
   * Request update so the strip renders. The tab strip's
   * render gate (``_tabs.size > 1``) flips from hidden to
   * visible on the first spawn, so this call is load-
   * bearing.
   *
   * @param {string} turnId — the backend's turn_id, shared
   *   across all agent tabs from this turn
   * @param {Array<object>} agentBlocks — validated block
   *   entries with {id, task, agent_idx}
   * @param {string} [parentRequestId] — the main LLM's
   *   request ID. The backend streams each agent on child
   *   request IDs of the form `{parent}-agent-{NN:02d}`;
   *   we seed each new tab's `currentRequestId` + flip
   *   its `streaming` flag so `_findTabForRequest` routes
   *   the child's chunks to the correct tab. Optional for
   *   backwards compatibility; when absent, tabs spawn
   *   without streaming state and chunk routing silently
   *   drops every child chunk.
   */
  _spawnAgentTabs(turnId, agentBlocks, parentRequestId) {
    if (typeof turnId !== 'string' || !turnId) return;
    if (!Array.isArray(agentBlocks)) return;
    let anySpawned = false;
    // Snapshot of the main tab's selection. Each new agent
    // tab gets its own copy so mutations on one don't leak
    // into another. Reading from _tabs directly (not via
    // the `selectedFiles` getter) because the getter would
    // return the ACTIVE tab's list — which is main here,
    // but being explicit about the read keeps the spawn
    // path robust against future changes to the getter.
    const mainTab = this._tabs.get('main');
    const mainSelection = Array.isArray(mainTab?.selectedFiles)
      ? [...mainTab.selectedFiles]
      : [];
    for (const block of agentBlocks) {
      if (!block || typeof block !== 'object') continue;
      const agentIdx = block.agent_idx;
      if (typeof agentIdx !== 'number' || agentIdx < 0) continue;
      const task = typeof block.task === 'string' ? block.task : '';
      // Tab ID — zero-padded to 2 digits for stable sort
      // order in the strip (agent-02 < agent-10) and to
      // match the backend's archive path convention.
      const paddedIdx = String(Math.floor(agentIdx)).padStart(2, '0');
      const tabId = `${turnId}/agent-${paddedIdx}`;
      // Idempotent — existing tab wins.
      if (this._tabs.has(tabId)) continue;
      // Fresh tab state with the task seeded as the initial
      // user message. The agent's own conversation starts
      // with this message server-side (the backend's spawn
      // path calls `_agent_stream_impl` with the task as
      // the message argument), so the tab's visible history
      // matches what the backend archives.
      const state = this._makeTabState();
      state.messages = [
        { role: 'user', content: task },
      ];
      state.selectedFiles = [...mainSelection];
      // Route child stream chunks to this tab. The
      // backend's child request ID format is
      // `{parent}-agent-{NN:02d}`, matching the backend
      // _spawn_agents_for_turn path. `_findTabForRequest`
      // uses exact-match on currentRequestId, so we must
      // install the FULL child ID (not just the parent).
      if (typeof parentRequestId === 'string' && parentRequestId) {
        const childId = (
          `${parentRequestId}-agent-${paddedIdx}`
        );
        state.currentRequestId = childId;
        state.streaming = true;
      }
      this._tabs.set(tabId, state);
      this._tabLabels.set(
        tabId, deriveAgentTabLabel(agentIdx, task),
      );
      anySpawned = true;
    }
    if (anySpawned) {
      // Force a re-render so the tab strip appears.
      // `_tabs` is a Map mutation (not a reactive property
      // assignment) so Lit doesn't observe the change
      // automatically.
      this.requestUpdate();
    }
  }

  /**
   * Format the assistant-card body for an error result.
   *
   * When `errorInfo` is present, prefix the message with a
   * human-readable label (e.g. "Rate limit exceeded") and
   * append a secondary line carrying provider and model
   * metadata. The user's first view of the failure is the
   * assistant card; a one-line "**Error:** 400 Bad
   * Request" is useless for diagnosis when the real cause
   * is "Claude context window exceeded via Bedrock for
   * claude-sonnet-4-5". The labels give operators and
   * users enough to act without hunting through logs.
   *
   * Unclassified errors (backend never reached
   * `_run_completion_sync` so `_last_error_info` was
   * never set) fall through to the legacy plain format.
   *
   * @param {string} error — the raw error string from
   *   `result.error`
   * @param {object | undefined} errorInfo — structured
   *   classification from `result.error_info`, absent on
   *   early-exit error paths
   * @returns {string} — markdown-ready error body
   */
  _formatErrorBody(error, errorInfo) {
    if (!errorInfo || typeof errorInfo !== 'object') {
      return `**Error:** ${error}`;
    }
    const label = this._errorTypeLabel(errorInfo.error_type);
    const parts = [`**Error:** ${label}`];
    // Provider message goes on its own line so long
    // tracebacks don't collide with the label. Fall back
    // to the raw error string if the classifier didn't
    // capture a message (shouldn't happen — it defaults
    // to str(exc) — but defensive).
    const msg = errorInfo.message || error;
    if (msg) parts.push(msg);
    // Metadata line — provider and model when known.
    // Skipped when both are null (self-hosted or local
    // models often don't report these) to avoid a noisy
    // "via  for " rendering.
    const provider = errorInfo.provider;
    const model = errorInfo.model;
    if (provider || model) {
      const metaParts = [];
      if (provider) metaParts.push(`provider: ${provider}`);
      if (model) metaParts.push(`model: ${model}`);
      parts.push(`*(${metaParts.join(', ')})*`);
    }
    return parts.join('\n\n');
  }

  /**
   * Human-readable label for each classified error type.
   *
   * Kept separate from the toast dispatcher because both
   * the assistant card and the toast consume these, and
   * keeping one source of truth avoids drift. Unknown
   * types fall back to "LLM error" — the toast and card
   * both surface the raw provider message alongside, so
   * the user still sees what went wrong even when the
   * classifier didn't recognise the specific failure.
   */
  _errorTypeLabel(errorType) {
    switch (errorType) {
      case 'context_window_exceeded':
        return 'Context window exceeded';
      case 'rate_limit':
        return 'Rate limit exceeded';
      case 'authentication':
        return 'Authentication failed';
      case 'not_found':
        return 'Model not found';
      case 'bad_request':
        return 'Invalid request';
      case 'api_connection':
        return 'Connection failed';
      case 'service_unavailable':
        return 'Service unavailable';
      case 'timeout':
        return 'Request timed out';
      default:
        return 'LLM error';
    }
  }

  /**
   * Emit a toast for a classified LLM error. The backend's
   * `_classify_litellm_error` maps LiteLLM exception types
   * to nine distinct `error_type` values; this dispatcher
   * picks the right icon, message, and severity for each.
   *
   * Per-type UX rationale (mirrors the intended behaviour
   * pinned in the backend's `_classify_litellm_error`
   * docstring):
   *
   *   - `context_window_exceeded` → error toast with
   *     compaction hint. Actionable: compact or drop
   *     files.
   *   - `rate_limit` → warning toast with Retry-After
   *     countdown when the header was populated. Users
   *     learn how long to wait without guessing.
   *   - `authentication` → error toast pointing at LLM
   *     config.
   *   - `not_found` → error toast naming the model so
   *     the user can verify the config entry.
   *   - `bad_request` → error toast with raw provider
   *     message (schema mismatch — not actionable by
   *     the user, but the message goes to the bug
   *     report).
   *   - `api_connection` → warning (network/proxy, often
   *     transient).
   *   - `service_unavailable` → warning (provider
   *     outage, retry later).
   *   - `timeout` → warning.
   *   - `llm_error` / missing info → error toast with the
   *     fallback message, same as the legacy uncategorised
   *     path.
   *
   * The toast is in addition to the assistant-card error
   * body, not a replacement — the card is the
   * persistent record, the toast is the transient
   * attention-getter. Users who scrolled away during
   * the stream would otherwise miss the failure.
   */
  _emitTypedErrorToast(errorInfo, fallbackMessage) {
    // No info → legacy path. Preserves behaviour for
    // early-exit errors (pre-_run_completion_sync crashes
    // in _sync_file_context, _build_tiered_content, etc.)
    // and for any future error shape the backend ships
    // before we update this dispatcher.
    if (!errorInfo || typeof errorInfo !== 'object') {
      this._emitToast(
        `❌ ${fallbackMessage || 'LLM error'}`,
        'error',
      );
      return;
    }
    const errorType = errorInfo.error_type;
    const providerMsg = errorInfo.message || fallbackMessage || '';
    let icon;
    let label;
    let type;
    switch (errorType) {
      case 'context_window_exceeded':
        icon = '📏';
        label = 'Context too large — compact or remove files';
        type = 'error';
        break;
      case 'rate_limit': {
        icon = '⏱️';
        type = 'warning';
        // Retry-After is float seconds when the provider
        // populated the header. Render as "retry in N s"
        // or "retry in N min" so the user knows roughly
        // when to try again. Absent header → generic
        // label.
        const retryAfter = errorInfo.retry_after;
        if (typeof retryAfter === 'number' && retryAfter > 0) {
          const seconds = Math.round(retryAfter);
          const when =
            seconds >= 60
              ? `${Math.round(seconds / 60)} min`
              : `${seconds} s`;
          label = `Rate limited — retry in ${when}`;
        } else {
          label = 'Rate limited — wait and retry';
        }
        break;
      }
      case 'authentication':
        icon = '🔑';
        label = 'Authentication failed — check LLM config';
        type = 'error';
        break;
      case 'not_found': {
        icon = '❓';
        type = 'error';
        // Name the model when available so the user
        // knows which entry in LLM config to fix.
        const model = errorInfo.model;
        label = model
          ? `Model not found: ${model}`
          : 'Model not found — check LLM config';
        break;
      }
      case 'bad_request':
        icon = '⚠️';
        // Raw message surfaces a provider schema
        // complaint the user can paste into a bug report.
        label = `Invalid request: ${providerMsg}`;
        type = 'error';
        break;
      case 'api_connection':
        icon = '🌐';
        label = 'Connection failed — check network / proxy';
        type = 'warning';
        break;
      case 'service_unavailable':
        icon = '🔧';
        label = 'Provider unavailable — retry later';
        type = 'warning';
        break;
      case 'timeout':
        icon = '⏱️';
        label = 'Request timed out';
        type = 'warning';
        break;
      default:
        // Includes 'llm_error' and any future backend
        // classifications we haven't learned about.
        icon = '❌';
        label = providerMsg || 'LLM error';
        type = 'error';
        break;
    }
    this._emitToast(`${icon} ${label}`, type);
  }

  /**
   * Emit a toast for non-natural finish reasons. Natural
   * stops (`stop`, `end_turn`) produce nothing — the
   * caller has already filtered them out before calling
   * us, but we double-check defensively.
   *
   * Per specs-reference/3-llm/streaming.md § Finish
   * Reason — `length` and `content_filter` are `error`
   * severity ("response incomplete"); `tool_calls` /
   * `function_call` are `warning` (the provider wanted
   * something we don't support yet, but the response
   * itself isn't broken); anything else is `warning` with
   * the raw reason surfaced.
   *
   * The `ac-toast` event is the shell's toast channel —
   * see app-shell.js for the listener. Dispatching here
   * rather than via a direct method call keeps the chat
   * panel decoupled from the shell.
   */
  _maybeShowFinishReasonToast(reason) {
    if (!reason || reason === 'stop' || reason === 'end_turn') {
      return;
    }
    let message;
    let type = 'warning';
    switch (reason) {
      case 'length':
        message = '⚠️ Response truncated — hit max_tokens';
        type = 'error';
        break;
      case 'content_filter':
        message = '⚠️ Response blocked by content filter';
        type = 'error';
        break;
      case 'tool_calls':
      case 'function_call':
        message = `⚠️ Model requested a ${reason} (not supported)`;
        break;
      default:
        message = `⚠️ Stopped: ${reason}`;
        break;
    }
    this._emitToast(message, type);
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
    // Clear URL chips — a new session starts fresh. The
    // backend's URL service session state is cleared
    // server-side on new_session via URLService.clear_fetched;
    // we mirror that on the client. Also wipe per-tab
    // snapshots so switching back to a tab that had
    // chips from a prior session doesn't resurrect
    // them.
    const chipsEl = this.shadowRoot?.querySelector('ac-url-chips');
    if (chipsEl) chipsEl.reset();
    for (const tab of this._tabs.values()) {
      tab.urlChips = null;
    }
  }

  /**
   * Handle the `state-loaded` event dispatched by AppShell
   * after `get_current_state` returns on startup / reconnect.
   *
   * The backend auto-restores the most recent prior session
   * when it boots, so `get_current_state` includes the
   * restored message list. Without consuming this event, the
   * chat panel would render empty even though the backend's
   * context already has the prior conversation loaded — any
   * new message would be appended to that history from the
   * backend's perspective, but the user would see only their
   * own new turn.
   *
   * Shape mirrors `_onSessionChanged` — the snapshot carries
   * messages in the same format. We replace the local list
   * rather than merging; the backend's state is
   * authoritative.
   *
   * Guarded against wiping an in-flight stream: if the user
   * reconnects mid-stream (rare but possible), we skip the
   * replace. The stream's own completion will bring the UI
   * back into sync.
   */
  _onStateLoaded(event) {
    if (this._streaming) return;
    const state = event.detail || {};
    const msgs = Array.isArray(state.messages) ? state.messages : [];
    // Only overwrite when we actually have something to
    // restore. An empty snapshot during a fresh-install
    // first-connect shouldn't clobber any optimistic local
    // state (there shouldn't be any, but defensive).
    if (msgs.length === 0 && this.messages.length === 0) return;
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
    // Seed input history so up-arrow recall works for the
    // restored session's prompts on first keystroke.
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
   * Handle the `commit-result` window event dispatched by
   * AppShell when the backend's background commit_all task
   * finishes. The detail is the commit result dict carrying:
   *   - sha / short_sha / message — commit metadata
   *   - system_event_message — pre-formatted markdown text
   *     matching what the server persisted to history
   *   - error — present on failure
   *
   * Two jobs:
   *   1. Flip `_committing` off so the commit button returns
   *      to idle.
   *   2. Append the commit's system event message to the
   *      local `messages` array so the user sees it in the
   *      chat. The server already persisted the same text
   *      to the history store, so a subsequent session
   *      reload picks it up too — this handler is what
   *      makes it appear in the current session's UI
   *      without waiting for a reload.
   *
   * Per specs-reference/5-webapp/chat.md § System Event
   * Messages — commit events render as role=user with
   * system_event=true, distinct styling.
   *
   * Server broadcasts `commitResult` to all connected
   * clients (not just the initiator), so every client
   * appends exactly once per commit. Unlike `userMessage`,
   * there's no dedupe needed — commits don't stream and
   * there's no optimistic local-add on the initiator.
   */
  _onCommitResult(event) {
    this._committing = false;
    const detail = event?.detail;
    if (!detail || typeof detail !== 'object') return;
    // Error path — don't append a message; the shell has
    // already surfaced a toast. The frontend error state
    // stops here.
    if (detail.error) return;
    const text = detail.system_event_message;
    if (typeof text !== 'string' || !text) return;
    this.messages = [
      ...this.messages,
      { role: 'user', content: text, system_event: true },
    ];
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
      // Drain pending chunks across every tab. Each
      // entry in pendingChunks is keyed by request ID;
      // we look up the owning tab and write the chunk
      // to its streamingContent. Only the active tab's
      // update triggers a Lit re-render — inactive tabs
      // accumulate state silently and render when the
      // user switches to them.
      let activeChanged = false;
      for (const tab of this._tabs.values()) {
        if (tab.pendingChunks.size === 0) continue;
        for (const [requestId, content] of tab.pendingChunks) {
          if (requestId !== tab.currentRequestId) continue;
          tab.pendingChunks.delete(requestId);
          tab.streamingContent = content;
          if (tab === this._tabs.get(this._activeTabId)) {
            activeChanged = true;
          }
        }
      }
      if (activeChanged) {
        this.requestUpdate('_streamingContent');
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

    // Auto-exit file search mode on send — the user is
    // now composing a message, not scanning results.
    // Matches specs4/5-webapp/search.md.
    if (this._searchMode === 'file') {
      this._setSearchMode('message');
    }

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
    // Clear detected / fetching URL chips per specs4 —
    // fetched and errored chips survive because they
    // represent work the user already committed to.
    const chipsEl = this.shadowRoot?.querySelector('ac-url-chips');
    if (chipsEl) chipsEl.clearDetected();

    try {
      // Compute the per-turn URL exclusion set from the chip
      // component. Every fetched chip whose include checkbox is
      // unchecked ends up here. The chip stays visible in the
      // strip — only this turn's prompt omits its content.
      // See specs4/4-features/url-content.md § URL Chips UI.
      const chipsEl = this.shadowRoot?.querySelector('ac-url-chips');
      const excludedUrls = [];
      if (chipsEl && chipsEl._chips) {
        for (const chip of chipsEl._chips.values()) {
          if (chip.status === 'fetched' && chip.excluded) {
            excludedUrls.push(chip.url);
          }
        }
      }
      // agent_tag (6th positional arg) routes the call to
      // the agent's ConversationScope when the active tab
      // is an agent. Null for the main tab — the backend's
      // C1c dispatcher treats null as "use the main
      // conversation" and takes the untagged path through
      // the single-stream guard. Parsed from the active
      // tab ID so the turn_id + agent_idx exactly match
      // the keys in the backend's _agent_contexts registry.
      const agentTag = parseAgentTabId(this._activeTabId);
      const result = await this.rpcExtract(
        'LLMService.chat_streaming',
        requestId,
        text,
        // Passed positionally as the 4th arg to match the
        // backend's `chat_streaming(request_id, message,
        // files=None, images=None, excluded_urls=None,
        // agent_tag=None)` signature. Phase 2c's selected-
        // files list lives on this component as
        // `selectedFiles` (set by the files-tab
        // orchestrator); the per-tab getter routes to the
        // active tab's state so agent tabs send their own
        // selection, not the main tab's.
        Array.isArray(this.selectedFiles)
          ? this.selectedFiles
          : [],
        images,
        excludedUrls,
        agentTag,
      );
      // Response is {status: "started"} on the happy path.
      // Chunks and completion arrive via server-push events.
      //
      // Error responses (synchronous rejections from the
      // backend's chat_streaming) don't become exceptions —
      // they resolve the Promise with an error dict. Handle
      // them here rather than waiting for stream events
      // that will never arrive.
      //
      // Two error shapes we care about:
      //
      // 1. {error: "agent not found"} — C1c's stale-tag
      //    case. The agent_tag pointed at a scope that no
      //    longer exists (closed in a race, session
      //    restarted). The frontend's tab is stale; close
      //    it and switch to main.
      //
      // 2. Anything else — generic errors like "Another
      //    stream is active", "Malformed agent_tag",
      //    restricted-caller. Surface as an assistant-
      //    slot error message so the user sees why the
      //    stream didn't start, clear streaming state.
      if (result && typeof result === 'object' && result.error) {
        this._handleStreamStartError(
          requestId, result.error, agentTag,
        );
        return;
      }
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
   * Handle a synchronous error response from
   * ``chat_streaming``. The backend resolves the
   * Promise with an error dict (not a rejection) for
   * gate failures — stale agent_tag, duplicate
   * stream, restricted caller, malformed payload.
   *
   * Two distinct UX paths:
   *
   * 1. ``agent not found`` — stale agent tab. The
   *    scope was closed server-side between tab
   *    creation and send (close_agent_context raced
   *    with send, or session restarted). Close the
   *    tab locally, switch to main, toast the user.
   *    The tab's message the user just typed is
   *    lost — acceptable because the scope itself
   *    is gone and typing into a ghost tab is the
   *    real bug.
   *
   * 2. Everything else — append an error message to
   *    the current tab's message list so the user
   *    sees why the stream didn't start. Clear
   *    streaming state, keep the tab open. User can
   *    retry.
   *
   * Both paths clear request tracking (current/last
   * IDs, streams map) so stream events that somehow
   * arrive for the failed request are dropped.
   *
   * @param {string} requestId — the request ID
   *   registered at send time
   * @param {string} errorMsg — the `error` field
   *   from the backend response
   * @param {[string, number] | null} agentTag —
   *   parsed agent tag, null for main-tab sends
   */
  _handleStreamStartError(requestId, errorMsg, agentTag) {
    // Always clear request tracking first — the
    // stream isn't happening, so don't leave the
    // guard slot held or any stale request-ID refs.
    this._streaming = false;
    this._streamingContent = '';
    this._currentRequestId = null;
    this._streams.delete(requestId);

    // Stale agent tab — C1c returns "agent not found"
    // for this case. Close the tab, switch to main,
    // toast. The tab ID we're closing is the ACTIVE
    // one (we just used it to build agent_tag).
    const isStaleAgent =
      errorMsg === 'agent not found' && agentTag !== null;
    if (isStaleAgent) {
      const staleTabId = this._activeTabId;
      // Remove the optimistic user message we added
      // before sending — the scope is gone, so the
      // message never landed anywhere useful.
      if (
        this.messages.length > 0
        && this.messages[this.messages.length - 1].role === 'user'
      ) {
        this.messages = this.messages.slice(0, -1);
      }
      // _onTabClose handles the local removal,
      // active-tab switch, close-tab event dispatch,
      // AND the follow-up close_agent_context RPC.
      // The latter is now idempotent-or-noop
      // (backend returns closed:false for unknown
      // agents), so firing it again for an already-
      // closed agent is safe.
      this._onTabClose(staleTabId);
      this._emitToast(
        'Agent tab closed — scope was no longer available',
        'warning',
      );
      return;
    }

    // Generic error path. Append as an assistant
    // message so it renders inline with the failed
    // user message. Keeps the tab open for retry.
    this.messages = [
      ...this.messages,
      {
        role: 'assistant',
        content: `**Error:** ${errorMsg}`,
      },
    ];
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
   * The ordering matches specs-reference/3-llm/edit-protocol.md —
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
   * Opening the browser itself is read-only — the user
   * can scan past sessions while waiting for a stream to
   * complete. The actual load action (inside the modal)
   * is gated separately on rpc-connected state, and
   * sessionChanged during an in-flight stream is rare
   * enough that the user accepting that risk is fine.
   */
  _onOpenHistory() {
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
    // @-filter detection. Runs after every input event —
    // we check whether the cursor is inside an @word
    // sequence and dispatch edge-triggered
    // `filter-from-chat` events so the files-tab can
    // forward to the picker's setFilter.
    this._updateMentionFilter(ta);
    // URL detection debounce. Defer the detect_urls RPC
    // until the user stops typing so rapid keystrokes
    // don't thrash the server. Empty input cancels any
    // pending scan and leaves fetched chips intact.
    this._scheduleUrlDetection();
  }

  /**
   * Detect an active @mention at the cursor position and
   * dispatch `filter-from-chat` when the mention state
   * changes. Edge-triggered:
   *
   *   - Entering a mention (no prior → has mention):
   *     emit event with the query.
   *   - Mention query changed (has mention → different
   *     mention range): emit with new query.
   *   - Exiting a mention (had mention → no mention):
   *     emit empty query to clear the filter.
   *
   * A mention is an `@` followed by zero or more
   * non-whitespace characters, with the cursor INSIDE
   * the sequence. The `@` must be at a word boundary —
   * preceded by whitespace OR start-of-string, not
   * preceded by another word character. This is the
   * rule that keeps `foo@bar` from being treated as
   * a mention.
   */
  _updateMentionFilter(ta) {
    const value = ta.value;
    const cursor = ta.selectionStart;
    const mention = this._detectActiveMention(value, cursor);
    // Compare against prior state to decide whether to
    // emit. Same range and same query → no-op. Different
    // → emit.
    if (mention === null && this._activeMention === null) {
      return;
    }
    if (
      mention !== null &&
      this._activeMention !== null &&
      mention.start === this._activeMention.start &&
      mention.end === this._activeMention.end &&
      mention.query === this._activeMention.query
    ) {
      return;
    }
    // State changed. Store the new state and emit.
    this._activeMention = mention;
    const query = mention === null ? '' : mention.query;
    this.dispatchEvent(
      new CustomEvent('filter-from-chat', {
        detail: { query },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Schedule a debounced URL detection scan. 300ms matches
   * the file-search debounce and is long enough to avoid
   * thrashing on fast typing, short enough to feel
   * responsive when the user pauses.
   *
   * An empty input cancels the pending timer and leaves the
   * chip strip's existing state (fetched chips survive).
   * Detection is idempotent — the chip component's
   * updateDetected merges with existing state rather than
   * replacing.
   */
  _scheduleUrlDetection() {
    if (this._urlDetectDebounceTimer != null) {
      clearTimeout(this._urlDetectDebounceTimer);
      this._urlDetectDebounceTimer = null;
    }
    const text = this._input;
    if (typeof text !== 'string' || !text.trim()) {
      // Empty input — let the chip component drop any
      // lingering detected entries. Pass an empty array
      // rather than skipping so the "no longer in input"
      // pruning rule fires.
      this.updateComplete.then(() => {
        const chips = this.shadowRoot?.querySelector('ac-url-chips');
        if (chips) chips.updateDetected([]);
      });
      return;
    }
    this._urlDetectDebounceTimer = setTimeout(() => {
      this._urlDetectDebounceTimer = null;
      this._runUrlDetection(text);
    }, 300);
  }

  /**
   * Call LLMService.detect_urls and feed the results to the
   * chip component. Guards against stale responses via the
   * generation counter — the user may have typed more since
   * the RPC was issued, and an earlier response arriving
   * after a later one would roll back detected state.
   *
   * Silently no-ops when RPC isn't connected — detection is
   * a best-effort enhancement, not critical path.
   */
  async _runUrlDetection(text) {
    if (!this.rpcConnected) return;
    const gen = ++this._urlDetectGeneration;
    let detected;
    try {
      detected = await this.rpcExtract('LLMService.detect_urls', text);
    } catch (err) {
      // Silent failure — detection retries on the next
      // keystroke. Don't toast; this would be noisy for a
      // feature the user didn't explicitly invoke.
      console.debug('[chat] detect_urls failed', err);
      return;
    }
    if (gen !== this._urlDetectGeneration) return;
    const chips = this.shadowRoot?.querySelector('ac-url-chips');
    if (!chips) return;
    chips.updateDetected(Array.isArray(detected) ? detected : []);
  }

  /**
   * Handle the chip component's `url-fetch-requested` event.
   * Fires the fetch_url RPC and transitions the chip through
   * fetching → fetched/errored states based on the result.
   *
   * The backend's URLContent carries a (possibly empty)
   * `error` field; an error record still fetches successfully
   * but should render as an errored chip, not a fetched one.
   * This distinguishes "HTTP 404" (errored chip, user can
   * retry or dismiss) from "network failure" (RPC rejected,
   * we toast).
   */
  async _onUrlFetchRequested(event) {
    // TODO(url-fetch-cross-tab): this closure captures
    // the singleton chips element, not the originating
    // tab. Mid-fetch tab switches land the result on
    // the wrong tab. See IMPLEMENTATION_NOTES.md §
    // "Known bugs — per-tab state".
    const url = event.detail?.url;
    if (typeof url !== 'string' || !url) return;
    if (!this.rpcConnected) {
      this._emitToast('Not connected — cannot fetch', 'warning');
      return;
    }
    const chips = this.shadowRoot?.querySelector('ac-url-chips');
    if (!chips) return;
    chips.markFetching(url);
    let result;
    try {
      // Positional args per LLMService.fetch_url signature:
      // (url, use_cache=True, summarize=True, user_text=None).
      // We default to cache + summarize — matches the
      // streaming handler's own fetch path.
      result = await this.rpcExtract(
        'LLMService.fetch_url', url, true, true,
      );
    } catch (err) {
      console.error('[chat] fetch_url failed', err);
      chips.markErrored(url, err?.message || 'Network error');
      this._emitToast(
        `Fetch failed: ${err?.message || 'unknown error'}`,
        'error',
      );
      return;
    }
    if (result && typeof result === 'object' && result.error) {
      // Restricted-caller shape in collab mode. Treat as
      // errored chip so the user sees why the fetch didn't
      // happen; also toast since this may not be obvious.
      if (result.error === 'restricted') {
        chips.markErrored(url, 'Not allowed');
        this._emitToast(
          result.reason || 'Restricted operation',
          'warning',
        );
        return;
      }
      // The URLContent payload itself may carry an error
      // (HTTP 404, clone failure, etc.). render as an
      // errored chip.
      chips.markErrored(url, result.error);
      return;
    }
    chips.markFetched(url, result);
  }

  /**
   * Handle `url-remove-requested`. Two responsibilities:
   *
   *   1. Tell the backend to drop the URL from its
   *      in-memory fetched dict (remove_fetched_url).
   *      Cache stays intact so a later re-fetch hits it.
   *   2. Remove the chip from the local component.
   *
   * Fetched and errored chips need the RPC call; detected
   * chips haven't been fetched yet so the backend has
   * nothing to clean up. We call remove_fetched_url
   * unconditionally — the backend returns `removed: false`
   * for unknown URLs, which is a safe idempotent no-op.
   */
  async _onUrlRemoveRequested(event) {
    const url = event.detail?.url;
    if (typeof url !== 'string' || !url) return;
    const chips = this.shadowRoot?.querySelector('ac-url-chips');
    if (!chips) return;
    // Optimistic local remove — responsiveness first, the
    // RPC follows. If the RPC rejects we log but don't
    // restore the chip; the user clicked remove and expects
    // it to stay gone.
    chips.remove(url);
    if (!this.rpcConnected) return;
    try {
      await this.rpcExtract('LLMService.remove_fetched_url', url);
    } catch (err) {
      console.debug('[chat] remove_fetched_url failed', err);
    }
  }

  /**
   * Handle `url-view-requested`. Opens the content dialog
   * with the chip's cached URLContent payload. The payload
   * was stored when the chip transitioned to fetched, so
   * no additional RPC is needed for the common case.
   *
   * If the chip's content is missing (edge case — e.g. the
   * chip was restored from a future persistence layer
   * without the payload), fall back to get_url_content.
   */
  async _onUrlViewRequested(event) {
    const url = event.detail?.url;
    if (typeof url !== 'string' || !url) return;
    const chips = this.shadowRoot?.querySelector('ac-url-chips');
    if (!chips) return;
    const chip = chips._chips?.get(url);
    let content = chip?.content;
    if (!content && this.rpcConnected) {
      try {
        content = await this.rpcExtract(
          'LLMService.get_url_content', url,
        );
      } catch (err) {
        this._emitToast(
          `View failed: ${err?.message || 'unknown error'}`,
          'error',
        );
        return;
      }
    }
    if (!content) return;
    this._urlViewDialog = { url, content };
    this._urlViewTab = 'content';
  }

  _closeUrlViewDialog() {
    this._urlViewDialog = null;
  }

  _onUrlViewKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this._closeUrlViewDialog();
    }
  }

  /**
   * Walk backward from the cursor to find an active
   * @mention. Returns `{start, end, query}` or null.
   *
   *   - `start` is the index of the `@` character
   *   - `end` is the cursor position (exclusive end of
   *     the mention)
   *   - `query` is the substring `value[start+1..end]`
   *     — the filter pattern without the leading `@`
   *
   * Returns null when:
   *   - No `@` found before cursor at word boundary
   *   - Whitespace between the `@` and cursor (mention
   *     terminated)
   *   - `@` is preceded by a non-boundary character
   *     (word char like letter, digit, or underscore)
   */
  _detectActiveMention(value, cursor) {
    // Walk backward from cursor looking for @ or
    // whitespace. Whitespace terminates the scan — no
    // mention if we hit whitespace before @.
    for (let i = cursor - 1; i >= 0; i -= 1) {
      const ch = value[i];
      if (/\s/.test(ch)) {
        // Hit whitespace before @ — no active mention.
        return null;
      }
      if (ch === '@') {
        // Check the boundary rule — the char before @
        // must be whitespace or start-of-string, not a
        // word character. This blocks `foo@bar` from
        // matching.
        const before = i > 0 ? value[i - 1] : '';
        if (before !== '' && !/\s/.test(before)) {
          // @ is embedded in a word (e.g. email-like).
          // Not a mention.
          return null;
        }
        // Found a valid @word mention.
        return {
          start: i,
          end: cursor,
          query: value.slice(i + 1, cursor),
        };
      }
    }
    // Walked to start-of-string without finding @.
    return null;
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
    // Check the one-shot suppression flag first —
    // set by the files-tab's middle-click-insert flow
    // to block the Linux selection-buffer auto-paste
    // that follows the focus() call. The flag clears
    // on the same event, so a subsequent user paste
    // (Ctrl+V or right-click → paste) flows through
    // normally.
    if (this._suppressNextPaste) {
      this._suppressNextPaste = false;
      event.preventDefault();
      return;
    }
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
   * Insert a transcribed speech segment at the
   * textarea's cursor position. Adds space separators
   * when adjacent text is non-whitespace so successive
   * utterances don't jam together ("helloworld") and
   * so dictation mid-sentence inserts cleanly.
   *
   * Per specs4/5-webapp/speech.md — existing input is
   * preserved (never overwritten); cursor ends up
   * after the inserted text so the next utterance
   * continues naturally.
   */
  _onTranscript(event) {
    const text = event.detail?.text;
    if (typeof text !== 'string' || !text) return;
    const ta = this.shadowRoot?.querySelector('.input-textarea');
    if (!ta) {
      this._input = `${this._input}${text}`;
      return;
    }
    const before = ta.value.slice(0, ta.selectionStart);
    const after = ta.value.slice(ta.selectionEnd);
    // Auto-space: prepend a space if the char before the
    // cursor is non-whitespace, append one if the char
    // after is non-whitespace. Mid-word dictation ("I am
    // goinghome") would otherwise be a garden-path
    // parse problem for the reader.
    const prefix =
      before.length > 0 && !/\s$/.test(before) ? ' ' : '';
    const suffix =
      after.length > 0 && !/^\s/.test(after) ? ' ' : '';
    const insertion = `${prefix}${text}${suffix}`;
    const next = `${before}${insertion}${after}`;
    this._input = next;
    ta.value = next;
    const cursor = before.length + insertion.length;
    ta.setSelectionRange(cursor, cursor);
    // Fire input event so auto-resize runs.
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /**
   * Surface a speech recognition error as a toast. The
   * component has already reverted to inactive state by
   * the time this fires.
   */
  _onRecognitionError(event) {
    const errorCode = event.detail?.error || 'unknown';
    // Translate common error codes to user-friendly
    // messages. Unknown codes surface verbatim so
    // unexpected issues are at least diagnosable.
    const messages = {
      'not-allowed': 'Microphone access denied',
      'service-not-allowed': 'Speech service unavailable',
      'audio-capture': 'No microphone detected',
      network: 'Speech recognition network error',
    };
    const message =
      messages[errorCode] || `Speech error: ${errorCode}`;
    this._emitToast(message, 'warning');
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
   * state; match computation happens in render (message
   * mode) or via a debounced RPC (file mode).
   *
   * Message mode — resets the current-match cursor to 0 and
   * scrolls the first match into view on each keystroke
   * (immediate visual confirmation).
   *
   * File mode — schedules a debounced RPC call via
   * `_runFileSearch`. The RPC only fires after the user
   * stops typing for a short interval; stale responses are
   * discarded via a generation counter.
   */
  _onSearchInput(event) {
    this._searchQuery = event.target.value;
    if (this._searchMode === 'file') {
      // File mode — reset focus and debounce the RPC. No
      // immediate UI update beyond clearing the focused
      // match; the next update comes from the RPC response.
      this._fileSearchFocusedIndex = -1;
      this._scheduleFileSearch();
      return;
    }
    // Message mode — existing behaviour.
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
    if (this._searchMode === 'file') {
      // In file mode — re-run the search with the new
      // options. Reset focus since the match set may
      // change.
      this._fileSearchFocusedIndex = -1;
      this._scheduleFileSearch();
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
   * Handle keydown in the search input. In message mode,
   * Enter/Shift+Enter navigate message matches; Escape
   * clears and blurs. In file mode, Enter opens the focused
   * match in the viewer; ↑/↓ navigate matches; Escape
   * clears, then on second press exits file mode.
   *
   * Letter keys fall through to the input's default
   * behaviour — the `_onSearchInput` handler catches the
   * subsequent `input` event.
   */
  _onSearchKeyDown(event) {
    if (this._searchMode === 'file') {
      this._onFileSearchKeyDown(event);
      return;
    }
    // Message mode — existing behaviour.
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

  /**
   * Keyboard handling specific to file-search mode.
   *
   * - Enter → open the focused match in the diff viewer
   *   (via a `navigate-file` window event) and keep the
   *   overlay open so the user can continue scanning
   * - Shift+Enter → previous match
   * - ↑/↓ → navigate matches
   * - Escape → clear query; on second press (empty query),
   *   exit file search mode
   *
   * Letter keys fall through — the subsequent `input`
   * event triggers the debounced RPC.
   */
  _onFileSearchKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) {
        this._onFileSearchPrev();
      } else {
        this._onFileSearchOpenFocused();
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this._onFileSearchNext();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this._onFileSearchPrev();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this._searchQuery) {
        // First press — clear the query, results will
        // clear on the next debounce tick.
        this._searchQuery = '';
        this._fileSearchResults = [];
        this._fileSearchFocusedIndex = -1;
        this._fileSearchLoading = false;
        return;
      }
      // Second press — exit file mode.
      this._setSearchMode('message');
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

  // ---------------------------------------------------------------
  // File search mode
  // ---------------------------------------------------------------

  /**
   * Switch search mode. Resets state specific to the
   * mode being LEFT (message highlights cleared on exit;
   * file results cleared on exit). Dispatches
   * `file-search-changed` so the files-tab orchestrator
   * can swap the picker tree accordingly.
   *
   * Safe to call with the current mode — becomes a no-op
   * (no state change, no event dispatch).
   */
  _setSearchMode(mode) {
    if (mode !== 'message' && mode !== 'file') return;
    if (mode === this._searchMode) return;
    const wasFile = this._searchMode === 'file';
    this._searchMode = mode;
    // Leaving message mode — clear highlight cursor so the
    // settled cards don't show stale borders when the user
    // re-enters later.
    this._searchCurrentIndex = -1;
    // Leaving file mode — clear results and cancel any
    // pending RPC. Entering file mode — results start
    // empty until the first RPC returns.
    this._fileSearchResults = [];
    this._fileSearchFocusedIndex = -1;
    this._fileSearchLoading = false;
    if (this._fileSearchDebounceTimer != null) {
      clearTimeout(this._fileSearchDebounceTimer);
      this._fileSearchDebounceTimer = null;
    }
    // Clear the query on mode switch — otherwise a
    // message-search query would suddenly become a
    // file-search query (or vice versa) with surprising
    // results. Explicit clear keeps the mental model
    // clean.
    this._searchQuery = '';
    // Notify the files-tab. Emits on EVERY mode change so
    // entry triggers a tree swap and exit triggers a
    // restore. Carries the current results (empty) so the
    // files-tab doesn't need to guess.
    this._dispatchFileSearchChanged();
    // Kick off a debounced search if we just entered file
    // mode with a pre-filled query (from
    // activateFileSearch). Normal mode entry has empty
    // query so this is a no-op.
    if (mode === 'file' && this._searchQuery) {
      this._scheduleFileSearch();
    }
  }

  /**
   * Toggle between message and file search modes via
   * the mode button.
   */
  _toggleSearchMode() {
    this._setSearchMode(
      this._searchMode === 'message' ? 'file' : 'message',
    );
    // Focus the search input after the mode switch so the
    // user can start typing immediately. Deferred to the
    // next Lit update so the input element reflects any
    // placeholder/ARIA changes.
    this.updateComplete.then(() => {
      const input = this.shadowRoot?.querySelector(
        '.search-input',
      );
      if (input) input.focus();
    });
  }

  /**
   * Schedule a debounced file-search RPC call. Clears any
   * pending timer. The RPC fires 300ms after the last
   * keystroke (matches specs3's debounce value). Empty
   * queries clear results immediately without a round-trip.
   */
  _scheduleFileSearch() {
    if (this._fileSearchDebounceTimer != null) {
      clearTimeout(this._fileSearchDebounceTimer);
      this._fileSearchDebounceTimer = null;
    }
    const query = this._searchQuery.trim();
    if (!query) {
      // Empty query — clear results immediately. Bump the
      // generation so any in-flight response is discarded
      // when it arrives.
      this._fileSearchGeneration += 1;
      this._fileSearchResults = [];
      this._fileSearchFocusedIndex = -1;
      this._fileSearchLoading = false;
      this._dispatchFileSearchChanged();
      return;
    }
    this._fileSearchDebounceTimer = setTimeout(() => {
      this._fileSearchDebounceTimer = null;
      this._runFileSearch(query);
    }, 300);
  }

  /**
   * Run the file-search RPC. Generation-guarded so a stale
   * response (user typed faster than the server responded)
   * is silently discarded rather than overwriting fresher
   * results.
   *
   * Mode-guarded too — if the user exited file search
   * between the debounce firing and the RPC returning,
   * the response is discarded.
   */
  async _runFileSearch(query) {
    if (!this.rpcConnected) {
      this._fileSearchLoading = false;
      return;
    }
    const gen = ++this._fileSearchGeneration;
    this._fileSearchLoading = true;
    let results;
    try {
      results = await this.rpcExtract(
        'Repo.search_files',
        query,
        this._searchWholeWord,
        this._searchRegex,
        this._searchIgnoreCase,
        // context_lines — single line before and after
        // each match per specs4/5-webapp/search.md.
        1,
      );
    } catch (err) {
      // Stale-gen check first — a later call may have
      // already replaced our future.
      if (gen !== this._fileSearchGeneration) return;
      if (this._searchMode !== 'file') return;
      console.error('[chat] Repo.search_files failed', err);
      this._fileSearchLoading = false;
      this._fileSearchResults = [];
      this._fileSearchFocusedIndex = -1;
      this._emitToast(
        `Search failed: ${err?.message || String(err)}`,
        'error',
      );
      this._dispatchFileSearchChanged();
      return;
    }
    if (gen !== this._fileSearchGeneration) return;
    if (this._searchMode !== 'file') return;
    this._fileSearchLoading = false;
    this._fileSearchResults = Array.isArray(results) ? results : [];
    // Focus the first match when results arrive. Flat
    // match-count-driven index — 0 means first match of
    // first file.
    this._fileSearchFocusedIndex =
      this._totalFileSearchMatches() > 0 ? 0 : -1;
    this._dispatchFileSearchChanged();
  }

  /**
   * Total match count across all files in the current
   * results. Used for counter display and for bounding the
   * focus index on navigation.
   */
  _totalFileSearchMatches() {
    let total = 0;
    for (const r of this._fileSearchResults) {
      if (r && Array.isArray(r.matches)) {
        total += r.matches.length;
      }
    }
    return total;
  }

  /**
   * Map a flat match index to a `{file, match, matchIndex,
   * fileIndex}` structure. `matchIndex` is the position
   * within the file; `fileIndex` is the position of the
   * file in the results array. Returns null when the index
   * is out of range.
   */
  _resolveFileSearchFocus(flatIndex) {
    if (flatIndex < 0) return null;
    let cursor = 0;
    for (let fi = 0; fi < this._fileSearchResults.length; fi += 1) {
      const entry = this._fileSearchResults[fi];
      const matches = Array.isArray(entry?.matches) ? entry.matches : [];
      if (flatIndex < cursor + matches.length) {
        const mi = flatIndex - cursor;
        return {
          file: entry.file,
          match: matches[mi],
          fileIndex: fi,
          matchIndex: mi,
        };
      }
      cursor += matches.length;
    }
    return null;
  }

  _onFileSearchNext() {
    const total = this._totalFileSearchMatches();
    if (total === 0) return;
    this._fileSearchFocusedIndex =
      (Math.max(0, this._fileSearchFocusedIndex) + 1) % total;
    this.updateComplete.then(() =>
      this._scrollFocusedFileSearchMatchIntoView(),
    );
  }

  _onFileSearchPrev() {
    const total = this._totalFileSearchMatches();
    if (total === 0) return;
    const base = Math.max(0, this._fileSearchFocusedIndex);
    this._fileSearchFocusedIndex = (base - 1 + total) % total;
    this.updateComplete.then(() =>
      this._scrollFocusedFileSearchMatchIntoView(),
    );
  }

  _onFileSearchOpenFocused() {
    const target = this._resolveFileSearchFocus(
      this._fileSearchFocusedIndex,
    );
    if (!target) return;
    // Dispatch navigate-file with the line number so the
    // viewer can scroll to the match. specs4/5-webapp's
    // app-shell routes this to the diff viewer.
    window.dispatchEvent(
      new CustomEvent('navigate-file', {
        detail: {
          path: target.file,
          line: target.match?.line_num,
        },
        bubbles: false,
      }),
    );
  }

  /**
   * Scroll the focused match row into view within the
   * overlay. Also dispatches `file-search-scroll` so the
   * files-tab can sync the picker's focused path.
   */
  _scrollFocusedFileSearchMatchIntoView() {
    const target = this._resolveFileSearchFocus(
      this._fileSearchFocusedIndex,
    );
    if (!target) return;
    const row = this.shadowRoot?.querySelector(
      `[data-file-match-flat="${this._fileSearchFocusedIndex}"]`,
    );
    if (row && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    // Sync the picker highlight. Dispatch unconditionally
    // of scroll success — the picker's highlight shouldn't
    // depend on whether scrollIntoView was a no-op.
    this._dispatchFileSearchScroll(target.file);
  }

  _dispatchFileSearchChanged() {
    this.dispatchEvent(
      new CustomEvent('file-search-changed', {
        detail: {
          active: this._searchMode === 'file',
          results: this._fileSearchResults,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _dispatchFileSearchScroll(filePath) {
    this.dispatchEvent(
      new CustomEvent('file-search-scroll', {
        detail: { filePath },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Public entry point for Ctrl+Shift+F from the shell.
   * Switches to file mode (if not already), prefills the
   * query, focuses the search input, and kicks off a
   * debounced RPC call. The prefill typically comes from
   * window.getSelection() captured synchronously at the
   * shell keydown handler (per specs4's Ctrl+Shift+F
   * timing rules).
   *
   * Accepts empty prefill — switches to file mode with an
   * empty query, ready for the user to type.
   */
  activateFileSearch(prefill = '') {
    const query = typeof prefill === 'string' ? prefill.trim() : '';
    if (this._searchMode !== 'file') {
      this._setSearchMode('file');
    }
    // Set query AFTER mode switch (mode switch clears the
    // query). Schedule a search if the query is non-empty.
    if (query) {
      this._searchQuery = query;
      this._scheduleFileSearch();
    }
    this.updateComplete.then(() => {
      const input = this.shadowRoot?.querySelector(
        '.search-input',
      );
      if (input) input.focus();
    });
  }

  /**
   * Public entry point for picker clicks during file
   * search. The files-tab forwards `file-clicked` events
   * from the picker here so the overlay scrolls to the
   * corresponding file section.
   *
   * Sets a brief scroll-pause flag so the reciprocal
   * overlay-scroll → picker-focus sync doesn't re-fire
   * and create a feedback loop. The pause auto-clears
   * after a short delay.
   */
  scrollFileSearchToFile(filePath) {
    if (this._searchMode !== 'file') return;
    if (typeof filePath !== 'string' || !filePath) return;
    // Find the first match index for this file and focus
    // it. Gives the user a consistent focus state after
    // the scroll — clicking a file both scrolls the
    // overlay AND focuses that file's first match so
    // Enter-to-open works right away.
    let cursor = 0;
    let targetFlatIndex = -1;
    for (const entry of this._fileSearchResults) {
      if (entry?.file === filePath) {
        targetFlatIndex = cursor;
        break;
      }
      const matches = Array.isArray(entry?.matches) ? entry.matches : [];
      cursor += matches.length;
    }
    if (targetFlatIndex < 0) return;
    this._fileSearchFocusedIndex = targetFlatIndex;
    this._fileSearchScrollPaused = true;
    this.updateComplete.then(() => {
      const section = this.shadowRoot?.querySelector(
        `[data-file-section="${this._cssEscape(filePath)}"]`,
      );
      if (section && typeof section.scrollIntoView === 'function') {
        section.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
      // Release the pause after the scroll settles. 400ms
      // matches the smooth-scroll duration generously.
      setTimeout(() => {
        this._fileSearchScrollPaused = false;
      }, 400);
    });
  }

  /**
   * Defensive CSS selector escape — file paths may contain
   * characters that need escaping when embedded in a
   * `[data-file-section="..."]` selector. `CSS.escape` is
   * the standard API; fallback to a manual quote-escape
   * when unavailable (older jsdom).
   */
  _cssEscape(value) {
    if (typeof CSS !== 'undefined' && CSS && CSS.escape) {
      return CSS.escape(value);
    }
    return String(value).replace(/(["\\])/g, '\\$1');
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
   * event delegation for three kinds of target:
   *
   *   1. `.file-mention` inside assistant prose — toggle
   *      file selection + navigate to diff viewer. The
   *      span carries `data-file="<path>"`.
   *   2. `.code-copy-btn` inside a rendered code block —
   *      copy the sibling `<code>`'s textContent to the
   *      clipboard and flash a ✓ indicator. The button
   *      may be the actual click target or a click may
   *      land on the inner SVG/path, so we walk up via
   *      `.closest()`.
   *   3. `.edit-file-path` inside an edit-block card —
   *      navigate to the file in the diff viewer,
   *      scrolling to the edit anchor. The element
   *      carries `data-edit-path` and optionally
   *      `data-edit-anchor` (first line of old text).
   *
   * Delegation pattern rather than per-span handlers so
   * lit-html's template diffing doesn't need to track
   * handler attachment per span — the wrapped HTML comes
   * from `unsafeHTML` and doesn't participate in Lit's
   * event binding anyway.
   */
  _onMessagesClick(event) {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    // Copy-code button. Handled first so a copy button
    // nested inside some exotic parent structure doesn't
    // fall through to other handlers.
    const copyBtn = target.closest('.code-copy-btn');
    if (copyBtn) {
      event.preventDefault();
      event.stopPropagation();
      this._handleCodeCopy(copyBtn);
      return;
    }

    // Edit-block file path — navigate with anchor text.
    const editPath = target.closest('.edit-file-path');
    if (editPath) {
      const path = editPath.getAttribute('data-edit-path');
      if (path) {
        event.preventDefault();
        event.stopPropagation();
        const anchor = editPath.getAttribute('data-edit-anchor') || '';
        window.dispatchEvent(
          new CustomEvent('navigate-file', {
            detail: {
              path,
              ...(anchor ? { searchText: anchor } : {}),
            },
            bubbles: false,
          }),
        );
      }
      return;
    }

    // File mention inside prose.
    if (!target.classList || !target.classList.contains('file-mention')) {
      return;
    }
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

  /**
   * Copy the contents of the `<code>` element inside the
   * same `<pre>` as the clicked button. Flashes a ✓ via
   * a temporary `.copied` class for 1.5s, with a toast
   * on failure. Uses `navigator.clipboard.writeText` with
   * the same defensive fallbacks as `_copyMessageText`.
   *
   * The button and its sibling `<code>` are both inside
   * the same `.code-block` `<pre>` per the markdown
   * renderer's output shape. Walking up to `.code-block`
   * and back down to `code` is the cleanest way to find
   * the content regardless of DOM depth.
   */
  async _handleCodeCopy(copyBtn) {
    const pre = copyBtn.closest('pre.code-block');
    if (!pre) return;
    const codeEl = pre.querySelector('code');
    if (!codeEl) return;
    const text = codeEl.textContent || '';
    if (!text) return;
    try {
      if (
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(text);
        // Flash ✓ by swapping the icon content for 1.5s.
        // We preserve the original innerHTML so the SVG
        // icon comes back cleanly.
        const originalHtml = copyBtn.innerHTML;
        copyBtn.textContent = '✓';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.innerHTML = originalHtml;
        }, 1500);
      } else {
        this._emitToast('Clipboard not available', 'warning');
      }
    } catch (err) {
      this._emitToast(
        `Copy failed: ${err?.message || 'permission denied'}`,
        'warning',
      );
    }
  }

  // ---------------------------------------------------------------
  // File summary section
  // ---------------------------------------------------------------

  /**
   * Collect every file path referenced by an assistant
   * message — both edit-block headers and inline prose
   * mentions. Returns `[{path, inContext}]` deduplicated
   * in first-seen order, with `inContext` reflecting
   * whether the path is currently in `selectedFiles`.
   *
   * Edit blocks always contribute their `filePath` — the
   * LLM unambiguously named the file as an edit target,
   * so it belongs in the summary regardless of whether
   * the file exists in `repoFiles` (it might be a freshly
   * created file not yet in the tree).
   *
   * Prose mentions are harvested only when `repoFiles` is
   * non-empty, using the same longest-first substring
   * matching as `findFileMentions` but returning the
   * matched paths rather than rewritten HTML. This
   * mirrors specs4/5-webapp/chat.md — "Scan assistant
   * message HTML for known repo file paths… also collect
   * file paths from edit block headers."
   *
   * Runs per message during settled rendering only
   * (never during streaming), so the O(paths × content)
   * cost is bounded and not on the rAF hot path.
   *
   * @param {object} msg — assistant message dict
   * @returns {Array<{path: string, inContext: boolean}>}
   */
  _collectMessageFiles(msg) {
    if (!msg || msg.role !== 'assistant') return [];
    const content =
      typeof msg.content === 'string' ? msg.content : '';
    const selected = new Set(
      Array.isArray(this.selectedFiles) ? this.selectedFiles : [],
    );
    const seen = new Set();
    const out = [];

    // Edit block file paths. Segment the response and pull
    // filePath off every edit / edit-pending segment.
    // segmentResponse is the same parser used for
    // rendering the cards, so we see exactly what the user
    // sees.
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

    // Inline prose mentions — only detectable when we
    // know the repo's file list. Runs a cheap substring
    // scan with the same longest-first + boundary rules
    // findFileMentions uses. We operate on raw content
    // (not rendered HTML) to avoid tripping on markdown
    // entity encoding.
    if (content && Array.isArray(this.repoFiles) && this.repoFiles.length > 0) {
      // Pre-filter candidates — paths that appear as a
      // plain substring anywhere in content. Most repo
      // paths won't appear in any given message; skipping
      // them up front keeps the inner loop tight.
      const candidates = this.repoFiles.filter(
        (p) => typeof p === 'string' && p && content.includes(p),
      );
      if (candidates.length > 0) {
        // Longest-first + lexicographic tie-break — same
        // ordering as findFileMentions so we pick the
        // most-specific path when two overlap.
        candidates.sort((a, b) => {
          if (b.length !== a.length) return b.length - a.length;
          return a.localeCompare(b);
        });
        for (const path of candidates) {
          if (seen.has(path)) continue;
          if (this._proseContainsPath(content, path)) {
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
   * Check whether `path` appears in `content` as a real
   * mention — same boundary rules as the HTML mention
   * matcher. We skip code fences (triple-backtick blocks)
   * since the spec says matches inside fenced code blocks
   * are skipped. Returns true on the first valid match;
   * doesn't enumerate them.
   *
   * Simple character-level scan — text is assistant
   * output, typically a few KB at most, so the cost is
   * negligible compared to the segmenter and markdown
   * render that already ran.
   */
  _proseContainsPath(content, path) {
    // Skip anything inside ``` fences. We walk lines,
    // toggling an "inside fence" flag when we hit a line
    // starting with three backticks. Inline code (single
    // backticks) isn't excluded — per specs3 matches
    // inside inline code are wrapped normally.
    let inFence = false;
    const lines = content.split('\n');
    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      if (this._lineContainsPath(line, path)) return true;
    }
    return false;
  }

  /**
   * Boundary-aware substring check for a single line.
   * Matches the rules in `file-mentions.js::_isBoundary`:
   * path characters (letters, digits, underscore, hyphen,
   * slash) never terminate a match; dot is a boundary
   * only at the trailing edge; everything else
   * (whitespace, punctuation) is a boundary on both sides.
   */
  _lineContainsPath(line, path) {
    let from = 0;
    while (from <= line.length - path.length) {
      const idx = line.indexOf(path, from);
      if (idx === -1) return false;
      const endIdx = idx + path.length;
      const before = idx > 0 ? line[idx - 1] : '';
      const after = endIdx < line.length ? line[endIdx] : '';
      if (
        this._isMentionBoundary(before, 'before') &&
        this._isMentionBoundary(after, 'after')
      ) {
        return true;
      }
      from = idx + 1;
    }
    return false;
  }

  _isMentionBoundary(ch, position) {
    if (ch === '') return true;
    if (/[A-Za-z0-9_\-/]/.test(ch)) return false;
    if (ch === '.') return position === 'after';
    return true;
  }

  /**
   * Render the file summary section for an assistant
   * message. Emits nothing when the file list is empty —
   * casual assistant replies with no file references
   * shouldn't carry an empty summary section.
   *
   * Layout per specs3:
   *
   *   📁 Files Referenced       [+ Add All (N)]
   *   [✓ path/to/in.py]  [+ path/to/out.py]
   *
   * Chips show ✓ for in-context (muted style) and + for
   * not-in-context (accent style). Clicking a chip
   * dispatches `file-chip-click` with `{path, navigate:
   * false}`. The "Add All" button is shown only when ≥2
   * files are not currently in context — a single
   * unselected file already has its own + chip, and
   * "Add All (1)" would be redundant noise.
   *
   * @param {Array<{path: string, inContext: boolean}>} files
   * @returns {import('lit').TemplateResult | ''}
   */
  _renderFileSummary(files) {
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
                  this._onAddAllFiles(notInContext);
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
                  this._onFileChipClick(file.path);
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
   * Handle a chip click — dispatch `file-chip-click`
   * with `navigate: false` so the files-tab toggles
   * selection without opening the file in the viewer.
   *
   * Distinct from `file-mention-click` on purpose:
   * inline mentions in prose navigate + toggle; summary
   * chips only toggle. Same info, different interaction
   * contract, different event name means no conditional
   * on the handler side.
   *
   * When adding a not-in-context file (not removing an
   * in-context one), accumulate natural-language text in
   * the chat input per specs4/5-webapp/chat.md §Input
   * Accumulation on Add. The `inContext` flag on the
   * message-rendered chip tells us which direction this
   * click is going; we infer it by checking whether the
   * path is currently in selectedFiles.
   */
  _onFileChipClick(path) {
    if (typeof path !== 'string' || !path) return;
    const selected = new Set(
      Array.isArray(this.selectedFiles) ? this.selectedFiles : [],
    );
    const isAdd = !selected.has(path);
    this.dispatchEvent(
      new CustomEvent('file-chip-click', {
        detail: { path, navigate: false },
        bubbles: true,
        composed: true,
      }),
    );
    if (isAdd) {
      this._accumulateAddedFilesInInput([path]);
    }
  }

  /**
   * Accumulate natural-language text into the chat input
   * announcing files the user just added to context.
   *
   * Per specs4/5-webapp/chat.md §Input Accumulation on
   * Add:
   *   - Templates — "The file X added. Do you want to
   *     see more files before you continue?" for the
   *     first add; updated to join multiple files
   *     naturally on subsequent adds.
   *   - Only basename (filename without directory path)
   *     used in accumulated text.
   *   - Falls back to appending a parenthetical note for
   *     non-matching input states.
   *
   * The "matching input state" is text that already
   * follows the generated template — we can splice
   * additional filenames into the existing phrase
   * (e.g. "The file foo.py added. …" → "The files
   * foo.py, bar.py added. …"). Anything else (the user
   * typed their own message, or the phrasing diverged)
   * falls back to a parenthetical note appended at the
   * end so we don't rewrite user content.
   *
   * Input shape — array of repo-relative paths. All
   * paths are treated as "just added"; de-duplication
   * is caller responsibility (single-chip passes one,
   * Add-All passes the not-in-context subset).
   */
  _accumulateAddedFilesInInput(paths) {
    if (!Array.isArray(paths) || paths.length === 0) return;
    // Basename only per spec — trailing segment after the
    // last slash. Works for both forward and back slashes
    // so Windows-style paths don't slip through.
    const toBasename = (p) => {
      const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
      return idx >= 0 ? p.slice(idx + 1) : p;
    };
    const newNames = paths
      .map(toBasename)
      .filter((n) => typeof n === 'string' && n);
    if (newNames.length === 0) return;

    const current = this._input;
    const trailing =
      ' Do you want to see more files before you continue?';

    // Detect an existing accumulated phrase we can extend.
    // Matches both singular ("The file X added.") and
    // plural ("The files X, Y added.") forms followed by
    // the trailing question.
    const existingRe =
      /^The files? ([^.]+?) added\. Do you want to see more files before you continue\?\s*$/;
    const match = current.match(existingRe);

    let next;
    if (match) {
      // Splice new basenames into the existing list,
      // deduplicating so a double-click doesn't repeat
      // filenames.
      const existing = match[1].split(',').map((s) => s.trim()).filter(Boolean);
      const seen = new Set(existing);
      const merged = [...existing];
      for (const name of newNames) {
        if (!seen.has(name)) {
          seen.add(name);
          merged.push(name);
        }
      }
      const noun = merged.length === 1 ? 'file' : 'files';
      next = `The ${noun} ${merged.join(', ')} added.${trailing}`;
    } else if (current.trim() === '') {
      // Empty input — clean template.
      const noun = newNames.length === 1 ? 'file' : 'files';
      next = `The ${noun} ${newNames.join(', ')} added.${trailing}`;
    } else {
      // Non-matching input — user typed something of their
      // own. Don't rewrite their text; append a
      // parenthetical note so the context addition is
      // still visible.
      const noun = newNames.length === 1 ? 'file' : 'files';
      const suffix = ` (${noun} added: ${newNames.join(', ')})`;
      next = current + suffix;
    }

    this._input = next;
    // Reflect into the textarea and place cursor at end
    // so the user can continue typing. Defer to
    // updateComplete so Lit has committed the value
    // before we measure/position. Mirrors the pattern in
    // _insertSnippet and _pasteMessageToPrompt.
    this.updateComplete.then(() => {
      const ta = this.shadowRoot?.querySelector('.input-textarea');
      if (!ta) return;
      ta.value = next;
      ta.setSelectionRange(next.length, next.length);
      // Auto-resize — the textarea's input listener runs
      // _onInputChange, which handles height. Dispatch an
      // input event to trigger it.
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  /**
   * "Add All" button handler. Dispatches
   * `file-chips-add-all` with `{paths: [...]}` carrying
   * the list of not-in-context paths. The files-tab
   * handler (Step 2) batches them into a single
   * `set_selected_files` call rather than N round-trips.
   *
   * Also accumulates natural-language text in the chat
   * input — same path as single-chip add (per
   * specs4/5-webapp/chat.md §Input Accumulation on Add),
   * just with every added filename joined in.
   */
  _onAddAllFiles(notInContext) {
    if (!Array.isArray(notInContext) || notInContext.length === 0) return;
    const paths = notInContext
      .map((f) => f.path)
      .filter((p) => typeof p === 'string' && p);
    if (paths.length === 0) return;
    this.dispatchEvent(
      new CustomEvent('file-chips-add-all', {
        detail: { paths },
        bubbles: true,
        composed: true,
      }),
    );
    this._accumulateAddedFilesInInput(paths);
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
    const fileMode = this._searchMode === 'file';
    return html`
      ${this._renderTabStrip()}
      <div class="messages-wrapper">
        <div
          class="messages ${fileMode ? 'messages-hidden' : ''}"
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
        ${fileMode ? this._renderFileSearchOverlay() : ''}
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
            <ac-speech-to-text
              @transcript=${this._onTranscript}
              @recognition-error=${this._onRecognitionError}
            ></ac-speech-to-text>
          </div>
          <div class="action-divider" aria-hidden="true"></div>
          ${this._renderSearchBar()}
          ${this._searchMode === 'file'
            ? ''
            : html`
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
                    ?disabled=${!this.rpcConnected}
                    @click=${this._onOpenHistory}
                    aria-label="Open history browser"
                    title="Browse past sessions"
                  >
                    📜 History
                  </button>
                </div>
              `}
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
        <ac-url-chips
          @url-fetch-requested=${this._onUrlFetchRequested}
          @url-remove-requested=${this._onUrlRemoveRequested}
          @url-view-requested=${this._onUrlViewRequested}
        ></ac-url-chips>
        <div class="input-row">
          <textarea
            class="input-textarea"
            placeholder="Send a message… (Enter to send, Shift+Enter for newline)"
            .value=${this._input}
            ?disabled=${!this.rpcConnected}
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
      ${this._urlViewDialog
        ? this._renderUrlViewDialog()
        : ''}
    `;
  }

  /**
   * Render the URL content viewer overlay. Shows the
   * URLContent payload's most useful fields — title, body
   * (summary preferred over readme over content), and (for
   * GitHub repos) a symbol map. Styling mirrors the lightbox
   * overlay since the interaction contract is the same
   * (modal, Escape to close, backdrop click to close).
   *
   * Layout when a symbol map is present: tabbed, with
   * "Content" and "Symbol Map" tabs. Each tab panel fills
   * the dialog's available body height and scrolls
   * independently — users switching to the symbol map get
   * the full dialog area to read a (typically long)
   * map rather than a cramped scroll box inside a single
   * column. Generic URLs (no symbol map) skip the tab bar
   * entirely — there's only one panel, so tabs would be
   * useless chrome.
   */
  _renderUrlViewDialog() {
    const { url, content } = this._urlViewDialog;
    const title = content.title || url;
    const body =
      content.summary || content.readme || content.content || '';
    const hasSymbolMap = !!content.symbol_map;
    const activeTab = this._urlViewTab || 'content';
    return html`
      <div
        class="lightbox-backdrop"
        tabindex="0"
        @click=${(e) => {
          if (e.target === e.currentTarget) {
            this._closeUrlViewDialog();
          }
        }}
        @keydown=${this._onUrlViewKeyDown}
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
              @click=${this._closeUrlViewDialog}
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
                  @click=${() => { this._urlViewTab = 'content'; }}
                  style=${this._urlTabStyle(activeTab === 'content')}
                >Content</button>
                <button
                  role="tab"
                  aria-selected=${activeTab === 'symbols'}
                  @click=${() => { this._urlViewTab = 'symbols'; }}
                  style=${this._urlTabStyle(activeTab === 'symbols')}
                >Symbol Map</button>
              </div>`
            : ''}
          ${hasSymbolMap && activeTab === 'symbols'
            ? this._renderUrlViewSymbolsTab(content.symbol_map)
            : this._renderUrlViewContentTab(content, body)}
        </div>
      </div>
    `;
  }

  /**
   * Styling for a URL-view tab button. Active tab gets an
   * accent underline + brighter text; inactive tabs are
   * muted. Inline styles rather than a class because the
   * dialog body itself is inlined (no stylesheet entries
   * for `.url-view-dialog *`); keeping everything inline
   * keeps the component's CSS surface small.
   */
  _urlTabStyle(active) {
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

  /**
   * Content tab — summary / readme / content body plus the
   * optional summary-type badge. Fills the dialog body
   * and scrolls internally so long bodies don't push the
   * header offscreen.
   */
  _renderUrlViewContentTab(content, body) {
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

  /**
   * Symbol map tab — monospace, wraps long comma-joined
   * identifier runs, fills the dialog body. Overflow-y
   * on the outer wrapper means the user gets a single
   * scrollbar for the whole map rather than nested
   * scrolls.
   */
  _renderUrlViewSymbolsTab(symbolMap) {
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
    // User content and system-event content both go through
    // the markdown renderer so lists, paragraphs, code
    // fences, etc. render as intended — users type markdown-
    // literate text (that's what the LLM receives), so the
    // chat UI should show it the same way. The markdown
    // renderer handles escaping internally, so this path is
    // safe against HTML injection. Assistant content goes
    // through the edit-block segmenter so edit blocks become
    // visual cards instead of raw prose.
    let bodyHtml;
    if (msg.role === 'user' && !msg.system_event) {
      bodyHtml = html`
        <div class="md-content">
          ${unsafeHTML(renderMarkdown(msg.content))}
        </div>
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
    // Finish-reason badge — only shown for non-normal stop
    // reasons (length, content_filter, etc.). Normal
    // completions (stop, end_turn) don't carry the field
    // (the sender strips them in _onStreamComplete).
    //
    // Per specs-reference/3-llm/streaming.md § Finish
    // Reason:
    //   - length → red "✂️ truncated (max_tokens)"
    //   - content_filter → red "🚫 content filter"
    //   - tool_calls / function_call → amber "🔧 {reason}"
    //   - anything else → amber "{reason}"
    //
    // Icon + severity class chosen together so the badge
    // reads at a glance. Title attribute carries the raw
    // reason for screen readers and hover disclosure.
    const finishBadge =
      msg.finishReason
        ? this._renderFinishBadge(msg.finishReason)
        : '';
    // File summary section — settled assistant messages
    // only. Per specs4/5-webapp/chat.md: "Section only
    // shown for final rendered messages, never during
    // streaming." The streaming card uses
    // `_renderStreamingMessage` which doesn't call this
    // path, and user / system messages never reference
    // files in a way worth summarising.
    const fileSummary =
      msg.role === 'assistant' && !msg.system_event
        ? this._renderFileSummary(this._collectMessageFiles(msg))
        : '';
    // Edit summary banner — settled assistant messages
    // with edit results. Rendered BEFORE the file summary
    // so the order in the card is: body, edits, files.
    // Edits are the actionable outcome; the file summary
    // is a convenience affordance. If both render, edits
    // go first.
    const editSummary =
      msg.role === 'assistant' && !msg.system_event
        ? this._renderEditSummary(msg)
        : '';
    return html`
      <div
        class="message-card ${roleClass}${highlightClass}"
        data-msg-index=${index}
      >
        <div class="message-toolbar top">${toolbar}</div>
        <div class="role-label">${roleLabel}${finishBadge}</div>
        ${bodyHtml}
        ${images.length > 0
          ? this._renderMessageImages(images)
          : ''}
        ${editSummary}
        ${fileSummary}
        <div class="message-toolbar bottom">${toolbar}</div>
      </div>
    `;
  }

  /**
   * Render the finish-reason badge for a message. Picks a
   * severity class per specs-reference/5-webapp/chat.md §
   * Finish-reason badge labels:
   *
   *   - `stop` / `end_turn` → muted green `✓` badge
   *     (.severity-natural)
   *   - `length` / `content_filter` → red badge
   *     (.severity-error)
   *   - `tool_calls` / `function_call` → amber badge
   *     (default)
   *   - anything else → amber, with the raw reason
   *     surfaced verbatim so unexpected provider values
   *     stay diagnosable
   *
   * Called for every completed assistant message that
   * carries a finish reason. Natural completions still
   * render a badge — it's muted so it doesn't dominate
   * the role label, but visible so users get positive
   * confirmation the stream ended normally rather than
   * being cut off by an error or network hiccup.
   *
   * @param {string} reason — the raw finish_reason string
   *   from the provider (via litellm normalization)
   * @returns {import('lit').TemplateResult}
   */
  _renderFinishBadge(reason) {
    // Icon + label + severity, picked per reason. Severity
    // `natural` produces the muted green variant; `error`
    // produces the red variant; absent severity uses the
    // amber default.
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
        // Unknown reason — surface verbatim so
        // unexpected provider values stay diagnosable.
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

  /**
   * Render the edit summary banner for an assistant message.
   * Appears at the end of the message (after all edit cards)
   * when the response contained at least one edit.
   *
   * Per specs-reference/5-webapp/chat.md §Edit Summary and
   * specs4/5-webapp/chat.md §Edit Summary Banner:
   *
   *   - Aggregate counts as color-coded stat badges
   *   - Individual failure listing when failures are present
   *     (clickable file path, error-type badge, message)
   *   - Note about a populated retry prompt when applicable
   *
   * Returns empty when there are no edit results, or when
   * the results array is all zero counts (pure prose reply
   * the backend tagged with an empty results array).
   */
  _renderEditSummary(msg) {
    if (!msg || msg.role !== 'assistant') return '';
    const results = Array.isArray(msg.editResults)
      ? msg.editResults
      : [];
    if (results.length === 0) return '';

    // Aggregate by status. Count `applied` and
    // `already_applied` separately so the badge text
    // matches what the user actually got (idempotent
    // re-applies shouldn't look like fresh writes).
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

    // Detect whether a retry prompt was populated. We
    // don't track this as state; re-derive from the same
    // conditions the builder uses. The note is
    // informational — mismatched state (user cleared the
    // textarea between streamComplete and re-render) just
    // shows a stale note, which is harmless.
    const selected = new Set(
      Array.isArray(this.selectedFiles) ? this.selectedFiles : [],
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

    // Build the header badge list. Only non-zero counts
    // render — a successful response with no failures
    // shows just "✅ N applied".
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
    // Nothing to show — all results had unknown statuses
    // (defensive; shouldn't happen under normal operation).
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
    // Mode-dependent state — file mode uses its own
    // counter shape (matches in N files) and its own
    // nav handlers.
    const fileMode = this._searchMode === 'file';
    const hasQuery = this._searchQuery.trim().length > 0;
    let counterText = '';
    let noMatch = false;
    let navTotal = 0;
    if (fileMode) {
      const matchCount = this._totalFileSearchMatches();
      const fileCount = this._fileSearchResults.length;
      navTotal = matchCount;
      if (this._fileSearchLoading) {
        counterText = 'Searching…';
      } else if (hasQuery) {
        counterText =
          matchCount === 0
            ? '0 results'
            : `${matchCount} in ${fileCount}`;
        noMatch = matchCount === 0;
      }
    } else {
      const matches = this._computeSearchMatches();
      const total = matches.length;
      navTotal = total;
      if (hasQuery) {
        const current =
          total === 0
            ? 0
            : Math.min(
                Math.max(0, this._searchCurrentIndex) + 1,
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
      ? this._onFileSearchPrev
      : this._onSearchPrev;
    const onNext = fileMode
      ? this._onFileSearchNext
      : this._onSearchNext;
    return html`
      <div class="search-bar" role="search">
        <button
          class="action-button search-mode-toggle ${fileMode
            ? 'active'
            : ''}"
          @click=${this._toggleSearchMode}
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
            .value=${this._searchQuery}
            @input=${this._onSearchInput}
            @keydown=${this._onSearchKeyDown}
            aria-label=${ariaLabel}
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

  _renderFileSearchOverlay() {
    if (!this._searchQuery.trim()) {
      return html`
        <div class="file-search-overlay">
          <div class="file-search-empty">
            Type to search across files
          </div>
        </div>
      `;
    }
    if (this._fileSearchLoading && this._fileSearchResults.length === 0) {
      return html`
        <div class="file-search-overlay">
          <div class="file-search-empty">Searching…</div>
        </div>
      `;
    }
    if (this._fileSearchResults.length === 0) {
      return html`
        <div class="file-search-overlay">
          <div class="file-search-empty">No results found</div>
        </div>
      `;
    }
    // Walk results, maintaining a running flat-index so each
    // match row carries its position in the overall navigation
    // sequence. The focused row gets `.focused` class and a
    // `data-file-match-flat` attribute so scroll-sync can
    // target it.
    let flatIndex = 0;
    const sections = [];
    for (let fi = 0; fi < this._fileSearchResults.length; fi += 1) {
      const entry = this._fileSearchResults[fi];
      const matches = Array.isArray(entry?.matches) ? entry.matches : [];
      const matchRows = matches.map((match) => {
        const thisFlat = flatIndex++;
        return this._renderFileSearchMatch(
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
            @click=${() => this._onFileSearchHeaderClick(entry.file)}
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
        @scroll=${this._onFileSearchOverlayScroll}
      >
        ${sections}
      </div>
    `;
  }

  /**
   * Render a single match row — context lines before,
   * the match line itself, context lines after. Context
   * rows are not clickable and not focusable; only the
   * match line navigates.
   */
  _renderFileSearchMatch(filePath, match, flatIndex) {
    if (!match) return '';
    const isFocused = flatIndex === this._fileSearchFocusedIndex;
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
        @click=${() =>
          this._onFileSearchMatchClick(filePath, match)}
      >
        <span class="file-match-linenum">
          ${match.line_num ?? ''}
        </span>
        <span class="file-match-text">
          ${this._renderHighlightedMatchLine(match.line ?? '')}
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
   * Highlight occurrences of the search query within a
   * match line. Regex / whole-word / ignore-case toggles
   * are respected. Falls back to the plain line when
   * the pattern can't be built (invalid regex).
   */
  _renderHighlightedMatchLine(line) {
    if (!line) return '';
    const query = this._searchQuery;
    if (!query.trim()) return line;
    let pattern;
    try {
      let source = this._searchRegex
        ? query
        : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (this._searchWholeWord) {
        source = `\\b(?:${source})\\b`;
      }
      const flags = this._searchIgnoreCase ? 'gi' : 'g';
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
      // Guard against zero-width matches — infinite loop
      // prevention.
      if (m[0].length === 0) {
        pattern.lastIndex += 1;
      }
    }
    if (cursor < line.length) {
      parts.push(line.slice(cursor));
    }
    return parts;
  }

  _onFileSearchMatchClick(filePath, match) {
    window.dispatchEvent(
      new CustomEvent('navigate-file', {
        detail: { path: filePath, line: match?.line_num },
        bubbles: false,
      }),
    );
  }

  _onFileSearchHeaderClick(filePath) {
    window.dispatchEvent(
      new CustomEvent('navigate-file', {
        detail: { path: filePath },
        bubbles: false,
      }),
    );
  }

  /**
   * Overlay scroll handler. Dispatches `file-search-scroll`
   * with the file path at the top of the visible area so
   * the picker can sync its focus. Throttled via the
   * scroll-paused flag so an externally-driven scroll
   * (picker click → scrollFileSearchToFile) doesn't
   * bounce back.
   */
  _onFileSearchOverlayScroll(event) {
    if (this._fileSearchScrollPaused) return;
    const overlay = event.currentTarget;
    const sections = overlay.querySelectorAll(
      '[data-file-section]',
    );
    const overlayTop = overlay.getBoundingClientRect().top;
    let topFile = null;
    for (const section of sections) {
      const rect = section.getBoundingClientRect();
      // The section at the top of the visible area is the
      // one whose bottom edge is still below the overlay's
      // top edge.
      if (rect.bottom > overlayTop + 1) {
        topFile = section.getAttribute('data-file-section');
        break;
      }
    }
    if (topFile) {
      this._dispatchFileSearchScroll(topFile);
    }
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
  deriveAgentTabLabel,
  parseAgentTabId,
  _AGENT_LABEL_MAX_LENGTH,
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