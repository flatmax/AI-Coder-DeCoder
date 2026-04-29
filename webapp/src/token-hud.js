// TokenHUD — floating transient overlay showing per-request
// token breakdown after each LLM response.
//
// Layer 5 Phase 3.6 — Token HUD.
//
// Appears after each stream-complete, auto-hides after 8
// seconds. Hover pauses the timer; mouse leave restarts.
// Dismiss button hides immediately. Section collapse state
// persisted to localStorage.
//
// Governing spec: specs4/5-webapp/viewers-hud.md#token-hud

import { LitElement, css, html } from 'lit';
import { RpcMixin } from './rpc-mixin.js';

/** Auto-hide delay (ms). */
const _AUTO_HIDE_MS = 8000;
/** Fade-out duration (ms). */
const _FADE_MS = 800;
/** localStorage key for collapsed sections. */
const _COLLAPSE_KEY = 'ac-dc-hud-collapsed';

/** Tier colors — warm-to-cool spectrum. */
const _TIER_COLORS = {
  L0: '#50c878',
  L1: '#2dd4bf',
  L2: '#60a5fa',
  L3: '#f59e0b',
  active: '#f97316',
};

/** Icons for tier sub-item types. Mirrors context-tab.js. */
const _TYPE_ICONS = {
  system: '⚙️',
  legend: '📖',
  symbols: '📦',
  doc_symbols: '📝',
  files: '📄',
  urls: '🔗',
  history: '💬',
};

function _fmtTokens(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0';
  if (n < 1000) return String(Math.round(n));
  return `${(n / 1000).toFixed(1)}K`;
}

function _cacheHitColor(rate) {
  if (rate >= 0.5) return '#7ee787';
  if (rate >= 0.2) return '#d29922';
  return '#f85149';
}

function _budgetColor(pct) {
  if (pct > 90) return '#f85149';
  if (pct > 75) return '#d29922';
  return '#7ee787';
}

export class TokenHud extends RpcMixin(LitElement) {
  static properties = {
    /** Whether the HUD is visible. */
    _visible: { type: Boolean, state: true },
    /** Whether the HUD is fading out. */
    _fading: { type: Boolean, state: true },
    /** Breakdown data from get_context_breakdown. */
    _data: { type: Object, state: true },
    /** Per-request token usage from streamComplete result. */
    _requestUsage: { type: Object, state: true },
    /** Set of collapsed section names. */
    _collapsed: { type: Object, state: true },
    /** Map-block modal content (null when closed). */
    _mapModalContent: { type: Object, state: true },
    /** Map-block modal title. */
    _mapModalTitle: { type: String, state: true },
  };

