// Static properties declaration for the ChatPanel
// component, extracted from chat-panel.js.
//
// Lit reads `static properties` once at class
// definition time to install reactive-property
// metadata. The block is large (~30 properties, each
// with extensive doc comments explaining per-tab
// scoping and lifecycle semantics) so it lives here
// as a plain exported object.
//
// `noAccessor: true` is set on every per-tab
// property because the actual getter/setter pairs
// are installed onto the prototype by
// `installReactiveAccessors` in state.js — Lit must
// not install its default accessors or the tab-Map
// indirection breaks.
//
// Component-scoped reactive properties (those that
// don't move with the active tab — `repoFiles`,
// `reviewActive`, `_committing`, `_reasoningEnabled`,
// `_mode`, `_crossRefEnabled`, `_tabStripOverflowOpen`)
// use Lit's default accessor path and don't carry
// `noAccessor: true`.

export const PROPERTIES = {
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
   * True when extended-thinking / reasoning mode is on.
   * Component-scoped (not per-tab) — every tab and agent
   * shares the same setting because the toggle is a
   * cost/quality dial the user expresses globally. The
   * value is forwarded into ``LLMService.chat_streaming``
   * as the ``reasoning`` argument; backend layers
   * per-request override on top of ``app.json`` config.
   * Persisted to localStorage under
   * ``ac-dc-reasoning-enabled``. Spec
   * ``specs4/7-future/reasoning.md`` § Recommended Shape
   * — Commit B.
   */
  _reasoningEnabled: { type: Boolean, state: true },
  /**
   * Per-request reasoning effort level for adaptive-thinking
   * models — one of ``minimal``/``low``/``medium``/``high``/
   * ``xhigh``/``max``. Forwarded into
   * ``LLMService.chat_streaming`` as the ``effort`` argument;
   * the backend defers to ``config.reasoning_effort`` when it
   * doesn't recognise the value. Component-scoped like
   * ``_reasoningEnabled`` and persisted to localStorage under
   * ``ac-dc-reasoning-effort`` (default ``xhigh``).
   */
  _reasoningEffort: { type: String, state: true },
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
   * Current primary mode — 'code' or 'doc'. Component-
   * scoped (not per-tab) for now: the backend has one
   * authoritative mode and every tab follows it. When
   * backend gains per-agent mode, this and
   * `_crossRefEnabled` move into `_makeTabState()` and
   * the read/write paths thread through agent_tag.
   * Defaults to 'code' to match the backend.
   */
  _mode: { type: String, state: true },
  /**
   * Cross-reference overlay toggle. Resets to false on
   * every mode switch per specs4/3-llm/modes.md. Same
   * scoping rationale as `_mode`.
   */
  _crossRefEnabled: { type: Boolean, state: true },
  /**
   * Active tab within the URL view dialog. `'content'`
   * shows title + body (summary/readme/content); `'symbols'`
   * shows the symbol map. Only relevant when the fetched
   * URL is a GitHub repo with a symbol map — generic URLs
   * hide the tab bar since there's only one panel to show.
   */
  _urlViewTab: { type: String, state: true, noAccessor: true },
};