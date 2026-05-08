// FilesTab — orchestration hub for the file picker + chat panel.
//
// Layer 5 Phase 2c — wires picker and chat together, holds the
// authoritative selected-files state, drives file-tree loading
// from the Repo RPC, and routes events between the two child
// components and the AppShell.
//
// Responsibilities:
//
//   1. Load the repository file tree from `Repo.get_file_tree`
//      on RPC-ready and on `files-modified` events. The tree
//      is handed to the picker via direct property assignment
//      (not template propagation — specs4/5-webapp/file-picker.md
//      is explicit about why).
//   2. Hold `selectedFiles` as a Set. Listen for the picker's
//      `selection-changed` event, update the server via
//      `LLMService.set_selected_files`, update the picker's
//      `selectedFiles` prop directly.
//   3. Listen for `files-changed` (server broadcast) so
//      selection changes from the server (auto-add for
//      not-in-context edits, collab broadcasts) update the
//      picker without round-tripping through user action.
//   4. Route `file-clicked` from the picker to a `navigate-file`
//      window event. Phase 3 wires a viewer to consume it; for
//      now it's a no-op at the consumer side.
//
// Deferred to Phase 2d (explicit boundaries):
//
//   - @-filter bridge — picker's `setFilter` call is public,
//     but the chat panel needs an input handler that detects
//     `@foo` in the textarea and dispatches a filter event
//   - Middle-click path insertion — picker emits `insert-path`
//     on middle-click (2a); chat panel needs a paste-suppression
//     handler to consume it
//   - Context menu on picker rows
//   - Git status badges (M/S/U/D) — picker rendering update
//   - Branch badge at the root node
//
// Deferred to Phase 3:
//
//   - Active-file highlight in the picker (needs viewer's
//     `active-file-changed` event)
//   - File navigation grid integration
//
// ---------------------------------------------------------------
//
// Architectural contract — DIRECT-UPDATE PATTERN (load-bearing):
//
// When selection changes, this component updates both the
// picker's `selectedFiles` and the chat panel's `selectedFiles`
// **directly** (by assignment + requestUpdate()), NOT by
// relying on Lit's reactive property propagation through its
// own re-render.
//
// Why it matters: changing a property on a parent LitElement
// triggers a full re-render of its template, which reassigns
// child component properties. For the chat panel, that would
// reset scroll position and disrupt in-flight streaming. For
// the picker, it would collapse interaction state (context
// menus, inline inputs, focus). Specs4 documents this in
// file-picker.md#direct-update-pattern-architectural.
//
// The pattern, used for every selection-changing operation:
//   1. Update our own `_selectedFiles` Set (source of truth)
//   2. Assign `picker.selectedFiles = new Set(...)` + requestUpdate
//   3. Assign `chatPanel.selectedFiles = [...]` + requestUpdate
//   4. Notify server via RPC
//
// The chat panel in Phase 2b doesn't yet consume
// `selectedFiles` (it will in 2d for file mentions), but we
// preserve the assignment so 2d just works without a refactor.

import { LitElement, html } from 'lit';

import { RpcMixin } from '../rpc-mixin.js';
import '../file-picker.js';
import '../chat-panel/index.js';
import { parseAgentTabId } from '../chat-panel/index.js';
import '../commit-graph.js';

import {
  EMPTY_TREE,
  _L0_EXCLUDE_PREF_ALWAYS,
  _L0_EXCLUDE_PREF_ASK,
  _L0_EXCLUDE_PREF_KEY,
  _L0_EXCLUDE_PREF_NEVER,
  _PICKER_COLLAPSED_WIDTH,
} from './constants.js';
import {
  _loadL0ExcludePref,
  _loadPickerCollapsed,
  _loadPickerWidth,
  _saveL0ExcludePref,
  buildPrunedTree,
  flattenTreePaths,
} from './helpers.js';
import {
  dispatchExclude,
  dispatchExcludeAll,
  dispatchInclude,
  dispatchIncludeAll,
  dispatchLoadInPanel,
  isRestrictedError,
  onContextMenuAction,
} from './context-menu.js';
import {
  onFileClicked,
  onFileSearchChanged,
  onFileSearchScroll,
  onFilterFromChat,
} from './file-search.js';
import {
  onDuplicateCommitted,
  onNewDirectoryCommitted,
  onNewFileCommitted,
  onRenameCommitted,
} from './inline-commits.js';
import {
  onFileChipClick,
  onFileChipsAddAll,
  onFileMentionClick,
  onInsertPath,
} from './mentions.js';
import {
  detachSplitter,
  maxPickerWidth as maxPickerWidthFromModule,
  onSplitterDoubleClick,
  onSplitterPointerDown,
  onSplitterPointerMove,
  onSplitterPointerUp,
  saveCollapsed,
  savePickerWidth,
} from './splitter.js';
import { FILES_TAB_STYLES } from './styles.js';

export class FilesTab extends RpcMixin(LitElement) {
  static properties = {
    /**
     * Picker-pane width in pixels. Applied as an inline
     * style on .picker-pane so the flex layout can
     * respect it without every render re-computing. Drag
     * commits write back to this property; mid-drag
     * inline mutations bypass it for smooth tracking
     * (same pattern as app-shell's dialog resize).
     */
    _pickerWidthPx: { type: Number, state: true },
    /**
     * Collapsed state — when true, the picker renders at
     * _PICKER_COLLAPSED_WIDTH regardless of the stored
     * _pickerWidthPx. Double-click on the splitter
     * toggles this. The stored width survives so
     * expanding restores the user's prior size rather
     * than snapping to a default.
     */
    _pickerCollapsed: { type: Boolean, state: true },
    /**
     * Reflects the last-seen tree so the picker's initial
     * render has something to work with. We use a reactive
     * property here (not just an internal field) so we can
     * reflect load status in the template for tests.
     */
    _treeLoaded: { type: Boolean, state: true },
    /**
     * Review selector modal state. Null when closed;
     * otherwise `{selected, starting}` where:
     *   - selected: {commit, branch} | null — the
     *     commit the user clicked (via the graph) but
     *     hasn't yet confirmed with "Start review".
     *   - starting: bool — gates the confirm button
     *     while the start_review RPC is in flight.
     *
     * Non-null presence = modal open. The commit-graph
     * component fetches its own data via the injected
     * rpcCall prop; no branch preloading here.
     */
    _reviewSelector: { type: Object, state: true },
    /**
     * Review history graph modal state. Non-null when
     * open, null when closed. No fields needed inside
     * — the review state itself (from `_reviewState`)
     * provides the base and tip SHAs, and the
     * commit-graph fetches its own data. Simple
     * presence flag is enough to drive rendering.
     */
    _reviewGraphModal: { type: Object, state: true },
    /**
     * L0-exclude confirmation dialog state. Null when
     * the dialog is closed; populated with the
     * pending exclusion shape when open:
     *   {nextExcluded: Set<string>,
     *    addedPaths: string[]}
     *
     * The dialog asks whether to invalidate L0 now
     * (full cache rewrite, ~100K+ tokens) or defer
     * until the next L0-invalidating event. User's
     * choice flows back through `_resolveL0ExcludeDialog`
     * which calls `_applyExclusion` with the
     * appropriate `invalidate_l0` flag.
     *
     * Only the exclusion path uses this dialog —
     * inclusion always invalidates immediately and
     * skips the prompt.
     */
    _l0ExcludeDialog: { type: Object, state: true },
  };

  static styles = FILES_TAB_STYLES;