  static styles = css`
    :host {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 10000;
      display: none;
      pointer-events: none;
    }
    :host([visible]) {
      display: block;
      pointer-events: auto;
    }
    .hud {
      width: 340px;
      max-height: 80vh;
      overflow-y: auto;
      background: rgba(22, 27, 34, 0.96);
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px);
      font-size: 0.8125rem;
      color: var(--text-primary, #c9d1d9);
      transition: opacity ${_FADE_MS}ms ease;
    }
    :host(.fading) .hud {
      opacity: 0;
    }

    .hud-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.6rem 0.75rem;
      border-bottom: 1px solid rgba(240, 246, 252, 0.1);
    }
    .hud-model {
      flex: 1;
      font-weight: 600;
      font-size: 0.75rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cache-badge {
      font-size: 0.7rem;
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
      font-weight: 600;
    }
    .dismiss-btn {
      background: transparent;
      border: none;
      color: var(--text-secondary, #8b949e);
      cursor: pointer;
      font-size: 0.875rem;
      padding: 0.1rem 0.3rem;
      line-height: 1;
      border-radius: 3px;
    }
    .dismiss-btn:hover {
      background: rgba(240, 246, 252, 0.1);
      color: var(--text-primary, #c9d1d9);
    }

    .section {
      border-bottom: 1px solid rgba(240, 246, 252, 0.06);
    }
    .section:last-child {
      border-bottom: none;
    }
    .section-header {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.4rem 0.75rem;
      cursor: pointer;
      user-select: none;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-secondary, #8b949e);
    }
    .section-header:hover {
      background: rgba(240, 246, 252, 0.03);
    }
    .section-toggle {
      font-size: 0.625rem;
      width: 0.75rem;
      text-align: center;
    }
    .section-body {
      padding: 0.25rem 0.75rem 0.5rem;
    }

    .tier-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-bottom: 0.3rem;
    }
    .tier-name {
      min-width: 3.5rem;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .tier-bar-track {
      flex: 1;
      height: 4px;
      background: rgba(240, 246, 252, 0.08);
      border-radius: 2px;
      overflow: hidden;
    }
    .tier-bar-fill {
      height: 100%;
      border-radius: 2px;
    }
    .tier-tokens {
      min-width: 3.5rem;
      text-align: right;
      font-size: 0.75rem;
      font-family: 'SFMono-Regular', Consolas, monospace;
      color: #7ee787;
    }
    .tier-cached {
      font-size: 0.625rem;
      color: var(--text-secondary, #8b949e);
    }
    .tier-subitems {
      margin-left: 0.75rem;
      margin-bottom: 0.4rem;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      padding-left: 0.4rem;
      border-left: 1px solid rgba(240, 246, 252, 0.08);
    }
    .tier-subitem {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.7rem;
    }
    .tier-subitem-icon {
      flex-shrink: 0;
      width: 0.875rem;
      text-align: center;
    }
    .tier-subitem-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-secondary, #8b949e);
    }
    .tier-subitem-bar {
      flex-shrink: 0;
      width: 30px;
      height: 2px;
      background: rgba(240, 246, 252, 0.08);
      border-radius: 1px;
      overflow: hidden;
    }
    .tier-subitem-bar-fill {
      height: 100%;
      border-radius: 1px;
    }
    .tier-subitem-n {
      flex-shrink: 0;
      font-size: 0.6rem;
      color: var(--text-secondary, #8b949e);
      font-family: 'SFMono-Regular', Consolas, monospace;
      min-width: 2rem;
      text-align: right;
    }
    .tier-subitem-tokens {
      flex-shrink: 0;
      font-family: 'SFMono-Regular', Consolas, monospace;
      color: #7ee787;
      font-size: 0.65rem;
    }
    .tier-subitem-unmeasured {
      font-size: 0.7rem;
      color: var(--text-secondary, #8b949e);
      font-style: italic;
    }

    .request-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.2rem 0.75rem;
      font-size: 0.75rem;
    }
    .req-label {
      color: var(--text-secondary, #8b949e);
    }
    .req-value {
      text-align: right;
      font-family: 'SFMono-Regular', Consolas, monospace;
    }
    .req-value.green { color: #7ee787; }
    .req-value.yellow { color: #f59e0b; }

    .budget-bar-track {
      height: 4px;
      background: rgba(240, 246, 252, 0.08);
      border-radius: 2px;
      overflow: hidden;
      margin-bottom: 0.25rem;
    }
    .budget-bar-fill {
      height: 100%;
      border-radius: 2px;
    }
    .budget-label {
      display: flex;
      justify-content: space-between;
      font-size: 0.7rem;
      color: var(--text-secondary, #8b949e);
    }

    .change-item {
      font-size: 0.75rem;
      padding: 0.1rem 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .totals-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.2rem 0.75rem;
      font-size: 0.75rem;
    }
    .tot-label {
      color: var(--text-secondary, #8b949e);
    }
    .tot-value {
      text-align: right;
      font-family: 'SFMono-Regular', Consolas, monospace;
    }
    .tot-value.green { color: #7ee787; }
    .tot-value.yellow { color: #f59e0b; }

    .tier-subitem.clickable {
      cursor: pointer;
      border-radius: 3px;
      padding: 0.05rem 0.2rem;
      margin: 0 -0.2rem;
    }
    .tier-subitem.clickable:hover {
      background: rgba(240, 246, 252, 0.06);
    }

    /* Map-block modal — mirrors the Context tab's Cache
     * sub-view modal. Clicking a tier sub-item opens this
     * overlay with the full content the LLM sees for that
     * entry. */
    .map-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 10001;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .map-modal {
      background: var(--bg-primary, #0d1117);
      border: 1px solid rgba(240, 246, 252, 0.2);
      border-radius: 8px;
      max-width: min(900px, 90vw);
      max-height: 85vh;
      width: 100%;
      display: flex;
      flex-direction: column;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
    }
    .map-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid rgba(240, 246, 252, 0.1);
    }
    .map-modal-title {
      font-weight: 600;
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 0.85rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .map-modal-close {
      background: transparent;
      border: none;
      color: var(--text-secondary, #8b949e);
      cursor: pointer;
      font-size: 1rem;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
    }
    .map-modal-close:hover {
      background: rgba(240, 246, 252, 0.08);
      color: var(--text-primary, #c9d1d9);
    }
    .map-modal-body {
      flex: 1;
      overflow: auto;
      padding: 1rem;
    }
    .map-modal-body pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 0.75rem;
      line-height: 1.5;
      color: var(--text-primary, #c9d1d9);
    }
    .map-modal-error {
      color: #f85149;
      font-style: italic;
    }
    .map-modal-loading {
      color: var(--text-secondary, #8b949e);
      font-style: italic;
    }
  `;

