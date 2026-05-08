// AppShell — root component of the AC-DC webapp.
//
// Owns the single WebSocket connection (inherits from JRPCClient),
// publishes the RPC proxy to SharedRpc for child components, drives
// the startup overlay off progress events from the backend, and
// hosts the dialog + viewer background layers.
//
// Governing specs:
//   - specs4/5-webapp/shell.md
//   - specs4/1-foundation/rpc-transport.md
//
// Phase 1 scope — minimum viable shell:
//   - Connect to the WebSocket using ?port=N from the URL
//   - Publish the call proxy to SharedRpc on setupDone
//   - Render a startup overlay that dismisses on the "ready" stage
//   - Render a placeholder dialog with three tab buttons
//   - Show reconnect toast on WebSocket loss and recovery
//
// Phase 2 fills in the dialog's tab content. Phase 3 adds the
// viewer background, file navigation grid, token HUD, and the
// richer UX concerns.

import { LitElement, html, css } from 'lit';
import { JRPCClient } from '@flatmax/jrpc-oo/dist/bundle.js';

import { SharedRpc } from '../rpc.js';
import '../files-tab/index.js';
import '../diff-viewer.js';
import '../svg-viewer.js';
import '../settings-tab.js';
import '../context-tab.js';
import '../doc-convert-tab.js';
import '../file-nav.js';
import '../token-hud.js';
import '../compaction-progress.js';
import '../doc-index-progress.js';

import { APP_SHELL_STYLES } from './styles.js';
import {
  getWebSocketPort, RECONNECT_DELAYS_MS, TOAST_EVENT,
  DOC_INDEX_STAGES,
} from './constants.js';
import {
  loadActiveTab, loadMinimized, loadDockedWidth, loadUndockedPos,
  saveMinimized, saveDockedWidth, saveUndockedPos,
  saveLastOpenFile, loadLastOpenFile,
} from './persistence.js';
import {
  showToast, onToastEvent, maybeShowEnrichmentUnavailableToast,
} from './toasts.js';
import { scheduleReconnect, attemptReconnect } from './reconnect.js';
import {
  getDialogRect, onHeaderPointerDown, onHandlePointerDown,
  onPointerMove, onPointerUp, toggleMinimize,
  onWindowResize, handleWindowResize, dialogInlineStyle,
} from './dialog.js';
import {
  getFileNav, onGridKeyDown, onGridKeyUp,
  flushAltArrowPending, onGlobalKeyDown,
} from './file-nav.js';
import {
  onNavigateFile, onLoadDiffPanel, onToggleSvgMode,
  onActiveFileChanged, scheduleViewerRelayout, relayoutViewers,
} from './viewers.js';
import {
  saveViewportState, saveSvgViewportState, loadViewportState,
  tryReopenLastFile, doReopenLastFile, doReopenSvg, restoreViewport,
  onBeforeUnload, onPreviewModeChanged,
  onSvgViewBoxChanged, onSvgPresentationChanged,
} from './viewport.js';
import {
  fetchCurrentState, fetchHistoryStatus, onCompactionStatusRefresh,
} from './state-fetch.js';
import { onModeChanged, switchMode, toggleCrossRef } from './mode.js';
import {
  onGitAction, onCommitResultHeader, onReviewStateChanged,
  onStreamChunkHeader, onStreamCompleteHeader,
  onCopyDiff, onCommit, onResetToHead,
} from './git-actions.js';
import { onFileSaved, onFilesReverted } from './file-saved.js';
import { renderTemplate } from './render.js';

/**
 * AppShell — root LitElement, inherits from JRPCClient.
 *
 * JRPCClient handles the WebSocket + handshake plumbing. We
 * override `setupDone`, `remoteIsUp`, `remoteDisconnected`, and
 * `serverChanged` to hook into the lifecycle.
 */