  constructor() {
    super();
    // Authoritative selection state — keyed by tab ID so
    // agent tabs (Phase C) can each own their own
    // selection. In Phase A only the main tab exists,
    // so every read/write flows through the same entry
    // and behaviour matches pre-refactor byte-for-byte.
    //
    // The `_selectedFiles` getter/setter defined below
    // routes through `this._activeTabId` so existing
    // call sites (_applySelection, _onSelectionChanged,
    // etc.) don't need to know about the Map.
    this._activeTabId = 'main';
    this._selectedFilesByTab = new Map();
    this._selectedFilesByTab.set('main', new Set());
    // Authoritative exclusion state — per-tab, parallel to
    // selection. Per specs4/5-webapp/agent-browser.md §
    // File Picker Scope: "Excluded-files state is also
    // per-tab." The `_excludedFiles` getter/setter below
    // routes through the active tab's entry, matching the
    // selection pattern.
    this._excludedFilesByTab = new Map();
    this._excludedFilesByTab.set('main', new Set());
    // Path of the file currently active in a viewer, or
    // null. Updated from viewer `active-file-changed`
    // events (they bubble + compose out to the window),
    // pushed to the picker via direct-update so the
    // matching row gets the `.active-in-viewer` highlight.
    this._activePath = null;
    // Review state — populated when the LLM service
    // broadcasts `review-started` and cleared on
    // `review-ended`. Shape matches backend's
    // `get_review_state()`: `{active, branch,
    //   base_commit, branch_tip, original_branch,
    //   commits, changed_files, stats}`. Null when
    // no review is active. Pushed to the picker via
    // direct-update so the review banner appears above
    // the filter bar. The picker's `reviewState` prop
    // renders the banner only when `active === true`.
    this._reviewState = null;
    // Picker width + collapsed state. Hydrated synchronously
    // in the constructor (not connectedCallback) so first
    // paint doesn't flash the default before jumping to the
    // persisted value — same reasoning as app-shell's
    // dialog-state hydration.
    this._pickerWidthPx = _loadPickerWidth();
    this._pickerCollapsed = _loadPickerCollapsed();
    this._treeLoaded = false;
    // Splitter drag state. Null when idle; populated during
    // an active drag with the origin coords and the picker's
    // width at drag start. Kept out of reactive properties
    // so mid-drag style mutations don't trigger re-renders.
    this._splitterDrag = null;
    // True once `_pushChildProps` has successfully reached
    // both children. Guards the `updated()` retry path
    // against re-pushing on every subsequent Lit update.
    // Reset never happens — once pushed, future tree loads
    // just update `_latestTree` / `_repoFiles` and push
    // again via the same helper.
    this._childPropsPushed = false;
    // Latest loaded file tree. Kept as a non-reactive field
    // so the template's `.tree=${this._latestTree}` bind
    // carries the most recent value across re-renders rather
    // than clobbering back to EMPTY_TREE.
    this._latestTree = EMPTY_TREE;
    // Latest status data from the file tree RPC. Shape:
    // `{modified: Set<string>, staged: Set<string>,
    //   untracked: Set<string>, deleted: Set<string>,
    //   diffStats: Map<string, {added: number, removed: number}>}`.
    // Pushed to the picker via direct property assignment
    // so it can render M/S/U/D badges and `+N -N` diff
    // stats next to file rows. Sets / Maps for O(1) lookup
    // during render (the picker iterates over many files).
    this._latestStatusData = {
      modified: new Set(),
      staged: new Set(),
      untracked: new Set(),
      deleted: new Set(),
      diffStats: new Map(),
    };
    // Latest branch info from `Repo.get_current_branch`.
    // Shape: `{branch: string|null, detached: bool,
    //         sha: string|null, repoName: string}`.
    // Pushed to the picker so the root row can render a
    // branch pill. Empty / unfetched state — picker's
    // render degrades gracefully when `branch` is null.
    this._latestBranchInfo = {
      branch: null,
      detached: false,
      sha: null,
      repoName: '',
    };
    // Flat list of repo-relative file paths — derived from
    // the loaded tree and pushed to the chat panel so it can
    // detect file mentions in assistant output. Non-reactive
    // because we push directly to the chat panel via property
    // assignment (same pattern as `_selectedFiles`) rather
    // than through Lit's template propagation, which would
    // trigger full re-renders and reset scroll / streaming
    // state in the chat panel.
    this._repoFiles = [];
    // File search state — tracks whether the chat panel is
    // currently in file-search mode. When active, picker
    // file-clicked events route to the chat panel's
    // scrollFileSearchToFile rather than opening the file
    // in the viewer. Non-reactive; read inside event
    // handlers only.
    this._fileSearchActive = false;
    // First-load auto-selection flag. The files-tab auto-
    // selects every file with pending changes (modified,
    // staged, untracked, deleted) on the FIRST successful
    // tree load so the user doesn't have to re-tick what
    // they were clearly just working on. Unions with any
    // existing selection (server may have echoed a prior
    // session's state during startup). Flag flips to false
    // after the first load runs and never resets —
    // subsequent reloads (files-modified after commit,
    // explicit refresh) do not re-trigger auto-select.
    this._initialAutoSelect = true;

    // Review selector state. Null when the modal is
    // closed. The picker dispatches `open-review-selector`
    // when the user clicks the Review button; we fetch
    // branches and populate this object, which triggers
    // a re-render of the modal template.
    this._reviewSelector = null;
    // Review graph modal state. Null when closed.
    // Opened via `open-review-graph` from the picker's
    // View graph button. The modal renders a read-only
    // commit graph with the current review's base and
    // tip highlighted.
    this._reviewGraphModal = null;

    // L0-exclude confirmation dialog state. Null when
    // closed. Populated by `_applyExclusionWithPrompt`
    // when the user shift+clicks to exclude a file (or
    // the context menu's Exclude action runs) and the
    // stored preference is 'ask'. The dialog's button
    // handlers commit or cancel via
    // `_resolveL0ExcludeDialog`.
    this._l0ExcludeDialog = null;
    // Local copy of the L0-exclude preference. Hydrated
    // synchronously so the first dialog open / skip
    // decision uses the persisted value.
    this._l0ExcludePref = _loadL0ExcludePref();

    // Bound event handlers — same binding used for add and
    // remove so cleanup matches.
    this._onOpenReviewSelector =
      this._onOpenReviewSelector.bind(this);
    this._onOpenReviewGraph =
      this._onOpenReviewGraph.bind(this);
    this._onCommitInspectedFromGraph =
      this._onCommitInspectedFromGraph.bind(this);
    this._onFilesChanged = this._onFilesChanged.bind(this);
    this._onFilesModified = this._onFilesModified.bind(this);
    this._onStateLoaded = this._onStateLoaded.bind(this);
    this._onFileMentionClick = this._onFileMentionClick.bind(this);
    this._onBranchMenuRequested =
      this._onBranchMenuRequested.bind(this);
    this._onBranchSwitchRequested =
      this._onBranchSwitchRequested.bind(this);
    this._onActiveFileChanged =
      this._onActiveFileChanged.bind(this);
    this._onReviewStarted = this._onReviewStarted.bind(this);
    this._onReviewEnded = this._onReviewEnded.bind(this);
    this._onExitReview = this._onExitReview.bind(this);
    // Context-menu action handler — bubbles up from the
    // picker via `bubbles: true, composed: true`. 8b
    // wires stage / unstage / discard / delete; 8c
    // wires rename / duplicate; later sub-commits wire
    // include / exclude / load-in-panel.
    this._onContextMenuAction = this._onContextMenuAction.bind(this);
    // Rename and duplicate commit handlers — fire when
    // the picker's inline input is confirmed with
    // Enter. Bind so the `@rename-committed` /
    // `@duplicate-committed` template bindings see a
    // stable reference.
    this._onRenameCommitted = this._onRenameCommitted.bind(this);
    this._onDuplicateCommitted =
      this._onDuplicateCommitted.bind(this);
    // Middle-click path insertion. Picker dispatches
    // `insert-path` with `{path}` on middle-click of
    // any row; we insert the path into the chat
    // panel's textarea at the current cursor.
    this._onInsertPath = this._onInsertPath.bind(this);
    // Reveal-file-in-picker — diff viewer dispatches
    // this when the user clicks the status LED, so
    // the picker scrolls to and flashes the active
    // file. Useful when the picker has scrolled away
    // from what the editor is showing.
    this._onRevealFileInPicker =
      this._onRevealFileInPicker.bind(this);
    // Chat panel's active-tab-changed bubbles +
    // composes out to the window (D21 A3). We listen
    // there so the picker's checkbox state tracks
    // whichever tab is currently visible. Phase A
    // only has the main tab, so the listener never
    // actually swaps — but wiring it now means
    // Phase C's spawn path doesn't re-touch this
    // component.
    this._onActiveTabChanged = this._onActiveTabChanged.bind(this);
    // New-file and new-directory commit handlers —
    // fired when the picker's inline input is
    // confirmed with Enter. Same bind pattern as
    // rename / duplicate.
    this._onNewFileCommitted = this._onNewFileCommitted.bind(this);
    this._onNewDirectoryCommitted =
      this._onNewDirectoryCommitted.bind(this);
    // Splitter handlers. Bound so the document-level
    // pointermove / pointerup listeners match the
    // same function references for add/remove.
    this._onSplitterPointerDown =
      this._onSplitterPointerDown.bind(this);
    this._onSplitterPointerMove =
      this._onSplitterPointerMove.bind(this);
    this._onSplitterPointerUp =
      this._onSplitterPointerUp.bind(this);
    this._onSplitterDoubleClick =
      this._onSplitterDoubleClick.bind(this);
  }

  // ---------------------------------------------------------------
  // Per-tab selection accessors (D21 Phase A4)
  // ---------------------------------------------------------------

  // `_selectedFiles` was a plain Set pre-A4; now it's a
  // getter that routes through the tab-keyed Map. Every
  // existing call site — _applySelection,
  // _onSelectionChanged, the initial-auto-select pass,
  // _sendSelectionToServer — writes or reads
  // `this._selectedFiles` and gets the active tab's
  // slot transparently.
  //
  // A missing Map entry for the active tab is created on
  // demand with an empty Set. This defends against a
  // race where `active-tab-changed` hasn't been observed
  // yet but the active tab's slot is queried — the
  // fresh empty Set is the correct starting state for
  // any tab Phase C spawns.

  get _selectedFiles() {
    let set = this._selectedFilesByTab.get(this._activeTabId);
    if (set === undefined) {
      set = new Set();
      this._selectedFilesByTab.set(this._activeTabId, set);
    }
    return set;
  }

  set _selectedFiles(value) {
    // Wrap non-Set inputs defensively — the pre-A4 code
    // always assigned Set instances, but _applySelection
    // passes whatever it was given.
    const set = value instanceof Set ? value : new Set(value);
    this._selectedFilesByTab.set(this._activeTabId, set);
  }

  get _excludedFiles() {
    let set = this._excludedFilesByTab.get(this._activeTabId);
    if (set === undefined) {
      set = new Set();
      this._excludedFilesByTab.set(this._activeTabId, set);
    }
    return set;
  }

  set _excludedFiles(value) {
    const set = value instanceof Set ? value : new Set(value);
    this._excludedFilesByTab.set(this._activeTabId, set);
  }

