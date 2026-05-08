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
 * Returns an empty template when only the main tab
 * exists. Otherwise produces one dot per non-main tab
 * in tab insertion order, mirroring the tab strip.
 * Click delegates to `onTabClick` so the LED is a
 * second entry point for tab activation.
 *
 * Wrapping: the row uses flex-wrap so 8+ agents flow
 * onto a second line rather than truncating, per spec.
 * Each dot has a fixed small footprint; no overflow
 * indicator and no cap.
 */
export function renderLedRow(panel) {
  const tabs = Array.from(panel._tabs.keys()).filter(
    (id) => id !== 'main',
  );
  if (tabs.length === 0) {
    return html``;
  }
  return html`
    <div class="led-row" role="group" aria-label="Agent status">
      ${tabs.map((tabId) => {
        const tab = panel._tabs.get(tabId);
        if (!tab) return html``;
        const mode = panel._tabModes.get(tabId) || '';
        const state = getLedState(tab);
        const tooltip = formatLedTooltip(
          tabId, mode, state, tab.lastEditOutcome,
        );
        const active = tabId === panel._activeTabId;
        const classes = [
          'led-dot',
          `led-${state}`,
          active ? 'active' : '',
        ].filter(Boolean).join(' ');
        return html`
          <button
            class=${classes}
            data-led-tab-id=${tabId}
            data-led-state=${state}
            title=${tooltip}
            aria-label=${tooltip}
            @click=${() => onTabClick(panel, tabId)}
          ></button>
        `;
      })}
    </div>
  `;
}