export class AppShell extends JRPCClient {
  static properties = {
    /** Connection state — drives overlay and reconnect banner. */
    connectionState: { type: String, state: true },
    /** Startup progress — populated from AcApp.startupProgress. */
    startupStage: { type: String, state: true },
    startupMessage: { type: String, state: true },
    startupPercent: { type: Number, state: true },
    /** Whether the startup overlay is visible. */
    overlayVisible: { type: Boolean, state: true },
    /** Active dialog tab. */
    activeTab: { type: String, state: true },
    /** Active toasts (array of {id, message, type}). */
    toasts: { type: Array, state: true },
    /** Number of reconnect attempts (display only). */
    reconnectAttempt: { type: Number, state: true },
    _activeViewer: { type: String, state: true },
    _repoName: { type: String, state: true },
    _initComplete: { type: Boolean, state: true },
    /**
     * Whether the backend reports markitdown is installed.
     * Hydrated from get_current_state's
     * `doc_convert_available` field. Gates the Doc Convert
     * tab button — when false, the tab is hidden entirely
     * per specs4/4-features/doc-convert.md "Tab Visibility".
     * Defaults false so first paint doesn't briefly flash
     * the tab before the state snapshot arrives.
     */
    _docConvertAvailable: { type: Boolean, state: true },
    /** Dialog minimize state — persisted to localStorage. */
    _minimized: { type: Boolean, state: true },
    /**
     * Docked width when in docked mode. Applied as an inline
     * style override so the CSS `width: 50%` default still
     * governs the never-resized case.
     */
    _dockedWidth: { type: Number, state: true },
    /**
     * Undocked rectangle. null means "still docked". Set on
     * first drag or first bottom/corner resize. Once set, the
     * dialog renders with explicit pixel positioning.
     */
    _undockedPos: { type: Object, state: true },
    /**
     * Current primary mode — 'code' or 'doc'. Drives the
     * segmented toggle in the header. Synced with the
     * backend via get_current_state and mode-changed
     * broadcasts. Defaults to 'code' matching the
     * backend's default.
     */
    _mode: { type: String, state: true },
    /**
     * Cross-reference overlay toggle. Resets to false on
     * every mode switch per specs4/3-llm/modes.md. When
     * true, the other index's blocks participate in tier
     * assembly alongside the primary.
     */
    _crossRefEnabled: { type: Boolean, state: true },
    /**
     * Whether the current caller is localhost. Non-localhost
     * participants cannot initiate mode switches per
     * specs4/4-features/collaboration.md. Disables the
     * toggle UI when false. Defaults true so the UI is
     * live in single-user mode without a collab check.
     */
    _isLocalhost: { type: Boolean, state: true },
    /**
     * True while a commit_all background task is in
     * flight. Drives the header commit button's spinner
     * state and disables both commit and reset until the
     * completion event fires. Cleared by the
     * `commit-result` window event handler (see
     * _onCommitResult). Mirrors the same flag on
     * ChatPanel — both need it because both need to
     * reflect in-flight state in their own UI.
     */
    _committing: { type: Boolean, state: true },
    /**
     * True while review mode is active. Disables the
     * header commit button — review is read-only per
     * specs4/4-features/code-review.md. Reset is NOT
     * disabled in review mode (user may legitimately
     * want to discard review-mode changes). Synced via
     * the review-started / review-ended window events.
     */
    _reviewActive: { type: Boolean, state: true },
    /**
     * True while an LLM stream is in flight. Disables
     * commit and reset — both mutate the working tree,
     * and the backend's post-stream edit-application
     * phase (LLMService._stream_chat → apply_edits) is
     * not serialized against stage_all or reset_hard.
     * A commit during that window could stage
     * partially-written files; a reset could discard
     * edits mid-apply. The backend's per-path write
     * locks cover edits vs edits but not edits vs
     * stage_all / reset_hard. Gating at the UI is the
     * cheapest fix. Tracked by listening to
     * stream-chunk (first chunk flips true) and
     * stream-complete (flips false).
     */
    _streaming: { type: Boolean, state: true },
    /**
     * Compaction capacity — history token usage vs. the
     * configured trigger threshold. Shape matches
     * LLMService.get_history_status:
     *   { history_tokens, compaction_trigger,
     *     compaction_percent, compaction_enabled, ... }
     * Null before the first fetch. Refreshed on
     * stream-complete, session-changed, and successful
     * compaction events.
     */
    _historyStatus: { type: Object, state: true },
  };

  static styles = APP_SHELL_STYLES;