  constructor() {
    super();
    this._visible = false;
    this._fading = false;
    this._data = null;
    this._requestUsage = null;
    this._collapsed = this._loadCollapsed();
    this._mapModalContent = null;
    this._mapModalTitle = '';

    this._autoHideTimer = null;
    this._fadeTimer = null;

    this._onStreamComplete = this._onStreamComplete.bind(this);
    this._onSessionChanged = this._onSessionChanged.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('stream-complete', this._onStreamComplete);
    // session-changed fires on startup (after session restore)
    // and when the user loads a historical session. We refresh
    // the backing breakdown data — but don't make the HUD
    // visible, because the HUD is per-request feedback, not a
    // persistent display. Keeps the next streamComplete's HUD
    // consistent with the restored session state.
    window.addEventListener('session-changed', this._onSessionChanged);
  }

  disconnectedCallback() {
    window.removeEventListener('stream-complete', this._onStreamComplete);
    window.removeEventListener('session-changed', this._onSessionChanged);
    this._clearTimers();
    super.disconnectedCallback();
  }

  // Reflect visible as an attribute for the :host([visible])
  // selector. Lit's `reflect: true` on a reactive property
  // would work, but _visible is internal state, not a public
  // attribute. Manual reflection keeps the API clean.
  updated(changedProps) {
    if (changedProps.has('_visible')) {
      if (this._visible) {
        this.setAttribute('visible', '');
      } else {
        this.removeAttribute('visible');
      }
    }
  }

  // ---------------------------------------------------------------
  // Stream-complete handler
  // ---------------------------------------------------------------

  _onStreamComplete(event) {
    const result = event.detail?.result;
    console.debug('[token-hud] stream-complete', {
      hasResult: !!result,
      hasError: !!result?.error,
      hasCancelled: !!result?.cancelled,
      currentVisible: this._visible,
      currentFading: this._fading,
    });
    if (!result) return;
    if (result.error) return;

    // Extract per-request usage immediately.
    //
    // Fields pulled from the backend's normalised shape (see
    // ``LLMService._run_completion_sync``): prompt/completion
    // are top-line counts; reasoning is a subset of completion
    // that the provider spent on hidden thinking (Claude
    // extended thinking, o1/o3); cache_read is unified across
    // Anthropic's ``cache_read_input_tokens`` and OpenAI's
    // ``prompt_tokens_details.cached_tokens`` so the HUD shows
    // one number regardless of provider. ``cost_usd`` lives on
    // the same payload but is deliberately NOT rendered here —
    // per the operator's preference, cost only appears in the
    // Context tab's session totals, not the per-request HUD.
    const usage = result.token_usage || {};
    this._requestUsage = {
      prompt: usage.prompt_tokens || 0,
      completion: usage.completion_tokens || 0,
      reasoning: usage.reasoning_tokens || 0,
      cacheRead: usage.cache_read_tokens || 0,
      cacheWrite: usage.cache_write_tokens || 0,
    };

    // Show immediately with whatever data we have.
    this._visible = true;
    this._fading = false;
    this.classList.remove('fading');
    this._startAutoHide();

    // Fetch full breakdown asynchronously.
    this._fetchBreakdown();
  }

