// ChatPanel — the primary interaction surface in
// the Files tab.
//
// This file is deliberately slim. Every concern
// the component owns (state, rendering, event
// handling, streaming, search, URLs, tabs,
// input) lives in a sibling module under
// `webapp/src/chat-panel/`. This file is the
// integration point — it pulls those modules
// together into a Lit element, registers the
// custom element, and exposes the public surface
// the rest of the webapp (and the test suite)
// imports.
//
// Module map:
//
//   helpers.js     — pure utilities, constants,
//                    localStorage shims, and
//                    request-ID generation
//   properties.js  — `static properties` block
//   styles.js      — `static styles` block
//   state.js       — per-tab state factory +
//                    reactive-accessor installer
//   tabs.js        — tab strip rendering, spawn,
//                    overflow menu, Alt+`
//   streaming.js   — stream chunk/complete,
//                    retry prompts, error
//                    formatting + toasts
//   search.js      — message + file search
//                    controllers
//   urls.js        — URL detection, fetch, view
//                    dialog
//   input.js       — input handling, paste,
//                    images, lightbox, speech,
//                    snippets, file chips
//   rendering.js   — render() entry + per-region
//                    helpers
//   events.js      — connect/disconnect, all
//                    window event listeners,
//                    mode toggle, snippet load,
//                    commit result
//
// Architectural contracts preserved here (the
// modules cooperate to honour these — the
// component class itself does no business logic):
//
//   - **Streaming state keyed by request ID**
//     (specs4/0-overview/implementation-guide.md
//     D10): each tab has its own `_streams` Map
//     and `_pendingChunks` Map; routing happens
//     by request ID via `findTabForRequest`.
//
//   - **Chunks carry full accumulated content,
//     not deltas**: `onStreamChunk` overwrites
//     the pending slot rather than appending.
//     Dropped chunks are harmless because each
//     carries a superset of prior content.
//
//   - **Chunks coalesced per animation frame**:
//     `_pendingChunks` holds the latest-seen
//     content per request-id; the rAF callback
//     reads it, clears the pending marker, and
//     updates reactive state.
//
//   - **Per-tab state lives in `_tabs`, accessed
//     via prototype-installed getter/setter
//     pairs**. Lit's `noAccessor: true` flag
//     opts out of its default accessor
//     installation (see properties.js).

import { LitElement } from 'lit';

import { RpcMixin } from '../rpc-mixin.js';
// Side-effect imports — these modules register
// custom elements (`<ac-history-browser>`,
// `<ac-input-history>`, `<ac-speech-to-text>`,
// `<ac-url-chips>`) that the render template uses.
// Without these imports the elements would render
// as unknown HTML.
import '../history-browser.js';
import '../input-history.js';
import '../speech-to-text.js';
import '../url-chips.js';

import {
  attachEventListeners,
  bindEventHandlers,
  detachEventListeners,
  loadModeState,
  loadSnippets,
  onUpdated,
  rehydrateLiveAgents,
  switchMode,
  toggleCrossRef,
} from './events.js';
import {
  _AGENT_LABEL_MAX_LENGTH,
  _DRAWER_STORAGE_KEY,
  _EXPERIMENTAL_ENABLED,
  _REASONING_STORAGE_KEY,
  _REASONING_EFFORT_STORAGE_KEY,
  _REASONING_EFFORT_LEVELS,
  _SEARCH_IGNORE_CASE_KEY,
  _SEARCH_REGEX_KEY,
  _SEARCH_WHOLE_WORD_KEY,
  _loadDrawerOpen,
  _loadReasoningEnabled,
  _loadReasoningEffort,
  _saveReasoningEffort,
  _loadSearchToggle,
  _saveDrawerOpen,
  _saveReasoningEnabled,
  _saveSearchToggle,
  buildAmbiguousRetryPrompt,
  buildInContextMismatchRetryPrompt,
  buildNotInContextRetryPrompt,
  deriveAgentTabLabel,
  generateRequestId,
  parseAgentTabId,
} from './helpers.js';
import {
  _DRAFT_STORAGE_KEY,
  _loadDraft,
  cancel,
  onHistoryCancel,
  onHistorySelect,
  onNewSession,
  onOpenHistory,
  onRecognitionError,
  onTranscript,
  send,
} from './input.js';
import { PROPERTIES } from './properties.js';
import { render as renderTemplate } from './rendering.js';
import {
  activateFileSearch as activateFileSearchImpl,
  scrollFileSearchToFile as scrollFileSearchToFileImpl,
  scrollToCurrentMatch,
  setSearchMode,
} from './search.js';
import { installReactiveAccessors, makeTabState } from './state.js';
import { STYLES } from './styles.js';
import { installTabHandlers, onTabClose } from './tabs.js';