  constructor() {
    super();
    // JRPCClient configuration — serverURI set in connectedCallback
    // so the port is read at the right time.
    this.remoteTimeout = 60;

    this.connectionState = 'connecting';
    this.startupStage = '';
    this.startupMessage = 'Connecting…';
    this.startupPercent = 0;
    this.overlayVisible = true;
    // Hydrate persisted dialog state synchronously in the
    // constructor. Reading later (e.g. in connectedCallback
    // or setupDone) causes a visible flash where the dialog
    // renders at defaults before jumping to the saved
    // state. specs4/5-webapp/shell.md#state-restoration
    // calls for "no visible flicker" on reconnect; same
    // principle applies to first paint.
    this.activeTab = loadActiveTab(this);
    this._minimized = loadMinimized(this);
    this._dockedWidth = loadDockedWidth(this);
    this._undockedPos = loadUndockedPos(this);
    // Baseline viewport size at the moment _dockedWidth and
    // _undockedPos were last committed (pointerup or
    // resize-driven rescale). Used to rescale proportionally
    // on window resize — without a remembered baseline, each
    // resize event would start over from the pixel-literal
    // saved value and the dialog would stop tracking the
    // viewport.
    //
    // Initialised to the current viewport so the very first
    // resize after a fresh load scales from "now", not from
    // whatever viewport was active when the stored geometry
    // was originally written. The spec (§ Proportional
    // Rescaling) asks for scaling from the last-known state.
    this._dockedWidthViewport = window.innerWidth;
    this._undockedPosViewport = {
      w: window.innerWidth,
      h: window.innerHeight,
    };
    this.toasts = [];
    this.reconnectAttempt = 0;
    // Default to diff viewer — most files route there.
    // Flipped to 'svg' on navigate-file to an .svg path.
    this._activeViewer = 'diff';
    this._repoName = '';
    this._initComplete = false;
    // Doc Convert availability — flipped to true when the
    // backend's get_current_state reports markitdown is
    // installed. Stays false in stripped-down releases
    // where the tab should never appear.
    this._docConvertAvailable = false;
    // Mode toggle state. Hydrated from get_current_state
    // once the backend snapshot arrives, and kept in sync
    // via mode-changed window events.
    this._mode = 'code';
    this._crossRefEnabled = false;
    // Assume localhost until the backend tells us
    // otherwise. A future collab probe could flip this;
    // for now single-user mode is always localhost.
    this._isLocalhost = true;
    // Header git action state. _committing toggles while
    // a commit_all background task is running; cleared on
    // commit-result. _reviewActive mirrors backend review
    // state so we can disable commit in review mode.
    // _streaming toggles while an LLM request is active;
    // gates commit and reset to avoid racing the
    // post-stream edit-application phase.
    this._committing = false;
    this._reviewActive = false;
    this._streaming = false;
    // Whether a file reopen is pending (waiting for the
    // startup overlay to dismiss before issuing the RPC).
    this._pendingReopen = false;

    // Alt+Arrow debounce state. Rapid arrow sequences
    // through the file-nav grid would otherwise fire one
    // viewer.openFile per press — 10 fetches for a 10-key
    // sequence the user meant as "jump to the end". The
    // debounce defers the dispatch by ~200ms; a subsequent
    // arrow resets the timer, Alt release fires immediately.
    // HUD updates on every keypress regardless — only the
    // viewer fetch is debounced.
    this._altArrowTimer = null;
    this._altArrowPending = null;

    // Whether we've ever connected successfully. Controls
    // whether disconnects show the startup overlay (first
    // connect) vs a reconnect banner (subsequent).
    this._wasConnected = false;
    // Pending reconnect timeout handle.
    this._reconnectTimer = null;

    // Drag/resize interaction state. null when idle;
    // populated during an active drag with the origin
    // coords and the dialog's rect at drag start. Kept
    // out of reactive properties so mid-drag updates
    // don't trigger re-renders — we mutate inline styles
    // directly for smooth tracking, then commit to
    // _dockedWidth / _undockedPos on pointerup.
    this._drag = null;
    // RAF handle for window resize throttling. One call
    // per animation frame, cancelled on unmount.
    this._resizeRAF = null;
    // Separate RAF handle for viewer relayout during
    // dialog resize drags. Distinct from _resizeRAF so a
    // window-resize event in the middle of a drag
    // doesn't cancel the drag's pending viewer relayout
    // and vice versa. See specs4/5-webapp/shell.md §
    // Window Resize Handling.
    this._viewerRelayoutRAF = null;

    // Global toast event listener binding.
    this._onToastEvent = this._onToastEvent.bind(this);
    // file-saved — routes editor saves to Repo.write_file
    // or Settings.save_config_content.
    this._onFileSaved = this._onFileSaved.bind(this);
    // preview-mode-changed — fired by the diff viewer
    // whenever the user toggles the preview pane. We
    // save the viewport state immediately so a reload
    // right after a toggle-then-nothing restores the
    // correct pane. Per save-triggers table in
    // specs-reference/5-webapp/shell.md.
    this._onPreviewModeChanged =
      this._onPreviewModeChanged.bind(this);
    // viewbox-changed — fired by the SVG viewer on
    // every right-editor onViewChange. Debounced save
    // so wheel-zoom bursts don't produce one write per
    // frame. See specs-reference/5-webapp/shell.md §
    // "SVG viewBox debounce window".
    this._onSvgViewBoxChanged =
      this._onSvgViewBoxChanged.bind(this);
    this._svgViewBoxSaveTimer = null;
    // svg-presentation-changed — same pattern as
    // preview-mode-changed but for the SVG viewer's
    // presentation toggle. Saves immediately.
    this._onSvgPresentationChanged =
      this._onSvgPresentationChanged.bind(this);
    // files-reverted — after Discard Changes and
    // similar working-tree reverts, refresh open
    // viewers so stale modified buffers get replaced
    // with the new on-disk content.
    this._onFilesReverted = this._onFilesReverted.bind(this);
    // Navigate-file routing. Bound so add/remove match.
    this._onNavigateFile = this._onNavigateFile.bind(this);
    this._onActiveFileChanged = this._onActiveFileChanged.bind(this);
    this._onLoadDiffPanel = this._onLoadDiffPanel.bind(this);
    this._onToggleSvgMode = this._onToggleSvgMode.bind(this);
    this._onGridKeyDown = this._onGridKeyDown.bind(this);
    this._onGridKeyUp = this._onGridKeyUp.bind(this);
    this._onBeforeUnload = this._onBeforeUnload.bind(this);
    this._onModeChanged = this._onModeChanged.bind(this);
    // Dialog drag/resize handlers. Bound so add/remove
    // across document scope works on the same instance.
    this._onHeaderPointerDown =
      this._onHeaderPointerDown.bind(this);
    this._onHandlePointerDown =
      this._onHandlePointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    // Window resize — RAF-throttled.
    this._onWindowResize = this._onWindowResize.bind(this);
    // Global keyboard shortcuts — Alt+1..4 for tab
    // switching, Alt+M for minimize toggle. Bound here
    // so add/remove on document scope match.
    this._onGlobalKeyDown = this._onGlobalKeyDown.bind(this);
    // Header git action handlers and commit-result.
    this._onCommitResultHeader =
      this._onCommitResultHeader.bind(this);
    this._onReviewStateChanged =
      this._onReviewStateChanged.bind(this);
    // Stream state — header gates commit/reset on these.
    this._onStreamChunkHeader =
      this._onStreamChunkHeader.bind(this);
    this._onStreamCompleteHeader =
      this._onStreamCompleteHeader.bind(this);
    // Compaction capacity refresh — bound so the three
    // window event listeners share one callable and
    // removeEventListener can match. Without the bind,
    // `this` is undefined inside the handler and the
    // _fetchHistoryStatus call throws.
    this._onCompactionStatusRefresh =
      this._onCompactionStatusRefresh.bind(this);
    // Git action button dispatch from the file picker
    // header. The picker doesn't know the RPC call proxy,
    // so it fires a bubbling `git-action` window event
    // carrying {action: 'copy-diff'|'commit'|'reset'} and
    // we route to the existing handlers.
    this._onGitAction = this._onGitAction.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    this.addClass(this, 'AcApp');
    const port = getWebSocketPort();
    const host = window.location.hostname || 'localhost';
    this.serverURI = `ws://${host}:${port}`;
    window.addEventListener(TOAST_EVENT, this._onToastEvent);
    // file-saved bubbles from the diff viewer (Ctrl+S in
    // the editor, clicking the dirty status LED, or
    // explicit saveAll). The shell routes to Repo.write_file
    // for normal files, or Settings.save_config_content
    // when the file is flagged as a config file. Without
    // this handler, saves silently vanish.
    window.addEventListener('file-saved', this._onFileSaved);
    window.addEventListener(
      'preview-mode-changed', this._onPreviewModeChanged,
    );
    window.addEventListener(
      'viewbox-changed', this._onSvgViewBoxChanged,
    );
    window.addEventListener(
      'svg-presentation-changed',
      this._onSvgPresentationChanged,
    );
    // files-reverted fires from files-tab after a
    // successful Discard Changes (and in future: stage
    // rollback, reset-to-HEAD paths). Refresh open
    // viewers so any editor showing a discarded file
    // picks up the on-disk content, otherwise the
    // user's already-discarded edits stay visible and
    // the next save round-trips them back.
    window.addEventListener(
      'files-reverted', this._onFilesReverted,
    );
    // navigate-file is dispatched by the files tab (file
    // picker clicks), the chat panel (file mention clicks),
    // and the navigateFile server-push callback (when
    // another collaborator opens a file). Extension-based
    // routing picks the right viewer.
    window.addEventListener('navigate-file', this._onNavigateFile);
    // Alt+Arrow file navigation grid — capture phase so
    // we intercept before Monaco's word-navigation bindings.
    document.addEventListener('keydown', this._onGridKeyDown, true);
    document.addEventListener('keyup', this._onGridKeyUp, true);
    // Alt+digit / Alt+M shortcuts — bubble phase is fine
    // because Alt+digit/M aren't intercepted by Monaco or
    // any child component. Registered separately from the
    // grid's capture-phase handler so the two concerns
    // stay independent.
    document.addEventListener('keydown', this._onGlobalKeyDown);
    // toggle-svg-mode is dispatched by the SVG viewer's
    // "</>" button (visual → text diff) and by the diff
    // viewer's "🎨 Visual" button (text → visual). The
    // app shell orchestrates the viewer swap.
    window.addEventListener(
      'toggle-svg-mode',
      this._onToggleSvgMode,
    );
    // load-diff-panel comes from the history browser's
    // context menu (Phase 2e.4). The diff viewer's
    // loadPanel method does the actual ad-hoc
    // comparison rendering; we route from here so the
    // history browser doesn't need a direct diff viewer
    // reference.
    window.addEventListener(
      'load-diff-panel',
      this._onLoadDiffPanel,
    );
    window.addEventListener('beforeunload', this._onBeforeUnload);
    window.addEventListener('resize', this._onWindowResize);
    // mode-changed fires when any client (including us)
    // successfully switches modes or toggles cross-ref.
    // Spec is explicit: all clients follow the server's
    // authoritative mode via this broadcast.
    window.addEventListener('mode-changed', this._onModeChanged);
    // commit-result broadcasts via the server to all
    // clients; we use it here to clear the in-flight
    // flag so the header button returns to idle. The
    // viewer refresh is handled inside commitResult()
    // already.
    window.addEventListener(
      'commit-result', this._onCommitResultHeader,
    );
    // Review state — drives commit button disabling.
    // Dispatched by chat panel / files tab when review
    // starts/ends. Fallback: the get_current_state
    // snapshot hydrates it on connect.
    window.addEventListener(
      'review-started', this._onReviewStateChanged,
    );
    window.addEventListener(
      'review-ended', this._onReviewStateChanged,
    );
    // Streaming — any chunk arrival means a stream is
    // active; completion (for any request) clears it.
    // Simpler than request-ID tracking at this layer,
    // and the single-stream invariant makes it accurate.
    window.addEventListener(
      'stream-chunk', this._onStreamChunkHeader,
    );
    window.addEventListener(
      'stream-complete', this._onStreamCompleteHeader,
    );
    // Compaction capacity refresh triggers. Three
    // disjoint events because they arrive on separate
    // channels: stream-complete after an LLM turn,
    // session-changed after a restore or history-browser
    // load, and compaction-event when the compactor
    // itself fires. All route through the single
    // _onCompactionStatusRefresh handler so the fetch
    // logic (debounced, in-flight guarded) lives in
    // one place.
    window.addEventListener(
      'stream-complete', this._onCompactionStatusRefresh,
    );
    window.addEventListener(
      'session-changed', this._onCompactionStatusRefresh,
    );
    window.addEventListener(
      'compaction-event', this._onCompactionStatusRefresh,
    );
    window.addEventListener('git-action', this._onGitAction);
  }

