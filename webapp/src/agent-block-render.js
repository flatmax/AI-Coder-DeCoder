// Pure rendering helpers for agent-spawn cards.
//
// Symmetric to edit-block-render.js — the chat panel's
// renderAssistantBody dispatches `agent` and `agent-pending`
// segments here, gets back an HTML string, and embeds via Lit's
// `unsafeHTML` directive.
//
// Visual language:
//
//   - Card chrome mirrors edit-block-card so the two block
//     types feel like peers (same border-radius, same header
//     layout, same status-badge geometry).
//   - Distinct accent — agent cards use a magenta/violet hue
//     instead of the edit-block blue, so users can tell at a
//     glance whether a card is "the LLM proposes a file edit"
//     vs. "the LLM spawned a worker agent".
//   - The agent's id renders as a clickable chip styled like
//     edit-block file-path chips. Clicking dispatches
//     `switch-agent-tab` which the chat panel handles by
//     flipping `_activeTabId`.
//   - The task body renders as markdown (collapsible if long).
//
// Status comes from the chat panel's per-request streaming
// state: pending (parsed but not yet dispatched), streaming
// (child stream in flight), complete (clean finish), error
// (stream-level error or failed edits in the child).

import { escapeHtml, renderMarkdown } from './markdown.js';

/**
 * Map of agent-card display statuses to badge metadata.
 *
 * Statuses follow the spec at specs4/7-future/parallel-agents.md
 * § Frontend agent-block rendering — pending / streaming /
 * complete / error. The CSS class is always
 * `agent-status-{status}` so the stylesheet can hook without
 * the renderer caring about colour.
 */
const STATUS_META = {
  pending: {
    icon: '⏳',
    label: 'Pending',
    cssClass: 'agent-status-pending',
  },
  streaming: {
    icon: '🤖',
    label: 'Working',
    cssClass: 'agent-status-streaming',
  },
  complete: {
    icon: '✅',
    label: 'Done',
    cssClass: 'agent-status-complete',
  },
  error: {
    icon: '❌',
    label: 'Failed',
    cssClass: 'agent-status-error',
  },
};

/**
 * Resolve a segment + optional live state into a display
 * status string. Always a key of STATUS_META.
 *
 * Precedence:
 *
 *   1. agent-pending (truncated stream) → `pending`
 *      (the spawn block hasn't even finished arriving yet)
 *   2. explicit status arg from caller → that value
 *      (chat panel passes the live execution status)
 *   3. agent segment with no status → `pending`
 *      (block parsed but the chat panel hasn't wired up
 *      the per-tab streaming subscription yet, or the
 *      agent's tab is gone)
 *
 * @param {Object} segment
 * @param {string | null} status
 * @returns {string}
 */
export function resolveDisplayStatus(segment, status) {
  if (segment.type === 'agent-pending') return 'pending';
  if (typeof status === 'string' && STATUS_META[status]) {
    return status;
  }
  return 'pending';
}

/**
 * Render the status badge — icon + label. Returns HTML.
 */
export function renderStatusBadge(status) {
  const meta = STATUS_META[status] || STATUS_META.pending;
  return (
    `<span class="agent-status-badge ${meta.cssClass}">` +
    `<span class="agent-status-icon">${meta.icon}</span>` +
    `<span class="agent-status-label">${escapeHtml(meta.label)}</span>` +
    `</span>`
  );
}

/**
 * Render the agent id as a clickable chip. The chip carries
 * `data-agent-id` which the chat panel's delegated click
 * handler (in input.js → onMessagesClick) recognises and uses
 * to flip the active tab.
 *
 * Empty/unknown ids render as a muted "(unnamed agent)"
 * placeholder — defensive against malformed AGENT blocks.
 */
export function renderAgentId(id) {
  const safe = typeof id === 'string' ? id : '';
  if (!safe) {
    return (
      `<span class="agent-id-chip agent-id-empty">` +
      `(unnamed agent)</span>`
    );
  }
  return (
    `<span class="agent-id-chip" ` +
    `data-agent-id="${escapeHtml(safe)}" ` +
    `role="button" tabindex="0" ` +
    `title="Switch to ${escapeHtml(safe)}'s tab">` +
    `🤖 ${escapeHtml(safe)}` +
    `</span>`
  );
}

/**
 * Render the optional mode pill — `code`, `doc`, `code+xref`,
 * `doc+xref`, or empty (inherit). Empty mode renders nothing
 * so cards aren't visually noisy when the orchestrator didn't
 * explicitly specify a mode.
 */
export function renderModePill(mode) {
  const safe = typeof mode === 'string' ? mode.trim() : '';
  if (!safe) return '';
  return (
    `<span class="agent-mode-pill" title="Repo-view mode">` +
    escapeHtml(safe) +
    `</span>`
  );
}

/**
 * Render the task body as markdown. Long tasks (more than ~6
 * lines or 600 chars) get a `<details>` wrapper so the card
 * doesn't dominate the message; short tasks render inline.
 *
 * The body goes through the chat panel's normal markdown
 * pipeline, which handles escaping internally — passing
 * arbitrary task text is safe against HTML injection.
 *
 * Empty tasks render a muted placeholder so a malformed
 * block (no `task:` field) is visible rather than rendering
 * an empty card.
 */
export function renderTaskBody(task) {
  const safe = typeof task === 'string' ? task : '';
  if (!safe.trim()) {
    return (
      `<div class="agent-task-empty">(no task specified)</div>`
    );
  }
  const md = renderMarkdown(safe);
  const lineCount = safe.split('\n').length;
  const isLong = lineCount > 6 || safe.length > 600;
  if (isLong) {
    return (
      `<details class="agent-task-body agent-task-long">` +
      `<summary class="agent-task-summary">` +
      `View task (${lineCount} lines)</summary>` +
      `<div class="md-content agent-task-markdown">${md}</div>` +
      `</details>`
    );
  }
  return (
    `<div class="agent-task-body">` +
    `<div class="md-content agent-task-markdown">${md}</div>` +
    `</div>`
  );
}

/**
 * Render a full agent card.
 *
 * @param {Object} segment — agent or agent-pending from
 *   segmentResponse()
 * @param {string | null} [status] — live execution status
 *   from the chat panel's per-request streaming state
 * @returns {string}
 */
export function renderAgentCard(segment, status) {
  const displayStatus = resolveDisplayStatus(segment, status || null);
  const meta = STATUS_META[displayStatus] || STATUS_META.pending;
  const parts = [
    `<div class="agent-block-card ${meta.cssClass}">`,
    `<div class="agent-card-header">`,
    `<div class="agent-card-header-left">`,
    renderAgentId(segment.id),
    renderModePill(segment.mode),
    `</div>`,
    renderStatusBadge(displayStatus),
    `</div>`,
    renderTaskBody(segment.task),
    `</div>`,
  ];
  return parts.join('');
}

// Re-exported for tests.
export { STATUS_META };