  _onSessionChanged() {
    // Refresh backing breakdown data but stay hidden. The next
    // stream-complete will reveal the HUD with up-to-date
    // tier/budget/session-totals numbers. No per-request usage
    // to populate (session restore isn't a request), so
    // _requestUsage stays at whatever it was — the HUD's
    // "This Request" section renders the placeholder when
    // _requestUsage is null, which is the correct state
    // immediately after a restore.
    this._fetchBreakdown();
  }

  async _fetchBreakdown() {
    if (!this.rpcConnected) return;
    try {
      const result = await this.rpcExtract(
        'LLMService.get_context_breakdown',
      );
      this._data = result && typeof result === 'object' ? result : null;
    } catch (err) {
      const msg = err?.message || '';
      if (!msg.includes('method not found')) {
        console.debug('[token-hud] get_context_breakdown failed', err);
      }
    }
  }

  // ---------------------------------------------------------------
  // Auto-hide + hover pause
  // ---------------------------------------------------------------

  _startAutoHide() {
    this._clearTimers();
    this._autoHideTimer = setTimeout(() => {
      this._autoHideTimer = null;
      this._startFade();
    }, _AUTO_HIDE_MS);
  }

  _startFade() {
    this._fading = true;
    this.classList.add('fading');
    this._fadeTimer = setTimeout(() => {
      this._fadeTimer = null;
      this._visible = false;
      this._fading = false;
      this.classList.remove('fading');
    }, _FADE_MS);
  }

  _clearTimers() {
    if (this._autoHideTimer) {
      clearTimeout(this._autoHideTimer);
      this._autoHideTimer = null;
    }
    if (this._fadeTimer) {
      clearTimeout(this._fadeTimer);
      this._fadeTimer = null;
    }
  }

  _onMouseEnter() {
    this._clearTimers();
    this._fading = false;
    this.classList.remove('fading');
  }

  _onMouseLeave() {
    this._startAutoHide();
  }

  _dismiss() {
    this._clearTimers();
    this._visible = false;
    this._fading = false;
    this.classList.remove('fading');
  }

  // ---------------------------------------------------------------
  // Section collapse
  // ---------------------------------------------------------------

  _loadCollapsed() {
    try {
      const raw = localStorage.getItem(_COLLAPSE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return new Set(arr);
      }
    } catch (_) {}
    return new Set();
  }

  _saveCollapsed() {
    try {
      localStorage.setItem(
        _COLLAPSE_KEY,
        JSON.stringify([...this._collapsed]),
      );
    } catch (_) {}
  }

  _toggleSection(name) {
    const next = new Set(this._collapsed);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    this._collapsed = next;
    this._saveCollapsed();
  }

  _isExpanded(name) {
    return !this._collapsed.has(name);
  }

  // ---------------------------------------------------------------
  // Map-block modal
  // ---------------------------------------------------------------

  /**
   * Open the map-block modal for a tracker key. Mirrors the
   * Context tab's Cache sub-view behavior — fetches the
   * backend's formatted block for this item and displays it
   * in a centered overlay.
   *
   * Pauses the HUD's auto-hide timer while the modal is open
   * so the HUD doesn't fade out from under the user.
   */
  async _openMapModal(key, name) {
    this._mapModalTitle = name || key || '';
    // Sentinel: null means "closed", {} with a `loading`
    // flag means "fetching". The template distinguishes.
    this._mapModalContent = { loading: true };
    this._clearTimers();
    if (!this.rpcConnected) {
      this._mapModalContent = {
        error: 'Not connected to the server',
      };
      return;
    }
    try {
      const result = await this.rpcExtract(
        'LLMService.get_file_map_block',
        key,
      );
      this._mapModalContent =
        result && typeof result === 'object' ? result : {};
    } catch (err) {
      this._mapModalContent = {
        error: err?.message || 'Failed to fetch content',
      };
    }
  }