  disconnectedCallback() {
    window.removeEventListener(TOAST_EVENT, this._onToastEvent);
    window.removeEventListener('file-saved', this._onFileSaved);
    window.removeEventListener(
      'preview-mode-changed', this._onPreviewModeChanged,
    );
    window.removeEventListener(
      'viewbox-changed', this._onSvgViewBoxChanged,
    );
    window.removeEventListener(
      'svg-presentation-changed',
      this._onSvgPresentationChanged,
    );
    if (this._svgViewBoxSaveTimer) {
      clearTimeout(this._svgViewBoxSaveTimer);
      this._svgViewBoxSaveTimer = null;
    }
    window.removeEventListener(
      'files-reverted', this._onFilesReverted,
    );
    window.removeEventListener('resize', this._onWindowResize);
    // Cancel any pending RAF callback — leaking it would fire
    // after the element is gone and try to query a detached
    // shadow root.
    if (this._resizeRAF) {
      cancelAnimationFrame(this._resizeRAF);
      this._resizeRAF = null;
    }
    if (this._viewerRelayoutRAF) {
      cancelAnimationFrame(this._viewerRelayoutRAF);
      this._viewerRelayoutRAF = null;
    }
    // If a drag was in progress at unmount (unusual but
    // possible during hot reload), remove document-scope
    // listeners so they don't keep the stale handler alive.
    document.removeEventListener('pointermove', this._onPointerMove);
    document.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener(
      'navigate-file',
      this._onNavigateFile,
    );
    document.removeEventListener('keydown', this._onGridKeyDown, true);
    document.removeEventListener('keyup', this._onGridKeyUp, true);
    document.removeEventListener('keydown', this._onGlobalKeyDown);
    window.removeEventListener(
      'toggle-svg-mode',
      this._onToggleSvgMode,
    );
    window.removeEventListener(
      'load-diff-panel',
      this._onLoadDiffPanel,
    );
    window.removeEventListener('beforeunload', this._onBeforeUnload);
    window.removeEventListener('mode-changed', this._onModeChanged);
    window.removeEventListener(
      'commit-result', this._onCommitResultHeader,
    );
    window.removeEventListener(
      'review-started', this._onReviewStateChanged,
    );
    window.removeEventListener(
      'review-ended', this._onReviewStateChanged,
    );
    window.removeEventListener(
      'stream-chunk', this._onStreamChunkHeader,
    );
    window.removeEventListener(
      'stream-complete', this._onStreamCompleteHeader,
    );
    window.removeEventListener(
      'stream-complete', this._onCompactionStatusRefresh,
    );
    window.removeEventListener(
      'session-changed', this._onCompactionStatusRefresh,
    );
    window.removeEventListener(
      'compaction-event', this._onCompactionStatusRefresh,
    );
    window.removeEventListener('git-action', this._onGitAction);
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    super.disconnectedCallback();
  }

