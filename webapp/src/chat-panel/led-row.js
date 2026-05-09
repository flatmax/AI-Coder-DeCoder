// LED row for the chat-panel "main tab header".
//
// Renders one dot per live agent tab between the tab
// strip and the message list. Each dot reflects that
// agent's current state derived from the tab object
// (`streaming` flag plus `lastEditOutcome` written by
// the streaming pipeline) and carries a hover tooltip
// per ``specs4/5-webapp/agent-browser.md`` § Status
// LEDs.
//
// This module is purely presentational. State writes
// live in ``streaming.js`` (`onStreamComplete` and
// `onStreamChunk`) and the per-agent-mode store in
// ``tabs.js`` (`spawnAgentTabs`). The LED row reads
// that state directly off `panel._tabs` and
// `panel._tabModes` on each render.
//
// Three exports:
//
//   - `getLedState(tab)` — pure function returning
//     'cyan' | 'green' | 'red'. Streaming wins over
//     completion state (a tab that just started a new
//     stream after a previous failure should flash
//     cyan, not stay red). Pinned in tests.
//
//   - `formatLedTooltip(agentId, mode, state, outcome)`
//     — pure tooltip-string builder, three forms per
//     spec.
//
//   - `renderLedRow(panel)` — Lit template returning
//     the row, or an empty fragment when no agent tabs
//     exist. Click handler is `onTabClick` from
//     ``tabs.js``.

import { html } from 'lit';
import { onTabClick } from './tabs.js';

/**
 * Click handler for the right-side Context icon. Dispatches
 * `request-dialog-tab` so the app-shell flips to the Context
 * overlay scoped to whichever tab is currently active.
 *
 * The Context overlay reads the active tab from the chat
 * panel's `_activeTabId` setter event (`active-tab-changed`)
 * — we don't need to pass it explicitly here.
 */
function onContextIconClick(panel) {
  panel.dispatchEvent(
    new CustomEvent('request-dialog-tab', {
      detail: { tab: 'context' },
      bubbles: true,
      composed: true,
    }),
  );
}

/**
 * Click handler for the right-side minimize button. Dispatches
 * a `request-dialog-minimize` event the app-shell catches and
 * routes through its existing minimize toggle.
 */
function onMinimizeClick(panel) {
  panel.dispatchEvent(
    new CustomEvent('request-dialog-minimize', {
      bubbles: true,
      composed: true,
    }),
  );
}

/**
 * Scroll the tab strip so the button for `tabId` is
 * visible. No-op when the strip isn't rendered (single-
 * tab mode) or the button isn't found yet — the next
 * render will lay it out, but we only need to scroll
 * when the user actively jumps to a tab via its LED.
 *
 * Defers through `updateComplete` so any pending
 * activation render (which may move the active class
 * around) commits before we measure positions. The
 * tab-strip-scroll element is the horizontal scroll
 * container; `scrollIntoView` with inline:'nearest'
 * scrolls the minimum amount needed, leaving the
 * user's existing scroll position alone when the
 * target is already visible.
 */
function scrollTabIntoView(panel, tabId) {
  panel.updateComplete.then(() => {
    const root = panel.shadowRoot;
    if (!root) return;
    const btn = root.querySelector(
      `.tab-strip-scroll .tab-strip-tab[data-tab-id="${tabId}"]`,
    );
    if (!btn) return;
    // Test environments (happy-dom / older jsdom) may
    // not implement scrollIntoView. Guard so the LED
    // click handler doesn't throw an unhandled
    // rejection in those harnesses; real browsers
    // always have it.
    if (typeof btn.scrollIntoView !== 'function') return;
    btn.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  });
}

/**
 * Derive the LED state for one agent tab.
 *
 * Streaming → cyan (flashing). Resting state reads
 * `lastEditOutcome.status`: clean → green, error →
 * red. A tab that exists but has neither streamed nor
 * completed (defensive — agentsSpawned populates
 * `streaming = true` synchronously) defaults to cyan.
 *
 * Pure function. Caller is responsible for handling
 * `null` / `undefined` tab argument.
 */
