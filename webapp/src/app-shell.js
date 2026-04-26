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
// Import from the pre-bundled distribution rather than the
// ESM source. The package's jrpc-client.js re-exports
// JRPCExport.js which references a `JRPC` global set up by
// the UMD bundle's side effects — importing the ESM path
// directly produces `ReferenceError: JRPC is not defined`
// at runtime. The dist bundle inlines everything it needs.
import { JRPCClient } from '@flatmax/jrpc-oo/dist/bundle.js';

import { SharedRpc } from './rpc.js';
import './files-tab.js';
import './diff-viewer.js';
import './svg-viewer.js';
import './settings-tab.js';
import './context-tab.js';
import './doc-convert-tab.js';
import './file-nav.js';
import './token-hud.js';
import './compaction-progress.js';
import { viewerForPath } from './viewer-routing.js';

// ---------------------------------------------------------------
// localStorage persistence helpers
// ---------------------------------------------------------------

/**
 * Build a repo-scoped localStorage key. Falls back to the
 * bare key when the repo name isn't known yet. Scoping
 * prevents opening a different repo from restoring the
 * wrong file.
 */
function _repoKey(key, repoName) {
  if (repoName) return `${key}:${repoName}`;
  return key;
}

const _LAST_OPEN_FILE_KEY = 'ac-last-open-file';
const _LAST_VIEWPORT_KEY = 'ac-last-viewport';

// ---------------------------------------------------------------
// Dialog persistence keys and sizing constants
// ---------------------------------------------------------------
//
// specs4/5-webapp/shell.md pins these four keys and the default
// dock behaviour. `ac-dc-dialog-width` is the docked width (a
// single number); `ac-dc-dialog-pos` is the full undocked rect
// (JSON with left/top/width/height). They're separate so the
// docked width survives an undock-then-redock cycle without
// being clobbered by stale position data.

const _DIALOG_WIDTH_KEY = 'ac-dc-dialog-width';
const _DIALOG_POS_KEY = 'ac-dc-dialog-pos';
const _DIALOG_MIN_KEY = 'ac-dc-minimized';
const _ACTIVE_TAB_KEY = 'ac-dc-active-tab';

// Minimum size during resize. Keep these generous — below
// ~300 wide the tab buttons start wrapping, and below ~200
// tall the dialog body collapses unusably.
const _DIALOG_MIN_WIDTH = 300;
const _DIALOG_MIN_HEIGHT = 200;
// When restoring an undocked position, at least this many
// pixels must remain inside the viewport on both axes.
// Otherwise the dialog may be stranded off-screen after a
// monitor disconnect or resolution change.
const _DIALOG_VISIBLE_MARGIN = 100;
// Drag threshold (px). Below this, treat header pointerdown +
// pointerup as a click. Matches the specs4 convention of 5px.
const _DIALOG_DRAG_THRESHOLD = 5;

// Which edge/corner a resize handle represents. Drives the
// delta math: right moves the right edge, bottom moves the
// bottom edge, corner moves both.
const _RESIZE_RIGHT = 'right';
const _RESIZE_BOTTOM = 'bottom';
const _RESIZE_CORNER = 'corner';

/**
 * Read the WebSocket port from the URL, falling back to 18080.
 *
 * Duplicates the logic from main.js so AppShell is self-contained —
 * the shell should be testable without main.js having run.
 * specs4/1-foundation/rpc-transport.md pins the ?port=N contract
 * between the Python launcher and the webapp.
 */
function getWebSocketPort() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('port');
  if (!raw) return 18080;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0 || parsed > 65535) {
    return 18080;
  }
  return parsed;
}

/**
 * Reconnection backoff schedule (ms).
 *
 * specs4/1-foundation/rpc-transport.md calls for "exponential
 * backoff (1s, 2s, 4s, 8s, cap 15s)". The 0th entry is the
 * delay before the FIRST reconnect attempt; subsequent entries
 * apply to retry 2, 3, ...
 */
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

/**
 * Name of the custom event used by child components (or utility
 * modules) to request a toast message. The shell catches these
 * and displays them in its toast layer.
 *
 * specs4/5-webapp/shell.md#toast-system — "Components dispatch
 * toast events; the shell catches and renders them."
 */