  // ---------------------------------------------------------------
  // JRPCClient lifecycle hooks
  // ---------------------------------------------------------------

  setupDone() {
    super.setupDone();
    // Publish the call proxy to the shared singleton. Child
    // components using RpcMixin subscribe to this and wake up.
    SharedRpc.set(this.call);
    this.connectionState = 'connected';
    this.reconnectAttempt = 0;

    if (this._wasConnected) {
      // This is a reconnect, not the first connect. Skip the
      // startup overlay and show a success toast instead.
      this.overlayVisible = false;
      this._showToast('Reconnected', 'success');
    }
    this._wasConnected = true;

    // Fetch the authoritative state snapshot. This gives us
    // the repo name (for the browser tab title), the message
    // history (restored from the last session on the server),
    // selected files, streaming status, and init_complete.
    this._fetchCurrentState();

    // Initial history-status fetch so the compaction bar
    // reflects restored-session tokens from the first paint.
    // Subsequent refreshes come through the event handlers.
    this._fetchHistoryStatus();
  }

  remoteDisconnected() {
    try {
      super.remoteDisconnected?.();
    } catch (err) {
      // Defensive — jrpc-oo API may not always expose the
      // parent hook. Swallow and continue.
    }
    SharedRpc.set(null);
    this.connectionState = 'disconnected';
    if (this._wasConnected) {
      this._scheduleReconnect();
    }
  }

