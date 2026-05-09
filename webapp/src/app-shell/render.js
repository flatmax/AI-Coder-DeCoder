// Render helpers for AppShell.
//
// Extracted from webapp/src/app-shell.js so the root component
// stays focused on lifecycle wiring. The host (AppShell instance)
// is passed in explicitly — these functions read reactive state
// off `host.*` and bind handlers to host methods.

import { html } from 'lit';

import { RESIZE_RIGHT, RESIZE_BOTTOM, RESIZE_CORNER } from './constants.js';

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
export function renderCompactionBar(host) {
  const status = host._historyStatus;
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

export function renderTemplate(host) {
  return html`
    <div class="viewer-background">
      <ac-diff-viewer
        class=${host._activeViewer === 'diff'
          ? 'viewer-visible'
          : 'viewer-hidden'}
        @active-file-changed=${host._onActiveFileChanged}
      ></ac-diff-viewer>
      <ac-svg-viewer
        class=${host._activeViewer === 'svg'
          ? 'viewer-visible'
          : 'viewer-hidden'}
        @active-file-changed=${host._onActiveFileChanged}
      ></ac-svg-viewer>
    </div>

    <ac-file-nav
      @navigate-file=${host._onNavigateFile}
    ></ac-file-nav>

    <div
      class="dialog ${host._undockedPos ? 'floating' : ''} ${host._minimized ? 'minimized' : ''}"
      style=${host._dialogInlineStyle()}
    >
      ${host.connectionState === 'disconnected' ? html`
        <div class="reconnect-banner">
          Reconnecting… (attempt ${host.reconnectAttempt})
        </div>
      ` : null}
      <div
        class="dialog-header"
        @pointerdown=${host._onHeaderPointerDown}
      >
        <div class="tab-group-right">
          <button
            class="tab-button icon-only ${host.activeTab === 'context' ? 'active' : ''}"
            @click=${() => host._switchTab('context')}
            title="Context — token budget and cache tier viewer"
            aria-label="Context"
          >📊</button>
          ${host._docConvertAvailable ? html`
            <button
              class="tab-button icon-only ${host.activeTab === 'doc-convert' ? 'active' : ''}"
              @click=${() => host._switchTab('doc-convert')}
              title="Convert documents to markdown"
              aria-label="Convert"
            >📄</button>
          ` : null}
          <button
            class="tab-button icon-only ${host.activeTab === 'settings' ? 'active' : ''}"
            @click=${() => host._switchTab('settings')}
            title="Settings"
            aria-label="Settings"
          >⚙️</button>
          <button
            class="minimize-button"
            title=${host._minimized ? 'Expand' : 'Minimize'}
            @click=${host._toggleMinimize}
          >${host._minimized ? '▴' : '▾'}</button>
        </div>
      </div>
      <div class="dialog-body">
        <div class="tab-panel ${host.activeTab === 'files' ? 'active' : ''}">
          <ac-files-tab></ac-files-tab>
        </div>
        <div class="tab-panel ${host.activeTab === 'context' ? 'active' : ''}">
          <ac-context-tab></ac-context-tab>
        </div>
        <div class="tab-panel ${host.activeTab === 'settings' ? 'active' : ''}">
          <ac-settings-tab></ac-settings-tab>
        </div>
        ${host._docConvertAvailable ? html`
          <div class="tab-panel ${host.activeTab === 'doc-convert' ? 'active' : ''}">
            <ac-doc-convert-tab></ac-doc-convert-tab>
          </div>
        ` : null}
      </div>
      <ac-doc-index-progress></ac-doc-index-progress>
      ${renderCompactionBar(host)}
      <div
        class="resize-handle right"
        @pointerdown=${(e) => host._onHandlePointerDown(e, RESIZE_RIGHT)}
      ></div>
      <div
        class="resize-handle bottom"
        @pointerdown=${(e) => host._onHandlePointerDown(e, RESIZE_BOTTOM)}
      ></div>
      <div
        class="resize-handle corner"
        @pointerdown=${(e) => host._onHandlePointerDown(e, RESIZE_CORNER)}
      ></div>
    </div>

    ${host.overlayVisible ? html`
      <div class="startup-overlay ${host.startupPercent >= 100 ? 'fading' : ''}">
        <div class="startup-brand">
          <span>AC</span><span class="bolt">⚡</span><span>DC</span>
        </div>
        <div class="startup-message">${host.startupMessage}</div>
        <div class="startup-progress">
          <div
            class="startup-progress-bar"
            style="width: ${host.startupPercent}%"
          ></div>
        </div>
      </div>
    ` : null}

    <div class="toast-layer">
      ${host.toasts.map((toast) => html`
        <div class="toast ${toast.type}" data-toast-id=${toast.id}>
          ${toast.message}
        </div>
      `)}
    </div>

    <ac-compaction-progress></ac-compaction-progress>

    <ac-token-hud></ac-token-hud>
  `;
}