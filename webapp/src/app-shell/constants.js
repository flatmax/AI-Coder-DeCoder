// AppShell — module-level constants and standalone helpers.
//
// Extracted from webapp/src/app-shell.js. These have no
// dependencies on the AppShell class itself, so they live
// here as plain module exports. The leading-underscore
// naming convention used in app-shell.js was an
// in-class-scope marker; once these names are module
// scoped, the underscore is just noise and we drop it.
//
// Governing specs:
//   - specs4/5-webapp/shell.md
//   - specs4/1-foundation/rpc-transport.md

// ---------------------------------------------------------------
// localStorage persistence helpers
// ---------------------------------------------------------------

/**
 * Build a repo-scoped localStorage key. Falls back to the
 * bare key when the repo name isn't known yet. Scoping
 * prevents opening a different repo from restoring the
 * wrong file.
 */
export function repoKey(key, repoName) {
  if (repoName) return `${key}:${repoName}`;
  return key;
}

export const LAST_OPEN_FILE_KEY = 'ac-last-open-file';
export const LAST_VIEWPORT_KEY = 'ac-last-viewport';

/**
 * Stages that drive the doc-index progress overlay, not the
 * startup overlay. Per specs4/5-webapp/shell.md § "Doc Index
 * Stage Filtering" — in-progress doc-index updates shouldn't
 * re-show the already-dismissed startup overlay. We re-dispatch
 * them on the `doc-index-progress` window channel so
 * `ac-doc-index-progress` picks them up.
 */
export const DOC_INDEX_STAGES = new Set([
  'doc_index',
  'doc_index_error',
  'doc_enrichment_queued',
  'doc_enrichment_file_done',
  'doc_enrichment_complete',
]);

/**
 * localStorage key for the one-shot "enrichment unavailable"
 * warning toast. When `enrichment_status === "unavailable"`
 * arrives in a state snapshot or modeChanged broadcast, we
 * show a toast pointing users at `pip install 'ac-dc[docs]'`
 * — but only once per browser session. Setting this flag
 * suppresses repeats across page reloads and mid-session
 * broadcasts.
 */
export const ENRICHMENT_UNAVAILABLE_SHOWN_KEY =
  'ac-dc-enrichment-unavailable-shown';

/**
 * Alt+Arrow debounce window (ms). Rapid arrow sequences
 * through the file-nav grid coalesce into a single viewer
 * fetch at the end — holding Alt+Right through a 10-node
 * path should produce one fetch for the final target, not
 * ten. HUD updates remain immediate; only the viewer
 * `navigate-file` dispatch is debounced.
 *
 * Alt release flushes the pending dispatch immediately so
 * the user doesn't see the HUD disappear before the viewer
 * has updated.
 */
export const ALT_ARROW_DEBOUNCE_MS = 200;

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

export const DIALOG_WIDTH_KEY = 'ac-dc-dialog-width';
export const DIALOG_POS_KEY = 'ac-dc-dialog-pos';
export const DIALOG_MIN_KEY = 'ac-dc-minimized';
export const ACTIVE_TAB_KEY = 'ac-dc-active-tab';

// Minimum size during resize. Keep these generous — below
// ~300 wide the tab buttons start wrapping, and below ~200
// tall the dialog body collapses unusably.
export const DIALOG_MIN_WIDTH = 300;
export const DIALOG_MIN_HEIGHT = 200;
// When restoring an undocked position, at least this many
// pixels must remain inside the viewport on both axes.
// Otherwise the dialog may be stranded off-screen after a
// monitor disconnect or resolution change.
export const DIALOG_VISIBLE_MARGIN = 100;
// Drag threshold (px). Below this, treat header pointerdown +
// pointerup as a click. Matches the specs4 convention of 5px.
export const DIALOG_DRAG_THRESHOLD = 5;

// Which edge/corner a resize handle represents. Drives the
// delta math: right moves the right edge, bottom moves the
// bottom edge, corner moves both.
export const RESIZE_RIGHT = 'right';
export const RESIZE_BOTTOM = 'bottom';
export const RESIZE_CORNER = 'corner';

/**
 * Read the WebSocket port from the URL, falling back to 18080.
 *
 * Duplicates the logic from main.js so AppShell is self-contained —
 * the shell should be testable without main.js having run.
 * specs4/1-foundation/rpc-transport.md pins the ?port=N contract
 * between the Python launcher and the webapp.
 */
export function getWebSocketPort() {
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
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

/**
 * Name of the custom event used by child components (or utility
 * modules) to request a toast message. The shell catches these
 * and displays them in its toast layer.
 *
 * specs4/5-webapp/shell.md#toast-system — "Components dispatch
 * toast events; the shell catches and renders them."
 */
export const TOAST_EVENT = 'ac-toast';