export class ChatPanel extends RpcMixin(LitElement) {
  static properties = PROPERTIES;
  static styles = STYLES;

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
    // spawning adds one entry per agent under the same
    // Map.
    //
    // `_activeTabIdValue` is the backing storage for the
    // `_activeTabId` getter/setter defined on the
    // prototype below (see `_installActiveTabAccessor`).
    // The setter dispatches `active-tab-changed` on
    // change so sibling components can re-sync per-tab
    // state.
    this._activeTabIdValue = 'main';
    this._tabs = new Map();
    this._tabs.set('main', makeTabState());

    // Human-readable labels for the tab strip. Keyed by
    // tab ID, stored separately from `_tabs` so agent
    // tabs can have descriptive labels derived from
    // their task text without renaming their state-
    // storage key. Main's label is fixed.
    this._tabLabels = new Map();
    this._tabLabels.set('main', 'Main');

    // Per-agent mode strings — one of 'code', 'doc',
    // 'code+xref', 'doc+xref'. Populated by
    // spawnAgentTabs from the agentsSpawned payload's
    // resolved mode field. Stable for the agent's
    // lifetime (mode is fixed at spawn time per spec
    // ``specs4/7-future/parallel-agents.md``).
    // Surfaced in the tab strip tooltip and the LED
    // row's hover state. Main tab has no entry — the
    // orchestrator's mode is shown via the action-bar
    // mode toggle, not via tooltip.
    this._tabModes = new Map();

    // Overflow menu open state. Reactive (declared in
    // properties.js) rather than per-tab because it's a
    // UI-level dropdown — every tab sees the same menu.
    this._tabStripOverflowOpen = false;

    // ---------------------------------------------------------
    // Cross-tab / component-scoped state
    // ---------------------------------------------------------
    // Not per-conversation — global to the chat panel
    // (main-only concerns, handler bindings, files-tab
    // pushes).

    // Commit state. `_committing` flips true on click,
    // false when the `commit-result` window event fires.
    // Review state defaults false and is driven by the
    // parent component via property push. Both are
    // main-conversation concerns — agents never commit,
    // agents never enter review mode.
    this._committing = false;
    this.reviewActive = false;

    // Reasoning toggle — restored from localStorage so
    // the user's last choice survives reload. Gated on
    // ``--experimental``: the toggle/effort UI is only
    // rendered under that flag (see rendering.js), so the
    // persisted state must also be suppressed when it's
    // off — otherwise a ``true``/``xhigh`` left in
    // localStorage from a prior experimental session
    // ships a hard per-request reasoning override on every
    // send, forcing extended thinking the user can no
    // longer see or toggle. (Effort still falls back to
    // its default for the UI's sake, but it's never sent
    // while ``_reasoningEnabled`` is false.)
    this._reasoningEnabled = _EXPERIMENTAL_ENABLED
      ? _loadReasoningEnabled()
      : false;
    this._reasoningEffort = _loadReasoningEffort();

    // Mode + cross-ref state. Hydrated from
    // get_current_state on RPC ready and kept in sync
    // via the `mode-changed` window event.
    this._mode = 'code';
    this._crossRefEnabled = false;

    // Repo files list — pushed by files-tab for file
    // mention detection. Global to the chat panel.
    this.repoFiles = [];

    // rAF handle for chunk coalescing. One rAF active
    // at a time across all tabs.
    this._rafHandle = null;

