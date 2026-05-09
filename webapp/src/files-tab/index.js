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
import '../file-picker/index.js';
import '../chat-panel/index.js';
import { parseAgentTabId } from '../chat-panel/index.js';
import '../commit-graph.js';

import {
  EMPTY_TREE,
  _PICKER_COLLAPSED_WIDTH,
} from './constants.js';
import {
  _loadL0ExcludePref,
  _loadPickerCollapsed,
  _loadPickerWidth,
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
  applyExclusion,
  applyExclusionWithPrompt,
  onExclusionChanged,
  onL0DialogApplyNow,
  onL0DialogBackdropClick,
  onL0DialogCancel,
  onL0DialogDefer,
  onL0DialogKeyDown,
  renderL0ExcludeDialog,
  resetL0ExcludePref,
  resolveL0ExcludeDialog,
  sendExclusionToServer,
} from './exclusion.js';
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
  onBranchMenuRequested,
  onBranchSwitchRequested,
} from './branch.js';
import {
  closeReviewGraphModal,
  closeReviewSelector,
  confirmStartReview,
  onCommitInspectedFromGraph,
  onCommitSelectedFromGraph,
  onExitReview,
  onGraphError,
  onOpenReviewGraph,
  onOpenReviewSelector,
  onReviewBackdropClick,
  onReviewEnded,
  onReviewGraphBackdropClick,
  onReviewStarted,
  renderReviewGraphModal,
  renderReviewSelectorModal,
} from './review.js';
import {
  applySelection,
  onFilesChanged,
  onSelectionChanged,
  sendSelectionToServer,
} from './selection.js';
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
import {
  applyInitialAutoSelect,
  expandAncestorsOf,
  loadFileTree,
  onFilesModified,
  onStateLoaded,
  pushChildProps,
} from './tree-loader.js';

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
  //
  // Bodies live in ./tree-loader.js. Host method names
  // preserved as forwarders so intra-class call sites
  // and tests (which read `_latestTree` etc. directly
  // but invoke nothing here) keep working.

  _loadFileTree() {
    return loadFileTree(this);
  }

  _applyInitialAutoSelect() {
    return applyInitialAutoSelect(this);
  }

  _expandAncestorsOf(paths) {
    return expandAncestorsOf(this, paths);
  }

  _pushChildProps() {
    return pushChildProps(this);
  }

  /**
   * Retry the child-props push after the first render.
   *
   * The RPC-ready microtask hook can fire before Lit's
   * first `updateComplete` resolves, meaning
   * `this._chat()` inside the tree-load returns null
   * and the assignments are silently lost. The
   * Phase 2c original code had this failure mode but
   * it was masked because `repoFiles` was optional
   * and nothing in the chat panel consumed it.
   *
   * Phase 2d's file summary section DOES consume
   * `repoFiles`, so the silent drop became visible.
   * The fix is to retry once the first render has
   * happened — `updated()` always runs after commit,
   * so by then `this._chat()` returns a real element.
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

  // Bodies live in ./selection.js (selection events) and
  // ./tree-loader.js (state-loaded restore + reload
  // trigger). Host method names preserved for the event
  // bindings.
  _onSelectionChanged(event) {
    return onSelectionChanged(this, event);
  }

  _onFilesChanged(event) {
    return onFilesChanged(this, event);
  }

  _onStateLoaded(event) {
    return onStateLoaded(this, event);
  }

  _onFilesModified(event) {
    return onFilesModified(this, event);
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

  // Review lifecycle bodies live in ./review.js.
  // Forwarders preserve the bound-handler references
  // wired in connectedCallback / disconnectedCallback.
  _onReviewStarted(event) {
    return onReviewStarted(this, event);
  }

  _onReviewEnded() {
    return onReviewEnded(this);
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

  _onExitReview() {
    return onExitReview(this);
  }

  // ---------------------------------------------------------------
  // Branch switching
  // ---------------------------------------------------------------
  //
  // Bodies live in ./branch.js. Forwarders preserve
  // the bound-handler references stored in the
  // constructor.

  _onBranchMenuRequested() {
    return onBranchMenuRequested(this);
  }

  _onBranchSwitchRequested(event) {
    return onBranchSwitchRequested(this, event);
  }

  // Bodies live in ./selection.js. Host method names
  // preserved as forwarders — tests in
  // selection-sync.test.js, init.test.js, etc. call
  // _applySelection directly.
  _applySelection(newSelection, notifyServer) {
    return applySelection(this, newSelection, notifyServer);
  }

  _sendSelectionToServer(files) {
    return sendSelectionToServer(this, files);
  }

  // Bodies live in ./exclusion.js. Host method names
  // preserved as forwarders — tests in exclusion.test.js
  // and per-tab.test.js call _applyExclusion /
  // _applyExclusionWithPrompt directly, and
  // resetL0ExcludePref is documented as part of the
  // settings-tab integration surface.
  _onExclusionChanged(event) {
    return onExclusionChanged(this, event);
  }

  _applyExclusion(newExcluded, notifyServer, invalidateL0 = false) {
    return applyExclusion(
      this, newExcluded, notifyServer, invalidateL0,
    );
  }

  _applyExclusionWithPrompt(nextExcluded) {
    return applyExclusionWithPrompt(this, nextExcluded);
  }

  _resolveL0ExcludeDialog(choice, remember) {
    return resolveL0ExcludeDialog(this, choice, remember);
  }

  resetL0ExcludePref() {
    return resetL0ExcludePref(this);
  }

  _sendExclusionToServer(files, invalidateL0 = false) {
    return sendExclusionToServer(this, files, invalidateL0);
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

  // L0 dialog rendering + button handlers live in
  // ./exclusion.js. Forwarders preserve the host
  // surface — the render template calls
  // `${this._renderL0ExcludeDialog()}`.
  _renderL0ExcludeDialog() {
    return renderL0ExcludeDialog(this);
  }

  _onL0DialogApplyNow() {
    return onL0DialogApplyNow(this);
  }

  _onL0DialogDefer() {
    return onL0DialogDefer(this);
  }

  _onL0DialogCancel() {
    return onL0DialogCancel(this);
  }

  _onL0DialogBackdropClick(event) {
    return onL0DialogBackdropClick(this, event);
  }

  _onL0DialogKeyDown(event) {
    return onL0DialogKeyDown(this, event);
  }

  // ---------------------------------------------------------------
  // Review selector modal
  // ---------------------------------------------------------------
  //
  // Bodies live in ./review.js. Forwarders preserve
  // the host method names so the render template's
  // `${this._renderReviewSelectorModal()}` call and
  // any test hooks see a stable surface.

  _onOpenReviewSelector() {
    return onOpenReviewSelector(this);
  }

  _onCommitSelectedFromGraph(event) {
    return onCommitSelectedFromGraph(this, event);
  }

  _onGraphError(event) {
    return onGraphError(this, event);
  }

  _closeReviewSelector() {
    return closeReviewSelector(this);
  }

  _confirmStartReview() {
    return confirmStartReview(this);
  }

  _onReviewBackdropClick(event) {
    return onReviewBackdropClick(this, event);
  }

  _renderReviewSelectorModal() {
    return renderReviewSelectorModal(this);
  }

  // ---------------------------------------------------------------
  // Review history graph modal
  // ---------------------------------------------------------------
  //
  // Bodies live in ./review.js. Forwarders preserve
  // the host method names so the render template's
  // `${this._renderReviewGraphModal()}` call and any
  // test hooks see a stable surface.

  _onOpenReviewGraph() {
    return onOpenReviewGraph(this);
  }

  _closeReviewGraphModal() {
    return closeReviewGraphModal(this);
  }

  _onReviewGraphBackdropClick(event) {
    return onReviewGraphBackdropClick(this, event);
  }

  _onCommitInspectedFromGraph(event) {
    return onCommitInspectedFromGraph(this, event);
  }

  _renderReviewGraphModal() {
    return renderReviewGraphModal(this);
  }
}

customElements.define('ac-files-tab', FilesTab);

// Exported for unit tests. Production callers don't need
// the helpers — they run internally during tree load and
// file search result handling.
export { flattenTreePaths, buildPrunedTree };