  _closeMapModal() {
    this._mapModalContent = null;
    this._mapModalTitle = '';
    // Resume the auto-hide timer so the HUD eventually
    // dismisses itself after the user closes the modal.
    this._startAutoHide();
  }

  _onMapModalKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this._closeMapModal();
    }
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  render() {
    if (!this._visible && !this._mapModalContent) return html``;

    const d = this._data;
    const cacheRate = d
      ? (d.provider_cache_rate ?? d.cache_hit_rate ?? 0)
      : 0;

    return html`
      ${this._visible ? html`
        <div
          class="hud"
          @mouseenter=${this._onMouseEnter}
          @mouseleave=${this._onMouseLeave}
        >
          ${this._renderHeader(d, cacheRate)}
          ${this._renderSection('Cache Tiers', 'tiers',
            () => this._renderTiers(d))}
          ${this._renderSection('This Request', 'request',
            () => this._renderRequest())}
          ${this._renderSection('History Budget', 'budget',
            () => this._renderBudget(d))}
          ${this._renderSection('Tier Changes', 'changes',
            () => this._renderChanges(d))}
          ${this._renderSection('Session Totals', 'totals',
            () => this._renderTotals(d))}
        </div>
      ` : ''}
      ${this._mapModalContent ? this._renderMapModal() : ''}
    `;
  }

  _renderMapModal() {
    const c = this._mapModalContent;
    let body;
    if (c.loading) {
      body = html`<div class="map-modal-loading">Loading…</div>`;
    } else if (c.error) {
      body = html`<div class="map-modal-error">${c.error}</div>`;
    } else {
      body = html`<pre>${c.content || '(empty)'}</pre>`;
    }
    return html`
      <div
        class="map-modal-backdrop"
        @click=${(e) => {
          if (e.target === e.currentTarget) this._closeMapModal();
        }}
        @keydown=${this._onMapModalKeyDown}
        tabindex="0"
        role="dialog"
        aria-modal="true"
      >
        <div class="map-modal">
          <div class="map-modal-header">
            <span class="map-modal-title"
              title=${this._mapModalTitle}
            >${this._mapModalTitle}</span>
            <button
              class="map-modal-close"
              @click=${this._closeMapModal}
              aria-label="Close"
            >✕</button>
          </div>
          <div class="map-modal-body">${body}</div>
        </div>
      </div>
    `;
  }

  _renderHeader(d, cacheRate) {
    const model = d?.model || '—';
    const color = _cacheHitColor(cacheRate);
    return html`
      <div class="hud-header">
        <span class="hud-model">${model}</span>
        ${cacheRate > 0
          ? html`<span
              class="cache-badge"
              style="background: ${color}22; color: ${color};"
            >${Math.round(cacheRate * 100)}%</span>`
          : ''}
        <button
          class="dismiss-btn"
          @click=${this._dismiss}
          title="Dismiss"
          aria-label="Dismiss token HUD"
        >✕</button>
      </div>
    `;
  }

  _renderSection(title, name, bodyFn) {
    const expanded = this._isExpanded(name);
    return html`
      <div class="section">
        <div
          class="section-header"
          @click=${() => this._toggleSection(name)}
          role="button"
          aria-expanded=${expanded}
        >
          <span class="section-toggle">${expanded ? '▼' : '▶'}</span>
          ${title}
        </div>
        ${expanded ? html`<div class="section-body">${bodyFn()}</div>` : ''}
      </div>
    `;
  }

  _renderTiers(d) {
    const blocks = d?.blocks;
    if (!Array.isArray(blocks) || blocks.length === 0) {
      return html`<span style="color: var(--text-secondary); font-size: 0.75rem; font-style: italic;">No tier data yet</span>`;
    }
    const maxTokens = Math.max(1, ...blocks.map((b) => b.tokens || 0));
    return html`
      ${blocks.map((b) => {
        const color = _TIER_COLORS[b.name] || _TIER_COLORS.active;
        const pct = maxTokens > 0 ? ((b.tokens || 0) / maxTokens) * 100 : 0;
        return html`
          <div class="tier-row">
            <span class="tier-name" style="color: ${color};">${b.name}</span>
            <div class="tier-bar-track">
              <div
                class="tier-bar-fill"
                style="width: ${pct}%; background: ${color};"
              ></div>
            </div>
            <span class="tier-tokens">${_fmtTokens(b.tokens || 0)}</span>
            ${b.cached
              ? html`<span class="tier-cached">🔒</span>`
              : ''}
          </div>
          ${this._renderTierSubItems(b, color)}
        `;
      })}
    `;
  }

  // Per-spec: each tier shows sub-items below its bar with
  // icon, name, N/threshold label, stability bar, tokens.
  // Measured items (tokens > 0) render individually; unmeasured
  // items collapse into a "N pre-indexed …" summary line —
  // mirrors the Cache sub-view's contract so the HUD and the
  // Context tab read the same way.
  _renderTierSubItems(b, color) {
    const contents = Array.isArray(b.contents) ? b.contents : [];
    if (contents.length === 0) return '';
    const measured = contents.filter((c) => (c.tokens || 0) > 0);
    const unmeasuredCount = contents.length - measured.length;
    const mode = this._data?.mode;
    return html`
      <div class="tier-subitems">
        ${measured.map((item) => this._renderTierSubItem(item, color))}
        ${unmeasuredCount > 0
          ? html`<div class="tier-subitem-unmeasured">
              📦 ${unmeasuredCount} pre-indexed
              ${mode === 'doc' ? 'documents' : 'symbols'}
            </div>`
          : ''}
      </div>
    `;
  }

  _renderTierSubItem(item, color) {
    const icon = _TYPE_ICONS[item.type] || '📋';
    const hasN = typeof item.n === 'number'
      && typeof item.threshold === 'number';
    const nPct = hasN && item.threshold > 0
      ? Math.min(100, (item.n / item.threshold) * 100)
      : 0;
    const displayName = item.path || item.name || '—';
    // Clickable when we have a key the backend knows how to
    // resolve — same criterion the Context tab's Cache sub-
    // view uses. The backend's get_file_map_block handles
    // system:, symbol:, doc:, file:, url:, and meta:* keys;
    // history: entries have no corresponding block so we
    // leave them non-clickable.
    const key = item.name;
    const clickable = typeof key === 'string'
      && key.length > 0
      && !key.startsWith('history:');
    return html`
      <div
        class="tier-subitem ${clickable ? 'clickable' : ''}"
        @click=${clickable
          ? () => this._openMapModal(key, displayName)
          : null}
        title=${clickable
          ? `Click to view: ${displayName}`
          : displayName}
      >
        <span class="tier-subitem-icon">${icon}</span>
        <span class="tier-subitem-name" title=${displayName}>
          ${displayName}
        </span>
        ${hasN
          ? html`
              <div class="tier-subitem-bar"
                   title="N=${item.n}/${item.threshold}">
                <div
                  class="tier-subitem-bar-fill"
                  style="width: ${nPct}%; background: ${color};"
                ></div>
              </div>
              <span class="tier-subitem-n">${item.n}/${item.threshold}</span>
            `
          : ''}
        <span class="tier-subitem-tokens">
          ${_fmtTokens(item.tokens || 0)}
        </span>
      </div>
    `;
  }

  _renderRequest() {
    const u = this._requestUsage;
    if (!u) {
      return html`<span style="color: var(--text-secondary); font-size: 0.75rem; font-style: italic;">—</span>`;
    }
    // Reasoning row renders unconditionally (even when zero)
    // per the operator's preference pinned in commit 1's
    // planning: models without extended-thinking report 0
    // and the persistent row makes the presence/absence of
    // reasoning unambiguous rather than "did the backend
    // forget to report it?". Other rows (cache read/write)
    // stay conditional because they're genuinely absent for
    // providers without caching, and a zero row there would
    // be noise.
    //
    // Note on the Completion row: the provider's
    // ``completion_tokens`` INCLUDES reasoning tokens. The
    // Reasoning row is a breakdown of that total, not an
    // additional charge — shown side by side so the user
    // can see what portion of output went to hidden
    // reasoning vs. visible response. E.g. "Completion:
    // 5.7K, Reasoning: 4.0K" means the visible response was
    // ~1.7K tokens and the model spent 4K reasoning.
    return html`
      <div class="request-grid">
        <span class="req-label">Prompt</span>
        <span class="req-value">${_fmtTokens(u.prompt)}</span>
        <span class="req-label">Completion</span>
        <span class="req-value">${_fmtTokens(u.completion)}</span>
        <span class="req-label">Reasoning</span>
        <span
          class="req-value"
          title="Hidden reasoning tokens (subset of Completion). Zero for models without extended thinking."
        >${_fmtTokens(u.reasoning)}</span>
        ${u.cacheRead > 0
          ? html`
              <span class="req-label">Cache Read</span>
              <span class="req-value green">${_fmtTokens(u.cacheRead)}</span>
            `
          : ''}
        ${u.cacheWrite > 0
          ? html`
              <span class="req-label">Cache Write</span>
              <span class="req-value yellow">${_fmtTokens(u.cacheWrite)}</span>
            `
          : ''}
      </div>
    `;
  }

  _renderBudget(d) {
    if (!d) return html`<span style="color: var(--text-secondary); font-size: 0.75rem; font-style: italic;">—</span>`;
    const total = d.total_tokens || 0;
    const max = d.max_input_tokens || 1000000;
    const pct = max > 0 ? Math.min(100, (total / max) * 100) : 0;
    const bd = d.breakdown || {};
    return html`
      <div class="budget-bar-track">
        <div
          class="budget-bar-fill"
          style="width: ${pct}%; background: ${_budgetColor(pct)};"
        ></div>
      </div>
      <div class="budget-label">
        <span>${_fmtTokens(total)} / ${_fmtTokens(max)}</span>
        <span>${pct.toFixed(1)}%</span>
      </div>
      ${bd.history > 0
        ? html`<div style="margin-top: 0.25rem; font-size: 0.7rem; color: var(--text-secondary);">
            History: ${_fmtTokens(bd.history)}
          </div>`
        : ''}
    `;
  }

  _renderChanges(d) {
    const promotions = d?.promotions;
    const demotions = d?.demotions;
    const hasChanges =
      (Array.isArray(promotions) && promotions.length > 0) ||
      (Array.isArray(demotions) && demotions.length > 0);
    if (!hasChanges) {
      return html`<span style="color: var(--text-secondary); font-size: 0.75rem; font-style: italic;">No changes this cycle</span>`;
    }
    return html`
      ${(promotions || []).map(
        (p) => html`<div class="change-item">📈 ${p}</div>`,
      )}
      ${(demotions || []).map(
        (d_) => html`<div class="change-item">📉 ${d_}</div>`,
      )}
    `;
  }

  _renderTotals(d) {
    const st = d?.session_totals;
    if (!st) {
      return html`<span style="color: var(--text-secondary); font-size: 0.75rem; font-style: italic;">—</span>`;
    }
    return html`
      <div class="totals-grid">
        <span class="tot-label">Prompt In</span>
        <span class="tot-value">${_fmtTokens(st.prompt || st.input_tokens || 0)}</span>
        <span class="tot-label">Completion Out</span>
        <span class="tot-value">${_fmtTokens(st.completion || st.output_tokens || 0)}</span>
        <span class="tot-label">Total</span>
        <span class="tot-value">${_fmtTokens(st.total || 0)}</span>
        ${(st.cache_hit || st.cache_read_tokens || 0) > 0
          ? html`
              <span class="tot-label">Cache Saved</span>
              <span class="tot-value green">${_fmtTokens(st.cache_hit || st.cache_read_tokens || 0)}</span>
            `
          : ''}
        ${(st.cache_write || st.cache_write_tokens || 0) > 0
          ? html`
              <span class="tot-label">Cache Written</span>
              <span class="tot-value yellow">${_fmtTokens(st.cache_write || st.cache_write_tokens || 0)}</span>
            `
          : ''}
      </div>
    `;
  }
}

customElements.define('ac-token-hud', TokenHud);