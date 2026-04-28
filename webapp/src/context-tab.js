// ContextTab — token budget breakdown and cache tier viewer.
//
// Layer 5 Phase 3.4 — Context tab with Budget / Cache sub-views.
//
// Consumes LLMService.get_context_breakdown for both views.
// Budget shows category-level token allocation; Cache shows
// per-tier stability state. Active sub-view persisted to
// localStorage. Both auto-refresh on stream-complete and
// files-changed when visible; mark stale when hidden.
//
// Governing spec: specs4/5-webapp/viewers-hud.md

import { LitElement, css, html } from 'lit';
import { RpcMixin } from './rpc-mixin.js';
import { fuzzyMatch } from './file-picker.js';

/** localStorage key for the active sub-view. */
const _SUBVIEW_KEY = 'ac-dc-context-subview';

/** localStorage key for expanded tiers in the cache sub-view. */
const _CACHE_EXPANDED_KEY = 'ac-dc-cache-expanded';

/** localStorage key for the Files category expanded state in Budget view. */
const _BUDGET_FILES_EXPANDED_KEY = 'ac-dc-budget-files-expanded';

/** Tier colors for the cache sub-view. */
const _TIER_COLORS = {
  L0: '#50c878',
  L1: '#2dd4bf',
  L2: '#60a5fa',
  L3: '#f59e0b',
  active: '#f97316',
};

/** Content type icons for cache tier items. */
const _TYPE_ICONS = {
  system: '⚙️',
  legend: '📖',
  symbols: '📦',
  doc_symbols: '📝',
  files: '📄',
  urls: '🔗',
  history: '💬',
};

/** Category colors for the stacked bar. */
const _COLORS = {
  system: '#50c878',
  symbol_map: '#60a5fa',
  files: '#f59e0b',
  urls: '#a78bfa',
  history: '#f97316',
};

/**
 * Format a token count for display. Uses K suffix for
 * thousands (e.g., 34,355 → "34.4K"). Values under 1000
 * render as-is.
 */
function _fmtTokens(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0';
  if (n < 1000) return String(Math.round(n));
  return `${(n / 1000).toFixed(1)}K`;
}

/**
 * Compute the budget bar color from a usage percentage.
 * Green ≤75%, amber 75–90%, red >90%.
 */
function _budgetColor(pct) {
  if (pct > 90) return '#f85149';
  if (pct > 75) return '#d29922';
  return '#7ee787';
}