  setupSkip() {
    // Connection attempt failed entirely — schedule retry.
    try {
      super.setupSkip?.();
    } catch (err) {
      // same defensive rationale
    }
    if (!this._wasConnected) {
      // First-connect failure — stay on the startup overlay
      // with an updated message so the user sees progress.
      this.startupMessage = 'Waiting for server…';
    }
    this._scheduleReconnect();
  }

  // ---------------------------------------------------------------
  // Server-push callbacks (registered via addClass(this, 'AcApp'))
  // ---------------------------------------------------------------

  /**
   * Startup progress event. Drives the overlay's message +
   * progress bar. When stage === 'ready', the overlay fades out.
   *
   * Doc-index stages (listed in DOC_INDEX_STAGES) are
   * intercepted here and re-dispatched on the
   * `doc-index-progress` window channel so the doc-index
   * overlay component handles them instead of the startup
   * overlay. Without this split, a long enrichment run
   * arriving after the `ready` stage would re-show the
   * already-dismissed startup overlay, which would be jarring.
   *
   * specs4/5-webapp/shell.md#startup-overlay pins the stage names
   * and message conventions; the backend's startup sequence fires
   * these in order during deferred init.
   */
  startupProgress(stage, message, percent) {
    // Doc-index-related stages take a separate path — they
    // flow to ac-doc-index-progress via the doc-index-progress
    // window channel, not to the startup overlay.
    if (stage && DOC_INDEX_STAGES.has(stage)) {
      window.dispatchEvent(new CustomEvent('doc-index-progress', {
        detail: { stage, message, percent },
      }));
      return true;
    }

    this.startupStage = stage || '';
    this.startupMessage = message || '';
    this.startupPercent = Math.max(0, Math.min(100, percent || 0));
    if (stage === 'ready') {
      this._initComplete = true;
      // Fade out shortly after ready so the user briefly sees
      // 100%. The CSS transition handles the actual fade.
      setTimeout(() => {
        this.overlayVisible = false;
        // If a file reopen was deferred waiting for the
        // overlay to dismiss, do it now.
        if (this._pendingReopen) {
          const path = this._loadLastOpenFile();
          if (path) this._doReopenLastFile(path);
        }
      }, 400);
    }
    return true;
  }

  // Stubs for Phase 2/3 callbacks. Declared so the addClass
  // registration exposes them over RPC from day one — the
  // backend will call them even in Phase 1 and we want "method
  // not found" errors to surface in logs rather than silently
  // vanishing.

  streamChunk(requestId, content) {
    // Phase 2: chat panel listens via window event.
    window.dispatchEvent(new CustomEvent('stream-chunk', {
      detail: { requestId, content },
    }));
    return true;
  }

  streamComplete(requestId, result) {
    window.dispatchEvent(new CustomEvent('stream-complete', {
      detail: { requestId, result },
    }));
    // Post-edit viewer refresh. When the LLM's edit
    // pipeline writes to disk, open viewers are still
    // showing the pre-edit content cached in their
    // internal _files array. Without this call, the
    // diff viewer's same-file suppression means a
    // click-away-and-back leaves the stale content
    // visible — and re-sending the same prompt yields
    // a confusing "already applied" result against
    // what looks like unchanged content.
    //
    // specs4/5-webapp/diff-viewer.md event routing table:
    //   "Post-edit refresh — Direct call from app shell"
    //
    // We refresh whichever viewer is currently active.
    // The inactive viewer's files are necessarily stale
    // too, but they'll re-fetch on next activation
    // because closeFile/openFile fetch fresh content —
    // actually no, refreshOpenFiles operates on the
    // internal _files array and is cheap (skips closed
    // files), so call it on both. Each viewer's
    // refreshOpenFiles iterates only its own open files
    // and no-ops when empty.
    const modified =
      result && Array.isArray(result.files_modified)
        ? result.files_modified
        : [];
    if (modified.length > 0) {
      const diffViewer =
        this.shadowRoot?.querySelector('ac-diff-viewer');
      const svgViewer =
        this.shadowRoot?.querySelector('ac-svg-viewer');
      if (diffViewer && typeof diffViewer.refreshOpenFiles === 'function') {
        // Fire and forget — viewer handles its own errors.
        diffViewer.refreshOpenFiles().catch((err) => {
          console.warn('[app-shell] diff viewer refresh failed', err);
        });
      }
      if (svgViewer && typeof svgViewer.refreshOpenFiles === 'function') {
        svgViewer.refreshOpenFiles().catch((err) => {
          console.warn('[app-shell] svg viewer refresh failed', err);
        });
      }
    }
    return true;
  }

  compactionEvent(requestId, event) {
    window.dispatchEvent(new CustomEvent('compaction-event', {
      detail: { requestId, event },
    }));
    return true;
  }

