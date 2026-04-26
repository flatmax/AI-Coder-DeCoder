// DocConvertTab — dialog-driven tool for converting non-markdown
// documents to markdown.
//
// Layer 5 — Doc Convert tab. Drives:
//
//   - DocConvert.is_available()          — backend capability probe
//   - DocConvert.scan_convertible_files() — file list + status
//   - DocConvert.convert_files(paths)    — conversion trigger
//     (Commit 4, not yet wired)
//
// The backend's async mode fires `docConvertProgress` events which
// AppShell translates to `doc-convert-progress` window events; this
// component subscribes in Commit 4 to drive the progress view.
//
// Governing specs:
//   - specs4/4-features/doc-convert.md (full UI + backend spec)
//
// Scope for Commit 2 (this file):
//   - Component scaffold with RpcMixin wiring
//   - is_available + scan on RPC ready (and re-scan on
//     files-modified window event, so post-commit refreshes pick
//     up the newly-committed .md / .svg output)
//   - File list rendering with status badges and checkboxes
//   - Toolbar with select-all / deselect-all / convert button
//     (convert button is disabled in this commit)
//   - Filter bar with fuzzy match (character-by-character
//     subsequence) — same algorithm the file picker uses, so the
//     UX is consistent across tabs
//   - Info banner showing dependency availability
//
// Deferred to later commits:
//   - Commit 3 — app-shell tab registration + visibility gate
//   - Commit 4 — conversion trigger + progress view + event
//     subscription + results summary
//   - Commit 5 — clean-tree gate display, conflict warning
//     tooltips, per-file size/over-size rendering polish

import { LitElement, css, html } from 'lit';

import { RpcMixin } from './rpc-mixin.js';

/**
 * Fuzzy subsequence match — same algorithm the file picker
 * uses (see webapp/src/file-picker.js#fuzzyMatch). Each
 * character in the query must appear in order in the target,
 * but not necessarily consecutively. Case-insensitive. An
 * empty query matches everything.
 *
 * Extracted here rather than imported to keep the doc
 * convert tab standalone — the picker's export surface is
 * already busy and this is a tiny helper.
 *
 * @param {string} path
 * @param {string} query
 * @returns {boolean}
 */
function fuzzyMatch(path, query) {
  if (!query) return true;
  const p = path.toLowerCase();
  const q = query.toLowerCase();
  let i = 0;
  for (let j = 0; j < p.length && i < q.length; j += 1) {
    if (p[j] === q[i]) i += 1;
  }
  return i === q.length;
}

/**
 * Format a byte count for display. 0 B, 1.2 KB, 3.4 MB.
 * Matches the file picker's line-count formatting style —
 * compact and decimal-comma'd so it fits in a row without
 * wrapping.
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Status-badge metadata per specs4/4-features/doc-convert.md.
 * Order here drives legend rendering; color choices match the
 * specs3 table (green/amber/grey/red).
 */
const STATUS_META = {
  new: {
    label: 'new',
    title: 'No converted output yet — first conversion',
    color: '#3fb950',
  },
  stale: {
    label: 'stale',
    title: 'Source has changed since last conversion — '
      + 'converting again will overwrite with fresh output',
    color: '#d29922',
  },
  current: {
    label: 'current',
    title: 'Converted output is up to date — '
      + 're-selecting and converting will overwrite '
      + 'with identical content',
    color: '#8b949e',
  },
  conflict: {
    label: '⚠ conflict',
    title:
      'Output file exists and was not created by doc convert. '
      + 'It may be hand-authored or from another tool. '
      + 'Converting will overwrite it — review the diff '
      + 'before committing.',
    color: '#f85149',
  },
};