export class ContextTab extends RpcMixin(LitElement) {
  static properties = {
    /** Active sub-view — 'budget' or 'cache'. */
    _subview: { type: String, state: true },
    /** Breakdown data from get_context_breakdown. */
    _data: { type: Object, state: true },
    /** Whether a fetch is in flight. */
    _loading: { type: Boolean, state: true },
    /** Whether the data is stale (hidden during an update). */
    _stale: { type: Boolean, state: true },
    /** Set of expanded tier names in the cache sub-view. */
    _cacheExpanded: { type: Object, state: true },
    /**
     * Whether a cache rebuild RPC is in flight. Distinct from
     * ``_loading`` (which covers ``get_context_breakdown``) so
     * the rebuild button can show its own disabled/progress
     * state without fighting with a concurrent refresh.
     */
    _rebuilding: { type: Boolean, state: true },
    /**
     * Map-block modal state. Null when no modal is open;
     * otherwise ``{key, name, loading, content, error, mode}``
     * tracking the click-to-view modal for a tracker item.
     * The cache viewer opens this modal when the user clicks
     * an item row — see specs4/5-webapp/viewers-hud.md §
     * "Item Click → View Map Block".
     */
    _mapModal: { type: Object, state: true },
    /**
     * Whether the Files category in Budget view is expanded to
     * show per-file detail. When true, the Files row renders
     * each selected file's path and token count below the
     * aggregate bar. Persisted to localStorage so users who
     * habitually audit their context don't have to re-expand
     * every session. Defaults to true — the whole point of
     * looking at the Budget view is to see what's in context,
     * and aggregate-only display made it hard to diagnose
     * "file I thought was in context isn't" cases.
     */
    _budgetFilesExpanded: { type: Boolean, state: true },
    /**
     * Fuzzy-match filter query for the Cache sub-view. Empty
     * string means no filter (show all tiers and items).
     * Character-subsequence matching (same algorithm as the
     * file picker) — typing ``ctx`` matches ``context.py``,
     * ``ContextManager``, ``src/ac_dc/context/manager.py``.
     * Case-insensitive. Applies to the item's displayed path
     * or name; tiers whose measured items all get filtered
     * out AND have no unmeasured items are hidden entirely.
     * Not persisted — per-session state; a filter left over
     * from a previous session is more confusing than useful.
     */
    _cacheFilter: { type: String, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: var(--bg-primary, #0d1117);
      color: var(--text-primary, #c9d1d9);
      font-size: 0.875rem;
      overflow-y: auto;
    }

    .toolbar {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      border-bottom: 1px solid rgba(240, 246, 252, 0.1);
      background: rgba(22, 27, 34, 0.4);
    }
    .pill-toggle {
      display: flex;
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 4px;
      overflow: hidden;
    }
    .pill-btn {
      background: transparent;
      border: none;
      color: var(--text-secondary, #8b949e);
      padding: 0.3rem 0.75rem;
      font-size: 0.75rem;
      font-family: inherit;
      cursor: pointer;
    }
    .pill-btn:hover {
      background: rgba(240, 246, 252, 0.06);
    }
    .pill-btn.active {
      background: rgba(88, 166, 255, 0.15);
      color: var(--accent-primary, #58a6ff);
    }
    .toolbar-spacer {
      flex: 1;
    }
    .stale-badge {
      font-size: 0.7rem;
      color: #d29922;
    }
    .refresh-btn {
      background: transparent;
      border: 1px solid rgba(240, 246, 252, 0.15);
      color: var(--text-secondary, #8b949e);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.75rem;
      font-family: inherit;
    }
    .refresh-btn:hover {
      background: rgba(240, 246, 252, 0.06);
      color: var(--text-primary, #c9d1d9);
    }
    .refresh-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .filter-input {
      flex: 1;
      min-width: 6rem;
      max-width: 16rem;
      padding: 0.25rem 0.5rem;
      background: rgba(13, 17, 23, 0.8);
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 4px;
      color: var(--text-primary, #c9d1d9);
      font-family: inherit;
      font-size: 0.75rem;
    }
    .filter-input:focus {
      outline: none;
      border-color: var(--accent-primary, #58a6ff);
    }
    .filter-clear {
      background: transparent;
      border: none;
      color: var(--text-secondary, #8b949e);
      cursor: pointer;
      padding: 0 0.25rem;
      font-size: 0.875rem;
      line-height: 1;
    }
    .filter-clear:hover {
      color: var(--text-primary, #c9d1d9);
    }
    .no-matches {
      padding: 1.5rem;
      text-align: center;
      color: var(--text-secondary, #8b949e);
      font-style: italic;
      font-size: 0.8125rem;
    }

    .content {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 1rem;
    }
    .empty-state {
      padding: 2rem;
      text-align: center;
      color: var(--text-secondary, #8b949e);
      font-style: italic;
    }

    /* Budget sub-view */
    .budget-header {
      margin-bottom: 1rem;
    }
    .model-info {
      font-size: 0.8125rem;
      color: var(--text-secondary, #8b949e);
      margin-bottom: 0.5rem;
    }
    .model-info strong {
      color: var(--text-primary, #c9d1d9);
    }
    .budget-bar-container {
      background: rgba(240, 246, 252, 0.08);
      border-radius: 4px;
      height: 8px;
      overflow: hidden;
      margin-bottom: 0.25rem;
    }
    .budget-bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 300ms ease;
    }
    .budget-label {
      font-size: 0.75rem;
      color: var(--text-secondary, #8b949e);
      display: flex;
      justify-content: space-between;
    }

    .stacked-bar {
      display: flex;
      height: 6px;
      border-radius: 3px;
      overflow: hidden;
      margin: 0.75rem 0 0.5rem;
      background: rgba(240, 246, 252, 0.06);
    }
    .stacked-segment {
      height: 100%;
      transition: width 300ms ease;
    }
    .legend-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-bottom: 1rem;
      font-size: 0.75rem;
      color: var(--text-secondary, #8b949e);
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 0.3rem;
    }
    .legend-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .category-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .category-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .category-name {
      min-width: 6rem;
      font-size: 0.8125rem;
    }
    .category-bar-track {
      flex: 1;
      height: 4px;
      background: rgba(240, 246, 252, 0.08);
      border-radius: 2px;
      overflow: hidden;
    }
    .category-bar-fill {
      height: 100%;
      border-radius: 2px;
    }
    .category-tokens {
      min-width: 4rem;
      text-align: right;
      font-size: 0.8125rem;
      font-family: 'SFMono-Regular', Consolas, monospace;
      color: #7ee787;
    }
    .category-row-expandable {
      cursor: pointer;
      user-select: none;
    }
    .category-row-expandable:hover {
      background: rgba(240, 246, 252, 0.04);
      border-radius: 3px;
    }
    .category-toggle {
      display: inline-block;
      width: 0.75rem;
      font-size: 0.625rem;
      color: var(--text-secondary, #8b949e);
      flex-shrink: 0;
    }
    .file-detail-list {
      display: flex;
      flex-direction: column;
      margin-left: 6.75rem;
      margin-bottom: 0.5rem;
      padding-left: 0.5rem;
      border-left: 1px solid rgba(240, 246, 252, 0.08);
    }
    .file-detail-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.15rem 0;
      font-size: 0.75rem;
      color: var(--text-secondary, #8b949e);
    }
    .file-detail-path {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: 'SFMono-Regular', Consolas, monospace;
    }
    .file-detail-tokens {
      flex-shrink: 0;
      font-family: 'SFMono-Regular', Consolas, monospace;
      color: #7ee787;
    }

    .session-totals {
      border-top: 1px solid rgba(240, 246, 252, 0.08);
      padding-top: 0.75rem;
      margin-top: 0.5rem;
    }
    .session-totals-title {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary, #8b949e);
      margin-bottom: 0.5rem;
    }
    .totals-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.35rem 1rem;
      font-size: 0.8125rem;
    }
    .totals-label {
      color: var(--text-secondary, #8b949e);
    }
    .totals-value {
      text-align: right;
      font-family: 'SFMono-Regular', Consolas, monospace;
    }
    .totals-value.cache-read {
      color: #7ee787;
    }
    .totals-value.cache-write {
      color: #f59e0b;
    }

    /* Cache sub-view */
    .cache-actions {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 0.75rem;
    }
    .rebuild-btn {
      background: rgba(88, 166, 255, 0.08);
      border: 1px solid rgba(88, 166, 255, 0.3);
      color: var(--accent-primary, #58a6ff);
      padding: 0.35rem 0.75rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.75rem;
      font-family: inherit;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .rebuild-btn:hover:not(:disabled) {
      background: rgba(88, 166, 255, 0.15);
      border-color: rgba(88, 166, 255, 0.5);
    }
    .rebuild-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .cache-header {
      margin-bottom: 1rem;
    }
    .cache-hit-bar-container {
      background: rgba(240, 246, 252, 0.08);
      border-radius: 4px;
      height: 6px;
      overflow: hidden;
      margin-bottom: 0.25rem;
    }
    .cache-hit-bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 300ms ease;
    }
    .cache-hit-label {
      font-size: 0.75rem;
      color: var(--text-secondary, #8b949e);
      display: flex;
      justify-content: space-between;
    }

    .changes-section {
      margin-bottom: 0.75rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid rgba(240, 246, 252, 0.06);
    }
    .changes-title {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-secondary, #8b949e);
      margin-bottom: 0.35rem;
    }
    .change-item {
      font-size: 0.75rem;
      padding: 0.1rem 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tier-group {
      margin-bottom: 0.5rem;
      border: 1px solid rgba(240, 246, 252, 0.08);
      border-radius: 6px;
      overflow: hidden;
    }
    .tier-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0.75rem;
      cursor: pointer;
      user-select: none;
      background: rgba(22, 27, 34, 0.4);
    }
    .tier-header:hover {
      background: rgba(240, 246, 252, 0.03);
    }
    .tier-toggle {
      font-size: 0.625rem;
      width: 0.75rem;
      text-align: center;
      color: var(--text-secondary, #8b949e);
    }
    .tier-name {
      font-size: 0.8125rem;
      font-weight: 600;
    }
    .tier-spacer {
      flex: 1;
    }
    .tier-tokens {
      font-size: 0.75rem;
      font-family: 'SFMono-Regular', Consolas, monospace;
      color: #7ee787;
    }
    .tier-cached-icon {
      font-size: 0.625rem;
      color: var(--text-secondary, #8b949e);
    }
    .tier-body {
      padding: 0.25rem 0.75rem 0.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    .tier-item {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.75rem;
    }
    .tier-item-icon {
      flex-shrink: 0;
      width: 1rem;
      text-align: center;
    }
    .tier-item-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tier-item-tokens {
      flex-shrink: 0;
      font-family: 'SFMono-Regular', Consolas, monospace;
      color: #7ee787;
      font-size: 0.7rem;
    }
    .tier-item-bar {
      flex-shrink: 0;
      width: 40px;
      height: 3px;
      background: rgba(240, 246, 252, 0.08);
      border-radius: 1.5px;
      overflow: hidden;
    }
    .tier-item-bar-fill {
      height: 100%;
      border-radius: 1.5px;
    }
    .tier-item-n {
      flex-shrink: 0;
      font-size: 0.625rem;
      color: var(--text-secondary, #8b949e);
      font-family: 'SFMono-Regular', Consolas, monospace;
      min-width: 2.5rem;
      text-align: right;
    }
    .tier-unmeasured {
      font-size: 0.75rem;
      color: var(--text-secondary, #8b949e);
      font-style: italic;
      padding: 0.15rem 0;
    }

    .cache-footer {
      border-top: 1px solid rgba(240, 246, 252, 0.08);
      padding-top: 0.5rem;
      margin-top: 0.5rem;
      font-size: 0.75rem;
      color: var(--text-secondary, #8b949e);
      display: flex;
      justify-content: space-between;
    }

    .tier-item-name {
      cursor: pointer;
    }
    .tier-item-name:hover {
      color: var(--accent-primary, #58a6ff);
      text-decoration: underline;
    }

    /* Map-block modal */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .modal-dialog {
      background: var(--bg-primary, #0d1117);
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 8px;
      max-width: 900px;
      width: 100%;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    }
    .modal-header {
      flex-shrink: 0;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid rgba(240, 246, 252, 0.1);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .modal-title {
      font-size: 0.875rem;
      font-weight: 600;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .modal-mode-badge {
      font-size: 0.7rem;
      padding: 0.15rem 0.5rem;
      border-radius: 3px;
      background: rgba(88, 166, 255, 0.15);
      color: var(--accent-primary, #58a6ff);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .modal-close {
      background: transparent;
      border: none;
      color: var(--text-secondary, #8b949e);
      font-size: 1.25rem;
      cursor: pointer;
      padding: 0 0.25rem;
      line-height: 1;
    }
    .modal-close:hover {
      color: var(--text-primary, #c9d1d9);
    }
    .modal-body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 1rem;
    }
    .modal-body pre {
      margin: 0;
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 0.8125rem;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--text-primary, #c9d1d9);
    }
    .modal-loading,
    .modal-error {
      padding: 2rem;
      text-align: center;
      color: var(--text-secondary, #8b949e);
    }
    .modal-error {
      color: #f85149;
    }
  `;

  constructor() {
    super();
    this._subview = this._loadSubview();
    this._data = null;
    this._loading = false;
    this._stale = false;
    this._rebuilding = false;
    this._cacheExpanded = this._loadCacheExpanded();
    this._mapModal = null;
    this._budgetFilesExpanded = this._loadBudgetFilesExpanded();
    this._cacheFilter = '';

    this._onStreamComplete = this._onStreamComplete.bind(this);
    this._onFilesChanged = this._onFilesChanged.bind(this);
    this._onModeChanged = this._onModeChanged.bind(this);
    this._onSessionChanged = this._onSessionChanged.bind(this);
    this._onModalKeyDown = this._onModalKeyDown.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('stream-complete', this._onStreamComplete);
    window.addEventListener('files-changed', this._onFilesChanged);
    window.addEventListener('mode-changed', this._onModeChanged);
    // session-changed fires on startup after _restore_last_session
    // loads a prior session's history, and whenever the user
    // loads a historical session via the browser. The budget
    // display depends on history token count, so either case
    // requires a refresh. Mark stale when the tab isn't
    // visible so the refresh runs when the user switches to
    // it — matches the other listeners' behaviour.
    window.addEventListener('session-changed', this._onSessionChanged);
    window.addEventListener('keydown', this._onModalKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener('stream-complete', this._onStreamComplete);
    window.removeEventListener('files-changed', this._onFilesChanged);
    window.removeEventListener('mode-changed', this._onModeChanged);
    window.removeEventListener('session-changed', this._onSessionChanged);
    window.removeEventListener('keydown', this._onModalKeyDown);
    super.disconnectedCallback();
  }

  onRpcReady() {
    this._refresh();
  }

  /**
   * Called by the dialog when this tab becomes visible.
   * Refreshes if stale; otherwise no-op.
   */
  onTabVisible() {
    if (this._stale) {
      this._stale = false;
      this._refresh();
    }
  }

  // ---------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------

  _isTabActive() {
    const panel = this.parentElement;
    if (panel && panel.classList && panel.classList.contains('tab-panel')) {
      return panel.classList.contains('active');
    }
    return this.offsetParent !== null;
  }

  _onStreamComplete() {
    if (this._isTabActive()) {
      this._refresh();
    } else {
      this._stale = true;
    }
  }

  _onFilesChanged() {
    if (this._isTabActive()) {
      this._refresh();
    } else {
      this._stale = true;
    }
  }

  _onModeChanged() {
    if (this._isTabActive()) {
      this._refresh();
    } else {
      this._stale = true;
    }
  }

  _onSessionChanged() {
    if (this._isTabActive()) {
      this._refresh();
    } else {
      this._stale = true;
    }
  }

  async _refresh() {
    if (this._loading) return;
    if (!this.rpcConnected) return;
    this._loading = true;
    try {
      const result = await this.rpcExtract(
        'LLMService.get_context_breakdown',
      );
      this._data = result && typeof result === 'object' ? result : null;
      this._stale = false;
    } catch (err) {
      // Method may not exist on older/stripped backends.
      const msg = err?.message || '';
      if (!msg.includes('method not found')) {
        console.warn('[context-tab] get_context_breakdown failed', err);
      }
    } finally {
      this._loading = false;
    }
  }

  /**
   * Trigger a server-side cache tier rebuild.
   *
   * Calls ``LLMService.rebuild_cache`` — a one-shot disruptive
   * operation that wipes all tier assignments (except history)
   * and redistributes using the clustering algorithm. The
   * server returns a summary dict with per-tier counts and a
   * human-readable ``message`` string.
   *
   * Surfaces feedback via ``ac-toast`` events:
   *
   * - Success → the server's ``message`` (shape:
   *   "Cache rebuild (code): 40 → 194 items | L0=4 L1=31 …")
   * - Restricted (non-localhost) → info toast explaining the
   *   localhost-only policy
   * - Other error → error toast with the server's error text
   *
   * Always calls ``_refresh()`` afterward — on success to show
   * the new tier distribution, on failure to show whatever
   * partial state the failure left (rebuild is atomic from the
   * RPC caller's perspective, but the next chat request's
   * ``_update_stability`` will repair any inconsistency).
   *
   * Guarded by ``_rebuilding`` against double-clicks, and by
   * ``_loading`` against overlapping with an in-flight refresh
   * — kicking off a rebuild while a refresh is reading the
   * tracker would produce inconsistent viewer state.
   */
  async _rebuild() {
    if (this._rebuilding || this._loading) return;
    if (!this.rpcConnected) return;
    this._rebuilding = true;
    try {
      const result = await this.rpcExtract(
        'LLMService.rebuild_cache',
      );
      if (result && typeof result === 'object' && result.error) {
        // Differentiate the restricted-error shape from other
        // errors. specs4/1-foundation/rpc-transport.md pins
        // the {error: "restricted", reason: ...} shape for
        // non-localhost callers.
        const isRestricted = result.error === 'restricted';
        this._emitToast(
          isRestricted
            ? (result.reason
               || 'Cache rebuild is localhost-only')
            : `Rebuild failed: ${result.error}`,
          isRestricted ? 'info' : 'error',
        );
      } else if (result && typeof result === 'object' && result.message) {
        this._emitToast(result.message, 'success');
      } else {
        // Defensive — a rebuilt response without a message
        // field would indicate a backend contract change.
        // Show a generic success so the user knows it
        // completed.
        this._emitToast('Cache rebuilt', 'success');
      }
    } catch (err) {
      // Transport-level errors (RPC disconnect, method not
      // found on an older backend).
      const msg = err?.message || String(err);
      this._emitToast(`Rebuild failed: ${msg}`, 'error');
    } finally {
      this._rebuilding = false;
      // Refresh even on failure — shows the current tracker
      // state, which the user may need to see to diagnose.
      this._refresh();
    }
  }

  /**
   * Dispatch an ``ac-toast`` window event — consumed by the
   * app shell's toast layer. Uses bubbles + composed so the
   * event crosses shadow DOM boundaries.
   */
  _emitToast(message, type = 'info') {
    this.dispatchEvent(
      new CustomEvent('ac-toast', {
        bubbles: true,
        composed: true,
        detail: { message, type },
      }),
    );
  }

  // ---------------------------------------------------------------
  // Map-block modal (item click → view index block)
  // ---------------------------------------------------------------
  //
  // Per specs4/5-webapp/viewers-hud.md § "Item Click → View Map
  // Block", clicking a tracker item name opens a modal with the
  // full index block for that file. Backend dispatch at
  // LLMService.get_file_map_block — it handles the system:prompt
  // special case, current-mode primary, cross-mode fallback, and
  // error-when-neither-has-data.

  async _openMapModal(key, name) {
    this._mapModal = {
      key,
      name,
      loading: true,
      content: '',
      error: null,
      mode: null,
    };
    try {
      const result = await this.rpcExtract(
        'LLMService.get_file_map_block',
        key,
      );
      if (result && typeof result === 'object' && result.error) {
        this._mapModal = {
          ...this._mapModal,
          loading: false,
          error: result.error,
        };
      } else if (result && typeof result === 'object') {
        this._mapModal = {
          ...this._mapModal,
          loading: false,
          content: result.content || '',
          mode: result.mode || null,
        };
      } else {
        this._mapModal = {
          ...this._mapModal,
          loading: false,
          error: 'No content returned',
        };
      }
    } catch (err) {
      this._mapModal = {
        ...this._mapModal,
        loading: false,
        error: err?.message || String(err),
      };
    }
  }

  _closeMapModal() {
    this._mapModal = null;
  }

  _onModalKeyDown(event) {
    if (event.key === 'Escape' && this._mapModal) {
      event.preventDefault();
      this._closeMapModal();
    }
  }

  // ---------------------------------------------------------------
  // Sub-view toggle
  // ---------------------------------------------------------------

  _loadSubview() {
    try {
      const v = localStorage.getItem(_SUBVIEW_KEY);
      if (v === 'cache') return 'cache';
    } catch (_) {}
    return 'budget';
  }

  _setSubview(v) {
    this._subview = v;
    try {
      localStorage.setItem(_SUBVIEW_KEY, v);
    } catch (_) {}
  }

  _loadCacheExpanded() {
    try {
      const raw = localStorage.getItem(_CACHE_EXPANDED_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return new Set(arr);
      }
    } catch (_) {}
    // Default: L0 and active expanded, others collapsed.
    return new Set(['L0', 'active']);
  }

  _saveCacheExpanded() {
    try {
      localStorage.setItem(
        _CACHE_EXPANDED_KEY,
        JSON.stringify([...this._cacheExpanded]),
      );
    } catch (_) {}
  }

  _toggleCacheTier(name) {
    const next = new Set(this._cacheExpanded);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    this._cacheExpanded = next;
    this._saveCacheExpanded();
  }

  _loadBudgetFilesExpanded() {
    try {
      const raw = localStorage.getItem(_BUDGET_FILES_EXPANDED_KEY);
      // Default true — aggregate-only Files row made it
      // hard to see what the LLM actually sees. Only
      // respect an explicit "false" to keep it collapsed.
      if (raw === 'false') return false;
    } catch (_) {}
    return true;
  }

  _saveBudgetFilesExpanded() {
    try {
      localStorage.setItem(
        _BUDGET_FILES_EXPANDED_KEY,
        this._budgetFilesExpanded ? 'true' : 'false',
      );
    } catch (_) {}
  }

  _toggleBudgetFiles() {
    this._budgetFilesExpanded = !this._budgetFilesExpanded;
    this._saveBudgetFilesExpanded();
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  render() {
    return html`
      <div class="toolbar">
        <div class="pill-toggle">
          <button
            class="pill-btn ${this._subview === 'budget' ? 'active' : ''}"
            @click=${() => this._setSubview('budget')}
          >Budget</button>
          <button
            class="pill-btn ${this._subview === 'cache' ? 'active' : ''}"
            @click=${() => this._setSubview('cache')}
          >Cache</button>
        </div>
        ${this._subview === 'cache'
          ? html`
              <input
                type="text"
                class="filter-input"
                placeholder="Filter items (fuzzy match)…"
                .value=${this._cacheFilter}
                @input=${(e) => { this._cacheFilter = e.target.value; }}
                aria-label="Filter cache items"
              />
              ${this._cacheFilter
                ? html`<button
                    class="filter-clear"
                    @click=${() => { this._cacheFilter = ''; }}
                    title="Clear filter"
                    aria-label="Clear filter"
                  >×</button>`
                : ''}
            `
          : ''}
        <div class="toolbar-spacer"></div>
        ${this._stale ? html`<span class="stale-badge">● stale</span>` : ''}
        <button
          class="refresh-btn"
          ?disabled=${this._loading || !this.rpcConnected}
          @click=${() => this._refresh()}
          title="Refresh"
        >↻</button>
      </div>
      <div class="content">
        ${this._subview === 'budget'
          ? this._renderBudget()
          : this._renderCache()}
      </div>
      ${this._renderMapModal()}
    `;
  }

  // ---------------------------------------------------------------
  // Budget sub-view
  // ---------------------------------------------------------------

  _renderBudget() {
    if (!this._data) {
      return html`<div class="empty-state">
        ${this._loading ? 'Loading…' : 'No data yet — send a message first'}
      </div>`;
    }
    const d = this._data;
    const bd = d.breakdown || {};
    const total = d.total_tokens || 0;
    const max = d.max_input_tokens || 1000000;
    const pct = max > 0 ? Math.min(100, (total / max) * 100) : 0;
    const cacheRate = d.provider_cache_rate ?? d.cache_hit_rate ?? 0;

    // Categories for the stacked bar and the detail list.
    const categories = [
      { key: 'system', label: 'System', tokens: bd.system || 0 },
      { key: 'symbol_map', label: d.mode === 'doc' ? 'Doc Map' : 'Symbol Map', tokens: bd.symbol_map || 0 },
      { key: 'files', label: `Files (${bd.file_count || 0})`, tokens: bd.files || 0 },
      { key: 'urls', label: 'URLs', tokens: bd.urls || 0 },
      { key: 'history', label: 'History', tokens: bd.history || 0 },
    ].filter((c) => c.tokens > 0);

    const maxCat = Math.max(1, ...categories.map((c) => c.tokens));

    return html`
      <div class="budget-header">
        <div class="model-info">
          <strong>${d.model || '—'}</strong>
          ${cacheRate > 0
            ? html` · Cache: ${Math.round(cacheRate * 100)}% hit`
            : ''}
          ${d.mode === 'doc' ? html` · 📝 Doc Mode` : ''}
        </div>
        <div class="budget-bar-container">
          <div
            class="budget-bar-fill"
            style="width: ${pct}%; background: ${_budgetColor(pct)}"
          ></div>
        </div>
        <div class="budget-label">
          <span>${_fmtTokens(total)} / ${_fmtTokens(max)}</span>
          <span>${pct.toFixed(1)}% used</span>
        </div>
      </div>

      ${categories.length > 0
        ? html`
            <div class="stacked-bar">
              ${categories.map(
                (c) => html`
                  <div
                    class="stacked-segment"
                    style="width: ${total > 0 ? (c.tokens / total) * 100 : 0}%; background: ${_COLORS[c.key] || '#8b949e'}"
                  ></div>
                `,
              )}
            </div>
            <div class="legend-row">
              ${categories.map(
                (c) => html`
                  <span class="legend-item">
                    <span class="legend-dot" style="background: ${_COLORS[c.key] || '#8b949e'}"></span>
                    ${c.label}: ${_fmtTokens(c.tokens)}
                  </span>
                `,
              )}
            </div>
          `
        : ''}

      <div class="category-list">
        ${categories.map(
          (c) => this._renderCategoryRow(c, maxCat),
        )}
      </div>

      ${this._renderSessionTotals()}
    `;
  }

  _renderCategoryRow(c, maxCat) {
    // Files is the only category with per-entry detail worth
    // surfacing inline. Render it as a clickable expander row
    // followed by a nested file list when expanded. Every
    // other category renders as a plain non-interactive row.
    const color = _COLORS[c.key] || '#8b949e';
    const tokenPct = maxCat > 0 ? (c.tokens / maxCat) * 100 : 0;
    if (c.key !== 'files') {
      return html`
        <div class="category-row">
          <span class="category-name">${c.label}</span>
          <div class="category-bar-track">
            <div
              class="category-bar-fill"
              style="width: ${tokenPct}%; background: ${color}"
            ></div>
          </div>
          <span class="category-tokens">${_fmtTokens(c.tokens)}</span>
        </div>
      `;
    }
    const expanded = this._budgetFilesExpanded;
    const fileDetails =
      this._data?.breakdown?.file_details;
    const hasDetails =
      Array.isArray(fileDetails) && fileDetails.length > 0;
    return html`
      <div
        class="category-row category-row-expandable"
        role="button"
        aria-expanded=${expanded}
        title=${hasDetails
          ? (expanded
              ? 'Click to collapse file list'
              : 'Click to expand file list')
          : 'No file detail available'}
        @click=${hasDetails ? () => this._toggleBudgetFiles() : undefined}
      >
        <span class="category-toggle">
          ${hasDetails ? (expanded ? '▼' : '▶') : ''}
        </span>
        <span class="category-name">${c.label}</span>
        <div class="category-bar-track">
          <div
            class="category-bar-fill"
            style="width: ${tokenPct}%; background: ${color}"
          ></div>
        </div>
        <span class="category-tokens">${_fmtTokens(c.tokens)}</span>
      </div>
      ${expanded && hasDetails
        ? html`
            <div class="file-detail-list">
              ${fileDetails.map(
                (f) => html`
                  <div class="file-detail-row" title=${f.path}>
                    <span class="file-detail-path">${f.path}</span>
                    <span class="file-detail-tokens">
                      ${_fmtTokens(f.tokens)}
                    </span>
                  </div>
                `,
              )}
            </div>
          `
        : ''}
    `;
  }

  _renderSessionTotals() {
    const st = this._data?.session_totals;
    if (!st) return '';
    return html`
      <div class="session-totals">
        <div class="session-totals-title">Session Totals</div>
        <div class="totals-grid">
          <span class="totals-label">Prompt In</span>
          <span class="totals-value">${_fmtTokens(st.prompt || st.input_tokens || 0)}</span>
          <span class="totals-label">Completion Out</span>
          <span class="totals-value">${_fmtTokens(st.completion || st.output_tokens || 0)}</span>
          <span class="totals-label">Total</span>
          <span class="totals-value">${_fmtTokens(st.total || 0)}</span>
          ${(st.cache_hit || st.cache_read_tokens || 0) > 0
            ? html`
                <span class="totals-label">Cache Read</span>
                <span class="totals-value cache-read">${_fmtTokens(st.cache_hit || st.cache_read_tokens || 0)}</span>
              `
            : ''}
          ${(st.cache_write || st.cache_write_tokens || 0) > 0
            ? html`
                <span class="totals-label">Cache Write</span>
                <span class="totals-value cache-write">${_fmtTokens(st.cache_write || st.cache_write_tokens || 0)}</span>
              `
            : ''}
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------
  // Cache sub-view
  // ---------------------------------------------------------------

  _renderCache() {
    if (!this._data) {
      return html`<div class="empty-state">
        ${this._loading ? 'Loading…' : 'No data yet — send a message first'}
      </div>`;
    }
    const d = this._data;
    const cacheRate = d.provider_cache_rate ?? d.cache_hit_rate ?? 0;
    const rawBlocks = Array.isArray(d.blocks) ? d.blocks : [];
    const promotions = Array.isArray(d.promotions) ? d.promotions : [];
    const demotions = Array.isArray(d.demotions) ? d.demotions : [];
    const hasChanges = promotions.length > 0 || demotions.length > 0;
    const filterQuery = this._cacheFilter.trim();
    // Apply filter to each tier's contents. A tier survives
    // when at least one measured item matches; unmeasured
    // items (aggregate count) are kept visible as long as
    // the tier itself survives, since they have no per-item
    // name to match against. Tiers with nothing surviving
    // drop out entirely so the display focuses on hits.
    const blocks = filterQuery
      ? rawBlocks
          .map((block) => this._filterTierBlock(block, filterQuery))
          .filter((block) => block !== null)
      : rawBlocks;
    const noMatches = filterQuery && blocks.length === 0;

    return html`
      <div class="cache-actions">
        <button
          class="rebuild-btn"
          ?disabled=${this._rebuilding || this._loading || !this.rpcConnected}
          @click=${() => this._rebuild()}
          title="Rebuild cache — redistribute all symbols/docs into tiers L0-L3. Selected files stay in active context."
        >
          ${this._rebuilding ? '⏳ Rebuilding…' : '🔄 Rebuild'}
        </button>
      </div>

      <div class="cache-header">
        <div class="cache-hit-label">
          <span>Cache Performance</span>
          <span>${cacheRate > 0 ? `${Math.round(cacheRate * 100)}% hit rate` : 'No cache data'}</span>
        </div>
        <div class="cache-hit-bar-container">
          <div
            class="cache-hit-bar-fill"
            style="width: ${Math.min(100, cacheRate * 100)}%; background: ${cacheRate >= 0.5 ? '#7ee787' : cacheRate >= 0.2 ? '#d29922' : '#f85149'};"
          ></div>
        </div>
      </div>

      ${hasChanges
        ? html`
            <div class="changes-section">
              <div class="changes-title">Recent Changes</div>
              ${promotions.map(
                (p) => html`<div class="change-item">📈 ${p}</div>`,
              )}
              ${demotions.map(
                (d_) => html`<div class="change-item">📉 ${d_}</div>`,
              )}
            </div>
          `
        : ''}

      ${noMatches
        ? html`<div class="no-matches">
            No items match “${filterQuery}”
          </div>`
        : blocks.map((block) => this._renderCacheTier(block))}

      <div class="cache-footer">
        <span>${d.model || '—'}</span>
        <span>Total: ${_fmtTokens(d.total_tokens || 0)}</span>
      </div>
    `;
  }

  /**
   * Filter a tier block's contents against a fuzzy query.
   *
   * Returns a new block with only matching measured items in
   * its ``contents`` array. Unmeasured items (``tokens === 0``)
   * are kept verbatim — they're aggregated into a summary
   * line rather than shown individually, so there's no name
   * to match against; dropping them based on a filter that
   * can't see them would be surprising.
   *
   * Matches against ``path`` first (the displayed label when
   * present) and falls back to ``name`` (the key). Returns
   * null when the tier has zero measured matches AND zero
   * unmeasured items — the caller filters those out so
   * empty tiers don't clutter a filtered view.
   */
  _filterTierBlock(block, query) {
    const contents = Array.isArray(block.contents) ? block.contents : [];
    const measured = contents.filter((c) => (c.tokens || 0) > 0);
    const unmeasured = contents.filter((c) => (c.tokens || 0) === 0);
    const matches = measured.filter((item) => {
      const label = item.path || item.name || '';
      return fuzzyMatch(label, query);
    });
    if (matches.length === 0 && unmeasured.length === 0) {
      return null;
    }
    return { ...block, contents: [...matches, ...unmeasured] };
  }

  _renderCacheTier(block) {
    const name = block.name || 'unknown';
    const color = _TIER_COLORS[name] || _TIER_COLORS.active;
    // Auto-expand filtered tiers — when the user is
    // searching, the expected behaviour is "show me the
    // matches", not "show me the matches if I remembered
    // to expand this tier first". The persisted expanded
    // set is preserved; this override is scoped to the
    // filtered render.
    const filtering = this._cacheFilter.trim() !== '';
    const expanded = filtering || this._cacheExpanded.has(name);
    const contents = Array.isArray(block.contents) ? block.contents : [];

    // Split into measured (tokens > 0) and unmeasured.
    const measured = contents.filter((c) => (c.tokens || 0) > 0);
    const unmeasuredCount = contents.length - measured.length;

    return html`
      <div class="tier-group">
        <div
          class="tier-header"
          @click=${() => this._toggleCacheTier(name)}
          role="button"
          aria-expanded=${expanded}
        >
          <span class="tier-toggle">${expanded ? '▼' : '▶'}</span>
          <span class="tier-name" style="color: ${color};">${name}</span>
          <span class="tier-spacer"></span>
          <span class="tier-tokens">${_fmtTokens(block.tokens || 0)}</span>
          ${block.cached
            ? html`<span class="tier-cached-icon">🔒</span>`
            : ''}
        </div>
        ${expanded
          ? html`
              <div class="tier-body">
                ${measured.map((item) =>
                  this._renderCacheItem(item, block, color),
                )}
                ${unmeasuredCount > 0
                  ? html`
                      <div class="tier-unmeasured">
                        📦 ${unmeasuredCount} pre-indexed
                        ${this._data?.mode === 'doc' ? 'documents' : 'symbols'}
                        (awaiting measurement)
                      </div>
                    `
                  : ''}
                ${contents.length === 0
                  ? html`<div class="tier-unmeasured">Empty tier</div>`
                  : ''}
              </div>
            `
          : ''}
      </div>
    `;
  }

  _renderCacheItem(item, block, tierColor) {
    const icon = _TYPE_ICONS[item.type] || '📋';
    const hasN = typeof item.n === 'number' && typeof item.threshold === 'number';
    const nPct = hasN && item.threshold > 0
      ? Math.min(100, (item.n / item.threshold) * 100)
      : 0;
    const key = item.name || item.path || '';
    const displayName = item.path || item.name || '—';

    return html`
      <div class="tier-item">
        <span class="tier-item-icon">${icon}</span>
        <span
          class="tier-item-name"
          title="Click to view index block for ${displayName}"
          @click=${() => this._openMapModal(key, displayName)}
          role="button"
        >
          ${item.name || item.path || '—'}
        </span>
        ${hasN
          ? html`
              <div class="tier-item-bar" title="N=${item.n}/${item.threshold}">
                <div
                  class="tier-item-bar-fill"
                  style="width: ${nPct}%; background: ${tierColor};"
                ></div>
              </div>
              <span class="tier-item-n">${item.n}/${item.threshold}</span>
            `
          : ''}
        <span class="tier-item-tokens">${_fmtTokens(item.tokens || 0)}</span>
      </div>
    `;
  }

  _renderMapModal() {
    if (!this._mapModal) return '';
    const m = this._mapModal;
    return html`
      <div
        class="modal-backdrop"
        @click=${(e) => {
          if (e.target.classList.contains('modal-backdrop')) {
            this._closeMapModal();
          }
        }}
      >
        <div class="modal-dialog">
          <div class="modal-header">
            <span class="modal-title" title=${m.name}>${m.name}</span>
            ${m.mode
              ? html`<span class="modal-mode-badge">${m.mode}</span>`
              : ''}
            <button
              class="modal-close"
              @click=${() => this._closeMapModal()}
              title="Close (Esc)"
            >×</button>
          </div>
          <div class="modal-body">
            ${m.loading
              ? html`<div class="modal-loading">Loading…</div>`
              : m.error
                ? html`<div class="modal-error">${m.error}</div>`
                : html`<pre>${m.content}</pre>`}
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('ac-context-tab', ContextTab);