  filesChanged(selectedFiles) {
    window.dispatchEvent(new CustomEvent('files-changed', {
      detail: { selectedFiles },
    }));
    return true;
  }

  filesModified(paths) {
    // Backend signals disk changes (created, modified, or
    // deleted files) after edit-pipeline apply, commits,
    // and resets. The files tab listens for the hyphenated
    // DOM event and reloads the file tree via RPC, which
    // picks up new untracked files and refreshed git
    // status badges.
    //
    // Note the event-name difference: the server-push hook
    // is camelCase (`filesModified`) to match the existing
    // `filesChanged` / `commitResult` naming convention;
    // the DOM event is hyphenated (`files-modified`) to
    // match what file-picker.md "Files Tab Orchestration"
    // specifies and what files-tab.js already listens for.
    window.dispatchEvent(new CustomEvent('files-modified', {
      detail: { paths: Array.isArray(paths) ? paths : [] },
    }));
    return true;
  }

  userMessage(data) {
    window.dispatchEvent(new CustomEvent('user-message', { detail: data }));
    return true;
  }

  commitResult(result) {
    window.dispatchEvent(new CustomEvent('commit-result', { detail: result }));
    // Refresh open viewers after a commit. The working
    // copy is unchanged, but HEAD moved — the diff
    // viewer's left (original) side is now stale, and
    // the status LED should flip from "new-file" cyan
    // to "clean" green for files that just landed in
    // HEAD. refreshOpenFiles re-fetches both sides so
    // this falls out naturally.
    const diffViewer =
      this.shadowRoot?.querySelector('ac-diff-viewer');
    const svgViewer =
      this.shadowRoot?.querySelector('ac-svg-viewer');
    if (diffViewer && typeof diffViewer.refreshOpenFiles === 'function') {
      diffViewer.refreshOpenFiles().catch((err) => {
        console.warn('[app-shell] diff viewer refresh failed', err);
      });
    }
    if (svgViewer && typeof svgViewer.refreshOpenFiles === 'function') {
      svgViewer.refreshOpenFiles().catch((err) => {
        console.warn('[app-shell] svg viewer refresh failed', err);
      });
    }
    return true;
  }

  modeChanged(data) {
    window.dispatchEvent(new CustomEvent('mode-changed', { detail: data }));
    return true;
  }

  agentsSpawned(data) {
    // Fired by the backend immediately after the main LLM
    // finishes and before spawning agents. Carries
    // {turn_id, parent_request_id, agent_blocks} so the
    // chat panel can create agent tabs in time to receive
    // the child streams. See specs4/7-future/
    // parallel-agents.md § Execution Model.
    window.dispatchEvent(
      new CustomEvent('agents-spawned', { detail: data }),
    );
    return true;
  }

  sessionChanged(data) {
    window.dispatchEvent(new CustomEvent('session-changed', { detail: data }));
    return true;
  }

  reviewStarted(data) {
    // Re-dispatch as a window event so files-tab's
    // `_onReviewStarted` handler fires. files-tab
    // stores the review state, pushes it to the
    // picker (which renders the amber banner), and
    // triggers a tree reload + auto-select pass so
    // the staged review files get ticked.
    window.dispatchEvent(
      new CustomEvent('review-started', { detail: data }),
    );
    return true;
  }

  reviewEnded(data) {
    // Symmetric with reviewStarted. The `data`
    // payload is the empty-state review shape
    // (active=False); files-tab's handler clears its
    // local state and reloads the tree to reflect the
    // restored HEAD.
    window.dispatchEvent(
      new CustomEvent('review-ended', { detail: data }),
    );
    return true;
  }

  navigateFile(data) {
    // The `_remote: true` flag lets the frontend distinguish
    // broadcast-driven navigation from user-initiated, so
    // collaborators don't echo-broadcast.
    window.dispatchEvent(new CustomEvent('navigate-file', {
      detail: { ...data, _remote: true },
    }));
    return true;
  }

  docConvertProgress(data) {
    window.dispatchEvent(new CustomEvent('doc-convert-progress', {
      detail: data,
    }));
    return true;
  }

  // Collab callbacks — Phase 3.
  admissionRequest(data) {
    window.dispatchEvent(new CustomEvent('admission-request', { detail: data }));
    return true;
  }

  admissionResult(data) {
    window.dispatchEvent(new CustomEvent('admission-result', { detail: data }));
    return true;
  }

  clientJoined(data) {
    window.dispatchEvent(new CustomEvent('client-joined', { detail: data }));
    return true;
  }

  clientLeft(data) {
    window.dispatchEvent(new CustomEvent('client-left', { detail: data }));
    return true;
  }

  roleChanged(data) {
    window.dispatchEvent(new CustomEvent('role-changed', { detail: data }));
    return true;
  }

  // ---------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------

  _switchTab(tab) {
    this.activeTab = tab;
    try {
      localStorage.setItem('ac-dc-active-tab', tab);
    } catch (_) {
      // localStorage can throw in private-browsing modes or
      // when quota is exhausted. Persistence is best-effort.
    }
  }

  // ---------------------------------------------------------------
  // Helper-module delegating methods
  // ---------------------------------------------------------------