export function getLedState(tab) {
  if (tab.streaming) return 'cyan';
  const outcome = tab.lastEditOutcome;
  if (outcome && outcome.status === 'error') return 'red';
  if (outcome && outcome.status === 'clean') return 'green';
  // Tab exists but no stream has produced an outcome
  // yet. Treat as in-flight; a real "agent finished
  // with nothing to report" produces a clean outcome.
  return 'cyan';
}

/**
 * Build the LED hover tooltip string per spec.
 *
 * Three forms based on state:
 *
 *   cyan   → `<id> (<mode>): running`
 *   green  → `<id> (<mode>): completed (N edits applied)`
 *   red    → `<id> (<mode>): <diagnostic>`
 *
 * Mode segment omitted when mode is missing — older
 * backends not yet reporting mode in `agentsSpawned`
 * still produce a useful tooltip, just without the
 * mode hint.
 *
 * Pure function for testability.
 */
export function formatLedTooltip(agentId, mode, state, outcome) {
  const modeSegment = mode ? ` (${mode})` : '';
  const prefix = `${agentId}${modeSegment}`;
  if (state === 'cyan') {
    return `${prefix}: running`;
  }
  if (state === 'green') {
    const n = outcome?.appliedCount ?? 0;
    const edits = n === 1 ? '1 edit applied' : `${n} edits applied`;
    return `${prefix}: completed (${edits})`;
  }
  // red
  const diag = outcome?.failureReason || 'failed';
  return `${prefix}: ${diag}`;
}

/**
 * Render the LED row.
 *
 * Always carries one dot for main plus one per agent
 * tab (in tab insertion order, mirroring the strip).
 * The row is permanent — even a fresh panel with no
 * agents shows the main-tab LED so users can see at a
 * glance whether the main thread is streaming, clean,
 * or errored. Click delegates to `onTabClick` so the
 * LED is a second entry point for tab activation.
 *
 * Wrapping: the row uses flex-wrap so 8+ agents flow
 * onto a second line rather than truncating, per spec.
 * Each dot has a fixed small footprint; no overflow
 * indicator and no cap.
 */
export function renderLedRow(panel) {
  // Always include the main tab. Agents follow in
  // tab insertion order. The row is permanent — even
  // a fresh panel with no agents shows a single dot
  // for main so users can see at a glance whether
  // the main thread is streaming, clean, or errored.
  const tabs = Array.from(panel._tabs.keys());
  if (tabs.length === 0) {
    return html``;
  }
  return html`
    <div
      class="led-row"
      role="group"
      aria-label="Conversation status"
      data-drag-handle="true"
    >
      ${tabs.map((tabId) => {
        const tab = panel._tabs.get(tabId);
        if (!tab) return html``;
        const isMain = tabId === 'main';
        // Main tab has no per-tab mode entry (mode for
        // main is reflected in the action-bar toggle);
        // agents carry an explicit mode in `_tabModes`.
        const mode = isMain
          ? ''
          : panel._tabModes.get(tabId) || '';
        const state = getLedState(tab);
        // Tooltip uses a friendlier label for main
        // ("Main") instead of the raw tab id, since
        // the literal string "main" is an internal
        // identifier rather than user-facing copy.
        const label = isMain ? 'Main' : tabId;
        const tooltip = formatLedTooltip(
          label, mode, state, tab.lastEditOutcome,
        );
        const active = tabId === panel._activeTabId;
        const classes = [
          'led-dot',
          `led-${state}`,
          isMain ? 'led-main' : '',
          active ? 'active' : '',
        ].filter(Boolean).join(' ');
        return html`
          <button
            class=${classes}
            data-led-tab-id=${tabId}
            data-led-state=${state}
            title=${tooltip}
            aria-label=${tooltip}
            @click=${() => {
              onTabClick(panel, tabId);
              scrollTabIntoView(panel, tabId);
            }}
          ></button>
        `;
      })}
      <div class="led-row-spacer" aria-hidden="true"></div>
      <button
        class="led-row-icon led-row-context"
        title="Context — token budget and cache tier viewer"
        aria-label="Open Context for the active conversation"
        @click=${() => onContextIconClick(panel)}
      >📊</button>
      <button
        class="led-row-icon led-row-minimize"
        title="Minimize dialog"
        aria-label="Minimize dialog"
        @click=${() => onMinimizeClick(panel)}
      >▾</button>
    </div>
  `;
}