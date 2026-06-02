// Per-tab state machine for the ChatPanel component.
//
// Two exports:
//
//   - `makeTabState()` — factory returning a fresh
//     state object. Called once at construction for
//     the main tab; called again per spawned agent.
//
//   - `installReactiveAccessors(proto)` — installs
//     getter/setter pairs onto a class prototype.
//     Each pair forwards to the active tab's state
//     object (via `this._tabs.get(this._activeTabId)`)
//     and, for reactive properties, calls
//     `requestUpdate(name, oldValue)` so Lit's
//     dirty-check fires on mutation.
//
// Why prototype-installed accessors instead of
// declaring them on the class body: the original
// chat-panel.js had ~30 near-identical getter/setter
// pairs taking up several hundred lines. Generating
// them programmatically from a list keeps the
// component class slim and the per-tab fan-out
// declarative.
//
// `noAccessor: true` in `properties.js` matters
// here. Lit normally installs its own accessors that
// store values directly on the instance; we need
// those values to live in `_tabs.get(id)` instead.
// `noAccessor: true` tells Lit "don't install your
// default accessors, the user is providing their
// own", which is exactly what
// `installReactiveAccessors` does.
//
// Reactive vs non-reactive split:
//
//   - REACTIVE_FIELDS: declared in `properties.js`,
//     drive Lit re-renders. Setter calls
//     `requestUpdate(name, oldValue)`.
//
//   - NON_REACTIVE_FIELDS: per-tab storage for
//     handler-scoped state (debounce timers, stream
//     internals, scroll flags). Setters skip
//     `requestUpdate` because their mutation alone
//     doesn't change rendered output — code paths
//     that DO need a re-render also write a reactive
//     field, which carries the requestUpdate.

import {
  _loadDrawerOpen,
  _loadSearchToggle,
  _SEARCH_IGNORE_CASE_KEY,
  _SEARCH_REGEX_KEY,
  _SEARCH_WHOLE_WORD_KEY,
} from './helpers.js';

/**
 * Factory: build a fresh tab state object.
 *
 * Field groupings (informational — the flat object is
 * what callers use):
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
 *                  urlDetectGeneration, urlChips
 *   Misc         — autoScroll, suppressNextPaste,
 *                  activeMention
 *
 * Persisted toggles (drawer state, search toggles)
 * load their initial values from localStorage so
 * each new tab inherits the user's last choice.
 * Per-tab divergence after that is intentional —
 * an agent tab's search settings may legitimately
 * differ from main's.
 */
export function makeTabState() {
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
    // restore the entering tab's snapshot.
    urlChips: null,
    // Misc non-reactive flags / state
    autoScroll: true,
    suppressNextPaste: false,
    activeMention: null,
    // Last-completion outcome for this tab. Drives the
    // LED row's green/red state for agent tabs (cyan
    // flashing comes from the live `streaming` flag
    // above, so `lastEditOutcome` only needs to record
    // the post-stream resting state).
    //
    // Shape:
    //   null — never streamed, or fresh stream in
    //          flight. LEDs default to cyan flashing
    //          while streaming, no LED at rest.
    //   { status: 'clean', appliedCount, failureReason: null }
    //   { status: 'error', appliedCount, failureReason }
    //
    // `appliedCount` is the count of EditResult entries
    // with status === 'applied'. `failureReason` carries
    // the human-readable diagnostic — provider error
    // message, anchor-not-found, ambiguous, or the
    // assimilation-failed marker. Per spec
    // ``specs4/5-webapp/agent-browser.md`` § Status LEDs.
    //
    // Reset to null when a fresh stream starts on this
    // tab so a previous failure doesn't show stale red
    // on the next turn.
    lastEditOutcome: null,
    // Read-only flag for historical agent tabs (those
    // populated via `view-agents-requested` from a
    // previous turn). Per spec
    // ``specs4/5-webapp/agent-browser.md`` § Tab
    // Lifetime — read-only tabs disable the input box
    // because the agent's `ContextManager` is gone
    // server-side; users can read the archive but not
    // continue the conversation. Live tabs default to
    // false; only historical tabs flip this to true.
    readOnly: false,
    // Retry progress banner state. Populated by
    // onStreamRetry when the backend's retry wrapper
    // emits a streamRetry event (rate-limit, api
    // connection, service unavailable, timeout).
    // Cleared when a chunk arrives (stream succeeded
    // on retry) or stream completes.
    //
    // Shape when active:
    //   {
    //     attempt: 1-indexed current attempt,
    //     maxAttempts, errorType, message, provider,
    //     context, waitSeconds: float backoff duration,
    //     startedAt: Date.now() at event receipt,
    //   }
    //
    // Per-tab because multiple agent tabs can be
    // retrying concurrently and each needs its own
    // countdown.
    retryInfo: null,
    // Non-reactive handle for the 100ms setInterval
    // that drives the countdown's re-render. Managed
    // by startRetryTick / stopRetryTick in streaming.js.
    retryTickHandle: null,
  };
}