  _showToast(message, type = 'info') {
    return showToast(this, message, type);
  }

  _onToastEvent(event) {
    return onToastEvent(this, event);
  }

  _maybeShowEnrichmentUnavailableToast(status) {
    return maybeShowEnrichmentUnavailableToast(this, status);
  }

  _scheduleReconnect() {
    return scheduleReconnect(this);
  }

  _attemptReconnect() {
    return attemptReconnect(this);
  }

  _getDialogRect() {
    return getDialogRect(this);
  }

  _onHeaderPointerDown(event) {
    return onHeaderPointerDown(this, event);
  }

  _onHandlePointerDown(event, which) {
    return onHandlePointerDown(this, event, which);
  }

  _onPointerMove(event) {
    return onPointerMove(this, event);
  }

  _onPointerUp() {
    return onPointerUp(this);
  }

  _toggleMinimize() {
    return toggleMinimize(this);
  }

  _onWindowResize() {
    return onWindowResize(this);
  }

  _handleWindowResize() {
    return handleWindowResize(this);
  }

  _dialogInlineStyle() {
    return dialogInlineStyle(this);
  }

  _getFileNav() {
    return getFileNav(this);
  }

  _onGridKeyDown(event) {
    return onGridKeyDown(this, event);
  }

  _onGridKeyUp(event) {
    return onGridKeyUp(this, event);
  }

  _flushAltArrowPending() {
    return flushAltArrowPending(this);
  }

  _onGlobalKeyDown(event) {
    return onGlobalKeyDown(this, event);
  }

  _onNavigateFile(event) {
    return onNavigateFile(this, event);
  }

  _onLoadDiffPanel(event) {
    return onLoadDiffPanel(this, event);
  }

  _onToggleSvgMode(event) {
    return onToggleSvgMode(this, event);
  }

  _onActiveFileChanged(event) {
    return onActiveFileChanged(this, event);
  }

  _scheduleViewerRelayout() {
    return scheduleViewerRelayout(this);
  }

  _relayoutViewers() {
    return relayoutViewers(this);
  }

  _saveViewportState() {
    return saveViewportState(this);
  }

  _saveSvgViewportState() {
    return saveSvgViewportState(this);
  }

  _loadViewportState() {
    return loadViewportState(this);
  }

  _tryReopenLastFile() {
    return tryReopenLastFile(this);
  }

  _doReopenLastFile(path) {
    return doReopenLastFile(this, path);
  }

  _doReopenSvg(path, svgState) {
    return doReopenSvg(this, path, svgState);
  }

  _restoreViewport(viewer, state, preview) {
    return restoreViewport(this, viewer, state, preview);
  }

  _onBeforeUnload() {
    return onBeforeUnload(this);
  }

  _onPreviewModeChanged(event) {
    return onPreviewModeChanged(this, event);
  }

  _onSvgViewBoxChanged(event) {
    return onSvgViewBoxChanged(this, event);
  }

  _onSvgPresentationChanged(event) {
    return onSvgPresentationChanged(this, event);
  }

  async _fetchCurrentState() {
    return fetchCurrentState(this);
  }

  async _fetchHistoryStatus() {
    return fetchHistoryStatus(this);
  }

  _onCompactionStatusRefresh() {
    return onCompactionStatusRefresh(this);
  }

  _onModeChanged(event) {
    return onModeChanged(this, event);
  }

  async _switchMode(mode) {
    return switchMode(this, mode);
  }

  async _toggleCrossRef() {
    return toggleCrossRef(this);
  }

  _onGitAction(event) {
    return onGitAction(this, event);
  }

  _onCommitResultHeader() {
    return onCommitResultHeader(this);
  }

  _onReviewStateChanged(event) {
    return onReviewStateChanged(this, event);
  }

  _onStreamChunkHeader() {
    return onStreamChunkHeader(this);
  }

  _onStreamCompleteHeader() {
    return onStreamCompleteHeader(this);
  }

  async _onCopyDiff() {
    return onCopyDiff(this);
  }

  async _onCommit() {
    return onCommit(this);
  }

  async _onResetToHead() {
    return onResetToHead(this);
  }

  async _onFileSaved(event) {
    return onFileSaved(this, event);
  }

  _onFilesReverted(event) {
    return onFilesReverted(this, event);
  }

  _loadActiveTab() {
    return loadActiveTab(this);
  }

  _loadMinimized() {
    return loadMinimized(this);
  }

  _loadDockedWidth() {
    return loadDockedWidth(this);
  }

  _loadUndockedPos() {
    return loadUndockedPos(this);
  }

  _saveMinimized() {
    return saveMinimized(this);
  }

  _saveDockedWidth() {
    return saveDockedWidth(this);
  }

  _saveUndockedPos() {
    return saveUndockedPos(this);
  }

  _saveLastOpenFile(path) {
    return saveLastOpenFile(this, path);
  }

  _loadLastOpenFile() {
    return loadLastOpenFile(this);
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  render() {
    return renderTemplate(this);
  }
}

customElements.define('ac-app-shell', AppShell);