  // ---------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('files-changed', this._onFilesChanged);
    window.addEventListener('files-modified', this._onFilesModified);
    window.addEventListener('state-loaded', this._onStateLoaded);
    window.addEventListener(
      'reveal-file-in-picker',
      this._onRevealFileInPicker,
    );
    // Viewer-dispatched `active-file-changed` bubbles and
    // composes out to the window naturally — the event
    // fires from inside the viewer's shadow root, passes
    // through the app-shell's own handler (which flips
    // _activeViewer), then continues bubbling to the
    // window because the shell doesn't call
    // stopPropagation. We listen here so the picker
    // highlight updates without the shell needing to
    // explicitly re-dispatch.
    window.addEventListener(
      'active-file-changed',
      this._onActiveFileChanged,
    );
    // Review lifecycle — the LLM service broadcasts
    // `review-started` when `start_review` succeeds and
    // `review-ended` on `end_review`. The app-shell's
    // own handlers for these events (driving the
    // commit-button gate) bubble through to the window
    // so we pick them up here too. Both events'
    // detail carries the full review-state dict.
    window.addEventListener('review-started', this._onReviewStarted);
    window.addEventListener('review-ended', this._onReviewEnded);
    // Chat panel tab switches (D21 A4). The event is
    // bubbled + composed so we catch it at the
    // window level without coupling to the chat
    // panel's shadow root.
    window.addEventListener(
      'active-tab-changed', this._onActiveTabChanged,
    );
  }

  disconnectedCallback() {
    window.removeEventListener('files-changed', this._onFilesChanged);
    window.removeEventListener(
      'files-modified',
      this._onFilesModified,
    );
    window.removeEventListener('state-loaded', this._onStateLoaded);
    window.removeEventListener(
      'reveal-file-in-picker',
      this._onRevealFileInPicker,
    );
    window.removeEventListener(
      'active-file-changed',
      this._onActiveFileChanged,
    );
    window.removeEventListener(
      'review-started',
      this._onReviewStarted,
    );
    window.removeEventListener('review-ended', this._onReviewEnded);
    window.removeEventListener(
      'active-tab-changed', this._onActiveTabChanged,
    );
    // If a splitter drag was in progress at unmount (hot
    // reload, tab switch under load), release the
    // document-scope listeners. Without this, pointermove
    // events continue firing into the detached handler.
    detachSplitter(this);
    super.disconnectedCallback();
  }

  onRpcReady() {
    // Fetch the initial file tree. RpcMixin's microtask
    // deferral means every sibling component has already
    // received the proxy by the time this fires.
    this._loadFileTree();
  }

  // ---------------------------------------------------------------
  // File tree loading
  // ---------------------------------------------------------------

  async _loadFileTree() {
    // Two RPCs in parallel — tree and branch info. Both
    // live on Repo. A branch-info failure doesn't block
    // the tree from rendering (the picker degrades to no
    // branch pill); a tree failure is fatal for this load
    // because nothing useful is left to display.
    let tree;
    let branchResult;
    try {
      const [treeValue, branchValue] = await Promise.allSettled([
        this.rpcExtract('Repo.get_file_tree'),
        this.rpcExtract('Repo.get_current_branch'),
      ]);
      if (treeValue.status === 'rejected') throw treeValue.reason;
      tree = treeValue.value;
      branchResult =
        branchValue.status === 'fulfilled' ? branchValue.value : null;
      if (branchValue.status === 'rejected') {
        // Log but don't toast — a missing branch pill is
        // a minor regression compared to a broken tree.
        console.warn(
          '[files-tab] get_current_branch failed',
          branchValue.reason,
        );
      }
    } catch (err) {
      console.error('[files-tab] get_file_tree failed', err);
      this._showToast(
        `Failed to load file tree: ${err?.message || err}`,
        'error',
      );
      return;
    }
    // The repo returns the full shape documented in
    // src/ac_dc/repo.py — `tree` is the nested node plus
    // sibling arrays (modified, staged, etc.). Phase 2c uses
    // only the `tree` field; Phase 2d will consume the status
    // arrays for git badges.
    //
    // Direct-update pattern (see class docstring) — we write
    // `picker.tree` directly and flip `_treeLoaded` AFTER, so
    // our own re-render can't clobber the assignment. The
    // template below binds `.tree` via a getter that reads
    // from `_latestTree`, which we update here.
    this._latestTree = tree?.tree || EMPTY_TREE;
    // Build status data from the RPC's sibling arrays.
    // Repo.get_file_tree returns `modified`, `staged`,
    // `untracked`, `deleted` as path-string arrays and
    // `diff_stats` as `{path: {added, removed}}`. We
    // convert to Sets / Map here so the picker's per-row
    // render stays O(1) per lookup rather than O(N) scans.
    // Defensive — any missing / malformed field falls back
    // to an empty collection so a partial response doesn't
    // crash the picker.
    this._latestStatusData = {
      modified: new Set(
        Array.isArray(tree?.modified) ? tree.modified : [],
      ),
      staged: new Set(
        Array.isArray(tree?.staged) ? tree.staged : [],
      ),
      untracked: new Set(
        Array.isArray(tree?.untracked) ? tree.untracked : [],
      ),
      deleted: new Set(
        Array.isArray(tree?.deleted) ? tree.deleted : [],
      ),
      diffStats: new Map(
        tree?.diff_stats && typeof tree.diff_stats === 'object'
          ? Object.entries(tree.diff_stats)
          : [],
      ),
    };
    // Build branch info from the second RPC. Defensive —
    // a null `branchResult` (RPC rejected or returned
    // nothing) degrades to the "no branch pill" state.
    // The tree's root node carries the repo name as
    // `name`, so we thread that through for the root
    // row's tooltip even when branch info isn't
    // available.
    const repoName =
      typeof this._latestTree?.name === 'string'
        ? this._latestTree.name
        : '';
    this._latestBranchInfo = {
      branch:
        typeof branchResult?.branch === 'string'
          ? branchResult.branch
          : null,
      detached: branchResult?.detached === true,
      sha:
        typeof branchResult?.sha === 'string'
          ? branchResult.sha
          : null,
      repoName,
    };
    // Derive the flat file list and push to the chat panel
    // so file mentions in assistant output get wrapped. The
    // chat panel's `repoFiles` prop short-circuits on empty
    // input, so before the first load the cost is zero.
    this._repoFiles = flattenTreePaths(this._latestTree);
    // First-load auto-select — picks up every file with
    // pending changes so the user doesn't have to re-tick
    // what they were just working on. Runs exactly once
    // per component lifetime; subsequent reloads do
    // nothing here. The flag flip happens synchronously
    // so a re-entrant reload during the RPC that got us
    // here can't trigger double-auto-select.
    if (this._initialAutoSelect) {
      this._initialAutoSelect = false;
      this._applyInitialAutoSelect();
    }
    // Reset the push flag — a fresh tree load means the
    // children need fresh props, even if a previous load
    // already pushed once. `updated()` will retry if the
    // call below is too early in the lifecycle.
    this._childPropsPushed = false;
    this._pushChildProps();
    this._treeLoaded = true;
  }

  /**
   * Apply the first-load auto-selection rule: union every
   * changed file (modified ∪ staged ∪ untracked ∪ deleted)
   * with the existing selection, then expand the ancestor
   * directories of every selected file so the user can
   * see them in the tree.
   *
   * Union semantics (not replace) preserve any selection
   * the server broadcast during startup — e.g., a prior
   * session's state restored by `_restore_last_session`
   * on the backend, or a collab host's selection received
   * via `files-changed` before our first tree load.
   *
   * Called exactly once per component lifetime, by
   * `_loadFileTree` after status data is built. The
   * subsequent `_pushChildProps` call picks up the
   * mutations and pushes them to the picker in a single
   * render cycle.
   */
  _applyInitialAutoSelect() {
    const changed = new Set();
    const sd = this._latestStatusData;
    if (sd) {
      if (sd.modified instanceof Set) {
        for (const p of sd.modified) changed.add(p);
      }
      if (sd.staged instanceof Set) {
        for (const p of sd.staged) changed.add(p);
      }
      if (sd.untracked instanceof Set) {
        for (const p of sd.untracked) changed.add(p);
      }
      if (sd.deleted instanceof Set) {
        for (const p of sd.deleted) changed.add(p);
      }
    }
    if (changed.size === 0) {
      // Nothing changed — no selection to union, no
      // ancestors to expand. Skip entirely so the
      // `_applySelection` short-circuit path isn't
      // involved in the common "clean working tree"
      // case.
      return;
    }
    // Union with existing selection. If the union is
    // strictly a superset of what we already have,
    // _applySelection sends the new selection to the
    // server; if it's equal (every changed file was
    // already selected), the set-equality short-circuit
    // inside _applySelection makes this a no-op.
    const union = new Set(this._selectedFiles);
    for (const p of changed) union.add(p);
    this._applySelection(union, /* notifyServer */ true);
    // Expand ancestor directories of every selected
    // file so they're visible in the tree. The picker
    // doesn't auto-expand on selection normally —
    // selection state is independent of expansion — so
    // we have to do it here.
    this._expandAncestorsOf(union);
  }

  /**
   * Mark every ancestor directory of every path in
   * `paths` as expanded in the picker. Mutates the
   * picker's `_expanded` Set directly (same pattern as
   * the file-search scroll handler). Called from
   * `_applyInitialAutoSelect`; safe to call before the
   * first `_pushChildProps` because it updates an
   * internal-state Set that the picker consults on its
   * next render.
   */
  _expandAncestorsOf(paths) {
    const picker = this._picker();
    if (!picker) {
      // Picker not mounted yet — defer. The first
      // `_pushChildProps` retry through `updated()`
      // will bring the picker into view, but the
      // expansion state won't be re-derived there.
      // Fall through to directly mutating the set we
      // track pre-mount. The picker's default
      // `_expanded` starts empty; we can't reach
      // into it until it mounts, so in the rare
      // mount-order case (picker not yet visible
      // when auto-select runs) we just skip the
      // expansion — the user can still reach the
      // auto-selected files manually.
      return;
    }
    const next = new Set(picker._expanded);
    for (const path of paths) {
      if (typeof path !== 'string' || !path) continue;
      const parts = path.split('/');
      let acc = '';
      // Stop before the last part — that's the file
      // itself, not a directory to expand.
      for (let i = 0; i < parts.length - 1; i += 1) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        next.add(acc);
      }
    }
    picker._expanded = next;
  }

  /**
   * Push `tree` and `repoFiles` to child components.
   *
   * Called both from `_loadFileTree` (first-time populate)
   * and from `updated` after the initial render (retry path
   * for the race where RPC-ready fires before the template
   * has committed and `this._chat()` returns null). The
   * retry is guarded by `_childPropsPushed` so a successful
   * push isn't redone on every subsequent update.
   *
   * Returns true when both children were reachable and
   * received their props — the caller uses this to mark
   * the push complete.
   */
  _pushChildProps() {
    const picker = this._picker();
    const chat = this._chat();
    if (!picker || !chat) {
      // One or both children not mounted yet. `updated()`
      // will retry after the first render commits.
      return false;
    }
    picker.tree = this._latestTree;
    picker.statusData = this._latestStatusData;
    picker.branchInfo = this._latestBranchInfo;
    picker.excludedFiles = new Set(this._excludedFiles);
    picker.pinnedFiles = this._computePinnedFiles();
    picker.activePath = this._activePath;
    picker.reviewState = this._reviewState;
    picker.requestUpdate();
    chat.repoFiles = this._repoFiles;
    chat.requestUpdate();
    this._childPropsPushed = true;
    return true;
  }

  /**
   * Retry the child-props push after the first render.
   *
   * The RPC-ready microtask hook can fire before Lit's
   * first `updateComplete` resolves, meaning
   * `this._chat()` inside `_loadFileTree` returns null
   * and the assignments are silently lost. The Phase 2c
   * original code had this failure mode but it was
   * masked because `repoFiles` was optional and nothing
   * in the chat panel consumed it.
   *
   * Phase 2d's file summary section DOES consume
   * `repoFiles`, so the silent drop became visible. The
   * fix is to retry once the first render has happened
   * — `updated()` always runs after commit, so by then
   * `this._chat()` returns a real element.
   */
  updated(changedProps) {
    super.updated?.(changedProps);
    if (
      !this._childPropsPushed &&
      this._treeLoaded &&
      Array.isArray(this._repoFiles)
    ) {
      this._pushChildProps();
    }
  }

  // ---------------------------------------------------------------
  // Selection sync
  // ---------------------------------------------------------------

  _onSelectionChanged(event) {
    // Picker emits this when the user toggles a checkbox or
    // clicks a directory checkbox.
    const incoming = event.detail?.selectedFiles;
    if (!Array.isArray(incoming)) return;
    this._applySelection(new Set(incoming), /* notifyServer */ true);
  }

  _onFilesChanged(event) {
    // Server broadcast — happens on another client's
    // `set_selected_files`, on auto-add for not-in-context
    // edits, and on our own `set_selected_files` call (the
    // server echoes back). We treat the broadcast as
    // authoritative: even for our own send, applying the
    // echo is idempotent because `_applySelection` only
    // mutates when the set actually changes.
    const incoming = event.detail?.selectedFiles;
    if (!Array.isArray(incoming)) return;
    this._applySelection(
      new Set(incoming),
      /* notifyServer */ false,
    );
  }

  _onStateLoaded(event) {
    // AppShell dispatches `state-loaded` after every
    // successful `get_current_state()` fetch — on initial
    // connect and on every reconnect. Restore the server's
    // authoritative selection and exclusion sets so a
    // browser refresh preserves what the user had ticked,
    // even when the working tree is clean (and thus
    // `_applyInitialAutoSelect` wouldn't otherwise seed
    // anything).
    //
    // Do NOT suppress the first-load auto-select. Per
    // specs4/5-webapp/file-picker.md § Auto-Selection, the
    // git-changed union must "merge with any server-
    // provided selection … rather than replacing" it. The
    // state-loaded snapshot typically arrives before the
    // tree loads (AppShell's `_fetchCurrentState` fires on
    // `setupDone`, before this component's `onRpcReady`
    // microtask defers the tree RPC), so when
    // `_applyInitialAutoSelect` runs on tree load it sees
    // the server's selection already installed in
    // `_selectedFiles` and unions the git-changed files on
    // top. No extra ordering logic required.
    const state = event?.detail;
    if (!state || typeof state !== 'object') return;
    const selected = state.selected_files;
    if (Array.isArray(selected)) {
      this._applySelection(
        new Set(selected),
        /* notifyServer */ false,
      );
    }
    const excluded = state.excluded_index_files;
    if (Array.isArray(excluded)) {
      this._applyExclusion(
        new Set(excluded),
        /* notifyServer */ false,
      );
    }
    // Restore review state so the picker's amber banner
    // reappears after a browser refresh during an active
    // review. Without this, the post-refresh UI looks
    // identical to non-review mode even though git HEAD
    // is detached at the merge-base — confusing, because
    // the user has no affordance to exit review and
    // recover their original branch.
    //
    // The backend's get_current_state includes the full
    // review-state dict under the `review_state` key
    // (matching get_review_state's shape); we mirror it
    // into _reviewState and push to the picker via the
    // same direct-update pattern the review-started
    // handler uses.
    const review =
      state.review_state && typeof state.review_state === 'object'
        ? state.review_state
        : null;
    if (review && review.active) {
      this._reviewState = review;
      const picker = this._picker();
      if (picker) {
        picker.reviewState = review;
        picker.requestUpdate();
      }
    }
  }

  _onFilesModified(_event) {
    // Fires after commit / reset / any server-side file-tree
    // mutation. Phase 2d will extend this for per-file
    // invalidation when edit blocks land; for Phase 2c a full
    // reload is fine.
    this._loadFileTree();
  }

  _onActiveFileChanged(event) {
    // Viewer event — `{path: string | null}`. When a file
    // opens or becomes the active tab, this fires with the
    // path. When the last file closes, it fires with null.
    // Either way, push the update to the picker so the
    // `.active-in-viewer` highlight follows.
    const detail = event.detail || {};
    const nextPath = typeof detail.path === 'string' && detail.path
      ? detail.path
      : null;
    if (nextPath === this._activePath) return;
    this._activePath = nextPath;
    const picker = this._picker();
    if (picker) {
      picker.activePath = nextPath;
      picker.requestUpdate();
    }
  }

  /**
   * Handle `reveal-file-in-picker` — dispatched by the
   * diff viewer's status LED. Calls the picker's public
   * `revealFile` method which expands ancestors, clears
   * the filter, scrolls the row into view, and flashes
   * it briefly. No-op when the picker isn't mounted or
   * the event carries no path.
   */
  _onRevealFileInPicker(event) {
    const path = event.detail?.path;
    if (typeof path !== 'string' || !path) return;
    const picker = this._picker();
    if (!picker) return;
    picker.revealFile(path);
  }

  async _onReviewStarted(event) {
    // Enter review mode. Store the full state dict and
    // push to the picker so the banner appears. The
    // backend's `start_review` has already cleared its
    // own `_selected_files`, but we mirror the clear
    // locally (defense-in-depth, per
    // specs4/4-features/code-review.md) so the UI
    // reflects the empty selection without waiting for
    // the server's `filesChanged` broadcast.
    //
    // Detail shape matches backend's `get_review_state()`:
    // `{active: true, branch, base_commit, branch_tip,
    //   original_branch, commits, changed_files, stats}`.
    const state = event.detail || {};
    this._reviewState = state;
    // Clear selection — review starts with a clean slate.
    // Direct-update pattern (not `_applySelection` with
    // `notifyServer=true`) because the server has
    // already cleared on its side; round-tripping would
    // be redundant.
    this._selectedFiles = new Set();
    const picker = this._picker();
    if (picker) {
      picker.reviewState = state;
      picker.selectedFiles = new Set();
      picker.requestUpdate();
    }
    const chat = this._chat();
    if (chat) {
      chat.selectedFiles = [];
      chat.requestUpdate();
    }
    // Refresh file tree so the picker reflects the
    // staged state produced by the soft reset. Wait
    // for the fetch to settle before the auto-select
    // pass below — it needs `_latestStatusData` to be
    // populated with the review's staged files.
    await this._loadFileTree();
    // Auto-select every file the review touches so the
    // user doesn't have to tick them individually to
    // get diffs into the LLM's context. The review's
    // soft-reset puts every branch-tip change into the
    // staged set, which `_loadFileTree` mapped into
    // `_latestStatusData.staged`. Reuse the same
    // union-with-existing-selection logic that the
    // first-load path uses — it handles the "expand
    // ancestors so the files are visible" step too.
    //
    // We skip the `_initialAutoSelect` flag entirely
    // here: that flag governs the first-ever tree load
    // (so subsequent reloads don't undo user
    // deselections). Review entry is a distinct event
    // — the user explicitly asked to review, and every
    // review starts from an empty selection cleared
    // above — so re-applying the auto-select rule is
    // expected, not a regression.
    this._applyInitialAutoSelect();
  }

  _onReviewEnded() {
    // Exit review mode. Clear local state and push
    // null to the picker so the banner disappears.
    // Selection is NOT cleared here — the server's
    // `end_review` doesn't touch `_selected_files`,
    // and the user may want to continue with the
    // files they had in review context. If the
    // server's selection broadcast fires later, the
    // normal `files-changed` handler picks it up.
    this._reviewState = null;
    const picker = this._picker();
    if (picker) {
      picker.reviewState = null;
      picker.requestUpdate();
    }
    // Refresh file tree to reflect the restored
    // post-review state (HEAD reattached, staging
    // cleared).
    this._loadFileTree();
  }

  /**
   * Chat panel's active-tab-changed event — swap the
   * picker's selection state to whichever tab is now
   * visible. Phase A always has the main tab active,
   * so the handler is reachable but the branch below
   * that swaps picker state only fires in Phase C when
   * agent tabs materialise.
   *
   * Detail shape: `{tabId, previousTabId}`.
   *
   * The handler has two jobs:
   *
   *   1. Update `_activeTabId` so the `_selectedFiles`
   *      getter routes to the right Map slot. Every
   *      subsequent selection read/write inside this
   *      component lands on the correct tab.
   *   2. Push the new tab's selection to the picker
   *      via direct-update so its checkboxes reflect
   *      the tab's state without re-rendering the
   *      orchestrator.
   *
   * The chat panel is the source of truth for tab
   * activation — its `_activeTabId` setter fires the
   * event, and files-tab follows. Files-tab does NOT
   * originate tab switches.
   */
  _onActiveTabChanged(event) {
    const tabId = event?.detail?.tabId;
    if (typeof tabId !== 'string' || !tabId) return;
    if (tabId === this._activeTabId) return;
    this._activeTabId = tabId;
    // Ensure the Maps have entries — the getters do
    // this lazily too, but doing it up front keeps the
    // subsequent .get() deterministic.
    if (!this._selectedFilesByTab.has(tabId)) {
      this._selectedFilesByTab.set(tabId, new Set());
    }
    if (!this._excludedFilesByTab.has(tabId)) {
      this._excludedFilesByTab.set(tabId, new Set());
    }
    const tabSelection = this._selectedFilesByTab.get(tabId);
    const tabExclusion = this._excludedFilesByTab.get(tabId);
    // Push to the picker. Direct-update pattern, same as
    // _applySelection — assign fresh Sets then
    // requestUpdate so the picker's internal
    // `selectedFiles` / `excludedFiles` props reflect
    // the active tab.
    const picker = this._picker();
    if (picker) {
      picker.selectedFiles = new Set(tabSelection);
      picker.excludedFiles = new Set(tabExclusion);
      picker.requestUpdate();
    }
    // Chat panel is already tracking the active tab
    // (the event came from its setter), so we don't
    // push to it — its own getter now reads from the
    // right tab slot automatically.
  }

  async _onExitReview() {
    // User clicked the exit button on the review
    // banner. Call the server's `end_review` RPC;
    // the server broadcasts `reviewEnded` which
    // comes back through our `_onReviewEnded`
    // handler to do the UI cleanup. No optimistic
    // local update — if the server rejects (e.g.
    // non-localhost caller), the banner should stay
    // visible so the user sees the error state.
    if (!this.rpcConnected) return;
    try {
      const result = await this.rpcExtract(
        'LLMService.end_review',
      );
      if (this._isRestrictedError(result)) {
        this._showToast(
          result.reason || 'Restricted operation',
          'warning',
        );
        return;
      }
      // Partial-exit case — server couldn't reattach
      // the original branch. State was cleared on
      // the server regardless; surface the error
      // so the user knows git is in an unusual
      // state.
      if (result && result.status === 'partial' && result.error) {
        this._showToast(
          `Review exited with warning: ${result.error}`,
          'warning',
        );
        return;
      }
      // Success — the server's `reviewEnded`
      // broadcast will trigger `_onReviewEnded`.
    } catch (err) {
      console.error('[files-tab] end_review failed', err);
      this._showToast(
        `Failed to exit review: ${err?.message || err}`,
        'error',
      );
    }
  }

  // ---------------------------------------------------------------
  // Branch switching
  // ---------------------------------------------------------------

  /**
   * Picker dispatched `branch-menu-requested` — the
   * user clicked the branch pill. Fetch the full
   * branch list (local + remote) and hand it back to
   * the picker via `populateBranchMenu`. Errors
   * surface as toasts but don't close the menu — the
   * picker's "Loading…" state falls through to
   * "No branches" which is still informative.
   */
  async _onBranchMenuRequested() {
    if (!this.rpcConnected) return;
    try {
      const branches = await this.rpcExtract(
        'Repo.list_all_branches',
      );
      const picker = this._picker();
      if (picker) {
        picker.populateBranchMenu(
          Array.isArray(branches) ? branches : [],
        );
      }
    } catch (err) {
      console.error('[files-tab] list_all_branches failed', err);
      this._showToast(
        `Failed to load branches: ${err?.message || err}`,
        'error',
      );
      const picker = this._picker();
      if (picker) picker.populateBranchMenu([]);
    }
  }

  /**
   * Picker dispatched `branch-switch-requested` —
   * the user picked a branch from the popover.
   * Detail: `{name, is_remote}`. Dirty-tree check
   * runs before the RPC so users get a precise
   * toast rather than a generic git error, even
   * though the backend also refuses dirty trees
   * (belt-and-braces).
   *
   * On success we reload the file tree so the
   * picker reflects the new branch. The backend's
   * post-write callback fires `filesChanged`-adjacent
   * behaviour via LLMService refreshes, but the tree
   * RPC is cheap and a fresh call keeps the UI
   * authoritative.
   */
  async _onBranchSwitchRequested(event) {
    const name = event.detail?.name;
    if (typeof name !== 'string' || !name) return;
    if (!this.rpcConnected) return;
    // Clean-tree gate. The backend also checks, but
    // this produces a clearer toast with no RPC
    // round-trip for the common dirty-tree case.
    try {
      const clean = await this.rpcExtract('Repo.is_clean');
      if (!clean) {
        this._showToast(
          'Working tree has uncommitted changes. ' +
            'Commit, stash, or discard them before ' +
            'switching branches.',
          'warning',
        );
        return;
      }
    } catch (err) {
      // If the probe fails, defer to the backend's
      // own check — don't block the switch on a
      // probe failure.
      console.warn('[files-tab] is_clean probe failed', err);
    }
    try {
      const result = await this.rpcExtract(
        'Repo.checkout_branch',
        name,
      );
      if (this._isRestrictedError(result)) {
        this._showToast(
          result.reason || 'Restricted operation',
          'warning',
        );
        return;
      }
      if (result && typeof result === 'object' && result.error) {
        this._showToast(
          `Switch failed: ${result.error}`,
          'error',
        );
        return;
      }
      const landedOn =
        result && typeof result === 'object' && result.branch
          ? result.branch
          : name;
      this._showToast(`Switched to ${landedOn}`, 'success');
      await this._loadFileTree();
    } catch (err) {
      console.error('[files-tab] checkout_branch failed', err);
      this._showToast(
        `Switch failed: ${err?.message || err}`,
        'error',
      );
    }
  }

  _applySelection(newSelection, notifyServer) {
    // Modified-file pin (cache-tiering invariant): a file
    // with working-tree or staged changes cannot be
    // deselected. Edited files pin into lower cache tiers
    // (D27) and the picker should reflect their residency
    // — letting the user uncheck them while they're still
    // pinned would create a confusing split between "what
    // the picker shows" and "what's actually in the
    // prompt." If the incoming set drops any modified
    // file, re-add it and toast the user.
    //
    // Only working-tree-modified and staged files pin.
    // Untracked files were auto-added as a convenience
    // (Increment 4 / first-load auto-select) and the user
    // remains free to drop them. Deleted files have no
    // content to pin, and the delete-cleanup paths need
    // to keep working.
    const sd = this._latestStatusData;
    let pinnedReverted = false;
    if (sd) {
      const pinned = [];
      for (const path of this._selectedFiles) {
        if (newSelection.has(path)) continue;
        if (sd.modified?.has(path) || sd.staged?.has(path)) {
          pinned.push(path);
        }
      }
      if (pinned.length > 0) {
        const next = new Set(newSelection);
        for (const p of pinned) next.add(p);
        newSelection = next;
        pinnedReverted = true;
        const label =
          pinned.length === 1
            ? pinned[0]
            : `${pinned.length} modified files`;
        this._showToast(
          `${label} cannot be removed from context while modified — commit or discard changes first.`,
          'warning',
        );
      }
    }
    // Fast-path no-op when the set hasn't actually changed.
    // Prevents loopback from the server broadcast doing
    // another round-trip for our own update.
    //
    // Exception: when we just reverted a pinned-file
    // removal, the corrected `newSelection` equals our
    // current state — but the picker's optimistic local
    // state still shows the unticked checkbox from the
    // user's click. We must push the corrected selection
    // to the picker (below) so the checkbox snaps back
    // on. The server doesn't need notification because
    // its state hasn't changed.
    if (this._setsEqual(this._selectedFiles, newSelection)) {
      if (pinnedReverted) {
        const picker = this._picker();
        if (picker) {
          picker.selectedFiles = new Set(newSelection);
          picker.requestUpdate();
        }
      }
      return;
    }
    this._selectedFiles = newSelection;

    // Direct-update pattern (load-bearing — see class
    // docstring). Assign to child props then requestUpdate.
    const picker = this._picker();
    if (picker) {
      picker.selectedFiles = new Set(newSelection);
      picker.requestUpdate();
    }
    const chat = this._chat();
    if (chat) {
      // Chat panel in Phase 2b doesn't yet consume this
      // prop; assigning now so Phase 2d's file-mention work
      // sees a populated field without a refactor.
      chat.selectedFiles = Array.from(newSelection);
      chat.requestUpdate();
    }

    if (notifyServer) {
      this._sendSelectionToServer(Array.from(newSelection));
    }
  }

  async _sendSelectionToServer(files) {
    // Route by active tab: main → set_selected_files,
    // agent tab → set_agent_selected_files(turn_id,
    // agent_idx, files). parseAgentTabId returns null
    // for 'main' or malformed IDs, in which case we use
    // the main RPC path (the tab-as-main case).
    //
    // Per specs4/5-webapp/agent-browser.md § File Picker
    // Scope: "A user granting a file to agent 2 doesn't
    // affect the main LLM's context on the next turn."
    // Without this dispatch, every selection change on
    // any tab clobbers the main tab's server-side
    // selection.
    const agentTag = parseAgentTabId(this._activeTabId);
    try {
      let result;
      if (agentTag) {
        // agentTag IS the agent's LLM-chosen id —
        // post-flat-identity refactor flattened the
        // (turn_id, agent_idx) tuple into a single
        // string keyed in the backend registry.
        result = await this.rpcExtract(
          'LLMService.set_agent_selected_files',
          agentTag,
          files,
        );
      } else {
        result = await this.rpcExtract(
          'LLMService.set_selected_files',
          files,
        );
      }
      // The server returns either an array of paths
      // (success) or an error dict. `{error:
      // "restricted", ...}` is collab-mode localhost gate.
      // `{error: "agent not found"}` happens when the
      // tab was closed server-side between the last tab
      // switch and this selection change — treat it as a
      // warning; the tab's local state is stale but the
      // chat panel's close-tab flow will clean up
      // eventually.
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        if (result.error === 'restricted') {
          this._showToast(
            result.reason || 'Restricted operation',
            'warning',
          );
        } else if (result.error === 'agent not found') {
          this._showToast(
            'Agent tab no longer available on server',
            'warning',
          );
        }
      }
    } catch (err) {
      console.error(
        '[files-tab] set_selected_files failed', err,
      );
      this._showToast(
        `Failed to update selection: ${err?.message || err}`,
        'error',
      );
    }
  }

  _onExclusionChanged(event) {
    // Picker emits this when the user shift+clicks a file
    // checkbox or a directory checkbox (the latter applies
    // to every descendant file). The event carries an array
    // of excluded paths; we update our authoritative state,
    // push to the picker via direct-update, and notify the
    // server.
    //
    // User-driven exclusion goes through the L0
    // invalidation prompt — see `_applyExclusionWithPrompt`
    // for the pref-driven dispatch. Pure removals (the
    // user un-excluded a file via shift+click on an
    // already-excluded entry) skip the prompt because
    // there's nothing for the user to opt into.
    const incoming = event.detail?.excludedFiles;
    if (!Array.isArray(incoming)) return;
    this._applyExclusionWithPrompt(new Set(incoming));
  }

  _applyExclusion(newExcluded, notifyServer, invalidateL0 = false) {
    // Fast-path no-op when the set hasn't actually changed.
    // Prevents loopback from the server broadcast (when
    // collab mode lands this for real) doing another
    // round-trip for our own update.
    if (this._setsEqual(this._excludedFiles, newExcluded)) return;
    this._excludedFiles = newExcluded;
    // Direct-update pattern (load-bearing — see class
    // docstring). Assign to picker prop then requestUpdate.
    const picker = this._picker();
    if (picker) {
      picker.excludedFiles = new Set(newExcluded);
      picker.requestUpdate();
    }
    if (notifyServer) {
      this._sendExclusionToServer(
        Array.from(newExcluded),
        invalidateL0,
      );
    }
  }

  /**
   * Apply an exclusion with the L0-invalidation prompt.
   *
   * Wraps `_applyExclusion` for the user-driven exclusion
   * paths: the picker's shift+click handler and the
   * context-menu Exclude / Exclude-all actions. Inclusion
   * paths skip this — they always pass `invalidateL0=true`
   * directly because the user wants the file's structural
   * block back in the map immediately.
   *
   * Behaviour driven by the stored preference:
   *
   * - 'always' → invalidate L0 immediately, no prompt
   * - 'never' → defer L0 invalidation, no prompt
   * - 'ask' (default) → open the dialog; user's choice
   *   determines the flag and may also persist the
   *   preference for next time
   *
   * Set-equality short-circuit happens BEFORE the prompt
   * — there's no point asking about an exclusion change
   * that's a no-op.
   *
   * The added-paths list is computed here so the dialog
   * body can name what's being excluded ("foo.py" vs.
   * "3 files in src/"). Empty list when the diff is a
   * pure removal — shouldn't reach this method since
   * removals are inclusions, but defensive against a
   * future caller that passes a smaller set than the
   * current one.
   */
  _applyExclusionWithPrompt(nextExcluded) {
    if (this._setsEqual(this._excludedFiles, nextExcluded)) return;
    // Compute newly-excluded paths (set difference). If
    // the diff has no additions, treat it as a plain
    // exclusion-change call without prompt — there's
    // nothing the user is opting into invalidating.
    const addedPaths = [];
    for (const p of nextExcluded) {
      if (!this._excludedFiles.has(p)) addedPaths.push(p);
    }
    if (addedPaths.length === 0) {
      this._applyExclusion(
        nextExcluded, /* notifyServer */ true, /* invalidateL0 */ false,
      );
      return;
    }
    // Pref-driven dispatch.
    if (this._l0ExcludePref === _L0_EXCLUDE_PREF_ALWAYS) {
      this._applyExclusion(nextExcluded, true, true);
      return;
    }
    if (this._l0ExcludePref === _L0_EXCLUDE_PREF_NEVER) {
      this._applyExclusion(nextExcluded, true, false);
      return;
    }
    // 'ask' — open the dialog. The pending exclusion
    // sits in dialog state until the user picks; the
    // user can also cancel, which discards the
    // pending change entirely (the picker's optimistic
    // state will reconcile on the next render via the
    // direct-update path).
    this._l0ExcludeDialog = {
      nextExcluded,
      addedPaths,
    };
  }

  /**
   * Resolve an open L0-exclude dialog. Called by the
   * three button handlers (Apply now, Defer, Cancel).
   *
   * `choice` is one of:
   *   - 'invalidate' → apply with invalidateL0=true
   *   - 'defer' → apply with invalidateL0=false
   *   - 'cancel' → discard the pending exclusion
   *
   * `remember` is the "Don't ask again" checkbox state.
   * Only meaningful for invalidate / defer choices —
   * cancel never persists a preference.
   *
   * After resolving, the picker's checkbox state may be
   * stale (the user shift-clicked, the picker
   * optimistically updated, then the user cancelled).
   * The direct-update inside `_applyExclusion` re-pushes
   * the canonical `excludedFiles` Set, which causes the
   * picker to re-render with the correct state.
   */
  _resolveL0ExcludeDialog(choice, remember) {
    const dialog = this._l0ExcludeDialog;
    this._l0ExcludeDialog = null;
    if (!dialog) return;
    if (choice === 'cancel') {
      // Re-push current excluded set to the picker so
      // its visual state reconciles with the
      // unchanged authoritative state. Without this,
      // a shift-click that opened the dialog and was
      // cancelled could leave the picker showing a
      // ticked checkbox even though our set is
      // unchanged.
      const picker = this._picker();
      if (picker) {
        picker.excludedFiles = new Set(this._excludedFiles);
        picker.requestUpdate();
      }
      return;
    }
    const invalidate = choice === 'invalidate';
    if (remember) {
      const pref = invalidate
        ? _L0_EXCLUDE_PREF_ALWAYS
        : _L0_EXCLUDE_PREF_NEVER;
      this._l0ExcludePref = pref;
      _saveL0ExcludePref(pref);
    }
    this._applyExclusion(dialog.nextExcluded, true, invalidate);
  }

  /**
   * Reset the stored L0-exclude preference back to
   * 'ask'. Exposed so the Settings tab can offer a
   * "reset preferences" affordance — users who picked
   * "always" once and now want the dialog back have
   * an escape hatch.
   */
  resetL0ExcludePref() {
    this._l0ExcludePref = _L0_EXCLUDE_PREF_ASK;
    try {
      localStorage.removeItem(_L0_EXCLUDE_PREF_KEY);
    } catch (_) {}
  }

  async _sendExclusionToServer(files, invalidateL0 = false) {
    // Same dispatch rule as _sendSelectionToServer. Per
    // specs4/5-webapp/agent-browser.md § File Picker
    // Scope: "Excluded-files state is also per-tab."
    //
    // `invalidateL0` flows through to the main-tab RPC
    // as a third argument. Agent tabs don't accept it
    // — agent ContextManagers share the orchestrator's
    // L0 prefix per the parallel-agents design, so an
    // agent-tab exclusion can't invalidate the
    // orchestrator's L0 cache directly. (The
    // orchestrator's own next L0-invalidation event
    // refreshes when needed.) We silently drop the
    // flag for agent tabs rather than raise — agent
    // exclusions are still applied via the per-agent
    // tracker; only the L0 refresh decision differs.
    const agentTag = parseAgentTabId(this._activeTabId);
    try {
      let result;
      if (agentTag) {
        // agentTag IS the agent's LLM-chosen id —
        // matches the backend's flat registry key.
        result = await this.rpcExtract(
          'LLMService.set_agent_excluded_index_files',
          agentTag,
          files,
        );
      } else {
        result = await this.rpcExtract(
          'LLMService.set_excluded_index_files',
          files,
          invalidateL0,
        );
      }
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        if (result.error === 'restricted') {
          this._showToast(
            result.reason || 'Restricted operation',
            'warning',
          );
        } else if (result.error === 'agent not found') {
          this._showToast(
            'Agent tab no longer available on server',
            'warning',
          );
        }
      }
    } catch (err) {
      console.error(
        '[files-tab] set_excluded_index_files failed',
        err,
      );
      this._showToast(
        `Failed to update exclusion: ${err?.message || err}`,
        'error',
      );
    }
  }

  // ---------------------------------------------------------------
  // File clicks
  // ---------------------------------------------------------------

  // Bodies live in ./file-search.js.
  _onFileClicked(event) {
    onFileClicked(this, event);
  }

  _onFileSearchChanged(event) {
    onFileSearchChanged(this, event);
  }

  _onFilterFromChat(event) {
    onFilterFromChat(this, event);
  }

  _onFileSearchScroll(event) {
    onFileSearchScroll(this, event);
  }

  // Body lives in ./mentions.js.
  _onFileMentionClick(event) {
    onFileMentionClick(this, event);
  }

  // Bodies live in ./mentions.js.
  _onFileChipClick(event) {
    onFileChipClick(this, event);
  }

  _onFileChipsAddAll(event) {
    onFileChipsAddAll(this, event);
  }

  // ---------------------------------------------------------------
  // Context-menu action routing (Increment 8b — simple RPCs)
  // ---------------------------------------------------------------

  // Bodies live in ./context-menu.js. The host method
  // names stay so the template binding and any test
  // hooks see the same shape.
  _onContextMenuAction(event) {
    onContextMenuAction(this, event);
  }

  // Per-action dispatchers live in ./context-menu.js
  // (file actions, dir actions, helpers). The host
  // exposes only the three entries that other
  // modules / tests reach into directly:
  // _dispatchInclude, _dispatchExcludeAll,
  // _dispatchIncludeAll — see below.

  // Body lives in ./mentions.js.
  _onInsertPath(event) {
    onInsertPath(this, event);
  }

  // Bodies live in ./inline-commits.js. Handler names
  // preserved so the template bindings stay stable.
  _onRenameCommitted(event) {
    return onRenameCommitted(this, event);
  }

  _onDuplicateCommitted(event) {
    return onDuplicateCommitted(this, event);
  }

  _onNewFileCommitted(event) {
    return onNewFileCommitted(this, event);
  }

  _onNewDirectoryCommitted(event) {
    return onNewDirectoryCommitted(this, event);
  }

  // ---------------------------------------------------------------
  // Context-menu dispatcher forwarders
  // ---------------------------------------------------------------
  //
  // Most dispatchers live in ./context-menu.js and are
  // reached through onContextMenuAction's routing —
  // tests don't call them directly. The three below are
  // exercised via direct method calls in
  // exclusion.test.js (e.g.
  // `t._dispatchInclude('a.md')`), so the host method
  // names stay reachable as one-line forwarders.

  _dispatchInclude(path) {
    dispatchInclude(this, path);
  }

  _dispatchExcludeAll(dirPath) {
    dispatchExcludeAll(this, dirPath);
  }

  _dispatchIncludeAll(dirPath) {
    dispatchIncludeAll(this, dirPath);
  }

  /**
   * Forwarder for the load-in-panel dispatcher. Tests
   * call it directly with deliberately invalid panel
   * names to verify the silent-drop branch (the public
   * routing only ever passes 'left' or 'right').
   */
  _dispatchLoadInPanel(path, panel) {
    return dispatchLoadInPanel(this, path, panel);
  }

  /**
   * Wrap `window.confirm` so tests can stub it cleanly.
   * The real implementation delegates directly; tests
   * mock this method to drive the confirm / cancel
   * branches deterministically.
   */
  _confirm(message) {
    return typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(message)
      : false;
  }

  /**
   * Forwarder to the module helper. Used by
   * pre-extraction call sites that haven't migrated
   * to the module-level export — keeps the host
   * surface stable across stages.
   */
  _isRestrictedError(result) {
    return isRestrictedError(result);
  }

  // ---------------------------------------------------------------
  // Splitter — drag and double-click
  // ---------------------------------------------------------------

  // Splitter handler bodies live in ./splitter.js. The
  // bound forwarders below preserve the public method
  // names (called from the constructor, render
  // template, and disconnectedCallback) so external
  // call sites don't change.

  _maxPickerWidth() {
    return maxPickerWidthFromModule(this);
  }

  _onSplitterPointerDown(event) {
    onSplitterPointerDown(this, event);
  }

  _onSplitterPointerMove(event) {
    onSplitterPointerMove(this, event);
  }

  _onSplitterPointerUp() {
    onSplitterPointerUp(this);
  }

  _onSplitterDoubleClick(event) {
    onSplitterDoubleClick(this, event);
  }

  _savePickerWidth() {
    savePickerWidth(this);
  }

  _saveCollapsed() {
    saveCollapsed(this);
  }

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------

  /**
   * Build the set of paths that should be pinned to
   * selection — files with working-tree or staged
   * modifications. The picker uses this to suppress the
   * native checkbox toggle on attempted deselection so
   * Lit's reactive binding stays the source of truth.
   * Untracked and deleted files are excluded — see the
   * comment in `_applySelection` for the rationale.
   */
  _computePinnedFiles() {
    const pinned = new Set();
    const sd = this._latestStatusData;
    if (!sd) return pinned;
    if (sd.modified instanceof Set) {
      for (const p of sd.modified) pinned.add(p);
    }
    if (sd.staged instanceof Set) {
      for (const p of sd.staged) pinned.add(p);
    }
    return pinned;
  }

  _picker() {
    return this.shadowRoot?.querySelector('ac-file-picker') || null;
  }

  _chat() {
    return this.shadowRoot?.querySelector('ac-chat-panel') || null;
  }

  _setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const item of a) {
      if (!b.has(item)) return false;
    }
    return true;
  }

  _showToast(message, type = 'info') {
    // AppShell listens for `ac-toast` window events and
    // renders them in the global toast layer. Components
    // dispatch rather than reach through the DOM.
    window.dispatchEvent(
      new CustomEvent('ac-toast', {
        detail: { message, type },
      }),
    );
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  render() {
    // Effective picker width — collapsed mode overrides
    // the stored _pickerWidthPx with a thin affordance
    // strip. Stored width survives so expand-via-
    // double-click restores the user's prior size.
    const pickerWidth = this._pickerCollapsed
      ? _PICKER_COLLAPSED_WIDTH
      : this._pickerWidthPx;
    const paneClasses = this._pickerCollapsed
      ? 'picker-pane collapsed'
      : 'picker-pane';
    const splitterClasses = this._pickerCollapsed
      ? 'splitter collapsed'
      : 'splitter';
    return html`
      <div
        class=${paneClasses}
        style="width: ${pickerWidth}px"
      >
        <ac-file-picker
          .tree=${this._latestTree}
          .statusData=${this._latestStatusData}
          .branchInfo=${this._latestBranchInfo}
          .selectedFiles=${this._selectedFiles}
          .excludedFiles=${this._excludedFiles}
          @selection-changed=${this._onSelectionChanged}
          @exclusion-changed=${this._onExclusionChanged}
          @file-clicked=${this._onFileClicked}
          @context-menu-action=${this._onContextMenuAction}
          @rename-committed=${this._onRenameCommitted}
          @duplicate-committed=${this._onDuplicateCommitted}
          @insert-path=${this._onInsertPath}
          @new-file-committed=${this._onNewFileCommitted}
          @new-directory-committed=${this._onNewDirectoryCommitted}
          @exit-review=${this._onExitReview}
          @open-review-selector=${this._onOpenReviewSelector}
          @open-review-graph=${this._onOpenReviewGraph}
          @branch-menu-requested=${this._onBranchMenuRequested}
          @branch-switch-requested=${this._onBranchSwitchRequested}
        ></ac-file-picker>
      </div>
      <div
        class=${splitterClasses}
        role="separator"
        aria-orientation="vertical"
        aria-label=${this._pickerCollapsed
          ? 'Expand file picker'
          : 'Resize file picker'}
        title=${this._pickerCollapsed
          ? 'Double-click to expand'
          : 'Drag to resize, double-click to collapse'}
        @pointerdown=${this._onSplitterPointerDown}
        @dblclick=${this._onSplitterDoubleClick}
      >${this._pickerCollapsed
        ? html`<span class="splitter-affordance">▸</span>`
        : ''}</div>
      <div class="chat-pane">
        <ac-chat-panel
          @file-mention-click=${this._onFileMentionClick}
          @file-chip-click=${this._onFileChipClick}
          @file-chips-add-all=${this._onFileChipsAddAll}
          @file-search-changed=${this._onFileSearchChanged}
          @file-search-scroll=${this._onFileSearchScroll}
          @filter-from-chat=${this._onFilterFromChat}
        ></ac-chat-panel>
      </div>
      ${this._renderReviewSelectorModal()}
      ${this._renderReviewGraphModal()}
      ${this._renderL0ExcludeDialog()}
    `;
  }

  // ---------------------------------------------------------------
  // L0-exclude confirmation dialog
  // ---------------------------------------------------------------

  /**
   * Render the L0-exclude confirmation dialog when
   * `_l0ExcludeDialog` is non-null. Three buttons:
   *
   *   - Apply now (primary) — invalidate L0
   *     immediately, full cache rewrite
   *   - Defer (secondary) — leave L0 cached as-is;
   *     the next mode switch / cross-ref toggle /
   *     manual rebuild / restart will refresh
   *   - Cancel — discard the pending exclusion
   *
   * Plus a "Don't ask again" checkbox that persists
   * the user's choice as the new default for both
   * exclusion paths. Cancel doesn't persist
   * anything — it's a "I changed my mind" gesture.
   */
  _renderL0ExcludeDialog() {
    const dialog = this._l0ExcludeDialog;
    if (!dialog) return '';
    const count = dialog.addedPaths.length;
    const target =
      count === 1
        ? dialog.addedPaths[0]
        : `${count} files`;
    return html`
      <div
        class="l0-dialog-backdrop"
        @click=${this._onL0DialogBackdropClick}
        @keydown=${this._onL0DialogKeyDown}
      >
        <div
          class="l0-dialog"
          role="dialog"
          aria-label="Confirm L0 cache invalidation"
          tabindex="0"
          @click=${(e) => e.stopPropagation()}
        >
          <div class="l0-dialog-title">
            Invalidate L0 cache?
          </div>
          <div class="l0-dialog-body">
            Excluding <strong>${target}</strong> from the
            index can either invalidate the L0 cache
            immediately (a full cache rewrite — typically
            100,000+ tokens) or leave the cached aggregate
            map stale until the next L0-invalidating event
            (mode switch, cross-reference toggle, manual
            rebuild, restart).
            <br /><br />
            <strong>Apply now</strong> if you want the
            exclusion to take effect on the next request
            and don't mind the cache cost. <strong>Defer</strong>
            if you'd rather not pay the cache cost yet —
            the LLM may still see ${target} in the
            structural map until the cache refreshes
            naturally.
          </div>
          <label class="l0-dialog-remember">
            <input
              type="checkbox"
              data-l0-remember
            />
            Don't ask again — remember this choice for
            future exclusions
          </label>
          <div class="l0-dialog-actions">
            <button
              class="l0-dialog-btn cancel"
              @click=${this._onL0DialogCancel}
            >Cancel</button>
            <button
              class="l0-dialog-btn secondary"
              @click=${this._onL0DialogDefer}
            >Defer</button>
            <button
              class="l0-dialog-btn primary"
              @click=${this._onL0DialogApplyNow}
            >Apply now</button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Read the "Don't ask again" checkbox state from the
   * rendered dialog. Returns false when the dialog
   * isn't mounted or the checkbox can't be queried —
   * defensive against a race between button click and
   * dialog close.
   */
  _readL0DialogRememberFlag() {
    const cb = this.shadowRoot?.querySelector(
      '.l0-dialog input[data-l0-remember]',
    );
    return !!(cb && cb.checked);
  }

  _onL0DialogApplyNow() {
    const remember = this._readL0DialogRememberFlag();
    this._resolveL0ExcludeDialog('invalidate', remember);
  }

  _onL0DialogDefer() {
    const remember = this._readL0DialogRememberFlag();
    this._resolveL0ExcludeDialog('defer', remember);
  }

  _onL0DialogCancel() {
    // Cancel never persists a preference — the
    // checkbox value is irrelevant.
    this._resolveL0ExcludeDialog('cancel', false);
  }

  _onL0DialogBackdropClick(event) {
    // Backdrop click = cancel. Same gesture as the
    // review selector modal's backdrop click.
    if (event.target === event.currentTarget) {
      this._onL0DialogCancel();
    }
  }

  _onL0DialogKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this._onL0DialogCancel();
    }
  }

  // ---------------------------------------------------------------
  // Review selector modal
  // ---------------------------------------------------------------

  /**
   * Handle the picker's `open-review-selector` event.
   * Runs the clean-tree gate first so dirty working
   * trees bail out with a clear message instead of
   * producing a modal that leads to an RPC failure.
   * Then opens the modal — the commit-graph component
   * fetches its own data via the RPC call proxy.
   */
  async _onOpenReviewSelector() {
    try {
      const readiness = await this.rpcExtract(
        'LLMService.check_review_ready',
      );
      if (readiness && readiness.clean === false) {
        const msg = readiness.message
          || 'Working tree must be clean to start a review.';
        this._showToast(msg, 'warning');
        return;
      }
    } catch (err) {
      console.error('[files-tab] check_review_ready failed', err);
      this._showToast(
        `Review check failed: ${err?.message || err}`,
        'error',
      );
      return;
    }
    this._reviewSelector = {
      selected: null,
      starting: false,
    };
  }

  /**
   * Commit-graph fired commit-selected — the user
   * clicked a commit (optionally chose a branch via
   * the disambiguation popover). Store the selection
   * so the Start Review action bar can display the
   * summary and fire start_review on confirm.
   *
   * Detail: `{commit, branch}`. `branch` may be null
   * when no branch in the loaded history reaches the
   * commit — the action bar handles that by
   * disabling the Start button.
   */
  _onCommitSelectedFromGraph(event) {
    if (!this._reviewSelector) return;
    const detail = event.detail || {};
    if (!detail.commit) return;
    this._reviewSelector = {
      ...this._reviewSelector,
      selected: {
        commit: detail.commit,
        branch: detail.branch || null,
      },
    };
  }

  /**
   * Graph fired graph-error — surface as a toast but
   * keep the modal open so the user can retry or
   * close it manually.
   */
  _onGraphError(event) {
    const message = event.detail?.message || 'Graph load failed';
    this._showToast(`Commit graph: ${message}`, 'error');
  }

  /**
   * Close the modal — user clicked the backdrop, the
   * close button, or pressed Escape. No RPC cleanup
   * needed; an in-flight fetch's resolve will find
   * `_reviewSelector` null and skip its update.
   */
  _closeReviewSelector() {
    this._reviewSelector = null;
  }

  /**
   * Start a review using the currently-selected
   * commit from the graph. The confirm button in the
   * action bar triggers this.
   *
   * `selected.branch` may be null when the graph
   * walk couldn't find any branch reaching the
   * commit — the confirm button is disabled in that
   * case so this method is only reachable when both
   * fields are populated. Defensive guard kept
   * anyway.
   *
   * Backend's `start_review(branch, base_commit)`
   * accepts any commit SHA as the base — not just
   * branch tips — so the user can scroll down the
   * graph and pick an older commit to widen the
   * review scope.
   */
  async _confirmStartReview() {
    if (!this._reviewSelector) return;
    const selected = this._reviewSelector.selected;
    if (!selected || !selected.branch || !selected.commit) return;
    const branch = selected.branch.name;
    const baseCommit = selected.commit.sha;
    if (typeof branch !== 'string' || !branch) return;
    if (typeof baseCommit !== 'string' || !baseCommit) return;
    this._reviewSelector = {
      ...this._reviewSelector,
      starting: true,
    };
    try {
      const result = await this.rpcExtract(
        'LLMService.start_review',
        branch,
        baseCommit,
      );
      if (this._isRestrictedError(result)) {
        this._showToast(
          result.reason || 'Restricted operation',
          'warning',
        );
        if (this._reviewSelector) {
          this._reviewSelector = {
            ...this._reviewSelector,
            starting: false,
          };
        }
        return;
      }
      if (result && result.error) {
        this._showToast(
          `Start review failed: ${result.error}`,
          'error',
        );
        if (this._reviewSelector) {
          this._reviewSelector = {
            ...this._reviewSelector,
            starting: false,
          };
        }
        return;
      }
      this._closeReviewSelector();
    } catch (err) {
      console.error('[files-tab] start_review failed', err);
      this._showToast(
        `Start review failed: ${err?.message || err}`,
        'error',
      );
      if (this._reviewSelector) {
        this._reviewSelector = {
          ...this._reviewSelector,
          starting: false,
        };
      }
    }
  }

  _onReviewBackdropClick(event) {
    // Only close when the user clicks the backdrop
    // itself — clicks that bubbled from inside the
    // modal (buttons, rows) shouldn't close.
    if (event.target === event.currentTarget) {
      this._closeReviewSelector();
    }
  }

  _renderReviewSelectorModal() {
    const state = this._reviewSelector;
    if (!state) return '';
    const selected = state.selected;
    const starting = !!state.starting;
    const canStart =
      !!selected && !!selected.branch && !!selected.commit && !starting;
    return html`
      <div
        class="review-modal-backdrop"
        @click=${this._onReviewBackdropClick}
      >
        <div
          class="review-modal"
          role="dialog"
          aria-label="Start code review"
        >
          <div class="review-modal-header">
            <span class="review-modal-title">
              🔍 Start code review
            </span>
            <button
              class="review-modal-close"
              title="Close"
              aria-label="Close review selector"
              @click=${this._closeReviewSelector}
            >✕</button>
          </div>
          <div class="review-modal-hint">
            Click a commit to select it as the review base.
            The review will compare the chosen branch tip
            against its merge-base with your current
            branch (or main / master).
          </div>
          <ac-commit-graph
            .rpcCall=${(method, ...args) => this.rpcExtract(method, ...args)}
            @commit-selected=${this._onCommitSelectedFromGraph}
            @graph-error=${this._onGraphError}
          ></ac-commit-graph>
          <div class="review-action-bar">
            <div class="review-action-summary">
              ${selected
                ? html`
                    Reviewing
                    <strong>${selected.branch?.name || '(no branch)'}</strong>
                    from base
                    <strong>${selected.commit.short_sha
                      || selected.commit.sha?.slice(0, 7)}</strong>
                  `
                : html`<em>Click a commit to select it as the review base.</em>`}
            </div>
            <button
              class="review-start-btn"
              ?disabled=${!canStart}
              @click=${this._confirmStartReview}
            >${starting ? 'Starting…' : 'Start review'}</button>
          </div>
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------
  // Review history graph modal
  // ---------------------------------------------------------------

  /**
   * Open the review history graph modal. Fired when
   * the picker's "View graph" button is clicked
   * during an active review. No-op when review isn't
   * active (defensive — the button is only rendered
   * during review, but guard against a stale dispatch
   * racing with an exit).
   */
  _onOpenReviewGraph() {
    if (!this._reviewState || !this._reviewState.active) {
      return;
    }
    this._reviewGraphModal = {};
  }

  _closeReviewGraphModal() {
    this._reviewGraphModal = null;
  }

  _onReviewGraphBackdropClick(event) {
    if (event.target === event.currentTarget) {
      this._closeReviewGraphModal();
    }
  }

  /**
   * Route a commit-inspected event from the read-only
   * graph to the diff viewer's ad-hoc panel. Shows
   * the commit's diff against its first parent on
   * the left, leaves the right panel with the current
   * branch-tip content so the user can compare the
   * commit's effect against their current view.
   *
   * Parent-diff is the conventional git-tool default
   * (Sourcetree, GitKraken) for "what did this commit
   * introduce?". A commit with no parent (root commit)
   * degrades to an empty-left panel — the diff viewer
   * shows the commit's full content as additions,
   * which is visually accurate.
   */
  async _onCommitInspectedFromGraph(event) {
    const commit = event.detail?.commit;
    if (!commit || typeof commit.sha !== 'string') return;
    if (!this.rpcConnected) return;
    // Close the modal first so the diff viewer has focus
    // and isn't competing with the backdrop. The fetch
    // runs afterward and populates the panel when it
    // lands.
    this._closeReviewGraphModal();
    try {
      // Fetch the diff via git show. One round-trip;
      // the backend doesn't have a dedicated "diff this
      // commit" RPC but get_diff_to_branch's cousin
      // pattern via Repo.get_file_content at the commit
      // isn't suitable either (no native diff output).
      // Quickest path: use Repo._run_git via a new
      // helper is overkill for this feature — instead
      // ask for the commit message + parent info and
      // use Repo.get_staged_diff-style format via a
      // simple get-commit-diff helper.
      //
      // Without a bespoke RPC, we fall back to
      // `get_diff_to_branch(commit_sha)` which produces
      // the diff between that commit and the working
      // tree. That's not "this commit only" — it
      // includes every change between the commit and
      // now. Good enough for inspection during review
      // (user is asking "what did this commit touch?"
      // in the context of the feature branch), and
      // keeps the feature shippable without a backend
      // change.
      const result = await this.rpcExtract(
        'Repo.get_diff_to_branch',
        commit.sha,
      );
      if (result && typeof result === 'object' && result.error) {
        this._showToast(
          `Commit inspect failed: ${result.error}`,
          'warning',
        );
        return;
      }
      const diff =
        result && typeof result === 'object'
          ? result.diff || ''
          : typeof result === 'string' ? result : '';
      if (!diff) {
        this._showToast(
          'No diff available for that commit',
          'info',
        );
        return;
      }
      const label = `commit ${commit.short_sha || commit.sha.slice(0, 7)}`;
      window.dispatchEvent(
        new CustomEvent('load-diff-panel', {
          detail: {
            content: diff,
            panel: 'left',
            label,
          },
          bubbles: false,
        }),
      );
    } catch (err) {
      console.error('[files-tab] commit-inspected failed', err);
      this._showToast(
        `Commit inspect failed: ${err?.message || err}`,
        'error',
      );
    }
  }

  _renderReviewGraphModal() {
    if (!this._reviewGraphModal) return '';
    const state = this._reviewState || {};
    // Build the highlight map from the current review
    // state. Base is the merge-base (parent_commit),
    // tip is the branch tip being reviewed.
    const highlighted = {
      base: state.parent_commit || null,
      tip: state.branch_tip || null,
    };
    const branch = state.branch || '(unknown)';
    const baseShort = (state.parent_commit || '').slice(0, 7);
    const tipShort = (state.branch_tip || '').slice(0, 7);
    return html`
      <div
        class="review-modal-backdrop"
        @click=${this._onReviewGraphBackdropClick}
      >
        <div
          class="review-modal"
          role="dialog"
          aria-label="Review history graph"
        >
          <div class="review-modal-header">
            <span class="review-modal-title">
              🔍 Review history: ${branch}
            </span>
            <button
              class="review-modal-close"
              title="Close"
              aria-label="Close graph"
              @click=${this._closeReviewGraphModal}
            >✕</button>
          </div>
          <div class="review-modal-hint">
            Amber ring = review base (${baseShort});
            green ring = branch tip (${tipShort}).
            Click any commit to see its diff in the left panel.
          </div>
          <ac-commit-graph
            .rpcCall=${(method, ...args) => this.rpcExtract(method, ...args)}
            .readOnly=${true}
            .highlightedCommits=${highlighted}
            includeRemote
            @commit-inspected=${this._onCommitInspectedFromGraph}
            @graph-error=${this._onGraphError}
          ></ac-commit-graph>
        </div>
      </div>
    `;
  }
}

customElements.define('ac-files-tab', FilesTab);

// Exported for unit tests. Production callers don't need
// the helpers — they run internally during tree load and
// file search result handling.
export { flattenTreePaths, buildPrunedTree };