/**
 * Reactive per-tab fields. Each entry is
 * `[propertyName, tabFieldName]`. The property name
 * is what the component code reads/writes via
 * `this.<name>`; the tab-field name is the
 * corresponding key inside the tab state object.
 *
 * Most properties are 1:1 with their tab field
 * minus the leading underscore — the underscore is
 * a Lit convention for "internal state" properties
 * but the tab-state object doesn't carry that
 * convention. Mapping is explicit so a future
 * rename in either direction stays surgical.
 */
const REACTIVE_FIELDS = [
  ['messages', 'messages'],
  ['_input', 'input'],
  ['_streaming', 'streaming'],
  ['_streamingContent', 'streamingContent'],
  ['_historyOpen', 'historyOpen'],
  ['_snippetDrawerOpen', 'snippetDrawerOpen'],
  ['_snippets', 'snippets'],
  ['_pendingImages', 'pendingImages'],
  ['_lightboxImage', 'lightboxImage'],
  ['_searchQuery', 'searchQuery'],
  ['_searchIgnoreCase', 'searchIgnoreCase'],
  ['_searchRegex', 'searchRegex'],
  ['_searchWholeWord', 'searchWholeWord'],
  ['_searchCurrentIndex', 'searchCurrentIndex'],
  ['_searchMode', 'searchMode'],
  ['_fileSearchResults', 'fileSearchResults'],
  ['_fileSearchLoading', 'fileSearchLoading'],
  ['_fileSearchFocusedIndex', 'fileSearchFocusedIndex'],
  ['_urlViewDialog', 'urlViewDialog'],
  ['_urlViewTab', 'urlViewTab'],
  ['_retryInfo', 'retryInfo'],
  // selectedFiles is pushed by the files-tab via
  // direct assignment; per-tab because agent tabs
  // will get their own selection. Reactive because
  // changes need to drive the picker re-render path.
  ['selectedFiles', 'selectedFiles'],
];

/**
 * Non-reactive per-tab fields. These back code
 * paths that should NOT trigger a Lit re-render on
 * mutation — streaming internals, event-handler
 * scoped flags, transient timer handles. They need
 * tab-scoped storage but no `requestUpdate` call.
 */
const NON_REACTIVE_FIELDS = [
  ['_streams', 'streams'],
  ['_currentRequestId', 'currentRequestId'],
  ['_lastRequestId', 'lastRequestId'],
  ['_pendingChunks', 'pendingChunks'],
  ['_autoScroll', 'autoScroll'],
  ['_suppressNextPaste', 'suppressNextPaste'],
  ['_activeMention', 'activeMention'],
  ['_fileSearchGeneration', 'fileSearchGeneration'],
  ['_fileSearchDebounceTimer', 'fileSearchDebounceTimer'],
  ['_fileSearchScrollPaused', 'fileSearchScrollPaused'],
  ['_urlDetectDebounceTimer', 'urlDetectDebounceTimer'],
  ['_urlDetectGeneration', 'urlDetectGeneration'],
  ['_retryTickHandle', 'retryTickHandle'],
];

/**
 * Install per-tab forwarding accessors onto a class
 * prototype.
 *
 * Called once at class-definition time. Walks the
 * REACTIVE_FIELDS and NON_REACTIVE_FIELDS lists and
 * defines a getter/setter pair for each. Reactive
 * setters call `requestUpdate(name, oldValue)` so
 * Lit's dirty-check fires; non-reactive setters
 * skip it.
 *
 * The closure captures `tabField` so each accessor
 * routes to the right slot of the tab state
 * object. `this._tabs.get(this._activeTabId)` is
 * the tab state at call time — the active tab can
 * change between successive accesses, which is
 * exactly the behaviour we want (e.g. switching
 * tabs makes `this.messages` return the newly-
 * active tab's messages).
 *
 * @param {Function} proto — the class prototype to
 *   modify. The chat-panel component class passes
 *   `ChatPanel.prototype`.
 */
export function installReactiveAccessors(proto) {
  for (const [propName, tabField] of REACTIVE_FIELDS) {
    Object.defineProperty(proto, propName, {
      configurable: true,
      enumerable: true,
      get() {
        return this._tabs.get(this._activeTabId)[tabField];
      },
      set(value) {
        const tab = this._tabs.get(this._activeTabId);
        const oldValue = tab[tabField];
        tab[tabField] = value;
        this.requestUpdate(propName, oldValue);
      },
    });
  }
  for (const [propName, tabField] of NON_REACTIVE_FIELDS) {
    Object.defineProperty(proto, propName, {
      configurable: true,
      enumerable: true,
      get() {
        return this._tabs.get(this._activeTabId)[tabField];
      },
      set(value) {
        this._tabs.get(this._activeTabId)[tabField] = value;
      },
    });
  }
}