export class DocConvertTab extends RpcMixin(LitElement) {
  static properties = {
    /** Availability probe result from is_available(). */
    _availability: { type: Object, state: true },
    /** File list from scan_convertible_files(). */
    _files: { type: Array, state: true },
    /** Selected source paths (Set). */
    _selected: { type: Object, state: true },
    /** Active filter string (empty matches everything). */
    _filter: { type: String, state: true },
    /** True while a scan RPC is in flight. */
    _scanning: { type: Boolean, state: true },
    /** Last scan error (null on success). */
    _scanError: { type: String, state: true },
    /**
     * Working-tree cleanliness from Repo.is_clean. Three
     * states per specs4/4-features/doc-convert.md §
     * Clean-Tree Gate:
     *
     *   - true  — clean, conversion allowed
     *   - false — dirty, Convert button disabled + banner
     *             tells user to commit/stash/discard
     *   - null  — probe hasn't completed or failed (e.g.,
     *             Repo.is_clean RPC unavailable). Don't
     *             block the Convert button — the backend's
     *             clean-tree gate is the final authority
     *             when the user actually clicks. Don't
     *             flash the banner either — showing a
     *             dirty-tree warning when we don't know
     *             the state would be misleading.
     *
     * Refetched on every files-modified window event so
     * the banner and button state follow commits / resets
     * the user performs elsewhere in the app.
     */
    _treeClean: { type: Object, state: true },
    /**
     * Conversion view state machine:
     *   - 'idle'       — file list visible, user can select
     *   - 'converting' — progress view visible, events arriving
     *   - 'complete'   — summary visible, "Done" returns to idle
     */
    _convertPhase: { type: String, state: true },
    /**
     * Paths passed to the current/last convert_files call.
     * Snapshotted at Convert-click time so selection
     * changes during conversion don't shift the progress
     * view's frame of reference.
     */
    _convertBatch: { type: Array, state: true },
    /**
     * Per-file progress keyed by source path. Values
     * carry ``{status, message?, output_path?}`` mirroring
     * the backend's per-file result shape plus a
     * ``'pending'`` status for files that haven't
     * started yet.
     */
    _progressByPath: { type: Object, state: true },
    /**
     * Final results list from the ``complete`` event
     * (or the sync-fallback return value). Drives the
     * summary view — tallies + per-file error messages.
     */
    _convertResults: { type: Array, state: true },
    /**
     * Conversion-level error (RPC failure, restricted
     * caller, dirty tree). Distinct from per-file errors,
     * which live inside _convertResults.
     */
    _convertError: { type: String, state: true },
    /**
     * Working-tree cleanliness, cached from
     * `Repo.is_clean()`. null before the first probe
     * completes — rendered as "checking" state. Rechecked
     * on `files-modified` events since commits / resets
     * change the value.
     */
    _treeClean: { type: Boolean, state: true },
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
      overflow: hidden;
    }