const TOAST_EVENT = 'ac-toast';

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
     * specs3/4-features/code_review.md. Reset is NOT
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

  static styles = css`
    :host {
      display: block;
      position: fixed;
      inset: 0;
      overflow: hidden;
      background: var(--bg-primary, #0d1117);
      color: var(--text-primary, #c9d1d9);
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    }

    /* Viewer background -- the diff viewer and SVG viewer
     * are absolutely-positioned siblings filling the
     * background layer. Only one is visible at a time
     * (class viewer-visible vs viewer-hidden). Opacity +
     * pointer-events transition gives a smooth cross-fade
     * without rebuilding the inactive viewer's DOM --
     * matters for the diff viewer's Monaco instances,
     * which are expensive to construct.
     *
     * Explicit z-index on the background keeps it below
     * the dialog. Without this, the viewers' internal
     * position:fixed (Monaco editor) can escape and
     * cover the dialog entirely — their position:fixed
     * anchors to the nearest ancestor with a transform
     * or will-change, or the viewport otherwise. */
    .viewer-background {
      position: absolute;
      inset: 0;
      overflow: hidden;
      z-index: 0;
    }
    ac-diff-viewer,
    ac-svg-viewer {
      position: absolute;
      inset: 0;
      transition: opacity 150ms ease;
    }
    .viewer-visible {
      opacity: 1;
      pointer-events: auto;
      z-index: 1;
    }
    .viewer-hidden {
      opacity: 0;
      pointer-events: none;
      z-index: 0;
    }

    /* Dialog — foreground panel. Explicit z-index keeps
     * it above the viewer background regardless of what
     * internal positioning the viewer components use.
     *
     * Two layout modes:
     *   Docked (default)   — top/left/bottom anchored to
     *                        viewport edges, width as a %
     *                        (overridable via inline style
     *                        for docked-width persistence).
     *   Undocked (.floating) — all four edges set by inline
     *                        style from _undockedPos; the
     *                        CSS "bottom: 0" is disabled by
     *                        "bottom: auto".
     *
     * Minimized collapses to the header only. We force a
     * fixed height rather than relying on content-hugging
     * because the body has "flex: 1" and would otherwise
     * pull the dialog to full height even with no children. */
    .dialog {
      position: absolute;
      top: 0;
      left: 0;
      bottom: 0;
      width: 50%;
      min-width: 400px;
      background: rgba(22, 27, 34, 0.95);
      border-right: 1px solid rgba(240, 246, 252, 0.1);
      display: flex;
      flex-direction: column;
      backdrop-filter: blur(8px);
      z-index: 10;
    }
    .dialog.floating {
      /* Undocked: disable the docked bottom anchor so the
       * inline height style takes effect. Shadow gives
       * visual separation from the viewer background. */
      bottom: auto;
      min-width: unset;
      border-right: 1px solid rgba(240, 246, 252, 0.1);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
    }
    .dialog.minimized {
      height: auto !important;
      bottom: auto;
    }
    .dialog.minimized .dialog-body,
    .dialog.minimized .reconnect-banner,
    .dialog.minimized .compaction-bar {
      display: none;
    }
    .dialog.dragging,
    .dialog.resizing {
      /* Disable text selection and remove the transition
       * during a drag so the pointer tracks 1:1. */
      user-select: none;
      transition: none;
    }
    .dialog-header {
      display: flex;
      gap: 0.25rem;
      padding: 0.5rem;
      border-bottom: 1px solid rgba(240, 246, 252, 0.1);
      align-items: center;
      /* The header background (not its buttons) is the drag
       * handle. Buttons override cursor:default. */
      cursor: grab;
    }
    .dialog.dragging .dialog-header {
      cursor: grabbing;
    }
    .dialog-header .tab-button {
      cursor: pointer;
    }
    .dialog-header .minimize-button {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-primary, #c9d1d9);
      padding: 0.4rem 0.6rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.875rem;
      opacity: 0.7;
    }
    .dialog-header .minimize-button:hover {
      opacity: 1;
      background: rgba(240, 246, 252, 0.05);
    }

    /* Mode toggle — segmented code/doc buttons plus a
     * separate cross-ref overlay toggle. Sits between
     * the git actions group and the minimize button.
     * No margin-left: auto here — the git-actions
     * group's symmetric auto margins already push
     * everything to the right of it against the
     * minimize button per specs3 §Header Sections
     * ("centered in the gap between the tab buttons
     * and the right-side controls"). */
    .mode-toggle {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .mode-segmented {
      display: inline-flex;
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 4px;
      overflow: hidden;
    }
    .mode-segmented .mode-btn {
      background: transparent;
      border: none;
      color: var(--text-primary, #c9d1d9);
      padding: 0.35rem 0.6rem;
      font-size: 0.8125rem;
      cursor: pointer;
      opacity: 0.65;
      transition: opacity 120ms ease, background 120ms ease;
    }
    .mode-segmented .mode-btn:hover:not([disabled]) {
      opacity: 1;
      background: rgba(240, 246, 252, 0.05);
    }
    .mode-segmented .mode-btn.active {
      opacity: 1;
      background: rgba(88, 166, 255, 0.15);
      color: var(--accent-primary, #58a6ff);
    }
    .mode-segmented .mode-btn[disabled] {
      opacity: 0.3;
      cursor: not-allowed;
    }
    .crossref-btn {
      background: transparent;
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 4px;
      color: var(--text-primary, #c9d1d9);
      padding: 0.35rem 0.55rem;
      font-size: 0.8125rem;
      cursor: pointer;
      opacity: 0.65;
      transition: opacity 120ms ease, background 120ms ease;
    }
    .crossref-btn:hover:not([disabled]) {
      opacity: 1;
      background: rgba(240, 246, 252, 0.05);
    }
    .crossref-btn.active {
      opacity: 1;
      background: rgba(210, 153, 34, 0.15);
      border-color: rgba(210, 153, 34, 0.4);
      color: #d29922;
    }
    .crossref-btn[disabled] {
      opacity: 0.3;
      cursor: not-allowed;
    }

    /* Header git actions: symmetric auto margins center the
     * group between flex siblings; mode toggle's auto-left push
     * was removed so this centering holds. Danger variant
     * (reset) tints red to distinguish from benign actions. */
    .header-git-actions {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      margin-left: auto;
      margin-right: auto;
    }
    .git-action-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-primary, #c9d1d9);
      padding: 0.35rem 0.5rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.95rem;
      line-height: 1;
      opacity: 0.75;
      transition: opacity 120ms ease, background 120ms ease;
    }
    .git-action-btn:hover:not([disabled]) {
      opacity: 1;
      background: rgba(240, 246, 252, 0.08);
    }
    .git-action-btn.danger:hover:not([disabled]) {
      background: rgba(248, 81, 73, 0.15);
      border-color: rgba(248, 81, 73, 0.3);
    }
    .git-action-btn.in-flight {
      opacity: 1;
      background: rgba(88, 166, 255, 0.12);
      border-color: rgba(88, 166, 255, 0.3);
    }
    .git-action-btn[disabled] {
      opacity: 0.3;
      cursor: not-allowed;
    }

    /* Resize handles — invisible hit zones at the edges.
     * Right and bottom handles take a single axis; the
     * corner handle takes both. Hover shows a subtle
     * accent line so the handle is discoverable without
     * being distracting. */
    .resize-handle {
      position: absolute;
      z-index: 11;
      background: transparent;
      transition: background 120ms ease;
    }
    .resize-handle.right {
      top: 0;
      bottom: 0;
      right: -4px;
      width: 8px;
      cursor: ew-resize;
    }
    .resize-handle.bottom {
      left: 0;
      right: 0;
      bottom: -4px;
      height: 8px;
      cursor: ns-resize;
    }
    .resize-handle.corner {
      right: -4px;
      bottom: -4px;
      width: 14px;
      height: 14px;
      cursor: nwse-resize;
      z-index: 12;
    }
    .resize-handle:hover {
      background: rgba(88, 166, 255, 0.25);
    }
    .dialog.minimized .resize-handle.bottom,
    .dialog.minimized .resize-handle.corner {
      display: none;
    }
    .tab-button {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-primary, #c9d1d9);
      padding: 0.4rem 0.8rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.875rem;
    }
    .tab-button:hover {
      background: rgba(240, 246, 252, 0.05);
    }
    .tab-button.active {
      background: rgba(88, 166, 255, 0.12);
      border-color: rgba(88, 166, 255, 0.3);
      color: var(--accent-primary, #58a6ff);
    }
    .dialog-body {
      flex: 1;
      min-height: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .dialog-body > ac-files-tab {
      flex: 1;
      min-height: 0;
    }

    /* Compaction-capacity bar — a thin strip at the bottom
     * of the dialog showing the ratio of current history
     * tokens to the compaction trigger threshold. Colour
     * mirrors the budget-bar convention used by the Context
     * tab and Token HUD: green below 75%, amber 75-90%, red
     * above 90%.
     *
     * Positioned inside .dialog as the last child before the
     * resize handles. The bottom resize-handle sits at
     * bottom: -4px with height: 8px, so its 8px hit zone
     * overlays the bar's upper half without preventing pointer
     * events on the bar itself (which takes no pointer
     * events — it's informational only).
     *
     * Inner .compaction-bar-fill drives the width. Transition
     * makes the shrink on a successful compaction visible —
     * going from 100% to 5% is the moment this bar earns its
     * screen space. Without the transition the change would
     * be a jarring jump.
     *
     * Hidden in minimized state via the .minimized rule below
     * so a collapsed dialog doesn't dedicate height to it.
     */
    .compaction-bar {
      flex-shrink: 0;
      position: relative;
      height: 4px;
      background: rgba(240, 246, 252, 0.06);
      border-top: 1px solid rgba(240, 246, 252, 0.05);
      pointer-events: none;
      overflow: hidden;
    }
    .compaction-bar-fill {
      height: 100%;
      transition: width 300ms ease, background 300ms ease;
    }
    /* Tab panels — all mounted into the DOM, but only the
     * active one is visible. Matches specs3
     * app_shell_and_dialog.md "Lazy Loading and DOM
     * Preservation": "tab panels remain in DOM (hidden
     * via CSS, not destroyed). Switching tabs toggles
     * the .active class."
     *
     * Using display: none on inactive panels (rather than
     * visibility: hidden) takes them out of the flex
     * layout entirely so the active panel can claim the
     * full dialog body height via flex: 1. The inactive
     * panel's internal state — including the chat
     * panel's textarea value, scroll position, and
     * streaming state — is preserved because Lit never
     * unmounts the element. */
    .tab-panel {
      flex: 1;
      min-height: 0;
      display: none;
      flex-direction: column;
    }
    .tab-panel.active {
      display: flex;
    }
    .tab-placeholder {
      opacity: 0.5;
      font-style: italic;
      padding: 2rem;
      text-align: center;
    }

    /* Startup overlay. */
    .startup-overlay {
      position: absolute;
      inset: 0;
      background: var(--bg-primary, #0d1117);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      transition: opacity 400ms ease-out;
    }
    .startup-overlay.fading {
      opacity: 0;
      pointer-events: none;
    }
    .startup-brand {
      font-size: 5rem;
      margin-bottom: 2rem;
      letter-spacing: -0.05em;
    }
    .startup-brand .bolt {
      color: var(--accent-primary, #58a6ff);
    }
    .startup-message {
      font-size: 1rem;
      margin-bottom: 1rem;
      opacity: 0.75;
    }
    .startup-progress {
      width: 300px;
      height: 4px;
      background: rgba(240, 246, 252, 0.1);
      border-radius: 2px;
      overflow: hidden;
    }
    .startup-progress-bar {
      height: 100%;
      background: var(--accent-primary, #58a6ff);
      transition: width 300ms ease;
    }

    /* Reconnect banner — sits below dialog header when
     * connection is lost. */
    .reconnect-banner {
      background: rgba(248, 81, 73, 0.15);
      color: #f85149;
      padding: 0.5rem 1rem;
      font-size: 0.85rem;
      text-align: center;
      border-bottom: 1px solid rgba(248, 81, 73, 0.3);
    }

    /* Toast layer. */
    .toast-layer {
      position: fixed;
      bottom: 1rem;
      right: 1rem;
      z-index: 2000;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .toast {
      background: rgba(22, 27, 34, 0.95);
      border: 1px solid rgba(240, 246, 252, 0.2);
      border-radius: 6px;
      padding: 0.75rem 1rem;
      font-size: 0.875rem;
      min-width: 200px;
      max-width: 400px;
      backdrop-filter: blur(8px);
      animation: toast-in 200ms ease-out;
    }
    .toast.info { border-left: 3px solid var(--accent-primary, #58a6ff); }
    .toast.success { border-left: 3px solid #7ee787; }
    .toast.error { border-left: 3px solid #f85149; }
    .toast.warning { border-left: 3px solid #d29922; }
    @keyframes toast-in {
      from { opacity: 0; transform: translateX(20px); }
      to { opacity: 1; transform: translateX(0); }
    }
  `;

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
    this.activeTab = this._loadActiveTab();
    this._minimized = this._loadMinimized();
    this._dockedWidth = this._loadDockedWidth();
    this._undockedPos = this._loadUndockedPos();
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

    // Global toast event listener binding.
    this._onToastEvent = this._onToastEvent.bind(this);
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
  }

  connectedCallback() {
    super.connectedCallback();
    this.addClass(this, 'AcApp');
    const port = getWebSocketPort();
    const host = window.location.hostname || 'localhost';
    this.serverURI = `ws://${host}:${port}`;
    window.addEventListener(TOAST_EVENT, this._onToastEvent);
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
  }

  disconnectedCallback() {
    window.removeEventListener(TOAST_EVENT, this._onToastEvent);
    window.removeEventListener('resize', this._onWindowResize);
    // Cancel any pending RAF callback — leaking it would fire
    // after the element is gone and try to query a detached
    // shadow root.
    if (this._resizeRAF) {
      cancelAnimationFrame(this._resizeRAF);
      this._resizeRAF = null;
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

  /**
   * Fetch get_current_state and dispatch the state-loaded
   * event so child components (files tab, chat panel) can
   * restore their UI.
   */
  async _fetchCurrentState() {
    if (!this.call) return;
    try {
      const fn = this.call['LLMService.get_current_state'];
      if (typeof fn !== 'function') return;
      const raw = await fn();
      // Unwrap jrpc-oo envelope.
      let state = raw;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const keys = Object.keys(raw);
        if (keys.length === 1) {
          const inner = raw[keys[0]];
          if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
            state = inner;
          }
        }
      }
      if (!state || typeof state !== 'object') return;
      // Update browser tab title from repo name.
      if (state.repo_name) {
        this._repoName = state.repo_name;
        document.title = state.repo_name;
      }
      this._initComplete = !!state.init_complete;
      // Hydrate mode state from the snapshot. Defaults
      // cover older backends that don't report these
      // fields yet.
      if (typeof state.mode === 'string') {
        this._mode = state.mode;
      }
      if (typeof state.cross_ref_enabled === 'boolean') {
        this._crossRefEnabled = state.cross_ref_enabled;
      }
      // Review state — the snapshot carries a review
      // object with `active: bool`. Missing field means
      // no review in progress.
      if (state.review && typeof state.review === 'object') {
        this._reviewActive = !!state.review.active;
      } else {
        this._reviewActive = false;
      }
      // Doc Convert availability — true when markitdown is
      // importable on the server. Missing field (older
      // backend) keeps the tab hidden, which is the safe
      // degradation path.
      this._docConvertAvailable = !!state.doc_convert_available;
      // Fallback when the persisted active tab no longer
      // applies. Happens when the user's last session was
      // in a repo with doc-convert enabled and they've
      // reconnected to one without markitdown. Without
      // this, activeTab stays 'doc-convert' but the panel
      // is excluded from the DOM — producing a blank body.
      if (
        this.activeTab === 'doc-convert'
        && !this._docConvertAvailable
      ) {
        this._switchTab('files');
      }
      // If the backend reports init is already complete,
      // dismiss the startup overlay. Handles the common
      // race where Phase 2 finishes before the browser
      // registers AcApp — startupProgress events get
      // dropped, but get_current_state arrives afterward
      // with init_complete=true and we can dismiss based
      // on that.
      if (this._initComplete && this.overlayVisible) {
        this.startupPercent = 100;
        this.startupMessage = 'Ready';
        setTimeout(() => {
          this.overlayVisible = false;
          if (this._pendingReopen) {
            const path = this._loadLastOpenFile();
            if (path) this._doReopenLastFile(path);
          }
        }, 400);
      }
      // Dispatch state-loaded so child components restore.
      window.dispatchEvent(
        new CustomEvent('state-loaded', { detail: state }),
      );
      // After state is loaded, try to reopen the last file.
      this._tryReopenLastFile();
    } catch (err) {
      console.warn('[app-shell] get_current_state failed', err);
    }
  }

  // ---------------------------------------------------------------
  // Compaction capacity bar — history-status fetch and refresh
  // ---------------------------------------------------------------

  /**
   * Event handler bound to stream-complete, session-changed,
   * and compaction-event. Fire-and-forget refresh — we don't
   * need to await the fetch here, the reactive property update
   * in _fetchHistoryStatus re-renders when the result lands.
   */
  _onCompactionStatusRefresh() {
    this._fetchHistoryStatus();
  }

  /**
   * Fetch the current history status from the backend and
   * update the reactive property. Guarded against overlapping
   * fetches — if one is in flight, new triggers are coalesced
   * into the pending call rather than queueing a second one.
   *
   * Non-fatal on failure: missing backend, method not found
   * on an older server, or transient network error all leave
   * the prior snapshot in place. The bar keeps showing the
   * last-known state; next event triggers a retry.
   */
  async _fetchHistoryStatus() {
    if (!this.call) return;
    if (this._historyStatusFetchInFlight) return;
    this._historyStatusFetchInFlight = true;
    try {
      // Call in the same style as _fetchCurrentState — no
      // typeof check on the method reference. The jrpc-oo
      // call proxy exposes methods as Proxy-wrapped
      // callables whose typeof is not necessarily
      // 'function', so guarding on typeof was rejecting
      // valid calls and silently leaving the bar empty.
      const raw = await this.call['LLMService.get_history_status']();
      // Unwrap single-key envelope the same way
      // _fetchCurrentState does. jrpc-oo returns
      // { ClassName: { ... } } for method calls.
      let status = raw;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const keys = Object.keys(raw);
        if (keys.length === 1) {
          const inner = raw[keys[0]];
          if (
            inner && typeof inner === 'object'
            && !Array.isArray(inner)
          ) {
            status = inner;
          }
        }
      }
      if (status && typeof status === 'object') {
        this._historyStatus = status;
      }
    } catch (err) {
      // Surface failures with console.warn — debug-level
      // messages are hidden by default in most browsers
      // and we'd lose visibility on genuine RPC errors.
      // method-not-found is still the only expected
      // non-fatal case (older backend), so filter that
      // to debug to avoid nagging.
      const msg = err?.message || '';
      if (msg.includes('method not found')) {
        console.debug(
          '[app-shell] get_history_status not available', err,
        );
      } else {
        console.warn(
          '[app-shell] get_history_status failed', err,
        );
      }
    } finally {
      this._historyStatusFetchInFlight = false;
    }
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
   * specs4/5-webapp/shell.md#startup-overlay pins the stage names
   * and message conventions; the backend's startup sequence fires
   * these in order during deferred init.
   */
  startupProgress(stage, message, percent) {
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

  sessionChanged(data) {
    window.dispatchEvent(new CustomEvent('session-changed', { detail: data }));
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
  // Reconnection
  // ---------------------------------------------------------------

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    const attempt = this.reconnectAttempt;
    const delayIdx = Math.min(attempt, RECONNECT_DELAYS_MS.length - 1);
    const delay = RECONNECT_DELAYS_MS[delayIdx];
    this.reconnectAttempt = attempt + 1;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._attemptReconnect();
    }, delay);
  }

  _attemptReconnect() {
    // jrpc-oo's JRPCClient reconnects by re-assigning serverURI
    // to the same value — its internal setter tears down the
    // old socket and opens a new one. Force a re-set by
    // nulling and restoring.
    const uri = this.serverURI;
    try {
      this.serverURI = null;
      this.serverURI = uri;
    } catch (err) {
      // If the setter is unavailable, fall through to the next
      // scheduled retry.
      this._scheduleReconnect();
    }
  }

  // ---------------------------------------------------------------
  // Viewer routing
  // ---------------------------------------------------------------

  /**
   * Route a `navigate-file` event to the appropriate viewer
   * based on the file's extension. Dispatches `openFile` on
   * the target viewer. The viewer's `active-file-changed`
   * event then triggers visibility toggling.
   *
   * The `_remote` flag on broadcasts is consumed by the
   * chat panel / picker to suppress re-broadcasts — we
   * don't care about it here. Same routing applies
   * whether the event came from a local click or a
   * collaboration broadcast.
   */
  _onNavigateFile(event) {
    const detail = event.detail || {};
    const path = detail.path;
    if (typeof path !== 'string' || !path) return;
    const target = viewerForPath(path);
    if (!target) return;
    // Save viewport of the current file before navigating
    // away (so switching files preserves the prior file's
    // scroll state in localStorage).
    try {
      this._saveViewportState();
    } catch (_) {
      // Don't let a save failure block navigation.
    }
    // Persist the new path so page refresh reopens it.
    this._saveLastOpenFile(path);
    // Register with the file navigation grid unless the
    // event came from the grid itself or is a programmatic
    // refresh.
    if (!detail._fromNav && !detail._refresh) {
      const nav = this._getFileNav();
      if (nav) nav.openFile(path);
    }
    // Defer until the viewers exist in the DOM. Normally
    // they're rendered from the first template commit and
    // this is synchronous; the guard protects against
    // navigate-file firing before first render (rare,
    // but possible during startup).
    this.updateComplete.then(() => {
      const viewer =
        target === 'svg'
          ? this.shadowRoot?.querySelector('ac-svg-viewer')
          : this.shadowRoot?.querySelector('ac-diff-viewer');
      if (!viewer) return;
      viewer.openFile({
        path,
        line: detail.line,
        searchText: detail.searchText,
      });
    });
  }

  /**
   * Route a `load-diff-panel` event to the diff viewer's
   * loadPanel method. Dispatched by the history browser's
   * context menu for ad-hoc comparison. Shows the diff
   * viewer (switches active viewer if currently on SVG)
   * so the user sees the result immediately.
   */
  _onLoadDiffPanel(event) {
    const detail = event.detail || {};
    const { content, panel, label } = detail;
    if (typeof content !== 'string') return;
    if (panel !== 'left' && panel !== 'right') return;
    this._activeViewer = 'diff';
    this.updateComplete.then(() => {
      const viewer =
        this.shadowRoot?.querySelector('ac-diff-viewer');
      if (!viewer || typeof viewer.loadPanel !== 'function') {
        return;
      }
      viewer.loadPanel(content, panel, label);
    });
  }

  /**
   * Handle `toggle-svg-mode` from either viewer. Switches
   * between the visual SVG viewer and the Monaco text diff
   * editor for the same file, carrying content and dirty
   * state across.
   */
  _onToggleSvgMode(event) {
    const detail = event.detail || {};
    const { path, target, modified, savedContent } = detail;
    if (!path || !target) return;
    this.updateComplete.then(() => {
      const diffViewer =
        this.shadowRoot?.querySelector('ac-diff-viewer');
      const svgViewer =
        this.shadowRoot?.querySelector('ac-svg-viewer');
      if (target === 'diff') {
        // Visual → text diff.
        this._activeViewer = 'diff';
        if (diffViewer) {
          diffViewer.closeFile(path);
          diffViewer.openFile({
            path,
            virtualContent: undefined,
          }).then(() => {
            // If we have modified content from the SVG
            // editor, update the diff viewer's file so
            // visual edits appear as dirty in text mode.
            if (typeof modified === 'string') {
              const file = diffViewer._files?.find(
                (f) => f.path === path,
              );
              if (file) {
                file.modified = modified;
                if (typeof savedContent === 'string') {
                  file.savedContent = savedContent;
                }
                diffViewer._recomputeDirtyCount();
                diffViewer._showEditor?.();
              }
            }
          });
        }
      } else if (target === 'visual') {
        // Text diff → visual.
        this._activeViewer = 'svg';
        if (svgViewer && diffViewer) {
          // Read latest content from the diff viewer.
          const diffFile = diffViewer._files?.find(
            (f) => f.path === path,
          );
          const latestModified = diffFile?.modified;
          const latestSaved = diffFile?.savedContent;
          diffViewer.closeFile(path);
          svgViewer.closeFile(path);
          svgViewer.openFile({
            path,
            ...(typeof latestModified === 'string'
              ? { modified: latestModified }
              : {}),
          }).then(() => {
            if (typeof latestSaved === 'string') {
              const svgFile = svgViewer._files?.find(
                (f) => f.path === path,
              );
              if (svgFile) {
                svgFile.savedContent = latestSaved;
                svgViewer._recomputeDirtyCount();
              }
            }
          });
        }
      }
    });
  }

  // ---------------------------------------------------------------
  // File and viewport persistence
  // ---------------------------------------------------------------

  /**
   * Save the current viewport state on page unload. This
   * captures the scroll position and cursor so the next
   * page load can restore the exact view.
   */
  _onBeforeUnload() {
    this._saveViewportState();
  }

  /**
   * Save the last-opened file path to localStorage.
   * Called on every navigate-file event.
   */
  _saveLastOpenFile(path) {
    if (typeof path !== 'string' || !path) return;
    try {
      const key = _repoKey(_LAST_OPEN_FILE_KEY, this._repoName);
      localStorage.setItem(key, path);
    } catch (_) {}
  }

  /**
   * Read the last-opened file path from localStorage.
   */
  _loadLastOpenFile() {
    try {
      const key = _repoKey(_LAST_OPEN_FILE_KEY, this._repoName);
      return localStorage.getItem(key) || null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Save the current diff viewer's viewport state to
   * localStorage. SVG files are excluded (SVG zoom
   * restore is not yet supported).
   */
  _saveViewportState() {
    const viewer = this.shadowRoot?.querySelector('ac-diff-viewer');
    if (!viewer) return;
    if (viewer._activeIndex < 0) return;
    const file = viewer._files?.[viewer._activeIndex];
    if (!file || !file.path) return;
    // Skip SVG files — SVG zoom restore not yet supported.
    if (file.path.toLowerCase().endsWith('.svg')) return;
    try {
      const modifiedEditor = viewer._getModifiedEditor?.();
      if (!modifiedEditor) return;
      const pos = modifiedEditor.getPosition?.();
      const state = {
        path: file.path,
        type: 'diff',
        diff: {
          scrollTop: modifiedEditor.getScrollTop?.() || 0,
          scrollLeft: modifiedEditor.getScrollLeft?.() || 0,
          lineNumber: pos?.lineNumber || 1,
          column: pos?.column || 1,
        },
      };
      const key = _repoKey(_LAST_VIEWPORT_KEY, this._repoName);
      localStorage.setItem(key, JSON.stringify(state));
    } catch (_) {
      // Monaco mock or broken editor — skip silently.
    }
  }

  /**
   * Load the saved viewport state from localStorage.
   * Returns null when nothing is saved or the data is
   * malformed.
   */
  _loadViewportState() {
    try {
      const key = _repoKey(_LAST_VIEWPORT_KEY, this._repoName);
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.path) {
        return parsed;
      }
    } catch (_) {}
    return null;
  }

  /**
   * Try to reopen the last-viewed file. Deferred until
   * the startup overlay dismisses on first connect (to
   * avoid file-fetch RPCs blocking the server during
   * heavy init). On reconnect (init already complete),
   * reopens immediately.
   */
  _tryReopenLastFile() {
    const path = this._loadLastOpenFile();
    if (!path) return;
    if (this._initComplete || !this.overlayVisible) {
      // Init already complete (reconnect) or overlay
      // already dismissed — reopen now.
      this._doReopenLastFile(path);
    } else {
      // First connect, overlay still showing — defer.
      this._pendingReopen = true;
    }
  }

  /**
   * Actually reopen the file and restore viewport state.
   */
  _doReopenLastFile(path) {
    this._pendingReopen = false;
    if (!path) return;
    // Dispatch navigate-file to open the file.
    window.dispatchEvent(
      new CustomEvent('navigate-file', {
        detail: { path, _refresh: true },
      }),
    );
    // Restore viewport state if it matches the file.
    const viewport = this._loadViewportState();
    if (!viewport || viewport.path !== path) return;
    if (!viewport.diff) return;
    // Wait for the file to open, then restore. Use a
    // one-shot active-file-changed listener filtered
    // to the target path. Timeout after 10 seconds.
    const viewer = this.shadowRoot?.querySelector('ac-diff-viewer');
    if (!viewer) return;
    let settled = false;
    const timeoutId = setTimeout(() => {
      settled = true;
    }, 10000);
    const handler = (event) => {
      if (settled) return;
      if (event.detail?.path !== path) return;
      settled = true;
      clearTimeout(timeoutId);
      viewer.removeEventListener('active-file-changed', handler);
      // Wait for diff computation to settle before
      // restoring scroll + cursor.
      this._restoreViewport(viewer, viewport.diff);
    };
    viewer.addEventListener('active-file-changed', handler);
  }

  /**
   * Restore scroll position and cursor on the diff
   * viewer's modified editor. Polls up to 20 animation
   * frames for the editor to be ready (it's created
   * asynchronously after the file content fetch
   * completes).
   */
  _restoreViewport(viewer, state) {
    let attempts = 0;
    const maxAttempts = 20;
    const tryRestore = () => {
      attempts += 1;
      const modifiedEditor = viewer._getModifiedEditor?.();
      if (!modifiedEditor) {
        if (attempts < maxAttempts) {
          requestAnimationFrame(tryRestore);
        }
        return;
      }
      // Wait for diff ready, then set position + scroll.
      if (typeof viewer._waitForDiffReady === 'function') {
        viewer._waitForDiffReady().then(() => {
          try {
            modifiedEditor.setPosition?.({
              lineNumber: state.lineNumber || 1,
              column: state.column || 1,
            });
            modifiedEditor.setScrollTop?.(state.scrollTop || 0);
            modifiedEditor.setScrollLeft?.(state.scrollLeft || 0);
          } catch (_) {}
        });
      } else {
        try {
          modifiedEditor.setPosition?.({
            lineNumber: state.lineNumber || 1,
            column: state.column || 1,
          });
          modifiedEditor.setScrollTop?.(state.scrollTop || 0);
          modifiedEditor.setScrollLeft?.(state.scrollLeft || 0);
        } catch (_) {}
      }
    };
    requestAnimationFrame(tryRestore);
  }

  // ---------------------------------------------------------------
  // File navigation grid (Alt+Arrow)
  // ---------------------------------------------------------------

  _getFileNav() {
    return this.shadowRoot?.querySelector('ac-file-nav') || null;
  }

  /**
   * Alt+Arrow keydown — navigate the file grid. When the
   * grid has nodes, all Alt+Arrow events are consumed
   * (preventDefault + stopPropagation) to prevent Monaco's
   * word-navigation and line-move bindings from firing.
   *
   * Escape while the HUD is visible hides it immediately.
   *
   * Capture phase (`true` in addEventListener) ensures we
   * intercept before Monaco sees the event.
   */
  _onGridKeyDown(event) {
    const nav = this._getFileNav();
    if (!nav) return;

    // Escape hides the HUD if visible.
    if (event.key === 'Escape' && nav.visible) {
      event.preventDefault();
      event.stopPropagation();
      nav.visible = false;
      nav.classList.remove('fading');
      return;
    }

    // Only process Alt+Arrow.
    if (!event.altKey) return;
    const dirMap = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
    };
    const dir = dirMap[event.key];
    if (!dir) return;

    // When the grid has nodes, consume the event regardless
    // of whether a neighbor exists — prevents Monaco's
    // Alt+Arrow bindings from firing while the HUD is
    // potentially visible.
    if (!nav.hasNodes) return;
    event.preventDefault();
    event.stopPropagation();

    const targetPath = nav.navigateDirection(dir);
    nav.show();
    nav.requestUpdate();

    if (targetPath) {
      // Route to the appropriate viewer.
      const target = viewerForPath(targetPath);
      if (target) {
        this.updateComplete.then(() => {
          const viewer =
            target === 'svg'
              ? this.shadowRoot?.querySelector('ac-svg-viewer')
              : this.shadowRoot?.querySelector('ac-diff-viewer');
          if (viewer) {
            viewer.openFile({ path: targetPath });
          }
        });
      }
    }
  }

  /**
   * Alt keyup — hide the HUD when Alt is released.
   */
  _onGridKeyUp(event) {
    if (event.key !== 'Alt') return;
    const nav = this._getFileNav();
    if (nav && nav.visible) {
      nav.hide();
    }
  }

  /**
   * Handle `active-file-changed` bubbling up from either
   * viewer. When a viewer reports it has an active file,
   * that viewer becomes visible. When it reports null
   * (no files open), we keep the currently-visible viewer
   * as-is — flipping to the other one would just show
   * its empty state, which isn't what the user wants.
   *
   * Uses `event.composedPath()` to identify which viewer
   * emitted the event, so the handler is robust even if
   * additional viewers are added later.
   */
  _onActiveFileChanged(event) {
    const detail = event.detail || {};
    if (!detail.path) return;
    // Identify the source viewer by walking the composed
    // path — the event originates inside the viewer's
    // shadow root and bubbles up through the host element.
    const path = event.composedPath ? event.composedPath() : [];
    for (const el of path) {
      if (el && el.tagName === 'AC-SVG-VIEWER') {
        this._activeViewer = 'svg';
        return;
      }
      if (el && el.tagName === 'AC-DIFF-VIEWER') {
        this._activeViewer = 'diff';
        return;
      }
    }
  }

  // ---------------------------------------------------------------
  // Toast system
  // ---------------------------------------------------------------

  _onToastEvent(event) {
    const { message, type } = event.detail || {};
    if (!message) return;
    this._showToast(message, type || 'info');
  }

  _showToast(message, type = 'info') {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const toast = { id, message, type };
    this.toasts = [...this.toasts, toast];
    // Auto-dismiss after 3s, with a 300ms fade handled by CSS.
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    }, 3000);
  }

  // ---------------------------------------------------------------
  // Dialog persistence
  // ---------------------------------------------------------------

  /**
   * Load the last active tab from localStorage. Returns 'files'
   * when no preference is stored or the stored value is an
   * unrecognised string — defending against a stale key written
   * by an older build that had additional tabs.
   *
   * A stale 'search' preference (from before file search was
   * integrated into the Files tab) migrates to 'files'. Matches
   * the spec's migration clause.
   */
  _loadActiveTab() {
    try {
      const stored = localStorage.getItem(_ACTIVE_TAB_KEY);
      if (stored === 'search') return 'files';
      if (stored === 'files' || stored === 'context'
          || stored === 'settings'
          || stored === 'doc-convert') {
        return stored;
      }
    } catch (_) {}
    return 'files';
  }

  _loadMinimized() {
    try {
      return localStorage.getItem(_DIALOG_MIN_KEY) === 'true';
    } catch (_) {
      return false;
    }
  }

  _loadDockedWidth() {
    try {
      const raw = localStorage.getItem(_DIALOG_WIDTH_KEY);
      if (!raw) return null;
      const n = parseInt(raw, 10);
      if (Number.isNaN(n) || n < _DIALOG_MIN_WIDTH) return null;
      return n;
    } catch (_) {
      return null;
    }
  }

  /**
   * Load the undocked position and bounds-check it against the
   * current viewport. Returns null when:
   *   - no data stored
   *   - JSON parse fails
   *   - the rect would leave fewer than _DIALOG_VISIBLE_MARGIN
   *     pixels of the dialog inside the viewport (monitor
   *     disconnect / resolution change stranded it off-screen)
   *
   * Clamps valid-but-too-big rects to viewport size.
   */
  _loadUndockedPos() {
    try {
      const raw = localStorage.getItem(_DIALOG_POS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const { left, top, width, height } = parsed;
      if (![left, top, width, height].every(
        (n) => typeof n === 'number' && Number.isFinite(n),
      )) {
        return null;
      }
      if (width < _DIALOG_MIN_WIDTH) return null;
      if (height < _DIALOG_MIN_HEIGHT) return null;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Must leave a visible handle on both axes for
      // recovery when the viewport shrinks below the stored
      // position.
      if (left > vw - _DIALOG_VISIBLE_MARGIN) return null;
      if (top > vh - _DIALOG_VISIBLE_MARGIN) return null;
      if (left + width < _DIALOG_VISIBLE_MARGIN) return null;
      if (top + height < _DIALOG_VISIBLE_MARGIN) return null;
      return {
        left: Math.max(0, left),
        top: Math.max(0, top),
        width: Math.min(width, vw),
        height: Math.min(height, vh),
      };
    } catch (_) {
      return null;
    }
  }

  _saveMinimized() {
    try {
      localStorage.setItem(_DIALOG_MIN_KEY, String(this._minimized));
    } catch (_) {}
  }

  _saveDockedWidth() {
    try {
      if (this._dockedWidth == null) {
        localStorage.removeItem(_DIALOG_WIDTH_KEY);
      } else {
        localStorage.setItem(
          _DIALOG_WIDTH_KEY, String(this._dockedWidth),
        );
      }
    } catch (_) {}
  }

  _saveUndockedPos() {
    try {
      if (this._undockedPos == null) {
        localStorage.removeItem(_DIALOG_POS_KEY);
      } else {
        localStorage.setItem(
          _DIALOG_POS_KEY, JSON.stringify(this._undockedPos),
        );
      }
    } catch (_) {}
  }

  // ---------------------------------------------------------------
  // Dialog drag, resize, minimize
  // ---------------------------------------------------------------

  /**
   * Query the dialog element's current rect. Used at drag
   * start to snapshot the starting geometry — from there
   * we apply pointer deltas. Returns null when the shadow
   * root hasn't rendered yet (shouldn't happen in
   * practice since the pointer can't target it, but
   * defensive).
   */
  _getDialogRect() {
    const dialog = this.shadowRoot?.querySelector('.dialog');
    if (!dialog) return null;
    return dialog.getBoundingClientRect();
  }

  /**
   * Begin dragging from a header pointerdown. Skips when the
   * pointer is on a button inside the header — tab buttons
   * and the minimize button handle their own clicks.
   */
  _onHeaderPointerDown(event) {
    if (event.button !== 0) return;
    // closest('button') lets a click anywhere on a button
    // (including nested icons if we add them later) skip drag.
    if (
      event.target
      && typeof event.target.closest === 'function'
      && event.target.closest('button')
    ) {
      return;
    }
    const rect = this._getDialogRect();
    if (!rect) return;
    this._drag = {
      mode: 'drag',
      startX: event.clientX,
      startY: event.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      originWidth: rect.width,
      originHeight: rect.height,
      committed: false,
    };
    document.addEventListener('pointermove', this._onPointerMove);
    document.addEventListener('pointerup', this._onPointerUp);
  }

  /**
   * Begin resizing from a handle pointerdown. The handle's
   * dataset carries which edge/corner it represents.
   */
  _onHandlePointerDown(event, which) {
    if (event.button !== 0) return;
    // Don't let the pointerdown bubble to the header (which
    // would also try to start a drag).
    event.stopPropagation();
    const rect = this._getDialogRect();
    if (!rect) return;
    this._drag = {
      mode: 'resize',
      which,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      originWidth: rect.width,
      originHeight: rect.height,
    };
    document.addEventListener('pointermove', this._onPointerMove);
    document.addEventListener('pointerup', this._onPointerUp);
  }

  /**
   * Pointer move during drag or resize. Mutates inline styles
   * directly (not reactive state) so tracking is smooth. The
   * committed values are written back to reactive state on
   * pointerup.
   *
   * For drag: cross the threshold before committing to an
   * undock. Below the threshold, treat the gesture as a click
   * that'll fall through to pointerup with no change — this
   * is how the minimize-via-header-click behavior would work
   * if we ever bind that gesture. Currently minimize has a
   * dedicated button, so below-threshold drags are just no-ops.
   */
  _onPointerMove(event) {
    if (!this._drag) return;
    const dx = event.clientX - this._drag.startX;
    const dy = event.clientY - this._drag.startY;
    const dialog = this.shadowRoot?.querySelector('.dialog');
    if (!dialog) return;

    if (this._drag.mode === 'drag') {
      if (!this._drag.committed) {
        if (
          Math.abs(dx) < _DIALOG_DRAG_THRESHOLD
          && Math.abs(dy) < _DIALOG_DRAG_THRESHOLD
        ) {
          return;
        }
        this._drag.committed = true;
        dialog.classList.add('dragging');
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Clamp so the dialog never fully leaves the viewport.
      // Using _DIALOG_VISIBLE_MARGIN here gives the user the
      // same recovery guarantee as the bounds check at
      // restore time.
      const newLeft = Math.max(
        _DIALOG_VISIBLE_MARGIN - this._drag.originWidth,
        Math.min(
          vw - _DIALOG_VISIBLE_MARGIN,
          this._drag.originLeft + dx,
        ),
      );
      const newTop = Math.max(
        0,
        Math.min(
          vh - _DIALOG_VISIBLE_MARGIN,
          this._drag.originTop + dy,
        ),
      );
      dialog.style.left = `${newLeft}px`;
      dialog.style.top = `${newTop}px`;
      dialog.style.right = 'auto';
      dialog.style.bottom = 'auto';
      dialog.style.width = `${this._drag.originWidth}px`;
      dialog.style.height = `${this._drag.originHeight}px`;
      dialog.classList.add('floating');
      return;
    }

    // mode === 'resize'
    dialog.classList.add('resizing');
    let newWidth = this._drag.originWidth;
    let newHeight = this._drag.originHeight;
    if (
      this._drag.which === _RESIZE_RIGHT
      || this._drag.which === _RESIZE_CORNER
    ) {
      newWidth = Math.max(
        _DIALOG_MIN_WIDTH,
        this._drag.originWidth + dx,
      );
    }
    if (
      this._drag.which === _RESIZE_BOTTOM
      || this._drag.which === _RESIZE_CORNER
    ) {
      newHeight = Math.max(
        _DIALOG_MIN_HEIGHT,
        this._drag.originHeight + dy,
      );
    }
    dialog.style.width = `${newWidth}px`;
    // Bottom / corner resize forces undock — the docked
    // height is 100% of the viewport, so there's no way to
    // express a smaller height while still docked. Match
    // the spec: "Auto-undocks if still docked" for bottom /
    // corner handles.
    if (
      this._drag.which === _RESIZE_BOTTOM
      || this._drag.which === _RESIZE_CORNER
    ) {
      if (!this._undockedPos) {
        dialog.style.left = `${this._drag.originLeft}px`;
        dialog.style.top = `${this._drag.originTop}px`;
        dialog.style.right = 'auto';
        dialog.style.bottom = 'auto';
        dialog.classList.add('floating');
      }
      dialog.style.height = `${newHeight}px`;
    }
  }

  /**
   * Release drag / resize. Commits the final geometry to
   * reactive state and persists it. Below-threshold drags
   * that never crossed _DIALOG_DRAG_THRESHOLD leave state
   * unchanged — the class toggles revert on the next render.
   */
  _onPointerUp() {
    document.removeEventListener('pointermove', this._onPointerMove);
    document.removeEventListener('pointerup', this._onPointerUp);
    const drag = this._drag;
    this._drag = null;
    if (!drag) return;
    const dialog = this.shadowRoot?.querySelector('.dialog');
    if (dialog) {
      dialog.classList.remove('dragging');
      dialog.classList.remove('resizing');
    }
    if (drag.mode === 'drag') {
      if (!drag.committed) return;
      const rect = this._getDialogRect();
      if (!rect) return;
      this._undockedPos = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
      this._saveUndockedPos();
      return;
    }
    // resize
    const rect = this._getDialogRect();
    if (!rect) return;
    if (drag.which === _RESIZE_RIGHT && !this._undockedPos) {
      // Docked width change only.
      this._dockedWidth = rect.width;
      this._saveDockedWidth();
      return;
    }
    // Bottom / corner always, or right when already undocked.
    this._undockedPos = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    this._saveUndockedPos();
  }

  /**
   * Toggle minimize state. Dedicated button in the header.
   * Minimized dialogs persist their undocked position — on
   * restore they reopen at the same spot.
   */
  _toggleMinimize() {
    this._minimized = !this._minimized;
    this._saveMinimized();
  }

  // ---------------------------------------------------------------
  // Window resize
  // ---------------------------------------------------------------

  /**
   * RAF-throttled resize handler. Rapid resize events (drag
   * the window corner, laptop lid reopen) can fire dozens of
   * times per animation frame; without throttling the
   * proportional-rescale logic forces reflow faster than the
   * browser can display and produces visible jank.
   */
  _onWindowResize() {
    if (this._resizeRAF) return;
    this._resizeRAF = requestAnimationFrame(() => {
      this._resizeRAF = null;
      this._handleWindowResize();
    });
  }

  /**
   * Proportionally rescale undocked dialog dimensions so the
   * dialog keeps the same approximate fraction of the viewport
   * across resolution changes. Only applies when undocked —
   * docked dialogs already track viewport size via the CSS
   * `width: %` + `bottom: 0` rules.
   *
   * Also re-clamps position so the dialog never strands
   * off-screen (same bounds check as at restore time).
   */
  _handleWindowResize() {
    if (!this._undockedPos) {
      // Docked. Nothing to rescale — CSS handles it.
      // But still re-clamp if the docked width exceeds the
      // new viewport, otherwise the user has to resize
      // manually after a shrink.
      if (
        this._dockedWidth != null
        && this._dockedWidth > window.innerWidth - _DIALOG_VISIBLE_MARGIN
      ) {
        this._dockedWidth = Math.max(
          _DIALOG_MIN_WIDTH,
          window.innerWidth - _DIALOG_VISIBLE_MARGIN,
        );
        this._saveDockedWidth();
      }
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // If position is still valid, leave it alone. We only
    // act when the current rect has stranded off-screen.
    const p = this._undockedPos;
    const outOfBounds =
      p.left > vw - _DIALOG_VISIBLE_MARGIN
      || p.top > vh - _DIALOG_VISIBLE_MARGIN
      || p.left + p.width < _DIALOG_VISIBLE_MARGIN
      || p.top + p.height < _DIALOG_VISIBLE_MARGIN;
    if (!outOfBounds) return;
    this._undockedPos = {
      left: Math.max(
        0, Math.min(p.left, vw - _DIALOG_VISIBLE_MARGIN),
      ),
      top: Math.max(
        0, Math.min(p.top, vh - _DIALOG_VISIBLE_MARGIN),
      ),
      width: Math.min(p.width, vw),
      height: Math.min(p.height, vh),
    };
    this._saveUndockedPos();
  }

  // ---------------------------------------------------------------
  // Mode toggle
  // ---------------------------------------------------------------

  /**
   * Handle mode-changed broadcasts. Fires for our own
   * switches and for any other admitted client's switches
   * — collaborators follow the server's authoritative
   * mode.
   *
   * Payload shape (per specs4/4-features/collaboration.md):
   *   { mode: 'code' | 'doc', cross_ref_enabled?: bool }
   * Cross-ref flag is only present on cross-ref toggle
   * events; mode-only switches omit it and we leave the
   * UI state alone (backend resets it to false on mode
   * switch, but the follow-up broadcast carries the new
   * mode value — the reset is implicit).
   */
  _onModeChanged(event) {
    const detail = event.detail || {};
    if (typeof detail.mode === 'string') {
      if (detail.mode !== this._mode) {
        // Mode actually changed — cross-ref resets per
        // spec. Backend does the reset; we mirror it so
        // the UI stays in sync without an extra RPC.
        this._mode = detail.mode;
        this._crossRefEnabled = false;
      }
    }
    if (typeof detail.cross_ref_enabled === 'boolean') {
      this._crossRefEnabled = detail.cross_ref_enabled;
    }
  }

  /**
   * Switch to the given primary mode. No-op if already
   * in that mode (backend would also no-op, but saves an
   * RPC). Disabled for non-localhost callers — the button
   * is visually disabled, but we guard here too.
   */
  async _switchMode(mode) {
    if (mode !== 'code' && mode !== 'doc') return;
    if (mode === this._mode) return;
    if (!this.call) return;
    if (!this._isLocalhost) return;
    const fn = this.call['LLMService.switch_mode'];
    if (typeof fn !== 'function') return;
    try {
      const result = await fn(mode);
      // Unwrap single-key envelope.
      let payload = result;
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        const keys = Object.keys(result);
        if (keys.length === 1) {
          const inner = result[keys[0]];
          if (inner && typeof inner === 'object') payload = inner;
        }
      }
      if (payload && payload.error) {
        const reason = payload.reason || payload.error;
        this._showToast(`Mode switch failed: ${reason}`, 'warning');
        return;
      }
      // mode-changed broadcast will update _mode; don't
      // set it optimistically or we'll race the broadcast.
      this._showToast(
        mode === 'doc' ? 'Switched to document mode'
                       : 'Switched to code mode',
        'info',
      );
    } catch (err) {
      this._showToast(
        `Mode switch failed: ${err?.message || 'RPC error'}`,
        'error',
      );
    }
  }

  /**
   * Toggle cross-reference mode. The backend holds
   * authoritative state; we fire the RPC and let the
   * mode-changed broadcast flip _crossRefEnabled.
   */
  async _toggleCrossRef() {
    if (!this.call) return;
    if (!this._isLocalhost) return;
    const fn = this.call['LLMService.set_cross_reference'];
    if (typeof fn !== 'function') return;
    const next = !this._crossRefEnabled;
    try {
      const result = await fn(next);
      let payload = result;
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        const keys = Object.keys(result);
        if (keys.length === 1) {
          const inner = result[keys[0]];
          if (inner && typeof inner === 'object') payload = inner;
        }
      }
      if (payload && payload.error) {
        const reason = payload.reason || payload.error;
        this._showToast(
          `Cross-reference toggle failed: ${reason}`,
          'warning',
        );
        return;
      }
      if (next) {
        this._showToast(
          'Cross-reference enabled — both indexes active',
          'info',
        );
      } else {
        this._showToast('Cross-reference disabled', 'info');
      }
    } catch (err) {
      this._showToast(
        `Cross-reference toggle failed: ${err?.message || 'RPC error'}`,
        'error',
      );
    }
  }

  // ---------------------------------------------------------------
  // Git actions (header)
  // ---------------------------------------------------------------

  /**
   * Clear the _committing flag when commit_all finishes.
   * ChatPanel has its own _onCommitResult for its own
   * state; this is the header's copy. Both listen to
   * the same window event independently.
   */
  _onCommitResultHeader() {
    this._committing = false;
  }

  /**
   * Follow review-started / review-ended window events to
   * drive the commit button's disabled state. The detail
   * shape isn't inspected — the event type alone tells us
   * the direction.
   */
  _onReviewStateChanged(event) {
    this._reviewActive = event.type === 'review-started';
  }

  /**
   * First chunk of a stream flips the gate. Subsequent
   * chunks are idempotent no-ops. We don't care which
   * request is streaming — the single-stream invariant
   * means "any chunk in flight" is equivalent to
   * "streaming active" for button-gating purposes.
   */
  _onStreamChunkHeader() {
    if (!this._streaming) this._streaming = true;
  }

  /**
   * Stream completion — whether natural, cancelled, or
   * errored — clears the gate. The backend fires
   * streamComplete on all three paths, so this is the
   * single reliable release point.
   */
  _onStreamCompleteHeader() {
    this._streaming = false;
  }

  /**
   * Copy the current working-tree diff (staged + unstaged)
   * to the clipboard. Uses Repo.get_staged_diff and
   * Repo.get_unstaged_diff, concatenates with a section
   * header for each. If both are empty, toasts "Nothing
   * to copy" rather than silently copying an empty string.
   */
  async _onCopyDiff() {
    if (!this.call) return;
    const getStaged = this.call['Repo.get_staged_diff'];
    const getUnstaged = this.call['Repo.get_unstaged_diff'];
    if (
      typeof getStaged !== 'function'
      || typeof getUnstaged !== 'function'
    ) {
      this._showToast('Diff not available', 'warning');
      return;
    }
    try {
      const [stagedRaw, unstagedRaw] = await Promise.all([
        getStaged(), getUnstaged(),
      ]);
      const unwrap = (raw) => {
        if (typeof raw === 'string') return raw;
        if (raw && typeof raw === 'object') {
          const keys = Object.keys(raw);
          if (keys.length === 1) {
            const v = raw[keys[0]];
            return typeof v === 'string' ? v : '';
          }
        }
        return '';
      };
      const staged = unwrap(stagedRaw);
      const unstaged = unwrap(unstagedRaw);
      const parts = [];
      if (staged.trim()) {
        parts.push('# === STAGED ===\n' + staged);
      }
      if (unstaged.trim()) {
        parts.push('# === UNSTAGED ===\n' + unstaged);
      }
      if (parts.length === 0) {
        this._showToast('No changes to copy', 'info');
        return;
      }
      const text = parts.join('\n\n');
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        this._showToast('Diff copied to clipboard', 'success');
      } else {
        this._showToast('Clipboard not available', 'warning');
      }
    } catch (err) {
      this._showToast(
        `Copy diff failed: ${err?.message || 'RPC error'}`,
        'error',
      );
    }
  }

  /**
   * Start a commit via LLMService.commit_all. The server
   * does staging → diff → LLM-generated message → commit
   * as a background task and broadcasts commit-result
   * when done. We just set _committing=true to disable
   * the button, and let commit-result flip it back.
   *
   * Disabled during review (read-only), during an
   * existing commit (reentrancy guard), and for
   * non-localhost callers.
   */
  async _onCommit() {
    if (!this.call) return;
    if (this._committing || this._reviewActive) return;
    if (this._streaming) return;
    if (!this._isLocalhost) return;
    const fn = this.call['LLMService.commit_all'];
    if (typeof fn !== 'function') {
      this._showToast('Commit not available', 'warning');
      return;
    }
    this._committing = true;
    try {
      const raw = await fn();
      let payload = raw;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const keys = Object.keys(raw);
        if (keys.length === 1) {
          const inner = raw[keys[0]];
          if (inner && typeof inner === 'object') payload = inner;
        }
      }
      if (payload && payload.error) {
        this._committing = false;
        const reason = payload.reason || payload.error;
        this._showToast(`Commit failed: ${reason}`, 'warning');
        return;
      }
      // Server returns {status: "started"} — the actual
      // result arrives via the commit-result broadcast,
      // which is where _committing gets cleared.
      this._showToast('Generating commit message…', 'info');
    } catch (err) {
      this._committing = false;
      this._showToast(
        `Commit failed: ${err?.message || 'RPC error'}`,
        'error',
      );
    }
  }

  /**
   * Reset working tree + index to HEAD. Destructive —
   * requires confirmation. Disabled during an in-flight
   * commit and for non-localhost callers. Per
   * specs4/5-webapp/chat.md, review mode does NOT
   * disable reset — a user may legitimately want to
   * discard review-mode modifications.
   */
  async _onResetToHead() {
    if (!this.call) return;
    if (this._committing) return;
    if (this._streaming) return;
    if (!this._isLocalhost) return;
    const confirmed = window.confirm(
      'Reset working tree to HEAD?\n\nAll uncommitted changes (staged and unstaged) will be discarded. This cannot be undone.',
    );
    if (!confirmed) return;
    const fn = this.call['LLMService.reset_to_head'];
    if (typeof fn !== 'function') {
      this._showToast('Reset not available', 'warning');
      return;
    }
    try {
      const raw = await fn();
      let payload = raw;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const keys = Object.keys(raw);
        if (keys.length === 1) {
          const inner = raw[keys[0]];
          if (inner && typeof inner === 'object') payload = inner;
        }
      }
      if (payload && payload.error) {
        const reason = payload.reason || payload.error;
        this._showToast(`Reset failed: ${reason}`, 'warning');
        return;
      }
      this._showToast('Reset to HEAD', 'success');
      // Refresh open viewers so the stale post-edit
      // content is replaced with the HEAD state.
      const diffViewer =
        this.shadowRoot?.querySelector('ac-diff-viewer');
      const svgViewer =
        this.shadowRoot?.querySelector('ac-svg-viewer');
      if (diffViewer?.refreshOpenFiles) {
        diffViewer.refreshOpenFiles().catch(() => {});
      }
      if (svgViewer?.refreshOpenFiles) {
        svgViewer.refreshOpenFiles().catch(() => {});
      }
    } catch (err) {
      this._showToast(
        `Reset failed: ${err?.message || 'RPC error'}`,
        'error',
      );
    }
  }

  // ---------------------------------------------------------------
  // Button title helpers
  // ---------------------------------------------------------------

  _commitButtonTitle() {
    if (this._reviewActive) return 'Commit disabled during review';
    if (this._streaming) return 'Commit disabled while AI is responding';
    if (this._committing) return 'Committing…';
    return 'Stage all changes and commit with an auto-generated message';
  }

  _resetButtonTitle() {
    if (this._streaming) return 'Reset disabled while AI is responding';
    return 'Reset to HEAD (discard all uncommitted changes)';
  }

  // ---------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------

  _switchTab(tab) {
    this.activeTab = tab;
    try {
      localStorage.setItem(_ACTIVE_TAB_KEY, tab);
    } catch (_) {
      // localStorage can throw in private-browsing modes or
      // when quota is exhausted. Persistence is best-effort.
    }
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  /**
   * Build the inline style string for .dialog. When undocked,
   * the entire rect comes from _undockedPos. When docked but
   * with a persisted custom width, only the width is overridden.
   * The default (fresh install) returns empty, letting the CSS
   * defaults take over.
   */
  _dialogInlineStyle() {
    if (this._undockedPos) {
      const { left, top, width, height } = this._undockedPos;
      return `left: ${left}px; top: ${top}px; `
        + `width: ${width}px; height: ${height}px; `
        + 'right: auto; bottom: auto;';
    }
    if (this._dockedWidth != null) {
      return `width: ${this._dockedWidth}px;`;
    }
    return '';
  }

  /**
   * Compaction-capacity bar — renders a thin strip at the
   * dialog bottom showing how close current history tokens
   * are to the compaction trigger threshold.
   *
   * Visibility rules:
   *
   *   - Returns empty when the backend status hasn't been
   *     fetched yet (initial paint before the first
   *     get_history_status response).
   *   - Returns empty when the backend reports compaction
   *     disabled — the ratio is meaningless if there's no
   *     threshold to approach.
   *   - Otherwise always rendered, including at 0% — the
   *     constant placeholder makes the bar's reappearance
   *     after a successful compaction (tokens drop to
   *     near-zero) less surprising.
   *
   * Colour follows the same tri-state rule used by the
   * Context tab and Token HUD: green ≤75%, amber 75-90%,
   * red >90%. The red band is the "imminent compaction"
   * warning — users can anticipate the pause.
   */
  _renderCompactionBar() {
    const status = this._historyStatus;
    if (!status) return null;
    // Backend keys come from LLMService.get_history_status,
    // which merges get_token_budget + get_compaction_status
    // and re-prefixes the compaction fields to avoid name
    // collisions. Field shape confirmed in the browser console:
    //   history_tokens, compaction_enabled, compaction_trigger,
    //   compaction_percent, max_history_tokens, remaining,
    //   needs_compaction, session_id.
    // An earlier draft of this component assumed the un-prefixed
    // names (enabled, trigger_tokens, percent) — the gate rejected
    // every snapshot and the bar never rendered.
    if (!status.compaction_enabled) return null;
    const trigger = Number(status.compaction_trigger) || 0;
    if (trigger <= 0) return null;
    const tokens = Number(status.history_tokens) || 0;
    // Backend-computed percent is preferred when present;
    // fall back to a local ratio if the snapshot is a
    // subset shape. Capped at 100 for display — over-100
    // is possible briefly before compaction kicks in, and
    // rendering widths beyond 100% would trigger horizontal
    // overflow on the bar container.
    const rawPct = status.compaction_percent != null
      ? Number(status.compaction_percent)
      : (tokens / trigger) * 100;
    const pct = Math.max(0, Math.min(100, rawPct || 0));
    // Colour picker — same thresholds as _budgetColor
    // in context-tab.js / token-hud.js. Keeping the logic
    // inline here avoids an import just for three values.
    let color;
    if (pct > 90) {
      color = '#f85149';
    } else if (pct > 75) {
      color = '#d29922';
    } else {
      color = '#7ee787';
    }
    const title = (
      `History: ${tokens.toLocaleString()} / `
      + `${trigger.toLocaleString()} tokens `
      + `(${pct.toFixed(1)}% of compaction threshold)`
    );
    return html`
      <div class="compaction-bar" title=${title}>
        <div
          class="compaction-bar-fill"
          style="width: ${pct}%; background: ${color};"
        ></div>
      </div>
    `;
  }

  render() {
    return html`
      <div class="viewer-background">
        <ac-diff-viewer
          class=${this._activeViewer === 'diff'
            ? 'viewer-visible'
            : 'viewer-hidden'}
          @active-file-changed=${this._onActiveFileChanged}
        ></ac-diff-viewer>
        <ac-svg-viewer
          class=${this._activeViewer === 'svg'
            ? 'viewer-visible'
            : 'viewer-hidden'}
          @active-file-changed=${this._onActiveFileChanged}
        ></ac-svg-viewer>
      </div>

      <ac-file-nav
        @navigate-file=${this._onNavigateFile}
      ></ac-file-nav>

      <div
        class="dialog ${this._undockedPos ? 'floating' : ''} ${this._minimized ? 'minimized' : ''}"
        style=${this._dialogInlineStyle()}
      >
        ${this.connectionState === 'disconnected' ? html`
          <div class="reconnect-banner">
            Reconnecting… (attempt ${this.reconnectAttempt})
          </div>
        ` : null}
        <div
          class="dialog-header"
          @pointerdown=${this._onHeaderPointerDown}
        >
          <button
            class="tab-button ${this.activeTab === 'files' ? 'active' : ''}"
            @click=${() => this._switchTab('files')}
          >🗨 Chat</button>
          <button
            class="tab-button ${this.activeTab === 'context' ? 'active' : ''}"
            @click=${() => this._switchTab('context')}
          >📊 Context</button>
          <button
            class="tab-button ${this.activeTab === 'settings' ? 'active' : ''}"
            @click=${() => this._switchTab('settings')}
          >⚙️ Settings</button>
          ${this._docConvertAvailable ? html`
            <button
              class="tab-button ${this.activeTab === 'doc-convert' ? 'active' : ''}"
              @click=${() => this._switchTab('doc-convert')}
              title="Convert documents to markdown"
            >📄 Convert</button>
          ` : null}
          <div class="mode-toggle">
            <div class="mode-segmented" role="group"
              aria-label="Context mode">
              <button
                class="mode-btn ${this._mode === 'code' ? 'active' : ''}"
                ?disabled=${!this.call || !this._isLocalhost}
                title="Code mode — symbol index feeds context"
                aria-pressed=${this._mode === 'code'}
                @click=${() => this._switchMode('code')}
              >💻 Code</button>
              <button
                class="mode-btn ${this._mode === 'doc' ? 'active' : ''}"
                ?disabled=${!this.call || !this._isLocalhost}
                title="Document mode — doc index feeds context"
                aria-pressed=${this._mode === 'doc'}
                @click=${() => this._switchMode('doc')}
              >📄 Doc</button>
            </div>
            <button
              class="crossref-btn ${this._crossRefEnabled ? 'active' : ''}"
              ?disabled=${!this.call || !this._isLocalhost}
              title=${this._crossRefEnabled
                ? 'Cross-reference ON — both indexes active (click to disable)'
                : 'Cross-reference OFF — click to add the other index alongside'}
              aria-pressed=${this._crossRefEnabled}
              @click=${this._toggleCrossRef}
            >🔀 ${this._crossRefEnabled ? 'Cross-ref ON' : 'Cross-ref'}</button>
          </div>
          <div class="header-git-actions" role="group"
            aria-label="Git actions">
            <button
              class="git-action-btn"
              ?disabled=${!this.call}
              title="Copy working-tree diff to clipboard"
              aria-label="Copy diff"
              @click=${this._onCopyDiff}
            >📋</button>
            <button
              class="git-action-btn ${this._committing ? 'in-flight' : ''}"
              ?disabled=${!this.call || this._committing
                || this._reviewActive || this._streaming
                || !this._isLocalhost}
              title=${this._commitButtonTitle()}
              aria-label="Commit all changes"
              @click=${this._onCommit}
            >${this._committing ? '⏳' : '💾'}</button>
            <button
              class="git-action-btn danger"
              ?disabled=${!this.call || this._committing
                || this._streaming || !this._isLocalhost}
              title=${this._resetButtonTitle()}
              aria-label="Reset to HEAD"
              @click=${this._onResetToHead}
            >⚠️</button>
          </div>
          <button
            class="minimize-button"
            title=${this._minimized ? 'Expand' : 'Minimize'}
            @click=${this._toggleMinimize}
          >${this._minimized ? '▴' : '▾'}</button>
        </div>
        <div class="dialog-body">
          <div class="tab-panel ${this.activeTab === 'files' ? 'active' : ''}">
            <ac-files-tab></ac-files-tab>
          </div>
          <div class="tab-panel ${this.activeTab === 'context' ? 'active' : ''}">
            <ac-context-tab></ac-context-tab>
          </div>
          <div class="tab-panel ${this.activeTab === 'settings' ? 'active' : ''}">
            <ac-settings-tab></ac-settings-tab>
          </div>
          ${this._docConvertAvailable ? html`
            <div class="tab-panel ${this.activeTab === 'doc-convert' ? 'active' : ''}">
              <ac-doc-convert-tab></ac-doc-convert-tab>
            </div>
          ` : null}
        </div>
        ${this._renderCompactionBar()}
        <div
          class="resize-handle right"
          @pointerdown=${(e) => this._onHandlePointerDown(e, _RESIZE_RIGHT)}
        ></div>
        <div
          class="resize-handle bottom"
          @pointerdown=${(e) => this._onHandlePointerDown(e, _RESIZE_BOTTOM)}
        ></div>
        <div
          class="resize-handle corner"
          @pointerdown=${(e) => this._onHandlePointerDown(e, _RESIZE_CORNER)}
        ></div>
      </div>

      ${this.overlayVisible ? html`
        <div class="startup-overlay ${this.startupPercent >= 100 ? 'fading' : ''}">
          <div class="startup-brand">
            <span>AC</span><span class="bolt">⚡</span><span>DC</span>
          </div>
          <div class="startup-message">${this.startupMessage}</div>
          <div class="startup-progress">
            <div
              class="startup-progress-bar"
              style="width: ${this.startupPercent}%"
            ></div>
          </div>
        </div>
      ` : null}

      <div class="toast-layer">
        ${this.toasts.map((toast) => html`
          <div class="toast ${toast.type}" data-toast-id=${toast.id}>
            ${toast.message}
          </div>
        `)}
      </div>

      <ac-compaction-progress></ac-compaction-progress>

      <ac-token-hud></ac-token-hud>
    `;
  }

}

customElements.define('ac-app-shell', AppShell);