    // Bind handlers. tabs.js owns the overflow + Alt+`
    // closures; events.js owns window-event handlers;
    // input.js owns the speech-to-text + history
    // delegators (the renderer wires them via
    // `panel._onTranscript` etc., so we install thin
    // bound forwarders here).
    installTabHandlers(this);
    bindEventHandlers(this);
    this._onTranscript = (e) => onTranscript(this, e);
    this._onRecognitionError = (e) => onRecognitionError(this, e);
    this._onHistoryClose = () => { this._historyOpen = false; };
    this._onHistorySessionLoaded = () => {
      this._historyOpen = false;
    };
    // Bound mode helpers — the search bar's render path
    // calls these via `panel._switchMode(mode)` etc.
    this._switchMode = (mode) => switchMode(this, mode);
    this._toggleCrossRef = () => toggleCrossRef(this);
    // Bound tab-close — used by streaming.js's stale-
    // agent recovery path (it calls `panel._onTabClose`
    // when the backend reports `agent not found`).
    this._onTabClose = (tabId) => onTabClose(this, tabId);
  }

  // ---------------------------------------------------------------
  // Active-tab accessor
  // ---------------------------------------------------------------
  //
  // Special-cased here rather than in state.js because
  // `_activeTabId` is the KEY into `_tabs`, not a per-
  // tab field itself. The setter dispatches
  // `active-tab-changed` on real transitions and
  // snapshots / restores URL chip state across the
  // switch.

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
    this._snapshotUrlChipsForTab(oldValue);
    this._activeTabIdValue = value;
    this.requestUpdate('_activeTabId', oldValue);
    // Restore the entering tab's URL chip state. Runs
    // after the property flip so the chip component
    // (if it re-renders based on reactive state) sees
    // the new tab's data, not a half-swapped mix.
    this._restoreUrlChipsForTab(value);
    // Notify listeners of the transition. bubbles +
    // composed so the event crosses the shadow DOM
    // boundary.
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
   * Snapshot the leaving tab's URL chip Map. Called by
   * the `_activeTabId` setter. Defensive — before any
   * render the chip element doesn't exist in
   * shadowRoot, in which case there's nothing to
   * snapshot.
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
   * Restore the entering tab's URL chip snapshot.
   * Defers through `updateComplete` so the setter's
   * `requestUpdate` cycle finishes first.
   */
  _restoreUrlChipsForTab(tabId) {
    this.updateComplete.then(() => {
      const chipsEl =
        this.shadowRoot?.querySelector('ac-url-chips');
      if (!chipsEl) return;
      const tab = this._tabs.get(tabId);
      if (!tab) return;
      chipsEl._chips = tab.urlChips
        ? new Map(tab.urlChips)
        : new Map();
    });
  }

  // ---------------------------------------------------------------
  // Toast emission
  // ---------------------------------------------------------------

  /**
   * Emit a toast event. Modules that need to surface
   * user feedback go through this rather than
   * dispatching directly so the channel stays
   * consistent (e.g. for future toast deduplication).
   */
  _emitToast(message, type = 'info') {
    window.dispatchEvent(
      new CustomEvent('ac-toast', {
        detail: { message, type },
        bubbles: false,
      }),
    );
  }

  // ---------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------

  connectedCallback() {
    super.connectedCallback();
    attachEventListeners(this);
    // Restore any persisted draft. Done here
    // rather than in the constructor because
    // `_input` is a forwarding accessor backed
    // by the main tab's state — the per-tab
    // state is set up in the constructor, so
    // this is safe either place, but
    // connectedCallback also covers the case
    // where the panel is detached and re-
    // attached without re-construction. The
    // textarea is hydrated from `_input` via
    // the `.value=${panel._input}` binding in
    // the render template, so no manual sync
    // is needed.
    const draft = _loadDraft();
    if (draft && !this._input) {
      this._input = draft;
    }
    // Listen for view-agents-requested events
    // dispatched by the renderViewAgentsAffordance
    // button. The event is composed + bubbles so
    // it crosses the shadow boundary; we listen
    // on the panel itself rather than on window
    // so a future host outside the chat panel
    // can intercept too. Bound in constructor by
    // installTabHandlers.
    this.addEventListener(
      'view-agents-requested', this._onViewAgentsRequested,
    );
  }

  firstUpdated() {
    // After the textarea exists in the shadow
    // DOM, force its inline height to match the
    // restored draft. The render binding sets
    // `.value` reactively, but auto-resize only
    // runs on `input` events — without this,
    // a multi-line restored draft renders in a
    // single-row textarea until the user types.
    if (this._input) {
      const ta = this.shadowRoot?.querySelector(
        '.input-textarea',
      );
      if (ta) {
        ta.style.height = 'auto';
        ta.style.height = `${Math.min(ta.scrollHeight, 192)}px`;
      }
    }
  }

  disconnectedCallback() {
    this.removeEventListener(
      'view-agents-requested', this._onViewAgentsRequested,
    );
    detachEventListeners(this);
    super.disconnectedCallback();
  }

  onRpcReady() {
    // Fetch snippets + hydrate mode state once the
    // proxy is published. RpcMixin defers this hook to
    // the next microtask so every sibling component
    // has received the proxy before any of them issues
    // requests — we're safe to call straight away.
    loadSnippets(this);
    loadModeState(this);
    // Rehydrate live agent tabs from the backend's
    // _agent_contexts registry. Per spec
    // specs4/5-webapp/agent-browser.md § Refresh and
    // Reconnect, the backend's agent registry survives
    // browser refresh and WebSocket reconnect; the
    // frontend tab strip does not, so onRpcReady is
    // the recovery point.
    rehydrateLiveAgents(this);
  }

  updated(changedProps) {
    onUpdated(this, changedProps);
  }

  // ---------------------------------------------------------------
  // Public methods
  // ---------------------------------------------------------------
  //
  // The shell calls these directly (Ctrl+Shift+F
  // routing) and the files-tab calls
  // `scrollFileSearchToFile` for picker-driven
  // overlay scrolling.

  activateFileSearch(prefill = '') {
    activateFileSearchImpl(this, prefill);
  }

  scrollFileSearchToFile(filePath) {
    scrollFileSearchToFileImpl(this, filePath);
  }

  // ---------------------------------------------------------------
  // Test-surface forwarders
  // ---------------------------------------------------------------
  //
  // The old chat-panel.js exposed `_makeTabState`,
  // `_send`, and `_cancel` as instance methods. The
  // refactor moved their implementations to
  // `./state.js` (factory) and `./input.js`
  // (functional handlers taking `panel` as their
  // first argument), neither of which lands on the
  // instance.
  //
  // Existing test files seed agent tabs via
  // `panel._tabs.set(id, panel._makeTabState())` and
  // exercise the send path via `panel._send()` /
  // `panel._cancel()`. Rather than rewrite every
  // call site, expose thin forwarders here. Costs
  // nothing in production (one extra function call)
  // and keeps the test surface stable.

  _makeTabState() {
    return makeTabState();
  }

  _send() {
    return send(this);
  }

  _cancel() {
    return cancel(this);
  }

  _setSearchMode(mode) {
    return setSearchMode(this, mode);
  }

  _onNewSession() {
    return onNewSession(this);
  }

  _onOpenHistory() {
    return onOpenHistory(this);
  }

  _scrollToCurrentMatch() {
    return scrollToCurrentMatch(this);
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  render() {
    return renderTemplate(this);
  }
}