    .info-banner {
      background: rgba(22, 27, 34, 0.6);
      border-bottom: 1px solid rgba(240, 246, 252, 0.08);
      padding: 0.5rem 0.75rem;
      font-size: 0.8125rem;
      color: var(--text-secondary, #8b949e);
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
    }

    /* Dirty-tree banner — amber warning strip. Same
     * visual language as the shell's review banner
     * (per specs4/5-webapp/file-picker.md § Review
     * Banner) so the two banners feel like one system.
     * Not dismissable — it reflects an operational
     * constraint (can't convert with uncommitted
     * changes) that the user resolves by changing
     * state, not by clicking X. */
    .dirty-tree-banner {
      background: rgba(210, 153, 34, 0.12);
      border-bottom: 1px solid rgba(210, 153, 34, 0.4);
      color: #d29922;
      padding: 0.6rem 0.75rem;
      font-size: 0.8125rem;
      line-height: 1.45;
    }
    .dirty-tree-banner {
      background: rgba(210, 153, 34, 0.08);
      border-bottom: 1px solid rgba(210, 153, 34, 0.3);
      color: #d29922;
      padding: 0.5rem 0.75rem;
      font-size: 0.8125rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .dirty-tree-banner-icon {
      flex-shrink: 0;
    }
    .dirty-tree-banner {
      background: rgba(210, 153, 34, 0.08);
      border-bottom: 1px solid rgba(210, 153, 34, 0.3);
      color: #d29922;
      padding: 0.5rem 0.75rem;
      font-size: 0.8125rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .dirty-tree-banner-icon {
      flex-shrink: 0;
    }
    .dep-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
    }
    .dep-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }
    .dep-dot.on { background: #3fb950; }
    .dep-dot.off { background: #8b949e; opacity: 0.6; }

    /* Dirty-tree banner — amber warning strip. Same
     * visual language as the shell's review banner
     * (per specs4/5-webapp/file-picker.md § Review
     * Banner) so the two banners feel like one system.
     * Not dismissable — it reflects an operational
     * constraint (can't convert with uncommitted
     * changes) that the user resolves by changing
     * state, not by clicking X. */
    .dirty-tree-banner {
      background: rgba(210, 153, 34, 0.12);
      border-bottom: 1px solid rgba(210, 153, 34, 0.4);
      color: #d29922;
      padding: 0.6rem 0.75rem;
      font-size: 0.8125rem;
      line-height: 1.45;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid rgba(240, 246, 252, 0.08);
    }
    .toolbar .count {
      flex: 1;
      font-size: 0.8125rem;
      color: var(--text-secondary, #8b949e);
    }
    .toolbar-button {
      background: transparent;
      border: 1px solid rgba(240, 246, 252, 0.15);
      color: var(--text-primary, #c9d1d9);
      padding: 0.3rem 0.6rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.75rem;
      font-family: inherit;
    }
    .toolbar-button:hover:not([disabled]) {
      background: rgba(240, 246, 252, 0.06);
      border-color: rgba(240, 246, 252, 0.3);
    }
    .toolbar-button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .toolbar-button.primary {
      background: var(--accent-primary, #58a6ff);
      border-color: var(--accent-primary, #58a6ff);
      color: #0d1117;
      font-weight: 600;
    }
    .toolbar-button.primary:hover:not([disabled]) {
      filter: brightness(1.1);
    }

    .filter-bar {
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid rgba(240, 246, 252, 0.08);
    }
    .filter-input {
      width: 100%;
      box-sizing: border-box;
      background: rgba(13, 17, 23, 0.8);
      border: 1px solid rgba(240, 246, 252, 0.1);
      color: var(--text-primary, #c9d1d9);
      padding: 0.35rem 0.55rem;
      border-radius: 4px;
      font-size: 0.8125rem;
      font-family: inherit;
    }
    .filter-input:focus {
      outline: none;
      border-color: var(--accent-primary, #58a6ff);
    }

    .file-list {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }

    .file-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.75rem;
      border-bottom: 1px solid rgba(240, 246, 252, 0.04);
      cursor: pointer;
      transition: background 80ms ease;
    }
    .file-row:hover {
      background: rgba(240, 246, 252, 0.03);
    }
    .file-row.is-current,
    .file-row.is-oversize {
      opacity: 0.55;
    }
    .file-row.is-oversize {
      cursor: not-allowed;
    }
    .file-row input[type="checkbox"] {
      flex-shrink: 0;
      accent-color: var(--accent-primary, #58a6ff);
      cursor: pointer;
    }
    .file-path {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 0.8125rem;
    }
    .file-size {
      flex-shrink: 0;
      font-size: 0.75rem;
      color: var(--text-secondary, #8b949e);
      min-width: 4rem;
      text-align: right;
    }
    .status-badge {
      flex-shrink: 0;
      padding: 0.15rem 0.45rem;
      border-radius: 10px;
      font-size: 0.6875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border: 1px solid currentColor;
      min-width: 3.5rem;
      text-align: center;
    }
    .over-size {
      flex-shrink: 0;
      font-size: 0.9rem;
      opacity: 0.85;
    }

    .empty-state {
      padding: 2rem;
      text-align: center;
      color: var(--text-secondary, #8b949e);
      font-style: italic;
    }
    .error-state {
      padding: 1rem;
      color: #f85149;
      font-size: 0.8125rem;
      border-left: 3px solid #f85149;
      background: rgba(248, 81, 73, 0.08);
      margin: 0.75rem;
    }

    .progress-view {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .progress-header {
      padding: 0.75rem;
      border-bottom: 1px solid rgba(240, 246, 252, 0.08);
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .progress-title {
      flex: 1;
      font-size: 0.875rem;
      font-weight: 600;
    }
    .progress-bar {
      flex: 1;
      height: 6px;
      background: rgba(240, 246, 252, 0.08);
      border-radius: 3px;
      overflow: hidden;
      max-width: 240px;
    }
    .progress-bar-fill {
      height: 100%;
      background: var(--accent-primary, #58a6ff);
      transition: width 200ms ease;
    }
    .progress-list {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }
    .progress-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.75rem;
      border-bottom: 1px solid rgba(240, 246, 252, 0.04);
    }
    .progress-status {
      flex-shrink: 0;
      width: 1.25rem;
      text-align: center;
      font-size: 0.9rem;
    }
    .progress-path {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 0.8125rem;
    }
    .progress-detail {
      flex-shrink: 0;
      font-size: 0.75rem;
      color: var(--text-secondary, #8b949e);
      max-width: 40%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .progress-detail.error-text {
      color: #f85149;
    }

    .summary-footer {
      padding: 0.75rem;
      border-top: 1px solid rgba(240, 246, 252, 0.08);
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .summary-tally {
      flex: 1;
      font-size: 0.8125rem;
      color: var(--text-secondary, #8b949e);
    }
    .summary-tally .tally-ok { color: #3fb950; }
    .summary-tally .tally-err { color: #f85149; }
    .summary-tally .tally-skip { color: #8b949e; }

    .top-error {
      padding: 0.75rem;
      color: #f85149;
      font-size: 0.8125rem;
      border-left: 3px solid #f85149;
      background: rgba(248, 81, 73, 0.08);
      margin: 0.75rem;
    }
  `;

  constructor() {
    super();
    this._availability = null;
    this._files = [];
    this._selected = new Set();
    this._filter = '';
    this._scanning = false;
    this._scanError = null;
    // null until the first Repo.is_clean probe completes.
    // See property docstring for the three-state contract.
    this._treeClean = null;
    this._convertPhase = 'idle';
    this._convertBatch = [];
    this._progressByPath = new Map();
    this._convertResults = [];
    this._convertError = null;
    this._treeClean = null;

    // Re-scan after commits / resets — the picker fires
    // `files-modified` as a window event after those ops,
    // so the newly-committed converted files appear with
    // `current` status instead of getting stuck on `new`.
    this._onFilesModified = this._onFilesModified.bind(this);
    // Progress events from the backend flow via AppShell's
    // server-push callback, which re-dispatches them as
    // window events. Binding here lets us add / remove the
    // same callable.
    this._onConvertProgress = this._onConvertProgress.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('files-modified', this._onFilesModified);
    window.addEventListener(
      'doc-convert-progress', this._onConvertProgress,
    );
  }

  disconnectedCallback() {
    window.removeEventListener(
      'files-modified', this._onFilesModified,
    );
    window.removeEventListener(
      'doc-convert-progress', this._onConvertProgress,
    );
    super.disconnectedCallback();
  }

  onRpcReady() {
    this._loadAvailability();
    this._loadFiles();
    this._loadTreeClean();
  }

  _onFilesModified() {
    if (!this.rpcConnected) return;
    // Re-check cleanliness before the re-scan so the
    // gate tooltip reflects the new state. Independent
    // of the scan-in-flight guard — cleanliness is a
    // cheap one-line git call and doesn't collide with
    // the scanner.
    this._loadTreeClean();
    // Skip re-scan while a scan is already in flight —
    // a back-to-back commit + reset sequence would
    // otherwise race.
    if (this._scanning) return;
    this._loadFiles();
  }

  /**
   * Fetch `Repo.is_clean()` and cache the result. Runs
   * on mount and after every `files-modified` event.
   * Failures degrade to null — the gate then assumes
   * dirty (false-safe), showing the tooltip but letting
   * the backend be the final authority when the user
   * actually clicks.
   */
  async _loadTreeClean() {
    try {
      const result = await this.rpcExtract('Repo.is_clean');
      this._treeClean = typeof result === 'boolean'
        ? result : null;
    } catch (err) {
      console.warn('[doc-convert] is_clean failed', err);
      this._treeClean = null;
    }
  }

  /**
   * Consume `doc-convert-progress` window events dispatched
   * by AppShell's `docConvertProgress` server-push callback.
   * The backend's three-stage protocol
   * (`start` / `file` / `complete`) maps to:
   *
   *   start    → transition to 'converting', seed the
   *              progress map with 'pending' entries
   *   file     → update the single file's entry
   *   complete → transition to 'complete', store results,
   *              fire `files-modified` so the picker picks
   *              up new output files
   *
   * Events arriving when we're not in the 'converting'
   * phase are dropped defensively — late events from a
   * cancelled batch (not yet a feature, but a likely
   * addition) shouldn't corrupt an idle or already-
   * completed view.
   */
  _onConvertProgress(event) {
    const detail = event.detail || {};
    const data = detail.data || {};
    const stage = data.stage;
    if (stage === 'start') {
      // Seed progressByPath with 'pending' entries so the
      // UI can show "0 of N" from the first frame. The
      // actual batch path list was already captured at
      // click time, so we trust that ordering.
      const seeded = new Map();
      for (const path of this._convertBatch) {
        seeded.set(path, { status: 'pending' });
      }
      this._progressByPath = seeded;
      this._convertPhase = 'converting';
      return;
    }
    if (stage === 'file') {
      if (this._convertPhase !== 'converting') return;
      const result = data.result || {};
      const path = result.path;
      if (typeof path !== 'string') return;
      const next = new Map(this._progressByPath);
      next.set(path, {
        status: result.status || 'ok',
        message: result.message,
        output_path: result.output_path,
        images: result.images,
      });
      this._progressByPath = next;
      return;
    }
    if (stage === 'complete') {
      if (this._convertPhase !== 'converting') return;
      const results = Array.isArray(data.results)
        ? data.results : [];
      this._applyCompletion(results);
      return;
    }
  }

  async _loadAvailability() {
    try {
      const result = await this.rpcExtract(
        'DocConvert.is_available',
      );
      if (result && typeof result === 'object') {
        this._availability = result;
      }
    } catch (err) {
      // Non-fatal — the info banner just won't render.
      // The file list still works even without the dep
      // flags (scan reports its own errors via
      // _scanError).
      console.warn('[doc-convert] is_available failed', err);
    }
  }

  async _loadCleanliness() {
    // Probe Repo.is_clean. Failure leaves `_treeClean`
    // null, which keeps the Convert button enabled (the
    // backend's gate is the final authority) and the
    // dirty-tree banner hidden. Matches the
    // graceful-degradation contract in specs4.
    try {
      const result = await this.rpcExtract('Repo.is_clean');
      // RPC returns a bare boolean. Coerce defensively —
      // if a future backend wraps it differently, we'd
      // rather null out than store a truthy object.
      if (typeof result === 'boolean') {
        this._treeClean = result;
      } else {
        this._treeClean = null;
      }
    } catch (err) {
      this._treeClean = null;
      console.warn('[doc-convert] Repo.is_clean failed', err);
    }
  }

  async _loadFiles() {
    this._scanning = true;
    this._scanError = null;
    try {
      const result = await this.rpcExtract(
        'DocConvert.scan_convertible_files',
      );
      if (!Array.isArray(result)) {
        this._files = [];
        return;
      }
      this._files = result;
      // Drop stale selections — a file that was selected
      // before a commit may no longer be in the scan
      // (deleted, renamed). Filter the selection to
      // currently-known paths so the count stays honest.
      const paths = new Set(
        result
          .map((entry) => entry?.path)
          .filter((p) => typeof p === 'string'),
      );
      const kept = new Set();
      for (const p of this._selected) {
        if (paths.has(p)) kept.add(p);
      }
      this._selected = kept;
    } catch (err) {
      this._scanError = err?.message || String(err);
      this._files = [];
    } finally {
      this._scanning = false;
    }
  }

  /**
   * Fire the conversion RPC and transition to the progress
   * view. Two paths to completion:
   *
   *   - **Background** — backend returns
   *     `{status: "started", count: N}` and we wait for
   *     `doc-convert-progress` window events to drive the
   *     view. Matches production use.
   *   - **Inline** — backend returns
   *     `{status: "ok", results: [...]}` directly (sync
   *     fallback for no-event-loop paths). We apply the
   *     completion immediately. Matches tests that stub
   *     the RPC.
   *
   * Errors (restricted caller, dirty tree, RPC failure)
   * transition to a dedicated error view with a Retry
   * button rather than leaving the user stuck on a
   * half-rendered progress screen.
   */
  async _startConversion() {
    if (this._convertPhase === 'converting') return;
    const paths = Array.from(this._selected);
    if (paths.length === 0) return;
    // Snapshot the batch before the RPC returns — the
    // user may toggle checkboxes while conversion runs,
    // and the progress view must keep its original frame.
    this._convertBatch = paths;
    this._convertResults = [];
    this._convertError = null;
    // Seed progressByPath optimistically so the user sees
    // something even before the start event arrives. The
    // backend's start event will overwrite this with the
    // same content in background mode; in inline mode
    // it's the only seed we get.
    const seeded = new Map();
    for (const path of paths) {
      seeded.set(path, { status: 'pending' });
    }
    this._progressByPath = seeded;
    this._convertPhase = 'converting';
    try {
      const result = await this.rpcExtract(
        'DocConvert.convert_files', paths,
      );
      if (!result || typeof result !== 'object') {
        this._convertError = 'Unexpected response from server.';
        this._convertPhase = 'complete';
        return;
      }
      if (result.error) {
        // Restricted caller, dirty tree, or other
        // pre-flight rejection. Surface the
        // human-readable `reason` when present (e.g.,
        // "Participants cannot convert files") and
        // fall back to the error code only when no
        // reason was supplied — users shouldn't see a
        // bare "restricted" string when the server
        // told us what it actually meant.
        this._convertError = String(
          result.reason || result.error,
        );
        this._convertPhase = 'complete';
        return;
      }
      if (result.status === 'ok'
          && Array.isArray(result.results)) {
        // Inline (sync) path — apply directly, no events
        // will arrive.
        this._applyCompletion(result.results);
        return;
      }
      if (result.status === 'started') {
        // Background path — events drive the rest. Nothing
        // to do here but wait.
        return;
      }
      // Unknown status — treat as error rather than hang.
      this._convertError = (
        `Unexpected status from server: ${result.status}`
      );
      this._convertPhase = 'complete';
    } catch (err) {
      this._convertError = err?.message || String(err);
      this._convertPhase = 'complete';
    }
  }

  /**
   * Common completion handler for both execution modes.
   * Stores the results list, flips to the summary view,
   * and nudges the rest of the app to re-scan its disk
   * caches via a `files-modified` window event.
   *
   * The re-scan of our own file list runs synchronously
   * via `_loadFiles` — fire-and-forget so the summary
   * render doesn't wait on it. When the scan returns,
   * the badges in the (now-hidden) list behind the
   * summary update; the user sees them on "Done".
   */
  _applyCompletion(results) {
    this._convertResults = results;
    this._convertPhase = 'complete';
    // Let the rest of the app know disk state changed.
    // The file picker, doc index watcher, etc. subscribe
    // to this. Our own `_onFilesModified` handler will
    // re-scan too, which is exactly what we want.
    try {
      window.dispatchEvent(new CustomEvent('files-modified', {
        detail: { source: 'doc-convert' },
      }));
    } catch (_) {
      // CustomEvent unsupported in some test stubs — safe
      // to ignore; the component's own re-scan is what
      // actually matters for badge correctness.
      this._loadFiles();
    }
  }

  /**
   * Transition from the 'complete' summary back to the
   * 'idle' file-list view. Selection is cleared so the
   * user doesn't accidentally re-convert the same batch
   * by double-clicking Convert.
   */
  _dismissSummary() {
    this._convertPhase = 'idle';
    this._convertBatch = [];
    this._progressByPath = new Map();
    this._convertResults = [];
    this._convertError = null;
    this._selected = new Set();
  }

  _visibleFiles() {
    if (!this._filter) return this._files;
    return this._files.filter(
      (entry) =>
        typeof entry?.path === 'string'
        && fuzzyMatch(entry.path, this._filter),
    );
  }

  _toggleSelection(path) {
    if (typeof path !== 'string' || !path) return;
    // Defensive — over-size files can't be converted, so
    // silently refuse to select them even if a caller
    // (row click, Select All) tries. The checkbox is
    // already disabled at the DOM level; this is the
    // backstop.
    const entry = this._files.find((e) => e?.path === path);
    if (entry?.over_size) return;
    const next = new Set(this._selected);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    this._selected = next;
  }

  _selectAll() {
    const next = new Set(this._selected);
    for (const entry of this._visibleFiles()) {
      if (
        typeof entry?.path === 'string'
        && !entry.over_size
      ) {
        next.add(entry.path);
      }
    }
    this._selected = next;
  }

  _deselectAll() {
    // Only deselect visible files — an active filter
    // means the user may have deliberately selected
    // things outside the current view. Matching the
    // select-all's scope keeps the two buttons
    // symmetric.
    const visible = new Set(
      this._visibleFiles()
        .map((entry) => entry?.path)
        .filter((p) => typeof p === 'string'),
    );
    const next = new Set();
    for (const p of this._selected) {
      if (!visible.has(p)) next.add(p);
    }
    this._selected = next;
  }

  _onFilterInput(event) {
    this._filter = event.target.value || '';
  }

  /**
   * Compose the Convert button tooltip. Prioritises the
   * most actionable message:
   *
   *   1. Tree dirty → "Commit or stash first" (spec
   *      wording is explicit here).
   *   2. No selection → "Select files to convert".
   *   3. Otherwise → confirmation count.
   */
  _convertButtonTitle(selectedCount) {
    if (this._treeClean === false) {
      return 'Commit or stash uncommitted changes first';
    }
    if (selectedCount === 0) {
      return 'Select files to convert';
    }
    const plural = selectedCount === 1 ? '' : 's';
    return `Convert ${selectedCount} selected file${plural}`;
  }

  /**
   * Compose the Convert button tooltip. Prioritises the
   * most actionable message:
   *
   *   1. Tree dirty → "Commit or stash first" (spec
   *      wording is explicit here).
   *   2. No selection → "Select files to convert".
   *   3. Otherwise → confirmation count.
   */
  _convertButtonTitle(selectedCount) {
    if (this._treeClean === false) {
      return 'Commit or stash uncommitted changes first';
    }
    if (selectedCount === 0) {
      return 'Select files to convert';
    }
    const plural = selectedCount === 1 ? '' : 's';
    return `Convert ${selectedCount} selected file${plural}`;
  }

  render() {
    if (this._convertPhase === 'converting'
        || this._convertPhase === 'complete') {
      return html`
        ${this._renderInfoBanner()}
        ${this._renderProgressView()}
      `;
    }
    return html`
      ${this._renderInfoBanner()}
      ${this._renderDirtyTreeBanner()}
      ${this._renderToolbar()}
      ${this._renderFilterBar()}
      ${this._renderFileList()}
    `;
  }

  _renderDirtyTreeBanner() {
    // null means the probe hasn't completed or failed.
    // We only show the banner on a definitive dirty
    // result so the UI doesn't flash it during startup.
    if (this._treeClean !== false) return null;
    return html`
      <div class="dirty-tree-banner">
        <span class="dirty-tree-banner-icon">⚠</span>
        <span>
          Working tree has uncommitted changes.
          Commit or stash before converting so new output
          files produce a clean diff.
        </span>
      </div>
    `;
  }

  _renderInfoBanner() {
    const a = this._availability;
    if (!a) return null;
    const chip = (label, on) => html`
      <span class="dep-chip" title=${on ? `${label} available`
        : `${label} not installed`}>
        <span class="dep-dot ${on ? 'on' : 'off'}"></span>
        ${label}
      </span>
    `;
    return html`
      <div class="info-banner">
        ${chip('markitdown', !!a.available)}
        ${chip('LibreOffice', !!a.libreoffice)}
        ${chip('PyMuPDF', !!a.pymupdf)}
        ${chip('PDF pipeline', !!a.pdf_pipeline)}
      </div>
    `;
  }

  _renderToolbar() {
    const visible = this._visibleFiles();
    const selectedCount = this._selected.size;
    const visibleSelected = visible.filter(
      (e) => this._selected.has(e.path),
    ).length;
    // Convert button is disabled in three cases:
    //   1. No selection (user hasn't picked anything)
    //   2. A conversion is already running
    //   3. Working tree is dirty (commit first — the
    //      diff review story depends on it)
    //
    // Tooltip priority mirrors this order so the hover
    // text explains the MOST USER-ACTIONABLE reason.
    // Dirty-tree wins over no-selection because a user
    // with a dirty tree AND no selection needs to
    // commit first anyway; selection comes second. Null
    // cleanliness (probe pending/failed) doesn't
    // disable — the backend gate is the authority.
    const convertDisabled =
      selectedCount === 0
      || this._convertPhase !== 'idle'
      || this._treeClean === false;
    let convertTitle;
    if (this._treeClean === false) {
      convertTitle =
        'Commit or stash your changes before converting — '
        + 'output files must appear as clear diffs.';
    } else if (selectedCount === 0) {
      convertTitle = 'Select files to convert';
    } else {
      convertTitle = `Convert ${selectedCount} selected file${
        selectedCount === 1 ? '' : 's'
      }`;
    }
    return html`
      <div class="toolbar">
        <button
          class="toolbar-button"
          @click=${this._selectAll}
          ?disabled=${visible.length === 0}
          title="Select all visible files"
        >Select all</button>
        <button
          class="toolbar-button"
          @click=${this._deselectAll}
          ?disabled=${visibleSelected === 0}
          title="Deselect all visible files"
        >Deselect all</button>
        <span class="count">
          ${selectedCount} selected${
            this._filter
              ? ` · ${visible.length} visible`
              : ''
          } · ${this._files.length} total
        </span>
        <button
          class="toolbar-button primary"
          ?disabled=${selectedCount === 0
            || this._convertPhase !== 'idle'
            || this._treeClean === false}
          title=${this._convertButtonTitle(selectedCount)}
          @click=${this._startConversion}
        >Convert Selected (${selectedCount})</button>
      </div>
    `;
  }

  _renderFilterBar() {
    return html`
      <div class="filter-bar">
        <input
          class="filter-input"
          type="text"
          placeholder="Filter files…"
          .value=${this._filter}
          @input=${this._onFilterInput}
          spellcheck="false"
        />
      </div>
    `;
  }

  _renderFileList() {
    if (this._scanError) {
      return html`
        <div class="error-state">
          Scan failed: ${this._scanError}
        </div>
      `;
    }
    if (this._scanning && this._files.length === 0) {
      return html`
        <div class="empty-state">Scanning…</div>
      `;
    }
    const visible = this._visibleFiles();
    if (visible.length === 0) {
      const msg = this._filter
        ? 'No files match the filter.'
        : (this._files.length === 0
            ? 'No convertible documents in this repository.'
            : 'No files match the filter.');
      return html`<div class="empty-state">${msg}</div>`;
    }
    return html`
      <div class="file-list">
        ${visible.map((entry) => this._renderFileRow(entry))}
      </div>
    `;
  }

  _renderFileRow(entry) {
    const path = entry?.path || '';
    const status = entry?.status || 'new';
    const meta = STATUS_META[status] || STATUS_META.new;
    const outputPath = entry?.output_path || '';
    const tooltip = outputPath
      ? `${path} → ${outputPath}`
      : path;
    const checked = this._selected.has(path);
    const overSize = !!entry?.over_size;
    // Compose row-level classes. Over-size rows are
    // muted to match `current` — they're also ineligible
    // for the batch, so the visual cue is consistent.
    const rowClasses = [
      'file-row',
      status === 'current' ? 'is-current' : '',
      overSize ? 'is-oversize' : '',
    ].filter(Boolean).join(' ');
    return html`
      <div
        class=${rowClasses}
        title=${tooltip}
        @click=${(e) => this._onRowClick(e, path)}
      >
        <input
          type="checkbox"
          .checked=${checked}
          ?disabled=${overSize}
          @click=${(e) => e.stopPropagation()}
          @change=${() => this._toggleSelection(path)}
        />
        <span class="file-path">${path}</span>
        <span
          class="status-badge"
          style="color: ${meta.color}"
          title=${meta.title}
        >${meta.label}</span>
        <span class="file-size">${formatSize(entry?.size)}</span>
        ${overSize
          ? html`<span
              class="over-size"
              title="Exceeds the configured size limit. This file will be skipped during conversion and cannot be selected."
            >📏</span>`
          : null}
      </div>
    `;
  }

  _onRowClick(event, path) {
    // Click anywhere on the row toggles selection,
    // except when the user explicitly clicked a button
    // or link (none in this commit, but future polish
    // may add context-menu affordances).
    if (
      event.target
      && typeof event.target.closest === 'function'
      && event.target.closest('button, a')
    ) {
      return;
    }
    this._toggleSelection(path);
  }

  _renderProgressView() {
    const total = this._convertBatch.length;
    // Count terminal entries — anything that's not
    // 'pending' has a final status from the backend.
    let done = 0;
    for (const value of this._progressByPath.values()) {
      if (value && value.status !== 'pending') done += 1;
    }
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const isComplete = this._convertPhase === 'complete';
    const title = isComplete
      ? 'Conversion complete'
      : `Converting ${done} of ${total}…`;
    return html`
      <div class="progress-view">
        <div class="progress-header">
          <div class="progress-title">${title}</div>
          <div class="progress-bar">
            <div
              class="progress-bar-fill"
              style="width: ${pct}%"
            ></div>
          </div>
        </div>
        ${this._convertError ? html`
          <div class="top-error">${this._convertError}</div>
        ` : null}
        <div class="progress-list">
          ${this._convertBatch.map((path) =>
            this._renderProgressRow(path))}
        </div>
        ${isComplete ? this._renderSummaryFooter() : null}
      </div>
    `;
  }

  _renderProgressRow(path) {
    const entry = this._progressByPath.get(path)
      || { status: 'pending' };
    const status = entry.status;
    // Icon choice:
    //   pending  — spinner hint
    //   ok       — green check
    //   skipped  — grey dash (e.g. over-size)
    //   error    — red cross
    let icon;
    let iconColor;
    if (status === 'pending') {
      icon = '⋯';
      iconColor = '#8b949e';
    } else if (status === 'ok') {
      icon = '✓';
      iconColor = '#3fb950';
    } else if (status === 'skipped') {
      icon = '–';
      iconColor = '#8b949e';
    } else {
      icon = '✗';
      iconColor = '#f85149';
    }
    // Detail line — for ok entries show the output path;
    // for errors/skips show the message. Keeps the row
    // dense without sacrificing diagnosability.
    let detail = '';
    let detailClass = 'progress-detail';
    if (status === 'ok' && entry.output_path) {
      detail = `→ ${entry.output_path}`;
    } else if (entry.message) {
      detail = entry.message;
      if (status === 'error') detailClass += ' error-text';
    }
    return html`
      <div class="progress-row" title=${path}>
        <span
          class="progress-status"
          style="color: ${iconColor}"
        >${icon}</span>
        <span class="progress-path">${path}</span>
        <span class=${detailClass}>${detail}</span>
      </div>
    `;
  }

  _renderSummaryFooter() {
    // Tally from results when we have them; fall back to
    // the live map for the edge case where the complete
    // event was dropped but file events all arrived.
    const tally = { ok: 0, skipped: 0, error: 0 };
    const source = this._convertResults.length > 0
      ? this._convertResults
      : Array.from(this._progressByPath.values());
    for (const entry of source) {
      const s = entry?.status;
      if (s === 'ok') tally.ok += 1;
      else if (s === 'skipped') tally.skipped += 1;
      else if (s === 'error') tally.error += 1;
    }
    const retryDisabled = this._convertBatch.length === 0;
    return html`
      <div class="summary-footer">
        <span class="summary-tally">
          <span class="tally-ok">${tally.ok} converted</span>
          ${tally.skipped > 0 ? html`
            · <span class="tally-skip">${tally.skipped} skipped</span>
          ` : null}
          ${tally.error > 0 ? html`
            · <span class="tally-err">${tally.error} failed</span>
          ` : null}
        </span>
        <button
          class="toolbar-button"
          @click=${this._retryConversion}
          ?disabled=${retryDisabled}
          title="Re-run conversion for the same file set"
        >Retry</button>
        <button
          class="toolbar-button primary"
          @click=${this._dismissSummary}
        >Done</button>
      </div>
    `;
  }

  _retryConversion() {
    if (this._convertBatch.length === 0) return;
    // Re-enter the start flow with the same batch. Keep
    // _convertBatch intact so _startConversion's own
    // snapshot step ends up with the same paths it
    // started with.
    this._selected = new Set(this._convertBatch);
    // Reset phase so _startConversion's idle check
    // passes.
    this._convertPhase = 'idle';
    this._startConversion();
  }
}

customElements.define('ac-doc-convert-tab', DocConvertTab);