// Install per-tab forwarding accessors onto the
// prototype. Done at module load so every instance
// shares the same accessor descriptors (Lit's reactive-
// property contract is preserved via
// requestUpdate calls inside the setters — see
// state.js for details).
installReactiveAccessors(ChatPanel.prototype);

customElements.define('ac-chat-panel', ChatPanel);

// ---------------------------------------------------------------
// Public re-exports
// ---------------------------------------------------------------
//
// Tests and a few sibling components import these
// helpers directly. The original chat-panel.js
// re-exported them at the bottom of the file; we
// preserve the surface here so commit 13's import
// retargeting is purely path-level (`'./chat-panel.js'`
// → `'./chat-panel/index.js'`).

export {
  generateRequestId,
  deriveAgentTabLabel,
  parseAgentTabId,
  _AGENT_LABEL_MAX_LENGTH,
  _loadDrawerOpen,
  _saveDrawerOpen,
  _DRAWER_STORAGE_KEY,
  _DRAFT_STORAGE_KEY,
  _SEARCH_IGNORE_CASE_KEY,
  _SEARCH_REGEX_KEY,
  _SEARCH_WHOLE_WORD_KEY,
  _loadSearchToggle,
  _saveSearchToggle,
  _REASONING_STORAGE_KEY,
  _REASONING_EFFORT_STORAGE_KEY,
  _REASONING_EFFORT_LEVELS,
  _loadReasoningEnabled,
  _saveReasoningEnabled,
  _loadReasoningEffort,
  _saveReasoningEffort,
  buildAmbiguousRetryPrompt,
  buildInContextMismatchRetryPrompt,
  buildNotInContextRetryPrompt,
};